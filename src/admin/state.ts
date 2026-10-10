import { DatabaseSync } from 'node:sqlite';
import { chmodSync,lstatSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createCipheriv,randomBytes,createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../security.js';
export const businessSchema=z.object({name:z.string().trim().min(1).max(100),service:z.string().trim().min(1).max(100),policy:z.string().trim().max(2000),timezone:z.literal('Europe/Istanbul'),weekdays:z.array(z.number().int().min(1).max(7)).min(1).max(7).refine(x=>new Set(x).size===x.length),startMinute:z.number().int().min(0).max(1439),endMinute:z.number().int().min(1).max(1440),durationMinutes:z.number().int().min(5).max(240)}).strict().refine(x=>x.endMinute>x.startMinute&&x.durationMinutes<=x.endMinute-x.startMinute);
export const secretKind=z.enum(['retellApiKey','googleClientId','googleClientSecret','googleRefreshToken']);
export type SecretKind=z.infer<typeof secretKind>;
export class AdminState {
 readonly db:DatabaseSync;
 constructor(path:string,private key:Buffer){
  if(key.length!==32)throw new Error('ADMIN_ENCRYPTION_KEY_REQUIRED');
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const parent=lstatSync(dirname(path));
  if(parent.isSymbolicLink())throw new Error('ADMIN_DIRECTORY_SYMLINK');
  if(!parent.isDirectory()||(parent.mode&0o077)!==0||(process.getuid&&parent.uid!==process.getuid()))throw new Error('ADMIN_DIRECTORY_PERMISSIONS');
  try{const existing=lstatSync(path);if(existing.isSymbolicLink())throw new Error('ADMIN_FILE_SYMLINK');if(!existing.isFile()||existing.nlink!==1||(existing.mode&0o077)!==0||(process.getuid&&existing.uid!==process.getuid()))throw new Error('ADMIN_FILE_PERMISSIONS');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  this.db=new DatabaseSync(path);chmodSync(path,0o600);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS vault_meta(id INTEGER PRIMARY KEY,fingerprint TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS drafts(tenant TEXT PRIMARY KEY,body TEXT NOT NULL,revision INTEGER NOT NULL,updated INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS vault(tenant TEXT NOT NULL,kind TEXT NOT NULL,cipher TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(tenant,kind));
   CREATE TABLE IF NOT EXISTS actions(id INTEGER PRIMARY KEY,tenant TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,at_ms INTEGER NOT NULL);
   CREATE TRIGGER IF NOT EXISTS actions_no_update BEFORE UPDATE ON actions BEGIN SELECT RAISE(ABORT,'append_only'); END;
   CREATE TRIGGER IF NOT EXISTS actions_no_delete BEFORE DELETE ON actions BEGIN SELECT RAISE(ABORT,'append_only'); END;`);
  const fingerprint=createHash('sha256').update(key).digest('hex');const prior=this.db.prepare('SELECT fingerprint FROM vault_meta WHERE id=1').get();
  if(prior&&prior.fingerprint!==fingerprint){this.db.close();throw new Error('ADMIN_ENCRYPTION_KEY_MISMATCH');}
  this.db.prepare('INSERT OR IGNORE INTO vault_meta VALUES(1,?)').run(fingerprint);
 }
 audit(tenant:string,actor:string,action:string){this.db.prepare('INSERT INTO actions(tenant,actor,action,at_ms) VALUES(?,?,?,?)').run(tenant,createHash('sha256').update(actor).digest('hex').slice(0,12),action,Date.now());}
 transaction<T>(f:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const r=f();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 draft(tenant:string){const row=this.db.prepare('SELECT body,revision,updated FROM drafts WHERE tenant=?').get(tenant);return row?{value:JSON.parse(String(row.body)),revision:Number(row.revision),updated:Number(row.updated),active:false}:{value:null,revision:0,updated:null,active:false};}
 saveDraft(tenant:string,actor:string,value:unknown,revision:number){const parsed=businessSchema.safeParse(value);if(!parsed.success)throw new AppError(400,'INVALID_BUSINESS');return this.transaction(()=>{const old=this.draft(tenant);if(old.revision!==revision)throw new AppError(409,'STALE_REVISION');const updated=Date.now();this.db.prepare('INSERT INTO drafts VALUES(?,?,?,?) ON CONFLICT(tenant) DO UPDATE SET body=excluded.body,revision=excluded.revision,updated=excluded.updated').run(tenant,JSON.stringify(parsed.data),revision+1,updated);this.audit(tenant,actor,'BUSINESS_DRAFT_SAVED');return this.draft(tenant);});}
 // There is deliberately no browser-facing read/decrypt method or automatic provider activation.
 saveSecret(tenant:string,actor:string,kind:SecretKind,value:string){return this.transaction(()=>{const nonce=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',this.key,nonce);cipher.setAAD(Buffer.from(tenant+'\0'+kind));const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);const blob=Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64');this.db.prepare('INSERT INTO vault VALUES(?,?,?,?) ON CONFLICT(tenant,kind) DO UPDATE SET cipher=excluded.cipher,updated=excluded.updated').run(tenant,kind,blob,Date.now());this.audit(tenant,actor,'SECRET_SAVED_'+kind);return {stored:true,verified:false,active:false};});}
 connections(tenant:string){const rows=this.db.prepare('SELECT kind,updated FROM vault WHERE tenant=?').all(tenant);return secretKind.options.map(kind=>({kind,stored:rows.some(r=>r.kind===kind),updated:rows.find(r=>r.kind===kind)?.updated??null,verified:false,active:false}));}
 actions(tenant:string){return this.db.prepare('SELECT id,actor,action,at_ms FROM actions WHERE tenant=? ORDER BY id DESC LIMIT 100').all(tenant);}
 close(){this.db.close();this.key.fill(0);}
}
