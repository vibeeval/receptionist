// Shared SQLite contract port: assertions unchanged; async PostgreSQL binding.
import { pgEngine } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from './helpers.js';
import { loadConfig } from '../../src/config.js';
import { harness, signed, event, eligible, reserve, NOW } from './helpers.js';
test('100 identical signed deliveries create exactly one durable inbox job', async () => {
    const h = await harness();
    try {
        const r = await Promise.all(Array.from({ length: 100 }, () => signed(h.engine, h.config, 'event', 'demo-a', 'events', event())));
        assert.equal(r.filter(x => x.status === 200).length, 100);
        assert.equal(await h.engine.store.count('inbox'), 1);
        assert.equal(await h.engine.store.count('jobs'), 1);
        await h.engine.drain();
        assert.equal(await h.engine.store.count('calls'), 1);
    }
    finally {
        await h.close();
    }
});
test('same event id with changed body conflicts', async () => {
    const h = await harness();
    try {
        await signed(h.engine, h.config, 'event', 'demo-a', 'events', event());
        assert.equal((await signed(h.engine, h.config, 'event', 'demo-a', 'events', event('evt-1', 'call-other'))).status, 409);
    }
    finally {
        await h.close();
    }
});
test('booking confirmation, reserve, provider receipt and CRM are durable', async () => {
    const h = await harness();
    try {
        await eligible(h);
        assert.equal((await reserve(h)).status, 202);
        await h.engine.drain();
        assert.equal((await h.engine.store.command('tenant-a', 'cmd-1'))?.state, 'confirmed');
        assert.equal(h.engine.provider.bookingCount(), 1);
        assert.equal(h.engine.provider.crmCount(), 1);
        const reopened = await pgEngine(h.config, { clock: () => NOW });
        assert.equal((await reopened.store.command('tenant-a', 'cmd-1'))?.state, 'confirmed');
        await reopened.close();
    }
    finally {
        await h.close();
    }
});
test('20 concurrent same-slot attempts admit one booking', async () => {
    const h = await harness();
    try {
        for (let i = 0; i < 20; i++)
            await eligible(h, 'call-' + i);
        const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => reserve(h, 'cmd-' + i, 'call-' + i)));
        assert.equal(rs.filter(r => r.status === 202).length, 1);
        assert.equal(rs.filter(r => r.status === 409).length, 19);
        await h.engine.drain();
        assert.equal(h.engine.provider.bookingCount(), 1);
    }
    finally {
        await h.close();
    }
});
test('after-commit timeout reconciles without repeating provider booking', async () => {
    const h = await harness();
    try {
        await eligible(h);
        await reserve(h);
        h.engine.provider.setFault('booking', 'after_commit_timeout');
        await h.engine.drain();
        assert.equal((await h.engine.store.command('tenant-a', 'cmd-1'))?.state, 'unknown');
        assert.equal(h.engine.provider.bookingCount(), 1);
        h.setNow(NOW + 60000);
        await h.engine.drain();
        assert.equal((await h.engine.store.command('tenant-a', 'cmd-1'))?.state, 'confirmed');
        assert.equal(h.engine.provider.bookAttempts(), 1);
    }
    finally {
        await h.close();
    }
});
test('crash point after attempted state becomes unknown then reconciles on restart', async () => {
    const h = await harness();
    try {
        await eligible(h);
        await reserve(h);
        h.engine.provider.setFault('booking', 'crash_after_commit');
        await assert.rejects(h.engine.drain(), /SIMULATED_CRASH/);
        assert.equal((await h.engine.store.command('tenant-a', 'cmd-1'))?.state, 'attempted');
        const reopened = await pgEngine(h.config, { clock: () => NOW + 60000 });
        await reopened.drain();
        assert.equal((await reopened.store.command('tenant-a', 'cmd-1'))?.state, 'confirmed');
        assert.equal(reopened.provider.bookingCount(), 1);
        await reopened.close();
    }
    finally {
        await h.close();
    }
});
test('unknown outcome keeps slot and budget and eventually reaches DLQ', async () => {
    const h = await harness();
    try {
        await eligible(h);
        await reserve(h);
        h.engine.provider.setFault('booking', 'unknown');
        await h.engine.drain();
        for (let i = 1; i < 5; i++) {
            h.setNow(NOW + i * 120000);
            await h.engine.drain();
        }
        assert.equal((await h.engine.store.command('tenant-a', 'cmd-1'))?.state, 'unknown');
        assert.equal(await h.engine.store.count('dlq'), 1);
        assert.equal(await h.engine.store.count('reservations'), 1);
        assert.ok((await h.engine.store.budget('tenant-a')).reserved > 0);
    }
    finally {
        await h.close();
    }
});
test('bounded pre-commit retry eventually DLQs and releases only definite no-effect reservation', async () => {
    const h = await harness();
    try {
        await eligible(h);
        await reserve(h);
        h.engine.provider.setFault('booking', 'retryable');
        await h.engine.drain();
        for (let i = 1; i < 5; i++) {
            h.setNow(NOW + i * 120000);
            await h.engine.drain();
        }
        assert.equal((await h.engine.store.command('tenant-a', 'cmd-1'))?.state, 'failed');
        assert.equal(h.engine.provider.bookAttempts(), 3);
        assert.equal(await h.engine.store.count('dlq'), 1);
        assert.equal(await h.engine.store.count('reservations'), 0);
    }
    finally {
        await h.close();
    }
});
test('CRM retry never repeats a successful booking', async () => {
    const h = await harness();
    try {
        await eligible(h);
        await reserve(h);
        h.engine.provider.setFault('crm', 'retryable');
        await h.engine.drain();
        assert.equal((await h.engine.store.command('tenant-a', 'cmd-1'))?.state, 'confirmed');
        h.engine.provider.setFault('crm', 'none');
        h.setNow(NOW + 120000);
        await h.engine.drain();
        assert.equal(h.engine.provider.bookingCount(), 1);
        assert.equal(h.engine.provider.crmCount(), 1);
    }
    finally {
        await h.close();
    }
});
test('tenant isolation denies a foreign call, confirmation and command', async () => {
    const h = await harness();
    try {
        await eligible(h);
        await reserve(h);
        assert.equal((await signed(h.engine, h.config, 'operator', 'demo-b', 'confirmations', { callId: 'call-1', slotId: 'slot-1', attested: true, evidenceId: 'test' })).status, 404);
        assert.equal((await signed(h.engine, h.config, 'tool', 'demo-b', 'bookings/cmd-1', undefined, { method: 'GET' })).status, 404);
    }
    finally {
        await h.close();
    }
});
test('kill switch blocks new reservations and execution but permits reconciliation', async () => {
    const h = await harness();
    try {
        await eligible(h);
        await reserve(h);
        await signed(h.engine, h.config, 'operator', 'demo-a', 'control', { kill: true });
        await h.engine.drain();
        assert.equal(h.engine.provider.bookAttempts(), 0);
        assert.equal((await reserve(h, 'cmd-2')).status, 503);
        await signed(h.engine, h.config, 'operator', 'demo-a', 'control', { kill: false, operationId: 'resume-after-kill', expectedRevision: 1 });
        await h.engine.drain();
        assert.equal(h.engine.provider.bookingCount(), 1);
    }
    finally {
        await h.close();
    }
});
test('budget exhaustion rejects atomically without reserving slot or confirmation', async () => {
    const h = await harness();
    try {
        await eligible(h);
        await h.engine.store.setBudgetForTest('tenant-a', 0);
        assert.equal((await reserve(h)).status, 429);
        assert.equal(await h.engine.store.count('commands'), 0);
        assert.equal(await h.engine.store.count('reservations'), 0);
    }
    finally {
        await h.close();
    }
});
test('database transaction rollback removes all partial writes', async () => {
    const h = await harness();
    try {
        await assert.rejects(async () => await h.engine.store.transaction(async () => { await h.engine.store.audit('tenant-a', 'test', 'test', NOW); throw new Error('rollback'); }));
        assert.equal(await h.engine.store.count('audit'), 0);
    }
    finally {
        await h.close();
    }
});
test('bad config cannot disable freshness and remote hosts are rejected', async () => {
    assert.throws(() => loadConfig({ maxAgeSeconds: 'NaN' }));
    const h = await harness();
    try {
        assert.throws(() => loadConfig({ ...h.config, host: '0.0.0.0' }));
        assert.throws(() => loadConfig({ ...h.config, maxAgeSeconds: NaN }));
    }
    finally {
        await h.close();
    }
});
