(function () {
  'use strict';

  const VIEWS = ['overview', 'calls', 'bookings', 'connections', 'business', 'budget', 'control', 'errors', 'audit'];
  const LEGACY_VIEWS = { cost: 'budget' };
  const VIEW_LABELS = {
    overview: 'Genel bakış',
    calls: 'Çağrılar',
    bookings: 'Randevular',
    connections: 'Bağlantılar',
    business: 'İşletme taslağı',
    budget: 'Bütçe ve limitler',
    control: 'Durdurma kontrolü',
    errors: 'Hatalar',
    audit: 'Denetim kaydı'
  };
  const RESOURCES = {
    overview: 'overview',
    calls: 'calls',
    bookings: 'bookings',
    connections: 'connections',
    business: 'business',
    budget: 'overview',
    control: 'overview',
    errors: 'errors',
    audit: 'audit'
  };
  const PANEL_MESSAGES = {
    connections: { messages: ['connections-message'], reload: null },
    business: { messages: ['business-message'], reload: 'business-reload' },
    budget: { messages: ['limit-message'], reload: 'limit-reload' },
    control: { messages: ['control-message'], reload: 'control-reload' }
  };
  const EMPTY_TEXT = {
    calls: 'Henüz çağrı kaydı yok.',
    bookings: 'Henüz randevu kaydı yok.',
    errors: 'İnceleme bekleyen hata kaydı yok.',
    audit: 'Henüz denetim kaydı yok.'
  };
  const CONNECTION_KINDS = ['retellApiKey', 'googleClientId', 'googleClientSecret', 'googleRefreshToken'];
  const CONNECTION_LABELS = {
    retellApiKey: 'Retell API anahtarı',
    googleClientId: 'Google OAuth istemci kimliği',
    googleClientSecret: 'Google OAuth istemci sırrı',
    googleRefreshToken: 'Google yenileme belirteci'
  };
  const CONNECTION_STORED_TEXT = 'Sunucuda saklı · doğrulanmadı · etkin değil';
  const CONNECTION_EMPTY_TEXT = 'Kayıtlı değer yok';
  const ROLE_LABELS = { admin: 'Yönetici', operator: 'Operatör', viewer: 'Görüntüleyici' };
  const STATE_LABELS = {
    confirmed: 'Onaylandı',
    pending: 'Bekliyor',
    attempted: 'İşleniyor',
    unknown: 'Sonuç belirsiz',
    failed: 'Başarısız',
    active: 'Sürüyor',
    eligible: 'Uygun',
    human: 'İnsan desteği',
    opted_out: 'Reddetti',
    ended: 'Bitti',
    needs_operator: 'İnceleme gerekli'
  };
  const STATE_TONES = {
    confirmed: 'ok',
    pending: 'warn',
    attempted: 'info',
    unknown: 'warn',
    failed: 'danger',
    active: 'info',
    human: 'warn',
    needs_operator: 'warn'
  };
  const INVOICE_REASONS = { NOT_CONNECTED: 'Sağlayıcı faturası bağlı değil' };
  const INVOICE_FALLBACK = 'Sağlayıcı faturası kullanılamıyor';
  const COST_UNITS = { core_reservation_micros: 'yerel rezervasyon birimi' };
  const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  const DEFAULT_DRAFT = { weekdays: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020, durationMinutes: 30 };
  const BASE_DESCRIBEDBY = { 'biz-duration': 'biz-duration-hint', 'limit-cap': 'limit-cap-hint' };
  const TIMEZONE = 'Europe/Istanbul';
  const MAX_CAP = 1000000000;

  const MSG = {
    network: 'Sunucuya ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.',
    expired: 'Oturum sona erdi. Yeniden giriş yapın.',
    forbidden: 'Bu işlem için yetkiniz yok.',
    stale: 'Veri başka bir işlemle değişti; yenileyip tekrar deneyin.',
    rateLimited: 'Çok fazla istek; biraz bekleyin.',
    invalid: 'Gönderilen bilgiler kabul edilmedi; alanları kontrol edin.',
    server: 'Sunucu işlemi tamamlayamadı. Biraz sonra tekrar deneyin.',
    badResponse: 'Sunucudan beklenmeyen bir yanıt alındı.',
    generic: 'İşlem tamamlanamadı. Yenileyip tekrar deneyin.'
  };
  const CODE_MESSAGES = {
    INVALID_BUSINESS: 'İşletme alanlarını ve saat aralığını kontrol edin.',
    INVALID_INPUT: 'Girilen alanları kontrol edin.',
    NO_TENANT: 'Bu hesap için tanımlı işletme yok.',
    BAD_RESPONSE: MSG.badResponse
  };

  class ApiError extends Error {
    constructor(status, code, requestId, network) {
      super(code || (network ? 'NETWORK' : 'HTTP_' + status));
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.requestId = requestId;
      this.network = network;
    }
  }

  const state = {
    epoch: 0,
    loadSeq: 0,
    session: null,
    csrf: null,
    tenantId: null,
    view: 'overview',
    overview: null,
    business: null,
    controlStale: false,
    pendingControl: null,
    modal: null,
    loginBusy: false,
    busy: emptyBusy()
  };
  let bound = false;

  function emptyBusy() {
    return { logout: false, connections: null, business: null, limit: null, control: null };
  }

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  // DOM helpers

  function byId(id) {
    return document.getElementById(id);
  }

  function q(selector) {
    return document.querySelector(selector);
  }

  function qa(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  function qaIn(root, selector) {
    return root ? Array.prototype.slice.call(root.querySelectorAll(selector)) : [];
  }

  function on(node, type, handler) {
    if (node) node.addEventListener(type, handler);
  }

  function setText(node, text) {
    if (node) node.textContent = text;
  }

  function setHidden(id, hidden) {
    const node = byId(id);
    if (node) node.hidden = hidden;
  }

  function focusNode(node) {
    if (node && typeof node.focus === 'function') node.focus();
  }

  function make(tag, classes, text) {
    const node = document.createElement(tag);
    if (classes) {
      for (const name of classes.split(' ')) {
        if (name) node.classList.add(name);
      }
    }
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function fill(node, content) {
    if (content === null || content === undefined || content === '') node.textContent = '—';
    else if (typeof content === 'object') node.append(content);
    else node.textContent = String(content);
  }

  function badge(text, tone) {
    return make('span', tone ? 'badge badge--' + tone : 'badge', text);
  }

  function mono(value) {
    return make('code', 'mono', value === null || value === undefined || value === '' ? '—' : String(value));
  }

  // Formatting

  let numberFormat = null;
  let dateTimeFormat = null;
  let timeFormat = null;

  function getNumberFormat() {
    if (!numberFormat) {
      try {
        numberFormat = new Intl.NumberFormat('tr-TR');
      } catch (_) {
        numberFormat = { format: (n) => String(n) };
      }
    }
    return numberFormat;
  }

  function getDateFormat(timeOnly) {
    if (timeOnly ? timeFormat : dateTimeFormat) return timeOnly ? timeFormat : dateTimeFormat;
    const options = timeOnly ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' };
    let formatter;
    try {
      formatter = new Intl.DateTimeFormat('tr-TR', Object.assign({ timeZone: TIMEZONE }, options));
    } catch (_) {
      try {
        formatter = new Intl.DateTimeFormat('tr-TR', options);
      } catch (__) {
        formatter = { format: (d) => d.toISOString() };
      }
    }
    if (timeOnly) timeFormat = formatter;
    else dateTimeFormat = formatter;
    return formatter;
  }

  function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function fmtNumber(value) {
    const n = toNumber(value);
    return n === null ? '—' : getNumberFormat().format(n);
  }

  function toDate(ms) {
    const n = toNumber(ms);
    if (n === null || n <= 0) return null;
    const date = new Date(n);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function fmtDate(ms, timeOnly) {
    const date = toDate(ms);
    return date ? getDateFormat(Boolean(timeOnly)).format(date) : '—';
  }

  function timeNode(ms, timeOnly) {
    const date = toDate(ms);
    if (!date) return document.createTextNode('—');
    const node = make('time', '', fmtDate(ms, timeOnly));
    node.setAttribute('datetime', date.toISOString());
    return node;
  }

  function minutesToTime(minutes) {
    const n = toNumber(minutes);
    if (n === null || n < 0 || n > 1440) return '';
    const h = Math.floor(n / 60);
    const m = n % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function parseTime(value) {
    const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(value || '').trim());
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  }

  function isInteger(value) {
    return typeof value === 'number' && Number.isInteger(value);
  }

  // Errors and messages

  function describeError(err) {
    if (!(err instanceof ApiError)) return { text: MSG.generic, requestId: null };
    const requestId = err.requestId || null;
    if (err.network) return { text: MSG.network, requestId: null };
    if (err.code && has(CODE_MESSAGES, err.code) && (err.status === 400 || err.status === 200)) {
      return { text: CODE_MESSAGES[err.code], requestId };
    }
    if (err.status === 401) return { text: MSG.expired, requestId };
    if (err.status === 403) {
      const text = err.code === 'CSRF_REJECTED'
        ? MSG.forbidden + ' Oturum doğrulanamadı; sayfayı yenileyin.'
        : MSG.forbidden;
      return { text, requestId };
    }
    if (err.status === 409) return { text: MSG.stale, requestId };
    if (err.status === 429) return { text: MSG.rateLimited, requestId };
    if (err.status === 400) return { text: MSG.invalid, requestId };
    if (err.status >= 500) return { text: MSG.server, requestId };
    return { text: MSG.generic, requestId };
  }

  function describeLoginError(err, stage) {
    if (!(err instanceof ApiError)) return MSG.generic;
    if (err.network) return MSG.network;
    if (stage === 'session') {
      if (err.code === 'NO_TENANT') return CODE_MESSAGES.NO_TENANT;
      if (err.status === 401) return 'Oturum başlatılamadı. Tarayıcının çerezlere izin verdiğini kontrol edip tekrar deneyin.';
      return describeError(err).text;
    }
    if (err.status === 401 || err.status === 400) return 'Kullanıcı adı veya parola yanlış.';
    if (err.status === 429) return 'Çok fazla giriş denemesi; biraz bekleyip tekrar deneyin.';
    if (err.status === 403) return 'Giriş isteği reddedildi. Paneli bu sunucunun kendi adresinden açın.';
    return describeError(err).text;
  }

  function isUncertain(err) {
    return err instanceof ApiError && (err.network || err.status >= 500);
  }

  function setMessage(node, tone, text, requestId) {
    if (!node) return;
    node.replaceChildren();
    for (const name of ['is-ok', 'is-error', 'is-warn', 'is-info']) node.classList.remove(name);
    if (!text) return;
    node.classList.add('is-' + tone);
    node.append(document.createTextNode(text));
    if (requestId) {
      const ref = make('span', 'ref', 'Referans: ');
      ref.append(mono(requestId));
      node.append(ref);
    }
  }

  function showError(node, err) {
    const detail = describeError(err);
    setMessage(node, 'error', detail.text, detail.requestId);
  }

  function clearPanelMessages(view) {
    if (!has(PANEL_MESSAGES, view)) return;
    const config = PANEL_MESSAGES[view];
    for (const id of config.messages) setMessage(byId(id), '', '');
    if (config.reload) setHidden(config.reload, true);
  }

  function clearAllMessages() {
    for (const view of Object.keys(PANEL_MESSAGES)) clearPanelMessages(view);
    clearGlobalMessages();
  }

  function clearGlobalMessages() {
    setMessage(byId('global-error'), '', '');
    setMessage(byId('notice'), '', '');
  }

  // API

  function tenantPath(tenant, resource) {
    return '/api/tenants/' + encodeURIComponent(tenant) + '/' + resource;
  }

  async function request(method, path, body, options) {
    const sessionBound = !options || options.sessionBound !== false;
    const headers = {};
    const init = { method, credentials: 'same-origin', headers };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      if (sessionBound) headers['X-CSRF-Token'] = state.csrf || '';
      init.body = JSON.stringify(body === undefined ? {} : body);
    }
    const epoch = state.epoch;
    let response;
    try {
      response = await fetch(path, init);
    } catch (_) {
      throw new ApiError(0, null, null, true);
    }
    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      data = null;
    }
    const ok = typeof response.ok === 'boolean' ? response.ok : response.status >= 200 && response.status < 300;
    if (!ok) {
      const code = data && typeof data.code === 'string' ? data.code.slice(0, 64) : null;
      const requestId = data && typeof data.requestId === 'string' ? data.requestId.slice(0, 80) : null;
      if (response.status === 401 && sessionBound && epoch === state.epoch && state.session) expireSession();
      throw new ApiError(response.status, code, requestId, false);
    }
    if (!data || typeof data !== 'object') throw new ApiError(response.status, 'BAD_RESPONSE', null, false);
    return data;
  }

  function badResponse() {
    return new ApiError(200, 'BAD_RESPONSE', null, false);
  }

  function requireArray(value) {
    if (!Array.isArray(value)) throw badResponse();
    return value;
  }

  // Session and roles

  function currentRole() {
    if (!state.session || !state.tenantId) return null;
    const entry = state.session.tenants.find((t) => t.id === state.tenantId);
    return entry ? entry.role : null;
  }

  function isAdmin() {
    return currentRole() === 'admin';
  }

  function canControl() {
    const role = currentRole();
    return role === 'admin' || role === 'operator';
  }

  function currentOverview() {
    return state.overview && state.overview.tenant === state.tenantId ? state.overview.data : null;
  }

  function currentBusiness() {
    return state.business && state.business.tenant === state.tenantId ? state.business.data : null;
  }

  async function startSession() {
    const epoch = state.epoch;
    const data = await request('GET', '/api/session', undefined, { sessionBound: false });
    if (epoch !== state.epoch) return;
    const tenants = (Array.isArray(data.tenants) ? data.tenants : [])
      .filter((t) => t && typeof t.id === 'string' && t.id !== '' && typeof t.role === 'string' && has(ROLE_LABELS, t.role))
      .map((t) => ({ id: t.id, role: t.role }));
    if (tenants.length === 0) throw new ApiError(200, 'NO_TENANT', null, false);
    state.session = {
      username: typeof data.username === 'string' ? data.username : '',
      tenants,
      demo: data.demo === true
    };
    state.csrf = typeof data.csrf === 'string' ? data.csrf : '';
    state.tenantId = tenants[0].id;
    renderShell();
    showApp();
    showView(state.view, { focus: false });
  }

  function expireSession() {
    clearAll();
    showLogin(MSG.expired);
  }

  function clearAll() {
    state.epoch += 1;
    state.loadSeq += 1;
    state.session = null;
    state.csrf = null;
    state.tenantId = null;
    state.overview = null;
    state.business = null;
    state.controlStale = false;
    state.pendingControl = null;
    state.busy = emptyBusy();
    closeConfirm(false);
    closeMenu();
    const select = byId('tenant-select');
    if (select) select.replaceChildren();
    setText(byId('user-name'), '');
    const role = byId('user-role');
    if (role) {
      role.textContent = '';
      role.removeAttribute('data-role');
    }
    setHidden('demo-banner', true);
    setHidden('demo-badge', true);
    const logout = byId('logout-button');
    if (logout) logout.disabled = false;
    resetBusinessForm();
    const cap = byId('limit-cap');
    if (cap) cap.value = '';
    for (const kind of CONNECTION_KINDS) {
      const input = byId('conn-' + kind);
      if (input) input.value = '';
    }
    clearDataDom();
    clearAllMessages();
    refreshControls();
  }

  function clearDataDom() {
    for (const view of VIEWS) setPanelState(view, 'loading');
    for (const key of ['calls', 'bookings', 'errors', 'audit', 'audit-admin']) {
      const body = q('[data-rows="' + key + '"]');
      if (body) body.replaceChildren();
    }
    for (const node of qa('[data-metric]')) node.textContent = '—';
    for (const node of qa('[data-budget]')) node.textContent = '—';
    for (const node of qa('[data-connections-meta]')) node.textContent = '—';
    for (const kind of CONNECTION_KINDS) {
      setText(q('[data-connection-status="' + kind + '"]'), '—');
      setText(q('[data-connection-updated="' + kind + '"]'), '');
    }
    setText(byId('max-calls'), '—');
    setText(byId('kill-state'), '—');
    setText(byId('business-revision'), '—');
    setText(byId('business-updated'), '—');
    const facts = byId('business-effective-facts');
    if (facts) facts.replaceChildren();
    setHidden('business-effective', true);
    clearBusinessErrors();
    setFieldError(byId('limit-cap'), 'limit-cap-error', '');
  }

  function renderShell() {
    const select = byId('tenant-select');
    if (select) {
      const options = state.session.tenants.map((t) => {
        const option = make('option', '', t.id);
        option.value = t.id;
        return option;
      });
      select.replaceChildren(...options);
      select.value = state.tenantId;
    }
    setText(byId('user-name'), state.session.username);
    setHidden('demo-banner', !state.session.demo);
    setHidden('demo-badge', !state.session.demo);
    renderRole();
    refreshControls();
  }

  function renderRole() {
    const node = byId('user-role');
    const role = currentRole();
    if (!node) return;
    node.textContent = role ? ROLE_LABELS[role] : '';
    if (role) node.setAttribute('data-role', role);
    else node.removeAttribute('data-role');
  }

  function setGroupDisabled(id, disabled) {
    const group = byId(id);
    if (!group) return;
    group.disabled = disabled;
    for (const tag of ['input', 'textarea', 'select', 'button']) {
      for (const control of qaIn(group, tag)) control.disabled = disabled;
    }
  }

  function refreshControls() {
    const admin = isAdmin();
    const control = canControl();
    setGroupDisabled('connections-fieldset', !admin || Boolean(state.busy.connections));
    setGroupDisabled('business-fieldset', !admin || Boolean(state.busy.business));
    setGroupDisabled('limit-fieldset', !admin || Boolean(state.busy.limit));
    setHidden('connections-role-note', admin);
    setHidden('business-role-note', admin);
    setHidden('limit-role-note', admin);
    setHidden('control-role-note', control);

    const toggle = byId('kill-toggle');
    if (toggle) {
      toggle.disabled = !control || state.controlStale || !currentOverview();
      if (control) toggle.removeAttribute('aria-describedby');
      else toggle.setAttribute('aria-describedby', 'control-role-note');
      if (state.busy.control) toggle.setAttribute('aria-disabled', 'true');
      else toggle.removeAttribute('aria-disabled');
    }
    const retry = byId('control-retry');
    if (retry) {
      const pending = state.pendingControl;
      retry.hidden = !(pending && pending.tenant === state.tenantId && pending.epoch === state.epoch && control);
      retry.disabled = Boolean(state.busy.control);
    }
  }

  // Views and routing

  function viewFromHash(hash) {
    const key = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
    if (VIEWS.includes(key)) return key;
    if (has(LEGACY_VIEWS, key)) return LEGACY_VIEWS[key];
    return 'overview';
  }

  function readHash() {
    try {
      const loc = window.location;
      return loc && typeof loc.hash === 'string' ? loc.hash : '';
    } catch (_) {
      return '';
    }
  }

  function writeHash(view, replace) {
    const target = '#' + view;
    try {
      const loc = window.location;
      if (!loc || loc.hash === target) return;
      const hist = window.history;
      if (replace && hist && typeof hist.replaceState === 'function') {
        hist.replaceState(null, '', target);
        return;
      }
      loc.hash = target;
    } catch (_) {
      return;
    }
  }

  function initRoute() {
    const raw = readHash().replace(/^#/, '');
    state.view = viewFromHash(raw);
    if (raw !== '' && raw !== state.view) writeHash(state.view, true);
  }

  function onHashChange() {
    const hash = readHash();
    if (hash === '#main' || hash === '#login-username') return;
    const view = viewFromHash(hash);
    writeHash(view, true);
    if (view === state.view) return;
    showView(view, { focus: true });
  }

  function navigate(view) {
    if (!VIEWS.includes(view)) return;
    writeHash(view, false);
    if (view === state.view) {
      closeMenu();
      focusHeading(view);
      return;
    }
    showView(view, { focus: true });
  }

  function showView(view, options) {
    state.view = VIEWS.includes(view) ? view : 'overview';
    if (!state.session) return;
    closeConfirm(false);
    syncNav();
    closeMenu();
    clearGlobalMessages();
    document.title = VIEW_LABELS[state.view] + ' · Resepsiyon paneli';
    loadView(state.view);
    if (options && options.focus) focusHeading(state.view);
  }

  function syncNav() {
    for (const button of qa('[data-view]')) {
      if (button.getAttribute('data-view') === state.view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    for (const panel of qa('[data-panel]')) {
      panel.hidden = panel.getAttribute('data-panel') !== state.view;
    }
  }

  function focusHeading(view) {
    const panel = q('[data-panel="' + view + '"]');
    if (panel) focusNode(panel.querySelector('h1'));
  }

  function menuIsOpen() {
    const toggle = byId('menu-toggle');
    return Boolean(toggle && toggle.getAttribute('aria-expanded') === 'true');
  }

  function setMenu(open) {
    const toggle = byId('menu-toggle');
    const nav = byId('primary-nav');
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (nav) {
      if (open) nav.classList.add('is-open');
      else nav.classList.remove('is-open');
    }
  }

  function toggleMenu() {
    setMenu(!menuIsOpen());
  }

  function closeMenu() {
    setMenu(false);
  }

  function showLogin(message) {
    const skip = q('.skip-link');
    if (skip) skip.setAttribute('href', '#login-username');
    setHidden('boot-status', true);
    setHidden('app-view', true);
    setHidden('login-view', false);
    setText(byId('login-error'), message || '');
    document.title = 'Giriş · Resepsiyon paneli';
    focusNode(byId('login-username'));
  }

  function showApp() {
    const skip = q('.skip-link');
    if (skip) skip.setAttribute('href', '#main');
    setHidden('boot-status', true);
    setHidden('login-view', true);
    setHidden('app-view', false);
    setText(byId('login-error'), '');
  }

  // Loading

  function setPanelState(view, panelState, err) {
    const status = q('[data-status="' + view + '"]');
    const text = q('[data-status-text="' + view + '"]');
    const retry = q('[data-retry="' + view + '"]');
    const content = q('[data-content="' + view + '"]');
    if (status) {
      status.setAttribute('data-state', panelState);
      status.hidden = panelState === 'ready';
    }
    if (retry) retry.hidden = panelState !== 'error';
    if (content) content.hidden = panelState !== 'ready';
    if (!text) return;
    text.replaceChildren();
    if (panelState === 'loading') {
      text.textContent = 'Yükleniyor…';
    } else if (panelState === 'empty') {
      text.textContent = has(EMPTY_TEXT, view) ? EMPTY_TEXT[view] : 'Kayıt yok.';
    } else if (panelState === 'error') {
      const detail = describeError(err);
      text.append(document.createTextNode(detail.text));
      if (detail.requestId) {
        const ref = make('span', 'ref', 'Referans: ');
        ref.append(mono(detail.requestId));
        text.append(ref);
      }
    }
  }

  function isCurrentLoad(token) {
    return token.epoch === state.epoch
      && token.tenant === state.tenantId
      && token.view === state.view
      && token.seq === state.loadSeq;
  }

  async function loadView(view, options) {
    if (!state.session || !state.tenantId || !VIEWS.includes(view)) return;
    const afterWrite = Boolean(options && options.afterWrite);
    state.loadSeq += 1;
    const token = { epoch: state.epoch, tenant: state.tenantId, view, seq: state.loadSeq, afterWrite };
    if (!afterWrite) {
      clearPanelMessages(view);
      setPanelState(view, 'loading');
    }
    try {
      const data = await request('GET', tenantPath(token.tenant, RESOURCES[view]));
      if (!isCurrentLoad(token)) return;
      setPanelState(view, renderView(view, data, token));
    } catch (err) {
      if (!isCurrentLoad(token)) return;
      setPanelState(view, 'error', err);
    }
    refreshControls();
  }

  function refreshView(view) {
    if (view === state.view) loadView(view);
  }

  function renderView(view, data, token) {
    switch (view) {
      case 'overview':
        storeOverview(data, token);
        renderOverview(data);
        return 'ready';
      case 'budget':
        storeOverview(data, token);
        renderBudget(data);
        return 'ready';
      case 'control':
        storeOverview(data, token);
        renderKillState(data);
        return 'ready';
      case 'calls':
        return renderCalls(data);
      case 'bookings':
        return renderBookings(data);
      case 'connections':
        return renderConnections(data);
      case 'business':
        return renderBusiness(data, token);
      case 'errors':
        return renderErrors(data);
      case 'audit':
        return renderAudit(data);
      default:
        throw new Error('Bilinmeyen görünüm: ' + view);
    }
  }

  function storeOverview(data, token) {
    state.overview = { tenant: token.tenant, data };
    state.controlStale = false;
  }

  // Overview

  function setMetric(key, content) {
    const node = q('[data-metric="' + key + '"]');
    if (!node) return;
    node.replaceChildren();
    fill(node, content);
  }

  function readyBadge(ready) {
    if (ready === true) return badge('Hazır', 'ok');
    if (ready === false) return badge('Hazır değil', 'danger');
    return badge('Bilinmiyor');
  }

  function killBadge(kill) {
    if (kill === true) return badge('Yeni işlemler durduruldu', 'warn');
    if (kill === false) return badge('Yeni işlemler açık', 'ok');
    return badge('Bilinmiyor');
  }

  function providerModeBadge(mock) {
    if (mock === true) return badge('Sentetik sağlayıcı (mock)', 'info');
    if (mock === false) return badge('Canlı sağlayıcı adaptörü seçili');
    return badge('Bilinmiyor');
  }

  function invoiceText(data) {
    if (data.providerInvoice !== null && data.providerInvoice !== undefined) return INVOICE_FALLBACK;
    const reason = data.providerInvoiceReason;
    return typeof reason === 'string' && has(INVOICE_REASONS, reason) ? INVOICE_REASONS[reason] : INVOICE_FALLBACK;
  }

  function renderOverview(data) {
    const budget = data.budget && typeof data.budget === 'object' ? data.budget : {};
    setMetric('calls', fmtNumber(data.calls));
    setMetric('bookings', fmtNumber(data.bookings));
    setMetric('confirmed', fmtNumber(data.confirmed));
    setMetric('errors', fmtNumber(data.errors));
    setMetric('maxCalls', fmtNumber(data.maxCalls));
    setMetric('ready', readyBadge(data.ready));
    setMetric('kill', killBadge(data.kill));
    setMetric('providerMock', providerModeBadge(data.providerMock));
    setMetric('budgetCap', fmtNumber(budget.cap));
    setMetric('budgetReserved', fmtNumber(budget.reserved));
    setMetric('budgetSpent', fmtNumber(budget.spent));
    const unit = typeof data.costUnit === 'string' ? data.costUnit : '';
    setMetric('costUnit', has(COST_UNITS, unit) ? COST_UNITS[unit] : 'Tanımsız birim');
    setMetric('costUnitCode', unit || '—');
    setMetric('providerInvoice', invoiceText(data));
    setMetric('providerInvoiceReason', typeof data.providerInvoiceReason === 'string' ? data.providerInvoiceReason : '—');
    setMetric('observedAt', timeNode(data.observedAt));
  }

  // Budget

  function renderBudget(data) {
    const budget = data.budget && typeof data.budget === 'object' ? data.budget : {};
    for (const key of ['cap', 'reserved', 'spent']) setText(q('[data-budget="' + key + '"]'), fmtNumber(budget[key]));
    setText(byId('max-calls'), fmtNumber(data.maxCalls));
    const cap = byId('limit-cap');
    if (cap && !state.busy.limit) cap.value = isInteger(budget.cap) ? String(budget.cap) : '';
    setFieldError(cap, 'limit-cap-error', '');
  }

  async function onLimitSubmit(event) {
    event.preventDefault();
    const message = byId('limit-message');
    const input = byId('limit-cap');
    if (!isAdmin()) {
      setMessage(message, 'error', MSG.forbidden);
      return;
    }
    if (state.busy.limit) return;
    const overview = currentOverview();
    if (!overview) {
      setMessage(message, 'error', 'Güncel bütçe bilinmiyor; önce verileri yenileyin.');
      return;
    }
    const raw = input ? String(input.value).trim() : '';
    const cap = /^\d{1,10}$/.test(raw) ? Number(raw) : null;
    if (cap === null || cap > MAX_CAP) {
      setFieldError(input, 'limit-cap-error', '0 ile 1.000.000.000 arasında bir tam sayı girin.');
      setMessage(message, 'error', 'Formda düzeltilmesi gereken bir alan var.');
      focusNode(input);
      return;
    }
    setFieldError(input, 'limit-cap-error', '');
    setHidden('limit-reload', true);
    const ctx = beginWrite('limit');
    setMessage(message, 'info', 'Kaydediliyor…');
    try {
      const result = await request('POST', tenantPath(ctx.tenant, 'limits'), { cap, revision: overview.limitRevision });
      if (!isWriteCurrent(ctx)) return;
      if (overview.budget && typeof overview.budget === 'object' && isInteger(result.cap)) overview.budget.cap = result.cap;
      if (isInteger(result.revision)) overview.limitRevision = result.revision;
      setMessage(message, 'ok', 'Yerel bütçe sınırı kaydedildi. Sağlayıcı tarafında bir harcama limiti oluşturulmadı.');
      endWrite('limit', ctx);
      if (state.view === 'budget') loadView('budget', { afterWrite: true });
    } catch (err) {
      if (!isWriteCurrent(ctx)) return;
      showError(message, err);
      if (err instanceof ApiError && err.status === 409) setHidden('limit-reload', false);
    } finally {
      endWrite('limit', ctx);
    }
  }

  // Writes

  function beginWrite(key) {
    const ctx = { epoch: state.epoch, tenant: state.tenantId };
    state.busy[key] = ctx;
    refreshControls();
    return ctx;
  }

  function endWrite(key, ctx) {
    if (state.busy[key] !== ctx) return;
    state.busy[key] = null;
    refreshControls();
  }

  function isWriteCurrent(ctx) {
    return ctx.epoch === state.epoch && ctx.tenant === state.tenantId;
  }

  function setFieldError(input, errorId, text) {
    const error = byId(errorId);
    if (error) {
      error.textContent = text || '';
      error.hidden = !text;
    }
    if (!input) return;
    const base = input.id && has(BASE_DESCRIBEDBY, input.id) ? BASE_DESCRIBEDBY[input.id] : '';
    if (text) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', base ? base + ' ' + errorId : errorId);
    } else {
      input.removeAttribute('aria-invalid');
      if (base) input.setAttribute('aria-describedby', base);
      else input.removeAttribute('aria-describedby');
    }
  }

  // Tables

  function td(content, classes) {
    const cell = make('td', classes);
    fill(cell, content);
    return cell;
  }

  function rowHeader(content) {
    const cell = make('th');
    cell.setAttribute('scope', 'row');
    fill(cell, content);
    return cell;
  }

  function tr(cells) {
    const row = make('tr');
    row.append(...cells);
    return row;
  }

  function emptyRow(columns, text) {
    const cell = make('td', 'empty-row', text);
    cell.setAttribute('colspan', String(columns));
    return tr([cell]);
  }

  function setRows(key, rows) {
    const body = q('[data-rows="' + key + '"]');
    if (body) body.replaceChildren(...rows);
  }

  function stateBadge(value) {
    const key = typeof value === 'string' ? value : '';
    const label = has(STATE_LABELS, key) ? STATE_LABELS[key] : (key || 'Bilinmiyor');
    return badge(label, has(STATE_TONES, key) ? STATE_TONES[key] : '');
  }

  function plain(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }

  function renderCalls(data) {
    const items = requireArray(data.items);
    setRows('calls', items.map((item) => tr([
      rowHeader(mono(item.id)),
      td(stateBadge(item.state)),
      td(timeNode(item.started_ms)),
      td(timeNode(item.last_event_ms))
    ])));
    return items.length ? 'ready' : 'empty';
  }

  function bookingWindow(item) {
    const span = make('span');
    span.append(timeNode(item.start_ms));
    if (toDate(item.end_ms)) {
      span.append(document.createTextNode(' – '));
      span.append(timeNode(item.end_ms, true));
    }
    return span;
  }

  function renderBookings(data) {
    const items = requireArray(data.items);
    setRows('bookings', items.map((item) => {
      const mock = item.provider_mock === true || Number(item.provider_mock) === 1;
      return tr([
        rowHeader(mono(item.id)),
        td(plain(item.service)),
        td(bookingWindow(item)),
        td(stateBadge(item.state)),
        td(mock ? badge('Sentetik (mock)', 'info') : badge('Sağlayıcı')),
        td(mono(item.call_id)),
        td(timeNode(item.created_ms))
      ]);
    }));
    return items.length ? 'ready' : 'empty';
  }

  function renderErrors(data) {
    const items = requireArray(data.items);
    setRows('errors', items.map((item) => tr([
      rowHeader(mono(item.job_id)),
      td(plain(item.kind)),
      td(stateBadge(item.state)),
      td(plain(item.reason), 'wrap'),
      td(fmtNumber(item.attempts), 'num'),
      td(timeNode(item.created_ms))
    ])));
    return items.length ? 'ready' : 'empty';
  }

  function renderAudit(data) {
    const items = requireArray(data.items);
    const admin = Array.isArray(data.admin) ? data.admin : [];
    setRows('audit', items.length
      ? items.map((item) => tr([rowHeader(mono(item.id)), td(plain(item.action)), td(timeNode(item.at_ms))]))
      : [emptyRow(3, 'Bu bölümde kayıt yok.')]);
    setRows('audit-admin', admin.length
      ? admin.map((item) => tr([rowHeader(mono(item.id)), td(mono(item.actor)), td(plain(item.action)), td(timeNode(item.at_ms))]))
      : [emptyRow(4, 'Bu bölümde kayıt yok.')]);
    return items.length || admin.length ? 'ready' : 'empty';
  }

  // Connections

  function setConnectionStatus(kind, stored, updated) {
    const status = q('[data-connection-status="' + kind + '"]');
    if (status) {
      let text = 'Durum alınamadı';
      if (stored === true) text = CONNECTION_STORED_TEXT;
      else if (stored === false) text = CONNECTION_EMPTY_TEXT;
      status.textContent = text;
      status.setAttribute('data-state', stored === true ? 'stored' : 'empty');
    }
    setText(q('[data-connection-updated="' + kind + '"]'), stored === true && toDate(updated) ? 'Son kayıt: ' + fmtDate(updated) : '');
    const form = q('[data-connection-form="' + kind + '"]');
    const button = form ? form.querySelector('button') : null;
    setText(button, stored === true ? 'Değiştir' : 'Kaydet');
  }

  function availabilityText(flag) {
    return flag === true ? 'Sunucu kullanılabilir bildiriyor; bu panel yapmaz' : 'Bu sürümde kullanılamıyor';
  }

  function renderConnections(data) {
    const items = requireArray(data.items);
    for (const kind of CONNECTION_KINDS) {
      const item = items.find((entry) => entry && entry.kind === kind);
      setConnectionStatus(kind, item ? item.stored === true : null, item ? item.updated : null);
    }
    let runtime = 'Bilinmiyor';
    if (data.runtimeProviderMock === true) runtime = 'Sentetik (mock)';
    else if (data.runtimeProviderMock === false) runtime = 'Canlı adaptör seçili';
    setText(q('[data-connections-meta="runtime"]'), runtime);
    setText(q('[data-connections-meta="verification"]'), availabilityText(data.liveVerificationAvailable));
    setText(q('[data-connections-meta="activation"]'), availabilityText(data.activationAvailable));
    return 'ready';
  }

  async function onConnectionSubmit(event, kind) {
    event.preventDefault();
    const input = byId('conn-' + kind);
    const value = input ? String(input.value) : '';
    if (input) input.value = '';
    const message = byId('connections-message');
    const label = CONNECTION_LABELS[kind];
    if (!isAdmin()) {
      setMessage(message, 'error', MSG.forbidden);
      return;
    }
    if (state.busy.connections) {
      setMessage(message, 'info', 'Önceki kayıt sürüyor; tamamlandıktan sonra tekrar girin.');
      return;
    }
    if (value.trim() === '') {
      setMessage(message, 'error', label + ' için bir değer girin.');
      focusNode(input);
      return;
    }
    const ctx = beginWrite('connections');
    setMessage(message, 'info', label + ' kaydediliyor…');
    try {
      const result = await request('POST', tenantPath(ctx.tenant, 'connections'), { kind, value });
      if (!isWriteCurrent(ctx)) return;
      if (result.stored === true) {
        setConnectionStatus(kind, true, null);
        setMessage(message, 'ok', label + ' sunucuda saklandı. Doğrulanmadı ve etkin değil.');
      } else {
        setMessage(message, 'warn', 'Sunucu kaydı onaylamadı; durumu yenileyin.');
      }
    } catch (err) {
      if (!isWriteCurrent(ctx)) return;
      showError(message, err);
    } finally {
      if (input) input.value = '';
      endWrite('connections', ctx);
    }
  }

  // Business draft

  function weekdayInputs() {
    return qa('[name="weekday"]');
  }

  function resetBusinessForm() {
    for (const id of ['biz-name', 'biz-service', 'biz-policy', 'biz-start', 'biz-end', 'biz-duration']) {
      const node = byId(id);
      if (node) node.value = '';
    }
    const tz = byId('biz-timezone');
    if (tz) tz.value = TIMEZONE;
    for (const box of weekdayInputs()) box.checked = false;
  }

  function fillBusinessForm(value) {
    const v = value && typeof value === 'object' ? value : {};
    const setValue = (id, text) => {
      const node = byId(id);
      if (node) node.value = text;
    };
    setValue('biz-name', plain(v.name));
    setValue('biz-service', plain(v.service));
    setValue('biz-policy', plain(v.policy));
    setValue('biz-timezone', TIMEZONE);
    const days = Array.isArray(v.weekdays) ? v.weekdays.map(Number) : (value ? [] : DEFAULT_DRAFT.weekdays);
    for (const box of weekdayInputs()) box.checked = days.includes(Number(box.value));
    setValue('biz-start', minutesToTime(isInteger(v.startMinute) ? v.startMinute : DEFAULT_DRAFT.startMinute));
    setValue('biz-end', minutesToTime(isInteger(v.endMinute) ? v.endMinute : DEFAULT_DRAFT.endMinute));
    setValue('biz-duration', String(isInteger(v.durationMinutes) ? v.durationMinutes : DEFAULT_DRAFT.durationMinutes));
  }

  function renderDraftMeta(draft) {
    setText(byId('business-revision'), isInteger(draft.revision) ? String(draft.revision) : '—');
    const updated = toDate(draft.updated);
    setText(byId('business-updated'), updated ? fmtDate(draft.updated) : (draft.value ? '—' : 'Henüz kaydedilmedi'));
    const badgeNode = byId('business-draft-badge');
    if (badgeNode) {
      const active = draft.active === true;
      badgeNode.textContent = active ? 'Taslak · sunucuya göre etkin' : 'Taslak · etkin değil';
      badgeNode.classList.remove(active ? 'badge--warn' : 'badge--ok');
      badgeNode.classList.add(active ? 'badge--ok' : 'badge--warn');
    }
  }

  function fact(label, content) {
    const row = make('div', 'fact');
    const dt = make('dt', '', label);
    const dd = make('dd');
    fill(dd, content);
    row.append(dt, dd);
    return row;
  }

  function renderEffective(effective) {
    const section = byId('business-effective');
    const facts = byId('business-effective-facts');
    if (!section || !facts) return;
    if (!effective || typeof effective !== 'object') {
      facts.replaceChildren();
      section.hidden = true;
      return;
    }
    const days = Array.isArray(effective.weekdays)
      ? effective.weekdays.map(Number).filter((d) => d >= 1 && d <= 7).map((d) => DAY_LABELS[d - 1]).join(', ')
      : '';
    const start = minutesToTime(effective.startMinute);
    const end = minutesToTime(effective.endMinute);
    facts.replaceChildren(
      fact('İşletme adı', plain(effective.name)),
      fact('Hizmet', plain(effective.service)),
      fact('Çalışma günleri', days),
      fact('Saatler', start && end ? start + ' – ' + end : ''),
      fact('Randevu süresi', isInteger(effective.durationMinutes) ? effective.durationMinutes + ' dakika' : ''),
      fact('Saat dilimi', plain(effective.timezone))
    );
    section.hidden = false;
  }

  function renderBusiness(data, token) {
    const draft = data.draft && typeof data.draft === 'object' ? data.draft : null;
    if (!draft) throw badResponse();
    state.business = { tenant: token.tenant, data };
    if (!state.busy.business) {
      fillBusinessForm(draft.value);
      clearBusinessErrors();
    }
    renderDraftMeta(draft);
    renderEffective(data.effective);
    return 'ready';
  }

  function clearBusinessErrors() {
    setFieldError(byId('biz-name'), 'biz-name-error', '');
    setFieldError(byId('biz-service'), 'biz-service-error', '');
    setFieldError(byId('biz-weekdays'), 'biz-weekdays-error', '');
    setFieldError(byId('biz-start'), 'biz-hours-error', '');
    setFieldError(byId('biz-end'), 'biz-hours-error', '');
    setFieldError(byId('biz-duration'), 'biz-duration-error', '');
  }

  function readBusinessForm() {
    const invalid = [];
    const fail = (input, errorId, text, focusTarget) => {
      setFieldError(input, errorId, text);
      invalid.push(focusTarget || input);
    };
    clearBusinessErrors();
    const valueOf = (id) => {
      const node = byId(id);
      return node ? String(node.value) : '';
    };
    const name = valueOf('biz-name').trim();
    const service = valueOf('biz-service').trim();
    const policy = valueOf('biz-policy');
    if (!name) fail(byId('biz-name'), 'biz-name-error', 'İşletme adını girin.');
    if (!service) fail(byId('biz-service'), 'biz-service-error', 'Hizmet adını girin.');

    const boxes = weekdayInputs();
    const weekdays = boxes
      .filter((box) => box.checked)
      .map((box) => Number(box.value))
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
      .sort((a, b) => a - b);
    if (weekdays.length === 0) fail(byId('biz-weekdays'), 'biz-weekdays-error', 'En az bir çalışma günü seçin.', boxes[0]);

    const startInput = byId('biz-start');
    const endInput = byId('biz-end');
    const startMinute = parseTime(valueOf('biz-start'));
    const endMinute = parseTime(valueOf('biz-end'));
    let hoursText = '';
    if (startMinute === null || endMinute === null) hoursText = 'Geçerli bir başlangıç ve bitiş saati girin.';
    else if (startMinute >= endMinute) hoursText = 'Bitiş saati başlangıç saatinden sonra olmalı.';
    if (hoursText) {
      setFieldError(startInput, 'biz-hours-error', hoursText);
      setFieldError(endInput, 'biz-hours-error', hoursText);
      invalid.push(startMinute === null || endMinute !== null ? startInput : endInput);
    }

    const durationInput = byId('biz-duration');
    const rawDuration = valueOf('biz-duration').trim();
    const durationMinutes = /^\d{1,4}$/.test(rawDuration) ? Number(rawDuration) : null;
    if (durationMinutes === null || durationMinutes < 5) {
      fail(durationInput, 'biz-duration-error', 'Randevu süresi en az 5 dakikalık bir tam sayı olmalı.');
    } else if (!hoursText && durationMinutes > endMinute - startMinute) {
      fail(durationInput, 'biz-duration-error', 'Randevu süresi çalışma aralığına sığmalı (en fazla ' + (endMinute - startMinute) + ' dakika).');
    }

    if (invalid.length) return { ok: false, focus: invalid[0] };
    return {
      ok: true,
      value: { name, service, policy, timezone: TIMEZONE, weekdays, startMinute, endMinute, durationMinutes }
    };
  }

  function extractDraft(result) {
    if (result && result.draft && typeof result.draft === 'object') return result.draft;
    if (result && isInteger(result.revision)) return result;
    return null;
  }

  async function onBusinessSubmit(event) {
    event.preventDefault();
    const message = byId('business-message');
    if (!isAdmin()) {
      setMessage(message, 'error', MSG.forbidden);
      return;
    }
    if (state.busy.business) return;
    const business = currentBusiness();
    if (!business || !business.draft) {
      setMessage(message, 'error', 'Taslak verisi yüklenmedi; önce yenileyin.');
      return;
    }
    const form = readBusinessForm();
    if (!form.ok) {
      setMessage(message, 'error', 'Formda düzeltilmesi gereken alanlar var.');
      focusNode(form.focus);
      return;
    }
    setHidden('business-reload', true);
    const ctx = beginWrite('business');
    setMessage(message, 'info', 'Kaydediliyor…');
    try {
      const result = await request('POST', tenantPath(ctx.tenant, 'business'), {
        revision: business.draft.revision,
        value: form.value
      });
      if (!isWriteCurrent(ctx)) return;
      const draft = extractDraft(result);
      if (draft) {
        business.draft = draft;
        renderDraftMeta(draft);
      }
      setMessage(message, 'ok', 'Taslak kaydedildi. Etkin akışa uygulanmadı.');
      endWrite('business', ctx);
      if (!draft && state.view === 'business') loadView('business', { afterWrite: true });
    } catch (err) {
      if (!isWriteCurrent(ctx)) return;
      if (err instanceof ApiError && err.status === 409) {
        setMessage(message, 'warn', MSG.stale + ' Yeniden yükleme, formdaki kaydedilmemiş değişiklikleri siler.', err.requestId);
        setHidden('business-reload', false);
      } else {
        showError(message, err);
      }
    } finally {
      endWrite('business', ctx);
    }
  }

  // Kill control

  function renderKillState(data) {
    const node = byId('kill-state');
    if (node) node.replaceChildren(killBadge(data.kill));
    const toggle = byId('kill-toggle');
    if (!toggle) return;
    if (data.kill === true) {
      toggle.textContent = 'Durdurmayı kaldır';
      toggle.classList.remove('button--danger');
    } else {
      toggle.textContent = 'Yeni işlemleri durdur';
      toggle.classList.add('button--danger');
    }
  }

  function newOperationId() {
    try {
      return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null;
    } catch (_) {
      return null;
    }
  }

  function onKillToggle() {
    const message = byId('control-message');
    if (!canControl()) {
      setMessage(message, 'error', MSG.forbidden);
      return;
    }
    if (state.busy.control) {
      setMessage(message, 'info', 'Önceki işlem sürüyor.');
      return;
    }
    if (state.controlStale) {
      setMessage(message, 'warn', MSG.stale);
      return;
    }
    const overview = currentOverview();
    if (!overview || typeof overview.kill !== 'boolean' || !isInteger(overview.revision)) {
      setMessage(message, 'error', 'Güncel durum bilinmiyor; önce yenileyin.');
      return;
    }
    openConfirm({ epoch: state.epoch, tenant: state.tenantId, kill: !overview.kill, revision: overview.revision });
  }

  function openConfirm(intent) {
    const dialog = byId('confirm-dialog');
    if (!dialog) return;
    state.modal = { intent, trigger: byId('kill-toggle') };
    const ok = byId('confirm-ok');
    if (ok) {
      ok.classList.remove(intent.kill ? 'button--primary' : 'button--danger');
      ok.classList.add(intent.kill ? 'button--danger' : 'button--primary');
    }
    if (intent.kill) {
      setText(byId('confirm-title'), 'Yeni iş akışı işlemleri durdurulsun mu?');
      setText(byId('confirm-body'), 'Durdurma, yeni iş akışı işlemlerini engeller. Devam eden bir çağrıyı sonlandırmaz ve sağlayıcı ücretlerini durdurmaz.');
      setText(byId('confirm-ok'), 'Durdur');
    } else {
      setText(byId('confirm-title'), 'Durdurma kaldırılsın mı?');
      setText(byId('confirm-body'), 'Yeni iş akışı işlemleri yeniden kabul edilir.');
      setText(byId('confirm-ok'), 'Durdurmayı kaldır');
    }
    setText(byId('confirm-tenant'), 'İşletme: ' + intent.tenant);
    dialog.hidden = false;
    focusNode(byId('confirm-cancel'));
  }

  function closeConfirm(restoreFocus) {
    const modal = state.modal;
    state.modal = null;
    setHidden('confirm-dialog', true);
    if (restoreFocus && modal) focusNode(modal.trigger);
  }

  function onConfirmOk() {
    const modal = state.modal;
    if (!modal) return;
    closeConfirm(true);
    const message = byId('control-message');
    const intent = modal.intent;
    if (intent.epoch !== state.epoch || intent.tenant !== state.tenantId) {
      setMessage(message, 'warn', 'İşletme değiştiği için işlem gönderilmedi.');
      return;
    }
    const operationId = newOperationId();
    if (!operationId) {
      setMessage(message, 'error', 'Tarayıcı güvenli işlem kimliği üretemedi; işlem gönderilmedi.');
      return;
    }
    sendControl(Object.assign({}, intent, { operationId }));
  }

  function onControlRetry() {
    const op = state.pendingControl;
    if (!op || op.epoch !== state.epoch || op.tenant !== state.tenantId) return;
    sendControl(op);
  }

  async function sendControl(op) {
    const message = byId('control-message');
    if (!canControl()) {
      setMessage(message, 'error', MSG.forbidden);
      return;
    }
    if (state.busy.control) return;
    state.pendingControl = null;
    setHidden('control-reload', true);
    const ctx = beginWrite('control');
    setMessage(message, 'info', op.kill ? 'Durdurma isteği gönderiliyor…' : 'Durdurmayı kaldırma isteği gönderiliyor…');
    try {
      const result = await request('POST', tenantPath(op.tenant, 'control'), {
        kill: op.kill,
        revision: op.revision,
        operationId: op.operationId
      });
      if (!isWriteCurrent(ctx)) return;
      const overview = currentOverview();
      if (overview) {
        if (typeof result.kill === 'boolean') overview.kill = result.kill;
        if (isInteger(result.revision)) overview.revision = result.revision;
        renderKillState(overview);
      }
      const killed = typeof result.kill === 'boolean' ? result.kill : op.kill;
      setMessage(message, 'ok', killed
        ? 'Durdurma etkin. Yeni iş akışı işlemleri engellendi; devam eden çağrılar ve sağlayıcı ücretleri bundan etkilenmez.'
        : 'Durdurma kaldırıldı. Yeni iş akışı işlemleri yeniden kabul ediliyor.');
      endWrite('control', ctx);
      if (state.view === 'control') loadView('control', { afterWrite: true });
    } catch (err) {
      if (!isWriteCurrent(ctx)) return;
      if (err instanceof ApiError && err.status === 409) {
        state.controlStale = true;
        setMessage(message, 'warn', MSG.stale + ' Durumu yenilemeden yeni işlem gönderilemez.', err.requestId);
        setHidden('control-reload', false);
        refreshControls();
        focusNode(byId('control-reload'));
      } else if (isUncertain(err)) {
        state.pendingControl = op;
        const detail = describeError(err);
        setMessage(message, 'warn', 'Sonuç belirsiz: ' + detail.text + ' Önce durumu yenileyin; gerekirse aynı işlemi aynı işlem kimliğiyle yeniden gönderin.', detail.requestId);
        setHidden('control-reload', false);
      } else {
        showError(message, err);
      }
    } finally {
      endWrite('control', ctx);
    }
  }

  function trapTab(event) {
    const dialog = byId('confirm-dialog');
    const focusables = qaIn(dialog, 'button').filter((b) => !b.disabled && !b.hidden);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const inside = Boolean(active && dialog && typeof dialog.contains === 'function' && dialog.contains(active));
    if (event.shiftKey) {
      if (!inside || active === first) {
        event.preventDefault();
        focusNode(last);
      }
    } else if (!inside || active === last) {
      event.preventDefault();
      focusNode(first);
    }
  }

  function onDocumentKeydown(event) {
    if (state.modal) {
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        closeConfirm(true);
      } else if (event.key === 'Tab') {
        trapTab(event);
      }
      return;
    }
    if ((event.key === 'Escape' || event.key === 'Esc') && menuIsOpen()) {
      closeMenu();
      focusNode(byId('menu-toggle'));
    }
  }

  // Tenant, login, logout

  function onTenantChange() {
    const select = byId('tenant-select');
    if (!state.session || !select) return;
    const next = select.value;
    if (!state.session.tenants.some((t) => t.id === next)) {
      select.value = state.tenantId;
      return;
    }
    if (next === state.tenantId) return;
    state.tenantId = next;
    state.loadSeq += 1;
    state.overview = null;
    state.business = null;
    state.controlStale = false;
    state.pendingControl = null;
    state.busy = Object.assign(emptyBusy(), { logout: state.busy.logout });
    closeConfirm(false);
    for (const kind of CONNECTION_KINDS) {
      const input = byId('conn-' + kind);
      if (input) input.value = '';
    }
    clearDataDom();
    clearAllMessages();
    renderRole();
    refreshControls();
    loadView(state.view);
  }

  async function onLoginSubmit(event) {
    event.preventDefault();
    if (state.loginBusy) return;
    const userInput = byId('login-username');
    const passInput = byId('login-password');
    const submit = byId('login-submit');
    const errorNode = byId('login-error');
    const username = userInput ? String(userInput.value).trim() : '';
    const password = passInput ? String(passInput.value) : '';
    if (!username || !password) {
      setText(errorNode, 'Kullanıcı adı ve parolayı girin.');
      focusNode(username ? passInput : userInput);
      return;
    }
    state.loginBusy = true;
    if (submit) submit.disabled = true;
    setText(errorNode, '');
    let stage = 'login';
    try {
      await request('POST', '/api/login', { username, password }, { sessionBound: false });
      if (passInput) passInput.value = '';
      stage = 'session';
      await startSession();
    } catch (err) {
      setText(errorNode, describeLoginError(err, stage));
      focusNode(passInput);
    } finally {
      if (passInput) passInput.value = '';
      state.loginBusy = false;
      if (submit) submit.disabled = false;
    }
  }

  async function onLogout() {
    if (!state.session || state.busy.logout) return;
    const epoch = state.epoch;
    const button = byId('logout-button');
    state.busy.logout = true;
    if (button) button.disabled = true;
    setMessage(byId('global-error'), '', '');
    try {
      await request('POST', '/api/logout', {});
    } catch (err) {
      if (epoch !== state.epoch) return;
      state.busy.logout = false;
      if (button) button.disabled = false;
      const detail = describeError(err);
      setMessage(byId('global-error'), 'error', 'Çıkış tamamlanamadı. ' + detail.text, detail.requestId);
      return;
    }
    if (epoch !== state.epoch) return;
    clearAll();
    showLogin('');
  }

  // Init

  function bindOnce() {
    if (bound) return;
    bound = true;
    on(byId('login-form'), 'submit', onLoginSubmit);
    on(byId('logout-button'), 'click', onLogout);
    on(byId('tenant-select'), 'change', onTenantChange);
    on(byId('menu-toggle'), 'click', toggleMenu);
    for (const button of qa('[data-view]')) {
      on(button, 'click', () => navigate(button.getAttribute('data-view')));
    }
    for (const button of qa('[data-refresh]')) {
      on(button, 'click', () => refreshView(button.getAttribute('data-refresh')));
    }
    for (const button of qa('[data-retry]')) {
      on(button, 'click', () => refreshView(button.getAttribute('data-retry')));
    }
    for (const kind of CONNECTION_KINDS) {
      on(q('[data-connection-form="' + kind + '"]'), 'submit', (event) => onConnectionSubmit(event, kind));
    }
    on(byId('business-form'), 'submit', onBusinessSubmit);
    on(byId('business-reload'), 'click', () => refreshView('business'));
    on(byId('limit-form'), 'submit', onLimitSubmit);
    on(byId('limit-reload'), 'click', () => refreshView('budget'));
    on(byId('kill-toggle'), 'click', onKillToggle);
    on(byId('control-retry'), 'click', onControlRetry);
    on(byId('control-reload'), 'click', () => refreshView('control'));
    on(byId('confirm-ok'), 'click', onConfirmOk);
    on(byId('confirm-cancel'), 'click', () => closeConfirm(true));
    const dialog = byId('confirm-dialog');
    on(dialog, 'click', (event) => {
      if (event.target === dialog) closeConfirm(true);
    });
    document.addEventListener('keydown', onDocumentKeydown);
    if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
      window.addEventListener('hashchange', onHashChange);
    }
  }

  async function boot() {
    bindOnce();
    initRoute();
    refreshControls();
    try {
      await startSession();
    } catch (err) {
      if (state.session) return;
      if (err instanceof ApiError && err.status === 401) showLogin('');
      else showLogin(describeLoginError(err, 'session'));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
