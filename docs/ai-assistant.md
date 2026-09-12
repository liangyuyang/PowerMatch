# PowerMatch AI assistant

Implemented 2026-09-12, Home PC. Reference patterns: local DIG `worker/routes-ai.ts`, `worker/models.ts`, and Sales Radar (leads.zenmeasure.com) `app.js` provider selection/status labels. Other projects' credentials were not read or copied.

## Configure

Patrick signs in → Admin → AI 模型设置与计费. The page follows local DIG `src/components/ModelSettingsPanel.tsx` and its styles, excluding ASR. Overview/default model, today/week/90-day usage and model cost bars appear first. Expand API settings, details tables, or operational checks as needed.

Choose a provider and Add model. Interface addresses and some example model IDs autofill. Review the model ID against the provider console, enter the model's Key (blank preserves an existing key), and Save and check. A successful enabled model is selectable by frontend users; select its default radio/button to make it the app default. Existing shared provider keys remain supported and their presence is displayed; no other app's keys are copied. Settings use atomic revision checks; stale edits stay in the browser until explicitly discarded/reloaded.

Each row has display name, Provider, Model name, Base URL, write-only API Key, enabled/default flags, health/time/latency, currency, input/output price per million tokens, request price, billing mode, source URL and note. Support: six requested providers plus allowlisted OpenAI-compatible endpoints (including OpenRouter/OpenAI); Qwen regional URLs and Gemini native/compatible endpoints. Arbitrary hosts are rejected. Model examples are not claims of account availability. Region and plan must match the key.

Pricing supports tokens, requests, both, and plan/unknown. USD→CNY is an explicit admin rate, snapshotted per invocation; unknown prices/usage/FX remain unknown, not free. CSV includes attribution and escapes spreadsheet formulas. Today and Monday-based week use Beijing time; 90 days includes today. Aggregates query all records in-period, independent of the recent-100 task list. Ops self-check reads Worker/D1/R2/encryption/email status plus real AI/mail tasks; it does not call providers or send mail. No DIG ASR or Feishu processing is copied.

Official protocol references checked 2026-09-12:

- https://api-docs.deepseek.com/guides/json_mode/
- https://ai.google.dev/gemini-api/docs/openai
- https://platform.minimaxi.com/docs/api-reference/text-chat-openai
- https://platform.xiaomimimo.com/docs/en-US/usage-guide/passing-back-reasoning_content
- https://docs.x.ai/developers/rest-api-reference/inference/chat-completions
- https://help.aliyun.com/en/model-studio/base-url

## Boundaries

- Provider keys are write-only from the admin UI, stored as AES-GCM ciphertext in D1 with model/provider/endpoint identity authenticated as additional data. The wrapping key is the Worker secret `POWERMATCH_AI_ENCRYPTION_KEY`. Preserve this secret on redeploy; replacing it without re-encrypting records makes stored keys unreadable. `scripts/configure-ai-encryption.mjs` creates it only if absent and never displays key bytes. No key in Git, localStorage, audit, API responses or frontend bundles.
- Existing dedicated `POWERMATCH_AI_<PROVIDER>_KEY` secrets are supported as fallback only when no encrypted key exists. Per-model keys take precedence; changing their destination requires re-entering the key. A changed runtime/key resets health until checked again.
- Sole admin is the existing server-authenticated Patrick identity. All model/config/key/health routes enforce admin authorization and existing Origin checks. Public models are sanitized. Every assistant call resolves an enabled healthy model server-side; per-user reservations are atomic in D1.
- Daily invocation limits reset at Beijing midnight: company 80, external 10, total 500; 4/minute per user for design calls, up to 40/minute for admin health checks. Checks and failed calls count. Caller identity comes from the authenticated session, never request input. Token/cost metadata retained, conversation/design bodies not persisted by the AI endpoints.
- Conversation history/current design are sent to the selected provider after the UI disclosure. The assistant cannot browse or retrieve specs automatically in this release.
- AI returns a constrained action list, not an arbitrary design object. Server maps known component IDs to catalog data, rejects unknown IDs, electrical-spec fabrication, invalid schedules and locked-group changes, then runs the deterministic engine. Missing specs remain missing. Provider/catalog text cannot authorize publication, messages, database changes or new tool execution.
- Suggestions require Apply or Copy to comparison; stale suggestions cannot overwrite newer drafts. Undo is available only while the current design still matches the applied suggestion. Load is locked by default; more groups can be locked. This release does not infer every prior manual edit as a lock.
- Component nodes on the workbench now open a chooser. Selecting a model imports known values and preserves supply mode; retained assumptions and incomplete fields remain explicit.

## Verification

28 unit tests passed (engineering/security plus catalog actions, locks, invalid/fabricated fields, encryption tamper/provider isolation, mock provider response handling). 48 local API assertions passed for existing scopes/auth and AI admin access, disabled-model rejection, optimistic configuration, missing-key health logging and sanitized listing. Desktop/mobile browser checks cover close button, Escape, backdrop, focus restoration, draft retention, component selection, admin layout and mocked suggestion apply/undo/compare. Provider mocks are explicitly not live AI acceptance.

Real provider health and engineering conversation acceptance remain pending administrator key/model configuration. Existing incomplete PV profiles still block a fully verified zero-input PV recommendation. Current AI cannot edit measured load profiles, scan datasheets, optimize every circuit or produce a pin-level schematic; those remain follow-up work.

## DIG-style admin verification, 2026-09-12

33 additional local API checks cover batch saving, stale-revision rollback, per-model encrypted key retention, destination isolation, unauthorized routes, 120-row full usage aggregates and diagnostics. Edge checks cover desktop/mobile expanded fields, provider autofill, no ASR, draft survival across refresh/navigation/reload cancellation, plus existing assistant close/Escape/backdrop/focus and mocked apply/undo/compare. Live provider calls are not part of these tests. Production preflight found 0 model rows, 1 existing encrypted provider key and 0 invocations; the key is preserved without reading its value.

## Error diagnostics and price import — 2026-09-12

Health failures now persist stage, stable code, available HTTP status/vendor code/request ID, sanitized error message, model/endpoint and invocation ID. The UI displays actionable diagnostics and copyable JSON, including in recent tasks. No raw response body, authorization header, or API Key is retained. Old generic failures cannot be reconstructed; run a new check. Differentiate key/request/response/response-json/response-format/validate/storage stages. Changing runtime settings clears obsolete diagnostics.

Connection check and price import are separate actions. “从链接读取价格” supports the official DeepSeek Chinese/English pricing pages, exact model matching, merged HTML table cells, currency, cache hit/miss and peak/off-peak tiers. A selected tier fills only the draft; save remains explicit. The existing flat-rate estimator does not automatically switch peak/cache pricing. Unsupported sources, missing models, ambiguous currency/tiers and failed fetches leave existing prices unchanged with visible error codes. The fetch sends no model credentials, allows only exact official pricing paths, checks redirects, and bounds time/body size. Other providers' price extraction remains unsupported and explicitly reported.

Verification: 33 unit tests, 48 local API assertions, 33 batch-settings checks; local Edge verified persisted diagnostic details, real official price read/tier selection, unsupported-source preservation and desktop/mobile layout. The original real provider failure still needs a fresh production check; historical logs contain only ai-request-failed.


Root cause confirmed by user-triggered production diagnostics (DeepSeek/Grok/MiMo): Cloudflare Workers rejects RequestInit.redirect="error" before sending the provider request. Changed the common adapter to redirect="manual" and explicitly reject every 3xx without forwarding credentials. Pricing already used manual with allowlisted redirect validation. Added a regression test for Workers-compatible mode and no redirect follow. 34 unit tests and build passed. Existing keys do not need replacement for this shared error. Real post-fix health verification remains pending release/recheck.


Post-redirect-fix production health: DeepSeek, Grok and Qwen passed user-triggered real health checks. MiMo returned HTTP 401; MiniMax returned HTTP 200 but structured JSON parsing failed. Added MiniMax reasoning_split (with bounded leading think-block normalization), native MiMo api-key header/max_completion_tokens, and explicit Token Plan credential/endpoint mismatch feedback before a request. Official MiMo Token Plan regional endpoints are allowed but never automatically substituted; changing endpoint still requires explicit Key re-entry. No existing model/Key was changed automatically. 36 unit tests pass.

Official references checked: https://platform.minimax.cn/docs/api-reference/text-chat-openai ; https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/quick-access ; https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call . MiniMax and MiMo latest real health checks still require user-triggered verification after this adapter update.

## Default and Token Plan estimation — 2026-09-12

When no default exists, migration 0007 selects the earliest checked enabled healthy model; later, the first newly successful health check also becomes default. Manual default selection remains available. Availability and failure labels use high-contrast bold green/red states.

Plan models store a structured fee and month/year period. Per-call allocation is estimated from current billing-cycle usage pace: projected cycle calls = calls so far / elapsed fraction of the cycle; estimated unit allocation = plan fee / projected calls. The UI shows fee, cycle, calls so far, projected calls and estimated RMB per call. This is a management allocation estimate, not a provider charge. With no calls, or with USD pricing and no FX rate, the estimate remains pending. Token-priced invocation accounting remains unchanged.
