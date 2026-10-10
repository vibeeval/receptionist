import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
export class AppError extends Error {constructor(public readonly status:number,public readonly code:string){super(code);}}
export function signRequest(key:string,timestamp:string,method:string,path:string,body:Buffer):string {
 return createHmac('sha256',key).update(timestamp+'\n'+method+'\n'+path+'\n').update(body).digest('hex');
}
export function verify(key:string,headers:Record<string,string|undefined>,method:string,path:string,body:Buffer,now:number,maxAge:number){
 const ts=headers['x-timestamp'];const sig=headers['x-signature'];
 if(!ts||!sig||!/^\d{10,11}$/.test(ts)||!/^[a-f0-9]{64}$/.test(sig))throw new AppError(401,'UNAUTHENTICATED');
 if(Math.abs(now/1000-Number(ts))>maxAge)throw new AppError(401,'STALE_SIGNATURE');
 if(!timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(signRequest(key,ts,method,path,body),'hex')))throw new AppError(401,'UNAUTHENTICATED');
}
export function digest(value:string|Buffer){return createHash('sha256').update(value).digest('hex');}
export function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value);
}
