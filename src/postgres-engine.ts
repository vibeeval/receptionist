import { Engine } from './engine.js';
import { PgStore } from './pg-store.js';
import { loadConfig,type Config } from './config.js';
/** Explicit local-test composition. Never selected from webhook payloads. */
export async function createPostgresEngine(config:Config,connectionString:string,schema:string,options:{clock?:()=>number;log?:(entry:object)=>void}={}){
 const validated=loadConfig(config);const store=await PgStore.open(validated,connectionString,schema,'local-test',{seedDemo:true});
 try{return new Engine(validated,{...options,store});}catch(e){await store.close();throw e;}
}
