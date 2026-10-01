/*
 * so-sales.js — Sales Officer dashboard data that lives on the server (MySQL), so it is the same on every device.
 *
 *   ASM adds shops (Team Shops)  ->  Sales Officer: My Area & Shops, Daily Shop Report, shop check-in
 *   SO adds own shop (GPS)       ->  same list (POST /api/shops/mine, assigned to the SO) + visible to the ASM
 *   ASM sets monthly target      ->  Sales Officer: My Targets -> Target vs Actual graph
 *   Sales Officer daily stock    ->  Weekly Stock Report: Opening / Receipt / Closing / SO Sales / DP Sales
 *                                    Closing = Opening + Receipt - SO Sales - DP Sales, next day's Opening = Closing
 *   DP names                     ->  shared dropdown (anyone can add a new name)
 *
 * No shop is hard-coded any more: the generated demo shops are emptied on load, and a Sales Officer only ever sees the
 * shops returned by GET /api/shops/mine (added by their ASM or by themselves, always on the server).
 *
 * Loaded after api.js, backend-bridge.js and admin-console.js. It overrides a few global functions of index.html
 * (getMyShopsForOfficer, showMyAreaShops, openSOWeeklyReport, ...) the same way backend-bridge.js does.
 */
(function (global) {
    'use strict';

    var doc = global.document;
    var S = {
        user: null,
        shops: [],            // SO: my shops (legacy shape the dashboard understands)
        shopsLoaded: false,
        dp: [],               // DP names
        dpLoaded: false,
        team: null,           // managers: active Sales Officers in my team (from /api/users)
        teamShops: []         // managers: shops of my team (server shape)
    };
    var SO_COLOR = '#2a78d6', DP_COLOR = '#eb6834', TARGET_COLOR = '#B8C2D0', TOTAL_COLOR = '#04344C';

    // ------------------------------------------------------------------ small helpers
    function $(id) { return doc.getElementById(id); }
    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function jsq(v) { return esc(v).replace(/\\/g, '\\\\').replace(/&#39;/g, "\\'"); }
    function inr(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }
    function num(n) { return (Number(n) || 0).toLocaleString('en-IN'); }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function parseIso(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function todayIso() { return iso(new Date()); }
    function addDays(s, n) { var d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); }
    function mondayOf(s) { var d = parseIso(s); var dow = d.getDay(); d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow)); return iso(d); }
    function monthKey(s) { return String(s).slice(0, 7); }
    function monthStart(s) { return monthKey(s) + '-01'; }
    function monthEnd(s) { var d = parseIso(monthStart(s)); d.setMonth(d.getMonth() + 1); d.setDate(0); return iso(d); }
    function minIso(a, b) { return a < b ? a : b; }
    function fmtDay(s) { return parseIso(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); }
    function fmtLong(s) { return parseIso(s).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }); }
    function monthLabel(m) { return parseIso(m + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); }
    function api() { return global.SPApi; }
    function errText(e) { try { return api().friendlyError(e); } catch (x) { return (e && e.message) || 'Something went wrong.'; } }
    function role() { try { return currentRole; } catch (e) { return null; } } // eslint-disable-line no-undef
    function isSO() { return role() === 'so'; }
    function isManagerUser() { return S.user && ['ASM', 'RM', 'RSM', 'ADMIN', 'OWNER'].indexOf(S.user.role) >= 0; }
    function mm() {
        try {
            return { overlay: mmModalOverlay, title: mmTitleEl, tabs: mmTabsEl, body: mmBodyEl }; // eslint-disable-line no-undef
        } catch (e) {
            return { overlay: $('mm-section-modal-overlay'), title: $('mm-section-title'), tabs: $('mm-section-tabs'), body: $('mm-section-body') };
        }
    }
    function officerRec() { try { return currentOfficer; } catch (e) { return null; } } // eslint-disable-line no-undef
    function toast(msg, bad) {
        var t = $('sos-toast');
        if (!t) { t = doc.createElement('div'); t.id = 'sos-toast'; doc.body.appendChild(t); }
        t.textContent = msg;
        t.className = 'show' + (bad ? ' bad' : '');
        clearTimeout(toast._t);
        toast._t = setTimeout(function () { t.className = ''; }, 3200);
    }

    // ------------------------------------------------------------------ prices (for ₹ values of stock sales)
    var priceMap = null;
    function normName(n) {
        return String(n || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ')
            .replace(/\bMEXICIAN\b/g, 'MEXICAN').replace(/\bPROTIEN\b/g, 'PROTEIN').replace(/\bDRIEY\b/g, 'DRIED')
            .replace(/\bPUMKIN\b/g, 'PUMPKIN').replace(/\bKASMIR\b/g, 'KASHMIR').replace(/\s+/g, ' ').trim();
    }
    function priceFor(product) {
        if (!priceMap) {
            priceMap = {};
            [function () { return psProducts; }, function () { return productCatalog; }].forEach(function (get) { // eslint-disable-line no-undef
                var list; try { list = get(); } catch (e) { list = null; }
                (list || []).forEach(function (p) {
                    var k = normName(p.name);
                    if (k && priceMap[k] == null && Number(p.price)) priceMap[k] = Number(p.price);
                });
            });
        }
        var k = normName(product);
        if (priceMap[k] != null) return priceMap[k];
        var alt = k.replace(/ 230GM/, ' 230 GM');   // a few catalogue spellings differ
        return priceMap[alt] != null ? priceMap[alt] : 0;
    }
    function valueOf(e, field) {
        var p = Number(e.unitPrice) || priceFor(e.product);
        return (Number(e[field]) || 0) * p;
    }

    // ------------------------------------------------------------------ CSS
    function injectCss() {
        if ($('sos-css')) return;
        var css = [
            '#sos-toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,40px);opacity:0;background:#0F5132;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:100000;transition:all .2s;box-shadow:0 6px 18px rgba(0,0,0,.2);max-width:92vw;text-align:center}',
            '#sos-toast.show{opacity:1;transform:translate(-50%,0)}#sos-toast.bad{background:#9B2C2C}',
            '.sos-card{background:#fff;border:1px solid #E4EEF9;border-radius:14px;padding:16px;margin:14px 0}',
            '.sos-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}',
            '.sos-title{font-weight:700;font-size:14px;color:#04344C}.sos-sub{font-size:11.5px;color:#6B7A90}',
            '.sos-search{width:100%;box-sizing:border-box;padding:10px 12px 10px 36px;border:1px solid #D3E2F5;border-radius:10px;font-size:13.5px;font-family:inherit;background:#fff url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 fill=%27none%27 stroke=%27%236B7A90%27 stroke-width=%272%27 viewBox=%270 0 24 24%27%3E%3Ccircle cx=%2711%27 cy=%2711%27 r=%277%27/%3E%3Cpath d=%27m20 20-3.5-3.5%27/%3E%3C/svg%3E") no-repeat 12px center}',
            '.sos-search:focus{outline:none;border-color:#4675C0;box-shadow:0 0 0 3px rgba(70,117,192,.15)}',
            '.sos-shop{display:flex;align-items:center;gap:12px;padding:11px 4px;border-bottom:1px solid #F0F4FA}.sos-shop:last-child{border-bottom:0}',
            '.sos-shop-ico{width:34px;height:34px;border-radius:10px;background:#EAF1FC;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
            '.sos-shop-main{flex:1;min-width:0}.sos-shop-name{font-weight:700;font-size:13.5px;color:#04344C;overflow-wrap:anywhere}',
            '.sos-shop-meta{font-size:11.5px;color:#6B7A90;overflow-wrap:anywhere}',
            '.sos-shop-act{display:flex;gap:6px;flex-shrink:0}.sos-btn{padding:6px 11px;font-size:11.5px;font-weight:700;border-radius:8px;border:1px solid #04344C;background:#fff;color:#04344C;cursor:pointer;font-family:inherit;white-space:nowrap}',
            '.sos-btn.pri{background:#04344C;color:#fff}.sos-btn.danger{border-color:#C0392B;color:#C0392B}.sos-btn:disabled{opacity:.5;cursor:default}',
            '.sos-empty{padding:18px 8px;text-align:center;color:#6B7A90;font-size:12.5px}',
            '.sos-shop-cats{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.sos-chip{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:#EAF1FC;color:#2E4A9E}',
            '.sos-badge-pending{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:#FFF3C4;color:#8A5F14;margin-left:6px;white-space:nowrap}',
            '.sos-cat-pick{display:flex;flex-wrap:wrap;gap:6px;grid-column:1/-1}.sos-cat-pick label{flex-direction:row!important;align-items:center;gap:6px!important;font-weight:600!important;padding:6px 10px;border:1px solid #D3E2F5;border-radius:999px;background:#fff;cursor:pointer;color:#04344C!important}',
            '.sos-cat-pick input{margin:0}.sos-form .sos-wide{grid-column:1/-1}',
            '.sos-count{font-size:11.5px;color:#6B7A90;margin:8px 0 2px}',
            '.sos-dp-select{flex:1;min-width:0;border:0;padding:7px 9px;font-family:inherit;font-size:12.5px;font-weight:600;color:#0B3555;background:transparent;cursor:pointer}',
            '.sos-dp-select:focus{outline:none;background:#FFFBEF}',
            '.dsr-search-wrap{position:relative;margin:0 0 12px}.dsr-search-list{position:absolute;left:0;right:0;top:100%;z-index:20;background:#fff;border:1px solid #D3E2F5;border-radius:10px;box-shadow:0 10px 24px rgba(4,52,76,.14);max-height:260px;overflow:auto;display:none}',
            '.dsr-search-list.open{display:block}.dsr-search-item{padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F0F4FA}.dsr-search-item:hover,.dsr-search-item.hl{background:#F2F7FE}',
            '.dsr-search-item small{display:block;color:#6B7A90;font-size:11px}',
            'tr.dsr-flash td{animation:dsrFlash 1.6s ease}@keyframes dsrFlash{0%,40%{background:#FFF3C4}100%{background:transparent}}',
            // weekly stock
            '.wsr2-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:12px}',
            '.wsr2-field{display:flex;flex-direction:column;gap:4px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#5C6E88}',
            '.wsr2-field input,.wsr2-field select{padding:9px 10px;border:1px solid #D3E2F5;border-radius:9px;font-size:13px;font-family:inherit;color:#04344C;text-transform:none;letter-spacing:0;font-weight:600;background:#fff;min-width:0}',
            '.wsr2-cats{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:10px;-webkit-overflow-scrolling:touch}',
            '.wsr2-cat{flex-shrink:0;padding:7px 12px;border-radius:999px;border:1px solid #D3E2F5;background:#fff;font-size:11.5px;font-weight:700;color:#04344C;cursor:pointer;font-family:inherit;white-space:nowrap}',
            '.wsr2-cat.on{background:#04344C;border-color:#04344C;color:#fff}',
            '.wsr2-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #E4EEF9;border-radius:12px}',
            '.wsr2-table{width:100%;border-collapse:collapse;min-width:780px;font-size:12.5px}',
            '.wsr2-table th{background:#F0F5FB;color:#04344C;font-size:11px;text-transform:uppercase;letter-spacing:.03em;padding:9px 8px;text-align:left;white-space:nowrap}',
            '.wsr2-table th.n,.wsr2-table td.n{text-align:right}.wsr2-table td{padding:6px 8px;border-top:1px solid #F0F4FA;color:#04344C}',
            '.wsr2-table input{width:78px;box-sizing:border-box;padding:7px 8px;border:1px solid #D3E2F5;border-radius:7px;text-align:right;font-family:inherit;font-size:13px;color:#04344C}',
            '.wsr2-table input:focus{outline:none;border-color:#4675C0;background:#FFFBEF}',
            '.wsr2-auto{display:inline-block;min-width:60px;padding:6px 8px;border-radius:7px;background:#F4F7FB;font-weight:700;text-align:right}',
            '.wsr2-auto.neg{background:#FDECEC;color:#C0392B}.wsr2-closing{background:#E7F6EE;color:#1E7A4F}',
            '.wsr2-table tfoot td{background:#F6EFDC;font-weight:800}',
            '.wsr2-note{font-size:11.5px;color:#6B7A90;margin:10px 0}',
            '.wsr2-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}',
            '@media (max-width:640px){',
            '  .wsr2-table{min-width:0}.wsr2-table thead{display:none}.wsr2-table tr{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;padding:10px;border-top:1px solid #E4EEF9}',
            '  .wsr2-table td{border:0;padding:0;display:flex;justify-content:space-between;align-items:center;gap:6px}',
            '  .wsr2-table td[data-l]::before{content:attr(data-l);font-size:10.5px;font-weight:700;color:#5C6E88;text-transform:uppercase}',
            '  .wsr2-table td.wsr2-prod{grid-column:1/-1;font-weight:800;font-size:13px}.wsr2-table td.wsr2-no{display:none}',
            '  .wsr2-table input{width:84px}.wsr2-table tfoot tr{background:#F6EFDC}',
            '}',
            // charts
            '.sos-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}',
            '.sos-kpi{background:#F7FAFE;border:1px solid #E4EEF9;border-radius:12px;padding:12px}',
            '.sos-kpi-l{font-size:11px;color:#6B7A90;display:flex;align-items:center;gap:6px}.sos-kpi-v{font-family:"Space Grotesk",sans-serif;font-size:19px;font-weight:700;color:#04344C;margin-top:3px}',
            '.sos-sw{width:10px;height:10px;border-radius:3px;display:inline-block;flex-shrink:0}',
            '.sos-chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}',
            '.sos-chart{background:#fff;border:1px solid #E4EEF9;border-radius:14px;padding:14px;min-width:0}',
            '.sos-chart h4{margin:0 0 2px;font-size:13.5px;color:#04344C}.sos-chart .sos-sub{margin-bottom:8px}',
            '.sos-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:#52514e;margin:4px 0 8px}.sos-legend span{display:flex;align-items:center;gap:6px}',
            '.sos-chart svg{width:100%;height:auto;display:block;overflow:visible}',
            '.sos-chart svg text{font-family:inherit}.sos-chart rect.hit{fill:transparent}.sos-chart g.bar:hover rect.mk{opacity:.8}',
            '.sos-prog{height:10px;border-radius:6px;background:#EEF1F6;overflow:hidden;margin:8px 0 4px}.sos-prog>div{height:100%;border-radius:6px;background:linear-gradient(90deg,#2a78d6,#1baf7a)}',
            '.sos-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}',
            '.sos-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}',
            '.sos-form label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;color:#5C6E88}',
            '.sos-form input,.sos-form select{padding:9px 10px;border:1px solid #D3E2F5;border-radius:9px;font-size:13px;font-family:inherit;color:#04344C;background:#fff;min-width:0}',
            '.sos-msg{font-size:12px;margin-top:8px;min-height:16px}.sos-msg.bad{color:#C0392B}.sos-msg.ok{color:#1E7A4F}',
            '.sos-tbl{width:100%;border-collapse:collapse;font-size:12.5px}.sos-tbl th{background:#F0F5FB;text-align:left;padding:9px 8px;font-size:11px;color:#04344C;white-space:nowrap}',
            '.sos-tbl td{padding:9px 8px;border-top:1px solid #F0F4FA;color:#04344C;vertical-align:middle}',
            '@media (max-width:640px){.sos-tbl thead{display:none}.sos-tbl tr{display:block;border-top:1px solid #E4EEF9;padding:8px 0}.sos-tbl td{display:flex;justify-content:space-between;gap:10px;border:0;padding:4px 6px}',
            '  .sos-tbl td[data-l]::before{content:attr(data-l);font-size:10.5px;font-weight:700;color:#5C6E88;text-transform:uppercase}.sos-shop{flex-wrap:wrap}.sos-shop-act{width:100%;justify-content:flex-end}}',
            // ---- Messages: responsive on desktop, tablet and phone ----
            '#role-msg-modal-overlay{padding:16px;box-sizing:border-box}',
            '#role-msg-modal-overlay .modal-card{width:100%;max-width:820px;box-sizing:border-box;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;overflow-y:auto}',
            '#role-msg-to{max-width:100%}#role-msg-list > div{flex-wrap:wrap}#role-msg-list > div > div{overflow-wrap:anywhere;word-break:break-word}',
            '#role-msg-tabs{overflow-x:auto;flex-wrap:nowrap!important;-webkit-overflow-scrolling:touch;max-width:100%}#role-msg-tabs > *{flex-shrink:0}',
            '@media (max-width:900px){#role-msg-modal-overlay .modal-card{padding:22px 18px}#role-msg-title{font-size:21px!important;padding-right:34px}}',
            '@media (max-width:600px){',
            '  #role-msg-modal-overlay{padding:0;align-items:stretch}',
            '  #role-msg-modal-overlay .modal-card{max-width:none;max-height:none;height:100%;height:100dvh;border-radius:0;padding:18px 14px calc(18px + env(safe-area-inset-bottom))}',
            '  #role-msg-modal-overlay .modal-close{top:12px;right:10px;font-size:26px;padding:4px 8px}',
            '  #role-msg-title{font-size:19px!important}',
            '  #role-msg-to,#role-msg-text{width:100%;min-width:0!important;flex:1 1 100%!important;box-sizing:border-box;font-size:16px!important}',
            '  #role-msg-modal-overlay .btn-primary{width:100%}',
            '  #role-msg-list > div{gap:8px!important}#role-msg-list > div > div:last-child{white-space:normal!important;width:100%;padding-left:44px}',
            '}'
        ].join('\n');
        var st = doc.createElement('style');
        st.id = 'sos-css';
        st.textContent = css;
        doc.head.appendChild(st);
    }

    // ------------------------------------------------------------------ no hard-coded shops
    // The generated city lists (100 made-up shops per city) are emptied. Cities stay, so city pickers keep working.
    function purgeDemoShops() {
        try {
            for (var c in areaShopMap) { // eslint-disable-line no-undef
                if (areaShopMap[c] && Array.isArray(areaShopMap[c].shops)) areaShopMap[c].shops.length = 0; // eslint-disable-line no-undef
            }
        } catch (e) { /* map not on this page */ }
    }
    function ensureCity(city) {
        if (!city) return;
        try {
            if (!areaShopMap[city]) { // eslint-disable-line no-undef
                areaShopMap[city] = { officers: {}, baseLat: 11.1271, baseLng: 78.6569, regions: ['North', 'South', 'East', 'West'], shops: [] }; // eslint-disable-line no-undef
            }
        } catch (e) { /* ignore */ }
    }

    // server shop -> the shape the existing dashboard code uses
    function toLegacy(sh) {
        return {
            id: sh.code, _sid: sh.id, _server: true, fromASM: true,
            name: sh.name, locality: sh.locality || '', region: sh.region || '', city: sh.city || '',
            address: sh.address || '', phone: sh.phone || '', mobile: sh.phone || '',
            lat: sh.latitude, lng: sh.longitude, radius: sh.allowedRadiusMeters,
            owner: sh.assignedOfficerName || '', addedBy: sh.createdByName || '', status: 'Active',
            categories: sh.productCategories || '', addedAt: sh.createdAt ? Date.parse(sh.createdAt) : null,
            _pending: !!sh._pending
        };
    }

    // ------------------------------------------------------------------ Sales Officer: my shops
    async function loadSOShops() {
        var list;
        try { list = await api().myShops(); }
        catch (e) { S.shopsLoaded = true; toast('Could not load your shops: ' + errText(e), true); return; }
        S.shops = (list || []).map(toLegacy);
        Outbox.pending('shop').forEach(function (it) {   // added offline, not on the server yet
            var b = it.payload || {};
            if (!S.shops.some(function (x) { return (x.name || '').toLowerCase() === String(b.name || '').toLowerCase(); })) {
                S.shops.push(toLegacy({ code: 'PENDING-' + it.id, name: b.name, locality: b.locality, city: b.city, region: b.region, address: b.address,
                    phone: b.phone, productCategories: b.productCategories, latitude: b.latitude, longitude: b.longitude, allowedRadiusMeters: 50, _pending: true }));
            }
        });
        S.shopsLoaded = true;

        var o = officerRec();
        var city = (S.user && S.user.area) || (S.shops[0] && S.shops[0].city) || '';
        if (o && city) { ensureCity(city); o.workArea = city; }
        if (o) syncVisitsWithShops(o);
        refreshSOScreens();
    }

    // Today's plan keeps what the officer already did at a shop, drops shops that are not theirs any more, and adds the
    // ASM's new shops as Pending — so the Daily Shop Report and the shop screens only ever list ASM shops.
    function syncVisitsWithShops(o) {
        var names = {};
        S.shops.forEach(function (s) { names[s.name] = s; });
        var kept = (o.plannedVisitsList || []).filter(function (v) { return names[v.shop]; });
        var have = {};
        kept.forEach(function (v) { have[v.shop] = true; });
        S.shops.forEach(function (s) {
            if (!have[s.name]) kept.push({ shop: s.name, location: s.locality || s.city || '', time: '—', status: 'Pending', gps: undefined });
        });
        o.plannedVisitsList = kept;
        o.plannedVisits = kept.length;
        try { saveSOOfficers(); } catch (e) { /* ignore */ } // eslint-disable-line no-undef
    }

    function refreshSOScreens() {
        if (!isSO()) return;
        try { renderSOKPIs(); } catch (e) { /* ignore */ }   // eslint-disable-line no-undef
        try { renderSOTasks(); } catch (e) { /* ignore */ }  // eslint-disable-line no-undef
        var m = mm();
        if (m.overlay && m.overlay.classList.contains('open') && m.title) {
            var t = m.title.textContent || '';
            if (/My Area/.test(t)) global.showMyAreaShops();
            else if (/Daily Shop Report/.test(t) && global.openDailyShopReport) global.openDailyShopReport();
        }
        renderPerformanceCard();
    }

    function shopMatches(s, q) {
        if (!q) return true;
        q = q.toLowerCase();
        return (s.name || '').toLowerCase().indexOf(q) >= 0;
    }

    function shopRowHtml(s) {
        var meta = [s.locality, s.city, s.region ? s.region + ' Region' : ''].filter(Boolean).join(' · ');
        var hasPin = s.lat != null && s.lng != null && !(Number(s.lat) === 0 && Number(s.lng) === 0);
        return '<div class="sos-shop">' +
            '<div class="sos-shop-ico">🏬</div>' +
            '<div class="sos-shop-main"><div class="sos-shop-name">' + esc(s.name) +
            (s._pending ? ' <span class="sos-badge-pending" title="Saved on this phone; it is sent to the server as soon as you are online">⏳ waiting to sync</span>' : '') + '</div>' +
            '<div class="sos-shop-meta">' + esc(meta || '—') + (s.phone ? ' · <a href="tel:' + esc(s.phone) + '">' + esc(s.phone) + '</a>' : '') +
            (s.addedBy ? ' · added by ' + esc(s.addedBy) : '') + '</div>' +
            (s.address ? '<div class="sos-shop-meta">📍 ' + esc(s.address) + '</div>' : '') +
            (s.categories ? '<div class="sos-shop-cats">' + categoryChips(s.categories) + '</div>' : '') +
            '</div>' +
            '<div class="sos-shop-act">' +
            (hasPin ? '<button class="sos-btn" onclick="showLocationMap(\'' + s.lat + '\',\'' + s.lng + '\',\'' + jsq(s.name) + '\',\'' + jsq(s.locality || s.city) + '\')">📍 Map</button>' : '') +
            '<button class="sos-btn pri" onclick="openShopVisitFlowForShop(\'' + jsq(s.id) + '\')">▶ Visit</button>' +
            '</div></div>';
    }

    function renderMyShopList(q) {
        var box = $('sos-shop-list');
        if (!box) return;
        if (!S.shopsLoaded) { box.innerHTML = '<div class="sos-empty">Loading your shops…</div>'; return; }
        var hits = S.shops.filter(function (s) { return shopMatches(s, q); });
        var cnt = $('sos-shop-count');
        if (cnt) cnt.textContent = q ? hits.length + ' of ' + S.shops.length + ' shops' : S.shops.length + ' shops';
        if (!S.shops.length) {
            box.innerHTML = '<div class="sos-empty">No shops yet.<br>Tap <b>➕ Add shop</b> while standing at a shop, or ask your Area Sales Manager to add it.</div>';
            return;
        }
        box.innerHTML = hits.length ? hits.map(shopRowHtml).join('')
            : '<div class="sos-empty">No shop named “' + esc(q) + '”.</div>';
    }

    function myShopsSectionHtml() {
        return '<div class="sos-card" id="sos-myshops">' +
            '<div class="sos-head"><div><div class="sos-title">🏬 My Shops</div>' +
            '<div class="sos-sub">Shops assigned to you — added by you or your Area Sales Manager</div></div>' +
            '<span style="display:flex;gap:6px;flex-wrap:wrap"><button class="sos-btn pri" onclick="SOSales.addShop()">➕ Add shop</button>' +
            '<button class="sos-btn" onclick="SOSales.reloadShops()">↻ Refresh</button>' +
            '<button class="sos-btn" onclick="SOReports.exportShops(SOSales.shops(), \'My Shops\', \'pdf\')">📄 PDF</button>' +
            '<button class="sos-btn" onclick="SOReports.exportShops(SOSales.shops(), \'My Shops\', \'excel\')">📊 Excel</button></span></div>' +
            '<input type="search" class="sos-search" id="sos-shop-search" placeholder="Search shop by name…" autocomplete="off" oninput="SOSales.filterShops(this.value)">' +
            '<div class="sos-count" id="sos-shop-count"></div>' +
            '<div id="sos-shop-list"></div></div>';
    }

    function installShopOverrides() {
        var origGet = global.getMyShopsForOfficer;
        if (typeof origGet === 'function' && !origGet.__sos) {
            var g = function (info) {
                if (isSO()) return S.shops.slice();
                return origGet.apply(this, arguments);
            };
            g.__sos = true;
            global.getMyShopsForOfficer = g;
        }

        var origArea = global.showMyAreaShops;
        if (typeof origArea === 'function' && !origArea.__sos) {
            var a = function () {
                var out = origArea.apply(this, arguments);
                if (isSO()) decorateMyArea();
                return out;
            };
            a.__sos = true;
            global.showMyAreaShops = a;
        }

        // The Sales Officer adds a shop while standing at it: it is saved on the server with their GPS position and
        // assigned to them, so it shows up in shop check-in (attendance) and in their ASM's Team Shops straight away.
        var origAdd = global.openSOAddShop;
        global.openSOAddShop = function () {
            if (!isSO()) return typeof origAdd === 'function' ? origAdd.apply(this, arguments) : undefined;
            openAddShopForm();
        };
        global.soAddOwnShop = function () { openAddShopForm(); };
    }

    // ------------------------------------------------------------------ product categories of a shop
    // The same category names the stock report and the sales analysis use, so a shop's categories line up with sales.
    function productCategories() {
        var c = global.WSR_CATALOG;
        var list = Array.isArray(c) && c.length ? c.map(function (g) { return g.cat; }) : [];
        return list.length ? list : ['DRY FRUITS', 'SEEDS', 'ROASTED NUTS & SEEDS', 'BERRIES', 'DATES VARIETY', 'MAKKANA VARIETIES', 'SPICES'];
    }
    function catLabel(c) { return String(c || '').toLowerCase().replace(/\b\w/g, function (x) { return x.toUpperCase(); }); }
    function splitCats(v) { return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
    function categoryChips(v) { return splitCats(v).map(function (c) { return '<span class="sos-chip">' + esc(catLabel(c)) + '</span>'; }).join(''); }
    /** Checkbox list; read it back with pickedCats(prefix). */
    function categoryPickerHtml(prefix, selected) {
        var sel = splitCats(selected).map(function (x) { return x.toUpperCase(); });
        return '<div class="sos-cat-pick" id="' + prefix + '-cats">' + productCategories().map(function (c, i) {
            return '<label><input type="checkbox" value="' + esc(c) + '"' + (sel.indexOf(c.toUpperCase()) >= 0 ? ' checked' : '') + '> ' + esc(catLabel(c)) + '</label>';
        }).join('') + '</div>';
    }
    function pickedCats(prefix) {
        var box = $(prefix + '-cats');
        if (!box) return null;
        return Array.prototype.slice.call(box.querySelectorAll('input:checked')).map(function (i) { return i.value; }).join(', ') || null;
    }

    // ------------------------------------------------------------------ offline outbox
    // Work done without a connection (a new shop, a Daily Shop Report) is kept on this phone and sent the moment the
    // server can be reached again: on the browser's "online" event, every 30 s while something is waiting, and right
    // after the next sign-in. Only a network failure keeps an item; a real answer from the server (saved, or refused
    // with a reason) removes it.
    var OUTBOX_KEY = 'salesHierarchyPortal_outbox_v1';
    var outboxHandlers = {};
    var flushing = false;
    function outboxAll() { try { return JSON.parse(global.localStorage.getItem(OUTBOX_KEY) || '[]'); } catch (e) { return []; } }
    function outboxSave(list) { try { global.localStorage.setItem(OUTBOX_KEY, JSON.stringify(list)); } catch (e) { /* storage full */ } }
    function meId() { return S.user ? S.user.id : (api() && api().currentUser && api().currentUser() ? api().currentUser().id : null); }
    function isNetwork(e) { return !e || e.status === 0 || e.code === 'NETWORK'; }
    var Outbox = {
        /** Items of one kind for the signed-in user. */
        pending: function (kind) {
            var me = meId();
            return outboxAll().filter(function (x) { return x.user === me && (!kind || x.kind === kind); });
        },
        /** Queue (or replace, when key is given) an item and try to send it straight away. */
        add: function (kind, payload, key) {
            var me = meId();
            var list = outboxAll().filter(function (x) { return !(key && x.user === me && x.kind === kind && x.key === key); });
            list.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), user: me, kind: kind, key: key || null, payload: payload, at: Date.now() });
            outboxSave(list);
            return Outbox.flush();
        },
        on: function (kind, fn) { outboxHandlers[kind] = fn; },
        flush: async function () {
            if (flushing || !S.user) return;
            flushing = true;
            var sentAny = false;
            try {
                var mine = Outbox.pending();
                for (var i = 0; i < mine.length; i++) {
                    var item = mine[i], fn = outboxHandlers[item.kind];
                    if (!fn) continue;
                    try {
                        await fn(item.payload, item);
                        sentAny = true;
                        outboxSave(outboxAll().filter(function (x) { return x.id !== item.id; }));
                    } catch (e) {
                        if (isNetwork(e) || e.status === 401) break;           // still offline / signed out: try again later
                        outboxSave(outboxAll().filter(function (x) { return x.id !== item.id; }));
                        toast((item.kind === 'shop' ? 'Shop "' + (item.payload && item.payload.name) + '" was not saved: ' : 'Not saved: ') + errText(e), true);
                    }
                }
            } finally { flushing = false; }
            if (sentAny) {
                if (outboxHandlers.__after) { try { outboxHandlers.__after(); } catch (e) { /* ignore */ } }
            }
            return sentAny;
        }
    };
    global.addEventListener('online', function () { Outbox.flush(); });
    setInterval(function () { if (S.user && Outbox.pending().length) Outbox.flush(); }, 30000);

    Outbox.on('shop', function (body) { return api().createMyShop(body); });
    Outbox.on('__after', function () { if (isSO()) { S.shopsLoaded = false; loadSOShops(); } });

    // ------------------------------------------------------------------ Sales Officer: add my shop (server + GPS)
    var MAX_ADD_ACCURACY_M = 100;

    function openAddShopForm() {
        var m = mm();
        if (!m.body) return;
        if (m.tabs) m.tabs.innerHTML = '';
        m.title.textContent = '➕ Add New Shop';
        var city = (S.user && S.user.area) || (officerRec() && officerRec().workArea) || '';
        m.body.innerHTML = '<div class="sos-card">' +
            '<div class="sos-sub" style="margin-bottom:10px">Stand <b>at the shop</b> and save — its location is taken from your GPS. ' +
            'The shop is added to your list, you can check in there for attendance, and your ASM sees it too.</div>' +
            '<div class="sos-form">' +
            '<label>Shop name *<input id="sos-new-name" maxlength="150" autocomplete="off"></label>' +
            '<label>Locality / street<input id="sos-new-loc" maxlength="120"></label>' +
            '<label>City<input id="sos-new-city" maxlength="80" value="' + esc(city) + '"></label>' +
            '<label>Region<select id="sos-new-region"><option>North</option><option>South</option><option>East</option><option>West</option></select></label>' +
            '<label>Mobile number<input id="sos-new-phone" maxlength="20" inputmode="tel" placeholder="10-digit mobile"></label>' +
            '<label class="sos-wide">Full address<input id="sos-new-address" maxlength="255" placeholder="Door no, street, area, city, pincode"></label>' +
            '<label class="sos-wide">Product categories this shop buys</label>' +
            categoryPickerHtml('sos-new') +
            '</div>' +
            '<div class="wsr2-actions"><button class="btn-primary" id="sos-new-save" onclick="SOSales.saveNewShop()">📍 Save at my current location</button>' +
            '<button class="btn-outline" onclick="showMyAreaShops()">Cancel</button></div>' +
            '<div id="sos-new-msg" class="sos-msg"></div></div>';
        m.overlay.classList.add('open');
        var n = $('sos-new-name'); if (n) n.focus();
    }

    function currentPosition() {
        return new Promise(function (resolve, reject) {
            if (!global.navigator || !navigator.geolocation) { reject(new Error('This browser cannot read GPS.')); return; }
            navigator.geolocation.getCurrentPosition(resolve, function (err) {
                reject(new Error(err && err.code === 1 ? 'Location permission is blocked. Allow location for this site and try again.'
                    : 'Could not read your GPS position. Move to open sky and try again.'));
            }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
        });
    }

    async function saveNewShop() {
        var msg = $('sos-new-msg'), btn = $('sos-new-save');
        function say(t, bad) { if (msg) { msg.className = 'sos-msg ' + (bad ? 'bad' : 'ok'); msg.textContent = t; } }
        var name = (($('sos-new-name') || {}).value || '').trim();
        if (!name) { say('Enter the shop name.', true); var n = $('sos-new-name'); if (n) n.focus(); return; }
        if (S.shops.some(function (s) { return (s.name || '').toLowerCase() === name.toLowerCase(); })) {
            say('You already have a shop called "' + name + '".', true); return;
        }
        if (btn) btn.disabled = true;
        say('Reading your GPS position…');
        var pos;
        try { pos = await currentPosition(); }
        catch (e) { if (btn) btn.disabled = false; say(e.message, true); return; }
        var acc = Math.round(pos.coords.accuracy || 9999);
        if (acc > MAX_ADD_ACCURACY_M) {
            if (btn) btn.disabled = false;
            say('GPS is not accurate enough yet (±' + acc + ' m, need ±' + MAX_ADD_ACCURACY_M + ' m or better). Wait a few seconds and try again.', true);
            return;
        }
        var phone = (($('sos-new-phone') || {}).value || '').trim();
        if (phone && !/^[0-9+() -]{7,20}$/.test(phone)) { if (btn) btn.disabled = false; say('Mobile number looks wrong.', true); return; }
        var body = {
            name: name,
            address: (($('sos-new-address') || {}).value || '').trim() || null,
            productCategories: pickedCats('sos-new'),
            locality: (($('sos-new-loc') || {}).value || '').trim() || null,
            city: (($('sos-new-city') || {}).value || '').trim() || null,
            region: ($('sos-new-region') || {}).value || null,
            phone: phone || null,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude
        };
        say('Saving…');
        try {
            await api().createMyShop(body);
        } catch (e) {
            if (!isNetwork(e)) {
                if (btn) btn.disabled = false;
                say(errText(e), true);
                return;
            }
            // No connection: keep it on this phone and send it as soon as the server can be reached.
            Outbox.add('shop', body, 'shop:' + name.toLowerCase());
            toast('No connection — "' + name + '" is saved on this phone and will sync automatically');
            S.shops.push(toLegacy({ code: 'PENDING-' + Date.now(), name: name, locality: body.locality, city: body.city, region: body.region,
                address: body.address, phone: body.phone, productCategories: body.productCategories, latitude: body.latitude, longitude: body.longitude,
                allowedRadiusMeters: 50, _pending: true }));
            if (typeof global.showMyAreaShops === 'function') global.showMyAreaShops();
            return;
        }
        toast('Shop "' + name + '" added — you can check in there now');
        S.shopsLoaded = false;
        await loadSOShops();
        if (typeof global.showMyAreaShops === 'function') global.showMyAreaShops();
    }

    function decorateMyArea() {
        var body = mm().body;
        if (!body) return;
        // remove the old "Add a New Shop" box (Regions level) - it only saved in this browser; the ➕ Add New Shop form saves on the server
        var addInput = $('so-my-newshop-name');
        if (addInput) {
            var box = addInput.closest('div[style*="margin-top:14px"]') || addInput.parentNode.parentNode;
            if (box && box.parentNode) box.parentNode.removeChild(box);
        }
        var lvl; try { lvl = myAreaLevel; } catch (e) { lvl = 'city'; } // eslint-disable-line no-undef
        if (lvl !== 'city' || $('sos-myshops')) return;
        var first = body.firstElementChild;
        if (first) first.insertAdjacentHTML('afterend', myShopsSectionHtml());
        else body.insertAdjacentHTML('beforeend', myShopsSectionHtml());
        renderMyShopList('');
    }

    // ------------------------------------------------------------------ DP names
    async function loadDp(force) {
        if (S.dpLoaded && !force) return S.dp;
        try {
            S.dp = ((await api().dpNames()) || []).map(function (d) { return d.name; });
            S.dpLoaded = true;
        } catch (e) { /* keep what we have */ }
        return S.dp;
    }

    /** A DP Name dropdown: saved names + "+ Add new DP name…". onPick(name) is a global function name. */
    function dpSelectHtml(id, value, onPick) {
        var names = S.dp.slice();
        if (value && names.indexOf(value) < 0) names.unshift(value);
        return '<select id="' + id + '" class="sos-dp-select" data-prev="' + esc(value || '') + '" data-pick="' + esc(onPick) + '"' +
            ' onchange="SOSales.onDpChange(this)">' +
            '<option value="">' + (names.length ? '— Select DP —' : '— No DP yet —') + '</option>' +
            names.map(function (n) { return '<option' + (n === value ? ' selected' : '') + ' value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('') +
            '<option value="__new">➕ Add new DP name…</option></select>';
    }

    async function onDpChange(sel) {
        var pick = sel.getAttribute('data-pick');
        var val = sel.value;
        if (val === '__new') {
            var name = (global.prompt('New DP (distributor) name') || '').trim();
            if (!name) { sel.value = sel.getAttribute('data-prev') || ''; return; }
            try {
                var saved = await api().addDpName(name);
                name = saved.name;
                await loadDp(true);
                toast('DP "' + name + '" added');
            } catch (e) {
                toast(errText(e), true);
                sel.value = sel.getAttribute('data-prev') || '';
                return;
            }
            var fresh = doc.createElement('div');
            fresh.innerHTML = dpSelectHtml(sel.id, name, pick);
            sel.parentNode.replaceChild(fresh.firstChild, sel);
            val = name;
        } else {
            sel.setAttribute('data-prev', val);
        }
        if (pick && typeof global[pick] === 'function') global[pick](val);
    }

    // expose what the other parts need
    global.SOSales = {
        state: S,
        isSO: isSO,
        filterShops: function (q) { renderMyShopList(q); },
        addShop: function () { openAddShopForm(); },
        outbox: Outbox,
        categoryPickerHtml: categoryPickerHtml,
        pickedCats: pickedCats,
        categoryChips: categoryChips,
        productCategories: productCategories,
        saveNewShop: saveNewShop,
        reloadShops: function () { S.shopsLoaded = false; renderMyShopList(''); return loadSOShops(); },
        shops: function () { return S.shops.slice(); },
        shopsLoaded: function () { return S.shopsLoaded; },
        dpSelectHtml: dpSelectHtml,
        onDpChange: onDpChange,
        loadDp: loadDp,
        priceFor: priceFor,
        _h: { $: $, esc: esc, jsq: jsq, inr: inr, num: num, iso: iso, todayIso: todayIso, addDays: addDays, mondayOf: mondayOf,
            monthKey: monthKey, monthStart: monthStart, monthEnd: monthEnd, minIso: minIso, fmtDay: fmtDay, fmtLong: fmtLong,
            monthLabel: monthLabel, api: api, errText: errText, mm: mm, officerRec: officerRec, toast: toast, valueOf: valueOf,
            isManagerUser: isManagerUser, colors: { so: SO_COLOR, dp: DP_COLOR, target: TARGET_COLOR, total: TOTAL_COLOR } }
    };

    // ------------------------------------------------------------------ sign-in hook
    function onSignedIn(user) {
        S.user = user;
        S.shops = []; S.shopsLoaded = false; S.team = null; S.teamShops = []; S.dpLoaded = false;
        doc.body.classList.toggle('sos-so', user && user.role === 'SO');
        purgeDemoShops();
        loadDp();
        if (user && user.role === 'SO') {
            Outbox.flush().then(function () { return loadSOShops(); }).catch(function () { loadSOShops(); });
        }
        if (global.SOSalesParts) global.SOSalesParts.forEach(function (p) { if (p.onSignedIn) { try { p.onSignedIn(user); } catch (e) { console.warn(e); } } });
    }
    function renderPerformanceCard() {
        if (global.SOSalesParts) global.SOSalesParts.forEach(function (p) { if (p.refresh) { try { p.refresh(); } catch (e) { console.warn(e); } } });
    }
    global.SOSales.refresh = renderPerformanceCard;

    function install() {
        injectCss();
        purgeDemoShops();
        installShopOverrides();
        if (global.SPBridge && !global.SPBridge.__sos) {
            var orig = global.SPBridge.onSignedIn;
            global.SPBridge.onSignedIn = function (user) {
                var out = orig.apply(this, arguments);
                onSignedIn(user);
                return out;
            };
            global.SPBridge.__sos = true;
        }
    }
    install();
})(window);
