/*
 * mobile.js — phone layout fixes for the whole portal. Loaded last, so its rules come after every other style.
 *
 *  - Wide data tables (Staff, Shops, Work Locations, Audit Log, attendance report, Orders ...) turn into one card per
 *    row on a phone: each cell shows its column name on the left and the value on the right, and the action buttons
 *    fill the width. The column names are copied from the table header automatically (data-l), so every table that
 *    is drawn later - by any script - is handled too.
 *  - Section headers, toolbars and filters stack instead of squeezing side by side.
 *  - Inputs use a 16px font so iPhones do not zoom in when a field is tapped.
 */
(function (global) {
    'use strict';
    var doc = global.document;

    var CSS = [
        // --- wide tables -> one card per row on phones AND tablets (their 7-8 columns do not fit below ~1100 px)
        '@media (max-width:1100px){',
        '  .sp-table-wrap{overflow:visible!important;border:0!important;background:transparent!important}',
        '  table.sp-table,table.sp-table tbody,table.so-table-cards,table.so-table-cards tbody{display:block;width:100%}',
        '  table.sp-table thead,table.so-table-cards thead{display:none}',
        '  table.sp-table tr,table.so-table-cards tr{display:block;background:#fff;border:1px solid #E4EEF9;border-radius:12px;padding:4px 12px;margin:0 0 10px;box-shadow:0 1px 4px rgba(4,52,76,.05)}',
        // label column on the left (absolutely placed), the cell's own content flows on the right
        '  table.sp-table td,table.so-table-cards td{display:block!important;position:relative;padding:8px 0 8px 42%!important;border:0!important;border-bottom:1px dashed #EEF3FA!important;text-align:right;overflow-wrap:anywhere;min-height:18px}',
        '  table.sp-table td:last-child,table.so-table-cards td:last-child{border-bottom:0!important}',
        '  table.sp-table td::before,table.so-table-cards td::before{content:attr(data-l);position:absolute;left:0;top:9px;width:40%;text-align:left;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#6B7A90;white-space:normal}',
        '  table.sp-table td[data-l=""],table.so-table-cards td[data-l=""]{padding-left:0!important;text-align:left}',
        '  table.sp-table td[data-l=""]::before,table.so-table-cards td[data-l=""]::before{display:none}',
        '  table.sp-table td[colspan],table.so-table-cards td[colspan]{padding-left:0!important;text-align:center}',
        '  table.sp-table td[colspan]::before,table.so-table-cards td[colspan]::before{display:none}',
        '  .sp-row-actions{min-width:0!important;width:100%;display:flex;flex-wrap:wrap;gap:6px}',
        '  .sp-row-actions .sp-btn{flex:1 1 45%;padding:10px 8px}',
        '}',
        // tablets: two cards side by side
        '@media (min-width:681px) and (max-width:1100px){',
        '  table.sp-table tbody,table.so-table-cards tbody{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
        '  table.sp-table tr,table.so-table-cards tr{margin:0!important}',
        '}',
        '@media (max-width:680px){',
        '  .sos-tbl td[data-l]{display:block!important;position:relative;padding:8px 0 8px 42%!important;border:0!important;border-bottom:1px dashed #EEF3FA!important;text-align:right;overflow-wrap:anywhere;min-height:18px}',
        '  .sos-tbl td[data-l]:last-child{border-bottom:0!important}',
        '  .sos-tbl td[data-l]::before{content:attr(data-l);position:absolute;left:0;top:9px;width:40%;text-align:left;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#6B7A90;white-space:normal}',
        '  .sos-tbl td[data-l=""]{padding-left:0!important;text-align:left}',
        '  .sos-tbl td[data-l=""]::before{display:none}',
        // the ready-made card tables of so-sales.js: give each row a card too
        '  .sos-tbl tr{background:#fff;border:1px solid #E4EEF9!important;border-radius:12px;margin:0 0 10px;padding:4px 12px!important}',
        '  .sos-tbl td:not([data-l]){display:flex;justify-content:flex-end;padding:6px 0!important}',
        // --- headers, toolbars, forms
        '  .section-header{flex-direction:column;align-items:flex-start!important;gap:4px}',
        '  .so-card-header-row{flex-wrap:wrap;gap:6px 10px}',
        '  .sp-toolbar,.sp-filters{gap:8px}',
        '  .sp-toolbar .sp-field,.sp-filters .sp-field{flex:1 1 140px;min-width:0}',
        '  .sp-toolbar .sp-field:first-child{flex-basis:100%}',
        '  .sp-field input,.sp-field select,.sp-field textarea{width:100%;box-sizing:border-box}',
        '  .sp-spacer{display:none}',
        '  .sp-toolbar > .sp-btn{flex:1 1 100%}',
        '  .sp-form-grid{grid-template-columns:1fr!important}',
        '  .sp-field input,.sp-field select,.sp-field textarea,.sos-form input,.sos-form select,.sos-search,.so-input,input.form-input{font-size:16px!important}',
        '  .sp-modal-card{max-height:calc(100vh - 20px);border-radius:12px}',
        '  #sp-modal-overlay{padding:8px!important}',
        '  .sos-head{align-items:flex-start}',
        '  .sos-form{grid-template-columns:1fr!important}',
        '  img,canvas,svg{max-width:100%}',
        '}',
        // shop-visit popups: one column, the live camera full width and big, below the other sections
        '@media (max-width:1100px){',
        '  #so-attendance-overlay .modal-card,#so-shopvisit-overlay .modal-card{padding:18px 14px!important;width:100%;box-sizing:border-box}',
        '  #so-attendance-overlay .so-card:has(#so-att-photo-preview),#so-shopvisit-overlay .so-card:has(#sv-photo-preview){grid-column:1/-1;order:5;padding:12px!important}',
        '  #so-att-photo-preview,#sv-photo-preview{height:min(78vw,460px)!important;min-height:240px}',
        '  #so-att-capture-btn,#sv-capture-btn{padding:14px!important;font-size:15px!important}',
        '  #so-att-next-btn,#sv-present-btn{width:100%;padding:14px!important;font-size:15px!important}',
        '}',
        '@media (max-width:680px){',
        '  #so-attendance-overlay .modal-card > div[style*="grid-template-columns"],#so-shopvisit-overlay .modal-card div[style*="grid-template-columns"]{grid-template-columns:1fr!important}',
        '  #so-att-track > div,#sv-track > div{min-width:0!important;flex:1 1 30%!important}',
        '  #so-att-track > div[style*="align-self"],#sv-track > div[style*="align-self"]{display:none}',
        '  .modal-overlay .modal-card{max-width:100%!important;max-height:100vh;max-height:100dvh;border-radius:14px}',
        '  .modal-overlay{padding:6px!important}',
        '  .cam-switch{font-size:13px!important;padding:8px 12px!important}',
        '}',
        // no sideways page scroll, ever (a too-wide element scrolls inside its own box instead)
        'html,body{max-width:100%;overflow-x:clip}',   // clip (not hidden): keeps sticky headers working
        // very small phones
        '@media (max-width:380px){',
        '  table.sp-table td::before,table.so-table-cards td::before{flex-basis:44%}',
        '  .sp-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}',
        '}'
    ].join('\n');

    function injectCss() {
        if (doc.getElementById('mobile-css')) return;
        var st = doc.createElement('style');
        st.id = 'mobile-css';
        st.textContent = CSS;
        (doc.body || doc.head).appendChild(st);   // in <body>, after every <style> in <head>: these rules win ties
    }

    // ------------------------------------------------------------------ phone in Chrome's "Desktop site" mode
    // Chrome then lays the page out 980 px wide and shrinks it to the screen: every @media rule sees 980 px, so the phone
    // layout never switches on and the page is tiny / scrolls sideways. Here the page is laid out for the phone's real
    // width: every width condition in the CSS is re-evaluated against the screen width, and the page is zoomed so that
    // width fills the screen.
    function phoneWidth() {
        var coarse = global.matchMedia && global.matchMedia('(pointer: coarse)').matches;
        var sw = Math.min(global.screen ? global.screen.width : 0, global.screen ? global.screen.height : 0);
        return (coarse && sw && sw <= 600 && global.innerWidth > sw * 1.4) ? sw : 0;
    }
    var PHONE_W = 0;
    function rewriteMedia(text) {
        // (max-width: 680px) / (min-width:681px) / (max-width: 40em) -> decided now for the phone width
        return text.replace(/\(\s*(max|min)-width\s*:\s*([\d.]+)(px|em|rem)?\s*\)/gi, function (m, kind, n, unit) {
            var px = parseFloat(n) * (unit && unit.toLowerCase() !== 'px' ? 16 : 1);
            var ok = kind.toLowerCase() === 'max' ? PHONE_W <= px : PHONE_W >= px;
            return ok ? '(min-width: 0px)' : '(max-width: 0px)';
        });
    }
    function rewriteRules(rules) {
        if (!rules) return;
        for (var i = 0; i < rules.length; i++) {
            var r = rules[i];
            if (r.media && r.media.mediaText && /width/i.test(r.media.mediaText) && !r.__phone) {
                try { r.media.mediaText = rewriteMedia(r.media.mediaText); r.__phone = true; } catch (e) { /* read-only */ }
            }
            if (r.cssRules) rewriteRules(r.cssRules);
        }
    }
    function rewriteSheets() {
        Array.prototype.forEach.call(doc.styleSheets, function (sh) {
            var rules; try { rules = sh.cssRules; } catch (e) { return; }   // cross-origin (fonts): nothing to do
            rewriteRules(rules);
        });
    }
    function applyDesktopSiteFix() {
        PHONE_W = phoneWidth();
        if (!PHONE_W) return;
        var root = doc.documentElement;
        root.classList.add('sp-desktop-site-phone');
        rewriteSheets();
        var z = global.innerWidth / PHONE_W;
        root.style.width = PHONE_W + 'px';      // lay the page out at the phone's width ...
        root.style.zoom = String(z);             // ... and scale it up to fill the 980 px "desktop" viewport
        // fixed bars (header, bottom tab bar, popups) are sized to the viewport: give them the phone width too
        // fixed bars and popups are measured against the (unzoomed) viewport: give them the phone's width and height so the
        // bottom tab bar sits at the bottom of the screen and popups are centred on it
        var st = doc.createElement('style');
        function fixedCss() {
            var H = Math.round(global.innerHeight / z), P = 'html.sp-desktop-site-phone ';
            st.textContent =
                P + '.rtabbar,' + P + '.mobile-tabbar{left:0!important;right:auto!important;width:' + PHONE_W + 'px!important;bottom:auto!important;top:' + H + 'px!important;transform:translateY(-100%)}' +
                P + '.modal-overlay,' + P + '#sp-modal-overlay,' + P + '.lv-overlay,' + P + '.rsheet-overlay{left:0!important;top:0!important;right:auto!important;bottom:auto!important;width:' + PHONE_W + 'px!important;height:' + H + 'px!important}' +
                P + '.modal-overlay .modal-card,' + P + '.sp-modal-card,' + P + '.lv-modal{max-height:' + (H - 12) + 'px!important}';
        }
        fixedCss();
        doc.head.appendChild(st);
        global.addEventListener('resize', function () {
            var w = phoneWidth();
            if (!w) return;
            PHONE_W = w; z = global.innerWidth / PHONE_W;
            root.style.width = PHONE_W + 'px'; root.style.zoom = String(z);
            fixedCss();
        });
        var again = 0;
        var mo = new MutationObserver(function (list) {   // <style> elements that scripts add later (dashboards, popups)
            var added = list.some(function (m) { return Array.prototype.some.call(m.addedNodes, function (n) { return n.tagName === 'STYLE' || n.tagName === 'LINK'; }); });
            if (added) { clearTimeout(again); again = setTimeout(rewriteSheets, 30); }
        });
        mo.observe(doc.head, { childList: true });
        mo.observe(doc.body, { childList: true });
    }

    /** Copies each table's column names onto its cells, so the phone card layout can show them. */
    function labelTable(t) {
        var heads = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) { return (th.textContent || '').trim(); });
        if (!heads.length) return;
        Array.prototype.forEach.call(t.querySelectorAll('tbody tr'), function (tr) {
            var i = 0;
            Array.prototype.forEach.call(tr.children, function (td) {
                if (td.tagName !== 'TD') return;
                if (!td.hasAttribute('data-l')) td.setAttribute('data-l', heads[i] || '');
                i += td.colSpan || 1;
            });
        });
    }
    function labelAll(root) {
        Array.prototype.forEach.call((root || doc).querySelectorAll('table.sp-table, table.so-table-cards'), labelTable);
    }

    var pending = false;
    function schedule() {
        if (pending) return;
        pending = true;
        (global.requestAnimationFrame || setTimeout)(function () { pending = false; labelAll(doc); });
    }

    function install() {
        injectCss();
        labelAll(doc);
        try { applyDesktopSiteFix(); } catch (e) { /* normal layout */ }
        if (global.MutationObserver) new MutationObserver(schedule).observe(doc.body, { childList: true, subtree: true });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', install); else install();
    global.SPMobile = { labelAll: labelAll, phoneWidth: function () { return PHONE_W; } };
})(window);
