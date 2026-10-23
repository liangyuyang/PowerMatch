import type {Env} from './index';
import {hash} from './security';

const RETRY_WINDOW_HOURS=23; // Inside Resend's documented 24-hour idempotency retention.
type Mail={id:string;user_id:string|null;recipient:string;subject:string;html:string;attempts:number;payload_from:string|null;payload_hash:string|null;first_attempt_at:string|null};
class MailError extends Error {
  constructor(code:string,readonly retryable=false){super(code);}
}
export async function sendEmail(env:Env,to:string,subject:string,html:string,key:string,from=env.RESEND_FROM){
  const secret=typeof env.RESEND_API_KEY==='string'?env.RESEND_API_KEY:await env.RESEND_API_KEY?.get();
  if(!secret||!from) throw new MailError('email-not-configured');
  let response:Response;
  try {
    response=await fetch('https://api.resend.com/emails',{
      method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json','Idempotency-Key':key},
      body:JSON.stringify({from,to:[to],subject,html}),signal:AbortSignal.timeout(12000),
    });
  }catch{throw new MailError('mail-provider-outcome-unknown',true);}
  if(!response.ok)throw new MailError(`email-provider-${response.status}`,response.status===429||response.status>=500);
  let payload:{id?:unknown};
  try {payload=await response.json();}catch{throw new MailError('mail-provider-invalid-response',true);}
  if(typeof payload.id!=='string'||!payload.id||payload.id.length>200)throw new MailError('mail-provider-invalid-response',true);
  return payload.id;
}
export async function recoverMail(db:D1Database,retryFailed=false){
  let neverAttempted=0;
  if(retryFailed) neverAttempted=(await db.prepare("UPDATE mail_outbox SET state='pending',error_code=NULL,recovery_state='never-attempted-retry',next_attempt_at=NULL WHERE state='failed' AND attempts=0 AND first_attempt_at IS NULL AND payload_hash IS NULL").run()).meta.changes;
  const result=await db.prepare(`UPDATE mail_outbox SET
    state=CASE WHEN attempts<3 AND payload_hash IS NOT NULL AND first_attempt_at>datetime('now','-${RETRY_WINDOW_HOURS} hours') THEN 'pending' ELSE 'manual-review' END,
    recovery_state=CASE WHEN attempts<3 AND payload_hash IS NOT NULL AND first_attempt_at>datetime('now','-${RETRY_WINDOW_HOURS} hours') THEN 'safe-window-retry' ELSE 'outcome-needs-review' END,
    lease_token=NULL,lease_expires_at=NULL,
    error_code=CASE WHEN attempts>=3 THEN 'mail-attempts-exhausted' WHEN payload_hash IS NULL THEN 'mail-payload-unknown' WHEN first_attempt_at<=datetime('now','-${RETRY_WINDOW_HOURS} hours') THEN 'mail-retry-window-expired' ELSE error_code END
    WHERE (state='sending' AND lease_expires_at<=CURRENT_TIMESTAMP)
       OR (state='retry-wait' AND next_attempt_at<=CURRENT_TIMESTAMP)
       OR (?=1 AND state='failed')`).bind(retryFailed?1:0).run();
  return {reconciled:result.meta.changes+neverAttempted,retryWindowHours:RETRY_WINDOW_HOURS};
}
export async function mailStats(db:D1Database){
  return (await db.prepare('SELECT state,COUNT(*) count FROM mail_outbox GROUP BY state').all()).results;
}
export async function processMail(env:Env){
  await recoverMail(env.DB);
  const rows=await env.DB.prepare("SELECT id,user_id,recipient,subject,html,attempts,payload_from,payload_hash,first_attempt_at FROM mail_outbox WHERE state='pending' AND attempts<3 AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP) ORDER BY created_at,id LIMIT 10").all<Mail>();
  for(const mail of rows.results){
    // Legacy attempted payloads cannot be reconstructed from today's sender.
    if(mail.attempts>0&&(!mail.payload_hash||!mail.payload_from||!mail.first_attempt_at)){
      await env.DB.prepare("UPDATE mail_outbox SET state='manual-review',error_code='mail-payload-unknown' WHERE id=? AND state='pending'").bind(mail.id).run();continue;
    }
    const from=mail.payload_from??env.RESEND_FROM;
    if(!from){await env.DB.prepare("UPDATE mail_outbox SET state='failed',error_code='email-not-configured' WHERE id=? AND state='pending'").bind(mail.id).run();continue;}
    const payloadHash=await hash(JSON.stringify({from,to:[mail.recipient],subject:mail.subject,html:mail.html}));
    if(mail.payload_hash&&mail.payload_hash!==payloadHash){
      await env.DB.prepare("UPDATE mail_outbox SET state='manual-review',error_code='mail-payload-changed' WHERE id=? AND state='pending'").bind(mail.id).run();continue;
    }
    const token=crypto.randomUUID();
    const claimed=await env.DB.prepare(`UPDATE mail_outbox SET state='sending',attempts=attempts+1,lease_token=?,lease_expires_at=datetime('now','+60 seconds'),
      payload_from=?,payload_hash=?,first_attempt_at=COALESCE(first_attempt_at,CURRENT_TIMESTAMP),recovery_state=NULL
      WHERE id=? AND state='pending' AND attempts<3 AND (first_attempt_at IS NULL OR first_attempt_at>datetime('now','-${RETRY_WINDOW_HOURS} hours')) RETURNING id`)
      .bind(token,from,payloadHash,mail.id).first();
    if(!claimed){
      await env.DB.prepare("UPDATE mail_outbox SET state='manual-review',error_code='mail-retry-window-expired' WHERE id=? AND state='pending' AND first_attempt_at<=datetime('now','-23 hours')").bind(mail.id).run();continue;
    }
    const disabled=await env.DB.prepare('SELECT id FROM users WHERE active=0 AND (id=? OR email=?) LIMIT 1').bind(mail.user_id,mail.recipient).first();
    if(disabled){await env.DB.prepare("UPDATE mail_outbox SET state='skipped',error_code='account-disabled',lease_token=NULL,lease_expires_at=NULL,completed_at=CURRENT_TIMESTAMP,html='' WHERE id=? AND state='sending' AND lease_token=?").bind(mail.id,token).run();continue;}
    try{
      const provider=await sendEmail(env,mail.recipient,mail.subject,mail.html,mail.id,from);
      await env.DB.prepare("UPDATE mail_outbox SET state='accepted',provider_id=?,html='',lease_token=NULL,lease_expires_at=NULL,completed_at=CURRENT_TIMESTAMP,error_code=NULL WHERE id=? AND state='sending' AND lease_token=?")
        .bind(provider,mail.id,token).run();
    }catch(error){
      const code=error instanceof MailError?error.message:'mail-send-or-storage-outcome-unknown';
      // If persistence failed after acceptance, retry only with the frozen payload
      // and original key. A later claimant cannot be overwritten by this attempt.
      const retryable=!(error instanceof MailError)||error.retryable;
      await env.DB.prepare(`UPDATE mail_outbox SET state=CASE WHEN attempts>=3 THEN 'manual-review' ELSE ? END,error_code=?,
        next_attempt_at=datetime('now','+60 seconds'),lease_token=NULL,lease_expires_at=NULL WHERE id=? AND state='sending' AND lease_token=?`)
        .bind(retryable?'retry-wait':'failed',code,mail.id,token).run();
    }
  }
}
