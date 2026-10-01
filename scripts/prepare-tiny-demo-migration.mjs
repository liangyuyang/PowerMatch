import { writeFileSync } from "node:fs";
import { DEFAULT_DESIGN } from "../src/shared/model.ts";

const sqlQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const design = JSON.stringify(DEFAULT_DESIGN);
const migration = `-- Preserve the original incomplete public Tiny record as revision 1.
-- Revision 2 is a source-linked, conditional PowerFilm example; it is not a Tiny field measurement.
INSERT INTO revisions(id,case_id,number,design_json,engine_version,parent_revision,scope)
SELECT 'tiny-demo-r2',id,2,${sqlQuote(design)},'0.1.0','tiny-demo-r1','public'
FROM cases
WHERE id='tiny-demo' AND latest_revision=1
  AND EXISTS (SELECT 1 FROM revisions WHERE id='tiny-demo-r1' AND case_id='tiny-demo');

UPDATE cases SET latest_revision=2,updated_at=CURRENT_TIMESTAMP
WHERE id='tiny-demo' AND latest_revision=1
  AND EXISTS (SELECT 1 FROM revisions WHERE id='tiny-demo-r2' AND case_id='tiny-demo');
`;
writeFileSync("worker/migrations/0010_tiny_demo_ready.sql", migration);
console.log("Prepared versioned Tiny public case migration; original revision is preserved.");
