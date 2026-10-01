/*
 * portal-sync.js — the last two things that only lived in one phone's browser now live on the server.
 *
 *   Messages        The shared message board (portalMessages in index.html) is loaded from GET /api/messages and
 *                   every send / edit / delete goes to the server. The server decides who sees which message, so a
 *                   message really reaches the other person's phone. A message sent without a connection stays
 *                   "pending" on the phone and is sent automatically later.
 *   Call report     Every "Call" tap on the Telephone Call Report is stored with POST /api/call-logs (with a client
 *                   reference, so a re-send never makes a duplicate). Managers see their team's calls.
 *   Admin console   Top Performers and Role-wise Performance are worked out from real sales (stock reports) and
 *                   targets instead of demo numbers; the header avatar shows the signed-in person's initials.
 *
 * Loaded after portal-live.js. Like the other files it wraps a few global functions of index.html.
 */
(function (global) {
    'use strict';

    var doc = global.document;
    var SYNC_MS = 30000;
    var CALL_KEY = 'salesHierarchyPortal_callLog_v1';
    var me = null;

    function api() { return global.SPApi; }
    function lex(name) {   // a top-level let/const of index.html, or undefined
        try { return (0, eval)(name); } catch (e) { return undefined; } // eslint-disable-line no-eval
    }
    function call(name) {
        var fn = global[name];
        if (typeof fn !== 'function') return undefined;
        try { return fn.apply(global, Array.prototype.slice.call(arguments, 1)); } catch (e) { if (global.console) console.warn(name, e); return undefined; }
    }
    function warn(what, e) { if (global.console) console.warn('[portal-sync] ' + what, e && (e.message || e)); }
    function ref() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
    function isoDay(d) {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d || new Date());
    }

    // =========================================================================================== messages
    var M = { known: {}, busy: false, pulling: null, origSave: null };

    function board() { var a = lex('portalMessages'); return Array.isArray(a) ? a : null; }

    function fromServer(x) {
        return { id: x.id, fromId: x.fromId, from: x.from, fromRole: x.fromRole, to: x.to, text: x.text, at: x.at };
    }

    function renderBoards() {
        ['renderPortalMessages', 'renderSupervisorMessages'].forEach(function (n) { call(n); });
        // the role inbox redraws only while it is on screen (it also owns the compose box)
        var ov = doc.getElementById('role-msg-modal-overlay');
        if (ov && ov.classList.contains('open')) call('renderRoleMessages');
    }

    function cacheLocal() { if (M.origSave) { try { M.origSave(); } catch (e) { /* storage full */ } } }

    async function pullMessages() {
        if (!me || !api()) return;
        if (M.pulling) return M.pulling;
        M.pulling = (async function () {
            await pushMessages();
            var list;
            try { list = await api().messages(); } catch (e) { warn('messages', e); return; }
            var arr = board();
            if (!arr) return;
            var pending = arr.filter(function (m) { return !m.id && m._pending && m._by === me.id; });
            arr.length = 0;
            pending.forEach(function (m) { arr.push(m); });
            M.known = {};
            list.forEach(function (x) { var m = fromServer(x); arr.push(m); M.known[m.id] = m.text; });
            cacheLocal();
            renderBoards();
        })();
        try { await M.pulling; } finally { M.pulling = null; }
    }

    /** Sends whatever changed on the board since the last sync: new messages, edits, deletions. */
    async function pushMessages() {
        var arr = board();
        if (!arr || !me || M.busy) return;
        M.busy = true;
        try {
            var present = {};
            for (var i = 0; i < arr.length; i++) {
                var m = arr[i];
                if (!m.id) {
                    if (m._sending) continue;
                    m._pending = true; m._by = m._by || me.id; m._sending = true;
                    try {
                        var saved = await api().sendMessage(m.to, m.text);
                        Object.assign(m, fromServer(saved));
                        delete m._pending; delete m._by;
                        M.known[m.id] = m.text;
                    } catch (e) {
                        if (e && e.status && e.status !== 0 && e.status < 500) {   // refused for good (e.g. unknown person)
                            arr.splice(i, 1); i--;
                            global.alert('Message not sent: ' + api().friendlyError(e));
                        } else { warn('send (will retry)', e); }
                    } finally { if (m) delete m._sending; }
                    if (m && m.id) present[m.id] = true;
                    continue;
                }
                present[m.id] = true;
                if (M.known[m.id] != null && M.known[m.id] !== m.text) {
                    try { await api().editMessage(m.id, m.text); M.known[m.id] = m.text; }
                    catch (e) { warn('edit', e); m.text = M.known[m.id]; global.alert('Could not edit the message: ' + api().friendlyError(e)); }
                }
            }
            var gone = Object.keys(M.known).filter(function (id) { return !present[id]; });
            for (var j = 0; j < gone.length; j++) {
                try { await api().deleteMessage(gone[j]); delete M.known[gone[j]]; }
                catch (e) {
                    warn('delete', e);
                    if (e && e.status === 404) delete M.known[gone[j]];
                    else global.alert('Could not delete the message: ' + api().friendlyError(e));
                }
            }
        } finally {
            M.busy = false;
            cacheLocal();
        }
    }

    function installMessages() {
        var orig = global.savePortalMessages;
        if (typeof orig !== 'function' || orig.__sync) return;
        M.origSave = orig;
        var w = function () {
            var out = orig.apply(this, arguments);
            if (me) pushMessages().then(function () { renderBoards(); });
            return out;
        };
        w.__sync = true;
        global.savePortalMessages = w;
    }

    function resetBoardForUser() {
        // whatever another person left on this phone is not this person's inbox
        var arr = board();
        if (!arr) return;
        var keep = arr.filter(function (m) { return !m.id && m._pending && me && m._by === me.id; });
        arr.length = 0;
        keep.forEach(function (m) { arr.push(m); });
        M.known = {};
        cacheLocal();
    }

    // =========================================================================================== telephone call report
    var C = { busy: false };

    function readCalls() { try { return JSON.parse(global.localStorage.getItem(CALL_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function writeCalls(log) { try { global.localStorage.setItem(CALL_KEY, JSON.stringify(log)); } catch (e) { /* storage full */ } }
    function officerName() { var o = lex('currentOfficer'); return o && o.name; }

    async function pushCalls() {
        if (!me || me.role !== 'SO' || C.busy) return;
        C.busy = true;
        try {
            var log = readCalls(), changed = false;
            var lists = Object.keys(log).map(function (k) { return log[k] || []; });
            for (var l = 0; l < lists.length; l++) {
                for (var i = 0; i < lists[l].length; i++) {
                    var c = lists[l][i];
                    if (!c._pending || c._by !== me.id) continue;
                    try {
                        var saved = await api().logCall({ shop: c.shop, mobile: c.mobile || null, at: c.at, ref: c.ref });
                        c.id = saved.id; delete c._pending; delete c._by; changed = true;
                    } catch (e) {
                        if (e && e.status && e.status < 500) { lists[l].splice(i, 1); i--; changed = true; warn('call refused', e); }
                        else { warn('call (will retry)', e); }
                    }
                }
            }
            if (changed) writeCalls(log);
        } finally { C.busy = false; }
    }

    async function pullCalls() {
        if (!me || !api()) return;
        await pushCalls();
        var from = new Date(); from.setDate(from.getDate() - 60);
        var list;
        try { list = await api().callLogs({ from: isoDay(from), to: isoDay() }); } catch (e) { warn('call log', e); return; }
        var old = readCalls(), log = {};
        Object.keys(old).forEach(function (k) {   // keep only this person's calls that are still waiting to be sent
            (old[k] || []).forEach(function (c) { if (c._pending && c._by === me.id) (log[k] = log[k] || []).push(c); });
        });
        list.forEach(function (x) {
            (log[x.officerName] = log[x.officerName] || []).push({ id: x.id, shop: x.shop, mobile: x.mobile, date: x.date, time: x.time, at: x.at, ref: x.ref });
        });
        Object.keys(log).forEach(function (k) { log[k].sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); }); });
        writeCalls(log);
    }

    function installCalls() {
        var orig = global.logShopCallEvent;
        if (typeof orig === 'function' && !orig.__sync) {
            var w = function () {
                var out = orig.apply(this, arguments);
                var name = officerName();
                if (me && name) {
                    var log = readCalls(), list = log[name] || [];
                    if (list[0] && !list[0].ref) {
                        list[0].ref = ref(); list[0]._pending = true; list[0]._by = me.id;
                        writeCalls(log);
                        pushCalls();
                    }
                }
                return out;
            };
            w.__sync = true;
            global.logShopCallEvent = w;
        }
        var del = global.soDeleteCallEntry;
        if (typeof del === 'function' && !del.__sync) {
            var wd = function (idx) {
                var name = officerName(), c = name && (readCalls()[name] || [])[idx];
                var out = del.apply(this, arguments);
                if (c && c.id) api().deleteCall(c.id).catch(function (e) { warn('delete call', e); });
                return out;
            };
            wd.__sync = true;
            global.soDeleteCallEntry = wd;
        }
        var ren = global.soSaveCallEntry;
        if (typeof ren === 'function' && !ren.__sync) {
            var wr = function (idx) {
                var name = officerName(), c = name && (readCalls()[name] || [])[idx];
                var out = ren.apply(this, arguments);
                var after = name && (readCalls()[name] || [])[idx];
                if (c && c.id && after && after.shop !== c.shop) api().renameCall(c.id, after.shop).catch(function (e) { warn('rename call', e); });
                return out;
            };
            wr.__sync = true;
            global.soSaveCallEntry = wr;
        }
    }

    // =========================================================================================== admin console: real performers
    function live() { return global.SOLive && global.SOLive.data; }
    function inr(n) { return '₹' + Math.round(n || 0).toLocaleString('en-IN'); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    function monthNow() { return isoDay().slice(0, 7); }
    function salesByOfficer() {
        var L = live(), H = global.SOSales && global.SOSales._h, month = monthNow(), out = {};
        if (!L || !H) return out;
        (L.entries || []).forEach(function (e) {
            if (String(e.date).slice(0, 7) !== month) return;
            out[e.officerId] = (out[e.officerId] || 0) + H.valueOf(e, 'soSales') + H.valueOf(e, 'dpSales');
        });
        return out;
    }
    function targetsByOfficer() {
        var L = live(), out = {}, month = monthNow();
        ((L && L.targets) || []).forEach(function (t) { if (!t.month || t.month === month) out[t.officerId] = (out[t.officerId] || 0) + (Number(t.amount) || 0); });
        return out;
    }
    function soIdsUnder(id) {
        var L = live(), out = {}, grew = true, seen = {};
        seen[id] = true;
        while (grew) {
            grew = false;
            L.users.forEach(function (u) { if (u.reportingManagerId && seen[u.reportingManagerId] && !seen[u.id]) { seen[u.id] = true; grew = true; } });
        }
        Object.keys(seen).forEach(function (k) { var u = L.byId[k]; if (u && u.role === 'SO') out[k] = true; });
        return out;
    }
    function agg(ids, sales, targets) {
        var s = 0, t = 0;
        Object.keys(ids).forEach(function (k) { s += sales[k] || 0; t += targets[k] || 0; });
        return { sales: s, target: t, pct: t ? Math.round(s * 100 / t) : null };
    }
    function ensureLoaded(then) {
        var L = live();
        if (L && L.loaded) return true;
        if (global.SOLive && !ensureLoaded._w) {
            ensureLoaded._w = true;
            Promise.resolve(global.SOLive.load()).then(function () { ensureLoaded._w = false; then(); }, function () { ensureLoaded._w = false; });
        }
        return false;
    }

    function renderTop() {
        var host = doc.getElementById('sup-top-performers');
        if (!host) return;
        if (!ensureLoaded(renderTop)) { host.innerHTML = '<div class="sup-top-card"><span class="rk-label">Loading this month\'s sales…</span></div>'; return; }
        var L = live(), sales = salesByOfficer(), targets = targetsByOfficer();
        var sos = L.users.filter(function (u) { return u.role === 'SO'; });
        var asms = L.users.filter(function (u) { return u.role === 'ASM'; });
        var regions = {};
        sos.forEach(function (u) {
            var r = (u.region || u.area || 'No region').trim();
            var k = r.toLowerCase();
            (regions[k] = regions[k] || { name: r, ids: {} }).ids[u.id] = true;
        });
        function best(list) {
            return list.filter(function (x) { return x.sales > 0; }).sort(function (a, b) { return b.sales - a.sales; })[0] || null;
        }
        var bRegion = best(Object.keys(regions).map(function (k) { var a = agg(regions[k].ids, sales, targets); a.name = regions[k].name; return a; }));
        var bAsm = best(asms.map(function (u) { var a = agg(soIdsUnder(u.id), sales, targets); a.name = u.name; return a; }));
        var bSo = best(sos.map(function (u) { var one = {}; one[u.id] = true; var a = agg(one, sales, targets); a.name = u.name; return a; }));
        var cards = [
            { cap: 'Best Region', x: bRegion, accent: '#C9954E' },
            { cap: 'Best ASM', x: bAsm, accent: '#5B7FB9' },
            { cap: 'Best Sales Officer', x: bSo, accent: '#4E9B8F' }
        ];
        host.innerHTML = cards.map(function (c) {
            var x = c.x;
            return '<div class="sup-top-card" style="--accent:' + c.accent + ';">' +
                '<span class="rk-label">' + c.cap + '</span>' +
                '<span class="sup-top-name">' + (x ? esc(x.name) : '—') + '</span>' +
                '<span class="sup-top-sub">' + (x ? inr(x.sales) + ' this month' : 'No sales reported this month yet') + '</span>' +
                '<span class="sup-top-pct">' + (x ? (x.pct != null ? x.pct + '% of target' : 'No target set') : '') + '</span></div>';
        }).join('');
    }

    function renderRoles() {
        var host = doc.getElementById('sup-role-performance');
        if (!host) return;
        if (!ensureLoaded(renderRoles)) { host.innerHTML = '<div class="sup-perf-row"><div class="sup-perf-name"><span>Loading this month\'s sales…</span></div></div>'; return; }
        var L = live(), sales = salesByOfficer(), targets = targetsByOfficer();
        var defs = [['RSM', 'Marketing Manager', 'Marketing Managers'], ['RM', 'Regional Manager', 'Regional Managers'],
            ['ASM', 'ASM', 'Area Sales Managers'], ['SO', 'Sales Officers', 'Sales Officers']];
        host.innerHTML = defs.map(function (d) {
            var people = L.users.filter(function (u) { return u.role === d[0]; });
            var ids = {}, unassigned = 0;
            people.forEach(function (u) {
                if (d[0] === 'SO') { ids[u.id] = true; return; }
                var t = soIdsUnder(u.id);
                if (!Object.keys(t).length) unassigned++;
                Object.keys(t).forEach(function (k) { ids[k] = true; });
            });
            var a = agg(ids, sales, targets), pct = a.pct || 0;
            var tone = pct >= 90 ? 'good' : pct >= 70 ? 'ok' : 'low';
            var detail = people.length + ' ' + (people.length === 1 ? d[2].replace(/s$/, '') : d[2]) +
                (d[0] !== 'SO' ? ' · ' + Object.keys(ids).length + ' officers in their teams' : '') +
                ' · ' + inr(a.sales) + (a.target ? ' of ' + inr(a.target) + ' target' : ' · no target set') +
                (unassigned ? ' · <b style="color:#C2410C">' + unassigned + ' without a team</b>' : '');
            return '<div class="sup-perf-row"><div class="sup-perf-name"><strong>' + d[1] + '</strong><span>' + detail + '</span></div>' +
                '<span class="rk-chart-track"><span class="rk-chart-fill ' + (tone === 'low' ? 'short' : '') + '" style="width:' + Math.min(pct, 100) + '%"></span></span>' +
                '<span class="sup-perf-pct ' + tone + '">' + (a.target ? pct + '%' : '—') + '</span></div>';
        }).join('');
    }

    function installAdmin() {
        [['renderSupTopPerformers', renderTop], ['renderSupRolePerformance', renderRoles]].forEach(function (p) {
            var orig = global[p[0]];
            if (typeof orig !== 'function' || orig.__real) return;
            var w = function () { try { p[1](); } catch (e) { warn(p[0], e); return orig.apply(this, arguments); } };
            w.__real = true;
            global[p[0]] = w;
        });
    }

    function initials(name) {
        var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    function fixAvatars() {
        if (!me) return;
        ['sup-header-avatar-initials', 'sup-side-avatar'].forEach(function (id) {
            var el = doc.getElementById(id); if (el) el.textContent = initials(me.name);
        });
    }

    // =========================================================================================== wiring
    function install() { installMessages(); installCalls(); installAdmin(); }

    async function syncAll() {
        if (!me || doc.hidden) return;
        await Promise.all([pullMessages(), pullCalls()]);
    }

    (global.SOSalesParts = global.SOSalesParts || []).push({
        onSignedIn: function (user) {
            me = user || (api() && api().user()) || null;
            install();
            resetBoardForUser();
            fixAvatars();
            syncAll().catch(function (e) { warn('sync', e); });
            if (me && (me.role === 'ADMIN' || me.role === 'OWNER')) {
                Promise.resolve(global.SOLive && global.SOLive.load(true)).then(function () { call('renderSupervisorInsights'); }, function () { /* offline */ });
            }
        },
        refresh: function () { syncAll(); }
    });

    install();
    setInterval(function () { if (me && api() && api().isLoggedIn()) syncAll().catch(function () { /* next time */ }); }, SYNC_MS);
    global.addEventListener('online', function () { syncAll(); });

    global.PortalSync = { pullMessages: pullMessages, pushMessages: pushMessages, pullCalls: pullCalls, pushCalls: pushCalls,
        renderTop: renderTop, renderRoles: renderRoles };
})(window);
