import { readFileSync,lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { Engine } from '../engine.js';
import type { Store } from '../store.js';
import type { PgStore } from '../pg-store.js';
import { assertSeparateDatabases } from '../config.js';
import { SqliteAsyncStore } from '../async-store.js';
import { Store as SqliteStore } from '../store.js';
import { AdminState } from './state.js';
import { usersSchema } from './auth.js';
import { startAdmin } from './server.js';
export async function bootstrapAdmin(engine:Engine<Store|PgStore>,ready:()=>Promise<boolean>){
 if(process.env.ADMIN_ENABLED!=='true')return undefined;
 const file=process.env.ADMIN_USERS_PATH,path=process.env.ADMIN_DB_PATH,key=process.env.ADMIN_ENCRYPTION_KEY;
 if(!file||!path||!isAbsolute(file)||!isAbsolute(path)||!key||! /^[a-fA-F0-9]{64}$/.test(key))throw new Error('ADMIN_CONFIG_REQUIRED');
 let permissions;try{permissions=lstatSync(file);}catch{throw new Error('ADMIN_USERS_FILE_UNAVAILABLE');}
 if(!permissions.isFile()||permissions.isSymbolicLink()||permissions.nlink!==1||(permissions.mode&0o077)!==0||(process.getuid&&permissions.uid!==process.getuid()))throw new Error('ADMIN_USERS_FILE_PERMISSIONS');
 assertSeparateDatabases(path,engine.config.dbPath);assertSeparateDatabases(path,engine.config.providerDbPath);
 let users;try{users=usersSchema.parse(JSON.parse(readFileSync(file,'utf8')));}catch{throw new Error('ADMIN_USERS_CONFIG_INVALID');}
 const port=Number(process.env.ADMIN_PORT??8788);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('ADMIN_PORT_INVALID');
 const state=new AdminState(path,Buffer.from(key,'hex'));
 try{const app=await startAdmin({engine,db:engine.store instanceof SqliteStore?new SqliteAsyncStore(engine.store):engine.store,state,users,port,ready});return {url:app.url,close:async()=>{await app.close();state.close();}};}catch(e){state.close();throw e;}
}
