import fs from 'node:fs';
import { CATALOG } from '../src/shared/catalog.ts';
function edit(p,f){fs.writeFileSync(p,f(fs.readFileSync(p,'utf8')))}
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
fs.writeFileSync('worker/migrations/0009_design_presets.sql', CATALOG.slice(0,6).map(c=>`INSERT OR IGNORE INTO components(id,name,category,manufacturer,source,description,parameters_json,official,verified) VALUES(${[c.id,c.name,c.category,c.manufacturer,c.source,c.description,JSON.stringify(c.parameters)].map(q).join(',')},1,${c.verified?1:0});`).join('\n'));
edit('src/main.tsx',s=>{const a=s.indexOf('    setD((old) => {',s.indexOf('  const useComponent =')),b=s.indexOf('    setModal(null);',a);return s.slice(0,a)+`    setD(old => {
      const n = selectComponent(old, c);
      if (c.category === "pv") n.mode = "pv";
      if (c.category === "battery") {n.mode="battery"; n.regulation.charger=false;}
      if (["lic","supercap","rechargeable"].includes(c.category)) {
        const base=changeStorage({...n,mode:"hybrid"},n.storage.kind);
        return {...base,storage:n.storage};
      }
      return n;
    });
`+s.slice(b)});
edit('scripts/test-model-settings-ui.mjs',s=>s.replace('/产生调用后|推算约/','/预算示例/'));
