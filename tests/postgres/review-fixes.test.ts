// Shared SQLite contract port: assertions unchanged; async PostgreSQL binding.
import { pgEngine } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { symlinkSync, linkSync } from 'node:fs';
import { Engine } from './helpers.js';
import { loadConfig } from '../../src/config.js';
import { harness, eligible, reserve, signed, event, NOW } from './helpers.js';
for (const intent of ['opt_out', 'human', 'emergency', 'transfer'])
    test('accepted ' + intent + ' gates pending dispatch before worker and across restart', async () => {
        const h = await harness();
        let reopened: Engine | undefined;
        try {
            await eligible(h);
            await reserve(h);
            assert.equal((await signed(h.engine, h.config, 'event', 'demo-a', 'events', event('stop', 'call-1', 'intent.detected', { intent, confidence: 1 }))).status, 200);
            reopened = await pgEngine(h.config, { clock: () => NOW });
            await reopened.drain();
            assert.equal(reopened.provider.bookAttempts(), 0);
            assert.equal((await reopened.store.budget('tenant-a')).reserved, 0);
            await signed(reopened, h.config, 'event', 'demo-a', 'events', event('reopen', 'call-1', 'intent.detected', { intent: 'booking', confidence: 1 }));
            await reopened.drain();
            assert.notEqual((await reserve(h, 'new')).status, 202);
        }
        finally {
            await reopened?.close();
            await h.close();
        }
    });
test('confirmation evidence survives restart, expiry and payload conflict', async () => { const h = await harness(); let e: Engine | undefined; try {
    await eligible(h);
    const input = { callId: 'call-1', slotId: 'slot-1', attested: true, evidenceId: 'unique-evidence' };
    const first = await signed(h.engine, h.config, 'operator', 'demo-a', 'confirmations', input);
    e = await pgEngine(h.config, { clock: () => NOW + 120001 });
    const replay = await signed(e, h.config, 'operator', 'demo-a', 'confirmations', input);
    assert.equal(replay.body.confirmationId, first.body.confirmationId);
    assert.equal((await signed(e, h.config, 'operator', 'demo-a', 'confirmations', { ...input, slotId: 'slot-2' })).status, 409);
    assert.equal((await signed(e, h.config, 'tool', 'demo-a', 'bookings', { commandId: 'late', callId: 'call-1', slotId: 'slot-1', confirmationId: replay.body.confirmationId })).status, 409);
}
finally {
    await e?.close();
    await h.close();
} });
test('unkill requires current revision and new operation; delayed unseen and replay cannot undo kill', async () => {
    const h = await harness();
    try {
        const kill = await signed(h.engine, h.config, 'operator', 'demo-a', 'control', { kill: true, operationId: 'kill-1' });
        assert.equal(kill.status, 200);
        assert.equal((await signed(h.engine, h.config, 'operator', 'demo-a', 'control', { kill: false })).status, 409);
        const unlock = { kill: false, operationId: 'unlock-1', expectedRevision: kill.body.revision };
        assert.equal((await signed(h.engine, h.config, 'operator', 'demo-a', 'control', unlock)).status, 200);
        await signed(h.engine, h.config, 'operator', 'demo-a', 'control', { kill: true, operationId: 'kill-2' });
        await signed(h.engine, h.config, 'operator', 'demo-a', 'control', unlock);
        assert.equal(await h.engine.store.killed('tenant-a'), true);
        assert.equal((await signed(h.engine, h.config, 'operator', 'demo-a', 'control', { ...unlock, operationId: 'delayed' })).status, 409);
        assert.equal((await signed(h.engine, h.config, 'operator', 'demo-a', 'control', { kill: true, operationId: 'unlock-1' })).status, 409);
    }
    finally {
        await h.close();
    }
});
test('pending expired slot releases reservation but unknown expired slot stays held', async () => { for (const unknown of [false, true]) {
    const h = await harness();
    try {
        await eligible(h);
        await reserve(h);
        if (unknown) {
            h.engine.provider.setFault('booking', 'unknown');
            await h.engine.drain();
        }
        h.setNow(NOW + 3 * 86400000);
        await h.engine.drain();
        assert.equal(h.engine.provider.bookAttempts(), unknown ? 1 : 0);
        assert.equal((await h.engine.store.budget('tenant-a')).reserved, unknown ? 1000 : 0);
        assert.equal((await h.engine.store.command('tenant-a', 'cmd-1'))?.state, unknown ? 'unknown' : 'failed');
    }
    finally {
        await h.close();
    }
} });
test('operator confirmation saturation cannot prevent kill enable', async () => { const h = await harness(); let e: Engine | undefined; try {
    await eligible(h);
    e = await pgEngine({ ...h.config, maxRequestsPerMinute: 1 }, { clock: () => NOW });
    await signed(e, h.config, 'operator', 'demo-a', 'confirmations', { callId: 'call-1', slotId: 'slot-1', attested: true, evidenceId: 'e1' });
    await signed(e, h.config, 'operator', 'demo-a', 'confirmations', { callId: 'call-1', slotId: 'slot-1', attested: true, evidenceId: 'e2' });
    assert.equal((await signed(e, h.config, 'operator', 'demo-a', 'control', { kill: true })).status, 200);
}
finally {
    await e?.close();
    await h.close();
} });
