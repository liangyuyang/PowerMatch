import type { Hono } from "hono";
import type { Env } from "./index";
import {
  comparisonFingerprint,
  comparisonWriteSchema,
  type ComparisonSnapshot,
} from "../src/shared/comparisons";
import { designSchema, type Viewer, type Scope } from "../src/shared/model";
import { ENGINE_VERSION } from "../src/shared/engine";
import { pinComponentEvidence } from "./component-evidence";
import { canEditCase, canReadCase, hash } from "./security";
import { reserveRate, rateLimited } from "./http-security";

type App = Hono<{
  Bindings: Env;
  Variables: { user: Viewer | null; guestHash: string };
}>;
type Header = {
  id: string;
  owner_id: string | null;
  guest_hash: string | null;
  name: string;
  scope: Scope;
  latest_revision: number;
  deleted: number;
};
type Revision = {
  id: string;
  comparison_id: string;
  number: number;
  scope: Scope;
  name: string;
  locked: number;
  snapshots_json: string;
  actor_key: string;
  request_id: string;
  request_hash: string;
  created_at: string;
};
const failure = (error: string, status = 400) =>
  Response.json({ error }, { status });
const narrower = (target: Scope, source: Scope) =>
  source === "public" ||
  target === "private" ||
  (source === "company" && target === "company");
const canRead = (
  row: Parameters<typeof canReadCase>[0],
  user: Viewer | null,
  guest: string,
) =>
  (row.scope === "public" || !!user?.employee) && canReadCase(row, user, guest);
async function sourceRevision(
  db: D1Database,
  id: string,
  user: Viewer | null,
  guest: string,
  target?: Scope,
) {
  const row = await db
    .prepare(
      "SELECT c.owner_id,c.guest_hash,c.deleted,c.scope AS current_scope,r.scope,r.design_json,r.engine_version FROM revisions r JOIN cases c ON c.id=r.case_id WHERE r.id=?",
    )
    .bind(id)
    .first<{
      owner_id: string | null;
      guest_hash: string | null;
      deleted: number;
      current_scope: Scope;
      scope: Scope;
      design_json: string;
      engine_version: string;
    }>();
  if (
    !row ||
    !canRead(row, user, guest) ||
    !canRead({ ...row, scope: row.current_scope }, user, guest)
  )
    throw Error("source-unavailable");
  if (
    target &&
    (!narrower(target, row.scope) || !narrower(target, row.current_scope))
  )
    throw Error("source-scope-conflict");
  return row;
}
async function readableSources(
  db: D1Database,
  revision: Revision,
  user: Viewer | null,
  guest: string,
) {
  const snapshots = JSON.parse(revision.snapshots_json) as ComparisonSnapshot[];
  try {
    for (const snapshot of snapshots)
      if (snapshot.sourceRevision)
        await sourceRevision(db, snapshot.sourceRevision, user, guest);
  } catch {
    return false;
  }
  return true;
}
function output(
  header: Header,
  revision: Revision,
  user: Viewer | null,
  guest: string,
) {
  return {
    id: header.id,
    name: revision.name,
    scope: revision.scope,
    latest_revision: header.latest_revision,
    revision: revision.number,
    canEdit: canEditCase(header, user, guest),
    locked: !!revision.locked,
    snapshots: JSON.parse(revision.snapshots_json),
    created_at: revision.created_at,
  };
}
export function registerComparisons(app: App) {
  app.get("/api/comparisons", async (c) => {
    const user = c.get("user"),
      guest = c.get("guestHash"),
      scope = c.req.query("scope") ?? "public";
    const expectedActor = c.req.header("X-PowerMatch-Actor");
    if (expectedActor !== undefined && expectedActor !== (user?.id ?? "guest"))
      return failure("identity-conflict", 409);
    if (!["public", "company", "private", "mine"].includes(scope))
      return failure("invalid-scope");
    if ((scope === "company" || scope === "private") && !user?.employee)
      return failure("employee-required", 403);
    const limit = Number(c.req.query("limit") ?? 30),
      offset = Number(c.req.query("offset") ?? 0);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 10000
    )
      return failure("invalid-pagination");
    const where =
      scope === "mine"
        ? "(c.owner_id=? OR (c.owner_id IS NULL AND c.guest_hash=? AND c.guest_hash<>''))"
        : scope === "private"
          ? "c.scope='private' AND c.owner_id=?"
          : "c.scope=?";
    const args =
      scope === "mine"
        ? [user?.id ?? "", guest]
        : scope === "private"
          ? [user!.id]
          : [scope];
    const rows = await c.env.DB.prepare(
      `SELECT c.*,r.id AS revision_id,r.number,r.scope AS revision_scope,r.name AS revision_name,r.locked,r.snapshots_json,r.actor_key,r.request_id,r.request_hash,r.created_at AS revision_created_at FROM comparisons c JOIN comparison_revisions r ON r.comparison_id=c.id AND r.number=c.latest_revision WHERE c.deleted=0 AND ${where} ORDER BY c.updated_at DESC,c.id DESC LIMIT ? OFFSET ?`,
    )
      .bind(...args, limit + 1, offset)
      .all<
        Header &
          Revision & {
            revision_id: string;
            revision_scope: Scope;
            revision_name: string;
            revision_created_at: string;
          }
      >();
    const visible = [];
    for (const row of rows.results.slice(0, limit)) {
      const revision = {
        ...row,
        id: row.revision_id,
        scope: row.revision_scope,
        name: row.revision_name,
        created_at: row.revision_created_at,
      };
      if (
        canRead(row, user, guest) &&
        canRead({ ...row, scope: revision.scope }, user, guest) &&
        (await readableSources(c.env.DB, revision, user, guest))
      )
        visible.push({
          id: row.id,
          name: row.name,
          scope: row.scope,
          latest_revision: row.latest_revision,
          canEdit: canEditCase(row, user, guest),
        });
    }
    return c.json({
      comparisons: visible,
      nextOffset: rows.results.length > limit ? offset + limit : null,
    });
  });
  app.get("/api/comparisons/:id", async (c) => {
    const user = c.get("user"),
      guest = c.get("guestHash");
    const expectedActor = c.req.header("X-PowerMatch-Actor");
    if (expectedActor !== undefined && expectedActor !== (user?.id ?? "guest"))
      return failure("identity-conflict", 409);
    const header = await c.env.DB.prepare(
      "SELECT * FROM comparisons WHERE id=?",
    )
      .bind(c.req.param("id"))
      .first<Header>();
    if (!header || !canRead(header, user, guest))
      return failure("not-found", 404);
    const number = Number(c.req.query("revision") ?? header.latest_revision);
    if (!Number.isInteger(number) || number < 1)
      return failure("invalid-revision");
    const revision = await c.env.DB.prepare(
      "SELECT * FROM comparison_revisions WHERE comparison_id=? AND number=?",
    )
      .bind(header.id, number)
      .first<Revision>();
    if (
      !revision ||
      !canRead({ ...header, scope: revision.scope }, user, guest) ||
      !(await readableSources(c.env.DB, revision, user, guest))
    )
      return failure("not-found", 404);
    return c.json({ comparison: output(header, revision, user, guest) });
  });
  app.post("/api/comparisons", async (c) => {
    const parsed = comparisonWriteSchema.safeParse(await c.req.json());
    if (!parsed.success) return failure("invalid-comparison");
    const data = parsed.data,
      user = c.get("user"),
      guest = c.get("guestHash");
    if (data.expectedActor !== (user?.id ?? "guest"))
      return failure("identity-conflict", 409);
    if (!user && !guest) return failure("session-required", 401);
    if (data.scope !== "public" && !user?.employee)
      return failure("employee-required", 403);
    const actor = user ? "user:" + user.id : "guest:" + guest;
    const requestHash = await hash(comparisonFingerprint(data));
    const replay = async () => {
      const revision = await c.env.DB.prepare(
        "SELECT * FROM comparison_revisions WHERE actor_key=? AND request_id=?",
      )
        .bind(actor, data.requestId)
        .first<Revision>();
      if (!revision) return null;
      if (revision.request_hash !== requestHash)
        return failure("request-id-conflict", 409);
      const header = await c.env.DB.prepare(
        "SELECT * FROM comparisons WHERE id=?",
      )
        .bind(revision.comparison_id)
        .first<Header>();
      if (
        !header ||
        !canEditCase(header, user, guest) ||
        !canRead(header, user, guest) ||
        !(await readableSources(c.env.DB, revision, user, guest))
      )
        return failure("not-found", 404);
      return c.json({
        comparison: output(header, revision, user, guest),
        replayed: true,
      });
    };
    const previous = await replay();
    if (previous) return previous;
    const rate = await reserveRate(
      c.env.DB,
      "comparison-save:" + actor,
      30,
      3600,
    );
    if (!rate.allowed) return rateLimited(rate.retryAfter);
    const key =
      data.id ??
      "cmp_" + (await hash(actor + ":" + data.requestId)).slice(0, 40);
    const existing = data.id
      ? await c.env.DB.prepare("SELECT * FROM comparisons WHERE id=?")
          .bind(key)
          .first<Header>()
      : null;
    if (
      data.id &&
      (!existing ||
        !canEditCase(existing, user, guest) ||
        !canRead(existing, user, guest))
    )
      return failure("not-found", 404);
    const expected = data.expectedRevision ?? 0;
    if (existing && existing.latest_revision !== expected)
      return failure("revision-conflict", 409);
    const snapshots: ComparisonSnapshot[] = [];
    try {
      for (const item of data.snapshots) {
        if (item.sourceRevision) {
          const source = await sourceRevision(
            c.env.DB,
            item.sourceRevision,
            user,
            guest,
            data.scope,
          );
          const design = designSchema.parse(JSON.parse(source.design_json));
          if (
            comparisonFingerprint(design) !== comparisonFingerprint(item.design)
          )
            return failure("source-design-mismatch");
          snapshots.push({
            design,
            sourceRevision: item.sourceRevision,
            engineVersion: source.engine_version,
            provenance: "revision",
          });
        } else {
          const design = await pinComponentEvidence(c.env.DB, item.design);
          snapshots.push({
            design,
            sourceRevision: null,
            engineVersion: ENGINE_VERSION,
            provenance: Object.keys(design.componentVersions ?? {}).length
              ? "versioned-draft"
              : "legacy-unknown",
          });
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        [
          "source-unavailable",
          "source-scope-conflict",
          "component-version-mismatch",
        ].includes(error.message)
      )
        return failure(
          error.message,
          error.message === "source-unavailable" ? 404 : 400,
        );
      throw error;
    }
    const revisionId =
        "cr_" + (await hash(actor + ":" + data.requestId)).slice(0, 40),
      number = expected + 1;
    const statements = [];
    if (!data.id)
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO comparisons(id,owner_id,guest_hash,name,scope) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
        ).bind(
          key,
          user?.id ?? null,
          user ? null : guest,
          data.name,
          data.scope,
        ),
      );
    const ownerWhere = user
      ? "owner_id=?"
      : "owner_id IS NULL AND guest_hash=?";
    const owner = user?.id ?? guest;
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO comparison_revisions(id,comparison_id,number,scope,name,locked,snapshots_json,actor_key,request_id,request_hash) SELECT ?,id,?,?,?,?,?,?,?,? FROM comparisons WHERE id=? AND latest_revision=? AND deleted=0 AND ${ownerWhere} ON CONFLICT(actor_key,request_id) DO NOTHING`,
      ).bind(
        revisionId,
        number,
        data.scope,
        data.name,
        data.locked ? 1 : 0,
        JSON.stringify(snapshots),
        actor,
        data.requestId,
        requestHash,
        key,
        expected,
        owner,
      ),
    );
    statements.push(
      c.env.DB.prepare(
        `UPDATE comparisons SET name=?,scope=?,latest_revision=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND latest_revision=? AND deleted=0 AND ${ownerWhere} AND EXISTS(SELECT 1 FROM comparison_revisions WHERE id=? AND comparison_id=?)`,
      ).bind(
        data.name,
        data.scope,
        number,
        key,
        expected,
        owner,
        revisionId,
        key,
      ),
    );
    await c.env.DB.batch(statements);
    const saved = await replay();
    return saved ?? failure("revision-conflict", 409);
  });
}
