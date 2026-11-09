/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v31
   app-patch-v31.js  |  Load LAST (after app-patch-v30.js)

   REPORTED: "can't log in" (since the last fix) + "live streaming no longer
   cross-populates across devices." Diagnosed from the three console
   screenshots supplied (weak 4G, throughput bouncing 6.5 K/s → 58 K/s → 14 K/s
   across them) — both symptoms trace back to the SAME two root causes below,
   not two separate bugs.

   ═══════════════════════════════════════════════════════════════════════
   ROOT CAUSE #1 — anonymous sign-in races an ACTIVE real login attempt
   ═══════════════════════════════════════════════════════════════════════
   app-patch-v12.js's armAuthWatcher() only delays its signInAnonymously()
   fallback when hasExpectedRealSession() is true (a stored
   'empyrean_session_email' from a PREVIOUS session on this device). On a
   device/browser profile logging in for the very first time — exactly what
   the screenshots show, the "Welcome Back" modal is mid-submit — there is no
   stored session email yet, so v12's own onAuthStateChanged(null) handler
   fires trySignInAnonymously() with a 0ms delay, at the exact same moment
   app-auth.js's login handler (wrapped by app-patch-v26.js) is running its
   own signInWithEmailAndPassword() attempt.

   That puts TWO concurrent Firebase Auth network calls in flight on a
   connection weak enough to already be throwing auth/network-request-failed
   on its own (confirmed in all three screenshots). Firebase Auth's client
   SDK has exactly one "current user" slot; two competing sign-in calls
   resolving out of order is a known trigger for Auth/Firestore getting into
   a confused internal state on flaky connections — which is exactly where
   root cause #2 below starts showing up.

   FIX: wrap window.fbAuth.signInAnonymously so it will not fire while a
   real, credentialed sign-in is in flight — checked via a flight flag set
   around signInWithEmailAndPassword / createUserWithEmailAndPassword calls,
   the same functions app-patch-v26.js already wraps for retry logic (this
   composes with that wrap; it doesn't replace it). If anonymous sign-in is
   requested mid-login, it's deferred and retried shortly after the real
   attempt settles, instead of firing alongside it.

   ═══════════════════════════════════════════════════════════════════════
   ROOT CAUSE #2 — "FIRESTORE INTERNAL ASSERTION FAILED: Unexpected state"
   ═══════════════════════════════════════════════════════════════════════
   This exact message is a documented Firebase JS SDK failure mode (SDK
   9.23.0, confirmed in the screenshots), most commonly triggered by rapid
   online/offline flapping combined with enablePersistence({synchronizeTabs:
   true}) (index.html enables this) while listeners/auth are transitioning —
   exactly the condition a bouncing 6–58 K/s mobile signal plus the
   concurrent sign-in race above produces. Once it fires once, EVERY later
   Firestore call in that tab throws the same error again — it does not
   self-heal. That's why the 8:08 AM screenshot shows it looping forever
   with no login attempt even in progress any more: the Firestore client
   itself is wedged for the rest of that page load.

   This is also the actual cause of "live streaming no longer cross-
   populates" — every realtime listener that live-stream sync depends on
   (active_streams, posts, chat, etc. — app-live.js, app-patch-v11.js, and
   others each hold their own onSnapshot subscription in a private closure)
   is bound to that same now-wedged Firestore client instance and silently
   stops delivering updates, with no error visible anywhere near the live
   screen itself.

   Patching each module's private listener closure individually to rebind
   to a fresh Firestore client is exactly the kind of "another layer racing
   the other ones" fix this codebase has already burned time on before (see
   app-patch-v28.js's own header). The one thing actually known to fully
   clear this specific SDK state is a fresh page load. FIX: detect the
   signature via a console.error wrap (this message is logged by the SDK
   directly, not thrown as an uncaught exception, so window.onerror never
   sees it) and reload ONCE, using the exact same sessionStorage single-
   reload guard app-fixes.js already established for its own blank-screen
   recovery — so this can never loop, and if the wedge recurs immediately
   after a reload (e.g. the connection is still down), the person gets a
   clear manual banner instead of a silent reload loop.
   ============================================================================= */

(function empyreanPatchV31() {
    'use strict';

    if (window._empPatchV31Loaded) {
        console.warn('[V31] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV31Loaded = true;

    function log(msg)  { console.log('[V31] ' + msg); }
    function warn(msg) { console.warn('[V31] ' + msg); }

    /* =========================================================================
       §1 — Anonymous sign-in must not race an in-flight real login
       ========================================================================= */
    (function guardAnonAgainstRealLogin() {
        // NOTE: window._empLoginInFlight ALREADY EXISTS (app-auth.js /
        // app-fixes.js) with a DIFFERENT meaning — it spans app-auth.js's
        // whole _handleLoginSubmit() flow (credential call + profile load +
        // UI update) and app-fixes.js reads it to skip its own delegated
        // duplicate-submit handler. Reusing that name here would clear it
        // early (the instant the raw credential call resolves, before
        // app-auth.js's own finally{} does) and reopen the exact duplicate-
        // login bug that flag was added to prevent. Using a distinct,
        // namespaced flag instead — this one only ever needs to answer
        // "is a raw signIn/createUser network call in flight right now,"
        // nothing more.
        window._pv31CredentialCallInFlight = false;

        function wrapCredentialFn(fnName) {
            var target = window.fbAuth && window.fbAuth[fnName];
            if (typeof target !== 'function' || target._pv31FlightWrapped) return;

            var wrapped = function () {
                window._pv31CredentialCallInFlight = true;
                var self = this, args = arguments;
                return target.apply(self, args).then(function (res) {
                    window._pv31CredentialCallInFlight = false;
                    return res;
                }, function (err) {
                    window._pv31CredentialCallInFlight = false;
                    throw err;
                });
            };
            wrapped._pv31FlightWrapped = true;
            // Compose with whatever is already there (e.g. app-patch-v26.js's
            // retry wrapper) rather than replacing it — same "wrap the
            // current value" convention v19/v26/v29 already use.
            window.fbAuth[fnName] = wrapped;
            log('wrapped fbAuth.' + fnName + '() to track in-flight real login attempts.');
        }

        function wrapAnonymous() {
            var target = window.fbAuth && window.fbAuth.signInAnonymously;
            if (typeof target !== 'function' || target._pv31DeferWrapped) return;

            var wrapped = function () {
                var self = this, args = arguments;
                if (window._pv31CredentialCallInFlight) {
                    log('deferring signInAnonymously() — a real credentialed sign-in is currently in flight; retrying in 1200ms.');
                    return new Promise(function (resolve, reject) {
                        setTimeout(function () {
                            (window.fbAuth.signInAnonymously.apply(self, args)).then(resolve, reject);
                        }, 1200);
                    });
                }
                return target.apply(self, args);
            };
            wrapped._pv31DeferWrapped = true;
            window.fbAuth.signInAnonymously = wrapped;
            log('wrapped fbAuth.signInAnonymously() to defer while a real login is in flight.');
        }

        function armAll() {
            if (!window.fbAuth) return;
            wrapCredentialFn('signInWithEmailAndPassword');
            wrapCredentialFn('createUserWithEmailAndPassword');
            wrapAnonymous();
        }

        armAll();
        // Re-arm after load and once real Firebase replaces the pre-stub
        // fbAuth object wholesale — same pattern v12/v19/v26 already rely on.
        setTimeout(armAll, 500);
        setTimeout(armAll, 1500);
        window.addEventListener('empyrean:firebase-ready', function () { setTimeout(armAll, 50); });
    })();

    /* =========================================================================
       §2 — Detect the Firestore internal-assertion wedge and recover once
       ========================================================================= */
    (function guardFirestoreWedge() {
        var RELOAD_KEY = 'empyrean_firestore_wedge_recovery';
        var SIGNATURE = /INTERNAL ASSERTION FAILED/i;
        var _handled = false;

        function showBanner(msg) {
            var el = document.getElementById('_pv31_wedge_banner');
            if (el) { el.textContent = msg; return; }
            el = document.createElement('div');
            el.id = '_pv31_wedge_banner';
            el.textContent = msg;
            el.style.cssText =
                'position:fixed;top:0;left:0;right:0;z-index:999999;' +
                'background:#B00020;color:#fff;font:600 13px/1.4 sans-serif;' +
                'padding:10px 16px;text-align:center;cursor:pointer;';
            el.addEventListener('click', function () { location.reload(); });
            (document.body || document.documentElement).appendChild(el);
        }

        /* FIX (2026-08-28 — "login takes forever / too many retries yet
           never goes through", traced against this file's own §1 credential-
           flight tracking): handleWedge() used to fire the 900ms auto-reload
           completely unconditionally the instant the assertion signature was
           seen in console.error — including the exact moment a real
           signInWithEmailAndPassword()/createUserWithEmailAndPassword() call
           from app-auth.js's _handleLoginSubmit is in flight (the same
           connection quality that produces this Firestore wedge is also
           exactly the connection quality where a slow-but-succeeding login
           request is common). A reload fired in the middle of that credential
           call throws the in-flight promise away before it can resolve — the
           person sees "Signing in…" simply vanish into a full page reload,
           has to re-enter their password, and on a connection bad enough to
           wedge Firestore once, is likely to wedge it again on the very next
           attempt. That reload-during-login loop is what reads as "too many
           retries, never goes through" — not a login bug at all, but this
           file's own recovery step interrupting a login that may well have
           been about to succeed. §1's window._pv31CredentialCallInFlight
           already tracks exactly this window for the anonymous-sign-in guard
           above; reused here for the same purpose rather than adding a
           second tracking mechanism. The reload itself still isn't skipped —
           only delayed until the credential call settles (or a short cap
           expires), so this stays a one-reload-per-session recovery, just no
           longer one that can land mid-login. */
        function _waitForLoginToSettle(cb) {
            var WAIT_CAP_MS = 6000; // never delay recovery indefinitely on a login that itself never settles
            var started = Date.now();
            (function poll() {
                if (!window._pv31CredentialCallInFlight || (Date.now() - started) >= WAIT_CAP_MS) { cb(); return; }
                setTimeout(poll, 250);
            })();
        }

        function handleWedge(detail) {
            if (_handled) return; // one recovery attempt per page load, no matter how many times the message repeats
            _handled = true;
            warn('Detected "FIRESTORE INTERNAL ASSERTION FAILED" — this Firebase SDK state does not self-heal once it occurs (' +
                (detail || '').slice(0, 160) + '…). This is why realtime sync (chat, live-stream cross-device updates, etc.) stops working afterward.');

            var already = false;
            try { already = !!sessionStorage.getItem(RELOAD_KEY); } catch (e) {}

            if (!already) {
                try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch (e) {}
                warn('Reloading once to restore a clean Firestore connection…');
                showBanner('Reconnecting… reloading the app once to restore live sync.');
                _waitForLoginToSettle(function () {
                    setTimeout(function () { location.reload(); }, 900);
                });
            } else {
                // Already tried the automatic reload this session (or a very
                // recent prior one) and the wedge happened again — most likely
                // the connection itself is still down, not something a second
                // silent reload will fix. Never loop; give the person a clear,
                // tappable way to retry instead.
                warn('Already attempted an automatic reload this session — not reloading again automatically (avoids a reload loop on a genuinely dead connection). Showing manual recovery banner.');
                showBanner('Connection trouble — tap here to reload.');
            }
        }

        function wrapConsoleError() {
            var orig = console.error;
            if (orig._pv31Wrapped) return;
            var wrapped = function () {
                try {
                    var joined = Array.prototype.slice.call(arguments).map(function (a) {
                        return (a && a.message) ? a.message : String(a);
                    }).join(' ');
                    if (SIGNATURE.test(joined)) handleWedge(joined);
                } catch (e) { /* never let the detector itself break logging */ }
                return orig.apply(this, arguments);
            };
            wrapped._pv31Wrapped = true;
            console.error = wrapped;
        }
        wrapConsoleError();

        // Clear the one-shot reload guard once the page has been up and
        // stable for a while, so a genuine future recurrence (e.g. a bad
        // connection again tomorrow) still gets its one automatic reload
        // rather than going straight to the manual banner forever.
        setTimeout(function () {
            try { sessionStorage.removeItem(RELOAD_KEY); } catch (e) {}
        }, 5 * 60 * 1000);
    })();

    console.log('[EmpyreanPatchV31] ✅ Anonymous sign-in no longer races an in-flight real login, and a wedged Firestore client (INTERNAL ASSERTION FAILED — the actual cause of both the login instability and live-stream cross-device sync stopping) now recovers with one guarded reload instead of looping forever.');

})();