import { scrypt as callbackScrypt,randomBytes,timingSafeEqual,createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
const scrypt=promisify(callbackScrypt);
export const usersSchema=z.array(z.object({username:z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),passwordHash:z.string().regex(/^[a-f0-9]{32}:[a-f0-9]{128}$/),tenants:z.record(z.string().regex(/^[a-z0-9-]{1,64}$/),z.enum(['admin','operator','viewer'])).refine(t=>Object.keys(t).length>0)}).strict()).min(1).max(50).refine(a=>new Set(a.map(x=>x.username)).size===a.length);
export type User=z.infer<typeof usersSchema>[number];
export type Session={user:User;csrf:string;expires:number;absolute:number};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function passwordHash(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64) as Buffer).toString('hex');}
export class Auth {
 private sessions=new Map<string,Session>();private rates=new Map<string,{count:number;until:number}>();
 readonly users:User[];
 constructor(users:User[],private now:()=>number=Date.now){this.users=usersSchema.parse(users);}
 allow(key:string,limit:number,windowMs=60000){const now=this.now();for(const [k,v]of this.rates)if(v.until<=now)this.rates.delete(k);let r=this.rates.get(key);if(!r){if(this.rates.size>=2000)return false;r={count:0,until:now+windowMs};this.rates.set(key,r);}return ++r.count<=limit;}
 async login(name:string,password:string){const user=this.users.find(u=>u.username===name);const [salt,expected]=(user?.passwordHash??'0'.repeat(32)+':'+ '0'.repeat(128)).split(':');const actual=await scrypt(password,salt!,64) as Buffer;if(!user||!timingSafeEqual(actual,Buffer.from(expected!,'hex')))return undefined;this.prune();if(this.sessions.size>=200) return undefined;const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');this.sessions.set(hash(token),{user,csrf,expires:this.now()+900000,absolute:this.now()+28800000});return {token,csrf};}
 private prune(){for(const [k,s]of this.sessions)if(s.expires<=this.now()||s.absolute<=this.now())this.sessions.delete(k);}
 session(token:string){this.prune();const s=this.sessions.get(hash(token));if(s)s.expires=Math.min(this.now()+900000,s.absolute);return s;}
 logout(token:string){this.sessions.delete(hash(token));}
 close(){this.sessions.clear();this.rates.clear();}
}
