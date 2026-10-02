/* Real-browser test of server orders, "whole team" shops and order != attendance (so-orders.js) against the mock API:
 *   node orders-e2e.js */
'use strict';
const puppeteer = require('puppeteer-core');
const { createMock } = require('../frontend-test/mock-server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok ? '' : '  -> ' + JSON.stringify(x))); };
const SHOTS = process.env.SHOTS || require('path').join(require('os').tmpdir(), 'orders-shots');
require('fs').mkdirSync(SHOTS, { recursive: true });

(async () => {
  const mock = createMock(); await new Promise(r => mock.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + mock.server.address().port + '/';
  const S = mock.state;
  const id = n => S.users.find(u => u.name === n).id;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox'] });
  async function login(user, pw, view, width) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(width ? { width, height: 844, isMobile: true, hasTouch: true } : { width: 1366, height: 860 });
    await page.emulateTimezone('Asia/Kolkata');
    await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); return (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
    page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(base, { waitUntil: 'domcontentloaded' }); await sleep(500);
    await page.type('#userid', user); await page.type('#password', pw); await page.click('#submit-btn');
    await page.waitForSelector('#' + view + '.active', { timeout: 8000 }); await sleep(1800);
    return page;
  }

  // ------------------------------------------------------------------ 1. ASM adds a "whole team" shop
  console.log('[Whole-team shop]');
  const k = await login('areasales01', 'Asm@123', 'asm-dashboard-view');
  check('ASM menu has Team Orders', !!(await k.$('#asm2-nav-teamorders')));
  await k.evaluate(() => document.getElementById('asm2-nav-teamshops').click()); await k.waitForSelector('#ts-officer'); await sleep(300);
  const opts = await k.$$eval('#ts-officer option', os => os.map(o => o.value));
  check('Sales Officer picker offers "Whole team"', opts.includes('__team'), opts);
  await k.type('#ts-name', 'Karthik Team Mart');
  await k.select('#ts-officer', '__team');
  await k.evaluate(() => { document.getElementById('ts-loc').value = '9.93, 78.12'; });
  await k.click('#ts-save'); await sleep(900);
  const ts = S.shops.find(x => x.name === 'Karthik Team Mart');
  check('whole-team shop saved with no single officer, created by the ASM', ts && ts.assignedOfficerId == null && ts.createdById === id('Karthik Raja'), ts);
  const listTxt = await k.$eval('#ts-list', e => e.textContent);
  check('Team Shops list shows it as "Whole team"', /Karthik Team Mart/.test(listTxt) && /Whole team/.test(listTxt));

  // ------------------------------------------------------------------ 2. Visibility of the team shop
  console.log('[Who sees the team shop]');
  const ravi = await login('sales01', 'Sales@123', 'so-dashboard-view');
  const raviShops = await ravi.evaluate(() => SOSales.shops().map(s => s.name));
  check('Ravi (Karthik\'s SO) sees the whole-team shop', raviShops.includes('Karthik Team Mart'), raviShops);
  const kumar = await login('sales03', 'Sales@123', 'so-dashboard-view');
  const kumarShops = await kumar.evaluate(() => SOSales.shops().map(s => s.name));
  check('Kumar (another ASM\'s SO) does NOT see it', !kumarShops.includes('Karthik Team Mart'), kumarShops);
  const arul = await login('areasales02', 'Asm@123', 'asm-dashboard-view');
  const arulShops = await arul.evaluate(() => SPApi.teamShops().then(l => l.map(s => s.name)));
  check('Arul (another ASM) does NOT see it', !arulShops.includes('Karthik Team Mart'), arulShops);
  const adm0 = await login('Admin', 'Admin@123', 'supervisor-dashboard-view');
  const admShops = await adm0.evaluate(() => SPApi.adminShops({ includeInactive: 'true' }).then(l => l.map(s => s.name)));
  check('Admin sees it', admShops.includes('Karthik Team Mart'));

  // ------------------------------------------------------------------ 3. SO confirms an order: saved on the server, no attendance
  console.log('[Order -> server, not attendance]');
  const shopName = await ravi.evaluate(() => (currentOfficer.plannedVisitsList || [])[0] && currentOfficer.plannedVisitsList[0].shop);
  check('Ravi has a shop on today\'s beat', !!shopName, shopName);
  const before = await ravi.evaluate((sn) => { const v = currentOfficer.plannedVisitsList.find(x => x.shop === sn); return { status: v.status, login: v.loginTime || null, offLogin: currentOfficer.loginTime || null }; }, shopName);
  await ravi.evaluate((sn) => {
    openProductSelectModal(sn);
    psState[0].selected = true; psState[0].qty = 3;
    psState[2].selected = true; psState[2].qty = 2;
    psConfirmOrder();
  }, shopName);
  await sleep(1200);
  const o = S.orders[0];
  check('order saved on the server', S.orders.length === 1 && o.officerId === id('Ravi') && o.shopName === shopName && o.itemCount === 2, S.orders);
  check('order total = qty x price', o && o.total === 3 * 149 + 2 * 74, o && o.total);
  const after = await ravi.evaluate((sn) => { const v = currentOfficer.plannedVisitsList.find(x => x.shop === sn); return { status: v.status, login: v.loginTime || null, offLogin: currentOfficer.loginTime || null, os: v.orderStatus }; }, shopName);
  check('confirming the order did NOT complete the visit / stamp a login time', after.status === before.status && after.login === before.login && after.offLogin === before.offLogin && after.os === 'Order Verified', { before, after });
  check('no attendance record was created by the order', !S.atts.some(a => a.userId === id('Ravi')));
  // confirm again for the same shop today -> same order updated, not duplicated
  await ravi.evaluate((sn) => { openProductSelectModal(sn); psState[1].selected = true; psState[1].qty = 1; psConfirmOrder(); }, shopName); await sleep(900);
  check('re-confirming the same shop today updates the one order', S.orders.length === 1 && S.orders[0].itemCount === 1, S.orders.map(x => x.itemCount));

  // ------------------------------------------------------------------ 4. ASM / other ASM / Admin see it
  console.log('[Managers and Admin see the order]');
  await k.evaluate(() => SOSales.refresh()); await sleep(900);
  const home = await k.$eval('#ord-asm-home', e => e.textContent).catch(() => '');
  check('Karthik\'s dashboard shows "Orders today (1"', /Orders today \(1/.test(home), home.slice(0, 120));
  await k.evaluate(() => document.getElementById('asm2-nav-teamorders').click()); await sleep(1200);
  const kt = await k.$eval('#ord-team', e => e.textContent);
  check('Karthik\'s Team Orders lists Ravi\'s order', /Ravi/.test(kt) && kt.indexOf(shopName) >= 0, kt.slice(0, 200));
  await k.screenshot({ path: SHOTS + '/asm-team-orders.png' });
  const arulOrders = await arul.evaluate(() => SPApi.orders({}).then(l => l.length));
  check('Arul (other ASM) sees none of Karthik\'s orders', arulOrders === 0, arulOrders);
  await adm0.evaluate(() => supShowSection('orders')); await sleep(1200);
  const at = await adm0.$eval('#sp-admin-orders', e => e.textContent);
  check('Admin "Orders" section lists the order with its ASM', /Ravi/.test(at) && /ASM: Karthik Raja/.test(at), at.slice(0, 200));
  await adm0.screenshot({ path: SHOTS + '/admin-orders.png' });

  // ------------------------------------------------------------------ 4b. RM, Marketing Manager, Owner
  console.log('[RM / Marketing Manager / Owner]');
  const orderText = async (p) => { await sleep(1300); return p.evaluate(() => { const b = document.getElementById('ord-team'); const o = document.getElementById('mm-section-modal-overlay');
    return { txt: b ? b.textContent : '', open: !!(o && o.classList.contains('open')), title: (document.getElementById('mm-section-title') || {}).textContent }; }); };
  const rm = await login('regional01', 'password123', 'rm-dashboard-view');
  await rm.evaluate(() => [...document.querySelectorAll('#rm-dashboard-view .rmx-nav-item')].find(a => /Orders/.test(a.textContent)).click());
  let r = await orderText(rm);
  check('RM "Orders" menu opens the server orders of the RM\'s tree', r.open && /Ravi/.test(r.txt) && r.txt.indexOf(shopName) >= 0, r);
  await rm.screenshot({ path: SHOTS + '/rm-orders.png' });
  const mm = await login('marketing01', 'password123', 'rsm-dashboard-view');
  check('Marketing Manager menu has Orders', !!(await mm.$('#rsm-nav-orders')));
  await mm.evaluate(() => document.getElementById('rsm-nav-orders').click());
  r = await orderText(mm);
  check('Marketing Manager sees the order', r.open && /Ravi/.test(r.txt), r);
  const ow = await login('owner01', 'password123', 'dashboard-view');
  check('Owner nav has Orders', !!(await ow.$('#owner-nav-orders')));
  await ow.evaluate(() => document.getElementById('owner-nav-orders').click());
  r = await orderText(ow);
  check('Owner sees all orders ("All Orders")', r.open && /Ravi/.test(r.txt) && /All Orders/.test(r.title), r);
  await ow.screenshot({ path: SHOTS + '/owner-orders.png' });
  const owp = await login('owner01', 'password123', 'dashboard-view', 390);
  check('Owner phone tab bar has Orders', !!(await owp.$('#owner-mtab-orders')));
  await owp.evaluate(() => document.getElementById('owner-mtab-orders').click());
  r = await orderText(owp);
  check('Owner phone: Orders opens and fits the screen', r.open && /Ravi/.test(r.txt) && await owp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), r);
  await owp.screenshot({ path: SHOTS + '/owner-phone-orders.png' });
  const mmp = await login('marketing01', 'password123', 'rsm-dashboard-view', 390);
  const mmMore = await mmp.evaluate(() => { const bar = document.querySelector('.rtabbar[data-role="rsm"]'); const m = bar && [...bar.querySelectorAll('.mtab')].pop(); if (m) m.click(); return new Promise(res => setTimeout(() => res(document.querySelector('.rsheet-body') ? document.querySelector('.rsheet-body').textContent : ''), 400)); });
  check('Marketing Manager phone: Orders in the More menu', /Orders/.test(mmMore), mmMore);
  for (const [p, who] of [[rm, 'RM'], [mm, 'Marketing Manager'], [ow, 'Owner'], [owp, 'Owner phone'], [mmp, 'MM phone']]) check('no page errors (' + who + ')', !p.errors.length, p.errors);

  // ------------------------------------------------------------------ 5. phone layout
  console.log('[Phone]');
  const ap = await login('Admin', 'Admin@123', 'supervisor-dashboard-view', 390);
  for (const sec of ['staff', 'shops', 'orders', 'audit']) {
    await ap.evaluate(s => supShowSection(s), sec); await sleep(900);
    const w = await ap.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    check('Admin ' + sec + ': no sideways scroll on a phone', w[0] <= w[1], w);
    await ap.screenshot({ path: SHOTS + '/phone-admin-' + sec + '.png', fullPage: true });
  }
  const tallest = await ap.evaluate(() => { supShowSection('staff'); return new Promise(r => setTimeout(() => r(Math.max(...[...document.querySelectorAll('#sp-admin-staff table.sp-table tr')].map(t => t.getBoundingClientRect().height))), 600)); });
  check('Staff rows are compact cards on a phone (< 420 px each)', tallest < 420, tallest);
  const labelled = await ap.evaluate(() => [...document.querySelectorAll('#sp-admin-staff table.sp-table td')].filter(td => td.hasAttribute('data-l')).length);
  check('Staff table cells carry their column names', labelled > 10, labelled);
  const more = await ap.evaluate(() => { const bar = document.querySelector('.rtabbar[data-role="sup"]'); const m = bar && [...bar.querySelectorAll('.mtab')].pop(); if (m) m.click(); return new Promise(r => setTimeout(() => r(document.querySelector('.rsheet-body') ? document.querySelector('.rsheet-body').textContent : ''), 400)); });
  check('"Orders" is reachable from the phone More menu', /Orders/.test(more), more);

  for (const [p, who] of [[k, 'ASM Karthik'], [ravi, 'SO Ravi'], [kumar, 'SO Kumar'], [arul, 'ASM Arul'], [adm0, 'Admin'], [ap, 'Admin phone']]) check('no page errors (' + who + ')', !p.errors.length, p.errors);
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====\nScreenshots: ' + SHOTS);
  await browser.close(); mock.server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
