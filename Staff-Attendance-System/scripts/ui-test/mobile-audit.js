/* Phone-width audit: logs in as each role at 390x844, opens every section and reports horizontal overflow. */
'use strict';
const puppeteer = require('puppeteer-core');
const { createMock } = require('../frontend-test/mock-server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = process.env.SHOTS || '/tmp/claude-0/mob';
(async () => {
  const mock = createMock(); await new Promise(r => mock.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + mock.server.address().port + '/';
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox'] });
  const W = +(process.env.W || 390);
  async function login(user, pw, view) {
    const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
    await page.setViewport({ width: W, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); return (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
    page.errors = []; page.on('pageerror', e => page.errors.push(e.message)); page.on('dialog', d => d.accept());
    await page.goto(base, { waitUntil: 'domcontentloaded' }); await sleep(400);
    await page.screenshot({ path: OUT + '/login.png' });
    await page.type('#userid', user); await page.type('#password', pw); await page.click('#submit-btn');
    await page.waitForSelector('#' + view + '.active', { timeout: 8000 }); await sleep(1800);
    return page;
  }
  async function audit(page, tag) {
    const r = await page.evaluate((W) => {
      const vw = document.documentElement.clientWidth;
      const wide = [];
      document.querySelectorAll('body *').forEach(el => {
        const st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden') return;
        const b = el.getBoundingClientRect(); if (!b.width || !b.height) return;
        if (b.right > vw + 2 || b.left < -2) {
          // ignore children of elements that scroll horizontally themselves
          let p = el.parentElement, clipped = false;
          while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX) && p.getBoundingClientRect().right <= vw + 2) { clipped = true; break; } p = p.parentElement; }
          if (!clipped) wide.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 2).join('.')) + ' ' + Math.round(b.left) + '..' + Math.round(b.right));
        }
      });
      return { scroll: document.documentElement.scrollWidth, vw, wide: wide.slice(0, 12), n: wide.length };
    }, W);
    console.log(tag.padEnd(28), 'pageScroll=' + r.scroll + '/' + r.vw, 'overflowing=' + r.n, r.n ? '\n      ' + r.wide.join('\n      ') : '');
    await page.screenshot({ path: OUT + '/' + tag.replace(/[^a-z0-9]+/gi, '_') + '.png', fullPage: true });
  }
  const ad = await login('Admin', 'Admin@123', 'supervisor-dashboard-view');
  await audit(ad, 'admin-home');
  for (const s of ['staff', 'attendance', 'shops', 'locations', 'audit', 'settings', 'messages']) {
    await ad.evaluate(k => supShowSection(k), s); await sleep(900); await audit(ad, 'admin-' + s);
  }
  const asm = await login('areasales01', 'Asm@123', 'asm-dashboard-view');
  await audit(asm, 'asm-home');
  await asm.evaluate(() => { const a = document.getElementById('asm2-nav-teamshops'); if (a) a.click(); }); await sleep(1200); await audit(asm, 'asm-teamshops');
  const so = await login('sales01', 'Sales@123', 'so-dashboard-view');
  await audit(so, 'so-home');
  console.log('errors', ad.errors, asm.errors, so.errors);
  await browser.close(); mock.server.close();
})().catch(e => { console.error(e); process.exit(1); });
