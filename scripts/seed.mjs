import { writeFileSync, mkdirSync } from "node:fs";
import { CATALOG } from "../src/shared/catalog.ts";
import { DEFAULT_DESIGN } from "../src/shared/model.ts";
const q = (s) => "'" + String(s).replaceAll("'", "''") + "'";
const statements = CATALOG.map(
  (c) =>
    `INSERT OR IGNORE INTO components(id,name,category,manufacturer,source,description,parameters_json,official,verified) VALUES(${[c.id, c.name, c.category, c.manufacturer, c.source, c.description, JSON.stringify(c.parameters)].map(q).join(",")},1,${c.verified ? 1 : 0});`,
);
statements.push(
  "INSERT OR IGNORE INTO cases(id,name,scope,official) VALUES('tiny-demo','穿山甲Tiny · MOT-U125','public',1);",
);
statements.push(
  `INSERT OR IGNORE INTO revisions(id,case_id,number,design_json,engine_version,scope) VALUES('tiny-demo-r1','tiny-demo',1,${q(JSON.stringify(DEFAULT_DESIGN))},'0.1.0','public');`,
);
mkdirSync("tmp", { recursive: true });
writeFileSync("tmp/seed.sql", statements.join("\n"));
console.log(
  `Prepared ${CATALOG.length} official component records and Tiny demo; INSERT OR IGNORE preserves existing data.`,
);
