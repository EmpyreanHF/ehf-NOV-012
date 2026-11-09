/* =============================================================================
   EMPYREAN INTERNATIONAL — SPACE-FIX + PATCH v26 (merged)
   app-patch-space-fix-v26.js  |  standalone module

   MERGE NOTE (2026-08-25): combined into one file to get back under
   GitHub's 100-file limit on this plan. Purely mechanical — the former
   app-patch-space-fix.js and app-patch-v26.js are concatenated below
   UNCHANGED, each still in its own IIFE with its own idempotency
   guard/name (empyreanSpaceFix() / empyreanPatchV26_AuthNetworkRetry()),
   so they remain two independent modules that happen to ship in one
   file. Verified neither file is referenced by filename/id from any
   other file in the codebase — app-patch-v26.js is only referenced by
   POSITION in load-order comments elsewhere in index.html ("Load AFTER
   app-patch-v26.js"), never by anything that reaches into its closure —
   so this merge only needs to keep this file loading at that same
   position; nothing about what either module does or when it can run
   changes, only that they now load from one <script> tag instead of
   two. (app-patch-v26.js's own body already returns immediately at its
   top — see its own header — so in practice this merge adds one inert
   legacy module alongside the still-active space/enter-key composer
   fix, with zero interaction between them either way.)

   In index.html: replace the two separate tags
     <script src="app-patch-space-fix.js?v=..."></script>
     <script src="app-patch-v26.js?v=..."></script>
   with the single tag
     <script src="app-patch-space-fix-v26.js?v=20260825a"></script>
   placed where app-patch-v26.js's tag used to be (i.e. AFTER
   app-patch-v25.js), so every existing "Load AFTER app-patch-v26.js"
   comment elsewhere in index.html continues to hold true — the v26
   module still becomes available at that same point in load order,
   just bundled with space-fix instead of loading it separately earlier.

   Original app-patch-space-fix.js header: fixes the static
   #message-text-input composer so Enter sends (no newline), Shift+Enter
   inserts a newline, and Space/every other key behaves like normal
   typing with nothing able to trigger a submit as a side effect.

   Original app-patch-v26.js header: auto-retry auth/network-request-
   failed on weak mobile signal, and replace the misleading "no account
   found" message that could follow a real network failure. RETIRED
   2026-07-16 — the file's body returns immediately at its top; the real
   fix now lives directly in app-auth.js's own "§3.5 WEAK-CONNECTIVITY
   AUTH RETRY" section. Kept (now merged rather than deleted) per this
   codebase's no-deletion convention.
   ============================================================================= */

/* =============================================================================
   EMPYREAN INTERNATIONAL — app-patch-space-fix.js
   Load AFTER app-fixes.js and app-fix-final.js (order doesn't matter much
   relative to app-patch-openchat.js / app-patch-v13.js, but load it after
   index.html has rendered).

   WHAT THIS FILE DOES
   ────────────────────
   Fixes the static #message-text-input composer (index.html's #message-form)
   so that:
     [1] Enter (no Shift)  → sends the message, never inserts a newline
     [2] Shift+Enter       → inserts a newline (multi-line messages)
     [3] Space, and every other key → behaves exactly like normal typing;
         nothing intercepts it, nothing can trigger a submit as a side effect

   WHY THIS WAS NEEDED
   ────────────────────
   #message-text-input used to be a single-line <input type="text"> sitting
   inside a <form> whose only other actionable control was a
   <button type="submit">. Browsers auto-submit a form like that on Enter,
   and on some Android IME/keyboard combos, committing a word via the space
   key can fire a synthetic Enter/change event right behind it — which reads
   as "pressing space sent the message." Converting the field to a
   <textarea> (done in index.html) removes the implicit single-input-form
   submit behavior entirely; this file adds back an explicit, predictable
   Enter/Shift+Enter handler so behavior no longer depends on browser/IME
   guesswork.
   ============================================================================= */
(function empyreanSpaceFix() {
    'use strict';

    function ready(fn) {
        if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn);
    }

    function wire() {
        var form  = document.getElementById('message-form');
        var input = document.getElementById('message-text-input');
        if (!form || !input || input._vfSpaceFix) return;
        input._vfSpaceFix = true;

        /* Auto-grow like the dynamic (#oc-text-input) composer already does */
        input.addEventListener('input', function() {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, Math.max(120, Math.round((window.innerHeight || 600) * 0.4))) + 'px';
        });

        /* On a touch/mobile virtual keyboard, tapping the return/arrow key
           always reports shiftKey:false — there's no way to "hold Shift"
           on a soft keyboard. So on touch devices, Enter must ALWAYS just
           insert a newline; sending only happens via the send button.
           Physical-keyboard devices keep Enter-sends / Shift+Enter-newline. */
        var _isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        input.addEventListener('keydown', function(e) {
            if (e.key !== 'Enter') return;
            if (_isTouchDevice) return; /* let the newline happen naturally */
            if (e.shiftKey) return;
            e.preventDefault();
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        });
    }

    ready(wire);
    document.addEventListener('empyrean-init-done', wire);
    setTimeout(wire, 1000); /* in case the composer HTML is injected late */
})();

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v26
   app-patch-v26.js  |  Load AFTER app-patch-v25.js

   ISSUE: "I can no longer log in" — confirmed via live console diagnostic
   (screenshot, weak mobile signal / ~2.4 K/s throughput):

     [Login] Firebase error: auth/network-request-failed — Firebase: A
     network AuthError (such as timeout, interrupted connection or
     unreachable host) has occurred.

   ROOT CAUSE (confirmed, not guessed): this is NOT a Firestore rules /
   permissions problem like the separate active_streams "Missing or
   insufficient permissions" issue. `auth/network-request-failed` is
   thrown directly by the Firebase Auth SDK itself when the underlying
   HTTPS request to identitytoolkit.googleapis.com never completes —
   confirmed reproducible only on weak mobile data, not on WiFi, with no
   VPN/ad-blocker involved. Neither app-auth.js's nor app-fixes.js's
   login handler has any retry logic around signInWithEmailAndPassword —
   one dropped request and the attempt is simply over.

   Worse: both handlers treat 'auth/network-request-failed' as a signal
   to silently fall through to a localStorage-only check (see
   app-fixes.js's own firebaseErrMap comment: "fall through to local").
   For any account that has never logged in on that specific device
   before, that localStorage check has nothing to match, so the user
   sees "No account found with that email and password. Please sign up
   first." — which is FALSE; the account is fine, the network request to
   verify it just never completed. That's actively misleading at exactly
   the moment (flaky signal) a user most needs an accurate message.

   FIX (two parts, both additive — neither call site in app-auth.js /
   app-fixes.js is touched):

     1. Wrap window.fbAuth.signInWithEmailAndPassword and
        createUserWithEmailAndPassword so that ONLY
        'auth/network-request-failed' triggers up to 2 automatic
        retries with backoff (1.5s, 3s) before the call site ever sees
        a rejection. Most weak-signal blips clear within a couple of
        seconds, so most of these now just quietly succeed. Every other
        error code (wrong-password, user-not-found, etc.) passes through
        immediately, completely unchanged, so the existing fallback
        logic in both handlers keeps working exactly as before.

     2. If all retries are exhausted, record the failure and intercept
        the resulting "No account found..." notification/form-feedback
        (only when it lands within a couple seconds of a recorded
        network failure) and replace it with an accurate message
        instead: "Network issue reaching the server — check your
        connection and try again."
   ============================================================================= */

(function empyreanPatchV26_AuthNetworkRetry() {
    'use strict';

    /* ── RETIRED 2026-07-16 ──────────────────────────────────────────────
       This patch's 2-retry (1.5s/3s, 4.5s total) external wrap around
       fbAuth.signInWithEmailAndPassword/createUserWithEmailAndPassword
       confirmed too short for real weak-signal conditions (field screenshots
       showed the identical error recurring for minutes). The fix now lives
       directly in app-auth.js itself (see its "§3.5 WEAK-CONNECTIVITY AUTH
       RETRY" section) with a much longer, proven backoff (~121s across 8
       attempts) and live progress shown in the login form itself. Leaving
       this file inert rather than deleting it, per this codebase's
       no-deletion convention — an external wrap layered on top of the new
       in-line retry would only double-retry without adding resilience.
       Do not re-enable without removing app-auth.js's own retry first. */
    return;

    if (window._empPatchV26Loaded) {
        console.warn('[V26-AuthRetry] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV26Loaded = true;

    function log(msg)  { console.log('[V26-AuthRetry] ' + msg); }
    function warn(msg) { console.warn('[V26-AuthRetry] ' + msg); }

    var RETRY_DELAYS_MS = [1500, 3000]; // 2 retries: at +1.5s, +3s after the original attempt
    var MISLEADING_MSG = 'No account found with that email and password. Please sign up first.';
    var REPLACEMENT_MSG = 'Network issue reaching the server — check your connection and try again.';
    var FAILURE_ATTRIBUTION_WINDOW_MS = 4000; // how long after a recorded network fail we still intercept the message

    window._lastAuthNetworkFail = 0;

    function delay(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

    function wrapWithRetry(fnName) {
        var target = window.fbAuth && window.fbAuth[fnName];
        if (typeof target !== 'function' || target._pv26Wrapped) return;

        var wrapped = function (email, password) {
            var self = this;
            var attempt = 0;

            function tryOnce() {
                return target.call(self, email, password).catch(function (err) {
                    if (err && err.code === 'auth/network-request-failed' && attempt < RETRY_DELAYS_MS.length) {
                        var waitMs = RETRY_DELAYS_MS[attempt];
                        attempt++;
                        warn(fnName + '() hit auth/network-request-failed — retrying in ' + waitMs + 'ms (attempt ' + attempt + '/' + RETRY_DELAYS_MS.length + ')');
                        return delay(waitMs).then(tryOnce);
                    }
                    if (err && err.code === 'auth/network-request-failed') {
                        window._lastAuthNetworkFail = Date.now();
                        warn(fnName + '() still failing after ' + RETRY_DELAYS_MS.length + ' retries — genuine connectivity issue, giving up.');
                    }
                    throw err;
                });
            }

            return tryOnce();
        };
        wrapped._pv26Wrapped = true;
        window.fbAuth[fnName] = wrapped;
        log('wrapped fbAuth.' + fnName + '() with network-failure retry (' + RETRY_DELAYS_MS.join('ms, ') + 'ms).');
    }

    function wrapAuthMethods() {
        if (!window.fbAuth) return;
        wrapWithRetry('signInWithEmailAndPassword');
        wrapWithRetry('createUserWithEmailAndPassword');
    }

    function withinFailureWindow() {
        return window._lastAuthNetworkFail && (Date.now() - window._lastAuthNetworkFail) < FAILURE_ATTRIBUTION_WINDOW_MS;
    }

    // Intercept the misleading toast notification.
    function wrapShowNotification() {
        var orig = window.showNotification;
        if (typeof orig !== 'function' || orig._pv26Wrapped) return;
        var wrapped = function (message, type, onAction) {
            if (message === MISLEADING_MSG && withinFailureWindow()) {
                log('intercepted misleading "no account found" notification following a real network failure — replacing message.');
                message = REPLACEMENT_MSG;
                type = 'error';
            }
            return orig.call(this, message, type, onAction);
        };
        wrapped._pv26Wrapped = true;
        window.showNotification = wrapped;
        log('wrapped window.showNotification for accurate network-failure messaging.');
    }

    // Intercept the equivalent inline form-feedback path (app-auth.js's
    // login handler uses showFormFeedback for its own "Incorrect email or
    // password" text rather than showNotification, so both are covered).
    function wrapShowFormFeedback() {
        var orig = window.showFormFeedback;
        if (typeof orig !== 'function' || orig._pv26Wrapped) return;
        var wrapped = function (formId, message, type) {
            if (formId === 'login' && (message === 'Incorrect email or password.' || message === MISLEADING_MSG) && withinFailureWindow()) {
                log('intercepted misleading login form-feedback following a real network failure — replacing message.');
                message = REPLACEMENT_MSG;
                type = 'error';
            }
            return orig.call(this, formId, message, type);
        };
        wrapped._pv26Wrapped = true;
        window.showFormFeedback = wrapped;
        log('wrapped window.showFormFeedback for accurate network-failure messaging.');
    }

    function armAll() {
        wrapAuthMethods();
        wrapShowNotification();
        wrapShowFormFeedback();
    }

    armAll();
    // Re-arm shortly after load and again once real Firebase replaces the
    // pre-stub fbAuth object (window.fbAuth is reassigned wholesale at that
    // point, so any earlier wrap on the stub is lost — same pattern v12/v19
    // already use for exactly this reason).
    setTimeout(armAll, 500);
    setTimeout(armAll, 1500);
    window.addEventListener('empyrean:firebase-ready', function () { setTimeout(armAll, 50); });

    console.log('[EmpyreanPatchV26] ✅ Auth sign-in now auto-retries twice (1.5s, 3s) on auth/network-request-failed before giving up, and the misleading "no account found" message that could follow a real network failure now says so accurately instead.');

})();

console.log('[EmpyreanSpaceFixV26Merge] ✅ Composer Enter/Shift+Enter/Space fix (active) + legacy retired auth-retry patch v26 (inert, kept per no-deletion convention) now load from one file.');