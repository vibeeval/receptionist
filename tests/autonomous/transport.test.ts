import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import { RetellMonitorTransport } from '../../src/autonomous/transport.js';
test('native monitor transport fixed TLS origin, Bearer auth, redirect disabled; injected socket only',async()=>{
 const socket=new EventEmitter() as EventEmitter & {terminate:()=>void;close:()=>void};let closed=0;socket.terminate=()=>{closed++;};socket.close=()=>{closed++;};let seen:WebSocket.ClientOptions|undefined;
 const transport=new RetellMonitorTransport((url,options)=>{assert.equal(url,'wss://api.retellai.com/v2/monitor-call/call_1');seen=options;queueMicrotask(()=>socket.emit('open'));return socket as unknown as WebSocket;});
 const messages:string[]=[];const connection=await transport.connect({url:'wss://api.retellai.com/v2/monitor-call/call_1',key:'synthetic-key',message:x=>messages.push(x),closed:()=>{}});
 assert.deepEqual(seen?.headers,{Authorization:'Bearer synthetic-key'});assert.equal(seen?.rejectUnauthorized,true);assert.equal(seen?.followRedirects,false);assert.equal(seen?.maxPayload,262144);
 socket.emit('message',Buffer.from('{"type":"test"}'),false);assert.equal(messages.length,1);socket.emit('message',Buffer.from('binary'),true);assert.equal(closed,1);connection.close();assert.equal(closed,2);
 await assert.rejects(transport.connect({url:'wss://evil.invalid/call',key:'synthetic',message:()=>{},closed:()=>{}}),/INVALID_MONITOR_TARGET/);
});
