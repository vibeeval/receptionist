import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync,readFileSync,statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../../src/engine.js';
import { fixtureConfig } from '../helpers.js';
import { SqliteAsyncStore } from '../../src/async-store.js';
import { AdminState } from '../../src/admin/state.js';
import { Auth,passwordHash } from '../../src/admin/auth.js';
import { startAdmin } from '../../src/admin/server.js';
export async function fixture(){const dir=mkdtempSync(join(tmpdir(),'admin-test-'));const engine=new Engine(fixtureConfig(dir)),db=new SqliteAsyncStore(engine.store),key=randomBytes(32),state=new AdminState(join(dir,'admin.sqlite'),Buffer.from(key));const hash=await passwordHash('dummy-test-password');const users=([{username:'admin',passwordHash:hash,tenants:{'tenant-a':'admin'}},{username:'operator',passwordHash:hash,tenants:{'tenant-a':'operator'}},{username:'viewer',passwordHash:hash,tenants:{'tenant-a':'viewer'}}] as const).map(x=>({...x}));const server=await startAdmin({engine,db,state,users,port:0,demo:true,ready:async()=>true});const url=server.url;
async function login(username='admin'){const r=await fetch(url+'/api/login',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({username,password:'dummy-test-password'})});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie')!.split(';')[0]!;assert.match(r.headers.get('set-cookie')!,/HttpOnly; SameSite=Strict/);const s=await(await fetch(url+'/api/session',{headers:{Cookie:cookie}})).json() as {csrf:string};return {cookie,csrf:s.csrf};}
async function request(path:string,loginData:{cookie:string;csrf:string},body?:unknown,extra:Record<string,string>={}){return fetch(url+path,{method:body===undefined?'GET':'POST',headers:{Cookie:loginData.cookie,Origin:url,'Content-Type':'application/json','X-CSRF-Token':loginData.csrf,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});}
let closed=false;return {dir,engine,db,state,key,users,server,login,request,stop:async()=>{if(closed)return;closed=true;await server.close();state.close();engine.close();},close:async()=>{if(!closed){closed=true;await server.close();state.close();engine.close();}rmSync(dir,{recursive:true,force:true});}};}
