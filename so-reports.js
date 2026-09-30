/*
 * so-reports.js — server-backed Weekly Stock Report, SO/DP sales graphs, Target vs Actual, and the ASM's
 * Team Shops & Targets screen. Needs so-sales.js (window.SOSales) loaded first.
 */
(function (global) {
    'use strict';

    var SO = global.SOSales;
    if (!SO) return;
    var H = SO._h, S = SO.state, C = H.colors;
    var $ = H.$, esc = H.esc, jsq = H.jsq, inr = H.inr, num = H.num;
    var doc = global.document;

    function catalog() {
        var c = global.WSR_CATALOG;
        return Array.isArray(c) && c.length ? c : [{ cat: 'DRY FRUITS', items: [
            'Almond California (100GM)', 'Walnut (100GM)', 'Black Raisins (100GM)', 'Yellow Raisins (100GM)',
            'Full Cashew (100GM)', 'Afghan Anjeer (100GM)', 'Kiwi (100GM)', 'Plain Pista (100GM)'] }];
    }
    function nameEq(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
    function officerName() { var o = H.officerRec(); return (o && o.name) || (S.user && S.user.name) || ''; }

    async function loadTeam(force) {
        if (S.team && !force) return S.team;
        var users = await H.api().users();
        S.team = (users || []).filter(function (u) { return u.role === 'SO' && u.status === 'ACTIVE'; });
        return S.team;
    }
    /** Backend id of the officer the screen is about: me (SO), or the manager's currently picked officer. */
    async function targetOfficerId() {
        if (SO.isSO()) return null;
        var o = H.officerRec();
        if (!o) return undefined;
        if (o._uid) return o._uid;
        try { await loadTeam(); } catch (e) { return undefined; }
        var hit = (S.team || []).find(function (u) { return nameEq(u.name, o.name); });
        return hit ? hit.id : undefined;
    }

    // =========================================================================================== charts (inline SVG)
    function niceMax(v) {
        if (!(v > 0)) return 1;
        var p = Math.pow(10, Math.floor(Math.log10(v)));
        var n = v / p;
        return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
    }
    function shortInr(v) {
        v = Number(v) || 0;
        if (v >= 10000000) return '₹' + (v / 10000000).toFixed(v % 10000000 ? 1 : 0) + 'Cr';
        if (v >= 100000) return '₹' + (v / 100000).toFixed(v % 100000 ? 1 : 0) + 'L';
        if (v >= 1000) return '₹' + (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'K';
        return '₹' + Math.round(v);
    }
    // a bar with only its data-end (top / right) rounded
    function barPath(x, y, w, h, r, horizontal) {
        if (w <= 0 || h <= 0) return '';
        r = Math.min(r, horizontal ? h / 2 : w / 2, horizontal ? w : h);
        if (horizontal) {
            return 'M' + x + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) +
                'V' + (y + h - r) + 'Q' + (x + w) + ',' + (y + h) + ' ' + (x + w - r) + ',' + (y + h) + 'H' + x + 'Z';
        }
        return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
            'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
    }
    function legendHtml(items) {
        return '<div class="sos-legend">' + items.map(function (i) {
            return '<span><i class="sos-sw" style="background:' + i.color + '"></i>' + esc(i.name) + '</span>';
        }).join('') + '</div>';
    }

    /** Grouped vertical bars: categories on x, one bar per series, ₹ on y. tip(ci) returns the hover text. */
    function groupedBars(cats, series, tip) {
        var W = 600, Hh = 230, L = 52, R = 8, T = 10, B = 30;
        var pw = W - L - R, ph = Hh - T - B;
        var max = 0;
        series.forEach(function (s) { s.values.forEach(function (v) { if (v > max) max = v; }); });
        var top = niceMax(max);
        var slot = pw / Math.max(1, cats.length);
        var gap = 2, bw = Math.max(4, Math.min(26, (slot * 0.7 - gap * (series.length - 1)) / series.length));
        var groupW = bw * series.length + gap * (series.length - 1);
        var out = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" role="img">';
        var lead = top / Math.pow(10, Math.floor(Math.log10(top)));
        var ticks = Math.abs(lead - 2) < 1e-9 ? 4 : 5;
        for (var g = 0; g <= ticks; g++) {
            var gy = T + ph - (ph * g / ticks);
            out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '" stroke="' + (g ? '#EEF1F6' : '#C9D3E0') + '" stroke-width="1"/>' +
                '<text x="' + (L - 6) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="10.5" fill="#6B7A90">' + shortInr(top * g / ticks) + '</text>';
        }
        cats.forEach(function (c, ci) {
            var gx = L + slot * ci + (slot - groupW) / 2;
            out += '<g class="bar"><title>' + esc(tip(ci)) + '</title>' +
                '<rect class="hit" x="' + (L + slot * ci) + '" y="' + T + '" width="' + slot + '" height="' + ph + '"/>';
            series.forEach(function (s, si) {
                var v = s.values[ci] || 0;
                var h = top ? ph * v / top : 0;
                var x = gx + si * (bw + gap);
                if (h > 0) out += '<path class="mk" d="' + barPath(x, T + ph - h, bw, Math.max(h, 1.5), 4, false) + '" fill="' + s.color + '"/>';
            });
            out += '<text x="' + (L + slot * ci + slot / 2) + '" y="' + (Hh - 10) + '" text-anchor="middle" font-size="10.5" fill="#52514e">' + esc(c) + '</text></g>';
        });
        return out + '</svg>';
    }

    /** Horizontal stacked bars (SO + DP) per label, total ₹ at the end. */
    function stackedHBars(rows) {
        if (!rows.length) return '<div class="sos-empty">No sales entered this month yet.</div>';
        var W = 900, L = 200, R = 70, rowH = 26, T = 4;
        var Hh = T + rows.length * rowH + 4;
        var max = 0;
        rows.forEach(function (r) { if (r.so + r.dp > max) max = r.so + r.dp; });
        var pw = W - L - R;
        var out = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" role="img">';
        rows.forEach(function (r, i) {
            var y = T + i * rowH + 5, h = rowH - 10;
            var w1 = max ? pw * r.so / max : 0, w2 = max ? pw * r.dp / max : 0;
            var label = r.label.length > 26 ? r.label.slice(0, 25) + '…' : r.label;
            out += '<g class="bar"><title>' + esc(r.label + '\nSO Sales: ' + inr(r.so) + ' (' + num(r.soQty) + ' units)\nDP Sales: ' + inr(r.dp) + ' (' + num(r.dpQty) + ' units)') + '</title>' +
                '<rect class="hit" x="0" y="' + (y - 5) + '" width="' + W + '" height="' + rowH + '"/>' +
                '<text x="' + (L - 8) + '" y="' + (y + h - 3) + '" text-anchor="end" font-size="11" fill="#04344C">' + esc(label) + '</text>';
            if (w1 > 0) out += '<path class="mk" d="' + barPath(L, y, Math.max(w1 - (w2 > 0 ? 2 : 0), 1.5), h, w2 > 0 ? 0 : 4, true) + '" fill="' + C.so + '"/>';
            if (w2 > 0) out += '<path class="mk" d="' + barPath(L + w1, y, Math.max(w2, 1.5), h, 4, true) + '" fill="' + C.dp + '"/>';
            out += '<text x="' + (L + w1 + w2 + 6) + '" y="' + (y + h - 3) + '" font-size="11" fill="#52514e">' + shortInr(r.so + r.dp) + '</text></g>';
        });
        return out + '</svg>';
    }

    /** Target vs Actual: one horizontal bar per measure on a shared scale. */
    function targetBars(target, soV, dpV) {
        var rows = [
            { label: 'ASM Target', v: target, color: C.target },
            { label: 'Actual SO Sales', v: soV, color: C.so },
            { label: 'Actual DP Sales', v: dpV, color: C.dp },
            { label: 'Total Sales', v: soV + dpV, color: C.total }
        ];
        var W = 900, L = 130, R = 100, rowH = 34;
        var Hh = rows.length * rowH + 6;
        var max = Math.max(target, soV + dpV, 1);
        var pw = W - L - R;
        var out = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" role="img">';
        rows.forEach(function (r, i) {
            var y = 6 + i * rowH, h = 18;
            var w = pw * r.v / max;
            out += '<g class="bar"><title>' + esc(r.label + ': ' + inr(r.v)) + '</title>' +
                '<text x="' + (L - 8) + '" y="' + (y + 13) + '" text-anchor="end" font-size="11.5" fill="#04344C">' + r.label + '</text>' +
                '<rect x="' + L + '" y="' + y + '" width="' + pw + '" height="' + h + '" rx="4" fill="#F4F6FA"/>' +
                (w > 0 ? '<path class="mk" d="' + barPath(L, y, Math.max(w, 1.5), h, 4, true) + '" fill="' + r.color + '"/>' : '') +
                '<text x="' + (L + Math.max(w, 0) + 6) + '" y="' + (y + 13) + '" font-size="11.5" font-weight="700" fill="#04344C">' + inr(r.v) + '</text></g>';
        });
        if (target > 0) {
            var tx = L + pw * target / max;
            out += '<line x1="' + tx + '" x2="' + tx + '" y1="2" y2="' + (Hh - 2) + '" stroke="#52514e" stroke-dasharray="3 3" stroke-width="1"/>';
        }
        return out + '</svg>';
    }

    // =========================================================================================== sales performance
    async function loadPerformance(officerId, month) {
        var today = H.todayIso();
        var m = month || H.monthKey(today);
        var mEnd = H.minIso(H.monthEnd(m + '-01'), today);
        var weeksFrom = H.addDays(H.mondayOf(today), -35);           // 6 weeks incl. this one
        var from = H.minIso(H.monthStart(m + '-01'), weeksFrom);
        var q = { from: from, to: H.minIso(today, H.monthEnd(m + '-01')) };
        if (officerId) q.officerId = officerId;
        var t = { month: m };
        if (officerId) t.officerId = officerId;
        var res = await Promise.all([H.api().stock(q), H.api().target(t)]);
        return { entries: res[0] || [], target: res[1] || { amount: 0 }, month: m, monthEnd: mEnd, today: today };
    }

    function performanceHtml(d) {
        var today = d.today, m = d.month;
        var inMonth = d.entries.filter(function (e) { return H.monthKey(e.date) === m; });
        var soV = 0, dpV = 0;
        inMonth.forEach(function (e) { soV += H.valueOf(e, 'soSales'); dpV += H.valueOf(e, 'dpSales'); });
        var target = Number(d.target.amount) || 0;
        var total = soV + dpV;
        var pct = target ? Math.round(total * 100 / target) : 0;

        // daily: last 7 days
        var days = [];
        for (var i = 6; i >= 0; i--) days.push(H.addDays(today, -i));
        var dayVals = days.map(function (dd) {
            var so = 0, dp = 0, soQ = 0, dpQ = 0;
            d.entries.forEach(function (e) {
                if (e.date === dd) { so += H.valueOf(e, 'soSales'); dp += H.valueOf(e, 'dpSales'); soQ += e.soSales; dpQ += e.dpSales; }
            });
            return { so: so, dp: dp, soQ: soQ, dpQ: dpQ };
        });
        // weekly: last 6 weeks (Mon–Sun)
        var weeks = [];
        var mon0 = H.mondayOf(today);
        for (var w = 5; w >= 0; w--) weeks.push(H.addDays(mon0, -7 * w));
        var weekVals = weeks.map(function (ws) {
            var we = H.addDays(ws, 6), so = 0, dp = 0, soQ = 0, dpQ = 0;
            d.entries.forEach(function (e) {
                if (e.date >= ws && e.date <= we) { so += H.valueOf(e, 'soSales'); dp += H.valueOf(e, 'dpSales'); soQ += e.soSales; dpQ += e.dpSales; }
            });
            return { so: so, dp: dp, soQ: soQ, dpQ: dpQ, ws: ws, we: we };
        });
        // product-wise: this month, top 10 by value
        var byP = {};
        inMonth.forEach(function (e) {
            var r = byP[e.product] = byP[e.product] || { label: e.product, so: 0, dp: 0, soQty: 0, dpQty: 0 };
            r.so += H.valueOf(e, 'soSales'); r.dp += H.valueOf(e, 'dpSales'); r.soQty += e.soSales; r.dpQty += e.dpSales;
        });
        var prod = Object.keys(byP).map(function (k) { return byP[k]; })
            .filter(function (r) { return r.so + r.dp > 0; })
            .sort(function (a, b) { return (b.so + b.dp) - (a.so + a.dp); }).slice(0, 10);

        var legend = legendHtml([{ name: 'SO Sales', color: C.so }, { name: 'DP Sales', color: C.dp }]);
        function kpi(label, v, sw) {
            return '<div class="sos-kpi"><div class="sos-kpi-l">' + (sw ? '<i class="sos-sw" style="background:' + sw + '"></i>' : '') + label + '</div><div class="sos-kpi-v">' + v + '</div></div>';
        }
        return '' +
            '<div class="sos-kpis">' +
            kpi('ASM Target', target ? inr(target) : 'Not set', C.target) +
            kpi('Actual SO Sales', inr(soV), C.so) +
            kpi('Actual DP Sales', inr(dpV), C.dp) +
            kpi('Total Sales', inr(total), C.total) +
            kpi('Achievement', target ? pct + '%' : '—') +
            '</div>' +
            '<div class="sos-chart" style="margin-bottom:14px;"><h4>🎯 Target vs Actual — ' + esc(H.monthLabel(m)) + '</h4>' +
            '<div class="sos-sub">' + (target ? 'Target set by ' + esc(d.target.setByName || 'your ASM') + '. Sales = quantity × product price, from the stock report.'
                : 'Your ASM has not set a target for this month yet.') + '</div>' +
            targetBars(target, soV, dpV) +
            (target ? '<div class="sos-prog"><div style="width:' + Math.min(100, pct) + '%"></div></div>' +
                '<div class="sos-sub">' + pct + '% achieved · ' + (total >= target ? 'Target reached 🎉' : inr(target - total) + ' to go') + '</div>' : '') +
            '</div>' +
            '<div class="sos-chart-grid">' +
            '<div class="sos-chart"><h4>Daily Sales</h4><div class="sos-sub">Last 7 days · ₹ value</div>' + legend +
            groupedBars(days.map(function (x) { return H.fmtDay(x); }),
                [{ color: C.so, values: dayVals.map(function (v) { return v.so; }) }, { color: C.dp, values: dayVals.map(function (v) { return v.dp; }) }],
                function (i) { var v = dayVals[i]; return H.fmtLong(days[i]) + '\nSO Sales: ' + inr(v.so) + ' (' + num(v.soQ) + ' units)\nDP Sales: ' + inr(v.dp) + ' (' + num(v.dpQ) + ' units)'; }) +
            '</div>' +
            '<div class="sos-chart"><h4>Weekly Sales</h4><div class="sos-sub">Last 6 weeks (Mon–Sun) · ₹ value</div>' + legend +
            groupedBars(weeks.map(function (x) { return H.fmtDay(x); }),
                [{ color: C.so, values: weekVals.map(function (v) { return v.so; }) }, { color: C.dp, values: weekVals.map(function (v) { return v.dp; }) }],
                function (i) { var v = weekVals[i]; return H.fmtDay(v.ws) + ' – ' + H.fmtDay(v.we) + '\nSO Sales: ' + inr(v.so) + ' (' + num(v.soQ) + ' units)\nDP Sales: ' + inr(v.dp) + ' (' + num(v.dpQ) + ' units)'; }) +
            '</div>' +
            '</div>' +
            '<div class="sos-chart" style="margin-top:14px;"><h4>Product-wise Sales</h4><div class="sos-sub">' + esc(H.monthLabel(m)) + ' · top ' + prod.length + ' products by value</div>' + legend +
            stackedHBars(prod) + '</div>';
    }

    // ---- Sales Officer: My Targets card
    async function renderPerformanceCard() {
        if (!SO.isSO()) return;
        var card = $('so-mytargets-card');
        if (!card) return;
        var box = $('sos-perf');
        if (!box) {
            // the officer's own "Edit Target" and the old order-based donut are replaced by the ASM target + stock sales
            ['.so-target-label', '#so-target-value', '.so-target-body', '.progress-track', '.so-target-footer', '#so-target-edit-form'].forEach(function (sel) {
                var el = card.querySelector(sel);
                if (el) el.style.display = 'none';
            });
            var daily = $('so-daily-sales-list');           // order-based daily list: replaced by the stock-based Daily Sales graph
            if (daily && daily.parentNode) daily.parentNode.style.display = 'none';
            var head = card.querySelector('.so-card-header-row');
            box = doc.createElement('div');
            box.id = 'sos-perf';
            if (head && head.nextSibling) card.insertBefore(box, head.nextSibling); else card.appendChild(box);
        }
        box.innerHTML = '<div class="sos-empty">Loading sales performance…</div>';
        try {
            box.innerHTML = performanceHtml(await loadPerformance(null));
        } catch (e) {
            box.innerHTML = '<div class="sos-empty">Could not load sales performance: ' + esc(H.errText(e)) + '</div>';
        }
    }

    function wrapTargets() {
        var orig = global.showSOTargetsOnly;
        if (typeof orig === 'function' && !orig.__sos) {
            var w = function () { var out = orig.apply(this, arguments); renderPerformanceCard(); return out; };
            w.__sos = true;
            global.showSOTargetsOnly = w;
        }
    }

    /** Full-screen performance view (for an SO, or a manager looking at one officer). */
    async function openPerformance(officerId, title) {
        var m = H.mm();
        if (m.tabs) m.tabs.innerHTML = '';
        m.title.textContent = '📈 ' + (title || 'Sales Performance');
        m.body.innerHTML = '<div id="sos-perf-full"><div class="sos-empty">Loading…</div></div>';
        m.overlay.classList.add('open');
        var box = $('sos-perf-full');
        try { box.innerHTML = performanceHtml(await loadPerformance(officerId || null)); }
        catch (e) { box.innerHTML = '<div class="sos-empty">' + esc(H.errText(e)) + '</div>'; }
    }

    // =========================================================================================== Weekly Stock Report
    var W = { date: null, cat: 0, officerId: null, readOnly: false, day: {}, openings: {}, draft: {}, dp: '', weekEntries: [], weekOpenings: {} };

    function productCat(p) {
        var hit = catalog().find(function (g) { return g.items.indexOf(p) >= 0; });
        return hit ? hit.cat : '';
    }

    async function loadWsr() {
        var date = W.date, mon = H.mondayOf(date);
        var q1 = { from: date, to: date }, q2 = { from: mon, to: H.minIso(H.addDays(mon, 6), H.todayIso()) };
        if (W.officerId) { q1.officerId = W.officerId; q2.officerId = W.officerId; }
        var res = await Promise.all([
            H.api().stock(q1), H.api().stockOpenings(date, W.officerId), H.api().stock(q2),
            H.api().stockOpenings(mon, W.officerId), SO.loadDp()
        ]);
        W.day = {};
        (res[0] || []).forEach(function (e) { W.day[e.product] = e; });
        W.openings = res[1] || {};
        W.weekEntries = res[2] || [];
        W.weekOpenings = res[3] || {};
        var withDp = (res[0] || []).find(function (e) { return e.dpName; });
        if (withDp) W.dp = withDp.dpName;
    }

    function rowState(p) {
        var e = W.day[p], d = W.draft[p] || {};
        var hasPrev = Object.prototype.hasOwnProperty.call(W.openings, p);
        var opening = hasPrev ? W.openings[p] : (d.opening != null ? d.opening : (e ? e.opening : 0));
        var receipt = d.receipt != null ? d.receipt : (e ? e.receipt : 0);
        var so = d.soSales != null ? d.soSales : (e ? e.soSales : 0);
        var dp = d.dpSales != null ? d.dpSales : (e ? e.dpSales : 0);
        return { opening: opening, openingEditable: !hasPrev && !W.readOnly, receipt: receipt, soSales: so, dpSales: dp,
            closing: opening + receipt - so - dp, saved: !!e };
    }

    function cellIn(p, field, v) {
        if (W.readOnly) return '<span class="wsr2-auto">' + num(v) + '</span>';
        return '<input type="number" min="0" step="1" inputmode="numeric" value="' + (v ? v : '') + '" placeholder="0"' +
            ' data-p="' + esc(p) + '" data-f="' + field + '" oninput="SOReports.wsrInput(this)">';
    }

    function wsrTableHtml() {
        var g = catalog()[W.cat] || catalog()[0];
        var tot = { opening: 0, receipt: 0, closing: 0, soSales: 0, dpSales: 0 };
        var rows = g.items.map(function (p, i) {
            var r = rowState(p);
            Object.keys(tot).forEach(function (k) { tot[k] += r[k]; });
            return '<tr data-row="' + esc(p) + '">' +
                '<td class="wsr2-no">' + (i + 1) + '</td>' +
                '<td class="wsr2-prod">' + esc(p) + '</td>' +
                '<td class="n" data-l="Opening">' + (r.openingEditable ? cellIn(p, 'opening', r.opening)
                    : '<span class="wsr2-auto" title="Previous day\'s closing (automatic)">' + num(r.opening) + '</span>') + '</td>' +
                '<td class="n" data-l="Receipt">' + cellIn(p, 'receipt', r.receipt) + '</td>' +
                '<td class="n" data-l="Closing"><span class="wsr2-auto wsr2-closing' + (r.closing < 0 ? ' neg' : '') + '" data-closing="' + esc(p) + '">' + num(r.closing) + '</span></td>' +
                '<td class="n" data-l="SO Sales">' + cellIn(p, 'soSales', r.soSales) + '</td>' +
                '<td class="n" data-l="DP Sales">' + cellIn(p, 'dpSales', r.dpSales) + '</td>' +
                '</tr>';
        }).join('');
        return '<div class="wsr2-scroll"><table class="wsr2-table"><thead><tr>' +
            '<th>No.</th><th>Product</th><th class="n">Opening</th><th class="n">Receipt</th><th class="n">Closing</th><th class="n">SO Sales</th><th class="n">DP Sales</th>' +
            '</tr></thead><tbody>' + rows + '</tbody><tfoot><tr id="wsr2-tot">' +
            '<td class="wsr2-no"></td><td class="wsr2-prod">' + esc(g.cat) + ' — Total</td>' +
            '<td class="n" data-l="Opening">' + num(tot.opening) + '</td><td class="n" data-l="Receipt">' + num(tot.receipt) + '</td>' +
            '<td class="n" data-l="Closing">' + num(tot.closing) + '</td><td class="n" data-l="SO Sales">' + num(tot.soSales) + '</td>' +
            '<td class="n" data-l="DP Sales">' + num(tot.dpSales) + '</td></tr></tfoot></table></div>';
    }

    function weekSummary() {
        var mon = H.mondayOf(W.date), out = {};
        catalog().forEach(function (g) {
            g.items.forEach(function (p) {
                var list = W.weekEntries.filter(function (e) { return e.product === p; });
                var open = Object.prototype.hasOwnProperty.call(W.weekOpenings, p) ? W.weekOpenings[p] : (list[0] ? list[0].opening : 0);
                var r = { opening: open, receipt: 0, soSales: 0, dpSales: 0, closing: list.length ? list[list.length - 1].closing : open };
                list.forEach(function (e) { r.receipt += e.receipt; r.soSales += e.soSales; r.dpSales += e.dpSales; });
                out[p] = r;
            });
        });
        return { mon: mon, sun: H.addDays(mon, 6), rows: out };
    }

    function weekHtml() {
        var ws = weekSummary(), g = catalog()[W.cat] || catalog()[0];
        return '<div class="sos-card"><div class="sos-head"><div><div class="sos-title">🗓️ This week — ' + esc(g.cat) + '</div>' +
            '<div class="sos-sub">' + H.fmtDay(ws.mon) + ' – ' + H.fmtDay(ws.sun) + ' · opening of Monday, totals of the week, latest closing</div></div></div>' +
            '<div class="wsr2-scroll"><table class="wsr2-table"><thead><tr><th>No.</th><th>Product</th><th class="n">Opening</th><th class="n">Receipt</th><th class="n">Closing</th><th class="n">SO Sales</th><th class="n">DP Sales</th></tr></thead><tbody>' +
            g.items.map(function (p, i) {
                var r = ws.rows[p];
                return '<tr><td class="wsr2-no">' + (i + 1) + '</td><td class="wsr2-prod">' + esc(p) + '</td>' +
                    '<td class="n" data-l="Opening">' + num(r.opening) + '</td><td class="n" data-l="Receipt">' + num(r.receipt) + '</td>' +
                    '<td class="n" data-l="Closing">' + num(r.closing) + '</td><td class="n" data-l="SO Sales">' + num(r.soSales) + '</td>' +
                    '<td class="n" data-l="DP Sales">' + num(r.dpSales) + '</td></tr>';
            }).join('') + '</tbody></table></div></div>';
    }

    function wsrRender() {
        var root = $('wsr2-root');
        if (!root) return;
        var today = H.todayIso();
        var dirty = Object.keys(W.draft).length;
        root.innerHTML =
            '<div class="wsr2-top">' +
            '<label class="wsr2-field">Rep Name<input value="' + esc(officerName()) + '" readonly></label>' +
            '<label class="wsr2-field">DP Name' + (W.readOnly ? '<input value="' + esc(W.dp || '—') + '" readonly>'
                : '<span style="display:flex;border:1px solid #D3E2F5;border-radius:9px;background:#fff;">' + SO.dpSelectHtml('wsr2-dp', W.dp, '__wsr2Dp') + '</span>') + '</label>' +
            '<label class="wsr2-field">Date<input type="date" id="wsr2-date" value="' + W.date + '" max="' + today + '" onchange="SOReports.wsrDate(this.value)"></label>' +
            '</div>' +
            '<div class="wsr2-cats">' + catalog().map(function (g, i) {
                return '<button type="button" class="wsr2-cat' + (i === W.cat ? ' on' : '') + '" onclick="SOReports.wsrCat(' + i + ')">' + esc(g.cat) + '</button>';
            }).join('') + '</div>' +
            '<div class="sos-sub" style="margin-bottom:8px;">' + esc(H.fmtLong(W.date)) + (W.readOnly ? ' · view only' : '') + '</div>' +
            wsrTableHtml() +
            '<div class="wsr2-note"><b>Closing = Opening + Receipt − SO Sales − DP Sales.</b> Opening is filled automatically from the previous day\'s closing' +
            (W.readOnly ? '.' : ' — you only type it for a product\'s very first day.') + '</div>' +
            '<div class="wsr2-actions">' +
            (W.readOnly ? '' : '<button class="btn-primary" id="wsr2-save" onclick="SOReports.wsrSave()"' + (dirty ? '' : ' disabled') + '>💾 Save ' + esc(H.fmtDay(W.date)) + '</button>') +
            '<button class="btn-outline" onclick="SOReports.openPerformance(' + (W.officerId || 'null') + ')">📈 Sales Graphs</button>' +
            '<button class="btn-outline" onclick="exportWeeklyReportPDF()">📄 Week PDF</button>' +
            '<button class="btn-outline" onclick="exportWeeklyReportExcel()">📊 Week Excel</button>' +
            '<span id="wsr2-msg" class="sos-msg"></span></div>' +
            weekHtml();
    }

    function recalcRow(p) {
        var r = rowState(p);
        var tr = doc.querySelector('#wsr2-root tr[data-row="' + (global.CSS && CSS.escape ? CSS.escape(p) : p) + '"]');
        if (tr) {
            var c = tr.querySelector('[data-closing]');
            if (c) { c.textContent = num(r.closing); c.classList.toggle('neg', r.closing < 0); }
        }
        var g = catalog()[W.cat], tot = { opening: 0, receipt: 0, closing: 0, soSales: 0, dpSales: 0 };
        g.items.forEach(function (x) { var s = rowState(x); Object.keys(tot).forEach(function (k) { tot[k] += s[k]; }); });
        var tds = doc.querySelectorAll('#wsr2-tot td.n');
        ['opening', 'receipt', 'closing', 'soSales', 'dpSales'].forEach(function (k, i) { if (tds[i]) tds[i].textContent = num(tot[k]); });
        var b = $('wsr2-save'); if (b) b.disabled = !Object.keys(W.draft).length;
    }

    global.__wsr2Dp = function (v) { W.dp = v; W.dpDirty = true; var b = $('wsr2-save'); if (b) b.disabled = false; };

    async function openWeekly() {
        var m = H.mm();
        if (m.tabs) m.tabs.innerHTML = '';
        m.title.innerHTML = 'Weekly Stock Report';
        m.body.innerHTML = '<div class="dsr-sheet"><div id="wsr2-root"><div class="sos-empty">Loading stock…</div></div></div>';
        m.overlay.classList.add('open');
        var keepDate = W.date && W.date <= H.todayIso() ? W.date : H.todayIso();
        W = { date: keepDate, cat: W.cat || 0, officerId: null, readOnly: !SO.isSO(), day: {}, openings: {}, draft: {}, dp: '', weekEntries: [], weekOpenings: {} };
        if (!SO.isSO()) {
            W.officerId = await targetOfficerId();
            if (!W.officerId) {
                var r0 = $('wsr2-root');
                if (r0) r0.innerHTML = '<div class="sos-empty">This officer has no portal login yet, so there is no stock report to show.</div>';
                return;
            }
        }
        try { await loadWsr(); wsrRender(); }
        catch (e) { var r = $('wsr2-root'); if (r) r.innerHTML = '<div class="sos-empty">Could not load the stock report: ' + esc(H.errText(e)) + '</div>'; }
    }

    async function wsrSave() {
        var msg = $('wsr2-msg'), btn = $('wsr2-save');
        var products = Object.keys(W.draft);
        if (W.dpDirty) Object.keys(W.day).forEach(function (p) { if (products.indexOf(p) < 0) products.push(p); });
        if (!products.length) return;
        var bad = products.filter(function (p) { return rowState(p).closing < 0; });
        if (bad.length) { if (msg) { msg.className = 'sos-msg bad'; msg.textContent = 'Closing cannot be negative: ' + bad.join(', '); } return; }
        var rows = products.map(function (p) {
            var r = rowState(p);
            return { product: p, category: productCat(p), opening: r.openingEditable ? r.opening : null,
                receipt: r.receipt, soSales: r.soSales, dpSales: r.dpSales, unitPrice: SO.priceFor(p) || null };
        });
        if (btn) btn.disabled = true;
        try {
            await H.api().saveStockDay(W.date, { dpName: W.dp || null, rows: rows });
            W.draft = {}; W.dpDirty = false;
            await loadWsr();
            wsrRender();
            H.toast('Stock saved for ' + H.fmtDay(W.date) + ' — tomorrow\'s opening is updated');
            SO.refresh();
        } catch (e) {
            if (btn) btn.disabled = false;
            if (msg) { msg.className = 'sos-msg bad'; msg.textContent = H.errText(e); }
        }
    }

    // ---- week export (PDF / Excel), all categories
    function weekRowsForExport() {
        var ws = weekSummary();
        return { ws: ws, groups: catalog().map(function (g) { return { cat: g.cat, items: g.items.map(function (p) { return { p: p, r: ws.rows[p] }; }) }; }) };
    }
    function fileBase() { return 'Weekly-Stock-Report-' + officerName().replace(/\s+/g, '-') + '-' + H.mondayOf(W.date || H.todayIso()); }

    async function ensureWeekLoaded() {
        if (!W.date || !$('wsr2-root')) {
            W.date = W.date || H.todayIso();
            if (!SO.isSO()) W.officerId = await targetOfficerId();
            await loadWsr();
        }
    }

    async function exportPdf() {
        if (!global.jspdf) { global.alert('PDF library did not load. Check your connection.'); return; }
        try { await ensureWeekLoaded(); } catch (e) { H.toast(H.errText(e), true); return; }
        var d = weekRowsForExport();
        var pdf = new global.jspdf.jsPDF({ orientation: 'landscape' });
        pdf.setFontSize(15); pdf.setTextColor(20, 30, 60);
        pdf.text('SPARTAN BRISK & NUTS', 148, 14, { align: 'center' });
        pdf.setFontSize(11); pdf.text('WEEKLY STOCK REPORT', 148, 22, { align: 'center' });
        pdf.setFontSize(9); pdf.setTextColor(70, 70, 70);
        pdf.text('Rep Name: ' + officerName(), 12, 31);
        pdf.text('DP Name: ' + (W.dp || '-'), 110, 31);
        pdf.text('Week: ' + H.fmtDay(d.ws.mon) + ' - ' + H.fmtDay(d.ws.sun), 210, 31);
        var cx = [12, 24, 120, 150, 180, 210, 240], head = ['No.', 'Product', 'Opening', 'Receipt', 'Closing', 'SO Sales', 'DP Sales'];
        var y = 40;
        function ph() {
            pdf.setFontSize(8); pdf.setTextColor(20, 30, 60); pdf.setFont(undefined, 'bold');
            head.forEach(function (t, i) { pdf.text(t, cx[i], y); });
            pdf.setFont(undefined, 'normal'); y += 3; pdf.setDrawColor(190); pdf.line(12, y, 285, y); y += 5;
        }
        ph();
        d.groups.forEach(function (g) {
            if (y > 188) { pdf.addPage(); y = 20; ph(); }
            pdf.setFontSize(8); pdf.setTextColor(90, 60, 20); pdf.setFont(undefined, 'bold'); pdf.text(g.cat, 12, y); pdf.setFont(undefined, 'normal'); y += 5.5;
            g.items.forEach(function (it, i) {
                if (y > 195) { pdf.addPage(); y = 20; ph(); }
                pdf.setFontSize(7.5); pdf.setTextColor(60, 60, 60);
                [String(i + 1), it.p, it.r.opening, it.r.receipt, it.r.closing, it.r.soSales, it.r.dpSales].forEach(function (t, ci) {
                    pdf.text(String(t).slice(0, ci === 1 ? 50 : 12), cx[ci], y);
                });
                y += 5;
            });
            y += 2;
        });
        pdf.save(fileBase() + '.pdf');
    }

    async function exportExcel() {
        if (!global.ExcelJS) { global.alert('Excel library did not load. Check your connection.'); return; }
        try { await ensureWeekLoaded(); } catch (e) { H.toast(H.errText(e), true); return; }
        var d = weekRowsForExport();
        var wb = new global.ExcelJS.Workbook();
        var ws = wb.addWorksheet('Weekly Stock Report');
        ws.columns = [{ width: 6 }, { width: 32 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }];
        ws.mergeCells('A1:G1'); ws.getCell('A1').value = 'SPARTAN BRISK & NUTS'; ws.getCell('A1').font = { size: 15, bold: true }; ws.getCell('A1').alignment = { horizontal: 'center' };
        ws.mergeCells('A2:G2'); ws.getCell('A2').value = 'WEEKLY STOCK REPORT'; ws.getCell('A2').font = { size: 12, bold: true }; ws.getCell('A2').alignment = { horizontal: 'center' };
        ws.addRow(['Rep Name', officerName(), 'DP Name', W.dp || '', 'Week', H.fmtDay(d.ws.mon) + ' - ' + H.fmtDay(d.ws.sun)]);
        ws.addRow([]);
        var hr = ws.addRow(['No.', 'Product', 'Opening', 'Receipt', 'Closing', 'SO Sales', 'DP Sales']);
        hr.font = { bold: true };
        hr.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE8F7' } }; });
        d.groups.forEach(function (g) {
            var cr = ws.addRow([g.cat]); cr.font = { bold: true };
            ws.mergeCells('A' + cr.number + ':G' + cr.number);
            g.items.forEach(function (it, i) { ws.addRow([i + 1, it.p, it.r.opening, it.r.receipt, it.r.closing, it.r.soSales, it.r.dpSales]); });
        });
        var buf = await wb.xlsx.writeBuffer();
        var a = doc.createElement('a');
        a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        a.download = fileBase() + '.xlsx';
        doc.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    // =========================================================================================== ASM: Team Shops & Targets
    var T = { tab: 'shops', q: '', editing: null, month: null, officerFilter: '' };

    function officerOptions(sel, allLabel) {
        return (allLabel ? '<option value="">' + allLabel + '</option>' : '<option value="">— Choose Sales Officer —</option>') +
            (S.team || []).map(function (u) {
                return '<option value="' + u.id + '"' + (String(sel) === String(u.id) ? ' selected' : '') + '>' + esc(u.name) + (u.area ? ' — ' + esc(u.area) : '') + '</option>';
            }).join('');
    }

    async function openTeam(tab) {
        T.tab = tab || T.tab || 'shops';
        var m = H.mm();
        m.title.textContent = '🏬 Team Shops & Targets';
        if (m.tabs) {
            m.tabs.innerHTML = [['shops', '🏬 Shops'], ['targets', '🎯 Targets vs Sales']].map(function (t) {
                return '<button type="button" class="wsr2-cat' + (t[0] === T.tab ? ' on' : '') + '" style="margin-right:6px;" onclick="SOReports.openTeam(\'' + t[0] + '\')">' + t[1] + '</button>';
            }).join('');
        }
        m.body.innerHTML = '<div id="sos-team"><div class="sos-empty">Loading your team…</div></div>';
        m.overlay.classList.add('open');
        try {
            await loadTeam(true);
            if (T.tab === 'shops') {
                S.teamShops = (await H.api().teamShops()) || [];
                renderTeamShops();
            } else {
                await renderTeamTargets();
            }
        } catch (e) {
            var b = $('sos-team'); if (b) b.innerHTML = '<div class="sos-empty">' + esc(H.errText(e)) + '</div>';
        }
    }

    function shopForm(s) {
        s = s || {};
        var loc = (s.latitude != null && s.longitude != null) ? s.latitude + ', ' + s.longitude : '';
        return '<div class="sos-card"><div class="sos-head"><div class="sos-title">' + (T.editing ? '✏️ Edit shop' : '➕ Add a shop for your Sales Officer') + '</div>' +
            (T.editing ? '<button class="sos-btn" onclick="SOReports.cancelEdit()">✕ Cancel</button>' : '') + '</div>' +
            '<div class="sos-form">' +
            '<label>Shop name *<input id="ts-name" value="' + esc(s.name || '') + '" placeholder="e.g. Sri Murugan Stores" maxlength="150"></label>' +
            '<label>Sales Officer *<select id="ts-officer" onchange="SOReports.officerPicked(this.value)">' + officerOptions(s.assignedOfficerId) + '</select></label>' +
            '<label>City / Area<input id="ts-city" value="' + esc(s.city || '') + '" placeholder="e.g. Chennai" maxlength="80"></label>' +
            '<label>Locality<input id="ts-locality" value="' + esc(s.locality || '') + '" placeholder="e.g. T. Nagar" maxlength="120"></label>' +
            '<label>Region<select id="ts-region">' + ['', 'North', 'South', 'East', 'West'].map(function (r) {
                return '<option value="' + r + '"' + ((s.region || '') === r ? ' selected' : '') + '>' + (r ? r + ' Region' : '—') + '</option>';
            }).join('') + '</select></label>' +
            '<label>Phone<input id="ts-phone" value="' + esc(s.phone || '') + '" inputmode="tel" maxlength="20"></label>' +
            '<label style="grid-column:1/-1;">Address<input id="ts-address" value="' + esc(s.address || '') + '" maxlength="255"></label>' +
            '<label style="grid-column:1/-1;">Shop location * (latitude, longitude — paste from Google Maps, or stand at the shop and tap 📍)' +
            '<span style="display:flex;gap:8px;flex-wrap:wrap;"><input id="ts-loc" value="' + esc(loc) + '" placeholder="13.0418, 80.2341" style="flex:1;min-width:180px;">' +
            '<button type="button" class="sos-btn" onclick="SOReports.useMyLocation()">📍 Use my location</button></span></label>' +
            '<label>Check-in radius (m)<input id="ts-radius" type="number" min="10" max="500" value="' + esc(s.allowedRadiusMeters || 50) + '"></label>' +
            '</div>' +
            '<div class="wsr2-actions"><button class="btn-primary" id="ts-save" onclick="SOReports.saveShop()">' + (T.editing ? '💾 Save changes' : '➕ Add shop') + '</button>' +
            '<span id="ts-msg" class="sos-msg"></span></div></div>';
    }

    function renderTeamShops() {
        var box = $('sos-team');
        if (!box) return;
        var editing = T.editing ? S.teamShops.find(function (x) { return x.id === T.editing; }) : null;
        box.innerHTML = (S.team && S.team.length ? shopForm(editing)
                : '<div class="sos-card"><div class="sos-empty">No active Sales Officer reports to you yet. Ask the Admin to set you as their reporting manager.</div></div>') +
            '<div class="sos-card"><div class="sos-head"><div><div class="sos-title">Shops of your team</div>' +
            '<div class="sos-sub">Each Sales Officer sees only the shops assigned to them here</div></div></div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;">' +
            '<input type="search" class="sos-search" style="flex:2;min-width:200px;" placeholder="Search shop by name…" value="' + esc(T.q) + '" oninput="SOReports.teamSearch(this.value)">' +
            '<select class="sos-search" style="flex:1;min-width:160px;padding-left:12px;background-image:none;" onchange="SOReports.teamFilter(this.value)">' + officerOptions(T.officerFilter, 'All Sales Officers') + '</select></div>' +
            '<div id="ts-list"></div></div>';
        renderTeamShopList();
    }

    function renderTeamShopList() {
        var box = $('ts-list');
        if (!box) return;
        var q = (T.q || '').toLowerCase();
        var list = S.teamShops.filter(function (s) {
            return (!q || s.name.toLowerCase().indexOf(q) >= 0) && (!T.officerFilter || String(s.assignedOfficerId) === String(T.officerFilter));
        });
        if (!S.teamShops.length) { box.innerHTML = '<div class="sos-empty">No shops yet. Add the first one above.</div>'; return; }
        box.innerHTML = '<div class="sos-count">' + list.length + ' of ' + S.teamShops.length + ' shops</div>' +
            '<table class="sos-tbl"><thead><tr><th>Shop</th><th>Sales Officer</th><th>City / Locality</th><th>Region</th><th>Phone</th><th></th></tr></thead><tbody>' +
            list.map(function (s) {
                return '<tr><td data-l="Shop"><b>' + esc(s.name) + '</b><div class="sos-sub">' + esc(s.code) + (s.status === 'INACTIVE' ? ' · inactive' : '') + '</div></td>' +
                    '<td data-l="Sales Officer">' + esc(s.assignedOfficerName || '— unassigned —') + '</td>' +
                    '<td data-l="City / Locality">' + esc([s.city, s.locality].filter(Boolean).join(' · ') || '—') + '</td>' +
                    '<td data-l="Region">' + esc(s.region || '—') + '</td>' +
                    '<td data-l="Phone">' + esc(s.phone || '—') + '</td>' +
                    '<td><span style="display:flex;gap:6px;justify-content:flex-end;">' +
                    '<button class="sos-btn" onclick="SOReports.editShop(' + s.id + ')">✏️ Edit</button>' +
                    '<button class="sos-btn danger" onclick="SOReports.deleteShop(' + s.id + ')">🗑</button></span></td></tr>';
            }).join('') + '</tbody></table>' + (list.length ? '' : '<div class="sos-empty">No shop matches.</div>');
    }

    function readShopForm() {
        var v = function (id) { var e = $(id); return e ? e.value.trim() : ''; };
        var loc = v('ts-loc').split(/[,\s]+/).filter(Boolean).map(Number);
        return {
            body: {
                name: v('ts-name'), assignedOfficerId: v('ts-officer') ? Number(v('ts-officer')) : null,
                city: v('ts-city'), locality: v('ts-locality'), region: v('ts-region'), phone: v('ts-phone'), address: v('ts-address'),
                latitude: loc.length >= 2 ? loc[0] : null, longitude: loc.length >= 2 ? loc[1] : null,
                allowedRadiusMeters: v('ts-radius') ? Number(v('ts-radius')) : null
            },
            locOk: loc.length >= 2 && isFinite(loc[0]) && isFinite(loc[1]) && Math.abs(loc[0]) <= 90 && Math.abs(loc[1]) <= 180
        };
    }

    async function saveShop() {
        var msg = $('ts-msg'), btn = $('ts-save');
        var f = readShopForm();
        function bad(t) { if (msg) { msg.className = 'sos-msg bad'; msg.textContent = t; } }
        if (!f.body.name) return bad('Enter the shop name.');
        if (!f.body.assignedOfficerId) return bad('Choose the Sales Officer this shop is for.');
        if (!f.locOk) return bad('Enter the shop location as "latitude, longitude" (or tap 📍 at the shop).');
        if (btn) btn.disabled = true;
        try {
            var body = f.body;
            if (T.editing) {
                var cur = S.teamShops.find(function (x) { return x.id === T.editing; });
                if (cur) body.status = cur.status;
                await H.api().updateTeamShop(T.editing, body);
            } else {
                await H.api().createTeamShop(body);
            }
            var who = (S.team || []).find(function (u) { return u.id === body.assignedOfficerId; });
            H.toast((T.editing ? 'Shop updated' : '"' + body.name + '" added') + (who ? ' for ' + who.name : ''));
            T.editing = null;
            S.teamShops = (await H.api().teamShops()) || [];
            renderTeamShops();
        } catch (e) {
            if (btn) btn.disabled = false;
            bad(H.errText(e));
        }
    }

    async function deleteShop(id) {
        var s = S.teamShops.find(function (x) { return x.id === id; });
        if (!s || !global.confirm('Remove "' + s.name + '"? ' + (s.assignedOfficerName || 'The Sales Officer') + ' will no longer see it.')) return;
        try {
            await H.api().deleteTeamShop(id);
            S.teamShops = S.teamShops.filter(function (x) { return x.id !== id; });
            if (T.editing === id) T.editing = null;
            renderTeamShops();
            H.toast('Shop removed');
        } catch (e) { H.toast(H.errText(e), true); }
    }

    async function useMyLocation() {
        var msg = $('ts-msg');
        if (msg) { msg.className = 'sos-msg'; msg.textContent = 'Reading your location…'; }
        try {
            var p = await H.api().getPosition();
            var el = $('ts-loc'); if (el) el.value = p.latitude.toFixed(6) + ', ' + p.longitude.toFixed(6);
            if (msg) { msg.className = 'sos-msg ok'; msg.textContent = 'Location set (accuracy ±' + Math.round(p.accuracy) + ' m).'; }
        } catch (e) { if (msg) { msg.className = 'sos-msg bad'; msg.textContent = H.errText(e); } }
    }

    // ---- targets vs sales per officer
    async function renderTeamTargets() {
        var box = $('sos-team');
        var month = T.month || H.monthKey(H.todayIso());
        T.month = month;
        var first = month + '-01', today = H.todayIso();
        var to = H.minIso(H.monthEnd(first), today);
        var team = S.team || [];
        var targets = (await H.api().teamTargets(month)) || [];
        var actual = {};
        if (first <= today) {
            await Promise.all(team.map(async function (u) {
                try {
                    var list = await H.api().stock({ officerId: u.id, from: first, to: to });
                    var a = { so: 0, dp: 0 };
                    (list || []).forEach(function (e) { a.so += H.valueOf(e, 'soSales'); a.dp += H.valueOf(e, 'dpSales'); });
                    actual[u.id] = a;
                } catch (e) { actual[u.id] = { so: 0, dp: 0 }; }
            }));
        }
        var tot = { t: 0, so: 0, dp: 0 };
        var rows = team.map(function (u) {
            var t = targets.find(function (x) { return x.officerId === u.id; });
            var amt = t ? t.amount : 0, a = actual[u.id] || { so: 0, dp: 0 };
            tot.t += amt; tot.so += a.so; tot.dp += a.dp;
            var pct = amt ? Math.round((a.so + a.dp) * 100 / amt) : 0;
            return '<tr><td data-l="Sales Officer"><b>' + esc(u.name) + '</b><div class="sos-sub">' + esc(u.area || '') + '</div></td>' +
                '<td data-l="Target (₹)"><span style="display:flex;gap:6px;"><input type="number" min="0" step="1000" id="tt-' + u.id + '" value="' + (amt || '') + '" placeholder="0" style="width:120px;padding:7px 8px;border:1px solid #D3E2F5;border-radius:7px;font-family:inherit;">' +
                '<button class="sos-btn pri" onclick="SOReports.saveTarget(' + u.id + ')">Save</button></span></td>' +
                '<td data-l="SO Sales">' + inr(a.so) + '</td><td data-l="DP Sales">' + inr(a.dp) + '</td><td data-l="Total">' + inr(a.so + a.dp) + '</td>' +
                '<td data-l="Achieved" style="min-width:120px;">' + (amt ? '<div class="sos-prog" style="margin:0 0 3px;"><div style="width:' + Math.min(100, pct) + '%"></div></div>' + pct + '%' : '—') + '</td>' +
                '<td><button class="sos-btn" onclick="SOReports.openPerformance(' + u.id + ', \'' + jsq(u.name) + ' — Sales Performance\')">📈 Graphs</button></td></tr>';
        }).join('');
        box.innerHTML = '<div class="sos-card"><div class="sos-head"><div><div class="sos-title">🎯 Monthly targets vs actual sales</div>' +
            '<div class="sos-sub">Actual = SO Sales + DP Sales from each officer\'s stock report (quantity × price)</div></div>' +
            '<label class="wsr2-field">Month<input type="month" value="' + month + '" max="' + H.monthKey(today) + '" onchange="SOReports.teamMonth(this.value)"></label></div>' +
            (team.length ? '' : '<div class="sos-empty">No active Sales Officer reports to you yet.</div>') +
            (team.length ? '<div class="sos-chart" style="margin-bottom:12px;"><h4>Team — Target vs Actual</h4>' + targetBars(tot.t, tot.so, tot.dp) + '</div>' : '') +
            (team.length ? '<table class="sos-tbl"><thead><tr><th>Sales Officer</th><th>Target (₹)</th><th>SO Sales</th><th>DP Sales</th><th>Total</th><th>Achieved</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' : '') +
            '</div>';
    }

    async function saveTarget(uid) {
        var el = $('tt-' + uid);
        var amt = el ? Math.round(Number(el.value) || 0) : 0;
        try {
            await H.api().setTarget({ officerId: uid, month: T.month, amount: amt });
            H.toast('Target saved: ' + inr(amt));
            await renderTeamTargets();
        } catch (e) { H.toast(H.errText(e), true); }
    }

    function mountManagerNav() {
        var nav = doc.querySelector('#asm-dashboard-view .asm2-nav');
        if (!nav || $('asm2-nav-teamshops')) return;
        var logout = $('asm-logout-btn');
        function item(id, label, svg, fn) {
            var a = doc.createElement('a');
            a.className = 'asm2-nav-item';
            a.id = id;
            a.style.cursor = 'pointer';
            a.innerHTML = '<span class="asm2-nav-svg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + svg + '</svg></span> ' + label;
            a.onclick = function () { try { asm2Nav(a); } catch (e) { /* ignore */ } fn(); }; // eslint-disable-line no-undef
            nav.insertBefore(a, logout || null);
        }
        item('asm2-nav-teamshops', 'Team Shops', '<path d="M4 9.5 5.6 4h12.8L20 9.5"/><path d="M4 9.5h16v2a2.7 2.7 0 0 1-5.3 0 2.7 2.7 0 0 1-5.4 0 2.7 2.7 0 0 1-5.3 0z"/><path d="M5.5 13.5V20h13v-6.5"/><path d="M10 20v-4h4v4"/>', function () { openTeam('shops'); });
        item('asm2-nav-teamtargets', 'Targets vs Sales', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', function () { openTeam('targets'); });
    }

    // =========================================================================================== wiring
    global.SOReports = {
        openPerformance: openPerformance,
        openTeam: openTeam,
        wsrInput: function (el) {
            var p = el.getAttribute('data-p'), f = el.getAttribute('data-f');
            var v = el.value === '' ? 0 : Math.max(0, Math.floor(Number(el.value) || 0));
            (W.draft[p] = W.draft[p] || {})[f] = v;
            recalcRow(p);
        },
        wsrCat: function (i) { W.cat = i; wsrRender(); },
        wsrDate: async function (v) {
            if (!v) return;
            if (v > H.todayIso()) { H.toast('Stock cannot be entered for a future date.', true); var d = $('wsr2-date'); if (d) d.value = W.date; return; }
            if (Object.keys(W.draft).length && !global.confirm('You have unsaved stock for ' + H.fmtDay(W.date) + '. Discard it?')) {
                var d2 = $('wsr2-date'); if (d2) d2.value = W.date; return;
            }
            W.date = v; W.draft = {}; W.dpDirty = false;
            var r = $('wsr2-root'); if (r) r.innerHTML = '<div class="sos-empty">Loading…</div>';
            try { await loadWsr(); wsrRender(); } catch (e) { if (r) r.innerHTML = '<div class="sos-empty">' + esc(H.errText(e)) + '</div>'; }
        },
        wsrSave: wsrSave,
        teamSearch: function (q) { T.q = q; renderTeamShopList(); },
        teamFilter: function (v) { T.officerFilter = v; renderTeamShopList(); },
        teamMonth: function (m) { T.month = m; renderTeamTargets().catch(function (e) { H.toast(H.errText(e), true); }); },
        editShop: function (id) { T.editing = id; renderTeamShops(); var n = $('ts-name'); if (n) { n.focus(); n.scrollIntoView({ block: 'center' }); } },
        cancelEdit: function () { T.editing = null; renderTeamShops(); },
        officerPicked: function (id) {
            var u = (S.team || []).find(function (x) { return String(x.id) === String(id); });
            var c = $('ts-city');
            if (u && c && !c.value.trim() && u.area) c.value = u.area;
        },
        saveShop: saveShop,
        deleteShop: deleteShop,
        useMyLocation: useMyLocation,
        saveTarget: saveTarget
    };

    global.openSOWeeklyReport = openWeekly;
    global.exportWeeklyReportPDF = function () { exportPdf(); };
    global.exportWeeklyReportExcel = function () { exportExcel().catch(function (e) { global.alert('Could not generate the Excel file: ' + H.errText(e)); }); };

    (global.SOSalesParts = global.SOSalesParts || []).push({
        onSignedIn: function (user) {
            wrapTargets();
            if (user && user.role === 'SO') renderPerformanceCard();
            if (user && ['ASM', 'RM', 'RSM'].indexOf(user.role) >= 0) mountManagerNav();
        },
        refresh: renderPerformanceCard
    });
    wrapTargets();
    mountManagerNav();
})(window);
