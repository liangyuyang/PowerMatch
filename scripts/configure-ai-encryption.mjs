// Provisions only PowerMatch's wrapping key; never prints or persists key bytes locally.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
execFileSync(process.execPath, ["scripts/context-check.mjs"], {
  stdio: "inherit",
});
const env = { ...process.env, WRANGLER_LOG_PATH: "tmp/ai-secret-setup.log" };
delete env.CLOUDFLARE_API_TOKEN;
const wrangler = "node_modules/wrangler/bin/wrangler.js";
const raw = execFileSync(
  process.execPath,
  [wrangler, "secret", "list", "--name", "powermatch"],
  { env, encoding: "utf8" },
);
const list = JSON.parse(raw);
if (list.some((s) => s.name === "POWERMATCH_AI_ENCRYPTION_KEY")) {
  console.log("PowerMatch encryption secret already exists; preserved.");
} else {
  execFileSync(
    process.execPath,
    [
      wrangler,
      "secret",
      "put",
      "POWERMATCH_AI_ENCRYPTION_KEY",
      "--name",
      "powermatch",
    ],
    {
      env,
      input: randomBytes(32).toString("base64") + "\n",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  console.log(
    "PowerMatch encryption secret configured; key value was not displayed.",
  );
}
