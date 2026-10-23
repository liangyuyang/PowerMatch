import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { processMail, recoverMail, mailStats } from "../worker/mail";
import { hash } from "../worker/security";
import type { Env } from "../worker/index";

let sqlite: DatabaseSync;
let env: Env;
let failAcceptedOnce = false;
const originalFrom = "PowerMatch Test <original@example.test>";
const recipient = "recipient@example.test";
const body = "<p>Isolated mock mail fixture</p>";
const saved = (id = "mail-test") => sqlite.prepare("SELECT * FROM mail_outbox WHERE id=?").get(id)!;

// All statements execute against SQLite. Batch executes synchronously inside a
// real transaction, so an exception cannot leave half a D1 batch committed.
function localD1(): D1Database {
  return {
    prepare(sql: string) {
      let args: (string | number | null)[] = [];
      const statement = {
        bind(...values: (string | number | null)[]) { args = values; return statement; },
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...args) }; },
        execute() {
          if (failAcceptedOnce && sql.includes("SET state='accepted'")) {
            failAcceptedOnce = false;
            throw Error("simulated acceptance persistence failure before commit");
          }
          const result = sqlite.prepare(sql).run(...args);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
        async run() { return statement.execute(); },
      };
      return statement;
    },
    async batch(statements: { execute(): unknown }[]) {
      sqlite.exec("BEGIN");
      try {
        const result = statements.map(statement => statement.execute());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}
function enqueue(id = "mail-test") {
  sqlite.prepare("INSERT INTO mail_outbox(id,user_id,recipient,subject,html) VALUES(?,'source',?,'Fixture subject',?)").run(id, recipient, body);
}
async function freezeAttempt(options: { id?: string; attempts?: number; state?: string; age?: string } = {}) {
  const { id = "mail-test", attempts = 1, state = "retry-wait", age = "-1 minute" } = options;
  enqueue(id);
  const snapshot = await hash(JSON.stringify({ from: originalFrom, to: [recipient], subject: "Fixture subject", html: body }));
  sqlite.prepare(`UPDATE mail_outbox SET attempts=?,state=?,payload_from=?,payload_hash=?,first_attempt_at=datetime('now',?),
    next_attempt_at=datetime('now','-1 second'),lease_token='expired-claim',lease_expires_at=datetime('now','-1 second') WHERE id=?`)
    .run(attempts, state, originalFrom, snapshot, age, id);
}
function due(id = "mail-test") { sqlite.prepare("UPDATE mail_outbox SET next_attempt_at=datetime('now','-1 second') WHERE id=?").run(id); }
function capturedRequest(index: number) {
  const [url, init] = vi.mocked(fetch).mock.calls[index];
  return { url, body: String(init?.body), key: new Headers(init?.headers).get("Idempotency-Key"), redirect: init?.redirect };
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../worker/migrations/", import.meta.url)).filter(file => file.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(new URL(`../worker/migrations/${file}`, import.meta.url), "utf8"));
  sqlite.prepare("INSERT INTO users(id,email,display_name) VALUES('source','source@example.test','Source'),('recipient',?,'Recipient')").run(recipient);
  env = { DB: localD1(), RESEND_API_KEY: "isolated-test-credential", RESEND_FROM: originalFrom } as Env;
  failAcceptedOnce = false;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "provider-fixture" })));
});
afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); });

describe("mail claims and provider idempotency recovery", () => {
  it("allows only one concurrent claimant to send a pending message", async () => {
    enqueue();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => { await gate; return Response.json({ id: "one-acceptance" }); }));
    const workers = [processMail(env), processMail(env), processMail(env)];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(saved()).toMatchObject({ state: "sending", attempts: 1, payload_from: originalFrom });
    expect(saved().lease_token).toBeTruthy();
    release(); await Promise.all(workers);
    expect(saved()).toMatchObject({ state: "accepted", provider_id: "one-acceptance", html: "", lease_token: null });
    expect(capturedRequest(0)).toMatchObject({ url: "https://api.resend.com/emails", key: "mail-test", redirect: "manual" });
    expect(await mailStats(env.DB)).toContainEqual({ state: "accepted", count: 1 });
  });

  it.each(["network", "provider-500", "invalid-envelope"])("retries %s with frozen payload, sender and idempotency key", async kind => {
    enqueue();
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (kind === "network") throw Error("simulated connection interrupted");
      return kind === "provider-500" ? new Response("temporary rejection", { status: 500 }) : Response.json({ unexpected: true });
    }));
    await processMail(env);
    expect(saved()).toMatchObject({ state: "retry-wait", attempts: 1, html: body, payload_from: originalFrom });
    const first = capturedRequest(0), firstAttempt = saved().first_attempt_at, firstHash = saved().payload_hash;
    env.RESEND_FROM = "Changed Test <changed@example.test>";
    due();
    vi.mocked(fetch).mockImplementation(async () => Response.json({ id: "safe-retry" }));
    await processMail(env);
    expect(capturedRequest(1)).toEqual(first);
    expect(JSON.parse(capturedRequest(1).body).from).toBe(originalFrom);
    expect(saved()).toMatchObject({ state: "accepted", attempts: 2, provider_id: "safe-retry", first_attempt_at: firstAttempt, payload_hash: firstHash });
  });

  it.each(["-23 hours", "-1381 minutes"])("does not retry at or beyond the safe-window boundary (%s)", async age => {
    await freezeAttempt({ age });
    await processMail(env);
    expect(saved()).toMatchObject({ state: "manual-review", attempts: 1, error_code: "mail-retry-window-expired", html: body });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("can safely retry inside the 23-hour window and stops after three attempts", async () => {
    await freezeAttempt({ age: "-1379 minutes", attempts: 2 });
    vi.stubGlobal("fetch", vi.fn(async () => { throw Error("unknown outcome again"); }));
    await processMail(env);
    expect(saved()).toMatchObject({ state: "manual-review", attempts: 3, html: body });
    due(); await recoverMail(env.DB, true); await processMail(env);
    expect(saved()).toMatchObject({ state: "manual-review", attempts: 3 });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("recovers exhausted expired claims for manual inspection without a fourth send", async () => {
    await freezeAttempt({ attempts: 3, state: "sending" });
    await processMail(env);
    expect(saved()).toMatchObject({ state: "manual-review", attempts: 3, error_code: "mail-attempts-exhausted" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["payload_hash", "payload_from", "first_attempt_at"])("requires manual review when an attempted legacy message lacks %s", async field => {
    await freezeAttempt({ state: "pending" });
    sqlite.exec(`UPDATE mail_outbox SET ${field}=NULL`);
    await processMail(env);
    expect(saved()).toMatchObject({ state: "manual-review", attempts: 1, error_code: "mail-payload-unknown", html: body });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["acceptance", "failure"])("prevents expired claimant %s from overwriting a newer live claim", async outcome => {
    enqueue();
    let releaseOld!: () => void, releaseNew!: () => void;
    const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
    const newGate = new Promise<void>(resolve => { releaseNew = resolve; });
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => { await oldGate; if (outcome === "failure") throw Error("late unknown outcome"); return Response.json({ id: "expired-provider" }); })
      .mockImplementationOnce(async () => { await newGate; return Response.json({ id: "new-provider" }); }));
    const oldWorker = processMail(env);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const oldToken = saved().lease_token;
    sqlite.exec("UPDATE mail_outbox SET lease_expires_at=datetime('now','-1 second')");
    const newWorker = processMail(env);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const newToken = saved().lease_token;
    expect(newToken).not.toBe(oldToken);
    expect(saved()).toMatchObject({ state: "sending", attempts: 2 });
    releaseOld(); await oldWorker;
    expect(saved()).toMatchObject({ state: "sending", attempts: 2, lease_token: newToken, provider_id: null });
    releaseNew(); await newWorker;
    expect(saved()).toMatchObject({ state: "accepted", attempts: 2, provider_id: "new-provider" });
    expect(capturedRequest(1)).toEqual(capturedRequest(0));
  });

  it("safely retries when provider accepted but local accepted-state persistence failed", async () => {
    enqueue(); failAcceptedOnce = true;
    await processMail(env);
    expect(saved()).toMatchObject({ state: "retry-wait", attempts: 1, provider_id: null, html: body, error_code: "mail-send-or-storage-outcome-unknown" });
    const original = capturedRequest(0);
    due(); await processMail(env);
    expect(capturedRequest(1)).toEqual(original);
    expect(saved()).toMatchObject({ state: "accepted", attempts: 2, provider_id: "provider-fixture", html: "" });
  });

  it.each(["source", "recipient"])("suppresses delivery when the %s account is disabled", async id => {
    enqueue(); sqlite.prepare("UPDATE users SET active=0 WHERE id=?").run(id);
    await processMail(env);
    expect(saved()).toMatchObject({ state: "skipped", error_code: "account-disabled", html: "", lease_token: null });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["subject", "html", "recipient", "payload_from"])("does not reuse a provider key after persisted %s changes", async field => {
    await freezeAttempt();
    sqlite.prepare(`UPDATE mail_outbox SET ${field}=?`).run(field === "recipient" ? "changed@example.test" : "changed fixture");
    await processMail(env);
    expect(saved()).toMatchObject({ state: "manual-review", attempts: 1, error_code: "mail-payload-changed" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lets maintenance recover a missing sender failure that never attempted delivery", async () => {
    enqueue(); delete env.RESEND_FROM;
    await processMail(env);
    expect(saved()).toMatchObject({ state: "failed", attempts: 0, error_code: "email-not-configured", first_attempt_at: null, payload_hash: null, html: body });
    expect(fetch).not.toHaveBeenCalled();
    env.RESEND_FROM = originalFrom;
    await recoverMail(env.DB, true);
    expect(saved()).toMatchObject({ state: "pending", attempts: 0 });
    await processMail(env);
    expect(saved()).toMatchObject({ state: "accepted", attempts: 1, provider_id: "provider-fixture" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
