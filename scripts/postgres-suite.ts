import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
const input=process.env.POSTGRES_TEST_URL;
if(!input||process.env.ALLOW_POSTGRES_TEST!=='1'){console.error('NOT_RUN: provide ALLOW_POSTGRES_TEST=1 and a loopback POSTGRES_TEST_URL ending in _test, or use test:postgres:local with a verified PostgreSQL prefix.');process.exit(2);}
try{const u=new URL(input);if(u.protocol!=='postgresql:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||!u.pathname.endsWith('_test')||u.search)throw new Error();}catch{console.error('REFUSED: dedicated loopback test database required');process.exit(2);}
const paths=readdirSync('dist/tests/postgres').filter(x=>x.endsWith('.test.js')).sort().map(x=>'dist/tests/postgres/'+x);
const child=spawn(process.execPath,['--test','--test-concurrency=1',...paths],{stdio:'inherit'});
child.on('error',()=>{console.error('POSTGRES_TEST_START_FAILED');process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
