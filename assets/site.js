(() => {
  'use strict';
  const DEFAULT_ORIGIN = 'https://hk.couyiju-fonjure.dns.army';
  const DEFAULT_CONFIG = { serverOrigin: DEFAULT_ORIGIN, serverName: '香港服务器', maintenance: false, maintenanceMessage: '服务器正在维护，请稍后再来。' };
  const byId = (id) => document.getElementById(id);
  const status = byId('server-status'), title = byId('status-title'), message = byId('status-message'), detail = byId('status-detail');
  const gameLink = byId('game-link'), retry = byId('retry-status'), checkedAt = byId('checked-at');
  let checking = false;
  let currentOrigin = DEFAULT_ORIGIN;

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
  function entryEnabled(enabled, origin = DEFAULT_ORIGIN) {
    if (enabled) {
      gameLink.href = destination(origin);
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
    message.textContent = mainMessage;
    detail.textContent = explanation;
    status.setAttribute('aria-busy', state === 'checking' ? 'true' : 'false');
  }
  async function readConfig(signal) {
    const config = { ...DEFAULT_CONFIG };
    const response = await fetch(`/site-config.json?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal });
    if (!response.ok) throw new Error('Configuration unavailable.');
    const value = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid configuration.');
    config.serverOrigin = serverOrigin(value.serverOrigin || DEFAULT_ORIGIN);
    config.serverName = text(value.serverName, config.serverName);
    config.maintenance = value.maintenance === true;
    config.maintenanceMessage = text(value.maintenanceMessage, config.maintenanceMessage);
    return config;
  }
  async function checkStatus() {
    if (checking) return;
    checking = true;
    retry.hidden = false;
    retry.disabled = true;
    retry.textContent = '检测中';
    checkedAt.textContent = '点击后才会前往游戏';
    show('checking', '正在检查', '稍等一下', '正在确认最新服务器的连接状态。');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const config = await readConfig(controller.signal);
      currentOrigin = config.serverOrigin;
      byId('server-name').textContent = config.serverName;
      entryEnabled(!config.maintenance, config.serverOrigin);
      if (config.maintenance) {
        show('maintenance', '维护中', '我们很快回来', config.maintenanceMessage);
        return;
      }
      const response = await fetch(`${config.serverOrigin}/health`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors', signal: controller.signal });
      const health = await response.json().catch(() => null);
      if (health?.maintenance === true || health?.status === 'maintenance') {
        entryEnabled(false);
        show('maintenance', '维护中', '我们很快回来', text(health.maintenanceMessage || health.message, '服务器正在维护，请稍后再来。'));
      } else if (!response.ok) {
        show('unavailable', '服务暂不可用', '稍后再来试试', '服务器暂时没有正常响应。你可以稍后重新检测，或尝试进入游戏。');
      } else if (health?.service === 'couyiju-server' && health?.protocol === 1 && health?.runtime === 'node') {
        if (['status', 'database', 'rooms', 'storage'].every((key) => health[key] === 'ok')) {
          show('online', '服务器运行正常', '可以开一局了', '叫上朋友，点击下方入口一起玩。');
        } else {
          show('unavailable', '服务暂不可用', '稍后再来试试', '服务器暂时没有恢复正常，请稍后重新检测。');
        }
      } else {
        throw new Error('Unrecognized server response.');
      }
    } catch {
      entryEnabled(true, currentOrigin);
      show('failed', '连接失败', '请连接梯子', '无法从当前网络确认服务器状态，仍可点击下方入口尝试访问。');
    } finally {
      clearTimeout(timeout);
      checking = false;
      retry.disabled = false;
      retry.textContent = '重新检测';
      const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date());
      checkedAt.textContent = `${time} 更新 · 点击后才会前往游戏`;
    }
  }
  entryEnabled(true);
  retry.addEventListener('click', checkStatus);
  window.addEventListener('hashchange', () => {
    if (gameLink.hasAttribute('href')) gameLink.href = destination(new URL(gameLink.href).origin);
  });
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
  checkStatus();
})();
