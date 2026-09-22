/* ==========================================================================
   api.js  -  thin client for the Spring Boot backend (window.SPApi)

   * The JWT lives in memory only. It is never written to localStorage or
     sessionStorage, so closing/refreshing the tab signs the user out.
   * Every call is authenticated with  Authorization: Bearer <JWT>.
   * The backend is the only authority for role, scope and geofence checks;
     this file just carries requests and translates errors into messages a
     field officer can act on.
   ========================================================================== */
(function (global) {
    'use strict';

    // ---- Where is the backend? -------------------------------------------------
    //  * opened from the backend itself (http://host:8080/)  -> same origin
    //  * opened from a plain static server / file://          -> http://localhost:8080
    //  * anything else (reverse proxy)                        -> same origin
    //  Override with  window.SP_API_BASE = 'https://api.example.com'  before this
    //  script loads, or with ?api=https://api.example.com in the page URL.
    function resolveBase() {
        try {
            var q = new URLSearchParams(global.location.search).get('api');
            if (q) return q.replace(/\/+$/, '');
        } catch (e) { /* ignore */ }
        if (typeof global.SP_API_BASE === 'string') return global.SP_API_BASE.replace(/\/+$/, '');
        var loc = global.location || {};
        if (loc.protocol === 'file:') return 'http://localhost:8080';
        var devPorts = ['3000', '5000', '5173', '5500', '5501', '8000', '8081', '8888'];
        if (devPorts.indexOf(String(loc.port)) >= 0) return 'http://localhost:8080';
        return '';
    }
    var BASE = resolveBase();

    // ---- Session (memory only) ------------------------------------------------
    var session = { token: null, user: null, expiresAt: 0 };
    var onSessionExpired = null;

    function ApiError(status, code, message, details) {
        var e = new Error(message || 'Request failed');
        e.name = 'ApiError';
        e.status = status;          // HTTP status, 0 = network failure
        e.code = code || 'ERROR';   // machine readable code from the backend
        e.details = details || null;
        return e;
    }

    function qs(params) {
        var out = [];
        Object.keys(params || {}).forEach(function (k) {
            var v = params[k];
            if (v === undefined || v === null || v === '') return;
            out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
        });
        return out.length ? '?' + out.join('&') : '';
    }

    async function request(method, path, opts) {
        opts = opts || {};
        var headers = { 'Accept': 'application/json' };
        if (opts.body !== undefined) headers['Content-Type'] = 'application/json';   // (a FormData body sets its own multipart type)
        if (opts.auth !== false && session.token) headers['Authorization'] = 'Bearer ' + session.token;

        var res;
        try {
            res = await fetch(BASE + path + qs(opts.query), {
                method: method,
                headers: headers,
                body: opts.form !== undefined ? opts.form : (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
                cache: 'no-store'
            });
        } catch (netErr) {
            throw ApiError(0, 'NETWORK', 'Cannot reach the server.');
        }

        if (res.status === 204) return null;
        var data = null;
        var text = '';
        try { text = await res.text(); data = text ? JSON.parse(text) : null; } catch (e) { data = null; }

        if (!res.ok) {
            var err = ApiError(res.status,
                data && data.code, data && data.message, data && data.details);
            // A 401 on a *protected* call means the token is gone/expired: sign out.
            if (res.status === 401 && opts.auth !== false && session.token) {
                clearSession();
                if (typeof onSessionExpired === 'function') onSessionExpired(err);
            }
            throw err;
        }
        return data;
    }

    function clearSession() { session = { token: null, user: null, expiresAt: 0 }; }

    // ---- Friendly messages ------------------------------------------------------
    var MESSAGES = {
        NETWORK: 'Cannot reach the server. Check your internet connection and try again.',
        INVALID_CREDENTIALS: 'Incorrect username or password.',
        ACCOUNT_INACTIVE: 'Your account is inactive. Please contact your Admin.',
        TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
        TOKEN_INVALID: 'Your session is no longer valid. Please sign in again.',
        UNAUTHENTICATED: 'Please sign in to continue.',
        ACCESS_DENIED: 'You do not have permission to do that.',
        OUT_OF_SCOPE: 'That record is outside the team you can see.',
        ALREADY_CHECKED_IN: 'You have already checked in today.',
        ALREADY_CHECKED_OUT: 'You have already checked out today.',
        NOT_CHECKED_IN: 'You have not checked in today, so there is nothing to check out of.',
        POOR_GPS_ACCURACY: 'Your GPS signal is too weak to verify your location. Move to an open area and try again.',
        INVALID_GPS: 'The location your device reported is not valid. Please try again.',
        NO_WORK_LOCATION: 'No work location has been set up yet. Ask your Admin to add one.',
        SHOP_CHECKIN_REQUIRED: 'Sales Officers mark attendance at one of their assigned shops, with a live photo.',
        SHOP_NOT_ASSIGNED: 'That shop is not assigned to you. Ask your Admin.',
        SHOP_CHECKIN_SO_ONLY: 'Only Sales Officers mark attendance at a shop.',
        PHOTO_REQUIRED: 'Take the live photo of the shop first.',
        INVALID_PHOTO: 'That photo could not be used. Retake it (JPEG, PNG or WebP).',
        PHOTO_TOO_LARGE: 'That photo is too large. Retake it or choose a smaller image.',
        SHOP_CODE_TAKEN: 'Another shop already uses that code.',
        INVALID_OFFICER: 'A shop can only be assigned to an active Sales Officer.',
        CANNOT_DELETE_SELF: 'You cannot delete your own account.',
        LAST_ADMIN: 'At least one active Admin must remain.',
        VALIDATION_FAILED: 'Please check the details you entered and try again.',
        CONFLICT: 'That conflicts with an existing record.',
        INTERNAL_ERROR: 'Something went wrong on the server. Please try again in a moment.'
    };

    function friendlyError(err) {
        if (!err) return 'Something went wrong.';
        var d = err.details || {};
        if (err.code === 'OUTSIDE_GEOFENCE') {
            var dist = d.distanceMeters != null ? Math.round(d.distanceMeters) + ' m' : 'too far';
            var rad = d.allowedRadiusMeters != null ? Math.round(d.allowedRadiusMeters) + ' m' : 'the allowed radius';
            if (d.shopName) return 'You are ' + dist + ' from ' + d.shopName + '. Attendance is only allowed within ' + rad + ' of the shop.';
            var where = d.workLocationName ? ' from ' + d.workLocationName : '';
            return 'You are outside the permitted work location: ' + dist + where + ' (allowed: ' + rad + ').';
        }
        if (err.code === 'POOR_GPS_ACCURACY') {
            var acc = d.accuracyMeters != null ? ' (' + Math.round(d.accuracyMeters) + ' m' +
                (d.maxAccuracyMeters != null ? ', need ' + Math.round(d.maxAccuracyMeters) + ' m or better' : '') + ')' : '';
            return MESSAGES.POOR_GPS_ACCURACY.replace(/\.$/, '') + acc + '.';
        }
        if (err.code === 'VALIDATION_FAILED') {
            // the server already puts the first field message in `message`
            return err.message || MESSAGES.VALIDATION_FAILED;
        }
        if (err.code && MESSAGES[err.code]) return MESSAGES[err.code];
        if (err.status === 0) return MESSAGES.NETWORK;
        if (err.status === 401) return MESSAGES.UNAUTHENTICATED;
        if (err.status === 403) return MESSAGES.ACCESS_DENIED;
        if (err.status >= 500) return MESSAGES.INTERNAL_ERROR;
        return err.message || 'Something went wrong.';
    }

    // ---- GPS -------------------------------------------------------------------
    // Always a fresh, high-accuracy fix. Never cached, never hard-coded.
    function getPosition() {
        return new Promise(function (resolve, reject) {
            if (!global.isSecureContext && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(global.location.hostname)) {
                return reject(ApiError(0, 'GPS_INSECURE',
                    'Location needs a secure (HTTPS) connection. Open the portal using its https:// address.'));
            }
            if (!global.navigator || !global.navigator.geolocation) {
                return reject(ApiError(0, 'GPS_UNSUPPORTED', 'This device or browser does not support location.'));
            }
            global.navigator.geolocation.getCurrentPosition(function (pos) {
                resolve({
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                });
            }, function (err) {
                var code = 'GPS_UNAVAILABLE', msg = 'Could not read your location. Turn on GPS and try again.';
                if (err && err.code === 1) {
                    code = 'GPS_DENIED';
                    msg = 'Location permission was denied. Allow location for this site in your browser settings, then try again.';
                } else if (err && err.code === 3) {
                    code = 'GPS_TIMEOUT';
                    msg = 'Getting your location took too long. Move to an open area, make sure GPS is on, and try again.';
                }
                reject(ApiError(0, code, msg));
            }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
        });
    }

    function deviceInfo() {
        var ua = (global.navigator && global.navigator.userAgent) || '';
        return ua.slice(0, 250);
    }

    // ---- Public surface ---------------------------------------------------------
    global.SPApi = {
        base: function () { return BASE; },
        onSessionExpired: function (fn) { onSessionExpired = fn; },
        isLoggedIn: function () { return !!session.token; },
        user: function () { return session.user; },
        friendlyError: friendlyError,
        getPosition: getPosition,
        clearSession: clearSession,

        login: async function (username, password) {
            var data = await request('POST', '/api/auth/login', {
                auth: false, body: { username: username, password: password }
            });
            session.token = data.token;
            session.user = data.user;
            session.expiresAt = Date.now() + (data.expiresInSeconds || 0) * 1000;
            return data;
        },
        logout: async function () {
            try { if (session.token) await request('POST', '/api/auth/logout'); }
            catch (e) { /* signing out must never fail on the user */ }
            clearSession();
        },
        me: function () { return request('GET', '/api/auth/me'); },
        changePassword: function (currentPassword, newPassword) {
            return request('POST', '/api/auth/change-password',
                { body: { currentPassword: currentPassword, newPassword: newPassword } });
        },

        // attendance (any signed-in user; the server identifies who from the JWT)
        today: function () { return request('GET', '/api/attendance/today'); },
        checkIn: function (gps) {
            return request('POST', '/api/attendance/check-in', { body: withDevice(gps) });
        },
        checkOut: function (gps) {
            return request('POST', '/api/attendance/check-out', { body: withDevice(gps) });
        },
        myAttendance: function (q) { return request('GET', '/api/attendance/my', { query: q }); },
        teamAttendance: function (q) { return request('GET', '/api/attendance/team', { query: q }); },
        summary: function (q) { return request('GET', '/api/attendance/summary', { query: q }); },

        // admin
        adminAttendance: function (q) { return request('GET', '/api/admin/attendance', { query: q }); },
        correctAttendance: function (id, body) { return request('PUT', '/api/admin/attendance/' + id, { body: body }); },
        createAttendance: function (body) { return request('POST', '/api/admin/attendance', { body: body }); },
        settings: function () { return request('GET', '/api/admin/settings'); },
        auditLogs: function (q) { return request('GET', '/api/admin/audit-logs', { query: q }); },

        // Sales Officer: shops assigned to me, check-in at a shop (multipart: shopId, latitude, longitude, accuracy, photo)
        myShops: function () { return request('GET', '/api/shops/mine'); },
        shopCheckIn: function (form) { return request('POST', '/api/attendance/shop-check-in', { form: form }); },
        // the live photo of a check-in, as a Blob (the endpoint needs the Authorization header, so an <img src> cannot fetch it)
        attendancePhoto: async function (id) {
            var res;
            try {
                res = await fetch(BASE + '/api/attendance/' + encodeURIComponent(id) + '/photo', {
                    headers: session.token ? { 'Authorization': 'Bearer ' + session.token } : {}, cache: 'no-store'
                });
            } catch (netErr) { throw ApiError(0, 'NETWORK', 'Cannot reach the server.'); }
            if (!res.ok) {
                var d = null; try { d = await res.json(); } catch (e) { d = null; }
                throw ApiError(res.status, d && d.code, (d && d.message) || 'The photo could not be loaded.', d && d.details);
            }
            return res.blob();
        },

        // users
        users: function () { return request('GET', '/api/users'); },
        createUser: function (body) { return request('POST', '/api/users', { body: body }); },
        updateUser: function (id, body) { return request('PUT', '/api/users/' + id, { body: body }); },
        setUserStatus: function (id, status) {
            return request('PATCH', '/api/users/' + id + '/status', { body: { status: status } });
        },
        resetPassword: function (id, newPassword) {
            return request('POST', '/api/users/' + id + '/reset-password', { body: { newPassword: newPassword } });
        },
        deleteUser: function (id) { return request('DELETE', '/api/users/' + id); },

        // shops (Admin)
        adminShops: function (q) { return request('GET', '/api/admin/shops', { query: q }); },
        createShop: function (body) { return request('POST', '/api/admin/shops', { body: body }); },
        updateShop: function (id, body) { return request('PUT', '/api/admin/shops/' + id, { body: body }); },
        deleteShop: function (id) { return request('DELETE', '/api/admin/shops/' + id); },
        setShopStatus: function (id, status) {
            return request('PATCH', '/api/admin/shops/' + id + '/status', { body: { status: status } });
        },

        // work locations
        workLocations: function (includeInactive) {
            return request('GET', '/api/work-locations', { query: { includeInactive: includeInactive ? 'true' : '' } });
        },
        createWorkLocation: function (body) { return request('POST', '/api/work-locations', { body: body }); },
        updateWorkLocation: function (id, body) { return request('PUT', '/api/work-locations/' + id, { body: body }); },
        setWorkLocationStatus: function (id, status) {
            return request('PATCH', '/api/work-locations/' + id + '/status', { body: { status: status } });
        }
    };

    function withDevice(gps) {
        return { latitude: gps.latitude, longitude: gps.longitude, accuracy: gps.accuracy, deviceInfo: deviceInfo() };
    }
})(window);
