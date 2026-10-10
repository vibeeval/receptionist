'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootAs, TENANT_A } = require('./harness.js');

test('uncertain control keeps exact operation identity through a manual state refresh', async () => {
  const h = await bootAs('admin');
  await h.nav('control');
  const path = h.tenantPath(TENANT_A, 'control');
  h.backend.override('POST', path, {status: 503, body: {code: 'INTERNAL_ERROR'}});
  await h.click('#kill-toggle');
  await h.click('#confirm-ok');
  const first = h.reqs('POST', path)[0].body;
  assert.ok(h.visible('#control-retry'));
  await h.click('#control-reload');
  assert.equal(h.reqs('POST', path).length, 1, 'refresh must never resend automatically');
  assert.ok(h.visible('#control-retry'), 'manual retry survives the overview refresh');
  await h.click('#control-retry');
  assert.deepEqual(h.reqs('POST', path)[1].body, first, 'same operationId, revision and intent');
  assert.ok(!h.visible('#control-retry'), 'successful retry clears pending intent');
  h.finish();
});

test('hash changes canonicalize invalid and legacy routes, including the currently displayed view', async () => {
  const h = await bootAs('admin');
  h.run("location.hash = '#invalid'; window.dispatchEvent(new Event('hashchange'));");
  await h.flush();
  assert.equal(h.activeView(), 'overview');
  assert.equal(h.location.hash, '#overview');
  await h.nav('calls');
  h.run("location.hash = '#invalid'; window.dispatchEvent(new Event('hashchange'));");
  await h.flush();
  assert.equal(h.activeView(), 'overview');
  assert.equal(h.location.hash, '#overview');
  h.run("location.hash = '#cost'; window.dispatchEvent(new Event('hashchange'));");
  await h.flush();
  assert.equal(h.activeView(), 'budget');
  assert.equal(h.location.hash, '#budget');
  h.finish();
});

test('skip link preserves the active view and targets visible login content after logout', async () => {
  const h = await bootAs('admin');
  await h.nav('calls');
  await h.click('.skip-link');
  assert.equal(h.activeView(), 'calls', 'content anchor must not be treated as a route');
  assert.equal(h.location.hash, '#main');
  await h.click('#logout-button');
  assert.equal(h.$('.skip-link').getAttribute('href'), '#login-username');
  assert.ok(h.visible('#login-username'));
  h.finish();
});
