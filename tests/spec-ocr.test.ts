import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abortable,
  createLocalOCRTask,
  imageDimensions,
  MAX_CANVAS_PIXELS,
  OCR_ASSET_ROOT,
  scaledDimensions,
  downloadOCRLanguages,
  MAX_LANGUAGE_BYTES,
} from "../src/spec-ocr";
const mocks = vi.hoisted(() => ({
  startupPending: false,
  create: vi.fn(),
  recognize: vi.fn(),
  ocrTerminate: vi.fn(),
  nativeTerminate: vi.fn(),
  destroy: vi.fn(),
  renderCancel: vi.fn(),
  pages: 1,
  renderPending: false,
  renderOptions: null as any,
  decode: vi.fn(),
  fetch: vi.fn(),
  postMessage: vi.fn(),
}));
vi.mock("tesseract.js", () => ({
  OEM: { LSTM_ONLY: 1 },
  createWorker: (...args: any[]) => {
    mocks.create(...args);
    const worker = new globalThis.Worker(args[2].workerPath);
    worker.postMessage({ action: "loadLanguage", payload: { langs: args[0] } });
    worker.postMessage({ action: "initialize", payload: { langs: args[0] } });
    if (mocks.startupPending) return new Promise(() => {});
    return Promise.resolve({
      recognize: mocks.recognize,
      terminate: mocks.ocrTerminate,
    });
  },
}));
vi.mock("unpdf", () => ({
  getResolvedPDFJS: async () => ({
    getDocument: () => ({
      destroy: mocks.destroy,
      promise: Promise.resolve({
        numPages: mocks.pages,
        getPage: async () => ({
          getViewport: ({ scale }: any) => ({
            width: 1000 * scale,
            height: 2000 * scale,
          }),
          render: (options: any) => {
            mocks.renderOptions = options;
            return {
              cancel: mocks.renderCancel,
              promise: mocks.renderPending
                ? new Promise(() => {})
                : Promise.resolve(),
            };
          },
        }),
      }),
    }),
  }),
}));
function png(width = 1200, height = 600) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
const image = (width = 1200, height = 600) =>
  new File([png(width, height)], "test.png", { type: "image/png" });
function gzip(size = 20) {
  const bytes = new Uint8Array(size);
  bytes.set([31, 139, 8]);
  return bytes;
}
function rawTrainedData() {
  const data = new Uint8Array(2048),
    view = new DataView(data.buffer);
  view.setInt32(0, 24, true);
  for (let i = 0; i < 24; i++)
    view.setBigInt64(4 + i * 8, i === 23 ? 196n : -1n, true);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.startupPending = false;
  mocks.pages = 1;
  mocks.renderPending = false;
  mocks.renderOptions = null;
  mocks.recognize.mockResolvedValue({
    data: { text: "Rated voltage 3 V. Capacity 225 mAh.", confidence: 92 },
  });
  mocks.ocrTerminate.mockResolvedValue(undefined);
  mocks.destroy.mockResolvedValue(undefined);
  mocks.decode.mockResolvedValue({ close: vi.fn() });
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(
    async () => new Response(gzip(), { headers: { "Content-Length": "20" } }),
  );
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubGlobal("createImageBitmap", mocks.decode);
  vi.stubGlobal("location", {
    origin: "http://localhost",
    href: "http://localhost/",
  });
  vi.stubGlobal(
    "Worker",
    class {
      postMessage(message: unknown) {
        mocks.postMessage(message);
      }
      terminate() {
        mocks.nativeTerminate();
      }
    },
  );
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillRect() {}, drawImage() {} }),
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("bounded local OCR", () => {
  it("parses dimensions before decode and bounds output pixels without inventing source values", async () => {
    expect(imageDimensions(png())).toEqual({ width: 1200, height: 600 });
    const jpeg = new Uint8Array([
      255, 216, 255, 192, 0, 8, 8, 0, 100, 0, 200, 3,
    ]);
    expect(imageDimensions(jpeg)).toEqual({ width: 200, height: 100 });
    expect(() => imageDimensions(png(5000, 4000))).toThrow(
      "image-too-many-pixels",
    );
    expect(() => imageDimensions(new Uint8Array([1, 2, 3]))).toThrow(
      "image-header-invalid",
    );
    const scaled = scaledDimensions(4000, 4000);
    expect(scaled.width * scaled.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    await expect(
      createLocalOCRTask(image(5000, 4000), { language: "eng" }).promise,
    ).rejects.toThrow("image-too-many-pixels");
    expect(mocks.decode).not.toHaveBeenCalled();
    const result = await createLocalOCRTask(image(), { language: "eng" })
      .promise;
    expect(result.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameter: "capacityMah",
          value: 225,
          page: 1,
          method: "local-ocr",
        }),
      ]),
    );
    expect(mocks.create.mock.calls[0][2]).toMatchObject({
      workerBlobURL: false,
      workerPath: "http://localhost" + OCR_ASSET_ROOT + "/worker.min.js",
      langPath: "http://localhost" + OCR_ASSET_ROOT + "/lang",
      corePath: "http://localhost" + OCR_ASSET_ROOT + "/core",
    });
    expect(mocks.create.mock.calls[0][0]).toEqual([
      { code: "eng", data: gzip() },
    ]);
    expect(mocks.postMessage.mock.calls[0][0]).toEqual({
      action: "loadLanguage",
      payload: { langs: [{ code: "eng", data: gzip() }] },
    });
    expect(mocks.postMessage.mock.calls[1][0]).toEqual({
      action: "initialize",
      payload: { langs: "eng" },
    });
    expect(mocks.nativeTerminate).toHaveBeenCalled();
    expect(mocks.ocrTerminate).toHaveBeenCalled();
  });
  it("captures and terminates the spawned worker during unresolved WASM startup and restores Worker immediately", async () => {
    mocks.startupPending = true;
    const NativeWorker = globalThis.Worker;
    const task = createLocalOCRTask(image(), { language: "eng" });
    const rejection = expect(task.promise).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(globalThis.Worker).toBe(NativeWorker);
    task.cancel();
    await rejection;
    expect(mocks.nativeTerminate).toHaveBeenCalledTimes(1);
    expect(mocks.recognize).not.toHaveBeenCalled();
  });
  it("cancels decoded bitmap work, propagates external cancellation and enforces timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createLocalOCRTask(image(), {
        language: "eng",
        signal: controller.signal,
      }).promise,
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.decode).not.toHaveBeenCalled();
    mocks.startupPending = true;
    await expect(
      createLocalOCRTask(image(), { language: "eng", timeoutMs: 10 }).promise,
    ).rejects.toThrow("ocr-timeout");
    expect(mocks.nativeTerminate).toHaveBeenCalled();
    const cancelled = new AbortController();
    const pending = abortable(new Promise(() => {}), cancelled.signal);
    cancelled.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  it("enforces PDF page bounds and cancels/releases a pending single-page render", async () => {
    const pdf = new File(["%PDF-1.4"], "scan.pdf", { type: "application/pdf" });
    mocks.pages = 21;
    await expect(
      createLocalOCRTask(pdf, { language: "eng" }).promise,
    ).rejects.toThrow("pdf-too-many-pages");
    expect(mocks.destroy).toHaveBeenCalled();
    mocks.pages = 2;
    await expect(
      createLocalOCRTask(pdf, { language: "eng", page: 3 }).promise,
    ).rejects.toThrow("pdf-page-invalid");
    mocks.renderPending = true;
    const task = createLocalOCRTask(pdf, { language: "eng", page: 2 });
    const rejection = expect(task.promise).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(mocks.renderOptions).not.toBeNull());
    expect(
      mocks.renderOptions.canvas.width * mocks.renderOptions.canvas.height,
    ).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    task.cancel();
    await rejection;
    expect(mocks.renderCancel).toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalled();
  });
  it("closes a bitmap that finishes decoding after cancellation", async () => {
    let finish!: (value: any) => void;
    const close = vi.fn();
    mocks.decode.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const task = createLocalOCRTask(image(), { language: "eng" }),
      rejected = expect(task.promise).rejects.toMatchObject({
        name: "AbortError",
      });
    await vi.waitFor(() => expect(mocks.decode).toHaveBeenCalled());
    task.cancel();
    await rejected;
    finish({ close });
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
describe("observable local language downloads", () => {
  it.each(["application/gzip", "application/octet-stream"])(
    "passes browser-decoded traineddata through with gzip HTTP encoding and %s",
    async (mime) => {
      const raw = rawTrainedData();
      mocks.fetch.mockResolvedValue(
        new Response(raw, {
          headers: {
            "Content-Type": mime,
            "Content-Encoding": "gzip",
            "Content-Length": "999999999",
          },
        }),
      );
      const onProgress = vi.fn();
      const result = await downloadOCRLanguages(
        "eng",
        new AbortController().signal,
        onProgress,
      );
      expect(
        Buffer.from(result[0].data as Uint8Array).equals(Buffer.from(raw)),
      ).toBe(true);
      expect(
        onProgress.mock.calls.every(([status]) => !status.includes(" / ")),
      ).toBe(true);
    },
  );
  it.each(["text/html", "application/gzip", "application/octet-stream"])(
    "rejects an HTML body even if HTTP gzip encoding is present with %s",
    async (mime) => {
      mocks.fetch.mockResolvedValue(
        new Response("<!DOCTYPE html><html>SPA fallback</html>", {
          headers: { "Content-Type": mime, "Content-Encoding": "gzip" },
        }),
      );
      await expect(
        downloadOCRLanguages("eng", new AbortController().signal),
      ).rejects.toThrow(/HTML page|valid gzip or decoded/);
    },
  );
  it.each([new Uint8Array(), new Uint8Array([24, 0, 0, 0])])(
    "rejects empty or short browser-decoded bodies",
    async (data) => {
      mocks.fetch.mockResolvedValue(
        new Response(data, {
          headers: {
            "Content-Type": "application/gzip",
            "Content-Encoding": "gzip",
          },
        }),
      );
      await expect(
        downloadOCRLanguages("eng", new AbortController().signal),
      ).rejects.toThrow("valid gzip or decoded");
    },
  );
  it("does not accept raw bytes without the explicit decoded-HTTP-gzip media-type branch", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(rawTrainedData(), {
        headers: { "Content-Encoding": "gzip" },
      }),
    );
    await expect(
      downloadOCRLanguages("eng", new AbortController().signal),
    ).rejects.toThrow("valid gzip asset");
  });
  it("does not compare decoded body bytes with an encoded HTTP Content-Length", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(gzip(), {
        headers: { "Content-Encoding": "br", "Content-Length": "7" },
      }),
    );
    const onProgress = vi.fn();
    const result = await downloadOCRLanguages(
      "eng",
      new AbortController().signal,
      onProgress,
    );
    expect((result[0].data as Uint8Array).byteLength).toBe(20);
    expect(
      onProgress.mock.calls.every(([status]) => !status.includes(" / ")),
    ).toBe(true);
  });
  it("reports incremental byte progress with Content-Length and passes compressed bytes through unchanged", async () => {
    const data = gzip(3_000_000),
      onProgress = vi.fn();
    let offset = 0;
    mocks.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            if (offset === data.length) {
              controller.close();
              return;
            }
            controller.enqueue(data.slice(offset, offset + 1_000_000));
            offset += 1_000_000;
          },
        }),
        { headers: { "Content-Length": String(data.length) } },
      ),
    );
    const result = await downloadOCRLanguages(
      "eng",
      new AbortController().signal,
      onProgress,
    );
    expect(result[0].code).toBe("eng");
    expect(
      Buffer.from(result[0].data as Uint8Array).equals(Buffer.from(data)),
    ).toBe(true);
    expect(onProgress.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining([
        expect.stringContaining("eng: 1.00 / 3.00 MB"),
        expect.stringContaining("eng: 2.00 / 3.00 MB"),
      ]),
    );
    expect(onProgress.mock.calls.at(-1)![1]).toBe(1);
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      "http://localhost" + OCR_ASSET_ROOT + "/lang/eng.traineddata.gz",
    );
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({
      mode: "same-origin",
      credentials: "same-origin",
      redirect: "error",
    });
  });
  it("reports downloaded MB without inventing a total when Content-Length is absent", async () => {
    mocks.fetch.mockResolvedValue(new Response(gzip(100_000)));
    const onProgress = vi.fn();
    await downloadOCRLanguages("eng", new AbortController().signal, onProgress);
    expect(
      onProgress.mock.calls.some(([status]) => status.includes("eng: 0.10 MB")),
    ).toBe(true);
    expect(
      onProgress.mock.calls.every(([status]) => !status.includes(" / ")),
    ).toBe(true);
  });
  it("aborts the fetch and pending reader before any OCR worker is started", async () => {
    const cancel = vi.fn(),
      pull = vi.fn(() => new Promise<void>(() => {}));
    mocks.fetch.mockResolvedValue(
      new Response(new ReadableStream({ pull, cancel })),
    );
    const task = createLocalOCRTask(image(), { language: "eng" }),
      rejected = expect(task.promise).rejects.toMatchObject({
        name: "AbortError",
      });
    await vi.waitFor(() => expect(pull).toHaveBeenCalled());
    task.cancel();
    await rejected;
    expect(cancel).toHaveBeenCalled();
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.nativeTerminate).not.toHaveBeenCalled();
  });
  it.each(["header", "stream"] as const)(
    "rejects an oversized %s and cancels the body",
    async (kind) => {
      const cancel = vi.fn();
      mocks.fetch.mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              if (kind === "stream")
                controller.enqueue(gzip(MAX_LANGUAGE_BYTES + 1));
            },
            cancel,
          }),
          {
            headers:
              kind === "header"
                ? { "Content-Length": String(MAX_LANGUAGE_BYTES + 1) }
                : {},
          },
        ),
      );
      await expect(
        downloadOCRLanguages("eng", new AbortController().signal),
      ).rejects.toThrow("8 MB");
      expect(cancel).toHaveBeenCalled();
    },
  );
  it("rejects an HTML/invalid-gzip response and cancels another language download while retaining the first error", async () => {
    const cancelSibling = vi.fn(),
      pendingPull = vi.fn(() => new Promise<void>(() => {}));
    mocks.fetch.mockImplementation(async (url: string) =>
      url.includes("/eng.")
        ? new Response(new TextEncoder().encode("<!DOCTYPE html>"))
        : new Response(
            new ReadableStream({ pull: pendingPull, cancel: cancelSibling }),
          ),
    );
    await expect(
      downloadOCRLanguages("eng+chi_sim", new AbortController().signal),
    ).rejects.toThrow("OCR language eng is not a valid gzip asset.");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(cancelSibling).toHaveBeenCalled();
    expect(
      mocks.fetch.mock.calls.every(([, options]) => options.signal.aborted),
    ).toBe(true);
  });
  it("rejects truncated bodies and language path manipulation before spawning a worker", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(gzip(), { headers: { "Content-Length": "100" } }),
    );
    await expect(
      downloadOCRLanguages("eng", new AbortController().signal),
    ).rejects.toThrow("length did not match");
    mocks.fetch.mockClear();
    await expect(
      downloadOCRLanguages("../eng", new AbortController().signal),
    ).rejects.toThrow("ocr-invalid-language");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
