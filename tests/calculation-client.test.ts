import { afterEach, describe, expect, it, vi } from "vitest";
import { CalculationClient, calculationKey, type CalculationReply } from "../src/calculation-client";
import { calculate } from "../src/shared/engine";
import { cloneDesign } from "../src/shared/model";

class TestWorker {
  onmessage: ((event: MessageEvent<CalculationReply>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
}
const create = () => {
  const workers: TestWorker[] = [];
  const client = new CalculationClient(() => { const w = new TestWorker(); workers.push(w); return w as unknown as Worker; });
  return {client, workers};
};
function reply(w: TestWorker, result = calculate(cloneDesign())) {
  const {id, key} = w.postMessage.mock.lastCall![0];
  w.onmessage?.({data: {id, key, result}} as MessageEvent<CalculationReply>);
}
afterEach(() => vi.useRealTimers());
describe("background calculation lifecycle", () => {
  it("uses exact deterministic results and reuses numeric inputs across metadata edits", async () => {
    const {client, workers} = create(), design = cloneDesign();
    design.pv.areaCm2 = 4.213456789;
    const expected = calculate(design);
    const first = client.calculate(design, new AbortController().signal);
    reply(workers[0], expected);
    expect(await first).toEqual(expected);
    const metadata = {...design, name: "different title", notes: "different evidence note"};
    expect(calculationKey(metadata)).toBe(calculationKey(design));
    expect(await client.calculate(metadata, new AbortController().signal)).toBe(expected);
    expect(workers[0].postMessage).toHaveBeenCalledTimes(1);
    expect(calculationKey({...design, margin: design.margin + 1})).not.toBe(calculationKey(design));
  });
  it("cancels A, ignores its late reply and creates a fresh worker for B", async () => {
    const {client, workers} = create(), a = cloneDesign(), abort = new AbortController();
    const old = client.calculate(a, abort.signal).catch(error => error);
    abort.abort();
    expect((await old).name).toBe("AbortError");
    const b = {...a, horizonDays: 60};
    const current = client.calculate(b, new AbortController().signal);
    reply(workers[0]);
    expect(client.peek(calculationKey(a))).toBeUndefined();
    const expected = calculate(b);
    reply(workers[1], expected);
    expect(await current).toEqual(expected);
    expect(workers[0].terminate).toHaveBeenCalled();
  });
  it("settles crashes and retries without retaining failed results", async () => {
    const {client, workers} = create(), d = cloneDesign();
    const failed = client.calculate(d, new AbortController().signal);
    workers[0].onerror?.();
    await expect(failed).rejects.toThrow("calculation-worker-failed");
    expect(client.peek(calculationKey(d))).toBeUndefined();
    const retry = client.calculate(d, new AbortController().signal);
    reply(workers[1]);
    await expect(retry).resolves.toHaveProperty("averageUa");
  });
  it("settles unsupported workers and postMessage failures", async () => {
    const unsupported = new CalculationClient(() => { throw new Error("blocked"); });
    await expect(unsupported.calculate(cloneDesign(), new AbortController().signal)).rejects.toThrow("calculation-worker-unavailable");
    const worker = new TestWorker();
    worker.postMessage.mockImplementation(() => { throw new Error("clone failed"); });
    const client = new CalculationClient(() => worker as unknown as Worker);
    await expect(client.calculate(cloneDesign(), new AbortController().signal)).rejects.toThrow("calculation-worker-failed");
    expect(worker.terminate).toHaveBeenCalled();
  });
  it("times out a nonresponsive worker and disposes active work on unmount", async () => {
    vi.useFakeTimers();
    const {client, workers} = create();
    const timeout = client.calculate(cloneDesign(), new AbortController().signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await timeout).message).toBe("calculation-worker-timeout");
    const pending = client.calculate(cloneDesign(), new AbortController().signal).catch(error => error);
    client.cancel();
    expect((await pending).name).toBe("AbortError");
    expect(workers[1].terminate).toHaveBeenCalled();
  });
  it("rejects malformed input responses without caching them", async () => {
    const {client, workers} = create();
    const pending = client.calculate(cloneDesign(), new AbortController().signal);
    const {id, key} = workers[0].postMessage.mock.lastCall![0];
    workers[0].onmessage?.({data: {id, key, error: "invalid"}} as MessageEvent<CalculationReply>);
    await expect(pending).rejects.toThrow("calculation-invalid-input");
    expect(client.peek(key)).toBeUndefined();
  });
});
