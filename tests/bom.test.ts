import { describe, expect, it } from "vitest";
import { BOM_NOTICE, bomCSV, buildBOM } from "../src/shared/bom";
import { cloneDesign, type Design } from "../src/shared/model";
function pinned(group: "pv" | "storage" | "regulation" = "pv") {
  const design = cloneDesign();
  design.mode = "hybrid";
  const version = "immutable-v1";
  design.componentVersions = { [group]: version };
  design.componentEvidence = {
    [group]: {
      id: design[group].componentId,
      name: "Original component",
      manufacturer: "Original manufacturer",
      source: "https://example.test/original.pdf",
      parameters: { areaCm2: design.pv.areaCm2, voltage: 3, capacityMah: 225 },
      adoptedSpec: "original-spec",
      versionId: version,
      recordedAt: "2026-09-12",
      origin: "spec-review:1",
      specSha256: "a".repeat(64),
      specFilename: "original.pdf",
      reviewId: "review-v1",
      reviewRevision: 1,
      fieldEvidence: [
        {
          parameter: "voltage",
          value: 3,
          unit: "V",
          page: 4,
          excerpt: "Rated voltage 3 V",
          conditions: "25 C; rated load",
          method: "manual",
        },
      ],
    },
  };
  return design;
}
function parseCSV(csv: string) {
  const rows: string[][] = [],
    row: string[] = [];
  let value = "",
    quoted = false;
  for (let i = 1; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if (c === "\r" && csv[i + 1] === "\n" && !quoted) {
      row.push(value);
      rows.push([...row]);
      row.length = 0;
      value = "";
      i++;
    } else value += c;
  }
  return rows
    .map((values, index) =>
      index
        ? Object.fromEntries(rows[0].map((key, i) => [key, values[i]]))
        : null,
    )
    .slice(1) as Record<string, string>[];
}
describe("traceable component selection BOM", () => {
  it.each([
    ["battery", "ldo", ["storage", "regulation"]],
    ["battery", "direct", ["storage"]],
    ["pv", "converter", ["pv", "regulation"]],
    ["pv", "direct", ["pv"]],
    ["hybrid", "ldo", ["pv", "storage", "regulation"]],
    ["hybrid", "direct", ["pv", "storage"]],
  ] as const)("filters active parts for %s/%s", (mode, path, groups) => {
    const design = cloneDesign();
    design.mode = mode;
    design.path = path;
    expect(buildBOM(design).map((row) => row.group)).toEqual(groups);
  });
  it("counts series/parallel storage units and one regulator selection while keeping unknown pins/topology explicit", () => {
    const design = pinned("storage");
    design.storage.series = 2;
    design.storage.parallel = 3;
    const rows = buildBOM(design),
      storage = rows.find((row) => row.group === "storage")!,
      regulator = rows.find((row) => row.group === "regulation")!;
    expect(storage.quantity).toBe(6);
    expect(storage.quantityUnit).toBe("pcs");
    expect(regulator.quantity).toBe(1);
    expect(regulator.name).toBe("unknown");
    expect(regulator.pinInformation).toBe("unknown");
    expect(regulator.circuitTopology).toBe("unknown");
    expect(regulator.notice).toBe(BOM_NOTICE);
    expect(regulator.designParameters.dropout).toBe(design.regulation.dropout);
    expect(regulator.notice).toContain("resistor/capacitor");
  });
  it("does not convert a changed PV simulation area into a purchasable module count", () => {
    const design = pinned();
    expect(buildBOM(design)[0].quantity).toBe(1);
    design.pv.areaCm2 *= 2;
    const row = buildBOM(design)[0];
    expect(row.quantity).toBeNull();
    expect(row.designAreaCm2).toBe(137.24);
    expect(row.sourceAreaCm2).toBe(68.62);
    expect(row.quantityUnit).toBe("pcs");
    expect(row.quantityNote).toContain("confirmation");
    delete design.componentEvidence;
    expect(buildBOM(design)[0].quantity).toBeNull();
  });
  it("keeps old snapshot facts and exact source evidence separate from changed current inputs", () => {
    const design = pinned();
    design.pv.voltage = 4.2;
    const before = JSON.stringify(design),
      row = buildBOM(design)[0];
    expect(row.name).toBe("Original component");
    expect(row.designParameters.voltage).toBe(4.2);
    expect(row.sourceParameters?.voltage).toBe(3);
    expect(row.sourceVersion).toBe("immutable-v1");
    expect(row.source).toBe("https://example.test/original.pdf");
    expect(row.specSha256).toBe("a".repeat(64));
    expect(row.sourcePages).toBe("voltage: 4");
    expect(row.testConditions).toBe("voltage: 25 C; rated load");
    expect(row.fieldEvidence[0].excerpt).toBe("Rated voltage 3 V");
    expect(JSON.stringify(design)).toBe(before);
  });
  it.each([
    "missing-version",
    "wrong-version",
    "wrong-component",
    "missing-evidence",
    "blank-component",
    "blank-version",
  ] as const)("does not borrow catalog provenance for %s", (kind) => {
    const design = pinned();
    if (kind === "missing-version") delete design.componentVersions;
    if (kind === "wrong-version")
      design.componentEvidence!.pv!.versionId = "immutable-v2";
    if (kind === "wrong-component")
      design.componentEvidence!.pv!.id = "some-other-part";
    if (kind === "missing-evidence") delete design.componentEvidence;
    if (kind === "blank-component") {
      design.pv.componentId = "";
      design.componentEvidence!.pv!.id = "";
    }
    if (kind === "blank-version") {
      design.componentVersions!.pv = " ";
      design.componentEvidence!.pv!.versionId = " ";
    }
    const row = buildBOM(design)[0];
    expect(row.evidenceStatus).toBe("unknown");
    expect(row.name).toBe("unknown");
    expect(row.source).toBe("unknown");
    expect(row.sourceVersion).toBe("unknown");
    expect(row.specSha256).toBe("unknown");
    expect(row.sourcePages).toBe("unknown");
    expect(row.testConditions).toBe("unknown");
    expect(row.sourceParameters).toBeNull();
    expect(row.quantity).toBeNull();
  });
  it("does not export field evidence inconsistent with its own pinned source parameters", () => {
    const design = pinned();
    design.componentEvidence!.pv!.fieldEvidence![0].value = 5;
    const row = buildBOM(design)[0];
    expect(row.sourcePages).toBe("unknown");
    expect(row.testConditions).toBe("unknown");
    expect(row.fieldEvidence).toEqual([]);
  });
  it("marks a malformed purported Spec hash unknown", () => {
    const design = pinned();
    design.componentEvidence!.pv!.specSha256 = "not-a-sha256";
    expect(buildBOM(design)[0].specSha256).toBe("unknown");
  });
  it.each([
    '=HYPERLINK("https://bad.test")',
    "+SUM(1,1)",
    "-SUM(1,1)",
    "@SUM(1,1)",
    "\t=SUM(1,1)",
    "\r=SUM(1,1)",
    "  =SUM(1,1)",
    "\n@SUM(1,1)",
    "\u0000=SUM(1,1)",
  ])("neutralizes spreadsheet formulas in all string inputs: %s", (attack) => {
    const design = pinned();
    design.name = attack;
    design.componentEvidence!.pv!.name = attack;
    design.componentEvidence!.pv!.source = attack;
    const csv = bomCSV(design, { caseId: attack, revision: 2 }),
      row = parseCSV(csv)[0];
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(row.design_name).toBe("'" + attack);
    expect(row.name).toBe("'" + attack);
    expect(row.source_url).toBe("'" + attack);
    expect(row.derived_from_case_id).toBe("'" + attack);
  });
  it("round-trips CSV quotes/newlines, preserves numbers/units and labels context only as derived", () => {
    const design = pinned();
    design.name = 'Draft "quoted", name\nSecond line';
    design.componentEvidence!.pv!.manufacturer = 'Maker, "A"\r\nB';
    const csv = bomCSV(design, { caseId: "parent-case", revision: 7 }),
      row = parseCSV(csv)[0];
    expect(row.design_name).toBe(design.name);
    expect(row.manufacturer).toBe(design.componentEvidence!.pv!.manufacturer);
    expect(row.quantity).toBe("1");
    expect(row.quantity_unit).toBe("pcs");
    expect(row.design_area_cm2).toBe("68.62");
    expect(row.context_kind).toContain("not certified");
    expect(row.derived_from_revision).toBe("7");
    expect(row.circuit_topology).toBe("unknown");
    expect(row.notice).toContain("not a complete circuit BOM");
    expect(
      parseCSV(bomCSV(design, { revision: NaN }))[0].derived_from_revision,
    ).toBe("unknown");
  });
  it("rejects invalid quantity inputs before producing a misleading selection list", () => {
    const design = cloneDesign();
    design.storage.series = 0;
    expect(() => buildBOM(design)).toThrow();
  });
});
