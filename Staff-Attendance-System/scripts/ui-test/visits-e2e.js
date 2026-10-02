/* Real-browser test: several shop visits a day (each GPS + live photo, saved on the server), front/back camera switch,
 * nearest-shop pick, Daily Shop Report / dashboards the same on a second device and for the manager:  node visits-e2e.js */
'use strict';
const puppeteer = require('puppeteer-core');
const { createMock } = require('../frontend-test/mock-server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok ? '' : '  -> ' + JSON.stringify(x))); };
const SHOTS = process.env.SHOTS || require('path').join(require('os').tmpdir(), 'visits-shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const SHP1 = { lat: 9.9382, lng: 78.0878 }, SHP2 = { lat: 9.9354, lng: 78.0918 };   // Ravi's two shops, 50 m radius, ~530 m apart

(async () => {
  const mock = createMock(); await new Promise(r => mock.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + mock.server.address().port + '/';
  const S = mock.state;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', headless: true,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  async function login(user, pw, view, width) {
    const ctx = await browser.createBrowserContext();
    await ctx.overridePermissions(base, ['geolocation', 'camera']);
    const page = await ctx.newPage();
    await page.setViewport(width ? { width, height: 844, isMobile: true, hasTouch: true } : { width: 1366, height: 900 });
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

  // ------------------------------------------------------------------ 1. first shop = check-in, live camera with switch
  console.log('[Shop 1: check-in with the live camera]');
  const a = await login('sales01', 'Sales@123', 'so-dashboard-view', 390);
  await a.setGeolocation({ latitude: SHP1.lat + 0.0002, longitude: SHP1.lng, accuracy: 12 });
  await a.waitForSelector('#so-attendance-status [data-act="in"]:not([disabled])');
  await a.click('#so-attendance-status [data-act="in"]');
  await a.waitForFunction(() => /within range/i.test((document.getElementById('so-att-gps-body') || {}).innerText || ''), { timeout: 15000 });
  check('popup picked Sri Ganesh Stores (where the officer is)', await a.evaluate(() => soAttendanceState.shop.name) === 'Sri Ganesh Stores');
  await a.waitForSelector('#so-att-photo-preview .cam-switch', { timeout: 8000 });
  const before = await a.$eval('#so-att-photo-preview .cam-switch', b => b.textContent);
  await a.click('#so-att-photo-preview .cam-switch'); await sleep(900);
  const after = await a.$eval('#so-att-photo-preview .cam-switch', b => b.textContent).catch(() => '');
  check('attendance camera opens the FRONT camera first; the switch flips to the back one', /Back/.test(before) && /Front/.test(after), { before, after });
  const cam = await a.evaluate(() => { const r = document.getElementById('so-att-photo-preview').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), vw: document.documentElement.clientWidth }; });
  await a.evaluate(() => document.getElementById('so-att-photo-preview').scrollIntoView({ block: 'center' })); await a.screenshot({ path: SHOTS + '/phone-camera.png' });
  check('phone: live camera is full width and big (>= 240 px tall)', cam.w >= cam.vw - 80 && cam.h >= 240, cam);
  await a.evaluate(() => document.querySelector('#so-att-photo-preview .cam-switch').click()); await sleep(1200);   // back to the front camera for the selfie
  await a.click('#so-att-capture-btn'); await sleep(500);
  check('photo captured from the live (front) camera', await a.evaluate(() => !!soAttendanceState.photo && /^data:image\/jpeg/.test(soAttendanceState.photo)));
  await a.click('#so-att-next-btn'); await sleep(1800);
  check('server: attendance + visit 1 (first of day)', S.atts.length === 1 && (S.visits || []).length === 1 && S.visits[0].firstOfDay && S.visits[0].shopName === 'Sri Ganesh Stores', S.visits);
  // an order at shop 1 (does not touch attendance)
  await a.evaluate(() => { openProductSelectModal('Sri Ganesh Stores'); psState[0].selected = true; psState[0].qty = 4; psConfirmOrder(); }); await sleep(1200);
  check('order at shop 1 saved on the server', S.orders.length === 1 && S.orders[0].total === 4 * 149, S.orders);

  // ------------------------------------------------------------------ 2. second shop: Shop visit popup, GPS + photo, saved
  console.log('[Shop 2: another visit, same proof, saved on the server]');
  await a.setGeolocation({ latitude: SHP2.lat + 0.0001, longitude: SHP2.lng, accuracy: 10 });
  await a.evaluate(() => document.getElementById('so-visitsummary-overlay').classList.remove('open'));   // the summary of shop 1
  await a.evaluate(() => { const sh = getMyShopsForOfficer(getOfficerAreaInfo(currentOfficer.name)).find(s => s.name === 'Spartan Capital Enterprises'); openShopVisitFlowForShop(sh.id); });
  await a.waitForFunction(() => /Allowed/.test((document.getElementById('sv-distance-line') || {}).innerText || ''), { timeout: 15000 });
  const svLine = await a.$eval('#sv-distance-line', e => e.innerText);
  check('2nd shop uses the shop\'s own 50 m radius and shows GPS accuracy', /Allowed/.test(svLine) && /GPS ±10 m/.test(svLine), svLine);
  await a.waitForSelector('#sv-photo-preview .cam-switch', { timeout: 8000 });
  check('photo is required again for the 2nd shop', await a.$eval('#sv-present-btn', b => b.disabled));
  await a.click('#sv-capture-btn'); await sleep(400);
  await a.click('#sv-present-btn'); await sleep(3000);
  check('server: 2 visits, still 1 attendance record', S.visits.length === 2 && S.atts.length === 1 && !S.visits[1].firstOfDay && S.visits[1].shopName === 'Spartan Capital Enterprises', S.visits.map(v => v.shopName));
  await a.evaluate(() => SPBridge.refreshToday && SPBridge.refreshToday()); await sleep(800);
  const card = await a.$eval('#so-attendance-status', e => e.innerText);
  const beat = await a.$eval('#so-today-body', e => e.innerText).catch(() => '');
  const beatCount = await a.$eval('#so-today-count', e => e.textContent).catch(() => '');
  check('Today\'s Beat counts both visited shops at once', /^2 of /.test(beatCount) && /Visited\s*2/.test(beat), { beatCount, beat: beat.slice(0, 120) });
  check('My Attendance lists both visits (2)', /Shop visits today \(2\)/.test(card) && /Sri Ganesh Stores/.test(card) && /Spartan Capital/.test(card), card.slice(0, 400));
  await a.screenshot({ path: SHOTS + '/phone-my-attendance.png', fullPage: false });

  // My history lists every shop of the day
  await a.evaluate(() => document.querySelector('#so-attendance-status [data-act="history"]').click()); await sleep(1500);
  const hist = await a.evaluate(() => (document.getElementById('sp-modal-overlay') || document.body).innerText);
  check('My history shows both shops of the day', /2 shops visited/.test(hist) && /Sri Ganesh Stores/.test(hist) && /Spartan Capital/.test(hist), hist.slice(0, 300));
  await a.evaluate(() => { const x = document.querySelector('#sp-modal-overlay .sp-modal-x'); if (x) x.click(); });

  // ------------------------------------------------------------------ 3. the same day on another device
  console.log('[Second device]');
  const b = await login('sales01', 'Sales@123', 'so-dashboard-view');
  await sleep(1500);
  const plan = await b.evaluate(() => (currentOfficer.plannedVisitsList || []).filter(v => v.status === 'Completed').map(v => v.shop));
  check('other device: both shops show as visited', plan.includes('Sri Ganesh Stores') && plan.includes('Spartan Capital Enterprises'), plan);
  await b.evaluate(() => openDailyShopReport()); await sleep(1500);
  const dsr = await b.evaluate(() => document.body.innerText);
  check('other device: Daily Shop Report shows the order value (not 0)', /596/.test(dsr), dsr.match(/Sri Ganesh Stores[^\n]*\n?[^\n]*/) );
  await b.screenshot({ path: SHOTS + '/dsr-other-device.png' });
  // nearest shop: open the check-in popup at shop 2 without picking a shop
  await b.setGeolocation({ latitude: SHP2.lat, longitude: SHP2.lng + 0.0001, accuracy: 8 });
  await b.evaluate(() => { SPBridge.serverShops && null; }); 
  const near = await b.evaluate(async () => {
    const shops = await SPApi.myShops();
    window.__shops = shops;
    return shops.length;
  });
  check('Ravi has 2 server shops', near === 2, near);
  await b.evaluate(() => openSOAttendanceFlow());
  await b.waitForFunction(() => soAttendanceState.distance !== null, { timeout: 15000 });
  const picked = await b.evaluate(() => ({ shop: soAttendanceState.shop.name, d: Math.round(soAttendanceState.distance), ok: soAttendanceState.withinRange }));
  check('standing at shop 2, the check-in popup switches to the nearest shop (distance ~11 m, in range)', picked.shop === 'Spartan Capital Enterprises' && picked.ok && picked.d < 20, picked);
  await b.evaluate(() => { stopLiveCamera('so-att-photo-preview'); document.getElementById('so-attendance-overlay').classList.remove('open'); });

  // ------------------------------------------------------------------ 4. managers
  console.log('[Managers]');
  const k = await login('areasales01', 'Asm@123', 'asm-dashboard-view');
  const kv = await k.evaluate(() => SPApi.visits({}).then(l => l.map(v => v.shopName)));
  check('ASM Karthik sees both of Ravi\'s visits', kv.length === 2, kv);
  const done = await k.evaluate(() => { const o = soOfficers.find(x => x.name === 'Ravi'); return o ? (o.plannedVisitsList || []).filter(v => v.status === 'Completed').length : -1; });
  check('ASM dashboard: Ravi has 2 completed visits today', done === 2, done);
  const arul = await login('areasales02', 'Asm@123', 'asm-dashboard-view');
  check('another ASM sees none of Ravi\'s visits', (await arul.evaluate(() => SPApi.visits({}).then(l => l.length))) === 0);
  const ad = await login('Admin', 'Admin@123', 'supervisor-dashboard-view');
  check('Admin sees all visits', (await ad.evaluate(() => SPApi.visits({}).then(l => l.length))) === 2);
  // Sales Analysis includes the order value
  const sales = await k.evaluate(() => SOLive.data.entries.filter(e => e._order).reduce((t, e) => t + e.soSales * e.unitPrice, 0));
  check('Sales Analysis data includes the booked order (₹596)', sales === 596, sales);

  // ASM fixes a shop's location while standing at it: phone GPS ok, laptop-grade GPS refused
  await k.evaluate(() => document.getElementById('asm2-nav-teamshops').click()); await k.waitForSelector('#ts-list'); await sleep(500);
  const shopId = S.shops.find(x => x.name === 'Spartan Capital Enterprises').id;
  await k.setGeolocation({ latitude: 9.93545, longitude: 78.09185, accuracy: 99 });   // a laptop
  await k.evaluate(id => SOReports.pinHere(id), shopId); await sleep(16500);
  check('laptop GPS (±99 m) cannot move a shop', S.shops.find(x => x.id === shopId).latitude === 9.9354);
  await k.setGeolocation({ latitude: 9.93545, longitude: 78.09185, accuracy: 6 });    // a phone at the shop
  await k.evaluate(id => SOReports.pinHere(id), shopId); await sleep(1500);
  const moved = S.shops.find(x => x.id === shopId);
  check('ASM "Fix location here" with phone GPS saves the shop location', moved.latitude === 9.93545 && moved.longitude === 78.09185, [moved.latitude, moved.longitude]);

  // a phone with Chrome "Desktop site": laid out for the phone, no sideways scroll
  const dctx = await browser.createBrowserContext();
  const dp = await dctx.newPage();
  await dp.setViewport({ width: 980, height: 2122, isMobile: true, hasTouch: true });
  const cdp = await dp.target().createCDPSession();
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 980, height: 2122, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  await dp.setRequestInterception(true);
  dp.on('request', r => { const u = r.url(); return (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
  dp.errors = []; dp.on('pageerror', e => dp.errors.push(e.message));
  await dp.goto(base, { waitUntil: 'domcontentloaded' }); await sleep(600);
  await dp.evaluate(() => { document.getElementById('userid').value = 'Admin'; document.getElementById('password').value = 'Admin@123'; document.getElementById('submit-btn').click(); });
  await dp.waitForSelector('#supervisor-dashboard-view.active', { timeout: 8000 }); await sleep(1500);
  await dp.evaluate(() => supShowSection('staff')); await sleep(900);
  const ds = await dp.evaluate(() => ({ phone: window.SPMobile && SPMobile.phoneWidth(), cls: document.documentElement.className,
    scroll: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, cards: getComputedStyle(document.querySelector('#sp-admin-staff table.sp-table thead')).display }));
  check('Desktop-site phone: phone layout (cards) and no sideways scroll', ds.phone === 390 && ds.cards === 'none' && ds.scroll <= ds.vw + 1, ds);
  await dp.screenshot({ path: SHOTS + '/desktop-site-phone.png', clip: { x: 0, y: 0, width: 980, height: 2122 } });
  await dp.evaluate(() => supShowSection('shops')); await sleep(800);
  await dp.evaluate(() => { const b = document.querySelector('#sp-admin-shops [data-edit]'); if (b) b.click(); }); await sleep(900);
  await dp.screenshot({ path: SHOTS + '/desktop-site-popup.png', clip: { x: 0, y: 0, width: 980, height: 2122 } });
  check('no page errors (desktop-site phone)', !dp.errors.length, dp.errors);

  for (const [p, who] of [[a, 'SO phone'], [b, 'SO 2nd device'], [k, 'ASM'], [arul, 'ASM 2'], [ad, 'Admin']]) check('no page errors (' + who + ')', !p.errors.length, p.errors);
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====\nScreenshots: ' + SHOTS);
  await browser.close(); mock.server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
