import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseParameters,
  setParameter,
  parameterDisplay,
} from "../src/shared/component-parameters";
import { readPage, pageUrl, caseUrl } from "../src/shared/navigation";
import { decodeCaseCursor, encodeCaseCursor } from "../worker/case-pagination";
import { locales } from "../src/shared/model";
import { uiText } from "../src/ui-text";

describe("editable specifications", () => {
  it("preserves precision, unknown values and unrecognized keys", () => {
    const raw =
      '{"densityUwCm2":4.21160011658409,"custom":"Keep","voltage":null}';
    const changed = parseParameters(setParameter(raw, "referenceLux", 260))!;
    expect(changed.densityUwCm2).toBe(4.21160011658409);
    expect(changed.custom).toBe("Keep");
    expect(changed.voltage).toBeNull();
    expect(parameterDisplay("densityUwCm2", changed.densityUwCm2)).toBe(
      "4.21 µW/cm²",
    );
    expect(parameterDisplay("iqUa", 0.025)).toBe("25 nA");
    expect(
      parseParameters(setParameter(raw, "referenceLux", null))!.referenceLux,
    ).toBeNull();
  });
  it.each([
    "[]",
    "null",
    '{"voltage":1e999}',
    '{"nested":{}}',
    '{"mppt":true}',
    "unfinished",
  ])("rejects unsafe/unsupported parameter input %s", (raw) =>
    expect(parseParameters(raw)).toBeNull(),
  );
  it("has text for all seven locales in the changed workflows", () => {
    for (const locale of locales)
      for (const key of [
        "parameters",
        "invalidParameters",
        "copyHint",
        "linkedHint",
        "pvInput",
        "loadMore",
      ] as const)
        expect(uiText(locale, key).length).toBeGreaterThan(0);
  });
});
describe("navigation and share links", () => {
  it("preserves unrelated query state on page navigation but clears case tokens", () => {
    const url = new URL(
      "https://powermatch.zenmeasure.space/?page=hall&messages=1&case=a&revision=b#component=c",
    );
    expect(pageUrl(url, "compare")).toBe("/?page=compare&messages=1");
    expect(readPage(new URL("https://example.test/?page=untrusted"))).toBe(
      "workbench",
    );
  });
  it("shares only the case and optional revision, never auth tokens or caller parameters", () => {
    const link = new URL(
      caseUrl(
        new URL("https://powermatch.zenmeasure.space/?messages=1#token=secret"),
        "case/1",
        "rev &2",
      ),
    );
    expect([...link.searchParams.keys()]).toEqual(["page", "case", "revision"]);
    expect(link.searchParams.get("revision")).toBe("rev &2");
    expect(link.hash).toBe("");
  });
  it("round-trips stable pagination order and rejects malformed cursors", () => {
    const row = {
      official: 1,
      updated_at: "2026-10-21 10:00:00",
      id: "part-id",
    };
    expect(decodeCaseCursor(encodeCaseCursor(row))).toEqual(row);
    expect(() => decodeCaseCursor("invalid")).toThrow("invalid-cursor");
    expect(() => decodeCaseCursor(btoa('[1,{},"a"]'))).toThrow(
      "invalid-cursor",
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});
describe("API request lifecycle", () => {
  it("revalidates only the public catalog and respects body changes", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"components":[{"id":"a"}]}', {
          headers: { ETag: '"v1"' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(
        new Response('{"components":[{"id":"b"}]}', {
          headers: { ETag: '"v2"' },
        }),
      )
      .mockResolvedValueOnce(new Response('{"user":null}'));
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("../src/api");
    const first = await api("/components");
    expect(await api("/components")).toEqual(first);
    expect((await api("/components")).components[0].id).toBe("b");
    await api("/session");
    expect(fetch.mock.calls[1][1].headers["If-None-Match"]).toBe('"v1"');
    expect(fetch.mock.calls[3][1].headers).not.toHaveProperty("If-None-Match");
  });
  it.each([
    ["GET", "request-timeout"],
    ["POST", "request-timeout-outcome-unknown"],
  ])("does not silently retry %s on timeout", async (method, message) => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("../src/api");
    const pending = api(
      "/cases",
      method === "POST" ? {} : undefined,
      method,
      undefined,
      { timeoutMs: 100 },
    );
    const rejection = expect(pending).rejects.toMatchObject({
      message,
      status: 0,
    });
    await vi.advanceTimersByTimeAsync(101);
    await rejection;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("distinguishes cancellation from timeout and exposes HTTP format failures", async () => {
    const fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("../src/api");
    const controller = new AbortController();
    const pending = api("/cases", undefined, undefined, undefined, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("HTML proxy error", { status: 502 })),
    );
    await expect(api("/cases")).rejects.toMatchObject({
      status: 502,
      message: "invalid-api-response (HTTP 502)",
    });
  });
});
