import { Socket } from 'node:net';
export const egressEvidence={blocked:0,loopbackFetches:0,externalRequests:0};
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const u=new URL(input instanceof Request?input.url:String(input));if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'){egressEvidence.blocked++;throw new Error('TEST_NON_LOOPBACK_FETCH_BLOCKED');}egressEvidence.loopbackFetches++;return nativeFetch(input,init);};
const connect=Socket.prototype.connect;
Socket.prototype.connect=function(this:Socket,...args:unknown[]){let first=args[0] as {host?:string;path?:string}|unknown[];if(Array.isArray(first))first=first[0] as {host?:string;path?:string};const host=typeof first==='object'&&first!==null?(first as {host?:string}).host:args[1];if(host!=='127.0.0.1'){egressEvidence.blocked++;throw new Error('TEST_NON_LOOPBACK_SOCKET_BLOCKED');}return Reflect.apply(connect,this,args) as Socket;} as typeof connect;
