import { createServer,type IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Engine } from '../engine.js';
import type { PgStore } from '../pg-store.js';
import type { Store } from '../store.js';
import type { AsyncStore } from '../async-store.js';
import { AppError,signRequest } from '../security.js';
import { Auth,usersSchema,type User } from './auth.js';
import { AdminState,secretKind } from './state.js';
const loginSchema=z.object({username:z.string().max(48),password:z.string().min(1).max(256)}).strict();
const saveSchema=z.object({value:z.unknown(),revision:z.number().int().nonnegative()}).strict();
const secretSchema=z.object({kind:secretKind,value:z.string().min(8).max(8192).refine(v=>!/[\r\n\0]/.test(v))}).strict();
const limitSchema=z.object({cap:z.number().int().min(0).max(1e9),revision:z.number().int().nonnegative()}).strict();
const controlSchema=z.object({kill:z.boolean(),revision:z.number().int().nonnegative(),operationId:z.string().uuid()}).strict();
const parse=<T>(s:z.ZodType<T>,v:unknown)=>{const r=s.safeParse(v);if(!r.success)throw new AppError(400,'INVALID_INPUT');return r.data;};
const equal=(a:string,b:string)=>/^[a-f0-9]{64}$/.test(a)&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function body(req:IncomingMessage){if(req.headers['content-type']!=='application/json')throw new AppError(415,'JSON_REQUIRED');const chunks:Buffer[]=[];let size=0;for await(const c of req){size+=Buffer.byteLength(c);if(size>16384)throw new AppError(413,'BODY_TOO_LARGE');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new AppError(400,'INVALID_JSON');}}
export type AdminOptions={engine:Engine<Store|PgStore>;db:AsyncStore;state:AdminState;users:User[];port?:number;demo?:boolean;ready:()=>Promise<boolean>;effectiveBusiness?:Record<string,unknown>};
export async function startAdmin(o:AdminOptions){
 const users=usersSchema.parse(o.users);for(const u of users)for(const t of Object.keys(u.tenants))if(!o.engine.config.tenants.some(x=>x.id===t))throw new Error('ADMIN_UNKNOWN_TENANT');
 await o.db.run('CREATE TABLE IF NOT EXISTS dashboard_limits(tenant TEXT PRIMARY KEY,cap BIGINT NOT NULL,revision BIGINT NOT NULL)');
 await o.db.transaction(async()=>{for(const t of o.engine.config.tenants){const limit=await o.db.one('SELECT cap FROM dashboard_limits WHERE tenant=?',t.id);if(limit)await o.db.run('UPDATE budgets SET cap=? WHERE tenant=?',Number(limit.cap),t.id);}});
 const auth=new Auth(users);
 let origin='',host='';const cookieName='receptionist_admin';
 const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','microphone=(), camera=(), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const json=(status:number,data:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
  try{
   if(req.headers.host!==host||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))throw new AppError(403,'LOCALHOST_ONLY');
   if(req.headers['sec-fetch-site']==='cross-site')throw new AppError(403,'ORIGIN_REJECTED');
   if(!auth.allow('global',600))throw new AppError(429,'RATE_LIMITED');
   const path=req.url??'';const asset=assets.get(path);
   if(req.method==='GET'&&asset){res.setHeader('Content-Type',asset[1]!);res.end(readFileSync(new URL('../../../public/dashboard/'+asset[0],import.meta.url)));return;}
   if(!path.startsWith('/api/'))throw new AppError(404,'NOT_FOUND');
   if(req.method!=='GET'&&req.headers.origin!==origin)throw new AppError(403,'ORIGIN_REJECTED');
   const token=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)??'';
   if(path==='/api/login'&&req.method==='POST'){
    if(!auth.allow('login',10,300000))throw new AppError(429,'LOGIN_RATE_LIMITED');const input=parse(loginSchema,await body(req));const result=await auth.login(input.username,input.password);
    if(!result){o.state.audit('_auth','anonymous','LOGIN_REJECTED');throw new AppError(401,'LOGIN_FAILED');}
    if(token)auth.logout(token);for(const t of Object.keys(auth.session(result.token)!.user.tenants))o.state.audit(t,input.username,'LOGIN_SUCCEEDED');res.setHeader('Set-Cookie',`${cookieName}=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);json(200,{authenticated:true});return;
   }
   const session=auth.session(token);if(!session)throw new AppError(401,'LOGIN_REQUIRED');
   if(!auth.allow('user:'+session.user.username,240))throw new AppError(429,'RATE_LIMITED');
   if(req.method!=='GET'&&!equal(String(req.headers['x-csrf-token']??''),session.csrf))throw new AppError(403,'CSRF_REJECTED');
   if(path==='/api/session'&&req.method==='GET'){json(200,{username:session.user.username,csrf:session.csrf,tenants:Object.entries(session.user.tenants).map(([id,role])=>({id,role})),demo:o.demo===true});return;}
   if(path==='/api/logout'&&req.method==='POST'){auth.logout(token);res.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);json(200,{loggedOut:true});return;}
   const match=/^\/api\/tenants\/([a-z0-9-]{1,64})\/(overview|calls|bookings|errors|audit|business|connections|control|limits)$/.exec(path);if(!match)throw new AppError(404,'NOT_FOUND');
   const tenant=match[1]!,route=match[2]!,role=session.user.tenants[tenant];if(!role)throw new AppError(403,'TENANT_FORBIDDEN');
   if(req.method==='GET'){
    if(route==='overview'){
     const data=await o.db.transaction(async()=>({calls:Number((await o.db.one('SELECT count(*) n FROM calls WHERE tenant=?',tenant))?.n??0),bookings:Number((await o.db.one('SELECT count(*) n FROM commands WHERE tenant=?',tenant))?.n??0),confirmed:Number((await o.db.one("SELECT count(*) n FROM commands WHERE tenant=? AND state='confirmed'",tenant))?.n??0),errors:Number((await o.db.one("SELECT count(*) n FROM dlq WHERE tenant=? AND state='needs_operator'",tenant))?.n??0),budget:await o.db.budget(tenant),limitRevision:Number((await o.db.one('SELECT revision FROM dashboard_limits WHERE tenant=?',tenant))?.revision??0),kill:await o.db.killed(tenant),revision:Number((await o.db.one('SELECT revision FROM control_revisions WHERE tenant=?',tenant))?.revision??0)}));
     const t=o.engine.config.tenants.find(x=>x.id===tenant)!;json(200,{...data,maxCalls:t.maxCalls,ready:await o.ready(),providerMock:o.engine.providerMock,demo:o.demo===true,providerInvoice:null,providerInvoiceReason:'NOT_CONNECTED',costUnit:'core_reservation_micros',observedAt:Date.now()});return;
    }
    if(route==='calls'){json(200,{items:await o.db.all('SELECT id,state,started_ms,last_event_ms FROM calls WHERE tenant=? ORDER BY started_ms DESC LIMIT 100',tenant),limit:100});return;}
    if(route==='bookings'){json(200,{items:await o.db.all('SELECT c.id,c.call_id,c.state,c.created_ms,c.provider_mock,s.start_ms,s.end_ms,s.service FROM commands c JOIN slots s ON s.tenant=c.tenant AND s.id=c.slot_id WHERE c.tenant=? ORDER BY c.created_ms DESC LIMIT 100',tenant),limit:100});return;}
    if(route==='errors'){const rows=await o.db.all('SELECT d.job_id,d.reason,d.state,d.created_ms,j.kind,j.attempts FROM dlq d JOIN jobs j ON j.id=d.job_id AND j.tenant=d.tenant WHERE d.tenant=? ORDER BY d.created_ms DESC LIMIT 100',tenant);json(200,{items:rows.map(x=>({...x,reason:/^[A-Z0-9_]{1,80}$/.test(String(x.reason))?x.reason:'REVIEW_REQUIRED'})),replayAvailable:false});return;}
    if(route==='audit'){json(200,{items:await o.db.all('SELECT id,action,at_ms FROM audit WHERE tenant=? ORDER BY id DESC LIMIT 100',tenant),admin:o.state.actions(tenant)});return;}
    if(route==='business'){json(200,{draft:o.state.draft(tenant),effective:o.effectiveBusiness?.[tenant]??null,activationAvailable:false});return;}
    if(route==='connections'){json(200,{items:o.state.connections(tenant),runtimeProviderMock:o.engine.providerMock,activationAvailable:false,liveVerificationAvailable:false});return;}
   }
   if(req.method!=='POST')throw new AppError(405,'METHOD_NOT_ALLOWED');
   if(route==='control'){
    if(role==='viewer')throw new AppError(403,'ROLE_FORBIDDEN');const input=parse(controlSchema,await body(req));const t=o.engine.config.tenants.find(x=>x.id===tenant)!;
    o.state.audit(tenant,session.user.username,input.kill?'STOP_REQUESTED':'RESUME_REQUESTED');
    const p=`/v1/tenants/${t.route}/control`,b=Buffer.from(JSON.stringify({kill:input.kill,expectedRevision:input.revision,operationId:input.operationId})),ts=String(Math.floor(Date.now()/1000));
    const result=await o.engine.request({method:'POST',path:p,body:b,headers:{'x-timestamp':ts,'x-signature':signRequest(t.keys.operator,ts,'POST',p,b)}});
    o.state.audit(tenant,session.user.username,result.status===200?'CONTROL_APPLIED':'CONTROL_REJECTED');json(result.status,result.body);return;
   }
   if(role!=='admin')throw new AppError(403,'ROLE_FORBIDDEN');
   if(route==='limits'){const input=parse(limitSchema,await body(req));await o.db.transaction(async()=>{const old=await o.db.one('SELECT revision FROM dashboard_limits WHERE tenant=?',tenant);if(Number(old?.revision??0)!==input.revision)throw new AppError(409,'STALE_REVISION');await o.db.run('INSERT INTO dashboard_limits VALUES(?,?,?) ON CONFLICT(tenant) DO UPDATE SET cap=excluded.cap,revision=excluded.revision',tenant,input.cap,input.revision+1);await o.db.run('UPDATE budgets SET cap=? WHERE tenant=?',input.cap,tenant);await o.db.audit(tenant,'ADMIN_BUDGET_UPDATED',session.user.username,Date.now());});json(200,{cap:input.cap,revision:input.revision+1,providerHardCap:false});return;}
   if(route==='business'){const input=parse(saveSchema,await body(req));json(200,o.state.saveDraft(tenant,session.user.username,input.value,input.revision));return;}
   if(route==='connections'){if(!auth.allow('secret:'+session.user.username,10))throw new AppError(429,'RATE_LIMITED');const input=parse(secretSchema,await body(req));json(200,o.state.saveSecret(tenant,session.user.username,input.kind,input.value));return;}
   throw new AppError(404,'NOT_FOUND');
  }catch(e){if(!res.headersSent)json(e instanceof AppError?e.status:500,{code:e instanceof AppError?e.code:'ADMIN_INTERNAL_ERROR',requestId:randomUUID()});else res.end();}
 });
 server.requestTimeout=5000;server.headersTimeout=5000;server.maxHeadersCount=30;server.keepAliveTimeout=1000;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(o.port??8788,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
 const address=server.address();if(!address||typeof address==='string')throw new Error('ADMIN_BIND_FAILED');host='127.0.0.1:'+address.port;origin='http://'+host;
 return {url:origin,close:async()=>{auth.close();server.closeAllConnections();await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}};
}
