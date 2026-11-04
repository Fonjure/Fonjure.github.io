(() => {
  'use strict';
  const DEFAULT_ORIGIN = 'https://couyiju.xyz';
  const DEFAULT_ENTRIES = [
    { id: 'xyz', name: '正式入口', origin: DEFAULT_ORIGIN },
    { id: 'sslip', name: '备用入口一', origin: 'https://couyiju.47-76-72-151.sslip.io' },
    { id: 'hk', name: '备用入口二', origin: 'https://hk.couyiju-fonjure.dns.army' },
  ];
  const DEFAULT_CONFIG = { serverOrigin: DEFAULT_ORIGIN, serverName: '香港服务器', preferredEntry: 'xyz', maintenance: false, maintenanceMessage: '服务器正在维护，请稍后再来。' };
  const byId = (id) => document.getElementById(id);
  const status = byId('server-status'), title = byId('status-title'), message = byId('status-message'), detail = byId('status-detail');
  const gameLink = byId('game-link'), retry = byId('retry-status'), checkedAt = byId('checked-at');
  const metrics = byId('server-metrics');
  const options = byId('entry-options');
  let config = { ...DEFAULT_CONFIG };
  let entries = freshEntries(DEFAULT_ENTRIES);
  let selectedId = entries[0].id;
  let manualId = null;
  let checking = false;

  function serverOrigin(value) {
    if (typeof value !== 'string' || !/^https:\/\/[^\s/?#\\@]+\/?$/i.test(value)) throw new Error('Invalid server origin.');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid server origin.');
    return url.origin;
  }
  function destination(origin) {
    const url = new URL(origin);
    url.pathname = ['/index.html', '/404.html'].includes(location.pathname) ? '/' : location.pathname;
    url.search = location.search;
    url.hash = location.hash;
    return url.href;
  }
  function text(value, fallback) { return typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : fallback; }
  const nonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const latency = (elapsed) => nonnegative(elapsed) ? `${Math.max(1, Math.round(elapsed)).toLocaleString('zh-CN')} ms` : '—';
  function freshEntries(values) { return values.map((entry) => ({ ...entry, state: 'checking', health: null, elapsed: null, maintenanceMessage: '' })); }
  function normalizeEntries(value) {
    const candidates = Array.isArray(value.entries) ? value.entries : [
      { ...DEFAULT_ENTRIES[0], origin: value.serverOrigin || DEFAULT_ORIGIN },
      ...DEFAULT_ENTRIES.slice(1),
    ];
    const valid = [];
    for (const candidate of candidates.slice(0, 8)) {
      try {
        if (!candidate || typeof candidate !== 'object' || !DEFAULT_ENTRIES.some((entry) => entry.id === candidate.id)) continue;
        const origin = serverOrigin(candidate.origin);
        if (valid.some((entry) => entry.id === candidate.id || entry.origin === origin)) continue;
        const fallback = DEFAULT_ENTRIES.find((entry) => entry.id === candidate.id);
        valid.push({ id: candidate.id, name: text(candidate.name, fallback.name).slice(0, 40), origin });
      } catch { /* One invalid entry must not hide another valid entry. */ }
    }
    return valid.length ? valid : DEFAULT_ENTRIES;
  }
  function clearMetrics() {
    if (!metrics) return;
    metrics.hidden = true;
    ['server-memory', 'server-latency', 'server-uptime'].forEach((id) => { byId(id).textContent = '—'; });
  }
  function showMetrics(health, elapsed) {
    if (!metrics) return;
    const bytes = health.memory?.rssBytes;
    byId('server-memory').textContent = nonnegative(bytes) ? `${(bytes / 1024 ** 2).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} MB` : '—';
    byId('server-latency').textContent = latency(elapsed);
    const seconds = health.uptimeSeconds;
    const minutes = nonnegative(seconds) ? Math.floor(seconds / 60) : null;
    byId('server-uptime').textContent = minutes === null ? '—' : minutes < 1 ? '不足 1 分钟' : minutes < 60 ? `${minutes} 分钟`
      : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时` : `${Math.floor(minutes / 1440)} 天 ${Math.floor(minutes / 60) % 24} 小时`;
    metrics.hidden = false;
  }
  function entryEnabled(enabled, entry) {
    if (enabled && entry) {
      gameLink.href = destination(entry.origin);
      gameLink.removeAttribute('aria-disabled');
      gameLink.removeAttribute('tabindex');
      gameLink.textContent = '进入凑一局';
    } else {
      gameLink.removeAttribute('href');
      gameLink.setAttribute('aria-disabled', 'true');
      gameLink.setAttribute('tabindex', '-1');
      gameLink.textContent = '维护中，稍后再来';
    }
  }
  function show(state, heading, mainMessage, explanation) {
    status.dataset.state = state;
    title.textContent = heading;
    message.textContent = mainMessage || '';
    message.hidden = !mainMessage;
    detail.textContent = explanation || '';
    detail.hidden = !explanation;
    status.setAttribute('aria-busy', state === 'checking' ? 'true' : 'false');
  }
  function recommendedEntry() {
    const healthy = entries.filter((entry) => entry.state === 'online');
    return healthy.find((entry) => entry.id === config.preferredEntry) || healthy.sort((a, b) => a.elapsed - b.elapsed)[0] || null;
  }
  function render() {
    const recommended = recommendedEntry();
    if (!entries.some((entry) => entry.id === manualId)) manualId = null;
    if (manualId) selectedId = manualId;
    else if (recommended) selectedId = recommended.id;
    else if (!entries.some((entry) => entry.id === selectedId && entry.state !== 'maintenance')) {
      selectedId = (entries.find((entry) => entry.state !== 'maintenance') || entries[0]).id;
    }
    const selected = entries.find((entry) => entry.id === selectedId) || entries[0];
    for (const fallback of DEFAULT_ENTRIES) {
      const label = options?.querySelector(`[data-entry-id="${fallback.id}"]`);
      const input = options?.querySelector(`input[value="${fallback.id}"]`);
      const entry = entries.find((item) => item.id === fallback.id);
      if (label) label.hidden = !entry;
      if (input) {
        input.disabled = !entry || config.maintenance || entry.state === 'maintenance';
        input.checked = !!entry && selected.id === entry.id;
      }
      if (!entry) continue;
      if (label) {
        label.dataset.state = config.maintenance ? 'maintenance' : entry.state;
        label.classList.toggle('selected', selected.id === entry.id);
      }
      const name = byId(`entry-name-${entry.id}`) || label?.querySelector('.entry-name, .entry-option-heading > strong');
      if (name) name.textContent = entry.name;
      const state = config.maintenance ? 'maintenance' : entry.state;
      const stateLabel = byId(`entry-status-${entry.id}`);
      if (stateLabel) stateLabel.textContent = ({ checking: '检测中…', online: '能连上', unavailable: '暂时不可用', failed: '暂时没连上', maintenance: '维护中' })[state];
      const entryLatency = byId(`entry-latency-${entry.id}`);
      if (entryLatency) entryLatency.textContent = latency(entry.elapsed);
      const badge = byId(`entry-recommend-${entry.id}`);
      if (badge) badge.hidden = config.maintenance || recommended?.id !== entry.id;
    }
    clearMetrics();
    byId('server-name').textContent = config.serverName;
    entryEnabled(!config.maintenance && selected.state !== 'maintenance', selected);
    if (config.maintenance) {
      show('maintenance', '维护中', '我们很快回来', config.maintenanceMessage);
    } else if (selected.state === 'online') {
      show('online', '连接顺畅');
      showMetrics(selected.health, selected.elapsed);
    } else if (selected.state === 'maintenance') {
      show('maintenance', '这个入口维护中', entries.some((entry) => entry.state !== 'maintenance') ? '换个入口试试' : '我们很快回来', selected.maintenanceMessage || '这个入口正在维护，稍后再来。');
    } else if (selected.state === 'checking') {
      show('checking', '正在检测入口');
    } else if (selected.state === 'unavailable') {
      show('unavailable', '这个入口暂不可用', '换个入口试试', '可以选择另一个入口，或稍后重新检测；也可直接尝试进入。');
    } else {
      show('failed', '这个入口暂时没连上', '换个入口试试', '可以手动选择入口尝试访问，或点击“重新检测”。');
    }
  }
  async function readConfig() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(`/site-config.json?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!response.ok) throw new Error('Configuration unavailable.');
      const value = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid configuration.');
      return {
        ...DEFAULT_CONFIG,
        serverName: text(value.serverName, DEFAULT_CONFIG.serverName),
        preferredEntry: DEFAULT_ENTRIES.some((entry) => entry.id === value.preferredEntry) ? value.preferredEntry : DEFAULT_CONFIG.preferredEntry,
        maintenance: value.maintenance === true,
        maintenanceMessage: text(value.maintenanceMessage, DEFAULT_CONFIG.maintenanceMessage),
        entries: normalizeEntries(value),
      };
    } catch { return { ...DEFAULT_CONFIG, entries: DEFAULT_ENTRIES }; }
    finally { clearTimeout(timeout); }
  }
  async function probe(entry) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const started = performance.now();
    try {
      const response = await fetch(`${entry.origin}/health`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors', signal: controller.signal });
      const health = await response.json().catch(() => null);
      entry.elapsed = performance.now() - started;
      if (health?.maintenance === true || health?.status === 'maintenance') {
        entry.state = 'maintenance';
        entry.maintenanceMessage = text(health.maintenanceMessage || health.message, '这个入口正在维护，稍后再来。');
      } else if (!response.ok) {
        entry.state = 'unavailable';
      } else if (health?.service === 'couyiju-server' && health?.protocol === 1 && health?.runtime === 'node') {
        entry.state = ['status', 'database', 'rooms', 'storage'].every((key) => health[key] === 'ok') ? 'online' : 'unavailable';
        if (entry.state === 'online') entry.health = health;
      } else {
        entry.state = 'failed';
      }
    } catch {
      entry.state = 'failed';
      entry.elapsed = null;
    } finally {
      clearTimeout(timeout);
      render();
    }
  }
  async function checkStatus() {
    if (checking) return;
    checking = true;
    retry.hidden = false;
    retry.disabled = true;
    retry.textContent = '检测中';
    entries = freshEntries(entries);
    checkedAt.textContent = '检测中…';
    render();
    try {
      const next = await readConfig();
      config = next;
      entries = freshEntries(next.entries);
      if (!manualId && entries.some((entry) => entry.id === config.preferredEntry)) selectedId = config.preferredEntry;
      render();
      if (!config.maintenance) await Promise.all(entries.map(probe));
    } finally {
      checking = false;
      retry.disabled = false;
      retry.textContent = '重新检测';
      const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date());
      checkedAt.textContent = `${time} 更新`;
      render();
    }
  }
  options?.addEventListener('change', (event) => {
    const input = event.target;
    if (input?.name !== 'game-entry' || input.disabled || !entries.some((entry) => entry.id === input.value)) return;
    manualId = input.value;
    selectedId = input.value;
    render();
  });
  retry.addEventListener('click', checkStatus);
  window.addEventListener('hashchange', render);
  byId('copy-id').addEventListener('click', async () => {
    const account = byId('xiaohongshu-id'), feedback = byId('copy-feedback');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable.');
      await navigator.clipboard.writeText(account.value);
      feedback.textContent = '小红书号已复制';
    } catch {
      account.focus();
      account.select();
      account.setSelectionRange(0, account.value.length);
      feedback.textContent = '已选中小红书号，可长按或手动复制';
    }
  });
  render();
  checkStatus();
})();
