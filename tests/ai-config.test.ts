import { describe, it, expect, vi, afterEach } from "vitest";
import {
  modelConfigSchema,
  validBaseURL,
  estimateCost,
  costCny,
  secretTarget,
  csvCell,
  beijingTime,
} from "../src/shared/ai-config";
import { providerCall } from "../worker/ai";
const cfg = modelConfigSchema.parse({
  provider: "deepseek",
  name: "test",
  model: "test",
  inputPrice: 2,
  outputPrice: 8,
  currency: "USD",
});
describe("AI billing and destinations", () => {
  it("normalizes legacy settings and restricts credential destinations", () => {
    expect(cfg.baseUrl).toBe("https://api.deepseek.com");
    for (const url of [
      "http://api.deepseek.com",
      "https://api.deepseek.com.evil.test",
      "https://user:password@api.deepseek.com",
      "https://127.0.0.1",
      "https://api.deepseek.com/chat/completions",
      "https://api.deepseek.com?key=x",
    ])
      expect(validBaseURL("deepseek", url)).toBe(false);
    expect(
      validBaseURL(
        "qwen",
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      ),
    ).toBe(true);
    expect(
      validBaseURL("openai_compatible", "https://openrouter.ai/api/v1"),
    ).toBe(true);
    expect(secretTarget(cfg)).not.toBe(
      secretTarget({ ...cfg, baseUrl: cfg.baseUrl + "/v1" }),
    );
  });
  it("never treats unknown usage, prices, plans or FX as zero", () => {
    expect(estimateCost(cfg, 1000000, 1000000)).toBe(10);
    expect(estimateCost(cfg, null, 10)).toBeNull();
    expect(estimateCost({ ...cfg, inputPrice: null }, 10, 10)).toBeNull();
    expect(
      estimateCost(
        { ...cfg, billingMode: "request", requestPrice: 0.3 },
        null,
        null,
      ),
    ).toBe(0.3);
    expect(
      estimateCost(
        { ...cfg, billingMode: "tokens_request", requestPrice: 0.3 },
        1000000,
        1000000,
      ),
    ).toBe(10.3);
    expect(estimateCost({ ...cfg, billingMode: "plan" }, 10, 10)).toBeNull();
    expect(costCny(10, "USD", null)).toBeNull();
    expect(costCny(10, "USD", 7)).toBe(70);
    expect(costCny(0, "CNY", null)).toBe(0);
  });
  it("exports safe CSV and explicit Beijing time", () => {
    expect(csvCell('=HYPERLINK("evil")')).toBe('"\'=HYPERLINK(""evil"")"');
    expect(beijingTime("2026-09-12 18:00:00")).toBe("2026-09-13 02:00:00");
    expect(beijingTime("2026-09-12T18:00:00Z")).toBe("2026-09-13 02:00:00");
  });
});
describe("native Gemini adapter, mocked transport", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses native headers and includes thinking output in billing", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: "internal" },
                  { text: '{"ok":true}' },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 3,
            thoughtsTokenCount: 5,
          },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const result = await providerCall(
      {
        ...cfg,
        provider: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      },
      "fake-key",
      [{ role: "user", content: "test" }],
    );
    expect(result).toEqual({ parsed: { ok: true }, input: 10, output: 8 });
    expect(fetcher.mock.calls[0][1].headers["x-goog-api-key"]).toBe("fake-key");
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  });
});
