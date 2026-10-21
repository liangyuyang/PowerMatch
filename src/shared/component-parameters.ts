import type { Component } from "./model";
export function parseParameters(raw: string): Component["parameters"] | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    if (
      !Object.values(value).every(
        (v) =>
          v === null ||
          typeof v === "string" ||
          (typeof v === "number" && Number.isFinite(v)),
      )
    )
      return null;
    return value as Component["parameters"];
  } catch {
    return null;
  }
}
export function setParameter(
  raw: string,
  key: string,
  value: number | string | null,
): string {
  const parameters = parseParameters(raw);
  if (!parameters) throw new Error("invalid-parameters");
  return JSON.stringify({ ...parameters, [key]: value }, null, 2);
}
// Only established catalog keys; no manufactured specification values or defaults.
export const parameterFields: Record<string, string[]> = {
  battery: ["voltage", "capacityMah", "minVoltage", "leakUa", "esr"],
  rechargeable: [
    "voltage",
    "capacityMah",
    "minVoltage",
    "maxVoltage",
    "leakUa",
    "esr",
  ],
  lic: ["farads", "minVoltage", "maxVoltage", "leakUa", "esr"],
  supercap: ["farads", "minVoltage", "maxVoltage", "leakUa", "esr"],
  pv: ["chemistry", "areaCm2", "referenceLux", "densityUwCm2", "voltage"],
  ldo: ["iqUa", "inputMin", "inputMax", "dropout"],
  pmic: [
    "iqUa",
    "inputMin",
    "inputMax",
    "efficiency",
    "harvestEfficiency",
    "mppt",
    "charger",
  ],
  display: ["productVoltage", "minVoltage", "maxVoltage"],
};
export const parameterUnits: Record<string, string> = {
  voltage: "V",
  minVoltage: "V",
  maxVoltage: "V",
  inputMin: "V",
  inputMax: "V",
  productVoltage: "V",
  dropout: "V",
  capacityMah: "mAh",
  farads: "F",
  leakUa: "µA",
  iqUa: "µA",
  esr: "Ω",
  areaCm2: "cm²",
  referenceLux: "lux",
  densityUwCm2: "µW/cm²",
};
export function parameterDisplay(key: string, value: string | number | null) {
  if (value === null) return "—";
  if (typeof value !== "number") return value;
  const nano =
    (key === "iqUa" || key === "leakUa") && value !== 0 && Math.abs(value) < 1;
  return `${Number((nano ? value * 1000 : value).toFixed(2))}${nano ? " nA" : parameterUnits[key] ? " " + parameterUnits[key] : ""}`;
}
