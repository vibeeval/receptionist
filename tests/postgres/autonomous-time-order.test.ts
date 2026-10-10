import '../composition/no-egress.js';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { setup } from '../autonomous/fixture.js';
import { timeCases,rejectTimeCase } from '../autonomous/time-cases.js';
for(const mode of timeCases)test('real PG strict proposal time order: '+mode,async()=>{
 const schema='phone_test_time_'+randomBytes(6).toString('hex');const h=await setup({kind:'postgres',mode:'local-test',urlRef:'env:POSTGRES_TEST_URL',schema});
 try{await rejectTimeCase(h,mode);}finally{await h.close();const pool=new Pool({connectionString:process.env.POSTGRES_TEST_URL});try{await pool.query('DROP SCHEMA "'+schema+'" CASCADE');}finally{await pool.end();}}
});
