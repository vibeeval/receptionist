'use strict';
// Loads public/dashboard/index.html into the DOM fixture and runs app.js in a node:vm context
// against a synthetic in-memory backend that follows docs/dashboard-api.md.
// All values here are explicitly synthetic test data.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dom = require('./dom.js');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX_PATH = path.join(ROOT, 'public', 'dashboard', 'index.html');
const APP_PATH = path.join(ROOT, 'public', 'dashboard', 'app.js');
const ORIGIN = 'http://127.0.0.1:8788';

const DEMO_PASSWORD = 'demo-local-only-2026';
const TENANT_A = 'tenant-demo-a';
const TENANT_B = 'tenant-demo-b';
const CONNECTION_KINDS = ['retellApiKey', 'googleClientId', 'googleClientSecret', 'googleRefreshToken'];
const OBSERVED_AT = Date.UTC(2026, 9, 9, 9, 30, 0);
const VIEWS = ['overview', 'calls', 'bookings', 'connections', 'business', 'budget', 'control', 'errors', 'audit'];

// ---------------------------------------------------------------- synthetic data

function tenantData(tenant) {
  const isA = tenant === TENANT_A;
  const tag = isA ? 'a' : 'b';
  return {
    overview: {
      calls: isA ? 111 : 222,
      bookings: isA ? 12 : 24,
      confirmed: isA ? 7 : 14,
      errors: isA ? 3 : 0,
      budget: { tenant, cap: isA ? 500000 : 900000, reserved: isA ? 1000 : 2000, spent: isA ? 2500 : 5000 },
      limitRevision: isA ? 4 : 40,
      kill: false,
      revision: isA ? 7 : 70,
      maxCalls: isA ? 25 : 50,
      ready: true,
      providerMock: true,
      demo: true,
      providerInvoice: null,
      providerInvoiceReason: 'NOT_CONNECTED',
      costUnit: 'core_reservation_micros',
      observedAt: OBSERVED_AT,
    },
    calls: { items: [{ id: `call-${tag}-0001`, state: 'ended', started_ms: OBSERVED_AT - 600000, last_event_ms: OBSERVED_AT - 300000 }], limit: 100 },
    bookings: { items: [{ id: `booking-${tag}-0001`, call_id: `call-${tag}-0001`, state: 'confirmed', created_ms: OBSERVED_AT - 500000, provider_mock: 1, start_ms: OBSERVED_AT + 86400000, end_ms: OBSERVED_AT + 86400000 + 1800000, service: `Sentetik hizmet ${tag.toUpperCase()}` }], limit: 100 },
    errors: { items: [{ job_id: isA ? 9001 : 9002, reason: `synthetic-reason-${tag}`, state: 'needs_operator', created_ms: OBSERVED_AT - 400000, kind: 'booking', attempts: 2 }], replayAvailable: false },
    audit: {
      items: [{ id: `audit-${tag}-0001`, action: `synthetic.core.${tag}`, at_ms: OBSERVED_AT - 200000 }],
      admin: [{ id: `audit-admin-${tag}-0001`, actor: `hash-${tag}-0001`, action: `synthetic.admin.${tag}`, at_ms: OBSERVED_AT - 100000 }],
    },
    business: {
      draft: {
        value: { name: `Demo İşletme ${tag.toUpperCase()}`, service: 'Sentetik muayene', policy: 'Sentetik politika metni.', timezone: 'Europe/Istanbul', weekdays: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020, durationMinutes: 30 },
        revision: isA ? 3 : 30,
        updated: OBSERVED_AT - 50000,
        active: false,
      },
      effective: null,
      activationAvailable: false,
    },
    connections: {
      items: CONNECTION_KINDS.map((kind) => ({ kind, stored: kind === 'retellApiKey', updated: kind === 'retellApiKey' ? OBSERVED_AT - 40000 : null, verified: false, active: false })),
      runtimeProviderMock: true,
      activationAvailable: false,
      liveVerificationAvailable: false,
    },
  };
}

const clone = (x) => JSON.parse(JSON.stringify(x));

function defaultTenantsFor(username) {
  const role = ['admin', 'operator', 'viewer'].includes(username) ? username : 'viewer';
  return [{ id: TENANT_A, role }, { id: TENANT_B, role }];
}

// ---------------------------------------------------------------- backend

function createBackend(opts = {}) {
  const state = {
    loggedIn: false,
    username: null,
    csrf: null,
    csrfCounter: 0,
    demo: opts.demo ?? true,
    tenantsFor: opts.tenantsFor || ((u) => (opts.tenants ? clone(opts.tenants) : defaultTenantsFor(u))),
    data: { [TENANT_A]: tenantData(TENANT_A), [TENANT_B]: tenantData(TENANT_B) },
  };
  const overrides = [];
  const holds = [];
  let reqId = 0;

  if (opts.loggedInAs) login(opts.loggedInAs);

  function login(username) {
    state.loggedIn = true;
    state.username = username;
    state.csrfCounter++;
    state.csrf = `csrf-synthetic-${state.csrfCounter}`;
    state.tenants = state.tenantsFor(username);
  }
  const err = (status, code) => ({ status, body: { code, requestId: `req-synthetic-${++reqId}` } });
  const matches = (rule, req) => rule.method === req.method && (rule.path instanceof RegExp ? rule.path.test(req.path) : rule.path === req.path);

  function route(req) {
    const { method, path: p, body, headers } = req;
    if (method === 'POST') {
      if (headers['content-type'] !== 'application/json' && !String(headers['content-type'] || '').startsWith('application/json')) return err(415, 'CONTENT_TYPE_REQUIRED');
    }
    if (p === '/api/login' && method === 'POST') {
      const ok = body && typeof body === 'object' && ['admin', 'operator', 'viewer'].includes(body.username) && body.password === DEMO_PASSWORD;
      if (!ok) return err(401, 'LOGIN_FAILED');
      login(body.username);
      return { status: 200, body: { ok: true } };
    }
    if (p === '/api/session' && method === 'GET') {
      if (!state.loggedIn) return err(401, 'LOGIN_REQUIRED');
      return { status: 200, body: { username: state.username, csrf: state.csrf, tenants: clone(state.tenants), demo: state.demo } };
    }
    if (!state.loggedIn) return err(401, 'LOGIN_REQUIRED');
    if (method === 'POST' && headers['x-csrf-token'] !== state.csrf) return err(403, 'CSRF_REJECTED');
    if (p === '/api/logout' && method === 'POST') {
      state.loggedIn = false;
      state.csrf = null;
      return { status: 200, body: { ok: true } };
    }
    const m = /^\/api\/tenants\/([^/]+)\/([a-z]+)$/.exec(p);
    if (!m) return err(404, 'NOT_FOUND');
    const tenant = decodeURIComponent(m[1]);
    const resource = m[2];
    const access = state.tenants.find((t) => t.id === tenant);
    if (!access || !state.data[tenant]) return err(403, 'TENANT_FORBIDDEN');
    const d = state.data[tenant];
    if (method === 'GET') {
      if (!['overview', 'calls', 'bookings', 'errors', 'audit', 'business', 'connections'].includes(resource)) return err(404, 'NOT_FOUND');
      return { status: 200, body: clone(d[resource]) };
    }
    if (method !== 'POST') return err(405, 'METHOD_NOT_ALLOWED');
    const role = access.role;
    if (resource === 'control') {
      if (role === 'viewer') return err(403, 'ROLE_FORBIDDEN');
      if (!body || typeof body.kill !== 'boolean' || !Number.isInteger(body.revision) || typeof body.operationId !== 'string') return err(400, 'INVALID_INPUT');
      if (body.revision !== d.overview.revision) return err(409, 'STALE_REVISION');
      d.overview.kill = body.kill;
      d.overview.revision++;
      return { status: 200, body: { kill: d.overview.kill, revision: d.overview.revision, providerMock: true } };
    }
    if (role !== 'admin') return err(403, 'ROLE_FORBIDDEN');
    if (resource === 'limits') {
      if (!body || !Number.isInteger(body.cap) || body.cap < 0 || body.cap > 1e9) return err(400, 'INVALID_INPUT');
      if (body.revision !== d.overview.limitRevision) return err(409, 'STALE_REVISION');
      d.overview.budget.cap = body.cap;
      d.overview.limitRevision++;
      return { status: 200, body: { cap: body.cap, revision: d.overview.limitRevision, providerHardCap: false } };
    }
    if (resource === 'business') {
      if (!body || typeof body.value !== 'object' || body.value === null) return err(400, 'INVALID_BUSINESS');
      if (body.revision !== d.business.draft.revision) return err(409, 'STALE_REVISION');
      d.business.draft = { value: clone(body.value), revision: d.business.draft.revision + 1, updated: OBSERVED_AT + 1000, active: false };
      return { status: 200, body: { draft: clone(d.business.draft) } };
    }
    if (resource === 'connections') {
      if (!body || !CONNECTION_KINDS.includes(body.kind) || typeof body.value !== 'string' || !body.value) return err(400, 'INVALID_INPUT');
      const item = d.connections.items.find((x) => x.kind === body.kind);
      item.stored = true;
      item.updated = OBSERVED_AT + 2000;
      return { status: 200, body: { stored: true, verified: false, active: false } };
    }
    return err(404, 'NOT_FOUND');
  }

  async function handle(req) {
    const hold = holds.find((h) => !h.taken && matches(h, req));
    if (hold) {
      hold.taken = true;
      hold.request = req;
      hold.arrived();
      const forced = await hold.gate;
      if (forced) return forced;
    }
    const ov = overrides.find((o) => o.remaining > 0 && matches(o, req));
    if (ov) {
      ov.remaining--;
      return typeof ov.spec === 'function' ? ov.spec(req, state) : ov.spec;
    }
    return route(req);
  }

  return {
    state,
    handle,
    data: (tenant) => state.data[tenant],
    // Next `times` matching requests get `spec` ({status, body} | {status, text} | fn(req,state)).
    override(method, p, spec, times = 1) { overrides.push({ method, path: p, spec, remaining: times }); },
    // Next matching request is held until release([spec]); without spec it is answered normally.
    hold(method, p) {
      let release;
      let arrived;
      const h = { method, path: p, taken: false, request: null };
      h.gate = new Promise((r) => { release = r; });
      h.arrivedPromise = new Promise((r) => { arrived = r; });
      h.arrived = arrived;
      h.release = (spec) => release(spec);
      holds.push(h);
      return h;
    },
    expireSession() { state.loggedIn = false; },
  };
}

// ---------------------------------------------------------------- environment pieces

function normalizeHeaders(h) {
  const out = {};
  if (!h) return out;
  if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => { out[String(k).toLowerCase()] = String(v); });
  else if (Array.isArray(h)) for (const [k, v] of h) out[String(k).toLowerCase()] = String(v);
  else for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

function createTimers() {
  let now = 0;
  let seq = 0;
  const queue = new Map();
  const intervals = [];
  const add = (fn, delay, args, repeat) => {
    const id = ++seq;
    queue.set(id, { fn, at: now + Math.max(0, Number(delay) || 0), args, repeat: repeat ? Math.max(1, Number(delay) || 0) : 0 });
    if (repeat) intervals.push({ id, delay });
    return id;
  };
  function runDue() {
    let ran = 0;
    for (;;) {
      const due = [...queue.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (!due.length || ran > 1000) return ran;
      const [id, t] = due[0];
      if (t.repeat) t.at += t.repeat; else queue.delete(id);
      ran++;
      if (typeof t.fn === 'function') t.fn(...(t.args || []));
    }
  }
  return {
    setTimeout: (fn, delay, ...args) => add(fn, delay, args, false),
    clearTimeout: (id) => { queue.delete(id); },
    setInterval: (fn, delay, ...args) => add(fn, delay, args, true),
    clearInterval: (id) => { queue.delete(id); },
    runDue,
    advance(ms) { const target = now + ms; while (now < target) { now = Math.min(target, now + 10); runDue(); } },
    pending: () => queue.size,
    intervals,
  };
}

function createStorageSpy(name, log) {
  const data = new Map();
  const rec = (op, ...args) => log.push({ storage: name, op, args });
  return {
    getItem(k) { rec('getItem', k); return data.has(String(k)) ? data.get(String(k)) : null; },
    setItem(k, v) { rec('setItem', k, v); data.set(String(k), String(v)); },
    removeItem(k) { rec('removeItem', k); data.delete(String(k)); },
    clear() { rec('clear'); data.clear(); },
    key(i) { rec('key', i); return [...data.keys()][i] ?? null; },
    get length() { rec('length'); return data.size; },
  };
}

let activeHarness = null;
process.on('unhandledRejection', (reason) => {
  if (activeHarness) activeHarness.errors.push(reason);
  else throw reason;
});

// ---------------------------------------------------------------- harness

async function setup(opts = {}) {
  const backend = createBackend(opts.backend);
  const html = opts.html ?? fs.readFileSync(INDEX_PATH, 'utf8');
  const code = opts.appSource ?? fs.readFileSync(APP_PATH, 'utf8');
  const document = dom.parseDocument(html);
  const win = new dom.WindowTarget(document.stats);
  document.defaultView = win;

  const timers = createTimers();
  const storageLog = [];
  const requests = [];
  const uuids = [];
  const nativeDialogs = [];
  const consoleErrors = [];
  const location = {
    origin: ORIGIN, protocol: 'http:', host: '127.0.0.1:8788', hostname: '127.0.0.1', port: '8788',
    pathname: '/', search: '', hash: opts.hash ?? '',
    get href() { return ORIGIN + this.pathname + this.search + this.hash; },
    assign(u) { document.__navigations.push({ kind: 'location.assign', href: String(u) }); },
    replace(u) { document.__navigations.push({ kind: 'location.replace', href: String(u) }); },
    reload() { document.__navigations.push({ kind: 'location.reload' }); },
    toString() { return this.href; },
  };
  const setHash = (url) => {
    if (url == null) return;
    const u = new URL(String(url), location.href);
    location.pathname = u.pathname; location.search = u.search; location.hash = u.hash;
  };
  const history = {
    length: 1, state: null,
    pushState(s, _t, url) { this.state = s; setHash(url); },
    replaceState(s, _t, url) { this.state = s; setHash(url); },
    back() {}, forward() {}, go() {},
  };
  document.__navigate = (href) => {
    document.__navigations.push({ kind: 'link', href });
    if (String(href).startsWith('#')) {
      location.hash = href === '#' ? '' : href;
      win.dispatchEvent(new dom.Event('hashchange'));
    }
  };

  let ctxJSON = JSON;
  let seq = 0;
  function makeResponse(spec, url) {
    const status = spec.status ?? 200;
    const isText = spec.text !== undefined;
    const text = isText ? spec.text : JSON.stringify(spec.body ?? {});
    const headers = new Headers({ 'content-type': isText ? spec.contentType || 'text/html' : 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    const res = {
      ok: status >= 200 && status < 300, status, statusText: '', headers, url: ORIGIN + url, redirected: false, type: 'basic', bodyUsed: false,
      async json() { res.bodyUsed = true; return ctxJSON.parse(text); },
      async text() { res.bodyUsed = true; return text; },
      clone() { return makeResponse(spec, url); },
    };
    return res;
  }
  async function fetchMock(input, init = {}) {
    const rawUrl = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
    const u = new URL(rawUrl, ORIGIN + '/');
    const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    const headers = normalizeHeaders(init.headers);
    let body;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } } else body = init.body;
    const req = { seq: ++seq, method, url: rawUrl, path: u.pathname, search: u.search, origin: u.origin, headers, body, rawBody: init.body, credentials: init.credentials, mode: init.mode, cache: init.cache, signal: init.signal };
    requests.push(req);
    if (u.origin !== ORIGIN) throw new TypeError('fixture: cross-origin fetch blocked: ' + u.origin);
    const signal = init.signal;
    const abortError = () => { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; return e; };
    if (signal && signal.aborted) { req.aborted = true; throw abortError(); }
    const result = backend.handle(req).then((spec) => makeResponse(spec, u.pathname + u.search));
    if (!signal) return result;
    return Promise.race([result, new Promise((_, reject) => signal.addEventListener('abort', () => { req.aborted = true; reject(abortError()); }, { once: true }))]);
  }

  const sandbox = {
    document,
    console: {
      log() {}, info() {}, debug() {}, warn() {},
      error(...a) { consoleErrors.push(a); },
    },
    fetch: fetchMock,
    location,
    history,
    navigator: { language: 'tr-TR', languages: ['tr-TR', 'tr'], userAgent: 'node-dom-fixture', onLine: true, clipboard: undefined },
    crypto: {
      randomUUID() {
        const n = uuids.length + 1;
        const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
        uuids.push(id);
        return id;
      },
      getRandomValues(arr) { for (let k = 0; k < arr.length; k++) arr[k] = (k * 31 + 7) & 0xff; return arr; },
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    requestAnimationFrame: (fn) => timers.setTimeout(() => fn(0), 0),
    cancelAnimationFrame: timers.clearTimeout,
    requestIdleCallback: (fn) => timers.setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 50 }), 0),
    queueMicrotask,
    matchMedia: (q) => ({ matches: !!(opts.media && opts.media[q]), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return true; } }),
    localStorage: createStorageSpy('localStorage', storageLog),
    sessionStorage: createStorageSpy('sessionStorage', storageLog),
    getComputedStyle: () => new Proxy({}, { get: (_, k) => (k === 'getPropertyValue' ? () => '' : '') }),
    scrollTo() {}, scrollBy() {}, scroll() {},
    innerWidth: opts.innerWidth ?? 1440, innerHeight: 900, devicePixelRatio: 1, scrollX: 0, scrollY: 0, pageXOffset: 0, pageYOffset: 0,
    alert: (m) => { nativeDialogs.push({ kind: 'alert', m }); },
    confirm: (m) => { nativeDialogs.push({ kind: 'confirm', m }); return false; },
    prompt: (m) => { nativeDialogs.push({ kind: 'prompt', m }); return null; },
    open: (u) => { document.__navigations.push({ kind: 'window.open', href: String(u) }); return null; },
    Event: dom.Event, UIEvent: dom.UIEvent, MouseEvent: dom.MouseEvent, PointerEvent: dom.PointerEvent, KeyboardEvent: dom.KeyboardEvent,
    FocusEvent: dom.FocusEvent, InputEvent: dom.InputEvent, SubmitEvent: dom.SubmitEvent, CustomEvent: dom.CustomEvent,
    EventTarget: dom.EventTarget, Node: dom.Node, Element: dom.Element, Text: dom.Text, Comment: dom.Comment, DocumentFragment: dom.DocumentFragment, Document: dom.Document,
    ...dom.htmlClasses,
    Headers, URL, URLSearchParams, AbortController, AbortSignal, DOMException, structuredClone, TextEncoder, TextDecoder,
  };
  for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent']) sandbox[k] = win[k].bind(win);
  for (const t of ['hashchange', 'popstate', 'resize', 'load', 'keydown']) {
    Object.defineProperty(sandbox, 'on' + t, { get: () => win['on' + t], set: (v) => { win['on' + t] = v; }, configurable: true, enumerable: true });
  }
  const ctx = vm.createContext(sandbox);
  vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis; globalThis.top = globalThis; globalThis.parent = globalThis;', ctx);
  ctxJSON = vm.runInContext('JSON', ctx);

  const h = {
    document, window: sandbox, backend, requests, uuids, timers, storageLog, nativeDialogs, consoleErrors,
    location,
    errors: [],
    get listenerErrors() { return document.stats.errors; },
    $(sel) { return document.querySelector(sel); },
    $$(sel) { return document.querySelectorAll(sel); },
    el(target) {
      if (typeof target !== 'string') return target;
      const e = document.querySelector(target);
      if (!e) throw new Error(`no element matches ${target}`);
      return e;
    },
    async flush(rounds = 25) {
      for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setImmediate(r));
        timers.runDue();
      }
    },
    // Like a mouse click in Chromium: focusable targets receive focus, then click.
    async click(target) {
      const e = h.el(target);
      if (dom.isFocusable(e)) e.focus();
      e.click();
      await h.flush();
    },
    async type(target, value) {
      const e = h.el(target);
      e.focus();
      e.value = value;
      e.dispatchEvent(new dom.InputEvent('input', { bubbles: true, composed: true }));
      e.dispatchEvent(new dom.Event('change', { bubbles: true }));
      await h.flush();
    },
    async select(target, value) {
      const e = h.el(target);
      e.focus();
      e.value = value;
      if (e.value !== value) throw new Error(`select ${typeof target === 'string' ? target : dom.describe(e)} has no option ${value}`);
      e.dispatchEvent(new dom.InputEvent('input', { bubbles: true, composed: true }));
      e.dispatchEvent(new dom.Event('change', { bubbles: true }));
      await h.flush();
    },
    async setChecked(target, on) {
      const e = h.el(target);
      if (e.checked !== !!on) e.click();
      await h.flush();
    },
    // Submits like a user clicking the form's submit button (runs native constraint validation).
    async submit(target) {
      const form = h.el(target);
      const submitter = form.querySelectorAll('button, input').find((b) => (b.localName === 'button' && b.type === 'submit') || (b.localName === 'input' && b.type === 'submit'));
      if (submitter) submitter.click();
      else form._submitFrom(null);
      await h.flush();
    },
    async key(target, key, keyOpts) {
      document.__userKey(target == null ? null : h.el(target), key, keyOpts);
      await h.flush();
    },
    text(target) {
      const e = typeof target === 'string' ? document.querySelector(target) : target;
      return e ? e.textContent.replace(/\s+/g, ' ').trim() : '';
    },
    pageText() { return h.text(document.body); },
    // Text of rendered nodes only (skips subtrees with the hidden attribute).
    visibleText(target) {
      const e = typeof target === 'string' ? document.querySelector(target) : target;
      const walk = (n) => {
        if (n.nodeType === 3) return n.data;
        if (n.nodeType !== 1 || n.hasAttribute('hidden') || ['script', 'style', 'template'].includes(n.localName)) return '';
        return n.childNodes.map(walk).join(' ');
      };
      return e && dom.isRendered(e) ? walk(e).replace(/\s+/g, ' ').trim() : '';
    },
    visible(target) {
      const e = typeof target === 'string' ? document.querySelector(target) : target;
      return !!e && dom.isRendered(e);
    },
    reqs(method, pathPattern) {
      return requests.filter((r) => (!method || r.method === method) && (!pathPattern || (pathPattern instanceof RegExp ? pathPattern.test(r.path) : r.path === pathPattern)));
    },
    tenantPath: (tenant, resource) => `/api/tenants/${encodeURIComponent(tenant)}/${resource}`,
    async login(username = 'admin', password = DEMO_PASSWORD) {
      await h.type('#login-username', username);
      await h.type('#login-password', password);
      await h.submit('#login-form');
    },
    async nav(view) { await h.click(`button[data-view="${view}"]`); },
    async switchTenant(id) { await h.select('#tenant-select', id); },
    activeView() { const b = document.querySelector('button[data-view][aria-current="page"]'); return b ? b.getAttribute('data-view') : null; },
    statusState(view) { const s = document.querySelector(`[data-status="${view}"]`); return s ? s.getAttribute('data-state') : null; },
    listenerSnapshot: () => dom.snapshotListeners(document),
    totalListeners: () => dom.totalListeners(document),
    describe: dom.describe,
    run: (src) => vm.runInContext(src, ctx),
    // Fixture-level failures that mean the app threw: listener exceptions and unhandled rejections.
    fatalErrors() { return [...document.stats.errors, ...h.errors]; },
    dispose() { if (activeHarness === h) activeHarness = null; },
    // Asserts the app raised no listener exceptions / unhandled rejections, then disposes.
    finish() {
      const fatal = h.fatalErrors().map((e) => String((e && e.stack) || e).split('\n').slice(0, 3).join(' | '));
      h.dispose();
      if (fatal.length) throw new Error('app raised uncaught errors:\n' + fatal.join('\n'));
    },
  };
  activeHarness = h;
  try {
    vm.runInContext(code, ctx, { filename: APP_PATH });
  } catch (e) {
    h.errors.push(e);
  }
  await h.flush();
  return h;
}

// Boots the app and logs in through the UI as `username` (admin|operator|viewer).
async function bootAs(username = 'admin', opts = {}) {
  const h = await setup(opts);
  if (!h.visible('#app-view')) await h.login(username);
  return h;
}

// ---------------------------------------------------------------- Turkish copy checks

const trLower = (s) => String(s).toLocaleLowerCase('tr-TR');
const words = (s) => trLower(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// Past-tense/perfect forms that would claim a stored value or draft is verified/active/applied.
const POSITIVE_CLAIM_WORDS = ['doğrulandı', 'doğrulanmış', 'doğrulanmıştır', 'etkinleştirildi', 'etkinleştirilmiş', 'aktifleştirildi', 'aktifleştirilmiş', 'uygulandı', 'canlıda', 'yayında'];
// Returns offending words. With status=true, bare 'etkin'/'aktif' must be followed by 'değil'.
function positiveClaims(text, { status = false } = {}) {
  const w = words(text);
  const found = w.filter((x) => POSITIVE_CLAIM_WORDS.includes(x));
  if (status) w.forEach((x, i) => { if ((x === 'etkin' || x === 'aktif') && w[i + 1] !== 'değil') found.push(`${x} (not negated)`); });
  return found;
}

// DOM nodes must never reach assert.equal: its diff ignores custom inspect and walks the whole circular DOM.
function assertSameNode(actual, expected, message = 'same node') {
  if (actual !== expected) throw new Error(`${message}: expected ${dom.describe(expected)}, got ${actual ? dom.describe(actual) : String(actual)}`);
}
function assertNotSameNode(actual, other, message = 'different node') {
  if (actual === other) throw new Error(`${message}: unexpectedly ${dom.describe(actual)}`);
}

module.exports = {
  setup, bootAs, createBackend, tenantData, trLower, words, positiveClaims, assertSameNode, assertNotSameNode,
  ORIGIN, DEMO_PASSWORD, TENANT_A, TENANT_B, CONNECTION_KINDS, VIEWS, INDEX_PATH, APP_PATH, ROOT,
};
