import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {app,type Env} from '../worker/index';
import {hash} from '../worker/security';
import {pinComponentEvidence} from '../worker/component-evidence';
import {cloneDesign,changeMode,changeStorage,type Component} from '../src/shared/model';
import {selectComponent,applyProposal} from '../src/shared/assistant';

let sqlite:DatabaseSync,env:Env,cookie:string;
const origin='https://powermatch.zenmeasure.space';
// Synchronous isolated SQL transactions mimic the D1 batch rollback contract.
function database():D1Database {
  return {
    prepare(sql:string) {
      let args: any[]=[];
      const statement={
        bind(...values:any[]){args=values;return statement;},
        async first(){return sqlite.prepare(sql).get(...args)??null;},
        async all(){return {success:true,results:sqlite.prepare(sql).all(...args)};},
        execute(){const result=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}};},
        async run(){return statement.execute();},
      };return statement;
    },
    async batch(statements:any[]){sqlite.exec('BEGIN');try{const results=statements.map(s=>s.execute());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}},
  } as unknown as D1Database;
}
async function request(path:string,data?:any){return app.request(origin+path,{method:data?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined},env);}
async function parts(){return (await(await request('/api/components')).json() as any).components;}
async function createPart(){
  const r=await request('/api/components',{name:'Measured cell',category:'battery',manufacturer:'Fixture',source:'https://example.test/spec',description:'Isolated test',parameters:{voltage:1.5,capacityMah:25,minVoltage:1.2}});
  expect(r.status).toBe(200);const {id}=await r.json() as any;return (await parts()).find((p:any)=>p.id===id);
}
async function uploadResponse(component:string,value:number){
  const form=new FormData();form.set('parameters',JSON.stringify({voltage:1.5,capacityMah:value,minVoltage:1.2}));
  form.set('file',new File([new Uint8Array([137,80,78,71,13,10,26,10,value])],'fixture.png',{type:'image/png'}));
  return app.request(origin+'/api/components/'+component+'/specs',{method:'POST',headers:{Origin:origin,Cookie:cookie},body:form},env);
}
async function upload(component:string,value:number){
  const r=await uploadResponse(component,value);
  expect(r.status).toBe(200);return (await r.json() as any).id;
}
beforeEach(async()=>{
  sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../worker/migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL('../worker/migrations/'+file,import.meta.url),'utf8'));
  sqlite.prepare("INSERT INTO users(id,email,display_name) VALUES('employee','fixture@zenmeasure.com','Fixture')").run();
  sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('evidence-test'),'employee',Math.floor(Date.now()/1000)+3600);
  cookie='pm_session=evidence-test';
  const objects=new Map();
  env={DB:database(),APP_ORIGIN:origin,ENVIRONMENT:'production',SPECS:{async put(key:string,value:any){objects.set(key,value);},async delete(key:string){objects.delete(key);},async get(key:string){return objects.has(key)?{body:objects.get(key)}:null;}}} as unknown as Env;
});
afterEach(()=>{sqlite.close();vi.restoreAllMocks();});
describe('immutable component evidence',()=>{
  it('pins server facts, retains old versions after adoption, and rejects a mismatched component',async()=>{
    const part=await createPart();const spec=await upload(part.id,30);
    const original=selectComponent(changeMode(cloneDesign(),'battery'),part);
    original.componentEvidence!.storage!.manufacturer='forged';
    const pinned=await pinComponentEvidence(env.DB,original);
    expect(pinned.componentEvidence!.storage!.manufacturer).toBe('Fixture');
    const before=(sqlite.prepare('SELECT proposed_json FROM specs WHERE id=?').get(spec) as any).proposed_json;
    const r=await request('/api/specs/'+spec+'/review',{action:'adopt',note:'Reviewed',parameters:{voltage:1.5,capacityMah:30,minVoltage:1.2},expectedRevision:0,expectedComponentVersion:part.version_id});
    expect(r.status).toBe(200);
    const old=await pinComponentEvidence(env.DB,pinned);
    expect(old.componentEvidence!.storage!.parameters.capacityMah).toBe(25);
    const next=(await parts()).find((x:any)=>x.id===part.id);
    expect(next.parameters.capacityMah).toBe(30);expect(next.version_id).not.toBe(part.version_id);
    const modern=await pinComponentEvidence(env.DB,selectComponent(original,next));
    expect(modern.componentEvidence!.storage!.reviewRevision).toBe(1);
    expect(modern.componentEvidence!.storage!.specSha256).toMatch(/^[a-f0-9]{64}$/);
    expect((sqlite.prepare('SELECT proposed_json FROM specs WHERE id=?').get(spec) as any).proposed_json).toBe(before);
    const saved=await request('/api/cases',{name:old.name,scope:'private',design:old});expect(saved.status).toBe(200);
    const detail=await (await request('/api/cases/'+(await saved.json() as any).id)).json() as any;
    expect(detail.revisions[0].design.componentEvidence.storage.parameters.capacityMah).toBe(25);
    old.storage.componentId='another';await expect(pinComponentEvidence(env.DB,old)).rejects.toThrow('component-version-mismatch');
    expect(()=>sqlite.prepare("UPDATE component_versions SET origin='edited'").run()).toThrow('immutable-component-version');
    expect(()=>sqlite.prepare('DELETE FROM component_versions').run()).toThrow('immutable-component-version');
    expect(()=>sqlite.prepare("UPDATE spec_reviews SET note='edited'").run()).toThrow('immutable-spec-review');
  });
  it('only one different-Spec adoption succeeds against the same component head',async()=>{
    const part=await createPart(),specA=await upload(part.id,30),specB=await upload(part.id,35);
    const body={action:'adopt',note:'Concurrent review',parameters:{voltage:1.5,capacityMah:35},expectedRevision:0,expectedComponentVersion:part.version_id};
    const results=await Promise.all([request('/api/specs/'+specA+'/review',body),request('/api/specs/'+specB+'/review',body)]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    expect((sqlite.prepare('SELECT COUNT(*) count FROM spec_reviews').get() as any).count).toBe(1);
    const winner=results[0].status===200?specA:specB;
    const retry=await request('/api/specs/'+winner+'/review',body);expect(retry.status).toBe(409);
    const latest=(await parts()).find((p:any)=>p.id===part.id);
    const rejected=await request('/api/specs/'+winner+'/review',{...body,action:'reject',expectedRevision:1,expectedComponentVersion:latest.version_id});expect(rejected.status).toBe(200);
    expect((await parts()).find((p:any)=>p.id===part.id).version_id).toBe(latest.version_id);
  });
  it('keeps legacy provenance absent, clears preset identities and respects locked version-only changes',async()=>{
    const legacy=await pinComponentEvidence(env.DB,cloneDesign());expect(legacy.componentEvidence).toEqual({});
    const part=await createPart();const selected=selectComponent(cloneDesign(),part);
    expect(changeStorage(selected,'lic').componentVersions?.storage).toBeUndefined();
    expect(changeMode(selected,'battery').componentEvidence?.storage).toBeUndefined();
    const changed={...part,version_id:'later-version'} as Component;
    expect(()=>applyProposal(selected,{explanation:'Update version',actions:[{type:'component',id:part.id}],assumptions:[]},[changed],['storage'])).toThrow('locked-parameters');
    delete selected.componentVersions;delete selected.componentEvidence;
    expect(()=>applyProposal(selected,{explanation:'Pin legacy version',actions:[{type:'component',id:part.id}],assumptions:[]},[part],['storage'])).toThrow('locked-parameters');
  });
  it('removes only the failed attempt object and retains committed objects after an ambiguous response',async()=>{
    const part=await createPart();
    const prepare=env.DB.prepare.bind(env.DB);
    const remove=vi.spyOn(env.SPECS,'delete');
    let mode='fail';
    vi.spyOn(env.DB,'prepare').mockImplementation((sql:string)=>{
      const statement=prepare(sql);
      if(sql.startsWith('INSERT INTO specs(')) {
        const bind=statement.bind.bind(statement);
        statement.bind=(...args:any[])=>{
          const bound=bind(...args),run=bound.run.bind(bound);
          bound.run=async()=>{
            if(mode==='committed') await run();
            throw new Error('simulated-database-transport-failure');
          };return bound;
        };
      }
      return statement;
    });
    // upload helper asserts 200; failure is intentional and leaves no database row.
    await expect(upload(part.id,31)).rejects.toThrow();
    expect(remove).toHaveBeenCalledTimes(1);
    expect((sqlite.prepare('SELECT count(*) n FROM specs').get() as any).n).toBe(0);
    mode='committed';const saved=await upload(part.id,32);
    expect(remove).toHaveBeenCalledTimes(1);
    const row=sqlite.prepare('SELECT r2_key FROM specs WHERE id=?').get(saved) as any;
    expect(await env.SPECS.get(row.r2_key)).not.toBeNull();
  });
  it('deduplicates two uploads after both objects exist without deleting the winning object',async()=>{
    const part=await createPart(),put=env.SPECS.put.bind(env.SPECS);
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>release=resolve);
    let arrivals=0;
    vi.spyOn(env.SPECS,'put').mockImplementation(async(...args:any[])=>{
      await (put as any)(...args);if(++arrivals===2) release();await gate;return {} as R2Object;
    });
    const remove=vi.spyOn(env.SPECS,'delete');
    const results=await Promise.all([uploadResponse(part.id,36),uploadResponse(part.id,36)]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(remove).toHaveBeenCalledTimes(1);
    const rows=sqlite.prepare('SELECT r2_key FROM specs').all() as any[];
    expect(rows).toHaveLength(1);expect(await env.SPECS.get(rows[0].r2_key)).not.toBeNull();
  });
  it('preserves an object if database readback cannot establish whether insertion committed',async()=>{
    const part=await createPart(),prepare=env.DB.prepare.bind(env.DB);
    const put=vi.spyOn(env.SPECS,'put'),remove=vi.spyOn(env.SPECS,'delete');
    vi.spyOn(env.DB,'prepare').mockImplementation((sql:string)=>{
      if(sql==='SELECT id FROM specs WHERE id=?') throw new Error('simulated-readback-unavailable');
      const stmt=prepare(sql);
      if(sql.startsWith('INSERT INTO specs(')) {const bind=stmt.bind.bind(stmt);stmt.bind=(...args:any[])=>{const bound=bind(...args);bound.run=async()=>{throw new Error('simulated-insert-outcome-unknown');};return bound;};}
      return stmt;
    });
    expect((await uploadResponse(part.id,37)).status).toBe(500);expect(remove).not.toHaveBeenCalled();
    expect(await env.SPECS.get(put.mock.calls[0][0] as string)).not.toBeNull();
  });
});
