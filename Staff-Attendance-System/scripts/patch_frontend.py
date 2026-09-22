#!/usr/bin/env python3
"""
Applies the (small, targeted) edits that connect the ORIGINAL single-file frontend
to the Spring Boot backend. Everything else in the original file is left untouched.

    python3 scripts/patch_frontend.py  <original.html>  <output.html>

Each edit asserts that its anchor text occurs exactly once, so the script fails
loudly instead of silently patching the wrong place if the source changes.
"""
import re
import sys

src_path, out_path = sys.argv[1], sys.argv[2]
html = open(src_path, encoding="utf-8").read()
applied = []


def replace_once(old, new, label):
    global html
    n = html.count(old)
    if n != 1:
        sys.exit(f"[patch] '{label}': expected exactly 1 match, found {n}")
    html = html.replace(old, new)
    applied.append(label)


def replace_between(start, end, new, label, keep_end=True):
    """Replace everything from `start` up to (not including) `end`."""
    global html
    if html.count(start) != 1 or html.count(end) != 1:
        sys.exit(f"[patch] '{label}': anchors not unique ({html.count(start)}/{html.count(end)})")
    i = html.index(start)
    j = html.index(end)
    if j < i:
        sys.exit(f"[patch] '{label}': end anchor precedes start anchor")
    html = html[:i] + new + (html[j:] if keep_end else html[j + len(end):])
    applied.append(label)


# ---------------------------------------------------------------------------
# 1. Login form: nothing is pre-filled, and the Full-Name box no longer takes
#    part in signing in (the backend returns the real name).
# ---------------------------------------------------------------------------
replace_once(
    '<input id="loginname" name="loginname" type="text" placeholder="Enter your full name" autocomplete="name" value="Rajesh Sharma">',
    '<input id="loginname" name="loginname" type="text" placeholder="Enter your full name" autocomplete="name" value="">',
    "login: clear prefilled name")
replace_once(
    '<input id="userid" name="userid" type="text" value="owner01">',
    '<input id="userid" name="userid" type="text" value="" autocomplete="username" autocapitalize="off" spellcheck="false">',
    "login: clear prefilled user id")
replace_once(
    '<input id="password" name="password" type="password" value="password123">',
    '<input id="password" name="password" type="password" value="" autocomplete="current-password">',
    "login: clear prefilled password")
replace_once(
    '<div class="rung-name">Admin</div><div class="rung-desc">Team &amp; route oversight</div>',
    '<div class="rung-name">Admin</div><div class="rung-desc">Full system access</div>',
    "login: Admin rung description")

# ---------------------------------------------------------------------------
# 2. Hard-coded demo credentials removed from the role table. This table used to
#    BE the authentication (typed values were compared against it in the browser).
# ---------------------------------------------------------------------------
replace_between(
    "    const roles = {\n        owner:",
    "    const rungs = document.querySelectorAll('.rung');",
    """    // Titles/blurbs for the login tabs only. Credentials are NOT stored here any more:
    // sign-in is verified by the backend (Spring Security + BCrypt + JWT) and the
    // role/name come back from the database. `name` is just a display fallback that
    // is overwritten with the real name right after a successful login.
    const roles = {
        owner: { title: 'Owner', deck: 'Full visibility across every region and team.', userid: '', password: '', name: 'Owner' },
        rsm:   { title: 'Marketing Manager', deck: 'Manage regions, ASMs, Sales Officers and targets nationally.', userid: '', password: '', name: 'Marketing Manager' },
        rm:    { title: 'Regional Manager', deck: 'Manage ASMs, Sales Officers and targets for your region.', userid: '', password: '', name: 'Regional Manager' },
        asm:   { title: 'Area Sales Manager', deck: 'Track your area\\'s beats, officers and daily sales.', userid: '', password: '', name: 'Area Sales Manager' },
        so:    { title: 'Sales Officer', deck: 'Log visits, orders and collections for your beat.', userid: '', password: '', name: 'Sales Officer' },
        // ADMIN is the full-access account. Internal key stays 'sup' because every
        // dashboard id / CSS class in this file is still named sup-*; the backend
        // role behind it is ADMIN (see SPBridge.roleKey in backend-bridge.js).
        sup:   { title: 'Admin', deck: 'Admin access — enter your admin username and password to continue.', userid: '', password: '', name: 'Admin', admin: true }
    };

""",
    "roles table without credentials")

# ---------------------------------------------------------------------------
# 3. selectRole(): switching tabs no longer pre-fills demo credentials.
# ---------------------------------------------------------------------------
replace_between(
    "        standardFields.style.display = 'block';\n        const r = roles[currentRole];",
    "    rungs.forEach(r => {\n        r.addEventListener('click', () => selectRole(r.dataset.role));",
    """        standardFields.style.display = 'block';
        // Login is username + password only. The backend finds the person and returns
        // their real role and name, so the Full-Name box and the Sales Officer name
        // picker no longer take part in signing in.
        nameTextField.style.display = 'none';
        nameSelectField.style.display = 'none';
        loginNameInput.value = '';
        useridInput.value = '';
        passwordInput.value = '';
        useridInput.placeholder = roles[currentRole].admin ? 'Admin username' : 'Your username';
        if (adminHint) { adminHint.innerHTML = ''; adminHint.style.display = 'none'; }
    }

""",
    "selectRole without demo prefill")

# ---------------------------------------------------------------------------
# 4. doLogin(): real authentication through the backend.
# ---------------------------------------------------------------------------
replace_between(
    "    function doLogin(e) {\n        if (e) e.preventDefault();\n        let pendingOfficer = null;",
    "    form.addEventListener('submit', doLogin);",
    r"""    // ---- Real sign-in ----------------------------------------------------------
    // POST /api/auth/login  ->  Spring Security checks the BCrypt hash in MySQL and
    // returns a JWT plus the user's REAL role. Which tab happened to be highlighted
    // is irrelevant: the role comes from the database, never from the browser.
    let loginInFlight = false;
    async function doLogin(e) {
        if (e) e.preventDefault();
        if (loginInFlight) return;

        const typedUser = (useridInput.value || '').trim();
        const typedPass = passwordInput.value || '';
        status.style.color = '#C0392B';
        if (!typedUser || !typedPass) {
            status.textContent = 'Enter your username and password.';
            (!typedUser ? useridInput : passwordInput).focus();
            return;
        }
        if (typeof SPApi === 'undefined' || typeof SPBridge === 'undefined') {
            status.textContent = 'The connection scripts (api.js / backend-bridge.js) did not load. Open the portal from the backend address and reload.';
            return;
        }

        loginInFlight = true;
        const idleLabel = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in…';
        status.style.color = '';
        status.textContent = '';

        let session;
        try {
            session = await SPApi.login(typedUser, typedPass);
        } catch (err) {
            status.style.color = '#C0392B';
            status.textContent = '❌ ' + SPApi.friendlyError(err);
            if (err.status === 401 || err.status === 400) { passwordInput.value = ''; passwordInput.focus(); }
            return;
        } finally {
            loginInFlight = false;
            submitBtn.disabled = false;
            submitBtn.textContent = idleLabel;
        }

        const user = session.user;
        const roleKey = SPBridge.roleKey(user.role);
        if (!roleKey) {
            await SPApi.logout();
            status.style.color = '#C0392B';
            status.textContent = '❌ This account has a role the portal does not support.';
            return;
        }

        // The backend's answer wins over whichever tab was highlighted.
        selectRole(roleKey);
        roles[roleKey].name = user.name;
        loginNameInput.value = user.name;
        const local = SPBridge.localRecordsFor(user);   // sales-demo records the dashboards expect
        const pendingOfficer = local.officer;
        if (local.rmPerson) roles.rm.name = local.rmPerson.name; // downstream RM screens read it from here
        if (local.asmPerson) asmStampLogin(local.asmPerson);
        status.style.color = '';

        loginView.classList.remove('active');
        supervisorMode = false;
        resetBackButtonLabels();
        switchOwnerTab('overview');
        requestAnimationFrame(() => positionNavGliders(false));
        // applyLoggedInName() first: syncAllowedOfficerLists() needs to know WHICH ASM
        // signed in before it can narrow the officer lists to that ASM's own city.
        applyLoggedInName();
        syncAllowedOfficerLists();

        if (currentRole === 'so') {
            currentOfficer = pendingOfficer;
            renderDirectorySalesOfficers();
            soStampLogin(currentOfficer);
            document.getElementById('so-logged-name').textContent = currentOfficer.name;
            soDashboardView.classList.add('active');
            scheduleAutoSync();
            const changeCityPill = document.getElementById('so-change-city');
            if (changeCityPill) {
                changeCityPill.style.display = officerCityLocked() ? 'none' : '';
            }
            if (needsWorkAreaSelection()) {
                showWorkAreaSelector();
            } else {
                assignDailyVisitPlanFromArea(currentOfficer);
                renderSOKPIs();
                renderSOTasks();
            }
        } else if (currentRole === 'rsm') {
            renderRSMDashboard();
            rsmDashboardView.classList.add('active');
        } else if (currentRole === 'rm') {
            renderRMDashboard();
            rmDashboardView.classList.add('active');
        } else if (currentRole === 'asm') {
            renderASMDashboard();
            asmDashboardView.classList.add('active');
        } else if (currentRole === 'sup') {
            supervisorMode = true;
            supervisorDashboardView.classList.add('active');
            renderSupervisorInsights();
            supShowSection('dashboards');
        } else {
            document.getElementById('logged-in-role').textContent = roles[currentRole].title;
            dashboardView.classList.add('active');
        }
        applyLoggedInName();
        applyUploadedPhotoEverywhere();
        SPBridge.onSignedIn(user);
    }
""",
    "doLogin -> backend")

# ---------------------------------------------------------------------------
# 5. Legacy demo passwords: no longer used for sign-in, so they must not sit in
#    the page source or show up in the credential cards either.
# ---------------------------------------------------------------------------
replace_once("            password: 'Sales@123',\n            sales, collection,",
             "            password: '',   // sign-in is verified by the backend; no password lives in the browser\n            sales, collection,",
             "makeSOOfficer: no demo password")
replace_once("        if (!o.password) o.password = 'Sales@123';\n", "", "officer backfill: no demo password")
replace_once("{ name: 'Suresh Babu', userId: 'regional01', password: 'password123', assignedASMs: [] }",
             "{ name: 'Suresh Babu', userId: 'regional01', password: '', assignedASMs: [] }", "rmStaff seed")
replace_once("{ name: 'Karthik Raja', userId: 'areasales01', password: 'Asm@123', area: 'Madurai' },",
             "{ name: 'Karthik Raja', userId: 'areasales01', password: '', area: 'Madurai' },", "asmStaff seed 1")
replace_once("{ name: 'Arul Prakash', userId: 'areasales02', password: 'Asm@123', area: 'Chennai' }",
             "{ name: 'Arul Prakash', userId: 'areasales02', password: '', area: 'Chennai' }", "asmStaff seed 2")
replace_once("rmStaff.push({ name, userId: 'regional' + seq, password: 'Regional@123', assignedASMs: [] });",
             "rmStaff.push({ name, userId: 'regional' + seq, password: '', assignedASMs: [] });", "new RM: no demo password")
replace_once("asmStaff.push({ name, userId: 'areasales' + seq, password: 'Asm@123', area: '' });",
             "asmStaff.push({ name, userId: 'areasales' + seq, password: '', area: '' });", "new ASM: no demo password")
replace_once("const grid = '<div class=\"officer-cred-grid\">' + fields.map(f => {",
             "const grid = '<div class=\"officer-cred-grid\">' + fields.filter(f => f.key !== 'password').map(f => {",
             "credGrid hides local password rows")

# ---------------------------------------------------------------------------
# 6. Change-password screens used to just alert() success. Wire to the backend.
# ---------------------------------------------------------------------------
# SO and ASM screens use the identical button text, so patch them in document order.
_SAVE = """<button class="btn-primary" onclick="alert('Password updated successfully!')">💾 Save</button>"""
if html.count(_SAVE) != 2:
    sys.exit(f"[patch] expected 2 identical SO/ASM change-password buttons, found {html.count(_SAVE)}")
for prefix in ("so", "asm"):
    html = html.replace(
        _SAVE,
        f"""<button class="btn-primary" onclick="SPBridge.changePassword('{prefix}-pw-old','{prefix}-pw-new','{prefix}-pw-confirm')">💾 Save</button>""",
        1)
    applied.append(f"{prefix}: change password -> backend")
replace_once(
    """<button class="btn-primary" onclick="alert('Password updated successfully!')">\\ud83d\\udcbe Save</button>""",
    """<button class="btn-primary" onclick="SPBridge.changePassword('rm-pw-old','rm-pw-new','rm-pw-confirm')">\\ud83d\\udcbe Save</button>""",
    "rm: change password -> backend")
replace_once(
    "        alert('Password updated successfully!');\n        renderMMProfile();\n    }",
    "        SPBridge.changePassword('pw-old', 'pw-new', 'pw-confirm', renderMMProfile);\n    }",
    "mm: change password -> backend")

# ---------------------------------------------------------------------------
# 7. Admin console: full-access wording + new backend-driven sections.
# ---------------------------------------------------------------------------
replace_once('<div class="so-profile-role">View-only across all roles</div>',
             '<div class="so-profile-role">Full system access</div>', "admin sidebar wording")
replace_once("Full visibility · view only", "Full access · manage &amp; view", "admin chip wording")
replace_once(
    "Pick a dashboard below to inspect it as that role, or review the rollups and access controls on this page.",
    "Pick a dashboard below to inspect it as that role, or manage staff, GPS attendance, work locations and audit logs from the menu.",
    "admin lede wording")

# legacy 'Access Control' nav item is replaced by real Staff Accounts (backend)
access_nav = re.search(
    r'\n            <a class="so-nav-item sup-nav-item" data-sec="access" onclick="supShowSection\(\'access\'\)">.*?</a>',
    html, re.S)
if not access_nav:
    sys.exit("[patch] legacy access nav item not found")
NAV_ICON = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
            'stroke-linecap="round" stroke-linejoin="round">%s</svg>')
new_nav = ""
for key, label, path in (
    ("attendance", "Attendance", '<rect x="3.8" y="5.4" width="16.4" height="15" rx="2.4"/><path d="M3.8 10.2h16.4M8.4 3.4v3.6M15.6 3.4v3.6"/><path d="m9 15 2 2 4-4"/>'),
    ("staff", "Staff Accounts", '<circle cx="9.2" cy="8.4" r="3.3"/><path d="M3.3 19.6c0-3.2 2.6-5.3 5.9-5.3s5.9 2.1 5.9 5.3"/><path d="M16 5.2a3.1 3.1 0 0 1 0 6M17.6 14.6c2 .6 3.2 2.3 3.2 5"/>'),
    ("locations", "Work Locations", '<path d="M12 21s-6.6-5.6-6.6-11a6.6 6.6 0 0 1 13.2 0c0 5.4-6.6 11-6.6 11z"/><circle cx="12" cy="10" r="2.4"/>'),
    ("shops", "Shops", '<path d="M4 9.5 5.6 4.6h12.8L20 9.5"/><path d="M4.6 9.5h14.8v10.4H4.6z"/><path d="M9.6 19.9v-5.4h4.8v5.4"/><path d="M4 9.5a2.6 2.6 0 0 0 5.2 0 2.6 2.6 0 0 0 5.2 0 2.6 2.6 0 0 0 5.2 0"/>'),
    ("audit", "Audit Log", '<path d="M7 3.6h8.2L19 7.4V20.4H7z"/><path d="M15 3.6v4h4M9.6 12h6.4M9.6 15.4h6.4"/>'),
    ("settings", "Settings", '<circle cx="12" cy="12" r="3"/><path d="M12 3.6v2.2M12 18.2v2.2M3.6 12h2.2M18.2 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>'),
):
    new_nav += (f'\n            <a class="so-nav-item sup-nav-item" data-sec="{key}" onclick="supShowSection(\'{key}\')">\n'
                f'                {NAV_ICON % path}\n                <span>{label}</span>\n            </a>')
html = html.replace(access_nav.group(0), new_nav, 1)
applied.append("admin nav: attendance/staff/locations/shops/audit/settings")

# new (initially hidden) sections; the legacy Access section stays in the DOM, hidden,
# because older render functions still write into its lists.
sections = ""
for key, title, sub in (
    ("attendance", "📍 GPS Attendance", "Every employee's real check-in / check-out, verified by the server"),
    ("staff", "👥 Staff Accounts", "Create staff, set roles &amp; reporting lines, activate / deactivate, reset passwords"),
    ("locations", "🏢 Work Locations", "Geofences the server checks every check-in and check-out against"),
    ("shops", "🏬 Shops", "Shops Sales Officers mark attendance at: location, allowed distance and who each shop is assigned to"),
    ("audit", "🧾 Audit Log", "Logins, attendance, corrections and account changes"),
    ("settings", "⚙️ Settings", "Attendance policy the server applies"),
):
    sections += f'''
            <div class="dashboard-section sup-sec" data-sec="{key}" style="display:none;">
                <div class="section-header">
                    <h3 class="section-title">{title}</h3>
                    <span style="font-size: 12px; color: var(--ink-dim);">{sub}</span>
                </div>
                <div id="sp-admin-{key}" class="sp-admin-body"><div class="sp-muted">Loading…</div></div>
            </div>
'''
anchor = '            <div class="dashboard-section sup-sec" data-sec="access">'
replace_once(anchor,
             sections + '\n            <div class="dashboard-section sup-sec" data-sec="access" style="display:none !important;" aria-hidden="true">',
             "admin sections + hide legacy access")

replace_once("        access:      '',\n        messages:",
             "        access:      '',\n        attendance:  '',\n        staff:       '',\n        locations:   '',\n        shops:       '',\n        audit:       '',\n        settings:    '',\n        messages:",
             "section ledes")
replace_once("        if (key === 'messages') { renderSupervisorMessages(); return; }",
             "        if (window.SPAdmin && typeof SPAdmin.onSection === 'function') SPAdmin.onSection(key);\n        if (key === 'messages') { renderSupervisorMessages(); return; }",
             "supShowSection hook")
replace_once("                    { find: 'access',      label: 'Access',      icon: I.lock },",
             "                    { find: 'attendance',  label: 'Attendance',  icon: I.calendar },\n                    { find: 'staff accounts', label: 'Staff',   icon: I.people },",
             "admin mobile tabs")

# The sidebar "My Attendance" used to open the old shop-verification flow (demo shops with made-up coordinates,
# must be within 20 m of a demo shop). It now goes to the real GPS attendance card; the old flow stays reachable
# only from the explicit "Shop visit" button on that card.
replace_once('<a class="so-nav-item" onclick="event.stopPropagation(); openSOAttendanceFlow();"',
             '<a class="so-nav-item" onclick="event.stopPropagation(); SPBridge.showMyAttendance();"',
             "sidebar My Attendance -> real GPS card")


# ---------------------------------------------------------------------------
# 8. Sales Officer attendance = the original shop-verification flow (Login -> Select Shop -> GPS ON -> Check Distance ->
#    Live Camera -> Attendance), now backed by the server: the shops are the ones the Admin assigned (backend), the server
#    repeats the distance check and stores the live photo, and an officer can no longer move a shop's saved location.
#    Nothing changes for the demo shops (SPBridge.serverShops() is null when not signed in to the backend).
# ---------------------------------------------------------------------------
replace_once(
    "    const ATT_RANGE_METERS = 20;\n\n    // ---- Shared Live Camera helper",
    """    const ATT_RANGE_METERS = 20;
    // The distance the officer must be within. A shop that comes from the backend carries its own radius (set by the
    // Admin); the original demo shops keep the fixed 20 m.
    function attRangeFor(shop) { return (shop && shop.radius) ? shop.radius : ATT_RANGE_METERS; }

    // ---- Shared Live Camera helper""",
    "shop attendance: per-shop range helper")

replace_once(
    "const rangeRadiusPx = Math.max(14, Math.min(70, (ATT_RANGE_METERS / 111000 / maxSpan)",
    "const rangeRadiusPx = Math.max(14, Math.min(70, (attRangeFor(typeof soAttendanceState !== 'undefined' && soAttendanceState ? soAttendanceState.shop : null) / 111000 / maxSpan)",
    "shop attendance: map circle uses the shop's radius")

replace_once(
    "            address: `${shop.locality || ''}, ${areaName || 'Madurai'} - 625001`,",
    "            address: shop._server ? (shop.address || shop.locality || shop.name || '') : `${shop.locality || ''}, ${areaName || 'Madurai'} - 625001`,",
    "shop attendance: photo stamp carries the real shop address")

# the remote static-map image (staticmap.openstreetmap.de) is unreliable and only produced console errors; the built-in
# SVG map that is drawn first stays as the map
replace_between(
    "        const mapUrl = `https://staticmap.openstreetmap.de/staticmap.php",
    "    }\n\n    function haversineMeters(",
    "        // (A remote static-map image used to be requested here. That service is unreliable and only produced network errors,\n"
    "        // so the self-contained SVG map drawn above is the map.)\n",
    "shop attendance: drop the remote static map request")

replace_once(
    "        const info = getOfficerAreaInfo(currentOfficer.name);\n"
    "        const myShops = getMyShopsForOfficer(info);\n"
    "        const shop = applyShopLocationOverride((preselectShopId && myShops.find(s => s.id === preselectShopId)) || myShops[0]);\n"
    "        if (!shop) return; // nothing assigned yet — nothing to mark attendance against\n",
    """        const info = getOfficerAreaInfo(currentOfficer.name);
        // Signed in to the backend: the shops are the ones the Admin assigned to this officer, and only the Admin can move
        // them. Otherwise (no backend) the original demo shops are used.
        const serverShops = (window.SPBridge && SPBridge.serverShops) ? SPBridge.serverShops() : null;
        const myShops = serverShops || getMyShopsForOfficer(info);
        const picked = (preselectShopId && myShops.find(s => s.id === preselectShopId)) || myShops[0];
        const shop = (picked && picked._server) ? picked : applyShopLocationOverride(picked);
        if (!shop) return; // nothing assigned yet — nothing to mark attendance against
""",
    "shop attendance: shops come from the backend")

replace_once(
    "            deviceLat: null, deviceLng: null, distance: null, withinRange: false, gpsAttempted: false,\n            photo: null, orderStatus: 'Pending',\n            loginTime: now",
    "            deviceLat: null, deviceLng: null, distance: null, withinRange: false, gpsAttempted: false,\n            deviceAcc: null, accuracyOk: true, submitting: false,\n            photo: null, orderStatus: 'Pending',\n            loginTime: now",
    "shop attendance: extra popup state")

replace_once(
    "        const mobile = s.shop.mobile || '';\n",
    "        const mobile = s.shop.mobile || s.shop.phone || '';\n",
    "shop attendance: shop phone from the backend")

replace_once(
    r"""            <div><b>Shop Address:</b> ${escHtml(s.shop.locality || info.area)}, ${escHtml(info.area)} - 625${String(Math.abs((s.shop.id || '').charCodeAt(4) || 1) % 900 + 100).padStart(3, '0')}</div>""",
    r"""            <div><b>Shop Address:</b> ${s.shop._server ? escHtml(s.shop.address || s.shop.locality || '\u2014') : `${escHtml(s.shop.locality || info.area)}, ${escHtml(info.area)} - 625${String(Math.abs((s.shop.id || '').charCodeAt(4) || 1) % 900 + 100).padStart(3, '0')}`}</div>""",
    "shop attendance: real shop address")

replace_once(
    "                ${mobile\n                    ? `<b>📞 Phone:</b>",
    "                ${s.shop._server\n                    ? (mobile ? `<b>📞 Phone:</b> <a href=\"tel:${escAttr(mobile)}\" style=\"color:var(--green); font-weight:700; text-decoration:none;\">${escHtml(mobile)}</a>` : `<span style=\"color:var(--ink-dim);\">📞 No phone number on file</span>`)\n                    : mobile\n                    ? `<b>📞 Phone:</b>",
    "shop attendance: phone is read-only for backend shops")

replace_once(
    r"""        if (!s || !s.shop) return '\u2014';
        let area = '';""",
    r"""        if (!s || !s.shop) return '\u2014';
        if (s.shop._server) return [s.shop.locality, s.shop.region].filter(Boolean).join(', ') || '\u2014';
        let area = '';""",
    "shop attendance: shop area text")

# the live position -> distance card, rewritten to carry the GPS accuracy and the shop's own radius
replace_between(
    "    // Simulates fetching the officer's live GPS near the shop's known coordinates",
    "    window.correctShopLocationToCurrentGPS = function () {",
    r"""    // Reads the officer's live GPS position and compares it with the shop's location. For shops from the backend this is only
    // a preview: the server repeats the distance/accuracy check and is the one that decides.
    function applySOAttLocation(deviceLat, deviceLng, deviceAcc) {
        const s = soAttendanceState;
        const range = attRangeFor(s.shop);
        const server = !!(s.shop && s.shop._server);
        const maxAcc = (server && window.SPBridge && SPBridge.maxAccuracy) ? SPBridge.maxAccuracy() : null;
        s.gpsAttempted = true;
        s.deviceLat = deviceLat;
        s.deviceLng = deviceLng;
        s.deviceAcc = (deviceAcc == null || isNaN(deviceAcc)) ? null : deviceAcc;
        s.distance = haversineMeters(s.deviceLat, s.deviceLng, s.shop.lat, s.shop.lng);
        s.withinRange = s.distance <= range;
        s.accuracyOk = !(server && maxAcc != null && (s.deviceAcc == null || s.deviceAcc > maxAcc));

        document.getElementById('so-att-gps-body').innerHTML = `
            <div><b>Your Current Location</b></div>
            <div>Lat: ${s.deviceLat.toFixed(6)}</div>
            <div>Long: ${s.deviceLng.toFixed(6)} <span class="badge badge-done" style="margin-left:4px;">GPS ON</span></div>
            ${s.deviceAcc != null ? `<div style="font-size:11px; color:var(--ink-dim);">GPS accuracy ±${Math.round(s.deviceAcc)} m</div>` : ''}
            ${server ? '' : areaLineHTML(s.deviceLat, s.deviceLng)}
            <div style="margin-top:8px;"><b>Shop Location</b></div>
            <div>Lat: ${s.shop.lat.toFixed(6)}</div>
            <div>Long: ${s.shop.lng.toFixed(6)}</div>
            <div style="margin-top:2px;">Area: <b>${escHtml(attShopAreaText())}</b></div>
            <div style="margin-top:8px;"><b>Distance</b></div>
            <div style="font-family:'Space Grotesk', sans-serif; font-size:18px; font-weight:700; color:${s.withinRange ? 'var(--green)' : '#F0958D'};">${s.distance.toFixed(1)} meters</div>
            <div style="font-size:11px; color:var(--ink-dim);">(Within ${range} meters)</div>
            ${s.withinRange
            ? `<span class="badge badge-done" style="margin-top:4px; display:inline-block;">✅ You are within range</span>`
            : `<div style="margin-top:6px; padding:8px 10px; background:#FDEAEA; border:1px solid #F0958D; border-radius:8px;">
                     <span style="color:#C0392B; font-weight:700; font-size:13px;">❌ ABSENT — Too far from shop</span><br>
                     <span style="font-size:11px; color:#8a3a34;">Move within ${range}m of the shop, then retry.</span><br>
                     <button class="btn-outline" style="margin-top:6px; padding:5px 10px; font-size:11px;" onclick="simulateGPSVerification()">🔄 Retry GPS</button>
                     ${server ? `<div style="font-size:10.5px; color:#8a3a34; margin-top:4px;">A laptop or desktop has no GPS and often reports an approximate place. Use your phone. Only your Admin can change a shop's saved location.</div>`
                : `<button class="btn-outline" style="margin-top:6px; margin-left:6px; padding:5px 10px; font-size:11px; color:#04344C; border-color:#04344C;" onclick="correctShopLocationToCurrentGPS()">📍 I'm actually here — fix shop location</button>
                     <div style="font-size:10.5px; color:#8a3a34; margin-top:4px;">Only use this if you're really standing at the shop — this updates the shop's saved location for everyone.</div>`}
                   </div>`}
            ${s.withinRange && !s.accuracyOk
            ? `<div style="margin-top:6px; padding:8px 10px; background:#FDF3E6; border:1px solid #F0D3A8; border-radius:8px;">
                     <span style="color:#8A6220; font-weight:700; font-size:13px;">📡 GPS signal too weak${s.deviceAcc != null ? ' (±' + Math.round(s.deviceAcc) + ' m)' : ''}</span><br>
                     <span style="font-size:11px; color:#8A6220;">${maxAcc != null ? 'Need ±' + Math.round(maxAcc) + ' m or better. ' : ''}Move to an open area and retry.</span><br>
                     <button class="btn-outline" style="margin-top:6px; padding:5px 10px; font-size:11px;" onclick="simulateGPSVerification()">🔄 Retry GPS</button>
                   </div>` : ''}
        `;

        renderMapView('so-att-map-visual', s.deviceLat, s.deviceLng, s.shop.lat, s.shop.lng, s.withinRange);
        document.getElementById('so-att-map-legend').innerHTML = `
            <div>📍 <b>Your Location</b><br>${server ? '' : `<span style="color:var(--ink-dim);">${escHtml((nearestAreaName(s.deviceLat, s.deviceLng) || {}).text || '')}</span><br>`}<span style="color:var(--ink-dim);">Lat: ${s.deviceLat.toFixed(4)}, Long: ${s.deviceLng.toFixed(4)}</span></div>
            <div style="margin-top:4px;">🏬 <b>Shop Location</b><br><span style="color:var(--ink-dim);">${escHtml(attShopAreaText())}</span><br><span style="color:var(--ink-dim);">Lat: ${s.shop.lat.toFixed(4)}, Long: ${s.shop.lng.toFixed(4)}</span></div>
            <div style="margin-top:4px; color:var(--ink-dim);">⭕ ${range} Meter Range</div>
        `;

        renderSOAttTrack();
        updateSOAttNextButton();
    }

""",
    "shop attendance: distance card with accuracy + per-shop radius")

replace_once(
    "            (pos) => applySOAttLocation(pos.coords.latitude, pos.coords.longitude),",
    "            (pos) => applySOAttLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),",
    "shop attendance: pass GPS accuracy")

replace_once(
    """        const ready = s.withinRange && !!s.photo;
        btn.disabled = !ready;
        btn.style.opacity = ready ? '1' : '0.5';
        btn.textContent = (s.distance !== null && !s.withinRange) ? '❌ Too Far — Cannot Mark Present' : 'Next: Mark Present →';""",
    """        const ready = s.withinRange && !!s.photo && s.accuracyOk !== false && !s.submitting;
        btn.disabled = !ready;
        btn.style.opacity = ready ? '1' : '0.5';
        btn.textContent = s.submitting ? 'Saving attendance…'
            : (s.distance !== null && !s.withinRange) ? '❌ Too Far — Cannot Mark Present'
            : (s.withinRange && s.accuracyOk === false) ? '📡 GPS too weak — Cannot Mark Present'
            : 'Next: Mark Present →';""",
    "shop attendance: Next button honours accuracy + saving state")

replace_once(
    """    function soAttFinish() {
        const s = soAttendanceState;
        if (!s.withinRange || !s.photo) return;

        // first check-in of the day wins""",
    """    // For a backend shop the attendance is first saved on the server (which repeats the distance check and stores the
    // photo); only when that succeeds does the original local bookkeeping below run.
    function soAttFinish() {
        const s = soAttendanceState;
        if (!s.withinRange || !s.photo) return;
        if (s.shop && s.shop._server && window.SPBridge && SPBridge.submitShopAttendance) {
            SPBridge.submitShopAttendance(s, soAttFinishLocal);
            return;
        }
        soAttFinishLocal();
    }

    function soAttFinishLocal() {
        const s = soAttendanceState;
        if (!s.withinRange || !s.photo) return;

        // first check-in of the day wins""",
    "shop attendance: save on the server before the local bookkeeping")


# the page already ends with <script src="api.js"> and <script src="backend-bridge.js">;
# add the admin/report module after them
replace_once('<script src="backend-bridge.js"></script>',
             '<script src="backend-bridge.js"></script>\n<script src="admin-console.js"></script>',
             "load admin-console.js")

open(out_path, "w", encoding="utf-8").write(html)
print(f"[patch] {len(applied)} edits applied -> {out_path}")
for a in applied:
    print("   -", a)
