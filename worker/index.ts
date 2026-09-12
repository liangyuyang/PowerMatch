import { extractText } from 'unpdf';
import { extractCandidates } from '../src/shared/spec-parser';
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { designSchema, locales, type Viewer, type Scope } from '../src/shared/model';
import { calculate, ENGINE_VERSION } from '../src/shared/engine';
import { randomToken, hash, escapeHtml, toViewer, canReadCase, canEditCase } from './security';

export interface Env {DB:D1Database;SPECS:R2Bucket;ASSETS:Fetcher;RESEND_API_KEY?:string|{get():Promise<string>};RESEND_FROM?:string;APP_ORIGIN:string;ENVIRONMENT:string;}
type UserRow={id:string;email:string;display_name:string;locale:string;active:number;posts_count:number};
type CaseRow={id:string;owner_id:string|null;guest_hash:string|null;name:string;scope:Scope;latest_revision:number;official:number;deleted:number};
type SpecRow={id:string;component_id:string;uploader_id:string;filename:string;mime:string;r2_key:string;sha256:string;bytes:number;status:string;proposed_json:string};
const app=new Hono<{Bindings:Env;Variables:{user:Viewer|null;guestHash:string}}>();
const id=()=>crypto.randomUUID();
const now=()=>Math.floor(Date.now()/1000);
const emailSchema=z.string().trim().toLowerCase().email().max(254);
const paramSchema=z.record(z.string().max(80),z.union([z.string().max(500),z.number().finite(),z.null()]));
const jsonError=(error:string,status=400)=>new Response(JSON.stringify({error}),{status,headers:{'Content-Type':'application/json'}});
async function rate(db:D1Database,key:string,max:number,windowS:number){const keyHash=await hash(key);const t=now();const row=await db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING count').bind(keyHash,t+windowS,t,t,t+windowS).first<{count:number}>();return row!.count<=max;}
async function audit(env:Env,actor:string,action:string,target:string,detail=''){await env.DB.prepare('INSERT INTO audit(id,actor_id,action,target_id,detail) VALUES(?,?,?,?,?)').bind(id(),actor,action,target,detail).run();}
async function resend(env:Env,to:string,subject:string,html:string,key:string){
 const secret=typeof env.RESEND_API_KEY==='string'?env.RESEND_API_KEY:await env.RESEND_API_KEY?.get();
 if(!secret||!env.RESEND_FROM)throw new Error('email-not-configured');
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({from:env.RESEND_FROM,to:[to],subject,html}),signal:AbortSignal.timeout(12000)});
 const payload=await response.json() as {id?:string};
 if(!response.ok||!payload.id)throw new Error(`email-provider-${response.status}`);
 return payload.id;
}
async function processMail(env:Env){const pending=await env.DB.prepare("SELECT id,recipient,subject,html FROM mail_outbox WHERE state='pending' AND attempts<3 ORDER BY created_at LIMIT 10").all<{id:string;recipient:string;subject:string;html:string}>();for(const mail of pending.results){const claimed=await env.DB.prepare("UPDATE mail_outbox SET state='sending',attempts=attempts+1 WHERE id=? AND state='pending' RETURNING id").bind(mail.id).first();if(!claimed)continue;try{const provider=await resend(env,mail.recipient,mail.subject,mail.html,mail.id);await env.DB.prepare("UPDATE mail_outbox SET state='accepted',provider_id=?,html='' WHERE id=?").bind(provider,mail.id).run();}catch(e){await env.DB.prepare("UPDATE mail_outbox SET state='failed',error_code=? WHERE id=?").bind(e instanceof Error?e.message:'mail-error',mail.id).run();}}}

app.use('/api/*',bodyLimit({maxSize:21*1024*1024,onError:()=>jsonError('file-too-large',413)}));
app.use('/api/*',async(c,next)=>{
 c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');
 if(!['GET','HEAD','OPTIONS'].includes(c.req.method)){
  const origin=c.req.header('Origin');const allowed=[c.env.APP_ORIGIN];
  if(c.env.ENVIRONMENT==='development')allowed.push('http://127.0.0.1:5173','http://localhost:5173');
  if(!origin||!allowed.includes(origin))return jsonError('origin-not-allowed',403);
 }
 let user:Viewer|null=null;const session=getCookie(c,'pm_session');
 if(session){const row=await c.env.DB.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').bind(await hash(session),now()).first<UserRow>();if(row)user=toViewer(row);}
 c.set('user',user);const guest=getCookie(c,'pm_guest');c.set('guestHash',guest?await hash(guest):'');
 await next();
});
app.onError((e)=>{if(e instanceof z.ZodError)return jsonError('invalid-input',400);console.error('PowerMatch request failed',e instanceof Error?e.name:'unknown');return jsonError('request-failed',500);});
app.get('/api/health',async(c)=>{await c.env.DB.prepare('SELECT 1').first();return c.json({ok:true,app:'PowerMatch',version:ENGINE_VERSION,emailConfigured:!!c.env.RESEND_API_KEY&&!!c.env.RESEND_FROM});});
app.get('/api/session',(c)=>{if(!getCookie(c,'pm_guest'))setCookie(c,'pm_guest',randomToken(),{httpOnly:true,secure:c.env.ENVIRONMENT!=='development',sameSite:'Lax',path:'/',maxAge:365*86400});return c.json({user:c.get('user'),emailConfigured:!!c.env.RESEND_API_KEY&&!!c.env.RESEND_FROM});});
app.post('/api/auth/request',async(c)=>{
 const data=z.object({email:emailSchema,locale:z.enum(locales)}).parse(await c.req.json());
 const ip=c.req.header('CF-Connecting-IP')||'local';
 if(!await rate(c.env.DB,`auth-ip:${ip}`,8,3600)||!await rate(c.env.DB,`auth-mail:${data.email}`,3,900))return jsonError('rate-limited',429);
 const active=await c.env.DB.prepare('SELECT active FROM users WHERE email=?').bind(data.email).first<{active:number}>();if(active?.active===0)return c.json({ok:true});
 if(!c.env.RESEND_API_KEY||!c.env.RESEND_FROM)return jsonError('email-not-configured',503);
 const token=randomToken();const hashed=await hash(token);await c.env.DB.prepare('INSERT INTO login_tokens(token_hash,email,locale,expires_at) VALUES(?,?,?,?)').bind(hashed,data.email,data.locale,now()+900).run();
 const url=`${c.env.APP_ORIGIN}/login#token=${token}`;
 const label=data.locale==='zh'?'登录 PowerMatch':'Sign in to PowerMatch';
 const body=`<div style="font-family:Arial,sans-serif;max-width:540px;margin:auto;color:#172033"><img alt="ZenMeasure" width="180" src="${c.env.APP_ORIGIN}/assets/zenmeasure-blue.png"><h1>PowerMatch</h1><p>${data.locale==='zh'?'点击下方链接，继续登录。链接15分钟有效，只能使用一次。':'Continue to sign in. This link expires in 15 minutes and can be used once.'}</p><p><a href="${url}" style="display:inline-block;background:#100080;color:white;padding:14px 24px;border-radius:8px;text-decoration:none">${label}</a></p><p>${data.locale==='zh'?'如果你没有请求登录，请忽略此邮件。':'If you did not request this email, you can ignore it.'}</p></div>`;
 try{await resend(c.env,data.email,label,body,hashed);}catch(e){await c.env.DB.prepare('DELETE FROM login_tokens WHERE token_hash=?').bind(hashed).run();return jsonError(e instanceof Error?e.message:'email-failed',503);}
 return c.json({ok:true});
});
app.post('/api/auth/consume',async(c)=>{
 const {token}=z.object({token:z.string().regex(/^[a-f0-9]{64}$/)}).parse(await c.req.json());
 if(!await rate(c.env.DB,`consume:${c.req.header('CF-Connecting-IP')||'local'}`,30,600))return jsonError('rate-limited',429);
 const record=await c.env.DB.prepare('DELETE FROM login_tokens WHERE token_hash=? AND expires_at>? RETURNING email,locale').bind(await hash(token),now()).first<{email:string;locale:string}>();if(!record)return jsonError('link-expired',401);
 const userId=id();await c.env.DB.prepare('INSERT INTO users(id,email,display_name,locale) VALUES(?,?,?,?) ON CONFLICT(email) DO NOTHING').bind(userId,record.email,record.email.split('@')[0],record.locale).run();
 const row=await c.env.DB.prepare('SELECT * FROM users WHERE email=? AND active=1').bind(record.email).first<UserRow>();if(!row)return jsonError('account-disabled',403);
 const session=randomToken();await c.env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await hash(session),row.id,now()+14*86400).run();
 setCookie(c,'pm_session',session,{httpOnly:true,secure:c.env.ENVIRONMENT!=='development',sameSite:'Lax',path:'/',maxAge:14*86400});return c.json({user:toViewer(row)});
});
app.post('/api/auth/logout',async(c)=>{const token=getCookie(c,'pm_session');if(token)await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(token)).run();deleteCookie(c,'pm_session',{path:'/'});return c.json({ok:true});});
app.patch('/api/preferences',async(c)=>{const user=c.get('user');if(!user)return jsonError('login-required',401);const {locale,mode}=z.object({locale:z.enum(locales),mode:z.enum(['auto','manual']).default('manual')}).parse(await c.req.json());await c.env.DB.prepare('UPDATE users SET locale=?,locale_mode=? WHERE id=?').bind(locale,mode,user.id).run();return c.json({ok:true});});
app.post('/api/calculate',async(c)=>c.json(calculate(designSchema.parse(await c.req.json()))));
app.get('/api/cases',async(c)=>{
 const user=c.get('user');const scope=c.req.query('scope')||'public';
 if(scope==='company'&&!user?.employee)return jsonError('employee-required',403);
 if(scope==='private'&&!user?.employee)return jsonError('employee-required',403);
 const where=scope==='mine'?'(c.owner_id=? OR c.guest_hash=?)':scope==='private'?"c.scope='private' AND c.owner_id=?":'c.scope=?';
 const values=scope==='mine'?[user?.id||'',c.get('guestHash')]:scope==='private'?[user!.id]:[scope];
 const rows=await c.env.DB.prepare(`SELECT c.id,c.name,c.scope,c.latest_revision,c.official,c.updated_at,u.display_name AS author_name,u.id AS author_id FROM cases c LEFT JOIN users u ON c.owner_id=u.id WHERE c.deleted=0 AND ${where} ORDER BY c.official DESC,c.updated_at DESC LIMIT 100`).bind(...values).all();
 return c.json({cases:rows.results});
});
app.get('/api/cases/:id',async(c)=>{
 const row=await c.env.DB.prepare('SELECT * FROM cases WHERE id=?').bind(c.req.param('id')).first<CaseRow>();if(!row||!canReadCase(row,c.get('user'),c.get('guestHash')))return jsonError('not-found',404);
 const revisions=await c.env.DB.prepare('SELECT id,number,scope,design_json,engine_version,parent_revision,created_at FROM revisions WHERE case_id=? ORDER BY number DESC').bind(row.id).all<{id:string;number:number;scope:Scope;design_json:string}>();
 return c.json({case:{id:row.id,name:row.name,scope:row.scope,official:row.official,latest_revision:row.latest_revision,canEdit:canEditCase(row,c.get('user'),c.get('guestHash'))},revisions:revisions.results.filter(r=>canReadCase({...row,scope:r.scope},c.get('user'),c.get('guestHash'))).map(r=>({...r,design:JSON.parse(r.design_json),design_json:undefined}))});
});
app.post('/api/cases',async(c)=>{
 const data=z.object({id:z.string().max(100).optional(),expectedRevision:z.number().int().positive().optional(),name:z.string().trim().min(1).max(100),scope:z.enum(['public','company','private']),design:designSchema,parentRevision:z.string().max(100).nullable().optional()}).parse(await c.req.json());
 const user=c.get('user');if(data.scope!=='public'&&!user?.employee)return jsonError('employee-required',403);
 if(!await rate(c.env.DB,`save:${user?.id||c.req.header('CF-Connecting-IP')||'local'}`,30,3600))return jsonError('rate-limited',429);
 const guestHash=c.get('guestHash');if(!user&&!guestHash)return jsonError('session-required',401);
 if(data.parentRevision){const parent=await c.env.DB.prepare('SELECT c.id,c.owner_id,c.guest_hash,c.name,r.scope,c.latest_revision,c.official,c.deleted FROM cases c JOIN revisions r ON r.case_id=c.id WHERE r.id=?').bind(data.parentRevision).first<CaseRow>();if(!parent||!canReadCase(parent,user,guestHash))return jsonError('not-found',404);}
 const caseId=data.id||id();const revisionId=id();let number=1;
 if(data.id){const row=await c.env.DB.prepare('SELECT * FROM cases WHERE id=? AND deleted=0').bind(data.id).first<CaseRow>();if(!row||!canEditCase(row,user,guestHash))return jsonError('not-found',404);if(row.latest_revision!==data.expectedRevision)return jsonError('revision-conflict',409);number=row.latest_revision+1;
  const result=await c.env.DB.batch([
   c.env.DB.prepare('INSERT INTO revisions(id,case_id,number,design_json,engine_version,parent_revision,scope) SELECT ?,id,?,?,?,?,? FROM cases WHERE id=? AND latest_revision=?').bind(revisionId,number,JSON.stringify(data.design),ENGINE_VERSION,data.parentRevision||null,data.scope,caseId,row.latest_revision),
   c.env.DB.prepare('UPDATE cases SET name=?,scope=?,latest_revision=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND latest_revision=?').bind(data.name,data.scope,number,caseId,row.latest_revision)
  ]);if(!result[0].meta.changes)return jsonError('revision-conflict',409);
 }else{await c.env.DB.batch([
  c.env.DB.prepare('INSERT INTO cases(id,owner_id,guest_hash,name,scope) VALUES(?,?,?,?,?)').bind(caseId,user?.id||null,user?null:guestHash,data.name,data.scope),
  c.env.DB.prepare('INSERT INTO revisions(id,case_id,number,design_json,engine_version,parent_revision,scope) VALUES(?,?,1,?,?,?,?)').bind(revisionId,caseId,JSON.stringify(data.design),ENGINE_VERSION,data.parentRevision||null,data.scope)
 ]);}
 return c.json({id:caseId,revisionId,number});
});
app.delete('/api/cases/:id',async(c)=>{const row=await c.env.DB.prepare('SELECT * FROM cases WHERE id=?').bind(c.req.param('id')).first<CaseRow>();if(!row||!canEditCase(row,c.get('user'),c.get('guestHash')))return jsonError('not-found',404);await c.env.DB.prepare('UPDATE cases SET deleted=1 WHERE id=?').bind(row.id).run();return c.json({ok:true});});
app.get('/api/components',async(c)=>{const rows=await c.env.DB.prepare('SELECT c.id,c.name,c.category,c.manufacturer,c.source,c.description,c.parameters_json,c.official,c.verified,c.adopted_spec,u.display_name AS author_name,u.id AS author_id FROM components c LEFT JOIN users u ON u.id=c.owner_id ORDER BY c.official DESC,c.category,c.name').all<{parameters_json:string}>();return c.json({components:rows.results.map(r=>({...r,parameters:JSON.parse(r.parameters_json),parameters_json:undefined}))});});
app.post('/api/components',async(c)=>{const user=c.get('user');if(!user)return jsonError('login-required',401);const data=z.object({name:z.string().trim().min(1).max(100),category:z.string().min(1).max(40),manufacturer:z.string().max(100),source:z.string().max(1000).refine(s=>!s||/^https?:\/\//.test(s)),description:z.string().max(2000),parameters:paramSchema}).parse(await c.req.json());const key=id();await c.env.DB.prepare('INSERT INTO components(id,name,category,manufacturer,source,description,parameters_json,owner_id) VALUES(?,?,?,?,?,?,?,?)').bind(key,data.name,data.category,data.manufacturer,data.source,data.description,JSON.stringify(data.parameters),user.id).run();return c.json({id:key});});
app.post('/api/specs/extract',async(c)=>{const user=c.get('user');if(!user)return jsonError('login-required',401);if(!await rate(c.env.DB,`extract:${user.id}`,5,3600))return jsonError('rate-limited',429);const body=await c.req.formData();const file=body.get('file');if(!(file instanceof File)||file.type!=='application/pdf'||file.size>5*1024*1024)return jsonError('text-pdf-max-5mb',400);const bytes=new Uint8Array(await file.arrayBuffer());const extracted=await extractText(bytes,{mergePages:true});const text=extracted.text.slice(0,150000);return c.json({pages:extracted.totalPages,candidates:extractCandidates(text),ocrRequired:!text.trim(),note:'Candidates only. Confirm model, units, test conditions and source before adoption.'});});
app.get('/api/components/:id/specs',async(c)=>{const rows=await c.env.DB.prepare('SELECT s.id,s.filename,s.mime,s.sha256,s.bytes,s.status,s.proposed_json,s.review_note,s.created_at,u.display_name AS author_name,u.id AS author_id FROM specs s JOIN users u ON u.id=s.uploader_id WHERE s.component_id=? ORDER BY s.created_at DESC').bind(c.req.param('id')).all();return c.json({specs:rows.results});});
app.post('/api/components/:id/specs',async(c)=>{
 const user=c.get('user');if(!user)return jsonError('login-required',401);if(!await rate(c.env.DB,`upload:${user.id}`,10,3600))return jsonError('rate-limited',429);
 const component=await c.env.DB.prepare('SELECT id FROM components WHERE id=?').bind(c.req.param('id')).first();if(!component)return jsonError('not-found',404);
 const body=await c.req.formData();const file=body.get('file');if(!(file instanceof File)||file.size>20*1024*1024||file.size===0)return jsonError('invalid-file',400);
 if(!['application/pdf','image/png','image/jpeg'].includes(file.type))return jsonError('unsupported-file',400);
 const bytes=await file.arrayBuffer();const magic=new Uint8Array(bytes).slice(0,8);const valid=file.type==='application/pdf'?String.fromCharCode(...magic).startsWith('%PDF-'):file.type==='image/png'?magic[0]===137&&magic[1]===80&&magic[2]===78:magic[0]===255&&magic[1]===216;
 if(!valid)return jsonError('file-type-mismatch',400);
 const proposed=paramSchema.parse(JSON.parse(String(body.get('parameters')||'{}')));const sha=await hash(bytes);const existing=await c.env.DB.prepare('SELECT id FROM specs WHERE component_id=? AND sha256=?').bind(c.req.param('id'),sha).first();if(existing)return jsonError('duplicate-spec',409);
 const key=id(),r2Key=`specs/${key}`;await c.env.SPECS.put(r2Key,bytes,{httpMetadata:{contentType:file.type}});
 await c.env.DB.prepare('INSERT INTO specs(id,component_id,uploader_id,filename,mime,r2_key,sha256,bytes,proposed_json) VALUES(?,?,?,?,?,?,?,?,?)').bind(key,c.req.param('id'),user.id,file.name.slice(0,180),file.type,r2Key,sha,file.size,JSON.stringify(proposed)).run();return c.json({id:key,status:'submitted'});
});
app.get('/api/specs/:id/file',async(c)=>{const row=await c.env.DB.prepare('SELECT * FROM specs WHERE id=?').bind(c.req.param('id')).first<SpecRow>();if(!row)return jsonError('not-found',404);const object=await c.env.SPECS.get(row.r2_key);if(!object)return jsonError('not-found',404);return new Response(object.body,{headers:{'Content-Type':row.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});});
app.post('/api/specs/:id/review',async(c)=>{const user=c.get('user');if(!user?.employee)return jsonError('employee-required',403);const data=z.object({action:z.enum(['adopt','reject']),note:z.string().trim().min(1).max(1000),parameters:paramSchema}).parse(await c.req.json());const row=await c.env.DB.prepare('SELECT * FROM specs WHERE id=?').bind(c.req.param('id')).first<SpecRow>();if(!row)return jsonError('not-found',404);const statements=[c.env.DB.prepare('UPDATE specs SET status=?,review_note=?,reviewer_id=?,proposed_json=? WHERE id=?').bind(data.action==='adopt'?'adopted':'rejected',data.note,user.id,JSON.stringify(data.parameters),row.id)];if(data.action==='adopt')statements.push(c.env.DB.prepare('UPDATE components SET parameters_json=?,adopted_spec=?,verified=1 WHERE id=?').bind(JSON.stringify(data.parameters),row.id,row.component_id));await c.env.DB.batch(statements);await audit(c.env,user.id,`spec-${data.action}`,row.id,data.note);return c.json({ok:true});});

async function targetAllowed(env:Env,type:string,target:string,user:Viewer|null,guestHash:string){if(type==='application')return ['general','indoor-pv','battery','display'].includes(target);if(type==='component')return !!await env.DB.prepare('SELECT id FROM components WHERE id=?').bind(target).first();const row=type==='case'?await env.DB.prepare('SELECT * FROM cases WHERE id=?').bind(target).first<CaseRow>():type==='revision'?await env.DB.prepare('SELECT c.id,c.owner_id,c.guest_hash,c.name,r.scope,c.latest_revision,c.official,c.deleted FROM cases c JOIN revisions r ON r.case_id=c.id WHERE r.id=?').bind(target).first<CaseRow>():null;return !!row&&canReadCase(row,user,guestHash);}
app.get('/api/posts',async(c)=>{const type=c.req.query('type')||'application',target=c.req.query('target')||'general';if(!await targetAllowed(c.env,type,target,c.get('user'),c.get('guestHash')))return jsonError('not-found',404);const rows=await c.env.DB.prepare('SELECT p.id,p.body,p.scope,p.created_at,u.id AS author_id,u.display_name AS author_name,u.posts_count FROM posts p JOIN users u ON u.id=p.author_id WHERE target_type=? AND target_id=? AND deleted=0 ORDER BY p.created_at DESC LIMIT 100').bind(type,target).all();return c.json({posts:rows.results.filter((p:any)=>p.scope==='public'||p.author_id===c.get('user')?.id||(p.scope==='company'&&c.get('user')?.employee))});});
app.post('/api/posts',async(c)=>{const user=c.get('user');if(!user)return jsonError('login-required',401);const data=z.object({type:z.enum(['case','revision','component','application']),target:z.string().max(100),body:z.string().trim().min(1).max(5000)}).parse(await c.req.json());if(!await targetAllowed(c.env,data.type,data.target,user,c.get('guestHash')))return jsonError('not-found',404);if(!await rate(c.env.DB,`post:${user.id}`,20,3600))return jsonError('rate-limited',429);let scope='public';if(data.type==='case'||data.type==='revision'){const row=await c.env.DB.prepare(data.type==='case'?'SELECT scope FROM cases WHERE id=?':'SELECT scope FROM revisions WHERE id=?').bind(data.target).first<{scope:string}>();scope=row!.scope;}const key=id();await c.env.DB.batch([c.env.DB.prepare('INSERT INTO posts(id,target_type,target_id,author_id,body,scope) VALUES(?,?,?,?,?,?)').bind(key,data.type,data.target,user.id,data.body,scope),c.env.DB.prepare('UPDATE users SET posts_count=posts_count+1 WHERE id=?').bind(user.id)]);return c.json({id:key});});
app.delete('/api/posts/:id',async(c)=>{const user=c.get('user');if(!user)return jsonError('login-required',401);const post=await c.env.DB.prepare('SELECT author_id FROM posts WHERE id=? AND deleted=0').bind(c.req.param('id')).first<{author_id:string}>();if(!post||(!user.admin&&post.author_id!==user.id))return jsonError('not-found',404);const deleted=await c.env.DB.prepare('UPDATE posts SET deleted=1 WHERE id=? AND deleted=0 RETURNING author_id').bind(c.req.param('id')).first<{author_id:string}>();if(deleted)await c.env.DB.prepare('UPDATE users SET posts_count=MAX(0,posts_count-1) WHERE id=?').bind(deleted.author_id).run();return c.json({ok:true});});
app.get('/api/messages',async(c)=>{const user=c.get('user');if(!user)return jsonError('login-required',401);const rows=await c.env.DB.prepare('SELECT m.id,m.body,m.sender_id,m.recipient_id,m.created_at,u.display_name AS sender_name,v.display_name AS recipient_name FROM messages m JOIN users u ON u.id=m.sender_id JOIN users v ON v.id=m.recipient_id WHERE m.recipient_id=? OR m.sender_id=? ORDER BY m.created_at DESC LIMIT 100').bind(user.id,user.id).all();return c.json({messages:rows.results});});
app.post('/api/messages',async(c)=>{const user=c.get('user');if(!user)return jsonError('login-required',401);const data=z.object({recipientId:z.string().max(100),body:z.string().trim().min(1).max(3000)}).parse(await c.req.json());if(!await rate(c.env.DB,`message:${user.id}`,5,3600))return jsonError('rate-limited',429);const recipient=await c.env.DB.prepare('SELECT id,email,locale FROM users WHERE id=? AND active=1').bind(data.recipientId).first<{id:string;email:string;locale:string}>();if(!recipient)return jsonError('not-found',404);const key=id(),mailId=id();await c.env.DB.batch([c.env.DB.prepare('INSERT INTO messages(id,sender_id,recipient_id,body) VALUES(?,?,?,?)').bind(key,user.id,recipient.id,data.body),c.env.DB.prepare('INSERT INTO mail_outbox(id,user_id,recipient,subject,html) VALUES(?,?,?,?,?)').bind(mailId,user.id,recipient.email,'PowerMatch · New message',`<p>${escapeHtml(user.name)} sent you a message on PowerMatch.</p><p><a href="${c.env.APP_ORIGIN}/?messages=1">Open PowerMatch</a></p>`)]);c.executionCtx.waitUntil(processMail(c.env));return c.json({id:key,notification:'queued'});});
app.post('/api/admin/maintenance',async(c)=>{const user=c.get('user');if(!user?.admin)return jsonError('admin-required',403);await c.env.DB.batch([c.env.DB.prepare('DELETE FROM login_tokens WHERE expires_at<?').bind(now()),c.env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()),c.env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(now()),c.env.DB.prepare("UPDATE mail_outbox SET state='pending' WHERE state='failed' AND attempts<3")]);c.executionCtx.waitUntil(processMail(c.env));await audit(c.env,user.id,'maintenance','powermatch');return c.json({ok:true});});
app.get('/api/admin',async(c)=>{if(!c.get('user')?.admin)return jsonError('admin-required',403);const results=await c.env.DB.batch([c.env.DB.prepare('SELECT id,email,display_name,active,posts_count,created_at FROM users ORDER BY created_at DESC LIMIT 100'),c.env.DB.prepare('SELECT s.id,s.component_id,s.filename,s.status,s.proposed_json,s.created_at,c.name AS component_name,u.display_name AS author_name FROM specs s JOIN components c ON c.id=s.component_id JOIN users u ON u.id=s.uploader_id ORDER BY s.created_at DESC LIMIT 100'),c.env.DB.prepare('SELECT id,state,attempts,error_code,created_at FROM mail_outbox ORDER BY created_at DESC LIMIT 100'),c.env.DB.prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 100')]);return c.json({users:results[0].results,specs:results[1].results,mail:results[2].results,audit:results[3].results});});
app.patch('/api/admin/users/:id',async(c)=>{const user=c.get('user');if(!user?.admin)return jsonError('admin-required',403);if(c.req.param('id')===user.id)return jsonError('cannot-disable-self',400);const {active}=z.object({active:z.boolean()}).parse(await c.req.json());await c.env.DB.batch([c.env.DB.prepare('UPDATE users SET active=? WHERE id=?').bind(active?1:0,c.req.param('id')),c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(c.req.param('id'))]);await audit(c.env,user.id,'user-active',c.req.param('id'),String(active));return c.json({ok:true});});
app.all('/api/*',()=>jsonError('not-found',404));
app.all('*',(c)=>c.env.ASSETS.fetch(c.req.raw));
export default {fetch:app.fetch,async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(processMail(env));ctx.waitUntil(env.DB.batch([env.DB.prepare('DELETE FROM login_tokens WHERE expires_at<?').bind(now()),env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()),env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(now())]));}};
export { app };
