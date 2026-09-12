import { z } from "zod";
const finite = (min: number, max: number) =>
  z.number().finite().min(min).max(max);
const optional = (min: number, max: number) => finite(min, max).nullable();
export const phaseSchema = z.object({
  name: z.string().trim().min(1).max(60),
  seconds: finite(0.001, 86400),
  currentUa: finite(0, 1e7),
});
export const designSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    device: z.enum(["MOT-U125", "MHO-C404", "custom"]),
    load: z
      .object({
        voltage: finite(0.1, 48),
        minVoltage: finite(0.1, 48),
        maxVoltage: finite(0.1, 60),
        phases: z.array(phaseSchema).min(1).max(20),
      })
      .refine(
        (x) => x.minVoltage <= x.voltage && x.voltage <= x.maxVoltage,
        "load-voltage-range",
      ),
    mode: z.enum(["battery", "pv", "hybrid"]),
    path: z.enum(["ldo", "converter", "direct"]),
    light: z
      .object({
        source: z.enum([
          "office",
          "home",
          "led-warm",
          "led-neutral",
          "led-cool",
          "daylight",
        ]),
        lux: finite(0, 100000),
        days: finite(0, 7).int(),
        hours: finite(0, 24),
        startHour: finite(0, 24),
        angle: finite(0, 90),
        planeMeasured: z.boolean(),
      })
      .refine((x) => x.startHour + x.hours <= 24, "schedule-crosses-midnight"),
    pv: z.object({
      componentId: z.string().max(100),
      areaCm2: finite(0.01, 1e5),
      referenceLux: finite(1, 100000),
      densityUwCm2: optional(0.001, 1e5),
      voltage: optional(0.1, 60),
      utilization: finite(0.01, 1),
    }),
    storage: z.object({
      kind: z.enum(["primary", "rechargeable", "lic", "supercap"]),
      componentId: z.string().max(100),
      series: finite(1, 16).int(),
      parallel: finite(1, 16).int(),
      voltage: optional(0.1, 48),
      capacityMah: optional(0.001, 1e7),
      farads: optional(0.000001, 1e5),
      maxVoltage: optional(0.1, 48),
      minVoltage: optional(0.01, 48),
      initialPercent: finite(0, 100),
      leakUa: optional(0, 1e6),
      esr: optional(0, 1e5),
    }),
    regulation: z.object({
      componentId: z.string().max(100),
      iqUa: optional(0, 1e5),
      dropout: finite(0, 5),
      efficiency: finite(0.01, 1),
      harvestEfficiency: finite(0.01, 1),
      mppt: z.boolean(),
      charger: z.boolean(),
    }),
    horizonDays: finite(1, 365).int(),
    margin: finite(0, 100),
    notes: z.string().max(5000),
  })
  .superRefine((x, c) => {
    if (
      x.storage.maxVoltage !== null &&
      x.storage.minVoltage !== null &&
      x.storage.minVoltage >= x.storage.maxVoltage
    )
      c.addIssue({
        code: "custom",
        path: ["storage", "minVoltage"],
        message: "storage-voltage-range",
      });
  });
export type Design = z.infer<typeof designSchema>;
export type Locale = "zh" | "en" | "ja" | "ko" | "es" | "fr" | "de";
export type Scope = "public" | "company" | "private";
export const locales: Locale[] = ["zh", "en", "ja", "ko", "es", "fr", "de"];
export interface Viewer {
  id: string;
  name: string;
  email: string;
  employee: boolean;
  admin: boolean;
  locale: Locale;
  localeMode?: "auto" | "manual";
  level: number;
}
export interface Component {
  id: string;
  name: string;
  category: string;
  manufacturer: string;
  official: boolean;
  source: string;
  description: string;
  parameters: Record<string, number | string | null>;
  verified: boolean;
}
export const DEFAULT_DESIGN: Design = {
  name: "穿山甲Tiny · 光伏改型",
  device: "MOT-U125",
  load: {
    voltage: 1.5,
    minVoltage: 1.2,
    maxVoltage: 1.65,
    phases: [
      { name: "Sleep", seconds: 9, currentUa: 3 },
      { name: "Active", seconds: 1.2, currentUa: 90 },
    ],
  },
  mode: "pv",
  path: "ldo",
  light: {
    source: "office",
    lux: 260,
    days: 5,
    hours: 10,
    startHour: 9,
    angle: 0,
    planeMeasured: false,
  },
  pv: {
    componentId: "powerfilm-ll200-24-75",
    areaCm2: 68.62,
    referenceLux: 200,
    densityUwCm2: 289 / 68.62,
    voltage: 1.6,
    utilization: 0.7,
  },
  storage: {
    kind: "primary",
    componentId: "panasonic-cr2032",
    series: 1,
    parallel: 1,
    voltage: 3,
    capacityMah: 225,
    farads: null,
    maxVoltage: 3,
    minVoltage: 2,
    initialPercent: 100,
    leakUa: 0,
    esr: 20,
  },
  regulation: {
    componentId: "tps7a02",
    iqUa: 0.025,
    dropout: 0.1,
    efficiency: 0.8,
    harvestEfficiency: 0.8,
    mppt: false,
    charger: false,
  },
  horizonDays: 30,
  margin: 20,
  notes:
    "MOT-U125: 11+ µA is an engineering estimate. Timing model: 13.2353 µA. 150 lux is a prior test observation, not a universal threshold. Internal IC and original LR41 ×2 wiring are unconfirmed. 演算假设 / Simulation assumptions: battery ESR 20 ohm; regulator dropout 0.1 V; conversion/harvest efficiency 80%; non-MPPT utilization 70%. Validate at actual operating conditions. PowerFilm 200 lux power density uses module footprint, not active cell area.",
};
export function cloneDesign(d: Design = DEFAULT_DESIGN): Design {
  return structuredClone(d);
}
export function publicName(email: string) {
  const local = email.split("@")[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}
export function employeeEmail(email: string) {
  return ["miaomiaoce.com", "zenmeasure.com", "zenmeasure.space"].includes(
    email.toLowerCase().split("@")[1],
  );
}
export function chooseLocale(
  preference: string | null,
  languages: readonly string[],
): Locale {
  if (preference && locales.includes(preference as Locale))
    return preference as Locale;
  for (const language of languages) {
    const code = language.toLowerCase().split("-")[0];
    if (locales.includes(code as Locale)) return code as Locale;
  }
  return "en";
}
export function changeStorage(
  d: Design,
  kind: Design["storage"]["kind"],
): Design {
  const next = cloneDesign(d);
  next.storage =
    kind === "primary"
      ? cloneDesign().storage
      : kind === "rechargeable"
        ? {
            kind,
            componentId: "assumed-li-ion-40mah",
            series: 1,
            parallel: 1,
            voltage: 3.7,
            capacityMah: 40,
            farads: null,
            maxVoltage: 4.2,
            minVoltage: 3,
            initialPercent: 100,
            leakUa: 1,
            esr: 1,
          }
        : {
            kind,
            componentId: kind === "lic" ? "assumed-lic-1f" : "capxx-edlc1",
            series: 1,
            parallel: 1,
            voltage: kind === "lic" ? 3.8 : 2.7,
            capacityMah: null,
            farads: 1,
            maxVoltage: kind === "lic" ? 3.8 : 2.7,
            minVoltage: kind === "lic" ? 2.5 : 1.6,
            initialPercent: 100,
            leakUa: kind === "lic" ? 3 : 2,
            esr: kind === "lic" ? 1 : 0.25,
          };
  if (next.mode === "hybrid" || kind !== "primary") {
    next.regulation.charger = kind !== "primary";
    if (kind !== "primary") {
      next.regulation = { ...next.regulation, componentId: "assumed-harvester-regulator", iqUa: 0.5, efficiency: 0.8, harvestEfficiency: 0.8, mppt: true, charger: true };
      next.path = "converter";
    }
  }
  return next;
}

export function changeMode(d: Design, mode: Design["mode"]): Design {
  const n = cloneDesign(d);
  n.mode = mode;
  if (mode === "hybrid") return changeStorage(n, "lic");
  n.path = "ldo";
  n.regulation = cloneDesign().regulation;
  if (mode === "battery") n.storage = cloneDesign().storage;
  return n;
}
