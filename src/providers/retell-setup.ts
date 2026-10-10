import { canonical,digest } from '../security.js';
import type { FlowPins } from '../autonomous/controller.js';
import { AGENT_PATCH,materializeFlow } from '../autonomous/flow.js';
export interface SetupVerifier {check(signal?:AbortSignal):Promise<boolean>;close?():void;}
export function remoteFlowDigest(flow:Record<string,unknown>){const copy={...flow};for(const key of ['conversation_flow_id','version','is_published','last_modification_timestamp','version_title','version_description'])delete copy[key];return digest(canonical(copy));}
function contains(actual:unknown,expected:unknown):boolean {if(expected===null||typeof expected!=='object')return actual===expected;if(Array.isArray(expected))return Array.isArray(actual)&&actual.length===expected.length&&expected.every((v,i)=>contains(actual[i],v));if(!actual||typeof actual!=='object')return false;return Object.entries(expected).every(([k,v])=>contains((actual as Record<string,unknown>)[k],v));}
/** A single cancellation boundary owns all account iterations and body reads. */
export class RetellSetupVerifier implements SetupVerifier {
 private lifetime=new AbortController();
 constructor(private accounts:{id:string;key:string;agentIds:string[]}[],private pins:FlowPins,private origin:string,private remoteDigests:Record<string,string>,private handoff:Record<string,string>,private fetcher:typeof fetch=fetch){}
 private async request(path:string,key:string,signal:AbortSignal){
  signal.throwIfAborted();
  const response=await this.fetcher('https://api.retellai.com'+path,{headers:{Authorization:'Bearer '+key},redirect:'error',signal});
  if(signal.aborted){void response.body?.cancel().catch(()=>{});signal.throwIfAborted();}
  if(response.status!==200){void response.body?.cancel().catch(()=>{});throw new Error('SETUP_UNAVAILABLE');}
  const reader=response.body?.getReader();if(!reader)throw new Error('SETUP_INVALID');let data='',bytes=0;const decoder=new TextDecoder();
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done)break;bytes+=part.value.byteLength;if(bytes>524288)throw new Error('SETUP_TOO_LARGE');data+=decoder.decode(part.value,{stream:true});}return JSON.parse(data+decoder.decode()) as Record<string,unknown>;}finally{signal.removeEventListener('abort',cancel);cancel();}
 }
 private async get(path:string,key:string,aggregate:AbortSignal){
  const controller=new AbortController(),signal=AbortSignal.any([aggregate,controller.signal]);let timer:ReturnType<typeof setTimeout>|undefined,abort=()=>{};
  try{signal.throwIfAborted();return await Promise.race([this.request(path,key,signal),new Promise<never>((_,reject)=>{abort=()=>reject(new Error('SETUP_CANCELLED'));signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>controller.abort(),4000);if(signal.aborted)abort();})]);}finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();}
 }
 private async verify(signal:AbortSignal){for(const account of this.accounts)for(const agentId of account.agentIds){
  signal.throwIfAborted();const pin=this.pins[agentId];if(!pin||!this.remoteDigests[agentId])return false;
  const agent=await this.get('/get-agent/'+encodeURIComponent(agentId)+'?version='+pin.agentVersion,account.key,signal);signal.throwIfAborted();
  if(agent.agent_id!==agentId||agent.version!==pin.agentVersion||agent.is_published!==true||!contains(agent,AGENT_PATCH)||!contains(agent.response_engine,{type:'conversation-flow',conversation_flow_id:pin.flowId,version:pin.flowVersion})||agent.webhook_url!==this.origin+'/providers/retell/'+account.id+'/events')return false;
  const flow=await this.get('/get-conversation-flow/'+encodeURIComponent(pin.flowId)+'?version='+pin.flowVersion,account.key,signal);signal.throwIfAborted();
  if(flow.conversation_flow_id!==pin.flowId||flow.version!==pin.flowVersion||!contains(flow,materializeFlow(this.origin,account.id,this.handoff[account.id]))||remoteFlowDigest(flow)!==this.remoteDigests[agentId])return false;
 }return true;}
 async check(parent?:AbortSignal){const deadline=new AbortController(),signal=AbortSignal.any([deadline.signal,this.lifetime.signal,...(parent?[parent]:[])]);const timer=setTimeout(()=>deadline.abort(),5000);try{signal.throwIfAborted();return await this.verify(signal);}catch{return false;}finally{clearTimeout(timer);deadline.abort();}}
 close(){this.lifetime.abort();}
}
/** Closing cannot promote a pending verification into a cached success. */
export class SetupHealth {
 private expires=0;private inflight:Promise<boolean>|undefined;private ok=false;private lifetime=new AbortController();
 constructor(private verifier:SetupVerifier,private now:()=>number=Date.now,private ttlMs=30000){}
 async ready(){if(this.lifetime.signal.aborted)return false;if(this.ok&&this.now()<this.expires)return true;if(this.inflight)return this.inflight;this.inflight=this.verifier.check(this.lifetime.signal).catch(()=>false).then(ok=>{this.ok=ok&&!this.lifetime.signal.aborted;this.expires=this.ok?this.now()+this.ttlMs:0;return this.ok;}).finally(()=>{this.inflight=undefined;});return this.inflight;}
 close(){this.ok=false;this.expires=0;this.lifetime.abort();this.verifier.close?.();}
}
