import {z} from 'zod';
import {parameterUnits} from './component-parameters.ts';

// File binding identifies the source file, not the truth of a quoted claim.
export const fieldEvidenceSchema=z.object({
  parameter:z.string().min(1).max(80),value:z.union([z.number().finite(),z.string().max(500),z.null()]),
  unit:z.string().max(40),page:z.number().int().min(1).max(10000).nullable(),
  excerpt:z.string().trim().max(1000),conditions:z.string().trim().max(500),
  method:z.enum(['pdf-text','local-ocr','manual']),
});
export const fieldEvidenceListSchema=z.array(fieldEvidenceSchema).max(80);
export type FieldEvidence=z.infer<typeof fieldEvidenceSchema>;
export function validateFieldEvidence(input:unknown,parameters:Record<string,unknown>){
  const fields=fieldEvidenceListSchema.parse(input??[]),seen=new Set<string>();
  for(const field of fields){
    if(seen.has(field.parameter)||!Object.hasOwn(parameters,field.parameter)||parameters[field.parameter]!==field.value)
      throw new Error('field-evidence-value-mismatch');
    if(parameterUnits[field.parameter] && field.unit!==parameterUnits[field.parameter]) throw new Error("field-evidence-unit-mismatch");
    seen.add(field.parameter);
  }
  return fields;
}
