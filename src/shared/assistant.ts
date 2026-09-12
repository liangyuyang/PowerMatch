import { z } from "zod";
import {
  cloneDesign,
  changeStorage,
  designSchema,
  type Design,
  type Component,
} from "./model";

export const lockGroups = [
  "load",
  "light",
  "pv",
  "storage",
  "regulation",
  "mode",
  "path",
] as const;
export type LockGroup = (typeof lockGroups)[number];
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("component"), id: z.string().max(100) }).strict(),
  z
    .object({
      type: z.literal("set"),
      path: z.enum([
        "mode",
        "path",
        "light.source",
        "light.lux",
        "light.days",
        "light.hours",
        "light.startHour",
        "light.angle",
        "pv.areaCm2",
        "storage.series",
        "storage.parallel",
        "horizonDays",
        "margin",
      ]),
      value: z.union([z.string().max(40), z.number().finite()]),
    })
    .strict(),
]);
export const proposalSchema = z
  .object({
    explanation: z.string().min(1).max(6000),
    actions: z.array(actionSchema).max(16),
    assumptions: z.array(z.string().max(500)).max(12),
  })
  .strict();
export type Proposal = z.infer<typeof proposalSchema>;

// Missing catalog facts remain unchanged in the catalog; the design gets labeled simulation assumptions.
export function selectComponent(input: Design, c: Component): Design {
  const n = cloneDesign(input),
    p = c.parameters;
  const num = (key: string) =>
    typeof p[key] === "number" ? (p[key] as number) : null;
  if (
    ["battery", "lic", "supercapacitor", "supercap", "rechargeable"].includes(
      c.category,
    )
  ) {
    const kind =
      c.category === "battery"
        ? "primary"
        : c.category === "lic"
          ? "lic"
          : c.category === "rechargeable"
            ? "rechargeable"
            : "supercap";
    n.storage = {
      ...n.storage,
      kind,
      componentId: c.id,
      series: 1,
      parallel: 1,
      voltage: num("voltage"),
      capacityMah: num("capacityMah"),
      farads: num("farads"),
      minVoltage: num("minVoltage"),
      maxVoltage: num("maxVoltage") ?? num("voltage"),
      leakUa: num("leakUa"),
      esr: num("esr"),
    };
    // Primary-cell self discharge is not modeled by the existing engine.
    if (kind === "primary") n.storage.leakUa = 0;
  } else if (c.category === "pv") {
    n.pv = {
      ...n.pv,
      componentId: c.id,
      densityUwCm2: num("densityUwCm2"),
      voltage: num("voltage"),
      referenceLux: num("referenceLux") ?? n.pv.referenceLux,
      areaCm2: num("areaCm2") ?? n.pv.areaCm2,
    };
  } else if (["ldo", "pmic"].includes(c.category)) {
    n.path = c.category === "ldo" ? "ldo" : "converter";
    n.regulation = {
      ...n.regulation,
      componentId: c.id,
      iqUa: num("iqUa"),
      mppt: String(p.mppt).toLowerCase() === "yes",
      charger: String(p.charger).toLowerCase() === "yes",
      dropout: num("dropout") ?? n.regulation.dropout,
      efficiency: num("efficiency") ?? n.regulation.efficiency,
      harvestEfficiency:
        num("harvestEfficiency") ?? n.regulation.harvestEfficiency,
    };
  } else throw new Error("component-category-unsupported");
  const fallback = c.category === "pv" ? cloneDesign().pv : ["ldo","pmic"].includes(c.category) ? {...cloneDesign().regulation, iqUa: c.category === "pmic" ? 0.5 : 0.025} : changeStorage(cloneDesign(),n.storage.kind).storage;
  const group = c.category === "pv" ? "pv" : ["ldo","pmic"].includes(c.category) ? "regulation" : "storage";
  const assumed:string[]=[];
  for(const [key,value] of Object.entries(fallback)) {
    if ((n[group] as any)[key] === null && value !== null) { (n[group] as any)[key]=value; assumed.push(`${group}.${key}=${value}`); }
  }
  if(assumed.length) n.notes = (n.notes + `\n演算假设 / Simulation assumptions for ${c.id} (not manufacturer specs): ${assumed.join(", ")}`).slice(-5000);
  return n;
}

export function changesBetween(
  a: unknown,
  b: unknown,
  prefix = "",
): { path: string; before: unknown; after: unknown }[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  )
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
      changesBetween(
        (a as any)[key],
        (b as any)[key],
        prefix ? `${prefix}.${key}` : key,
      ),
    );
  return [{ path: prefix, before: a, after: b }];
}

export function applyProposal(
  input: Design,
  raw: unknown,
  catalog: Component[],
  locks: readonly LockGroup[],
) {
  const proposal = proposalSchema.parse(raw);
  let next = cloneDesign(input);
  const sources: Component[] = [];
  for (const action of proposal.actions) {
    if (action.type === "component") {
      const c = catalog.find((c) => c.id === action.id);
      if (!c) throw new Error("component-not-in-catalog");
      next = selectComponent(next, c);
      sources.push(c);
    } else {
      const [group, key] = action.path.split(".");
      if (key) (next as any)[group][key] = action.value;
      else (next as any)[group] = action.value;
    }
  }
  next = designSchema.parse(next);
  const changes = changesBetween(input, next);
  if (changes.some((c) => locks.includes(c.path.split(".")[0] as LockGroup)))
    throw new Error("locked-parameters");
  return {
    proposal,
    design: next,
    changes,
    sources: [...new Map(sources.map((c) => [c.id, c])).values()],
  };
}
