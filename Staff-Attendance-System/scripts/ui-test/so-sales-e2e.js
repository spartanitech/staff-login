/* Real-browser test of the Sales Officer / ASM features backed by the new APIs (team shops, DP names, daily stock,
 * targets, graphs, responsive messages) against the mock API.  Run:  npm install && node so-sales-e2e.js
 * (set CHROME_PATH to use an installed Chrome/Chromium instead of @sparticuz/chromium). */
'use strict';
const puppeteer = require('puppeteer-core');
const { createMock } = require('../frontend-test/mock-server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok ? '' : '  -> ' + JSON.stringify(x))); };
const SHOTS = process.env.SHOTS || require('path').join(require('os').tmpdir(), 'so-sales-shots');
require('fs').mkdirSync(SHOTS, { recursive: true });

(async () => {
  const mock = createMock(); await new Promise(r => mock.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + mock.server.address().port + '/';
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || await (require('@sparticuz/chromium').default || require('@sparticuz/chromium')).executablePath(), headless: true, args: ['--no-sandbox'] });
  async function login(user, pw, view, vp) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(vp || { width: 1366, height: 800 });
    await page.emulateTimezone('Asia/Kolkata');
    await page.setRequestInterception(true);
    page.on('request', r => (r.url().startsWith(base) || r.url().startsWith('data:')) ? r.continue() : r.abort());
    page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
    page.on('dialog', d => d.type() === 'prompt' ? d.accept(page.nextPrompt || '') : d.accept());
    await page.goto(base, { waitUntil: 'domcontentloaded' }); await sleep(500);
    await page.type('#userid', user); await page.type('#password', pw); await page.click('#submit-btn');
    await page.waitForSelector('#' + view + '.active', { timeout: 8000 }); await sleep(800);
    return page;
  }
  const today = await (async () => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()); return p; })();
  const yest = new Date(today + 'T00:00:00Z'); yest.setUTCDate(yest.getUTCDate() - 1); const yIso = yest.toISOString().slice(0, 10);

  // ---------------- ASM adds a Chennai shop for Kumar and sets his target
  console.log('\n[ASM: Team Shops & Targets]');
  let asm = await login('areasales02', 'Asm@123', 'asm-dashboard-view');
  check('Team Shops nav item added', !!(await asm.$('#asm2-nav-teamshops')));
  await asm.click('#asm2-nav-teamshops'); await asm.waitForSelector('#ts-name', { timeout: 5000 }); await sleep(300);
  const opts = await asm.$$eval('#ts-officer option', os => os.map(o => o.textContent));
  check('officer dropdown lists only my team (Kumar)', opts.some(t => /Kumar/.test(t)) && !opts.some(t => /Ravi/.test(t)), opts);
  await asm.type('#ts-name', 'Chennai Fresh Mart');
  await asm.select('#ts-officer', String(mock.state.users.find(u => u.name === 'Kumar').id));
  check('city auto-filled from officer', await asm.$eval('#ts-city', e => e.value) === 'Chennai');
  await asm.click('#ts-save'); await sleep(400);
  check('location required', /location/i.test(await asm.$eval('#ts-msg', e => e.textContent)));
  await asm.type('#ts-loc', '13.0500, 80.2500'); await asm.type('#ts-locality', 'Anna Nagar');
  await asm.click('#ts-save'); await sleep(700);
  check('shop created on server for Kumar', mock.state.shops.some(s => s.name === 'Chennai Fresh Mart' && s.city === 'Chennai'));
  check('list shows both team shops', (await asm.$$eval('#ts-list tbody tr', r => r.length)) === 2);
  await asm.screenshot({ path: SHOTS + '/asm-team-shops.png', fullPage: false });
  await asm.evaluate(() => SOReports.openTeam('targets')); await asm.waitForSelector('input[id^="tt-"]', { timeout: 5000 });
  const kid = mock.state.users.find(u => u.name === 'Kumar').id;
  await asm.$eval('#tt-' + kid, e => { e.value = '100000'; });
  await asm.evaluate(id => SOReports.saveTarget(id), kid); await sleep(700);
  check('target saved', mock.state.targets.some(t => t.officerId === kid && t.amount === 100000));
  check('no page errors (ASM)', !asm.errors.length, asm.errors);

  // ---------------- Sales Officer
  console.log('\n[Sales Officer]');
  let so = await login('sales03', 'Sales@123', 'so-dashboard-view');
  await sleep(600);
  const shops = await so.evaluate(() => getMyShopsForOfficer(getOfficerAreaInfo(currentOfficer.name)).map(s => s.name));
  check('SO sees only ASM shops', JSON.stringify(shops.sort()) === JSON.stringify(['Chennai Fresh Mart', 'Kaveri Mart']), shops);
  const demoLeft = await so.evaluate(() => Object.values(areaShopMap).reduce((t, a) => t + a.shops.length, 0));
  check('no hard-coded demo shops left', demoLeft === 0, demoLeft);
  await so.evaluate(() => myAreaGo('city')); await sleep(400);
  check('My Area shows My Shops with search', !!(await so.$('#sos-shop-search')));
  check('My Area lists 2 shops', (await so.$$eval('#sos-shop-list .sos-shop', r => r.length)) === 2);
  await so.type('#sos-shop-search', 'fresh'); await sleep(200);
  const hits = await so.$$eval('#sos-shop-list .sos-shop-name', r => r.map(x => x.textContent));
  check('search by name filters', hits.length === 1 && hits[0] === 'Chennai Fresh Mart', hits);
  await so.screenshot({ path: SHOTS + '/so-my-area.png' });
  await so.evaluate(() => myAreaGo('regions')); await sleep(300);
  check('SO add-shop box removed', !(await so.$('#so-my-newshop-name')));

  // Daily shop report
  await so.evaluate(() => openDailyShopReport()); await sleep(500);
  const dsrShops = await so.$$eval('.dsr-main tbody tr[data-shop]', r => r.map(x => x.getAttribute('data-shop')));
  check('DSR shows only ASM shops', dsrShops.length === 2 && dsrShops.includes('Chennai Fresh Mart'), dsrShops);
  check('DP Name is a dropdown', await so.$eval('#dsr-h-dpName', e => e.tagName) === 'SELECT');
  so.nextPrompt = 'Lalitha Office';
  await so.select('#dsr-h-dpName', '__new'); await sleep(600);
  check('new DP added and selected', await so.$eval('#dsr-h-dpName', e => e.value) === 'Lalitha Office' && mock.state.dp.length === 1);
  await so.type('#dsr-shop-search', 'kav'); await sleep(200);
  const vis = await so.$$eval('.dsr-main tbody tr[data-shop]', r => r.filter(x => x.style.display !== 'none').length);
  check('DSR shop search filters rows', vis === 1, vis);
  await so.keyboard.press('Enter'); await sleep(300);
  check('picking a shop selects it', await so.$eval('#dsr-shop-search', e => e.value) === 'Kaveri Mart');
  await so.screenshot({ path: SHOTS + '/so-dsr.png' });

  // Weekly stock report: yesterday then today
  await so.evaluate(() => openSOWeeklyReport()); await so.waitForSelector('#wsr2-date', { timeout: 5000 });
  check('Dry Fruits first, 8 products', (await so.$eval('.wsr2-table', t => t.tBodies[0].rows.length)) === 8 && /DRY FRUITS/.test(await so.$eval('.wsr2-cat.on', e => e.textContent)));
  const heads = await so.$eval('.wsr2-table', t => [...t.tHead.rows[0].cells].map(x => x.textContent));
  check('columns No/Product/Opening/Receipt/Total Stock/SO Sales/DP Sales/Total Sales/Closing', heads.join('|') === 'No.|Product|Opening|Receipt|Total Stock|SO Sales|DP Sales|Total Sales|Closing', heads);
  await so.evaluate(v => SOReports.wsrDate(v), yIso); await so.waitForSelector('.wsr2-table input'); await sleep(300);
  const P = 'Almond California (100GM)';
  const setv = async (f, v) => { await so.$eval(`.wsr2-table input[data-p="${P}"][data-f="${f}"]`, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, String(v)); };
  await setv('opening', 100); await setv('receipt', 50); await setv('soSales', 20); await setv('dpSales', 10);
  const closing = await so.$eval(`[data-closing="${P}"]`, e => e.textContent);
  check('closing auto = 100+50-20-10 = 120', closing === '120', closing);
  await so.click('#wsr2-save'); await sleep(700);
  check('day 1 saved on server', mock.state.stock.some(e => e.date === yIso && e.closing === 120));
  await so.evaluate(v => SOReports.wsrDate(v), today); await sleep(700);
  const open2 = await so.$eval(`tr[data-row="${P}"] td[data-l="Opening"]`, e => e.textContent.trim());
  const editable = await so.$(`.wsr2-table input[data-p="${P}"][data-f="opening"]`);
  check('next day opening = 120 automatically (not editable)', open2 === '120' && !editable, { open2 });
  await setv('receipt', 0); await setv('soSales', 30); await setv('dpSales', 5);
  await so.click('#wsr2-save'); await sleep(700);
  check('day 2 closing 85', mock.state.stock.some(e => e.date === today && e.product === P && e.opening === 120 && e.closing === 85));
  await so.screenshot({ path: SHOTS + '/so-wsr.png' });
  // edit day 1 -> day 2 re-flows
  await so.evaluate(v => SOReports.wsrDate(v), yIso); await sleep(600);
  await setv('receipt', 60); await so.click('#wsr2-save'); await sleep(700);
  const d2 = mock.state.stock.find(e => e.date === today && e.product === P);
  check('editing an earlier day re-flows next day opening (130 -> 95)', d2.opening === 130 && d2.closing === 95, d2);

  // Performance
  await so.evaluate(() => { closeMMSection(); });
  await so.evaluate(() => showSOTargetsOnly()); await sleep(900);
  const kpis = await so.$$eval('#sos-perf .sos-kpi-v', k => k.map(x => x.textContent));
  check('target from ASM shown (₹1,00,000)', kpis[0] === '₹1,00,000', kpis);
  check('4 charts rendered', (await so.$$eval('#sos-perf svg', s => s.length)) === 4);
  await (await so.$('#so-mytargets-card')).screenshot({ path: SHOTS + '/so-targets.png' });
  check('no page errors (SO)', !so.errors.length, so.errors);

  // Messages responsive on phone
  console.log('\n[Messages responsive]');
  for (const vp of [{ width: 375, height: 740 }, { width: 800, height: 1000 }, { width: 1366, height: 800 }]) {
    await so.setViewport(vp); await so.evaluate(() => openRoleMessages('so')); await sleep(300);
    const g = await so.evaluate(() => {
      const c = document.querySelector('#role-msg-modal-overlay .modal-card').getBoundingClientRect();
      return { l: c.left, r: c.right, w: innerWidth, sw: document.querySelector('#role-msg-modal-overlay .modal-card').scrollWidth, cw: document.querySelector('#role-msg-modal-overlay .modal-card').clientWidth };
    });
    check(`messages fit at ${vp.width}px`, g.l >= 0 && g.r <= g.w + 0.5 && g.sw <= g.cw + 1, g);
    if (vp.width === 375) await so.screenshot({ path: SHOTS + '/so-messages-phone.png' });
    await so.evaluate(() => closeRoleMessages());
  }
  // phone stock report
  await so.setViewport({ width: 375, height: 740 });
  await so.evaluate(() => openSOWeeklyReport()); await so.waitForSelector('.wsr2-table', { timeout: 5000 }); await sleep(400);
  const ov = await so.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  check('stock report no horizontal page scroll on phone', ov);
  await so.screenshot({ path: SHOTS + '/so-wsr-phone.png' });

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); mock.server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
