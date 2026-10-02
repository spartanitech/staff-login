/*
 * so-orders.js — orders booked by Sales Officers are saved on the server (PUT /api/orders) and shown to the people
 * above them (GET /api/orders, scope-checked by the server):
 *
 *   Sales Officer confirms an order   ->  saved on the server at once (kept on the phone and re-sent if offline)
 *   Area Sales Manager                ->  "Team Orders" (menu) + "Orders today" card on the dashboard: own team only
 *   Admin                             ->  "Orders" section: every order
 *
 * Booking an order never marks attendance. Attendance is only the shop check-in (GPS + live photo).
 * Loaded after so-sales.js (uses its helpers and its offline outbox).
 */
(function (global) {
    'use strict';
    var doc = global.document;
    var SO = global.SOSales;
    if (!SO) return;
    var H = SO._h, esc = H.esc, inr = H.inr, $ = H.$;
    var S = { user: null, rows: [], loading: false, from: null, to: null, officer: '', q: '', open: {} };

    function api() { return H.api(); }
    function todayIso() { return H.todayIso(); }
    function isManager(u) { return !!u && ['ASM', 'RM', 'RSM'].indexOf(u.role) >= 0; }
    function isAdmin(u) { return !!u && (u.role === 'ADMIN' || u.role === 'OWNER'); }

    // =========================================================================================== Sales Officer: save
    function catalogue() {
        var out = {};
        [function () { return productCatalog; }, function () { return psProducts; }].forEach(function (get) { // eslint-disable-line no-undef
            var list; try { list = get(); } catch (e) { list = null; }
            (list || []).forEach(function (p) { if (p && p.id != null) out[p.id] = p; });
        });
        return out;
    }

    /** Items of either order shape: {items:[{name,category,price,qty}]} or {qty:{productId:qty}}. */
    function itemsOf(order) {
        if (!order) return [];
        if (Array.isArray(order.items) && order.items.length) {
            return order.items.map(function (it) {
                return { name: it.name, category: it.category || '', price: Number(it.price != null ? it.price : it.rate) || 0, qty: Number(it.qty) || 0 };
            }).filter(function (it) { return it.name && it.qty > 0; });
        }
        if (order.qty) {
            var cat = catalogue();
            return Object.keys(order.qty).map(function (id) {
                var p = cat[id] || {};
                return { name: p.name || String(id), category: p.category || '', price: Number(p.price) || 0, qty: Number(order.qty[id]) || 0 };
            }).filter(function (it) { return it.qty > 0; });
        }
        return [];
    }

    function shopIdFor(name) {
        var hit = (SO.shops() || []).find(function (s) { return String(s.name || '').toLowerCase() === String(name || '').toLowerCase(); });
        return hit && hit._sid ? hit._sid : null;
    }

    /** Called by the order screens of index.html right after the officer confirms / saves an order. */
    function push(shopName, order) {
        var u = S.user;
        if (!u || u.role !== 'SO' || !shopName) return;
        var items = itemsOf(order);
        if (!items.length) return;
        var day = order && order.orderedOn ? String(order.orderedOn).slice(0, 10) : todayIso();
        if (day > todayIso()) day = todayIso();
        var ref = (day + '|' + String(shopName).trim().toLowerCase()).slice(0, 100);   // one order per shop per day
        var body = { clientRef: ref, shopId: shopIdFor(shopName), shopName: String(shopName).trim(), date: day, items: items, status: 'CONFIRMED' };
        SO.outbox.add('order', body, ref).then(function (sent) {
            if (sent) H.toast('Order saved for ' + body.shopName + ' — your ASM can see it now');
            else if (SO.outbox.pending('order').length) H.toast('No connection — the order is kept on this phone and will be sent automatically', true);
        }).catch(function () { /* the outbox keeps it */ });
    }
    SO.outbox.on('order', function (body) { return api().saveOrder(body); });

    // =========================================================================================== shared list view
    function itemsText(o) {
        return (o.items || []).map(function (it) { return it.name + ' × ' + (Number(it.qty) || 0); }).join(', ');
    }
    function filtered() {
        var q = (S.q || '').trim().toLowerCase();
        return S.rows.filter(function (o) {
            return (!S.officer || String(o.officerId) === String(S.officer)) &&
                (!q || (o.shopName + ' ' + o.officerName + ' ' + itemsText(o)).toLowerCase().indexOf(q) >= 0);
        });
    }
    function fmtDate(d) { try { return H.fmtDay(d) + ' ' + String(d).slice(0, 4); } catch (e) { return d; } }

    async function load() {
        S.loading = true;
        try {
            S.rows = (await api().orders({ from: S.from, to: S.to })) || [];
        } finally { S.loading = false; }
    }

    function viewHtml(prefix) {
        var officers = {};
        S.rows.forEach(function (o) { officers[o.officerId] = o.officerName; });
        var list = filtered();
        var total = list.reduce(function (t, o) { return t + (Number(o.total) || 0); }, 0);
        var people = {}; list.forEach(function (o) { people[o.officerId] = 1; });
        return '<div class="sos-card">' +
            '<div class="ord-filters">' +
            '<label>From<input type="date" id="' + prefix + '-from" value="' + esc(S.from) + '" max="' + todayIso() + '"></label>' +
            '<label>To<input type="date" id="' + prefix + '-to" value="' + esc(S.to) + '" max="' + todayIso() + '"></label>' +
            '<label>Sales Officer<select id="' + prefix + '-off"><option value="">All Sales Officers</option>' +
            Object.keys(officers).sort(function (a, b) { return String(officers[a]).localeCompare(officers[b]); }).map(function (id) {
                return '<option value="' + esc(id) + '"' + (String(S.officer) === String(id) ? ' selected' : '') + '>' + esc(officers[id]) + '</option>';
            }).join('') + '</select></label>' +
            '<label class="ord-wide">Search<input type="search" id="' + prefix + '-q" value="' + esc(S.q) + '" placeholder="Shop, officer or product"></label>' +
            '</div>' +
            '<div class="ord-kpis"><div><b>' + list.length + '</b><span>Orders</span></div><div><b>' + inr(total) + '</b><span>Order value</span></div>' +
            '<div><b>' + Object.keys(people).length + '</b><span>Sales Officers</span></div></div>' +
            '<div class="sos-head" style="margin-top:6px"><div class="sos-sub">Saved by the Sales Officers on the server · newest first</div>' +
            '<span style="display:flex;gap:6px;flex-wrap:wrap"><button class="sos-btn" id="' + prefix + '-reload">↻ Refresh</button>' +
            '<button class="sos-btn" id="' + prefix + '-xls">📊 Excel</button></span></div>' +
            (S.loading ? '<div class="sos-empty">Loading orders…</div>'
                : !list.length ? '<div class="sos-empty">No orders in this period.</div>'
                : '<div class="ord-scroll"><table class="sos-tbl so-table-cards ord-tbl"><thead><tr><th>Date</th><th>Sales Officer</th><th>Shop</th><th>Items</th><th>Total</th></tr></thead><tbody>' +
                list.map(function (o) {
                    var open = !!S.open[o.id];
                    return '<tr class="ord-row" data-ord="' + o.id + '"><td>' + esc(fmtDate(o.date)) + '</td>' +
                        '<td><b>' + esc(o.officerName) + '</b>' + (o.managerName ? '<div class="sos-sub">ASM: ' + esc(o.managerName) + '</div>' : '') + '</td>' +
                        '<td>' + esc(o.shopName) + (o.status === 'CANCELLED' ? ' <span class="sos-sub">(cancelled)</span>' : '') + '</td>' +
                        '<td>' + o.itemCount + ' item' + (o.itemCount === 1 ? '' : 's') + ' <a href="javascript:void 0" class="ord-more">' + (open ? 'hide' : 'view') + '</a>' +
                        (open ? '<div class="ord-items">' + (o.items || []).map(function (it) {
                            return '<div><span>' + esc(it.name) + '</span><span>' + (Number(it.qty) || 0) + ' × ' + inr(it.price) + '</span></div>';
                        }).join('') + '</div>' : '') + '</td>' +
                        '<td><b>' + inr(o.total) + '</b></td></tr>';
                }).join('') + '</tbody></table></div>') +
            '</div>';
    }

    function bind(host, prefix, rerender) {
        function on(id, ev, fn) { var e = host.querySelector('#' + prefix + '-' + id); if (e) e.addEventListener(ev, fn); }
        async function reload() { rerender(); try { await load(); } catch (e) { H.toast(H.errText(e), true); } rerender(); }
        on('from', 'change', function (e) { S.from = e.target.value || S.from; reload(); });
        on('to', 'change', function (e) { S.to = e.target.value || S.to; reload(); });
        on('off', 'change', function (e) { S.officer = e.target.value; rerender(); });
        on('q', 'input', function (e) { S.q = e.target.value; clearTimeout(bind._t); bind._t = setTimeout(function () { rerender(true); }, 250); });
        on('reload', 'click', reload);
        on('xls', 'click', function () { exportExcel().catch(function (e) { H.toast(H.errText(e), true); }); });
        Array.prototype.forEach.call(host.querySelectorAll('.ord-more'), function (a) {
            a.addEventListener('click', function () { var id = a.closest('[data-ord]').getAttribute('data-ord'); S.open[id] = !S.open[id]; rerender(); });
        });
    }

    function mount(host, prefix) {
        function rerender(keepFocus) {
            var had = keepFocus && doc.activeElement && doc.activeElement.id === prefix + '-q';
            host.innerHTML = viewHtml(prefix);
            bind(host, prefix, rerender);
            if (had) { var q = host.querySelector('#' + prefix + '-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
        }
        if (!S.from) { S.to = todayIso(); S.from = H.addDays(S.to, -6); }
        S.loading = true; rerender();
        load().catch(function (e) { host.innerHTML = '<div class="sos-card"><div class="sos-empty">' + esc(H.errText(e)) + '</div></div>'; S.loading = false; })
            .then(function () { if (!S.loading) rerender(); });
    }

    async function exportExcel() {
        if (!global.ExcelJS) { global.alert('Excel library did not load. Check your connection.'); return; }
        var list = filtered();
        var wb = new global.ExcelJS.Workbook(), ws = wb.addWorksheet('Orders');
        ws.columns = [12, 22, 20, 30, 40, 10, 12, 14].map(function (w) { return { width: w }; });
        var hr = ws.addRow(['Date', 'Sales Officer', 'ASM', 'Shop', 'Product', 'Qty', 'Price', 'Amount']); hr.font = { bold: true };
        list.forEach(function (o) {
            (o.items || []).forEach(function (it) {
                ws.addRow([o.date, o.officerName, o.managerName || '', o.shopName, it.name, Number(it.qty) || 0, Number(it.price) || 0, (Number(it.qty) || 0) * (Number(it.price) || 0)]);
            });
        });
        var buf = await wb.xlsx.writeBuffer();
        var a = doc.createElement('a');
        a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        a.download = 'Orders-' + S.from + '-to-' + S.to + '.xlsx'; doc.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    // =========================================================================================== Admin: Orders section
    var CART = '<path d="M3.6 4.4h2.2l2 10.2h10.4l1.9-7.4H7.2"/><circle cx="9.6" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>';
    function mountAdminSection() {
        if ($('sp-admin-orders')) return;
        var shopsNav = doc.querySelector('#supervisor-dashboard-view .sup-nav-item[data-sec="shops"]');
        var shopsSec = doc.querySelector('#supervisor-dashboard-view .sup-sec[data-sec="shops"]');
        if (!shopsNav || !shopsSec) return;
        var a = doc.createElement('a');
        a.className = 'so-nav-item sup-nav-item';
        a.setAttribute('data-sec', 'orders');
        a.setAttribute('onclick', "supShowSection('orders')");
        a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + CART + '</svg><span>Orders</span>';
        shopsNav.parentNode.insertBefore(a, shopsNav.nextSibling);
        var sec = doc.createElement('div');
        sec.className = 'dashboard-section sup-sec';
        sec.setAttribute('data-sec', 'orders');
        sec.style.display = 'none';
        sec.innerHTML = '<div class="section-header"><h3 class="section-title">🧾 Orders</h3>' +
            '<span style="font-size:12px;color:var(--ink-dim);">Every order the Sales Officers booked, saved on the server the moment it is confirmed</span></div>' +
            '<div id="sp-admin-orders"></div>';
        shopsSec.parentNode.insertBefore(sec, shopsSec.nextSibling);

        var orig = global.supShowSection;
        if (typeof orig === 'function' && !orig.__ord) {
            var wrapped = function (key) {
                var out = orig.apply(this, arguments);
                if (key === 'orders' && isAdmin(S.user)) mount($('sp-admin-orders'), 'ord-a');
                return out;
            };
            wrapped.__ord = true;
            global.supShowSection = wrapped;
        }
    }

    // =========================================================================================== ASM: Team Orders
    function openTeamOrders() {
        var m = H.mm();
        if (!m.body) return;
        m.title.textContent = isAdmin(S.user) ? '🧾 All Orders' : '🧾 Team Orders';
        if (m.tabs) m.tabs.innerHTML = '';
        m.body.innerHTML = '<div id="ord-team"></div>';
        m.overlay.classList.add('open');
        mount($('ord-team'), 'ord-t');
    }
    function mountManagerNav() {
        var nav = doc.querySelector('#asm-dashboard-view .asm2-nav');
        if (!nav || $('asm2-nav-teamorders')) return;
        var a = doc.createElement('a');
        a.className = 'asm2-nav-item';
        a.id = 'asm2-nav-teamorders';
        a.style.cursor = 'pointer';
        a.innerHTML = '<span class="asm2-nav-svg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + CART + '</svg></span> Team Orders';
        a.onclick = function () { try { asm2Nav(a); } catch (e) { /* ignore */ } openTeamOrders(); }; // eslint-disable-line no-undef
        var after = $('asm2-nav-teamtargets') || $('asm2-nav-teamshops');
        nav.insertBefore(a, after ? after.nextSibling : ($('asm-logout-btn') || null));
    }

    // "Orders today" card on the ASM dashboard, refreshed every minute while the dashboard is open
    var homeTimer = null;
    async function renderASMHome() {
        var view = $('asm-dashboard-view');
        if (!view || !S.user || S.user.role !== 'ASM') return;
        var host = $('ord-asm-home');
        if (!host) {
            host = doc.createElement('div');
            host.id = 'ord-asm-home';
            var anchor = $('lv-asm-home') || $('asm2-kpi-grid') || view.querySelector('.asm2-kpi-grid');
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor.nextSibling);
            else (view.querySelector('.asm2-main') || view).appendChild(host);
        }
        var rows;
        try { rows = (await api().orders({ from: todayIso(), to: todayIso() })) || []; }
        catch (e) { host.innerHTML = ''; return; }
        var total = rows.reduce(function (t, o) { return t + (Number(o.total) || 0); }, 0);
        host.innerHTML = '<div class="sos-card"><div class="sos-head"><div><div class="sos-title">🧾 Orders today <span class="sos-sub">(' + rows.length + ' · ' + inr(total) + ')</span></div>' +
            '<div class="sos-sub">Booked by your Sales Officers — updates every minute</div></div>' +
            '<button class="sos-btn pri" onclick="SOOrders.openTeam()">All team orders</button></div>' +
            (rows.length ? '<table class="sos-tbl so-table-cards"><thead><tr><th>Sales Officer</th><th>Shop</th><th>Items</th><th>Total</th></tr></thead><tbody>' +
                rows.slice(0, 15).map(function (o) {
                    return '<tr><td><b>' + esc(o.officerName) + '</b></td><td>' + esc(o.shopName) + '</td><td>' + o.itemCount + '</td><td><b>' + inr(o.total) + '</b></td></tr>';
                }).join('') + '</tbody></table>' + (rows.length > 15 ? '<div class="sos-sub" style="margin-top:6px">Showing 15 of ' + rows.length + '</div>' : '')
                : '<div class="sos-empty">No orders booked yet today.</div>') + '</div>';
    }
    function startHomeTimer() {
        clearInterval(homeTimer);
        homeTimer = setInterval(function () {
            var v = $('asm-dashboard-view');
            if (v && v.classList.contains('active') && S.user && S.user.role === 'ASM' && !doc.hidden) renderASMHome();
        }, 60000);
    }

    // =========================================================================================== RM, Marketing Manager, Owner
    // RM: its existing "Orders" menu item (and the "View Orders" link) showed demo data kept in the browser; both now open
    // the server orders of the RM's own tree. Marketing Manager and Owner get an "Orders" entry. All of this runs before
    // the phone tab bars are built, so the entries also appear in each phone "More" menu.
    function repoint(el) {
        if (!el || el.__ord) return;
        el.removeAttribute('onclick');
        el.addEventListener('click', function (e) { e.preventDefault(); openTeamOrders(); });
        el.__ord = true;
    }
    function mountOtherRoles() {
        Array.prototype.forEach.call(doc.querySelectorAll('#rm-dashboard-view [onclick*="notif-orders"]'), repoint);

        var rsmNav = doc.querySelector('#rsm-dashboard-view .so-nav');
        if (rsmNav && !$('rsm-nav-orders')) {
            var a = doc.createElement('a');
            a.className = 'so-nav-item';
            a.id = 'rsm-nav-orders';
            a.style.cursor = 'pointer';
            a.textContent = '🛒 Orders';
            a.addEventListener('click', openTeamOrders);
            var msgs = Array.prototype.find.call(rsmNav.querySelectorAll('.so-nav-item'), function (x) { return /Messages/.test(x.textContent); });
            rsmNav.insertBefore(a, msgs || null);
        }

        var ownerNav = $('owner-nav');
        if (ownerNav && !$('owner-nav-orders')) {
            var b = doc.createElement('button');
            b.className = 'owner-nav-item';
            b.id = 'owner-nav-orders';
            b.type = 'button';
            b.innerHTML = '<svg class="owner-nav-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + CART + '</svg><span>Orders</span>';
            b.addEventListener('click', openTeamOrders);
            var rep = ownerNav.querySelector('[data-tab="reports"]');
            ownerNav.insertBefore(b, rep ? rep.nextSibling : null);
        }
        var bar = $('mobile-tabbar');
        if (bar && !$('owner-mtab-orders')) {
            var t = doc.createElement('button');
            t.className = 'mtab';
            t.id = 'owner-mtab-orders';
            t.type = 'button';
            t.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + CART + '</svg><span>Orders</span>';
            t.addEventListener('click', openTeamOrders);
            var repT = bar.querySelector('[data-tab="reports"]');
            bar.insertBefore(t, repT ? repT.nextSibling : null);
        }
    }

    // =========================================================================================== CSS + wiring
    function injectCss() {
        if ($('ord-css')) return;
        var st = doc.createElement('style');
        st.id = 'ord-css';
        st.textContent = [
            '.ord-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}',
            '.ord-filters label{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:600;color:#04344C}',
            '.ord-filters input,.ord-filters select{font-family:inherit;font-size:13px;padding:9px 10px;border:1px solid #D3E2F5;border-radius:8px;background:#fff;color:#04344C;width:100%;box-sizing:border-box}',
            '.ord-filters .ord-wide{grid-column:span 2}',
            '.ord-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:4px 0 8px}',
            '.ord-kpis div{background:#F7FAFD;border:1px solid #E4EEF9;border-radius:10px;padding:10px;text-align:center}',
            '.ord-kpis b{display:block;font-size:17px;color:#04344C}.ord-kpis span{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#6B7A90}',
            '.ord-scroll{overflow-x:auto}.ord-more{font-size:11.5px;font-weight:700;color:#2a78d6;margin-left:6px}',
            '.ord-items{margin-top:6px;font-size:12px;border-top:1px dashed #E4EEF9;padding-top:4px}',
            '.ord-items div{display:flex;justify-content:space-between;gap:10px;padding:2px 0}',
            '@media (max-width:680px){.ord-filters{grid-template-columns:1fr 1fr}.ord-filters .ord-wide{grid-column:1/-1}',
            '  .ord-filters input,.ord-filters select{font-size:16px}.ord-kpis b{font-size:15px}',
            '  .ord-tbl td .ord-items{width:100%}.ord-tbl td:has(.ord-items){flex-wrap:wrap}}'
        ].join('\n');
        doc.head.appendChild(st);
    }

    (global.SOSalesParts = global.SOSalesParts || []).push({
        onSignedIn: function (user) {
            S.user = user; S.rows = []; S.officer = ''; S.q = ''; S.open = {}; S.from = null; S.to = null;
            if (isManager(user)) { mountManagerNav(); renderASMHome(); startHomeTimer(); } else { clearInterval(homeTimer); }
            if (user && user.role === 'SO') SO.outbox.flush();
        },
        refresh: function () { if (isManager(S.user)) renderASMHome(); }
    });

    global.SOOrders = { push: push, openTeam: openTeamOrders, itemsOf: itemsOf };

    injectCss();
    mountAdminSection();    // before the phone tab bars are built (DOMContentLoaded), so "Orders" is in the Admin's More menu
    mountManagerNav();
    mountOtherRoles();
})(window);
