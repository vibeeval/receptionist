import { z } from 'zod';
import { loadConfig,type Config } from './config.js';
const ref=z.string().regex(/^env:[A-Z][A-Z0-9_]{2,80}$/);
const ident=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const compositionSchema=z.object({profile:z.enum(['disabled','test','live']).default('disabled'),enableLive:z.boolean().default(false),
 database:z.discriminatedUnion('kind',[z.object({kind:z.literal('sqlite')}).strict(),z.object({kind:z.literal('postgres'),urlRef:ref,schema:ident,mode:z.enum(['local-test','production'])}).strict()]).default({kind:'sqlite'}),
 autonomous:z.object({setup:z.object({origin:z.string().url(),remoteDigests:z.record(ident,z.string().regex(/^[a-f0-9]{64}$/)),handoffNumbers:z.record(ident,z.string().regex(/^\+[1-9][0-9]{7,14}$/))}).strict().optional(),pins:z.record(z.string(),z.object({agentVersion:z.number().int().nonnegative(),flowId:ident,flowVersion:z.number().int().nonnegative(),artifactSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict())}).strict().optional(),
 accounts:z.array(z.object({id:z.string().regex(/^[a-z0-9-]{1,32}$/),keyRef:ref,tenantRoute:z.string(),agentIds:z.array(ident.refine(v=>!v.startsWith('REPLACE_'))).min(1)}).strict()).min(1),
 google:z.object({oauth:z.object({clientIdRef:ref,clientSecretRef:ref,refreshTokenRef:ref,encryptionKeyRef:ref}).strict().optional(),availability:z.boolean().default(false),freeBusyScope:z.literal('https://www.googleapis.com/auth/calendar.events.freebusy').optional(),accessTokenRef:ref.optional(),scope:z.literal('https://www.googleapis.com/auth/calendar.events.owned'),calendars:z.record(z.string(),z.string().min(1).max(256).refine(v=>!v.startsWith('REPLACE_')&&v!=='primary'&&!/[\r\n]/.test(v)))}).strict(),
 crm:z.object({enabled:z.boolean().default(false),url:z.string().url(),allowedTargets:z.array(z.string().url()),keyRef:ref}).strict().optional(),
 schedules:z.array(z.object({tenant:ident,resource:ident,service:z.string().min(1).max(100),weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7),startMinute:z.number().int().min(0).max(1439),endMinute:z.number().int().min(1).max(1440),durationMinutes:z.number().int().min(5).max(480),horizonDays:z.number().int().min(1).max(30)}).strict()).max(20).optional(),
 slots:z.array(z.object({tenant:ident,id:ident,resource:ident,startMs:z.number().int().nonnegative().max(8640000000000000),endMs:z.number().int().positive().max(8640000000000000),service:z.string().min(1).max(100)}).strict()).max(1000),
 knowledge:z.record(z.string(),z.object({name:z.string().min(1).max(100),policy:z.string().min(1).max(2000),service:z.string().min(1).max(100)}).strict())
}).strict();
export type SecretResolver=(reference:string)=>string;
export function environmentSecret(reference:string){if(!ref.safeParse(reference).success)throw new Error('INVALID_SECRET_REFERENCE');const value=process.env[reference.slice(4)];if(!value||value.startsWith('REPLACE_'))throw new Error('MISSING_REFERENCED_SECRET');return value;}
export function coreFromReferences(input:unknown,resolve:SecretResolver):Config{
 const raw=z.object({tenants:z.array(z.object({keys:z.object({event:ref,tool:ref,operator:ref}).strict()}).passthrough())}).passthrough().parse(input);
 return loadConfig({...raw,tenants:raw.tenants.map(t=>({...t,keys:{event:resolve(t.keys.event),tool:resolve(t.keys.tool),operator:resolve(t.keys.operator)}}))});
}
