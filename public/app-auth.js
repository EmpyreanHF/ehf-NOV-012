/* =============================================================================
   EMPYREAN INTERNATIONAL — AUTHENTICATION & SESSION
   app-auth.js  |  Step 0.7  |  Refactor Roadmap v1.0
   =============================================================================

   PURPOSE
   ───────
   Complete authentication system extracted from app-fixes.js.  Covers every
   path a user can take to establish or destroy a session:

     • Page-load session restore (localStorage + Firebase onAuthStateChanged)
     • Email/password login (Firebase Auth primary, localStorage fallback)
     • Email/password registration (localStorage-first, Firebase async)
     • Google Sign-In (Firebase Auth popup)
     • Forgot-password email dispatch
     • Sign-out (Firebase + localStorage + state reset)
     • Admin detection and PIN modal guard
     • Core app initialiser — initializeApp()
     • Firestore user profile helpers — loadUserFromFirestore / saveUserToFirestore
     • Avatar propagation — propagateProfilePicture()
     • Auth modal open/close/switch-view

   LOAD ORDER
   ──────────
   Must load AFTER all prior modules:
   firebase-init.js → app-state.js → app-helpers.js → app-contracts.js
   → app-notifications.js → app-tags.js → app-dom.js → app-auth.js

   DEPENDS ON
   ──────────
   • window.fbAuth / window.fbDb   (firebase-init.js stubs)
   • window.EmpState               (app-state.js)
   • window.showNotification       (app-helpers.js)
   • window.showFormFeedback       (app-helpers.js)
   • window.generateCaptcha        (app-helpers.js)
   • window.handleAvatarUpload     (app-helpers.js)
   • window.rewardUserForAction    (app-helpers.js)
   • window.pushNotification       (app-notifications.js)
   • window.loadUserNotifications  (app-notifications.js)
   • window.navigateTo             (app-dom.js)
   • window.buildSidebar / buildHeader / renderDynamicUI  (app-dom.js)
   • window.updateWalletUI / updateCartUI / updateStakingUI  (app-wallet.js)
   • window.renderMarketplaceCards  (app-marketplace.js)
   • window.renderUserProfile / renderBusinessPage  (app-profile.js)
   • window.renderCommunityTasks / renderGrantLedger / renderNgoGrid  (app-ngo.js)
   • window.renderDashboardNews / renderSuggestedUsers  (app-feed.js)
   • window.renderAdminQueues      (app-admin.js)
   • window.renderContactList      (app-chat.js)
   • window.populateBackgroundSelector / populateGiftCatalog  (app-live.js)
   • window._startRealtimeListeners  (app-feed.js)
   • window.startLiveStreamListener  (app-live.js)

   PUBLIC API
   ──────────
   window.initializeApp(guestMode, isAdminUser, customUserData)
   window.loadUserFromFirestore(uid)  → Promise<Object|null>
   window.saveUserToFirestore(uid, data) → Promise<void>
   window.propagateProfilePicture()
   window.signOutUser()

   SECTION MAP
   ───────────
   §1  Constants
   §2  Firestore user helpers — load / save
   §3  Set-field normaliser
   §4  initializeApp — core app bootstrapper
   §5  restoreLocalSession — page-load localStorage restore
   §6  Firebase onAuthStateChanged — canonical session observer
   §7  Login handler
   §8  Register handler
   §9  Google Sign-In handler
   §10 Forgot-password handler
   §11 Sign-out handler
   §12 Auth modal — open / close / view switching
   §13 propagateProfilePicture
   §14 Listener retry + network resume logic

   ============================================================================= */

(function empyreanAuthModule() {
    'use strict';

    if (window._empyreanAuthLoaded) {
        console.warn('[EmpAuth] Already loaded — skipping duplicate.');
        return;
    }
    window._empyreanAuthLoaded = true;

    /* =========================================================================
       §1  CONSTANTS
       ========================================================================= */

    const ADMIN_EMAILS = new Set([
        'admin@empyrean.com',
        'chiefadmin@empyreanhumanitarianfoundation.com'
    ]);

    /** Keys that must be stored as Set objects on userState
     *
     * FIX (2026-08-05 — "cover/profile picture upload disappears after
     * save, cloud sync failed" — confirmed via console: "Unsupported
     * field value: a custom Set object (found in field downloadedPostIds
     * ...)"): this list was missing 'downloadedPostIds' and
     * 'quotedPostIds', even though both are declared as real Set fields
     * on userState (see app-fixes.js's guestState/demo-user declarations:
     * `downloadedPostIds: new Set(), quotedPostIds: new Set()`) and are
     * actively .add()/.has()'d elsewhere (app-fixes.js's download-gate
     * logic). This function — window.saveUserToFirestore — is the one
     * that actually runs in production (it's assigned here, in
     * app-auth.js, which loads after and overwrites app-dom.js's own
     * separate copy of the same function name; a matching fix was
     * already made to that other copy in an earlier pass, but since it's
     * shadowed it never took effect). Any profile save while either
     * field held a Set threw here, aborting the ENTIRE write — which is
     * what app-fixes.js's profile-save handler then reported as "cloud
     * sync failed," reverting the just-uploaded avatar/cover on screen.
     * Added both missing fields so save, load, and localStorage
     * serialization all handle them symmetrically. */
    const SET_KEYS = [
        'likedPostIds', 'followedUserIds', 'retweetedPostIds',
        'awardedRanks', 'completedTasks', 'viewedStatusUserIds',
        'downloadedPostIds', 'quotedPostIds'
    ];

    /** Default avatar used before a user uploads their own */
    const DEFAULT_AVATAR =
        'https://ui-avatars.com/api/?name=Guest&background=1B2B8B&color=fff&size=150';

    /* FIX (2026-10-28 — "remove the EM placeholder"): the generic "EM" avatar is
       no longer shown anywhere. Profiles that already carry it (saved by an old
       signup/login fallback) are swapped, at load time, for an avatar built from
       the account's OWN name — a real uploaded photo is never touched. */
    function _isEmAvatar(u) {
        return typeof u === 'string' && /ui-avatars\.com\/api\/?\?[^#]*\bname=EM(&|$)/i.test(u);
    }
    function _nameAvatar(name) {
        return 'https://ui-avatars.com/api/?name=' + encodeURIComponent((name || 'User').trim() || 'User')
            + '&background=1B2B8B&color=fff&size=150';
    }
    function _fixAvatar(p) {
        if (!p) return p && p.avatar;
        if (p.avatar && !_isEmAvatar(p.avatar)) return p.avatar;
        var nm = (p.fullName || '').trim();
        if (!nm || nm.indexOf('@') !== -1) nm = (p.username || (p.email || '').split('@')[0] || 'User');
        return _nameAvatar(nm);
    }

    /** Default cover photo */
    const DEFAULT_COVER =
        'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1200&q=80';


    /* =========================================================================
       §2  FIRESTORE USER HELPERS
       ========================================================================= */

    /**
     * Load a user profile document from Firestore.
     * Returns the profile object with Set fields normalised,
     * or null if the document does not exist or Firebase is unavailable.
     *
     * @param {string} uid — Firebase Auth UID
     * @returns {Promise<Object|null>}
     */
    async function loadUserFromFirestore(uid) {
        if (!uid || !window.fbDb || !window._firebaseLoaded) return null;
        try {
            const doc = await window.fbDb.collection('users').doc(uid).get();
            if (!doc || !doc.exists) return null;
            const data = doc.data();
            _normaliseSets(data);
            if (!data.statuses) data.statuses = [];
            return data;
        } catch (e) {
            console.warn('[Auth] loadUserFromFirestore failed:', e.message);
            return null;
        }
    }
    window.loadUserFromFirestore = loadUserFromFirestore;

    /* FIX (2026-10-28 — "logged into michaelakhigbe94@gmail.com: my picture and
       name aren't shown, just the default 'EM' avatar"): loadUserFromFirestore()
       returns null BOTH when the profile doc genuinely doesn't exist AND when the
       read merely failed (weak/offline connection — this app's field notes are
       full of sub-10 K/s screenshots). Callers treated every null as "brand-new
       user": they built a blank default profile (DEFAULT_AVATAR "EM", no cover,
       no follows, 0 balance) and, in onAuthStateChanged, even wrote it back to
       Firestore with merge:true — overwriting the real profile. This strict
       variant tells the two cases apart and retries transient failures first. */
    async function _loadUserDocStrict(uid) {
        var delays = [0, 1500, 3500];
        for (var i = 0; i < delays.length; i++) {
            if (delays[i]) await new Promise(function (r) { setTimeout(r, delays[i]); });
            if (!uid || !window.fbDb || !window._firebaseLoaded) continue;
            try {
                var doc = await window.fbDb.collection('users').doc(uid).get();
                if (doc && doc.exists) {
                    var data = doc.data();
                    _normaliseSets(data);
                    if (!data.statuses) data.statuses = [];
                    data.avatar = _fixAvatar(data);
                    return { state: 'ok', data: data };
                }
                if (doc && doc.exists === false && !(doc.metadata && doc.metadata.fromCache)) {
                    return { state: 'missing', data: null };
                }
                /* exists:false straight from cache is not proof the doc is absent */
            } catch (e) {
                console.warn('[Auth] users/' + uid + ' read attempt ' + (i + 1) + ' failed:', e && e.message);
            }
        }
        return { state: 'error', data: null };
    }

    /* Cached copy of this account's last-known profile (written by _persistSession). */
    function _cachedProfileForEmail(email) {
        try {
            var all = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
            var e = all[(email || '').toLowerCase()] || all[email];
            if (e && (e.avatar || e.fullName)) { var c = Object.assign({}, e); _normaliseSets(c); c.avatar = _fixAvatar(c); return c; }
        } catch (err) {}
        return null;
    }

    /* When the first read failed, keep trying quietly, then merge the real
       profile into the live session and refresh the visible pieces. */
    function _rehydrateProfileLater(uid, attempt) {
        attempt = attempt || 0;
        if (attempt > 8) return;
        setTimeout(async function () {
            try {
                if (!window.fbAuth || !window.fbAuth.currentUser || window.fbAuth.currentUser.uid !== uid) return;
                var r = await _loadUserDocStrict(uid);
                if (r.state !== 'ok') { _rehydrateProfileLater(uid, attempt + 1); return; }
                var live = (window.EmpState && window.EmpState.userState) || window.userState;
                if (!live || live.id !== uid) return;
                var keep = { password: 1, statuses: 1 };
                Object.keys(r.data).forEach(function (k) { if (!keep[k]) live[k] = r.data[k]; });
                _normaliseSets(live);
                try { _persistSession(live); } catch (e) {}
                ['buildSidebar', 'updateSidebarUser', 'propagateProfilePicture'].forEach(function (fn) {
                    try { if (typeof window[fn] === 'function') window[fn](); } catch (e) {}
                });
                try { if (typeof window.renderUserProfile === 'function') window.renderUserProfile(uid); } catch (e) {}
                console.log('[Auth] Profile re-hydrated from Firestore after an earlier failed read.');
            } catch (e) { _rehydrateProfileLater(uid, attempt + 1); }
        }, attempt === 0 ? 4000 : 10000);
    }

    /* FIX (2026-10-28 — "one browser shows 'Nigeria Democratic Congress', another
       shows the email as the account name"): the display name used to be decided
       per-browser from a mix of sources — this device's localStorage copy, the
       Firebase Auth displayName, and whichever profile snapshot the login path
       happened to have — so two browsers could legitimately disagree. After every
       login this now reads the account's profile straight from the SERVER
       (never the local cache) and makes it the single source of truth: if the
       stored fullName is a real name it wins everywhere; if it is auto-generated
       (empty / the email / the email prefix) the Firebase Auth displayName
       repairs it, and the repair is written back so every browser converges on
       the same name. Applied to the live session, localStorage and the visible UI. */
    function _isAutoName(fn, email) {
        fn = (fn || '').trim();
        var em = (email || '').toLowerCase();
        var raw = em.split('@')[0];
        return !fn || fn.toLowerCase() === em || fn.indexOf('@') !== -1 || fn.toLowerCase() === raw;
    }
    function _syncOwnerIdentity(uid, email, attempt) {
        attempt = attempt || 0;
        var waits = [1500, 4000, 9000, 20000, 40000];
        if (attempt >= waits.length) return;
        setTimeout(async function () {
            try {
                if (!window.fbAuth || !window.fbAuth.currentUser || window.fbAuth.currentUser.uid !== uid) return;
                if (!window.fbDb || !window._firebaseLoaded) { _syncOwnerIdentity(uid, email, attempt + 1); return; }
                var doc = await window.fbDb.collection('users').doc(uid).get({ source: 'server' });
                if (!doc || !doc.exists) return;
                var d = doc.data() || {};
                var name = (d.fullName || '').trim();
                if (_isAutoName(name, email)) {
                    var dn = (window.fbAuth.currentUser.displayName || '').trim();
                    if (dn && !_isAutoName(dn, email)) {
                        name = dn;
                        try { window.fbDb.collection('users').doc(uid).update({ fullName: dn }).catch(function () {}); } catch (e) {}
                    }
                }
                var live = (window.EmpState && window.EmpState.userState) || window.userState;
                if (!live || live.id !== uid) return;
                var changed = false;
                if (name && live.fullName !== name) { live.fullName = name; changed = true; }
                if (d.username && live.username !== d.username) { live.username = d.username; changed = true; }
                var _av = _fixAvatar({ avatar: d.avatar, fullName: name, username: d.username || live.username, email: email });
                if (_av && live.avatar !== _av) { live.avatar = _av; changed = true; }
                if (d.coverPhoto && live.coverPhoto !== d.coverPhoto) { live.coverPhoto = d.coverPhoto; changed = true; }
                if (window.userState && window.userState !== live) {
                    ['fullName', 'username', 'avatar', 'coverPhoto'].forEach(function (k) { if (live[k]) window.userState[k] = live[k]; });
                }
                try {
                    var all = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
                    var key = (email || '').toLowerCase();
                    if (all[key]) {
                        ['fullName', 'username', 'avatar', 'coverPhoto'].forEach(function (k) { if (live[k]) all[key][k] = live[k]; });
                        localStorage.setItem('empyrean_users', JSON.stringify(all));
                    }
                    var sess = JSON.parse(localStorage.getItem('empyrean_session') || 'null');
                    if (sess && (sess.email || '').toLowerCase() === key) {
                        ['fullName', 'username', 'avatar', 'coverPhoto'].forEach(function (k) { if (live[k]) sess[k] = live[k]; });
                        localStorage.setItem('empyrean_session', JSON.stringify(sess));
                    }
                } catch (e) {}
                if (changed) {
                    ['buildSidebar', 'updateSidebarUser', 'propagateProfilePicture'].forEach(function (fn) {
                        try { if (typeof window[fn] === 'function') window[fn](); } catch (e) {}
                    });
                    try { if (typeof window.renderUserProfile === 'function') window.renderUserProfile(uid); } catch (e) {}
                    console.log('[Auth] Account identity synced from server — name: ' + live.fullName);
                }
            } catch (e) {
                console.warn('[Auth] identity sync attempt ' + (attempt + 1) + ' failed:', e && e.message);
                _syncOwnerIdentity(uid, email, attempt + 1);
            }
        }, waits[attempt]);
    }

    /**
     * Write (merge) a user profile to Firestore.
     * Serialises Set fields to plain arrays before writing.
     *
     * BUGFIX (2026-08-04 — profile picture "reverts to local"): this used
     * to silently `return` (no throw, no signal of any kind) whenever
     * !uid || !window.fbDb || !window._firebaseLoaded. Since window.fbDb is
     * pre-stubbed to a truthy mock at page load, the realistic failure case
     * here is window._firebaseLoaded still being false (e.g. a profile
     * picture changed right after login, before Firebase finishes
     * initializing). Every caller of this function (e.g. app-fixes.js's
     * profile-info-form submit handler) just does `await
     * saveUserToFirestore(...)` with no return-value check, so a silent
     * no-op here was indistinguishable from a real save -- the caller went
     * on to show "Profile updated and saved successfully!" even though the
     * new avatar/profile fields never reached Firestore, so they reverted
     * to the old ones on next login/device. Fixed by (1) waiting briefly
     * for window._firebaseLoaded the same way _handleRegisterSubmit already
     * does elsewhere in this file, instead of giving up immediately, and
     * (2) returning true/false so callers can now tell success from
     * silent failure instead of assuming success.
     *
     * @param {string} uid  — Firebase Auth UID
     * @param {Object} data — User profile object
     * @returns {Promise<boolean>} true if the write actually reached Firestore
     */
    async function saveUserToFirestore(uid, data) {
        if (!uid) return false;
        if (!window._firebaseLoaded) {
            await new Promise(function (resolve) {
                let tries = 0;
                const t = setInterval(function () {
                    if (window._firebaseLoaded || ++tries > 20) { clearInterval(t); resolve(); }
                }, 500);
            });
        }
        if (!window.fbDb || !window._firebaseLoaded) return false;
        const safe = Object.assign({}, data);
        SET_KEYS.forEach(function (k) {
            if (safe[k] instanceof Set) safe[k] = Array.from(safe[k]);
        });
        // FIX (2026-08-05, follow-up — this exact "Unsupported field value:
        // a custom Set object" crash has now recurred twice: once because
        // SET_KEYS was missing two fields, and once more because a stale
        // cached copy of this file (see index.html's cache-busting version
        // bump alongside this fix) kept the incomplete list in production
        // even after it was corrected here. Rather than rely a third time
        // on remembering to keep SET_KEYS in sync with every Set field this
        // app ever adds to userState, this generic pass catches ANY
        // remaining Set instance on the object, whether or not its key name
        // is in SET_KEYS, and converts it the same way. SET_KEYS above is
        // left in place (converts the known fields explicitly, so this loop
        // is normally a no-op) rather than removed, since it's harmless and
        // documents which fields are expected to be Sets.
        Object.keys(safe).forEach(function (k) {
            if (safe[k] instanceof Set) safe[k] = Array.from(safe[k]);
        });
        safe.statuses = [];       // never persist blob-URL stories
        delete safe.password;     // never write plaintext password to Firestore
        try {
            await window.fbDb.collection('users').doc(uid).set(safe, { merge: true });
            return true;
        } catch (e) {
            console.warn('[Auth] saveUserToFirestore failed:', e.message);
            return false;
        }
    }
    window.saveUserToFirestore = saveUserToFirestore;


    /* =========================================================================
       §3  SET-FIELD NORMALISER
       ========================================================================= */

    /**
     * Convert any array-or-missing Set fields on a user object to proper Set
     * instances.  Mutates in place.
     * @param {Object} u
     */
    function _normaliseSets(u) {
        if (!u) return;
        SET_KEYS.forEach(function (k) {
            /* FIX (2026-10-28 — "following / followers don't stick after logging out"):
               ROOT CAUSE. This used to be
                   u[k] = new Set(Array.isArray(u[k]) ? u[k] : []);
               which is NOT idempotent: when u[k] is ALREADY a Set, Array.isArray()
               is false, so the Set was replaced by an EMPTY one. The login path runs
               this normaliser more than once on the same object — _loadUserDocStrict()
               normalises the Firestore profile, then _completeFirebaseSignIn() /
               onAuthStateChanged / initializeApp() normalise it again — so every
               signed-in session started with followedUserIds (and likedPostIds,
               retweetedPostIds, ...) wiped to empty, and _persistSession() then saved
               that empty list into localStorage as well. Existing Sets are now kept;
               arrays (Firestore / localStorage shape) are still converted. */
            if (u[k] instanceof Set) return;
            u[k] = new Set(Array.isArray(u[k]) ? u[k] : []);
        });
    }

    /**
     * Produce a localStorage-safe copy of a user object (Sets → arrays,
     * statuses cleared, password removed).
     * @param {Object} u
     * @returns {Object}
     */
    function _serialiseUser(u) {
        const safe = Object.assign({}, u);
        SET_KEYS.forEach(function (k) {
            safe[k] = u[k] instanceof Set ? Array.from(u[k]) : (u[k] || []);
        });
        safe.statuses = [];
        delete safe.password;
        return safe;
    }

    /** Persist current session to localStorage */
    function _persistSession(profile) {
        try {
            localStorage.setItem('empyrean_session', JSON.stringify(_serialiseUser(profile)));
            localStorage.setItem('empyrean_session_email', profile.email || '');
            const stored = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
            stored[profile.email] = _serialiseUser(profile);
            localStorage.setItem('empyrean_users', JSON.stringify(stored));
        } catch (e) {}
    }
    // FIX (bug: "business page doesn't persist — refresh/logout asks to
    // create a new page again", root cause #1): restoreLocalSession() below
    // reads its snapshot ONLY from localStorage (`empyrean_users`), and on a
    // slow connection it wins the race and calls initializeApp() BEFORE the
    // slower Firebase onAuthStateChanged → loadUserFromFirestore() call
    // returns the fresh profile. Any code that mutates userState fields
    // in-memory (e.g. app-business.js attaching a newly created business
    // page to `us.businessPages`) must also write that change back into
    // this same localStorage snapshot, or the next restoreLocalSession()
    // — which can easily win that race on a poor connection — resurrects
    // the OLD snapshot and the business page appears to have vanished.
    // Exposed here so app-business.js (and any other module) can call
    // window._persistSession(userState) right after such a mutation,
    // instead of only updating the in-memory object.
    window._persistSession = _persistSession;


    /* =========================================================================
       §3.5  WEAK-CONNECTIVITY AUTH RETRY
       =========================================================================
       FIX 2026-07-16 ("authentication issue is too strong" — repeated
       auth/network-request-failed on a real 1-2 bar / 10-15 K/s connection,
       confirmed via field console screenshots showing the same error
       recurring for minutes). app-patch-v26.js previously wrapped
       window.fbAuth.signInWithEmailAndPassword from OUTSIDE this file to add
       2 retries (1.5s, 3s — 4.5s total) before giving up; that's nowhere
       near enough for a connection this degraded, and stacking another
       external wrapper on top (as a v32 patch would have) just adds a
       second, harder-to-follow retry layer instead of actually fixing the
       one that matters. Moving the retry here — where the real call and the
       login form's own feedback element live — lets it show live progress
       ("retrying 2/8…") directly in the form instead of a toast, and use a
       much longer, already-proven backoff shape: the exact escalating
       schedule index.html's own /api/config fetch already uses for this
       same kind of connection (that code's own comment calls it "generous
       for a flaky mobile connection"). app-patch-v26.js's external wrap is
       now retired — see that file, left in place but inert per this
       codebase's no-deletion convention, so nothing double-retries.

       Only auth/network-request-failed is retried here. Every other error
       code (wrong-password, user-not-found, etc.) rejects on the very first
       try, exactly as before this fix.
       ========================================================================= */
    var AUTH_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]; // ~121s ceiling total across 8 attempts

    /* FIX (bug: "getting frustrating" — login makes you wait out the FULL
       ~121s network-retry schedule even when this exact device already has
       your credentials cached from a previous successful login): the
       login handler below already has a perfectly good offline fallback
       (Step 3, localStorage) for exactly this situation, but it only ever
       ran AFTER this function exhausted every one of its 8 retries against
       Firebase — so a person with valid, cached local credentials on a
       weak connection was forced through 2 minutes of retrying a network
       call that had no chance of succeeding, before ever reaching the
       fallback that would've logged them in instantly. maxAttempts lets a
       caller cap how many of those 8 attempts to actually use: the login
       handler now passes a short cap (2 quick attempts, ~3s total) when a
       local match exists, since it doesn't need to keep hammering the
       network — and keeps the full 8 when Firebase is the ONLY way in
       (no cached local credentials at all). */
    function _withAuthNetworkRetry(fn, formId, maxAttempts) {
        var cap = (typeof maxAttempts === 'number' && maxAttempts >= 0)
            ? Math.min(maxAttempts, AUTH_RETRY_DELAYS_MS.length)
            : AUTH_RETRY_DELAYS_MS.length;
        var attempt = 0;
        function tryOnce() {
            return fn().catch(function (err) {
                if (err && err.code === 'auth/network-request-failed' && attempt < cap) {
                    var waitMs = AUTH_RETRY_DELAYS_MS[attempt];
                    attempt++;
                    if (typeof window.showFormFeedback === 'function') {
                        window.showFormFeedback(formId,
                            'Weak connection — retrying (' + attempt + '/' + cap + ')…',
                            'warning');
                    }
                    console.warn('[Auth] network-request-failed — retrying in ' + waitMs + 'ms (attempt ' + attempt + '/' + cap + ')');
                    return new Promise(function (resolve) { setTimeout(resolve, waitMs); }).then(tryOnce);
                }
                throw err;
            });
        }
        return tryOnce();
    }


    /* =========================================================================
       §4  CORE APP INITIALISER
       ========================================================================= */

    /**
     * Bootstrap the application for a given session type.
     * Called by: restoreLocalSession, onAuthStateChanged, login handler,
     *            Google sign-in handler, and the admin login path.
     *
     * Debounced: a second call within 1 500 ms is blocked unless it carries a
     * real Firebase UID upgrading from a transient guest session.
     *
     * @param {boolean}     guestMode      — true = guest session
     * @param {boolean}     isAdminUser    — true = admin privileges
     * @param {Object|null} customUserData — profile object; null = use defaults
     */
    function initializeApp(guestMode, isAdminUser, customUserData) {
        isAdminUser    = isAdminUser    || false;
        customUserData = customUserData || null;

        /* ── Debounce guard ── */
        const _now       = Date.now();
        const _upgrading = !guestMode && customUserData && customUserData.id
            && customUserData.id !== 'user-main';

        if (window._initAppRunning
            && ((_now - (window._initAppLastRun || 0)) < 1500)
            && !_upgrading) {
            console.warn('[Auth] initializeApp blocked by debounce.');
            return;
        }
        window._initAppRunning     = true;
        window._initAppLastRun     = _now;
        window._initAppLastGuestMode = guestMode;
        setTimeout(function () { window._initAppRunning = false; }, 1500);

        /* ── Blank-screen guard ── */
        setTimeout(function () {
            const sections   = document.querySelectorAll('.content-section');
            const anyVisible = Array.from(sections).some(function (s) {
                return s.style.display !== 'none' && s.offsetParent !== null;
            });
            if (!anyVisible) {
                sections.forEach(function (s) { s.style.display = 'none'; });
                const dash = document.getElementById('dashboard');
                if (dash) dash.style.display = 'block';
            }
        }, 2500);

        /* Auth modal: close on logged-in. Close (never auto-open) on guest.

           FIX (2026-08-04 — "site not visible/usable unless logged in", the
           actual AdSense/public-browsing blocker): this used to force the
           #auth-modal-overlay open — display:flex + .show + body.modal-open
           — every single time initializeApp(true) ran, which includes the
           NORMAL first-load path for any signed-out visitor (see this
           file's own boot flow at ~line 806/814-815, and index.html's
           fallback at ~line 5979). A full-screen modal covering the whole
           app is exactly what made the site unreachable to a crawler, an
           AdSense reviewer, or any real visitor who hasn't already signed
           up — regardless of robots.txt/sitemap.xml/public /privacy+/terms
           routes already being correct. Guest state itself (guestState,
           the isGuest-aware sidebar/nav in app-nav.js, etc.) was always
           designed to be a real, browsable mode — this modal was the only
           thing overriding that and hard-blocking it.

           The modal is now NEVER opened automatically. It only opens from
           an explicit user action:
             - tapping "Login / Sign Up" in the sidebar footer / header
               (#login-signup-btn, .open-auth-modal — app-auth.js §"auth
               modal open/close" click delegate, unaffected by this edit)
             - a guest attempting a gated create/upload action, which
               redirects them into the signup view (see app-patch-v61.js)
           A guest can now browse the whole public surface of the app —
           dashboard, marketplace, reels, news, NGO partners, individual
           posts/business pages — exactly like a logged-out visitor on any
           normal social app, and only actually creating/uploading content
           prompts sign-up. Sign-out (which also calls initializeApp(true))
           now behaves the same way: it drops back to guest browsing
           instead of re-blocking the whole app behind the modal. */
        const authModal = document.getElementById('auth-modal-overlay');
        if (guestMode) {
            if (authModal) {
                authModal.classList.remove('show');
                authModal.style.display = 'none';
            }
            document.body.classList.remove('modal-open');
        } else {
            /* Logged in: close modal */
            if (authModal) {
                authModal.classList.remove('show');
                authModal.style.display = 'none';
            }
            ['signup-view', 'forgot-password-view', 'auth-action-view'].forEach(function (id) {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
        }

        /* ── Default user shapes ── */
        const guestState = {
            id: null, fullName: 'Guest', username: 'guest',
            avatar: 'https://source.unsplash.com/random/150x150/?avatar',
            coverPhoto: 'https://source.unsplash.com/random/1200x400/?pattern',
            likedPostIds: new Set(), followedUserIds: new Set(),
            retweetedPostIds: new Set(), statuses: [],
            awardedRanks: new Set(), empyBalance: 0,
            isVerified: false, businessPage: null,
            completedTasks: new Set(), viewedStatusUserIds: new Set()
        };

        const defaultUserState = {
            id: 'user-main', fullName: '', username: 'member', email: '',
            password: '', avatar: DEFAULT_AVATAR, coverPhoto: DEFAULT_COVER,
            bio: '', phone: '', website: '', profession: '', education: '',
            maritalStatus: '', hobbies: '', location: '',
            likedPostIds: new Set(), followedUserIds: new Set(),
            retweetedPostIds: new Set(), statuses: [],
            viewedStatusUserIds: new Set(), empyBalance: 0,
            isVerified: false, followerCount: 0, businessPage: null,
            awardedRanks: new Set(), completedTasks: new Set()
        };

        const adminState = Object.assign({}, defaultUserState, {
            id: 'admin-user', fullName: 'Admin User',
            username: 'admin', email: 'admin@empyrean.com'
        });

        /* ── Resolve userState ── */
        const S = window.EmpState;
        let userState;
        if (guestMode) {
            userState = guestState;
        } else if (customUserData) {
            userState = Object.assign({}, guestState, customUserData);
            _normaliseSets(userState);
            userState.avatar = _fixAvatar(userState);

            /* FIX (2026-08-10 — root cause of the "Missing or insufficient
               permissions" burst right at login, visible in the console as
               a FirebaseError + a V38-DIAG unhandled-rejection immediately
               followed by app-patch-openchat.js's own "[OC] Self-healing
               stale userState.id (...) → live Firebase UID (...)" line):
               initializeApp() is the ONE function every one of these
               callers funnels through — _handleLoginSubmit (fresh sign-in,
               already carries the correct live uid), the onAuthStateChanged
               listener a few dozen lines below (also correct), AND
               restoreLocalSession()'s 800ms-delayed call using whatever
               profile snapshot happens to be sitting in
               localStorage['empyrean_users'][email] at that moment — which
               can carry a STALE id (e.g. a synthetic local-<timestamp> id
               persisted before this device's Firebase Auth ever confirmed,
               or simply a previous session's cached copy). On a slow
               connection (this app's own field notes are full of sub-30
               K/s screenshots) restoreLocalSession's 800ms guard window can
               land AFTER a fresh, correct login has already run — its own
               "Firebase already logged in" check only looks at
               isGuest/S.isGuest, which the fresh login has already flipped
               to false, so it does NOT protect against this: it still goes
               ahead and calls initializeApp() with its stale cached id,
               silently clobbering the correct one that was just set.
               Every write/listener that fires in that window uses the
               wrong id, and Firestore's rules (which require
               request.auth.uid to equal the id embedded in the doc being
               written — see firebase-rules.js) reject them outright.
               app-patch-openchat.js's watcher does eventually notice and
               repair userState.id, but only AFTER the damage (failed
               writes, "Loading…"-stuck listeners) already happened, and
               only for id drift — not the moment it's introduced here.
               Closing it at the source instead: whenever a REAL (non-
               anonymous) Firebase Auth session is already active, that
               live uid is authoritative — override whatever id
               customUserData carried with it, for every caller, so no
               stale cached id can ever be installed into userState in the
               first place. guestMode is already excluded above (a guest
               deliberately has no uid to reconcile against). */
            try {
                var _liveUser = window.fbAuth && window.fbAuth.currentUser;
                if (_liveUser && !_liveUser.isAnonymous && _liveUser.uid && userState.id !== _liveUser.uid) {
                    console.warn('[Auth] initializeApp() received a stale id (' + userState.id + ') that doesn\'t match the live Firebase session (' + _liveUser.uid + ') — correcting before it reaches userState.');
                    userState.id = _liveUser.uid;
                }
            } catch (e) {}
        } else {
            userState = isAdminUser ? adminState : defaultUserState;
        }

        /* ── Apply to state ── */
        if (S) {
            S.isGuest   = guestMode;
            S.isAdmin   = isAdminUser;
            S.userState = userState;
            S.cart      = [];
            S.newAvatarFile  = null;
            S.newCoverFile   = null;
            S.newsMediaFile  = null;
            S.newPageProfileFile = null;
            S.newPageCoverFile   = null;
        } else {
            window.isGuest   = guestMode;
            window.isAdmin   = isAdminUser;
            window.userState = userState;
            window.cart      = [];
        }

        const mu = S ? S.mockUsers : window.mockUsers;
        if (userState.id && mu && !mu[userState.id]) mu[userState.id] = userState;

        /* BUG FIX: Synchronise isGuest on ALL global state paths BEFORE any
           rendering call. app-nav._isGuest() checks multiple sources; any stale
           one causes "Guest" to display in the sidebar after a successful login. */
        window.isGuest   = guestMode;
        if (S) S.isGuest = guestMode;
        if (S) S.userState = userState;
        window.userState = userState;

        /* ── Call domain renderers (all guarded — safe if module not yet loaded) ── */
        function _safe(fn) {
            if (typeof window[fn] === 'function') window[fn]();
        }
        _safe('buildSidebar');
        _safe('buildHeader');
        _safe('updateWalletUI');
        _safe('updateCartUI');
        _safe('renderDynamicUI');
        _safe('renderMarketplaceCards');
        _safe('populateBackgroundSelector');
        _safe('populateGiftCatalog');
        _safe('renderGrantLedger');
        _safe('renderNgoGrid');
        _safe('renderDashboardNews');

        if (!guestMode) {
            if (userState.id && typeof window.renderUserProfile === 'function') {
                window.renderUserProfile(userState.id);
            }
            _safe('renderCommunityTasks');
            _safe('renderSuggestedUsers');
            _safe('renderBusinessPage');
            _safe('updateStakingUI');
            _safe('renderContactList');
        }

        if (isAdminUser) {
            /* Load pending SOS queue from Firestore for admin view */
            (async function () {
                try {
                    if (window.fbDb) {
                        const snap = await window.fbDb.collection('sos_queue')
                            .where('status', '==', 'pending_approval').get();
                        if (!snap.empty) {
                            const mq = S ? S.mockAdminSosQueue : window.mockAdminSosQueue;
                            snap.forEach(function (doc) {
                                const d = doc.data();
                                if (!mq.find(function (x) { return x.id === d.id; })) mq.push(d);
                            });
                        }
                    }
                } catch (e) {}
                _safe('renderAdminQueues');
            })();
        }

        /* ── Section navigation ── */
        const lastSection = (function () {
            try { return localStorage.getItem('empyrean_last_section'); } catch (e) { return null; }
        })();
        const sectionToOpen = (!guestMode && !isAdminUser && lastSection
            && document.getElementById(lastSection))
            ? lastSection
            : (!guestMode && !isAdminUser ? 'profile' : 'dashboard');

        /* FIX (2026-08-08 — refresh dropping a signed-in person onto the
           dashboard instead of the section they refreshed from):
           initializeApp() can legitimately run more than once during a
           single page load/refresh — see this file's own anonymous-sign-in
           race history (the same race app-patch-v12.js/v26.js/v31.js were
           written against). index.html's own FINAL BOOT script already
           restores the correct last-visited section as soon as the app is
           ready, BEFORE Firebase Auth has necessarily resolved. If a
           stale/racing initializeApp(true) (guestMode) call lands here
           AFTER that correct restore — while a real Firebase session is
           actually signed in — this used to blindly re-navigate to
           'dashboard' regardless, silently discarding the section the
           person was just on. Skip ONLY that one stale-guest-during-a-
           real-session case; every other call (a genuine guest, a real
           logged-out visitor, or the correct !guestMode call for the
           actual signed-in user) still navigates exactly as before. */
        /* FOLLOW-UP (2026-08-08, same day — still reported after the fix
           above): the check only caught a stale guestMode call that landed
           AFTER window.fbAuth.currentUser had already resolved. The far
           MORE common ordering — this file's own comment two lines up says
           it outright, "BEFORE Firebase Auth has necessarily resolved" — is
           the opposite: the stale guestMode pass fires WHILE auth is still
           resolving, so fbAuth.currentUser is STILL NULL at the exact
           instant this runs. The old check let that case straight through,
           sectionToOpen fell to 'dashboard', and window.navigateTo()
           unconditionally persists whatever section it's given right back
           into localStorage (app-nav.js) — silently overwriting the correct
           restored section with 'dashboard' before the real, !guestMode
           call (moments later, once auth actually resolves) ever gets a
           chance to read the correct value back. By then it's already
           gone, which is exactly why this looked "partially fixed" — it
           only stopped the rarer of the two orderings.

           A stored 'empyrean_session_email' (see this file's own §6 login
           success handler, which sets it, and its sign-out handlers, the
           only places that ever clear it) means this device has a real
           account associated with it. A guestMode call while that's still
           present is presumptively this exact pre-resolution race, not a
           genuine logged-out visitor — regardless of whether
           fbAuth.currentUser has resolved yet — so it's now included in
           the same skip. */
        const _hasExpectedRealSession = (function () {
            try { return !!localStorage.getItem('empyrean_session_email'); } catch (e) { return false; }
        })();
        const staleGuestCallDuringRealSession =
            guestMode && (!!(window.fbAuth && window.fbAuth.currentUser) || _hasExpectedRealSession);
        if (!staleGuestCallDuringRealSession && typeof window.navigateTo === 'function') {
            window.navigateTo(sectionToOpen);
        } else if (staleGuestCallDuringRealSession) {
            console.log('[Auth] Skipped stale guestMode navigateTo(\'' + sectionToOpen + '\') — a real session is expected/active on this device (empyrean_session_email present or fbAuth.currentUser already resolved); the correct section restores once the real, non-guest initializeApp() call runs.');
        }

        /* ── Mobile bottom-nav rebuild ── */
        if (typeof window._buildMobileBottomNav === 'function') {
            setTimeout(window._buildMobileBottomNav, 100);
        }

        /* ── Pre-fill settings fields ── */
        setTimeout(function () {
            if (!guestMode) {
                [
                    ['profile-fullname', 'fullName'],
                    ['profile-username', 'username'],
                    ['profile-bio',      'bio'],
                    ['profile-email',    'email']
                ].forEach(function (pair) {
                    const el = document.getElementById(pair[0]);
                    if (el) el.value = userState[pair[1]] || '';
                });
            }
            /* Fire init-done so notification system + other subscribers respond */
            document.dispatchEvent(new CustomEvent('empyrean-init-done'));
            document.dispatchEvent(new CustomEvent('empyrean-user-ready'));
        }, 300);

        console.log('[Auth] initializeApp — guest:', guestMode, '| admin:', isAdminUser,
            '| user:', userState.fullName || userState.username || '(guest)');
    }
    window.initializeApp = initializeApp;


    /* =========================================================================
       §5  RESTORE LOCAL SESSION (page-load)
       ========================================================================= */

    (function restoreLocalSession() {
        try {
            const sessionEmail = localStorage.getItem('empyrean_session_email');
            if (!sessionEmail) return;
            const stored     = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
            const storedUser = stored[sessionEmail];
            if (!storedUser) return;
            _normaliseSets(storedUser);
            if (!storedUser.statuses) storedUser.statuses = [];

            /* Give Firebase onAuthStateChanged a head-start (800 ms) */
            setTimeout(function () {
                const S = window.EmpState || {};
                if (!S.isGuest && !window.isGuest) return; // Firebase already logged in
                console.log('[Auth] Restoring localStorage session for:', sessionEmail);
                window._listenerRetryCount = 0;
                initializeApp(false, ADMIN_EMAILS.has(storedUser.email), storedUser);

                /* FIX (2026-08-01 — root cause of "Missing or insufficient
                   permissions" recurring across group chat sends, call
                   signaling, and host-mute, even after the Firestore rules
                   were already relaxed to request.auth != null): this
                   branch logs the person into the APP using the cached
                   profile alone — it never itself establishes a real
                   Firebase Auth session, it only assumes one is either
                   already there or on its way. If onAuthStateChanged
                   didn't resolve a real (non-anonymous) user within the
                   800ms head-start above — e.g. Firebase's own IndexedDB
                   persistence didn't survive this browser session —
                   window.fbAuth.currentUser is still null right here, and
                   every Firestore rule in this app requires request.auth
                   != null, so every write this "logged in" session makes
                   silently permission-denies while the UI shows a normal,
                   fully signed-in user. Falls back to an anonymous
                   Firebase Auth session so request.auth is non-null for
                   this tab, matching what every already-relaxed rule in
                   firebase-rules.js expects. Checked fresh right here
                   (not cached) so this never overrides a real session that
                   resolves moments later via onAuthStateChanged. */
                /* FIX (2026-08-01 — regression: "why does a logged-in
                   account turn anonymous" / Firebase Console Authentication
                   tab filling with (anonymous) rows instead of real
                   accounts): this block used to call signInAnonymously()
                   itself, right here, after only an 800ms head-start, the
                   instant window.fbAuth.currentUser was still falsy. That
                   is EXACTLY the race condition app-patch-v11.js's v12
                   section (search "REV.2 FIX" in that file) was written to
                   eliminate — Firebase's real, persisted session restore is
                   known to take longer than a fixed short delay on weak
                   connections (see this app's own field notes on sub-1KB/s
                   mobile signal), and whichever signInAnonymously() call
                   resolves FIRST permanently occupies Firebase Auth's one
                   "current user" slot, with Firebase persistence then
                   remembering THAT (anonymous) session as "last signed in"
                   forever after — even for a real, registered account.
                   v12 already solved this correctly: it waits for
                   onAuthStateChanged's own authoritative first verdict, and
                   additionally gives a real session a 7s grace window
                   (hasExpectedRealSession()) before ever falling back. This
                   block, added independently and later, duplicated the
                   UNSAFE original approach right back in — two uncoordinated
                   callers racing for the same slot is worse than one safe
                   one. Deleting this call entirely and letting v12's own
                   window.addEventListener('empyrean:firebase-ready', ...)
                   + onAuthStateChanged listener be the ONLY place that ever
                   calls signInAnonymously() removes the race without
                   needing any new cross-file coordination — v12 already
                   runs regardless of what happens in this file. */
                console.log('[Auth] Skipping local anonymous-session fallback here — app-patch-v11.js\'s auth watcher (with a real onAuthStateChanged verdict + grace window) already owns this safely; calling it again from here was the cause of real accounts flipping to anonymous.');
            }, 800);
        } catch (e) {}
    })();


    /* =========================================================================
       §6  FIREBASE onAuthStateChanged
       ========================================================================= */

    try {
        window.fbAuth.onAuthStateChanged(async function (fbUser) {
            if (fbUser && !fbUser.isAnonymous) {
                try {
                    const _ld = await _loadUserDocStrict(fbUser.uid);
                    let profile = _ld.data;
                    let _readFailed = (_ld.state === 'error');

                    /* Read FAILED (not "doc missing"): never treat this as a new
                       user and never write a blank profile over the real one. Use
                       this account's cached profile and re-hydrate in the background. */
                    if (!profile && _readFailed && !window._pendingSignupProfile) {
                        const _cached = _cachedProfileForEmail(fbUser.email);
                        if (_cached) {
                            profile = _cached;
                            console.warn('[Auth] Could not read users/' + fbUser.uid + ' — signed in from cached profile; will re-hydrate.');
                            _rehydrateProfileLater(fbUser.uid, 0);
                        }
                    }

                    /* New signup: prefer _pendingSignupProfile (has real form data)
                       over email-prefix fallback, to fix race with onAuthStateChanged */
                    if (!profile) {
                        const _pend = window._pendingSignupProfile;
                        if (_pend && _pend.email === fbUser.email) {
                            profile = Object.assign({}, _pend, { id: fbUser.uid });
                        } else {
                            const _name = fbUser.displayName
                                || (fbUser.email ? fbUser.email.split('@')[0] : 'User');
                            profile = {
                                id:         fbUser.uid,
                                email:      fbUser.email      || '',
                                fullName:   _name,
                                username:   fbUser.email
                                    ? fbUser.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
                                    : 'user' + fbUser.uid.slice(-4),
                                avatar:     fbUser.photoURL   || _nameAvatar(_name),
                                coverPhoto: DEFAULT_COVER,
                                bio: '', empyBalance: 0, isVerified: false,
                                followerCount: 0, businessPage: null,
                                likedPostIds: new Set(), followedUserIds: new Set(),
                                retweetedPostIds: new Set(), awardedRanks: new Set(),
                                completedTasks: new Set(), viewedStatusUserIds: new Set(),
                                statuses: [], createdAt: new Date().toISOString()
                            };
                        }
                        /* Only persist a brand-new profile when the doc is CONFIRMED
                           missing — a failed read must not overwrite a real account. */
                        if (!_readFailed) {
                            try { await saveUserToFirestore(fbUser.uid, profile); } catch (e) {}
                        } else {
                            console.warn('[Auth] Skipped writing a fallback profile to Firestore — the read failed, doc existence unknown.');
                            _rehydrateProfileLater(fbUser.uid, 0);
                        }
                        console.log('[Auth] New user profile created:', fbUser.uid, '| name:', profile.fullName);
                    }

                    profile.id = fbUser.uid;

                    /* FIX (2026-08-07 — "log out of Account A, log in as
                       Account B, business page/profile still shows Account
                       A"): this callback is async (loadUserFromFirestore
                       above is a Firestore round-trip), and this is one of
                       THREE separate onAuthStateChanged listeners registered
                       on the same fbAuth instance (this one, plus two more
                       in app-fixes.js — see those files' own matching
                       2026-08-07 comments). Firebase fires ALL of them on
                       every auth change. If Account A's fetch here is still
                       in flight at the moment the person signs out of A and
                       straight into B, this continuation can resolve AFTER
                       B has already logged in and finished initializeApp —
                       at which point calling initializeApp(..., profile)
                       below would silently overwrite B's fresh session with
                       A's stale one. Firebase Auth's fbAuth.currentUser
                       always reflects whoever is ACTUALLY signed in right
                       now, so re-checking it here (rather than trusting the
                       fbUser this callback closed over, which is frozen at
                       whatever the auth state was WHEN the event fired) is
                       what actually detects "am I still the current user by
                       the time my own fetch came back." If not, this run is
                       stale — bail out before touching any shared state. */
                    if (!window.fbAuth || !window.fbAuth.currentUser
                            || window.fbAuth.currentUser.uid !== fbUser.uid) {
                        console.warn('[Auth] Discarding stale onAuthStateChanged resolution for', fbUser.uid, '— a newer session is already active.');
                        return;
                    }

                    /* Repair stored fullName only when it is clearly an auto-generated
                       placeholder — i.e. the raw email prefix (all lowercase, no spaces,
                       no capitalisation).  A real name like "Emmanuel" that happens to
                       share letters with the email prefix must NOT be replaced.
                       BUG FIX: previous check `(!fn.includes(' ') && fnc === pfx)` was
                       too broad — it flagged any single-word capitalised real name whose
                       lowercase-stripped form equalled the email prefix, causing real
                       names to be overwritten with "email" or "Guest". */
                    (function() {
                        var fn    = (profile.fullName || '').trim();
                        var em    = (profile.email || '').toLowerCase();
                        /* Raw email prefix BEFORE stripping — e.g. "john.doe" */
                        var rawPfx = em.split('@')[0];
                        /* Stripped prefix for fallback comparisons */
                        var pfx   = rawPfx.replace(/[^a-z0-9]/g, '');

                        /* Only consider a name "bad" (auto-generated) when it is:
                           1. Empty / missing
                           2. The full email address itself ("john@gmail.com")
                           3. Contains an "@" (should never be a real name)
                           4. Exactly the raw lowercase email prefix with no capitalisation
                              ("johndoe" or "john.doe" but NOT "John" or "Emmanuel")
                        */
                        var isExactRawPrefix = (fn === rawPfx) || (fn.toLowerCase() === rawPfx);
                        var bad = !fn
                            || fn === em
                            || fn.indexOf('@') !== -1
                            || isExactRawPrefix;

                        if (!bad) return;

                        /* Try Firebase Auth displayName first — this is set by
                           updateProfile() during registration so it has the real name */
                        var fbDN  = fbUser.displayName || '';
                        var fbDNc = fbDN.toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (fbDN && fbDN !== em && fbDN.indexOf('@') === -1
                                && fbDN !== rawPfx && fbDNc !== pfx) {
                            profile.fullName = fbDN;
                        } else {
                            /* Fall back to localStorage signup data */
                            try {
                                var ls  = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
                                var lse = ls[em] || {};
                                var lsn = (lse.fullName || '').trim();
                                /* Accept the localStorage name only if it looks like a real
                                   name — not an email, not the raw prefix, not empty */
                                if (lsn && lsn !== em && lsn.indexOf('@') === -1
                                        && lsn !== rawPfx) {
                                    profile.fullName = lsn;
                                    if (lse.username && lse.username !== pfx)
                                        profile.username = lse.username;
                                }
                            } catch(e) {}
                        }

                        if (profile.fullName !== fn) {
                            /* Write correction back to Firestore + localStorage */
                            try {
                                if (window.fbDb) window.fbDb.collection('users').doc(fbUser.uid)
                                    .update({ fullName: profile.fullName }).catch(function(){});
                            } catch(e) {}
                            try {
                                var ls2 = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
                                if (ls2[em]) { ls2[em].fullName = profile.fullName; }
                                localStorage.setItem('empyrean_users', JSON.stringify(ls2));
                            } catch(e) {}
                            console.log('[Auth] Repaired name for', em, '->', profile.fullName);
                        }
                    })();

                    const S    = window.EmpState || {};
                    const ru   = S.registeredUsers || window.registeredUsers || {};
                    if (profile.email) ru[profile.email] = profile;
                    const mu   = S.mockUsers || window.mockUsers || {};
                    mu[profile.id] = profile;

                    const isAdminUser = ADMIN_EMAILS.has(profile.email);
                    initializeApp(false, isAdminUser, profile);
                    _syncOwnerIdentity(profile.id, profile.email || fbUser.email, 0);

                    /* Reset stale listener handles */
                    ['_postsListener', '_newsListener', '_mktListener',
                     '_reelsListener', '_usersListener', '_sosListener',
                     '_crisisListener', '_announcementsListener'].forEach(function (k) {
                        window[k] = null;
                    });
                    window._suggestedFetchDone      = false;
                    window._firestoreSuggestedUsers = null;

                    /* Start real-time listeners after DOM settles */
                    setTimeout(function () {
                        console.log('[Auth] ✅ Confirmed user:', profile.fullName || profile.email);
                        if (typeof window._startRealtimeListeners  === 'function') window._startRealtimeListeners();
                        if (typeof window.startLiveStreamListener   === 'function') window.startLiveStreamListener();
                        if (typeof window.loadUserNotifications      === 'function') window.loadUserNotifications();

                        /* Real-time user_notifications snapshot */
                        if (window.fbDb && window._firebaseLoaded && profile.id) {
                            window.fbDb.collection('user_notifications')
                                .where('userId', '==', profile.id)
                                .where('read',   '==', false)
                                .orderBy('createdAt', 'desc')
                                .limit(20)
                                .onSnapshot(function (snap) {
                                    if (!snap) return;
                                    snap.docChanges().forEach(function (ch) {
                                        if (ch.type !== 'added') return;
                                        const n = ch.doc.data();
                                        if (!n) return;
                                        if (typeof window.showNotification === 'function') {
                                            window.showNotification(
                                                n.message,
                                                n.type === 'sos_rejected' ? 'error' : (n.type || 'info')
                                            );
                                        }
                                        const badge = document.getElementById('notif-badge');
                                        if (badge) {
                                            badge.textContent    = (parseInt(badge.textContent) || 0) + 1;
                                            badge.style.display  = 'inline-flex';
                                        }
                                        try { ch.doc.ref.update({ read: true }); } catch (e) {}
                                    });
                                }, function (err) {
                                    console.warn('[Notif] listener error:', err.message);
                                });
                        }
                    }, 800);

                } catch (e) {
                    console.error('[Auth] onAuthStateChanged error:', e.message);
                }

            } else {
                /* No Firebase session — try localStorage fallback */
                try {
                    const sessionEmail = localStorage.getItem('empyrean_session_email') || '';
                    if (sessionEmail) {
                        const stored     = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
                        const storedUser = stored[sessionEmail];
                        if (storedUser && !window._initAppRunning) {
                            _normaliseSets(storedUser);
                            if (!storedUser.statuses) storedUser.statuses = [];
                            console.log('[Auth] Restoring localStorage session:', sessionEmail);
                            initializeApp(false, ADMIN_EMAILS.has(storedUser.email), storedUser);
                            setTimeout(function () {
                                if (typeof window._startRealtimeListeners === 'function') window._startRealtimeListeners();
                                if (typeof window.startLiveStreamListener  === 'function') window.startLiveStreamListener();
                            }, 600);
                            return;
                        }
                    }
                } catch (e) {}

                /* Truly no session */
                if (!window._initAppRunning) {
                    console.log('[Auth] No session — initialising as guest.');
                    initializeApp(true);
                }
            }
        });
    } catch (e) {
        console.warn('[Auth] onAuthStateChanged registration failed:', e.message);
        /* Fallback: start as guest immediately */
        setTimeout(function () {
            if (window.EmpState && window.EmpState.isGuest !== false) initializeApp(true);
            else if (window.isGuest !== false)                         initializeApp(true);
        }, 1200);
    }


    /* =========================================================================
       §7  LOGIN HANDLER
       Called from the submit event on #login-form.
       Dual-path: Firebase Auth (primary) → localStorage (offline fallback).
       ========================================================================= */

    /* FIX ("fast login" — a returning user with a verified local password
       match was still forced to sit through Firebase's OWN internal
       network hang before the first attempt even rejects, which can run
       well past this file's own retry delays on a poor connection — the
       delays only govern the wait BETWEEN attempts, not how long the SDK
       takes to give up on the first one, which is exactly what "stuck on
       Signing in…" for a long stretch was). Extracted from the inline
       success-path block so the SAME completion logic can run either
       immediately (normal path) or later, in the background, once a
       fast-tracked local login has already gotten the person into the
       app (see the race in _handleLoginSubmit below). opts.background
       suppresses the modal-close/toast (already handled by the local
       login that got them in first) in favor of a quiet console line,
       since surfacing a second "Welcome back!" after they're already
       using the app would just be confusing chrome, not useful feedback. */
    async function _completeFirebaseSignIn(cred, email, localUser, opts) {
        opts = opts || {};
        const uid     = cred.user.uid;
        const _ld2    = await _loadUserDocStrict(uid);
        let profile   = _ld2.data;
        const S = window.EmpState || {};

        if (!profile && _ld2.state === 'error') {
            /* Read failed — prefer the cached full profile (real avatar/name/follows)
               over a blank default, and fetch the real one in the background. */
            profile = localUser || _cachedProfileForEmail(email);
            _rehydrateProfileLater(uid, 0);
        }

        if (!profile) {
            /* Prefer displayName > localStorage > email prefix for fullName.
               Priority: Firebase Auth displayName (set during registration)
               → localStorage fullName → email prefix as last resort. */
            var _lsAll4   = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
            var _lsUser4  = _lsAll4[email] || {};
            var _rawPfx4  = email.split('@')[0];
            var _fbDN4    = cred.user.displayName || '';
            var _lsName4  = (_lsUser4.fullName || '').trim();
            var _bestName4 = (_fbDN4 && _fbDN4 !== email && _fbDN4 !== _rawPfx4)
                ? _fbDN4
                : (_lsName4 && _lsName4 !== email && _lsName4 !== _rawPfx4)
                    ? _lsName4
                    : _rawPfx4;
            profile = localUser || {
                id: uid,
                fullName: _bestName4,
                email,
                username: (_lsUser4.username && _lsUser4.username !== _rawPfx4.replace(/[^a-z0-9]/gi,'').toLowerCase())
                    ? _lsUser4.username : _rawPfx4.replace(/[^a-z0-9]/gi, '').toLowerCase(),
                avatar: (_lsUser4.avatar && !_isEmAvatar(_lsUser4.avatar)) ? _lsUser4.avatar : _nameAvatar(_bestName4),
                coverPhoto: DEFAULT_COVER,
                bio: '', empyBalance: 0, isVerified: false,
                followerCount: 0, businessPage: null,
                likedPostIds: new Set(), followedUserIds: new Set(),
                retweetedPostIds: new Set(), awardedRanks: new Set(),
                completedTasks: new Set(), viewedStatusUserIds: new Set(),
                statuses: []
            };
            /* Upgrade localUser name too if it stored a bad value */
            if (localUser && (!localUser.fullName || localUser.fullName === email
                    || localUser.fullName === _rawPfx4)) {
                localUser.fullName = _bestName4;
            }
        }
        profile.id = uid;
        _normaliseSets(profile);

        const ru = S.registeredUsers || window.registeredUsers || {};
        ru[email] = profile;
        const mu = S.mockUsers || window.mockUsers || {};
        mu[uid]  = profile;
        _persistSession(profile);

        ['_postsListener','_newsListener','_mktListener',
         '_reelsListener','_usersListener'].forEach(function (k) { window[k] = null; });

        initializeApp(false, ADMIN_EMAILS.has(email), profile);
        _syncOwnerIdentity(uid, email, 0);

        if (opts.background) {
            console.log('[Auth] Background Firebase sign-in finished after the fast local login already let ' + email + ' in — session upgraded to the live uid (' + uid + ').');
        } else {
            const am = document.getElementById('auth-modal-overlay');
            if (am) { am.classList.remove('show'); am.style.display = 'none'; }
            document.body.classList.remove('modal-open');

            if (typeof window.showNotification === 'function') {
                window.showNotification('✅ Welcome back, ' + (profile.fullName || email.split('@')[0]) + '!', 'success');
            }
        }

        setTimeout(function () {
            if (typeof window._startRealtimeListeners === 'function') window._startRealtimeListeners();
            if (typeof window.startLiveStreamListener  === 'function') window.startLiveStreamListener();
            if (typeof window.loadUserNotifications    === 'function') window.loadUserNotifications();
        }, 600);
    }

    var FAST_LOGIN_RACE_MS = 6000; // only ever used when a verified local fallback already exists to race against

    window._handleLoginSubmit = async function (e) {
        e.preventDefault();
        /* Tell the delegated app-fixes.js login handler that this dedicated
           handler is actively taking care of the submission, so it skips
           instead of running its own duplicate sign-in attempt alongside
           this one (that duplication was the cause of the "No account
           found" error flashing on top of a successful login). */
        window._empLoginInFlight = true;
        try {
        const emailEl    = document.getElementById('login-email');
        const passEl     = document.getElementById('login-password');
        const captchaEl  = document.getElementById('login-captcha-input');

        if (!emailEl || !passEl) return;

        const email    = (emailEl.value || '').trim().toLowerCase();
        const password = (passEl.value  || '').trim();

        /* ── Captcha validation ── */
        const S = window.EmpState || {};
        const expectedCaptcha = S.captchaCode || window.captchaCode || '';
        if (captchaEl && expectedCaptcha
            && captchaEl.value.toUpperCase() !== expectedCaptcha.toUpperCase()) {
            if (typeof window.showFormFeedback === 'function') {
                window.showFormFeedback('login', 'Incorrect security code. Please try again.', 'error');
            }
            if (typeof window.generateCaptcha === 'function') window.generateCaptcha();
            return;
        }

        if (!email || !password) {
            if (typeof window.showFormFeedback === 'function') {
                window.showFormFeedback('login', 'Please enter your email and password.', 'error');
            }
            return;
        }

        if (typeof window.showFormFeedback === 'function') {
            window.showFormFeedback('login', 'Signing in…', 'info');
        }

        /* Set when signInWithEmailAndPassword/createUserWithEmailAndPassword
           below ultimately gives up after all retries in
           _withAuthNetworkRetry — lets the final localStorage-fallback
           branch tell "genuinely wrong password" apart from "never actually
           reached the server", instead of showing the misleading
           "Incorrect email or password" for both. */
        let _authNetworkFailed = false;

        /* ── Step 1: Check localStorage ── */
        let localUser = null;
        try {
            const stored = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
            const entry  = stored[email];
            if (entry && entry.password === password) {
                localUser = entry;
                _normaliseSets(localUser);
            }
        } catch (e) {}

        /* ── Step 2: Firebase Auth (primary) ──
           FIX: cap retries to 2 quick attempts (~3s) when a valid cached
           local login already exists — no reason to make someone wait out
           the full ~121s schedule for a network call that has a ready,
           instant fallback. Keep the full 8-attempt schedule when Firebase
           is the only way in (no local match at all).

           FIX (2026-09-02 — "login takes forever"): the "no local match"
           branch above passed `undefined` here, which _withAuthNetworkRetry
           reads as "use every entry in AUTH_RETRY_DELAYS_MS" — 8 attempts,
           ~121 seconds worst case — and, unlike the cached-login branch
           just below, this call is never raced against a timer; the code
           directly `await`s it. On a genuinely weak connection (this is
           exactly the connection class AUTH_RETRY_DELAYS_MS was lengthened
           FOR — see the FIX note above that schedule), an account with no
           cached local password on this device — a first login on a new
           device/browser, or any time site data was cleared — sat on
           "Signing in…" for up to two minutes before either succeeding or
           finally reaching an error. Capped to NO_CACHE_LOGIN_MAX_ATTEMPTS
           (1s+2s+4s+8s+16s = 31s worst case) instead: still roughly 7x more
           retrying than the original 4.5s schedule that was proven "nowhere
           near enough" for a weak connection (so this doesn't reopen that
           bug), while bounding the actual wait to something a person will
           wait out instead of giving up on. Step 3's localStorage fallback
           and the accurate "couldn't reach the server" messaging below are
           unchanged — they still run exactly as before once this shorter
           schedule is exhausted. */
        var NO_CACHE_LOGIN_MAX_ATTEMPTS = 5;
        if (window._firebaseLoaded && window.fbAuth
            && typeof window.fbAuth.signInWithEmailAndPassword === 'function') {
            try {
                const authPromise = _withAuthNetworkRetry(function () {
                    return window.fbAuth.signInWithEmailAndPassword(email, password);
                }, 'login', localUser ? 2 : NO_CACHE_LOGIN_MAX_ATTEMPTS);

                let cred = null;
                let _wentFast = false;

                if (localUser) {
                    /* FAST LOGIN: race the real sign-in against a short
                       timer instead of just waiting on it directly — see
                       _completeFirebaseSignIn's own comment above for why
                       this file's retry delays alone don't bound how long
                       "Signing in…" can sit there on a poor connection.
                       The real attempt is NEVER cancelled if the timer
                       wins; it keeps running and, if it later succeeds,
                       silently upgrades the session onto the live uid via
                       the SAME completion function, in the background. */
                    const race = await Promise.race([
                        authPromise.then(function (c) { return { won: 'firebase', cred: c }; }),
                        new Promise(function (resolve) { setTimeout(function () { resolve({ won: 'timeout' }); }, FAST_LOGIN_RACE_MS); })
                    ]);

                    if (race.won === 'timeout') {
                        _wentFast = true;
                        authPromise
                            .then(function (c) {
                                if (c && c.user) return _completeFirebaseSignIn(c, email, localUser, { background: true });
                            })
                            .catch(function (bgErr) {
                                /* The person is already in via the fast local
                                   login below — a background failure here
                                   (including a genuine wrong-password on the
                                   real account) isn't shown as an error,
                                   since surfacing it now would just be
                                   confusing after they're already using the
                                   app. Logged for diagnosis only. */
                                console.warn('[Auth] Background sign-in (after fast local login) did not complete:', bgErr && bgErr.code, bgErr && bgErr.message);
                            });
                    } else {
                        cred = race.cred;
                    }
                } else {
                    cred = await authPromise;
                }

                if (cred && cred.user) {
                    await _completeFirebaseSignIn(cred, email, localUser);
                    return;
                }
                if (_wentFast) {
                    /* Timed out, not failed — fall through to Step 3 below
                       exactly like a network failure would, WITHOUT
                       treating it as an error (no fbErr was thrown, so the
                       catch block below never runs for this case). */
                    _authNetworkFailed = true;
                }
            } catch (fbErr) {
                /* Wrong password / user-not-found → fall through to localStorage */
                if (fbErr.code === 'auth/wrong-password' || fbErr.code === 'auth/user-not-found') {
                    if (!localUser) {
                        if (typeof window.showFormFeedback === 'function') {
                            window.showFormFeedback('login', 'Incorrect email or password.', 'error');
                        }
                        if (typeof window.generateCaptcha === 'function') window.generateCaptcha();
                        return;
                    }

                    /* FIX (bug: "business page / profile writes fail with
                       'Missing or insufficient permissions' no matter how
                       many times I log in or out"): auth/user-not-found
                       here — with a localUser that DID match on password —
                       means this account only ever exists in localStorage.
                       The register handler below gives every signup a
                       synthetic `local-<timestamp>` id immediately and only
                       upgrades it to a real Firebase Auth uid if
                       createUserWithEmailAndPassword succeeds right then;
                       on a slow connection that step can fail/time out and
                       signup still silently reports success. A `local-...`
                       id can never satisfy `request.auth.uid == userId` in
                       the security rules — there is no request.auth for it
                       at all, since Firebase has no account for this email —
                       so every write to this user's own /users/{id} doc was
                       always going to fail, permanently, regardless of
                       re-login. Self-heal it here: we already just verified
                       this password is correct against the localStorage
                       record, so use it to create the real Firebase Auth
                       account now and migrate the session onto its real
                       uid, instead of falling back to the same broken
                       local-only mode again. */
                    if (window._firebaseLoaded && window.fbAuth
                        && typeof window.fbAuth.createUserWithEmailAndPassword === 'function') {
                        try {
                            const fbCred2 = await _withAuthNetworkRetry(function () {
                                return window.fbAuth.createUserWithEmailAndPassword(email, password);
                            }, 'login');
                            if (fbCred2 && fbCred2.user) {
                                const realUid  = fbCred2.user.uid;
                                const oldLocal = localUser.id;
                                localUser.id   = realUid;

                                try { await fbCred2.user.updateProfile({ displayName: localUser.fullName || '' }); } catch (upErr2) {}
                                await saveUserToFirestore(realUid, localUser);

                                const ru2 = S.registeredUsers || window.registeredUsers || {};
                                ru2[email] = localUser;
                                const mu2 = S.mockUsers || window.mockUsers || {};
                                mu2[realUid] = localUser;
                                if (oldLocal) delete mu2[oldLocal];

                                _persistSession(localUser);
                                try {
                                    const ls3 = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
                                    if (ls3[email]) ls3[email].id = realUid;
                                    localStorage.setItem('empyrean_users', JSON.stringify(ls3));
                                } catch (lsErr3) {}

                                initializeApp(false, ADMIN_EMAILS.has(email), localUser);
                                const am2 = document.getElementById('auth-modal-overlay');
                                if (am2) { am2.classList.remove('show'); am2.style.display = 'none'; }
                                document.body.classList.remove('modal-open');
                                if (typeof window.showNotification === 'function') {
                                    window.showNotification('✅ Welcome back, ' + (localUser.fullName || email) + '!', 'success');
                                }
                                console.log('[Auth] Repaired local-only account -> real Firebase UID:', realUid);
                                return;
                            }
                        } catch (createErr) {
                            /* Genuinely couldn't create it (e.g. this email
                               already has a real Firebase account under a
                               different password) — fall through to the
                               existing localStorage-only behaviour below,
                               unchanged from before this fix. */
                            console.warn('[Auth] Self-heal signup failed:', createErr.code, createErr.message);
                        }
                    }
                } else if (fbErr.code === 'auth/network-request-failed') {
                    /* Exhausted every retry in _withAuthNetworkRetry (~2
                       minutes of attempts) — genuinely unreachable right
                       now, not a login problem. Fall through to the
                       localStorage cache below same as before; if there's
                       no cached match either, the final branch shows an
                       accurate message instead of "Incorrect email or
                       password". */
                    _authNetworkFailed = true;
                    console.warn('[Login] Still unreachable after retries — falling back to local cache if available.');
                } else {
                    console.warn('[Login] Firebase error:', fbErr.code, fbErr.message);
                }
            }
        }

        /* ── Step 3: localStorage-only fallback ── */
        if (localUser) {
            const ru = S.registeredUsers || window.registeredUsers || {};
            ru[email] = localUser;
            _persistSession(localUser);
            initializeApp(false, ADMIN_EMAILS.has(email), localUser);
            const am = document.getElementById('auth-modal-overlay');
            if (am) { am.classList.remove('show'); am.style.display = 'none'; }
            document.body.classList.remove('modal-open');
            if (typeof window.showNotification === 'function') {
                window.showNotification(
                    _authNetworkFailed
                        ? '✅ Signed in offline as ' + (localUser.fullName || email) + ' — will sync once your connection improves.'
                        : '✅ Welcome back, ' + (localUser.fullName || email) + '!',
                    'success'
                );
            }
        } else {
            if (typeof window.showFormFeedback === 'function') {
                window.showFormFeedback('login', _authNetworkFailed
                    ? "Couldn't reach the server after several attempts — check your connection and try again."
                    : 'Incorrect email or password.', 'error');
            }
            /* A network failure isn't a captcha problem — don't force the
               person to re-enter it on top of an already-frustrating wait. */
            if (!_authNetworkFailed && typeof window.generateCaptcha === 'function') window.generateCaptcha();
        }
        } finally {
            window._empLoginInFlight = false;
        }
    };


    /* =========================================================================
       §8  REGISTER HANDLER
       Called from submit on #signup-form.
       Strategy: save to localStorage immediately (works offline), then
       create Firebase Auth account + Firestore profile asynchronously.
       ========================================================================= */

    window._handleRegisterSubmit = async function (e) {
        e.preventDefault();

        const fullNameEl = document.getElementById('signup-fullname');
        const emailEl    = document.getElementById('signup-email');
        const passEl     = document.getElementById('signup-password');
        // FIX (2026-08-25 — DOB year picker): #signup-dob is no longer a
        // single <input type="date"> — index.html now renders it as three
        // <select> dropdowns (Year/Month/Day; see _populateSignupDobSelects
        // above). Combined here into the same 'YYYY-MM-DD' string the rest
        // of this function (and everything downstream — dobMonthDay,
        // Firestore) already expects, so nothing past this point changes.
        const dobYearEl  = document.getElementById('signup-dob-year');
        const dobMonthEl = document.getElementById('signup-dob-month');
        const dobDayEl   = document.getElementById('signup-dob-day');
        const typeEls    = document.querySelectorAll('input[name="user-type"]');

        if (!emailEl || !passEl) return;

        /* FIX (signup details not reaching the profile): #signup-fullname does not exist in
           the form (index.html has First/Last name for individuals and Organisation Name for
           organisations), so fullName was always '' and the account fell back to the email
           prefix. Read the real fields; #signup-fullname is still honoured if it ever returns. */
        const _fnEl  = document.getElementById('signup-fname');
        const _lnEl  = document.getElementById('signup-lname');
        const _orgEl = document.getElementById('signup-orgname');
        const _usrEl = document.getElementById('signup-username');
        const _bioEl = document.getElementById('signup-bio');
        const _phnEl = document.getElementById('signup-phone');
        let _typedName = '';
        if (fullNameEl && fullNameEl.value) _typedName = fullNameEl.value;
        else if (Array.prototype.some.call(typeEls, function (el) { return el.checked && el.value === 'organisation'; }))
            _typedName = _orgEl ? _orgEl.value : '';
        else
            _typedName = ((_fnEl ? _fnEl.value : '') + ' ' + (_lnEl ? _lnEl.value : ''));
        const fullName = _typedName.replace(/\s+/g, ' ').trim();
        const _typedUsername = (_usrEl ? _usrEl.value : '').trim();
        const _typedBio      = (_bioEl ? _bioEl.value : '').trim();
        const _typedPhone    = (_phnEl ? _phnEl.value : '').trim();
        const email    = (emailEl.value || '').trim().toLowerCase();
        const password = (passEl.value  || '').trim();
        const dob      = (dobYearEl && dobMonthEl && dobDayEl && dobYearEl.value && dobMonthEl.value && dobDayEl.value)
            ? (dobYearEl.value + '-' + ('0' + dobMonthEl.value).slice(-2) + '-' + ('0' + dobDayEl.value).slice(-2))
            : ''; // 'YYYY-MM-DD', combined from the three Year/Month/Day selects
        // Derived once at signup so the daily birthday cron (server.js) can
        // run a cheap equality query ('dobMonthDay' == today's 'MM-DD')
        // instead of scanning every user doc and parsing dob client-side —
        // matters once this collection has more than a handful of users.
        const dobMonthDay = dob ? dob.slice(5) : ''; // 'YYYY-MM-DD'.slice(5) === 'MM-DD'
        let   userType = 'individual';
        typeEls.forEach(function (el) { if (el.checked) userType = el.value; });

        if (!email || !password) {
            if (typeof window.showFormFeedback === 'function') {
                window.showFormFeedback('signup', 'Please fill in all required fields.', 'error');
            }
            return;
        }
        // FEATURE (birthday feature — mandatory DOB at registration): checked
        // here alongside the other required-field validation, same pattern,
        // same feedback mechanism. A malformed/future date is also rejected
        // here rather than trusting the <input type="date"> element alone —
        // some mobile browsers still allow free-text entry that bypasses the
        // native date picker's own validation.
        if (!dob) {
            if (typeof window.showFormFeedback === 'function') {
                window.showFormFeedback('signup', 'Please enter your date of birth.', 'error');
            }
            return;
        }
        if (isNaN(new Date(dob).getTime()) || new Date(dob) > new Date()) {
            if (typeof window.showFormFeedback === 'function') {
                window.showFormFeedback('signup', 'Please enter a valid date of birth.', 'error');
            }
            return;
        }
        // FIX (Google Play Child Safety Standards review — minimum age not
        // enforced): the Privacy Policy already states Empyrean is "not
        // directed at children under 13" and, per this session's own
        // policy decision, the platform's actual minimum age is 18 — but
        // nothing here ever checked the DOB collected two blocks above
        // against either number. A signup with any date of birth,
        // including one indicating a young child, was accepted as-is.
        // Computed as a real calendar age (year difference adjusted for
        // whether this year's birthday has occurred yet), not a coarse
        // year subtraction, so someone born 17.9 years ago isn't
        // incorrectly let through.
        var _dobDate  = new Date(dob);
        var _ageToday = new Date();
        var _age = _ageToday.getFullYear() - _dobDate.getFullYear();
        var _hadBirthdayThisYear =
            (_ageToday.getMonth() > _dobDate.getMonth()) ||
            (_ageToday.getMonth() === _dobDate.getMonth() && _ageToday.getDate() >= _dobDate.getDate());
        if (!_hadBirthdayThisYear) _age--;
        if (_age < 18) {
            if (typeof window.showFormFeedback === 'function') {
                window.showFormFeedback('signup', 'You must be at least 18 years old to create an Empyrean account.', 'error');
            }
            return;
        }
        if (password.length < 6) {
            if (typeof window.showFormFeedback === 'function') {
                window.showFormFeedback('signup', 'Password must be at least 6 characters.', 'error');
            }
            return;
        }

        /* Check duplicate email */
        const existingStored = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
        if (existingStored[email]) {
            if (typeof window.showFormFeedback === 'function') {
                window.showFormFeedback('signup', 'That email already has an account. Please log in.', 'warning');
            }
            return;
        }

        /* Accepted: tell app-fixes.js's delegated #signup-form handler to stand down so it
           doesn't race this one for the same Firebase account (see its 'signup-form' case). */
        window._empSignupInFlight = Date.now();

        const S = window.EmpState || {};

        /* ── Picked signup photo ──
           FIX (signup photo not showing on the profile): the chosen photo is staged by
           handleAvatarUpload (app-fixes.js), which only ever wrote it to a private variable,
           so window.newAvatarFile / S.newAvatarFile were always empty here and every account
           got the generated initials avatar. It is now exposed on window; as a safety net the
           file input itself is also read if the staged copy is somehow missing. */
        let _pickedAvatar = window.newAvatarFile || S.newAvatarFile || null;
        if (typeof _pickedAvatar !== 'string' || !/^(data:image|https?:)/.test(_pickedAvatar)) _pickedAvatar = null;
        if (!_pickedAvatar) {
            const _avInput = document.getElementById('signup-avatar');
            const _avFile  = _avInput && _avInput.files && _avInput.files[0];
            if (_avFile && typeof window.resizeAndCropImage === 'function') {
                try {
                    _pickedAvatar = await new Promise(function (resolve) {
                        const _t = setTimeout(function () { resolve(null); }, 8000);
                        window.resizeAndCropImage(_avFile, 150, 150, function (d) { clearTimeout(_t); resolve(d); });
                    });
                } catch (_e) { _pickedAvatar = null; }
            }
        }

        /* ── Build new user object ── */
        const avatarSrc = _pickedAvatar
            || ('https://ui-avatars.com/api/?name='
                + encodeURIComponent(fullName || email.split('@')[0])
                + '&background=1B2B8B&color=fff&size=150');

        const newUser = {
            id:          'local-' + Date.now(),
            fullName:    fullName || email.split('@')[0],
            username:    (/^[a-zA-Z0-9_]{3,20}$/.test(_typedUsername) ? _typedUsername.toLowerCase() : '')
                || (fullName || email.split('@')[0])
                .toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
            email:       email,
            password:    password,
            avatar:      avatarSrc,
            coverPhoto:  DEFAULT_COVER,
            bio:         _typedBio,
            phone:       _typedPhone,
            userType:    userType,
            empyBalance: 0,
            isVerified:  false,
            followerCount: 0,
            businessPage:  null,
            likedPostIds:  new Set(), followedUserIds: new Set(),
            retweetedPostIds: new Set(), awardedRanks: new Set(),
            completedTasks: new Set(), viewedStatusUserIds: new Set(),
            statuses: [],
            // FEATURE ("must follow 15 suggested people before posting, like
            // X/Twitter's onboarding"): only ever set true here, at account
            // creation — never retroactively applied to accounts that
            // already existed before this shipped. Cleared (see
            // app-fixes.js's follow-button handler) the moment
            // followedUserIds first reaches 15; the actual posting gate
            // itself lives at the real create-post-form submit chokepoint
            // in app-fixes.js, not here — this is just where the flag
            // starts life.
            requiresOnboardingFollows: true,
            // FEATURE (birthday feature): dob is 'YYYY-MM-DD', validated
            // mandatory above. dobVisibility defaults to private — a person
            // must opt in via Settings > Profile > Preferences to show it
            // publicly (see index.html's #profile-dob-visibility and
            // app-fixes.js's profile-info-form save handler). Private still
            // means the daily birthday cron in server.js can use it — that
            // job runs server-side with the Admin SDK, which bypasses
            // Firestore's client-facing read rules entirely, so a private
            // DOB still triggers the birthday frame/notification/feed for
            // its owner; "private" only ever means hidden from OTHER users'
            // reads, never from the app's own server logic.
            dob: dob,
            dobMonthDay: dobMonthDay,
            dobVisibility: 'private',
            // Guards the once-per-year frequency requirement — set by
            // server.js's daily birthday-check cron the first time it
            // celebrates this account each year, so a server restart later
            // that same day can't re-trigger the frame/notification/gift
            // window a second time.
            lastBirthdayCelebratedYear: null,
            createdAt: new Date().toISOString()
        };

        /* ── Save to localStorage immediately ── */
        const ru = S.registeredUsers || window.registeredUsers || {};
        const mu = S.mockUsers || window.mockUsers || {};
        ru[email]        = newUser;
        mu[newUser.id]   = newUser;
        existingStored[email] = _serialiseUser(newUser);
        try { localStorage.setItem('empyrean_users', JSON.stringify(existingStored)); } catch (e) {}
        _persistSession(newUser);

        if (typeof window.showFormFeedback === 'function') {
            window.showFormFeedback('signup', '⏳ Creating your account…', 'info');
        }

        /* ── Firebase Auth + Firestore (async) ── */
        try {
            if (!window._firebaseLoaded || !window.fbAuth) {
                /* Wait up to 10 s for Firebase */
                await new Promise(function (resolve) {
                    let tries = 0;
                    const t = setInterval(function () {
                        if (window._firebaseLoaded || ++tries > 20) { clearInterval(t); resolve(); }
                    }, 500);
                });
            }

            if (window._firebaseLoaded && window.fbAuth
                && typeof window.fbAuth.createUserWithEmailAndPassword === 'function') {
                const fbCred = await window.fbAuth.createUserWithEmailAndPassword(email, password);
                if (fbCred && fbCred.user) {
                    newUser.id   = fbCred.user.uid;
                    ru[email].id = fbCred.user.uid;
                    mu[fbCred.user.uid] = newUser;
                    /* Stash signup data so onAuthStateChanged uses real name
                       before Firestore write completes (race condition fix) */
                    window._pendingSignupProfile = newUser;
                    /* Set displayName on Firebase Auth so fbUser.displayName
                       is correct if onAuthStateChanged fires before Firestore */
                    try {
                        await fbCred.user.updateProfile({ displayName: newUser.fullName });
                    } catch (upErr) {
                        console.warn('[Auth] updateProfile failed (non-fatal):', upErr.message);
                    }
                    await saveUserToFirestore(fbCred.user.uid, newUser);
                    window._pendingSignupProfile = null;
                    /* Update localStorage with real UID and correct name */
                    try {
                        const ls2 = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
                        if (ls2[email]) {
                            ls2[email].id       = fbCred.user.uid;
                            ls2[email].fullName = newUser.fullName;
                            ls2[email].username = newUser.username;
                        }
                        localStorage.setItem('empyrean_users', JSON.stringify(ls2));
                    } catch (e) {}
                    console.log('[Auth] Firebase account created. UID:', fbCred.user.uid, '| name:', newUser.fullName);
                }
            }
        } catch (fbErr) {
            if (fbErr.code === 'auth/email-already-in-use') {
                if (typeof window.showNotification === 'function') {
                    window.showNotification('That email already has an account. Please log in.', 'warning');
                }
            } else {
                console.warn('[Register] Firebase error:', fbErr.code, fbErr.message);
            }
        }

        if (typeof window.showFormFeedback === 'function') {
            window.showFormFeedback('signup', '✅ Account created!', 'success');
        }
        if (typeof window.rewardUserForAction === 'function') {
            window.rewardUserForAction('SUCCESSFUL_REFERRAL');
        }

        /* FIX (2026-08-08 — "new users don't know they need to log out and
           log in again" / can't upload media right after signing up):
           createUserWithEmailAndPassword() above already leaves the
           browser with a live, fully authenticated Firebase session
           (fbCred.user / window.fbAuth.currentUser) — Firebase signs a new
           user in automatically as part of account creation, no separate
           login call needed. This function used to throw that away: it
           showed a "you can now log in" message and switched to the LOGIN
           VIEW, requiring the person to manually re-type the password they
           just entered and submit the login form themselves before
           initializeApp(false, ...) ever ran to sync window.userState/
           isGuest/uid to the new account.
           Until that happened, every guest-content-creation gate
           (app-nav.js) and every place that tags a write with
           window.userState.id (e.g. app-dom.js's upload owner segment,
           post/status authorship) was still running off the OLD guest
           state — id null or a stale local- placeholder, isGuest still
           true — which is exactly why uploads/posts silently failed to
           attribute to the new account until a person stumbled onto
           logging in (or a full logout+login) as a workaround.
           Now calls the SAME initializeApp(false, ...) transition every
           other real-login path in this file already uses, directly with
           the account that's already signed in — a brand new user lands
           fully logged in immediately, no extra manual step, no stale
           guest state window for anything to fall into. */
        if (typeof initializeApp === 'function') {
            initializeApp(false, ADMIN_EMAILS.has(email), newUser);
        }

        setTimeout(function () {
            const sv = document.getElementById('signup-view');
            const lv = document.getElementById('login-view');
            if (sv) sv.style.display  = 'none';
            if (lv) lv.style.display  = 'block';
            if (S.newAvatarFile != null) S.newAvatarFile = null;
            else window.newAvatarFile  = null;
            const form = document.getElementById('signup-form');
            if (form) form.reset();
            if (typeof window.handleAvatarUpload === 'function') {
                window.handleAvatarUpload(null, 'avatar-preview');
            }
        }, 1500);
    };


    /* =========================================================================
       §9  GOOGLE SIGN-IN HANDLER
       ========================================================================= */

    window._googleSignInInProgress = false;

    window._handleGoogleSignIn = async function (clickedBtn) {
        // Guard: ignore a second tap while one flow is already running instead
        // of letting two signInWithPopup() calls race (that race — with a
        // second, now-removed handler elsewhere in the app — is what used to
        // make Firebase cancel one of them and surface as "Google sign-in
        // failed. Please try again.").
        if (window._googleSignInInProgress) return;

        if (!window._firebaseLoaded || typeof firebase === 'undefined' || !firebase.auth) {
            if (typeof window.showNotification === 'function') {
                window.showNotification('Google sign-in is not available right now — please check your connection and try again.', 'error');
            }
            return;
        }

        window._googleSignInInProgress = true;

        // Put the actual button the user tapped into a visible "working"
        // state so the tap feels acknowledged instantly, rather than leaving
        // it looking clickable while the popup loads in the background.
        var btns = clickedBtn ? [clickedBtn] : Array.prototype.slice.call(document.querySelectorAll('.btn-google'));
        btns.forEach(function (b) {
            if (!b) return;
            b._origHTML = b._origHTML || b.innerHTML;
            b.disabled = true;
            b.classList.add('btn-google-loading');
            b.innerHTML = '<span class="btn-google-spinner" aria-hidden="true"></span> Signing in…';
        });
        function _resetBtns() {
            btns.forEach(function (b) {
                if (!b) return;
                b.disabled = false;
                b.classList.remove('btn-google-loading');
                if (b._origHTML) b.innerHTML = b._origHTML;
            });
        }

        try {
            const gProvider = new firebase.auth.GoogleAuthProvider();
            gProvider.setCustomParameters({ prompt: 'select_account' });
            const result = await firebase.auth().signInWithPopup(gProvider);
            const fbUser = result.user;
            if (!fbUser) throw new Error('No user returned from Google popup');

            let profile = null;
            try {
                const doc = await window.fbDb.collection('users').doc(fbUser.uid).get();
                if (doc && doc.exists) {
                    profile = doc.data();
                    _normaliseSets(profile);
                }
            } catch (e) {}

            if (!profile) {
                // FIX (Google Play Child Safety Standards review — minimum
                // age not enforced on this signup path): Google's own
                // profile data has no birthdate, so the age gate added to
                // _handleRegisterSubmit's email/password path above never
                // ran for a brand-new account created here. That left a
                // second, completely unguarded way to create an Empyrean
                // account regardless of age. Firebase Auth doesn't expose
                // a way to collect a form field mid-popup-flow, so this
                // asks for a birth year with a plain browser prompt right
                // here, before the profile doc is ever written — good
                // enough to actually enforce the 18+ minimum on this path
                // (a nicer inline modal can replace the prompt() call
                // later without touching the age-check logic itself).
                // Cancelling the prompt or entering an under-18 birth year
                // signs the brand-new Firebase Auth user back out and
                // aborts account creation — nothing is persisted either
                // way. This only runs for a FIRST-TIME sign-in (the
                // `!profile` branch) — an existing account that already
                // completed this check, or the email/password check above,
                // is not re-prompted on every later login.
                var _gYearStr = window.prompt('To finish creating your Empyrean account, please enter your birth year (you must be 18 or older):', '');
                var _gYear = _gYearStr ? parseInt(_gYearStr.trim(), 10) : NaN;
                var _gAge = isNaN(_gYear) ? -1 : (new Date().getFullYear() - _gYear);
                if (isNaN(_gYear) || _gYear < 1900 || _gAge < 18) {
                    try { await firebase.auth().signOut(); } catch (eSignOut) {}
                    _resetBtns();
                    window._googleSignInInProgress = false;
                    if (typeof window.showNotification === 'function') {
                        window.showNotification('You must be at least 18 years old to create an Empyrean account.', 'error');
                    }
                    return;
                }

                profile = {
                    id:          fbUser.uid,
                    fullName:    fbUser.displayName || 'Google User',
                    username:    (fbUser.displayName || 'user')
                        .toLowerCase().replace(/\s+/g, '') + Math.floor(Math.random() * 999),
                    email:       fbUser.email,
                    avatar:      fbUser.photoURL || _nameAvatar(fbUser.displayName || 'Google User'),
                    coverPhoto:  DEFAULT_COVER,
                    bio:         'Joined via Google',
                    empyBalance: 0, isVerified: false,
                    followerCount: 0, businessPage: null,
                    likedPostIds: new Set(), followedUserIds: new Set(),
                    retweetedPostIds: new Set(), awardedRanks: new Set(),
                    completedTasks: new Set(), viewedStatusUserIds: new Set(),
                    statuses: []
                };
                try {
                    await window.fbDb.collection('users').doc(fbUser.uid)
                        .set(profile, { merge: true });
                } catch (e) {}
            }
            if (!profile.statuses) profile.statuses = [];

            const S  = window.EmpState || {};
            const ru = S.registeredUsers || window.registeredUsers || {};
            const mu = S.mockUsers || window.mockUsers || {};
            ru[profile.email] = profile;
            mu[profile.id]    = profile;
            _persistSession(profile);

            if (typeof window.rewardUserForAction === 'function') {
                window.rewardUserForAction('SUCCESSFUL_REFERRAL');
            }
            initializeApp(false, ADMIN_EMAILS.has(profile.email), profile);

            const am = document.getElementById('auth-modal-overlay');
            if (am) { am.classList.remove('show'); am.style.display = 'none'; }
            document.body.classList.remove('modal-open');

            if (typeof window.showNotification === 'function') {
                window.showNotification('✅ Signed in with Google as ' + profile.fullName + '!', 'success');
            }
        } catch (gErr) {
            if (gErr.code === 'auth/popup-closed-by-user' || gErr.code === 'auth/cancelled-popup-request') {
                // User closed the picker or a second tap superseded this one — not a real error, stay quiet.
            } else if (gErr.code === 'auth/popup-blocked') {
                if (typeof window.showNotification === 'function') {
                    window.showNotification('Your browser blocked the Google sign-in popup — allow popups for this site and try again.', 'error');
                }
            } else if (gErr.code === 'auth/network-request-failed') {
                if (typeof window.showNotification === 'function') {
                    window.showNotification('Google sign-in couldn\'t reach the network — check your connection and try again.', 'error');
                }
            } else if (gErr.code === 'auth/unauthorized-domain') {
                console.warn('[Google Auth] Domain not authorized in Firebase console:', window.location.hostname);
                if (typeof window.showNotification === 'function') {
                    window.showNotification('Google sign-in isn\'t set up for this address yet. Please try again later.', 'error');
                }
            } else {
                console.warn('[Google Auth]', gErr.code || '', gErr.message);
                if (typeof window.showNotification === 'function') {
                    window.showNotification('Google sign-in failed. Please try again.', 'error');
                }
            }
        } finally {
            window._googleSignInInProgress = false;
            _resetBtns();
        }
    };


    /* =========================================================================
       §10  FORGOT PASSWORD HANDLER
       ========================================================================= */

    window._handleForgotPassword = async function (e) {
        e.preventDefault();
        const emailEl = document.getElementById('forgot-email');
        if (!emailEl) return;
        const email = (emailEl.value || '').trim().toLowerCase();
        if (!email) {
            if (typeof window.showFormFeedback === 'function') {
                window.showFormFeedback('forgot', 'Please enter your email address.', 'error');
            }
            return;
        }
        try {
            /* FIX (companion to login-form race fix): on a slow connection
               Firebase may simply not have finished initialising yet when
               the user submits this form. Previously that gave an
               immediate, incorrect "Email service unavailable" even for a
               perfectly valid account. Wait briefly for it (same 500ms
               retry pattern app-startup.js already uses) before giving up. */
            let _fpWait = 0;
            while (!window._firebaseLoaded && _fpWait < 6) {
                await new Promise(function (r) { setTimeout(r, 500); });
                _fpWait++;
            }

            if (window._firebaseLoaded && window.fbAuth
                && typeof window.fbAuth.sendPasswordResetEmail === 'function') {
                await window.fbAuth.sendPasswordResetEmail(email);
                if (typeof window.showFormFeedback === 'function') {
                    window.showFormFeedback('forgot', '✅ Reset email sent! Check your inbox.', 'success');
                }
            } else {
                if (typeof window.showFormFeedback === 'function') {
                    window.showFormFeedback('forgot', 'Email service unavailable. Please check your connection and try again.', 'error');
                }
            }
        } catch (err) {
            if (typeof window.showFormFeedback === 'function') {
                window.showFormFeedback('forgot',
                    err.code === 'auth/user-not-found'
                        ? 'No account found with that email.'
                        : 'Failed to send reset email. Please try again.', 'error');
            }
        }
    };


    /* =========================================================================
       §10b  FIREBASE EMAIL-ACTION LINK HANDLER
       ─────────────────────────────────────────────────────────────────────
       Handles the links Firebase Auth emails out for "verify email",
       "reset password", and "recover email" (the built-in Firebase modes:
       verifyEmail / resetPassword / recoverEmail). Those links land back
       on the app's Action URL as e.g.
         https://joinempyrean.com/?mode=resetPassword&oobCode=XXXX&apiKey=YYYY
       Previously nothing on the app read those query params at all, so
       clicking the email link just opened the homepage and did nothing.
       This reuses the existing #auth-modal-overlay (new "auth-action-view"
       pane added in index.html) rather than a dedicated page/route, since
       this is a single-page app and the Action URL only needs to be the
       base domain — Firebase still appends the params to it either way.
       ========================================================================= */

    /** oobCode currently pending a new password (resetPassword mode only). */
    let _pendingResetOobCode = null;

    function _authActionShowStatus(msg) {
        const statusEl = document.getElementById('auth-action-status');
        const formEl   = document.getElementById('auth-action-reset-form');
        const fbEl     = document.getElementById('auth-action-feedback');
        if (fbEl) { fbEl.style.display = 'none'; fbEl.textContent = ''; }
        if (formEl) formEl.style.display = 'none';
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.innerHTML = '<span class="btn-google-spinner" aria-hidden="true"></span> ' + msg;
        }
    }

    function _authActionShowResult(msg, type) {
        const statusEl = document.getElementById('auth-action-status');
        const formEl   = document.getElementById('auth-action-reset-form');
        if (statusEl) statusEl.style.display = 'none';
        if (formEl) formEl.style.display = 'none';
        if (typeof window.showFormFeedback === 'function') {
            window.showFormFeedback('auth-action', msg, type || 'info');
        }
    }

    function _authActionShowResetForm() {
        const statusEl = document.getElementById('auth-action-status');
        const formEl   = document.getElementById('auth-action-reset-form');
        const fbEl     = document.getElementById('auth-action-feedback');
        if (statusEl) statusEl.style.display = 'none';
        if (fbEl) { fbEl.style.display = 'none'; fbEl.textContent = ''; }
        if (formEl) formEl.style.display = 'block';
    }

    /** Friendly copy for the Firebase Auth error codes these actions can throw. */
    function _authActionErrorMessage(err) {
        const code = err && err.code;
        if (code === 'auth/expired-action-code') return 'This link has expired. Please request a new one.';
        if (code === 'auth/invalid-action-code')  return 'This link has already been used or is invalid.';
        if (code === 'auth/user-disabled')        return 'This account has been disabled.';
        if (code === 'auth/user-not-found')       return 'We could not find an account for this link.';
        if (code === 'auth/weak-password')        return 'Please choose a stronger password.';
        return 'This link is invalid or has expired. Please request a new one.';
    }

    /**
     * Reads ?mode=&oobCode= from the URL (if present) and drives the
     * matching Firebase Auth flow, showing progress/result in the
     * auth-action-view pane of the auth modal.
     */
    window._handleAuthActionLink = async function () {
        let params;
        try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
        const mode    = params.get('mode');
        const oobCode = params.get('oobCode');
        if (!mode || !oobCode) return;

        window.openAuthModal('action');
        _authActionShowStatus('Verifying your link…');

        /* Same short retry pattern the forgot-password handler above uses --
           on a slow connection Firebase may not have finished initialising
           yet when this runs. */
        let _waitTries = 0;
        while (!window._firebaseLoaded && _waitTries < 6) {
            await new Promise(function (r) { setTimeout(r, 500); });
            _waitTries++;
        }
        if (!window._firebaseLoaded || !window.fbAuth
            || typeof window.fbAuth.checkActionCode !== 'function') {
            _authActionShowResult('Unable to connect right now. Please check your internet connection and try the link again.', 'error');
            return;
        }

        try {
            const info = await window.fbAuth.checkActionCode(oobCode);

            if (mode === 'verifyEmail') {
                await window.fbAuth.applyActionCode(oobCode);
                if (window.userState && window.userState.id) {
                    window.userState.emailVerified = true;
                    if (typeof window.saveUserToFirestore === 'function') {
                        try { await window.saveUserToFirestore(window.userState.id, { emailVerified: true }); } catch (e) { /* non-fatal */ }
                    }
                }
                _authActionShowResult('✅ Your email has been verified! You can now log in.', 'success');

            } else if (mode === 'resetPassword') {
                _pendingResetOobCode = oobCode;
                _authActionShowResetForm();

            } else if (mode === 'recoverEmail') {
                const restoredEmail = info && info.data && info.data.email;
                await window.fbAuth.applyActionCode(oobCode);
                _authActionShowResult(
                    '✅ Your email change has been reverted' + (restoredEmail ? (' to ' + restoredEmail) : '') +
                    '. If you didn\u2019t request this change, we recommend resetting your password right away.',
                    'warning'
                );

            } else {
                _authActionShowResult('This link is not recognised. It may already have been used.', 'error');
            }
        } catch (err) {
            _authActionShowResult(_authActionErrorMessage(err), 'error');
        } finally {
            /* Strip mode/oobCode/apiKey out of the URL so a refresh doesn't
               try to re-consume a single-use code a second time. */
            try {
                window.history.replaceState({}, document.title, window.location.pathname);
            } catch (e) { /* non-fatal */ }
        }
    };

    /** Submit handler for the "set new password" form shown for resetPassword links. */
    window._handleAuthActionResetSubmit = async function (e) {
        e.preventDefault();
        if (!_pendingResetOobCode) return;
        const pwdEl  = document.getElementById('auth-action-new-password');
        const pwd2El = document.getElementById('auth-action-confirm-password');
        const pwd  = pwdEl  ? (pwdEl.value  || '') : '';
        const pwd2 = pwd2El ? (pwd2El.value || '') : '';

        if (pwd.length < 6) {
            if (typeof window.showFormFeedback === 'function') window.showFormFeedback('auth-action', 'Password must be at least 6 characters.', 'error');
            return;
        }
        if (pwd !== pwd2) {
            if (typeof window.showFormFeedback === 'function') window.showFormFeedback('auth-action', 'Passwords do not match.', 'error');
            return;
        }
        try {
            await window.fbAuth.confirmPasswordReset(_pendingResetOobCode, pwd);
            _pendingResetOobCode = null;
            const formEl = document.getElementById('auth-action-reset-form');
            if (formEl) formEl.style.display = 'none';
            _authActionShowResult('✅ Password updated! You can now log in with your new password.', 'success');
        } catch (err) {
            if (typeof window.showFormFeedback === 'function') window.showFormFeedback('auth-action', _authActionErrorMessage(err), 'error');
        }
    };

    /* Boot trigger: only runs the flow above at all if ?mode=&oobCode= are
       actually present in the URL. Waits for the app's real boot-complete
       signal (same 'empyrean-init-done' event + 6s soft-ceiling fallback
       app-startup.js's post/reel deep-link feature already uses) so this
       runs *after* initializeApp's guest-mode logic has forced the modal
       to the login view -- otherwise that would immediately hide the
       action view we're about to show. */
    (function _wireAuthActionBoot() {
        let bootParams;
        try { bootParams = new URLSearchParams(window.location.search); } catch (e) { return; }
        if (!bootParams.get('oobCode') || !bootParams.get('mode')) return;

        let _fired = false;
        function _runOnce() {
            if (_fired) return;
            _fired = true;
            window._handleAuthActionLink();
        }
        document.addEventListener('empyrean-init-done', _runOnce);
        setTimeout(_runOnce, 6000);
    })();


    /* =========================================================================
       §11  SIGN-OUT HANDLER
       ========================================================================= */

    /**
     * Complete sign-out: clears Firebase session, localStorage, EmpState,
     * and reinitialises as guest.
     */
    async function signOutUser() {
        /* FIX ("logout should automatically end live streaming, but it
           keeps running for hours"): the isLive check further below only
           ends a stream if THIS device's local liveStreamData still says
           isLive — which misses the stream entirely once local state is
           stale, or if sign-out happens on a different device than the
           one actually broadcasting (the account's live doc lives in
           Firestore, not on any one device). window._cleanupMyStaleStreams
           (exposed by app-live-tiktok-patch.js) queries Firestore directly
           for this account's own active_streams docs and kills them — the
           same proven cleanup already used on login and go-live — so it
           works regardless of which device or local state caused the
           mismatch. It reads window.userState.id, so it must run BEFORE
           the reset below wipes it. Firestore's rules already restrict
           this to the account's own docs, so calling it unconditionally
           on every sign-out is harmless even when nothing is live. */
        try {
            if (typeof window._cleanupMyStaleStreams === 'function'
                && window.userState && window.userState.id && !window.isGuest) {
                window._cleanupMyStaleStreams(null);
            }
        } catch (e) {}

        /* FIX (bug: marketplace-tab permission-denied spam after logout,
           still-broken-after-relogin): nothing in the codebase ever told
           per-file Firestore listeners (e.g. app-patch-v20.js's Marketplace/
           Broadcasts tabs) that a sign-out happened, so they kept running
           against Firestore with no auth — every rule that requires
           request.auth != null then rejects them on every write/read.
           Dispatching this lets any file opt in to its own teardown without
           this module needing to know those files' internals. */
        try { document.dispatchEvent(new CustomEvent('empyrean:logout')); } catch (e) {}

        try {
            if (window._firebaseLoaded && window.fbAuth
                && typeof window.fbAuth.signOut === 'function') {
                await window.fbAuth.signOut();
            }
        } catch (e) {}

        /* Clear localStorage session (keep empyrean_users for next login) */
        try {
            localStorage.removeItem('empyrean_session');
            localStorage.removeItem('empyrean_session_email');
        } catch (e) {}

        /* Reset all state */
        if (window.EmpState && typeof window.EmpState.reset === 'function') {
            window.EmpState.reset();
        } else {
            window.isGuest   = true;
            window.isAdmin   = false;
            window.userState = {};
        }

        /* Stop live stream if active (belt-and-suspenders alongside the
           Firestore-query cleanup already run above, before reset) */
        const ld = (window.EmpState && window.EmpState.liveStreamData) || window.liveStreamData || {};
        if (ld.isLive && typeof window.endLiveStream === 'function') {
            window.endLiveStream();
        }

        if (typeof window.showNotification === 'function') {
            window.showNotification('You have been signed out.', 'info');
        }

        initializeApp(true);

        /* FIX (2026-08-04): initializeApp(true) no longer force-opens the
           auth modal (see that function's own comment — the whole point of
           this session's change is that signing out drops back to normal,
           browsable guest mode, not a re-blocked app). This used to be a
           belt-and-suspenders fallback that re-opened the modal a moment
           later "for browsers that are slow" — removing it is intentional,
           not an oversight; keeping it would silently undo the fix above
           400ms after every sign-out. Nothing here anymore — the modal
           stays closed, exactly like the initial guest boot path. */
    }
    window.signOutUser = signOutUser;


    /* =========================================================================
       §11b  DELETE MY ACCOUNT (self-service)
       =========================================================================
       Wires the existing #delete-account-btn (Settings → Security → Danger
       Zone). Fully removes the logged-in user from the platform:

         1. Deletes any business_pages owned by this user + their
            business_posts.
         2. Deletes this user's authored business_posts (pageless too).
         3. Deletes the users/{uid} Firestore profile document.
         4. Deletes the Firebase Auth credential via
            fbAuth.currentUser.delete().

       Firebase requires a RECENT login before currentUser.delete() will
       succeed (auth/requires-recent-login). If that error occurs, this
       shows a password re-entry prompt, re-authenticates via
       reauthenticateWithCredential, then retries the deletion.

       Guests / localStorage-only accounts (no Firebase user) are handled
       by simply clearing local session data.
       ========================================================================= */
    (function initDeleteOwnAccount() {

        function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
        function _notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type); else console.log('[DeleteAccount]', msg); }
        function _fbOk() { return !!(window._firebaseLoaded && window.fbDb && window.fbAuth); }

        /* Delete every doc in a query snapshot, individually, swallowing
           per-doc errors (matches the existing pageDeletes/postsSnap
           convention just below — one bad doc must never abort the rest
           of account deletion). */
        function _deleteSnap(snap) {
            var dels = [];
            snap.forEach(function (doc) { dels.push(doc.ref.delete().catch(function () {})); });
            return Promise.all(dels);
        }
        function _deleteWhere(collectionOrGroupName, isGroup, field, uid) {
            var q = isGroup ? window.fbDb.collectionGroup(collectionOrGroupName) : window.fbDb.collection(collectionOrGroupName);
            return q.where(field, '==', uid).get().then(_deleteSnap).catch(function () {
                // A missing composite index (collectionGroup queries need one
                // per field) must not block the rest of deletion — the doc
                // just survives this pass rather than the whole flow erroring.
                return null;
            });
        }

        /* Wipe this user's Firestore data: their business page(s) + posts,
           any pageless authored posts, their own posts/comments/replies/
           reels/statuses, and finally their user profile document.

           FIX (widened 2026-08-27 — account deletion only ever removed
           business_pages/business_posts + the users/{uid} doc; a
           "deleted" account's actual social posts, comments, replies,
           reels, and statuses stayed on the platform forever, which
           doesn't match what settings-privacy's own policy text promises
           ("we delete... your personal data") or what the Danger Zone
           copy in index.html tells the person ("your... posts... will be
           erased forever"). comments/replies are queried via
           collectionGroup — the same pattern server.js's OGP scan and
           migrate-once.js already use for these same two nested
           subcollections (posts/{id}/comments, comments/{id}/replies) —
           since a flat collection().where() can't reach a subcollection
           nested under every single post.

           DELIBERATELY NOT included here, and not a bug:
             - messages/chats/marketplace_messages — deleting a message
               doc removes it for BOTH participants, not just the account
               being deleted (these are shared docs, unlike a post), and
               senderId/receiverId are already documented elsewhere in
               this codebase (firebase-rules.js's own comments) as
               unreliable against request.auth.uid. Doing this safely
               needs a real per-thread redaction design, not a blind
               where('senderId','==',uid) delete — left for a dedicated
               follow-up rather than guessed at here.
             - kyc_submissions/kyc_selfies, sos_queue, crisis_reports,
               wallet/transaction/withdrawal records — the same
               legally-required-retention carve-out settings-privacy's
               own policy text already states (section 5: "except where
               required to retain records... for legal purposes"); KYC
               and financial records fall under that, identity documents
               and SOS safety reports included. */
        function _wipeFirestoreData(uid) {
            if (!_fbOk() || !uid) return Promise.resolve();
            return window.fbDb.collection('business_pages').where('ownerId', '==', uid).get()
                .then(function (pagesSnap) {
                    var pageDeletes = [];
                    pagesSnap.forEach(function (pageDoc) {
                        var pid = pageDoc.id;
                        pageDeletes.push(
                            window.fbDb.collection('business_posts').where('pageId', '==', pid).get().then(function (postsSnap) {
                                var dels = [];
                                postsSnap.forEach(function (pd) { dels.push(pd.ref.delete().catch(function () {})); });
                                return Promise.all(dels);
                            }).then(function () { return pageDoc.ref.delete().catch(function () {}); })
                        );
                    });
                    return Promise.all(pageDeletes);
                })
                .then(function () { return _deleteWhere('business_posts', false, 'userId', uid); })
                .then(function () { return _deleteWhere('posts', false, 'userId', uid); })
                .then(function () { return _deleteWhere('comments', true, 'userId', uid); })
                .then(function () { return _deleteWhere('replies', true, 'userId', uid); })
                .then(function () { return _deleteWhere('reels', false, 'userId', uid); })
                .then(function () { return _deleteWhere('statuses', false, 'userId', uid); })
                .then(function () { return window.fbDb.collection('users').doc(uid).delete().catch(function () {}); });
        }

        /* Show a small inline password prompt for re-authentication.
           Resolves with the entered password, or rejects if cancelled. */
        function _promptPassword() {
            return new Promise(function (resolve, reject) {
                var existing = document.getElementById('reauth-password-modal');
                if (existing) existing.remove();

                var modal = document.createElement('div');
                modal.id = 'reauth-password-modal';
                modal.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(10,14,39,0.65);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);';
                modal.innerHTML =
                    '<div style="background:#fff;border-radius:18px;width:100%;max-width:380px;padding:24px;box-shadow:0 12px 40px rgba(10,14,39,0.25);">' +
                    '<h3 style="margin:0 0 8px;font-size:1.02rem;font-weight:900;color:#0A0E27;"><i class="fas fa-lock" style="color:#EF4444;margin-right:8px;"></i>Confirm Your Password</h3>' +
                    '<p style="margin:0 0 14px;font-size:0.85rem;color:#6B7280;line-height:1.5;">For your security, please re-enter your password to permanently delete your account.</p>' +
                    '<input type="password" id="reauth-password-input" placeholder="Current password" style="width:100%;box-sizing:border-box;border:1.5px solid rgba(10,14,39,0.12);border-radius:10px;padding:11px 13px;font-size:0.9rem;outline:none;margin-bottom:14px;">' +
                    '<div id="reauth-password-error" style="display:none;color:#EF4444;font-size:0.8rem;margin-bottom:10px;"></div>' +
                    '<div style="display:flex;gap:10px;">' +
                    '<button id="reauth-cancel-btn" style="flex:1;padding:11px;border-radius:10px;background:rgba(10,14,39,0.06);color:#374151;border:none;font-weight:700;cursor:pointer;">Cancel</button>' +
                    '<button id="reauth-confirm-btn" style="flex:1;padding:11px;border-radius:10px;background:#EF4444;color:#fff;border:none;font-weight:800;cursor:pointer;">Confirm</button>' +
                    '</div></div>';
                document.body.appendChild(modal);

                var input = document.getElementById('reauth-password-input');
                input.focus();
                document.getElementById('reauth-cancel-btn').addEventListener('click', function () {
                    modal.remove();
                    reject(new Error('cancelled'));
                });
                document.getElementById('reauth-confirm-btn').addEventListener('click', function () {
                    var pw = input.value || '';
                    if (!pw) {
                        var err = document.getElementById('reauth-password-error');
                        err.textContent = 'Please enter your password.';
                        err.style.display = 'block';
                        return;
                    }
                    modal.remove();
                    resolve(pw);
                });
                input.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') document.getElementById('reauth-confirm-btn').click();
                });
            });
        }

        /* Re-authenticate the current Firebase user with their password,
           then retry currentUser.delete(). */
        function _reauthAndDelete(fbUser, btn) {
            return _promptPassword().then(function (password) {
                if (typeof firebase === 'undefined' || !firebase.auth || !firebase.auth.EmailAuthProvider) {
                    throw new Error('Re-authentication is unavailable in this environment.');
                }
                var cred = firebase.auth.EmailAuthProvider.credential(fbUser.email, password);
                return fbUser.reauthenticateWithCredential(cred).then(function () {
                    return fbUser.delete();
                });
            });
        }

        function _finishLocalCleanup() {
            try {
                localStorage.removeItem('empyrean_session');
                localStorage.removeItem('empyrean_session_email');
                /* Remove this user from the saved-accounts switcher list */
                var raw = localStorage.getItem('empyrean_users');
                if (raw && window.userState && window.userState.email) {
                    var users = JSON.parse(raw);
                    if (users && users[window.userState.email]) {
                        delete users[window.userState.email];
                        localStorage.setItem('empyrean_users', JSON.stringify(users));
                    }
                }
            } catch (e) {}

            if (window.EmpState && typeof window.EmpState.reset === 'function') {
                window.EmpState.reset();
            } else {
                window.isGuest   = true;
                window.isAdmin   = false;
                window.userState = {};
            }

            _notify('Your account has been permanently deleted.', 'success');
            if (typeof initializeApp === 'function') initializeApp(true);
        }

        function _runDeletion(btn) {
            var us  = (window.EmpState && window.EmpState.userState) || window.userState || {};
            var uid = us.id || '';

            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting account…';

            var fbUser = (window._firebaseLoaded && window.fbAuth && window.fbAuth.currentUser) || null;

            _wipeFirestoreData(uid)
                .then(function () {
                    if (!fbUser) return _finishLocalCleanup();
                    return fbUser.delete()
                        .then(_finishLocalCleanup)
                        .catch(function (err) {
                            if (err && err.code === 'auth/requires-recent-login') {
                                return _reauthAndDelete(fbUser, btn).then(_finishLocalCleanup);
                            }
                            throw err;
                        });
                })
                .catch(function (err) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-trash"></i> Delete My Account';
                    if (err && err.message === 'cancelled') return;
                    _notify('Could not delete account: ' + (err && err.message ? err.message : 'Please try again.'), 'error');
                });
        }

        function _wire() {
            var btn = document.getElementById('delete-account-btn');
            if (!btn || btn._wired) return;
            btn._wired = true;
            var originalLabel = btn.innerHTML;

            btn.addEventListener('click', function () {
                if (window.isGuest) { _notify('Please log in first.', 'info'); return; }

                if (!btn._confirming) {
                    btn._confirming = true;
                    btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Tap again to permanently delete your account';
                    setTimeout(function () {
                        if (btn._confirming) {
                            btn._confirming = false;
                            btn.innerHTML = originalLabel;
                        }
                    }, 5000);
                    return;
                }
                btn._confirming = false;
                _runDeletion(btn);
            });
        }

        if (document.readyState !== 'loading') _wire();
        else document.addEventListener('DOMContentLoaded', _wire);
        document.addEventListener('empyrean-init-done', function () { setTimeout(_wire, 400); });
        document.addEventListener('empyrean-section-change', function (ev) {
            if (ev && ev.detail && ev.detail.section === 'settings') setTimeout(_wire, 150);
        });

        console.log('[EmpAuth] ✅ Delete My Account wired — Firestore wipe + Firebase Auth delete + re-auth handling.');
    })();


    /* =========================================================================
       §12  AUTH MODAL — OPEN / CLOSE / VIEW SWITCHING
       ========================================================================= */

    /**
     * Open the auth modal and optionally jump to a specific view.
     * @param {'login'|'signup'|'forgot'} [view='login']
     */
    window.openAuthModal = function openAuthModal(view) {
        view = view || 'login';
        const am = document.getElementById('auth-modal-overlay');
        if (!am) return;
        am.style.display = 'flex';
        am.classList.add('show');
        document.body.classList.add('modal-open');

        ['login-view', 'signup-view', 'forgot-password-view', 'auth-action-view'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        const target = view === 'signup'  ? 'signup-view'
            : view === 'forgot' ? 'forgot-password-view'
            : view === 'action' ? 'auth-action-view'
            : 'login-view';
        const targetEl = document.getElementById(target);
        if (targetEl) targetEl.style.display = 'block';

        if (view === 'login' && typeof window.generateCaptcha === 'function') {
            window.generateCaptcha();
        }
    };

    /** Close the auth modal and reset to login view. */
    window.closeAuthModal = function closeAuthModal() {
        const am = document.getElementById('auth-modal-overlay');
        if (am) { am.classList.remove('show'); am.style.display = 'none'; }
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
    };

    /* Wire form submit events.
       FIX (bug: _handleLoginSubmit never firing -- confirmed via diagnostic
       banner showing ONLY the app-fixes.js delegated fallback ever runs):
       a plain document.addEventListener('DOMContentLoaded', ...) NEVER
       fires if that event has already happened by the time this script
       executes -- and the app already has proof of exactly that failure
       mode a little further up this same file (see _wire() for
       delete-account-btn), which guards against it by checking
       document.readyState first. This block never had that guard, so on
       any load where DOMContentLoaded fires before this point, the
       dedicated login/signup/forgot-password handlers silently never
       attached at all -- app-fixes.js's delegated fallback was quietly
       doing 100% of the real work the whole time. */

    /* FIX (2026-08-25 — "date of birth is difficult to select the year,
       have to scroll and scroll"): #signup-dob used to be a single
       <input type="date">, whose calendar popup is drawn entirely by the
       OS/browser with no reachable year-jump control. index.html now
       renders three plain <select> dropdowns instead (Year / Month /
       Day) — this just builds the Year options (Month/Day options are
       already static markup) and keeps the Day list in sync with
       whichever Year/Month is picked, same as any calendar would clamp
       Feb to 28/29 days. Called once from _wireAuthForms below; safe to
       call again (idempotent via the select's own _empDobWired flag) if
       the signup view is rebuilt/reopened later. */
    function _populateSignupDobSelects() {
        var yearSel  = document.getElementById('signup-dob-year');
        var monthSel = document.getElementById('signup-dob-month');
        var daySel   = document.getElementById('signup-dob-day');
        if (!yearSel || !monthSel || !daySel) return;

        if (!yearSel._empDobWired) {
            yearSel._empDobWired = true;
            var currentYear = new Date().getFullYear();
            var minYear = currentYear - 100; // wide enough for any real signup
            for (var y = currentYear; y >= minYear; y--) {
                var opt = document.createElement('option');
                opt.value = String(y);
                opt.textContent = String(y);
                yearSel.appendChild(opt);
            }
        }

        function rebuildDays() {
            var y = parseInt(yearSel.value, 10);
            var m = parseInt(monthSel.value, 10);
            var keepDay = daySel.value;
            var maxDay = (y && m) ? new Date(y, m, 0).getDate() : 31;
            while (daySel.options.length > 1) daySel.remove(1); // keep the "Day" placeholder
            for (var d = 1; d <= maxDay; d++) {
                var od = document.createElement('option');
                od.value = String(d);
                od.textContent = String(d);
                daySel.appendChild(od);
            }
            // Preserve the previous day if it still fits this month/year
            // (e.g. only clamps away when switching INTO Feb on a day > 28/29).
            if (keepDay && parseInt(keepDay, 10) <= maxDay) daySel.value = keepDay;
        }
        rebuildDays();

        if (!monthSel._empDobWired) {
            monthSel._empDobWired = true;
            monthSel.addEventListener('change', rebuildDays);
        }
        if (!yearSel._empDobRebuildWired) {
            yearSel._empDobRebuildWired = true;
            yearSel.addEventListener('change', rebuildDays);
        }
    }

    function _wireAuthForms() {
        const loginForm     = document.getElementById('login-form');
        const signupForm    = document.getElementById('signup-form');
        const forgotForm    = document.getElementById('forgot-password-form');
        /* FIX: auth-action-reset-form (the "set new password" form shown
           for Firebase resetPassword email links, see §10b) had a handler
           defined at window._handleAuthActionResetSubmit but nothing ever
           attached it here -- same duplicate-handler-list omission this
           block's comment already documents for login/signup/forgot. Left
           unwired, submitting that form did a plain HTML form submit
           (full page reload, oobCode never consumed) instead of calling
           fbAuth.confirmPasswordReset(). */
        const resetForm     = document.getElementById('auth-action-reset-form');
        if (loginForm  && !loginForm._empAuthWired) {
            loginForm._empAuthWired  = true;
            loginForm.addEventListener('submit', window._handleLoginSubmit);
        }
        if (signupForm && !signupForm._empAuthWired) {
            signupForm._empAuthWired = true;
            signupForm.addEventListener('submit', window._handleRegisterSubmit);
            // FEATURE (birthday feature): populate the Year/Month/Day
            // dropdowns (see _populateSignupDobSelects above). The real
            // not-a-future-date enforcement is still the submit-time
            // check in _handleRegisterSubmit below — this only builds the
            // option lists, it doesn't cap what can be picked.
            _populateSignupDobSelects();
        }
        if (forgotForm && !forgotForm._empAuthWired) {
            forgotForm._empAuthWired = true;
            forgotForm.addEventListener('submit', window._handleForgotPassword);
        }
        if (resetForm && !resetForm._empAuthWired) {
            resetForm._empAuthWired = true;
            resetForm.addEventListener('submit', window._handleAuthActionResetSubmit);
        }
    }
    if (document.readyState !== 'loading') _wireAuthForms();
    else document.addEventListener('DOMContentLoaded', _wireAuthForms);
    /* Auth modal can also be rebuilt/opened later by other scripts -- catch that too. */
    document.addEventListener('empyrean-init-done', function () { setTimeout(_wireAuthForms, 400); });

    /* Delegate auth modal button clicks (works even if buttons load later) */
    document.addEventListener('click', function (e) {
        const t = e.target;

        if (t.closest('#login-signup-btn, .open-auth-modal')) {
            e.preventDefault();
            window.openAuthModal('login');
        }
        if (t.closest('#show-signup')) {
            e.preventDefault();
            window.openAuthModal('signup');
        }
        if (t.closest('#show-login, #back-to-login')) {
            e.preventDefault();
            window.openAuthModal('login');
        }
        if (t.closest('#show-forgot-password')) {
            e.preventDefault();
            window.openAuthModal('forgot');
        }
        if (t.closest('.close-modal, .close-modal-btn, #auth-modal-overlay')
            && !t.closest('.auth-card, .modal-card')) {
            window.closeAuthModal();
        }
        if (t.closest('#logout-btn, #admin-logout-btn')) {
            e.preventDefault();
            signOutUser();
        }
        if (t.closest('.btn-google')) {
            e.preventDefault();
            window._handleGoogleSignIn(t.closest('.btn-google'));
        }

        /* #refresh-captcha */
        if (t.id === 'refresh-captcha' || t.closest('#refresh-captcha')) {
            e.preventDefault();
            if (typeof window.generateCaptcha === 'function') window.generateCaptcha();
        }
    });


    /* =========================================================================
       §13  propagateProfilePicture
       ========================================================================= */

    /**
     * Push the current userState.avatar to every avatar element that belongs
     * to the logged-in user.  Call after any avatar update.
     */
    function propagateProfilePicture() {
        const S  = window.EmpState || {};
        const us = S.userState || window.userState || {};
        if (!us.avatar) return;
        const src = us.avatar;

        const sba = document.getElementById('sidebar-user-avatar');
        if (sba) sba.src = src;

        document.querySelectorAll('.user-own-avatar').forEach(function (el) {
            if (el.tagName === 'IMG') el.src = src;
            else el.style.backgroundImage = "url('" + src + "')";
        });

        const ld = S.liveStreamData || window.liveStreamData || {};
        if (ld.hostUserId === us.id) {
            ['live-host-avatar', 'live-stream-host-avatar'].forEach(function (id) {
                const el = document.getElementById(id);
                if (el) el.src = src;
            });
        }

        const sa = document.querySelector('.sidebar-user-avatar');
        if (sa) sa.src = src;
    }
    window.propagateProfilePicture = propagateProfilePicture;


    /* =========================================================================
       §14  LISTENER RETRY + NETWORK RESUME
       ========================================================================= */

    /** Exponential-backoff retry for _startRealtimeListeners on bad connections. */
    window._scheduleListenerRetry = function () {
        window._listenerRetryCount = (window._listenerRetryCount || 0) + 1;
        if (window._listenerRetryCount > 15) {
            console.warn('[Listeners] Max retries — waiting for network.');
            return;
        }
        if (!window._listenerRetryScheduled) {
            window._listenerRetryScheduled = true;
            const delay = Math.min(1500 * window._listenerRetryCount, 12000);
            setTimeout(function () {
                window._listenerRetryScheduled = false;
                if (typeof window._startRealtimeListeners === 'function') {
                    window._startRealtimeListeners();
                }
            }, delay);
        }
    };

    /* Resume listeners when network comes back (critical for Lagos users) */
    if (!window._empyreanOnlineListenerAdded) {
        window._empyreanOnlineListenerAdded = true;
        window.addEventListener('online', function () {
            console.log('[Listeners] Network restored — restarting…');
            window._listenerRetryCount     = 0;
            window._listenerRetryScheduled = false;
            setTimeout(function () {
                if (typeof window._startRealtimeListeners === 'function') {
                    window._startRealtimeListeners();
                }
            }, 1000);
        });
    }

    console.log('[EmpAuth] ✅ Authentication module ready.');

})();