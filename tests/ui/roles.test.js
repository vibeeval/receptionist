'use strict';
// Role restrictions: viewer read-only, operator kill only, admin everything; role is per tenant.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootAs, TENANT_A, TENANT_B } = require('./harness.js');

async function controlState(h) {
  await h.nav('control');
  const kill = h.$('#kill-toggle').disabled;
  await h.nav('connections');
  const connections = h.$('#connections-fieldset').disabled;
  await h.nav('business');
  const business = h.$('#business-fieldset').disabled;
  await h.nav('budget');
  const limit = h.$('#limit-fieldset').disabled;
  return { kill, connections, business, limit };
}

const ALL_DISABLED = { kill: true, connections: true, business: true, limit: true };
const OPERATOR = { kill: false, connections: true, business: true, limit: true };
const ALL_ENABLED = { kill: false, connections: false, business: false, limit: false };

test('viewer: kill toggle and all admin fieldsets disabled', async () => {
  const h = await bootAs('viewer');
  assert.deepEqual(await controlState(h), ALL_DISABLED);
  await h.nav('control');
  await h.click('#kill-toggle');
  assert.ok(h.$('#confirm-dialog').hidden, 'disabled kill toggle cannot open the dialog');
  assert.equal(h.reqs('POST').filter((r) => r.path !== '/api/login').length, 0, 'viewer sends no writes');
  h.finish();
});

test('operator: kill toggle enabled, admin fieldsets disabled', async () => {
  const h = await bootAs('operator');
  assert.deepEqual(await controlState(h), OPERATOR);
  h.finish();
});

test('admin: kill toggle and all fieldsets enabled', async () => {
  const h = await bootAs('admin');
  assert.deepEqual(await controlState(h), ALL_ENABLED);
  h.finish();
});

test('role is taken per tenant from session.tenants and follows tenant switches', async () => {
  const tenants = [{ id: TENANT_A, role: 'admin' }, { id: TENANT_B, role: 'viewer' }];
  const h = await bootAs('admin', { backend: { tenants } });
  assert.deepEqual(await controlState(h), ALL_ENABLED, 'tenant A (admin)');
  const roleA = h.text('#user-role');
  await h.switchTenant(TENANT_B);
  assert.equal(h.$('#tenant-select').value, TENANT_B);
  assert.deepEqual(await controlState(h), ALL_DISABLED, 'tenant B (viewer)');
  assert.notEqual(h.text('#user-role'), roleA, 'role label changes with tenant');
  await h.switchTenant(TENANT_A);
  assert.deepEqual(await controlState(h), ALL_ENABLED, 'back to tenant A (admin)');
  h.finish();
});

test('operator on one tenant, viewer on another', async () => {
  const tenants = [{ id: TENANT_A, role: 'viewer' }, { id: TENANT_B, role: 'operator' }];
  const h = await bootAs('operator', { backend: { tenants } });
  assert.deepEqual(await controlState(h), ALL_DISABLED, 'tenant A (viewer)');
  await h.switchTenant(TENANT_B);
  assert.deepEqual(await controlState(h), OPERATOR, 'tenant B (operator)');
  h.finish();
});
