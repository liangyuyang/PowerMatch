import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { DEFAULT_DESIGN } from "../src/shared/model.ts";
const base = "http://127.0.0.1:8787";
const origin = "http://127.0.0.1:5173";
const suffix = randomBytes(5).toString("hex");
const identities = ["employee", "outsider", "colleague", "admin"].map(
  (role, i) => ({
    id: role === "admin" ? "test-admin" : `test-${role}-${suffix}`,
    email:
      role === "admin"
        ? "patrick@miaomiaoce.com"
        : `test-${suffix}-${i}@${i === 1 ? "example.test" : "zenmeasure.com"}`,
    token: randomBytes(32).toString("hex"),
  }),
);
const sql = identities
  .map(
    (u) =>
      `INSERT INTO users(id,email,display_name) VALUES('${u.id}','${u.email}','Test') ON CONFLICT(email) DO NOTHING; INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('${createHash("sha256").update(u.token).digest("hex")}','${u.id}',${Math.floor(Date.now() / 1000) + 900});`,
  )
  .join("\n");
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/test-identities.sql", sql);
execFileSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "migrations",
    "apply",
    "powermatch-db",
    "--local",
  ],
  {
    stdio: "pipe",
    env: { ...process.env, WRANGLER_LOG_PATH: "tmp/test-wrangler.log" },
  },
);
execFileSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    "powermatch-db",
    "--local",
    "--file=tmp/test-identities.sql",
  ],
  {
    stdio: "pipe",
    env: { ...process.env, WRANGLER_LOG_PATH: "tmp/test-wrangler.log" },
  },
);
let assertions = 0;
async function request(
  path,
  {
    user,
    method = "GET",
    data,
    cookie,
    expected = 200,
    sendOrigin = true,
  } = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(sendOrigin ? { Origin: origin } : {}),
      ...(user
        ? { Cookie: `pm_session=${user.token}` }
        : cookie
          ? { Cookie: cookie }
          : {}),
      ...(data && !(data instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      data instanceof FormData ? data : data ? JSON.stringify(data) : undefined,
  });
  assert.equal(r.status, expected, `${method} ${path}: ${r.status}`);
  assertions++;
  return {
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
const [employee, outsider, colleague, admin] = identities;
fs.writeFileSync(
  "tmp/test-admin-browser.json",
  JSON.stringify({ token: admin.token }),
);
const linkToken = randomBytes(32).toString("hex");
fs.writeFileSync(
  "tmp/test-link.sql",
  `INSERT INTO login_tokens(token_hash,email,locale,expires_at) VALUES('${createHash("sha256").update(linkToken).digest("hex")}','${employee.email}','zh',${Math.floor(Date.now() / 1000) + 600});`,
);
execFileSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    "powermatch-db",
    "--local",
    "--file=tmp/test-link.sql",
  ],
  {
    stdio: "pipe",
    env: { ...process.env, WRANGLER_LOG_PATH: "tmp/test-wrangler.log" },
  },
);
await request("/api/auth/consume", {
  method: "POST",
  data: { token: linkToken },
});
await request("/api/auth/consume", {
  method: "POST",
  data: { token: linkToken },
  expected: 401,
});
await request("/api/admin", { user: admin });
await request("/api/admin/maintenance", {
  method: "POST",
  user: employee,
  data: {},
  expected: 403,
});
const upload = new FormData();
upload.set(
  "file",
  new File(
    [
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK3sAAAAASUVORK5CYII=",
        "base64",
      ),
    ],
    `test-${suffix}.png`,
    { type: "image/png" },
  ),
);
upload.set("parameters", JSON.stringify({ testValue: 1 }));
const part = (
  await request("/api/components", {
    method: "POST",
    user: outsider,
    data: {
      name: `Test ${suffix}`,
      category: "custom",
      manufacturer: "Test",
      source: "",
      description: "Local test only",
      parameters: { value: null },
    },
  })
).data;
const spec = (
  await request("/api/components/" + part.id + "/specs", {
    method: "POST",
    user: outsider,
    data: upload,
  })
).data;
await request("/api/specs/" + spec.id + "/review", {
  method: "POST",
  user: outsider,
  data: {
    action: "adopt",
    note: "Not authorized",
    parameters: { testValue: 2 },
  },
  expected: 403,
});
await request("/api/specs/" + spec.id + "/review", {
  method: "POST",
  user: employee,
  data: {
    action: "adopt",
    note: "Local fixture review",
    parameters: { testValue: 2 },
  },
});
const adopted = (await request("/api/components")).data.components.find(
  (x) => x.id === part.id,
);
assert.equal(adopted.parameters.testValue, 2);
assertions++;
await request("/api/admin", { expected: 403 });
await request("/api/admin", { user: employee, expected: 403 });
await request("/api/cases?scope=private", { user: outsider, expected: 403 });
await request("/api/calculate", {
  method: "POST",
  data: DEFAULT_DESIGN,
  sendOrigin: false,
  expected: 403,
});
const guest = (await request("/api/session")).cookie;
const create = (scope) => ({
  name: `API verification ${suffix}`,
  scope,
  design: DEFAULT_DESIGN,
});
await request("/api/cases", {
  method: "POST",
  cookie: guest,
  data: create("private"),
  expected: 403,
});
const priv = (
  await request("/api/cases", {
    method: "POST",
    user: employee,
    data: create("private"),
  })
).data;
await request("/api/cases/" + priv.id, { expected: 404 });
await request("/api/cases/" + priv.id, { user: colleague, expected: 404 });
await request("/api/posts", {
  method: "POST",
  user: employee,
  data: {
    type: "revision",
    target: priv.revisionId,
    body: "Private revision evidence",
  },
});
const pub = (
  await request("/api/cases", {
    method: "POST",
    user: employee,
    data: { ...create("public"), id: priv.id, expectedRevision: 1 },
  })
).data;
const publicRead = (await request("/api/cases/" + pub.id)).data;
assert.equal(publicRead.revisions.length, 1);
assert.equal(publicRead.revisions[0].number, 2);
assertions += 2;
await request("/api/posts?type=revision&target=" + priv.revisionId, {
  expected: 404,
});
await request("/api/cases", {
  method: "POST",
  user: outsider,
  data: { ...create("public"), parentRevision: priv.revisionId },
  expected: 404,
});
await request("/api/cases", {
  method: "POST",
  user: employee,
  data: { ...create("public"), id: priv.id, expectedRevision: 1 },
  expected: 409,
});
await request("/api/cases/" + pub.id, {
  method: "DELETE",
  user: outsider,
  expected: 404,
});
const own = (await request("/api/cases/" + pub.id, { user: employee })).data;
assert.equal(own.revisions.length, 2);
assertions++;
const guestCase = (
  await request("/api/cases", {
    method: "POST",
    cookie: guest,
    data: create("public"),
  })
).data;
await request("/api/cases/" + guestCase.id, {
  method: "DELETE",
  expected: 404,
});
await request("/api/cases/" + guestCase.id, {
  method: "DELETE",
  cookie: guest,
});
await request("/api/cases/" + pub.id, { method: "DELETE", user: employee });
await request("/api/admin/ai", { expected: 403 });
await request("/api/admin/ai", { user: outsider, expected: 403 });
await request("/api/ai/assist", { method: "POST", data: {}, expected: 401 });
const aiConfig = {
  provider: "deepseek",
  name: "Local test only",
  model: "test-model",
  inputPrice: null,
  outputPrice: null,
  currency: "CNY",
};
const aiId = `test-ai-${suffix}`;
await request("/api/admin/ai", {
  user: admin,
  method: "POST",
  data: {
    id: aiId,
    config: aiConfig,
    enabled: false,
    isDefault: false,
    revision: 0,
  },
});
await request("/api/admin/ai", {
  user: admin,
  method: "POST",
  data: {
    id: aiId,
    config: aiConfig,
    enabled: true,
    isDefault: true,
    revision: 1,
  },
  expected: 400,
});
await request("/api/admin/ai", {
  user: admin,
  method: "POST",
  data: {
    id: aiId,
    config: aiConfig,
    enabled: false,
    isDefault: false,
    revision: 0,
  },
  expected: 409,
});
await request("/api/ai/assist", {
  user: employee,
  method: "POST",
  data: {
    design: DEFAULT_DESIGN,
    modelId: aiId,
    locale: "zh",
    message: "Test",
    locks: ["load"],
    history: [],
  },
  expected: 503,
});
const available = await request("/api/ai/models");
assert.ok(!available.data.models.some((m) => m.id === aiId));
assertions++;
const aiAdmin = await request("/api/admin/ai", { user: admin });
assert.ok(!JSON.stringify(aiAdmin.data).includes("ciphertext"));
assertions++;
await request(`/api/admin/ai/${aiId}/check`, {
  user: admin,
  method: "POST",
  data: {},
  expected: 503,
});
const missingKeyLog = await request("/api/admin/ai", { user: admin });
assert.ok(
  missingKeyLog.data.usage.some(
    (x) =>
      x.model_id === aiId &&
      x.error_code === "missing-key" &&
      x.user_id === admin.id,
  ),
);
assertions++;
console.log(
  JSON.stringify({
    test: "local API authorization and revisions",
    assertions,
    result: "passed",
    externalEmailsSent: 0,
  }),
);
