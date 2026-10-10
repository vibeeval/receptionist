'use strict';
// Login, session restore, 401 handling, CSRF on writes, logout, and no client-side persistence.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, bootAs, DEMO_PASSWORD, TENANT_A, TENANT_B, VIEWS } = require('./harness.js');

const jsonType = (r) => String(r.headers['content-type'] || '').split(';')[0].trim();
const sameOrigin = (r) => (r.credentials ?? 'same-origin') === 'same-origin';

test('initial load without a session shows the login view quietly', async () => {
  const h = await setup();
  assert.ok(h.visible('#login-view'), 'login view visible');
  assert.ok(!h.visible('#app-view'), 'app view hidden');
  assert.equal(h.reqs(null, /^\/api\/tenants\//).length, 0, 'no tenant requests without session');
  assert.equal(h.text('#login-error'), '', 'no error shown for a missing session');
  h.finish();
});

test('existing cookie session (GET /api/session 200) restores the app without login', async () => {
  const h = await setup({ backend: { loggedInAs: 'admin' } });
  assert.equal(h.reqs('GET', '/api/session').length, 1, 'session checked once on boot');
  assert.ok(h.visible('#app-view'), 'app view shown');
  assert.ok(!h.visible('#login-view'), 'login hidden');
  assert.equal(h.reqs('POST', '/api/login').length, 0);
  h.finish();
});

test('login posts JSON {username,password} same-origin, then loads session and shows the app', async () => {
  const h = await setup();
  await h.login('admin');
  const logins = h.reqs('POST', '/api/login');
  assert.equal(logins.length, 1, 'exactly one login POST');
  const r = logins[0];
  assert.equal(jsonType(r), 'application/json');
  assert.ok(sameOrigin(r), `credentials must be same-origin, got ${r.credentials}`);
  assert.equal(typeof r.rawBody, 'string', 'body is a JSON string');
  assert.deepEqual(r.body, { username: 'admin', password: DEMO_PASSWORD });
  assert.ok(h.requests.some((x) => x.seq > r.seq && x.method === 'GET' && x.path === '/api/session'), 'GET /api/session after login');

  assert.ok(h.visible('#app-view'), 'app view visible');
  assert.ok(!h.visible('#login-view'), 'login view hidden');
  const options = h.$$('#tenant-select option').map((o) => o.value);
  assert.deepEqual(options, [TENANT_A, TENANT_B], 'tenant select populated from session.tenants');
  assert.equal(h.$('#tenant-select').value, TENANT_A);
  assert.equal(h.$('#login-password').value, '', 'password field cleared');
  assert.match(h.text('#user-name'), /admin/);
  assert.notEqual(h.text('#user-role'), '', 'role label shown');
  assert.ok(h.visible('#demo-banner'), 'demo banner visible for demo session');
  assert.match(h.text('[data-metric="calls"]'), /111/, 'overview for first tenant rendered');
  const bad = h.requests.filter((x) => !sameOrigin(x)).map((x) => `${x.method} ${x.path} credentials=${x.credentials}`);
  assert.deepEqual(bad, [], 'all requests use same-origin credentials');
  h.finish();
});

test('failed login (401) shows an actionable error without raw response body and stays on login', async () => {
  const h = await setup();
  await h.login('admin', 'wrong-synthetic-password');
  assert.ok(h.visible('#login-view'));
  assert.ok(!h.visible('#app-view'));
  const msg = h.text('#login-error');
  assert.notEqual(msg, '', 'error text shown');
  for (const raw of ['{', '"code"', 'LOGIN_FAILED', 'requestId', 'wrong-synthetic-password']) {
    assert.ok(!msg.includes(raw), `login error must not contain ${raw}: ${msg}`);
  }
  assert.ok(!h.pageText().includes('wrong-synthetic-password'), 'password never rendered');
  h.finish();
});

test('401 on a tenant GET clears the session UI; re-login uses the new session and CSRF only', async () => {
  const h = await bootAs('admin');
  assert.ok(h.visible('#app-view'));
  h.backend.expireSession();
  const mark = h.requests.length;
  await h.nav('calls');
  assert.ok(h.reqs('GET', /\/calls$/).length >= 1, 'calls requested');
  assert.ok(!h.visible('#app-view'), 'app view hidden after 401');
  assert.ok(h.visible('#login-view'), 'login view shown after 401');

  await h.login('viewer');
  assert.ok(h.visible('#app-view'), 'app view after re-login');
  assert.match(h.text('#user-name'), /viewer/, 'new session user shown');
  await h.click('#logout-button');
  const logout = h.reqs('POST', '/api/logout').at(-1);
  assert.ok(logout, 'logout POST sent');
  assert.equal(logout.headers['x-csrf-token'], 'csrf-synthetic-2', 'logout uses the new session csrf');
  const stale = h.requests.slice(mark).filter((r) => r.headers['x-csrf-token'] === 'csrf-synthetic-1');
  assert.deepEqual(stale.map((r) => r.path), [], 'old csrf never reused after 401');
  assert.ok(h.visible('#login-view'), 'login view after logout');
  assert.ok(!h.visible('#app-view'));
  h.finish();
});

test('authenticated POSTs send X-CSRF-Token from session and JSON content type', async () => {
  const h = await bootAs('admin');
  await h.nav('budget');
  await h.type('#limit-cap', '600000');
  await h.submit('#limit-form');
  await h.nav('business');
  await h.submit('#business-form');
  await h.nav('connections');
  await h.type('#conn-googleClientId', 'synthetic-client-id-value');
  await h.submit('form[data-connection-form="googleClientId"]');
  await h.nav('control');
  await h.click('#kill-toggle');
  await h.click('#confirm-ok');
  await h.click('#logout-button');

  const posts = h.reqs('POST').filter((r) => r.path !== '/api/login');
  const paths = posts.map((p) => p.path);
  for (const want of [`/api/tenants/${TENANT_A}/limits`, `/api/tenants/${TENANT_A}/business`, `/api/tenants/${TENANT_A}/connections`, `/api/tenants/${TENANT_A}/control`, '/api/logout']) {
    assert.ok(paths.includes(want), `expected POST ${want}; got ${paths.join(', ')}`);
  }
  for (const p of posts) {
    assert.equal(p.headers['x-csrf-token'], 'csrf-synthetic-1', `${p.path} csrf header`);
    assert.equal(jsonType(p), 'application/json', `${p.path} content-type`);
    assert.ok(sameOrigin(p), `${p.path} credentials`);
    assert.equal(typeof p.rawBody, 'string', `${p.path} JSON body`);
  }
  assert.deepEqual(h.reqs('POST', '/api/logout')[0].body, {}, 'logout body is {}');
  h.finish();
});

test('no auth/secret persistence or unsafe DOM APIs at runtime', async () => {
  const h = await bootAs('admin');
  for (const v of VIEWS) await h.nav(v);
  await h.nav('connections');
  await h.type('#conn-retellApiKey', 'synthetic-secret-runtime');
  await h.submit('form[data-connection-form="retellApiKey"]');
  await h.click('#logout-button');
  assert.deepEqual(h.storageLog.map((x) => `${x.storage}.${x.op}`), [], 'localStorage/sessionStorage never touched');
  assert.deepEqual(h.document.__cookieWrites, [], 'document.cookie never written');
  assert.deepEqual(h.document.__htmlWrites.filter((w) => w.value !== '').map((w) => w.prop), [], 'no HTML string injection');
  assert.deepEqual(h.nativeDialogs, [], 'no alert/confirm/prompt');
  assert.deepEqual([...new Set(h.document.__usage)], [], 'no showModal/requestSubmit/form.elements');
  assert.deepEqual(h.document.__navigations.filter((n) => n.kind !== 'link'), [], 'no full-page form submission or reload');
  h.finish();
});
