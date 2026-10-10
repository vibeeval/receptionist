'use strict';
// Static checks: the shared DOM contract exists in index.html and app.js avoids forbidden APIs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const dom = require('./dom.js');
const { INDEX_PATH, APP_PATH, VIEWS, CONNECTION_KINDS, assertSameNode } = require('./harness.js');

const html = fs.readFileSync(INDEX_PATH, 'utf8');
const appSource = fs.readFileSync(APP_PATH, 'utf8');
const doc = dom.parseDocument(html);

test('index.html contains every id from the shared DOM contract', () => {
  const ids = [
    'login-view', 'login-form', 'login-username', 'login-password', 'login-error',
    'app-view', 'tenant-select', 'user-name', 'user-role', 'demo-banner', 'logout-button', 'menu-toggle', 'main',
    'connections-fieldset', 'connections-message',
    'business-fieldset', 'business-form', 'biz-name', 'biz-service', 'biz-policy', 'biz-timezone', 'biz-start', 'biz-end', 'biz-duration', 'business-message', 'business-draft-badge',
    'limit-fieldset', 'limit-form', 'limit-cap', 'limit-message', 'max-calls',
    'kill-state', 'kill-toggle', 'confirm-dialog', 'confirm-title', 'confirm-ok', 'confirm-cancel', 'control-message',
    'notice', 'global-error',
  ];
  const missing = ids.filter((id) => !doc.getElementById(id));
  assert.deepEqual(missing, [], 'missing ids');
  assert.ok(doc.getElementById('app-view').hidden, '#app-view is hidden until a session exists');
  assert.equal(doc.getElementById('notice').getAttribute('role'), 'status');
  assert.equal(doc.getElementById('global-error').getAttribute('role'), 'alert');
  const dlg = doc.getElementById('confirm-dialog');
  assert.equal(dlg.localName === 'dialog', false, 'confirm dialog is a custom element, not <dialog>');
  assert.equal(dlg.getAttribute('role'), 'dialog');
  assert.ok(dlg.hidden, 'confirm dialog starts hidden');
  assert.equal(doc.getElementById('login-password').type, 'password');
  assert.equal(doc.getElementById('biz-start').type, 'time');
  assert.equal(doc.getElementById('biz-end').type, 'time');
});

test('navigation, panels, status, retry and table hooks exist for every view', () => {
  const missing = [];
  for (const v of VIEWS) {
    const btn = doc.querySelector(`button[data-view="${v}"]`);
    if (!btn) missing.push(`button[data-view="${v}"]`);
    else if (btn.closest('form')) missing.push(`button[data-view="${v}"] must not be inside a form`);
    if (!doc.querySelector(`section[data-panel="${v}"]`)) missing.push(`section[data-panel="${v}"]`);
    if (!doc.querySelector(`[data-status="${v}"]`)) missing.push(`[data-status="${v}"]`);
    if (!doc.querySelector(`[data-retry="${v}"]`)) missing.push(`[data-retry="${v}"]`);
  }
  for (const r of ['calls', 'bookings', 'errors', 'audit', 'audit-admin']) if (!doc.querySelector(`tbody[data-rows="${r}"]`)) missing.push(`tbody[data-rows="${r}"]`);
  for (const m of ['calls', 'bookings', 'confirmed', 'errors', 'maxCalls', 'ready', 'kill', 'providerInvoice']) if (!doc.querySelector(`[data-metric="${m}"]`)) missing.push(`[data-metric="${m}"]`);
  for (const k of CONNECTION_KINDS) {
    const form = doc.querySelector(`form[data-connection-form="${k}"]`);
    if (!form) missing.push(`form[data-connection-form="${k}"]`);
    const input = doc.getElementById(`conn-${k}`);
    if (!input) missing.push(`#conn-${k}`);
    else if (input.type !== 'password') missing.push(`#conn-${k} must be type=password`);
    if (!doc.querySelector(`[data-connection-status="${k}"]`)) missing.push(`[data-connection-status="${k}"]`);
  }
  for (let d = 1; d <= 7; d++) if (!doc.querySelector(`input[name="weekday"][value="${d}"]`)) missing.push(`weekday ${d}`);
  assert.deepEqual(missing, []);
  const visiblePanels = VIEWS.filter((v) => !doc.querySelector(`section[data-panel="${v}"]`).hidden);
  assert.ok(visiblePanels.length <= 1, 'at most one panel visible initially');
});

test('index.html is CSP-clean: no inline script/style/handlers, only local resources, skip link to #main', () => {
  const scripts = doc.querySelectorAll('script');
  assert.ok(scripts.length >= 1);
  for (const s of scripts) {
    assert.equal(s.textContent.trim(), '', 'no inline script content');
    assert.ok(/^\/[^/]/.test(s.getAttribute('src') || ''), 'script src is same-origin path');
  }
  assert.equal(doc.querySelectorAll('style').length, 0, 'no <style> blocks');
  const offenders = [];
  const walk = (el) => {
    for (const a of el.getAttributeNames()) {
      if (a === 'style' || a.startsWith('on')) offenders.push(`${dom.describe(el)} [${a}]`);
      if ((a === 'href' || a === 'src') && /^(https?:)?\/\//i.test(el.getAttribute(a))) offenders.push(`${dom.describe(el)} external ${a}`);
    }
    el.children.forEach(walk);
  };
  walk(doc.documentElement);
  assert.deepEqual(offenders, []);
  const skip = doc.querySelector('a[href="#main"]');
  assert.ok(skip, 'skip link exists');
  assertSameNode(doc.body.firstElementChild, skip, 'skip link is the first focusable element in body');
  assert.ok(doc.getElementById('main').hasAttribute('tabindex'), '#main can receive focus from the skip link');
});

test('app.js avoids forbidden APIs (innerHTML, storage, cookies, eval, native modal, polling)', () => {
  const code = appSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const forbidden = {
    innerHTML: /\.innerHTML\b/, outerHTML: /\.outerHTML\b/, insertAdjacentHTML: /insertAdjacentHTML/,
    localStorage: /localStorage/, sessionStorage: /sessionStorage/, 'document.cookie': /document\.cookie/,
    eval: /\beval\s*\(/, 'new Function': /new\s+Function\s*\(/, showModal: /showModal/, requestSubmit: /requestSubmit/,
    FormData: /\bFormData\b/, 'form.elements': /\.elements\b/, setInterval: /\bsetInterval\s*\(/,
    'external URL': /https?:\/\//,
    'ES module syntax': /^\s*(import|export)\s/m,
  };
  const hits = Object.entries(forbidden).filter(([, re]) => re.test(code)).map(([k]) => k);
  assert.deepEqual(hits, []);
});
