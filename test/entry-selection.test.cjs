const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, expect } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');

// Run against a local copy only. Every request to an external origin is intercepted.
const ROOT = path.resolve(__dirname, '..');
const PRIMARY = { id: 'xyz', name: '正式入口', origin: 'https://couyiju.xyz' };
const ENTRIES = [
  { id: 'sslip', name: '备用入口一', origin: 'https://couyiju.47-76-72-151.sslip.io' },
  { id: 'hk', name: '备用入口二', origin: 'https://hk.couyiju-fonjure.dns.army' },
];
const ALL_ENTRIES = [PRIMARY, ...ENTRIES];
const HEALTH = {
  service: 'couyiju-server', protocol: 1, runtime: 'node',
  status: 'ok', storage: 'ok', database: 'ok', rooms: 'ok',
  memory: { rssBytes: 80 * 1024 ** 2 }, uptimeSeconds: 3600,
};
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let server, base, browser;

before(async () => {
  server = http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      const absolute = path.resolve(ROOT, relative);
      if (path.relative(ROOT, absolute).startsWith('..') || relative.startsWith('.git')) {
        response.writeHead(403).end();
        return;
      }
      let bytes;
      try { bytes = await fs.readFile(absolute); }
      catch {
        if (path.extname(relative)) { response.writeHead(404).end(); return; }
        relative = '404.html';
        bytes = await fs.readFile(path.join(ROOT, relative));
      }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg' };
      response.writeHead(200, { 'Content-Type': `${types[path.extname(relative)] || 'application/octet-stream'}; charset=utf-8` });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(500).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

async function openPortal(options = {}) {
  const config = {
    serverOrigin: PRIMARY.origin, serverName: '香港服务器', preferredEntry: PRIMARY.id,
    entries: ALL_ENTRIES.map((entry) => ({ ...entry })), maintenance: false,
    maintenanceMessage: '正在做一次短暂维护。', ...options.config,
  };
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1280, height: 900 },
    javaScriptEnabled: options.javaScriptEnabled !== false,
  });
  const calls = [], unexpected = [], writes = [], errors = [];
  const counts = new Map();
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      writes.push(request.method() + ' ' + request.url());
      await route.abort('blockedbyclient');
      return;
    }
    if (url.origin === base && url.pathname === '/site-config.json') {
      await route.fulfill({ status: options.configFailure ? 503 : 200, contentType: 'application/json', body: JSON.stringify(config) });
      return;
    }
    if (url.origin === base) { await route.continue(); return; }
    if (url.pathname !== '/health') {
      unexpected.push(request.url());
      await route.abort('blockedbyclient');
      return;
    }
    const entry = config.entries.find((item) => item.origin === url.origin) || ALL_ENTRIES.find((item) => item.origin === url.origin);
    if (!entry) {
      unexpected.push(request.url());
      await route.abort('blockedbyclient');
      return;
    }
    const count = (counts.get(entry.id) || 0) + 1;
    counts.set(entry.id, count);
    calls.push({ id: entry.id, origin: url.origin, headers: request.headers() });
    const result = options.health?.(entry.id, count) || {};
    if (result.mode === 'hang') return;
    if (result.delay) await sleep(result.delay);
    try {
      if (result.mode === 'abort') await route.abort('failed');
      else await route.fulfill({
        status: result.status || 200, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': base },
        body: JSON.stringify(result.body || HEALTH),
      });
    } catch (error) {
      // A timeout, page close, or a new run may have cancelled this intercepted request.
      if (!/closed|handled|disposed|Invalid InterceptionId/i.test(error.message)) throw error;
    }
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + (options.path || '/'), { waitUntil: 'domcontentloaded' });
  return {
    context, page, calls, unexpected, writes, errors,
    async close() {
      await context.close();
      assert.deepEqual(writes, [], 'the portal must never call a mutating endpoint');
      assert.deepEqual(unexpected, [], 'no requests may escape the controlled public health endpoints');
      assert.deepEqual(errors, [], 'the portal must not throw an uncaught browser error');
    },
  };
}

const radio = (page, id) => page.locator(`input[name="game-entry"][value="${id}"]`);
const recommended = (page, id) => page.locator(`#entry-recommend-${id}`);
const gameLink = (page) => page.locator('#game-link');
const done = async (page) => {
  await expect(page.locator('#retry-status')).toBeEnabled({ timeout: 10000 });
  await expect(page.locator('#retry-status')).not.toHaveText(/检测中|检查中/);
};
const linkOrigin = async (page) => new URL(await gameLink(page).getAttribute('href')).origin;

test('the formal entry is selected before detection finishes', async () => {
  const portal = await openPortal({ health: () => ({ mode: 'hang' }) });
  try {
    await expect(radio(portal.page, 'xyz')).toBeChecked();
    assert.equal(await linkOrigin(portal.page), PRIMARY.origin);
    await expect(recommended(portal.page, 'xyz')).toBeHidden();
    await expect(portal.page.locator('#status-message')).toBeHidden();
    await expect(portal.page.locator('#status-detail')).toBeHidden();
    await expect(portal.page.locator('#checked-at')).toHaveText('检测中…');
  } finally { await portal.close(); }
});

test('a healthy formal entry stays preferred even when both backups respond faster', async () => {
  const portal = await openPortal({ health: (id) => ({ delay: id === 'xyz' ? 400 : id === 'sslip' ? 30 : 90 }) });
  try {
    await done(portal.page);
    await expect(radio(portal.page, 'xyz')).toBeChecked();
    await expect(recommended(portal.page, 'xyz')).toBeVisible();
    for (const { id } of ENTRIES) await expect(recommended(portal.page, id)).toBeHidden();
    assert.equal(await linkOrigin(portal.page), PRIMARY.origin);
    const timing = await portal.page.locator('#entry-latency-xyz').innerText();
    assert.ok(Number(timing.replace(/[^\d.]/g, '')) >= 300, 'the preferred entry must not merely be the fastest reply');
  } finally { await portal.close(); }
});

test('a failed formal entry falls back to the faster healthy backup', async () => {
  const portal = await openPortal({ health: (id) => id === 'xyz' ? { mode: 'abort' } : { delay: id === 'sslip' ? 250 : 40 } });
  try {
    await done(portal.page);
    await expect(radio(portal.page, 'hk')).toBeChecked();
    await expect(recommended(portal.page, 'hk')).toBeVisible();
    await expect(recommended(portal.page, 'xyz')).toBeHidden();
    assert.equal(await linkOrigin(portal.page), ENTRIES[1].origin);
  } finally { await portal.close(); }
});

test('maintenance at the formal entry leaves both backups available', async () => {
  const portal = await openPortal({ health: (id) => id === 'xyz'
    ? { status: 503, body: { maintenance: true, status: 'maintenance' } }
    : { delay: id === 'sslip' ? 35 : 120 } });
  try {
    await done(portal.page);
    await expect(radio(portal.page, 'xyz')).toBeDisabled();
    for (const { id } of ENTRIES) await expect(radio(portal.page, id)).toBeEnabled();
    await expect(radio(portal.page, 'sslip')).toBeChecked();
    await expect(recommended(portal.page, 'sslip')).toBeVisible();
    assert.equal(await linkOrigin(portal.page), ENTRIES[0].origin);
  } finally { await portal.close(); }
});

test('a manual backup choice is not replaced when the formal entry becomes healthy', async () => {
  const portal = await openPortal({ health: (id) => ({ delay: id === 'xyz' ? 450 : 120 }) });
  try {
    await radio(portal.page, 'hk').check();
    await done(portal.page);
    await expect(recommended(portal.page, 'xyz')).toBeVisible();
    await expect(radio(portal.page, 'hk')).toBeChecked();
    assert.equal(await linkOrigin(portal.page), ENTRIES[1].origin);
  } finally { await portal.close(); }
});

test('a healthy backup is usable while the formal entry is still timing out', { timeout: 15000 }, async () => {
  const portal = await openPortal({ health: (id) => id === 'xyz' ? { mode: 'hang' } : { delay: id === 'sslip' ? 45 : 150 } });
  try {
    await expect(radio(portal.page, 'sslip')).toBeChecked({ timeout: 2000 });
    await expect(recommended(portal.page, 'sslip')).toBeVisible();
    assert.equal(await linkOrigin(portal.page), ENTRIES[0].origin);
    await expect(gameLink(portal.page)).not.toHaveAttribute('aria-disabled', 'true');
    await done(portal.page);
    await expect(radio(portal.page, 'sslip')).toBeChecked();
  } finally { await portal.close(); }
});

test('a fast healthy entry is selected while the other entry is still timing out', { timeout: 15000 }, async () => {
  const started = Date.now();
  const portal = await openPortal({ config: { entries: ENTRIES }, health: (id) => id === 'sslip' ? { mode: 'hang' } : { delay: 60 } });
  try {
    await expect(radio(portal.page, 'hk')).toBeChecked({ timeout: 2000 });
    assert.ok(Date.now() - started < 2500, 'a successful health response must enable the chosen entry promptly');
    assert.equal(await linkOrigin(portal.page), ENTRIES[1].origin);
    await expect(gameLink(portal.page)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(recommended(portal.page, 'hk')).toBeVisible();
    await done(portal.page);
    await expect(radio(portal.page, 'hk')).toBeChecked();
    await expect(recommended(portal.page, 'sslip')).toBeHidden();
  } finally { await portal.close(); }
});

test('two healthy entries recommend and select the lower measured latency', async () => {
  const portal = await openPortal({ config: { entries: ENTRIES }, health: (id) => ({ delay: id === 'sslip' ? 320 : 60 }) });
  try {
    await done(portal.page);
    await expect(radio(portal.page, 'hk')).toBeChecked();
    await expect(recommended(portal.page, 'hk')).toBeVisible();
    await expect(recommended(portal.page, 'sslip')).toBeHidden();
    const latencies = await Promise.all(ENTRIES.map(async ({ id }) => Number((await portal.page.locator(`#entry-latency-${id}`).innerText()).replace(/[^\d.]/g, ''))));
    assert.ok(latencies[0] > latencies[1] && latencies[1] > 0, 'the visible timing must agree with the recommended entry');
    assert.equal(await linkOrigin(portal.page), ENTRIES[1].origin);
    for (const call of portal.calls) {
      assert.equal(call.headers.authorization, undefined);
      assert.equal(call.headers.cookie, undefined);
    }
  } finally { await portal.close(); }
});

test('a manual choice during detection survives later automatic results', async () => {
  const portal = await openPortal({ config: { entries: ENTRIES }, health: (id) => ({ delay: id === 'sslip' ? 180 : 550 }) });
  try {
    await radio(portal.page, 'hk').check();
    await done(portal.page);
    await expect(recommended(portal.page, 'sslip')).toBeVisible();
    await expect(radio(portal.page, 'hk')).toBeChecked();
    assert.equal(await linkOrigin(portal.page), ENTRIES[1].origin);
  } finally { await portal.close(); }
});

test('a retry clears obsolete recommendations and picks the newly faster entry', async () => {
  const portal = await openPortal({ config: { entries: ENTRIES }, health: (id, count) => ({ delay: count === 1 ? (id === 'sslip' ? 40 : 180) : (id === 'sslip' ? 450 : 220) }) });
  try {
    await done(portal.page);
    await expect(recommended(portal.page, 'sslip')).toBeVisible();
    await portal.page.locator('#retry-status').click();
    await expect(recommended(portal.page, 'sslip')).toBeHidden();
    await expect(recommended(portal.page, 'hk')).toBeHidden();
    await expect(portal.page.locator('#entry-latency-sslip')).not.toHaveText(/\d+\s*ms/);
    await done(portal.page);
    await expect(recommended(portal.page, 'hk')).toBeVisible();
    await expect(radio(portal.page, 'hk')).toBeChecked();
    assert.equal(await linkOrigin(portal.page), ENTRIES[1].origin);
    assert.deepEqual([...new Set(portal.calls.map((call) => call.id))].sort(), ['hk', 'sslip']);
    assert.equal(portal.calls.length, 4);
  } finally { await portal.close(); }
});

test('maintenance at one entry leaves the other entry usable', async () => {
  const portal = await openPortal({ config: { entries: ENTRIES }, health: (id) => id === 'sslip'
    ? { status: 503, body: { status: 'maintenance', maintenance: true }, delay: 20 }
    : { delay: 100 } });
  try {
    await done(portal.page);
    await expect(radio(portal.page, 'hk')).toBeEnabled();
    await expect(radio(portal.page, 'hk')).toBeChecked();
    await expect(gameLink(portal.page)).not.toHaveAttribute('aria-disabled', 'true');
    assert.equal(await linkOrigin(portal.page), ENTRIES[1].origin);
    await expect(portal.page.locator('#entry-status-sslip')).toContainText('维护');
  } finally { await portal.close(); }
});

test('global maintenance disables all choices and skips health requests', async () => {
  const portal = await openPortal({ config: { maintenance: true } });
  try {
    await expect(gameLink(portal.page)).toHaveAttribute('aria-disabled', 'true');
    assert.equal(await gameLink(portal.page).getAttribute('href'), null);
    for (const { id } of ALL_ENTRIES) await expect(radio(portal.page, id)).toBeDisabled();
    assert.deepEqual(portal.calls, []);
    await expect(portal.page.locator('#status-detail')).toBeVisible();
    await expect(portal.page.locator('#status-detail')).toHaveText('正在做一次短暂维护。');
  } finally { await portal.close(); }
});

test('failed checks retain manual entry choices without claiming a proxy is required', async () => {
  const portal = await openPortal({ health: () => ({ mode: 'abort' }) });
  try {
    await done(portal.page);
    await expect(portal.page.locator('#server-status')).not.toContainText('梯子');
    await expect(portal.page.locator('#status-detail')).toBeVisible();
    await expect(portal.page.locator('#status-detail')).toContainText('手动选择入口');
    for (const { id } of ALL_ENTRIES) {
      await expect(radio(portal.page, id)).toBeEnabled();
      await expect(recommended(portal.page, id)).toBeHidden();
      await radio(portal.page, id).check();
      assert.equal(await linkOrigin(portal.page), ALL_ENTRIES.find((entry) => entry.id === id).origin);
    }
    await expect(gameLink(portal.page)).not.toHaveAttribute('aria-disabled', 'true');
  } finally { await portal.close(); }
});

for (const invalidOrigin of [
  'javascript:alert(1)', 'http://evil.invalid', 'https://user:secret@evil.invalid',
  'https://evil.invalid/steal', 'https://evil.invalid?next=1', 'https://evil.invalid#fragment',
]) {
  test(`an invalid entry origin cannot disable or divert the healthy entry: ${invalidOrigin}`, async () => {
    const portal = await openPortal({
      config: { entries: [{ ...ENTRIES[0], origin: invalidOrigin }, { ...ENTRIES[1] }] },
      health: (id) => id === 'hk' ? { delay: 40 } : { mode: 'abort' },
    });
    try {
      await expect(radio(portal.page, 'hk')).toBeChecked({ timeout: 2000 });
      assert.equal(await linkOrigin(portal.page), ENTRIES[1].origin);
      assert.ok(portal.calls.every((call) => ENTRIES.some((entry) => entry.origin === call.origin)));
    } finally { await portal.close(); }
  });
}

test('trusted configuration may supply a future valid HTTPS entry', async () => {
  const newOrigin = 'https://play.example.test';
  const portal = await openPortal({
    config: { entries: [{ ...ENTRIES[0], origin: newOrigin }, { ...ENTRIES[1] }] },
    health: (id) => ({ delay: id === 'sslip' ? 25 : 120 }),
  });
  try {
    await done(portal.page);
    assert.equal(await linkOrigin(portal.page), newOrigin);
    assert.ok(portal.calls.some((call) => call.origin === newOrigin));
  } finally { await portal.close(); }
});

test('configuration failure uses all three built-in entries and prefers the formal entry', async () => {
  const portal = await openPortal({ configFailure: true, health: (id) => ({ delay: id === 'sslip' ? 25 : 100 }) });
  try {
    await done(portal.page);
    for (const { id } of ALL_ENTRIES) await expect(radio(portal.page, id)).toBeVisible();
    assert.deepEqual([...new Set(portal.calls.map((call) => call.origin))].sort(), ALL_ENTRIES.map((entry) => entry.origin).sort());
    assert.equal(await linkOrigin(portal.page), PRIMARY.origin);
  } finally { await portal.close(); }
});

test('entry switching and hash changes retain invitation data without following next URLs', async () => {
  const invite = '/rooms/ABCD?room=ABC123&next=https%3A%2F%2Fevil.invalid%2Fsteal#join=ABC123';
  const portal = await openPortal({ path: invite });
  try {
    await done(portal.page);
    const expected = new URL(invite, base);
    for (const entry of ALL_ENTRIES) {
      await radio(portal.page, entry.id).check();
      const actual = new URL(await gameLink(portal.page).getAttribute('href'));
      assert.equal(actual.origin, entry.origin);
      assert.equal(actual.pathname, expected.pathname);
      assert.equal(actual.search, expected.search);
      assert.equal(actual.hash, expected.hash);
    }
    await portal.page.evaluate(() => { location.hash = '#join=ZZZ999&next=https://evil.invalid/'; });
    await expect(gameLink(portal.page)).toHaveAttribute('href', /#join=ZZZ999&next=https:\/\/evil\.invalid\/$/);
    const changed = new URL(await gameLink(portal.page).getAttribute('href'));
    assert.equal(changed.origin, ENTRIES[1].origin);
    assert.equal(changed.pathname, expected.pathname);
    assert.equal(changed.search, expected.search);
  } finally { await portal.close(); }
});

for (const filename of ['index.html', '404.html']) {
  test(`${filename} keeps invitation parameters while normalizing the game path`, async () => {
    const portal = await openPortal({ path: `/${filename}?room=ABC123#join` });
    try {
      await done(portal.page);
      const target = new URL(await gameLink(portal.page).getAttribute('href'));
      assert.equal(target.pathname, '/');
      assert.equal(target.search, '?room=ABC123');
      assert.equal(target.hash, '#join');
    } finally { await portal.close(); }
  });
}

for (const width of [320, 375, 850, 1280, 3840]) {
  test(`all three entries remain usable without horizontal overflow at ${width}px`, async () => {
    const portal = await openPortal({ viewport: { width, height: 1000 } });
    try {
      await done(portal.page);
      await expect(portal.page.locator('.eyebrow, .entry-selection-hint')).toHaveCount(0);
      await expect(portal.page.locator('#status-message')).toBeHidden();
      await expect(portal.page.locator('#status-detail')).toBeHidden();
      await expect(portal.page.locator('#checked-at')).toHaveText(/^\d{2}:\d{2} 更新$/);
      const copy = await portal.page.locator('body').innerText();
      assert.doesNotMatch(copy, /一起玩点有意思的|可以开一局了|已连上，叫上朋友一起玩|帮你挑条快的，也能自己选|正式入口优先，备用入口也能自己选|点击后才会前往游戏/);
      const statusBox = await portal.page.locator('#server-status').boundingBox();
      const entryBox = await portal.page.locator('#entry-options').boundingBox();
      assert.ok(statusBox.height < 40 && entryBox.y - statusBox.y - statusBox.height <= 22, 'a healthy status must not leave an empty headline area above the entries');
      const dimensions = await portal.page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        html: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      assert.ok(dimensions.html <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1, JSON.stringify(dimensions));
      for (const { id } of ALL_ENTRIES) {
        await expect(radio(portal.page, id)).toBeVisible();
        await radio(portal.page, id).check();
      }
      const box = await gameLink(portal.page).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, 'the main entry button must fit within the viewport');
    } finally { await portal.close(); }
  });
}

test('without JavaScript all three static game entry links remain available', async () => {
  const portal = await openPortal({ javaScriptEnabled: false, viewport: { width: 375, height: 900 } });
  try {
    const hrefs = await portal.page.locator('a[href]').evaluateAll((links) => links.map((link) => link.href));
    for (const { origin } of ALL_ENTRIES) {
      assert.ok(hrefs.some((href) => new URL(href).origin === origin), `missing no-JavaScript link for ${origin}`);
    }
    assert.deepEqual(portal.calls, []);
    assert.equal(portal.page.url(), base + '/');
  } finally { await portal.close(); }
});
