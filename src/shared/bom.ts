import { componentEvidenceSchema, designSchema, type Design } from "./model";
import { validateFieldEvidence, type FieldEvidence } from "./spec-evidence";

export const BOM_NOTICE =
  "Selection list only; not a complete circuit BOM. Circuit topology, connections and peripheral resistor/capacitor values are unverified and are not generated.";
const UNKNOWN = "unknown";
type Group = "pv" | "storage" | "regulation";
type ParameterValue = string | number | null;
export interface BOMRow {
  group: Group;
  componentId: string;
  name: string;
  manufacturer: string;
  quantity: number | null;
  quantityUnit: "pcs";
  quantityNote: string;
  designAreaCm2: number | null;
  sourceAreaCm2: number | null;
  designParameters: Record<string, ParameterValue | boolean>;
  sourceParameters: Record<string, ParameterValue> | null;
  requestedVersion: string;
  sourceVersion: string;
  evidenceStatus: "matched-pinned-snapshot" | "unknown";
  source: string;
  specId: string;
  specSha256: string;
  specFilename: string;
  sourceRecordedAt: string;
  sourceOrigin: string;
  reviewId: string;
  reviewRevision: number | null;
  pinInformation: string;
  circuitTopology: "unknown";
  sourcePages: string;
  testConditions: string;
  fieldEvidence: FieldEvidence[];
  notice: string;
}
const known = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : UNKNOWN;
const positive = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
/** Build from the design's pinned snapshot only. A current catalog entry is never substituted. */
export function buildBOM(input: Design): BOMRow[] {
  const design = designSchema.parse(input),
    groups: Group[] = [];
  if (design.mode !== "battery") groups.push("pv");
  if (design.mode !== "pv") groups.push("storage");
  if (design.path !== "direct") groups.push("regulation");
  return groups.map((group) => {
    const selected = design[group],
      version = design.componentVersions?.[group];
    const parsed = componentEvidenceSchema.safeParse(
      design.componentEvidence?.[group],
    );
    const evidence =
      selected.componentId.trim() &&
      version?.trim() &&
      parsed.success &&
      parsed.data.id === selected.componentId &&
      parsed.data.versionId === version
        ? parsed.data
        : null;
    let fields: FieldEvidence[] = [];
    if (evidence)
      try {
        fields = validateFieldEvidence(
          evidence.fieldEvidence ?? [],
          evidence.parameters,
        );
      } catch {
        /* Inconsistent field claims are not exported as source evidence. */
      }
    const designAreaCm2 = group === "pv" ? design.pv.areaCm2 : null,
      sourceAreaCm2 =
        group === "pv" ? positive(evidence?.parameters.areaCm2) : null;
    const sameArea =
      designAreaCm2 !== null &&
      sourceAreaCm2 !== null &&
      Math.abs(designAreaCm2 - sourceAreaCm2) <=
        1e-9 * Math.max(1, designAreaCm2, sourceAreaCm2);
    const quantity =
      group === "storage"
        ? design.storage.series * design.storage.parallel
        : group === "regulation"
          ? 1
          : sameArea
            ? 1
            : null;
    const quantityNote =
      group === "storage"
        ? `Selected storage units: ${design.storage.series} series × ${design.storage.parallel} parallel; wiring and compatibility unverified.`
        : group === "regulation"
          ? "One regulator selection; exact part, pinout, connections and peripheral parts require confirmation."
          : sameArea
            ? "Design area matches the pinned component area; one selected module, availability and wiring unverified."
            : "Module quantity requires confirmation. Design area is a simulation input; a changed or unknown source area does not establish a purchasable module count.";
    const { componentId: _componentId, ...designParameters } = selected;
    const pin =
      evidence?.parameters.pinout ??
      evidence?.parameters.pins ??
      evidence?.parameters.pinCount;
    return {
      group,
      componentId: known(selected.componentId),
      name: known(evidence?.name),
      manufacturer: known(evidence?.manufacturer),
      quantity,
      quantityUnit: "pcs",
      quantityNote,
      designAreaCm2,
      sourceAreaCm2,
      designParameters,
      sourceParameters: evidence ? structuredClone(evidence.parameters) : null,
      requestedVersion: known(version),
      sourceVersion: known(evidence?.versionId),
      evidenceStatus: evidence ? "matched-pinned-snapshot" : "unknown",
      source: known(evidence?.source),
      specId: known(evidence?.adoptedSpec),
      specSha256:
        evidence?.specSha256 && /^[a-f\d]{64}$/i.test(evidence.specSha256)
          ? evidence.specSha256
          : UNKNOWN,
      specFilename: known(evidence?.specFilename),
      sourceRecordedAt: known(evidence?.recordedAt),
      sourceOrigin: known(evidence?.origin),
      reviewId: known(evidence?.reviewId),
      reviewRevision: evidence?.reviewRevision ?? null,
      pinInformation:
        typeof pin === "number" && Number.isFinite(pin)
          ? String(pin)
          : known(pin),
      circuitTopology: "unknown",
      sourcePages: fields.length
        ? fields
            .map((field) => `${field.parameter}: ${field.page ?? UNKNOWN}`)
            .join("; ")
        : UNKNOWN,
      testConditions: fields.length
        ? fields
            .map((field) => `${field.parameter}: ${known(field.conditions)}`)
            .join("; ")
        : UNKNOWN,
      fieldEvidence: structuredClone(fields),
      notice: BOM_NOTICE,
    };
  });
}
/** Quote every CSV cell; neutralize spreadsheet formulas in every string, including metadata. */
function cell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? UNKNOWN
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (
    typeof value !== "number" &&
    (/^[\s\u0000-\u0020\u007f-\u009f\uFEFF]*[=+\-@]/u.test(text) ||
      /^[\s\uFEFF]*[\t\r]/u.test(text))
  )
    text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function bomCSV(
  design: Design,
  metadata: { caseId?: string; revision?: number } = {},
): string {
  const rows = buildBOM(design);
  const headers = [
    "document_kind",
    "notice",
    "design_name",
    "mode",
    "path",
    "context_kind",
    "derived_from_case_id",
    "derived_from_revision",
    "selection_group",
    "component_id",
    "name",
    "manufacturer",
    "quantity",
    "quantity_unit",
    "quantity_note",
    "design_area_cm2",
    "source_area_cm2",
    "design_parameters",
    "source_parameters",
    "evidence_status",
    "requested_version",
    "source_version",
    "source_url",
    "spec_id",
    "spec_sha256",
    "spec_filename",
    "source_recorded_at",
    "source_origin",
    "review_id",
    "review_revision",
    "pin_information",
    "circuit_topology",
    "source_pages",
    "test_conditions",
    "field_evidence",
  ];
  const revision =
    Number.isInteger(metadata.revision) && metadata.revision! > 0
      ? metadata.revision
      : null;
  const context =
    metadata.caseId || metadata.revision !== undefined
      ? "Derived-from context only; current inputs are not certified as the contents of that fixed revision."
      : "Current design inputs; no fixed revision is claimed.";
  const data = rows.map((row) => [
    "component-selection-list",
    row.notice,
    design.name,
    design.mode,
    design.path,
    context,
    known(metadata.caseId),
    revision,
    row.group,
    row.componentId,
    row.name,
    row.manufacturer,
    row.quantity,
    row.quantityUnit,
    row.quantityNote,
    row.designAreaCm2,
    row.sourceAreaCm2,
    row.designParameters,
    row.sourceParameters,
    row.evidenceStatus,
    row.requestedVersion,
    row.sourceVersion,
    row.source,
    row.specId,
    row.specSha256,
    row.specFilename,
    row.sourceRecordedAt,
    row.sourceOrigin,
    row.reviewId,
    row.reviewRevision,
    row.pinInformation,
    row.circuitTopology,
    row.sourcePages,
    row.testConditions,
    row.fieldEvidence,
  ]);
  return (
    "\uFEFF" +
    [headers, ...data].map((row) => row.map(cell).join(",")).join("\r\n") +
    "\r\n"
  );
}
