/* ==========================================================================
   admin-console.js  -  Admin console panels + the shared attendance report

     SPReport.mount(el, {mode:'admin'|'team'})   attendance report with filters,
                                                  summary, PDF/Excel export and
                                                  (admin) audited corrections
     SPAdmin                                      Staff Accounts, Work Locations, Shops,
                                                  Audit Log, Settings, dashboard glance

   Everything shown here is fetched from the backend. Which rows a person may see
   (all / their reporting tree / only themselves) is decided by the server; this
   file never filters by role on its own.
   ========================================================================== */
(function (global) {
    'use strict';
    var doc = global.document;
    var U = global.SPBridge.util;
    var esc = U.esc, $ = U.$;
    var API = global.SPApi;
    var ROLES = ['ADMIN', 'OWNER', 'RSM', 'RM', 'ASM', 'SO'];
    var uid = 0;

    function errBox(e) { return '<div class="sp-msg sp-msg-err">' + esc(API.friendlyError(e)) + '</div>'; }
    function opt(value, label, selected) {
        return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    }
    function nz(v) { v = (v == null ? '' : String(v)).trim(); return v === '' ? null : v; }

    // ======================================================================
    // Attendance report (admin: everyone + corrections; team: my reporting tree)
    // ======================================================================
    function mountReport(container, options) {
        var admin = options.mode === 'admin';
        var id = 'sp-r' + (++uid) + '-';
        var users = [], locs = [], rows = [], sum = null;
        var today = U.todayIso();

        container.innerHTML =
            '<div class="sp-filters">' +
            '<label class="sp-field">From<input type="date" id="' + id + 'from" value="' + today + '"></label>' +
            '<label class="sp-field">To<input type="date" id="' + id + 'to" value="' + today + '"></label>' +
            '<label class="sp-field">Employee<select id="' + id + 'user"><option value="">All</option></select></label>' +
            '<label class="sp-field">Role<select id="' + id + 'role"><option value="">All</option>' +
            ROLES.filter(function (r) { return r !== 'ADMIN'; }).map(function (r) { return opt(r, U.ROLE_LABEL[r]); }).join('') + '</select></label>' +
            '<label class="sp-field">Status<select id="' + id + 'status"><option value="">All</option>' +
            ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT'].map(function (s) { return opt(s, U.STATUS_LABEL[s]); }).join('') + '</select></label>' +
            '<label class="sp-field">Work location<select id="' + id + 'loc"><option value="">All</option></select></label>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-primary" id="' + id + 'apply">Apply</button></div>' +
            '<div class="sp-toolbar">' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-preset="today">Today</button>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-preset="week">This week</button>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-preset="month">This month</button>' +
            '<span class="sp-spacer"></span>' +
            (admin ? '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="' + id + 'manual">+ Manual entry</button>' : '') +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="' + id + 'pdf">📄 PDF</button>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="' + id + 'xls">📊 Excel</button></div>' +
            '<div id="' + id + 'out"><div class="sp-muted">Loading…</div></div>';

        var el = function (s) { return doc.getElementById(id + s); };

        function filters() {
            return {
                from: el('from').value, to: el('to').value, userId: el('user').value,
                role: el('role').value, status: el('status').value, workLocationId: el('loc').value
            };
        }

        async function loadLookups() {
            try {
                var res = await Promise.all([API.users(), API.workLocations(admin)]);
                users = res[0].filter(function (u) { return u.role !== 'ADMIN'; });
                locs = res[1];
                el('user').innerHTML = '<option value="">All</option>' + users.map(function (u) {
                    return opt(u.id, u.name + ' (' + u.employeeCode + ')');
                }).join('');
                el('loc').innerHTML = '<option value="">All</option>' + locs.map(function (w) { return opt(w.id, w.name); }).join('');
            } catch (e) { /* the report itself will show the error */ }
        }

        async function load() {
            var q = filters();
            var out = el('out');
            if (!q.from || !q.to) { out.innerHTML = '<div class="sp-msg sp-msg-err">Choose a From and To date.</div>'; return; }
            if (q.from > q.to) { out.innerHTML = '<div class="sp-msg sp-msg-err">"From" must not be after "To".</div>'; return; }
            out.innerHTML = '<div class="sp-muted">Loading…</div>';
            try {
                var list = admin ? API.adminAttendance : API.teamAttendance;
                var res = await Promise.all([
                    list(q),
                    API.summary({ from: q.from, to: q.to, userId: q.userId, role: q.role })
                ]);
                rows = res[0]; sum = res[1];
                render();
            } catch (e) { out.innerHTML = errBox(e); }
        }

        function employeeTable() {
            if (!sum || !sum.employees || !sum.employees.length) return '';
            return '<h4 style="margin:18px 0 8px;font-family:\'Space Grotesk\',sans-serif;">By employee</h4>' +
                '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Employee</th><th>Role</th><th>Working days</th>' +
                '<th>Present</th><th>Absent</th><th>Late</th><th>Half day</th><th>Total hours</th></tr></thead><tbody>' +
                sum.employees.map(function (e) {
                    return '<tr><td><b>' + esc(e.name) + '</b><br><small>' + esc(e.employeeCode) + '</small></td><td>' + esc(U.roleLabel(e.role)) +
                        '</td><td>' + e.workingDays + '</td><td>' + e.present + '</td><td>' + e.absent + '</td><td>' + e.late +
                        '</td><td>' + e.halfDay + '</td><td>' + esc(e.totalWorkingHours) + '</td></tr>';
                }).join('') + '</tbody></table></div>';
        }

        function render() {
            var out = el('out');
            out.innerHTML = U.kpiHtml(sum) +
                '<h4 style="margin:6px 0 8px;font-family:\'Space Grotesk\',sans-serif;">Attendance records (' + rows.length + ')</h4>' +
                U.attTableHtml(rows, { showEmployee: true, admin: admin }) + employeeTable();
            Array.prototype.forEach.call(out.querySelectorAll('[data-correct]'), function (b) {
                b.addEventListener('click', function () {
                    var rec = rows.filter(function (r) { return String(r.id) === b.getAttribute('data-correct'); })[0];
                    if (rec) openCorrection(rec, load);
                });
            });
        }

        function meta() {
            var q = filters(), parts = [];
            var u = users.filter(function (x) { return String(x.id) === q.userId; })[0];
            if (u) parts.push('Employee: ' + u.name);
            if (q.role) parts.push('Role: ' + U.roleLabel(q.role));
            if (q.status) parts.push('Status: ' + U.STATUS_LABEL[q.status]);
            var w = locs.filter(function (x) { return String(x.id) === q.workLocationId; })[0];
            if (w) parts.push('Work location: ' + w.name);
            return {
                title: admin ? 'Attendance Report' : 'Team Attendance Report',
                lines: ['Period: ' + U.fmtDate(q.from) + ' to ' + U.fmtDate(q.to),
                    (admin ? 'Scope: all staff' : 'Scope: your reporting team') + (parts.length ? '   |   ' + parts.join('   |   ') : '')],
                summary: sum, employees: sum ? sum.employees : null,
                fileBase: (admin ? 'Attendance_Report_' : 'Team_Attendance_') + q.from + '_to_' + q.to
            };
        }

        Array.prototype.forEach.call(container.querySelectorAll('[data-preset]'), function (b) {
            b.addEventListener('click', function () {
                var p = b.getAttribute('data-preset'), t = U.todayIso();
                el('to').value = t;
                el('from').value = p === 'week' ? U.weekStartIso(t) : (p === 'month' ? U.monthStartIso(t) : t);
                load();
            });
        });
        el('apply').addEventListener('click', load);
        el('pdf').addEventListener('click', function () { U.exportAttendance('pdf', rows, meta()); });
        el('xls').addEventListener('click', function () { U.exportAttendance('excel', rows, meta()); });
        if (admin) el('manual').addEventListener('click', function () { openManualEntry(users, load); });

        loadLookups().then(load);
    }

    function openCorrection(a, done) {
        var body = U.openModal('Correct attendance · ' + a.employeeName + ' · ' + U.fmtDate(a.attendanceDate), { sticky: true });
        var inV = (a.checkInTime || '').slice(0, 16), outV = (a.checkOutTime || '').slice(0, 16);
        body.innerHTML =
            '<p class="sp-muted">Every correction needs a reason and is written to the audit log with the before/after values.</p>' +
            '<div class="sp-form-grid">' +
            '<label class="sp-field">Check in<input type="datetime-local" id="sp-c-in" value="' + esc(inV) + '"></label>' +
            '<label class="sp-field">Check out<input type="datetime-local" id="sp-c-out" value="' + esc(outV) + '"></label>' +
            '<label class="sp-field sp-wide">Status<select id="sp-c-status"><option value="">Work out from the times</option>' +
            ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT'].map(function (s) { return opt(s, U.STATUS_LABEL[s]); }).join('') + '</select></label>' +
            '<label class="sp-field sp-wide">Reason (required)<textarea id="sp-c-reason" rows="3" maxlength="500" placeholder="Why is this being changed?"></textarea></label></div>' +
            '<div id="sp-c-err"></div><div class="sp-toolbar" style="margin-top:14px"><span class="sp-spacer"></span>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="sp-c-cancel">Cancel</button>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-primary" id="sp-c-save">Save correction</button></div>';
        $('#sp-c-cancel', body).addEventListener('click', U.closeModal);
        $('#sp-c-save', body).addEventListener('click', async function () {
            var reason = $('#sp-c-reason', body).value.trim();
            var err = $('#sp-c-err', body);
            if (reason.length < 5) { err.innerHTML = '<div class="sp-msg sp-msg-err">Please give a reason (at least 5 characters).</div>'; return; }
            var vIn = $('#sp-c-in', body).value, vOut = $('#sp-c-out', body).value;
            try {
                await API.correctAttendance(a.id, {
                    checkInTime: vIn ? vIn + ':00' : null, checkOutTime: vOut ? vOut + ':00' : null,
                    status: $('#sp-c-status', body).value || null, reason: reason
                });
                U.closeModal(); done();
            } catch (e) { err.innerHTML = errBox(e); }
        });
    }

    function openManualEntry(users, done) {
        var body = U.openModal('Manual attendance entry', { sticky: true });
        body.innerHTML =
            '<p class="sp-muted">For a day with no record at all (for example the person could not use the app). Needs a reason and is audited.</p>' +
            '<div class="sp-form-grid">' +
            '<label class="sp-field sp-wide">Employee<select id="sp-m-user">' +
            users.map(function (u) { return opt(u.id, u.name + ' (' + u.employeeCode + ')'); }).join('') + '</select></label>' +
            '<label class="sp-field">Date<input type="date" id="sp-m-date" max="' + U.todayIso() + '" value="' + U.todayIso() + '"></label>' +
            '<label class="sp-field">Status<select id="sp-m-status"><option value="">Work out from the times</option>' +
            ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT'].map(function (s) { return opt(s, U.STATUS_LABEL[s]); }).join('') + '</select></label>' +
            '<label class="sp-field">Check in<input type="time" id="sp-m-in"></label>' +
            '<label class="sp-field">Check out<input type="time" id="sp-m-out"></label>' +
            '<label class="sp-field sp-wide">Reason (required)<textarea id="sp-m-reason" rows="3" maxlength="500"></textarea></label></div>' +
            '<div id="sp-m-err"></div><div class="sp-toolbar" style="margin-top:14px"><span class="sp-spacer"></span>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="sp-m-cancel">Cancel</button>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-primary" id="sp-m-save">Save entry</button></div>';
        $('#sp-m-cancel', body).addEventListener('click', U.closeModal);
        $('#sp-m-save', body).addEventListener('click', async function () {
            var err = $('#sp-m-err', body);
            var date = $('#sp-m-date', body).value, tin = $('#sp-m-in', body).value, tout = $('#sp-m-out', body).value;
            var reason = $('#sp-m-reason', body).value.trim();
            if (!date) { err.innerHTML = '<div class="sp-msg sp-msg-err">Choose a date.</div>'; return; }
            if (reason.length < 5) { err.innerHTML = '<div class="sp-msg sp-msg-err">Please give a reason (at least 5 characters).</div>'; return; }
            try {
                await API.createAttendance({
                    userId: Number($('#sp-m-user', body).value), date: date,
                    checkInTime: tin ? date + 'T' + tin + ':00' : null, checkOutTime: tout ? date + 'T' + tout + ':00' : null,
                    status: $('#sp-m-status', body).value || null, reason: reason
                });
                U.closeModal(); done();
            } catch (e) { err.innerHTML = errBox(e); }
        });
    }

    // ======================================================================
    // Staff accounts
    // ======================================================================
    function renderStaff(host) {
        host.innerHTML = '<div class="sp-muted">Loading…</div>';
        var users = [];
        var f = { q: '', role: '', status: '' };

        function shell() {
            host.innerHTML =
                '<div class="sp-toolbar">' +
                '<label class="sp-field">Search<input id="sp-s-q" placeholder="Name, username or code" value="' + esc(f.q) + '"></label>' +
                '<label class="sp-field">Role<select id="sp-s-role"><option value="">All</option>' +
                ROLES.map(function (r) { return opt(r, U.ROLE_LABEL[r], f.role === r); }).join('') + '</select></label>' +
                '<label class="sp-field">Status<select id="sp-s-status"><option value="">All</option>' +
                opt('ACTIVE', 'Active', f.status === 'ACTIVE') + opt('INACTIVE', 'Inactive', f.status === 'INACTIVE') + '</select></label>' +
                '<span class="sp-spacer"></span><button type="button" class="sp-btn sp-btn-sm sp-btn-primary" id="sp-s-add">+ Add staff</button></div>' +
                '<div id="sp-s-table"></div>';
            $('#sp-s-q', host).addEventListener('input', function (e) { f.q = e.target.value; table(); });
            $('#sp-s-role', host).addEventListener('change', function (e) { f.role = e.target.value; table(); });
            $('#sp-s-status', host).addEventListener('change', function (e) { f.status = e.target.value; table(); });
            $('#sp-s-add', host).addEventListener('click', function () { openUserForm(null, users, reload); });
            table();
        }

        function table() {
            var q = f.q.trim().toLowerCase();
            var list = users.filter(function (u) {
                return (!f.role || u.role === f.role) && (!f.status || u.status === f.status) &&
                    (!q || (u.name + ' ' + u.username + ' ' + u.employeeCode).toLowerCase().indexOf(q) >= 0);
            });
            var t = $('#sp-s-table', host);
            if (!list.length) { t.innerHTML = '<div class="sp-muted">No staff match.</div>'; return; }
            t.innerHTML = '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Code</th><th>Name</th><th>Username</th><th>Role</th>' +
                '<th>Area / Region</th><th>Reports to</th><th>Status</th><th></th></tr></thead><tbody>' +
                list.map(function (u) {
                    return '<tr><td>' + esc(u.employeeCode) + '</td><td><b>' + esc(u.name) + '</b><br><small>' + esc(u.designation || '') + '</small></td>' +
                        '<td>' + esc(u.username) + '</td><td>' + esc(U.roleLabel(u.role)) + '</td>' +
                        '<td>' + esc([u.area, u.region].filter(Boolean).join(' / ') || '—') + '</td>' +
                        '<td>' + esc(u.reportingManagerName || '—') + '</td>' +
                        '<td><span class="sp-badge sp-b-' + esc(u.status) + '">' + esc(u.status === 'ACTIVE' ? 'Active' : 'Inactive') + '</span></td>' +
                        '<td><div class="sp-row-actions">' +
                        '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-edit="' + u.id + '">Edit</button>' +
                        '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-toggle="' + u.id + '">' + (u.status === 'ACTIVE' ? 'Deactivate' : 'Activate') + '</button>' +
                        '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-reset="' + u.id + '">Reset password</button>' +
                        '<button type="button" class="sp-btn sp-btn-sm sp-btn-danger" data-delete="' + u.id + '">Delete</button></div></td></tr>';
                }).join('') + '</tbody></table></div>';
            function byId(v) { return users.filter(function (u) { return String(u.id) === v; })[0]; }
            Array.prototype.forEach.call(t.querySelectorAll('[data-edit]'), function (b) {
                b.addEventListener('click', function () { openUserForm(byId(b.getAttribute('data-edit')), users, reload); });
            });
            Array.prototype.forEach.call(t.querySelectorAll('[data-reset]'), function (b) {
                b.addEventListener('click', function () { openResetPassword(byId(b.getAttribute('data-reset'))); });
            });
            Array.prototype.forEach.call(t.querySelectorAll('[data-delete]'), function (b) {
                b.addEventListener('click', async function () {
                    var u = byId(b.getAttribute('data-delete'));
                    if (!global.confirm('Permanently delete ' + u.name + ' (' + u.username + ')? This removes their account and ' +
                        'all their attendance history, and cannot be undone.')) return;
                    try { await API.deleteUser(u.id); reload(); } catch (e) { global.alert(API.friendlyError(e)); }
                });
            });
            Array.prototype.forEach.call(t.querySelectorAll('[data-toggle]'), function (b) {
                b.addEventListener('click', async function () {
                    var u = byId(b.getAttribute('data-toggle'));
                    var to = u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
                    if (!global.confirm((to === 'INACTIVE' ? 'Deactivate ' : 'Activate ') + u.name + '? ' +
                        (to === 'INACTIVE' ? 'They will not be able to sign in.' : 'They will be able to sign in again.'))) return;
                    try { await API.setUserStatus(u.id, to); reload(); } catch (e) { global.alert(API.friendlyError(e)); }
                });
            });
        }

        async function reload() {
            try { users = await API.users(); shell(); }
            catch (e) { host.innerHTML = errBox(e); }
        }
        reload();
    }

    function openUserForm(user, users, done) {
        var editing = !!user;
        var body = U.openModal(editing ? 'Edit staff · ' + user.name : 'Add staff', { sticky: true });
        var v = user || {};
        body.innerHTML =
            '<div class="sp-form-grid">' +
            '<label class="sp-field">Full name *<input id="sp-u-name" maxlength="120" value="' + esc(v.name || '') + '"></label>' +
            '<label class="sp-field">Username *<input id="sp-u-username" maxlength="64" autocapitalize="off" value="' + esc(v.username || '') + '"></label>' +
            (editing ? '' :
                '<label class="sp-field">Password * (8–72 characters)<input id="sp-u-pass" type="password" autocomplete="new-password"></label>' +
                '<label class="sp-field">Confirm password *<input id="sp-u-pass2" type="password" autocomplete="new-password"></label>') +
            '<label class="sp-field">Role *<select id="sp-u-role">' + ROLES.map(function (r) { return opt(r, U.ROLE_LABEL[r], editing ? v.role === r : r === 'SO'); }).join('') + '</select></label>' +
            '<label class="sp-field">Employee code (auto if empty)<input id="sp-u-code" maxlength="32" value="' + esc(v.employeeCode || '') + '"' + (editing ? ' disabled' : '') + '></label>' +
            '<label class="sp-field">Email<input id="sp-u-email" type="email" maxlength="150" value="' + esc(v.email || '') + '"></label>' +
            '<label class="sp-field">Phone<input id="sp-u-phone" maxlength="20" value="' + esc(v.phone || '') + '"></label>' +
            '<label class="sp-field">Designation<input id="sp-u-desig" maxlength="80" value="' + esc(v.designation || '') + '"></label>' +
            '<label class="sp-field">Area / City<input id="sp-u-area" maxlength="80" value="' + esc(v.area || '') + '"></label>' +
            '<label class="sp-field">Region<input id="sp-u-region" maxlength="80" value="' + esc(v.region || '') + '"></label>' +
            '<label class="sp-field sp-wide">Reports to<select id="sp-u-mgr"><option value="">— nobody —</option>' +
            users.filter(function (u) { return !user || u.id !== user.id; }).map(function (u) {
                return opt(u.id, u.name + ' · ' + U.roleLabel(u.role), v.reportingManagerId === u.id);
            }).join('') + '</select></label></div>' +
            '<div id="sp-u-err"></div><div class="sp-toolbar" style="margin-top:14px"><span class="sp-spacer"></span>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="sp-u-cancel">Cancel</button>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-primary" id="sp-u-save">' + (editing ? 'Save changes' : 'Create account') + '</button></div>';
        $('#sp-u-cancel', body).addEventListener('click', U.closeModal);
        $('#sp-u-save', body).addEventListener('click', async function () {
            var g = function (s) { return $('#sp-u-' + s, body); };
            var err = $('#sp-u-err', body);
            var payload = {
                name: g('name').value.trim(), username: g('username').value.trim(), role: g('role').value,
                email: nz(g('email').value), phone: nz(g('phone').value), designation: nz(g('desig').value),
                area: nz(g('area').value), region: nz(g('region').value),
                reportingManagerId: g('mgr').value ? Number(g('mgr').value) : null
            };
            try {
                if (editing) {
                    await API.updateUser(user.id, payload);
                } else {
                    if (g('pass').value !== g('pass2').value) { err.innerHTML = '<div class="sp-msg sp-msg-err">The two passwords do not match.</div>'; return; }
                    payload.password = g('pass').value;
                    payload.employeeCode = nz(g('code').value);
                    await API.createUser(payload);
                }
                U.closeModal(); done();
            } catch (e) { err.innerHTML = errBox(e); }
        });
    }

    function openResetPassword(user) {
        var body = U.openModal('Reset password · ' + user.name, { sticky: true });
        body.innerHTML =
            '<p class="sp-muted">Sets a new password for <b>' + esc(user.username) + '</b>. The change is written to the audit log (never the password itself).</p>' +
            '<div class="sp-form-grid"><label class="sp-field">New password (8–72 characters)<input id="sp-p-new" type="password" autocomplete="new-password"></label>' +
            '<label class="sp-field">Confirm<input id="sp-p-new2" type="password" autocomplete="new-password"></label></div>' +
            '<div id="sp-p-err"></div><div class="sp-toolbar" style="margin-top:14px"><span class="sp-spacer"></span>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="sp-p-cancel">Cancel</button>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-primary" id="sp-p-save">Reset password</button></div>';
        $('#sp-p-cancel', body).addEventListener('click', U.closeModal);
        $('#sp-p-save', body).addEventListener('click', async function () {
            var a = $('#sp-p-new', body).value, b = $('#sp-p-new2', body).value, err = $('#sp-p-err', body);
            if (a !== b) { err.innerHTML = '<div class="sp-msg sp-msg-err">The two passwords do not match.</div>'; return; }
            try { await API.resetPassword(user.id, a); U.closeModal(); global.alert('Password reset for ' + user.name + '.'); }
            catch (e) { err.innerHTML = errBox(e); }
        });
    }

    // ======================================================================
    // Work locations (geofences)
    // ======================================================================
    function renderLocations(host) {
        host.innerHTML = '<div class="sp-muted">Loading…</div>';
        async function reload() {
            try {
                var list = await API.workLocations(true);
                host.innerHTML = '<div class="sp-toolbar"><span class="sp-muted">The server compares every check-in / check-out with these circles.</span>' +
                    '<span class="sp-spacer"></span><button type="button" class="sp-btn sp-btn-sm sp-btn-primary" id="sp-l-add">+ Add location</button></div>' +
                    (list.length ? '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Name</th><th>Address</th><th>Latitude</th><th>Longitude</th>' +
                        '<th>Radius</th><th>Status</th><th></th></tr></thead><tbody>' +
                        list.map(function (w) {
                            return '<tr><td><b>' + esc(w.name) + '</b></td><td>' + esc(w.address || '—') + '</td><td>' + Number(w.latitude).toFixed(6) +
                                '</td><td>' + Number(w.longitude).toFixed(6) + '</td><td>' + w.allowedRadiusMeters + ' m</td>' +
                                '<td><span class="sp-badge sp-b-' + esc(w.status) + '">' + (w.status === 'ACTIVE' ? 'Active' : 'Inactive') + '</span></td>' +
                                '<td><div class="sp-row-actions"><button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-edit="' + w.id + '">Edit</button>' +
                                '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-toggle="' + w.id + '">' + (w.status === 'ACTIVE' ? 'Deactivate' : 'Activate') + '</button></div></td></tr>';
                        }).join('') + '</tbody></table></div>'
                        : '<div class="sp-msg sp-msg-info">No work location yet. Nobody can check in until you add one.</div>');
                $('#sp-l-add', host).addEventListener('click', function () { openLocationForm(null, reload); });
                var byId = function (v) { return list.filter(function (w) { return String(w.id) === v; })[0]; };
                Array.prototype.forEach.call(host.querySelectorAll('[data-edit]'), function (b) {
                    b.addEventListener('click', function () { openLocationForm(byId(b.getAttribute('data-edit')), reload); });
                });
                Array.prototype.forEach.call(host.querySelectorAll('[data-toggle]'), function (b) {
                    b.addEventListener('click', async function () {
                        var w = byId(b.getAttribute('data-toggle')), to = w.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
                        if (!global.confirm((to === 'INACTIVE' ? 'Deactivate ' : 'Activate ') + w.name + '?')) return;
                        try { await API.setWorkLocationStatus(w.id, to); reload(); } catch (e) { global.alert(API.friendlyError(e)); }
                    });
                });
            } catch (e) { host.innerHTML = errBox(e); }
        }
        reload();
    }

    function validCoord(lat, lng) {
        return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    }

    function openLocationForm(w, done) {
        var editing = !!w;
        var map = null;
        var body = U.openModal(editing ? 'Edit work location' : 'Add work location', {
            sticky: true,
            onClose: function () { if (map) { try { map.remove(); } catch (e) { /* ignore */ } map = null; } }
        });
        body.innerHTML =
            '<div class="sp-form-grid">' +
            '<label class="sp-field sp-wide">Name *<input id="sp-w-name" maxlength="120" value="' + esc(w ? w.name : '') + '"></label>' +
            '<label class="sp-field sp-wide">Address<input id="sp-w-addr" maxlength="255" value="' + esc(w ? w.address || '' : '') + '"></label>' +
            '<label class="sp-field">Latitude *<input id="sp-w-lat" inputmode="decimal" value="' + (w ? w.latitude : '') + '"></label>' +
            '<label class="sp-field">Longitude *<input id="sp-w-lng" inputmode="decimal" value="' + (w ? w.longitude : '') + '"></label>' +
            '<label class="sp-field">Allowed radius (10–5000 m) *<input id="sp-w-rad" inputmode="numeric" value="' + (w ? w.allowedRadiusMeters : 200) + '"></label>' +
            '<div class="sp-field" style="justify-content:flex-end"><button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="sp-w-here">📍 Use my current location</button></div>' +
            '<div class="sp-wide"><div class="sp-cell-l">Click the map to place the centre</div><div class="sp-map" id="sp-w-map"></div></div></div>' +
            '<div id="sp-w-err"></div><div class="sp-toolbar" style="margin-top:14px"><span class="sp-spacer"></span>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="sp-w-cancel">Cancel</button>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-primary" id="sp-w-save">' + (editing ? 'Save changes' : 'Add location') + '</button></div>';
        var g = function (s) { return $('#sp-w-' + s, body); };
        var marker = null, circle = null;

        function draw() {
            if (!map) return;
            var lat = parseFloat(g('lat').value), lng = parseFloat(g('lng').value), r = parseFloat(g('rad').value);
            if (!validCoord(lat, lng)) return;
            if (!marker) { marker = global.L.marker([lat, lng]).addTo(map); circle = global.L.circle([lat, lng], { radius: r > 0 ? r : 50 }).addTo(map); }
            marker.setLatLng([lat, lng]); circle.setLatLng([lat, lng]); circle.setRadius(r > 0 ? r : 50);
            map.setView([lat, lng], map.getZoom() < 15 ? 16 : map.getZoom());
        }
        function setPoint(lat, lng) { g('lat').value = lat.toFixed(6); g('lng').value = lng.toFixed(6); draw(); }

        if (global.L && global.L.map) {
            var lat0 = parseFloat(g('lat').value), lng0 = parseFloat(g('lng').value);
            // the wide default view is only where an EMPTY map starts; it is never stored or used for attendance
            map = global.L.map(g('map')).setView(validCoord(lat0, lng0) ? [lat0, lng0] : [20.5937, 78.9629], validCoord(lat0, lng0) ? 16 : 5);
            global.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
            map.on('click', function (e) { setPoint(e.latlng.lat, e.latlng.lng); });
            setTimeout(function () { if (map) { map.invalidateSize(); draw(); } }, 200);
        } else {
            g('map').outerHTML = '<div class="sp-muted">Map preview unavailable (Leaflet did not load). Type the coordinates instead.</div>';
        }
        g('lat').addEventListener('change', function () {
            var m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(g('lat').value);
            if (m) { g('lat').value = m[1]; g('lng').value = m[2]; }      // "lat, lng" pasted from Google Maps
        });
        ['lat', 'lng', 'rad'].forEach(function (k) { g(k).addEventListener('change', draw); });

        g('here').addEventListener('click', async function () {
            var btn = g('here'); btn.disabled = true; btn.textContent = 'Locating…';
            var box = $('#sp-w-err', body);
            try {
                var p = await API.getPosition();
                setPoint(p.latitude, p.longitude);
                var acc = Math.round(p.accuracy);
                box.innerHTML = p.accuracy > 100
                    ? '<div class="sp-msg sp-msg-info">📡 This device gave only an APPROXIMATE location (±' + acc + ' m). A laptop or desktop has no GPS, ' +
                      'so the pin can be hundreds of metres or even kilometres off. For an exact pin: click the office on the map, or paste "latitude, longitude" ' +
                      'copied from Google Maps (right-click the place, click the numbers) into the Latitude box, or open this page on a phone.</div>'
                    : '<div class="sp-msg sp-msg-ok">📍 Location set (±' + acc + ' m). Check that the pin is on your office.</div>';
            } catch (e) { box.innerHTML = errBox(e); }
            btn.disabled = false; btn.textContent = '📍 Use my current location';
        });
        g('cancel').addEventListener('click', U.closeModal);
        g('save').addEventListener('click', async function () {
            var err = $('#sp-w-err', body);
            var lat = parseFloat(g('lat').value), lng = parseFloat(g('lng').value), rad = parseInt(g('rad').value, 10);
            if (!g('name').value.trim()) { err.innerHTML = '<div class="sp-msg sp-msg-err">Enter a name.</div>'; return; }
            if (!validCoord(lat, lng)) { err.innerHTML = '<div class="sp-msg sp-msg-err">Enter a valid latitude and longitude, or click the map.</div>'; return; }
            var payload = {
                name: g('name').value.trim(), address: nz(g('addr').value), latitude: lat, longitude: lng,
                allowedRadiusMeters: rad, status: w ? w.status : 'ACTIVE'
            };
            try {
                if (editing) await API.updateWorkLocation(w.id, payload); else await API.createWorkLocation(payload);
                U.closeModal(); done();
            } catch (e) { err.innerHTML = errBox(e); }
        });
    }

    // ======================================================================
    // Shops (where Sales Officers mark attendance)
    // ======================================================================
    function renderShops(host) {
        host.innerHTML = '<div class="sp-muted">Loading…</div>';
        var shops = [], officers = [], f = { q: '', officer: '', status: '' };

        function officerName(id) {
            var o = officers.filter(function (x) { return String(x.id) === String(id); })[0];
            return o ? o.name : '';
        }
        function shell() {
            host.innerHTML = '<div class="sp-toolbar">' +
                '<label class="sp-field">Search<input id="sp-sh-q" placeholder="Shop, code or locality" value="' + esc(f.q) + '"></label>' +
                '<label class="sp-field">Officer<select id="sp-sh-off"><option value="">All</option><option value="none">Not assigned</option>' +
                officers.map(function (o) { return opt(o.id, o.name + ' (' + o.employeeCode + ')', String(o.id) === f.officer); }).join('') + '</select></label>' +
                '<label class="sp-field">Status<select id="sp-sh-st"><option value="">All</option>' + opt('ACTIVE', 'Active', f.status === 'ACTIVE') +
                opt('INACTIVE', 'Inactive', f.status === 'INACTIVE') + '</select></label>' +
                '<span class="sp-spacer"></span><button type="button" class="sp-btn sp-btn-sm sp-btn-primary" id="sp-sh-add">+ Add shop</button></div>' +
                '<div id="sp-sh-table"></div>';
            $('#sp-sh-q', host).addEventListener('input', function (e) { f.q = e.target.value; table(); });
            $('#sp-sh-off', host).addEventListener('change', function (e) { f.officer = e.target.value; table(); });
            $('#sp-sh-st', host).addEventListener('change', function (e) { f.status = e.target.value; table(); });
            $('#sp-sh-add', host).addEventListener('click', function () { openShopForm(null, officers, reload); });
            table();
        }
        function table() {
            var t = $('#sp-sh-table', host);
            var q = f.q.trim().toLowerCase();
            var list = shops.filter(function (x) {
                if (q && (x.name + ' ' + x.code + ' ' + (x.locality || '') + ' ' + (x.address || '')).toLowerCase().indexOf(q) < 0) return false;
                if (f.officer === 'none' && x.assignedOfficerId != null) return false;
                if (f.officer && f.officer !== 'none' && String(x.assignedOfficerId) !== f.officer) return false;
                if (f.status && x.status !== f.status) return false;
                return true;
            });
            if (!shops.length) {
                t.innerHTML = '<div class="sp-msg sp-msg-info">No shop yet. A Sales Officer can only mark attendance at a shop assigned to them — add shops here and assign each one to an officer.</div>';
                return;
            }
            t.innerHTML = '<div class="sp-muted">' + list.length + ' of ' + shops.length + ' shops. The server compares an officer\'s GPS with the shop\'s pin and radius; officers cannot move a shop.</div>' +
                '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Code</th><th>Shop</th><th>Locality</th><th>Assigned to</th><th>Radius</th><th>Location</th><th>Status</th><th></th></tr></thead><tbody>' +
                list.map(function (x) {
                    return '<tr><td>' + esc(x.code) + '</td><td><b>' + esc(x.name) + '</b>' + (x.phone ? '<br><small>' + esc(x.phone) + '</small>' : '') + '</td>' +
                        '<td>' + esc([x.locality, x.region].filter(Boolean).join(', ') || '—') + '</td>' +
                        '<td>' + (x.assignedOfficerName ? esc(x.assignedOfficerName) : '<span class="sp-muted">Not assigned</span>') + '</td>' +
                        '<td>' + x.allowedRadiusMeters + ' m</td>' +
                        '<td><small>' + Number(x.latitude).toFixed(5) + ', ' + Number(x.longitude).toFixed(5) + '</small></td>' +
                        '<td><span class="sp-badge sp-b-' + esc(x.status) + '">' + (x.status === 'ACTIVE' ? 'Active' : 'Inactive') + '</span></td>' +
                        '<td><div class="sp-row-actions"><button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-edit="' + x.id + '">Edit</button>' +
                        '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" data-toggle="' + x.id + '">' + (x.status === 'ACTIVE' ? 'Deactivate' : 'Activate') + '</button>' +
                        '<button type="button" class="sp-btn sp-btn-sm sp-btn-danger" data-delete="' + x.id + '">Delete</button></div></td></tr>';
                }).join('') + '</tbody></table></div>';
            function byId(v) { return shops.filter(function (x) { return String(x.id) === v; })[0]; }
            Array.prototype.forEach.call(t.querySelectorAll('[data-edit]'), function (b) {
                b.addEventListener('click', function () { openShopForm(byId(b.getAttribute('data-edit')), officers, reload); });
            });
            Array.prototype.forEach.call(t.querySelectorAll('[data-delete]'), function (b) {
                b.addEventListener('click', async function () {
                    var x = byId(b.getAttribute('data-delete'));
                    if (!global.confirm('Permanently delete ' + x.name + ' (' + x.code + ')? Past attendance recorded there is kept ' +
                        '(just unlinked from this shop). This cannot be undone.')) return;
                    try { await API.deleteShop(x.id); reload(); } catch (e) { global.alert(API.friendlyError(e)); }
                });
            });
            Array.prototype.forEach.call(t.querySelectorAll('[data-toggle]'), function (b) {
                b.addEventListener('click', async function () {
                    var x = byId(b.getAttribute('data-toggle')), to = x.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
                    if (!global.confirm((to === 'INACTIVE' ? 'Deactivate ' : 'Activate ') + x.name + '?')) return;
                    try { await API.setShopStatus(x.id, to); reload(); } catch (e) { global.alert(API.friendlyError(e)); }
                });
            });
        }
        async function reload() {
            try {
                var res = await Promise.all([API.adminShops({ includeInactive: 'true' }), API.users()]);
                shops = res[0];
                officers = res[1].filter(function (u) { return u.role === 'SO' && u.status === 'ACTIVE'; });
                shell();
            } catch (e) { host.innerHTML = errBox(e); }
        }
        reload();
    }

    function openShopForm(x, officers, done) {
        var editing = !!x;
        var map = null;
        var body = U.openModal(editing ? 'Edit shop' : 'Add shop', {
            sticky: true, wide: true,
            onClose: function () { if (map) { try { map.remove(); } catch (e) { /* ignore */ } map = null; } }
        });
        body.innerHTML =
            '<div class="sp-form-grid">' +
            '<label class="sp-field">Shop code<input id="sp-x-code" maxlength="32" placeholder="Leave blank to generate" value="' + esc(x ? x.code : '') + '"></label>' +
            '<label class="sp-field sp-wide">Shop name *<input id="sp-x-name" maxlength="150" value="' + esc(x ? x.name : '') + '"></label>' +
            '<label class="sp-field">Locality<input id="sp-x-loc" maxlength="120" value="' + esc(x ? x.locality || '' : '') + '"></label>' +
            '<label class="sp-field">Region<input id="sp-x-reg" maxlength="80" value="' + esc(x ? x.region || '' : '') + '"></label>' +
            '<label class="sp-field">Phone<input id="sp-x-ph" maxlength="20" inputmode="tel" value="' + esc(x ? x.phone || '' : '') + '"></label>' +
            '<label class="sp-field sp-wide">Address<input id="sp-x-addr" maxlength="255" value="' + esc(x ? x.address || '' : '') + '"></label>' +
            '<label class="sp-field">Assigned Sales Officer<select id="sp-x-off"><option value="">— Not assigned —</option>' +
            officers.map(function (o) { return opt(o.id, o.name + ' (' + o.employeeCode + ')', x && String(x.assignedOfficerId) === String(o.id)); }).join('') + '</select></label>' +
            '<label class="sp-field">Latitude *<input id="sp-x-lat" inputmode="decimal" value="' + (x ? x.latitude : '') + '"></label>' +
            '<label class="sp-field">Longitude *<input id="sp-x-lng" inputmode="decimal" value="' + (x ? x.longitude : '') + '"></label>' +
            '<label class="sp-field">Allowed distance (10–500 m)<input id="sp-x-rad" inputmode="numeric" value="' + (x ? x.allowedRadiusMeters : 50) + '"></label>' +
            '<div class="sp-field" style="justify-content:flex-end"><button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="sp-x-here">📍 Use my current location</button></div>' +
            '<div class="sp-wide"><div class="sp-cell-l">Click the map to place the shop\'s pin, or paste "latitude, longitude" from Google Maps into the Latitude box</div><div class="sp-map" id="sp-x-map"></div></div></div>' +
            '<div id="sp-x-err"></div><div class="sp-toolbar" style="margin-top:14px"><span class="sp-spacer"></span>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="sp-x-cancel">Cancel</button>' +
            '<button type="button" class="sp-btn sp-btn-sm sp-btn-primary" id="sp-x-save">' + (editing ? 'Save changes' : 'Add shop') + '</button></div>';
        var g = function (k) { return $('#sp-x-' + k, body); };
        var marker = null, circle = null;

        function draw() {
            if (!map) return;
            var lat = parseFloat(g('lat').value), lng = parseFloat(g('lng').value), r = parseFloat(g('rad').value);
            if (!validCoord(lat, lng)) return;
            if (!marker) { marker = global.L.marker([lat, lng]).addTo(map); circle = global.L.circle([lat, lng], { radius: r > 0 ? r : 50 }).addTo(map); }
            marker.setLatLng([lat, lng]); circle.setLatLng([lat, lng]); circle.setRadius(r > 0 ? r : 50);
            map.setView([lat, lng], map.getZoom() < 16 ? 17 : map.getZoom());
        }
        function setPoint(lat, lng) { g('lat').value = lat.toFixed(6); g('lng').value = lng.toFixed(6); draw(); }

        if (global.L && global.L.map) {
            var lat0 = parseFloat(g('lat').value), lng0 = parseFloat(g('lng').value);
            map = global.L.map(g('map')).setView(validCoord(lat0, lng0) ? [lat0, lng0] : [20.5937, 78.9629], validCoord(lat0, lng0) ? 17 : 5);
            global.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
            map.on('click', function (e) { setPoint(e.latlng.lat, e.latlng.lng); });
            setTimeout(function () { if (map) { map.invalidateSize(); draw(); } }, 200);
        } else {
            g('map').outerHTML = '<div class="sp-muted">Map preview unavailable (Leaflet did not load). Type the coordinates instead.</div>';
        }
        g('lat').addEventListener('change', function () {
            var m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(g('lat').value);
            if (m) { g('lat').value = m[1]; g('lng').value = m[2]; }
        });
        ['lat', 'lng', 'rad'].forEach(function (k) { g(k).addEventListener('change', draw); });

        g('here').addEventListener('click', async function () {
            var btn = g('here'); btn.disabled = true; btn.textContent = 'Locating…';
            var box = $('#sp-x-err', body);
            try {
                var p = await API.getPosition();
                setPoint(p.latitude, p.longitude);
                var acc = Math.round(p.accuracy);
                box.innerHTML = p.accuracy > 50
                    ? '<div class="sp-msg sp-msg-info">📡 This device gave only an approximate location (±' + acc + ' m). Stand at the shop with a phone for an exact pin, ' +
                      'or click the shop on the map / paste its coordinates from Google Maps.</div>'
                    : '<div class="sp-msg sp-msg-ok">📍 Location set (±' + acc + ' m). Check that the pin is on the shop.</div>';
            } catch (e) { box.innerHTML = errBox(e); }
            btn.disabled = false; btn.textContent = '📍 Use my current location';
        });
        g('cancel').addEventListener('click', U.closeModal);
        g('save').addEventListener('click', async function () {
            var err = $('#sp-x-err', body);
            var lat = parseFloat(g('lat').value), lng = parseFloat(g('lng').value), rad = parseInt(g('rad').value, 10);
            if (!g('name').value.trim()) { err.innerHTML = '<div class="sp-msg sp-msg-err">Enter the shop name.</div>'; return; }
            if (!validCoord(lat, lng)) { err.innerHTML = '<div class="sp-msg sp-msg-err">Enter a valid latitude and longitude, or click the map.</div>'; return; }
            if (!(rad >= 10 && rad <= 500)) { err.innerHTML = '<div class="sp-msg sp-msg-err">The allowed distance must be between 10 and 500 metres.</div>'; return; }
            var off = g('off').value;
            var payload = {
                code: nz(g('code').value), name: g('name').value.trim(), locality: nz(g('loc').value), region: nz(g('reg').value),
                address: nz(g('addr').value), phone: nz(g('ph').value), latitude: lat, longitude: lng, allowedRadiusMeters: rad,
                assignedOfficerId: off === '' ? null : parseInt(off, 10), status: x ? x.status : 'ACTIVE'
            };
            try {
                if (editing) await API.updateShop(x.id, payload); else await API.createShop(payload);
                U.closeModal(); done();
            } catch (e) { err.innerHTML = errBox(e); }
        });
    }

    // ======================================================================
    // Audit log
    // ======================================================================
    var AUDIT_ACTIONS = ['LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'CHECK_IN', 'CHECK_OUT', 'ATTENDANCE_CORRECTION', 'USER_CREATE',
        'USER_UPDATE', 'USER_STATUS_CHANGE', 'USER_DELETE', 'PASSWORD_RESET', 'PASSWORD_CHANGE', 'WORK_LOCATION_CREATE',
        'WORK_LOCATION_UPDATE', 'WORK_LOCATION_STATUS_CHANGE', 'SHOP_CREATE', 'SHOP_UPDATE', 'SHOP_STATUS_CHANGE', 'SHOP_DELETE'];

    function renderAudit(host) {
        var f = { userId: '', action: '', from: '', to: '', page: 0 }, users = [];
        host.innerHTML = '<div class="sp-muted">Loading…</div>';

        function shell() {
            host.innerHTML =
                '<div class="sp-filters">' +
                '<label class="sp-field">User<select id="sp-a-user"><option value="">All</option>' +
                users.map(function (u) { return opt(u.id, u.name + ' (' + u.username + ')', String(u.id) === String(f.userId)); }).join('') + '</select></label>' +
                '<label class="sp-field">Action<select id="sp-a-action"><option value="">All</option>' +
                AUDIT_ACTIONS.map(function (a) { return opt(a, a.replace(/_/g, ' '), f.action === a); }).join('') + '</select></label>' +
                '<label class="sp-field">From<input type="date" id="sp-a-from" value="' + esc(f.from) + '"></label>' +
                '<label class="sp-field">To<input type="date" id="sp-a-to" value="' + esc(f.to) + '"></label>' +
                '<button type="button" class="sp-btn sp-btn-sm sp-btn-primary" id="sp-a-apply">Apply</button></div>' +
                '<div id="sp-a-out"><div class="sp-muted">Loading…</div></div>';
            $('#sp-a-apply', host).addEventListener('click', function () {
                f.userId = $('#sp-a-user', host).value; f.action = $('#sp-a-action', host).value;
                f.from = $('#sp-a-from', host).value; f.to = $('#sp-a-to', host).value; f.page = 0; load();
            });
            load();
        }

        async function load() {
            var out = $('#sp-a-out', host);
            out.innerHTML = '<div class="sp-muted">Loading…</div>';
            try {
                var p = await API.auditLogs({ userId: f.userId, action: f.action, from: f.from, to: f.to, page: f.page, size: 25 });
                out.innerHTML = (p.content.length
                    ? '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>When (IST)</th><th>User</th><th>Action</th><th>Details</th><th>IP</th></tr></thead><tbody>' +
                    p.content.map(function (l) {
                        return '<tr><td style="white-space:nowrap">' + esc(U.fmtDate(l.timestamp)) + '<br><small>' + esc(U.fmtTime(l.timestamp)) + '</small></td>' +
                            '<td>' + esc(l.userName || (l.userId ? '#' + l.userId : '—')) + '</td><td><span class="sp-badge sp-b-none">' + esc(l.action.replace(/_/g, ' ')) + '</span></td>' +
                            '<td style="max-width:520px">' + esc(l.description || '') + '</td><td>' + esc(l.ipAddress || '—') + '</td></tr>';
                    }).join('') + '</tbody></table></div>'
                    : '<div class="sp-muted">No audit entries for this selection.</div>') +
                    '<div class="sp-toolbar" style="margin-top:12px"><button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="sp-a-prev"' + (p.page <= 0 ? ' disabled' : '') + '>← Newer</button>' +
                    '<span class="sp-muted">Page ' + (p.page + 1) + ' of ' + Math.max(1, p.totalPages) + ' · ' + p.totalElements + ' entries</span>' +
                    '<button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" id="sp-a-next"' + (p.page + 1 >= p.totalPages ? ' disabled' : '') + '>Older →</button></div>';
                var prev = $('#sp-a-prev', out), next = $('#sp-a-next', out);
                prev.addEventListener('click', function () { f.page = Math.max(0, f.page - 1); load(); });
                next.addEventListener('click', function () { f.page += 1; load(); });
            } catch (e) { out.innerHTML = errBox(e); }
        }

        API.users().then(function (u) { users = u; shell(); }, function () { shell(); });
    }

    // ======================================================================
    // Settings
    // ======================================================================
    function renderSettings(host) {
        host.innerHTML = '<div class="sp-muted">Loading…</div>';
        var me = API.user();
        API.settings().then(function (s) {
            var rows = [['Time zone', s.timezone], ['Shift starts', s.shiftStart], ['Late after (grace)', s.lateGraceMinutes + ' minutes'],
                ['Half day if under', U.minutesText(s.halfDayMinutes)], ['Worst GPS accuracy accepted', '±' + s.maxAccuracyMeters + ' m'],
                ['Weekly off', s.weeklyOff]];
            host.innerHTML =
                '<h4 style="margin:0 0 8px;font-family:\'Space Grotesk\',sans-serif;">Attendance policy</h4>' +
                '<div class="sp-table-wrap" style="max-width:520px"><table class="sp-table"><tbody>' +
                rows.map(function (r) { return '<tr><td><b>' + esc(r[0]) + '</b></td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
                '<p class="sp-muted">Read-only here. Change it under <code>app.attendance</code> in <code>application.properties</code> and restart the backend.</p>' +
                '<h4 style="margin:22px 0 8px;font-family:\'Space Grotesk\',sans-serif;">My account</h4>' +
                '<p class="sp-muted">Signed in as <b>' + esc(me.name) + '</b> (' + esc(me.username) + ') · ' + esc(U.roleLabel(me.role)) + '</p>' +
                '<div class="sp-form-grid" style="max-width:640px">' +
                '<label class="sp-field">Current password<input type="password" id="sp-set-old" autocomplete="current-password"></label>' +
                '<label class="sp-field">New password (8–72)<input type="password" id="sp-set-new" autocomplete="new-password"></label>' +
                '<label class="sp-field">Confirm new password<input type="password" id="sp-set-conf" autocomplete="new-password"></label></div>' +
                '<div class="sp-toolbar" style="margin-top:12px"><button type="button" class="sp-btn sp-btn-sm sp-btn-primary" id="sp-set-save">Change my password</button></div>';
            $('#sp-set-save', host).addEventListener('click', function () {
                global.SPBridge.changePassword('sp-set-old', 'sp-set-new', 'sp-set-conf');
            });
        }, function (e) { host.innerHTML = errBox(e); });
    }

    // ======================================================================
    // Admin dashboard "today at a glance" (real numbers)
    // ======================================================================
    function ensureGlance() {
        var glance = doc.getElementById('sp-admin-glance');
        if (glance) return glance;
        var first = $('#supervisor-dashboard-view .sup-sec[data-sec="dashboards"]');
        if (!first) return null;
        glance = doc.createElement('div');
        glance.id = 'sp-admin-glance';
        glance.className = 'dashboard-section sup-sec';
        glance.setAttribute('data-sec', 'dashboards');
        first.insertAdjacentElement('beforebegin', glance);
        return glance;
    }

    async function renderGlance() {
        var el = ensureGlance();
        if (!el) return;
        el.innerHTML = '<div class="sp-muted">Loading today\'s attendance…</div>';
        var t = U.todayIso();
        try {
            var res = await Promise.all([API.users(), API.adminAttendance({ from: t, to: t }), API.workLocations(true),
                API.adminShops({ includeInactive: 'true' })]);
            var staff = res[0].filter(function (u) { return u.role !== 'ADMIN' && u.status === 'ACTIVE'; });
            var rows = res[1];
            var checkedOut = rows.filter(function (r) { return r.checkOutTime; }).length;
            var late = rows.filter(function (r) { return r.status === 'LATE'; }).length;
            var half = rows.filter(function (r) { return r.status === 'HALF_DAY'; }).length;
            var sites = res[2].filter(function (w) { return w.status === 'ACTIVE'; }).length;
            var shopsActive = res[3].filter(function (w) { return w.status === 'ACTIVE'; }).length;
            var cards = [['Active staff', staff.length], ['Checked in today', rows.length], ['Checked out', checkedOut],
                ['Late', late], ['Half day', half], ['Not checked in yet', Math.max(0, staff.length - rows.length)], ['Active locations', sites], ['Active shops', shopsActive]];
            el.innerHTML = '<div class="section-header"><h3 class="section-title">📍 Today at a glance</h3>' +
                '<span style="font-size:12px;color:var(--ink-dim);">' + esc(U.fmtDate(t)) + ' · live from the server</span></div>' +
                '<div class="sp-kpis">' + cards.map(function (c) {
                    return '<div class="sp-kpi"><b>' + c[1] + '</b><span>' + esc(c[0]) + '</span></div>';
                }).join('') + '</div>' +
                (sites === 0 ? '<div class="sp-msg sp-msg-info">No active work location yet — add one under Work Locations so staff can check in.</div>' : '') +
                (shopsActive === 0 ? '<div class="sp-msg sp-msg-info">No active shop yet — add shops under Shops and assign them so Sales Officers can mark attendance.</div>' : '') +
                '<div class="sp-toolbar"><button type="button" class="sp-btn sp-btn-sm sp-btn-ghost" onclick="supShowSection(\'attendance\')">Open attendance report</button></div>';
        } catch (e) { el.innerHTML = errBox(e); }
    }

    // ======================================================================
    // Public surface
    // ======================================================================
    global.SPReport = { mount: mountReport };
    global.SPAdmin = {
        onSignedIn: function (user) { if (user.role === 'ADMIN') renderGlance(); },
        onSection: function (key) {
            var u = API.user();
            if (!u || u.role !== 'ADMIN') return;
            var host = doc.getElementById('sp-admin-' + key);
            if (!host) { if (key === 'dashboards') renderGlance(); return; }
            if (key === 'attendance') mountReport(host, { mode: 'admin' });
            else if (key === 'staff') renderStaff(host);
            else if (key === 'locations') renderLocations(host);
            else if (key === 'shops') renderShops(host);
            else if (key === 'audit') renderAudit(host);
            else if (key === 'settings') renderSettings(host);
        },
        reset: function () {
            ['attendance', 'staff', 'locations', 'shops', 'audit', 'settings'].forEach(function (k) {
                var h = doc.getElementById('sp-admin-' + k);
                if (h) h.innerHTML = '<div class="sp-muted">Loading…</div>';
            });
            var g = doc.getElementById('sp-admin-glance'); if (g) g.innerHTML = '';
        }
    };
})(window);
