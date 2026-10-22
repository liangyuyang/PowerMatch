import { componentEvidenceSchema, type Design } from '../src/shared/model';

/** Replace client metadata with immutable server evidence; never retrofit legacy designs. */
export async function pinComponentEvidence(db:D1Database, input:Design):Promise<Design> {
  const design=structuredClone(input);
  design.componentEvidence={};
  for(const group of ['pv','storage','regulation'] as const) {
    const version=design.componentVersions?.[group];
    if(!version) continue;
    const row=await db.prepare('SELECT component_id,snapshot_json,created_at,origin FROM component_versions WHERE id=?')
      .bind(version).first<{component_id:string;snapshot_json:string;created_at:string;origin:string}>();
    if(!row||row.component_id!==design[group].componentId) throw new Error('component-version-mismatch');
    design.componentEvidence[group]=componentEvidenceSchema.parse({
      ...JSON.parse(row.snapshot_json),versionId:version,recordedAt:row.created_at,origin:row.origin,
    });
  }
  return design;
}
