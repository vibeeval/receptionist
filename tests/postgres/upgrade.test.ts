// Shared SQLite contract port: assertions unchanged; async PostgreSQL binding.
import { pgEngine } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from './helpers.js';
import { harness, eligible, reserve, signed, event, NOW } from './helpers.js';
for (const intent of ['opt_out', 'human', 'emergency', 'transfer'])
    test('legacy pending ' + intent + ' backfills before dispatch and migration is idempotent', async () => {
        const h = await harness();
        let e: Engine | undefined;
        try {
            await eligible(h);
            await reserve(h);
            await signed(h.engine, h.config, 'event', 'demo-a', 'events', event('legacy-stop', 'call-1', 'intent.detected', { intent, confidence: 1 }));
            await h.engine.store.run('DELETE FROM cancellation_gates');
            await h.engine.store.run('DELETE FROM local_migrations');
            e = await pgEngine(h.config, { clock: () => NOW });
            assert.equal(Number((await e.store.one('SELECT count(*) n FROM cancellation_gates'))?.n), 1);
            const auditCount = await e.store.count('audit');
            await e.close();
            e = await pgEngine(h.config, { clock: () => NOW });
            assert.equal(await e.store.count('audit'), auditCount);
            await e.drain();
            assert.equal(e.provider.bookAttempts(), 0);
            assert.equal((await e.store.budget('tenant-a')).reserved, 0);
        }
        finally {
            await e?.close();
            await h.close();
        }
    });
test('legacy unknown receipt remains reconcilable after backfill', async () => { const h = await harness(); let e: Engine | undefined; try {
    await eligible(h);
    await reserve(h);
    h.engine.provider.setFault('booking', 'after_commit_timeout');
    await h.engine.drain();
    await signed(h.engine, h.config, 'event', 'demo-a', 'events', event('legacy-stop', 'call-1', 'intent.detected', { intent: 'opt_out', confidence: 1 }));
    await h.engine.store.run('DELETE FROM cancellation_gates');
    await h.engine.store.run('DELETE FROM local_migrations');
    e = await pgEngine(h.config, { clock: () => NOW + 60000 });
    await e.drain();
    assert.equal(e.provider.bookAttempts(), 1);
    assert.equal((await e.store.command('tenant-a', 'cmd-1'))?.state, 'confirmed');
}
finally {
    await e?.close();
    await h.close();
} });
test('malformed legacy inbox blocks startup and rolls migration back', async () => { const h = await harness(); try {
    await eligible(h);
    await reserve(h);
    await h.engine.store.run('DELETE FROM local_migrations');
    await h.engine.store.run("INSERT INTO inbox VALUES(?,?,?,?,?)", 'tenant-a', 'bad', 'hash', '{', NOW);
    await assert.rejects(async () => await pgEngine(h.config), /UPGRADE_BLOCKED/);
    assert.equal(Number((await h.engine.store.one('SELECT count(*) n FROM local_migrations'))?.n), 0);
    assert.equal(h.engine.provider.bookAttempts(), 0);
}
finally {
    await h.close();
} });
