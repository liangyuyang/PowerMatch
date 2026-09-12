# PowerMatch

Project root: D:/Data/GitHub/PowerMatch. Repository: https://github.com/liangyuyang/PowerMatch.git.

Cloudflare account: bc2ac4bad6f535fcde57fa10a22f131b. Zone zenmeasure.space: bac3193498d4550dffe6bb1b4a02c7ad.
Worker target: powermatch. Production domain: powermatch.zenmeasure.space.
D1 target name: powermatch-db. R2 target name: powermatch-specs. Actual IDs must be checked against wrangler.jsonc and project-context.json before writes.
No Supabase. Resend is the chosen email provider (confirmed 2026-09-12). Secrets server-side only; never copy another project's secret.

Run npm run context:check before database, secret or deploy changes. Preserve existing Cloudflare secrets on deploy.
Tests must cover energy accounting, unit conversions, invalid inputs, access scopes and token consumption.
No invented device/PV/LIC parameters. Missing values must be visible; estimates are explicitly conditional.
Keep docs/assets original brand and source materials intact. docs/ui-concepts/v2-workbench.png and v2-comparison.png are the selected UI references.
Editable dates YYYY-MM-DD. All overlays close using visible control, Escape and click-away, restore focus and preserve draft input.
After completed coding: verify, commit, push, deploy Worker/assets, smoke-test, update HANDOFF.md and the PowerMatch Obsidian handoff. Do not deploy on a failed guard.
