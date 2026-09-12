# PowerMatch AI assistant

Implemented 2026-09-12, Home PC. Reference patterns: local DIG `worker/routes-ai.ts`, `worker/models.ts`, and Sales Radar (leads.zenmeasure.com) `app.js` provider selection/status labels. Other projects' credentials were not read or copied.

## Configure

Patrick signs in → Admin → AI models & usage. Choose a provider card, enter a model ID from its console, and save. Enter the provider key in the password field and save; then select the model, run its live health check, enable it, optionally mark default, and save. Multiple models per provider are supported. All authenticated users can select enabled healthy models in the assistant. Anonymous users retain local calculation.

Providers: DeepSeek, Gemini, MiniMax China, MiMo China, Grok, Qwen Beijing. Endpoints are fixed server-side, not arbitrary user URLs. Provider region and billing plan must match the key. A key from a coding subscription is not presumed usable for a public application; check the provider's plan terms before enabling. No subscription keys were reused automatically. Model IDs and prices are administrator input, not unverified seeded recommendations. Unpriced usage displays unknown, not zero.

Official protocol references checked 2026-09-12:

- https://api-docs.deepseek.com/guides/json_mode/
- https://ai.google.dev/gemini-api/docs/openai
- https://platform.minimaxi.com/docs/api-reference/text-chat-openai
- https://platform.xiaomimimo.com/docs/en-US/usage-guide/passing-back-reasoning_content
- https://docs.x.ai/developers/rest-api-reference/inference/chat-completions
- https://help.aliyun.com/en/model-studio/base-url

## Boundaries

- Provider keys are write-only from the admin UI, stored as AES-GCM ciphertext in D1 with provider identity authenticated as additional data. The wrapping key is the Worker secret `POWERMATCH_AI_ENCRYPTION_KEY`. Preserve this secret on redeploy; replacing it without re-encrypting records makes stored keys unreadable. `scripts/configure-ai-encryption.mjs` creates it only if absent and never displays key bytes. No key in Git, localStorage, audit, API responses or frontend bundles.
- Existing dedicated `POWERMATCH_AI_<PROVIDER>_KEY` secrets are supported as fallback only when no encrypted key exists. Replacing a key disables that provider's models until checked and enabled again.
- Sole admin is the existing server-authenticated Patrick identity. All model/config/key/health routes enforce admin authorization and existing Origin checks. Public models are sanitized. Every assistant call resolves an enabled healthy model server-side; per-user reservations are atomic in D1.
- Daily invocation limits reset at Beijing midnight: company 80, external 10, total 500; 4/minute per user. Checks and failed calls count. Caller identity comes from the authenticated session, never request input. Token/cost metadata retained, conversation/design bodies not persisted by the AI endpoints.
- Conversation history/current design are sent to the selected provider after the UI disclosure. The assistant cannot browse or retrieve specs automatically in this release.
- AI returns a constrained action list, not an arbitrary design object. Server maps known component IDs to catalog data, rejects unknown IDs, electrical-spec fabrication, invalid schedules and locked-group changes, then runs the deterministic engine. Missing specs remain missing. Provider/catalog text cannot authorize publication, messages, database changes or new tool execution.
- Suggestions require Apply or Copy to comparison; stale suggestions cannot overwrite newer drafts. Undo is available only while the current design still matches the applied suggestion. Load is locked by default; more groups can be locked. This release does not infer every prior manual edit as a lock.
- Component nodes on the workbench now open a chooser. Selecting a model imports known values and preserves supply mode; retained assumptions and incomplete fields remain explicit.

## Verification

24 unit tests passed (engineering/security plus catalog actions, locks, invalid/fabricated fields, encryption tamper/provider isolation, mock provider response handling). 48 local API assertions passed for existing scopes/auth and AI admin access, disabled-model rejection, optimistic configuration, missing-key health logging and sanitized listing. Desktop/mobile browser checks cover close button, Escape, backdrop, focus restoration, draft retention, component selection, admin layout and mocked suggestion apply/undo/compare. Provider mocks are explicitly not live AI acceptance.

Real provider health and engineering conversation acceptance remain pending administrator key/model configuration. Existing incomplete PV profiles still block a fully verified zero-input PV recommendation. Current AI cannot edit measured load profiles, scan datasheets, optimize every circuit or produce a pin-level schematic; those remain follow-up work.
