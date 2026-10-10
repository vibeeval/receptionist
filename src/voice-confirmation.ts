import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { AsyncStore } from './async-store.js';
import type { Engine,Request,Result } from './engine.js';
import { RetellGateway } from './providers/retell.js';
import { AppError,verify,digest,canonical,signRequest } from './security.js';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const challenge=z.object({account:id,providerCall:z.string().min(1).max(128),slotId:id,intent:z.literal('booking')}).strict();
const attest=challenge.extend({nonce:z.string().regex(/^[a-f0-9]{64}$/),userConfirmed:z.boolean(),provenance:z.literal('human_operator'),evidenceId:id}).strict();
export class VoiceConfirmation {
 constructor(private core:Pick<Engine,'config'|'request'>,private db:AsyncStore,private gateway:RetellGateway,private now:()=>number){}
 async handle(r:Request):Promise<Result>{try{
  const m=/^\/v1\/tenants\/([a-z0-9-]+)\/voice-confirmations\/(challenge|attest)$/.exec(r.path);if(!m)throw new AppError(404,'NOT_FOUND');
  const tenant=this.core.config.tenants.find(t=>t.route===m[1]);if(!tenant)throw new AppError(404,'NOT_FOUND');if(r.method!=='POST')throw new AppError(405,'METHOD_NOT_ALLOWED');
  if(r.body.length>this.core.config.maxBodyBytes)throw new AppError(413,'BODY_TOO_LARGE');verify(tenant.keys.operator,r.headers,r.method,r.path,r.body,this.now(),this.core.config.maxAgeSeconds);
  let raw:unknown;try{raw=JSON.parse(r.body.toString());}catch{throw new AppError(400,'INVALID_JSON');}
  const parsed=(m[2]==='challenge'?challenge:attest).safeParse(raw);if(!parsed.success)throw new AppError(400,'INVALID_CONFIRMATION');const input=parsed.data;
  const result=await this.db.transaction(async()=>{
   const session=await this.db.one('SELECT * FROM retell_sessions WHERE account=? AND provider_call=?',input.account,input.providerCall);
   if(!session||session.tenant!==tenant.id||Number(session.closed)!==0)throw new AppError(403,'SESSION_NOT_ACTIVE');
   const call=await this.db.call(tenant.id,String(session.core_call));
   if(!call||!['active','eligible'].includes(String(call.state))||await this.db.killed(tenant.id)||await this.db.one('SELECT call_id FROM cancellation_gates WHERE tenant=? AND call_id=?',tenant.id,session.core_call!))throw new AppError(409,'CALL_BLOCKED');
   const slot=await this.db.one('SELECT * FROM slots WHERE tenant=? AND id=?',tenant.id,input.slotId);
   if(!slot||Number(slot.start_ms)<=this.now())throw new AppError(409,'SLOT_UNAVAILABLE');const slotHash=digest(canonical(slot));
   if(m[2]==='challenge'){
    const nonce=randomBytes(32).toString('hex');await this.db.run("INSERT INTO voice_confirmations VALUES(?,?,?,?,?,?,?,?,'issued',NULL)",digest(nonce),tenant.id,input.account,input.providerCall,session.core_call!,input.slotId,slotHash,this.now()+60000);
    return {status:201,body:{nonce,intent:'booking',slotId:input.slotId,startMs:slot.start_ms,endMs:slot.end_ms,timeZone:'Europe/Istanbul',instruction:'Tarih, saat ve görüşme amacını kullanıcıya tekrar okuyun; yalnız açık onaydan sonra operatör teyidi verin.'}};
   }
   const a=attest.parse(raw),row=await this.db.one('SELECT * FROM voice_confirmations WHERE nonce_hash=?',digest(a.nonce));
   if(!row||row.state!=='issued'||row.tenant!==tenant.id||row.account!==a.account||row.provider_call!==a.providerCall||row.slot!==a.slotId||row.core_call!==session.core_call||row.slot_hash!==slotHash||Number(row.expires_ms)<=this.now())throw new AppError(409,'NONCE_BINDING_REQUIRED');
   if(!a.userConfirmed){await this.db.run("UPDATE voice_confirmations SET state='declined',provenance='human_operator' WHERE nonce_hash=?",digest(a.nonce));await this.db.run("INSERT OR IGNORE INTO cancellation_gates VALUES(?,?,'human')",tenant.id,session.core_call!);await this.db.run("INSERT OR IGNORE INTO human_tasks(tenant,call_id,reason) VALUES(?,?,'VOICE_CONFIRMATION_DECLINED')",tenant.id,session.core_call!);return {status:202,body:{state:'human_review',transferExecuted:false}};}
   await this.db.run("UPDATE voice_confirmations SET state='consumed',provenance=? WHERE nonce_hash=?",digest('human_operator:'+a.evidenceId),digest(a.nonce));
   await this.db.run("UPDATE calls SET state='eligible' WHERE tenant=? AND id=?",tenant.id,session.core_call!);await this.db.audit(tenant.id,'OPERATOR_VOICE_RECONFIRMED',a.evidenceId,this.now());
   return {status:200,body:{coreCall:session.core_call,nonceHash:digest(a.nonce)}};
  });
  if(m[2]==='challenge'||result.status!==200)return result;
  const a=attest.parse(raw),body=Buffer.from(JSON.stringify({callId:result.body.coreCall,slotId:a.slotId,attested:true,evidenceId:digest('voice:'+a.nonce)})),path='/v1/tenants/'+tenant.route+'/confirmations',ts=String(Math.floor(this.now()/1000));
  const confirmation=await this.core.request({method:'POST',path,body,headers:{'x-timestamp':ts,'x-signature':signRequest(tenant.keys.operator,ts,'POST',path,body)}});
  if(confirmation.status!==201)throw new AppError(409,'HUMAN_REVIEW_REQUIRED');
  const approved=await this.db.one('SELECT slot_hash FROM voice_confirmations WHERE nonce_hash=?',digest(a.nonce));
  if(!approved)throw new AppError(409,'PROPOSAL_CHANGED');
  await this.db.run('INSERT INTO confirmation_slot_bindings VALUES(?,?,?,?,?)',tenant.id,String(confirmation.body.confirmationId),String(result.body.coreCall),a.slotId,approved.slot_hash!);
  const commandId=digest('voice-command:'+a.nonce),capability=await this.gateway.issueBookingCapability(a.account,a.providerCall,commandId,String(confirmation.body.confirmationId));
  return {status:201,body:{capability,commandId,expiresInMs:60000,provenance:'human_operator',voiceRecognitionVerified:false}};
 }catch(e){const x=e instanceof AppError?e:new AppError(503,'VOICE_CONFIRMATION_UNAVAILABLE');return {status:x.status,body:{code:x.code,humanFallback:true,transferExecuted:false}};}}
}
