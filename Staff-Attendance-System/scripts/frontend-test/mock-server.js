/* Mock of the Spring Boot API (same URLs, JSON shapes, error codes, role/scope rules
 * and geofence maths) plus a static file server for ../../frontend.
 *
 * It exists ONLY so the browser code can be exercised without MySQL/Maven. It is NOT
 * the real backend and proves nothing about the Java code. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FRONTEND = path.resolve(__dirname, '../../attendance/src/main/resources/static');
const IST = 'Asia/Kolkata';

function istParts(d) {
    const f = new Intl.DateTimeFormat('en-CA', {
        timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(d || new Date());
    const o = {}; f.forEach(p => { o[p.type] = p.value; });
    return o;
}
const nowLdt = () => { const p = istParts(); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; };
const todayIso = () => nowLdt().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = iso => new Date(iso + 'T00:00:00Z').getUTCDay();
const hm = m => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, r = x => x * Math.PI / 180;
    const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function createMock() {
    const S = { seq: { user: 0, att: 0, loc: 0, audit: 0, shop: 0 }, users: [], atts: [], locs: [], shops: [], photos: new Map(), audit: [], tokens: new Map(), maxAcc: 100 };
    const settings = { timezone: IST, shiftStart: '09:30', lateGraceMinutes: 15, halfDayMinutes: 240, maxAccuracyMeters: 100, weeklyOff: 'SUNDAY' };

    function addUser(code, name, username, password, role, designation, area, region, mgr) {
        const u = { id: ++S.seq.user, employeeCode: code, name, username, password, email: null, phone: null, role, designation, area, region,
            status: 'ACTIVE', reportingManagerId: mgr ? mgr.id : null, createdAt: '2026-01-01T00:00:00', updatedAt: '2026-01-01T00:00:00' };
        S.users.push(u); return u;
    }
    const admin = addUser('ADM001', 'Administrator', 'Admin', 'Admin@123', 'ADMIN', null, null, null, null);
    const owner = addUser('OWN001', 'Rajesh Sharma', 'owner01', 'password123', 'OWNER', 'Owner', null, null, null);
    const rsm = addUser('RSM001', 'Ramesh Kumar', 'marketing01', 'password123', 'RSM', 'Marketing Manager', null, null, owner);
    const rm = addUser('RM001', 'Suresh Babu', 'regional01', 'password123', 'RM', 'Regional Manager', null, 'South', rsm);
    const asm1 = addUser('ASM001', 'Karthik Raja', 'areasales01', 'Asm@123', 'ASM', 'Area Sales Manager', 'Madurai', 'South', rm);
    const asm2 = addUser('ASM002', 'Arul Prakash', 'areasales02', 'Asm@123', 'ASM', 'Area Sales Manager', 'Chennai', 'North', rm);
    addUser('SO001', 'Ravi', 'sales01', 'Sales@123', 'SO', 'Sales Officer', 'Madurai', 'South', asm1);
    addUser('SO002', 'Murugan', 'sales02', 'Sales@123', 'SO', 'Sales Officer', 'Theni', 'South', asm1);
    addUser('SO003', 'Kumar', 'sales03', 'Sales@123', 'SO', 'Sales Officer', 'Chennai', 'North', asm2);
    const soByName = n => S.users.find(u => u.role === 'SO' && u.name === n);
    const addShop = (code, name, locality, region, address, lat, lng, officer) => S.shops.push({ id: ++S.seq.shop, code, name, locality, region, address, phone: null,
        latitude: lat, longitude: lng, allowedRadiusMeters: 50, status: 'ACTIVE', assignedOfficerId: officer ? officer.id : null });
    addShop('SHP001', 'Sri Ganesh Stores', 'Anna Nagar', 'North', 'Anna Nagar, Madurai - 625020', 9.9382, 78.0878, soByName('Ravi'));
    addShop('SHP002', 'Spartan Capital Enterprises', 'Kochadai', 'West', '16/1, Virudhachalam Street, Natraj Nagar, Kochadai Main Road, Madurai - 625016', 9.9354, 78.0918, soByName('Ravi'));
    addShop('SHP004', 'Vetri Provisions', 'Rajaji Nagar', 'South', 'Rajaji Nagar, Theni', 10.0104, 77.4768, soByName('Murugan'));
    addShop('SHP006', 'Kaveri Mart', 'T. Nagar', 'South', 'T. Nagar, Chennai', 13.0418, 80.2341, soByName('Kumar'));
    S.locs.push({ id: ++S.seq.loc, name: 'Madurai HQ', address: 'Test site', latitude: 9.9252, longitude: 78.1198, allowedRadiusMeters: 200, status: 'ACTIVE' });

    const pub = u => { const m = S.users.find(x => x.id === u.reportingManagerId);
        const { password, ...rest } = u; return { ...rest, reportingManagerName: m ? m.name : null }; };

    function log(userId, action, description, req) {
        S.audit.unshift({ id: ++S.seq.audit, userId, action, description, ipAddress: '127.0.0.1', userAgent: 'test', timestamp: nowLdt() });
    }
    const descendants = id => {
        const out = new Set([id]); let grew = true;
        while (grew) { grew = false; S.users.forEach(u => { if (u.reportingManagerId && out.has(u.reportingManagerId) && !out.has(u.id)) { out.add(u.id); grew = true; } }); }
        return out;
    };
    const scopeIds = u => (u.role === 'ADMIN' || u.role === 'OWNER') ? null : (u.role === 'SO' ? new Set([u.id]) : descendants(u.id));

    const shopResp = sh => { const o = S.users.find(u => u.id === sh.assignedOfficerId); return { ...sh, assignedOfficerName: o ? o.name : null }; };

    class ApiErr extends Error { constructor(status, code, message, details) { super(message); Object.assign(this, { status, code, details }); } }
    const bad = (code, msg, d) => new ApiErr(400, code, msg, d);

    const attResp = (a, technical) => {
        const u = S.users.find(x => x.id === a.userId), w = S.locs.find(x => x.id === a.workLocationId), sh = S.shops.find(x => x.id === a.shopId);
        return { id: a.id, userId: u.id, employeeCode: u.employeeCode, employeeName: u.name, role: u.role, attendanceDate: a.attendanceDate,
            checkInTime: a.checkInTime, checkOutTime: a.checkOutTime || null, checkInLatitude: a.checkInLatitude, checkInLongitude: a.checkInLongitude,
            checkOutLatitude: a.checkOutLatitude ?? null, checkOutLongitude: a.checkOutLongitude ?? null, checkInAccuracy: a.checkInAccuracy,
            checkOutAccuracy: a.checkOutAccuracy ?? null, checkInDistanceMeters: a.checkInDistanceMeters, checkOutDistanceMeters: a.checkOutDistanceMeters ?? null,
            totalWorkingMinutes: a.totalWorkingMinutes ?? null, workingHours: a.checkOutTime ? hm(a.totalWorkingMinutes || 0) : null, status: a.status,
            workLocationId: w ? w.id : null, workLocationName: w ? w.name : null, allowedRadiusMeters: w ? w.allowedRadiusMeters : (sh ? sh.allowedRadiusMeters : null),
            shopId: sh ? sh.id : null, shopCode: sh ? sh.code : null, shopName: sh ? sh.name : null, hasPhoto: S.photos.has(a.id),
            deviceInfo: technical ? a.deviceInfo : null, ipAddress: technical ? '127.0.0.1' : null, correctionReason: a.correctionReason || null, correctedAt: a.correctedAt || null };
    };

    function validateFix(b) {
        if (typeof b.latitude !== 'number' || typeof b.longitude !== 'number' || typeof b.accuracy !== 'number')
            throw bad('VALIDATION_FAILED', 'latitude, longitude and accuracy are required');
        if ((b.latitude === 0 && b.longitude === 0) || Math.abs(b.latitude) > 90 || Math.abs(b.longitude) > 180 || b.accuracy < 0) throw bad('INVALID_GPS', 'Invalid GPS fix');
        if (b.accuracy > S.maxAcc) throw bad('POOR_GPS_ACCURACY', 'GPS accuracy too poor', { accuracyMeters: b.accuracy, maxAccuracyMeters: S.maxAcc });
    }
    function validateGps(b) {
        validateFix(b);
        const active = S.locs.filter(l => l.status === 'ACTIVE');
        if (!active.length) throw new ApiErr(409, 'NO_WORK_LOCATION', 'No work location configured');
        let nearest = null, nd = Infinity, inside = null, insideD = Infinity;
        active.forEach(l => { const d = haversine(b.latitude, b.longitude, l.latitude, l.longitude);
            if (d < nd) { nd = d; nearest = l; } if (d <= l.allowedRadiusMeters && d < insideD) { insideD = d; inside = l; } });
        if (!inside) throw bad('OUTSIDE_GEOFENCE', 'Outside the permitted area', { distanceMeters: Math.round(nd), allowedRadiusMeters: nearest.allowedRadiusMeters, workLocationId: nearest.id, workLocationName: nearest.name });
        return { loc: inside, dist: Math.round(insideD * 10) / 10 };
    }
    function statusFor(inLdt) { const [h, m] = inLdt.slice(11, 16).split(':').map(Number); return (h * 60 + m) > (9 * 60 + 30 + 15) ? 'LATE' : 'PRESENT'; }

    function summary(caller, q) {
        const ids = scopeIds(caller);
        const from = q.from || todayIso(), to = q.to || todayIso(), today = todayIso();
        if (q.userId && ids && !ids.has(Number(q.userId))) throw new ApiErr(403, 'OUT_OF_SCOPE', 'Outside your team');
        let emps = S.users.filter(u => u.role !== 'ADMIN' && u.status === 'ACTIVE' && (!ids || ids.has(u.id)) &&
            (!q.userId || u.id === Number(q.userId)) && (!q.role || u.role === q.role));
        const employees = emps.map(u => {
            const mine = S.atts.filter(a => a.userId === u.id && a.attendanceDate >= from && a.attendanceDate <= to);
            let wd = 0; for (let d = from; d <= to && d <= today; d = addDays(d, 1)) { if (dow(d) !== 0 && (d < today || mine.some(a => a.attendanceDate === d))) wd++; }
            const present = mine.filter(a => a.status !== 'ABSENT').length;
            const mins = mine.reduce((t, a) => t + (a.totalWorkingMinutes || 0), 0);
            return { userId: u.id, employeeCode: u.employeeCode, name: u.name, role: u.role, workingDays: wd, present,
                absent: Math.max(0, wd - present), late: mine.filter(a => a.status === 'LATE').length, halfDay: mine.filter(a => a.status === 'HALF_DAY').length,
                totalWorkingMinutes: mins, totalWorkingHours: hm(mins) };
        });
        const sum = k => employees.reduce((t, e) => t + e[k], 0);
        return { from, to, totalWorkingDays: Math.max(0, ...employees.map(e => e.workingDays), 0), present: sum('present'), absent: sum('absent'), late: sum('late'),
            halfDay: sum('halfDay'), totalWorkingMinutes: sum('totalWorkingMinutes'), totalWorkingHours: hm(sum('totalWorkingMinutes')), employees };
    }

    function report(caller, q, technical) {
        const ids = scopeIds(caller);
        if (q.userId && ids && !ids.has(Number(q.userId))) throw new ApiErr(403, 'OUT_OF_SCOPE', 'Outside your team');
        const from = q.from || todayIso(), to = q.to || todayIso();
        return S.atts.filter(a => (!ids || ids.has(a.userId)) && a.attendanceDate >= from && a.attendanceDate <= to &&
            (!q.userId || a.userId === Number(q.userId)) && (!q.status || a.status === q.status) &&
            (!q.workLocationId || a.workLocationId === Number(q.workLocationId)) &&
            (!q.role || S.users.find(u => u.id === a.userId).role === q.role))
            .sort((x, y) => y.attendanceDate.localeCompare(x.attendanceDate) || x.id - y.id).map(a => attResp(a, technical));
    }

    // -------------------- routing --------------------
    function handle(method, url, body, caller) {
        const [p, qs] = url.split('?'); const q = Object.fromEntries(new URLSearchParams(qs || ''));
        const need = (...roles) => { if (!roles.includes(caller.role)) throw new ApiErr(403, 'ACCESS_DENIED', 'You do not have permission to do that.'); };
        let m;

        if (method === 'POST' && p === '/api/auth/logout') { log(caller.id, 'LOGOUT', 'Signed out'); return [204]; }
        if (method === 'GET' && p === '/api/auth/me') return [200, pub(caller)];
        if (method === 'POST' && p === '/api/auth/change-password') {
            if (caller.password !== body.currentPassword) throw bad('WRONG_CURRENT_PASSWORD', 'Your current password is not correct.');
            if (!body.newPassword || body.newPassword.length < 8) throw bad('VALIDATION_FAILED', 'Password must be 8-72 characters');
            caller.password = body.newPassword; log(caller.id, 'PASSWORD_CHANGE', 'Changed own password'); return [204];
        }
        if (method === 'GET' && p === '/api/attendance/today') {
            const a = S.atts.find(x => x.userId === caller.id && x.attendanceDate === todayIso());
            return [200, { date: todayIso(), state: !a ? 'NOT_CHECKED_IN' : (a.checkOutTime ? 'COMPLETED' : 'CHECKED_IN'), attendance: a ? attResp(a, false) : null,
                workLocations: S.locs.filter(l => l.status === 'ACTIVE'), maxAccuracyMeters: S.maxAcc }];
        }
        if (method === 'POST' && p === '/api/attendance/shop-check-in') {
            need('SO');
            if (S.atts.find(x => x.userId === caller.id && x.attendanceDate === todayIso())) throw new ApiErr(409, 'ALREADY_CHECKED_IN', 'Already checked in today');
            const f = body.fields, shop = S.shops.find(x => x.id === Number(f.shopId));
            if (!shop) throw new ApiErr(404, 'NOT_FOUND', 'Shop not found.');
            if (shop.status !== 'ACTIVE' || shop.assignedOfficerId !== caller.id) throw new ApiErr(403, 'SHOP_NOT_ASSIGNED', 'That shop is not assigned to you.');
            const gps = { latitude: Number(f.latitude), longitude: Number(f.longitude), accuracy: Number(f.accuracy) };
            validateFix(gps);
            const dist = haversine(gps.latitude, gps.longitude, shop.latitude, shop.longitude);
            if (dist > shop.allowedRadiusMeters) throw bad('OUTSIDE_GEOFENCE', `You are ${Math.round(dist)} m from ${shop.name}.`,
                { distanceMeters: Math.round(dist), allowedRadiusMeters: shop.allowedRadiusMeters, shopId: shop.id, shopName: shop.name });
            const ph = body.files.photo;
            if (!ph || !ph.data.length) throw bad('PHOTO_REQUIRED', 'A live photo of the shop is required to mark attendance.');
            const d = ph.data, isJpeg = d[0] === 0xFF && d[1] === 0xD8 && d[2] === 0xFF, isPng = d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4E && d[3] === 0x47;
            if (!isJpeg && !isPng) throw bad('INVALID_PHOTO', 'The photo must be a JPEG, PNG or WebP image.');
            if (d.length > 5 * 1024 * 1024) throw bad('PHOTO_TOO_LARGE', 'That photo is too large.');
            const t = nowLdt();
            const a = { id: ++S.seq.att, userId: caller.id, attendanceDate: t.slice(0, 10), checkInTime: t, checkInLatitude: gps.latitude, checkInLongitude: gps.longitude,
                checkInAccuracy: gps.accuracy, checkInDistanceMeters: Math.round(dist * 10) / 10, status: statusFor(t), shopId: shop.id, deviceInfo: f.deviceInfo };
            S.atts.push(a); S.photos.set(a.id, { data: d, type: isPng ? 'image/png' : 'image/jpeg' });
            log(caller.id, 'CHECK_IN', `Checked in at shop ${shop.code} '${shop.name}', ${Math.round(dist)} m, live photo saved`); return [201, attResp(a, false)];
        }
        if (method === 'GET' && (m = /^\/api\/attendance\/(\d+)\/photo$/.exec(p))) {
            const a = S.atts.find(x => x.id === Number(m[1])); if (!a) throw new ApiErr(404, 'NOT_FOUND', 'Attendance record not found.');
            const ids = scopeIds(caller); if (ids && !ids.has(a.userId)) throw new ApiErr(403, 'OUT_OF_SCOPE', 'You can only view people who report to you.');
            const ph = S.photos.get(a.id); if (!ph) throw new ApiErr(404, 'NOT_FOUND', 'There is no photo for this record.');
            return [200, ph.data, ph.type];
        }
        if (method === 'GET' && p === '/api/shops/mine') { need('SO'); return [200, S.shops.filter(x => x.status === 'ACTIVE' && x.assignedOfficerId === caller.id).map(shopResp)]; }
        if (method === 'POST' && p === '/api/attendance/check-in') {
            if (caller.role === 'SO') throw bad('SHOP_CHECKIN_REQUIRED', 'Sales Officers mark attendance at one of their assigned shops, with a live photo of the shop.');
            if (S.atts.find(x => x.userId === caller.id && x.attendanceDate === todayIso())) throw new ApiErr(409, 'ALREADY_CHECKED_IN', 'Already checked in today');
            const { loc, dist } = validateGps(body); const t = nowLdt();
            const a = { id: ++S.seq.att, userId: caller.id, attendanceDate: t.slice(0, 10), checkInTime: t, checkInLatitude: body.latitude, checkInLongitude: body.longitude,
                checkInAccuracy: body.accuracy, checkInDistanceMeters: dist, status: statusFor(t), workLocationId: loc.id, deviceInfo: body.deviceInfo };
            S.atts.push(a); log(caller.id, 'CHECK_IN', `Checked in at ${loc.name}, ${dist} m`); return [201, attResp(a, false)];
        }
        if (method === 'POST' && p === '/api/attendance/check-out') {
            const a = S.atts.find(x => x.userId === caller.id && x.attendanceDate === todayIso());
            if (!a) throw bad('NOT_CHECKED_IN', 'No check-in today');
            if (a.checkOutTime) throw new ApiErr(409, 'ALREADY_CHECKED_OUT', 'Already checked out');
            let dist = null;
            if (caller.role === 'SO') validateFix(body); else dist = validateGps(body).dist;
            const t = nowLdt();
            Object.assign(a, { checkOutTime: t, checkOutLatitude: body.latitude, checkOutLongitude: body.longitude, checkOutAccuracy: body.accuracy, checkOutDistanceMeters: dist,
                totalWorkingMinutes: Math.max(1, Math.round((new Date(t) - new Date(a.checkInTime)) / 60000)) });
            log(caller.id, 'CHECK_OUT', `Checked out${dist == null ? '' : ', ' + dist + ' m'}`); return [200, attResp(a, false)];
        }
        if (method === 'GET' && p === '/api/attendance/my') return [200, report({ ...caller, role: 'SO' }, { ...q, userId: undefined }, false)];
        if (method === 'GET' && p === '/api/attendance/team') { need('ADMIN', 'OWNER', 'RSM', 'RM', 'ASM'); return [200, report(caller, q, caller.role === 'ADMIN')]; }
        if (method === 'GET' && p === '/api/attendance/summary') return [200, summary(caller, q)];

        if (p.startsWith('/api/admin/')) need('ADMIN');
        if (method === 'GET' && p === '/api/admin/attendance') return [200, report(caller, q, true)];
        if (method === 'GET' && p === '/api/admin/settings') return [200, settings];
        if (method === 'GET' && p === '/api/admin/shops') return [200, S.shops.filter(x => (q.includeInactive !== 'false' || x.status === 'ACTIVE') && (!q.officerId || x.assignedOfficerId === Number(q.officerId))).map(shopResp)];
        if (p.startsWith('/api/admin/shops') && method !== 'GET') {
            const officerOk = id => { if (id == null) return; const o = S.users.find(u => u.id === id);
                if (!o) throw bad('INVALID_OFFICER', 'The selected officer does not exist.');
                if (o.role !== 'SO' || o.status !== 'ACTIVE') throw bad('INVALID_OFFICER', 'A shop can only be assigned to an active Sales Officer.'); };
            const check = b => {
                if (!b.name || !String(b.name).trim()) throw bad('VALIDATION_FAILED', 'Shop name is required');
                if (typeof b.latitude !== 'number' || typeof b.longitude !== 'number') throw bad('VALIDATION_FAILED', 'latitude and longitude are required');
                if (b.allowedRadiusMeters != null && (b.allowedRadiusMeters < 10 || b.allowedRadiusMeters > 500)) throw bad('VALIDATION_FAILED', 'Radius must be between 10 and 500 m');
                officerOk(b.assignedOfficerId);
            };
            if (method === 'POST' && p === '/api/admin/shops') {
                check(body);
                const code = (body.code && body.code.trim()) ? body.code.trim().toUpperCase() : 'SHP' + String(S.shops.length + 1).padStart(3, '0');
                if (S.shops.some(x => x.code.toUpperCase() === code)) throw new ApiErr(409, 'SHOP_CODE_TAKEN', `A shop with the code ${code} already exists.`);
                const sh = { id: ++S.seq.shop, code, name: body.name.trim(), locality: body.locality || null, region: body.region || null, address: body.address || null, phone: body.phone || null,
                    latitude: body.latitude, longitude: body.longitude, allowedRadiusMeters: body.allowedRadiusMeters == null ? 50 : body.allowedRadiusMeters,
                    status: body.status || 'ACTIVE', assignedOfficerId: body.assignedOfficerId == null ? null : body.assignedOfficerId };
                S.shops.push(sh); log(caller.id, 'SHOP_CREATE', `Created shop ${sh.code} '${sh.name}'`); return [201, shopResp(sh)];
            }
            if ((m = /^\/api\/admin\/shops\/(\d+)$/.exec(p)) && method === 'PUT') {
                const sh = S.shops.find(x => x.id === Number(m[1])); if (!sh) throw new ApiErr(404, 'NOT_FOUND', 'Shop not found.');
                check(body);
                const code = (body.code && body.code.trim()) ? body.code.trim().toUpperCase() : sh.code;
                if (S.shops.some(x => x.id !== sh.id && x.code.toUpperCase() === code)) throw new ApiErr(409, 'SHOP_CODE_TAKEN', `A shop with the code ${code} already exists.`);
                Object.assign(sh, { code, name: body.name.trim(), locality: body.locality || null, region: body.region || null, address: body.address || null, phone: body.phone || null,
                    latitude: body.latitude, longitude: body.longitude, allowedRadiusMeters: body.allowedRadiusMeters == null ? 50 : body.allowedRadiusMeters,
                    assignedOfficerId: body.assignedOfficerId == null ? null : body.assignedOfficerId });
                if (body.status) sh.status = body.status;
                log(caller.id, 'SHOP_UPDATE', `Updated shop ${sh.code}`); return [200, shopResp(sh)];
            }
            if ((m = /^\/api\/admin\/shops\/(\d+)\/status$/.exec(p)) && method === 'PATCH') {
                const sh = S.shops.find(x => x.id === Number(m[1])); if (!sh) throw new ApiErr(404, 'NOT_FOUND', 'Shop not found.');
                sh.status = body.status; log(caller.id, 'SHOP_STATUS_CHANGE', `Shop ${sh.code} -> ${sh.status}`); return [200, shopResp(sh)];
            }
            if ((m = /^\/api\/admin\/shops\/(\d+)$/.exec(p)) && method === 'DELETE') {
                const sh = S.shops.find(x => x.id === Number(m[1])); if (!sh) throw new ApiErr(404, 'NOT_FOUND', 'Shop not found.');
                let cleared = 0;
                S.atts.forEach(a => { if (a.shopId === sh.id) { a.shopId = null; cleared++; } });
                log(caller.id, 'SHOP_DELETE', `Deleted shop ${sh.code} '${sh.name}' (${cleared} past attendance record(s) kept, no longer linked to a shop)`);
                S.shops = S.shops.filter(x => x.id !== sh.id);
                return [204];
            }
        }
        if ((m = /^\/api\/admin\/attendance(?:\/(\d+))?$/.exec(p)) && (method === 'PUT' || method === 'POST')) {
            if (!body.reason || body.reason.trim().length < 5) throw bad('VALIDATION_FAILED', 'Reason must be 5-500 characters');
            let a;
            if (method === 'PUT') { a = S.atts.find(x => x.id === Number(m[1])); if (!a) throw new ApiErr(404, 'NOT_FOUND', 'Attendance record not found.'); }
            else { if (S.atts.find(x => x.userId === body.userId && x.attendanceDate === body.date)) throw new ApiErr(409, 'ALREADY_EXISTS', 'Already has a record');
                a = { id: ++S.seq.att, userId: body.userId, attendanceDate: body.date, status: 'PRESENT' }; S.atts.push(a); }
            if (body.checkInTime) a.checkInTime = body.checkInTime.length === 16 ? body.checkInTime + ':00' : body.checkInTime;
            a.checkOutTime = body.checkOutTime || null;
            if (a.checkInTime && a.checkOutTime) a.totalWorkingMinutes = Math.round((new Date(a.checkOutTime) - new Date(a.checkInTime)) / 60000);
            a.status = body.status || (a.totalWorkingMinutes != null && a.totalWorkingMinutes < 240 ? 'HALF_DAY' : statusFor(a.checkInTime || todayIso() + 'T09:00:00'));
            a.correctionReason = body.reason.trim(); a.correctedAt = nowLdt();
            log(caller.id, 'ATTENDANCE_CORRECTION', `${method === 'PUT' ? 'Corrected' : 'Created'} attendance #${a.id}. Reason: ${a.correctionReason}`);
            return [200, attResp(a, true)];
        }
        if (method === 'GET' && p === '/api/admin/audit-logs') {
            const size = Number(q.size || 50), page = Number(q.page || 0);
            const all = S.audit.filter(l => (!q.userId || l.userId === Number(q.userId)) && (!q.action || l.action === q.action));
            return [200, { content: all.slice(page * size, page * size + size).map(l => ({ ...l, userName: (S.users.find(u => u.id === l.userId) || {}).name || null })),
                page, size, totalElements: all.length, totalPages: Math.ceil(all.length / size) }];
        }

        if (method === 'GET' && p === '/api/users') { const ids = scopeIds(caller); return [200, S.users.filter(u => !ids || ids.has(u.id)).map(pub)]; }
        if (p.startsWith('/api/users') && method !== 'GET') need('ADMIN');
        if (method === 'POST' && p === '/api/users') {
            if (!body.name || !body.username || !body.password || !body.role) throw bad('VALIDATION_FAILED', 'Name, username, password and role are required');
            if (body.password.length < 8) throw bad('VALIDATION_FAILED', 'Password must be 8-72 characters');
            if (S.users.find(u => u.username.toLowerCase() === body.username.toLowerCase())) throw new ApiErr(409, 'USERNAME_TAKEN', 'That username is already taken.');
            const u = addUser(body.employeeCode || `${body.role}${String(S.seq.user + 1).padStart(3, '0')}`, body.name, body.username, body.password, body.role,
                body.designation, body.area, body.region, S.users.find(x => x.id === body.reportingManagerId));
            log(caller.id, 'USER_CREATE', `Created ${u.username}`); return [200, pub(u)];
        }
        if ((m = /^\/api\/users\/(\d+)$/.exec(p)) && method === 'PUT') {
            const u = S.users.find(x => x.id === Number(m[1])); Object.assign(u, { name: body.name, username: body.username, role: body.role, designation: body.designation,
                area: body.area, region: body.region, reportingManagerId: body.reportingManagerId }); log(caller.id, 'USER_UPDATE', `Updated ${u.username}`); return [200, pub(u)];
        }
        if ((m = /^\/api\/users\/(\d+)\/status$/.exec(p)) && method === 'PATCH') {
            const u = S.users.find(x => x.id === Number(m[1]));
            if (u.id === caller.id) throw bad('CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account.');
            u.status = body.status; log(caller.id, 'USER_STATUS_CHANGE', `${u.username} -> ${u.status}`); return [200, pub(u)];
        }
        if ((m = /^\/api\/users\/(\d+)\/reset-password$/.exec(p)) && method === 'POST') {
            const u = S.users.find(x => x.id === Number(m[1])); u.password = body.newPassword; log(caller.id, 'PASSWORD_RESET', `Reset password of ${u.username}`); return [204];
        }
        if ((m = /^\/api\/users\/(\d+)$/.exec(p)) && method === 'DELETE') {
            const u = S.users.find(x => x.id === Number(m[1])); if (!u) throw new ApiErr(404, 'NOT_FOUND', 'User not found.');
            if (u.id === caller.id) throw bad('CANNOT_DELETE_SELF', 'You cannot delete your own account.');
            if (u.role === 'ADMIN' && u.status === 'ACTIVE' && S.users.filter(x => x.role === 'ADMIN' && x.status === 'ACTIVE').length <= 1)
                throw bad('LAST_ADMIN', 'At least one active Admin must remain.');
            const reports = S.users.filter(x => x.reportingManagerId === u.id);
            if (reports.length) throw new ApiErr(409, 'HAS_SUBORDINATES',
                `${reports.length} people report to ${u.name} (${reports.map(r => r.name).join(', ')}). Reassign them to another manager first.`);
            S.shops.forEach(s => { if (s.assignedOfficerId === u.id) s.assignedOfficerId = null; });
            const removed = S.atts.filter(a => a.userId === u.id).length;
            S.atts = S.atts.filter(a => a.userId !== u.id);
            log(caller.id, 'USER_DELETE', `Deleted user ${u.username} along with ${removed} attendance record(s)`);
            S.users = S.users.filter(x => x.id !== u.id);
            return [204];
        }

        if (method === 'GET' && p === '/api/work-locations') return [200, S.locs.filter(l => caller.role === 'ADMIN' && q.includeInactive === 'true' ? true : l.status === 'ACTIVE')];
        if (p.startsWith('/api/work-locations') && method !== 'GET') need('ADMIN');
        if (method === 'POST' && p === '/api/work-locations') {
            if (!body.name) throw bad('VALIDATION_FAILED', 'Name is required');
            const l = { id: ++S.seq.loc, name: body.name, address: body.address, latitude: body.latitude, longitude: body.longitude, allowedRadiusMeters: body.allowedRadiusMeters, status: body.status || 'ACTIVE' };
            S.locs.push(l); log(caller.id, 'WORK_LOCATION_CREATE', `Created ${l.name}`); return [200, l];
        }
        if ((m = /^\/api\/work-locations\/(\d+)$/.exec(p)) && method === 'PUT') { const l = S.locs.find(x => x.id === Number(m[1])); Object.assign(l, body); log(caller.id, 'WORK_LOCATION_UPDATE', `Updated ${l.name}`); return [200, l]; }
        if ((m = /^\/api\/work-locations\/(\d+)\/status$/.exec(p)) && method === 'PATCH') { const l = S.locs.find(x => x.id === Number(m[1])); l.status = body.status; log(caller.id, 'WORK_LOCATION_STATUS_CHANGE', `${l.name} -> ${l.status}`); return [200, l]; }
        throw new ApiErr(404, 'NOT_FOUND', 'No such endpoint');
    }

    // minimal multipart/form-data reader (bytes kept intact via latin1) -> { fields, files: { name: { filename, data: Buffer } } }
    function parseMultipart(buf, contentType) {
        const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || ''); const boundary = m && (m[1] || m[2]);
        if (!boundary) throw bad('BAD_REQUEST', 'Malformed request');
        const out = { fields: {}, files: {} };
        buf.toString('latin1').split('--' + boundary).forEach(part => {
            const i = part.indexOf('\r\n\r\n'); if (i < 0) return;
            const head = part.slice(0, i), name = /name="([^"]*)"/.exec(head), file = /filename="([^"]*)"/.exec(head);
            if (!name) return;
            const data = part.slice(i + 4).replace(/\r\n$/, '');
            if (file) out.files[name[1]] = { filename: file[1], data: Buffer.from(data, 'latin1') };
            else out.fields[name[1]] = Buffer.from(data, 'latin1').toString('utf8');
        });
        return out;
    }

    function api(req, res, rawBuf) {
        const send = (status, obj, type) => {
            if (Buffer.isBuffer(obj)) { res.writeHead(status, { 'Content-Type': type || 'application/octet-stream' }); return res.end(obj); }
            res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj));
        };
        const fail = e => send(e.status || 500, { timestamp: nowLdt(), status: e.status || 500, error: 'x', code: e.code || 'INTERNAL_ERROR', message: e.message, path: req.url, details: e.details || undefined });
        try {
            const ctype = req.headers['content-type'] || '';
            const body = rawBuf.length ? (ctype.startsWith('multipart/') ? parseMultipart(rawBuf, ctype) : JSON.parse(rawBuf.toString('utf8'))) : undefined;
            if (req.method === 'POST' && req.url === '/api/auth/login') {
                if (!body || !body.username || !body.password) throw bad('VALIDATION_FAILED', 'Username is required');
                const u = S.users.find(x => x.username.toLowerCase() === String(body.username).toLowerCase());
                if (!u || u.password !== body.password) { log(u ? u.id : null, 'LOGIN_FAILED', `Failed login for ${body.username}`); throw new ApiErr(401, 'INVALID_CREDENTIALS', 'Incorrect username or password.'); }
                if (u.status !== 'ACTIVE') { log(u.id, 'LOGIN_FAILED', 'Inactive account'); throw new ApiErr(401, 'ACCOUNT_INACTIVE', 'This account is inactive. Ask your Admin to enable it.'); }
                const token = crypto.randomBytes(24).toString('hex'); S.tokens.set(token, u.id); log(u.id, 'LOGIN', 'Signed in');
                return send(200, { token, tokenType: 'Bearer', expiresInSeconds: 28800, user: pub(u) });
            }
            const auth = req.headers.authorization || '';
            const uid = S.tokens.get(auth.replace(/^Bearer /, ''));
            const caller = S.users.find(u => u.id === uid);
            if (!caller) throw new ApiErr(401, auth ? 'TOKEN_INVALID' : 'UNAUTHENTICATED', 'Please sign in.');
            if (caller.status !== 'ACTIVE') throw new ApiErr(401, 'ACCOUNT_INACTIVE', 'This account is inactive.');
            const [status, payload, type] = handle(req.method, req.url, body, caller);
            send(status, payload, type);
        } catch (e) { if (e instanceof SyntaxError) e = bad('BAD_REQUEST', 'Malformed request'); fail(e); }
    }

    const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
    const server = http.createServer((req, res) => {
        if (req.url.startsWith('/api/')) { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => api(req, res, Buffer.concat(chunks))); return; }
        const rel = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
        const file = path.join(FRONTEND, path.normalize(rel));
        if (!file.startsWith(FRONTEND) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
    });
    return { server, state: S, invalidateTokens: () => S.tokens.clear(), get users() { return S.users; } };
}
module.exports = { createMock };
