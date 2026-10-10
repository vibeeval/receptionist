import WebSocket from 'ws';
export interface MonitorConnection {close():void;}
export interface MonitorTransport {connect(input:{url:string;key:string;message:(data:string)=>void;closed:(code:number,reason:string)=>void}):Promise<MonitorConnection>;}
/** No socket is created until connect. Never used by tests without an injected factory. */
export class RetellMonitorTransport implements MonitorTransport {
 constructor(private factory:(url:string,options:WebSocket.ClientOptions)=>WebSocket=(u,o)=>new WebSocket(u,o)){}
 async connect(input:Parameters<MonitorTransport['connect']>[0]){
  if(!/^wss:\/\/api\.retellai\.com\/v2\/monitor-call\/[A-Za-z0-9_-]{1,128}$/.test(input.url)||!input.key||/[\r\n]/.test(input.key))throw new Error('INVALID_MONITOR_TARGET');
  const ws=this.factory(input.url,{headers:{Authorization:'Bearer '+input.key},followRedirects:false,handshakeTimeout:5000,maxPayload:262144,perMessageDeflate:false,rejectUnauthorized:true});
  ws.on('message',(data,binary)=>{if(binary){ws.close(1008,'text_required');return;}input.message(data.toString());});
  ws.on('close',(code,reason)=>input.closed(code,reason.toString()));ws.on('error',()=>{});
  await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',()=>reject(new Error('MONITOR_UNAVAILABLE')));ws.once('close',()=>reject(new Error('MONITOR_CLOSED_BEFORE_OPEN')));});
  return {close:()=>ws.terminate()};
 }
}
