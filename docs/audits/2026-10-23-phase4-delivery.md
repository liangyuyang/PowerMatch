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

Pending final committed build, push, migration, deploy and independent smoke. Append actual identifiers/checks after completion; do not treat this local report as proof of production delivery.
