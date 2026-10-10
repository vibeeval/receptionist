import test from 'node:test';
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
test('provider test command blocks fetch and socket connect before egress',async()=>{await assert.rejects(()=>fetch('https://offline.invalid'),/OFFLINE_NETWORK_FORBIDDEN/);const socket=new Socket();try{assert.throws(()=>socket.connect({host:'offline.invalid',port:443}),/OFFLINE_NETWORK_FORBIDDEN/);}finally{socket.destroy();}});
