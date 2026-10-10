'use strict';
// Write-only secrets, business draft validation, limits, and stale (409) conflicts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootAs, TENANT_A, trLower, positiveClaims } = require('./harness.js');

const SECRET = 'synthetic-secret-value-1';
const STALE_RE = /değiş|güncel değil|eski|yenile/;

function domContains(h, s) {
  return h.document.documentElement.outerHTML.includes(s) || h.pageText().includes(s);
}
function messageText(h, id) {
  return trLower([h.text(`#${id}`), h.text('#global-error'), h.text('#notice')].join(' '));
}

test('connection secret: body is {kind,value}, input cleared after success, value never in DOM', async () => {
  const h = await bootAs('admin');
  await h.nav('connections');
  await h.type('#conn-googleClientId', SECRET);
  await h.submit('form[data-connection-form="googleClientId"]');
  const posts = h.reqs('POST', h.tenantPath(TENANT_A, 'connections'));
  assert.equal(posts.length, 1, 'one POST');
  assert.deepEqual(posts[0].body, { kind: 'googleClientId', value: SECRET });
  assert.equal(h.$('#conn-googleClientId').value, '', 'input cleared');
  assert.equal(h.$('#conn-googleClientId').type, 'password');
  assert.ok(!domContains(h, SECRET), 'secret not in DOM text or attributes');
  const status = trLower(h.text('[data-connection-status="googleClientId"]'));
  assert.ok(status.includes('doğrulanmadı') && status.includes('etkin değil'), `stored status after save: ${status}`);
  assert.deepEqual(positiveClaims(h.text('#connections-message'), { status: true }), [], 'success message makes no active/verified claim');
  h.finish();
});

test('connection secret: input cleared after a failed save as well', async () => {
  const h = await bootAs('admin');
  await h.nav('connections');
  h.backend.override('POST', h.tenantPath(TENANT_A, 'connections'), { status: 500, body: { code: 'INTERNAL', requestId: 'req-synthetic-conn' } });
  await h.type('#conn-retellApiKey', SECRET);
  await h.submit('form[data-connection-form="retellApiKey"]');
  assert.equal(h.reqs('POST', h.tenantPath(TENANT_A, 'connections')).length, 1);
  assert.equal(h.$('#conn-retellApiKey').value, '', 'input cleared after failure');
  assert.ok(!domContains(h, SECRET), 'secret not in DOM');
  assert.notEqual(messageText(h, 'connections-message').trim(), '', 'failure is reported');
  h.finish();
});

async function fillBusiness(h, { start = '09:00', end = '17:00', duration = '30', days = [1, 2, 3, 4, 5] } = {}) {
  await h.type('#biz-name', 'Demo Klinik');
  await h.type('#biz-service', 'Sentetik muayene');
  await h.type('#biz-policy', 'Sentetik politika.');
  await h.type('#biz-start', start);
  await h.type('#biz-end', end);
  await h.type('#biz-duration', duration);
  for (let d = 1; d <= 7; d++) await h.setChecked(`input[name="weekday"][value="${d}"]`, days.includes(d));
}
const invalid = (h, sel) => h.$(sel) && h.$(sel).getAttribute('aria-invalid') === 'true';
const businessPosts = (h) => h.reqs('POST', h.tenantPath(TENANT_A, 'business'));

test('business: start >= end is rejected client-side and marked aria-invalid', async () => {
  const h = await bootAs('admin');
  await h.nav('business');
  await fillBusiness(h, { start: '18:00', end: '09:00' });
  await h.submit('#business-form');
  assert.equal(businessPosts(h).length, 0, 'no POST');
  assert.ok(invalid(h, '#biz-start') || invalid(h, '#biz-end'), 'start or end marked aria-invalid');
  await fillBusiness(h, { start: '10:00', end: '10:00' });
  await h.submit('#business-form');
  assert.equal(businessPosts(h).length, 0, 'equal start/end rejected');
  h.finish();
});

test('business: duration that does not fit the hours is rejected and marked aria-invalid', async () => {
  const h = await bootAs('admin');
  await h.nav('business');
  await fillBusiness(h, { start: '09:00', end: '10:00', duration: '120' });
  await h.submit('#business-form');
  assert.equal(businessPosts(h).length, 0, 'no POST');
  assert.ok(invalid(h, '#biz-duration'), '#biz-duration aria-invalid');
  h.finish();
});

test('business: no weekday selected is rejected and the weekday group marked aria-invalid', async () => {
  const h = await bootAs('admin');
  await h.nav('business');
  await fillBusiness(h, { days: [] });
  await h.submit('#business-form');
  assert.equal(businessPosts(h).length, 0, 'no POST');
  const days = h.$$('input[name="weekday"]');
  const marked = days.some((d) => d.getAttribute('aria-invalid') === 'true')
    || h.$$('[aria-invalid="true"]').some((el) => days.every((d) => el.contains(d)));
  assert.ok(marked, 'weekday inputs or their group marked aria-invalid');
  h.finish();
});

test('business: valid draft POSTs revision + minutes; success says not applied to the live flow', async () => {
  const h = await bootAs('admin');
  await h.nav('business');
  await fillBusiness(h, { start: '18:00', end: '09:00' });
  await h.submit('#business-form');
  await fillBusiness(h, { start: '09:00', end: '17:00', duration: '30', days: [1, 2, 3, 4, 5] });
  await h.submit('#business-form');
  const posts = businessPosts(h);
  assert.equal(posts.length, 1, 'exactly one POST');
  const { revision, value } = posts[0].body;
  assert.equal(revision, 3, 'revision from GET business draft');
  assert.equal(value.name, 'Demo Klinik');
  assert.equal(value.service, 'Sentetik muayene');
  assert.equal(value.timezone, 'Europe/Istanbul');
  assert.deepEqual([...value.weekdays].sort(), [1, 2, 3, 4, 5]);
  assert.equal(value.startMinute, 540);
  assert.equal(value.endMinute, 1020);
  assert.equal(value.durationMinutes, 30);
  assert.equal(h.$$('#business-form [aria-invalid="true"]').length, 0, 'aria-invalid cleared after valid submit');
  const msg = trLower(h.text('#business-message'));
  assert.match(msg, /taslak/, `message mentions draft: ${msg}`);
  assert.match(msg, /değişmedi|uygulanmadı|etkin değil|etkinleştirilmedi|uygulanmaz|değiştirmez|etkilemez/, `message says not applied: ${msg}`);
  assert.deepEqual(positiveClaims(msg), []);
  const badge = trLower(h.text('#business-draft-badge'));
  assert.ok(badge.includes('taslak') || badge.includes('etkin değil'), 'badge still draft after save');
  h.finish();
});

test('limits: POST {cap:int, revision: overview.limitRevision}; maxCalls is read-only', async () => {
  const h = await bootAs('admin');
  await h.nav('budget');
  assert.ok(h.text('#max-calls').includes('25') || h.$('#max-calls').value === '25', 'maxCalls shown');
  const mc = h.$('#max-calls');
  if (['input', 'select', 'textarea'].includes(mc.localName)) assert.ok(mc.readOnly || mc.disabled, 'maxCalls not editable');
  await h.type('#limit-cap', '750000');
  await h.submit('#limit-form');
  const posts = h.reqs('POST', h.tenantPath(TENANT_A, 'limits'));
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, { cap: 750000, revision: 4 });
  assert.ok(Number.isInteger(posts[0].body.cap));
  h.finish();
});

test('limits: negative, >1e9, non-integer and empty caps are not sent', async () => {
  const h = await bootAs('admin');
  await h.nav('budget');
  for (const bad of ['-1', '1000000001', '1.5', '']) {
    await h.type('#limit-cap', bad);
    await h.submit('#limit-form');
    assert.equal(h.reqs('POST', h.tenantPath(TENANT_A, 'limits')).length, 0, `cap ${JSON.stringify(bad)} must not POST`);
  }
  h.finish();
});

test('409 on business save shows a stale-revision message', async () => {
  const h = await bootAs('admin');
  await h.nav('business');
  h.backend.override('POST', h.tenantPath(TENANT_A, 'business'), { status: 409, body: { code: 'STALE_REVISION', requestId: 'req-synthetic-409' } });
  await fillBusiness(h);
  await h.submit('#business-form');
  assert.equal(businessPosts(h).length, 1);
  assert.match(messageText(h, 'business-message'), STALE_RE);
  assert.deepEqual(positiveClaims(h.text('#business-message')), []);
  h.finish();
});

test('409 on limits save shows a stale-revision message', async () => {
  const h = await bootAs('admin');
  await h.nav('budget');
  h.backend.override('POST', h.tenantPath(TENANT_A, 'limits'), { status: 409, body: { code: 'STALE_REVISION', requestId: 'req-synthetic-409' } });
  await h.type('#limit-cap', '1000');
  await h.submit('#limit-form');
  assert.equal(h.reqs('POST', h.tenantPath(TENANT_A, 'limits')).length, 1);
  assert.match(messageText(h, 'limit-message'), STALE_RE);
  h.finish();
});

test('409 on control shows a stale message and is never auto-retried', async () => {
  const h = await bootAs('admin');
  await h.nav('control');
  h.backend.override('POST', h.tenantPath(TENANT_A, 'control'), { status: 409, body: { code: 'STALE_REVISION', requestId: 'req-synthetic-409' } });
  await h.click('#kill-toggle');
  await h.click('#confirm-ok');
  h.timers.advance(60000);
  await h.flush();
  assert.equal(h.reqs('POST', h.tenantPath(TENANT_A, 'control')).length, 1, 'exactly one control POST');
  assert.match(messageText(h, 'control-message'), STALE_RE);
  h.finish();
});
