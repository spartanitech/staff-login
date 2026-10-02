/*
 * portal-live.js — makes the role dashboards run on server data instead of the demo numbers the page was built with.
 *
 *   Live sales      Sales = booked orders (server) + DP Sales x unit price from the Weekly Stock Report (SOSales.salesEntries)
 *                   (GET /api/stock/team). Sales Analysis (all filters, Category-wise and Product-wise share), the
 *                   RM / Marketing Manager dashboards, the ASM performance table and the Team Targets screens all
 *                   read it, together with the monthly targets (GET /api/targets/team), the team's shops
 *                   (GET /api/team/shops) and today's shop check-ins (GET /api/attendance/team).
 *   Real people     The local officer / ASM / RM records the old screens draw from are rebuilt from GET /api/users,
 *                   so the made-up demo people and their seeded sales/targets disappear.
 *   ASM home        Team Shops and Targets vs Sales are shown on the ASM dashboard itself.
 *   Admin console   Picking a role lists every active person in it; the admin then opens one person's dashboard.
 *   RM / MM         The stand-alone Reports module is removed; Messages is responsive.
 *   Daily report    The Daily Shop Report is saved on the server (PUT /api/daily-reports/{date}); without a
 *                   connection it is kept on the phone and sent automatically (SOSales.outbox).
 *
 * Loaded after so-sales.js and so-reports.js. Like them it wraps a few global functions of index.html.
 */
(function (global) {
    'use strict';

    var SO = global.SOSales;
    if (!SO) return;
    var H = SO._h, S = SO.state;
    var $ = H.$, esc = H.esc, inr = H.inr, num = H.num;
    var doc = global.document;

    function api() { return global.SPApi; }
    function lex(name) {   // a top-level let/const/function of index.html, or undefined
        try { return (0, eval)(name); } catch (e) { return undefined; } // eslint-disable-line no-eval
    }
    function call(name) {
        var fn = global[name];
        if (typeof fn !== 'function') return undefined;
        try { return fn.apply(global, Array.prototype.slice.call(arguments, 1)); } catch (e) { if (global.console) console.warn(name, e); return undefined; }
    }
    function nameEq(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
    function role() { return S.user ? S.user.role : null; }
    function isManagerRole(r) { return ['ADMIN', 'OWNER', 'RSM', 'RM', 'ASM'].indexOf(r) >= 0; }
    function todayIso() { return H.todayIso(); }
    function catLabel(c) { return String(c || '').toLowerCase().replace(/\b\w/g, function (x) { return x.toUpperCase(); }) || 'Uncategorised'; }
    function productCategory(p) {
        var cat = global.WSR_CATALOG || [];
        for (var i = 0; i < cat.length; i++) if ((cat[i].items || []).indexOf(p) >= 0) return cat[i].cat;
        return '';
    }

    // =========================================================================================== live data
    var L = {
        loaded: false, loading: null, at: 0,
        users: [], byId: {}, byName: {},
        shops: [], targets: [], entries: [], attendance: [],
        month: null
    };

    function valueOf(e) { return H.valueOf(e, 'soSales') + H.valueOf(e, 'dpSales'); }
    function userFor(o) {
        if (!o) return null;
        if (o._uid && L.byId[o._uid]) return L.byId[o._uid];
        var u = L.byName[String(o.name || '').trim().toLowerCase()];
        if (u) o._uid = u.id;
        return u || null;
    }
    function idOf(o) { var u = userFor(o); return u ? u.id : null; }
    function idsOf(list) {
        var out = {};
        (list || []).forEach(function (o) { var id = idOf(o); if (id) out[id] = true; });
        return out;
    }
    function inRange(e, from, to) { return (!from || e.date >= from) && (!to || e.date <= to); }
    function monthOf(iso) { return String(iso).slice(0, 7); }
    function weekStart(iso) { return H.mondayOf(iso); }

    /** Sales value of a set of officer ids (map) between two dates. */
    function salesOf(ids, from, to) {
        var t = 0;
        L.entries.forEach(function (e) { if (ids[e.officerId] && inRange(e, from, to)) t += valueOf(e); });
        return t;
    }
    function targetOf(id) {
        var t = L.targets.find(function (x) { return x.officerId === id; });
        return t ? Number(t.amount) || 0 : 0;
    }
    function shopsOf(ids) {
        var me = S.user ? S.user.id : null;
        return L.shops.filter(function (s) {
            if (s.assignedOfficerId != null) return !!ids[s.assignedOfficerId];
            // a "whole team" shop added by a manager: belongs to whoever added it
            return s.createdById != null && (s.createdById === me || !!ids[s.createdById] || (VIEW.active && VIEW.user && s.createdById === VIEW.user.id));
        });
    }

    /** Descendants of a user id in the reporting tree (from the users list). */
    function treeOf(id) {
        var out = {}, grew = true;
        out[id] = true;
        while (grew) {
            grew = false;
            L.users.forEach(function (u) { if (u.reportingManagerId && out[u.reportingManagerId] && !out[u.id]) { out[u.id] = true; grew = true; } });
        }
        return out;
    }

    async function load(force) {
        if (!S.user || !api()) return;
        if (L.loading) return L.loading;
        if (L.loaded && !force && Date.now() - L.at < 60000) return;
        var r = role();
        var today = todayIso();
        var from = (function () { var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 11); return H.iso(d); })();
        L.loading = (async function () {
            var month = monthOf(today);
            var jobs = [
                api().users().catch(function () { return null; }),
                isManagerRole(r) ? api().teamShops().catch(function () { return null; }) : Promise.resolve(null),
                api().teamTargets(month).catch(function () { return null; }),
                api().teamStock(from, today).catch(function () { return null; }),
                isManagerRole(r) ? api().teamAttendance({ from: today, to: today, size: 500 }).catch(function () { return null; }) : Promise.resolve(null),
                api().orders ? api().orders({ from: from, to: today }).catch(function () { return null; }) : Promise.resolve(null),
                api().visits ? api().visits({ from: today, to: today }).catch(function () { return null; }) : Promise.resolve(null)
            ];
            var res = await Promise.all(jobs);
            if (res[0]) setUsers(res[0]);
            if (res[1]) L.shops = res[1];
            if (r === 'SO') L.shops = (SO.shops() || []).map(function (s) { return { name: s.name, assignedOfficerId: S.user.id, productCategories: s.categories }; });
            if (res[2]) L.targets = res[2];
            if (r === 'SO') {
                try { var mine = await api().target({ month: month }); L.targets = mine ? [mine] : []; } catch (e) { /* keep */ }
            }
            if (res[5]) L.orders = res[5];
            if (res[6]) L.visits = res[6];
            if (res[3] || res[5]) L.entries = SO.salesEntries(res[3] || [], L.orders || []);   // orders + DP sales (see SOSales.salesEntries)
            if (res[4]) L.attendance = Array.isArray(res[4]) ? res[4] : (res[4].content || res[4].items || []);
            L.month = month;
            L.loaded = true; L.at = Date.now();
        })();
        try { await L.loading; } finally { L.loading = null; }
        syncLocalRecords();
        repaint();
    }

    function setUsers(list) {
        L.users = (list || []).filter(function (u) { return u.status === 'ACTIVE'; });
        L.byId = {}; L.byName = {};
        L.users.forEach(function (u) { L.byId[u.id] = u; L.byName[String(u.name || '').trim().toLowerCase()] = u; });
    }

    // =========================================================================================== local records <- server
    var DEMO_ORDER = /^ORD-25072/;
    function ensureCity(city) {
        var map = lex('areaShopMap');
        if (!map || !city || map[city]) return;
        map[city] = { officers: {}, baseLat: 11.1271, baseLng: 78.6569, regions: ['North', 'South', 'East', 'West'], shops: [] };
    }

    /** Fills one local officer record with real numbers (and wipes the factory's made-up ones). */
    function liveOfficer(o, u) {
        var month = L.month || monthOf(todayIso());
        var ids = {}; ids[u.id] = true;
        var target = targetOf(u.id);
        var monthSales = salesOf(ids, month + '-01', todayIso());
        var todaySales = salesOf(ids, todayIso(), todayIso());
        o._uid = u.id;
        if (u.area) { ensureCity(u.area); o.workArea = o.workArea && nameEq(o.workArea, u.area) ? o.workArea : u.area; }
        o.monthlyTarget = target;
        o.achieved = monthSales;
        o.remaining = Math.max(0, target - monthSales);
        o.pct = target ? Math.round(monthSales * 100 / target) : 0;
        o.sales = todaySales;
        o.collection = 0;
        o.orders = L.entries.filter(function (e) { return e.officerId === u.id && e.date.slice(0, 7) === month && (e.soSales + e.dpSales) > 0; })
            .reduce(function (acc, e) { acc[e._order ? 'o' + e._order : e.date + '|' + (e.dpName || '')] = true; return acc; }, {});
        o.orders = Object.keys(o.orders).length;
        // the officer's real orders (server), newest first - the report screens list these instead of demo rows
        o.recentOrders = (L.orders || []).filter(function (x) { return x.officerId === u.id && x.status !== 'CANCELLED'; }).slice(0, 50).map(function (x) {
            return { orderNo: 'ORD-' + x.id, shop: x.shopName, amount: Number(x.total) || 0, status: 'Confirmed', orderedOn: x.date + 'T12:00:00', date: x.date, _server: true };
        });
        if (o.tasks && o.tasks.length && !o._liveTasks) { o.tasks = []; o._liveTasks = true; }
        // The officer's own shops (server) are their visit plan; a shop is "Completed" when they checked in there today.
        var mineShops = L.shops.filter(function (s) { return s.assignedOfficerId === u.id; });
        if (!S.user || S.user.id !== u.id) {
            var visited = {};
            L.attendance.forEach(function (a) { if (a.userId === u.id && a.shopName) visited[a.shopName] = a; });
            // every shop visited today (not only the first check-in), from the server, so it is the same on every device
            (L.visits || []).forEach(function (v) { if (v.officerId === u.id && v.shopName && !visited[v.shopName]) visited[v.shopName] = { checkInTime: v.visitTime }; });
            o.plannedVisitsList = mineShops.map(function (s) {
                var a = visited[s.name];
                return { shop: s.name, location: s.locality || s.city || '', time: a && a.checkInTime ? String(a.checkInTime).slice(11, 16) : '—',
                    status: a ? 'Completed' : 'Pending' };
            });
            o.assignedShops = mineShops.map(function (s) { return s.name; });
            o.plannedVisits = o.plannedVisitsList.length;
            o.visits = o.plannedVisitsList.filter(function (v) { return v.status === 'Completed'; }).length;
            var att = L.attendance.find(function (a) { return a.userId === u.id; });
            if (att && att.checkInTime) {
                o.loginDate = new Date().toDateString();
                o.loginTime = new Date(att.checkInTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                o.lastCheckIn = { shop: att.shopName || att.workLocationName || '', time: o.loginTime };
            } else if (o.loginDate === new Date().toDateString() && !o._selfStamped) {
                o.loginDate = null; o.loginTime = null; o.lastCheckIn = null;
            }
        }
    }

    function syncLocalRecords() {
        var r = role();
        var officers = lex('soOfficers');
        var make = global.makeSOOfficer;
        if (!Array.isArray(officers)) return;
        var serverSO = L.users.filter(function (u) { return u.role === 'SO'; });

        if (isManagerRole(r) && L.users.length) {
            // one local record per real Sales Officer in my scope; nobody else
            serverSO.forEach(function (u) {
                var o = officers.find(function (x) { return x._uid === u.id || nameEq(x.name, u.name); });
                if (!o && typeof make === 'function') {
                    o = make(u.name, officers.length);
                    o.plannedVisitsList = []; o.recentOrders = []; o.tasks = [];
                    officers.push(o);
                }
                if (o) { o.userId = u.username; liveOfficer(o, u); }
            });
            for (var i = officers.length - 1; i >= 0; i--) {
                if (!serverSO.some(function (u) { return officers[i]._uid === u.id || nameEq(officers[i].name, u.name); })) officers.splice(i, 1);
            }
            syncStaff('asmStaff', 'ASM', function (u) { return { name: u.name, userId: u.username, password: '', area: u.area || '' }; }, 'saveASMStaff');
            syncStaff('rmStaff', 'RM', function (u) { return { name: u.name, userId: u.username, password: '', assignedASMs: [] }; }, 'saveRMStaff');
        } else if (r === 'SO') {
            var me = officers.find(function (x) { return nameEq(x.name, S.user.name); });
            if (me) liveOfficer(me, S.user);
        }
        call('saveSOOfficers');
    }

    function syncStaff(listName, roleName, maker, saver) {
        var list = lex(listName);
        if (!Array.isArray(list)) return;
        var server = L.users.filter(function (u) { return u.role === roleName; });
        if (!server.length && role() !== 'ADMIN' && role() !== 'OWNER') return;   // e.g. an ASM cannot see other ASMs
        server.forEach(function (u) {
            var p = list.find(function (x) { return nameEq(x.name, u.name); });
            if (!p) { p = maker(u); list.push(p); }
            p.userId = u.username; p._uid = u.id;
            if (roleName === 'ASM' && u.area) { p.area = u.area; ensureCity(u.area); if (!p.workArea) p.workArea = u.area; }
            if (roleName === 'RM') {
                // the ASMs reporting to this RM
                p.assignedASMs = L.users.filter(function (a) { return a.role === 'ASM' && a.reportingManagerId === u.id; }).map(function (a) { return a.name; });
            }
        });
        for (var i = list.length - 1; i >= 0; i--) {
            if (!server.some(function (u) { return nameEq(list[i].name, u.name); }) && !nameEq(list[i].name, S.user && S.user.name)) list.splice(i, 1);
        }
        call(saver);
    }

    // =========================================================================================== real sales everywhere
    /** One "order" per officer per day per DP: the products they sold (SO + DP sales) that day. */
    var FILTER = { category: '' };
    function liveVisits(officers) {
        var ids = idsOf(officers);
        var onlyCat = FILTER.category;
        var groups = {};
        L.entries.forEach(function (e) {
            if (!ids[e.officerId]) return;
            var qty = (Number(e.soSales) || 0) + (Number(e.dpSales) || 0);
            if (!qty) return;
            if (onlyCat && String(e.category || productCategory(e.product)).toUpperCase() !== onlyCat) return;
            var key = e._order ? 'o' + e._order : e.officerId + '|' + e.date + '|' + (e.dpName || '');
            var u = L.byId[e.officerId] || {};
            var g = groups[key] || (groups[key] = {
                shop: e._order ? (e.shopName || 'Shop order') : (e.dpName ? 'DP: ' + e.dpName : 'DP sales'),
                officer: u.name || '',
                city: u.area || '',
                order: { total: 0, items: [], orderedOn: e.date + 'T12:00:00' }
            });
            var price = Number(e.unitPrice) || SO.priceFor(e.product) || 0;
            g.order.items.push({ name: e.product, category: catLabel(e.category || productCategory(e.product)), qty: qty, price: price });
            g.order.total += qty * price;
        });
        return Object.keys(groups).map(function (k) { return groups[k]; });
    }

    function installSalesOverrides() {
        if (global.saVisitsFor && !global.saVisitsFor.__live) {
            var sv = function (officers) { return liveVisits(officers || []); };
            sv.__live = true;
            global.saVisitsFor = sv;
        }
        var month = function () { return monthOf(todayIso()); };
        if (global.officerRealSales && !global.officerRealSales.__live) {
            var rs = function (o) { var id = idOf(o); if (!id) return 0; var ids = {}; ids[id] = true; return salesOf(ids, month() + '-01', todayIso()); };
            rs.__live = true;
            global.officerRealSales = rs;
        }
        if (global.officerRealOrders && !global.officerRealOrders.__live) {
            var ro = function (o) {
                var id = idOf(o), days = {};
                L.entries.forEach(function (e) { if (e.officerId === id && monthOf(e.date) === month() && (e.soSales + e.dpSales) > 0) days[e._order ? 'o' + e._order : e.date + (e.dpName || '')] = 1; });
                return Object.keys(days).length;
            };
            ro.__live = true;
            global.officerRealOrders = ro;
        }
        var stats = global.asmShopStats;
        if (typeof stats === 'function' && !stats.__live) {
            var st = function (officers) {
                if (!L.loaded) return stats.apply(this, arguments);
                var ids = idsOf(officers || []);
                var n = shopsOf(ids).length;
                return { count: n, sub: 'Assigned to ' + Object.keys(ids).length + ' officer' + (Object.keys(ids).length === 1 ? '' : 's') };
            };
            st.__live = true;
            global.asmShopStats = st;
        }
        // the cards count stock-report days per DP, so say that instead of "orders" / "shops"
        var kpiHtml = global.saKPIsHTML;
        if (typeof kpiHtml === 'function' && !kpiHtml.__live) {
            var kh = function () {
                return String(kpiHtml.apply(this, arguments) || '')
                    .replace('>Shops Covered<', '>Shops / DPs<');   // rows are shop orders + DP sales from the stock report
            };
            kh.__live = true;
            global.saKPIsHTML = kh;
        }
        var share = global.saShareHTML;
        if (typeof share === 'function' && !share.__live) {
            var sh = function () {
                return String(share.apply(this, arguments) || '')
                    .replace(/No orders booked in this month yet\.[^<]*/, 'No sales for this selection yet. Sales appear here once Sales Officers book orders or save DP Sales in their stock report.')
                    .replace(/across (\d+) orders?\./, 'across $1 sales report(s).')
                    .replace(' Tap a shop for its order history.', '');
            };
            sh.__live = true;
            global.saShareHTML = sh;
        }
        installRMOverrides();
        installMMOverrides();
        installScopeOverrides();
        installSAFilters();
    }

    // ---- Regional Manager dashboard
    function rmOfficers() { return call('rmRosterOfficers') || []; }
    function rmASMs() { return call('rmRosterASMs') || []; }
    function cityOfficers(city) {
        return rmOfficers().filter(function (o) { return nameEq(call('personCity', o) || o.workArea, city); });
    }
    function asmTeamIds(a) {
        var u = L.byName[String(a.name || '').trim().toLowerCase()];
        if (u) { var t = treeOf(u.id); delete t[u.id]; return t; }
        return idsOf(cityOfficers(a.workArea || a.area || ''));
    }
    function pctOf(sales, target) { return target ? Math.round(sales * 100 / target) : 0; }
    function sumTargets(ids) { var t = 0; Object.keys(ids).forEach(function (id) { t += targetOf(Number(id)); }); return t; }

    function installRMOverrides() {
        var month = monthOf(todayIso());
        function wrap(name, fn) {
            var orig = global[name];
            if (typeof orig !== 'function' || orig.__live) return;
            var w = function () { return fn.apply(this, [orig].concat(Array.prototype.slice.call(arguments))); };
            w.__live = true;
            global[name] = w;
        }
        wrap('rmComputeKpis', function (orig) {
            orig();
            var data = lex('rmData');
            if (!data || !Array.isArray(data.kpis)) return;
            var ids = idsOf(rmOfficers());
            var target = sumTargets(ids), mSales = salesOf(ids, month + '-01', todayIso()), tSales = salesOf(ids, todayIso(), todayIso());
            var shops = shopsOf(ids).length;
            data.kpis.forEach(function (k) {
                if (/Shops/i.test(k.label)) { k.value = String(shops); k.change = 'Assigned to your Sales Officers'; }
                if (/Today.?s Sales/i.test(k.label)) { k.value = inr(tSales); k.change = inr(mSales) + ' this month'; }
                if (/Target/i.test(k.label)) { k.value = pctOf(mSales, target) + '%'; k.change = target ? 'of ' + inr(target) + ' this month' : 'No targets set this month'; }
            });
        });
        wrap('syncRMAsmManagement', function () {
            var rows = rmASMs().map(function (a) {
                var ids = asmTeamIds(a);
                var target = sumTargets(ids), achieved = salesOf(ids, month + '-01', todayIso()), pct = pctOf(achieved, target);
                return {
                    name: a.name, territory: (a.workArea || a.area || '').trim() || '—', officers: Object.keys(ids).filter(function (id) { return L.byId[id] && L.byId[id].role === 'SO'; }).length,
                    shops: String(shopsOf(ids).length), target: target ? inr(target) : 'Not set', achieved: inr(achieved), pct: pct,
                    status: target && pct >= 80 ? 'Active' : 'Below Target'
                };
            });
            var arr = lex('rmAsmManagement');
            if (Array.isArray(arr)) { arr.length = 0; Array.prototype.push.apply(arr, rows); }
        });
        wrap('rmRegionalTargetRows', function () {
            var all = idsOf(rmOfficers());
            var city = lex('rmSelectedCity') || 'all';
            var row = function (name, ids) { return { name: name, pct: pctOf(salesOf(ids, month + '-01', todayIso()), sumTargets(ids)) }; };
            var rows = [row(city === 'all' ? 'Overall Target' : city, all)];
            if (city !== 'all') return rows;
            var seen = {};
            rmASMs().forEach(function (a) {
                var c = (a.workArea || a.area || '').trim();
                if (!c || seen[c.toLowerCase()]) return;
                seen[c.toLowerCase()] = 1;
                rows.push(row(c, idsOf(cityOfficers(c))));
            });
            return rows;
        });
        wrap('rmProductSalesRows', function () {
            var ids = idsOf(rmOfficers()), totals = {};
            L.entries.forEach(function (e) {
                if (!ids[e.officerId] || monthOf(e.date) !== month) return;
                totals[e.product] = (totals[e.product] || 0) + valueOf(e);
            });
            var ranked = Object.keys(totals).map(function (k) { return [k, totals[k]]; }).filter(function (x) { return x[1] > 0; })
                .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
            return ranked.map(function (x) { return { name: x[0], val: x[1], display: inr(x[1]) }; });
        });
        wrap('rmShopAnalyticsRows', function () {
            var ids = idsOf(rmOfficers()), shops = shopsOf(ids);
            var visited = {};
            L.attendance.forEach(function (a) { if (ids[a.userId] && a.shopName) visited[a.userId + '|' + a.shopName] = 1; });
            var cutoff = Date.now() - 30 * 86400000;
            var fresh = shops.filter(function (s) { return s.createdAt && Date.parse(s.createdAt) >= cutoff; }).length;
            var v = Object.keys(visited).length;
            return [
                { value: String(v), label: 'Shops Visited Today' },
                { value: String(Math.max(0, shops.length - v)), label: 'Not Visited Today' },
                { value: String(fresh), label: 'New Shops (30 days)' },
                { value: String(shops.length), label: 'Total Shops' }
            ];
        });
        wrap('rmOrdersSummaryRows', function () {
            var ids = idsOf(rmOfficers()), t = todayIso();
            var reporting = {};
            L.entries.forEach(function (e) { if (ids[e.officerId] && e.date === t) reporting[e.officerId] = 1; });
            return [
                { label: "Today's Sales", value: inr(salesOf(ids, t, t)) },
                { label: 'This Week', value: inr(salesOf(ids, weekStart(t), t)) },
                { label: 'This Month', value: inr(salesOf(ids, monthOf(t) + '-01', t)) },
                { label: 'Officers reported today', value: Object.keys(reporting).length + ' / ' + Object.keys(ids).length },
                { label: 'Target this month', value: inr(sumTargets(ids)) }
            ];
        });
    }

    // ---- Sales Analysis filters: month, area, Sales Officer and category, on every role's screen
    function catOptions(sel) {
        var cats = (global.WSR_CATALOG || []).map(function (g) { return g.cat; });
        return '<option value="">All categories</option>' + cats.map(function (c) {
            return '<option value="' + esc(c) + '"' + (sel === c ? ' selected' : '') + '>' + esc(catLabel(c)) + '</option>';
        }).join('');
    }
    function installSAFilters() {
        var show = global.showMgrSalesAnalysis;
        if (typeof show === 'function' && !show.__filters) {
            var w = function (roleOrTab) {
                var isRole = ['asm', 'rm', 'mm'].indexOf(roleOrTab) >= 0;
                var bar = $('mgr-sa-filters');
                if (!bar) {
                    var kpis = $('mgr-sa-kpis');
                    if (kpis) {
                        bar = doc.createElement('div');
                        bar.id = 'mgr-sa-filters';
                        bar.className = 'lv-filters';
                        kpis.parentNode.insertBefore(bar, kpis);
                    }
                }
                if (bar && (isRole || !bar.innerHTML)) {
                    bar.innerHTML =
                        '<label>Month<select id="mgr-sa-month" onchange="renderMgrSalesAnalysis()"></select></label>' +
                        '<label>Area<select id="mgr-sa-area" onchange="SOLive.saFilterChanged()"><option value="">All areas</option></select></label>' +
                        '<label>Sales Officer<select id="mgr-sa-officer" onchange="renderMgrSalesAnalysis()"><option value="">All officers</option></select></label>' +
                        '<label>Category<select id="mgr-sa-cat" onchange="renderMgrSalesAnalysis()">' + catOptions('') + '</select></label>';
                }
                FILTER.skipMgr = true;
                var out;
                try { out = show.apply(this, arguments); } finally { FILTER.skipMgr = false; }
                fillMgrFilterOptions();
                call('renderMgrSalesAnalysis');
                var subEl = $('mgr-sa-subtitle');
                if (subEl) subEl.textContent = 'Booked orders + DP Sales, from the orders and stock reports of ' + (role() === 'ASM' ? 'your Sales Officers' : 'the Sales Officers in your team');
                if (!L.loading && Date.now() - L.at > 30000) load(true);
                return out;
            };
            w.__filters = true;
            w.__open = true;
            global.showMgrSalesAnalysis = w;
        }
        var offs = global.mgrSAOfficers;
        if (typeof offs === 'function' && !offs.__filters) {
            var wo = function () {
                var list = offs.apply(this, arguments) || [];
                if (FILTER.skipMgr) return list;
                var area = ($('mgr-sa-area') || {}).value || '', who = ($('mgr-sa-officer') || {}).value || '';
                return list.filter(function (o) {
                    return (!area || nameEq(call('personCity', o) || o.workArea, area)) && (!who || nameEq(o.name, who));
                });
            };
            wo.__filters = true;
            global.mgrSAOfficers = wo;
        }
        [['renderMgrSalesAnalysis', 'mgr-sa-cat'], ['renderSOSalesAnalysis', 'so-sa-cat']].forEach(function (pair) {
            var orig = global[pair[0]];
            if (typeof orig !== 'function' || orig.__filters) return;
            var wr = function () {
                if (pair[1] === 'so-sa-cat') ensureSOCatFilter();
                FILTER.category = ($(pair[1]) || {}).value || '';
                try { return orig.apply(this, arguments); } finally { FILTER.category = ''; }
            };
            wr.__filters = true;
            global[pair[0]] = wr;
        });
    }
    function fillMgrFilterOptions() {
        var areaSel = $('mgr-sa-area'), offSel = $('mgr-sa-officer');
        if (!areaSel || !offSel) return;
        FILTER.skipMgr = true;
        var all;
        try { all = call('mgrSAOfficers', lex('mgrSARole') || 'asm') || []; } finally { FILTER.skipMgr = false; }
        var curA = areaSel.value, curO = offSel.value;
        var areas = {};
        all.forEach(function (o) { var c = call('personCity', o) || o.workArea; if (c) areas[c] = 1; });
        areaSel.innerHTML = '<option value="">All areas</option>' + Object.keys(areas).sort().map(function (a) {
            return '<option' + (nameEq(a, curA) ? ' selected' : '') + '>' + esc(a) + '</option>';
        }).join('');
        var inArea = all.filter(function (o) { return !areaSel.value || nameEq(call('personCity', o) || o.workArea, areaSel.value); });
        offSel.innerHTML = '<option value="">All officers</option>' + inArea.map(function (o) { return o.name; }).sort().map(function (n) {
            return '<option' + (nameEq(n, curO) ? ' selected' : '') + '>' + esc(n) + '</option>';
        }).join('');
    }
    function ensureSOCatFilter() {
        if ($('so-sa-cat')) return;
        var month = $('so-sa-month');
        if (!month) return;
        var sel = doc.createElement('select');
        sel.id = 'so-sa-cat';
        sel.className = month.className;
        sel.setAttribute('style', month.getAttribute('style') || '');
        sel.style.marginLeft = '8px';
        sel.innerHTML = catOptions('');
        sel.onchange = function () { call('renderSOSalesAnalysis'); };
        month.parentNode.insertBefore(sel, month.nextSibling);
    }

    // ---- Marketing Manager dashboard: add Category-wise and Product-wise to the share tabs
    function installMMOverrides() {
        var orig = global.renderMMCharts;
        if (typeof orig !== 'function' || orig.__live) return;
        var w = function (tab) {
            var res = orig.apply(this, arguments);
            var cur = tab || lex('mmChartShareTab') || 'area';
            var tabsEl = $('mm-chart-share-tabs');
            if (tabsEl) {
                var tabs = [['area', 'Area-wise'], ['officer', 'Officer-wise'], ['party', 'Party-wise (DP)'], ['category', 'Category-wise'], ['product', 'Product-wise']];
                tabsEl.innerHTML = tabs.map(function (t) {
                    return call('mmTabButton', t[1], cur === t[0], "renderMMCharts('" + t[0] + "')") || '';
                }).join('');
            }
            if (cur === 'category' || cur === 'product') {
                var title = $('mm-chart-share-title');
                if (title) title.textContent = cur === 'category' ? '📊 Category-wise Sales Share' : '📊 Product-wise Sales Share';
                var visits = liveVisits(call('allowedOfficers') || []);
                var share = $('mm-chart-share');
                if (share) share.innerHTML = call('saDonutHTML', call('saShareRows', visits, cur) || [], 'No sales reported yet — the share appears once Sales Officers save their stock report.') || '';
            }
            Array.prototype.forEach.call(doc.querySelectorAll('#mm-charts-panel span'), function (sp) {
                if (/^From orders Sales Officers saved/.test(sp.textContent)) sp.textContent = 'From the stock reports Sales Officers saved (SO + DP sales)';
            });
            return res;
        };
        w.__live = true;
        global.renderMMCharts = w;
    }

    // ---- when the Admin opens one person's dashboard, the lists follow that person's team
    var VIEW = { active: false, user: null, ids: null };
    /** The RM whose dashboard is on screen: the signed-in RM, or the one the Admin opened. */
    function rmMe() {
        if (VIEW.active && VIEW.user && VIEW.user.role === 'RM') return VIEW.user;
        return role() === 'RM' ? S.user : null;
    }
    function installScopeOverrides() {
        // A Regional Manager's people are their reporting tree on the server (whatever city they are in);
        // the city picker on the dashboard still narrows it.
        var rmOff = global.rmRosterOfficers, rmAsm = global.rmRosterASMs;
        if (typeof rmOff === 'function' && !rmOff.__tree) {
            var t1 = function () {
                var me = rmMe();
                if (!me || !L.loaded || !L.users.length) return rmOff.apply(this, arguments);
                var tree = treeOf(me.id), city = lex('rmSelectedCity') || 'all';
                var isAllowed = global.isOfficerAllowed || function () { return true; };
                return (lex('soOfficers') || []).filter(function (o) {
                    var id = idOf(o);
                    return id && tree[id] && isAllowed(o.name) && (city === 'all' || nameEq(call('personCity', o) || o.workArea, city));
                });
            };
            t1.__tree = true;
            global.rmRosterOfficers = t1;
        }
        if (typeof rmAsm === 'function' && !rmAsm.__tree) {
            var t2 = function () {
                var me = rmMe();
                if (!me || !L.loaded || !L.users.length) return rmAsm.apply(this, arguments);
                var tree = treeOf(me.id), city = lex('rmSelectedCity') || 'all';
                return (lex('asmStaff') || []).filter(function (a) {
                    var u = L.byName[String(a.name || '').trim().toLowerCase()];
                    return u && tree[u.id] && u.id !== me.id && (city === 'all' || nameEq(a.workArea || a.area, city));
                });
            };
            t2.__tree = true;
            global.rmRosterASMs = t2;
        }
        ['allowedOfficers'].forEach(function (name) {
            var orig = global[name];
            if (typeof orig !== 'function' || orig.__scope) return;
            var w = function () {
                var out = orig.apply(this, arguments) || [];
                if (!VIEW.active || !VIEW.ids || (VIEW.user.role !== 'RSM' && VIEW.user.role !== 'ASM')) return out;
                return out.filter(function (o) { var id = idOf(o); return id && VIEW.ids[id]; });
            };
            w.__scope = true;
            global[name] = w;
        });
        var origVis = global.asmVisibleOfficers;
        if (typeof origVis === 'function' && !origVis.__scope) {
            var wv = function () {
                var me = VIEW.active && VIEW.user && VIEW.user.role === 'ASM' ? VIEW.user : (role() === 'ASM' ? S.user : null);
                if (!me || !L.loaded || !L.users.length) return origVis.apply(this, arguments);
                // the ASM's team is their reporting tree on the server, not whoever happens to share their city
                var tree = treeOf(me.id);
                var isAllowed = global.isOfficerAllowed || function () { return true; };
                return (lex('soOfficers') || []).filter(function (o) { var id = idOf(o); return id && tree[id] && id !== me.id && isAllowed(o.name); });
            };
            wv.__scope = true;
            global.asmVisibleOfficers = wv;
        }
        var origRec = global.currentASMRecord;
        if (typeof origRec === 'function' && !origRec.__scope) {
            var wr = function () {
                if (VIEW.active && VIEW.user && VIEW.user.role === 'ASM') {
                    var list = lex('asmStaff') || [];
                    return list.find(function (a) { return nameEq(a.name, VIEW.user.name); }) || { name: VIEW.user.name, area: VIEW.user.area || '' };
                }
                return origRec.apply(this, arguments);
            };
            wr.__scope = true;
            global.currentASMRecord = wr;
        }
    }

    // =========================================================================================== repaint what is on screen
    function viewActive(id) { var v = $(id); return v && v.classList.contains('active'); }
    function modalOpen(id) { var v = $(id); return v && v.classList.contains('open'); }
    function repaint() {
        try {
            if (viewActive('rm-dashboard-view')) call('renderRMDashboard');
            if (viewActive('rsm-dashboard-view')) call('renderRSMDashboard');
            if (viewActive('asm-dashboard-view')) call('renderASMDashboard');
            if (viewActive('so-dashboard-view')) { call('renderSOKPIs'); }
            if (modalOpen('mgr-sa-modal-overlay')) call('renderMgrSalesAnalysis');
            var soSa = $('so-sales-analysis-card');
            if (soSa && soSa.style.display === 'block') call('renderSOSalesAnalysis');
            if (modalOpen('mgr-tgt-modal-overlay')) call('showMgrTargets');
        } catch (e) { if (global.console) console.warn('repaint', e); }
    }

    /** Sales Analysis and the manager screens: make sure the data is fresh whenever one of them opens. */
    function refreshOnOpen(name) {
        var orig = global[name];
        if (typeof orig !== 'function' || orig.__open) return;
        var w = function () {
            var out = orig.apply(this, arguments);
            if (!L.loading && Date.now() - L.at > 30000) load(true);
            return out;
        };
        w.__open = true;
        global[name] = w;
    }

    // =========================================================================================== ASM dashboard: Team Shops + Targets vs Sales
    function asmHomeIds() {
        if (!S.user) return {};
        var root = VIEW.active && VIEW.user ? VIEW.user.id : S.user.id;
        var t = treeOf(root); delete t[root];
        Object.keys(t).forEach(function (id) { if (!L.byId[id] || L.byId[id].role !== 'SO') delete t[id]; });
        return t;
    }

    function renderASMHome() {
        var view = $('asm-dashboard-view');
        if (!view) return;
        var host = $('lv-asm-home');
        if (!host) {
            host = doc.createElement('div');
            host.id = 'lv-asm-home';
            host.className = 'lv-grid';
            var anchor = $('asm2-kpi-grid') || view.querySelector('.asm2-kpi-grid');
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor.nextSibling);
            else (view.querySelector('.asm2-main') || view).appendChild(host);
        }
        if (!L.loaded) { host.innerHTML = '<div class="sos-card"><div class="sos-empty">Loading team shops and targets…</div></div>'; return; }
        var ids = asmHomeIds(), month = monthOf(todayIso());
        var team = Object.keys(ids).map(function (id) { return L.byId[id]; }).filter(Boolean).sort(function (a, b) { return a.name.localeCompare(b.name); });
        var shops = shopsOf(ids).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
        var canManage = !VIEW.active;

        var tRows = team.map(function (u) {
            var one = {}; one[u.id] = true;
            var so = 0, dp = 0;
            L.entries.forEach(function (e) { if (e.officerId === u.id && monthOf(e.date) === month) { so += H.valueOf(e, 'soSales'); dp += H.valueOf(e, 'dpSales'); } });
            var target = targetOf(u.id), pct = pctOf(so + dp, target);
            return '<tr><td data-l="Sales Officer"><b>' + esc(u.name) + '</b><div class="sos-sub">' + esc(u.area || '') + '</div></td>' +
                '<td data-l="Target">' + (target ? inr(target) : '<span class="sos-sub">Not set</span>') + '</td>' +
                '<td data-l="Orders">' + inr(so) + '</td><td data-l="DP Sales">' + inr(dp) + '</td><td data-l="Total"><b>' + inr(so + dp) + '</b></td>' +
                '<td data-l="Achieved" style="min-width:110px">' + (target ? '<div class="sos-prog" style="margin:0 0 3px"><div style="width:' + Math.min(100, pct) + '%"></div></div>' + pct + '%' : '—') + '</td></tr>';
        }).join('');
        var tot = team.reduce(function (acc, u) { var one = {}; one[u.id] = true; acc.t += targetOf(u.id); acc.s += salesOf(one, month + '-01', todayIso()); return acc; }, { t: 0, s: 0 });

        var sRows = shops.slice(0, 50).map(function (s) {
            return '<tr><td data-l="Shop"><b>' + esc(s.name) + '</b><div class="sos-sub">' + esc([s.city, s.locality].filter(Boolean).join(' · ')) + '</div></td>' +
                '<td data-l="Sales Officer">' + (s.assignedOfficerId ? esc(s.assignedOfficerName || '—') : '★ Whole team') + '</td>' +
                '<td data-l="Mobile">' + (s.phone ? '<a href="tel:' + esc(s.phone) + '">' + esc(s.phone) + '</a>' : '—') + '</td>' +
                '<td data-l="Categories">' + (s.productCategories ? SO.categoryChips(s.productCategories) : '—') + '</td></tr>';
        }).join('');

        host.innerHTML =
            '<div class="sos-card lv-card"><div class="sos-head"><div><div class="sos-title">🎯 Targets vs Sales — ' + esc(H.monthLabel(month)) + '</div>' +
            '<div class="sos-sub">Sales = booked orders + DP Sales from the stock report · team ' + inr(tot.s) + ' of ' + (tot.t ? inr(tot.t) : 'no target') + '</div></div>' +
            (canManage ? '<button class="sos-btn pri" onclick="SOReports.openTeam(\'targets\')">Set targets</button>' : '') + '</div>' +
            (team.length ? '<table class="sos-tbl"><thead><tr><th>Sales Officer</th><th>Target</th><th>Orders</th><th>DP Sales</th><th>Total</th><th>Achieved</th></tr></thead><tbody>' + tRows + '</tbody></table>'
                : '<div class="sos-empty">No active Sales Officer reports to you yet.</div>') + '</div>' +
            '<div class="sos-card lv-card"><div class="sos-head"><div><div class="sos-title">🏬 Team Shops <span class="sos-sub">(' + shops.length + ')</span></div>' +
            '<div class="sos-sub">The shops your Sales Officers check in at</div></div>' +
            '<span style="display:flex;gap:6px;flex-wrap:wrap">' + (canManage ? '<button class="sos-btn pri" onclick="SOReports.openTeam(\'shops\')">Manage shops</button>' : '') +
            '<button class="sos-btn" onclick="SOReports.exportShops(SOLive.asmShops(), \'Team Shops\', \'pdf\')">📄 PDF</button>' +
            '<button class="sos-btn" onclick="SOReports.exportShops(SOLive.asmShops(), \'Team Shops\', \'excel\')">📊 Excel</button></span></div>' +
            (shops.length ? '<div class="lv-scroll"><table class="sos-tbl"><thead><tr><th>Shop</th><th>Sales Officer</th><th>Mobile</th><th>Categories</th></tr></thead><tbody>' + sRows + '</tbody></table></div>' +
                (shops.length > 50 ? '<div class="sos-sub" style="margin-top:6px">Showing 50 of ' + shops.length + ' — open Manage shops or export for all.</div>' : '')
                : '<div class="sos-empty">No shops yet.' + (canManage ? ' Tap Manage shops to add the first one.' : '') + '</div>') + '</div>';
    }

    function installASMHome() {
        var orig = global.renderASMDashboard;
        if (typeof orig !== 'function' || orig.__live) return;
        var w = function () { var out = orig.apply(this, arguments); renderASMHome(); if (!L.loading && Date.now() - L.at > 30000) load(true); return out; };
        w.__live = true;
        global.renderASMDashboard = w;
    }

    // =========================================================================================== Admin console: role -> people -> dashboard
    var ROLE_PICK = {
        goToOwnerAsSupervisor: { role: 'OWNER', key: 'owner', label: 'Owner' },
        goToRSMAsSupervisor: { role: 'RSM', key: 'rsm', label: 'Marketing Manager' },
        goToRMAsSupervisor: { role: 'RM', key: 'rm', label: 'Regional Manager' },
        goToASMAsSupervisor: { role: 'ASM', key: 'asm', label: 'Area Sales Manager' },
        goToSOAsSupervisor: { role: 'SO', key: 'so', label: 'Sales Officer' }
    };
    var origGo = {};

    function pickerModal() {
        var ov = $('lv-pick-overlay');
        if (ov) return ov;
        ov = doc.createElement('div');
        ov.id = 'lv-pick-overlay';
        ov.className = 'lv-overlay';
        ov.innerHTML = '<div class="lv-modal" role="dialog" aria-modal="true" aria-labelledby="lv-pick-title">' +
            '<div class="lv-modal-head"><div><div class="lv-modal-title" id="lv-pick-title"></div><div class="sos-sub" id="lv-pick-sub"></div></div>' +
            '<button type="button" class="lv-x" aria-label="Close" onclick="SOLive.closePicker()">✕</button></div>' +
            '<input type="search" class="sos-search" id="lv-pick-q" placeholder="Search by name, username or area…" oninput="SOLive.filterPicker(this.value)">' +
            '<div id="lv-pick-list" class="lv-pick-list"></div></div>';
        ov.addEventListener('click', function (e) { if (e.target === ov) closePicker(); });
        doc.body.appendChild(ov);
        return ov;
    }
    var PICK = { fn: null, people: [] };
    async function openPicker(fnName) {
        var def = ROLE_PICK[fnName];
        PICK.fn = fnName;
        var ov = pickerModal();
        $('lv-pick-title').textContent = def.label + 's';
        $('lv-pick-sub').textContent = 'Active people in this role — pick one to open their dashboard';
        $('lv-pick-q').value = '';
        $('lv-pick-list').innerHTML = '<div class="sos-empty">Loading…</div>';
        ov.classList.add('open');
        try {
            if (!L.loaded || Date.now() - L.at > 30000) await load(true);
            PICK.people = L.users.filter(function (u) { return u.role === def.role; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
            renderPicker('');
        } catch (e) { $('lv-pick-list').innerHTML = '<div class="sos-empty">' + esc(H.errText(e)) + '</div>'; }
    }
    function renderPicker(q) {
        var box = $('lv-pick-list');
        if (!box) return;
        q = String(q || '').toLowerCase();
        var list = PICK.people.filter(function (u) {
            return !q || [u.name, u.username, u.area, u.region, u.employeeCode].some(function (v) { return String(v || '').toLowerCase().indexOf(q) >= 0; });
        });
        if (!PICK.people.length) { box.innerHTML = '<div class="sos-empty">Nobody is active in this role yet. Add them in Staff Accounts.</div>'; return; }
        box.innerHTML = '<div class="sos-count">' + list.length + ' of ' + PICK.people.length + '</div>' + list.map(function (u) {
            var mgr = u.reportingManagerId && L.byId[u.reportingManagerId] ? L.byId[u.reportingManagerId].name : '';
            var team = Object.keys(treeOf(u.id)).length - 1;
            return '<button type="button" class="lv-person" onclick="SOLive.openPerson(' + u.id + ')">' +
                '<span class="lv-ini">' + esc(String(u.name || '?').split(/\s+/).map(function (p) { return p[0]; }).join('').slice(0, 2).toUpperCase()) + '</span>' +
                '<span class="lv-person-main"><b>' + esc(u.name) + '</b><span class="sos-sub">' + esc([u.username, u.employeeCode, u.area, u.region].filter(Boolean).join(' · ')) + '</span>' +
                (mgr ? '<span class="sos-sub">Reports to ' + esc(mgr) + '</span>' : '') + '</span>' +
                (team > 0 ? '<span class="lv-badge">' + team + ' in team</span>' : '') + '<span class="lv-go">›</span></button>';
        }).join('') + (list.length ? '' : '<div class="sos-empty">No match.</div>');
    }
    function closePicker() { var ov = $('lv-pick-overlay'); if (ov) ov.classList.remove('open'); }

    function openPerson(id) {
        var u = L.byId[id];
        var def = ROLE_PICK[PICK.fn];
        if (!u || !def) return;
        closePicker();
        VIEW.active = true; VIEW.user = u; VIEW.ids = treeOf(u.id);
        try {
            var roles = lex('roles');
            if (roles && roles[def.key]) roles[def.key].name = u.name;
            if (def.key === 'rm') { var rd = lex('rmData'); if (rd) rd.name = u.name; var rp = lex('rmProfile'); if (rp) rp.name = u.name; }
            if (def.key === 'rsm') { var sd = lex('rsmData'); if (sd) sd.name = u.name; }
            if (def.key === 'asm') {
                var ad = lex('asmData'); if (ad) ad.name = u.name; var ap = lex('asmProfile'); if (ap) ap.name = u.name;
                global.loggedInUserName = u.name;
            }
        } catch (e) { /* ignore */ }
        if (def.key === 'so') {
            var officers = lex('soOfficers') || [];
            var o = officers.find(function (x) { return x._uid === u.id || nameEq(x.name, u.name); });
            if (!o && typeof global.makeSOOfficer === 'function') { o = global.makeSOOfficer(u.name, officers.length); o.plannedVisitsList = []; o.recentOrders = []; o.tasks = []; officers.push(o); }
            if (o) liveOfficer(o, u);
            // goToSOAsSupervisor always opens soOfficers[0] - put the chosen officer there
            if (o && officers[0] !== o) { officers.splice(officers.indexOf(o), 1); officers.unshift(o); }
        }
        origGo[PICK.fn].call(global);
        if (def.key === 'so') {
            var cur = H.officerRec();
            if (cur) { liveOfficer(cur, u); call('renderSOKPIs'); call('renderSOTasks'); }
        }
        if (def.key === 'owner') { var el = $('logged-in-role'); if (el) el.textContent = u.name; call('setHeaderInitials', u.name); }
        if (def.key === 'asm') {
            ['asm-logged-name', 'asm2-logged-name'].forEach(function (x) { doc.querySelectorAll('#' + x).forEach(function (n) { n.textContent = u.name; }); });
            call('renderASMDashboard');
        }
        if (def.key === 'rm') call('renderRMDashboard');
        if (def.key === 'rsm') call('renderRSMDashboard');
        showViewBanner(u, def.label);
    }

    function showViewBanner(u, label) {
        var b = $('lv-view-banner');
        if (!b) { b = doc.createElement('div'); b.id = 'lv-view-banner'; doc.body.appendChild(b); }
        b.innerHTML = '👁 Viewing <b>' + esc(u.name) + '</b> · ' + esc(label) + ' <button type="button" onclick="SOLive.exitView()">Back to Admin</button>';
        b.className = 'show';
    }
    function exitView() {
        VIEW.active = false; VIEW.user = null; VIEW.ids = null;
        var b = $('lv-view-banner'); if (b) b.className = '';
        // the dashboards' own "Back to Admin" button does the rest
        var active = doc.querySelector('.view.active');
        var btn = active && active.querySelector('.is-back-to-sup');
        if (btn) btn.click();
        else call('supShowSection', 'dashboards');
    }

    function installAdminPicker() {
        Object.keys(ROLE_PICK).forEach(function (fn) {
            var orig = global[fn];
            if (typeof orig !== 'function' || orig.__pick) return;
            origGo[fn] = orig;
            var w = function () { openPicker(fn); };
            w.__pick = true;
            global[fn] = w;
        });
        var sup = global.supShowSection;
        if (typeof sup === 'function' && !sup.__live) {
            var w2 = function () {
                if (VIEW.active) { VIEW.active = false; VIEW.user = null; VIEW.ids = null; var b = $('lv-view-banner'); if (b) b.className = ''; }
                return sup.apply(this, arguments);
            };
            w2.__live = true;
            global.supShowSection = w2;
        }
        // the cards' text says "View dashboard"; make it say what happens now
        doc.querySelectorAll('#supervisor-dashboard-view [onclick$="AsSupervisor()"]').forEach(function (card) {
            card.querySelectorAll('*').forEach(function (n) {
                if (n.children.length === 0 && /^\s*View dashboard\s*$/i.test(n.textContent)) n.textContent = 'Choose a person';
            });
        });
    }

    // =========================================================================================== RM / MM: no Reports module
    function hideReports() {
        doc.querySelectorAll('#rsm-dashboard-view [onclick="openMMSection(\'reports\')"], #rm-dashboard-view [onclick="showRMReport(\'perf-dashboard\')"]').forEach(function (a) {
            a.style.display = 'none';
            a.setAttribute('aria-hidden', 'true');
        });
        ['openMMSection', 'showRMReport'].forEach(function (fn) {
            var orig = global[fn];
            if (typeof orig !== 'function' || orig.__noReports) return;
            var w = function (key) {
                if ((fn === 'openMMSection' && key === 'reports') || (fn === 'showRMReport' && key === 'perf-dashboard')) return undefined;
                return orig.apply(this, arguments);
            };
            w.__noReports = true;
            global[fn] = w;
        });
    }

    // =========================================================================================== Daily Shop Report <-> server
    var DIRTY_KEY = 'salesHierarchyPortal_dsrDirty_v1';
    function dirtyAll() { try { return JSON.parse(global.localStorage.getItem(DIRTY_KEY) || '{}'); } catch (e) { return {}; } }
    function setDirty(scope, on) {
        var d = dirtyAll();
        if (on) d[scope] = Date.now(); else delete d[scope];
        try { global.localStorage.setItem(DIRTY_KEY, JSON.stringify(d)); } catch (e) { /* full */ }
    }
    var pushTimer = null;
    var applying = false;

    function reportBody(scope) {
        var st = global.__dsrStore;
        return { header: (st.read(st.HEAD_KEY)[scope]) || {}, rows: (st.read(st.ROW_KEY)[scope]) || {} };
    }
    function pushNow() {
        var st = global.__dsrStore;
        if (!st || !SO.isSO() || !S.user) return;
        var scope = st.scopeKey(), date = todayIso();
        SO.outbox.add('dsr', { date: date, scope: scope, body: reportBody(scope) }, 'dsr:' + date)
            .then(function () { markSynced(); }, function () { markSynced(); });
    }
    SO.outbox.on('dsr', async function (p) {
        await api().saveDailyReport(p.date, p.body);
        setDirty(p.scope, false);
        markSynced(true);
    });

    function markSynced(ok) {
        var el = $('lv-dsr-sync');
        if (!el) return;
        var waiting = SO.outbox.pending('dsr').length;
        el.className = 'lv-sync ' + (waiting ? 'wait' : 'ok');
        el.textContent = waiting ? '⏳ Saved on this phone — will sync when online' : '✔ Saved to server';
    }

    global.SPDailyReportSync = {
        changed: function (scope) {
            if (applying || !SO.isSO()) return;
            setDirty(scope, true);
            var el = $('lv-dsr-sync'); if (el) { el.className = 'lv-sync wait'; el.textContent = 'Saving…'; }
            clearTimeout(pushTimer);
            pushTimer = setTimeout(pushNow, 1200);
        }
    };

    /** Before the form opens: today's report from the server (unless this phone has unsent changes). */
    async function pullReport() {
        var st = global.__dsrStore;
        if (!st || !S.user) return;
        var scope = st.scopeKey();
        var officerId = null;
        if (!SO.isSO()) {
            var o = H.officerRec();
            officerId = idOf(o);
            if (!officerId) return;
        } else if (dirtyAll()[scope] || SO.outbox.pending('dsr').length) {
            SO.outbox.flush();
            return;
        }
        var r;
        try { r = await api().dailyReport(todayIso(), officerId); } catch (e) { return; }   // offline: use what this phone has
        if (!r || !r.updatedAt) {
            // nothing on the server yet: a report this phone already has (from before the sync existed) goes up now
            if (SO.isSO()) {
                var b = reportBody(scope);
                if (Object.keys(b.header).length || Object.keys(b.rows).length) pushNow();
            }
            return;
        }
        applying = true;
        try {
            var heads = st.read(st.HEAD_KEY), rows = st.read(st.ROW_KEY);
            heads[scope] = r.header || {};
            rows[scope] = r.rows || {};
            st.write(st.HEAD_KEY, heads);
            st.write(st.ROW_KEY, rows);
        } finally { applying = false; }
    }

    function installDailyReport() {
        var orig = global.openDailyShopReport;
        if (typeof orig !== 'function' || orig.__live) return;
        var w = async function () {
            var self = this, args = arguments;
            await pullReport();
            var out = orig.apply(self, args);
            var act = doc.querySelector('.dsr-actions');
            if (act && !$('lv-dsr-sync')) {
                var span = doc.createElement('span');
                span.id = 'lv-dsr-sync';
                span.className = 'lv-sync ok';
                act.insertBefore(span, act.firstChild);
                if (SO.isSO()) markSynced(true);
                else { span.textContent = '👁 Read-only — the Sales Officer fills this report'; span.className = 'lv-sync'; }
            }
            return out;
        };
        w.__live = true;
        global.openDailyShopReport = w;
    }

    // =========================================================================================== CSS
    function injectCss() {
        if ($('lv-css')) return;
        var css = [
            '.lv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:16px;margin:16px 0}',
            '.lv-grid .sos-card{margin:0}.lv-card .sos-tbl{min-width:0}.lv-scroll{max-height:360px;overflow:auto;-webkit-overflow-scrolling:touch}',
            '.lv-overlay{position:fixed;inset:0;background:rgba(4,20,40,.45);display:none;align-items:center;justify-content:center;z-index:99990;padding:16px;box-sizing:border-box}',
            '.lv-overlay.open{display:flex}',
            '.lv-modal{background:#fff;border-radius:16px;width:100%;max-width:620px;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;padding:18px;box-sizing:border-box;box-shadow:0 20px 50px rgba(0,0,0,.25)}',
            '.lv-modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px}.lv-modal-title{font-weight:800;font-size:18px;color:#04344C}',
            '.lv-x{border:0;background:#F0F4FA;border-radius:10px;width:34px;height:34px;font-size:16px;cursor:pointer;flex-shrink:0}',
            '.lv-pick-list{overflow:auto;margin-top:10px;-webkit-overflow-scrolling:touch}',
            '.lv-person{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:11px 10px;border:1px solid #E4EEF9;border-radius:12px;background:#fff;margin:0 0 8px;cursor:pointer;font-family:inherit}',
            '.lv-person:hover,.lv-person:focus{background:#F2F7FE;border-color:#B9CCEA;outline:none}',
            '.lv-ini{width:38px;height:38px;border-radius:50%;background:#EAF1FC;color:#2E4A9E;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px}',
            '.lv-person-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;color:#04344C;overflow-wrap:anywhere}',
            '.lv-badge{font-size:11px;font-weight:700;background:#E7F6EE;color:#1E7A4F;padding:3px 8px;border-radius:999px;white-space:nowrap}.lv-go{font-size:22px;color:#9AA3B8}',
            '#lv-view-banner{position:fixed;left:50%;top:10px;transform:translateX(-50%);background:#04344C;color:#fff;padding:8px 10px 8px 14px;border-radius:999px;font-size:12.5px;z-index:99980;display:none;align-items:center;gap:10px;box-shadow:0 6px 18px rgba(0,0,0,.25);max-width:calc(100vw - 24px);box-sizing:border-box}',
            '#lv-view-banner.show{display:flex}#lv-view-banner button{border:0;border-radius:999px;padding:5px 12px;font-weight:700;cursor:pointer;background:#fff;color:#04344C;font-family:inherit;white-space:nowrap}',
            '.lv-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 16px}',
            '.lv-filters label{display:flex;flex-direction:column;gap:4px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#5C6E88}',
            '.lv-filters select{padding:8px 10px;border:1px solid #D3E2F5;border-radius:9px;font-size:13px;font-family:inherit;color:#04344C;background:#fff;min-width:0;text-transform:none;letter-spacing:0;font-weight:600}',
            '.lv-sync{font-size:12px;font-weight:700;padding:5px 10px;border-radius:999px;background:#F0F4FA;color:#52647A}.lv-sync.ok{background:#E7F6EE;color:#1E7A4F}.lv-sync.wait{background:#FFF3C4;color:#8A5F14}',
            // Messages: the card on the RM / MM / ASM dashboards and its modal, at every width
            '.role-msg-card,[id$="-messages-card"]{max-width:100%;box-sizing:border-box;overflow-wrap:anywhere}',
            '#role-msg-list{max-height:min(60vh,520px);overflow-y:auto;-webkit-overflow-scrolling:touch}',
            '#role-msg-modal-overlay .modal-card *{max-width:100%;box-sizing:border-box}',
            '@media (max-width:600px){#role-msg-modal-overlay .modal-card textarea{min-height:90px}#role-msg-list{max-height:none}}'
        ].join('\n');
        var st = doc.createElement('style');
        st.id = 'lv-css';
        st.textContent = css;
        doc.head.appendChild(st);
    }

    // =========================================================================================== wiring
    global.SOLive = {
        data: L,
        load: load,
        refresh: function () { return load(true); },
        asmShops: function () { return shopsOf(asmHomeIds()); },
        closePicker: closePicker,
        filterPicker: renderPicker,
        openPerson: openPerson,
        exitView: exitView,
        saFilterChanged: function () { fillMgrFilterOptions(); call('renderMgrSalesAnalysis'); },
        _liveVisits: liveVisits
    };

    function install() {
        injectCss();
        installSalesOverrides();
        installASMHome();
        installAdminPicker();
        installDailyReport();
        hideReports();
        ['showMgrSalesAnalysis', 'showSOSalesAnalysis', 'showMgrTargets'].forEach(refreshOnOpen);
    }

    (global.SOSalesParts = global.SOSalesParts || []).push({
        onSignedIn: function (user) {
            VIEW.active = false; VIEW.user = null; VIEW.ids = null;
            L.loaded = false; L.at = 0; L.users = []; L.byId = {}; L.byName = {}; L.shops = []; L.targets = []; L.entries = []; L.attendance = [];
            install();
            if (user && user.role === 'ASM') renderASMHome();
            load(true).catch(function (e) { if (global.console) console.warn('live data', e); });
        },
        refresh: function () { if (S.user) load(true); }
    });
    install();
    setInterval(function () { if (S.user && !doc.hidden) load(true); }, 120000);   // keep the dashboards current
})(window);
