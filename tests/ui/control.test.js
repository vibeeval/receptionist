'use strict';
// Kill confirmation dialog: focus management, Escape/Cancel, operationId semantics.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootAs, TENANT_A, assertSameNode } = require('./harness.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dialogOpen = (h) => !h.$('#confirm-dialog').hidden;
const controlPosts = (h) => h.reqs('POST', h.tenantPath(TENANT_A, 'control'));

test('kill toggle opens the dialog and moves focus inside; Escape closes without POST and returns focus', async () => {
  const h = await bootAs('operator');
  await h.nav('control');
  assert.equal(h.statusState('control'), 'ready');
  const toggle = h.$('#kill-toggle');
  await h.click(toggle);
  assert.ok(dialogOpen(h), 'dialog opened (hidden removed)');
  assert.ok(h.$('#confirm-dialog').contains(h.document.activeElement), 'focus moved into the dialog');
  await h.key(null, 'Escape');
  assert.ok(!dialogOpen(h), 'Escape closes dialog');
  assert.equal(controlPosts(h).length, 0, 'no POST on Escape');
  assertSameNode(h.document.activeElement, h.$('#kill-toggle'), 'focus returned to kill toggle');
  h.finish();
});

test('Cancel closes the dialog without POST and returns focus', async () => {
  const h = await bootAs('admin');
  await h.nav('control');
  await h.click('#kill-toggle');
  assert.ok(dialogOpen(h));
  await h.click('#confirm-cancel');
  assert.ok(!dialogOpen(h), 'cancel closes dialog');
  assert.equal(controlPosts(h).length, 0, 'no POST on cancel');
  assertSameNode(h.document.activeElement, h.$('#kill-toggle'), 'focus returned to kill toggle');
  h.finish();
});

test('dialog keeps keyboard focus inside while open (Tab / Shift+Tab)', async () => {
  const h = await bootAs('admin');
  await h.nav('control');
  await h.click('#kill-toggle');
  const dlg = h.$('#confirm-dialog');
  const inside = h.document.tabbables().filter((e) => dlg.contains(e));
  assert.ok(inside.length >= 2, 'dialog has focusable actions');
  const last = inside.at(-1);
  last.focus();
  await h.key(null, 'Tab');
  let now = h.document.activeElement;
  assert.ok(dlg.contains(now) && now !== last, `Tab from last control wraps inside dialog (now ${h.describe(now)})`);
  inside[0].focus();
  await h.key(null, 'Tab', { shiftKey: true });
  now = h.document.activeElement;
  assert.ok(dlg.contains(now) && now !== inside[0], `Shift+Tab from first control wraps inside dialog (now ${h.describe(now)})`);
  await h.click('#confirm-cancel');
  h.finish();
});

test('confirm sends {kill, revision, operationId}; each deliberate action gets a new operationId', async () => {
  const h = await bootAs('admin');
  await h.nav('control');
  const stateBefore = h.text('#kill-state');
  await h.click('#kill-toggle');
  await h.click('#confirm-ok');
  let posts = controlPosts(h);
  assert.equal(posts.length, 1, 'one POST after confirm');
  const first = posts[0].body;
  assert.deepEqual(Object.keys(first).sort(), ['kill', 'operationId', 'revision']);
  assert.equal(first.kill, true);
  assert.equal(first.revision, 7, 'revision is overview.revision');
  assert.match(first.operationId, UUID_RE);
  assert.ok(h.uuids.includes(first.operationId), 'operationId from crypto.randomUUID');
  assert.ok(!dialogOpen(h), 'dialog closed after confirm');
  assert.notEqual(h.text('#kill-state'), stateBefore, 'kill state updated after success');

  await h.click('#kill-toggle');
  assert.ok(dialogOpen(h), 'dialog reopens for the second action');
  await h.click('#confirm-ok');
  posts = controlPosts(h);
  assert.equal(posts.length, 2, 'second deliberate action POSTs once');
  const second = posts[1].body;
  assert.equal(second.kill, false, 'second action reverses kill');
  assert.equal(second.revision, 8, 'uses refreshed revision');
  assert.match(second.operationId, UUID_RE);
  assert.notEqual(second.operationId, first.operationId, 'new operationId per deliberate action');
  h.finish();
});
