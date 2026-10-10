import { writeFileSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { FLOW,FLOW_DIGEST,AGENT_PATCH,materializeFlow } from '../src/autonomous/flow.js';
import { canonical,digest } from '../src/security.js';
// Generates files only. No credentials, API calls or deployment.
const dir=resolve(process.argv[2]??'flows'),base=process.argv[3]??'https://receptionist.invalid',account=process.argv[4]??'account-a';
const u=new URL(base);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!/^[a-z0-9-]{1,32}$/.test(account))throw new Error('HTTPS_ORIGIN_AND_ACCOUNT_REQUIRED');
const flow=materializeFlow(u.origin,account,process.argv[5]);
mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'autonomous-flow.v1.json'),JSON.stringify(flow,null,2)+'\n');writeFileSync(resolve(dir,'autonomous-agent-patch.v1.json'),JSON.stringify(AGENT_PATCH,null,2)+'\n');writeFileSync(resolve(dir,'autonomous-flow.manifest.json'),JSON.stringify({revision:1,sdk:'retell-sdk@6.2.4',templateSha256:FLOW_DIGEST,materializedSha256:digest(canonical(flow)),providerImported:false,agentBinding:'REQUIRED_AFTER_APPROVED_IMPORT',note:'Runtime artifactSha256 pins the versioned template. Materialized digest also requires deployment review. Remote published agent/flow mapping must be checked before live enablement.'},null,2)+'\n');
console.log(JSON.stringify({filesGenerated:3,externalRequests:0,providerImported:false}));
