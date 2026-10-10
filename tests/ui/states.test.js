'use strict';
// Empty/error/retry states and honest labels (draft-only, stored-only, no fabricated invoice).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, bootAs, TENANT_A, CONNECTION_KINDS, trLower, positiveClaims } = require('./harness.js');

const STACK_MARKER = 'synthetic-stack-marker';
const RAW_MARKER = 'raw-body-marker';
const leakyBody = { code: 'INTERNAL', requestId: 'req-synthetic-500', stack: `Error: ${STACK_MARKER}\n    at handler (/srv/synthetic.js:1:1)`, detail: RAW_MARKER };

for (const view of ['calls', 'bookings', 'errors', 'audit']) {
  test(`empty ${view} list shows data-state=empty`, async () => {
    const h = await bootAs('admin');
    const d = h.backend.data(TENANT_A)[view];
    const dataIds = [...d.items, ...(d.admin || [])].map((x) => String(x.id ?? x.job_id));
    d.items = [];
    if (view === 'audit') d.admin = [];
    await h.nav(view);
    assert.equal(h.statusState(view), 'empty');
    assert.ok(h.visible(`[data-status="${view}"]`), 'status visible');
    assert.notEqual(h.visibleText(`[data-status="${view}"]`), '', 'empty state has explanatory text');
    const rows = h.$$(`tbody[data-rows^="${view}"]`).map((t) => t.textContent).join(' ');
    assert.deepEqual(dataIds.filter((id) => rows.includes(id)), [], 'no data rows rendered (placeholder rows are fine)');
    h.finish();
  });
}

test('500 shows data-state=error without raw body/stack; retry re-fetches and recovers', async () => {
  const h = await bootAs('admin');
  h.backend.override('GET', h.tenantPath(TENANT_A, 'calls'), { status: 500, body: leakyBody });
  await h.nav('calls');
  assert.equal(h.statusState('calls'), 'error');
  const retry = h.$('[data-retry="calls"]');
  assert.ok(h.visible(retry), 'retry button visible');
  const text = h.pageText();
  assert.ok(!text.includes(STACK_MARKER), 'no stack in DOM');
  assert.ok(!text.includes(RAW_MARKER), 'no raw body in DOM');
  assert.ok(!text.includes('"code"') && !text.includes('INTERNAL'), 'no raw JSON/code in DOM');
  const before = h.reqs('GET', h.tenantPath(TENANT_A, 'calls')).length;
  await h.click('[data-retry="calls"]');
  assert.equal(h.reqs('GET', h.tenantPath(TENANT_A, 'calls')).length, before + 1, 'retry issues one new GET');
  assert.equal(h.statusState('calls'), 'ready');
  assert.match(h.text('tbody[data-rows="calls"]'), /call-a-0001/);
  h.finish();
});

test('non-JSON 502 body is handled as an error state without rendering the body', async () => {
  const h = await bootAs('admin');
  h.backend.override('GET', h.tenantPath(TENANT_A, 'bookings'), { status: 502, text: `<html><body>${RAW_MARKER} upstream</body></html>` });
  await h.nav('bookings');
  assert.equal(h.statusState('bookings'), 'error');
  assert.ok(h.visible('[data-retry="bookings"]'));
  assert.ok(!h.pageText().includes(RAW_MARKER));
  h.finish();
});

test('overview error after login shows error state with retry', async () => {
  const h = await setup();
  h.backend.override('GET', h.tenantPath(TENANT_A, 'overview'), { status: 500, body: leakyBody });
  await h.login('admin');
  assert.ok(h.visible('#app-view'));
  assert.equal(h.statusState('overview'), 'error');
  assert.ok(!h.pageText().includes(STACK_MARKER));
  await h.click('[data-retry="overview"]');
  assert.equal(h.statusState('overview'), 'ready');
  assert.match(h.text('[data-metric="calls"]'), /111/);
  h.finish();
});

test('business draft is labelled draft / not active and never claimed active or verified', async () => {
  const h = await bootAs('admin');
  await h.nav('business');
  assert.equal(h.statusState('business'), 'ready');
  const badge = trLower(h.visibleText('#business-draft-badge'));
  assert.ok(badge.includes('taslak') || badge.includes('etkin değil'), `badge says draft/not active: ${badge}`);
  assert.deepEqual(positiveClaims(badge, { status: true }), [], 'badge makes no positive active claim');
  assert.deepEqual(positiveClaims(h.visibleText('section[data-panel="business"]')), [], 'panel makes no verified/activated claim');
  h.finish();
});

test('stored connection shows "doğrulanmadı" and "etkin değil"; no status claims verified/active', async () => {
  const h = await bootAs('admin');
  await h.nav('connections');
  assert.equal(h.statusState('connections'), 'ready');
  const stored = trLower(h.text('[data-connection-status="retellApiKey"]'));
  assert.ok(stored.includes('doğrulanmadı'), `stored status mentions not verified: ${stored}`);
  assert.ok(stored.includes('etkin değil'), `stored status mentions not active: ${stored}`);
  const missing = trLower(h.text('[data-connection-status="googleClientId"]'));
  assert.notEqual(missing, stored, 'unstored status differs from stored status');
  for (const k of CONNECTION_KINDS) {
    assert.deepEqual(positiveClaims(h.text(`[data-connection-status="${k}"]`), { status: true }), [], `${k} status`);
  }
  assert.deepEqual(positiveClaims(h.visibleText('section[data-panel="connections"]')), [], 'connections panel makes no verified/activated claim');
  h.finish();
});

test('overview: providerInvoice null shows not-connected text and no fabricated amount', async () => {
  const h = await bootAs('admin');
  const inv = h.text('[data-metric="providerInvoice"]');
  assert.match(trLower(inv), /bağlı değil|bağlanmadı|bağlantı yok/, `not-connected text: ${inv}`);
  assert.ok(!/\d/.test(inv), `no number fabricated: ${inv}`);
  assert.ok(!/[₺$€£]|\bTL\b|\bUSD\b|\bEUR\b/.test(inv), `no currency: ${inv}`);
  for (const m of ['calls', 'bookings', 'confirmed', 'errors', 'maxCalls']) {
    const want = String(h.backend.data(TENANT_A).overview[m]);
    assert.ok(h.text(`[data-metric="${m}"]`).includes(want), `metric ${m} shows ${want}`);
  }
  assert.ok(!/[₺$€£]/.test(h.visibleText('section[data-panel="overview"]')), 'overview shows no currency symbols');
  h.finish();
});
