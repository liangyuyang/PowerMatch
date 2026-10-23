# Phase 4 — budgets, comparison collections, field evidence/OCR and BOM

Project PowerMatch, `D:/Data/GitHub/PowerMatch`, Home PC / HomePC, branch main. User authorized continued implementation of the existing roadmap. No additional API keys, external service, schedule or license choice was required.

## Implemented and locally verified

- Four optional AI budget scopes (global/user × Beijing day/month) with token/CNY reservation, settings/model revision fences and conservative interrupted/partial-use accounting. Existing limits remain in place; new limits default disabled.
- Immutable cloud comparison revisions, condition-lock persistence, private employee defaults, explicit publication acknowledgement, source access checks and actor/CAS/idempotency protection. Refresh, stable links and account changes preserve authorized drafts.
- Frozen outbox payload/key, send leases, safe-window retries and late-claim fencing. Legacy/expired/uncertain outcomes require manual review. No blind provider retry, new Cron or delivery guarantee.
- Per-field Spec value/unit/page/excerpt/conditions and submitter-declared method. Original uploads, review revisions and adopted component snapshots remain immutable. Uploaded file hash binds file identity only. PDF candidates normalize established units and reject ambiguous/partial/signed numbers rather than guessing.
- Local image/scanned-PDF single-page OCR using seven language packs. Same-origin, on-demand assets; bounded inputs/pages/pixels/output; cancellation, file changes and modal close terminate resources. JavaScript eval remains blocked by CSP; only WebAssembly compilation is allowed.
- Selection BOM CSV uses active components and matching pinned evidence, separates simulation inputs from source facts, marks unknown quantities and neutralizes spreadsheet formulas. It is not a complete circuit BOM or schematic.
- Long modal headers/close controls remain visible while scrolling. Updated vulnerable test dependency; dependency audit currently reports zero findings.

Operational details: [budgets/comparisons/mail/BOM](../phase4-operations.md), [OCR and evidence](../ocr-and-evidence.md).

## Verification evidence

- Full unit suite: 256 tests /17 files; TypeScript and production build passed.
- Native isolated D1 API:49 assertions, synthetic identities/data, zero external emails.
- Budget admin mock browser: four scopes, save payload, refresh/conflict draft retention, FX editing and390px layout.
- Comparison browser: six groups including actual local save/readback/refresh, explicit share/replacement, close/Escape/backdrop/focus/drafts, mobile, delayed response after cookie sign-out.
- Spec browser: six groups including actual local upload/adoption/version/report, value mismatch fencing, source-file switching, original preservation and mobile. Text-PDF candidate endpoint is mocked in this UI suite; separate API tests cover actual extraction control flow/page bounds.
- OCR browser: actual synthetic PNG and scanned-PDF rendering/recognition; held WASM startup cancellation and worker termination. Integrated desktop/mobile/file switching/modal close also passed against built Worker assets and actual CSP, independently repeated by reviewer. These are synthetic document checks, not manufacturer/hardware acceptance.
- Built anonymous UI: branded PDF, BOM download, responsive layout, charts/AI lazy chunks and no page/CSP errors.
- Independent review used `gpt-6-astra / high`; implementation/complex QA used declared `gpt-6.1-sol / high` agents. Main session model was not changed. Root owns integration, production changes and handoff.

## Material boundaries and follow-up

- AI reservation is an application estimate, not exact tokenizer/provider spending. Unknown historical amounts can block enabled corresponding budgets. Real paid AI acceptance and email delivery are not inferred from mocks.
- PDF output/page/pixel caps do not provide complete hostile-PDF decompression isolation. Real manufacturer scans, complex tables and alternate browser/font acceptance remain to be collected.
- OCR/field provenance is reviewed claim tracking, not document authentication or electrical validation. Unknown measurements, curves, MPPT/cold-start/temperature effects and MHO-C404 load traces remain explicit gaps.
- Main bundle remains about136KB gzip; PDF/OCR dependencies are lazy. No field INP or universal performance improvement is claimed; prior measured mobile long tasks still need targeted work.
- Full technical localization, calibrated recommendation search, notification preferences/moderation, pin-level KiCad/ERC and app license selection remain separate roadmap items. This release does not claim them complete.

## Production delivery

First production checkpoint: application7404a48 /V0.1.36 deployed as Worker6c46ccc2-d5a8-4c59-b3ea-daf0dc05a215; cold-loading explanation774d33c /V0.1.37 deployed as201b537c-a27a-4cb6-8947-b588407b9e26. All4 migrations0013–0016 applied after context guard, existing OAuth and a privately retained Time Travel bookmark. Independent post-query:41 components,41 component versions,0 Specs/reviews,2 original case revisions,0 comparison fixtures,16 migrations. Keys were preserved.

Anonymous production API/header/calculation checks, PDF/BOM download, mobile layout and no page/CSP errors passed. Initial cold OCR UI expectation at30s was too short; a180s UI run also did not return candidates, so the cause is not assumed to be only network speed. Independent single-recognition diagnosis after session readiness succeeded in33.3s: Worker/core and both language packages200, English body18.6s/Chinese23.7s, confidence92 on synthetic225mAh/3V, no CSP/fatal error. Tesseract emits compatibility warnings that did not block this recognition. Zero application uploads, paid AI calls or emails were made. A separate local reproduction verifies early component deep links can race identity initialization; a guard and5 browser regression groups are prepared. A streamed download progress improvement and final checkpoint follow below after deployment.


Final production checkpoint: **V0.1.38 · 2026.10.23**, source **d565cbc**, Worker **06497040-76a9-4deb-8b06-fe776a8d0284**. Source was committed/pushed, then rebuilt and deployed after a passing guard. GitHub checks passed: https://github.com/liangyuyang/PowerMatch/actions/runs/39974894715 . Full suite after stream changes: **272 tests /17 files**, type/build passed. Independent reviewer additionally repeated21 OCR tests,5 session timing groups and actual PNG/scanned-PDF/cancel checks; built8787 desktop/mobile/CSP acceptance passed.

Final production single synthetic PNG recognition succeeded:225mAh,3V, character confidence92%; file remained bound, no pending asset requests or fatal page/worker errors. It took about40s from navigation through completed recognition; observed download status progressed from38% (eng1.55/2.95MB, chi_sim0.41/1.72MB) to86% and then engine initialization. This is one network sample, not a speed improvement claim. Production PDF/BOM/mobile/CSP and API smoke passed again with the final version. Authenticated business acceptance/real manufacturer documents/paid providers/email delivery are not inferred.

Streamed same-origin language downloads now report bytes, cancel siblings/readers on error, cap Fetch-exposed bytes at8MiB per language and pass data to the OCR worker. Transparent HTTP decoding is handled explicitly; no general HTML model acceptance. The installed pinned Tesseract7.0.0 has an initialize Lang[] .data/.code defect; a narrowly scoped native-worker initialize-message adapter uses validated code names while loadLanguage retains the original bytes. No vendor source was changed. Local Vite serves the exact pinned seven binary asset paths consistently with production. Format screening is not model authentication or a hard bound on all decoded model/engine memory.

Rollback must preserve immutable Spec writes, budget admission/reconciliation and mail leases/frozen payloads. Do not restore the previous blind failed-mail reset/processor or an AI writer that bypasses the new budgets. No new schedule, public/community quota policy or PowerMatch license was chosen.
