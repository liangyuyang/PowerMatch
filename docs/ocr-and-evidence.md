# Local OCR and field evidence

Images and one selected scanned-PDF page can be recognized locally in the browser. No file is sent to an AI/OCR provider. Uploading a Spec for community review remains a separate explicit action. Text-PDF extraction uses the existing authenticated PowerMatch endpoint.

The component detail dialog offers English, Simplified Chinese, Japanese, Korean, Spanish, French and German recognition. The default is English + Simplified Chinese. Extraction only produces candidates: a person must select values, inspect units/model/conditions and submit them for review. OCR character confidence does not establish electrical accuracy.

Each supplied parameter source records its normalized value/unit, source page, excerpt, conditions and submitter-declared method. Editing a claim marks it manual. Missing provenance remains unknown. The original submission and each review are immutable; adopted component versions and saved designs retain their evidence. The file SHA identifies uploaded bytes; it does not authenticate a submitted quote or prove that the document says it. Changing files clears prior field claims; changing the component or identity cancels stale extraction. Reviewing an existing Spec clears any other file's pending candidates.

Limits: images <=20 MB, header dimensions <=16 MP; raster canvases <=4 MP and 8192 px per side. PDFs <=5 MB /20 pages, one page per local recognition. Recognition times out after 5 minutes; cancel/file change/modal close terminates the OCR worker and cleans up render resources. PDF parsing happens before page-count validation; these are input/page/pixel/output bounds, not a guarantee against arbitrary hostile-PDF decompression or CPU consumption. Server text extraction returns <=150 k characters and 80 candidates.

`npm run dev` and `npm run build` prepare versioned same-origin assets from pinned npm dependencies. Generated `public/ocr-assets/` is ignored by Git. Tesseract 7.0.0, core 7.0.0 and the seven 1.0.0 language packages are checked before copying; the asset manifest contains source hashes. OCR/PDF code and language data are loaded on demand. CSP allows same-origin workers and WebAssembly compilation (`wasm-unsafe-eval`), with JavaScript eval still blocked. There is no CDN fallback configured.

Third-party distribution notices accompany the assets. Language npm packages declare MIT in their original package metadata; the upstream trained-data repository distributes its [Apache 2 license](https://github.com/naptha/tessdata/blob/gh-pages/LICENSE), copied verbatim to `docs/third-party/tessdata-LICENSE.txt` and the generated assets. These notices do not choose an open-source license for PowerMatch or relicense ZenMeasure branding and manufacturer Specs.

Local acceptance uses synthetic documents, including actual PNG recognition and actual PDF raster/OCR. This does not replace acceptance with real manufacturer scans, difficult tables, alternate fonts or electrical measurements.
