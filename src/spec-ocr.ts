import { extractCandidates } from "./shared/spec-parser";
import type { FieldEvidence } from "./shared/spec-evidence";
import type { Lang } from "tesseract.js";

export const OCR_ASSET_ROOT =
  "/ocr-assets/tesseract-7.0.0-core-7.0.0-data-1.0.0-best-int";
export const OCR_LANGUAGES = [
  "eng+chi_sim",
  "eng",
  "chi_sim",
  "jpn",
  "kor",
  "spa",
  "fra",
  "deu",
] as const;
export const MAX_IMAGE_PIXELS = 16_000_000,
  MAX_CANVAS_PIXELS = 4_000_000;
export const MAX_LANGUAGE_BYTES = 8 * 1024 * 1024;
export interface OCRResult {
  text: string;
  confidence: number;
  fields: FieldEvidence[];
  page: number;
  totalPages: number;
}
export interface OCROptions {
  language: string;
  page?: number;
  onProgress?: (status: string, progress: number) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}
const aborted = () => new DOMException("Local OCR cancelled", "AbortError");
function check(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? aborted();
}
export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason ?? aborted());
    if (signal.aborted) {
      promise.catch(() => {});
      cancel();
      return;
    }
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", cancel);
        if (signal.aborted) cancel();
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", cancel);
        reject(error);
      },
    );
  });
}
function isRawTrainedData(data: Uint8Array) {
  if (data.byteLength < 1024) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength),
    entries = view.getInt32(0, true);
  const header = 4 + entries * 8;
  if (entries < 1 || entries > 256 || header > data.byteLength) return false;
  let sections = 0;
  for (let i = 0; i < entries; i++) {
    const offset = view.getBigInt64(4 + i * 8, true);
    if (offset === -1n) continue;
    if (offset < BigInt(header) || offset >= BigInt(data.byteLength))
      return false;
    sections++;
  }
  return sections > 0;
}
/** Download compressed language bytes in the page realm; decoding stays in Tesseract's worker. */
export async function downloadOCRLanguages(
  language: string,
  outerSignal: AbortSignal,
  onProgress?: OCROptions["onProgress"],
): Promise<Lang[]> {
  if (!OCR_LANGUAGES.includes(language as (typeof OCR_LANGUAGES)[number]))
    throw Error("ocr-invalid-language");
  const controller = new AbortController(),
    signal = controller.signal;
  const cancel = () => controller.abort(outerSignal.reason ?? aborted());
  outerSignal.addEventListener("abort", cancel, { once: true });
  if (outerSignal.aborted) cancel();
  const codes = language.split("+"),
    progress = new Map(
      codes.map((code) => [
        code,
        { loaded: 0, total: null as number | null, done: false },
      ]),
    );
  const emit = () => {
    if (signal.aborted) return;
    const status = codes
      .map((code) => {
        const item = progress.get(code)!;
        return (
          code +
          ": " +
          (item.loaded / 1_000_000).toFixed(2) +
          (item.total !== null
            ? " / " + (item.total / 1_000_000).toFixed(2)
            : "") +
          " MB"
        );
      })
      .join("; ");
    const ratio =
      codes.reduce((sum, code) => {
        const item = progress.get(code)!;
        return (
          sum +
          (item.done
            ? 1
            : item.total
              ? Math.min(1, item.loaded / item.total)
              : 0)
        );
      }, 0) / codes.length;
    onProgress?.("Downloading OCR language data — " + status, ratio);
  };
  const download = async (code: string): Promise<Lang> => {
    check(signal);
    const url = new URL(
      OCR_ASSET_ROOT + "/lang/" + code + ".traineddata.gz",
      location.origin,
    );
    const response = await abortable(
      fetch(url.href, {
        signal,
        mode: "same-origin",
        credentials: "same-origin",
        redirect: "error",
      }),
      signal,
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw Error(
        "OCR language " +
          code +
          " download failed (HTTP " +
          response.status +
          ").",
      );
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw Error("OCR language " + code + " response has no readable body.");
    let complete = false;
    const abortReader = () => {
      void reader.cancel(signal.reason).catch(() => {});
    };
    signal.addEventListener("abort", abortReader, { once: true });
    try {
      check(signal);
      const encoding = response.headers.get("Content-Encoding") ?? "",
        mime = (response.headers.get("Content-Type") ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase();
      const encodedGzip = encoding
        .split(",")
        .some((value) => value.trim().toLowerCase() === "gzip");
      const mayBeDecoded =
        encodedGzip &&
        ["application/gzip", "application/octet-stream"].includes(mime);
      if (mime === "text/html" || mime === "application/xhtml+xml")
        throw Error(
          "OCR language " +
            code +
            " response is an HTML page, not language data.",
        );
      // Fetch exposes decoded body bytes. An encoded HTTP Content-Length may
      // describe different wire bytes, so it cannot serve as our decoded total.
      const declared = response.headers.get("Content-Encoding")
        ? null
        : response.headers.get("Content-Length");
      const total =
        declared && /^\d+$/.test(declared) ? Number(declared) : null;
      if (
        total !== null &&
        (!Number.isSafeInteger(total) || total > MAX_LANGUAGE_BYTES)
      )
        throw Error(
          "OCR language " + code + " exceeds the 8 MB download limit.",
        );
      const item = progress.get(code)!;
      item.total = total && total > 0 ? total : null;
      emit();
      const chunks: Uint8Array[] = [];
      const prefix: number[] = [];
      while (true) {
        const { done, value } = await abortable(reader.read(), signal);
        check(signal);
        if (done) {
          complete = true;
          break;
        }
        if (!value?.byteLength) continue;
        item.loaded += value.byteLength;
        if (item.loaded > MAX_LANGUAGE_BYTES)
          throw Error(
            "OCR language " + code + " exceeds the 8 MB download limit.",
          );
        for (let i = 0; i < value.length && prefix.length < 3; i++)
          prefix.push(value[i]);
        if (
          !mayBeDecoded &&
          prefix.length === 3 &&
          (prefix[0] !== 31 || prefix[1] !== 139 || prefix[2] !== 8)
        )
          throw Error("OCR language " + code + " is not a valid gzip asset.");
        chunks.push(value);
        emit();
      }
      if (item.total !== null && item.loaded !== item.total)
        throw Error(
          "OCR language " +
            code +
            " download length did not match its response header.",
        );
      const data = new Uint8Array(item.loaded);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const gzip =
        item.loaded >= 10 &&
        prefix[0] === 31 &&
        prefix[1] === 139 &&
        prefix[2] === 8;
      if (!gzip && !(mayBeDecoded && isRawTrainedData(data)))
        throw Error(
          "OCR language " +
            code +
            " is not a valid gzip or decoded traineddata asset.",
        );
      item.done = true;
      emit();
      return { code, data };
    } finally {
      signal.removeEventListener("abort", abortReader);
      if (!complete) void reader.cancel(signal.reason).catch(() => {});
      try {
        reader.releaseLock();
      } catch {
        /* Aborting a pending read may release on the next microtask. */
      }
    }
  };
  try {
    // The supported default contains two languages; no other selection creates more than two fetches.
    return await Promise.all(codes.map(download));
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    outerSignal.removeEventListener("abort", cancel);
    controller.abort();
  }
}
/** Inspect PNG/JPEG dimensions before invoking any browser image decoder. */
export function imageDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10 &&
    String.fromCharCode(...bytes.slice(12, 16)) === "IHDR"
  ) {
    return checkedDimensions(view.getUint32(16), view.getUint32(20));
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) throw Error("image-header-invalid");
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        if (length < 7) break;
        return checkedDimensions(
          view.getUint16(offset + 5),
          view.getUint16(offset + 3),
        );
      }
      offset += length;
    }
  }
  throw Error("image-header-invalid");
}
function checkedDimensions(width: number, height: number) {
  if (!width || !height || width * height > MAX_IMAGE_PIXELS)
    throw Error("image-too-many-pixels");
  return { width, height };
}
export function scaledDimensions(
  width: number,
  height: number,
  cap = MAX_CANVAS_PIXELS,
) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw Error("image-header-invalid");
  const scale = Math.min(
    1,
    Math.sqrt(cap / (width * height)),
    8192 / width,
    8192 / height,
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}
export function createLocalOCRTask(file: File, options: OCROptions) {
  const controller = new AbortController(),
    signal = controller.signal;
  let nativeWorker: Worker | undefined,
    ocrWorker: { terminate: () => Promise<unknown> } | undefined;
  let loadingTask: { destroy: () => Promise<unknown> } | undefined,
    renderTask: { cancel: () => void } | undefined;
  let bitmap: ImageBitmap | undefined, canvas: HTMLCanvasElement | undefined;
  const cleanup = () => {
    nativeWorker?.terminate();
    nativeWorker = undefined;
    void ocrWorker?.terminate().catch(() => {});
    ocrWorker = undefined;
    renderTask?.cancel();
    renderTask = undefined;
    void loadingTask?.destroy().catch(() => {});
    loadingTask = undefined;
    bitmap?.close();
    bitmap = undefined;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
      canvas = undefined;
    }
  };
  const cancel = () => controller.abort(aborted());
  const externalAbort = () =>
    controller.abort(options.signal?.reason ?? aborted());
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  if (options.signal?.aborted) externalAbort();
  signal.addEventListener("abort", cleanup, { once: true });
  const timer = setTimeout(
    () => controller.abort(Error("ocr-timeout")),
    options.timeoutMs ?? 300_000,
  );
  const promise = (async (): Promise<OCRResult> => {
    try {
      check(signal);
      if (
        !OCR_LANGUAGES.includes(
          options.language as (typeof OCR_LANGUAGES)[number],
        )
      )
        throw Error("ocr-invalid-language");
      const isPDF =
        file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (file.size > (isPDF ? 5 : 20) * 1024 * 1024)
        throw Error(isPDF ? "pdf-too-large" : "image-too-large");
      const pageNumber = isPDF ? (options.page ?? 1) : 1;
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 20)
        throw Error("pdf-page-invalid");
      let totalPages = 1;
      if (isPDF) {
        options.onProgress?.("rendering PDF page", 0);
        const [{ getResolvedPDFJS }, buffer] = await abortable(
          Promise.all([import("unpdf"), file.arrayBuffer()]),
          signal,
        );
        const pdfjs = await abortable(getResolvedPDFJS(), signal);
        check(signal);
        loadingTask = pdfjs.getDocument({
          data: new Uint8Array(buffer),
          useSystemFonts: true,
          disableFontFace: true,
          isEvalSupported: false,
          useWorkerFetch: false,
          enableXfa: false,
          maxImageSize: MAX_IMAGE_PIXELS,
          canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
          stopAtErrors: true,
        } as any);
        const pdf: any = await abortable((loadingTask as any).promise, signal);
        totalPages = pdf.numPages;
        if (totalPages > 20) throw Error("pdf-too-many-pages");
        if (pageNumber > totalPages) throw Error("pdf-page-invalid");
        const page = (await abortable(pdf.getPage(pageNumber), signal)) as any;
        const base = page.getViewport({ scale: 1 }),
          bounds = scaledDimensions(base.width * 2, base.height * 2),
          scale = Math.min(
            bounds.width / base.width,
            bounds.height / base.height,
          );
        const viewport = page.getViewport({ scale }),
          size = scaledDimensions(viewport.width, viewport.height);
        canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw Error("canvas-unavailable");
        renderTask = page.render({
          canvasContext: context,
          canvas,
          viewport,
          background: "rgb(255,255,255)",
        });
        await abortable((renderTask as any).promise, signal);
        renderTask = undefined;
      } else {
        options.onProgress?.("reading image", 0);
        // Reject oversized headers before createImageBitmap can allocate full decoded pixels.
        const header = new Uint8Array(
          await abortable(file.slice(0, 512 * 1024).arrayBuffer(), signal),
        );
        const size = scaledDimensions(
          ...(Object.values(imageDimensions(header)) as [number, number]),
        );
        const decoded = createImageBitmap(file, {
          resizeWidth: size.width,
          resizeHeight: size.height,
          resizeQuality: "high",
          imageOrientation: "from-image",
        });
        decoded.then(
          (value) => {
            if (signal.aborted) value.close();
          },
          () => {},
        );
        bitmap = await abortable(decoded, signal);
        check(signal);
        canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw Error("canvas-unavailable");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, size.width, size.height);
        context.drawImage(bitmap, 0, 0, size.width, size.height);
        bitmap.close();
        bitmap = undefined;
      }
      check(signal);
      const languages = await downloadOCRLanguages(
        options.language,
        signal,
        options.onProgress,
      );
      check(signal);
      const { createWorker, OEM } = await abortable(
        import("tesseract.js"),
        signal,
      );
      check(signal);
      const workerPath = new URL(
        OCR_ASSET_ROOT + "/worker.min.js",
        location.origin,
      ).href;
      const NativeWorker = globalThis.Worker;
      let rejectWorkerError!: (error: Error) => void;
      const workerErrors = new Promise<never>((_, reject) => {
        rejectWorkerError = reject;
      });
      workerErrors.catch(() => {});
      let startup: ReturnType<typeof createWorker>;
      // v7 spawns synchronously before returning its initialization promise and has no
      // worker factory option. Capture only this URL in that synchronous call, then
      // immediately restore Worker. Cancellation during WASM loading can now terminate it.
      globalThis.Worker = class extends NativeWorker {
        private matchesOCR = false;
        constructor(url: string | URL, workerOptions?: WorkerOptions) {
          super(url, workerOptions);
          this.matchesOCR =
            new URL(String(url), location.href).href === workerPath;
          if (this.matchesOCR) nativeWorker = this;
        }
        postMessage(message: any, transfer: Transferable[]): void;
        postMessage(message: any, options?: StructuredSerializeOptions): void;
        postMessage(
          message: any,
          options?: Transferable[] | StructuredSerializeOptions,
        ) {
          // Installed tesseract.js7.0.0 accepts official Lang[] for loading bytes,
          // but initialize mistakenly joins Lang.data instead of Lang.code. Keep
          // loadLanguage bytes untouched and normalize only this known init packet.
          if (
            this.matchesOCR &&
            message?.action === "initialize" &&
            Array.isArray(message.payload?.langs)
          ) {
            message = {
              ...message,
              payload: {
                ...message.payload,
                langs: message.payload.langs
                  .map((lang: any) =>
                    typeof lang === "string" ? lang : lang.code,
                  )
                  .join("+"),
              },
            };
          }
          super.postMessage(message, options as StructuredSerializeOptions);
        }
      };
      try {
        startup = createWorker(languages, OEM.LSTM_ONLY, {
          workerPath,
          corePath: new URL(OCR_ASSET_ROOT + "/core", location.origin).href,
          langPath: new URL(OCR_ASSET_ROOT + "/lang", location.origin).href,
          workerBlobURL: false,
          gzip: true,
          cacheMethod: "none",
          logger: (entry) => {
            if (!signal.aborted)
              options.onProgress?.(
                entry.status,
                Math.max(0, Math.min(1, entry.progress)),
              );
          },
          errorHandler: (error) => rejectWorkerError(Error(String(error))),
        });
      } finally {
        globalThis.Worker = NativeWorker;
      }
      startup.then(
        (value) => {
          if (signal.aborted) void value.terminate();
        },
        () => {},
      );
      const worker = await abortable(
        Promise.race([startup, workerErrors]),
        signal,
      );
      ocrWorker = worker;
      check(signal);
      const result = await abortable(
        Promise.race([worker.recognize(canvas!), workerErrors]),
        signal,
      );
      check(signal);
      const text = result.data.text.slice(0, 150_000);
      return {
        text,
        confidence: result.data.confidence,
        fields: extractCandidates(text, pageNumber, "local-ocr"),
        page: pageNumber,
        totalPages,
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", externalAbort);
      signal.removeEventListener("abort", cleanup);
      cleanup();
    }
  })();
  return { promise, cancel };
}
