import { describe, it, expect } from "vitest";
import { calculate, darkCoverage, isLit, longestDark } from "../src/shared/engine";
import {
  changeMode,
  changeStorage,
  cloneDesign,
  chooseLocale,
  employeeEmail,
  publicName,
} from "../src/shared/model";
import { canReadCase, canEditCase, toViewer } from "../worker/security";
import { extractCandidates } from "../src/shared/spec-parser";
describe("physical model", () => {
  it("keeps the Tiny duty-cycle result separate from the 11+ estimate", () => {
    const r = calculate(cloneDesign());
    expect(r.averageUa).toBeCloseTo(13.235294, 5);
    expect(r.loadUw).toBeCloseTo(19.852941, 5);
    expect(r.status).not.toBe("incomplete");
    expect(r.runtimeHours).toBe(10);
  });
  it("models the 62 h weekend darkness and 50 h lit week", () => {
    const d = cloneDesign();
    expect(longestDark(d)).toBe(62);
    expect(
      Array.from({ length: 168 }, (_, h) => isLit(d, h)).filter(Boolean),
    ).toHaveLength(50);
    expect(isLit(d, 9)).toBe(true);
    expect(isLit(d, 10)).toBe(false);
  });
  it("agrees with analytic constant-current battery life", () => {
    const d = cloneDesign();
    d.mode = "battery";
    d.storage.capacityMah = 1;
    const r = calculate(d);
    expect(r.runtimeHours).toBeCloseTo(
      1000 / (r.averageUa + d.regulation.iqUa!),
      5,
    );
    expect(Math.abs(r.energy.balanceErrorJ)).toBeLessThan(1e-8);
  });
  it("parallel batteries double lifetime; series does not for an LDO", () => {
    const d = cloneDesign();
    d.mode = "battery";
    d.storage.capacityMah = 1;
    const a = calculate(d).runtimeHours!;
    d.storage.parallel = 2;
    expect(calculate(d).runtimeHours!).toBeCloseTo(a * 2, 5);
    d.storage.parallel = 1;
    d.storage.series = 2;
    expect(calculate(d).runtimeHours!).toBeCloseTo(a, 5);
  });
  it("never charges primary batteries", () => {
    const d = cloneDesign();
    d.mode = "hybrid";
    d.regulation.charger = true;
    expect(calculate(d).errors).toContain("primary-no-charge");
  });
  it("rejects raw 3 V directly connected to Tiny", () => {
    const d = cloneDesign();
    d.mode = "battery";
    d.path = "direct";
    expect(calculate(d).status).toBe("incompatible");
  });
  it.each(["battery", "pv", "hybrid"] as const)(
    "ignores absent regulator consumption and losses for direct %s supply",
    (mode) => {
      // Synthetic valid direct circuit for dependency testing, not a Tiny specification.
      const d = cloneDesign();
      d.device = "custom";
      d.mode = mode;
      d.path = "direct";
      d.load.voltage = 3;
      d.load.minVoltage = 2.5;
      d.load.maxVoltage = 4;
      d.pv.voltage = 3;
      d.pv.densityUwCm2 = 7;
      d.regulation.iqUa = 0;
      const baseline = calculate(d);
      expect(baseline.status).toBe("conditional");
      expect(Math.abs(baseline.energy.balanceErrorJ)).toBeLessThan(1e-6);
      if (mode === "battery")
        expect(baseline.batteryEstimateHours).toBeCloseTo(17000, 5);
      else {
        expect(baseline.requiredAreaCm2).toBeGreaterThan(0);
        const expectedGeneration =
          d.pv.densityUwCm2 * d.pv.areaCm2 * d.light.lux /
          d.pv.referenceLux * d.pv.utilization / 1e6 *
          d.light.hours * d.light.days * 3600;
        expect(baseline.generationWeekJ).toBeCloseTo(expectedGeneration, 8);
      }
      for (const iq of [100, null]) {
        d.regulation.iqUa = iq;
        expect(calculate(d)).toEqual(baseline);
      }
      d.regulation.dropout = 5;
      d.regulation.efficiency = 0.01;
      d.regulation.harvestEfficiency = 0.01;
      expect(calculate(d)).toEqual(baseline);
    },
  );
  it("ignores inactive regulator current during direct capacitor discharge and peak checks", () => {
    const d = changeStorage(cloneDesign(), "lic");
    d.device = "custom";
    d.mode = "battery";
    d.path = "direct";
    d.load.voltage = 3;
    d.load.minVoltage = 2.5;
    d.load.maxVoltage = 4;
    d.regulation.charger = false;
    d.regulation.mppt = false;
    d.regulation.iqUa = 0;
    const baseline = calculate(d);
    expect(baseline.status).toBe("conditional");
    expect(baseline.darkHours).not.toBeNull();
    expect(Math.abs(baseline.energy.balanceErrorJ)).toBeLessThan(1e-6);
    d.regulation.iqUa = 100000;
    expect(calculate(d)).toEqual(baseline);
  });
  it.each(["ldo", "converter"] as const)(
    "retains quiescent current consumption when a %s exists",
    (path) => {
      const d = cloneDesign();
      d.mode = "battery";
      d.path = path;
      d.regulation.iqUa = 0;
      const baseline = calculate(d);
      d.regulation.iqUa = 100;
      const withIq = calculate(d);
      expect(withIq.status).toBe("conditional");
      expect(withIq.batteryEstimateHours!).toBeLessThan(baseline.batteryEstimateHours!);
      expect(withIq.energy.consumedJ).toBeGreaterThan(baseline.energy.consumedJ);
      expect(Math.abs(withIq.energy.balanceErrorJ)).toBeLessThan(1e-6);
    },
  );
  it("does not let an LDO or direct wire claim MPPT or charging capability", () => {
    const d = cloneDesign();
    d.regulation.mppt = true;
    expect(calculate(d).errors).toContain("mppt-requires-harvester");
    d.regulation.mppt = false;
    d.regulation.charger = true;
    expect(calculate(d).errors).toContain("charger-requires-converter");
  });
  it("matches capacitor constant-current discharge within one integration step", () => {
    const d = cloneDesign();
    d.mode = "battery";
    d.storage = {
      ...d.storage,
      kind: "lic",
      farads: 1,
      maxVoltage: 3.8,
      minVoltage: 2.5,
      leakUa: 0,
      esr: 0,
    };
    const r = calculate(d);
    const expected = 1.3 / ((r.averageUa + d.regulation.iqUa!) * 1e-6) / 3600;
    expect(Math.abs(r.runtimeHours! - expected)).toBeLessThan(1 / 60);
    expect(Math.abs(r.energy.balanceErrorJ)).toBeLessThan(1e-8);
  });
  it("does not calculate a zero placeholder MHO load or unknown PMIC current", () => {
    const d = cloneDesign();
    d.mode = "battery";
    d.device = "MHO-C404";
    d.load.phases = [{ name: "Unconfirmed", seconds: 1, currentUa: 0 }];
    expect(calculate(d).missing).toContain("load-profile");
    d.device = "custom";
    d.regulation.iqUa = null;
    expect(calculate(d).missing).toContain("regulator-iq");
  });
  it("reports a horizon lower bound instead of infinite runtime", () => {
    const d = cloneDesign();
    d.mode = "battery";
    const r = calculate(d);
    expect(r.runtimeHours).toBeNull();
    expect(r.batteryEstimateHours).toBeCloseTo(
      225000 / (r.averageUa + d.regulation.iqUa!),
      5,
    );
    expect(r.warnings).toContain("horizon-lower-bound");
  });
  it("conserves energy with harvest, losses and curtailment", () => {
    const d = cloneDesign();
    d.mode = "hybrid";
    d.pv.densityUwCm2 = 50;
    d.pv.voltage = 3;
    const r = calculate(d);
    expect(r.energy.curtailedJ).toBeGreaterThan(0);
    expect(Math.abs(r.energy.balanceErrorJ)).toBeLessThan(1e-6);
    expect(r.energy.finalJ).toBeLessThanOrEqual(r.energy.initialJ);
  });
  it("blocks invalid numbers and overlapping daily schedules", () => {
    const d = cloneDesign();
    d.light.hours = 20;
    expect(() => calculate(d)).toThrow();
    d.light.hours = 10;
    d.load.phases[0].currentUa = NaN;
    expect(() => calculate(d)).toThrow();
  });
});
describe("dark-period coverage", () => {
  it("does not infer 62-hour coverage from a one-day LIC simulation", () => {
    const d = changeMode(cloneDesign(), "hybrid");
    d.horizonDays = 1;
    const short = calculate(d);
    expect(short.status).toBe("conditional");
    expect(short.longestDarkHours).toBe(62);
    expect(short.darkHours).toBeNull();
    expect(darkCoverage(short, d.horizonDays)).toBe("unproven");
    for (const days of [3, 30]) {
      d.horizonDays = days;
      const longer = calculate(d);
      expect(longer.darkHours).toBeCloseTo(31.640007, 5);
      expect(darkCoverage(longer, days)).toBe("shortfall");
    }
  });
  it("uses the simulated lower bound and accepts equality with the target", () => {
    const result = { status: "conditional" as const, darkHours: null, longestDarkHours: 62 };
    expect(darkCoverage(result, 1)).toBe("unproven");
    expect(darkCoverage(result, 3)).toBe("covered");
    expect(darkCoverage({ ...result, longestDarkHours: 24 }, 1)).toBe("covered");
    expect(darkCoverage({ ...result, darkHours: 61.99 }, 3)).toBe("shortfall");
    expect(darkCoverage({ ...result, darkHours: 62 }, 3)).toBe("covered");
    expect(darkCoverage({ ...result, darkHours: 63 }, 3)).toBe("covered");
    expect(darkCoverage({ ...result, darkHours: 0 }, 3)).toBe("shortfall");
    expect(darkCoverage({ ...result, darkHours: 0, longestDarkHours: 0 }, 3)).toBe("covered");
  });
  it("does not claim coverage for invalid or uncalculated results", () => {
    const result = { status: "conditional" as const, darkHours: null, longestDarkHours: 62 };
    expect(darkCoverage({ ...result, status: "incomplete" }, 30)).toBe("unproven");
    expect(darkCoverage({ ...result, status: "incompatible" }, 30)).toBe("unproven");
    for (const horizon of [0, -1, NaN, Infinity])
      expect(darkCoverage(result, horizon)).toBe("unproven");
    expect(darkCoverage({ ...result, darkHours: NaN }, 30)).toBe("unproven");
    expect(darkCoverage({ ...result, longestDarkHours: -1 }, 30)).toBe("unproven");
  });
});
describe("datasheet candidates", () => {
  it("retains competing values and evidence rather than selecting a specification silently", () => {
    const candidates = extractCandidates(
      "CR2032 capacity 225 mAh. Another model 620 mAh. Quiescent current 0.025 uA.",
    );
    expect(
      candidates
        .filter((c) => c.parameter === "capacityMah")
        .map((c) => c.value),
    ).toEqual([225, 620]);
    expect(candidates.find((c) => c.parameter === "iqUa")?.value).toBe(0.025);
    expect(candidates[0].excerpt).toContain("CR2032");
  });
});
describe("language and identity", () => {
  it("honors manual choices and ordered browser language fallbacks", () => {
    expect(chooseLocale("de", ["zh-CN"])).toBe("de");
    expect(chooseLocale("auto", ["pt-BR", "ja-JP"])).toBe("ja");
    expect(chooseLocale(null, ["xx"])).toBe("en");
  });
  it("requires exact company domains", () => {
    expect(employeeEmail("a@ZENMEASURE.COM")).toBe(true);
    expect(employeeEmail("a@zenmeasure.com.evil.test")).toBe(false);
    expect(employeeEmail("a@notzenmeasure.com")).toBe(false);
    expect(publicName("patrick@miaomiaoce.com")).toBe("Patrick");
  });
  it("checks server-side role, ownership and guest capability", () => {
    const user = toViewer({
      id: "a",
      email: "a@zenmeasure.com",
      locale: "zh",
      posts_count: 201,
    });
    expect(user.level).toBe(3);
    expect(user.admin).toBe(false);
    expect(canReadCase({ scope: "private", owner_id: "b" }, user, "")).toBe(
      false,
    );
    expect(canReadCase({ scope: "company", owner_id: "b" }, user, "")).toBe(
      true,
    );
    expect(
      canEditCase({ owner_id: null, guest_hash: "secret" }, null, ""),
    ).toBe(false);
    expect(canEditCase({ owner_id: "a", official: 1 }, user, "")).toBe(false);
  });
});
