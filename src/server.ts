import { createServer } from 'node:http';
import type { Engine } from './engine.js';
export async function startServer(engine:Pick<Engine,'config'|'request'> & {providerMock?:boolean},port=0,operations?:{ready:()=>Promise<boolean>;stopping:boolean}){
 let active=0,closed=false,closing:Promise<void>|undefined,complete=()=>{};
 const server=createServer(async(req,res)=>{
  active++;try{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.url==='/health'&&req.method==='GET'){res.end(JSON.stringify({status:'local-only',providerMock:engine.providerMock??true,adapter:'configured-loopback'}));return;}
  if(req.url==='/ready'&&req.method==='GET'){const ready=operations?await operations.ready():false;res.statusCode=ready?200:503;res.end(JSON.stringify({ready,providerMock:engine.providerMock??true}));return;}
  if(operations?.stopping){res.statusCode=503;res.end(JSON.stringify({code:'SHUTTING_DOWN',providerMock:engine.providerMock??true}));return;}
  const chunks:Buffer[]=[];let size=0,oversize=false;
  try{
   for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>engine.config.maxBodyBytes){oversize=true;res.statusCode=413;res.end(JSON.stringify({code:'BODY_TOO_LARGE',providerMock:engine.providerMock??true}));break;}chunks.push(Buffer.from(chunk));}
   if(oversize)return;
   const headers:Record<string,string|undefined>={};for(const name of ['x-signature','x-timestamp','x-retell-signature']){const v=req.headers[name];headers[name]=typeof v==='string'?v:undefined;}
   const result=await engine.request({method:req.method??'',path:req.url??'',body:Buffer.concat(chunks),headers});res.statusCode=result.status;res.end(JSON.stringify(result.body));
  }catch{if(!res.headersSent){res.statusCode=400;res.end(JSON.stringify({code:'REQUEST_ABORTED',providerMock:engine.providerMock??true}));}}
  }finally{active--;complete();}
 });
 server.requestTimeout=5000;server.headersTimeout=5000;server.maxHeadersCount=20;server.keepAliveTimeout=1000;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,engine.config.host,()=>{server.off('error',reject);resolve();});});
 const address=server.address();if(!address||typeof address==='string')throw new Error('LOOPBACK_BIND_FAILED');
 return {url:`http://127.0.0.1:${address.port}`,close:()=>{
  if(closing)return closing;
  closing=new Promise<void>((resolve,reject)=>{
   const timeout=setTimeout(()=>{server.closeAllConnections();reject(new Error('HTTP_DRAIN_TIMEOUT'));},5000);
   complete=()=>{if(closed&&active===0){clearTimeout(timeout);resolve();}};
   server.close(e=>{if(e){clearTimeout(timeout);reject(e);return;}closed=true;complete();});
   server.closeIdleConnections();
  });return closing;
 }};
}
