// =====================================================
// FIREBASE PRE-STUBS (v2 — safe re-entry guard)
// Ensures fbAuth/fbDb/fbStorage always exist before
// Firebase SDK loads. If SDK fails, app runs locally.
// Guards against overwriting a successful inline init.
// =====================================================

// Only reset the loaded flag if Firebase hasn't already been initialised
// by the inline head script (which runs _initFirebase via /api/config fetch).
if (!window._firebaseLoaded) {
    window._firebaseLoaded = false;
}
window._firebaseInitAttempts = window._firebaseInitAttempts || 0;

const _noop = () => Promise.resolve({ exists: false, data: () => ({}), user: { uid: 'local-' + Date.now() } });

// Static stub — avoids infinite recursion when chaining .where().orderBy().limit()
const _colStub = {
    add: _noop, set: _noop, get: _noop, update: _noop, delete: _noop,
    where:      function() { return _colStub; },
    orderBy:    function() { return _colStub; },
    limit:      function() { return _colStub; },
    doc:        function() { return _colStub; },
    onSnapshot: function(cb) {
        try { cb({ docs: [], empty: true, forEach: function() {} }); } catch(e) {}
        return function() {};
    }
};
const _col = function() { return _colStub; };

// Only install stubs if real Firebase hasn't set them yet
if (!window._firebaseLoaded) {
    window.fbAuth = window.fbAuth || {
        signInWithEmailAndPassword: _noop,
        createUserWithEmailAndPassword: _noop,
        signOut: () => Promise.resolve(),
        onAuthStateChanged: (cb) => { try { cb(null); } catch (e) {} return () => {}; },
        currentUser: null,
        sendPasswordResetEmail: _noop,
        signInWithPopup: _noop
    };
    window.fbDb = window.fbDb || {
        collection: _col,
        // Critical: batch() stub prevents "fbDb.batch is not a function" in admin reset tool
        batch: function() {
            return {
                delete:  function() { return this; },
                set:     function() { return this; },
                update:  function() { return this; },
                commit:  _noop
            };
        },
        FieldValue: {
            serverTimestamp: () => new Date(),
            arrayUnion: (...a) => a,
            increment: n => n
        }
    };
    // Patch batch() onto existing fbDb stub if it's missing (inline head script omitted it)
    if (window.fbDb && typeof window.fbDb.batch !== 'function') {
        window.fbDb.batch = function() {
            return {
                delete:  function() { return this; },
                set:     function() { return this; },
                update:  function() { return this; },
                commit:  _noop
            };
        };
    }
    window.fbStorage = window.fbStorage || { ref: () => ({ put: _noop, getDownloadURL: _noop }) };
}

// Always (re-)define _initFirebase — this version dispatches empyrean:firebase-ready
window._initFirebase = function () {
    window._firebaseInitAttempts++;
    try {
        if (typeof firebase === 'undefined' || !firebase.initializeApp) {
            console.warn('[Firebase] SDK not available, using local-only mode');
            return false;
        }
        let app;
        try {
            app = firebase.app();
        } catch (e) {
            const cfg = window._appConfig && window._appConfig.firebase;
            if (!cfg || !cfg.apiKey) {
                console.warn('[Firebase] Config not loaded yet — will retry');
                return false;
            }
            app = firebase.initializeApp(cfg);
        }
        window.fbAuth    = firebase.auth();
        window.fbDb      = firebase.firestore();
        window.fbStorage = firebase.storage();
        window._firebaseLoaded = true;

        // FIX (2026-08-18 — "make uploads work on very poor rural
        // connectivity"): the Storage SDK has its OWN internal retry layer
        // for individual failed chunk requests (separate from, and beneath,
        // the client-side stall watchdog in app-dom.js's uploadToCloudinary
        // — that watchdog exists for the different case of a request that
        // hangs with literally zero events, which the SDK's own retry never
        // even sees). By default this internal retry budget
        // (setMaxUploadRetryTime) is 2 minutes — plenty on a normal
        // connection, often not enough for a single video chunk to
        // eventually succeed on a genuinely poor rural link where individual
        // requests can legitimately take longer than that to land. Raised to
        // 10 minutes so more of these blips get absorbed silently at the
        // SDK level (which resumes the SAME chunk, no lost bytes) before
        // ever surfacing as a failure the app has to react to.
        try { firebase.storage().setMaxUploadRetryTime(10 * 60 * 1000); } catch (e) {}

        console.log('[Firebase] ✅ Initialized successfully (attempt ' + window._firebaseInitAttempts + ')');
        // Dispatch event so listeners in index.html and app-startup.js can start
        try { window.dispatchEvent(new CustomEvent('empyrean:firebase-ready')); } catch(e) {}
        return true;
    } catch (err) {
        console.warn('[Firebase] Init failed:', err.message);
        return false;
    }
};