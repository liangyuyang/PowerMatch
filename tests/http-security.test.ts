import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { app, type Env } from "../worker/index";
import { cloneDesign } from "../src/shared/model";
import { hash } from "../worker/security";
import {
  CONTENT_SECURITY_POLICY,
  REQUEST_BODY_LIMITS,
  requestBodyLimit,
  reserveRate,
} from "../worker/http-security";

const origin = "https://powermatch.zenmeasure.space";
let sqlite: DatabaseSync;
let env: Env;

// Run the real atomic SQL against isolated SQLite, exposing only the D1 methods
// used here. No deployed database, storage, mail or AI provider is contacted.
function localD1(database: DatabaseSync) {
  return {
    async batch(statements: { run(): Promise<unknown> }[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    prepare(sql: string) {
      let args: (string | number | null)[] = [];
      const statement = {
        bind(...values: (string | number | null)[]) {
          args = values;
          return statement;
        },
        async first() {
          return database.prepare(sql).get(...args) ?? null;
        },
        async all() {
          return { results: database.prepare(sql).all(...args), success: true };
        },
        async run() {
          const result = database.prepare(sql).run(...args);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function request(
  path: string,
  options: { method?: string; body?: BodyInit; headers?: HeadersInit } = {},
) {
  return app.request(
    origin + path,
    {
      method: options.method ?? "GET",
      body: options.body,
      headers: { Origin: origin, ...options.headers },
    },
    env,
  );
}

function expectProtected(response: Response) {
  expect(response.headers.get("Content-Security-Policy")).toBe(
    CONTENT_SECURITY_POLICY,
  );
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
}

async function signedIn(userId = "http-user", domain = "example.test") {
  const token = `session-${userId}`;
  sqlite
    .prepare("INSERT INTO users(id,email,display_name) VALUES(?,?,'Test')")
    .run(userId, `${userId}@${domain}`);
  sqlite
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run(await hash(token), userId, Math.floor(Date.now() / 1000) + 3600);
  return { Cookie: `pm_session=${token}` };
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(
      new URL("../worker/migrations/0001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL(
        "../worker/migrations/0002_visibility_preferences.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  env = {
    DB: localD1(sqlite),
    APP_ORIGIN: origin,
    ENVIRONMENT: "production",
  } as Env;
});
afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

describe("API response security", () => {
  it("covers success, early origin/auth denial, not-found and validation errors", async () => {
    const cases = [
      [await request("/api/health"), 200],
      [await request("/api/admin"), 403],
      [await request("/api/cases?scope=private"), 403],
      [await request("/api/does-not-exist"), 404],
      [await request("/api/components", { method: "POST", body: "{}" }), 401],
      [await request("/api/ai/assist", { method: "POST", body: "{}" }), 401],
      [await request("/api/calculate", { method: "POST", body: "{}" }), 400],
      [
        await request("/api/calculate", {
          method: "POST",
          body: "{}",
          headers: { Origin: "https://other.test" },
        }),
        403,
      ],
    ] as const;
    for (const [response, status] of cases) {
      expect(response.status).toBe(status);
      expectProtected(response);
    }
  });

  it("preserves session Set-Cookie while finalizing headers", async () => {
    const response = await request("/api/session");
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("pm_guest=");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expectProtected(response);
  });

  it("protects unexpected error responses without exposing the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    env.DB = {
      prepare() {
        throw new Error("private-details");
      },
    } as unknown as D1Database;
    const response = await request("/api/health");
    expect(response.status).toBe(500);
    expectProtected(response);
    expect(await response.json()).toEqual({ error: "request-failed" });
  });

  it("ships the same script-restricting policy for assets-first HTML", () => {
    const headers = readFileSync(
      new URL("../public/_headers", import.meta.url),
      "utf8",
    );
    expect(headers).toContain(
      `Content-Security-Policy: ${CONTENT_SECURITY_POLICY}`,
    );
    expect(headers).toContain("X-Frame-Options: DENY");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("Referrer-Policy: no-referrer");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self';");
    expect(CONTENT_SECURITY_POLICY).toContain(
      "style-src 'self' 'unsafe-inline';",
    );
  });
});

describe("bounded request bodies", () => {
  it("selects separate JSON, AI, extraction and upload budgets", () => {
    expect(requestBodyLimit("/api/cases", "POST")).toBe(128 * 1024);
    expect(requestBodyLimit("/api/admin/ai/settings", "POST")).toBe(128 * 1024);
    expect(requestBodyLimit("/api/ai/assist", "POST")).toBe(100000);
    expect(requestBodyLimit("/api/specs/extract", "POST")).toBe(
      5 * 1024 * 1024 + 128 * 1024,
    );
    expect(requestBodyLimit("/api/components/one/specs", "POST")).toBe(
      20 * 1024 * 1024 + 128 * 1024,
    );
    expect(requestBodyLimit("/api/components/one/specs", "PATCH")).toBe(
      128 * 1024,
    );
  });

  it("rejects actual oversized JSON with absent or understated Content-Length", async () => {
    for (const headers of [{}, { "Content-Length": "2" }] as Record<
      string,
      string
    >[]) {
      const response = await request("/api/calculate", {
        method: "POST",
        body: "x".repeat(REQUEST_BODY_LIMITS.json + 1),
        headers,
      });
      expect(response.status).toBe(413);
      expectProtected(response);
      expect(await response.json()).toEqual({ error: "request-too-large" });
    }
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM rate_limits").get()?.n,
    ).toBe(0);
  });

  it("bounds AI and both multipart routes before parser/storage work", async () => {
    for (const [path, limit] of [
      ["/api/ai/assist", REQUEST_BODY_LIMITS.ai],
      ["/api/specs/extract", REQUEST_BODY_LIMITS.extract],
      ["/api/components/one/specs", REQUEST_BODY_LIMITS.upload],
    ] as const) {
      const response = await request(path, {
        method: "POST",
        body: "small",
        headers: { "Content-Length": String(limit + 1) },
      });
      expect(response.status).toBe(413);
      expectProtected(response);
    }
  });

  it("accepts an exact-boundary valid JSON body and calculates normally", async () => {
    const design = cloneDesign();
    design.horizonDays = 1;
    const serialized = JSON.stringify(design);
    const body =
      serialized +
      " ".repeat(
        REQUEST_BODY_LIMITS.json - new TextEncoder().encode(serialized).length,
      );
    const response = await request("/api/calculate", { method: "POST", body });
    expect(response.status).toBe(200);
    expectProtected(response);
    expect(await response.json()).toHaveProperty("averageUa");
  });

  it("retains origin protection before reading a large body", async () => {
    const response = await request("/api/calculate", {
      method: "POST",
      body: "large",
      headers: { Origin: "https://other.test", "Content-Length": "999999999" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin-not-allowed" });
    expectProtected(response);
  });
});

describe("atomic route rate reservations", () => {
  it("permits only 60 concurrent calculation attempts per IP and returns retry time", async () => {
    const responses = await Promise.all(
      Array.from({ length: 61 }, () =>
        request("/api/calculate", { method: "POST", body: "{}" }),
      ),
    );
    expect(responses.filter((r) => r.status === 400)).toHaveLength(60);
    const rejected = responses.filter((r) => r.status === 429);
    expect(rejected).toHaveLength(1);
    expect(Number(rejected[0].headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number(rejected[0].headers.get("Retry-After"))).toBeLessThanOrEqual(
      60,
    );
    expectProtected(rejected[0]);
    const otherClient = await request("/api/calculate", {
      method: "POST",
      body: "{}",
      headers: { "CF-Connecting-IP": "192.0.2.2" },
    });
    expect(otherClient.status).toBe(400);
  });

  it("also caps a signed-in calculation account across IP addresses", async () => {
    const headers = await signedIn();
    const responses = await Promise.all(
      Array.from({ length: 61 }, (_, i) =>
        request("/api/calculate", {
          method: "POST",
          body: "{}",
          headers: { ...headers, "CF-Connecting-IP": `192.0.2.${i}` },
        }),
      ),
    );
    expect(responses.filter((r) => r.status === 429)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 400)).toHaveLength(60);
  });

  it("caps component creation at 20 per account and retains anonymous denial", async () => {
    const headers = await signedIn();
    const body = JSON.stringify({
      name: "Test component",
      category: "pv",
      manufacturer: "",
      source: "",
      description: "",
      parameters: {},
    });
    const responses = await Promise.all(
      Array.from({ length: 21 }, () =>
        request("/api/components", { method: "POST", body, headers }),
      ),
    );
    expect(responses.filter((r) => r.status === 200)).toHaveLength(20);
    const rejected = responses.find((r) => r.status === 429)!;
    expect(rejected).toBeDefined();
    expect(Number(rejected.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number(rejected.headers.get("Retry-After"))).toBeLessThanOrEqual(
      3600,
    );
    expectProtected(rejected);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM components").get()?.n,
    ).toBe(20);
    const anonymous = await request("/api/components", {
      method: "POST",
      body,
    });
    expect(anonymous.status).toBe(401);
    expectProtected(anonymous);
  });

  it("keeps counters bounded, hashes identifiers and resets only at expiry", async () => {
    const first = await reserveRate(env.DB, "test-raw-identity", 2, 60, 100);
    expect(first).toEqual({ allowed: true, retryAfter: 60 });
    expect(
      (await reserveRate(env.DB, "test-raw-identity", 2, 60, 101)).allowed,
    ).toBe(true);
    for (let i = 0; i < 5; i++)
      expect(
        await reserveRate(env.DB, "test-raw-identity", 2, 60, 159),
      ).toEqual({ allowed: false, retryAfter: 1 });
    const row = sqlite.prepare("SELECT * FROM rate_limits").get()!;
    expect(row.key).toBe(await hash("test-raw-identity"));
    expect(row.count).toBe(3);
    expect(await reserveRate(env.DB, "test-raw-identity", 2, 60, 160)).toEqual({
      allowed: true,
      retryAfter: 60,
    });
    expect(sqlite.prepare("SELECT count FROM rate_limits").get()?.count).toBe(
      1,
    );
  });

  it("caps component creation across accounts sharing an IP", async () => {
    const accounts = await Promise.all(
      Array.from({ length: 4 }, (_, i) => signedIn(`creator-${i}`)),
    );
    const body = JSON.stringify({
      name: "Test component",
      category: "pv",
      manufacturer: "",
      source: "",
      description: "",
      parameters: {},
    });
    const responses = await Promise.all(
      Array.from({ length: 61 }, (_, i) =>
        request("/api/components", {
          method: "POST",
          body,
          headers: accounts[i % accounts.length],
        }),
      ),
    );
    expect(responses.filter((r) => r.status === 200)).toHaveLength(60);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(1);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM components").get()?.n,
    ).toBe(60);
  });
});

describe("case actor consistency", () => {
  it("rejects guest-to-employee, employee-to-other and employee-to-guest saves before mutations", async () => {
    const employee = await signedIn("employee", "zenmeasure.com");
    const other = await signedIn("other", "zenmeasure.com");
    for (const [expectedActor, headers] of [
      ["guest", employee],
      ["employee", other],
      ["employee", {}],
    ] as const) {
      const response = await request("/api/cases", {
        method: "POST",
        headers,
        body: JSON.stringify({
          expectedActor,
          name: "Actor test",
          scope: "public",
          design: cloneDesign(),
        }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "identity-conflict" });
      expectProtected(response);
    }
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM cases").get()?.n).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM revisions").get()?.n).toBe(
      0,
    );
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM rate_limits").get()?.n,
    ).toBe(0);
  });

  it("retains matching actor saves and old clients without the actor field", async () => {
    const headers = await signedIn("employee", "zenmeasure.com");
    for (const expectedActor of ["employee", undefined]) {
      const response = await request("/api/cases", {
        method: "POST",
        headers,
        body: JSON.stringify({
          expectedActor,
          name: "Actor test",
          scope: "private",
          design: cloneDesign(),
        }),
      });
      expect(response.status).toBe(200);
      expectProtected(response);
    }
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM cases WHERE owner_id='employee' AND scope='private'",
        )
        .get()?.n,
    ).toBe(2);
  });

  it("rejects stale delete actors before deleting the current user's case", async () => {
    const headers = await signedIn("employee", "zenmeasure.com");
    sqlite
      .prepare(
        "INSERT INTO cases(id,owner_id,name,scope) VALUES('actor-case','employee','Actor test','private')",
      )
      .run();
    const response = await request("/api/cases/actor-case", {
      method: "DELETE",
      headers: { ...headers, "X-PowerMatch-Actor": "other" },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "identity-conflict" });
    expectProtected(response);
    expect(
      sqlite.prepare("SELECT deleted FROM cases WHERE id='actor-case'").get()
        ?.deleted,
    ).toBe(0);
    const matching = await request("/api/cases/actor-case", {
      method: "DELETE",
      headers: { ...headers, "X-PowerMatch-Actor": "employee" },
    });
    expect(matching.status).toBe(200);
    expect(
      sqlite.prepare("SELECT deleted FROM cases WHERE id='actor-case'").get()
        ?.deleted,
    ).toBe(1);
  });
});
