'use strict';
// Self-tests for the DOM fixture and harness, independent of the dashboard implementation.
const test = require('node:test');
const assert = require('node:assert/strict');
const dom = require('./dom.js');
const { setup, assertSameNode, assertNotSameNode } = require('./harness.js');

const SAMPLE = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>T &amp; S</title><link rel="stylesheet" href="/style.css"><script src="/app.js" defer></script></head>
<body>
<!-- comment -->
<a href="#main" class="skip">İçeriğe geç</a>
<div id="root" class="a b" data-user-role="admin">
  <p>One<p>Two
  <ul><li>x<li>y</ul>
  <form id="f"><fieldset id="fs" disabled><legend><button type="button" id="in-legend">L</button></legend><input id="in-fs" name="n"></fieldset>
    <input id="num" type="number" min="0" max="10" step="1" required>
    <input type="checkbox" name="weekday" value="1" checked><input type="checkbox" name="weekday" value="2">
    <select id="sel"><option value="a">A</option><option value="b" selected>B</option></select>
    <textarea id="ta">hello &lt;b&gt;</textarea>
    <button id="go">Go</button>
  </form>
  <table><tbody data-rows="calls"><tr><td>1<td>2</tr></tbody></table>
  <section data-panel="calls" hidden><button id="hidden-btn">H</button></section>
  <img src="x.png" alt="x"><br/>
</div>
<main id="main" tabindex="-1"></main>
</body></html>`;

test('parser builds document, head/body, void elements, comments, entities', () => {
  const d = dom.parseDocument(SAMPLE);
  assert.equal(d.documentElement.localName, 'html');
  assert.equal(d.documentElement.getAttribute('lang'), 'tr');
  assert.equal(d.title, 'T & S');
  assert.ok(d.head.querySelector('script[src="/app.js"]'));
  assert.ok(d.body.querySelector('a.skip'));
  assert.equal(d.querySelectorAll('#root > p').length, 2, 'implicit </p>');
  assert.equal(d.querySelectorAll('li').length, 2, 'implicit </li>');
  assert.equal(d.querySelector('img').childNodes.length, 0);
  assert.equal(d.getElementById('ta').value, 'hello <b>');
  assert.equal(d.querySelectorAll('tbody[data-rows="calls"] td').length, 2);
  assert.ok(d.body.childNodes.some((n) => n.nodeType === 8));
  assertSameNode(d.getElementById('main').parentNode, d.body);
});

test('selectors: id, class, tag, attributes, descendant, child, comma, pseudo', () => {
  const d = dom.parseDocument(SAMPLE);
  assert.equal(d.querySelector('#root').id, 'root');
  assert.equal(d.querySelector('div.a.b').id, 'root');
  assert.equal(d.querySelectorAll('input[name="weekday"]').length, 2);
  assert.equal(d.querySelectorAll('input[name=weekday][value="2"]').length, 1);
  assert.equal(d.querySelectorAll('[data-user-role]').length, 1);
  assert.equal(d.querySelectorAll('form input').length, 4);
  assert.equal(d.querySelectorAll('#root > form > input').length, 3);
  assert.equal(d.querySelectorAll('#num, #sel, #nope').length, 2);
  assert.equal(d.querySelectorAll('input[name="weekday"]:checked').length, 1);
  assert.equal(d.querySelectorAll('input:not([type])').length, 1);
  assert.ok(d.getElementById('in-fs').matches(':disabled'));
  assert.ok(!d.getElementById('in-legend').matches(':disabled'), 'first legend is not disabled by fieldset');
  assert.equal(d.getElementById('in-fs').closest('fieldset').id, 'fs');
  assert.throws(() => d.querySelector('p::before'), /unsupported/);
});

test('properties reflect attributes; value/checked/select/classList/dataset', () => {
  const d = dom.parseDocument(SAMPLE);
  const root = d.getElementById('root');
  assert.equal(root.dataset.userRole, 'admin');
  root.dataset.state = 'ready';
  assert.equal(root.getAttribute('data-state'), 'ready');
  root.classList.add('c');
  root.classList.remove('a');
  assert.equal(root.className, 'b c');
  assert.equal(root.classList.toggle('b'), false);
  const num = d.getElementById('num');
  assert.equal(num.type, 'number');
  num.value = 'abc';
  assert.equal(num.value, '', 'number input sanitizes');
  num.value = 11;
  assert.equal(num.value, '11');
  assert.equal(num.validity.rangeOverflow, true);
  num.value = '1.5';
  assert.equal(num.validity.stepMismatch, true);
  const sel = d.getElementById('sel');
  assert.equal(sel.value, 'b');
  sel.value = 'a';
  assert.equal(sel.selectedIndex, 0);
  const btn = d.getElementById('go');
  assert.equal(btn.type, 'submit');
  btn.disabled = true;
  assert.equal(btn.getAttribute('disabled'), '');
  btn.hidden = true;
  assert.ok(btn.hasAttribute('hidden'));
  assert.equal(btn.toggleAttribute('hidden'), false);
  const cb = d.querySelector('input[value="1"]');
  assert.equal(cb.checked, true);
  cb.checked = false;
  assert.equal(cb.hasAttribute('checked'), true, 'checked property does not change attribute');
});

test('tree mutation and textContent', () => {
  const d = dom.parseDocument('<html><body><div id="x"></div></body></html>');
  const x = d.getElementById('x');
  const a = d.createElement('span');
  a.textContent = 'a';
  x.append(a, 'b');
  x.insertBefore(d.createTextNode('0'), a);
  assert.equal(x.textContent, '0ab');
  x.replaceChildren(d.createElement('i'));
  assert.equal(x.children.length, 1);
  assert.equal(x.firstChild.localName, 'i');
  x.firstChild.remove();
  assert.equal(x.childNodes.length, 0);
  x.textContent = 'z';
  assert.equal(x.textContent, 'z');
  assert.ok(d.body.contains(x));
  assertSameNode(x.parentNode, d.body);
});

test('events bubble, capture, preventDefault, once, listener counts', () => {
  const d = dom.parseDocument(SAMPLE);
  const order = [];
  const root = d.getElementById('root');
  const go = d.getElementById('go');
  const f = () => order.push('root');
  root.addEventListener('click', f);
  root.addEventListener('click', f);
  assert.equal(root.listenerCount('click'), 1, 'identical listener is deduplicated like browsers');
  d.addEventListener('click', () => order.push('doc-capture'), true);
  go.addEventListener('click', (e) => { order.push('target'); e.preventDefault(); }, { once: true });
  const ok = go.dispatchEvent(new dom.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(ok, false);
  assert.deepEqual(order, ['doc-capture', 'target', 'root']);
  assert.equal(go.listenerCount('click'), 0);
  root.removeEventListener('click', f);
  assert.equal(root.listenerCount(), 0);
  const thrower = d.createElement('b');
  thrower.addEventListener('x', () => { throw new Error('boom'); });
  thrower.dispatchEvent(new dom.Event('x'));
  assert.equal(d.stats.errors.length, 1);
});

test('click on submit button dispatches submit after validation; disabled does nothing', () => {
  const d = dom.parseDocument(SAMPLE);
  const form = d.getElementById('f');
  let submits = 0;
  form.addEventListener('submit', (e) => { e.preventDefault(); submits++; });
  d.getElementById('go').click();
  assert.equal(submits, 0, 'required number blocks native submission');
  assert.equal(d.__blockedSubmits.length, 1);
  d.getElementById('num').value = '3';
  d.getElementById('go').click();
  assert.equal(submits, 1);
  assert.equal(d.__navigations.length, 0);
  d.getElementById('go').disabled = true;
  d.getElementById('go').click();
  assert.equal(submits, 1);
  const cb = d.querySelector('input[value="2"]');
  let changes = 0;
  cb.addEventListener('change', () => changes++);
  cb.click();
  assert.equal(cb.checked, true);
  assert.equal(changes, 1);
});

test('focus rules: hidden/disabled not focusable, activeElement fixup, Tab navigation', () => {
  const d = dom.parseDocument(SAMPLE);
  assertSameNode(d.activeElement, d.body);
  d.getElementById('hidden-btn').focus();
  assertSameNode(d.activeElement, d.body, 'hidden subtree is not focusable');
  d.getElementById('in-fs').focus();
  assertSameNode(d.activeElement, d.body, 'disabled fieldset control is not focusable');
  const main = d.getElementById('main');
  main.focus();
  assertSameNode(d.activeElement, main, 'tabindex=-1 is programmatically focusable');
  const sec = d.querySelector('[data-panel="calls"]');
  sec.hidden = false;
  const hb = d.getElementById('hidden-btn');
  hb.focus();
  assertSameNode(d.activeElement, hb);
  sec.hidden = true;
  assertSameNode(d.activeElement, d.body, 'focus fixup when focused element becomes hidden');
  d.querySelector('a.skip').focus();
  d.__userKey(null, 'Tab');
  assertNotSameNode(d.activeElement, d.querySelector('a.skip'));
});

test('harness: app runs in vm with fetch mock, storage spy and deterministic uuids', async () => {
  const html = '<!doctype html><html><body><button id="b">x</button><p id="out"></p></body></html>';
  const appSource = `(function(){
    var out = document.getElementById('out');
    document.getElementById('b').addEventListener('click', async function(){
      var r = await fetch('/api/session', {credentials:'same-origin'});
      var d = await r.json();
      out.textContent = r.status + ':' + d.code + ':' + crypto.randomUUID() + ':' + (window === globalThis) + ':' + (out instanceof HTMLElement);
    });
  })();`;
  const h = await setup({ html, appSource });
  await h.click('#b');
  assert.equal(h.text('#out'), '401:LOGIN_REQUIRED:00000000-0000-4000-8000-000000000001:true:true');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].credentials, 'same-origin');
  assert.deepEqual(h.storageLog, []);
  assert.deepEqual(h.fatalErrors(), []);
  h.dispose();
});

test('harness: hold() defers a response until released', async () => {
  const html = '<!doctype html><html><body><p id="out"></p></body></html>';
  const h = await setup({ html, appSource: 'void 0', backend: { loggedInAs: 'viewer' } });
  const held = h.backend.hold('GET', '/api/session');
  h.run(`fetch('/api/session').then(function(r){ return r.json(); }).then(function(d){ document.getElementById('out').textContent = d.username; });`);
  await h.flush();
  assert.equal(h.text('#out'), '', 'held');
  held.release();
  await h.flush();
  assert.equal(h.text('#out'), 'viewer');
  h.dispose();
});
