/* Real-browser test of the server-backed dashboards (portal-live.js + the shop / daily-report sync in so-sales.js)
 * against the mock API:  node live-e2e.js   (CHROME_PATH=/path/to/chrome to use an installed browser). */
'use strict';
const puppeteer = require('puppeteer-core');
const { createMock } = require('../frontend-test/mock-server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, x) => { ok ? pass++ : (fail++, failures.push(n)); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok ? '' : '  -> ' + JSON.stringify(x))); };
const SHOTS = process.env.SHOTS || require('path').join(require('os').tmpdir(), 'live-shots');
require('fs').mkdirSync(SHOTS, { recursive: true });

(async () => {
  const mock = createMock(); await new Promise(r => mock.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + mock.server.address().port + '/';
  const S = mock.state;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const month = today.slice(0, 7);
  const id = n => S.users.find(u => u.name === n).id;

  // ---- seed: stock reports (= sales) and targets for this month
  const add = (who, date, product, category, so, dp, price, dpName) => S.stock.push({ id: ++S.seq.stock, officerId: id(who), date, product, category,
    opening: 100, receipt: 0, totalStock: 100, soSales: so, dpSales: dp, totalSales: so + dp, closing: 100 - so - dp, unitPrice: price, dpName });
  add('Ravi', today, 'Almond California (100GM)', 'DRY FRUITS', 10, 5, 200, 'Lalitha Agencies');   // 3,000
  add('Ravi', today, 'Chia Seeds (100GM)', 'SEEDS', 4, 0, 100, 'Lalitha Agencies');                 //   400
  add('Murugan', today, 'Walnut (100GM)', 'DRY FRUITS', 2, 3, 300, 'Theni Traders');               // 1,500
  add('Kumar', today, 'Full Cashew (100GM)', 'DRY FRUITS', 6, 0, 250, 'Chennai DP');               // 1,500
  S.targets.push({ officerId: id('Ravi'), month, amount: 10000, setById: id('Karthik Raja') });
  S.targets.push({ officerId: id('Murugan'), month, amount: 5000, setById: id('Karthik Raja') });
  S.targets.push({ officerId: id('Kumar'), month, amount: 3000, setById: id('Arul Prakash') });
  S.shops.find(s => s.code === 'SHP001').productCategories = 'DRY FRUITS, SEEDS';
  S.shops.find(s => s.code === 'SHP001').phone = '9876543210';

  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || await (require('@sparticuz/chromium').default || require('@sparticuz/chromium')).executablePath(), headless: true, args: ['--no-sandbox'] });
  async function login(user, pw, view, vp, ctx) {
    ctx = ctx || await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.ctx = ctx;
    await page.setViewport(vp || { width: 1366, height: 860 });
    await page.emulateTimezone('Asia/Kolkata');
    await page.setGeolocation({ latitude: 9.9400, longitude: 78.0900, accuracy: 12 });
    await ctx.overridePermissions(base, ['geolocation']);
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      // the PDF / Excel libraries come from a CDN in production; serve local copies so the exports really run
      const lib = /jspdf/.test(u) ? 'jspdf/dist/jspdf.umd.min.js' : (/exceljs/.test(u) ? 'exceljs/dist/exceljs.min.js' : null);
      if (lib) { try { return r.respond({ status: 200, contentType: 'application/javascript', body: require('fs').readFileSync(require.resolve(lib)) }); } catch (e) { return r.abort(); } }
      return (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort();
    });
    page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(base, { waitUntil: 'domcontentloaded' }); await sleep(500);
    await page.type('#userid', user); await page.type('#password', pw); await page.click('#submit-btn');
    await page.waitForSelector('#' + view + '.active', { timeout: 8000 }); await sleep(1500);
    // count downloads (PDF / Excel) instead of saving them
    await page.evaluate(() => { window.__dl = []; const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl.push(this.download); return; } return o.apply(this, arguments); };
      if (window.jspdf) { window.jspdf.jsPDF.API.save = function (n) { window.__dl.push(n); window.__lastPdf = this.output(); return this; }; } });
    return page;
  }
  const noErrors = (p, who) => check('no page errors (' + who + ')', !p.errors.length, p.errors);

  // ===================================================================== 1. SO: shop with mobile, address, categories
  console.log('\n[1. Sales Officer adds a shop: mobile, full address, product categories -> server]');
  let so = await login('sales01', 'Sales@123', 'so-dashboard-view');
  await so.evaluate(() => SOSales.addShop()); await so.waitForSelector('#sos-new-name');
  check('form has mobile, full address and category checkboxes', !!(await so.$('#sos-new-phone')) && !!(await so.$('#sos-new-address')) && (await so.$$('#sos-new-cats input')).length >= 6);
  await so.type('#sos-new-name', 'Meenakshi Dry Fruits');
  await so.type('#sos-new-phone', '9443322110');
  await so.type('#sos-new-address', '12, North Masi Street, Madurai 625001');
  await so.$$eval('#sos-new-cats input', (els) => els.filter(e => /DRY FRUITS|DATES/.test(e.value)).forEach(e => { e.checked = true; }));
  await so.click('#sos-new-save'); await sleep(1500);
  const made = S.shops.find(s => s.name === 'Meenakshi Dry Fruits');
  check('saved on the server with mobile, address and categories, assigned to the SO',
    made && made.phone === '9443322110' && /North Masi/.test(made.address) && made.productCategories === 'DRY FRUITS, DATES VARIETY' && made.assignedOfficerId === id('Ravi'), made);
  await so.evaluate(() => myAreaGo('city')); await sleep(500);
  const card = await so.evaluate(() => { const r = [...document.querySelectorAll('#sos-shop-list .sos-shop')].find(x => /Meenakshi/.test(x.textContent)); return r ? r.textContent : ''; });
  check('My Shops list shows mobile, address and category chips', /9443322110/.test(card) && /North Masi/.test(card) && /Dry Fruits/.test(card) && /Dates Variety/.test(card), card);
  await so.screenshot({ path: SHOTS + '/1-so-myshops.png' });
  await so.evaluate(() => SOReports.exportShops(SOSales.shops(), 'My Shops', 'pdf')); await sleep(300);
  const pdfTxt = await so.evaluate(() => window.__lastPdf || '');
  check('My Shops PDF downloaded and contains mobile + categories', /My-Shops/.test((await so.evaluate(() => window.__dl)).join()) && /9443322110/.test(pdfTxt) && /DRY FRUITS/.test(pdfTxt));
  await so.evaluate(() => SOReports.exportShops(SOSales.shops(), 'My Shops', 'excel')); await sleep(800);
  check('My Shops Excel downloaded', (await so.evaluate(() => window.__dl)).some(n => /My-Shops.*\.xlsx$/.test(n)));

  // ---- offline: the shop waits on the phone and syncs on reconnect
  console.log('\n[1b. Offline shop is cached and auto-synced]');
  await so.evaluate(() => SOSales.addShop()); await so.waitForSelector('#sos-new-name');
  await so.type('#sos-new-name', 'Offline Corner Store'); await so.type('#sos-new-phone', '9000011111');
  await so.setOfflineMode(true);
  await so.click('#sos-new-save'); await sleep(1500);
  const queued = await so.evaluate(() => SOSales.outbox.pending('shop').length);
  check('queued on the phone while offline, not on the server yet', queued === 1 && !S.shops.some(s => s.name === 'Offline Corner Store'), queued);
  await so.evaluate(() => myAreaGo('city')); await sleep(400);
  check('shown in My Shops as "waiting to sync"', /Offline Corner Store[\s\S]*waiting to sync|waiting to sync[\s\S]*Offline/.test(await so.$eval('#sos-shop-list', e => e.textContent.replace(/₹\s+/g, '₹'))));
  await so.setOfflineMode(false);
  await so.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(1500);
  check('synced to the server on reconnect', S.shops.some(s => s.name === 'Offline Corner Store' && s.phone === '9000011111' && s.assignedOfficerId === id('Ravi')));
  check('outbox empty after sync', (await so.evaluate(() => SOSales.outbox.pending().length)) === 0);

  // ===================================================================== 2. Daily Shop Report on the server
  console.log('\n[2. Daily Shop Report is saved on the server, offline-safe, and exports shop details]');
  await so.evaluate(() => { closeMMSection(); openDailyShopReport(); }); await so.waitForSelector('#dsr-h-hq'); await sleep(400);
  const catsCell = await so.evaluate(() => { const tr = document.querySelector('.dsr-main tr[data-shop="Sri Ganesh Stores"]'); return tr ? tr.textContent : ''; });
  check('DSR row shows the shop\'s product categories', /DRY FRUITS, SEEDS/.test(catsCell), catsCell);
  await so.type('#dsr-h-hq', 'Madurai HQ'); await sleep(2200);
  const rep = S.reports.find(r => r.officerId === id('Ravi') && r.date === today);
  check('header typed in the form reaches the server', rep && rep.header.hq === 'Madurai HQ', rep);
  check('sync badge says saved', /Saved to server/.test(await so.$eval('#lv-dsr-sync', e => e.textContent.replace(/₹\s+/g, '₹'))));
  await so.setOfflineMode(true);
  await so.$eval('#dsr-h-beatName', e => { e.value = 'Anna Nagar beat'; e.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(2200);
  check('offline edit is kept on the phone (badge waiting)', /will sync/.test(await so.$eval('#lv-dsr-sync', e => e.textContent.replace(/₹\s+/g, '₹'))) && !S.reports.find(r => r.officerId === id('Ravi')).header.beatName);
  await so.setOfflineMode(false);
  await so.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(1500);
  check('offline edit reaches the server after reconnect', S.reports.find(r => r.officerId === id('Ravi')).header.beatName === 'Anna Nagar beat');
  await so.evaluate(() => exportDailyShopReport('pdf')); await sleep(300);
  const dsrPdf = await so.evaluate(() => window.__lastPdf || '');
  check('DSR PDF has a SHOP DETAILS section with mobile and categories', /SHOP DETAILS/.test(dsrPdf) && /9876543210/.test(dsrPdf) && /DRY FRUITS, SEEDS/.test(dsrPdf));
  await so.evaluate(() => exportDailyShopReport('excel')); await sleep(800);
  check('DSR Excel downloaded', (await so.evaluate(() => window.__dl)).some(n => /Daily-Shop-Report.*\.xlsx$/.test(n)));
  noErrors(so, 'SO');
  // the same report on another device
  const so2 = await login('sales01', 'Sales@123', 'so-dashboard-view');
  await so2.evaluate(() => openDailyShopReport()); await so2.waitForSelector('#dsr-h-hq'); await sleep(600);
  check('another device opens the same report from the server', await so2.$eval('#dsr-h-hq', e => e.value) === 'Madurai HQ' && await so2.$eval('#dsr-h-beatName', e => e.value) === 'Anna Nagar beat');
  await so2.ctx.close();

  // ===================================================================== 3. ASM home
  console.log('\n[3. ASM dashboard shows Team Shops and Targets vs Sales on login]');
  const asm = await login('areasales01', 'Asm@123', 'asm-dashboard-view');
  await asm.waitForSelector('#lv-asm-home table', { timeout: 6000 }); await sleep(500);
  const home = await asm.$eval('#lv-asm-home', e => e.textContent.replace(/₹\s+/g, '₹'));
  check('Targets vs Sales on the dashboard: Ravi ₹3,400 of ₹10,000 (34%)', /Ravi/.test(home) && /₹10,000/.test(home) && /₹3,400/.test(home) && /34%/.test(home), home.slice(0, 300));
  check('Murugan ₹1,500 of ₹5,000 (30%)', /Murugan/.test(home) && /₹5,000/.test(home) && /30%/.test(home));
  check('Team Shops on the dashboard with mobile and categories', /Team Shops/.test(home) && /Sri Ganesh Stores/.test(home) && /9876543210/.test(home) && /Meenakshi Dry Fruits/.test(home));
  check('another ASM\'s officer (Kumar) is not listed', !/Kumar/.test(home));
  await asm.screenshot({ path: SHOTS + '/3-asm-home.png', fullPage: true });
  const perf = await asm.$eval('#asm2-perf-table', e => e.textContent.replace(/₹\s+/g, '₹'));
  check('Sales Officer Performance uses server target/sales (no ₹5,00,000 default)', !/5,00,000/.test(perf) && /10,000/.test(perf), perf);
  noErrors(asm, 'ASM');

  // ===================================================================== 4. Sales Analysis
  console.log('\n[4. Sales Analysis: category-wise and product-wise from real sales]');
  await asm.evaluate(() => showMgrSalesAnalysis('asm')); await sleep(600);
  await asm.evaluate(() => showMgrSalesAnalysis('category')); await sleep(300);
  const cat = await asm.$eval('#mgr-sa-body', e => e.textContent.replace(/₹\s+/g, '₹'));
  check('ASM category share: Dry Fruits ₹4,500, Seeds ₹400 (own team only)', /Dry Fruits/.test(cat) && /₹4,500/.test(cat) && /Seeds/.test(cat) && /₹400/.test(cat) && !/₹6,000/.test(cat), cat);
  await asm.evaluate(() => showMgrSalesAnalysis('product')); await sleep(300);
  const prod = await asm.$eval('#mgr-sa-body', e => e.textContent.replace(/₹\s+/g, '₹'));
  check('ASM product share: Almond ₹3,000, Walnut ₹1,500, Chia ₹400', /Almond California[\s\S]*₹3,000/.test(prod) && /Walnut[\s\S]*₹1,500/.test(prod) && /Chia Seeds[\s\S]*₹400/.test(prod), prod);
  await asm.evaluate(() => showMgrSalesAnalysis('party')); await sleep(300);
  check('party-wise = DP', /Lalitha Agencies/.test(await asm.$eval('#mgr-sa-body', e => e.textContent.replace(/₹\s+/g, '₹'))));
  const kp = await asm.$eval('#mgr-sa-kpis', e => e.textContent.replace(/₹\s+/g, '₹'));
  check('KPI total sales ₹4,900 this month', /₹4,900/.test(kp), kp);
  // a month with no sales
  check('filters: Month, Area, Sales Officer, Category', !!(await asm.$('#mgr-sa-month')) && !!(await asm.$('#mgr-sa-area')) && !!(await asm.$('#mgr-sa-officer')) && !!(await asm.$('#mgr-sa-cat')));
  await asm.select('#mgr-sa-officer', 'Murugan'); await sleep(300);
  check('Sales Officer filter -> Murugan only ₹1,500', /₹1,500/.test(await asm.$eval('#mgr-sa-kpis', e => e.textContent.replace(/₹\s+/g, '₹'))) && !/Lalitha/.test(await asm.$eval('#mgr-sa-body', e => e.textContent.replace(/₹\s+/g, '₹'))));
  await asm.select('#mgr-sa-officer', ''); await asm.select('#mgr-sa-area', 'Theni'); await sleep(300);
  check('Area filter -> Theni ₹1,500', /₹1,500/.test(await asm.$eval('#mgr-sa-kpis', e => e.textContent.replace(/₹\s+/g, '₹'))));
  await asm.select('#mgr-sa-area', ''); await asm.select('#mgr-sa-cat', 'SEEDS'); await sleep(300);
  check('Category filter -> Seeds ₹400', /₹400/.test(await asm.$eval('#mgr-sa-kpis', e => e.textContent.replace(/₹\s+/g, '₹'))) && !/Almond/.test(await asm.$eval('#mgr-sa-body', e => e.textContent.replace(/₹\s+/g, '₹'))));
  await asm.select('#mgr-sa-cat', '');
  const prevMonth = await asm.evaluate(() => { const s = document.getElementById('mgr-sa-month'); const o = [...s.options].find(x => x.value !== s.value); s.value = o.value; s.dispatchEvent(new Event('change')); return o.value; });
  await sleep(300);
  check('another month filters to nothing (' + prevMonth + ')', /₹\s?0\b/.test(await asm.$eval('#mgr-sa-kpis', e => e.textContent.replace(/₹\s+/g, '₹'))), await asm.$eval('#mgr-sa-kpis', e => e.textContent.replace(/₹\s+/g, '₹')));
  await asm.screenshot({ path: SHOTS + '/4-asm-sales-analysis.png' });
  await asm.evaluate(() => closeMgrSalesAnalysis && closeMgrSalesAnalysis());
  await asm.ctx.close();

  // ===================================================================== 5. RM and MM dashboards
  console.log('\n[5. RM and Marketing Manager dashboards: live numbers, no Reports]');
  const rm = await login('regional01', 'password123', 'rm-dashboard-view');
  await sleep(1200);
  const kpis = await rm.$eval('#rm-kpi-grid', e => e.textContent.replace(/₹\s+/g, '₹'));
  check('RM KPIs: today ₹6,400 and target 36% of ₹18,000', /₹6,400/.test(kpis) && /36%/.test(kpis) && /₹18,000/.test(kpis), kpis);
  const asmT = await rm.$eval('#rm-asm-mgmt-table', e => e.textContent.replace(/₹\s+/g, '₹'));
  check('ASM Management: Karthik Raja ₹15,000 target / ₹4,900, Arul Prakash ₹3,000 / ₹1,500 (no ₹8,00,000)', /Karthik Raja[\s\S]*₹15,000[\s\S]*₹4,900/.test(asmT) && /Arul Prakash[\s\S]*₹3,000[\s\S]*₹1,500/.test(asmT) && !/8,00,000/.test(asmT), asmT);
  const prodRm = await rm.$eval('#rm-product-sales-bars', e => e.textContent.replace(/₹\s+/g, '₹'));
  check('Product-wise Sales: Almond ₹3,000, Walnut ₹1,500, Cashew ₹1,500', /Almond California[\s\S]*₹3,000/.test(prodRm) && /Walnut[\s\S]*₹1,500/.test(prodRm) && /Cashew[\s\S]*₹1,500/.test(prodRm), prodRm);
  const reportsVisible = await rm.$$eval('#rm-dashboard-view [onclick]', els => els.filter(e => /Reports\s*$/.test(e.textContent.trim()) && e.offsetParent !== null).map(e => e.textContent.trim()));
  check('RM: stand-alone Reports module hidden', reportsVisible.length === 0, reportsVisible);
  await rm.screenshot({ path: SHOTS + '/5-rm.png', fullPage: true });
  for (const w of [375, 768]) {
    await rm.setViewport({ width: w, height: 800 }); await rm.evaluate(() => openRoleMessages('rm')); await sleep(300);
    const g = await rm.evaluate(() => { const c = document.querySelector('#role-msg-modal-overlay .modal-card'); const b = c.getBoundingClientRect(); return { l: b.left, r: b.right, w: innerWidth, sw: c.scrollWidth, cw: c.clientWidth, doc: document.documentElement.scrollWidth }; });
    check(`RM Messages fit at ${w}px`, g.l >= 0 && g.r <= g.w + 0.5 && g.sw <= g.cw + 1, g);
    if (w === 375) await rm.screenshot({ path: SHOTS + '/5-rm-messages-375.png' });
    await rm.evaluate(() => closeRoleMessages());
  }
  noErrors(rm, 'RM');
  await rm.ctx.close();

  const mm = await login('marketing01', 'password123', 'rsm-dashboard-view');
  await sleep(1200);
  const mmK = await mm.$eval('#mm-chart-kpis', e => e.textContent.replace(/₹\s+/g, '₹'));
  check('MM Sales Overview today ₹6,400 (not demo orders)', /₹6,400/.test(mmK), mmK);
  await mm.evaluate(() => renderMMCharts('category')); await sleep(200);
  const mmCat = await mm.$eval('#mm-chart-share', e => e.textContent.replace(/₹\s+/g, '₹'));
  check('MM Category-wise share: Dry Fruits / Seeds', /Dry Fruits/.test(mmCat) && /Seeds/.test(mmCat), mmCat);
  await mm.evaluate(() => renderMMCharts('product')); await sleep(200);
  check('MM Product-wise share lists Almond / Walnut / Cashew', /Almond/.test(await mm.$eval('#mm-chart-share', e => e.textContent.replace(/₹\s+/g, '₹'))) && /Cashew/.test(await mm.$eval('#mm-chart-share', e => e.textContent.replace(/₹\s+/g, '₹'))));
  const top = await mm.$eval('#mm-top-officers', e => e.textContent.replace(/₹\s+/g, '₹'));
  check('MM top officers from real sales: Ravi ₹3,400 first', /^\s*1\s*Ravi[\s\S]*₹3,400/.test(top), top);
  const mmReports = await mm.$$eval('#rsm-dashboard-view [onclick]', els => els.filter(e => /^Reports/.test(e.textContent.trim()) && e.offsetParent !== null).length);
  check('MM: Reports module hidden', mmReports === 0, mmReports);
  await mm.screenshot({ path: SHOTS + '/5-mm.png', fullPage: true });
  await mm.setViewport({ width: 375, height: 800 }); await mm.evaluate(() => openRoleMessages('mm')); await sleep(300);
  const gm = await mm.evaluate(() => { const c = document.querySelector('#role-msg-modal-overlay .modal-card'); const b = c.getBoundingClientRect(); return { l: b.left, r: b.right, w: innerWidth, sw: c.scrollWidth, cw: c.clientWidth }; });
  check('MM Messages fit at 375px', gm.l >= 0 && gm.r <= gm.w + 0.5 && gm.sw <= gm.cw + 1, gm);
  noErrors(mm, 'MM');
  await mm.ctx.close();

  // ===================================================================== 6. Admin console
  console.log('\n[6. Admin: role -> list of people -> that person\'s dashboard]');
  const ad = await login('Admin', 'Admin@123', 'supervisor-dashboard-view');
  await ad.evaluate(() => goToASMAsSupervisor()); await ad.waitForSelector('#lv-pick-list .lv-person'); await sleep(200);
  const names = await ad.$$eval('#lv-pick-list .lv-person b', b => b.map(x => x.textContent));
  check('ASM card lists both active ASMs, opens nobody', names.join() === 'Arul Prakash,Karthik Raja' && await ad.$eval('#supervisor-dashboard-view', e => e.classList.contains('active')), names);
  await ad.screenshot({ path: SHOTS + '/6-admin-picker.png' });
  await ad.evaluate(() => [...document.querySelectorAll('#lv-pick-list .lv-person')].find(b => /Arul/.test(b.textContent)).click());
  await ad.waitForSelector('#asm-dashboard-view.active'); await ad.waitForSelector('#lv-asm-home table'); await sleep(500);
  const arul = await ad.$eval('#lv-asm-home', e => e.textContent.replace(/₹\s+/g, '₹'));
  check('Arul Prakash\'s dashboard shows only his team (Kumar, ₹1,500 of ₹3,000)', /Kumar/.test(arul) && /₹3,000/.test(arul) && !/Ravi/.test(arul), arul.slice(0, 300));
  check('banner says who is being viewed', /Arul Prakash/.test(await ad.$eval('#lv-view-banner', e => e.textContent.replace(/₹\s+/g, '₹'))));
  await ad.evaluate(() => SOLive.exitView()); await sleep(400);
  check('Back to Admin returns to the console, still signed in', await ad.$eval('#supervisor-dashboard-view', e => e.classList.contains('active')) && await ad.evaluate(() => SPApi.isLoggedIn()));
  await ad.evaluate(() => goToSOAsSupervisor()); await ad.waitForSelector('#lv-pick-list .lv-person'); await sleep(200);
  await ad.evaluate(() => [...document.querySelectorAll('#lv-pick-list .lv-person')].find(b => /Murugan/.test(b.textContent)).click()); await sleep(800);
  check('picked Sales Officer opens (Murugan)', /Murugan/.test(await ad.$eval('#so-logged-name', e => e.textContent.replace(/₹\s+/g, '₹'))));
  await ad.evaluate(() => SOLive.exitView()); await sleep(300);
  await ad.evaluate(() => goToRMAsSupervisor()); await ad.waitForSelector('#lv-pick-list .lv-person'); await sleep(200);
  await ad.evaluate(() => document.querySelector('#lv-pick-list .lv-person').click()); await sleep(800);
  check('picked RM dashboard shows that RM\'s name and live product sales', /Suresh Babu/.test(await ad.$eval('#rm-logged-name', e => e.textContent.replace(/₹\s+/g, '₹'))) && /₹3,000/.test(await ad.$eval('#rm-product-sales-bars', e => e.textContent.replace(/₹\s+/g, '₹'))));
  noErrors(ad, 'Admin');

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  if (fail) console.log('Failed:\n - ' + failures.join('\n - '));
  console.log('Screenshots: ' + SHOTS);
  await browser.close(); mock.server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST HARNESS ERROR:', e); process.exit(2); });
