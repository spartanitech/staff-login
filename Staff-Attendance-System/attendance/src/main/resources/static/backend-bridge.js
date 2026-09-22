/* ==========================================================================
   backend-bridge.js  -  connects the existing portal UI to the backend

   Loaded after the page's own scripts and after api.js. It provides:
     * SPBridge  - login glue (role mapping, session expiry, logout),
                   change-password, shared helpers used by admin-console.js
     * the real GPS attendance card (Check In / Check Out) for every non-Admin
       role (Sales Officers check in through the shop-verification flow: assigned
       shop + live GPS + live photo, all re-checked by the server), plus
       "My history" and (managers) "Team attendance"
     * PDF / Excel export of attendance, built from backend data

   Rules this file follows:
     - GPS always comes from navigator.geolocation. No hard-coded coordinates.
     - The browser never decides whether someone is inside the geofence, never
       says who they are, and never picks their role. The server does all three.
   ========================================================================== */
(function (global) {
    'use strict';
    var doc = global.document;

    // ----------------------------------------------------------------------
    // Constants
    // ----------------------------------------------------------------------
    var ROLE_KEY = { ADMIN: 'sup', OWNER: 'owner', RSM: 'rsm', RM: 'rm', ASM: 'asm', SO: 'so' };
    var ROLE_LABEL = {
        ADMIN: 'Admin', OWNER: 'Owner', RSM: 'Marketing Manager', RM: 'Regional Manager',
        ASM: 'Area Sales Manager', SO: 'Sales Officer'
    };
    var STATUS_LABEL = { PRESENT: 'Present', LATE: 'Late', HALF_DAY: 'Half day', ABSENT: 'Absent' };
    var MANAGER_ROLES = ['OWNER', 'RSM', 'RM', 'ASM'];
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // ----------------------------------------------------------------------
    // Small helpers (shared through SPBridge.util)
    // ----------------------------------------------------------------------
    function $(sel, root) { return (root || doc).querySelector(sel); }
    function $all(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function pad(n) { return (n < 10 ? '0' : '') + n; }

    // Backend timestamps are LocalDateTime strings in IST ("2026-09-21T09:30:00").
    // They are read as plain text so the browser's own time zone can never shift them.
    function parseLdt(s) {
        var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s || '');
        if (!m) return null;
        return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null };
    }
    function fmtDate(s) { var p = parseLdt(s); return p ? pad(p.d) + ' ' + MON[p.mo - 1] + ' ' + p.y : '—'; }
    function fmtTime(s) {
        var p = parseLdt(s);
        if (!p || p.h == null) return '—';
        return pad(p.h % 12 || 12) + ':' + pad(p.mi) + ' ' + (p.h >= 12 ? 'PM' : 'AM');
    }
    function minutesText(min) {
        if (min == null) return '—';
        return Math.floor(min / 60) + 'h ' + pad(min % 60) + 'm';
    }
    function todayIso() {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date());
    }
    function addDays(iso, n) {
        var d = new Date(iso + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    function weekStartIso(iso) {          // Monday of the week containing iso
        var dow = new Date(iso + 'T00:00:00Z').getUTCDay();   // 0 = Sunday
        return addDays(iso, dow === 0 ? -6 : 1 - dow);
    }
    function monthStartIso(iso) { return iso.slice(0, 8) + '01'; }
    function gpsText(lat, lng, acc) {
        if (lat == null || lng == null) return '—';
        return Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5) + (acc != null ? ' (±' + Math.round(acc) + ' m)' : '');
    }
    function statusBadge(st) {
        if (!st) return '<span class="sp-badge sp-b-none">—</span>';
        return '<span class="sp-badge sp-b-' + esc(st) + '">' + esc(STATUS_LABEL[st] || st) + '</span>';
    }
    function roleLabel(r) { return ROLE_LABEL[r] || r || '—'; }
    function isManager(u) { return !!u && MANAGER_ROLES.indexOf(u.role) >= 0; }

    // ----------------------------------------------------------------------
    // Styles (namespaced .sp-*, reusing the portal's colours and fonts)
    // ----------------------------------------------------------------------
    var CSS = [
        '.sp-att-card{background:#fff;border:1px solid #E4EEF9;border-radius:14px;padding:18px 20px;margin:0 0 20px;box-shadow:0 2px 10px rgba(30,60,40,.05);font-family:"Plus Jakarta Sans",sans-serif;color:#04344C}',
        '.sp-att-card.sp-embedded{border:none;box-shadow:none;padding:0;margin:0;background:transparent}',
        '.sp-att-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}',
        '.sp-att-title{font-family:"Space Grotesk",sans-serif;font-weight:700;font-size:16px;margin:0}',
        '.sp-att-date{font-size:12.5px;opacity:.75}',
        '.sp-att-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px}',
        '.sp-cell{background:#F7FAFD;border:1px solid #E4EEF9;border-radius:10px;padding:10px 12px;min-width:0}',
        '.sp-cell-l{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;opacity:.65;margin-bottom:4px}',
        '.sp-cell-v{font-family:"Space Grotesk",sans-serif;font-weight:700;font-size:15px;word-break:break-word}',
        '.sp-cell-v small{display:block;font-weight:500;font-size:11.5px;opacity:.75;margin-top:2px;font-family:"Plus Jakarta Sans",sans-serif}',
        '.sp-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}',
        '.sp-btn{border:none;border-radius:10px;padding:12px 22px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;letter-spacing:.02em}',
        '.sp-btn[disabled]{opacity:.55;cursor:not-allowed}',
        '.sp-btn-go{background:#2E9F6E;color:#fff}',
        '.sp-btn-out{background:#E0653A;color:#fff}',
        '.sp-btn-done{background:#E3F7EC;color:#0E7A4E;border:1px solid #A9E0C4}',
        '.sp-btn-sm{padding:8px 14px;font-size:12.5px;border-radius:8px}',
        '.sp-btn-ghost{background:#fff;color:#04344C;border:1px solid #D3E2F5}',
        '.sp-btn-ghost:hover{border-color:#2E9F6E}',
        '.sp-btn-primary{background:#04344C;color:#fff}',
        '.sp-btn-danger{background:#F0958D;color:#fff}',
        '.sp-msg{margin-top:12px;padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.45}',
        '.sp-msg-ok{background:#E3F7EC;border:1px solid #A9E0C4;color:#0E7A4E}',
        '.sp-msg-err{background:#FDECEA;border:1px solid #F0B4AE;color:#A12B20}',
        '.sp-msg-info{background:#EAF1FC;border:1px solid #C9DBF3;color:#04344C}',
        '.sp-badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap}',
        '.sp-b-PRESENT{background:#E3F7EC;color:#0E7A4E}',
        '.sp-b-LATE{background:#FDF3E6;color:#8A6220}',
        '.sp-b-HALF_DAY{background:#EEDDFB;color:#6B2E9E}',
        '.sp-b-ABSENT{background:#FDECEA;color:#A12B20}',
        '.sp-b-none,.sp-b-ACTIVE_{background:#EFF3F9;color:#5A6B82}',
        '.sp-b-ACTIVE{background:#E3F7EC;color:#0E7A4E}',
        '.sp-b-INACTIVE{background:#EFF3F9;color:#5A6B82}',
        // tables / forms
        '.sp-table-wrap{overflow-x:auto;border:1px solid #E4EEF9;border-radius:10px;background:#fff}',
        'table.sp-table{border-collapse:collapse;width:100%;font-size:12.5px;font-family:"Plus Jakarta Sans",sans-serif;color:#04344C}',
        'table.sp-table th{background:#F1F6FD;text-align:left;padding:9px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;border-bottom:1px solid #E4EEF9}',
        'table.sp-table td{padding:9px 10px;border-bottom:1px solid #EEF3FA;vertical-align:top}',
        'table.sp-table tr:last-child td{border-bottom:none}',
        '.sp-muted{color:#5A6B82;font-size:12.5px;padding:10px 2px}',
        '.sp-filters{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:14px}',
        '.sp-field{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:600;color:#04344C;min-width:130px}',
        '.sp-field input,.sp-field select,.sp-field textarea{font-family:inherit;font-size:13px;color:#04344C;background:#fff;border:1px solid #D3E2F5;border-radius:8px;padding:9px 10px;font-weight:400}',
        '.sp-field input:focus,.sp-field select:focus,.sp-field textarea:focus{outline:none;border-color:#2E9F6E}',
        '.sp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin:0 0 14px}',
        '.sp-kpi{background:#F7FAFD;border:1px solid #E4EEF9;border-radius:10px;padding:12px;text-align:center}',
        '.sp-kpi b{display:block;font-family:"Space Grotesk",sans-serif;font-size:20px}',
        '.sp-kpi span{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;opacity:.7}',
        '.sp-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px}',
        '.sp-spacer{flex:1}',
        '.sp-form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}',
        '.sp-form-grid .sp-wide{grid-column:1/-1}',
        '.sp-modal-card{background:#fff;border-radius:14px;width:100%;max-width:560px;max-height:92vh;overflow:auto;padding:24px;position:relative;box-shadow:0 20px 60px rgba(4,52,76,.25);font-family:"Plus Jakarta Sans",sans-serif;color:#04344C}',
        '.sp-modal-card.sp-wide-modal{max-width:1180px}',
        '.sp-modal-card h3{font-family:"Space Grotesk",sans-serif;margin:0 0 14px;font-size:19px;padding-right:28px}',
        '.sp-modal-x{position:absolute;top:12px;right:14px;background:none;border:none;font-size:24px;line-height:1;cursor:pointer;color:#04344C}',
        '#sp-modal-overlay{padding:14px;z-index:3000}',
        '.sp-map{height:230px;border-radius:10px;border:1px solid #D3E2F5;margin-top:6px}',
        '.sp-row-actions{display:flex;gap:6px;flex-wrap:wrap}',
        '@media (max-width:640px){.sp-att-card{padding:14px}.sp-btn{padding:12px 16px;flex:1 1 auto}.sp-modal-card{padding:18px 14px}}'
    ].join('\n');

    function injectCss() {
        if ($('#sp-bridge-css')) return;
        var st = doc.createElement('style');
        st.id = 'sp-bridge-css';
        st.textContent = CSS;
        doc.head.appendChild(st);
    }

    // ----------------------------------------------------------------------
    // Shared modal
    // ----------------------------------------------------------------------
    var modalState = { onClose: null, sticky: false };
    function ensureModal() {
        var ov = $('#sp-modal-overlay');
        if (ov) return ov;
        ov = doc.createElement('div');
        ov.id = 'sp-modal-overlay';
        ov.className = 'modal-overlay';
        ov.innerHTML = '<div class="sp-modal-card" role="dialog" aria-modal="true">' +
            '<button type="button" class="sp-modal-x" aria-label="Close">×</button>' +
            '<h3 id="sp-modal-title"></h3><div id="sp-modal-body"></div></div>';
        doc.body.appendChild(ov);
        // Close on a backdrop click only when the press AND the release both happened on the backdrop.
        // (Selecting text in a field and letting go outside the card also fires a 'click' on the backdrop; treating that
        // as "close" threw away everything the person had typed.) Forms are 'sticky': only Cancel / x / Esc close them.
        var pressedOnBackdrop = false;
        ov.addEventListener('mousedown', function (e) { pressedOnBackdrop = (e.target === ov); });
        ov.addEventListener('touchstart', function (e) { pressedOnBackdrop = (e.target === ov); }, { passive: true });
        ov.addEventListener('click', function (e) {
            var deliberate = e.target === ov && pressedOnBackdrop;
            pressedOnBackdrop = false;
            if (deliberate && !modalState.sticky) closeModal();
        });
        $('.sp-modal-x', ov).addEventListener('click', closeModal);
        doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov.classList.contains('open')) closeModal(); });
        return ov;
    }
    function openModal(title, opts) {
        opts = opts || {};
        var ov = ensureModal();
        $('#sp-modal-title', ov).textContent = title;
        var card = $('.sp-modal-card', ov);
        card.classList.toggle('sp-wide-modal', !!opts.wide);
        var body = $('#sp-modal-body', ov);
        body.innerHTML = '';
        modalState.onClose = opts.onClose || null;
        modalState.sticky = !!opts.sticky;
        ov.classList.add('open');
        return body;
    }
    function closeModal() {
        var ov = $('#sp-modal-overlay');
        if (!ov || !ov.classList.contains('open')) return;
        ov.classList.remove('open');
        var cb = modalState.onClose; modalState.onClose = null;
        if (typeof cb === 'function') { try { cb(); } catch (e) { /* ignore */ } }
        var b = $('#sp-modal-body', ov); if (b) b.innerHTML = '';
    }

    // ----------------------------------------------------------------------
    // Attendance table + exports (used by the card, history, team and admin views)
    // ----------------------------------------------------------------------
    var EXPORT_HEADERS = ['Employee Code', 'Employee Name', 'Role', 'Date', 'Check In', 'Check Out',
        'Working Hours', 'Status', 'Work Location / Shop', 'Check-in GPS', 'Check-out GPS'];

    function exportRow(a) {
        return [
            a.employeeCode || '', a.employeeName || '', roleLabel(a.role), fmtDate(a.attendanceDate),
            fmtTime(a.checkInTime), a.checkOutTime ? fmtTime(a.checkOutTime) : '—',
            a.checkOutTime ? (a.workingHours || minutesText(a.totalWorkingMinutes)) : '—',
            STATUS_LABEL[a.status] || a.status || '', a.workLocationName || a.shopName || '—',
            gpsText(a.checkInLatitude, a.checkInLongitude, a.checkInAccuracy),
            gpsText(a.checkOutLatitude, a.checkOutLongitude, a.checkOutAccuracy)
        ];
    }

    function attTableHtml(rows, opts) {
        opts = opts || {};
        if (!rows || !rows.length) return '<div class="sp-muted">No attendance records for this selection.</div>';
        var head = (opts.showEmployee ? '<th>Employee</th><th>Role</th>' : '') +
            '<th>Date</th><th>Check In</th><th>Check Out</th><th>Hours</th><th>Status</th><th>Work Location / Shop</th>' +
            '<th>Check-in GPS</th><th>Check-out GPS</th>' + (opts.admin ? '<th></th>' : '');
        var body = rows.map(function (a) {
            var dIn = a.checkInDistanceMeters != null ? '<br><small>' + Math.round(a.checkInDistanceMeters) + ' m from site</small>' : '';
            var dOut = a.checkOutDistanceMeters != null ? '<br><small>' + Math.round(a.checkOutDistanceMeters) + ' m from site</small>' : '';
            var corrected = a.correctionReason
                ? '<br><small title="' + esc(a.correctionReason) + '">✎ corrected</small>' : '';
            return '<tr>' +
                (opts.showEmployee ? '<td><b>' + esc(a.employeeName) + '</b><br><small>' + esc(a.employeeCode) + '</small></td><td>' + esc(roleLabel(a.role)) + '</td>' : '') +
                '<td>' + esc(fmtDate(a.attendanceDate)) + '</td>' +
                '<td>' + esc(fmtTime(a.checkInTime)) + '</td>' +
                '<td>' + (a.checkOutTime ? esc(fmtTime(a.checkOutTime)) : '—') + '</td>' +
                '<td>' + (a.checkOutTime ? esc(a.workingHours || minutesText(a.totalWorkingMinutes)) : '—') + '</td>' +
                '<td>' + statusBadge(a.status) + corrected + '</td>' +
                '<td>' + esc(a.workLocationName || a.shopName || '—') + (a.shopCode ? '<br><small>' + esc(a.shopCode) + '</small>' : '') + '</td>' +
                '<td>' + esc(gpsText(a.checkInLatitude, a.checkInLongitude, a.checkInAccuracy)) + dIn +
                (a.hasPhoto ? '<br><button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-photo="' + a.id + '">📷 Photo</button>' : '') + '</td>' +
                '<td>' + esc(gpsText(a.checkOutLatitude, a.checkOutLongitude, a.checkOutAccuracy)) + dOut + '</td>' +
                (opts.admin ? '<td><button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-correct="' + a.id + '">✎ Correct</button></td>' : '') +
                '</tr>';
        }).join('');
        return '<div class="sp-table-wrap"><table class="sp-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
    }

    /** meta: { title, lines:[...], summary:{...}|null, employees:[...]|null, fileBase } */
    function exportAttendance(kind, rows, meta, notify) {
        notify = notify || function (m) { global.alert(m); };
        if (!rows || !rows.length) { notify('There are no attendance records to export for this selection.'); return; }
        var data = rows.map(exportRow);
        var stamp = new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short'
        }).format(new Date());

        if (kind === 'excel') {
            if (!global.XLSX) { notify('The Excel library could not be loaded (are you offline?). Try again once you are online.'); return; }
            var aoa = [[meta.title]];
            (meta.lines || []).forEach(function (l) { aoa.push([l]); });
            aoa.push(['Generated (IST): ' + stamp]);
            if (meta.summary) {
                var s = meta.summary;
                aoa.push([]);
                aoa.push(['Working days', 'Present', 'Absent', 'Late', 'Half day', 'Total hours']);
                aoa.push([s.totalWorkingDays, s.present, s.absent, s.late, s.halfDay, s.totalWorkingHours]);
            }
            aoa.push([]);
            aoa.push(EXPORT_HEADERS);
            data.forEach(function (r) { aoa.push(r); });
            var ws = global.XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = [14, 24, 18, 13, 10, 10, 13, 11, 24, 30, 30].map(function (w) { return { wch: w }; });
            var wb = global.XLSX.utils.book_new();
            global.XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
            if (meta.employees && meta.employees.length) {
                var e = [['Employee Code', 'Name', 'Role', 'Working days', 'Present', 'Absent', 'Late', 'Half day', 'Total hours']];
                meta.employees.forEach(function (x) {
                    e.push([x.employeeCode, x.name, roleLabel(x.role), x.workingDays, x.present, x.absent, x.late, x.halfDay, x.totalWorkingHours]);
                });
                var ws2 = global.XLSX.utils.aoa_to_sheet(e);
                ws2['!cols'] = [14, 26, 18, 13, 9, 9, 7, 9, 12].map(function (w) { return { wch: w }; });
                global.XLSX.utils.book_append_sheet(wb, ws2, 'Summary by employee');
            }
            global.XLSX.writeFile(wb, meta.fileBase + '.xlsx');
            return;
        }

        // ---- PDF (landscape A4, same jsPDF the portal already loads) ----
        if (!global.jspdf || !global.jspdf.jsPDF) { notify('The PDF library could not be loaded (are you offline?). Try again once you are online.'); return; }
        var doc2 = new global.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        var widths = [17, 33, 22, 21, 16, 16, 15, 16, 32, 44, 44];   // mm, total 276
        var x0 = 8, y = 14;
        doc2.setFontSize(16); doc2.setTextColor(4, 52, 76);
        doc2.text(meta.title, x0, y); y += 6;
        doc2.setFontSize(8.5); doc2.setTextColor(90, 100, 120);
        (meta.lines || []).concat(['Generated (IST): ' + stamp]).forEach(function (l) { doc2.text(l, x0, y); y += 4.5; });
        if (meta.summary) {
            var m = meta.summary;
            doc2.setTextColor(14, 122, 78);
            doc2.text('Working days: ' + m.totalWorkingDays + '   Present: ' + m.present + '   Absent: ' + m.absent +
                '   Late: ' + m.late + '   Half day: ' + m.halfDay + '   Total hours: ' + m.totalWorkingHours, x0, y);
            y += 6;
        }
        function fit(text, w) {
            text = String(text == null ? '' : text);
            while (text.length > 1 && doc2.getTextWidth(text) > w - 2) text = text.slice(0, -1);
            return text;
        }
        function headerRow() {
            doc2.setFillColor(241, 246, 253); doc2.rect(x0, y - 4, 276, 6.5, 'F');
            doc2.setFontSize(7.5); doc2.setTextColor(4, 52, 76);
            var x = x0;
            EXPORT_HEADERS.forEach(function (h, i) { doc2.text(fit(h, widths[i]), x + 1, y); x += widths[i]; });
            y += 6;
        }
        headerRow();
        doc2.setFontSize(7.2);
        data.forEach(function (r, idx) {
            if (y > 196) { doc2.addPage(); y = 14; headerRow(); doc2.setFontSize(7.2); }
            if (idx % 2) { doc2.setFillColor(250, 252, 255); doc2.rect(x0, y - 3.6, 276, 5.6, 'F'); }
            doc2.setTextColor(30, 40, 60);
            var x = x0;
            r.forEach(function (cell, i) { doc2.text(fit(cell, widths[i]), x + 1, y); x += widths[i]; });
            y += 5.6;
        });
        var pages = doc2.getNumberOfPages();
        for (var p = 1; p <= pages; p++) {
            doc2.setPage(p); doc2.setFontSize(7.5); doc2.setTextColor(120, 130, 150);
            doc2.text('Page ' + p + ' of ' + pages, 289, 203, { align: 'right' });
        }
        doc2.save(meta.fileBase + '.pdf');
    }

    // ----------------------------------------------------------------------
    // GPS attendance card
    // ----------------------------------------------------------------------
    var Att = { user: null, state: null, busy: false, msg: null, hosts: [], lastFix: null, shops: null };

    function setMsg(kind, text) { Att.msg = text ? { kind: kind, text: text } : null; }

    function attCell(label, value, sub) {
        return '<div class="sp-cell"><div class="sp-cell-l">' + esc(label) + '</div><div class="sp-cell-v">' + value +
            (sub ? '<small>' + sub + '</small>' : '') + '</div></div>';
    }

    function renderHost(host) {
        var u = Att.user;
        if (!u) { host.innerHTML = ''; return; }
        if (u.role === 'ADMIN') {
            host.innerHTML = host.classList.contains('sp-embedded')
                ? '<div class="sp-muted">Preview mode: attendance is recorded for the employee who is signed in, not for the Admin.</div>' : '';
            host.style.display = host.classList.contains('sp-embedded') ? '' : 'none';
            return;
        }
        host.style.display = '';
        var t = Att.state, a = t && t.attendance, st = t ? t.state : null;
        var locNames = t && t.workLocations ? t.workLocations.map(function (w) { return w.name; }).join(', ') : '';

        var accuracy = a ? (a.checkOutAccuracy != null ? a.checkOutAccuracy : a.checkInAccuracy) : null;
        var dist = a ? (a.checkOutDistanceMeters != null ? a.checkOutDistanceMeters : a.checkInDistanceMeters) : null;
        var locCell = a
            ? attCell('Work location', esc(a.workLocationName || '—'),
                dist != null ? 'Inside · ' + Math.round(dist) + ' m of ' + (a.allowedRadiusMeters != null ? a.allowedRadiusMeters : '?') + ' m allowed' : '')
            : attCell('Work location', t && t.workLocations && t.workLocations.length ? esc(locNames) : 'None set up yet',
                t && t.workLocations && t.workLocations.length ? 'Checked when you tap Check In' : 'Ask your Admin to add one');

        if (u.role === 'SO') {
            // a Sales Officer checks in at an assigned shop, not at a work location
            locCell = attCell('Shop', a ? esc(a.shopName || '—') : 'Chosen when you check in',
                a ? (dist != null ? 'Inside · ' + Math.round(dist) + ' m of ' + (a.allowedRadiusMeters != null ? a.allowedRadiusMeters : '?') + ' m allowed' : '') +
                    (a.hasPhoto ? ' · 📷 photo saved' : '')
                  : 'Live GPS + live photo at the shop');
        }

        var grid =
            attCell("Today's date", esc(t ? fmtDate(t.date) : fmtDate(todayIso()))) +
            attCell('Check in', esc(a ? fmtTime(a.checkInTime) : '—')) +
            attCell('Check out', esc(a && a.checkOutTime ? fmtTime(a.checkOutTime) : '—')) +
            attCell('Working hours', a ? (a.checkOutTime ? esc(a.workingHours || minutesText(a.totalWorkingMinutes)) : 'In progress') : '—') +
            attCell('Status', a ? statusBadge(a.status) : '<span class="sp-badge sp-b-none">' + (t ? 'Not checked in' : 'Loading…') + '</span>') +
            attCell('GPS accuracy', accuracy != null ? '±' + Math.round(accuracy) + ' m' : '—',
                t && t.maxAccuracyMeters ? 'Need ±' + Math.round(t.maxAccuracyMeters) + ' m or better' : '') +
            locCell;

        var main;
        var dis = Att.busy || !t ? ' disabled' : '';
        if (st === 'CHECKED_IN') {
            main = '<button type="button" class="sp-btn sp-btn-done" disabled>✔ CHECKED IN</button>' +
                '<button type="button" class="sp-btn sp-btn-out" data-act="out"' + dis + '>CHECK OUT</button>';
        } else if (st === 'COMPLETED') {
            main = '<button type="button" class="sp-btn sp-btn-done" disabled>✅ COMPLETED FOR TODAY</button>';
        } else {
            main = '<button type="button" class="sp-btn sp-btn-go" data-act="in"' + dis + '>📍 CHECK IN</button>';
        }
        var extra = '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-act="history">🗓 My history</button>';
        if (isManager(u)) extra += '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-act="team">👥 Team attendance</button>';
        if (host.getAttribute('data-sp-so') === '1') {
            if (st === 'CHECKED_IN' || st === 'COMPLETED') {
                extra += '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-act="shop">🏪 Shop visit</button>';
            }
            extra += '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-act="pdf">📄 PDF</button>' +
                '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-act="excel">📊 Excel</button>';
        }

        var embedded = host.classList.contains('sp-embedded');
        host.innerHTML =
            (embedded ? '' : '<div class="sp-att-head"><h3 class="sp-att-title">📍 GPS Attendance</h3>' +
                '<span class="sp-att-date">' + esc(roleLabel(u.role)) + ' · ' + esc(u.name) + '</span></div>') +
            '<div class="sp-att-grid">' + grid + '</div>' +
            '<div class="sp-actions">' + main + extra + '</div>' +
            (Att.msg ? '<div class="sp-msg sp-msg-' + Att.msg.kind + '" role="status">' + esc(Att.msg.text) + '</div>' : '') +
            (Att.lastFix ? '<div class="sp-muted">Last reading from this device: ' + esc(gpsText(Att.lastFix.latitude, Att.lastFix.longitude, Att.lastFix.accuracy)) +
                ' · <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + encodeURIComponent(Att.lastFix.latitude + ',' + Att.lastFix.longitude) +
                '">see it on the map</a> (if that is not where you are, this device has no real GPS - use a phone)</div>' : '');
    }

    function renderAll() {
        Att.hosts = Att.hosts.filter(function (h) { return doc.body.contains(h); });
        Att.hosts.forEach(renderHost);
    }

    function onHostClick(e) {
        var btn = e.target.closest ? e.target.closest('[data-act]') : null;
        if (!btn || btn.disabled) return;
        var act = btn.getAttribute('data-act');
        if (act === 'in' && Att.user && Att.user.role === 'SO') openShopCheckIn();
        else if (act === 'in' || act === 'out') doAttendance(act);
        else if (act === 'history') openHistory();
        else if (act === 'team') openTeam();
        else if (act === 'pdf' || act === 'excel') exportMine(act);
        else if (act === 'shop') {
            try {
                var remaining = typeof global.getCurrentPendingVisitIndex === 'function' && global.getCurrentPendingVisitIndex() !== -1;
                if (remaining && typeof global.openShopVisitFlow === 'function' && typeof currentOfficer !== 'undefined' && currentOfficer && currentOfficer.attendanceStatus === 'PRESENT') global.openShopVisitFlow();
                else if (typeof global.openSOAttendanceFlow === 'function') global.openSOAttendanceFlow();
            } catch (err) { /* legacy shop flow unavailable */ }
        }
    }

    function registerHost(host) {
        if (Att.hosts.indexOf(host) < 0) {
            Att.hosts.push(host);
            host.addEventListener('click', onHostClick);
        }
    }

    async function refreshToday() {
        if (!Att.user || Att.user.role === 'ADMIN') { renderAll(); return; }
        try { Att.state = await global.SPApi.today(); syncLegacyPresence(); }
        catch (e) {
            if (e.status !== 401) setMsg('err', global.SPApi.friendlyError(e));
        }
        renderAll();
    }

    async function doAttendance(kind) {
        if (Att.busy) return;
        Att.busy = true;
        setMsg('info', '📡 Getting your GPS location… allow location access if your browser asks.');
        renderAll();
        var gps;
        try {
            gps = await global.SPApi.getPosition();
        } catch (e) {
            Att.busy = false; setMsg('err', e.message); renderAll(); return;
        }
        Att.lastFix = { latitude: gps.latitude, longitude: gps.longitude, accuracy: gps.accuracy };
        setMsg('info', '✔ Location found (±' + Math.round(gps.accuracy) + ' m). Verifying with the server…');
        renderAll();
        try {
            var r = kind === 'in' ? await global.SPApi.checkIn(gps) : await global.SPApi.checkOut(gps);
            if (kind === 'in') {
                setMsg('ok', '✅ Checked in at ' + fmtTime(r.checkInTime) + ' · ' + Math.round(r.checkInDistanceMeters) +
                    ' m from ' + (r.workLocationName || 'the work location') + ' (allowed ' + r.allowedRadiusMeters + ' m) · GPS ±' +
                    Math.round(r.checkInAccuracy) + ' m · ' + (STATUS_LABEL[r.status] || r.status));
            } else {
                setMsg('ok', '✅ Checked out at ' + fmtTime(r.checkOutTime) + ' · working hours ' +
                    (r.workingHours || minutesText(r.totalWorkingMinutes)) + ' · ' + (STATUS_LABEL[r.status] || r.status));
            }
        } catch (e) {
            var extra = '';
            if (e.code === 'OUTSIDE_GEOFENCE' || e.code === 'POOR_GPS_ACCURACY') {
                extra = ' Your device reported ' + Number(gps.latitude).toFixed(5) + ', ' + Number(gps.longitude).toFixed(5) +
                    ' (±' + Math.round(gps.accuracy) + ' m). A laptop or desktop has no GPS and often reports a wrong or approximate place - use your phone for check-in.';
            }
            setMsg('err', global.SPApi.friendlyError(e) + extra);
        }
        Att.busy = false;
        await refreshToday();
    }

    // ---- Sales Officer: check in at an assigned shop --------------------------------------------
    // The original shop-verification popup (Login > Select Shop > GPS ON > Check Distance > Live Camera > Attendance) is the
    // screen; what changed is where its data comes from and who decides. The shops are the ones the Admin assigned (from the
    // server), and "Mark Present" sends the officer's GPS + the live photo to the server, which repeats the distance check
    // and stores the photo. The browser's own distance/"allowed" answer is only a preview.
    function toLegacyShop(sh) {
        return {
            id: sh.code, _sid: sh.id, _server: true, name: sh.name, locality: sh.locality || '', region: sh.region || '',
            address: sh.address || '', phone: sh.phone || '', mobile: '', lat: sh.latitude, lng: sh.longitude,
            radius: sh.allowedRadiusMeters
        };
    }

    /** null = not signed in to the backend (the original demo shops are used); otherwise exactly the officer's assigned shops. */
    function serverShops() { return Att.user ? (Att.shops || []) : null; }
    function maxAccuracy() { return Att.state && Att.state.maxAccuracyMeters != null ? Att.state.maxAccuracyMeters : null; }

    async function openShopCheckIn() {
        if (Att.busy) return;
        Att.busy = true;
        setMsg('info', '🏬 Loading your assigned shops…');
        renderAll();
        var shops;
        try { shops = await global.SPApi.myShops(); }
        catch (e) { Att.busy = false; setMsg('err', global.SPApi.friendlyError(e)); renderAll(); return; }
        Att.busy = false;
        Att.shops = (shops || []).map(toLegacyShop);
        if (!Att.shops.length) {
            setMsg('err', 'No shop is assigned to you yet, so you cannot mark attendance. Ask your Admin to assign your shops.');
            renderAll();
            return;
        }
        setMsg('', '');
        renderAll();
        var err = $('#so-att-error'); if (err) err.style.display = 'none';
        if (typeof global.openSOAttendanceFlow === 'function') global.openSOAttendanceFlow();
    }

    function ensureAttError() {
        var el = $('#so-att-error');
        if (el) return el;
        var btn = $('#so-att-next-btn');
        el = doc.createElement('div');
        el.id = 'so-att-error';
        el.className = 'sp-msg sp-msg-err';
        el.setAttribute('role', 'alert');
        el.style.display = 'none';
        var row = btn && btn.parentNode;
        if (row && row.parentNode) row.parentNode.insertBefore(el, row);
        return el;
    }

    function dataUrlToBlob(dataUrl) {
        var m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(dataUrl || '');
        if (!m) throw new Error('Could not read the photo.');
        var bin = m[2] ? global.atob(m[3]) : decodeURIComponent(m[3]);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: m[1] || 'image/jpeg' });
    }

    /** The live photo as an upload: a phone photo can be 4000 px wide, so it is scaled down to at most 1600 px first. */
    function preparePhoto(dataUrl) {
        return new Promise(function (resolve) {
            var img = new Image();
            img.onload = function () {
                try {
                    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
                    var scale = Math.min(1, 1600 / Math.max(w, h));
                    if (scale >= 1 && /^data:image\/jpeg/.test(dataUrl)) return resolve(dataUrlToBlob(dataUrl));
                    var c = doc.createElement('canvas');
                    c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    c.toBlob(function (b) { resolve(b || dataUrlToBlob(dataUrl)); }, 'image/jpeg', 0.85);
                } catch (e) { resolve(dataUrlToBlob(dataUrl)); }
            };
            img.onerror = function () { resolve(dataUrlToBlob(dataUrl)); };
            img.src = dataUrl;
        });
    }

    function closeAttendancePopup() {
        try { if (typeof global.stopLiveCamera === 'function') global.stopLiveCamera('so-att-photo-preview'); } catch (e) { /* camera already off */ }
        var ov = $('#so-attendance-overlay'); if (ov) ov.classList.remove('open');
    }

    /** Called by the popup's "Next: Mark Present". `done` = the original local bookkeeping (closes the popup, updates the KPIs). */
    async function submitShopAttendance(s, done) {
        if (Att.busy || !s || !s.shop || !s.photo) return;
        Att.busy = true; s.submitting = true;
        var err = ensureAttError(); err.style.display = 'none'; err.textContent = '';
        if (typeof global.updateSOAttNextButton === 'function') global.updateSOAttNextButton();
        var saved = false;
        try {
            var photo = await preparePhoto(s.photo);
            var fd = new FormData();
            fd.append('shopId', String(s.shop._sid));
            fd.append('latitude', String(s.deviceLat));
            fd.append('longitude', String(s.deviceLng));
            fd.append('accuracy', String(s.deviceAcc != null ? s.deviceAcc : 99999));   // no accuracy reported = not trustworthy
            fd.append('deviceInfo', ((global.navigator && global.navigator.userAgent) || '').slice(0, 250));
            fd.append('photo', photo, 'shop.jpg');
            var r = await global.SPApi.shopCheckIn(fd);
            saved = true;
            Att.lastFix = { latitude: s.deviceLat, longitude: s.deviceLng, accuracy: s.deviceAcc };
            setMsg('ok', '✅ Attendance marked at ' + (r.shopName || s.shop.name) + ' at ' + fmtTime(r.checkInTime) + ' · ' +
                Math.round(r.checkInDistanceMeters) + ' m from the shop (allowed ' + r.allowedRadiusMeters + ' m) · GPS ±' +
                Math.round(r.checkInAccuracy) + ' m · ' + (STATUS_LABEL[r.status] || r.status) + ' · live photo saved');
        } catch (e) {
            err.textContent = global.SPApi.friendlyError(e);
            err.style.display = '';
        }
        Att.busy = false; s.submitting = false;
        if (saved) {
            try { done(); }
            catch (ex) { if (global.console) console.warn('Attendance is saved; the local screen update failed:', ex); closeAttendancePopup(); }
        } else if (typeof global.updateSOAttNextButton === 'function') {
            global.updateSOAttNextButton();
        }
        await refreshToday();
    }

    /** Keep the original (local) screens consistent with the server: if the server says I am in, the old "Shop visit" flow must agree. */
    function syncLegacyPresence() {
        try {
            if (!Att.user || Att.user.role !== 'SO' || !Att.state) return;
            if (Att.state.state !== 'CHECKED_IN' && Att.state.state !== 'COMPLETED') return;
            if (typeof currentOfficer === 'undefined' || !currentOfficer) return;                       // eslint-disable-line no-undef
            var d = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
            if (currentOfficer.attendanceStatus !== 'PRESENT' || currentOfficer.checkInDate !== d) {    // eslint-disable-line no-undef
                currentOfficer.attendanceStatus = 'PRESENT';                                            // eslint-disable-line no-undef
                currentOfficer.checkInDate = d;                                                         // eslint-disable-line no-undef
                if (!currentOfficer.loginTime && Att.state.attendance) currentOfficer.loginTime = fmtTime(Att.state.attendance.checkInTime);   // eslint-disable-line no-undef
                if (typeof saveSOOfficers === 'function') saveSOOfficers();                             // eslint-disable-line no-undef
            }
        } catch (e) { /* the local screens are optional */ }
    }

    // ---- the live photo taken at check-in (any table row with data-photo) ------------------------
    async function openPhoto(id) {
        var url = null;
        var body = openModal('Check-in photo', { onClose: function () { if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } url = null; } } });
        body.innerHTML = '<div class="sp-muted">Loading photo…</div>';
        try {
            var blob = await global.SPApi.attendancePhoto(id);
            var ov = $('#sp-modal-overlay');
            if (!ov || !ov.classList.contains('open')) return;                                         // closed while loading
            url = URL.createObjectURL(blob);
            body.innerHTML = '<img alt="Live photo taken at check-in" src="' + url + '" style="max-width:100%;border-radius:10px;display:block;margin:0 auto">';
        } catch (e) {
            body.innerHTML = '<div class="sp-msg sp-msg-err">' + esc(global.SPApi.friendlyError(e)) + '</div>';
        }
    }

    // ---- own history / summary -----------------------------------------------
    function openHistory() {
        var me = global.SPApi.user(); if (!me) return;
        var body = openModal('My attendance history', { wide: true });
        var f = { from: monthStartIso(todayIso()), to: todayIso(), status: '' };
        var rowsCache = [], sumCache = null;
        body.innerHTML =
            '<div class="sp-filters">' +
            '<label class="sp-field">From<input type="date" id="sp-h-from" value="' + f.from + '"></label>' +
            '<label class="sp-field">To<input type="date" id="sp-h-to" value="' + f.to + '"></label>' +
            '<label class="sp-field">Status<select id="sp-h-status"><option value="">All</option><option value="PRESENT">Present</option>' +
            '<option value="LATE">Late</option><option value="HALF_DAY">Half day</option><option value="ABSENT">Absent</option></select></label>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-primary" id="sp-h-apply">Apply</button>' +
            '<span class="sp-spacer"></span>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="sp-h-pdf">📄 PDF</button>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="sp-h-xls">📊 Excel</button></div>' +
            '<div id="sp-h-out"><div class="sp-muted">Loading…</div></div>';

        async function load() {
            f.from = $('#sp-h-from', body).value; f.to = $('#sp-h-to', body).value; f.status = $('#sp-h-status', body).value;
            var out = $('#sp-h-out', body);
            out.innerHTML = '<div class="sp-muted">Loading…</div>';
            try {
                var res = await Promise.all([
                    global.SPApi.myAttendance({ from: f.from, to: f.to, status: f.status }),
                    global.SPApi.summary({ from: f.from, to: f.to, userId: me.id })
                ]);
                rowsCache = res[0]; sumCache = res[1];
                out.innerHTML = kpiHtml(sumCache) + attTableHtml(rowsCache, {});
            } catch (e) {
                out.innerHTML = '<div class="sp-msg sp-msg-err">' + esc(global.SPApi.friendlyError(e)) + '</div>';
            }
        }
        function meta() {
            return {
                title: 'My Attendance Report',
                lines: ['Employee: ' + me.name + ' (' + (me.employeeCode || '') + ')  |  ' + roleLabel(me.role),
                    'Period: ' + fmtDate(f.from) + ' to ' + fmtDate(f.to)],
                summary: sumCache, fileBase: 'My_Attendance_' + f.from + '_to_' + f.to
            };
        }
        $('#sp-h-apply', body).addEventListener('click', load);
        $('#sp-h-pdf', body).addEventListener('click', function () { exportAttendance('pdf', rowsCache, meta()); });
        $('#sp-h-xls', body).addEventListener('click', function () { exportAttendance('excel', rowsCache, meta()); });
        load();
    }

    function kpiHtml(s) {
        if (!s) return '';
        return '<div class="sp-kpis">' +
            [['Working days', s.totalWorkingDays], ['Present', s.present], ['Absent', s.absent],
                ['Late', s.late], ['Half day', s.halfDay], ['Total hours', s.totalWorkingHours]].map(function (k) {
                return '<div class="sp-kpi"><b>' + esc(k[1]) + '</b><span>' + esc(k[0]) + '</span></div>';
            }).join('') + '</div>';
    }

    async function exportMine(kind) {
        var me = global.SPApi.user(); if (!me) return;
        var from = monthStartIso(todayIso()), to = todayIso();
        try {
            var res = await Promise.all([
                global.SPApi.myAttendance({ from: from, to: to }),
                global.SPApi.summary({ from: from, to: to, userId: me.id })
            ]);
            exportAttendance(kind, res[0], {
                title: 'My Attendance Report',
                lines: ['Employee: ' + me.name + ' (' + (me.employeeCode || '') + ')  |  ' + roleLabel(me.role),
                    'Period: ' + fmtDate(from) + ' to ' + fmtDate(to)],
                summary: res[1], fileBase: 'My_Attendance_' + from + '_to_' + to
            });
        } catch (e) { global.alert(global.SPApi.friendlyError(e)); }
    }

    function openTeam() {
        var body = openModal('Team attendance', { wide: true });
        if (global.SPReport) global.SPReport.mount(body, { mode: 'team' });
        else body.innerHTML = '<div class="sp-msg sp-msg-err">The reports module did not load.</div>';
    }

    // ----------------------------------------------------------------------
    // Sales-officer screens that used to read local demo attendance
    // ----------------------------------------------------------------------
    function installSalesOfficerOverrides() {
        // "My Attendance" card on the Sales Officer dashboard -> real GPS attendance
        global.renderMyAttendanceCard = function () {
            try { if (typeof global.renderTodayBeatCard === 'function') global.renderTodayBeatCard(); } catch (e) { /* beat card is optional */ }
            var wrap = $('#so-attendance-status');
            var dateLabel = $('#so-att-date-label');
            if (dateLabel) dateLabel.textContent = fmtDate(todayIso());
            if (!wrap) return;
            wrap.classList.add('sp-att-card', 'sp-embedded');
            wrap.setAttribute('data-sp-so', '1');
            registerHost(wrap);
            renderHost(wrap);
        };
        // PDF / Excel of the officer's own attendance -> backend data
        global.exportMyAttendanceReport = function (type) { exportMine(type === 'excel' ? 'excel' : 'pdf'); };
        // Week / month present-absent summary -> backend summary
        global.renderSOAttendanceSummary = async function () {
            var body = typeof mmBodyEl !== 'undefined' ? mmBodyEl : null;   // a page-level const, so it is not on window
            var me = global.SPApi.user();
            if (!body || !me) return;
            body.innerHTML = '<div class="sp-muted">Loading your attendance…</div>';
            var today = todayIso(), wk = weekStartIso(today), mo = monthStartIso(today);
            try {
                var res = await Promise.all([
                    global.SPApi.summary({ from: wk, to: today, userId: me.id }),
                    global.SPApi.summary({ from: mo, to: today, userId: me.id }),
                    global.SPApi.myAttendance({ from: mo, to: today })
                ]);
                body.innerHTML =
                    '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">🗓️ This week (' + esc(fmtDate(wk)) + ' – ' + esc(fmtDate(today)) + ')</div>' + kpiHtml(res[0]) +
                    '<div style="font-weight:700;font-size:13px;margin:18px 0 10px;">📅 This month (' + esc(fmtDate(mo)) + ' – ' + esc(fmtDate(today)) + ')</div>' + kpiHtml(res[1]) +
                    '<div style="font-weight:700;font-size:13px;margin:18px 0 10px;">Days you checked in</div>' + attTableHtml(res[2], {}) +
                    '<p class="sp-muted">Counted by the server from your GPS check-ins. Weekly-off days are not working days.</p>';
            } catch (e) {
                body.innerHTML = '<div class="sp-msg sp-msg-err">' + esc(global.SPApi.friendlyError(e)) + '</div>';
            }
        };
    }

    function mountManagerHosts() {
        var spots = [
            ['#dashboard-view .dash-title-row', 'owner'],
            ['#rsm-dashboard-view .so-topbar', 'rsm'],
            ['#rm-dashboard-view .rmx-topbar', 'rm'],
            ['#asm-dashboard-view .asm2-topbar', 'asm']
        ];
        spots.forEach(function (s) {
            var anchor = $(s[0]);
            if (!anchor || $('[data-sp-att="' + s[1] + '"]')) return;
            var host = doc.createElement('div');
            host.className = 'sp-att-card';
            host.setAttribute('data-sp-att', s[1]);
            host.style.marginTop = '16px';
            anchor.insertAdjacentElement('afterend', host);
            registerHost(host);
        });
    }

    // ----------------------------------------------------------------------
    // Login glue
    // ----------------------------------------------------------------------
    function nameEq(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }

    function pickArea(name) {
        try {
            var keys = Object.keys(areaShopMap);   // eslint-disable-line no-undef
            for (var i = 0; i < keys.length; i++) if (nameEq(keys[i], name)) return keys[i];
            return keys[0];
        } catch (e) { return name || ''; }
    }

    /** Sales-demo records (beats, targets, visit plans) are still local; make sure one exists. */
    function localRecordsFor(u) {
        var out = { officer: null, asmPerson: null, rmPerson: null };
        var key = ROLE_KEY[u.role];
        try {
            if (key === 'so') {
                var o = soOfficers.find(function (x) { return nameEq(x.name, u.name); });     // eslint-disable-line no-undef
                if (!o) {
                    o = makeSOOfficer(u.name, soOfficers.length);                              // eslint-disable-line no-undef
                    o.workArea = pickArea(u.area);
                    soOfficers.push(o);
                }
                o.userId = u.username;
                if (typeof saveSOOfficers === 'function') saveSOOfficers();                   // eslint-disable-line no-undef
                out.officer = o;
            } else if (key === 'asm') {
                var p = asmStaff.find(function (x) { return nameEq(x.name, u.name); });       // eslint-disable-line no-undef
                if (!p) { p = { name: u.name, userId: u.username, password: '', area: pickArea(u.area) }; asmStaff.push(p); }
                p.userId = u.username;
                if (typeof saveASMStaff === 'function') saveASMStaff();                       // eslint-disable-line no-undef
                out.asmPerson = p;
            } else if (key === 'rm') {
                var r = rmStaff.find(function (x) { return nameEq(x.name, u.name); });        // eslint-disable-line no-undef
                if (!r) { r = { name: u.name, userId: u.username, password: '', assignedASMs: [] }; rmStaff.push(r); }
                r.userId = u.username;
                if (typeof saveRMStaff === 'function') saveRMStaff();                         // eslint-disable-line no-undef
                out.rmPerson = r;
            }
        } catch (e) { if (global.console) console.warn('Could not prepare local dashboard records:', e); }
        return out;
    }

    /** Sidebar "My Attendance": bring the real GPS attendance card into view (SO dashboard). */
    function showMyAttendance() {
        try { if (typeof global.showSODashboardHome === 'function') global.showSODashboardHome(); } catch (e) { /* already on the dashboard */ }
        var card = $('#so-attendance-status');
        if (!card) return;
        refreshToday();
        setTimeout(function () {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            var box = card.closest('.so-card') || card;
            box.style.transition = 'box-shadow .3s';
            box.style.boxShadow = '0 0 0 3px #2E9F6E';
            setTimeout(function () { box.style.boxShadow = ''; }, 1600);
        }, 60);
    }

    function onSignedIn(user) {
        Att.user = user; Att.state = null; Att.msg = null; Att.busy = false; Att.shops = null;
        mountManagerHosts();
        renderAll();
        refreshToday();
        if (global.SPAdmin && typeof global.SPAdmin.onSignedIn === 'function') global.SPAdmin.onSignedIn(user);
    }

    function resetSession() {
        Att.user = null; Att.state = null; Att.msg = null; Att.busy = false; Att.shops = null;
        renderAll();
        closeModal();
        if (global.SPAdmin && typeof global.SPAdmin.reset === 'function') global.SPAdmin.reset();
    }

    function backToLogin(message) {
        $all('.modal-overlay.open').forEach(function (m) { m.classList.remove('open'); });
        $all('.view.active').forEach(function (v) { v.classList.remove('active'); });
        var lv = $('#login-view'); if (lv) lv.classList.add('active');
        var pw = $('#password'); if (pw) pw.value = '';
        var st = $('#status');
        if (st) { st.style.color = message ? '#C0392B' : ''; st.textContent = message ? '⚠ ' + message : ''; }
    }

    async function signOut() {
        await global.SPApi.logout();      // audited server-side, then the in-memory token is dropped
        resetSession();
    }

    function bindLogout() {
        ['logout-btn', 'so-logout-btn', 'rsm-logout-btn', 'rm-logout-btn', 'asm-logout-btn', 'supervisor-logout-btn'].forEach(function (id) {
            var el = doc.getElementById(id);
            if (!el) return;
            el.addEventListener('click', function () {
                var u = global.SPApi.user();
                if (!u) return;
                // an Admin stepping out of a role preview is not signing out; only the Admin's own button is
                if (id === 'supervisor-logout-btn' || u.role !== 'ADMIN') signOut();
            });
        });
    }

    /** Wired to the change-password screens (SO / RM / ASM / Marketing Manager). */
    async function changePassword(oldId, newId, confirmId, done) {
        var o = doc.getElementById(oldId), n = doc.getElementById(newId), c = doc.getElementById(confirmId);
        if (!o || !n || !c) return;
        if (!o.value || !n.value) { global.alert('Please fill in all password fields.'); return; }
        if (n.value !== c.value) { global.alert('New passwords do not match.'); return; }
        if (n.value.length < 8) { global.alert('The new password must be at least 8 characters.'); return; }
        try {
            await global.SPApi.changePassword(o.value, n.value);
            o.value = ''; n.value = ''; c.value = '';
            global.alert('Password updated. Use the new password the next time you sign in.');
            if (typeof done === 'function') done();
        } catch (e) { global.alert(global.SPApi.friendlyError(e)); }
    }

    // ----------------------------------------------------------------------
    // Boot
    // ----------------------------------------------------------------------
    injectCss();
    installSalesOfficerOverrides();
    bindLogout();
    global.SPApi.onSessionExpired(function (err) { resetSession(); backToLogin(global.SPApi.friendlyError(err)); });
    doc.addEventListener('visibilitychange', function () { if (!doc.hidden && Att.user) refreshToday(); });
    doc.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('[data-photo]') : null;
        if (b) openPhoto(b.getAttribute('data-photo'));
    });

    global.SPBridge = {
        roleKey: function (role) { return ROLE_KEY[role] || null; },
        localRecordsFor: localRecordsFor,
        onSignedIn: onSignedIn,
        changePassword: changePassword,
        showMyAttendance: showMyAttendance,
        serverShops: serverShops,
        maxAccuracy: maxAccuracy,
        submitShopAttendance: submitShopAttendance,
        signOut: signOut,
        util: {
            $: $, $all: $all, esc: esc, pad: pad, fmtDate: fmtDate, fmtTime: fmtTime, minutesText: minutesText,
            todayIso: todayIso, addDays: addDays, weekStartIso: weekStartIso, monthStartIso: monthStartIso,
            gpsText: gpsText, statusBadge: statusBadge, roleLabel: roleLabel, kpiHtml: kpiHtml,
            attTableHtml: attTableHtml, exportAttendance: exportAttendance,
            openModal: openModal, closeModal: closeModal,
            ROLE_LABEL: ROLE_LABEL, STATUS_LABEL: STATUS_LABEL
        }
    };
})(window);
