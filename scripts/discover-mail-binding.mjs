import fs from 'node:fs';
const context=JSON.parse(fs.readFileSync('project-context.json','utf8'));
const config=fs.readFileSync(`${process.env.USERPROFILE}/.wrangler/config/default.toml`,'utf8');
const token=config.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
if(!token)throw Error('Wrangler OAuth unavailable');
const account='bc2ac4bad6f535fcde57fa10a22f131b';
async function get(path){const r=await fetch(`https://api.cloudflare.com/client/v4${path}`,{headers:{Authorization:`Bearer ${token}`}});const x=await r.json();if(!x.success){console.log({path,status:r.status,codes:x.errors?.map(e=>e.code)});return [];}return x.result;}
const workers=await get(`/accounts/${account}/workers/scripts`);
const matches=workers.filter(w=>/power.?match/i.test(w.id));console.log({matchingWorkers:matches.map(w=>w.id)});
for(const w of matches){const secrets=await get(`/accounts/${account}/workers/scripts/${w.id}/secrets`);console.log({worker:w.id,secretNames:secrets.map(s=>s.name)});}
const pages=await get(`/accounts/${account}/pages/projects`);console.log({matchingPages:pages.filter(p=>/power.?match/i.test(p.name)).map(p=>({name:p.name,productionKeys:Object.keys(p.deployment_configs?.production?.env_vars??{})}))});
const dns=await get('/zones/bac3193498d4550dffe6bb1b4a02c7ad/dns_records?name=powermatch.zenmeasure.space');console.log({dns:dns.map(d=>({type:d.type,name:d.name,content:d.content}))});
