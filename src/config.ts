import { z } from 'zod';
import { isAbsolute,resolve,dirname,basename,join } from 'node:path';
import { existsSync,realpathSync,statSync } from 'node:fs';
function physicalPath(path:string):string {const normalized=resolve(path);if(existsSync(normalized))return realpathSync(normalized);return join(physicalPath(dirname(normalized)),basename(normalized));}
export function assertSeparateDatabases(core:string,provider:string){
 if(physicalPath(core)===physicalPath(provider))throw new Error('INVALID_CONFIG: separate physical databases required');
 if(existsSync(core)&&existsSync(provider)){const a=statSync(core),b=statSync(provider);if(a.dev===b.dev&&a.ino===b.ino)throw new Error('INVALID_CONFIG: separate physical databases required');}
}
const key=z.string().min(32).max(256).refine(v=>!v.startsWith('REPLACE_'),'Placeholder is not a credential');
const tenant=z.object({route:z.string().regex(/^[a-z0-9-]{1,32}$/),id:z.string().regex(/^[a-z0-9-]{1,64}$/),keys:z.object({event:key,tool:key,operator:key}).strict(),budgetMicros:z.number().int().min(0).max(1e9),maxCalls:z.number().int().min(1).max(10000)}).strict();
const schema=z.object({
 mode:z.literal('local'),host:z.literal('127.0.0.1'),
 dbPath:z.string().refine(isAbsolute),providerDbPath:z.string().refine(isAbsolute),
 maxAgeSeconds:z.number().int().min(1).max(300).default(300),
 maxBodyBytes:z.number().int().min(512).max(65536).default(16384),
 threshold:z.number().min(0).max(1).default(.88),
 confirmationTtlMs:z.number().int().min(1000).max(300000).default(120000),
 maxAttempts:z.number().int().min(1).max(5).default(3),
 maxCallDurationMs:z.number().int().min(1000).max(900000).default(300000),
 leaseMs:z.number().int().min(1000).max(60000).default(30000),
 commandCostMicros:z.number().int().min(1).max(100000).default(1000),
 maxRequestsPerMinute:z.number().int().min(1).max(10000).default(2000),
 tenants:z.array(tenant).min(1).max(10)
}).strict().superRefine((c,ctx)=>{
 if(c.dbPath===c.providerDbPath)ctx.addIssue({code:'custom',message:'Provider boundary needs separate database'});
 for(const field of ['id','route']as const)if(new Set(c.tenants.map(t=>t[field])).size!==c.tenants.length)ctx.addIssue({code:'custom',message:'Duplicate tenant mapping'});
 const keys=c.tenants.flatMap(t=>Object.values(t.keys));if(new Set(keys).size!==keys.length)ctx.addIssue({code:'custom',message:'Credentials must be role and tenant scoped'});
});
export type Config=z.infer<typeof schema>;
export type Tenant=Config['tenants'][number];
export function loadConfig(input:unknown):Config {const r=schema.safeParse(input);if(!r.success)throw new Error('INVALID_CONFIG: strict local configuration required');assertSeparateDatabases(r.data.dbPath,r.data.providerDbPath);return {...r.data,dbPath:physicalPath(r.data.dbPath),providerDbPath:physicalPath(r.data.providerDbPath)};}
