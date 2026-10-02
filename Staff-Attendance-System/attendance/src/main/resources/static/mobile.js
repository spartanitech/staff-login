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
        '@media (max-width:680px){',
        // --- tables -> cards
        '  .sp-table-wrap{overflow:visible!important;border:0!important;background:transparent!important}',
        '  table.sp-table,table.sp-table tbody,table.so-table-cards,table.so-table-cards tbody{display:block;width:100%}',
        '  table.sp-table thead,table.so-table-cards thead{display:none}',
        '  table.sp-table tr,table.so-table-cards tr{display:block;background:#fff;border:1px solid #E4EEF9;border-radius:12px;padding:4px 12px;margin:0 0 10px;box-shadow:0 1px 4px rgba(4,52,76,.05)}',
        // label column on the left (absolutely placed), the cell's own content flows on the right
        '  table.sp-table td,table.so-table-cards td,.sos-tbl td[data-l]{display:block!important;position:relative;padding:8px 0 8px 42%!important;border:0!important;border-bottom:1px dashed #EEF3FA!important;text-align:right;overflow-wrap:anywhere;min-height:18px}',
        '  table.sp-table td:last-child,table.so-table-cards td:last-child,.sos-tbl td[data-l]:last-child{border-bottom:0!important}',
        '  table.sp-table td::before,table.so-table-cards td::before,.sos-tbl td[data-l]::before{content:attr(data-l);position:absolute;left:0;top:9px;width:40%;text-align:left;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#6B7A90;white-space:normal}',
        '  table.sp-table td[data-l=""],table.so-table-cards td[data-l=""],.sos-tbl td[data-l=""]{padding-left:0!important;text-align:left}',
        '  table.sp-table td[data-l=""]::before,table.so-table-cards td[data-l=""]::before,.sos-tbl td[data-l=""]::before{display:none}',
        '  table.sp-table td[colspan],table.so-table-cards td[colspan]{padding-left:0!important;text-align:center}',
        '  table.sp-table td[colspan]::before,table.so-table-cards td[colspan]::before{display:none}',
        '  .sp-row-actions{min-width:0!important;width:100%;display:flex;flex-wrap:wrap;gap:6px}',
        '  .sp-row-actions .sp-btn{flex:1 1 45%;padding:10px 8px}',
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
        if (global.MutationObserver) new MutationObserver(schedule).observe(doc.body, { childList: true, subtree: true });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', install); else install();
    global.SPMobile = { labelAll: labelAll };
})(window);
