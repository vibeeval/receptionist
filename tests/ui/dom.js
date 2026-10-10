'use strict';
// Minimal, dependency-free DOM fixture for the dashboard functional tests.
// It models only what public/dashboard needs; it is not a browser and does no layout or CSS.

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);
const DISABLEABLE = new Set(['button', 'input', 'select', 'textarea', 'fieldset', 'optgroup', 'option']);
const SUBMITTABLE = new Set(['input', 'select', 'textarea']);
const P_CLOSERS = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const HEAD_ELEMENTS = new Set(['meta', 'link', 'title', 'base', 'style', 'script']);
const INPUT_TYPES = new Set(['text', 'password', 'number', 'time', 'date', 'email', 'url', 'tel', 'search', 'checkbox', 'radio', 'hidden', 'submit', 'button', 'reset', 'range', 'color', 'file', 'image', 'datetime-local', 'month', 'week']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', middot: '·', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', times: '×', rarr: '→', larr: '←', bull: '•', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', deg: '°', check: '✓' };
const HANDLER_PROPS = ['click', 'submit', 'change', 'input', 'keydown', 'keyup', 'focus', 'blur', 'focusin', 'focusout', 'invalid', 'hashchange', 'popstate', 'resize', 'load'];
const ARIA_PROPS = ['Expanded', 'Hidden', 'Current', 'Invalid', 'Pressed', 'Label', 'Busy', 'Disabled', 'Live', 'Modal', 'Checked', 'Selected', 'Required', 'ReadOnly'];

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return Object.hasOwn(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
  });
}
const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// ---------------------------------------------------------------- events

class Event {
  constructor(type, init = {}) {
    if (type === undefined) throw new TypeError('Event type required');
    this.type = String(type);
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.composed = !!init.composed;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this.eventPhase = 0;
    this.isTrusted = false;
    this.timeStamp = 0;
    this._stop = false;
    this._stopImmediate = false;
    this._passive = false;
    this._path = [];
  }
  preventDefault() { if (this.cancelable && !this._passive) this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._stopImmediate = true; }
  get returnValue() { return !this.defaultPrevented; }
  set returnValue(v) { if (v === false) this.preventDefault(); }
  get cancelBubble() { return this._stop; }
  set cancelBubble(v) { if (v) this._stop = true; }
  get srcElement() { return this.target; }
  composedPath() { return this._path.slice(); }
}
Event.NONE = 0; Event.CAPTURING_PHASE = 1; Event.AT_TARGET = 2; Event.BUBBLING_PHASE = 3;

class UIEvent extends Event {
  constructor(type, init = {}) { super(type, init); this.detail = init.detail ?? 0; this.view = init.view ?? null; }
}
class MouseEvent extends UIEvent {
  constructor(type, init = {}) {
    super(type, init);
    for (const k of ['button', 'buttons', 'clientX', 'clientY', 'screenX', 'screenY', 'pageX', 'pageY']) this[k] = init[k] ?? 0;
    for (const k of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey']) this[k] = !!init[k];
    this.relatedTarget = init.relatedTarget ?? null;
  }
}
class PointerEvent extends MouseEvent {}
class KeyboardEvent extends UIEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.key = init.key ?? '';
    this.code = init.code ?? '';
    this.location = init.location ?? 0;
    this.repeat = !!init.repeat;
    this.isComposing = !!init.isComposing;
    for (const k of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey']) this[k] = !!init[k];
  }
  getModifierState(k) { return !!this[{ Shift: 'shiftKey', Control: 'ctrlKey', Alt: 'altKey', Meta: 'metaKey' }[k]]; }
}
class FocusEvent extends UIEvent {
  constructor(type, init = {}) { super(type, init); this.relatedTarget = init.relatedTarget ?? null; }
}
class InputEvent extends UIEvent {
  constructor(type, init = {}) { super(type, init); this.data = init.data ?? null; this.inputType = init.inputType ?? ''; this.isComposing = !!init.isComposing; }
}
class SubmitEvent extends Event {
  constructor(type, init = {}) { super(type, init); this.submitter = init.submitter ?? null; }
}
class CustomEvent extends Event {
  constructor(type, init = {}) { super(type, init); this.detail = init.detail ?? null; }
}

// Every EventTarget registers here so tests can count live listeners.
class ListenerStats {
  constructor() { this.added = 0; this.removed = 0; this.errors = []; }
}
const defaultStats = new ListenerStats();

class EventTarget {
  constructor(stats) {
    this._listeners = new Map();
    this._stats = stats || defaultStats;
  }
  addEventListener(type, fn, opts) {
    if (fn == null) return;
    const capture = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
    const once = !!(opts && typeof opts === 'object' && opts.once);
    const passive = !!(opts && typeof opts === 'object' && opts.passive);
    const signal = opts && typeof opts === 'object' ? opts.signal : undefined;
    if (signal && signal.aborted) return;
    type = String(type);
    let list = this._listeners.get(type);
    if (!list) { list = []; this._listeners.set(type, list); }
    if (list.some((l) => l.fn === fn && l.capture === capture)) return;
    list.push({ fn, capture, once, passive, removed: false });
    this._stats.added++;
    if (signal) signal.addEventListener('abort', () => this.removeEventListener(type, fn, { capture }), { once: true });
  }
  removeEventListener(type, fn, opts) {
    const capture = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
    const list = this._listeners.get(String(type));
    if (!list) return;
    const i = list.findIndex((l) => l.fn === fn && l.capture === capture);
    if (i >= 0) { list[i].removed = true; list.splice(i, 1); this._stats.removed++; }
  }
  // Number of currently attached listeners (all types, or one type).
  listenerCount(type) {
    if (type !== undefined) return (this._listeners.get(type) || []).length;
    let n = 0;
    for (const l of this._listeners.values()) n += l.length;
    return n;
  }
  _parentForEvent() { return null; }
  dispatchEvent(ev) {
    if (!(ev instanceof Event)) throw new TypeError('dispatchEvent requires an Event');
    ev.target = this;
    const path = [];
    for (let n = this._parentForEvent(ev); n; n = n._parentForEvent(ev)) path.push(n);
    ev._path = [this, ...path];
    ev._stop = false;
    ev.eventPhase = 1;
    for (let i = path.length - 1; i >= 0 && !ev._stop; i--) invokeListeners(path[i], ev, 'capture');
    if (!ev._stop) { ev.eventPhase = 2; invokeListeners(this, ev, 'target'); }
    if (ev.bubbles) {
      ev.eventPhase = 3;
      for (let i = 0; i < path.length && !ev._stop; i++) invokeListeners(path[i], ev, 'bubble');
    }
    ev.eventPhase = 0;
    ev.currentTarget = null;
    return !ev.defaultPrevented;
  }
}

function invokeListeners(node, ev, phase) {
  const list = node._listeners.get(ev.type);
  if (!list || !list.length) return;
  ev.currentTarget = node;
  for (const rec of list.slice()) {
    if (rec.removed) continue;
    if (phase === 'capture' && !rec.capture) continue;
    if (phase === 'bubble' && rec.capture) continue;
    if (rec.once) node.removeEventListener(ev.type, rec.fn, { capture: rec.capture });
    ev._passive = rec.passive;
    try {
      if (typeof rec.fn === 'function') {
        const r = rec.fn.call(node, ev);
        if (rec.handlerProp && r === false) ev.preventDefault();
      } else if (rec.fn && typeof rec.fn.handleEvent === 'function') rec.fn.handleEvent(ev);
    } catch (err) {
      node._stats.errors.push(err);
    }
    ev._passive = false;
    if (ev._stopImmediate) break;
  }
}

function defineHandlerProps(proto) {
  for (const type of HANDLER_PROPS) {
    Object.defineProperty(proto, 'on' + type, {
      configurable: true,
      get() { return (this._handlerProps && this._handlerProps[type]) || null; },
      set(fn) {
        this._handlerProps = this._handlerProps || {};
        const prev = this._handlerProps[type];
        if (prev) this.removeEventListener(type, prev);
        this._handlerProps[type] = typeof fn === 'function' ? fn : null;
        if (typeof fn === 'function') {
          this.addEventListener(type, fn);
          const list = this._listeners.get(type);
          list[list.length - 1].handlerProp = true;
        }
      },
    });
  }
}

// ---------------------------------------------------------------- selectors

function parseSelectorList(src) {
  const s = String(src);
  let i = 0;
  const list = [];
  let complex = [];
  let compound = null;
  let pendingComb = null;
  const fail = (msg) => { throw new SyntaxError(`fixture: unsupported or invalid selector "${s}" (${msg})`); };
  const newCompound = () => ({ tag: null, ids: [], classes: [], attrs: [], pseudos: [] });
  const ensureCompound = () => {
    if (!compound) {
      compound = newCompound();
      complex.push({ combinator: complex.length ? (pendingComb || ' ') : null, compound });
      pendingComb = null;
    }
    return compound;
  };
  const readIdent = () => {
    let out = '';
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') { out += s[i + 1] ?? ''; i += 2; continue; }
      if (/[A-Za-z0-9_\-]/.test(c) || c.charCodeAt(0) > 127) { out += c; i++; continue; }
      break;
    }
    if (!out) fail('expected identifier at ' + i);
    return out;
  };
  const readString = () => {
    const q = s[i++];
    let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\') { out += s[i + 1] ?? ''; i += 2; continue; }
      out += s[i++];
    }
    if (s[i] !== q) fail('unterminated string');
    i++;
    return out;
  };
  const readParenArg = () => {
    let depth = 1;
    const start = ++i;
    while (i < s.length && depth) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      else if (s[i] === '"' || s[i] === "'") { readString(); continue; }
      i++;
    }
    if (depth) fail('unbalanced parentheses');
    return s.slice(start, i - 1).trim();
  };
  const endComplex = () => {
    if (!complex.length || pendingComb) fail('dangling combinator or empty selector');
    list.push(complex);
    complex = [];
    compound = null;
  };
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (compound && i < s.length && !/[>+~,]/.test(s[i])) { compound = null; pendingComb = ' '; }
      continue;
    }
    if (c === ',') { i++; endComplex(); continue; }
    if (c === '>' || c === '+' || c === '~') {
      if (!complex.length) fail('leading combinator');
      pendingComb = c; compound = null; i++; continue;
    }
    if (c === '*') { ensureCompound().tag = '*'; i++; continue; }
    if (c === '#') { i++; ensureCompound().ids.push(readIdent()); continue; }
    if (c === '.') { i++; ensureCompound().classes.push(readIdent()); continue; }
    if (c === '[') {
      i++;
      while (/\s/.test(s[i])) i++;
      const name = readIdent().toLowerCase();
      while (/\s/.test(s[i])) i++;
      let op = null;
      let value = null;
      let ci = false;
      const m = /^([~|^$*]?=)/.exec(s.slice(i));
      if (m) {
        op = m[1]; i += op.length;
        while (/\s/.test(s[i])) i++;
        value = s[i] === '"' || s[i] === "'" ? readString() : readIdent();
        while (/\s/.test(s[i])) i++;
        if (s[i] === 'i' || s[i] === 'I') { ci = true; i++; while (/\s/.test(s[i])) i++; }
      }
      if (s[i] !== ']') fail('expected ]');
      i++;
      ensureCompound().attrs.push({ name, op, value, ci });
      continue;
    }
    if (c === ':') {
      if (s[i + 1] === ':') fail('pseudo-elements are not supported');
      i++;
      const name = readIdent().toLowerCase();
      let arg = null;
      if (s[i] === '(') arg = readParenArg();
      if (!PSEUDOS[name]) fail('pseudo-class :' + name);
      const p = { name, arg };
      if (['not', 'is', 'where'].includes(name)) p.list = parseSelectorList(arg);
      if (name === 'nth-child' || name === 'nth-last-child') p.nth = parseNth(arg, fail);
      ensureCompound().pseudos.push(p);
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      if (compound) fail('type selector must come first in a compound');
      ensureCompound().tag = readIdent().toLowerCase();
      continue;
    }
    fail('unexpected character ' + JSON.stringify(c));
  }
  endComplex();
  return list;
}

function parseNth(arg, fail) {
  const a = String(arg).replace(/\s+/g, '').toLowerCase();
  if (a === 'odd') return { a: 2, b: 1 };
  if (a === 'even') return { a: 2, b: 0 };
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(a);
  if (m) return { a: m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : Number(m[1]), b: Number(m[2] || 0) };
  if (/^[+-]?\d+$/.test(a)) return { a: 0, b: Number(a) };
  return fail('nth expression ' + arg);
}

function nthMatches({ a, b }, index) {
  if (a === 0) return index === b;
  const n = (index - b) / a;
  return Number.isInteger(n) && n >= 0;
}

const PSEUDOS = {
  not: (el, p, ctx) => !matchesList(el, p.list, ctx),
  is: (el, p, ctx) => matchesList(el, p.list, ctx),
  where: (el, p, ctx) => matchesList(el, p.list, ctx),
  checked: (el) => (el.localName === 'input' && (el.type === 'checkbox' || el.type === 'radio') && el.checked) || (el.localName === 'option' && el.selected),
  disabled: (el) => DISABLEABLE.has(el.localName) && isActuallyDisabled(el),
  enabled: (el) => DISABLEABLE.has(el.localName) && !isActuallyDisabled(el),
  required: (el) => SUBMITTABLE.has(el.localName) && el.hasAttribute('required'),
  optional: (el) => SUBMITTABLE.has(el.localName) && !el.hasAttribute('required'),
  invalid: (el) => SUBMITTABLE.has(el.localName) && el.willValidate && !el.validity.valid,
  valid: (el) => SUBMITTABLE.has(el.localName) && (!el.willValidate || el.validity.valid),
  'first-child': (el) => el.parentNode && el.parentNode.children[0] === el,
  'last-child': (el) => el.parentNode && el.parentNode.children.at(-1) === el,
  'only-child': (el) => el.parentNode && el.parentNode.children.length === 1,
  'nth-child': (el, p) => el.parentNode && nthMatches(p.nth, el.parentNode.children.indexOf(el) + 1),
  'nth-last-child': (el, p) => el.parentNode && nthMatches(p.nth, el.parentNode.children.length - el.parentNode.children.indexOf(el)),
  'first-of-type': (el) => el.parentNode && el.parentNode.children.find((c) => c.localName === el.localName) === el,
  'last-of-type': (el) => el.parentNode && el.parentNode.children.filter((c) => c.localName === el.localName).at(-1) === el,
  empty: (el) => el.childNodes.every((c) => c.nodeType === 8),
  root: (el) => el.ownerDocument && el.ownerDocument.documentElement === el,
  scope: (el, p, ctx) => (ctx && ctx.scope ? el === ctx.scope : el.ownerDocument && el.ownerDocument.documentElement === el),
  focus: (el) => el.ownerDocument && el.ownerDocument.activeElement === el,
  'focus-visible': (el) => el.ownerDocument && el.ownerDocument.activeElement === el,
  'focus-within': (el) => el.ownerDocument && el.contains(el.ownerDocument.activeElement),
};

function attrMatches(el, a) {
  const v = el.getAttribute(a.name);
  if (v === null) return false;
  if (a.op === null) return true;
  const actual = a.ci ? v.toLowerCase() : v;
  const want = a.ci ? a.value.toLowerCase() : a.value;
  switch (a.op) {
    case '=': return actual === want;
    case '~=': return actual.split(/\s+/).includes(want);
    case '|=': return actual === want || actual.startsWith(want + '-');
    case '^=': return want !== '' && actual.startsWith(want);
    case '$=': return want !== '' && actual.endsWith(want);
    case '*=': return want !== '' && actual.includes(want);
    default: return false;
  }
}

function matchCompound(el, c, ctx) {
  if (c.tag && c.tag !== '*' && el.localName !== c.tag) return false;
  for (const id of c.ids) if (el.getAttribute('id') !== id) return false;
  if (c.classes.length) {
    const cls = (el.getAttribute('class') || '').split(/\s+/);
    for (const k of c.classes) if (!cls.includes(k)) return false;
  }
  for (const a of c.attrs) if (!attrMatches(el, a)) return false;
  for (const p of c.pseudos) if (!PSEUDOS[p.name](el, p, ctx)) return false;
  return true;
}

function matchComplex(el, parts, idx, ctx) {
  if (!matchCompound(el, parts[idx].compound, ctx)) return false;
  if (idx === 0) return true;
  const comb = parts[idx].combinator;
  if (comb === ' ') {
    for (let a = el.parentElement; a; a = a.parentElement) if (matchComplex(a, parts, idx - 1, ctx)) return true;
    return false;
  }
  if (comb === '>') return !!el.parentElement && matchComplex(el.parentElement, parts, idx - 1, ctx);
  if (comb === '+') return !!el.previousElementSibling && matchComplex(el.previousElementSibling, parts, idx - 1, ctx);
  if (comb === '~') {
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (matchComplex(s, parts, idx - 1, ctx)) return true;
    return false;
  }
  return false;
}

function matchesList(el, list, ctx) {
  return list.some((parts) => matchComplex(el, parts, parts.length - 1, ctx));
}

const selectorCache = new Map();
function compileSelector(sel) {
  if (!selectorCache.has(sel)) selectorCache.set(sel, parseSelectorList(sel));
  return selectorCache.get(sel);
}

function* descendants(node) {
  for (const c of node.childNodes) {
    if (c.nodeType === 1) { yield c; yield* descendants(c); }
  }
}

// ---------------------------------------------------------------- disabled / focus helpers

function isActuallyDisabled(el) {
  if (!DISABLEABLE.has(el.localName)) return false;
  if (el.hasAttribute('disabled')) return true;
  if (el.localName === 'option') {
    const g = el.parentElement;
    if (g && g.localName === 'optgroup' && g.hasAttribute('disabled')) return true;
  }
  for (let a = el.parentElement, child = el; a; child = a, a = a.parentElement) {
    if (a.localName === 'fieldset' && a.hasAttribute('disabled')) {
      const firstLegend = a.children.find((c) => c.localName === 'legend');
      if (!(firstLegend && firstLegend === child)) return true;
    }
  }
  return false;
}

function isRendered(el) {
  if (!el.isConnected) return false;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n.hasAttribute('hidden')) return false;
    if (n.localName === 'template') return false;
    if (n.localName === 'dialog' && !n.hasAttribute('open')) return false;
  }
  return true;
}

function isInert(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (n.hasAttribute('inert')) return true;
  return false;
}

function isNativelyFocusable(el) {
  switch (el.localName) {
    case 'a': case 'area': return el.hasAttribute('href');
    case 'button': case 'select': case 'textarea': case 'iframe': case 'summary': return true;
    case 'input': return el.type !== 'hidden';
    case 'audio': case 'video': return el.hasAttribute('controls');
    default: return el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false';
  }
}

function isFocusable(el) {
  if (!el || el.nodeType !== 1 || !isRendered(el) || isInert(el)) return false;
  if (isActuallyDisabled(el)) return false;
  if (isNativelyFocusable(el)) return true;
  const t = el.getAttribute('tabindex');
  return t !== null && /^\s*-?\d+\s*$/.test(t);
}

function isTabbable(el) {
  return isFocusable(el) && el.tabIndex >= 0;
}

// ---------------------------------------------------------------- validation

const VALID_FLOAT = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const VALID_TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?$/;
function timeToSeconds(v) {
  const m = VALID_TIME.exec(v);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0) : NaN;
}
function sanitizeValue(el, v) {
  switch (el.type) {
    case 'number': return VALID_FLOAT.test(v) ? v : '';
    case 'time': return VALID_TIME.test(v) ? v : '';
    case 'email': return v.replace(/[\r\n]/g, '').trim();
    case 'text': case 'password': case 'search': case 'tel': case 'url': return v.replace(/[\r\n]/g, '');
    default: return v;
  }
}

// ---------------------------------------------------------------- nodes

class Node extends EventTarget {
  constructor(doc) {
    super(doc ? doc._stats : undefined);
    this.ownerDocument = doc || null;
    this.parentNode = null;
    this.childNodes = [];
  }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] ?? null : null; }
  get previousSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return i > 0 ? p.childNodes[i - 1] : null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n.nodeType === 9;
  }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  get nextElementSibling() { let n = this.nextSibling; while (n && n.nodeType !== 1) n = n.nextSibling; return n; }
  get previousElementSibling() { let n = this.previousSibling; while (n && n.nodeType !== 1) n = n.previousSibling; return n; }
  hasChildNodes() { return this.childNodes.length > 0; }
  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  _parentForEvent() { return this.parentNode; }
  _toNode(x) {
    if (x instanceof Node) return x;
    return new Text(this.ownerDocument || this, String(x));
  }
  insertBefore(child, ref) {
    if (!(child instanceof Node)) throw new TypeError('insertBefore: not a Node');
    if (ref != null && ref.parentNode !== this) throw new Error('NotFoundError: reference node is not a child');
    if (child.nodeType === 11) {
      for (const c of child.childNodes.slice()) this.insertBefore(c, ref);
      return child;
    }
    if (child.contains(this)) throw new Error('HierarchyRequestError');
    if (child === ref) return child;
    if (child.parentNode) child.parentNode._detach(child);
    const i = ref == null ? this.childNodes.length : this.childNodes.indexOf(ref);
    this.childNodes.splice(i, 0, child);
    child.parentNode = this;
    return child;
  }
  _detach(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
  }
  appendChild(child) { return this.insertBefore(child, null); }
  removeChild(child) {
    if (child.parentNode !== this) throw new Error('NotFoundError: not a child');
    this._detach(child);
    return child;
  }
  replaceChild(newChild, oldChild) {
    if (oldChild.parentNode !== this) throw new Error('NotFoundError: not a child');
    const next = oldChild.nextSibling;
    this._detach(oldChild);
    this.insertBefore(newChild, next);
    return oldChild;
  }
  remove() { if (this.parentNode) this.parentNode._detach(this); }
  append(...nodes) { for (const n of nodes) this.appendChild(this._toNode(n)); }
  prepend(...nodes) { const first = this.firstChild; for (const n of nodes) this.insertBefore(this._toNode(n), first); }
  replaceChildren(...nodes) {
    const incoming = nodes.map((n) => this._toNode(n));
    for (const c of this.childNodes.slice()) this._detach(c);
    for (const n of incoming) this.appendChild(n);
  }
  before(...nodes) { const p = this.parentNode; if (!p) return; for (const n of nodes) p.insertBefore(this._toNode(n), this); }
  after(...nodes) { const p = this.parentNode; if (!p) return; const next = this.nextSibling; for (const n of nodes) p.insertBefore(this._toNode(n), next); }
  replaceWith(...nodes) { const p = this.parentNode; if (!p) return; const next = this.nextSibling; p._detach(this); for (const n of nodes) p.insertBefore(p._toNode(n), next); }
  get textContent() {
    let out = '';
    for (const c of this.childNodes) if (c.nodeType === 1 || c.nodeType === 3 || c.nodeType === 11) out += c.textContent;
    return out;
  }
  set textContent(v) {
    this.replaceChildren();
    const s = v == null ? '' : String(v);
    if (s) this.appendChild(new Text(this.ownerDocument || this, s));
  }
  querySelectorAll(sel) {
    const list = compileSelector(sel);
    const ctx = { scope: this.nodeType === 1 ? this : null };
    const out = [];
    for (const el of descendants(this)) if (matchesList(el, list, ctx)) out.push(el);
    return out;
  }
  querySelector(sel) {
    const list = compileSelector(sel);
    const ctx = { scope: this.nodeType === 1 ? this : null };
    for (const el of descendants(this)) if (matchesList(el, list, ctx)) return el;
    return null;
  }
  getElementsByTagName(tag) { const t = tag.toLowerCase(); return [...descendants(this)].filter((e) => t === '*' || e.localName === t); }
  getElementsByClassName(names) { const want = names.split(/\s+/).filter(Boolean); return [...descendants(this)].filter((e) => want.every((n) => e.classList.contains(n))); }
  cloneNode(deep) {
    const copy = this._shallowClone();
    if (deep) for (const c of this.childNodes) copy.appendChild(c.cloneNode(true));
    return copy;
  }
}
Node.ELEMENT_NODE = 1; Node.TEXT_NODE = 3; Node.COMMENT_NODE = 8; Node.DOCUMENT_NODE = 9; Node.DOCUMENT_TYPE_NODE = 10; Node.DOCUMENT_FRAGMENT_NODE = 11;

class CharacterData extends Node {
  constructor(doc, data) { super(doc); this.data = String(data); }
  get nodeValue() { return this.data; }
  set nodeValue(v) { this.data = String(v); }
  get length() { return this.data.length; }
}
class Text extends CharacterData {
  get nodeType() { return 3; }
  get nodeName() { return '#text'; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = v == null ? '' : String(v); }
  get wholeText() { return this.data; }
  _shallowClone() { return new Text(this.ownerDocument, this.data); }
}
class Comment extends CharacterData {
  get nodeType() { return 8; }
  get nodeName() { return '#comment'; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = v == null ? '' : String(v); }
  _shallowClone() { return new Comment(this.ownerDocument, this.data); }
}
class DocumentType extends Node {
  constructor(doc, name) { super(doc); this.name = name; }
  get nodeType() { return 10; }
  get nodeName() { return this.name; }
  get textContent() { return ''; }
  _shallowClone() { return new DocumentType(this.ownerDocument, this.name); }
}
class DocumentFragment extends Node {
  get nodeType() { return 11; }
  get nodeName() { return '#document-fragment'; }
  getElementById(id) { for (const el of descendants(this)) if (el.getAttribute('id') === id) return el; return null; }
  _shallowClone() { return new DocumentFragment(this.ownerDocument); }
}

class DOMTokenList {
  constructor(el, attr) { this._el = el; this._attr = attr; }
  _get() { return (this._el.getAttribute(this._attr) || '').split(/\s+/).filter(Boolean); }
  _set(list) { this._el.setAttribute(this._attr, [...new Set(list)].join(' ')); }
  get length() { return new Set(this._get()).size; }
  get value() { return this._el.getAttribute(this._attr) || ''; }
  set value(v) { this._el.setAttribute(this._attr, String(v)); }
  item(i) { return [...new Set(this._get())][i] ?? null; }
  contains(t) { return this._get().includes(String(t)); }
  add(...tokens) { this._set([...this._get(), ...tokens.map(String)]); }
  remove(...tokens) {
    if (!this._el.hasAttribute(this._attr)) return;
    const drop = new Set(tokens.map(String));
    this._set(this._get().filter((t) => !drop.has(t)));
  }
  toggle(t, force) {
    t = String(t);
    const has = this.contains(t);
    const want = force === undefined ? !has : !!force;
    if (want && !has) this.add(t);
    if (!want && has) this.remove(t);
    return want;
  }
  replace(a, b) { if (!this.contains(a)) return false; this._set(this._get().map((t) => (t === a ? String(b) : t))); return true; }
  forEach(fn, thisArg) { [...new Set(this._get())].forEach((t, i) => fn.call(thisArg, t, i, this)); }
  [Symbol.iterator]() { return [...new Set(this._get())][Symbol.iterator](); }
  toString() { return this.value; }
}

function makeStyle() {
  const props = {};
  return new Proxy(props, {
    get(t, k) {
      if (k === 'setProperty') return (n, v) => { t[camel(n)] = String(v); };
      if (k === 'removeProperty') return (n) => { const v = t[camel(n)]; delete t[camel(n)]; return v ?? ''; };
      if (k === 'getPropertyValue') return (n) => t[camel(n)] ?? '';
      if (k === 'cssText') return Object.entries(t).map(([a, b]) => `${kebab(a)}: ${b};`).join(' ');
      if (typeof k !== 'string') return undefined;
      return t[k] ?? '';
    },
    set(t, k, v) { if (k === 'cssText') { for (const key of Object.keys(t)) delete t[key]; } else t[k] = String(v); return true; },
  });
}

class Element extends Node {
  constructor(doc, tag, namespaceURI) {
    super(doc);
    this.localName = String(tag).toLowerCase();
    this.namespaceURI = namespaceURI || 'http://www.w3.org/1999/xhtml';
    this._attrs = new Map();
    this._style = null;
  }
  get nodeType() { return 1; }
  get tagName() { return this.localName.toUpperCase(); }
  get nodeName() { return this.tagName; }

  getAttribute(n) { n = String(n).toLowerCase(); return this._attrs.has(n) ? this._attrs.get(n) : null; }
  setAttribute(n, v) {
    n = String(n).toLowerCase();
    if (!/^[^\s"'>\/=]+$/.test(n)) throw new Error('InvalidCharacterError: ' + n);
    this._attrs.set(n, String(v));
  }
  removeAttribute(n) { this._attrs.delete(String(n).toLowerCase()); }
  hasAttribute(n) { return this._attrs.has(String(n).toLowerCase()); }
  toggleAttribute(n, force) {
    const has = this.hasAttribute(n);
    const want = force === undefined ? !has : !!force;
    if (want && !has) this.setAttribute(n, '');
    if (!want && has) this.removeAttribute(n);
    return want;
  }
  getAttributeNames() { return [...this._attrs.keys()]; }
  hasAttributes() { return this._attrs.size > 0; }
  get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); }

  get id() { return this.getAttribute('id') ?? ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') ?? ''; }
  set className(v) { this.setAttribute('class', v); }
  get classList() { return new DOMTokenList(this, 'class'); }
  get relList() { return new DOMTokenList(this, 'rel'); }
  get dataset() {
    const el = this;
    const attrName = (k) => 'data-' + kebab(k);
    return new Proxy({}, {
      get(_, k) { return typeof k === 'string' ? el.getAttribute(attrName(k)) ?? undefined : undefined; },
      set(_, k, v) { el.setAttribute(attrName(k), String(v)); return true; },
      deleteProperty(_, k) { el.removeAttribute(attrName(k)); return true; },
      has(_, k) { return typeof k === 'string' && el.hasAttribute(attrName(k)); },
      ownKeys() { return el.getAttributeNames().filter((n) => n.startsWith('data-')).map((n) => camel(n.slice(5))); },
      getOwnPropertyDescriptor(_, k) {
        const v = typeof k === 'string' ? el.getAttribute(attrName(k)) : null;
        return v === null ? undefined : { value: v, writable: true, enumerable: true, configurable: true };
      },
    });
  }
  get style() { if (!this._style) this._style = makeStyle(); return this._style; }

  get tabIndex() {
    const t = this.getAttribute('tabindex');
    if (t !== null && /^\s*-?\d+\s*$/.test(t)) return parseInt(t, 10);
    return isNativelyFocusable(this) ? 0 : -1;
  }
  set tabIndex(v) { this.setAttribute('tabindex', String(Math.trunc(Number(v)))); }
  get htmlFor() { return this.getAttribute('for') ?? ''; }
  set htmlFor(v) { this.setAttribute('for', v); }
  get readOnly() { return this.hasAttribute('readonly'); }
  set readOnly(v) { this.toggleAttribute('readonly', !!v); }
  get noValidate() { return this.hasAttribute('novalidate'); }
  set noValidate(v) { this.toggleAttribute('novalidate', !!v); }

  get type() {
    const raw = (this.getAttribute('type') || '').toLowerCase();
    if (this.localName === 'input') return INPUT_TYPES.has(raw) ? raw : 'text';
    if (this.localName === 'button') return raw === 'button' || raw === 'reset' ? raw : 'submit';
    if (this.localName === 'select') return this.hasAttribute('multiple') ? 'select-multiple' : 'select-one';
    if (this.localName === 'textarea') return 'textarea';
    if (this.localName === 'fieldset') return 'fieldset';
    return this.getAttribute('type') ?? '';
  }
  set type(v) { this.setAttribute('type', v); }

  get value() {
    switch (this.localName) {
      case 'input':
        if (this.type === 'checkbox' || this.type === 'radio') return this.getAttribute('value') ?? 'on';
        return this._value !== undefined ? this._value : sanitizeValue(this, this.getAttribute('value') ?? '');
      case 'textarea': return this._value !== undefined ? this._value : this.textContent;
      case 'select': { const o = this.options[this.selectedIndex]; return o ? o.value : ''; }
      case 'option': return this.getAttribute('value') ?? this.textContent.replace(/\s+/g, ' ').trim();
      default: return this.getAttribute('value') ?? '';
    }
  }
  set value(v) {
    const s = v == null ? '' : String(v);
    switch (this.localName) {
      case 'input':
        if (this.type === 'checkbox' || this.type === 'radio') this.setAttribute('value', s);
        else this._value = sanitizeValue(this, s);
        break;
      case 'textarea': this._value = s; break;
      case 'select': {
        const opts = this.options;
        const idx = opts.findIndex((o) => o.value === s);
        opts.forEach((o, i) => { o._selected = i === idx; });
        this._noneSelected = idx < 0;
        break;
      }
      default: this.setAttribute('value', s);
    }
  }
  get defaultValue() { return this.localName === 'textarea' ? this.textContent : this.getAttribute('value') ?? ''; }
  set defaultValue(v) { if (this.localName === 'textarea') this.textContent = v; else this.setAttribute('value', v); }
  get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); }
  set valueAsNumber(n) { this.value = Number.isFinite(n) ? String(n) : ''; }
  get checked() { return this._checked !== undefined ? this._checked : this.hasAttribute('checked'); }
  set checked(v) {
    this._checked = !!v;
    if (v && this.localName === 'input' && this.type === 'radio' && this.name) {
      const scope = this.form || this.ownerDocument;
      if (scope) for (const o of scope.querySelectorAll('input')) if (o !== this && o.type === 'radio' && o.name === this.name) o._checked = false;
    }
  }
  get defaultChecked() { return this.hasAttribute('checked'); }
  set defaultChecked(v) { this.toggleAttribute('checked', !!v); }

  get options() { return this.localName === 'select' ? this.querySelectorAll('option') : undefined; }
  get selectedIndex() {
    if (this.localName !== 'select') return undefined;
    const opts = this.options;
    let idx = -1;
    opts.forEach((o, i) => { if (o._selected === true || (o._selected === undefined && o.hasAttribute('selected'))) idx = i; });
    if (idx < 0 && !this._noneSelected && !this.hasAttribute('multiple')) idx = opts.findIndex((o) => !isActuallyDisabled(o));
    return idx;
  }
  set selectedIndex(i) {
    const opts = this.options;
    opts.forEach((o, k) => { o._selected = k === i; });
    this._noneSelected = !(i >= 0 && i < opts.length);
  }
  get selectedOptions() { return this.localName === 'select' ? this.options.filter((o, i) => i === this.selectedIndex) : undefined; }
  get selected() {
    const sel = this.closest('select');
    return sel ? sel.options[sel.selectedIndex] === this : this.hasAttribute('selected');
  }
  set selected(v) {
    const sel = this.closest('select');
    if (!sel) { this._selected = !!v; return; }
    if (v) sel.options.forEach((o) => { o._selected = o === this; });
    else this._selected = false;
    sel._noneSelected = false;
  }
  get text() { return this.textContent; }
  set text(v) { this.textContent = v; }
  get form() {
    const id = this.getAttribute('form');
    if (id && this.ownerDocument) return this.ownerDocument.getElementById(id);
    return this.localName === 'form' ? null : this.closest('form');
  }

  // ---- constraint validation (subset of HTML spec)
  get willValidate() {
    if (!SUBMITTABLE.has(this.localName) && this.localName !== 'button') return false;
    if (this.localName === 'button') return false;
    if (isActuallyDisabled(this)) return false;
    if (this.localName === 'input' && ['hidden', 'reset', 'button', 'submit', 'image'].includes(this.type)) return false;
    if ((this.localName === 'input' || this.localName === 'textarea') && this.readOnly) return false;
    return true;
  }
  setCustomValidity(msg) { this._customValidity = String(msg ?? ''); }
  get validationMessage() { return this.willValidate && !this.validity.valid ? this._customValidity || 'fixture: invalid value' : ''; }
  get validity() {
    const v = { valueMissing: false, typeMismatch: false, patternMismatch: false, tooLong: false, tooShort: false, rangeUnderflow: false, rangeOverflow: false, stepMismatch: false, badInput: false, customError: !!this._customValidity };
    if (this.willValidate) {
      const val = this.value;
      const type = this.type;
      if (this.hasAttribute('required')) {
        if (type === 'checkbox') v.valueMissing = !this.checked;
        else if (type === 'radio') {
          const scope = this.form || this.ownerDocument;
          v.valueMissing = !scope.querySelectorAll('input').some((o) => o.type === 'radio' && o.name === this.name && o.checked);
        } else v.valueMissing = val === '';
      }
      if (this.localName === 'input' && val !== '') {
        if (type === 'number' || type === 'range') {
          const n = Number(val);
          const min = this.getAttribute('min');
          const max = this.getAttribute('max');
          if (min !== null && VALID_FLOAT.test(min) && n < Number(min)) v.rangeUnderflow = true;
          if (max !== null && VALID_FLOAT.test(max) && n > Number(max)) v.rangeOverflow = true;
          const stepAttr = (this.getAttribute('step') || '').toLowerCase();
          if (stepAttr !== 'any') {
            const step = VALID_FLOAT.test(stepAttr) && Number(stepAttr) > 0 ? Number(stepAttr) : 1;
            const base = min !== null && VALID_FLOAT.test(min) ? Number(min) : 0;
            const q = (n - base) / step;
            if (Math.abs(q - Math.round(q)) > 1e-9) v.stepMismatch = true;
          }
        } else if (type === 'time') {
          const n = timeToSeconds(val);
          const min = timeToSeconds(this.getAttribute('min') || '');
          const max = timeToSeconds(this.getAttribute('max') || '');
          if (!Number.isNaN(min) && !Number.isNaN(max) && min > max) {
            if (n < min && n > max) v.rangeUnderflow = true;
          } else {
            if (!Number.isNaN(min) && n < min) v.rangeUnderflow = true;
            if (!Number.isNaN(max) && n > max) v.rangeOverflow = true;
          }
          const stepAttr = (this.getAttribute('step') || '').toLowerCase();
          if (stepAttr !== 'any') {
            const step = VALID_FLOAT.test(stepAttr) && Number(stepAttr) > 0 ? Number(stepAttr) : 60;
            const base = Number.isNaN(min) ? 0 : min;
            if (Math.abs(((n - base) / step) - Math.round((n - base) / step)) > 1e-9) v.stepMismatch = true;
          }
        } else if (type === 'email') {
          v.typeMismatch = !/^[^\s@]+@[^\s@]+$/.test(val);
        }
        const pattern = this.getAttribute('pattern');
        if (pattern !== null && ['text', 'search', 'tel', 'url', 'email', 'password'].includes(type)) {
          try { v.patternMismatch = !new RegExp('^(?:' + pattern + ')$', 'u').test(val); } catch { /* invalid pattern is ignored like browsers */ }
        }
      }
    }
    v.valid = !Object.values(v).some(Boolean);
    return v;
  }
  checkValidity() {
    if (this.localName === 'form') {
      let ok = true;
      for (const c of this._submittableControls()) if (!c.checkValidity()) ok = false;
      return ok;
    }
    if (this.willValidate && !this.validity.valid) {
      this.dispatchEvent(new Event('invalid', { cancelable: true }));
      return false;
    }
    return true;
  }
  reportValidity() { return this.checkValidity(); }
  _submittableControls() { return this.querySelectorAll('input, select, textarea').filter((c) => c.form === this); }
  _interactivelyValidate() {
    const invalid = [];
    for (const c of this._submittableControls()) {
      if (c.willValidate && !c.validity.valid) {
        invalid.push(c);
        c.dispatchEvent(new Event('invalid', { cancelable: true }));
      }
    }
    if (invalid.length) {
      const doc = this.ownerDocument;
      if (doc) doc.__blockedSubmits.push({ form: this, invalid });
      invalid[0].focus();
      return false;
    }
    return true;
  }
  _submitFrom(submitter) {
    const novalidate = this.noValidate || (submitter && submitter.hasAttribute('formnovalidate'));
    if (!novalidate && !this._interactivelyValidate()) return false;
    const ev = new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: submitter || null });
    const notCanceled = this.dispatchEvent(ev);
    if (notCanceled && this.ownerDocument) this.ownerDocument.__navigations.push({ kind: 'form-submit', action: this.getAttribute('action') ?? '' });
    return true;
  }
  requestSubmit(submitter) { this.ownerDocument.__usage.push('requestSubmit'); this._submitFrom(submitter); }
  submit() { this.ownerDocument.__navigations.push({ kind: 'form.submit()', action: this.getAttribute('action') ?? '' }); }
  reset() {
    for (const c of this._submittableControls()) { c._value = undefined; c._checked = undefined; if (c.localName === 'select') c.options.forEach((o) => { o._selected = undefined; }); }
  }
  get elements() { this.ownerDocument.__usage.push('form.elements'); return this.querySelectorAll('button, fieldset, input, object, output, select, textarea'); }

  // ---- interaction
  matches(sel) { return matchesList(this, compileSelector(sel), { scope: this }); }
  closest(sel) {
    const list = compileSelector(sel);
    for (let n = this; n && n.nodeType === 1; n = n.parentElement) if (matchesList(n, list, { scope: this })) return n;
    return null;
  }
  click() {
    if (isActuallyDisabled(this)) return;
    const isCheckable = this.localName === 'input' && (this.type === 'checkbox' || this.type === 'radio');
    const prev = isCheckable ? this.checked : undefined;
    if (isCheckable) this.checked = this.type === 'checkbox' ? !prev : true;
    const notCanceled = this.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    if (isCheckable) {
      if (!notCanceled) this.checked = prev;
      else if (this.checked !== prev) {
        this.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    if (!notCanceled) return;
    const isSubmit = (this.localName === 'button' && this.type === 'submit') || (this.localName === 'input' && (this.type === 'submit' || this.type === 'image'));
    if (isSubmit) {
      const form = this.form;
      if (form) form._submitFrom(this);
      return;
    }
    if (this.localName === 'label') {
      const forId = this.getAttribute('for');
      const control = forId ? this.ownerDocument.getElementById(forId) : this.querySelector('input, select, textarea, button');
      if (control) { control.focus(); if (control.localName === 'input' || control.localName === 'button') control.click(); }
      return;
    }
    if (this.localName === 'a' && this.hasAttribute('href') && this.ownerDocument) {
      this.ownerDocument.__navigate(this.getAttribute('href'));
    }
  }
  focus() {
    const doc = this.ownerDocument;
    if (!doc || !isFocusable(this)) return;
    doc._setFocus(this);
  }
  blur() {
    const doc = this.ownerDocument;
    if (doc && doc.activeElement === this) doc._setFocus(null);
  }
  get isContentEditable() { return this.hasAttribute('contenteditable') && this.getAttribute('contenteditable') !== 'false'; }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get outerText() { return this.textContent; }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(v) {
    const s = v == null ? '' : String(v);
    if (this.ownerDocument) this.ownerDocument.__htmlWrites.push({ prop: 'innerHTML', target: this, value: s });
    const frag = new DocumentFragment(this.ownerDocument);
    parseInto(this.ownerDocument, frag, s, false);
    this.replaceChildren(frag);
  }
  get outerHTML() { return serialize(this); }
  set outerHTML(v) {
    if (this.ownerDocument) this.ownerDocument.__htmlWrites.push({ prop: 'outerHTML', target: this, value: String(v) });
    const frag = new DocumentFragment(this.ownerDocument);
    parseInto(this.ownerDocument, frag, String(v), false);
    this.replaceWith(frag);
  }
  insertAdjacentHTML(pos, html) {
    if (this.ownerDocument) this.ownerDocument.__htmlWrites.push({ prop: 'insertAdjacentHTML', target: this, value: String(html) });
    const frag = new DocumentFragment(this.ownerDocument);
    parseInto(this.ownerDocument, frag, String(html), false);
    this._insertAdjacent(pos, frag);
  }
  insertAdjacentElement(pos, el) { this._insertAdjacent(pos, el); return el; }
  insertAdjacentText(pos, text) { this._insertAdjacent(pos, this._toNode(String(text))); }
  _insertAdjacent(pos, node) {
    switch (String(pos).toLowerCase()) {
      case 'beforebegin': this.before(node); break;
      case 'afterbegin': this.prepend(node); break;
      case 'beforeend': this.append(node); break;
      case 'afterend': this.after(node); break;
      default: throw new SyntaxError('insertAdjacent: bad position ' + pos);
    }
  }
  showModal() { this.ownerDocument.__usage.push('showModal'); this.setAttribute('open', ''); }
  show() { this.setAttribute('open', ''); }
  close() { this.removeAttribute('open'); }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return this; } }; }
  getClientRects() { return []; }
  scrollIntoView() {}
  scrollTo() {}
  scrollBy() {}
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  get clientWidth() { return 0; }
  get scrollWidth() { return 0; }
  get offsetParent() { return null; }
  animate() { return { finished: Promise.resolve(), cancel() {}, onfinish: null }; }
  getAnimations() { return []; }
  _shallowClone() {
    const c = new Element(this.ownerDocument, this.localName, this.namespaceURI);
    for (const [k, v] of this._attrs) c._attrs.set(k, v);
    return c;
  }
}

function defineReflection(proto) {
  for (const name of ['hidden', 'disabled', 'required', 'multiple', 'autofocus', 'open', 'inert', 'draggable']) {
    Object.defineProperty(proto, name, {
      configurable: true,
      get() { return this.hasAttribute(name); },
      set(v) { this.toggleAttribute(name, !!v); },
    });
  }
  for (const name of ['name', 'title', 'placeholder', 'href', 'role', 'lang', 'autocomplete', 'min', 'max', 'step', 'pattern', 'src', 'rel', 'action', 'method', 'alt', 'dir', 'inputMode', 'enterKeyHint', 'scope', 'colSpan', 'rowSpan', 'maxLength', 'minLength', 'size', 'rows', 'cols', 'spellcheck', 'translate', 'accessKey']) {
    const attr = name.toLowerCase();
    Object.defineProperty(proto, name, {
      configurable: true,
      get() { return this.getAttribute(attr) ?? ''; },
      set(v) { this.setAttribute(attr, v); },
    });
  }
  for (const p of ARIA_PROPS) {
    const attr = 'aria-' + p.toLowerCase();
    Object.defineProperty(proto, 'aria' + p, {
      configurable: true,
      get() { return this.getAttribute(attr); },
      set(v) { if (v == null) this.removeAttribute(attr); else this.setAttribute(attr, v); },
    });
  }
}
defineReflection(Element.prototype);
defineHandlerProps(Element.prototype);

function serialize(node) {
  if (node.nodeType === 3) {
    const p = node.parentNode;
    return p && p.nodeType === 1 && RAW_TEXT_ELEMENTS.has(p.localName) && p.localName !== 'textarea' && p.localName !== 'title' ? node.data : escapeText(node.data);
  }
  if (node.nodeType === 8) return `<!--${node.data}-->`;
  if (node.nodeType === 10) return `<!doctype ${node.name}>`;
  if (node.nodeType === 11 || node.nodeType === 9) return node.childNodes.map(serialize).join('');
  const attrs = [...node._attrs].map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`)).join('');
  if (VOID_ELEMENTS.has(node.localName)) return `<${node.localName}${attrs}>`;
  return `<${node.localName}${attrs}>${node.childNodes.map(serialize).join('')}</${node.localName}>`;
}

// ---------------------------------------------------------------- document / window

class WindowTarget extends EventTarget {}
defineHandlerProps(WindowTarget.prototype);

class Document extends Node {
  constructor() {
    const stats = new ListenerStats();
    super(null);
    this._stats = stats;
    this.ownerDocument = null;
    this.readyState = 'complete';
    this.defaultView = null;
    this._active = null;
    this.__htmlWrites = [];
    this.__navigations = [];
    this.__blockedSubmits = [];
    this.__usage = [];
    this.__cookieWrites = [];
    this.__navigate = (href) => { this.__navigations.push({ kind: 'link', href }); };
  }
  get nodeType() { return 9; }
  get nodeName() { return '#document'; }
  get textContent() { return null; }
  set textContent(_) {}
  get stats() { return this._stats; }
  _parentForEvent(ev) { return ev && ev.type === 'load' ? null : this.defaultView; }
  get documentElement() { return this.childNodes.find((n) => n.nodeType === 1) ?? null; }
  get head() { const h = this.documentElement; return h ? h.children.find((c) => c.localName === 'head') ?? null : null; }
  get body() { const h = this.documentElement; return h ? h.children.find((c) => c.localName === 'body') ?? null : null; }
  get title() { const t = this.querySelector('title'); return t ? t.textContent.trim() : ''; }
  set title(v) { let t = this.querySelector('title'); if (!t && this.head) { t = this.createElement('title'); this.head.append(t); } if (t) t.textContent = v; }
  get cookie() { return ''; }
  set cookie(v) { this.__cookieWrites.push(String(v)); }
  get forms() { return this.querySelectorAll('form'); }
  get visibilityState() { return 'visible'; }
  get hidden() { return false; }
  hasFocus() { return true; }
  getElementById(id) {
    id = String(id);
    for (const el of descendants(this)) if (el.getAttribute('id') === id) return el;
    return null;
  }
  getElementsByName(name) { return [...descendants(this)].filter((e) => e.getAttribute('name') === name); }
  createElement(tag) { return new Element(this, tag); }
  createElementNS(ns, tag) { return new Element(this, String(tag).replace(/^.*:/, ''), ns); }
  createTextNode(data) { return new Text(this, data); }
  createComment(data) { return new Comment(this, data); }
  createDocumentFragment() { return new DocumentFragment(this); }
  createEvent() { return new Event('', {}); }
  get activeElement() {
    const a = this._active;
    if (a && isRendered(a) && !isInert(a)) return a;
    return this.body;
  }
  _setFocus(next) {
    const prev = this._active && isRendered(this._active) ? this._active : null;
    if (prev === next) return;
    this._active = next;
    if (prev) {
      prev.dispatchEvent(new FocusEvent('blur', { relatedTarget: next }));
      prev.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: next }));
    }
    if (next && this._active === next) {
      next.dispatchEvent(new FocusEvent('focus', { relatedTarget: prev }));
      next.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: prev }));
    }
  }
  tabbables() {
    const all = [...descendants(this)].filter(isTabbable);
    const positive = all.filter((e) => e.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex);
    return [...positive, ...all.filter((e) => e.tabIndex === 0)];
  }
  // User-agent keyboard behaviour for a real key press (synthetic dispatchEvent has no default actions).
  __userKey(target, key, opts = {}) {
    const t = target || this.activeElement || this.body;
    const down = new KeyboardEvent('keydown', { key, code: opts.code ?? key, bubbles: true, cancelable: true, composed: true, shiftKey: !!opts.shiftKey, ctrlKey: !!opts.ctrlKey, altKey: !!opts.altKey, metaKey: !!opts.metaKey });
    const notCanceled = t.dispatchEvent(down);
    if (notCanceled) {
      if (key === 'Tab') {
        const list = this.tabbables();
        if (list.length) {
          const cur = list.indexOf(this.activeElement);
          let next;
          if (cur < 0) next = opts.shiftKey ? list.at(-1) : list[0];
          else next = list[(cur + (opts.shiftKey ? -1 : 1) + list.length) % list.length];
          next.focus();
        }
      } else if (key === 'Enter') {
        if (t.localName === 'button' || (t.localName === 'a' && t.hasAttribute('href'))) t.click();
        else if (t.localName === 'input' && t.form && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(t.type)) {
          const submitter = t.form.querySelectorAll('button, input').find((b) => (b.localName === 'button' && b.type === 'submit') || (b.localName === 'input' && b.type === 'submit'));
          if (submitter) submitter.click();
          else t.form._submitFrom(null);
        }
      }
    }
    const up = new KeyboardEvent('keyup', { key, code: opts.code ?? key, bubbles: true, cancelable: true, composed: true, shiftKey: !!opts.shiftKey });
    const upTarget = this.activeElement || this.body;
    const upOk = upTarget.dispatchEvent(up);
    if (notCanceled && upOk && key === ' ' && upTarget === t && (t.localName === 'button' || (t.localName === 'input' && ['checkbox', 'radio', 'button', 'submit'].includes(t.type)))) t.click();
    return notCanceled;
  }
}
defineHandlerProps(Document.prototype);

// ---------------------------------------------------------------- parser

function implicitClose(stack, name) {
  const cur = () => stack[stack.length - 1];
  const popUntilIncluding = (target, stops) => {
    for (let k = stack.length - 1; k > 0; k--) {
      const n = stack[k].localName;
      if (n === target) { stack.length = k; return; }
      if (stops.includes(n)) return;
    }
  };
  if (P_CLOSERS.has(name) && cur().localName === 'p') stack.pop();
  if (name === 'li') popUntilIncluding('li', ['ul', 'ol', 'menu']);
  if (name === 'dt' || name === 'dd') { popUntilIncluding('dt', ['dl']); popUntilIncluding('dd', ['dl']); }
  if (name === 'option') { if (cur().localName === 'option') stack.pop(); }
  if (name === 'optgroup') { if (cur().localName === 'option') stack.pop(); if (cur().localName === 'optgroup') stack.pop(); }
  if (name === 'tr') while (['td', 'th', 'tr'].includes(cur().localName)) stack.pop();
  if (name === 'td' || name === 'th') while (['td', 'th'].includes(cur().localName)) stack.pop();
  if (['thead', 'tbody', 'tfoot'].includes(name)) while (['td', 'th', 'tr', 'thead', 'tbody', 'tfoot'].includes(cur().localName)) stack.pop();
}

function parseInto(doc, container, html, fullDocument) {
  const stack = [container];
  const cur = () => stack[stack.length - 1];
  let htmlEl = null;
  const ensureHtml = () => {
    if (!fullDocument) return;
    if (!htmlEl) { htmlEl = doc.createElement('html'); container.appendChild(htmlEl); }
    if (stack.length === 1) stack.push(htmlEl);
  };
  const openTag = /<([A-Za-z][A-Za-z0-9:-]*)/y;
  const closeTag = /<\/([A-Za-z][A-Za-z0-9:-]*)\s*>/y;
  const attrName = /[^\s"'>\/=]+/y;
  const unquoted = /[^\s>]+/y;
  let i = 0;
  const n = html.length;
  while (i < n) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      const data = html.slice(i + 4, end < 0 ? n : end);
      (stack.length === 1 && fullDocument && htmlEl ? htmlEl : cur()).appendChild(doc.createComment(data));
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (html[i] === '<' && html[i + 1] === '!') {
      const end = html.indexOf('>', i);
      const content = html.slice(i + 2, end < 0 ? n : end);
      if (/^doctype/i.test(content) && fullDocument && !htmlEl) container.appendChild(new DocumentType(doc, content.replace(/^doctype\s*/i, '').trim().split(/\s/)[0] || 'html'));
      i = end < 0 ? n : end + 1;
      continue;
    }
    closeTag.lastIndex = i;
    let m = closeTag.exec(html);
    if (m) {
      const name = m[1].toLowerCase();
      i = closeTag.lastIndex;
      if (name === 'html' || name === 'body') continue;
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].localName === name) { stack.length = k; break; }
      }
      continue;
    }
    openTag.lastIndex = i;
    m = openTag.exec(html);
    if (m) {
      const name = m[1].toLowerCase();
      let j = openTag.lastIndex;
      const el = doc.createElement(name);
      let selfClosing = false;
      while (j < n) {
        while (j < n && /\s/.test(html[j])) j++;
        if (html[j] === '>') { j++; break; }
        if (html[j] === '/' && html[j + 1] === '>') { selfClosing = true; j += 2; break; }
        if (html[j] === '/') { j++; continue; }
        attrName.lastIndex = j;
        const an = attrName.exec(html);
        if (!an) { j++; continue; }
        j = attrName.lastIndex;
        let value = '';
        let k = j;
        while (k < n && /\s/.test(html[k])) k++;
        if (html[k] === '=') {
          k++;
          while (k < n && /\s/.test(html[k])) k++;
          if (html[k] === '"' || html[k] === "'") {
            const q = html[k];
            const end = html.indexOf(q, k + 1);
            value = html.slice(k + 1, end < 0 ? n : end);
            j = end < 0 ? n : end + 1;
          } else {
            unquoted.lastIndex = k;
            const uv = unquoted.exec(html);
            value = uv ? uv[0] : '';
            j = uv ? unquoted.lastIndex : k;
          }
        }
        const key = an[0].toLowerCase();
        if (!el.hasAttribute(key)) el._attrs.set(key, decodeEntities(value));
      }
      i = j;
      if (fullDocument && name === 'html') {
        if (!htmlEl) { htmlEl = el; container.appendChild(el); stack.length = 1; stack.push(el); }
        else for (const [k2, v2] of el._attrs) if (!htmlEl.hasAttribute(k2)) htmlEl._attrs.set(k2, v2);
        continue;
      }
      if (fullDocument && (name === 'head' || name === 'body')) {
        ensureHtml();
        const existing = htmlEl.children.find((c) => c.localName === name);
        const target = existing || el;
        if (!existing) htmlEl.appendChild(el);
        stack.length = 2;
        stack.push(target);
        continue;
      }
      ensureHtml();
      implicitClose(stack, name);
      cur().appendChild(el);
      if (RAW_TEXT_ELEMENTS.has(name) && !selfClosing) {
        const re = new RegExp('</' + name + '\\s*>', 'ig');
        re.lastIndex = i;
        const end = re.exec(html);
        const raw = html.slice(i, end ? end.index : n);
        if (raw) el.appendChild(doc.createTextNode(name === 'textarea' || name === 'title' ? decodeEntities(raw) : raw));
        i = end ? re.lastIndex : n;
        continue;
      }
      if (!VOID_ELEMENTS.has(name) && !selfClosing) stack.push(el);
      continue;
    }
    let next = html.indexOf('<', i + 1);
    if (next < 0) next = n;
    const text = decodeEntities(html.slice(i, next));
    i = next;
    if (fullDocument && stack.length <= 2 && !text.trim()) continue;
    ensureHtml();
    const parent = cur();
    const last = parent.lastChild;
    if (last && last.nodeType === 3) last.data += text;
    else parent.appendChild(doc.createTextNode(text));
  }
  if (fullDocument) {
    ensureHtml();
    let head = htmlEl.children.find((c) => c.localName === 'head');
    let body = htmlEl.children.find((c) => c.localName === 'body');
    if (!head) { head = doc.createElement('head'); htmlEl.insertBefore(head, htmlEl.firstChild); }
    if (!body) { body = doc.createElement('body'); htmlEl.appendChild(body); }
    for (const c of htmlEl.childNodes.slice()) {
      if (c === head || c === body) continue;
      if (c.nodeType === 1 && HEAD_ELEMENTS.has(c.localName) && htmlEl.childNodes.indexOf(c) < htmlEl.childNodes.indexOf(body)) head.appendChild(c);
      else body.appendChild(c);
    }
  }
}

function parseDocument(html) {
  const doc = new Document();
  parseInto(doc, doc, String(html), true);
  return doc;
}

// ---------------------------------------------------------------- listener accounting

function* allTargets(doc) {
  if (doc.defaultView) yield doc.defaultView;
  yield doc;
  yield* descendants(doc);
}
// Map<target, listenerCount> for window, document and every connected element.
function snapshotListeners(doc) {
  const m = new Map();
  for (const t of allTargets(doc)) m.set(t, t.listenerCount());
  return m;
}
function totalListeners(doc) {
  let n = 0;
  for (const t of allTargets(doc)) n += t.listenerCount();
  return n;
}
function describe(el) {
  if (!el || el.nodeType !== 1) return el && el.nodeType === 9 ? 'document' : 'window';
  const id = el.getAttribute('id');
  const extra = el.getAttributeNames().filter((a) => a.startsWith('data-')).map((a) => `[${a}="${el.getAttribute(a)}"]`).join('');
  return el.localName + (id ? '#' + id : '') + extra;
}

// Keeps node:assert failure messages short instead of inspecting the whole circular DOM graph.
EventTarget.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
  if (this.nodeType === 3) return `#text ${JSON.stringify(this.data.slice(0, 40))}`;
  return `<${describe(this)}>`;
};

// HTMLxxxElement globals answer instanceof by tag name.
function tagClass(tag) {
  return class {
    static [Symbol.hasInstance](o) { return o instanceof Element && (tag === null || o.localName === tag); }
  };
}
const htmlClasses = {
  HTMLElement: tagClass(null),
  HTMLInputElement: tagClass('input'),
  HTMLButtonElement: tagClass('button'),
  HTMLFormElement: tagClass('form'),
  HTMLSelectElement: tagClass('select'),
  HTMLTextAreaElement: tagClass('textarea'),
  HTMLFieldSetElement: tagClass('fieldset'),
  HTMLDialogElement: tagClass('dialog'),
  HTMLAnchorElement: tagClass('a'),
  HTMLTableSectionElement: tagClass('tbody'),
  HTMLOptionElement: tagClass('option'),
  HTMLTemplateElement: tagClass('template'),
};

module.exports = {
  Event, UIEvent, MouseEvent, PointerEvent, KeyboardEvent, FocusEvent, InputEvent, SubmitEvent, CustomEvent,
  EventTarget, WindowTarget, Node, Text, Comment, DocumentFragment, DocumentType, Element, Document, DOMTokenList,
  parseDocument, parseSelectorList, serialize, snapshotListeners, totalListeners, describe,
  isFocusable, isRendered, isActuallyDisabled, htmlClasses,
};
