# PowerMatch implementation handoff

Date: 2026-09-12 (Beijing). Machine: Home PC / HOMEPC.
Project: D:/Data/GitHub/PowerMatch. Branch: main. Remote: https://github.com/liangyuyang/PowerMatch.git.

## Current state

User authorized programming and creation of necessary Cloudflare resources. Resend sender confirmed as support@zenmeasure.com. Dedicated RESEND_API_KEY is now configured by the user in this Worker; its value was never read or printed.

Implemented initial workbench, comparison snapshots/common conditions, Tiny load model, conditional time simulation, source-linked 35-entry component catalog, D1 scope/revision authorization, single-use Magic Link endpoints, R2 spec uploads, text-PDF candidates, employee spec adoption, contextual forum, message queue, Patrick-only admin, seven-language primary UI and branded print report.

## Checks

- Context guard passed; isolated account bc2ac4bad6f535fcde57fa10a22f131b, Worker powermatch.
- D1 powermatch-db: c616a8ac-15d8-4bfa-ba6d-64e8b6e3e957. R2 powermatch-specs.
- Three remote migrations applied. Independent production query confirmed 1 case and 35 component entries; no synthetic test data was deployed.
- 15 unit tests passed; 34 local API assertions passed, including one-use login tokens, private revisions, role/guest ownership and stale writes. Local automated tests sent no email. A separate production Magic Link was accepted by Resend and the user confirmed successful sign-in and access to the admin screen.
- TypeScript + Vite production build passed. Main chunk about 775 KB (230 KB gzip); splitting remains a performance improvement.
- Browser observed desktop workbench, battery results and comparison. Escape/visible-close preserved edited draft. Subsequent browser connection timed out; complete responsive, click-away, focus-return and print acceptance remain unverified.

## Release status

Initial implementation 0.1.0 is deployed and available for review, not completion of every planned feature. Application code commit: d22d9ed on main; pushed to origin/main. Production Worker version: 41c5a3e9-aaa4-4f6e-9cb6-2cbcc60b5897. Later handoff-only commits do not change application artifacts.

## Open work / risks

1. Resend sender support@zenmeasure.com and production login/admin access have passed actual user verification. Other authenticated production flows still need user acceptance.
2. Full technical localization, image/scanned-spec OCR, persistent comparison collections, pin-level schematic/KiCad export and detailed display models are unfinished. Current graph is explicitly a block diagram.
3. Battery curves, temperature, cold-start/hysteresis and adaptive BLE models are not yet implemented; runtime remains conditional. Unknown MHO-C404 load profile is blocked.
4. Admin can retry failed mail and clear expired records. Account free Cron quota was exhausted; this app uses immediate message delivery with manual maintenance, without taking another app’s trigger. Opt-out and comprehensive abuse/moderation controls remain open.
5. Original selected UI references remain docs/ui-concepts/v2-*.png. Source-vs-render joint visual QA remains open after browser timeout; do not report full design acceptance.
6. D1 seed official means supplied by ZenMeasure, not universally engineering-validated; model-specific source/test conditions still require review.

## Next step

Patrick configures at least one real AI model/key in Admin, runs health check and enables it; then verify a real engineering conversation and applied/compared calculation. Continue PV catalog completeness and remaining engineering/product backlog. Do not present planned features as implemented.

## AI assistant release — 2026-09-12, Home PC

User authorized implementation and requested DeepSeek, Gemini, MiniMax, MiMo, Grok and Qwen, with Patrick-only configuration and frontend model selection patterned after Leads. Added encrypted write-only key configuration, model enable/default/health controls, authenticated usage attribution and quotas, constrained catalog-backed AI design proposals with deterministic calculation, apply/undo/compare, stale-draft rejection, parameter-group locks, and clickable component nodes.

Checks: 24 unit tests; 48 local API assertions; desktop/mobile browser interaction tests (close/Escape/backdrop/focus/draft, component chooser, admin layout, mock suggestion apply/undo/compare). No live AI credentials have been provided yet; provider health and real engineering conversation acceptance remain pending. No other app's keys were accessed/copied. Detailed setup, boundaries and official adapter sources: docs/ai-assistant.md.

AI application commit 3e7f41c was pushed to origin/main and deployed. Worker version 0b874b94-1e83-44ea-ae2e-a26e3291486c. Migration 0004 applied; encryption wrapping secret configured and RESEND_API_KEY preserved. Independent production counts: 1 active case, 35 components, 0 AI models and 0 provider keys. Existing PV catalog gaps remain; this change does not claim complete automatic PV sizing, datasheet browsing/OCR or pin-level schematics. Current UI technical details use Chinese/English fallback. Conversation is in-memory and proposals require explicit Apply/Copy; editing measured load via AI and automatic inference of every manual lock remain follow-up work.

## Verified production checkpoint

- URL: https://powermatch.zenmeasure.space
- Final successful deployment: 0b874b94-1e83-44ea-ae2e-a26e3291486c (application code 3e7f41c), verified 2026-09-12 18:55 Beijing.
- Homepage, health, public cases and component API returned HTTP 200.
- RESEND_API_KEY secret name confirmed; health reports emailConfigured=true. The user confirmed receiving/using the sign-in link and entering Admin.
- New AI/component UI was tested using local headless Edge at desktop/mobile sizes. The original full source-vs-render/print QA remains open. Production /api/ai/models returned 200 with no enabled models; anonymous /api/admin/ai correctly returned 403. No production login tokens or synthetic cases were created for this release.

## Cross-device handoff

This page is copied to the Obsidian PowerMatch project page. The Obsidian main checkout contains unrelated changes and diverged history, so only this handoff is synchronized using an isolated origin/main worktree. No unrelated files, commits or Z0 rules are changed. No new cross-project permanent rule was introduced in this task.

## DIG-style AI settings release — 2026-09-12, Home PC / HOMEPC

Replaced the old model editor with DIG-style AI 模型设置与计费, excluding ASR. Read-only reference: D:/Data/GitHub/Codex/dig/src/components/ModelSettingsPanel.tsx and App.css. Includes default/status overview, today/week/90-day full usage aggregates, model cost bars, CSV, per-model API/Key/pricing/health fields, atomic batch save, and PowerMatch AI/mail diagnostics. Existing shared keys remain supported; per-model encrypted keys bind to provider and endpoint. No DIG credentials/configuration were copied or changed.

Verification before release: context guard, build, 28 unit tests, 48 existing local API assertions, 33 new local API checks, existing assistant browser checks and new expanded desktop/mobile admin checks passed. Drafts survive stats refresh, navigation and reload cancellation. No live provider call was made. Production preflight: 0 models, 1 provider key, 0 invocations; preserve the key and encryption master. Migration 0005 adds billing/settings and model-key tables without deleting legacy data.

Application commit 0a1a713 pushed to origin/main, then deployed to production Worker e94b3c1f-e410-4d56-a1df-c8ad29c7461f. Migration 0005 applied. Production smoke at 20:19 Beijing passed for site, calculation, public AI list, and admin/usage/diagnostics access denial to anonymous callers. Independent post-migration counts: 0 models, 1 legacy provider key, 0 model keys, 1 settings row, 0 invocations. Existing key and Resend configuration preserved. Main frontend bundle is about 817 KB / 244 KB gzip; splitting remains open. New detailed admin is Chinese as requested; broader localization backlog remains. Next: Patrick adds model rows, checks actual account connectivity and selects default; then verify a real AI design conversation.

## AI failure diagnostics and price import — 2026-09-12, Home PC / HOMEPC

User reported all configured providers failing with ai-request-failed and price links not filling prices. Added persistent sanitized stage/HTTP/vendor error/request diagnostics and copyable admin details; migration 0006 adds diagnostic fields. Added separate official DeepSeek price import with exact-model/currency/cache/peak parsing, explicit tier selection into draft and failure feedback. Other price sources remain explicitly unsupported. Existing keys preserved. Historical generic failures cannot be reconstructed; fresh production check is necessary to identify the shared failure.

Checks: 33 unit tests, 48 local API assertions, 33 settings checks, Edge desktop/mobile diagnostic and real official-price import tests passed. No real AI provider calls were made by the tests. Deployment checkpoint follows after release. Next: run a new production health check, inspect detailed error, and fix the underlying cause if still failing.


Root cause confirmed by user-triggered production diagnostics (DeepSeek/Grok/MiMo): Cloudflare Workers rejects RequestInit.redirect="error" before sending the provider request. Changed the common adapter to redirect="manual" and explicitly reject every 3xx without forwarding credentials. Pricing already used manual with allowlisted redirect validation. Added a regression test for Workers-compatible mode and no redirect follow. 34 unit tests and build passed. Existing keys do not need replacement for this shared error. Real post-fix health verification remains pending release/recheck.


Post-redirect-fix production health: DeepSeek, Grok and Qwen passed user-triggered real health checks. MiMo returned HTTP 401; MiniMax returned HTTP 200 but structured JSON parsing failed. Added MiniMax reasoning_split (with bounded leading think-block normalization), native MiMo api-key header/max_completion_tokens, and explicit Token Plan credential/endpoint mismatch feedback before a request. Official MiMo Token Plan regional endpoints are allowed but never automatically substituted; changing endpoint still requires explicit Key re-entry. No existing model/Key was changed automatically. 36 unit tests pass.

Official references checked: https://platform.minimax.cn/docs/api-reference/text-chat-openai ; https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/quick-access ; https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call . MiniMax and MiMo latest real health checks still require user-triggered verification after this adapter update.


Latest deployed application: 81876cc (origin/main); Worker 3f41a08d-310c-4736-8f3c-c9ddf9966800. Diagnostic migration 0006 is applied. Current user-confirmed production evidence: three APIs working (DeepSeek/Grok/Qwen). Latest MiniMax format fix is deployed and awaiting recheck; user will check MiMo Key independently. Production retains 5 model rows, 1 legacy provider Key and 5 per-model Keys (read-only counts at 20:49 Beijing). No credentials were viewed, copied or changed by this task.

## Default model and Token Plan estimation — 2026-09-12, Home PC / HOMEPC

Added automatic default fallback: migration 0007 selects the earliest checked enabled healthy model when no default exists, and future first successful checks do the same. Admin can still switch the default. Availability states now use bold high-contrast green/red text.

Added structured plan fee and month/year period. The admin estimates per-call allocation using current billing-cycle calls and elapsed-cycle pace, and explicitly displays observed/projected calls. This is an allocation estimate, not provider per-request billing; no calls or missing USD FX remains pending. Validation: 37 unit tests, 48 local API assertions, production build, and local Edge desktop/mobile checks including plan fields and status typography. Production migration/deployment and smoke checkpoint follow.

Production preflight found the user's existing plan entries were plain notes: MiMo `39元/月` and MiniMax `290元/年`. Migration 0008 strictly backfills only exact numeric `元/月` or `元/年` notes into structured fee/period fields, preserving the original notes. Other free-form text is not guessed or changed.

Application commits d207fa6 and e9873f2 are pushed to origin/main. Migrations 0007 and 0008 are applied to production; latest Worker version is 03814732-50b6-480f-b72a-1c330e0b5e19. Independent production queries confirmed five enabled healthy models and exactly one default model: MiniMax. Structured plan data now records MiMo at CNY 39/month and MiniMax at CNY 290/year. At the current sparse, health-check-heavy usage pace, the UI estimates about CNY 2.17/call for MiMo and CNY 41.43/call for MiniMax; these allocation figures will change as real conversation volume accumulates.

Production smoke passed at 2026-09-12 21:23 Beijing: homepage, health, public case/component/model APIs, calculation and branded assets returned 200; anonymous admin, AI usage and diagnostic routes returned 403. Main frontend bundle remains about 823 KB / 246 KB gzip. Next: refresh the authenticated Admin page and use normal AI conversations so the plan allocation estimate becomes representative; no key replacement is required.

## Zero-input presets and corrected subscription accounting — 2026-09-12, HOMEPC

User requested animated gradient AI entry, expanded understandable parameter locks, ready-to-calculate supply/storage presets, Tiny image proportions, four friendly angle choices and disabling angle correction for plane-measured illuminance. Implemented these, with source-backed PowerFilm LL200-2.4-75 and clearly marked OPV/perovskite/LIC/rechargeable/harvesting simulation templates. Selecting incomplete catalog components fills assumptions into the design notes without changing the underlying catalog facts. MHO-C404 measured load remains unavailable; it is not invented. New Tiny asset was reprocessed against the supplied original; all product image placements retain contain behavior.

Correction: previous CNY 41.43 / 2.17 projected call costs were misleading extrapolations from sparse health checks and must NOT be used as API prices. Removed that estimator from backend and UI. Fixed subscription fee and monthly equivalent now display with an explicitly hypothetical 1,000 business calls/month allocation example (MiMo 0.039 CNY/call, MiniMax about 0.0242), without claiming incremental provider billing or quota availability.

Local checks: 45 unit tests, 48 API assertions, desktop/mobile workbench and admin browser checks; AI drawer close/Escape/backdrop/focus/draft and mock apply/undo/compare passed. No real provider calls or emails were sent by these tests. Migration 0009 adds six new source/template catalog records and preserves existing records. Production release checkpoint follows.
