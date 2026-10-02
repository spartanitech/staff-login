/* Real-browser test: Promotions are stored on the server — Delete next to Send on every tab, deletes and adds
 * survive a reload and show on another device; an SO cannot change them.   node promotions-e2e.js */
'use strict';
const puppeteer = require('puppeteer-core');
const { createMock } = require('../frontend-test/mock-server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok ? '' : '  -> ' + JSON.stringify(x))); };
const SHOTS = process.env.SHOTS || require('path').join(require('os').tmpdir(), 'promo-shots');
require('fs').mkdirSync(SHOTS, { recursive: true });

(async () => {
  const mock = createMock(); await new Promise(r => mock.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + mock.server.address().port + '/';
  const S = mock.state;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox'] });
  async function login(user, pw, view, width) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(width ? { width, height: 844, isMobile: true, hasTouch: true } : { width: 1366, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); return (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
    page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(base, { waitUntil: 'domcontentloaded' }); await sleep(500);
    await page.type('#userid', user); await page.type('#password', pw); await page.click('#submit-btn');
    await page.waitForSelector('#' + view + '.active', { timeout: 8000 }); await sleep(1800);
    return page;
  }
  const open = (pg, tab) => pg.evaluate(t => { openMMSection('promotions'); renderPromotions(t); }, tab).then(() => sleep(300));
  const rows = (pg) => pg.evaluate(() => [...document.querySelectorAll('#mm-section-body tbody tr')].map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  const kinds = k => (S.promos || []).filter(p => p.kind === k);

  console.log('[Marketing Manager: first sign-in imports the starting list]');
  const mm = await login('marketing01', 'password123', 'rsm-dashboard-view');
  await sleep(800);
  check('server has the starting promotions (1 offer, 2 coupons, 1 festival, 1 combo, 2 reports)',
    kinds('offer').length === 1 && kinds('coupon').length === 2 && kinds('festival').length === 1 && kinds('combo').length === 1 && kinds('report').length === 2, S.promos);

  for (const [tab, fn] of [['offers', 'deleteOffer'], ['coupons', 'deleteCoupon'], ['festival', 'deleteFestivalOffer'], ['combo', 'deleteComboOffer'], ['discount', 'deleteDiscountReport']]) {
    await open(mm, tab);
    const btns = await mm.evaluate(f => [...document.querySelectorAll('#mm-section-body tbody tr')].map(r => ({ send: !!r.querySelector('[onclick^="sendPromotion"]'), del: !!r.querySelector('[onclick^="' + f + '"]') })), fn);
    check(`"${tab}" tab: every row has a Delete button${tab === 'discount' ? '' : ' next to Send'}`, btns.length > 0 && btns.every(b => b.del && (tab === 'discount' || b.send)), btns);
  }
  await open(mm, 'festival'); await mm.screenshot({ path: SHOTS + '/festival-desktop.png' });

  console.log('[Delete festival + combo, add a new festival offer]');
  await mm.click('#mm-section-body [onclick^="deleteFestivalOffer"]'); await sleep(700);
  check('festival offer removed on screen', (await rows(mm)).every(r => !/Onam/.test(r)), await rows(mm));
  check('festival offer removed on the server', kinds('festival').length === 0, kinds('festival'));
  await open(mm, 'combo');
  await mm.click('#mm-section-body [onclick^="deleteComboOffer"]'); await sleep(700);
  check('combo offer removed on the server', kinds('combo').length === 0, kinds('combo'));
  await open(mm, 'festival');
  await mm.evaluate(() => showFestivalOfferForm());
  await mm.type('#ff-name', 'Diwali Dhamaka'); await mm.evaluate(() => { document.getElementById('ff-discount').value = '20%'; saveFestivalOfferForm(); }); await sleep(800);
  check('new festival offer saved on the server', kinds('festival').length === 1 && kinds('festival')[0].name === 'Diwali Dhamaka', kinds('festival'));
  await mm.click('#mm-section-body [onclick^="deleteFestivalOffer"]'); await sleep(900);
  check('a just-added offer can be deleted straight away', kinds('festival').length === 0, kinds('festival'));
  await mm.evaluate(() => showFestivalOfferForm());
  await mm.type('#ff-name', 'Pongal Offer'); await mm.evaluate(() => saveFestivalOfferForm()); await sleep(800);

  console.log('[Reload + another device (Admin, phone)]');
  const mm2 = await login('marketing01', 'password123', 'rsm-dashboard-view'); await sleep(800);
  await open(mm2, 'festival');
  check('signed in again: deleted Onam stays gone, Pongal is there', (await rows(mm2)).join('|').includes('Pongal Offer') && !(await rows(mm2)).join('|').includes('Onam'), await rows(mm2));
  const ad = await login('Admin', 'Admin@123', 'supervisor-dashboard-view', 390).catch(() => null);
  if (ad) {
    await sleep(800);
    await open(ad, 'combo');
    check('Admin phone: combo list empty (deleted for everyone)', (await rows(ad)).join('|').indexOf('Detergent') < 0, await rows(ad));
    await open(ad, 'festival');
    check('Admin phone: sees Pongal Offer', (await rows(ad)).join('|').includes('Pongal Offer'), await rows(ad));
    const fit = await ad.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check('phone: no sideways scroll on Promotions', fit.sw <= fit.cw + 1, fit);
    await ad.screenshot({ path: SHOTS + '/festival-phone.png' });
    check('no page errors (Admin)', ad.errors.length === 0, ad.errors);
  } else check('admin login', false, 'could not sign in as admin');
  check('no page errors (MM)', mm.errors.length === 0, mm.errors);

  console.log(`\n==== ${pass} passed, ${fail} failed ====\nScreenshots: ${SHOTS}`);
  await browser.close(); mock.server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
