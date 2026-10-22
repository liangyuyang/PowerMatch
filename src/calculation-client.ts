import type { Design } from "./shared/model";
import { ENGINE_VERSION, type Result } from "./shared/engine";

// Only engine inputs participate. Editing labels/notes must not restart a simulation.
export const calculationKey = (d: Design) => JSON.stringify({
  engine: ENGINE_VERSION, device: d.device, load: d.load, mode: d.mode, path: d.path,
  light: d.light, pv: d.pv, storage: d.storage, regulation: d.regulation,
  horizonDays: d.horizonDays, margin: d.margin,
});
export type CalculationReply = { id: number; key: string } & (
  { result: Result; error?: never } | { result?: never; error: string }
);
type WorkerPort = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror">;

/** One job at a time: a new batch cancels obsolete work before queuing current first. */
export class CalculationClient {
  private cache = new Map<string, Result>();
  private worker: WorkerPort | null = null;
  private sequence = 0;
  private rejectActive: ((reason: Error) => void) | null = null;
  constructor(private createWorker: () => WorkerPort = () => new Worker(
    new URL("./calculation-worker.ts", import.meta.url), { type: "module" },
  )) {}
  peek(key: string) { return this.cache.get(key); }
  cancel() {
    this.worker?.terminate();
    this.worker = null;
    this.rejectActive?.(new DOMException("Calculation cancelled", "AbortError"));
    this.rejectActive = null;
  }
  async calculate(design: Design, signal: AbortSignal): Promise<Result> {
    if (signal.aborted) throw new DOMException("Calculation cancelled", "AbortError");
    const key = calculationKey(design);
    const cached = this.cache.get(key);
    if (cached) return cached;
    return new Promise<Result>((resolve, reject) => {
      const id = ++this.sequence;
      let settled = false;
      let worker: WorkerPort;
      try { worker = this.worker ??= this.createWorker(); }
      catch { reject(new Error("calculation-worker-unavailable")); return; }
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", aborted);
        if (this.rejectActive === fail) this.rejectActive = null;
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        reject(error);
      };
      const aborted = () => fail(new DOMException("Calculation cancelled", "AbortError"));
      // A hung or blocked worker cannot leave export/save waiting indefinitely.
      const timeout = setTimeout(() => fail(new Error("calculation-worker-timeout")), 30_000);
      this.rejectActive = fail;
      signal.addEventListener("abort", aborted, { once: true });
      worker.onerror = () => fail(new Error("calculation-worker-failed"));
      worker.onmessageerror = () => fail(new Error("calculation-worker-invalid-response"));
      worker.onmessage = (event: MessageEvent<CalculationReply>) => {
        const reply = event.data;
        if (settled || reply.id !== id || reply.key !== key || signal.aborted || this.worker !== worker) return;
        if (reply.error || !reply.result) { fail(new Error("calculation-invalid-input")); return; }
        settled = true;
        cleanup();
        this.cache.set(key, reply.result);
        if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
        resolve(reply.result);
      };
      try { worker.postMessage({ id, key, design }); }
      catch { fail(new Error("calculation-worker-failed")); }
    });
  }
}
