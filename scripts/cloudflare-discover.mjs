const token=process.env.CLOUDFLARE_API_TOKEN;
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token || !account)throw new Error('Cloudflare credentials unavailable');
async function get(path){const response=await fetch('https://api.cloudflare.com/client/v4'+path,{headers:{Authorization:`Bearer ${token}`}});const data=await response.json();if(!data.success){console.log(JSON.stringify({path,status:response.status,errors:data.errors?.map(e=>({code:e.code,message:e.message}))}));return null;}return data.result;}
const zones=await get('/zones?name=zenmeasure.space');
console.log(JSON.stringify({account_id:account,zones:zones?.map(z=>({id:z.id,name:z.name,account:z.account.id}))}));
const workers=await get(`/accounts/${account}/workers/scripts`);
const matching=workers?.filter(w=>/powermatch/i.test(w.id));console.log(JSON.stringify({workers:matching?.map(w=>({id:w.id,modified_on:w.modified_on}))}));
for(const worker of matching||[]){const secrets=await get(`/accounts/${account}/workers/scripts/${worker.id}/secrets`);console.log(JSON.stringify({worker:worker.id,secret_names:secrets?.map(s=>s.name)}));}
const dbs=await get(`/accounts/${account}/d1/database`);console.log(JSON.stringify({databases:dbs?.filter(d=>/powermatch/i.test(d.name)).map(d=>({name:d.name,uuid:d.uuid}))}));
