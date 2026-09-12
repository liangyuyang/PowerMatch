import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const context = JSON.parse(
  readFileSync(new URL("../project-context.json", import.meta.url), "utf8"),
);
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const remote = execFileSync("git", ["remote", "get-url", "origin"], {
  encoding: "utf8",
}).trim();
if (resolve(root) !== resolve(process.cwd()))
  throw Error("Run guard from repository root");
if (remote !== context.repository) throw Error("Wrong PowerMatch Git remote");
if (
  process.env.CLOUDFLARE_ACCOUNT_ID &&
  process.env.CLOUDFLARE_ACCOUNT_ID !== context.accountId
)
  throw Error("Wrong Cloudflare account");
if (!process.argv.includes("--provision")) {
  const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
  if (
    config.name !== context.worker ||
    config.account_id !== context.accountId ||
    config.vars.APP_ORIGIN !== `https://${context.domain}`
  )
    throw Error("Wrong Worker/origin/account");
  if (
    !context.databaseId ||
    config.d1_databases[0].database_id !== context.databaseId ||
    config.d1_databases[0].database_name !== context.databaseName
  )
    throw Error("Unverified D1 target");
  if (config.r2_buckets[0].bucket_name !== context.r2Bucket)
    throw Error("Wrong R2 target");
}
console.log(
  JSON.stringify(
    {
      project: "PowerMatch",
      root,
      remote,
      worker: context.worker,
      account: context.accountId,
      domain: context.domain,
      database: context.databaseName,
      databaseId: context.databaseId,
      bucket: context.r2Bucket,
      check: "passed",
    },
    null,
    2,
  ),
);
