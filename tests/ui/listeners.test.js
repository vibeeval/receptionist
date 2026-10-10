'use strict';
// Repeated navigation, tenant switching and dialog use must not accumulate event handlers or polling.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootAs, TENANT_A, TENANT_B, VIEWS } = require('./harness.js');

async function cycle(h) {
  for (const v of VIEWS) await h.nav(v);
  await h.switchTenant(TENANT_B);
  for (const v of ['calls', 'business', 'connections', 'overview']) await h.nav(v);
  await h.switchTenant(TENANT_A);
  await h.nav('control');
  await h.click('#kill-toggle');
  await h.click('#confirm-cancel');
  await h.click('#kill-toggle');
  await h.key(null, 'Escape');
  await h.nav('overview');
}

test('navigating views/tenants and opening the dialog repeatedly does not add listeners', async () => {
  const h = await bootAs('admin');
  await cycle(h);
  const snap = h.listenerSnapshot();
  const total = h.totalListeners();
  for (let k = 0; k < 3; k++) await cycle(h);
  const grown = [];
  for (const [target, before] of snap) {
    const connected = target.nodeType === undefined || target.nodeType === 9 || target.isConnected;
    if (connected && target.listenerCount() > before) grown.push(`${h.describe(target)}: ${before} -> ${target.listenerCount()}`);
  }
  assert.deepEqual(grown, [], 'persistent elements gained listeners');
  assert.equal(h.totalListeners(), total, 'total live listeners stable');
  assert.equal(h.timers.intervals.length, 0, 'no setInterval polling');
  assert.equal(h.reqs('POST').filter((r) => r.path !== '/api/login').length, 0, 'navigation alone sends no writes');
  h.finish();
});

test('one click on a nav button triggers at most one fetch per resource', async () => {
  const h = await bootAs('admin');
  for (let k = 0; k < 3; k++) {
    await h.nav('overview');
    await h.nav('calls');
  }
  const mark = h.requests.length;
  await h.nav('bookings');
  const fresh = h.requests.slice(mark).map((r) => `${r.method} ${r.path}`);
  const dupes = fresh.filter((x, i) => fresh.indexOf(x) !== i);
  assert.deepEqual(dupes, [], `duplicate requests after one click: ${fresh.join(', ')}`);
  assert.ok(fresh.includes(`GET ${h.tenantPath(TENANT_A, 'bookings')}`));
  h.finish();
});
