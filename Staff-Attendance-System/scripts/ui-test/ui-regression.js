/* Real Chromium regression tests. Run:  npm install && npm test
 * (uses @sparticuz/chromium, which bundles a headless Chromium - no browser install needed). */
'use strict';
const chromium = require('@sparticuz/chromium').default || require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const { createMock } = require('../frontend-test/mock-server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '  -> ' + JSON.stringify(extra))); };

async function boot(viewport, user = 'Admin', pw = 'Admin@123', viewId = 'supervisor-dashboard-view') {
  const mock = createMock(); await new Promise(r => mock.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + mock.server.address().port + '/';
  const browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: 'shell', defaultViewport: viewport });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', r => (r.url().startsWith(base) || r.url().startsWith('data:')) ? r.continue() : r.abort());   // no internet in CI
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let navs = 0; page.on('framenavigated', f => { if (f === page.mainFrame()) navs++; });
  await page.goto(base, { waitUntil: 'domcontentloaded' }); await sleep(600);
  await page.type('#userid', user); await page.type('#password', pw); await page.click('#submit-btn');
  await page.waitForSelector('#' + viewId + '.active', { timeout: 8000 }); await sleep(500);
  return { mock, browser, page, errors, navs: () => navs, close: async () => { await browser.close(); mock.server.close(); } };
}
const modalOpen = page => page.evaluate(() => !!document.querySelector('#sp-modal-overlay.open'));

(async () => {
  console.log('\n[Add staff form in a real browser]');
  let t = await boot({ width: 1366, height: 768 }); let page = t.page;
  page.on('dialog', d => d.accept());   // auto-accept native confirm() dialogs (Delete, Deactivate, etc.)
  await page.evaluate(() => supShowSection('staff')); await page.waitForSelector('#sp-s-add'); await sleep(200);
  await page.click('#sp-s-add'); await sleep(300);
  const geom = await page.evaluate(() => { const r = document.querySelector('#sp-modal-overlay .sp-modal-card').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, w: innerWidth, h: innerHeight }; });
  check('form is fully inside the screen (nothing hangs outside)', geom.top >= 0 && geom.bottom <= geom.h, geom);
  check('new staff defaults to Sales Officer, not Admin', await page.$eval('#sp-u-role', e => e.value) === 'SO');
  await page.type('#sp-u-name', 'Test Officer'); await page.type('#sp-u-username', 'test.officer');
  await page.type('#sp-u-pass', 'Secret#123'); await page.type('#sp-u-pass2', 'Secret#123');
  // press inside a field, drag out over the dark backdrop, release  (what used to close the form and lose everything)
  const box = await (await page.$('#sp-u-name')).boundingBox();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x - 150, box.y + box.height / 2, { steps: 5 }); await page.mouse.up(); await sleep(200);
  check('selecting text and releasing outside the card does NOT close the form', await modalOpen(page));
  check('what was typed is still there', await page.$eval('#sp-u-name', e => e.value) === 'Test Officer');
  await page.mouse.click(30, 400); await sleep(200);
  check('a plain click on the backdrop does not throw away a half-filled form either', await modalOpen(page));
  await page.click('#sp-u-save'); await sleep(1000);
  check('Create account works, form closes, list refreshes (10 rows), still signed in',
    !(await modalOpen(page)) && (await page.$$eval('#sp-s-table tbody tr', r => r.length)) === 10 &&
    await page.evaluate(() => document.getElementById('supervisor-dashboard-view').classList.contains('active')));
  check('no page reload happened while adding staff', t.navs() === 1, t.navs());
  await page.click('#sp-s-add'); await sleep(200); await page.keyboard.press('Escape'); await sleep(150);
  check('Esc still closes the form', !(await modalOpen(page)));

  console.log('\n[Delete a staff account]');
  const beforeDeleteRows = await page.$$eval('#sp-s-table tbody tr', r => r.length);
  const delUserBtn = await page.evaluateHandle(() => [...document.querySelectorAll('#sp-s-table [data-delete]')]
      .find(b => b.closest('tr').textContent.includes('test.officer')));
  await delUserBtn.asElement().click(); await sleep(500);
  check('deleting a staff account removes their row (native confirm accepted)',
    (await page.$$eval('#sp-s-table tbody tr', r => r.length)) === beforeDeleteRows - 1 &&
    !(await page.evaluate(() => document.body.textContent.includes('test.officer'))));

  check('no script errors', t.errors.length === 0, t.errors);
  await t.close();

  console.log('\n[Read-only popups keep the easy backdrop close]');
  t = await boot({ width: 1366, height: 768 }, 'owner01', 'password123', 'dashboard-view'); page = t.page;
  await page.waitForSelector('[data-sp-att="owner"] [data-act="history"]'); await page.click('[data-sp-att="owner"] [data-act="history"]'); await sleep(500);
  check('history popup opens', await modalOpen(page));
  await page.mouse.click(20, 400); await sleep(200);
  check('a deliberate click on the backdrop closes it', !(await modalOpen(page)));
  await t.close();

  console.log('\n[Phone-sized screen]');
  t = await boot({ width: 390, height: 844, isMobile: true, hasTouch: true }); page = t.page;
  await page.evaluate(() => supShowSection('staff')); await page.waitForSelector('#sp-s-add'); await page.evaluate(() => document.getElementById('sp-s-add').click()); await sleep(300);
  const g2 = await page.evaluate(() => { const r = document.querySelector('#sp-modal-overlay .sp-modal-card').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight }; });
  check('form fits a phone screen', g2.l >= 0 && g2.r <= g2.w && g2.t >= 0 && g2.b <= g2.h, g2);
  await t.close();

  console.log('\n[Sales Officer: shop attendance in a real browser (GPS + live/upload photo, backend-assigned shop)]');
  {
    const path = require('path');
    const photoPath = path.join(__dirname, 'fixtures', 'shop-photo.jpg');
    const SHOP = { lat: 9.9382, lng: 78.0878 };   // SHP001 Sri Ganesh Stores, radius 50 m
    const mock = createMock(); await new Promise(r => mock.server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + mock.server.address().port + '/';
    const browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: 'shell', defaultViewport: { width: 1366, height: 900 } });
    await browser.defaultBrowserContext().overridePermissions(base, ['geolocation']);
    const pg = await browser.newPage();
    await pg.setRequestInterception(true);
    pg.on('request', r => (r.url().startsWith(base) || r.url().startsWith('data:')) ? r.continue() : r.abort());
    const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(base, { waitUntil: 'domcontentloaded' }); await sleep(600);
    await pg.type('#userid', 'sales01'); await pg.type('#password', 'Sales@123'); await pg.click('#submit-btn');
    await pg.waitForSelector('#so-dashboard-view.active'); await pg.waitForSelector('#so-attendance-status [data-act="in"]:not([disabled])');
    // sidebar "My Attendance" must NOT open the old demo-shop verification popup any more
    await pg.evaluate(() => { const a = [...document.querySelectorAll('#so-dashboard-view .so-nav-item')].find(x => /My Attendance/.test(x.textContent)); a.click(); });
    await sleep(500);
    check('sidebar "My Attendance" does not open the old demo-shop popup',
      !(await pg.evaluate(() => document.getElementById('so-attendance-overlay').classList.contains('open'))));

    await pg.setGeolocation({ latitude: SHOP.lat + 0.02, longitude: SHOP.lng, accuracy: 10 });   // ~2.2 km from the shop
    await pg.click('#so-attendance-status [data-act="in"]'); await sleep(1200);
    check('CHECK IN opens the real shop-visit popup', await pg.evaluate(() => document.getElementById('so-attendance-overlay').classList.contains('open')));
    let gpsTxt = await pg.$eval('#so-att-gps-body', e => e.innerText.replace(/\s+/g, ' '));
    check('outside the shop\'s geofence: refused with distance + radius, Next disabled', /Too far from shop/i.test(gpsTxt) && /Within 50 meters/i.test(gpsTxt), gpsTxt.slice(0, 300));
    check('Next: Mark Present is disabled while out of range', await pg.$eval('#so-att-next-btn', e => e.disabled));

    await pg.setGeolocation({ latitude: SHOP.lat + 0.0003, longitude: SHOP.lng, accuracy: 15 });   // ~35 m from the shop
    await pg.evaluate(() => simulateGPSVerification()); await sleep(1200);
    gpsTxt = await pg.$eval('#so-att-gps-body', e => e.innerText.replace(/\s+/g, ' '));
    check('inside the shop\'s geofence: distance shown, marked within range', /within range/i.test(gpsTxt), gpsTxt.slice(0, 300));

    // Headless Chromium has no real camera, so the live-camera step falls back to its upload button — same path a phone
    // takes if camera permission is denied. Wait for that fallback, then feed it a real file through a native chooser.
    await pg.waitForSelector('#so-att-upload-fallback-btn[style*="display: block"], #so-att-upload-fallback-btn:not([style*="display: none"])', { timeout: 8000 }).catch(() => {});
    await sleep(300);
    const [chooser] = await Promise.all([
      pg.waitForFileChooser(),
      pg.click('#so-att-upload-fallback-btn')
    ]);
    await chooser.accept([photoPath]);
    await pg.waitForFunction(() => /Uploaded at/.test(document.getElementById('so-att-photo-time').textContent), { timeout: 8000 });
    check('live photo captured (via the upload fallback) and Next enabled', !(await pg.$eval('#so-att-next-btn', e => e.disabled)));

    await pg.click('#so-att-next-btn'); await sleep(1500);
    check('popup closes after a successful submit', !(await pg.evaluate(() => document.getElementById('so-attendance-overlay').classList.contains('open'))));
    const statusTxt = await pg.$eval('#so-attendance-status', e => e.innerText.replace(/\s+/g, ' '));
    check('checked in at the shop, card shows CHECKED IN + the shop name', /CHECKED IN/.test(statusTxt) && /Sri Ganesh Stores/.test(statusTxt), statusTxt.slice(0, 400));
    check('no script errors', errs.length === 0, errs);
    await browser.close(); mock.server.close();
  }

  console.log('\n[Delete a shop in a real browser]');
  {
    const mock = createMock(); await new Promise(r => mock.server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + mock.server.address().port + '/';
    const browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: 'shell', defaultViewport: { width: 1366, height: 900 } });
    const pg = await browser.newPage();
    pg.on('dialog', d => d.accept());
    await pg.setRequestInterception(true);
    pg.on('request', r => (r.url().startsWith(base) || r.url().startsWith('data:')) ? r.continue() : r.abort());
    const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(base, { waitUntil: 'domcontentloaded' }); await sleep(600);
    await pg.type('#userid', 'Admin'); await pg.type('#password', 'Admin@123'); await pg.click('#submit-btn');
    await pg.waitForSelector('#supervisor-dashboard-view.active');
    await pg.evaluate(() => supShowSection('shops')); await pg.waitForSelector('#sp-sh-add'); await sleep(300);
    const beforeShops = await pg.$$eval('#sp-sh-table tbody tr', r => r.length);
    await pg.click('#sp-sh-add'); await sleep(300);
    await pg.type('#sp-x-name', 'Delete Me Mart'); await pg.type('#sp-x-lat', '11.5'); await pg.type('#sp-x-lng', '77.5');
    await pg.click('#sp-x-save'); await sleep(700);
    check('new shop created through the real Admin form', (await pg.$$eval('#sp-sh-table tbody tr', r => r.length)) === beforeShops + 1);
    const delShopBtn = await pg.evaluateHandle(() => [...document.querySelectorAll('#sp-sh-table [data-delete]')]
        .find(b => b.closest('tr').textContent.includes('Delete Me Mart')));
    await delShopBtn.asElement().click(); await sleep(500);
    check('deleting a shop removes its row (native confirm accepted)',
      (await pg.$$eval('#sp-sh-table tbody tr', r => r.length)) === beforeShops &&
      !(await pg.evaluate(() => document.body.textContent.includes('Delete Me Mart'))));
    check('no script errors', errs.length === 0, errs);
    await browser.close(); mock.server.close();
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
