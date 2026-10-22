-- Capture current facts only; these are not reconstructed historical Spec reviews.
ALTER TABLE components ADD COLUMN current_version TEXT;
ALTER TABLE specs ADD COLUMN review_revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE component_versions (
 id TEXT PRIMARY KEY, component_id TEXT NOT NULL REFERENCES components(id),
 snapshot_json TEXT NOT NULL, origin TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO component_versions(id,component_id,snapshot_json,origin)
 SELECT 'baseline:'||id,id,json_object('id',id,'name',name,'manufacturer',manufacturer,
 'source',source,'parameters',json(parameters_json),'adoptedSpec',adopted_spec,
 'specSha256',(SELECT sha256 FROM specs WHERE specs.id=components.adopted_spec),
 'specFilename',(SELECT filename FROM specs WHERE specs.id=components.adopted_spec),
 'reviewId',NULL,'reviewRevision',NULL),
 'catalog-at-migration' FROM components;
UPDATE components SET current_version='baseline:'||id;
CREATE TABLE spec_reviews (
 id TEXT PRIMARY KEY, spec_id TEXT NOT NULL REFERENCES specs(id),
 revision INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('adopt','reject')),
 parameters_json TEXT NOT NULL, note TEXT NOT NULL, reviewer_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(spec_id,revision)
);
CREATE TRIGGER component_versions_no_update BEFORE UPDATE ON component_versions BEGIN SELECT RAISE(ABORT,'immutable-component-version'); END;
CREATE TRIGGER component_versions_no_delete BEFORE DELETE ON component_versions BEGIN SELECT RAISE(ABORT,'immutable-component-version'); END;
CREATE TRIGGER spec_reviews_no_update BEFORE UPDATE ON spec_reviews BEGIN SELECT RAISE(ABORT,'immutable-spec-review'); END;
CREATE TRIGGER spec_reviews_no_delete BEFORE DELETE ON spec_reviews BEGIN SELECT RAISE(ABORT,'immutable-spec-review'); END;
CREATE TRIGGER specs_original_immutable BEFORE UPDATE OF component_id,filename,mime,r2_key,sha256,bytes,proposed_json ON specs BEGIN SELECT RAISE(ABORT,'immutable-original-spec'); END;
CREATE UNIQUE INDEX specs_file_unique ON specs(component_id,sha256);
CREATE INDEX component_versions_component ON component_versions(component_id,created_at);
