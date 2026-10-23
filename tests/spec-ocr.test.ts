import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abortable,
  createLocalOCRTask,
  imageDimensions,
  MAX_CANVAS_PIXELS,
  OCR_ASSET_ROOT,
  scaledDimensions,
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
}));
vi.mock("tesseract.js", () => ({
  OEM: { LSTM_ONLY: 1 },
  createWorker: (...args: any[]) => {
    mocks.create(...args);
    new globalThis.Worker(args[2].workerPath);
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
  vi.stubGlobal("createImageBitmap", mocks.decode);
  vi.stubGlobal("location", {
    origin: "http://localhost",
    href: "http://localhost/",
  });
  vi.stubGlobal(
    "Worker",
    class {
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
