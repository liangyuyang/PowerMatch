import { describe, it, expect, vi, afterEach } from "vitest";
import { applyProposal, selectComponent } from "../src/shared/assistant";
import { cloneDesign } from "../src/shared/model";
import { CATALOG } from "../src/shared/catalog";
import { calculate } from "../src/shared/engine";
import { sealSecret, openSecret } from "../worker/ai-secrets";
import { providerCall, modelConfigSchema } from "../worker/ai";
const proposal = (actions: unknown[]) => ({
  explanation: "Choose a battery.",
  actions,
  assumptions: [],
});
describe("AI design boundary", () => {
  it("resolves parts from catalog and leaves original design unchanged", () => {
    const d = cloneDesign();
    const x = applyProposal(
      d,
      proposal([
        { type: "component", id: "panasonic-cr2450" },
        { type: "set", path: "mode", value: "battery" },
      ]),
      CATALOG,
      ["load"],
    );
    expect(x.design.storage.capacityMah).toBe(620);
    expect(d.storage.capacityMah).toBe(225);
    expect(calculate(x.design).status).toBe("conditional");
    expect(x.sources[0].source).toContain("panasonic");
  });
  it("rejects fabricated specifications and identifiers", () => {
    expect(() =>
      applyProposal(
        cloneDesign(),
        proposal([{ type: "set", path: "pv.densityUwCm2", value: 20 }]),
        CATALOG,
        [],
      ),
    ).toThrow();
    expect(() =>
      applyProposal(
        cloneDesign(),
        proposal([{ type: "component", id: "imaginary" }]),
        CATALOG,
        [],
      ),
    ).toThrow("component-not-in-catalog");
  });
  it("preserves locks for both scalar and catalog updates", () => {
    expect(() =>
      applyProposal(
        cloneDesign(),
        proposal([{ type: "set", path: "light.lux", value: 500 }]),
        CATALOG,
        ["light"],
      ),
    ).toThrow("locked-parameters");
    expect(() =>
      applyProposal(
        cloneDesign(),
        proposal([{ type: "component", id: "panasonic-cr2450" }]),
        CATALOG,
        ["storage"],
      ),
    ).toThrow("locked-parameters");
  });
  it("replaces missing specifications with labeled assumptions, not the previous part values", () => {
    const d = cloneDesign();
    d.pv.densityUwCm2 = 30;
    d.pv.voltage = 3;
    const next = selectComponent(
      d,
      CATALOG.find((x) => x.id === "epishine-leh3")!,
    );
    expect(next.pv.densityUwCm2).not.toBe(30);
    expect(next.pv.voltage).not.toBe(3);
    expect(next.notes).toContain("Simulation assumptions for epishine-leh3");
    expect(calculate(next).missing).not.toContain("pv-density");
  });
  it("rejects invalid schedules and dangerous nested fields", () => {
    expect(() =>
      applyProposal(
        cloneDesign(),
        proposal([{ type: "set", path: "light.hours", value: 24 }]),
        CATALOG,
        [],
      ),
    ).toThrow();
    expect(() =>
      applyProposal(
        cloneDesign(),
        proposal([{ type: "set", path: "__proto__.admin", value: "true" }]),
        CATALOG,
        [],
      ),
    ).toThrow();
  });
  it("does not certify an incompatible primary charging design", () => {
    const input = cloneDesign();
    input.regulation.charger = true;
    const x = applyProposal(
      input,
      proposal([{ type: "set", path: "mode", value: "hybrid" }]),
      CATALOG,
      [],
    );
    expect(calculate(x.design).status).not.toBe("conditional");
  });
});
describe("AI encrypted key storage", () => {
  it("encrypts and authenticates provider identity; rejects tampering", async () => {
    const master = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
    );
    const sealed = await sealSecret(master, "test-only-key", "deepseek");
    expect(JSON.stringify(sealed)).not.toContain("test-only-key");
    expect(await openSecret(master, sealed, "deepseek")).toBe("test-only-key");
    await expect(openSecret(master, sealed, "grok")).rejects.toThrow();
    await expect(
      openSecret(
        master,
        { ...sealed, ciphertext: sealed.ciphertext.slice(4) },
        "deepseek",
      ),
    ).rejects.toThrow();
  });
});
describe("provider adapter (mock transport, not live acceptance)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const cfg = modelConfigSchema.parse({
    provider: "deepseek",
    name: "test",
    model: "test",
    inputPrice: null,
    outputPrice: null,
    currency: "CNY",
  });
  it("parses structured suggestions and usage and uses only the fixed provider host", async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          choices: [
            {
              message: { content: JSON.stringify(proposal([])) },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      );
    vi.stubGlobal("fetch", mock);
    const result = await providerCall(cfg, "not-a-real-key", []);
    expect(result.input).toBe(10);
    expect(result.output).toBe(5);
    expect(mock.mock.calls[0][0]).toBe(
      "https://api.deepseek.com/chat/completions",
    );
  });
  it("redacts provider auth errors and rejects truncated or invalid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("sensitive provider body", { status: 401 }),
        ),
    );
    await expect(providerCall(cfg, "test", [])).rejects.toThrow(
      "provider-http-401",
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            choices: [
              { message: { content: '{"ok":true}' }, finish_reason: "length" },
            ],
          }),
        ),
    );
    await expect(providerCall(cfg, "test", [])).rejects.toThrow(
      "provider-invalid-response",
    );
  });
});
