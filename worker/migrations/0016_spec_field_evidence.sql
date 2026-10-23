ALTER TABLE specs ADD COLUMN field_evidence_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE spec_reviews ADD COLUMN field_evidence_json TEXT NOT NULL DEFAULT '[]';
DROP TRIGGER specs_original_immutable;
CREATE TRIGGER specs_original_immutable BEFORE UPDATE OF component_id,filename,mime,r2_key,sha256,bytes,proposed_json,field_evidence_json ON specs BEGIN SELECT RAISE(ABORT,'immutable-original-spec'); END;
