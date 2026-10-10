import { createHmac } from 'node:crypto';
import type { CrmPort } from '../ports.js';
import { canonical,digest } from '../security.js';
/** Explicit user-approved exact URL only. Retry delivery requires receiver idempotency. */
export class GenericWebhookCrm implements CrmPort {
 readonly providerMock=false;readonly deliveryKind='webhook' as const;
 constructor(private target:string,private key:()=>string,private allowedTargets:string[],private fetcher:typeof fetch=fetch){const u=new URL(target);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||!allowedTargets.includes(target)||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(u.hostname))throw new Error('CRM_TARGET_NOT_AUTHORIZED');}
 validateConfiguration(){const key=this.key();if(key.length<32||/[\r\n]/.test(key))throw new Error('CRM_KEY_INVALID');}
 async upsertCrm(tenant:string,command:string,receipt:string){const body=canonical({version:1,type:'booking.confirmed',tenant,command,receipt}),id=digest(tenant+':'+command),key=this.key();if(key.length<32||/[\r\n]/.test(key))throw new Error('CRM_KEY_INVALID');try{const r=await this.fetcher(this.target,{method:'POST',redirect:'error',signal:AbortSignal.timeout(3000),headers:{'Content-Type':'application/json','Idempotency-Key':id,'X-Receptionist-Signature':createHmac('sha256',key).update(body).digest('hex')},body});await r.body?.cancel();if(r.status<200||r.status>=300)throw new Error('CRM_DELIVERY_PENDING');}catch{throw new Error('CRM_DELIVERY_PENDING');}}
}
