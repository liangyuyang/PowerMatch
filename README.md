# PowerMatch · ZenMeasure

## Implementation status · 0.1.0

React/TypeScript frontend + Cloudflare Worker, D1 and R2. Resend is the selected transactional email provider. The initial implementation includes a workbench, side-by-side comparison, conditional runtime model, source-linked component catalog, public Tiny example, scoped case revisions, Magic Link endpoints, spec review, discussion and admin screens.

```sh
npm ci
npm run context:check
npm run db:local
node scripts/seed.mjs
npx wrangler d1 execute powermatch-db --local --file=tmp/seed.sql
# Copy .dev.vars.example to .dev.vars. Run in separate terminals:
npm run dev:api
npm run dev
```

Frontend: http://127.0.0.1:5173. API: port 8787. Run `npm test`, `npm run build`, then `node scripts/test-api.mjs` with the local Worker running. Integration tests create synthetic identities only in local D1 and send no email.

Canonical production targets are in `project-context.json`. Guard, test, commit and push before `npm run deploy`. Apply remote D1 migrations explicitly; seed uses INSERT OR IGNORE. Never copy another application's credentials.

Email sender is `PowerMatch <support@zenmeasure.com>`. Set the dedicated Worker secret `RESEND_API_KEY` using Cloudflare or `wrangler secret put RESEND_API_KEY`; never place it in frontend variables, Git or chat. Without this secret, login is disabled and `/api/health` reports `emailConfigured: false`. Provider acceptance and real inbox delivery remain separate checks.

### Model boundaries and remaining work

- Tiny's timing model is **13.2353 µA**. The team's “11+ µA” observation remains separate. MHO-C404's brochure does not provide a load profile.
- Batteries currently use a nominal-voltage/capacity model; PV uses user-provided reference density and approximate lux/angle scaling. Capacitors use 60-second energy integration with a separate peak check. Results are conditional; an unexhausted simulation reports a lower bound, not infinite life.
- LIC defaults to a generic 1 F template, not an invented manufacturer part. Missing parameters remain explicit. Imported text-PDF values are candidates requiring human review.
- Seven-language primary labels and navigation are available with browser/manual preference. Detailed explanations currently use Chinese/English fallback; full technical localization remains open.
- Branded report uses browser **Print / Save as PDF**. Energy path is a block diagram. Pin-level schematics/KiCad export, scanned-spec OCR, persistent comparison collections, detailed display waveforms, temperature/discharge curves and adaptive BLE policies remain planned.
- Admin mail retry is implemented; opt-out controls and a fully reviewed component/image library remain open. Production Magic Link sign-in and Admin entry were confirmed by the user on 2026-09-12; other authenticated flows remain to be accepted. See [HANDOFF.md](HANDOFF.md) for current delivery evidence.

Original brand/product assets and brochures were supplied by ZenMeasure. Third-party datasheets are source links; code publication does not grant redistribution rights to those documents or trademarks.

## Product intent
A calculator for matching indoor solar panel area with device energy consumption. Supports solar, battery, and other power sources to assess if your energy supply can sustain your devices.

This tool answers one question: Can your energy supply sustain your devices?

It is an energy-matching calculator designed for indoor low-power scenarios (IoT sensors, smart home nodes, etc.). Core features include:

1) Photovoltaic area calculation: Estimate the indoor solar panel area needed based on device power requirements and lighting conditions.
2) Device energy assessment: Input device power parameters and duty cycles to derive average daily and peak energy consumption.
3) Battery matching analysis: Evaluate how different battery types (Li-ion, thin-film, etc.) — their capacity, charge/discharge characteristics — match your device's power demand. Solar is just one energy source for device batteries; this tool covers the broader "battery ↔ device" supply-demand relationship.
4) Supply-demand balance: Combine solar generation, battery storage, and device consumption to deliver a "sufficient or not" verdict with optimization suggestions.
Suitable for IoT product development, indoor energy harvesting design, and low-power device selection.

这个工具帮你回答一个问题：你的能源供给，能不能撑住你的设备？

它是一个面向室内低功耗场景（如 IoT 传感器、智能家居节点等）的能耗匹配计算器。核心功能包括：

1) 光伏面积计算：根据设备功耗需求和光照条件，估算所需的室内光伏板面积。
2) 设备能耗评估：录入设备的功耗参数与工作周期，得出日均/峰值耗电量。
3) 电池适配分析：支持不同类型电池（锂电、薄膜电池等）的容量、充放电特性与设备用电需求的匹配评估——光伏只是设备电池的一种能量来源，本工具同时覆盖"电池 ↔ 设备"的供需关系。
4) 供需平衡判断：综合光能发电、电池储能与设备耗电，给出"够不够用"的结论与优化建议。
适合 IoT 产品开发、室内能量采集方案设计、低功耗设备选型等场景使用。

Production uses immediate message processing plus admin-triggered retry/expiry cleanup. The account’s free Cron trigger quota was already exhausted; no other project schedules were modified.
