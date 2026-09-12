import { describe, it, expect, vi, afterEach } from "vitest";
import { providerCall, modelConfigSchema } from "../worker/ai";
import { diagnosticFor, redact } from "../src/shared/ai-diagnostic";
import { parseDeepSeekPricing, readPrices } from "../worker/ai-pricing";
const config = modelConfigSchema.parse({
  provider: "deepseek",
  name: "test",
  model: "test-model",
  inputPrice: null,
  outputPrice: null,
  currency: "CNY",
});
const html = `<table><tr><td colspan="3">模型</td><td>other</td><td>test-model<sup>(2)</sup></td></tr><tr><td rowspan="6">价格</td><td rowspan="2">百万tokens输入（缓存命中）</td><td>空闲时段</td><td>0.01元</td><td>0.1元</td></tr><tr><td>高峰时段</td><td>0.02元</td><td>0.2元</td></tr><tr><td rowspan="2">百万tokens输入（缓存未命中）</td><td>空闲时段</td><td>1元</td><td>3元</td></tr><tr><td>高峰时段</td><td>2元</td><td>6元</td></tr><tr><td rowspan="2">百万tokens输出</td><td>空闲时段</td><td>4元</td><td>5元</td></tr><tr><td>高峰时段</td><td>8元</td><td>10元</td></tr></table>`;
describe("read official pricing without guessing", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("matches exact model column, merged cells, cache and peak tiers", () => {
    const x = parseDeepSeekPricing(html, "test-model");
    expect(
      x.map((p) => [
        p.label,
        p.inputPrice,
        p.outputPrice,
        p.cacheHitPrice,
        p.currency,
      ]),
    ).toEqual([
      ["空闲时段", 3, 5, 0.1, "CNY"],
      ["高峰时段", 6, 10, 0.2, "CNY"],
    ]);
    expect(() => parseDeepSeekPricing(html, "test")).toThrow(
      "price-model-not-found",
    );
    expect(() =>
      parseDeepSeekPricing(html.replace("3元", "待定"), "test-model"),
    ).toThrow("price-format-unsupported");
  });
  it("rejects private addresses, unexpected provider, and offsite redirects before sending credentials", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1" },
      }),
    );
    vi.stubGlobal("fetch", f);
    await expect(
      readPrices("deepseek", "test-model", "http://127.0.0.1"),
    ).rejects.toThrow("price-source-unsupported");
    expect(f).not.toHaveBeenCalled();
    await expect(
      readPrices(
        "deepseek",
        "test-model",
        "https://api-docs.deepseek.com/quick_start/pricing/",
      ),
    ).rejects.toThrow("price-redirect-rejected");
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
  it("returns source and parsed options from a supported document", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(html)));
    const r = await readPrices(
      "deepseek",
      "test-model",
      "https://api-docs.deepseek.com/quick_start/pricing/",
    );
    expect(r.options).toHaveLength(2);
    expect(r.source).toContain("api-docs.deepseek.com");
  });
});
describe("actionable provider diagnostics", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("separates MiniMax thinking and refuses to parse arbitrary prose", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          choices: [
            {
              message: {
                content: '<think>private analysis</think>\n{"ok":true}',
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", f);
    expect(
      (
        await providerCall(
          {
            ...config,
            provider: "minimax",
            baseUrl: "https://api.minimaxi.com/v1",
          },
          "fake",
          [],
        )
      ).parsed,
    ).toEqual({ ok: true });
    expect(JSON.parse(f.mock.calls[0][1].body).reasoning_split).toBe(true);
  });
  it("detects MiMo plan endpoint mismatch before sending a request and uses native auth header", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }),
      );
    vi.stubGlobal("fetch", f);
    const mimo = {
      ...config,
      provider: "mimo" as const,
      baseUrl: "https://api.xiaomimimo.com/v1",
    };
    await expect(providerCall(mimo, "tp-fake", [])).rejects.toThrow(
      "provider-plan-endpoint-mismatch",
    );
    expect(f).not.toHaveBeenCalled();
    await providerCall(
      { ...mimo, baseUrl: "https://token-plan-cn.xiaomimimo.com/v1" },
      "tp-fake",
      [],
    );
    expect(f.mock.calls[0][1].headers["api-key"]).toBe("tp-fake");
  });
  it("uses Workers-compatible redirect mode and never forwards a key to redirect destinations", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 307,
        headers: { location: "https://untrusted.example/key-collector" },
      }),
    );
    vi.stubGlobal("fetch", f);
    await expect(providerCall(config, "private-key", [])).rejects.toThrow(
      "provider-redirect-rejected",
    );
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][1].redirect).toBe("manual");
  });
  it("preserves HTTP, vendor code and request ID but redacts the exact credential", async () => {
    const key = "private-test-credential";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "invalid_api_key",
              message: `Invalid ${key} Bearer ${key}`,
            },
          },
          { status: 401, headers: { "x-request-id": "request-123" } },
        ),
      ),
    );
    try {
      await providerCall(config, key, []);
      throw Error("expected failure");
    } catch (e) {
      const d = diagnosticFor(e, "request");
      expect(d.httpStatus).toBe(401);
      expect(d.providerCode).toBe("invalid_api_key");
      expect(d.requestId).toBe("request-123");
      expect(JSON.stringify(d)).not.toContain(key);
      expect(d.code).toBe("provider-http-401");
    }
  });
  it("separates network, timeout, response JSON, and credential-stage failures", async () => {
    expect(
      diagnosticFor(new DOMException("timed out", "TimeoutError"), "request")
        .code,
    ).toBe("provider-timeout");
    expect(diagnosticFor(new TypeError("fetch failed"), "request").code).toBe(
      "provider-network-error",
    );
    expect(
      diagnosticFor(new Error("ciphertext secret"), "key").message,
    ).not.toContain("ciphertext secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>secret content</html>", {
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    try {
      await providerCall(config, "fake", []);
      throw Error("expected failure");
    } catch (e) {
      const d = diagnosticFor(e, "request");
      expect(d.code).toBe("provider-response-not-json");
      expect(d.httpStatus).toBe(200);
      expect(d.message).not.toContain("secret content");
    }
    expect(redact("sk-abc123 api_key=abcdef")).not.toContain("abcdef");
  });
});
