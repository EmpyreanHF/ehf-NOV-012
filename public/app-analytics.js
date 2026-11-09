/* =============================================================================
   EMPYREAN INTERNATIONAL — ANALYTICS MODULE
   app-analytics.js  |  Load near the end, after app-admin.js and app-nav.js
   (both already loaded well before this point in index.html) — this file
   only READS globals/events those two already provide (window.fbDb,
   window._firebaseLoaded, the `empyrean-init-done` and
   `empyrean-section-change` events); it does not need to run before or
   immediately after either of them.

   TASK: "Build an analytical system to track engagement and display
   visitor statistics." — page visits, session duration, user activity,
   via a dedicated reporting module with Firestore (the app's existing
   API layer) integration and a visualization dashboard. Kept fully
   isolated in this one file, additive only: no existing file is edited,
   no existing collection is touched, no existing global is overwritten.

   ═══════════════════════════════════════════════════════════════════════
   WHY THIS MODULE, NOT A NEW SERVICE
   ═══════════════════════════════════════════════════════════════════════
   This app already has one integration layer for reads/writes — Firestore
   via window.fbDb, the same one every other module here uses (users,
   posts, presence, etc). Reusing it means: no new backend, no new auth,
   and admin-only reads can lean on the same Firestore rules the rest of
   the admin panel already relies on. "Integrate with existing APIs" is
   satisfied by writing analytics data through that same client, in two
   collections scoped only to this feature:

     • analytics_sessions/{sessionId}  — one doc per browser session
       (session = one page load until close/reload), tracking pageViews
       and durationSeconds for that session, updated on a heartbeat.
     • analytics_daily/{YYYY-MM-DD}    — one aggregate doc per calendar
       day, updated via FieldValue.increment() from every client, so the
       dashboard can read a handful of small daily docs instead of
       scanning every raw event to build a chart.

   Matches this codebase's existing presence heartbeat pattern
   (app-fix-final.js §11 fixOnlineStatus/_heartbeat) — same idea, same
   best-effort try/catch style, same "gate on _isGuest()" convention so
   an unauthenticated visitor's session never attempts a Firestore write
   that this app's existing rules likely wouldn't allow anyway (that
   convention already exists for the presence collection, and analytics
   follows it rather than guessing at different behavior).

   ═══════════════════════════════════════════════════════════════════════
   WHAT COUNTS AS SCALABLE / MODULAR HERE
   ═══════════════════════════════════════════════════════════════════════
   - Writes are aggregated client-side via FieldValue.increment(), so
     traffic growth adds more small increment writes, not more data the
     dashboard has to read — the dashboard always reads at most ~15 small
     docs (14 days + today) regardless of how many sessions occurred.
   - §1 (tracking) and §2 (dashboard) do not call each other and do not
     share any function — §1 can be reused by any future page/app shell
     that wants the same tracking without pulling in the admin dashboard
     renderer, and §2 could be pointed at a different data source later
     without touching §1. Both only agree on the two collection names.
   - Every Firestore call on both sides is wrapped and best-effort:
     a failed analytics write never surfaces to the visitor, and a failed
     analytics read never blocks the rest of the admin panel.
   ============================================================================= */

/* =============================================================================
   2026-11-06 UPGRADE (Facebook-style analytics + admin panel fix) — what changed:
     • FIX: section counts were written with dotted keys ('sections.home') through
       set({merge:true}), which Firestore stores as a literal field name, so the
       dashboard's `sections` map was always empty. Now written as a real nested map;
       old literal fields already in the database are still read (see _normDay).
     • FIX: every Firestore write is now .catch()-guarded (a rejected write used to
       surface as an unhandled promise rejection).
     • FIX: read failures were silently turned into zeros, so "permission denied" and
       "offline" looked identical to "no traffic" and the cards stayed on "—"/"Loading…".
       Reads now time out (12 s), failures are reported in a visible banner with the cause
       and the rule to add, and an empty-but-healthy state is explained.
     • FIX: "today" now follows Africa/Lagos (UTC+1) instead of UTC, so the day rolls over
       at local midnight, and a session that crosses midnight writes to the right day.
     • NEW (platform-wide, not just this device): active-now, daily active users, new
       signups, registered users (cheap count query), total time spent, vs-yesterday
       deltas, peak hours, device / OS split, members vs guests, 30 s auto-refresh while the
       tab is open, and the tab loads itself whenever it becomes visible.
     • NEW tracking: guests are counted too (best-effort — a rule that denies them just
       drops those writes silently), plus per-day activeUsers / hours / devices / os maps.
   ============================================================================= */

(function empyreanAnalytics() {
    'use strict';

    if (window._empAnalyticsLoaded) {
        console.warn('[Analytics] Already loaded — skipping duplicate.');
        return;
    }
    window._empAnalyticsLoaded = true;

    function log(msg) { console.log('[Analytics] ' + msg); }

    // ── Shared helpers — same shape as the equivalents already used
    //    throughout app-fix-final.js / app-admin.js, duplicated locally
    //    (not exposed on window) so this file has zero dependency on
    //    those files' internal closures, matching how every other patch
    //    file here defines its own copies of these same three helpers. ──
    function _fbOk() { return !!(window._firebaseLoaded && window.fbDb && typeof window.fbDb.collection === 'function'); }
    function _us() { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    function _isGuest() {
        var s = window.EmpState || {};
        if (s.isGuest != null) return !!s.isGuest;
        if (window.isGuest != null) return !!window.isGuest;
        var u = _us();
        if (u && u.id && u.id !== 'guest' && !String(u.id).startsWith('guest-')) return false;
        return true;
    }
    function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function _fv() { return firebase.firestore.FieldValue; }
    // Day keys follow Africa/Lagos (UTC+1, no DST): YYYY-MM-DD, lexicographically sortable.
    var TZ_MS = 3600000;
    function _dayKey(daysAgo) { return new Date(Date.now() + TZ_MS - (daysAgo || 0) * 86400000).toISOString().slice(0, 10); }
    function _todayKey() { return _dayKey(0); }
    function _hourWAT() { return new Date(Date.now() + TZ_MS).getUTCHours(); }
    function _dayStartISO(key) { return new Date(key + 'T00:00:00+01:00').toISOString(); }
    function _safe(p) { if (p && typeof p.catch === 'function') p.catch(function () {}); return p; }
    function _withTimeout(p, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject({ code: 'timeout', message: 'Request timed out' }); }, ms);
            p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }
    function _deviceInfo() {
        var ua = navigator.userAgent || '';
        var type = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua) ? 'tablet' : (/Mobi|Android|iPhone|iPod/i.test(ua) ? 'mobile' : 'desktop');
        var os = /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Windows/i.test(ua) ? 'windows' : /Mac OS X|Macintosh/i.test(ua) ? 'macos' : /Linux/i.test(ua) ? 'linux' : 'other';
        return { type: type, os: os };
    }

    // Profile location -> short city label + a Firestore-safe map key.
    function _cityOf(u) {
        var raw = String((u && (u.location || u.city)) || '').trim();
        if (!raw) return '';
        var c = raw.split(/[,;|\/]/)[0].replace(/\s+/g, ' ').trim().slice(0, 40);
        return c.toLowerCase().replace(/(^|\s)\S/g, function (m) { return m.toUpperCase(); });
    }
    function _cityKey(c) { return String(c).replace(/[.\/\s~*\[\]]/g, '_'); }

    /* =========================================================================
       §1 — TRACKING (runs for every real page load, not just inside admin)
       ========================================================================= */
    var _sessionId = null;
    var _lastHeartbeatAt = 0;
    var _heartbeatTimer = null;
    var _sessionGuest = false;
    var _readyForSectionEvents = false; // guards against double-counting the boot-restore section change (see app-patch-v40.js's own note on the same event for why that first firing isn't a real user-visible navigation)

    function _sessionDocRef() { return window.fbDb.collection('analytics_sessions').doc(_sessionId); }
    function _dailyDocRef(key) { return window.fbDb.collection('analytics_daily').doc(key); }

    // `fields` must be a REAL nested object ({sections:{home:inc}}), never dotted keys:
    // set({merge:true}) stores 'sections.home' as one literal field name.
    function _incrementDaily(fields) {
        if (!_fbOk()) return;
        try { _safe(_dailyDocRef(_todayKey()).set(fields, { merge: true })); } catch (e) {}
    }
    function _secKey(id) { return String(id).replace(/[.\/\s]/g, '_'); }

    function _endSession() {
        if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
        _heartbeat();
        _sessionId = null;
        _readyForSectionEvents = false;
    }

    function _startSession() {
        if (!_fbOk()) { log('tracking skipped (Firestore not ready).'); return; }
        var guest = _isGuest();
        if (_sessionId) {
            // A visitor who started as a guest and then logged in becomes a fresh member session.
            if (_sessionGuest && !guest) _endSession(); else return;
        }

        _sessionId = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        _sessionGuest = guest;
        _lastHeartbeatAt = Date.now();

        var u = _us();
        var dev = _deviceInfo();
        var initialSection = (document.querySelector('.content-section.active') || {}).id || 'dashboard';

        try {
            _safe(_sessionDocRef().set({
                uid: guest ? null : (u.id || null),
                guest: guest,
                dateKey: _todayKey(),
                startedAt: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                durationSeconds: 0,
                pageViews: 1,
                device: dev.type,
                os: dev.os,
                userAgent: navigator.userAgent || null
            }));
        } catch (e) {}

        var inc = {
            pageViews: _fv().increment(1),
            sessions: _fv().increment(1),
            sections: {},
            hours: {},
            devices: {},
            os: {}
        };
        inc.sections[_secKey(initialSection)] = _fv().increment(1);
        inc.hours['h' + _hourWAT()] = _fv().increment(1);
        inc.devices[dev.type] = _fv().increment(1);
        inc.os[dev.os] = _fv().increment(1);
        // 2026-11-07 — AUDIENCE CITY (Admin ▸ Platform Analytics ▸ "Audience cities"): members' own profile
        // location, first part only ("Lekki, Lagos" -> "Lekki"). Guests have no profile, so they are not placed.
        var _city = guest ? '' : _cityOf(u);
        if (_city) { inc.cities = {}; inc.cities[_cityKey(_city)] = _fv().increment(1); }
        if (guest) {
            inc.guestSessions = _fv().increment(1);
        } else if (u.id) {
            // Daily active users: counted once per member per device per day (localStorage marker),
            // so DAU stays a single cheap increment instead of a per-user read at report time.
            var mk = 'empAnDau:' + u.id + ':' + _todayKey();
            var seen = false;
            try { seen = !!localStorage.getItem(mk); if (!seen) localStorage.setItem(mk, '1'); } catch (e) {}
            if (!seen) inc.activeUsers = _fv().increment(1);
        }
        _incrementDaily(inc);

        _readyForSectionEvents = true;
        _heartbeatTimer = setInterval(_heartbeat, 20000); // same 20s cadence app-patch-group-call.js already uses for its own presence heartbeat
        log('session started (' + _sessionId + (guest ? ', guest' : '') + ').');
    }

    function _heartbeat() {
        if (!_sessionId || !_fbOk()) return;
        var now = Date.now();
        var deltaSeconds = Math.max(0, Math.round((now - _lastHeartbeatAt) / 1000));
        _lastHeartbeatAt = now;
        if (deltaSeconds <= 0) return;
        try {
            _safe(_sessionDocRef().set({ lastSeen: new Date().toISOString(), durationSeconds: _fv().increment(deltaSeconds) }, { merge: true }));
        } catch (e) {}
        _incrementDaily({ sessionSeconds: _fv().increment(deltaSeconds) });
    }

    function _recordPageview(sectionId) {
        if (!_sessionId || !_fbOk() || !sectionId) return;
        try {
            _safe(_sessionDocRef().set({ pageViews: _fv().increment(1), lastSeen: new Date().toISOString() }, { merge: true }));
        } catch (e) {}
        var inc = { pageViews: _fv().increment(1), sections: {}, hours: {} };
        inc.sections[_secKey(sectionId)] = _fv().increment(1);
        inc.hours['h' + _hourWAT()] = _fv().increment(1);
        _incrementDaily(inc);
    }

    document.addEventListener('empyrean-init-done', function () { _whenFbReady(_startSession, 20000); });

    document.addEventListener('empyrean-section-change', function (e) {
        if (!_readyForSectionEvents) return; // boot-restore nav, already counted as the session's initial view in _startSession()
        var id = e && e.detail && e.detail.section;
        if (id) _recordPageview(id);
    });

    // Best-effort final flush. A killed tab can still skip this (no server-side onDisconnect in
    // Firestore) — the periodic heartbeat is what keeps the data close to accurate regardless.
    window.addEventListener('pagehide', function () { _heartbeat(); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') _heartbeat(); });

    function _whenFbReady(cb, maxMs) {
        if (_fbOk()) { cb(); return; }
        var waited = 0;
        var t = setInterval(function () {
            waited += 500;
            if (_fbOk()) { clearInterval(t); cb(); }
            else if (waited >= maxMs) { clearInterval(t); }
        }, 500);
    }

    /* =========================================================================
       §1b — POST VIEWS (creator Analytics ▸ Audience: location + followers vs non-followers)
       One post_views doc per viewer per post per Lagos day (id = postId_viewerUid_dateKey — see the
       post_views rule in firebase-rules.js, which is create-only and shape-locked). Recorded when a feed
       post has been >=60% on screen for 1 second. Own posts are never counted. Best-effort and silent.
       ========================================================================= */
    var _pvDone = {};
    window._empRecordPostView = function (p) {
        try {
            if (!p || !p.id || !p.ownerId || !_fbOk() || !window.fbAuth || !window.fbAuth.currentUser) return;
            var viewer = window.fbAuth.currentUser.uid, dk = _todayKey();
            if (!viewer || viewer === p.ownerId) return;
            var id = p.id + '_' + viewer + '_' + dk;
            if (_pvDone[id]) return; _pvDone[id] = 1;
            var mk = 'empPv:' + id; try { if (localStorage.getItem(mk)) return; localStorage.setItem(mk, '1'); } catch (e) {}
            var u = _us(), guest = _isGuest(), f = u && u.followedUserIds;
            var isFollower = !!(f && typeof f.has === 'function' && f.has(p.ownerId));
            _safe(window.fbDb.collection('post_views').doc(id).set({
                postId: String(p.id), ownerId: String(p.ownerId), viewerId: viewer, isFollower: isFollower, isGuest: guest,
                loc: guest ? '' : _cityOf(u), dateKey: dk, ts: new Date().toISOString(), kind: p.kind === 'reel' ? 'reel' : 'post'
            }));
        } catch (e) {}
    };
    (function armPostViewObserver() {
        if (typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') return;
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                var el = en.target;
                if (en.isIntersecting) {
                    clearTimeout(el._empPvT);
                    el._empPvT = setTimeout(function () {
                        var pid = el.getAttribute('data-post-id') || el.getAttribute('data-id'), oid = el.getAttribute('data-user-id');
                        if (pid && oid) window._empRecordPostView({ id: pid, ownerId: oid, kind: (el.classList.contains('reel') || el.getAttribute('data-is-reel') === 'true') ? 'reel' : 'post' });
                        io.unobserve(el);
                    }, 1000);
                } else clearTimeout(el._empPvT);
            });
        }, { threshold: 0.6 });
        var queued = false;
        function scan() {
            queued = false;
            var list = document.querySelectorAll('.impact-story[data-user-id]:not(.sos-request):not(.crisis-report):not([data-emp-pv])');
            for (var i = 0; i < list.length; i++) { list[i].setAttribute('data-emp-pv', '1'); io.observe(list[i]); }
        }
        function start() {
            new MutationObserver(function () { if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(scan); } })
                .observe(document.body, { childList: true, subtree: true });
            scan();
        }
        if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    })();

/* =============================================================================
   2026-11-07 — LEGACY DASHBOARD REMOVED (this file is now TRACKING ONLY)
   The old admin dashboard renderer that used to live in §2 below (it filled the static
   #an-* stat cards / charts that index.html used to contain) has been deleted, together
   with its CSS, auto-refresh timer and click/visibility hooks. That is why the old
   "Engagement & Visitor Analytics" panels can no longer appear in the admin panel.
   The Platform Analytics dashboard is drawn by app-analytics-charts.js, which reads the same
   analytics_daily / analytics_sessions collections that §1 keeps writing.
   ============================================================================= */

    console.log('[EmpyreanAnalytics] \u2705 Engagement tracking armed (members + guests, Lagos day boundaries). Dashboard lives in app-analytics-charts.js.');
})();