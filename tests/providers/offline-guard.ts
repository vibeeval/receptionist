import { Socket } from 'node:net';
// Test-only fail-closed egress guard, loaded before every provider test file.
Object.defineProperty(Socket.prototype,'connect',{configurable:false,writable:false,value(){throw new Error('OFFLINE_NETWORK_FORBIDDEN');}});
globalThis.fetch=async()=>{throw new Error('OFFLINE_NETWORK_FORBIDDEN');};
