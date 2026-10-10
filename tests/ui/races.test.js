'use strict';
// Stale response protection: late responses for a previous tenant or view must not render.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, bootAs, TENANT_A, TENANT_B } = require('./harness.js');

test('late overview for tenant A does not overwrite tenant B', async () => {
  const h = await setup();
  const holdA = h.backend.hold('GET', h.tenantPath(TENANT_A, 'overview'));
  await h.login('admin');
  assert.ok(holdA.taken, 'tenant A overview requested and pending');
  await h.switchTenant(TENANT_B);
  assert.match(h.text('[data-metric="calls"]'), /222/, 'tenant B overview rendered');
  holdA.release();
  await h.flush();
  assert.equal(h.$('#tenant-select').value, TENANT_B, 'tenant stays B');
  assert.match(h.text('[data-metric="calls"]'), /222/, 'still tenant B data');
  assert.ok(!/111/.test(h.text('[data-metric="calls"]')), 'tenant A data not rendered');
  h.finish();
});

test('late calls list for tenant A does not render after switching to tenant B', async () => {
  const h = await bootAs('admin');
  const holdA = h.backend.hold('GET', h.tenantPath(TENANT_A, 'calls'));
  await h.nav('calls');
  assert.ok(holdA.taken, 'tenant A calls pending');
  await h.switchTenant(TENANT_B);
  if (h.activeView() !== 'calls') await h.nav('calls');
  assert.match(h.text('tbody[data-rows="calls"]'), /call-b-0001/, 'tenant B calls shown');
  holdA.release();
  await h.flush();
  const rows = h.text('tbody[data-rows="calls"]');
  assert.ok(!rows.includes('call-a-0001'), `tenant A rows must not render: ${rows}`);
  assert.match(rows, /call-b-0001/);
  assert.equal(h.statusState('calls'), 'ready');
  assert.equal(h.$('#tenant-select').value, TENANT_B);
  h.finish();
});

test('late response for a previous view does not steal the current view', async () => {
  const h = await bootAs('admin');
  const holdCalls = h.backend.hold('GET', h.tenantPath(TENANT_A, 'calls'));
  await h.nav('calls');
  assert.ok(holdCalls.taken, 'calls pending');
  await h.nav('bookings');
  assert.match(h.text('tbody[data-rows="bookings"]'), /booking-a-0001/);
  holdCalls.release();
  await h.flush();
  assert.equal(h.activeView(), 'bookings', 'aria-current stays on bookings');
  assert.ok(h.visible('section[data-panel="bookings"]'), 'bookings panel visible');
  assert.ok(!h.visible('section[data-panel="calls"]'), 'calls panel stays hidden');
  assert.equal(h.statusState('bookings'), 'ready');
  assert.equal(h.text('#global-error'), '', 'no global error from the late response');
  h.finish();
});

test('a pending kill action for tenant A does not render into tenant B after a switch', async () => {
  const h = await bootAs('admin');
  await h.nav('control');
  const holdPost = h.backend.hold('POST', h.tenantPath(TENANT_A, 'control'));
  await h.click('#kill-toggle');
  await h.click('#confirm-ok');
  assert.ok(holdPost.taken, 'control POST for A pending');
  await h.switchTenant(TENANT_B);
  if (h.activeView() !== 'control') await h.nav('control');
  const stateB = h.text('#kill-state');
  holdPost.release();
  await h.flush();
  assert.equal(h.$('#tenant-select').value, TENANT_B, 'tenant stays B');
  assert.equal(h.text('#kill-state'), stateB, 'tenant B kill state unchanged by tenant A response');
  assert.equal(h.reqs('POST', h.tenantPath(TENANT_B, 'control')).length, 0, 'no write sent to tenant B');
  assert.equal(h.backend.data(TENANT_B).overview.kill, false);
  h.finish();
});
