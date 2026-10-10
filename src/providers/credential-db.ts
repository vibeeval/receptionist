import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import type {AsyncStore} from '../async-store.js';
import {CredentialError,type CredentialStore,type CredentialSession,type CredentialRecord} from './credentials.js';
/** Store encryption key is an environment-resolved hex256 key; never placed in the database.
 * DB transaction locks serialize refresh across processes and release on process death.
 * Callback errors commit already-written invalidation/rotation, then propagate outside COMMIT.
 * Refresh intents commit before HTTP, which runs outside transactions. Pending owner/generation
 * fencing makes orphan recovery fail closed without replaying a possibly rotated grant.
 */
export class EncryptedCredentialStore implements CredentialStore {
 constructor(private db:AsyncStore,private key:()=>string,private id='google'){if(!/^[a-z0-9_-]{1,64}$/.test(id))throw new CredentialError('INVALID_CREDENTIAL_ID');this.keyBytes();}
 async migrate(){await this.db.transaction(async()=>{await this.db.run('CREATE TABLE IF NOT EXISTS encrypted_credentials(id TEXT PRIMARY KEY, envelope TEXT NOT NULL)');});}
 private keyBytes(){const value=this.key();if(!/^[a-fA-F0-9]{64}$/.test(value))throw new CredentialError('INVALID_CREDENTIAL_ENCRYPTION_KEY');return Buffer.from(value,'hex');}
 private encrypt(record:CredentialRecord){const key=this.keyBytes();try{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('receptionist:credentials:v1:'+this.id));const data=Buffer.concat([cipher.update(JSON.stringify(record),'utf8'),cipher.final()]);return JSON.stringify({v:1,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('base64')});}finally{key.fill(0);}}
 private decrypt(envelope:string):CredentialRecord{const key=this.keyBytes();try{const value=JSON.parse(envelope);if(value.v!==1||!/^([a-f0-9]{24})$/.test(value.iv)||!/^([a-f0-9]{32})$/.test(value.tag)||typeof value.data!=='string'||value.data.length>65536)throw 0;const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'hex'));decipher.setAAD(Buffer.from('receptionist:credentials:v1:'+this.id));decipher.setAuthTag(Buffer.from(value.tag,'hex'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString('utf8')) as CredentialRecord;}catch{throw new CredentialError('CREDENTIAL_DECRYPT_FAILED');}finally{key.fill(0);}}
 async exclusive<T>(fn:(session:CredentialSession)=>Promise<T>):Promise<T>{
  const result=await this.db.transaction(async()=>{
   const session:CredentialSession={read:async()=>{const row=await this.db.one('SELECT envelope FROM encrypted_credentials WHERE id=?',this.id);return row?this.decrypt(String(row.envelope)):undefined;},write:async record=>{const envelope=this.encrypt(record);await this.db.run('INSERT INTO encrypted_credentials(id,envelope) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET envelope=excluded.envelope',this.id,envelope);}};
   try{return {ok:true as const,value:await fn(session)};}catch(error){return {ok:false as const,error};}
  });if(!result.ok)throw result.error;return result.value;
 }
}
