import React, { useEffect, useRef, useState } from "react";
import type { FieldEvidence } from "./shared/spec-evidence";
import type { Locale } from "./shared/model";
import { createLocalOCRTask, OCR_LANGUAGES, type OCRResult } from "./spec-ocr";

export function SpecExtraction({
  file,
  onCandidates,
  locale,
}: {
  file: File | null;
  onCandidates: (fields: FieldEvidence[]) => void;
  locale: Locale;
}) {
  const bi = (zh: string, en: string) => (locale === "zh" ? zh : en);
  const [language, setLanguage] = useState<string>("eng+chi_sim"),
    [page, setPage] = useState(1),
    [running, setRunning] = useState(false),
    [progress, setProgress] = useState({ status: "", value: 0 }),
    [error, setError] = useState(""),
    [result, setResult] = useState<OCRResult | null>(null),
    [resultFile, setResultFile] = useState<File | null>(null);
  const epoch = useRef(0),
    fileRef = useRef(file),
    job = useRef<ReturnType<typeof createLocalOCRTask> | null>(null);
  fileRef.current = file;
  const cancel = () => {
    ++epoch.current;
    job.current?.cancel();
    job.current = null;
    setRunning(false);
    setProgress({
      status: bi(
        "已取消，当前输入保留。",
        "Cancelled. Current inputs are preserved.",
      ),
      value: 0,
    });
  };
  useEffect(() => {
    ++epoch.current;
    job.current?.cancel();
    job.current = null;
    setRunning(false);
    setResult(null);
    setError("");
    setPage(1);
    setProgress({ status: "", value: 0 });
    return () => {
      ++epoch.current;
      job.current?.cancel();
      job.current = null;
    };
  }, [file]);
  const start = async () => {
    if (!file || running) return;
    const selected = file,
      request = ++epoch.current;
    setRunning(true);
    setResult(null);
    setError("");
    const applies = () =>
      epoch.current === request && fileRef.current === selected;
    const task = createLocalOCRTask(selected, {
      language,
      page,
      onProgress: (status, value) => {
        if (applies()) setProgress({ status, value });
      },
    });
    job.current = task;
    try {
      const result = await task.promise;
      if (!applies()) return;
      setResult(result);
      setResultFile(selected);
      setProgress({
        status: bi(
          "候选提取完成，尚未经人工核实。",
          "Candidates extracted; human verification is required.",
        ),
        value: 1,
      });
    } catch (e) {
      if (!applies()) return;
      const message = e instanceof Error ? e.message : String(e);
      setError(
        message === "image-too-many-pixels"
          ? bi(
              "图片超过 1600 万像素，解码前已拒绝。请先裁切或缩小。",
              "Image exceeds 16 megapixels and was rejected before decoding. Crop or resize it first.",
            )
          : message === "pdf-too-many-pages"
            ? bi(
                "PDF 超过 20 页，请先拆分。",
                "PDF exceeds 20 pages. Split it first.",
              )
            : message === "pdf-too-large"
              ? bi(
                  "PDF 超过 5 MB，请先压缩或拆分。",
                  "PDF exceeds 5 MB. Compress or split it first.",
                )
              : message === "pdf-page-invalid"
                ? bi(
                    "页码无效或超出文件范围。",
                    "Page number is invalid or outside this document.",
                  )
                : message === "ocr-timeout"
                  ? bi(
                      "识别超过 5 分钟，已终止并释放资源。",
                      "Recognition exceeded 5 minutes and was terminated.",
                    )
                  : message === "image-header-invalid"
                    ? bi(
                        "仅支持有效 PNG/JPEG 图片；请重新导出此图片。",
                        "Only valid PNG/JPEG images are supported. Re-export this image.",
                      )
                    : message,
      );
    } finally {
      if (applies()) {
        job.current = null;
        setRunning(false);
      }
    }
  };
  const pdf =
    !!file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name));
  return (
    <section
      className="panel spec-extraction"
      aria-label={bi("本机 OCR 候选提取", "Local OCR candidate extraction")}
    >
      <h3>{bi("本机 OCR 候选提取", "Local OCR candidate extraction")}</h3>
      <p className="caption">
        {bi(
          "图像和扫描 PDF 在本浏览器识别；只读取同站点 OCR 程序和语言包，不向外部服务上传文件。图片最多 1600 万像素，识别画布最多 400 万像素；PDF 最多 5 MB / 20 页，每次只识别一页，5 分钟自动停止。",
          "Images and scanned PDFs are recognized in this browser using same-site OCR assets. Files are not uploaded to an external service. Images: 16 MP maximum; recognition canvas: 4 MP. PDFs: 5 MB / 20 pages maximum, one page per run, with a 5-minute timeout.",
        )}
      </p>
      <p className="caption">{bi('首次识别需要下载本地识别程序与所选语言包，网络较慢时可能超过一分钟；页面会显示加载阶段，可随时取消。再次使用可利用浏览器缓存。','The first run downloads the recognition engine and selected language data. On a slow connection this can take over a minute; the loading stage remains visible and you can cancel at any time. Later runs can use browser caching.')}</p>
      <label className="field">
        <span>{bi("识别语言", "Recognition language")}</span>
        <select
          value={language}
          disabled={running}
          onChange={(e) => setLanguage(e.target.value)}
        >
          {OCR_LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {
                (
                  {
                    "eng+chi_sim": "English + 简体中文",
                    eng: "English",
                    chi_sim: "简体中文",
                    jpn: "日本語",
                    kor: "한국어",
                    spa: "Español",
                    fra: "Français",
                    deu: "Deutsch",
                  } as Record<string, string>
                )[code]
              }
            </option>
          ))}
        </select>
      </label>
      {pdf && (
        <label className="field">
          <span>{bi("PDF 页码（每次一页）", "PDF page (one per run)")}</span>
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            value={page}
            disabled={running}
            onChange={(e) => setPage(Number(e.target.value))}
          />
        </label>
      )}
      <div className="toolbar">
        <button
          type="button"
          disabled={!file || running}
          onClick={() => void start()}
        >
          {bi("在本机识别", "Recognize locally")}
        </button>
        {running && (
          <button type="button" onClick={cancel}>
            {bi("取消识别", "Cancel recognition")}
          </button>
        )}
      </div>
      {(running || progress.status) && (
        <p role="status">
          {progress.status}{" "}
          {running ? Math.round(progress.value * 100) + "%" : ""}
        </p>
      )}
      {running && (
        <progress
          value={progress.value}
          max={1}
          aria-label={bi("识别进度", "Recognition progress")}
        />
      )}
      {error && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
      {result && resultFile === file && (
        <>
          <p className="warning">
            {bi(
              `第 ${result.page}/${result.totalPages} 页 · OCR 置信度 ${Number(result.confidence.toFixed(1))}% 仅表示字符识别质量；参数值、单位及测试条件均须人工核实。`,
              `Page ${result.page}/${result.totalPages} · OCR confidence ${Number(result.confidence.toFixed(1))}% describes character recognition only. Verify parameter values, units and test conditions.`,
            )}
          </p>
          <p>
            {result.fields.length} {bi("项未验证候选", "unverified candidates")}
          </p>
          <ul>
            {result.fields.map((field, i) => (
              <li key={i}>
                <strong>
                  {field.parameter}: {String(field.value)} {field.unit}
                </strong>
                <p>{field.excerpt}</p>
              </li>
            ))}
          </ul>
          <details>
            <summary>{bi("检查识别原文", "Inspect recognized text")}</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {result.text}
            </pre>
          </details>
          <button
            type="button"
            disabled={!result.fields.length || running || resultFile !== file}
            onClick={() =>
              resultFile === fileRef.current &&
              onCandidates(result.fields.map((field) => ({ ...field })))
            }
          >
            {bi("载入待审核候选", "Load candidates for review")}
          </button>
        </>
      )}
    </section>
  );
}
export default SpecExtraction;
