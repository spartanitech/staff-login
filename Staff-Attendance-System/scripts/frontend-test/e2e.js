/* End-to-end test of the real, patched frontend (jsdom) against the mock API.
 *   npm install && npm test
 * The mock mirrors the Spring Boot contract; it is not the Java code. */
'use strict';
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const { createMock } = require('./mock-server');
const XLSX = require('xlsx');
const { jsPDF } = require('jspdf');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name); console.log('  FAIL  ' + name + (extra !== undefined ? '   -> ' + JSON.stringify(extra) : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, what, ms = 4000) {
    const t0 = Date.now();
    for (;;) {
        let v; try { v = fn(); } catch (e) { v = false; }
        if (v) return v;
        if (Date.now() - t0 > ms) throw new Error('timeout waiting for: ' + what);
        await sleep(25);
    }
}

// ---- fake browser pieces ---------------------------------------------------------------
const SITE = { lat: 9.9252, lng: 78.1198 };
const geo = { next: null, calls: [] };
// A tiny buffer with real JPEG magic bytes (FF D8 FF) — enough for the mock server's photo-signature check.
const FAKE_JPEG_BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
const FAKE_JPEG_DATAURL = 'data:image/jpeg;base64,' + FAKE_JPEG_BYTES.toString('base64');
function installBrowserStubs(window, captured) {
    Object.defineProperty(window.navigator, 'geolocation', { configurable: true, value: {
        getCurrentPosition(ok, err, opts) {
            geo.calls.push(opts);
            const n = geo.next || { lat: SITE.lat, lng: SITE.lng, acc: 12 };
            setTimeout(() => {
                if (n.error) err({ code: n.error });
                else ok({ coords: { latitude: n.lat, longitude: n.lng, accuracy: n.acc } });
            }, 5);
        } } });
    window.alert = m => captured.alerts.push(String(m));
    window.confirm = () => true;
    window.scrollTo = () => {};
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    window.IntersectionObserver = window.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} };
    window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
    const ctx = new Proxy({}, { get: (t, k) => k === 'canvas' ? {} : (k === 'measureText' ? () => ({ width: 10 }) : () => ctx), set: () => true });
    window.HTMLCanvasElement.prototype.getContext = () => ctx;
    // jsdom has no real image/canvas decoder — the shop-attendance photo flow (stamp -> canvas -> dataURL, then
    // Image() re-decode before upload) only needs deterministic stand-ins, not real pixels.
    window.HTMLCanvasElement.prototype.toDataURL = () => FAKE_JPEG_DATAURL;
    window.HTMLCanvasElement.prototype.toBlob = function (cb, type) { cb(new window.Blob([FAKE_JPEG_BYTES], { type: type || 'image/jpeg' })); };
    window.Image = class {
        constructor() { this.naturalWidth = 100; this.naturalHeight = 100; }
        set src(v) { this._src = v; setTimeout(() => { if (this.onload) this.onload(); }, 0); }
        get src() { return this._src; }
    };
    window.fetch = async (u, i) => {
        const opts = i ? { ...i } : i;
        // jsdom's FormData/Blob/File live in a different realm than Node's fetch (undici) and don't implement
        // arrayBuffer(), so passing them straight through hangs the request forever — read each file/blob via
        // jsdom's own FileReader instead, then rebuild the body with Node's own FormData/Blob before sending it.
        const readAsBuffer = blob => new Promise((resolve, reject) => {
            const r = new window.FileReader();
            r.onload = () => resolve(Buffer.from(r.result));
            r.onerror = () => reject(r.error || new Error('FileReader failed'));
            r.readAsArrayBuffer(blob);
        });
        if (opts && opts.body && typeof opts.body.entries === 'function' && !(opts.body instanceof FormData)) {
            const nfd = new FormData();
            for (const [k, v] of opts.body.entries()) {
                if (v && typeof v === 'object' && typeof v.slice === 'function' && 'size' in v) nfd.append(k, new Blob([await readAsBuffer(v)], { type: v.type }), v.name);
                else nfd.append(k, v);
            }
            opts.body = nfd;
        }
        return fetch(new URL(u, window.location.href), opts);
    };
    if (!window.URL.createObjectURL) { window.URL.createObjectURL = () => 'blob:fake-' + Math.random().toString(36).slice(2); window.URL.revokeObjectURL = () => {}; }
}

class LocalOnly extends ResourceLoader {
    fetch(url, options) {
        if (/^http:\/\/127\.0\.0\.1/.test(url)) return super.fetch(url, options);
        return Promise.resolve(Buffer.from(''));       // CDN scripts (jsPDF, SheetJS, Leaflet) are injected separately
    }
}

async function openPortal(base, captured) {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => errors.push(String(e.message || e)));
    const dom = await JSDOM.fromURL(base, { runScripts: 'dangerously', resources: new LocalOnly(), pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(window) { installBrowserStubs(window, captured); } });
    await waitFor(() => dom.window.SPBridge && dom.window.SPAdmin && dom.window.document.readyState === 'complete', 'scripts loaded');
    const w = dom.window;
    w.XLSX = { ...XLSX, writeFile: (wb, name) => captured.xlsx.push({ name, wb }) };
    w.jspdf = { jsPDF: class extends jsPDF {
        constructor(...a) { super(...a); this.save = name => { captured.pdf.push({ name, bytes: this.output('arraybuffer').byteLength, pages: this.getNumberOfPages() }); }; }
    } };
    return { dom, w, d: w.document, errors };
}

const type = (w, sel, value) => { const el = w.document.querySelector(sel); el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };
const click = (w, sel) => { const el = typeof sel === 'string' ? w.document.querySelector(sel) : sel; if (!el) throw new Error('no element ' + sel); el.click(); };
const visible = (d, id) => d.getElementById(id).classList.contains('active');
const text = (d, sel) => (d.querySelector(sel) || {}).textContent || '';

async function login(p, user, pass, tab) {
    if (tab) click(p.w, `.rung[data-role="${tab}"]`);
    type(p.w, '#userid', user); type(p.w, '#password', pass);
    click(p.w, '#submit-btn');
}

// Opens the "Login > Select Shop > GPS ON > Check Distance > Live Camera > Attendance" popup by clicking CHECK IN
// (Sales Officers only), and leaves it open once the current geo.next fix has been applied and rendered.
async function openShopPopup(p) {
    click(p.w, '#so-attendance-status [data-act="in"]');
    await waitFor(() => visible2(p.d, 'so-attendance-overlay'), 'shop popup open');
    await waitFor(() => !/Fetching your live location/.test(text(p.d, '#so-att-gps-body')) && text(p.d, '#so-att-gps-body').trim() !== '', 'first GPS fix applied');
}

// Feeds a fake (but magic-byte-valid) JPEG into the popup's upload-fallback input, as if the camera were unavailable
// and the officer chose "Upload Photo instead".
function uploadShopPhoto(p) {
    const input = p.d.getElementById('so-att-photo-input');
    const file = new p.w.File([FAKE_JPEG_BYTES], 'shop.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new p.w.Event('change'));
}

// Full happy-path shop check-in: opens the popup at the given GPS fix, uploads a photo once in range, and submits.
async function shopCheckIn(p, fix) {
    geo.next = fix;
    await openShopPopup(p);
    await waitFor(() => /within range/i.test(text(p.d, '#so-att-gps-body')) && !/too weak/i.test(text(p.d, '#so-att-gps-body')), 'within range + good accuracy');
    uploadShopPhoto(p);
    await waitFor(() => /Uploaded at/.test(text(p.d, '#so-att-photo-time')), 'photo captured');
    await waitFor(() => !p.d.getElementById('so-att-next-btn').disabled, 'next enabled');
    click(p.w, '#so-att-next-btn');
    await waitFor(() => !visible2(p.d, 'so-attendance-overlay'), 'popup closed after submit');
}
const visible2 = (d, id) => d.getElementById(id).classList.contains('open');

(async () => {
    const mock = createMock();
    await new Promise(r => mock.server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + mock.server.address().port + '/';
    const S = mock.state;
    const cap = { alerts: [], xlsx: [], pdf: [] };

    // ---------------------------------------------------------------- static checks
    console.log('\n[1] Source is free of fake credentials');
    const html = fs.readFileSync(path.resolve(__dirname, '../../attendance/src/main/resources/static/index.html'), 'utf8');
    for (const secret of ['Admin@123', 'password123', 'Sales@123', 'Asm@123', 'Regional@123', 'supervisor01'])
        check(`page source does not contain "${secret}"`, !html.includes(secret));
    check('no localStorage/sessionStorage in api.js / bridge / admin modules',
        !/(local|session)Storage\s*[.\[]/.test(['api.js', 'backend-bridge.js', 'admin-console.js'].map(f => fs.readFileSync(path.resolve(__dirname, '../../attendance/src/main/resources/static', f), 'utf8')).join('\n')));

    let p = await openPortal(base, cap);
    console.log('\n[2] Login page');
    check('user id / password / name boxes start empty', ['#userid', '#password', '#loginname'].every(s => p.d.querySelector(s).value === ''));
    check('wrong password rejected with a clear message, stays on login', await (async () => {
        await login(p, 'Admin', 'wrong-pass', 'sup');
        await waitFor(() => /Incorrect username or password/.test(text(p.d, '#status')), 'error text');
        return visible(p.d, 'login-view') && !visible(p.d, 'supervisor-dashboard-view');
    })());
    check('failed login was audited by the server', S.audit.some(l => l.action === 'LOGIN_FAILED'));
    check('unknown user rejected', await (async () => {
        await login(p, 'nobody', 'x'); await waitFor(() => /Incorrect username or password/.test(text(p.d, '#status')), 'err');
        return visible(p.d, 'login-view');
    })());

    console.log('\n[3] THE reported bug: Admin credentials typed while the OWNER tab is selected');
    click(p.w, '.rung[data-role="owner"]');
    await login(p, 'Admin', 'Admin@123');
    await waitFor(() => visible(p.d, 'supervisor-dashboard-view'), 'admin dashboard');
    check('lands on the Admin console (role comes from the backend, not the tab)', visible(p.d, 'supervisor-dashboard-view') && !visible(p.d, 'dashboard-view'));
    check('Admin console title present', /Admin Console/.test(p.d.body.textContent));
    check('JWT held in memory only', p.w.SPApi.isLoggedIn() && !Object.keys(p.w.localStorage).some(k => /token|jwt|auth/i.test(k)));
    check('login audited', S.audit.some(l => l.action === 'LOGIN' && l.userId === 1));
    await waitFor(() => /Today at a glance/.test(text(p.d, '#sp-admin-glance')), 'glance card');
    check('dashboard "today at a glance" shows real counts', /Active staff/.test(text(p.d, '#sp-admin-glance')) && /Active locations/.test(text(p.d, '#sp-admin-glance')));
    check('Admin has all new menu sections', ['attendance', 'staff', 'locations', 'audit', 'settings'].every(k => p.d.querySelector(`.sup-nav-item[data-sec="${k}"]`)));

    console.log('\n[4] Admin: staff accounts');
    p.w.supShowSection('staff');
    await waitFor(() => p.d.querySelectorAll('#sp-s-table tbody tr').length >= 9, 'staff rows');
    check('lists all seeded users from the backend', p.d.querySelectorAll('#sp-s-table tbody tr').length === 9);
    click(p.w, '#sp-s-add');
    type(p.w, '#sp-u-name', 'Test Officer'); type(p.w, '#sp-u-username', 'test.officer'); type(p.w, '#sp-u-pass', 'Secret#123'); type(p.w, '#sp-u-pass2', 'Secret#123');
    type(p.w, '#sp-u-role', 'SO'); type(p.w, '#sp-u-mgr', String(S.users.find(u => u.username === 'areasales01').id));
    click(p.w, '#sp-u-save');
    await waitFor(() => S.users.some(u => u.username === 'test.officer'), 'user created');
    await waitFor(() => p.d.querySelectorAll('#sp-s-table tbody tr').length === 10, 'table refresh');
    check('new staff account created through the API and shown', S.users.find(u => u.username === 'test.officer').role === 'SO');
    check('password mismatch is caught before the request', await (async () => {
        click(p.w, '#sp-s-add'); type(p.w, '#sp-u-name', 'X'); type(p.w, '#sp-u-username', 'xx.yy'); type(p.w, '#sp-u-pass', 'abcdefgh1'); type(p.w, '#sp-u-pass2', 'different1');
        const before = S.users.length; click(p.w, '#sp-u-save'); await sleep(50);
        const ok = /do not match/.test(text(p.d, '#sp-u-err')) && S.users.length === before; click(p.w, '.sp-modal-x'); return ok; })());
    check('duplicate username shows the server message', await (async () => {
        click(p.w, '#sp-s-add'); type(p.w, '#sp-u-name', 'Dup'); type(p.w, '#sp-u-username', 'sales01'); type(p.w, '#sp-u-pass', 'abcdefgh1'); type(p.w, '#sp-u-pass2', 'abcdefgh1');
        click(p.w, '#sp-u-save'); await waitFor(() => /already taken/.test(text(p.d, '#sp-u-err')), 'dup msg'); click(p.w, '.sp-modal-x'); return true; })());
    const t1 = S.users.find(u => u.username === 'test.officer');
    click(p.w, `[data-toggle="${t1.id}"]`);
    await waitFor(() => t1.status === 'INACTIVE', 'deactivated');
    check('deactivate works (status INACTIVE in backend)', t1.status === 'INACTIVE');
    check('reset password writes to backend', await (async () => {
        await waitFor(() => p.d.querySelector(`[data-reset="${t1.id}"]`), 'row'); click(p.w, `[data-reset="${t1.id}"]`);
        type(p.w, '#sp-p-new', 'NewSecret#9'); type(p.w, '#sp-p-new2', 'NewSecret#9'); click(p.w, '#sp-p-save');
        await waitFor(() => t1.password === 'NewSecret#9', 'pw reset'); return true; })());
    check('cannot delete your own account', await (async () => {
        cap.alerts.length = 0;
        await waitFor(() => p.d.querySelector('[data-delete="1"]'), 'admin row'); click(p.w, '[data-delete="1"]');
        await waitFor(() => cap.alerts.length > 0, 'alert shown');
        const ok = /cannot delete your own account/i.test(cap.alerts[0]) && S.users.some(u => u.id === 1);
        return ok; })());
    check('cannot delete a manager who still has people reporting to them', await (async () => {
        const asm1 = S.users.find(u => u.username === 'areasales01');
        cap.alerts.length = 0;
        click(p.w, `[data-delete="${asm1.id}"]`);
        await waitFor(() => cap.alerts.length > 0, 'alert shown');
        const ok = /report to Karthik Raja/.test(cap.alerts[0]) && /Ravi/.test(cap.alerts[0]) && S.users.some(u => u.id === asm1.id);
        return ok; })());
    check('deleting a staff account with no reports removes it and their history', await (async () => {
        // a disposable account, so test.officer stays around (intact) for the "inactive account" test in section 7
        const temp = { id: ++S.seq.user, employeeCode: 'TMP001', name: 'Temp Staff', username: 'temp.staff', password: 'Temp@1234',
            role: 'SO', status: 'ACTIVE', reportingManagerId: null, area: null, region: null, createdAt: '2026-01-01T00:00:00', updatedAt: '2026-01-01T00:00:00' };
        S.users.push(temp);
        p.w.supShowSection('staff');   // remount the panel so it re-fetches the list, now including temp
        await waitFor(() => p.d.querySelector(`[data-delete="${temp.id}"]`), 'temp row rendered');
        click(p.w, `[data-delete="${temp.id}"]`);
        await waitFor(() => !S.users.some(u => u.id === temp.id), 'user gone');
        return S.audit.some(l => l.action === 'USER_DELETE' && l.description.includes('temp.staff')); })());

    console.log('\n[5] Admin: work locations');
    p.w.supShowSection('locations');
    await waitFor(() => /Madurai HQ/.test(text(p.d, '#sp-admin-locations')), 'locations list');
    click(p.w, '#sp-l-add');
    type(p.w, '#sp-w-name', 'Chennai Depot'); type(p.w, '#sp-w-lat', '13.0827'); type(p.w, '#sp-w-lng', '80.2707'); type(p.w, '#sp-w-rad', '150');
    click(p.w, '#sp-w-save');
    await waitFor(() => S.locs.some(l => l.name === 'Chennai Depot'), 'location created');
    const nl = S.locs.find(l => l.name === 'Chennai Depot');
    check('new geofence stored with lat/lng/radius', nl.latitude === 13.0827 && nl.longitude === 80.2707 && nl.allowedRadiusMeters === 150);
    check('bad coordinates blocked in the form', await (async () => {
        await waitFor(() => p.d.querySelector('#sp-l-add'), 'ui'); click(p.w, '#sp-l-add'); type(p.w, '#sp-w-name', 'Bad'); type(p.w, '#sp-w-lat', '123'); type(p.w, '#sp-w-lng', '10');
        click(p.w, '#sp-w-save'); await sleep(40); const ok = /valid latitude/.test(text(p.d, '#sp-w-err')); click(p.w, '.sp-modal-x'); return ok; })());
    S.locs.find(l => l.name === 'Chennai Depot').status = 'INACTIVE';   // keep the test geometry simple: only Madurai HQ is active

    console.log('\n[5b] Admin: shops');
    p.w.supShowSection('shops');
    await waitFor(() => p.d.querySelectorAll('#sp-admin-shops #sp-sh-table tbody tr').length === 4, 'seeded shops listed');
    check('lists all seeded demo shops with their assigned officer', /Sri Ganesh Stores/.test(text(p.d, '#sp-sh-table')) && /Ravi/.test(text(p.d, '#sp-sh-table')) && /Kaveri Mart/.test(text(p.d, '#sp-sh-table')));
    click(p.w, '#sp-sh-add');
    type(p.w, '#sp-x-name', 'New Test Mart'); type(p.w, '#sp-x-lat', '11.0000'); type(p.w, '#sp-x-lng', '77.0000'); type(p.w, '#sp-x-rad', '75');
    click(p.w, '#sp-x-save');
    await waitFor(() => S.shops.some(s => s.name === 'New Test Mart'), 'shop created');
    const newShop = S.shops.find(s => s.name === 'New Test Mart');
    check('new shop auto-generates a code and stores lat/lng/radius, unassigned by default', /^SHP\d{3}$/.test(newShop.code) && newShop.latitude === 11 && newShop.longitude === 77 && newShop.allowedRadiusMeters === 75 && newShop.assignedOfficerId == null);
    check('audit log records the shop creation', S.audit.some(l => l.action === 'SHOP_CREATE' && l.description.includes('New Test Mart')));
    check('duplicate shop code is rejected by the server', await (async () => {
        await waitFor(() => p.d.querySelector('#sp-sh-add'), 'ui'); click(p.w, '#sp-sh-add');
        type(p.w, '#sp-x-code', 'SHP001'); type(p.w, '#sp-x-name', 'Dup Shop'); type(p.w, '#sp-x-lat', '10'); type(p.w, '#sp-x-lng', '77');
        click(p.w, '#sp-x-save'); await waitFor(() => /already uses that code/.test(text(p.d, '#sp-x-err')), 'dup code msg'); click(p.w, '.sp-modal-x'); return true; })());
    check('bad radius is blocked in the form', await (async () => {
        click(p.w, '#sp-sh-add'); type(p.w, '#sp-x-name', 'Bad Radius'); type(p.w, '#sp-x-lat', '10'); type(p.w, '#sp-x-lng', '77'); type(p.w, '#sp-x-rad', '5');
        click(p.w, '#sp-x-save'); await sleep(40); const ok = /between 10 and 500/.test(text(p.d, '#sp-x-err')); click(p.w, '.sp-modal-x'); return ok; })());
    await waitFor(() => /New Test Mart/.test(text(p.d, '#sp-sh-table')), 'new shop row rendered');
    // Scoped to the shops panel: every admin section stays mounted (just hidden with display:none) once visited, so a
    // bare [data-toggle="N"] can collide with another section's row that happens to share the same numeric id.
    click(p.w, `#sp-admin-shops [data-toggle="${newShop.id}"]`);
    await waitFor(() => newShop.status === 'INACTIVE', 'shop deactivated');
    check('deactivating a shop works and is audited', newShop.status === 'INACTIVE' && S.audit.some(l => l.action === 'SHOP_STATUS_CHANGE' && l.description.includes(newShop.code)));

    console.log('\n[5c] Deleting a shop keeps past attendance, only clears the shop link');
    {
        // an isolated temp shop + a fabricated past attendance record, so this doesn't disturb any other section's data
        const tempShop = { id: ++S.seq.shop, code: 'SHPTMP', name: 'Temp Shop', locality: null, region: null, address: null, phone: null,
            latitude: 1, longitude: 1, allowedRadiusMeters: 50, status: 'ACTIVE', assignedOfficerId: null };
        S.shops.push(tempShop);
        const tempAtt = { id: ++S.seq.att, userId: S.users[0].id, attendanceDate: '2026-09-01', checkInTime: '2026-09-01T09:00:00',
            checkInLatitude: 1, checkInLongitude: 1, checkInAccuracy: 10, checkInDistanceMeters: 5, status: 'PRESENT', shopId: tempShop.id, deviceInfo: null };
        S.atts.push(tempAtt);
        await p.w.SPApi.deleteShop(tempShop.id);
        check('shop delete removes the shop from the list', !S.shops.some(s => s.id === tempShop.id));
        check('but the old attendance record survives, just no longer linked to a shop', S.atts.some(a => a.id === tempAtt.id) && tempAtt.shopId === null);
        check('shop delete is audited', S.audit.some(l => l.action === 'SHOP_DELETE' && l.description.includes('SHPTMP')));
        S.atts = S.atts.filter(a => a.id !== tempAtt.id);   // clean up so later sections' S.atts.length assumptions still hold
    }

    console.log('\n[6] Admin: logout');
    click(p.w, '#supervisor-logout-btn');
    await waitFor(() => !p.w.SPApi.isLoggedIn(), 'token cleared');
    check('back on login page, token gone, LOGOUT audited', visible(p.d, 'login-view') && S.audit.some(l => l.action === 'LOGOUT' && l.userId === 1));
    check('token no longer accepted', await p.w.SPApi.me().then(() => false, e => e.status === 401));

    console.log('\n[7] Inactive account cannot sign in');
    await login(p, 'test.officer', 'NewSecret#9');
    await waitFor(() => /inactive/i.test(text(p.d, '#status')), 'inactive msg');
    check('inactive user blocked with a clear message', visible(p.d, 'login-view'));

    console.log('\n[8] Sales Officer: shop attendance (real GPS + live photo, backend-assigned shops)');
    const shp001 = S.shops.find(s => s.code === 'SHP001');   // Sri Ganesh Stores, Anna Nagar — assigned to Ravi (sales01)
    await login(p, 'sales01', 'Sales@123', 'owner');
    await waitFor(() => visible(p.d, 'so-dashboard-view'), 'SO dashboard');
    check('routes to Sales Officer dashboard from backend role (tab was Owner)', visible(p.d, 'so-dashboard-view'));
    await waitFor(() => p.d.querySelector('#so-attendance-status [data-act="in"]:not([disabled])'), 'check-in button');
    check('card shows NOT checked in + CHECK IN button', /Not checked in/.test(text(p.d, '#so-attendance-status')) && !!p.d.querySelector('#so-attendance-status [data-act="in"]'));

    check('plain (non-shop) check-in is rejected for a Sales Officer', await p.w.SPApi.checkIn({ latitude: shp001.latitude, longitude: shp001.longitude, accuracy: 10 }).then(() => false, e => e.status === 400 && e.code === 'SHOP_CHECKIN_REQUIRED'));

    await openShopPopup(p);
    check('CHECK IN opens the shop-visit popup (Login > Select Shop > GPS ON > Check Distance > Live Camera > Attendance)', visible2(p.d, 'so-attendance-overlay'));
    check('shop popup pre-selects the officer\'s own backend-assigned shop', p.d.getElementById('so-att-shop-select').value === shp001.code && text(p.d, '#so-att-shop-details').includes('Sri Ganesh Stores'));
    check('GPS requested with enableHighAccuracy / timeout 15000 / maximumAge 0', geo.calls.every(o => o.enableHighAccuracy === true && o.timeout === 15000 && o.maximumAge === 0));

    geo.next = { lat: shp001.latitude + 0.02, lng: shp001.longitude, acc: 10 };   // ~2.2 km from the shop
    p.w.simulateGPSVerification();
    await waitFor(() => /Too far from shop/i.test(text(p.d, '#so-att-gps-body')), 'outside message');
    check('outside the shop\'s geofence explained with distance + radius, Next disabled', /2\d{3}\.\d meters/.test(text(p.d, '#so-att-gps-body')) && /Within 50 meters/.test(text(p.d, '#so-att-gps-body')) && p.d.getElementById('so-att-next-btn').disabled);
    check('nothing was recorded while out of range', S.atts.length === 0);
    check('no "fix the shop location" override is offered for a backend shop', !p.d.querySelector('[onclick="correctShopLocationToCurrentGPS()"]'));

    geo.next = { lat: shp001.latitude, lng: shp001.longitude, acc: 450 };   // at the shop, but a weak GPS fix
    p.w.simulateGPSVerification();
    await waitFor(() => /too weak/i.test(text(p.d, '#so-att-gps-body')), 'accuracy message');
    check('poor GPS accuracy at the shop explained, Next still disabled', /450 m/.test(text(p.d, '#so-att-gps-body')) && p.d.getElementById('so-att-next-btn').disabled && S.atts.length === 0);

    for (const [code, re] of [[1, /permission denied/i], [3, /Could not fetch/i]]) {
        geo.next = { error: code };
        p.w.simulateGPSVerification();
        await waitFor(() => re.test(text(p.d, '#so-att-gps-body')), 'gps error ' + code);
        check(`GPS error code ${code} in the shop popup -> friendly message, nothing recorded`, S.atts.length === 0);
    }

    await shopCheckIn(p, { lat: shp001.latitude + 0.0003, lng: shp001.longitude, acc: 15 });   // ~35 m from the shop, well within its 50 m radius
    await waitFor(() => /Attendance marked at/.test(text(p.d, '#so-attendance-status')) && p.d.querySelector('#so-attendance-status [data-act="out"]'), 'checked in');
    const rec = S.atts[0];
    check('check-in stored by server with server-computed distance + shop + photo', S.atts.length === 1 && rec.checkInDistanceMeters > 20 && rec.checkInDistanceMeters < 50 && rec.shopId === shp001.id && S.photos.has(rec.id));
    check('card now offers CHECK OUT and shows CHECKED IN, with the shop name shown', /CHECKED IN/.test(text(p.d, '#so-attendance-status')) && !p.d.querySelector('#so-attendance-status [data-act="in"]') && /Sri Ganesh Stores/.test(text(p.d, '#so-attendance-status')));
    check('attendance status shown (Present/Late)', /Present|Late/.test(text(p.d, '#so-attendance-status')));
    check('duplicate shop check-in impossible from UI and rejected by server', await p.w.SPApi.shopCheckIn(new p.w.FormData()).then(() => false, e => e.status === 409 && e.code === 'ALREADY_CHECKED_IN'));

    geo.next = { lat: SITE.lat, lng: SITE.lng, acc: 9 };
    click(p.w, '#so-attendance-status [data-act="out"]');
    await waitFor(() => /COMPLETED/.test(text(p.d, '#so-attendance-status')), 'completed');
    check('check-out recorded, card shows COMPLETED, no buttons to repeat', !!S.atts[0].checkOutTime && !p.d.querySelector('#so-attendance-status [data-act="in"]') && !p.d.querySelector('#so-attendance-status [data-act="out"]'));
    check('second check-out rejected by server', await p.w.SPApi.checkOut({ latitude: SITE.lat, longitude: SITE.lng, accuracy: 10 }).then(() => false, e => e.code === 'ALREADY_CHECKED_OUT'));

    click(p.w, '#so-attendance-status [data-act="history"]');
    await waitFor(() => p.d.querySelectorAll('#sp-modal-body table.sp-table tbody tr').length === 1, 'history row');
    check('history modal shows the record with hours + shop + GPS', /Sri Ganesh Stores/.test(text(p.d, '#sp-modal-body')) && /9\.\d{5}, 78\.\d{5}/.test(text(p.d, '#sp-modal-body')));
    check('history row offers the saved check-in photo', !!p.d.querySelector('#sp-modal-body [data-photo]'));
    click(p.w, '#sp-h-xls'); click(p.w, '#sp-h-pdf');
    check('Excel export built from backend data', cap.xlsx.length === 1 && cap.xlsx[0].wb.Sheets.Attendance['A1'].v === 'My Attendance Report' &&
        XLSX.utils.sheet_to_json(cap.xlsx[0].wb.Sheets.Attendance, { header: 1 }).some(r => r[1] === 'Ravi'));
    check('PDF export built from backend data', cap.pdf.length === 1 && cap.pdf[0].bytes > 1500);
    click(p.w, '[data-photo]');
    await waitFor(() => /<img/.test(p.d.getElementById('sp-modal-body').innerHTML), 'photo shown');
    check('own check-in photo opens as an authenticated blob image', /<img/.test(p.d.getElementById('sp-modal-body').innerHTML));
    click(p.w, '.sp-modal-x');
    p.w.showSOAttendanceSummary();
    await waitFor(() => /This week/.test(text(p.d, '#mm-section-modal-overlay')), 'summary modal');
    check('SO week/month summary comes from /api/attendance/summary', /Present/.test(text(p.d, '#mm-section-modal-overlay')) && /Working days/.test(text(p.d, '#mm-section-modal-overlay')));
    p.w.document.getElementById('mm-section-modal-overlay').classList.remove('open');

    console.log('\n[9] Role scoping is enforced by the server (not just hidden in the UI)');
    check('SO cannot call the team report (403)', await p.w.SPApi.teamAttendance({}).then(() => false, e => e.status === 403));
    check('SO cannot call admin endpoints (403)', await p.w.SPApi.adminAttendance({}).then(() => false, e => e.status === 403));
    check('SO cannot read another user\'s summary (403 OUT_OF_SCOPE)', await p.w.SPApi.summary({ userId: 3 }).then(() => false, e => e.status === 403 && e.code === 'OUT_OF_SCOPE'));
    check('SO cannot create users (403)', await p.w.SPApi.createUser({ name: 'x', username: 'hack.er', password: 'abcdefgh1', role: 'ADMIN' }).then(() => false, e => e.status === 403));
    check('SO cannot list work-location admin view', await p.w.SPApi.setWorkLocationStatus(1, 'INACTIVE').then(() => false, e => e.status === 403));
    click(p.w, '#so-logout-btn');
    await waitFor(() => !p.w.SPApi.isLoggedIn(), 'so logout');
    check('SO logout returns to login and audits it', visible(p.d, 'login-view') && S.audit.some(l => l.action === 'LOGOUT' && l.userId === 7));

    console.log('\n[10] Manager sees only their own reporting tree');
    // sales03 (Kumar, Chennai, under ASM2) checks in at his assigned shop (SHP006, Kaveri Mart)
    const sales03 = S.users.find(u => u.username === 'sales03');
    const shp006 = S.shops.find(s => s.code === 'SHP006');
    await login(p, 'sales03', 'Sales@123'); await waitFor(() => visible(p.d, 'so-dashboard-view'), 'sales03');
    await waitFor(() => p.d.querySelector('#so-attendance-status [data-act="in"]:not([disabled])'), 'btn');
    await shopCheckIn(p, { lat: shp006.latitude, lng: shp006.longitude, acc: 20 });
    await waitFor(() => S.atts.some(a => a.userId === sales03.id), 'sales03 checked in');
    click(p.w, '#so-logout-btn'); await waitFor(() => !p.w.SPApi.isLoggedIn(), 'logout');

    await login(p, 'areasales01', 'Asm@123', 'so');
    await waitFor(() => visible(p.d, 'asm-dashboard-view'), 'ASM dashboard');
    check('ASM routed to ASM dashboard (tab was Sales Officer)', visible(p.d, 'asm-dashboard-view'));
    await waitFor(() => p.d.querySelector('[data-sp-att="asm"] [data-act="team"]'), 'team button');
    check('ASM dashboard has the GPS attendance card with CHECK IN', !!p.d.querySelector('[data-sp-att="asm"] [data-act="in"]'));
    click(p.w, '[data-sp-att="asm"] [data-act="team"]');
    await waitFor(() => /Attendance records/.test(text(p.d, '#sp-modal-body')), 'team report');
    const teamRows = () => p.d.querySelectorAll('#sp-modal-body table.sp-table')[0].querySelectorAll('tbody tr').length;
    check('ASM1 sees Ravi (own team) ...', /Ravi/.test(text(p.d, '#sp-modal-body')));
    check('... and NOT Kumar (ASM2\'s team)', !/Kumar/.test(text(p.d, '#sp-modal-body')), text(p.d, '#sp-modal-body').slice(0, 400));
    check('ASM1 team report lists only records from own tree (1 row: Ravi)', teamRows() === 1, teamRows());
    check('team employee filter only offers own tree', !Array.from(p.d.querySelectorAll('#sp-modal-body select option')).some(o => /Kumar|Arul/.test(o.textContent)));
    check('ASM cannot request another team\'s user (403)', await p.w.SPApi.teamAttendance({ userId: sales03.id }).then(() => false, e => e.status === 403 && e.code === 'OUT_OF_SCOPE'));
    check('ASM cannot use /api/admin (403)', await p.w.SPApi.adminAttendance({}).then(() => false, e => e.status === 403));
    click(p.w, '.sp-modal-x');
    // ASM checks in too, so the team export includes managers' own rows correctly
    geo.next = { lat: SITE.lat, lng: SITE.lng, acc: 8 }; click(p.w, '[data-sp-att="asm"] [data-act="in"]');
    await waitFor(() => /CHECKED IN/.test(text(p.d, '[data-sp-att="asm"]')), 'asm checked in');
    check('manager can check in with the same GPS flow', S.atts.some(a => a.userId === 5));
    click(p.w, '#asm-logout-btn'); await waitFor(() => !p.w.SPApi.isLoggedIn(), 'asm logout');

    await login(p, 'owner01', 'password123');
    await waitFor(() => visible(p.d, 'dashboard-view'), 'owner dashboard');
    await waitFor(() => p.d.querySelector('[data-sp-att="owner"] [data-act="team"]'), 'owner team btn');
    click(p.w, '[data-sp-att="owner"] [data-act="team"]');
    await waitFor(() => /Attendance records/.test(text(p.d, '#sp-modal-body')), 'owner team');
    check('Owner sees everyone (Ravi, Kumar, Karthik)', ['Ravi', 'Kumar', 'Karthik Raja'].every(n => text(p.d, '#sp-modal-body').includes(n)));
    click(p.w, '#sp-modal-body [id$="xls"]'); click(p.w, '#sp-modal-body [id$="pdf"]');
    check('team Excel has a summary-by-employee sheet', cap.xlsx.length === 2 && !!cap.xlsx[1].wb.Sheets['Summary by employee']);
    check('team PDF generated', cap.pdf.length === 2);
    click(p.w, '.sp-modal-x');
    click(p.w, '#logout-btn'); await waitFor(() => !p.w.SPApi.isLoggedIn(), 'owner logout');

    console.log('\n[10b] Marketing Manager and Regional Manager dashboards');
    for (const [user, pass, view, host] of [['marketing01', 'password123', 'rsm-dashboard-view', 'rsm'], ['regional01', 'password123', 'rm-dashboard-view', 'rm']]) {
        await login(p, user, pass, 'so');
        await waitFor(() => visible(p.d, view), user + ' dashboard');
        await waitFor(() => p.d.querySelector(`[data-sp-att="${host}"] [data-act="in"]:not([disabled])`), user + ' card');
        check(`${user}: routed by backend role, GPS card + Team button present`, visible(p.d, view) && !!p.d.querySelector(`[data-sp-att="${host}"] [data-act="team"]`));
        click(p.w, `[data-sp-att="${host}"] [data-act="team"]`);
        await waitFor(() => /Attendance records/.test(text(p.d, '#sp-modal-body')), user + ' team');
        check(`${user}: team report covers the whole subtree below them (Ravi and Kumar)`, /Ravi/.test(text(p.d, '#sp-modal-body')) && /Kumar/.test(text(p.d, '#sp-modal-body')));
        check(`${user}: cannot ask for someone above them (owner) - 403 OUT_OF_SCOPE`, await p.w.SPApi.teamAttendance({ userId: 2 }).then(() => false, e => e.status === 403 && e.code === 'OUT_OF_SCOPE'));
        click(p.w, '.sp-modal-x');
        click(p.w, `#${host}-logout-btn`); await waitFor(() => !p.w.SPApi.isLoggedIn(), user + ' logout');
    }

    console.log('\n[11] Admin: attendance report, correction, audit log');
    await login(p, 'Admin', 'Admin@123', 'sup'); await waitFor(() => visible(p.d, 'supervisor-dashboard-view'), 'admin again');
    p.w.supShowSection('attendance');
    await waitFor(() => /Attendance records/.test(text(p.d, '#sp-admin-attendance')), 'admin report');
    check('admin report lists today\'s check-ins for all staff', ['Ravi', 'Kumar', 'Karthik Raja'].every(n => text(p.d, '#sp-admin-attendance').includes(n)));
    check('KPIs present (working days / present / absent / late / half day / hours)', ['Working days', 'Present', 'Absent', 'Late', 'Half day', 'Total hours'].every(k => text(p.d, '#sp-admin-attendance').includes(k)));
    const ravi = S.atts.find(a => a.userId === 7);
    click(p.w, `[data-correct="${ravi.id}"]`);
    check('correction without a reason is refused in the UI', await (async () => { click(p.w, '#sp-c-save'); await sleep(40); return /give a reason/.test(text(p.d, '#sp-c-err')) && !ravi.correctionReason; })());
    type(p.w, '#sp-c-reason', 'Forgot to check out, confirmed by ASM'); click(p.w, '#sp-c-save');
    await waitFor(() => ravi.correctionReason, 'corrected');
    check('correction stored with reason and audited', /Forgot to check out/.test(ravi.correctionReason) && S.audit.some(l => l.action === 'ATTENDANCE_CORRECTION' && /Forgot to check out/.test(l.description)));
    p.w.supShowSection('audit');
    await waitFor(() => /CHECK IN/.test(text(p.d, '#sp-admin-audit')), 'audit list');
    check('audit log shows logins, check-ins, corrections, user changes', ['LOGIN', 'CHECK IN', 'CHECK OUT', 'ATTENDANCE CORRECTION', 'USER CREATE', 'PASSWORD RESET'].every(a => text(p.d, '#sp-admin-audit').includes(a)));
    p.w.supShowSection('settings');
    await waitFor(() => /Attendance policy/.test(text(p.d, '#sp-admin-settings')), 'settings');
    check('settings show the server policy', /09:30/.test(text(p.d, '#sp-admin-settings')) && /SUNDAY/.test(text(p.d, '#sp-admin-settings')));

    console.log('\n[11b] Admin previewing role dashboards');
    for (const fn of ['goToOwnerAsSupervisor', 'goToRSMAsSupervisor', 'goToRMAsSupervisor', 'goToASMAsSupervisor', 'goToSOAsSupervisor']) {
        let err = null; try { p.w[fn](); } catch (e) { err = e; }
        check(`${fn}() opens without errors and still signed in as Admin`, !err && p.w.SPApi.user().role === 'ADMIN', err && String(err));
        const back = p.d.querySelector('.view.active [id$="logout-btn"]');
        if (back) back.click();
        await sleep(20);
        check(`${fn}: Back returns to Admin console without signing out`, p.w.SPApi.isLoggedIn() && visible(p.d, 'supervisor-dashboard-view'));
    }

    console.log('\n[12] Change password (was a fake alert before)');
    p.w.SPBridge.changePassword('sp-set-old', 'sp-set-new', 'sp-set-conf');
    type(p.w, '#sp-set-old', 'nope-wrong'); type(p.w, '#sp-set-new', 'Brand#New99'); type(p.w, '#sp-set-conf', 'Brand#New99');
    cap.alerts.length = 0; p.w.SPBridge.changePassword('sp-set-old', 'sp-set-new', 'sp-set-conf');
    await waitFor(() => cap.alerts.some(a => /current password is not correct/.test(a)), 'wrong current pw');
    check('wrong current password refused by backend', S.users[0].password === 'Admin@123');
    type(p.w, '#sp-set-old', 'Admin@123'); type(p.w, '#sp-set-new', 'Brand#New99'); type(p.w, '#sp-set-conf', 'Brand#New99');
    p.w.SPBridge.changePassword('sp-set-old', 'sp-set-new', 'sp-set-conf');
    await waitFor(() => S.users[0].password === 'Brand#New99', 'pw changed');
    check('password changed in backend, old one no longer works', S.users[0].password === 'Brand#New99');
    p.w.SPApi.setSessionForTest = null;

    console.log('\n[13] Expired / revoked session');
    mock.invalidateTokens();
    await p.w.SPApi.me().catch(() => {});
    await waitFor(() => visible(p.d, 'login-view'), 'forced back to login');
    check('401 on a protected call sends the user to login with a message', /session|sign in/i.test(text(p.d, '#status')) && !p.w.SPApi.isLoggedIn());

    console.log('\n[14] Server down');
    mock.server.close();
    await login(p, 'Admin', 'Brand#New99', 'sup');
    await waitFor(() => /Cannot reach the server/.test(text(p.d, '#status')), 'network msg');
    check('network failure shows a friendly message', visible(p.d, 'login-view'));

    const jsErrors = p.errors.filter(e => !/Not implemented|Could not parse CSS|Could not load|Failed to load|net::|getContext|leaflet|L is not defined/i.test(e));
    console.log('\n[15] Uncaught script errors during the whole run: ' + jsErrors.length);
    jsErrors.slice(0, 8).forEach(e => console.log('   ! ' + e.split('\n')[0]));
    check('no uncaught errors from the portal or bridge scripts', jsErrors.length === 0, jsErrors.slice(0, 3));

    console.log(`\n==== ${pass} passed, ${fail} failed ====`);
    if (fail) { console.log('Failed:\n - ' + failures.join('\n - ')); }
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST HARNESS ERROR:', e); process.exit(2); });
