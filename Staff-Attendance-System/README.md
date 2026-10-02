# Staff Attendance System (Spring Boot + MySQL + GPS)

Same project layout as the `dms` project: one Maven module (`attendance/`) that contains the Spring Boot
backend **and** the frontend (`src/main/resources/static/`), so one run serves everything on one port.

```
Staff-Attendance-System/
├── attendance/                      <- open THIS folder in IntelliJ (it has pom.xml)
│   ├── pom.xml  mvnw  mvnw.cmd  .mvn/wrapper/         Maven + Maven Wrapper (no Maven install needed)
│   ├── Dockerfile  docker-compose.yml  .env.example
│   ├── .run/AttendanceApplication.run.xml             IntelliJ run configuration
│   └── src/main/
│       ├── java/com/spartan/attendance/{config,controller,dto,entity,exception,repository,security,service,util}
│       └── resources/
│           ├── application.properties                 settings (defaults for local MySQL)
│           ├── application-local.properties.example   copy -> application-local.properties, add MySQL password
│           ├── application-prod.properties            production (secrets only from environment)
│           └── static/  index.html  api.js  backend-bridge.js  admin-console.js   <- the frontend
└── scripts/   patch_frontend.py, original/, frontend-test/   (how index.html was made + a browser test)
```

## Status – read this first
* The Java backend was **written but never compiled or run by me** (Maven Central is unreachable from my sandbox).
  Versions now match your `dms` project (Spring Boot 3.5.3, jjwt 0.12.7, springdoc 2.8.9), and most external
  imports are identical to ones that already compile in `dms` – but expect that a first build may still show small errors.
* Verified: attendance rules + the shop check-in flow (JUnit integration tests, now including staff/shop deletion); the
  browser code against a **mock** of this API (109 jsdom checks) and against **real headless Chromium** (25 checks,
  including a real file upload for the live photo, real `page.setGeolocation()` overrides, and real native confirm()
  dialogs for delete). See "Rebuilding index.html from the original" below to run these.

## Run in IntelliJ (like dms)
1. *File > Open* → the **`attendance`** folder → *Load Maven Project*. JDK 21. Turn on
   *Settings > Build > Compiler > Annotation Processors > Enable annotation processing* (Lombok).
2. In `src/main/resources/` copy `application-local.properties.example` to `application-local.properties`
   and put your MySQL password in it (this file is git-ignored).
3. Run the **AttendanceApplication** configuration (top right; it sets profile `local`).
   Terminal alternative: `cd attendance && ./mvnw spring-boot:run -Dspring-boot.run.profiles=local` (Windows: `mvnw.cmd`).
4. Open **http://localhost:8080/** and sign in: **`Admin` / `Admin@123`**.
   Swagger: http://localhost:8080/swagger-ui.html. Tests: `./mvnw test`.
5. Admin → **Work Locations** → add your office (nobody can check in until one exists).

Demo staff (local only): `owner01`, `marketing01`, `regional01` = `password123`; `areasales01/02` = `Asm@123`; `sales01`–`sales03` = `Sales@123`.

## Run with Docker (like dms)
```
cd attendance
copy .env.example .env      # edit DB_PASSWORD and JWT_SECRET
docker compose up --build   # http://localhost:8082
```

## Settings
`application.properties` (defaults) – override with environment variables or `application-local.properties`:
`DB_URL, DB_USERNAME, DB_PASSWORD, JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_RESET_PASSWORD, CORS_ALLOWED_ORIGINS, SEED_DEMO_USERS`.
Attendance policy is under `app.attendance.*` (shift 09:30, 15 min grace, half day < 240 min, GPS accuracy ≤ 100 m, Sunday off).
Shop attendance adds three more: `SHOP_RADIUS_METERS` (default 50 m — the default radius offered when Admin adds a new shop;
each shop's own radius, 10–500 m, is set per-shop and can be changed later), `PHOTO_DIR` (where live check-in photos are
stored on disk, default `~/.staff-attendance/photos`, outside the web root — mount this as a persistent volume in Docker
so photos survive a container rebuild), and the multipart upload is capped at ~5 MB per photo.
Production: `SPRING_PROFILES_ACTIVE=prod` (needs DB_URL, DB_USERNAME, DB_PASSWORD, JWT_SECRET, ADMIN_PASSWORD, CORS_ALLOWED_ORIGINS) and serve over
**HTTPS** – browsers only give GPS to HTTPS pages (or localhost).
If the Admin password is ever lost: start once with `ADMIN_RESET_PASSWORD=true`.

## GPS: laptop vs phone (important)
A laptop/desktop has **no GPS chip**. Browsers guess its position from Wi-Fi/IP, so it is often off by hundreds of metres or kilometres and reports
a poor accuracy (±100-5000 m). The server (rightly) refuses check-ins worse than `app.attendance.max-accuracy-meters` (100 m) or outside the radius.
* **Real use:** check in from a **phone** (GPS gives ±5-30 m) over HTTPS.
* **Setting up a work location on a PC:** click the office on the map, or paste `latitude, longitude` copied from Google Maps
  (right-click the place, click the numbers) into the Latitude box. "Use my current location" is only accurate on a phone.
* **Testing check-in on a PC only:** start the backend with environment variable `MAX_ACCURACY_METERS=5000`, create the work location with
  "Use my current location" from the same PC and a radius of about 1000 m. Put the value back to 100 for real use.
* **Testing on a PC with an exact position:** Chrome DevTools (F12) > three dots > More tools > **Sensors** > Location > Other... and type the
  office's latitude / longitude / accuracy (e.g. 10). The page then receives exactly that as its GPS reading. Testing only.
* When a check-in is refused, the message shows the coordinates and accuracy your device actually reported, with a "see it on the map" link.
* Everything below about phones vs. laptops applies just as much to **Sales Officer shop check-in** (see next section) — a
  laptop testing a shop's geofence should use DevTools Sensors or a temporarily large `SHOP_RADIUS_METERS`, the same as a work location.

## Shop attendance (Sales Officers)
A Sales Officer does not check in against a work location — they check in **at one of the shops the Admin assigned to
them**, with a live photo:
* **Admin → Shops**: add a shop (name, locality, address, phone, an assigned Sales Officer, a lat/lng pin — click the map,
  paste `latitude, longitude` from Google Maps, or "Use my current location" — and an allowed radius, 10–500 m). A shop
  with no officer assigned just sits unused; an officer with no shop assigned cannot mark attendance until one exists.
  Only the Admin can move a shop's pin — an officer standing at the wrong spot cannot "fix" it themselves.
* **Sales Officer → CHECK IN** opens the same Login → Select Shop → GPS ON → Check Distance → Live Camera → Attendance
  popup as before, but the shops now come from the backend (only the officer's own assigned, active shops), and pressing
  **Mark Present** sends the officer's GPS *and* the live photo to the server, which repeats the distance check itself
  and stores the photo — the browser's own "within range" reading is only a preview. An officer with no camera (or who
  denies camera permission) gets an "Upload Photo instead" fallback that still requires a real image file.
* The server rejects a check-in that is outside the shop's radius (`OUTSIDE_GEOFENCE`), has no live photo (`PHOTO_REQUIRED`),
  a photo that isn't really a JPEG/PNG/WebP (`INVALID_PHOTO`, checked by file signature, not by trusting the browser),
  a photo over ~5 MB (`PHOTO_TOO_LARGE`), or a shop not assigned to that officer (`SHOP_NOT_ASSIGNED`). A Sales Officer
  cannot use the plain work-location check-in endpoint at all (`SHOP_CHECKIN_REQUIRED`).
* Checking **out** does not need to be at any particular shop (an officer's day usually ends away from the last shop they
  visited) — it only needs a plausible, accurate-enough GPS fix, the same accuracy rule as everyone else.
* The check-in photo is visible to the officer themselves, their manager chain, Owner and Admin — the same visibility
  rule as the attendance record itself — via a "📷 Photo" button on the attendance table, opened as an authenticated
  in-app image (never a public URL).

## Local sign-in survives restarts
With no `JWT_SECRET`, the backend keeps one generated dev key in `~/.staff-attendance/jwt-dev-secret.txt`, so restarting it from IntelliJ no longer signs
everybody out. (Before this, every restart invalidated every open browser session and the next click sent you back to the login page.) Set `JWT_SECRET` for real deployments.

## What it does
* **Root cause of the old Admin login bug:** the original page had no backend – `doLogin()` compared what you typed with hard-coded
  JavaScript and the *tab you clicked* decided your role. The page opens on the Owner tab, so `Admin`/`Admin@123` typed there failed.
  Login is now `POST /api/auth/login` → Spring Security + BCrypt + MySQL → JWT; the role comes from the database.
* Roles ADMIN, OWNER, RSM, RM, ASM, SO. ADMIN/OWNER see everyone, RSM/RM/ASM their reporting tree, SO only themselves – enforced in the queries.
* GPS attendance: browser sends coordinates; the **server** checks accuracy, computes Haversine distance to active work locations, accepts only
  inside the radius, blocks duplicates (unique user+date key), and derives late / half-day. Corrections are Admin-only, need a reason, and are audited.
* Tables: `users`, `work_locations`, `shops`, `attendance`, `audit_logs`.
* API: `/api/auth/*`, `/api/users/*` (incl. `DELETE /{id}`), `/api/work-locations/*`, `/api/shops/mine` (a Sales Officer's own shops),
  `/api/attendance/*` (check-in, shop-check-in, check-out, today, my, team, summary, `{id}/photo`),
  `/api/admin/*` (attendance, corrections, settings, audit-logs, shops CRUD incl. `DELETE /shops/{id}`) – see Swagger.

## Deleting staff and shops
Deactivate is usually the right tool — it stops sign-in / stops attendance without losing anything. But Admin → Staff
Accounts and Admin → Shops also have a **Delete** button for when a record should be removed for good (a duplicate
entry, a mistaken test account, the original demo data, etc.):
* **Delete staff**: permanently removes the account and their own attendance history. Refused if it's your own account,
  if it's the last active Admin, or if anyone still reports to that person (the error names who — reassign them to a
  different manager first, then delete). A shop that was assigned to the deleted person is **not** deleted — it just
  becomes unassigned, so the Admin can hand it to someone else.
* **Delete shop**: permanently removes the shop. Any attendance already recorded there is **kept** (the day, hours and
  photo all stay) — only the link to that specific shop is cleared, since the shop no longer exists to point to.
* Both are irreversible and both are logged to the Audit Log (`USER_DELETE`, `SHOP_DELETE`).

## Limitations
* Order/target screens elsewhere in the Sales Officer views still use the original localStorage demo data; login, staff,
  attendance (including shop check-in and photos), locations, shops, reports, and audit are all backend-driven.
* JWT is kept in memory only (refresh = sign in again). No login rate-limit (add at your proxy). Inactive accounts are reported as inactive even with a wrong password.
* Leaflet / jsPDF / SheetJS load from CDNs (map picker and exports need internet).

## Rebuilding index.html from the original
`python3 scripts/patch_frontend.py scripts/original/final_staff_login_html.html attendance/src/main/resources/static/index.html`
Browser tests: `cd scripts/frontend-test && npm install && npm test` (jsdom, 109 checks, including the full shop check-in
flow with GPS/accuracy/photo validation, the Admin Shops panel, and staff/shop deletion) and `cd scripts/ui-test && npm install && npm test`
(real headless Chromium, 25 checks: form layout on desktop/phone, typing, drag-select, create/delete staff, delete a
shop with a real native confirm() dialog, and a real `page.setGeolocation()` + real file-upload shop check-in). Both run against a mock of the API.


## Sales Officer dashboard: ASM shops, DP names, daily stock, targets (server-backed)
Everything below is stored in MySQL (Hibernate `ddl-auto=update` creates the new tables `dp_names`, `stock_entries`,
`sales_targets` and the new `shops.city` / `shops.created_by_id` columns on the next start), so it is the same on every device.

* **No hard-coded shops.** The generated demo shops are emptied in the browser. A Sales Officer sees **only** the shops
  returned by `GET /api/shops/mine` – i.e. the shops the ASM (or Admin) assigned to them – in *My Area & Shops* (with a
  search-by-name box), the *Daily Shop Report* (with a shop search box) and shop check-in. The SO's own "Add shop" buttons are gone.
* **ASM → Team Shops** (new ASM menu item): add / edit / remove shops for the Sales Officers in their own team
  (`/api/team/shops`, scope-checked on the server: a manager can only touch shops of SOs in their reporting tree).
  A shop needs a location (paste `lat, lng` from Google Maps, or tap "Use my location" at the shop) because check-in is geofenced.
* **DP Name** in the Daily Shop Report and Weekly Stock Report is a dropdown of saved names with "+ Add new DP name…" (`/api/dp-names`).
* **Weekly Stock Report**: pick a date and a category (DRY FRUITS first). Columns: No, Product, Opening, Receipt, Closing,
  SO Sales, DP Sales. `Closing = Opening + Receipt − SO Sales − DP Sales` is calculated live and by the server; the next day's
  Opening is always the previous day's Closing (typed only for a product's very first day). Editing an earlier day re-flows
  every later day. `PUT /api/stock/{date}`, `GET /api/stock`, `GET /api/stock/openings`.
* **Targets**: the ASM sets each SO's monthly target in *Targets vs Sales* (`PUT /api/targets`). The SO's *My Targets* shows
  Target vs Actual (SO Sales, DP Sales, Total, % achieved) plus Daily, Weekly and Product-wise SO/DP sales graphs.
  Sales value = quantity × product price from the order price list.
* **Messages** screen is responsive (full-screen on phones, stacked send form, no sideways scrolling).
* Browser test: `scripts/ui-test/so-sales-e2e.js` (33 checks against the mock API).
* Note: `SEED_DEMO_USERS=true` (the non-prod default) still seeds 7 demo shops into the database on an empty `shops` table;
  production (`SPRING_PROFILES_ACTIVE=prod`) does not. Delete any leftover demo shops from Admin → Shops.

## Live dashboards, Daily Shop Report and shop details on the server (portal-live.js)
* **Sales = SO Sales + DP Sales × price** from every Sales Officer's Weekly Stock Report. `GET /api/stock/team?from&to`
  returns the stock rows of everyone the caller may see (own team; everyone for Admin/Owner). Sales Analysis
  (Month / Area / Sales Officer / Category filters; Category-, Product-, Party(DP)-, Officer-, Area-wise share), the
  RM and Marketing Manager dashboards, the ASM performance table and Team Targets all use it with
  `/api/targets/team`, `/api/team/shops` and today's `/api/attendance/team`. The demo people, the seeded orders and the
  ₹5,00,000 / ₹8,00,000 default targets are gone: the local officer / ASM / RM records are rebuilt from `/api/users`.
* **ASM dashboard** shows Targets vs Sales and Team Shops right after login.
* **Admin console**: a role card lists every active person in that role; the Admin opens one person's dashboard
  (their own team only) and "Back to Admin" returns.
* **RM / Marketing Manager**: the stand-alone Reports module is removed; Messages is responsive.
* **Shops** keep mobile, full address and `productCategories` (new column `shops.product_categories`). A Sales Officer
  adding a shop without a connection keeps it on the phone and it is sent automatically when back online.
  Shop lists (My Shops, Team Shops) export to PDF / Excel with all details.
* **Daily Shop Report** is stored per officer per day: `GET /api/daily-reports?date&officerId`,
  `PUT /api/daily-reports/{date}` (Sales Officer, own report), `GET /api/daily-reports/range`. Table `daily_reports`
  (header and rows as JSON). Edits are saved automatically; offline edits wait on the phone and sync on reconnect.
  Its PDF / Excel include a Shop Details section (mobile, address, categories).
* Tests: `scripts/ui-test/live-e2e.js` (real browser, 54 checks against the mock API).

## Teams, messages and the call report on the server (portal-sync.js)
* **Team allocation** – Admin → Staff Accounts → **Team (n)** on a Marketing Manager / Regional Manager / Area Sales
  Manager row. Tick the people who report to them (`PUT /api/users/{id}/team`, audited as `TEAM_ASSIGN`): ASM → Sales
  Officers, RM → ASMs, Marketing Manager → RMs. A person ticked here moves from their old manager. An ASM (and the
  managers above) then sees only those officers – their attendance, shops, sales, calls and messages; the server
  enforces it (`ScopeService`), the screens only follow.
* **Messages** – `GET/POST /api/messages`, `PUT/DELETE /api/messages/{id}`. The sender is taken from the login, not
  from the phone. Admin/Owner see every message; everyone else sees what they sent, what is addressed to everyone, to
  their role or to them by name, and what their own team sent. An SO/ASM/RM can address by name only people in their own
  tree or their own managers. A message typed without a connection is kept on the phone and sent automatically.
* **Telephone Call Report** – every Call tap is stored with `POST /api/call-logs` (a client reference stops duplicates
  when it is re-sent), managers read their team's calls with `GET /api/call-logs`, rename/delete with
  `PUT/DELETE /api/call-logs/{id}`.
* **Admin console** – Top Performers and Role-wise Performance are worked out from this month's stock reports (SO +
  DP sales) and targets; managers without a team are flagged. The header avatar shows the signed-in person.
* New tables `portal_messages` and `call_logs` are created by `ddl-auto=update` on the next start – no manual SQL.
* Test: `cd scripts/ui-test && node sync-e2e.js` (37 checks against the mock API, real headless Chromium).

## Orders on the server, "whole team" shops, phone layout (so-orders.js, mobile.js)
* **Orders** – when a Sales Officer confirms an order (product picker, "repeat last order" or the order-booking form) it is
  saved with `PUT /api/orders` (table `sales_orders`, created by `ddl-auto=update`). Re-confirming the same shop on the same
  day updates that order (`clientRef` = day + shop). Offline orders wait on the phone and are sent automatically.
  `GET /api/orders?from&to&officerId` follows the reporting tree: the SO sees their own, an ASM their team's, Admin/Owner all.
  * ASM: **Team Orders** menu item + an **Orders today** card on the dashboard (refreshes every minute).
  * Admin: new **Orders** section (filters, item details, Excel).
  * RM: the existing **Orders** menu item now shows the server orders of the RM's tree (was demo data).
  * Marketing Manager: new **Orders** menu item (also in the phone More menu). Owner: **Orders** tab (desktop + phone).
* **An order no longer marks attendance.** Confirming an order used to complete the visit and stamp login/logout times;
  attendance is now only the explicit shop check-in (GPS + live photo).
* **Whole-team shops** – in Team Shops an ASM can pick "★ Whole team" instead of one Sales Officer. Every SO under that
  ASM (any depth) sees it in My Shops and may check in there; the ASM and the managers above them and the Admin see it;
  another ASM's team never does. SO-added shops stay visible to that SO, their ASM chain and the Admin only.
* **Phone layout** – `mobile.js` turns every wide table (Staff, Shops, Locations, Audit, attendance, Orders …) into one
  card per row below 680 px (column names copied from the header automatically), stacks headers/toolbars, and uses
  16 px inputs so iPhones don't zoom.
* Tests: `cd scripts/ui-test && node orders-e2e.js` (31 checks), `node mobile-audit.js` (phone-width overflow audit).

## Several shop visits a day, sync across devices, sales = orders + DP sales, camera, GPS, tablet layout
* **Every shop visit is saved** – `POST /api/attendance/shop-visit` (GPS + live photo, table `shop_visits`). The first visit
  of the day is also the attendance check-in (unchanged `shopCheckIn` rules); every later shop is checked the same way
  (own / whole-team shop, GPS accuracy, inside the shop radius, live photo) and added as another visit.
  `GET /api/attendance/visits?from&to&officerId` (scope = reporting tree), `GET /api/attendance/visits/{id}/photo`.
  My Attendance lists "Shop visits today (n)"; the 2nd-shop popup now also needs a photo and uses the shop's own radius.
* **Same on every device / for managers** – after sign-in the SO's plan is marked from the server (visited shops, orders),
  and the Daily Shop Report fills its order/visit cells from the server for the officer it is open for, so it no longer
  reads 0 on another phone or for the ASM/RM/MM/Owner/Admin. Managers' officer records use server visits and orders.
* **Sales = booked orders + DP Sales** (stock report "SO Sales" is not added again) – one rule in `SOSales.salesEntries`,
  used by Sales Analysis, Targets vs Sales, My Targets, team targets, dashboards and Top Performers.
* **Camera** – live camera has a 🔄 Front / Back switch (front photos are saved un-mirrored); the fallback file input lets the
  phone offer either camera.
* **GPS** – readings are collected for up to 12 s and the most accurate one is used (phones' first fix is often hundreds of
  metres off); the check-in popup switches to the nearest of the officer's shops; the 2nd-shop popup and the visit summary
  use the shop's real radius instead of a fixed 20 m.
* **Tablet** – wide tables become cards up to 1100 px (two per row on tablets). `node mobile-audit.js` (W=390/768/1024/1366).
* Tests: `cd scripts/ui-test && node visits-e2e.js` (23 checks, fake camera); existing suites updated for the sales rule.

## SO phone fixes: Today's Beat, Desktop-site mode, selfie camera, GPS pins, all visits in history, speed
* **Today's Beat** counts every shop visited today from the server (visits + the check-in itself) as soon as My Attendance
  refreshes (`SOOrders.visitsLoaded`).
* **No sideways scrolling** – popups are one column on phones, the live camera is full width (≥240 px tall) below the other
  sections, `html,body{overflow-x:clip}`. **Chrome "Desktop site" on a phone**: `mobile.js` re-evaluates every width media
  query for the phone's real width, lays the page out at that width and zooms it to fill the screen (fixed bars/popups
  re-pinned).
* **Camera** – attendance photos open the **front (selfie)** camera first; 🔄 switches front/back.
* **Shop locations** – only from an accurate GPS reading (`SPApi.getAccuratePosition`, best of up to 15 s, ±30 m max – a
  laptop is refused). ASM (Team Shops) and Admin (Shops) have **📍 Fix location here** to re-pin a shop while standing at it.
* **My history / team / admin attendance** list every shop visited that day (`attachVisits`), also in the Excel/PDF export.
* **Speed** – jsPDF / SheetJS / ExcelJS / Leaflet no longer block the first screen (loaded in the background after the page
  shows; an export/map tap before they arrive waits for them), and the server gzips HTML/JS/CSS
  (`server.compression.*`; index.html ~1.4 MB → ~0.25 MB on the wire).
