/*
 * promotions-sync.js — the Promotions screen (offers, coupons, festival offers, combo offers, discount reports)
 * is stored on the server (GET/POST/DELETE /api/promotions), so an add or a delete is the same on every phone
 * and survives a reload.
 *
 *  - Signing in loads the list from the server and replaces the screen's lists.
 *  - The very first time (server empty), the starting list on the screen is imported once.
 *  - Every "Save" sends the new promotion; every "Delete" removes it on the server.
 *  - Admin, Owner and Marketing Manager can change promotions; everyone else only sees them.
 *
 * Loaded after portal-sync.js. Like the other files it wraps a few global functions of index.html.
 */
(function (global) {
    'use strict';

    var SYNC_MS = 60000;
    var me = null;
    var busy = false;

    // kind on the server -> [list variable in index.html, tab to re-render, save function, delete function]
    var KINDS = {
        offer:    { list: 'mmOffers',          tab: 'offers',   save: 'saveOfferForm',         del: 'deleteOffer' },
        coupon:   { list: 'mmCoupons',         tab: 'coupons',  save: 'saveCouponForm',        del: 'deleteCoupon' },
        festival: { list: 'mmFestivalOffers',  tab: 'festival', save: 'saveFestivalOfferForm', del: 'deleteFestivalOffer' },
        combo:    { list: 'mmComboOffers',     tab: 'combo',    save: 'saveComboOfferForm',    del: 'deleteComboOffer' },
        report:   { list: 'mmDiscountReports', tab: 'discount', save: null,                    del: 'deleteDiscountReport' }
    };

    function api() { return global.SPApi; }
    function lex(name) {   // a top-level let/const of index.html
        try { return (0, eval)(name); } catch (e) { return undefined; } // eslint-disable-line no-eval
    }
    function warn(what, e) { if (global.console) console.warn('[promotions-sync] ' + what, e && (e.message || e)); }
    function ref() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
    function signedIn() { return !!(me && api() && api().isLoggedIn && api().isLoggedIn()); }
    function canEdit() { return !!(me && (me.role === 'ADMIN' || me.role === 'OWNER' || me.role === 'RSM')); }
    function errText(e) {
        try { return (api() && api().friendlyError) ? api().friendlyError(e) : (e && e.message) || 'Something went wrong.'; }
        catch (x) { return 'Something went wrong.'; }
    }

    // ---- converting between the screen's rows and the server's rows ----
    function toServer(kind, row) {
        var b = { kind: kind, ref: row._ref || null };
        if (kind === 'offer')    { b.name = row.name; b.type = row.type; b.validTill = row.validTill; }
        if (kind === 'coupon')   { b.code = row.code; b.discount = row.discount; b.validTill = row.validTill; }
        if (kind === 'festival') { b.name = row.name; b.discount = row.discount; b.validTill = row.validTill; }
        if (kind === 'combo')    { b.name = row.name; b.price = row.price; b.mrp = row.mrp; }
        if (kind === 'report')   { b.name = row.name; b.redemptions = row.redemptions; b.totalDiscount = row.totalDiscount; }
        return b;
    }
    function fromServer(p) {
        var r = { _id: p.id, _ref: p.ref };
        switch (p.kind) {
            case 'offer':    r.name = p.name || ''; r.type = p.type || 'Offer'; r.validTill = p.validTill || ''; break;
            case 'coupon':   r.code = p.code || p.name || ''; r.discount = p.discount || ''; r.validTill = p.validTill || ''; break;
            case 'festival': r.name = p.name || ''; r.discount = p.discount || ''; r.validTill = p.validTill || ''; break;
            case 'combo':    r.name = p.name || ''; r.price = Number(p.price) || 0; r.mrp = Number(p.mrp) || 0; break;
            case 'report':   r.name = p.name || p.code || ''; r.redemptions = Number(p.redemptions) || 0; r.totalDiscount = Number(p.totalDiscount) || 0; break;
        }
        return r;
    }

    function currentTab() {   // the Promotions tab now on screen (its button is drawn bold), or null
        var ov = global.document.getElementById('mm-section-modal-overlay');
        if (!ov || !/\bopen\b/.test(ov.className)) return null;
        var btns = ov.querySelectorAll('[onclick^="renderPromotions("]');
        for (var i = 0; i < btns.length; i++) {
            if (/font-weight:\s*700/.test(btns[i].getAttribute('style') || '')) {
                var m = /renderPromotions\('(\w+)'\)/.exec(btns[i].getAttribute('onclick'));
                if (m) return m[1];
            }
        }
        return null;
    }
    function rerender(tab) {
        var body = lex('mmBodyEl');
        // only redraw when the Promotions table is what is on screen (never over an open form)
        if (!body || !global.document.body.contains(body)) return;
        if (body.querySelector('input, textarea, select')) return;
        var t = tab || currentTab();
        if (t && typeof global.renderPromotions === 'function') { try { global.renderPromotions(t); } catch (e) { /* screen closed */ } }
    }

    function applyServer(items) {
        var grouped = {};
        Object.keys(KINDS).forEach(function (k) { grouped[k] = []; });
        (items || []).forEach(function (p) { if (grouped[p.kind]) grouped[p.kind].push(fromServer(p)); });
        Object.keys(KINDS).forEach(function (k) {
            var arr = lex(KINDS[k].list);
            if (Array.isArray(arr)) arr.splice.apply(arr, [0, arr.length].concat(grouped[k]));
        });
        rerender();
    }

    function screenItems() {
        var out = [];
        Object.keys(KINDS).forEach(function (k) {
            var arr = lex(KINDS[k].list);
            (Array.isArray(arr) ? arr : []).forEach(function (row) { out.push(toServer(k, row)); });
        });
        return out;
    }

    async function pull() {
        if (!signedIn() || busy || !api().promotions) return;
        busy = true;
        try {
            var res = await api().promotions();
            if (res && !res.initialized && canEdit()) {
                res = await api().importPromotions(screenItems());   // first run: keep today's starting list
            }
            if (res && (res.initialized || (res.items && res.items.length))) applyServer(res.items);
        } catch (e) {
            warn('load', e);
        } finally {
            busy = false;
        }
    }

    // ---- Save: send the row that the original save just added ----
    function wrapSave(kind) {
        var k = KINDS[kind];
        if (!k.save || typeof global[k.save] !== 'function' || global[k.save]._promoSync) return;
        var orig = global[k.save];
        var wrapped = function () {
            var arr = lex(k.list);
            var before = Array.isArray(arr) ? arr.length : 0;
            var out = orig.apply(this, arguments);
            if (signedIn() && Array.isArray(arr) && arr.length > before) {
                var row = arr[arr.length - 1];
                row._ref = row._ref || ref();
                api().addPromotion(toServer(kind, row)).then(function (saved) {
                    if (saved && saved.id != null) row._id = saved.id;
                }, function (e) {
                    warn('save', e);
                    global.alert('Could not save "' + (row.name || row.code) + '" on the server: ' + errText(e) + '\nPlease try again.');
                    var i = arr.indexOf(row);
                    if (i >= 0) { arr.splice(i, 1); rerender(k.tab); }
                });
            }
            return out;
        };
        wrapped._promoSync = true;
        global[k.save] = wrapped;
    }

    // ---- Delete: remove it on the server too ----
    function wrapDelete(kind) {
        var k = KINDS[kind];
        if (typeof global[k.del] !== 'function' || global[k.del]._promoSync) return;
        var orig = global[k.del];
        var wrapped = function (i) {
            var arr = lex(k.list);
            var row = Array.isArray(arr) ? arr[i] : null;
            var done = orig.apply(this, arguments);
            if (done === false || !row || !signedIn()) return done;
            if (!canEdit()) {
                global.alert('Only Admin, Owner or Marketing Manager can delete promotions.');
                pull();
                return done;
            }
            var go = row._id != null ? Promise.resolve(row._id)
                : api().promotions().then(function (res) {   // added a moment ago: find it by its reference
                    var hit = (res && res.items || []).filter(function (p) { return row._ref && p.ref === row._ref; })[0];
                    return hit ? hit.id : null;
                });
            go.then(function (id) { return id == null ? null : api().deletePromotion(id); })
                .catch(function (e) {
                    warn('delete', e);
                    if (e && e.status === 404) return;   // already gone
                    global.alert('Could not delete "' + (row.name || row.code) + '" on the server: ' + errText(e) + '\nPlease try again.');
                    pull();
                });
            return done;
        };
        wrapped._promoSync = true;
        global[k.del] = wrapped;
    }

    function install() {
        Object.keys(KINDS).forEach(function (k) { wrapSave(k); wrapDelete(k); });
    }

    (global.SOSalesParts = global.SOSalesParts || []).push({
        onSignedIn: function (user) {
            me = user || (api() && api().user && api().user()) || null;
            install();
            pull();
        },
        refresh: function () { pull(); }
    });

    install();
    setInterval(function () { if (!global.document.hidden) pull(); }, SYNC_MS);
    global.addEventListener('online', function () { pull(); });

    global.PromotionsSync = { pull: pull, applyServer: applyServer };
})(window);
