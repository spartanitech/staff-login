/* Real-browser test of team allocation, server messages, server call log and the real Top Performers
 * (portal-sync.js + admin-console.js Team button) against the mock API:  node sync-e2e.js */
'use strict';
const puppeteer = require('puppeteer-core');
const { createMock } = require('../frontend-test/mock-server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, x) => { ok ? pass++ : (fail++, failures.push(n)); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok ? '' : '  -> ' + JSON.stringify(x))); };
const SHOTS = process.env.SHOTS || require('path').join(require('os').tmpdir(), 'sync-shots');
require('fs').mkdirSync(SHOTS, { recursive: true });

(async () => {
  const mock = createMock(); await new Promise(r => mock.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + mock.server.address().port + '/';
  const S = mock.state;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const month = today.slice(0, 7);
  const id = n => S.users.find(u => u.name === n).id;
  const add = (who, product, so, dp, price) => S.stock.push({ id: ++S.seq.stock, officerId: id(who), date: today, product, category: 'DRY FRUITS',
    opening: 100, receipt: 0, totalStock: 100, soSales: so, dpSales: dp, totalSales: so + dp, closing: 100 - so - dp, unitPrice: price, dpName: null });
  add('Ravi', 'Almond California (100GM)', 10, 5, 200);     // 3,000
  add('Murugan', 'Walnut (100GM)', 2, 3, 300);              // 1,500
  add('Kumar', 'Full Cashew (100GM)', 6, 0, 250);           // 1,500
  S.targets.push({ officerId: id('Ravi'), month, amount: 10000, setById: id('Karthik Raja') });
  S.targets.push({ officerId: id('Kumar'), month, amount: 3000, setById: id('Arul Prakash') });

  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox'] });
  async function login(user, pw, view) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1366, height: 860 });
    await page.emulateTimezone('Asia/Kolkata');
    await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); return (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
    page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
    page.on('dialog', d => { page.lastDialog = d.message(); d.accept(); });
    await page.goto(base, { waitUntil: 'domcontentloaded' }); await sleep(500);
    await page.type('#userid', user); await page.type('#password', pw); await page.click('#submit-btn');
    await page.waitForSelector('#' + view + '.active', { timeout: 8000 }); await sleep(1800);
    return page;
  }
  const noErrors = (p, who) => check('no page errors (' + who + ')', !p.errors.length, p.errors);

  // ------------------------------------------------------------------ 1. Admin allocates Sales Officers to an ASM
  console.log('[Team allocation]');
  const ad = await login('Admin', 'Admin@123', 'supervisor-dashboard-view');
  check('header avatar shows the signed-in Admin, not "SV"', (await ad.$eval('#sup-header-avatar-initials', e => e.textContent)) === 'AD');
  await ad.evaluate(() => supShowSection('staff')); await ad.waitForSelector('[data-team]'); await sleep(300);
  const teamBtns = await ad.$$eval('[data-team]', bs => bs.map(b => b.textContent));
  check('Team button on every ASM / RM / Marketing Manager row', teamBtns.length === 4, teamBtns);
  const karthikBtn = await ad.evaluate((kid) => { const b = document.querySelector('[data-team="' + kid + '"]'); b.click(); return b.textContent; }, id('Karthik Raja'));
  check('Karthik Raja shows Team (2) before the change', karthikBtn === 'Team (2)', karthikBtn);
  await ad.waitForSelector('#sp-t-list input'); await sleep(200);
  const notes = await ad.$eval('#sp-t-list', e => e.textContent);
  check('a Sales Officer under another ASM is marked "now under …"', /now under Arul Prakash/.test(notes), notes);
  await ad.evaluate((mu, ku) => {
    document.querySelector('#sp-t-list input[value="' + mu + '"]').click();     // untick Murugan
    document.querySelector('#sp-t-list input[value="' + ku + '"]').click();     // tick Kumar (moves from Arul)
  }, id('Murugan'), id('Kumar'));
  await ad.screenshot({ path: SHOTS + '/team-modal.png' });
  await ad.click('#sp-t-save'); await sleep(1200);
  const mgrOf = n => (S.users.find(u => u.id === S.users.find(x => x.name === n).reportingManagerId) || {}).name || null;
  check('saved on the server: Ravi + Kumar -> Karthik, Murugan unassigned', mgrOf('Ravi') === 'Karthik Raja' && mgrOf('Kumar') === 'Karthik Raja' && mgrOf('Murugan') === null,
    { Ravi: mgrOf('Ravi'), Kumar: mgrOf('Kumar'), Murugan: mgrOf('Murugan') });
  check('audit log records the team change', S.audit.some(a => a.action === 'TEAM_ASSIGN'));
  check('table refreshed: Karthik now Team (2), Arul Team (0)', await ad.evaluate((k, a) => document.querySelector('[data-team="' + k + '"]').textContent === 'Team (2)' &&
    document.querySelector('[data-team="' + a + '"]').textContent === 'Team (0)', id('Karthik Raja'), id('Arul Prakash')));
  const cut = await ad.evaluate(() => [...document.querySelectorAll('.sp-row-actions .sp-btn')].filter(b => b.scrollWidth > b.clientWidth + 1).length);
  check('Staff table action buttons are not clipped', cut === 0, cut);
  await ad.screenshot({ path: SHOTS + '/staff.png' });

  // ------------------------------------------------------------------ 2. ASM sees only the allocated officers
  console.log('[ASM sees only their own team]');
  await ad.evaluate(() => SOLive.refresh()); await sleep(800);
  await ad.evaluate(() => goToASMAsSupervisor()); await ad.waitForSelector('#lv-pick-list .lv-person'); await sleep(200);
  await ad.evaluate(() => [...document.querySelectorAll('#lv-pick-list .lv-person')].find(b => /Karthik/.test(b.textContent)).click()); await sleep(1200);
  const viewTxt = await ad.$eval('#lv-asm-home', e => e.textContent);
  check('Admin viewing Karthik: team has Ravi and Kumar, not Murugan', /Ravi/.test(viewTxt) && /Kumar/.test(viewTxt) && !/Murugan/.test(viewTxt), viewTxt.slice(0, 300));
  await ad.evaluate(() => SOLive.exitView()); await sleep(400);

  const asm = await login('areasales01', 'Asm@123', 'asm-dashboard-view');
  const visible = await asm.evaluate(async () => (await SPApi.users()).map(u => u.name));
  check('Karthik (ASM) receives only his own tree from the server', visible.includes('Ravi') && visible.includes('Kumar') && !visible.includes('Murugan'), visible);
  const asm2 = await login('areasales02', 'Asm@123', 'asm-dashboard-view');
  const visible2 = await asm2.evaluate(async () => (await SPApi.users()).map(u => u.name));
  check('Arul (other ASM) cannot see Karthik\'s officers', !visible2.includes('Ravi') && !visible2.includes('Kumar'), visible2);
  const home2 = await asm2.$eval('#lv-asm-home', e => e.textContent);
  check('Arul\'s dashboard says no officer reports to him', /No active Sales Officer reports to you yet/.test(home2));

  // ------------------------------------------------------------------ 3. messages go through the server
  console.log('[Messages on the server]');
  await asm.evaluate(() => openRoleMessages('asm')); await sleep(300);
  const opts = await asm.$$eval('#role-msg-to option', os => os.map(o => o.value));
  check('ASM can address only his own officers by name', opts.includes('person:Ravi') && opts.includes('person:Kumar') && !opts.includes('person:Murugan'), opts);
  await asm.select('#role-msg-to', 'person:Ravi');
  await asm.type('#role-msg-text', 'Visit Sri Ganesh Stores today');
  await asm.evaluate(() => sendRoleMessage()); await sleep(1200);
  check('message stored on the server, sender set by the server', S.msgs.length === 1 && S.msgs[0].from === 'Karthik Raja' && S.msgs[0].toId === id('Ravi'), S.msgs);
  check('sent message got its server id on the ASM phone', await asm.evaluate(() => portalMessages.length === 1 && !!portalMessages[0].id));

  const so = await login('sales01', 'Sales@123', 'so-dashboard-view');
  await so.evaluate(() => PortalSync.pullMessages()); await sleep(300);
  const ravisBoard = await so.evaluate(() => portalMessages.map(m => m.text));
  check('Ravi (another phone) receives the ASM\'s message', ravisBoard.includes('Visit Sri Ganesh Stores today'), ravisBoard);
  const kumar = await login('sales03', 'Sales@123', 'so-dashboard-view');
  await kumar.evaluate(() => PortalSync.pullMessages()); await sleep(300);
  check('Kumar does not see a message addressed to Ravi', (await kumar.evaluate(() => portalMessages.length)) === 0);
  const refused = await asm.evaluate(async () => { try { await SPApi.sendMessage('person:Murugan', 'x'); return 'sent'; } catch (e) { return e.code; } });
  check('server refuses an ASM writing to another team\'s officer', refused === 'OUT_OF_SCOPE', refused);

  // edit + delete
  await asm.evaluate(() => { portalMessages[0].text = 'Visit Sri Ganesh Stores before 5 pm'; savePortalMessages(); }); await sleep(800);
  check('edit reaches the server', S.msgs[0] && S.msgs[0].text === 'Visit Sri Ganesh Stores before 5 pm');
  // offline send is queued and sent later
  await so.setOfflineMode(true);
  await so.evaluate(() => { portalMessages.unshift({ from: 'Ravi', fromRole: 'Sales Officer', to: 'Area Sales Manager', text: 'Stock low at Sri Ganesh', at: new Date().toISOString() }); savePortalMessages(); }); await sleep(800);
  check('offline: message kept on the phone as pending', S.msgs.length === 1 && await so.evaluate(() => portalMessages.some(m => m._pending)));
  await so.setOfflineMode(false);
  await so.evaluate(() => PortalSync.pullMessages()); await sleep(800);
  check('back online: pending message delivered once', S.msgs.filter(m => m.text === 'Stock low at Sri Ganesh').length === 1);
  await asm.evaluate(() => PortalSync.pullMessages()); await sleep(300);
  check('ASM receives the officer\'s reply (to the ASM role)', (await asm.evaluate(() => portalMessages.map(m => m.text))).includes('Stock low at Sri Ganesh'));
  await asm.evaluate(() => { portalMessages.splice(portalMessages.findIndex(m => m.from === 'Karthik Raja'), 1); savePortalMessages(); }); await sleep(800);
  check('delete reaches the server', !S.msgs.some(m => m.from === 'Karthik Raja'));

  // ------------------------------------------------------------------ 4. telephone call report on the server
  console.log('[Call log on the server]');
  await so.evaluate(() => { currentOfficer = soOfficers.find(o => o.name === 'Ravi') || currentOfficer; logShopCallEvent('Sri Ganesh Stores', '9876543210'); }); await sleep(1000);
  check('call stored on the server', S.calls.length === 1 && S.calls[0].shop === 'Sri Ganesh Stores' && S.calls[0].officerId === id('Ravi'), S.calls);
  await so.evaluate(() => { logShopCallEvent('Sri Ganesh Stores', '9876543210'); }); await sleep(600);
  await so.evaluate(() => PortalSync.pushCalls()); await sleep(400);
  check('second call stored, no duplicates on re-send', S.calls.length === 2);
  await asm.evaluate(() => PortalSync.pullCalls()); await sleep(300);
  const asmCalls = await asm.evaluate(() => (loadCallLog()['Ravi'] || []).length);
  check('ASM (another phone) sees Ravi\'s calls', asmCalls === 2, asmCalls);
  await asm2.evaluate(() => PortalSync.pullCalls()); await sleep(300);
  check('other ASM does not', (await asm2.evaluate(() => Object.keys(loadCallLog()).length)) === 0);
  await so.evaluate(() => soDeleteCallEntry(0)); await sleep(600);
  check('deleting a call removes it on the server', S.calls.length === 1);

  // ------------------------------------------------------------------ 5. Admin console: real top performers
  console.log('[Top performers from real sales]');
  await ad.evaluate(() => SOLive.refresh()); await sleep(800);
  await ad.evaluate(() => supShowSection('top')); await sleep(800);
  const top = await ad.$eval('#sup-top-performers', e => e.innerText);
  check('Best Sales Officer is Ravi with ₹3,000 and 30% of target', /Ravi/.test(top) && /3,000/.test(top) && /30% of target/.test(top), top);
  check('Best ASM is Karthik Raja (his team sold ₹4,500)', /Karthik Raja/.test(top) && /4,500/.test(top), top);
  check('no demo names left (S. Prakash / North Region)', !/Prakash|North Region/.test(top.replace('Arul Prakash', '')), top);
  await ad.evaluate(() => supShowSection('performance')); await sleep(500);
  const perf = await ad.$eval('#sup-role-performance', e => e.innerText);
  check('Role performance shows real counts, unassigned ASM flagged', /2 Area Sales Managers/.test(perf) && /1 without a team/.test(perf) && !/Avg target %/.test(perf), perf);
  await ad.screenshot({ path: SHOTS + '/top.png' });

  [ad, asm, asm2, so, kumar].forEach((p, i) => noErrors(p, ['Admin', 'ASM Karthik', 'ASM Arul', 'SO Ravi', 'SO Kumar'][i]));
  await browser.close(); mock.server.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  if (fail) { console.log('Failed: ' + failures.join(' | ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
