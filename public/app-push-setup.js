/**
 * app-push-setup.js — Empyrean
 * ─────────────────────────────────────────────────────────────────────────
 * Push notifications, client half only.
 *
 * empyreanPushSetup(): registers the device for push and shows foreground
 * pushes via the in-app bell/toast.
 *   1. Register the firebase-messaging-sw.js service worker (background push)
 *   2. Ask the browser for notification permission
 *   3. Get an FCM Web Push token from Firebase Messaging
 *   4. POST that token to /api/fcm/subscribe so the backend can broadcast
 *      to it via the "empyrean_all" topic (see server.js /api/notify), and
 *      — when a real logged-in identity is available — also persist it
 *      onto users/{uid}.fcmToken so server.js's scheduled-stream reminder
 *      watcher (_checkScheduledStreamReminders) can push a notification to
 *      this specific user instead of only the broadcast topic.
 *   5. Show foreground pushes (app open in an active tab) via the existing
 *      in-app bell/toast (window.pushNotification), since Firebase does NOT
 *      auto-display an OS notification for foreground messages — only the
 *      service worker does that for background ones.
 *
 * Requires: window.fbDb / window._firebaseLoaded (app-startup.js / index.html
 * inline init), window.userState (app-state.js), and the
 * firebase-messaging-compat SDK script tag (added in index.html).
 *
 * Does NOT auto-run on page load — notification permission prompts are
 * disruptive if fired before a user has any reason to trust the app, so
 * this waits for a login event and only asks once per browser
 * (see PERMISSION_ASK_KEY below).
 *
 * UPDATE (2026-07-29): the trigger half that used to live in this file
 * (empyreanPostNotifyTrigger — fired /api/notify on every new post/SOS/
 * crisis doc) has moved into server.js itself — a persistent listener
 * started when the Render server boots, so notifications now fire even
 * when no client has the app open anywhere. See startServerNotifyListeners()
 * in server.js.
 */

// ── PART 1: client push setup ──────────────────────────────────────────
(function empyreanPushSetup() {
    'use strict';

    var PERMISSION_ASK_KEY = 'empyrean_push_asked';

    async function _getConfig() {
        if (window._empyreanConfigCache) return window._empyreanConfigCache;
        var res = await fetch('/api/config');
        if (!res.ok) throw new Error('config fetch failed: ' + res.status);
        var cfg = await res.json();
        window._empyreanConfigCache = cfg;
        return cfg;
    }

    async function _registerServiceWorker(cfg) {
        if (!('serviceWorker' in navigator)) return null;
        // Pass the (public, non-secret) Firebase config via query string —
        // service workers run in a separate scope and can't call the app's
        // normal /api/config fetch before firebase.initializeApp() needs to
        // run at import time, so this is the standard workaround.
        var params = new URLSearchParams({
            apiKey: cfg.firebase.apiKey,
            authDomain: cfg.firebase.authDomain,
            projectId: cfg.firebase.projectId,
            storageBucket: cfg.firebase.storageBucket,
            messagingSenderId: cfg.firebase.messagingSenderId,
            appId: cfg.firebase.appId
        });
        // IMPORTANT: registered at a distinct, narrow scope — NOT "/" — so
        // it doesn't collide with the app's existing service-worker.js
        // (offline app-shell caching, registered at root scope). Two
        // different scripts registered at the identical scope would just
        // replace one registration with the other, silently breaking
        // whichever one lost. Push delivery and showNotification() work
        // fine from a narrow-scope worker; scope only restricts which
        // pages it CONTROLS for fetch/navigation, not push handling.
        return navigator.serviceWorker.register(
            '/firebase-messaging-sw.js?' + params.toString(),
            { scope: '/firebase-cloud-messaging-push-scope' }
        );
    }

    async function _subscribeToken(token) {
        try {
            // uid: NEW — server.js's /api/fcm/subscribe now optionally
            // persists this token onto users/{uid}.fcmToken (Admin SDK
            // write, merge:true) when uid is present, which is what the
            // scheduled-stream reminder watcher (server.js,
            // _checkScheduledStreamReminders) needs to push a targeted
            // notification to a specific host/remind-me user instead of
            // the broadcast topic. Guarded on window.userState/isGuest the
            // same way the rest of this file already gates a real,
            // logged-in identity before doing anything push-related —
            // omitting uid here (e.g. a guest session slipping through)
            // just means that call behaves exactly as it always has:
            // topic-subscribe only, no per-user token stored.
            var uid = (window.userState && !window.isGuest) ? window.userState.id : undefined;
            await fetch('/api/fcm/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(uid ? { token: token, uid: uid } : { token: token })
            });
            console.log('[Push] Subscribed device to broadcast topic' + (uid ? ' and registered token for uid ' + uid + '.' : '.'));
        } catch (err) {
            console.warn('[Push] subscribe call failed:', err.message);
        }
    }

    var PROMPT_RETRY_MS = 3 * 24 * 60 * 60 * 1000;
    var _gestureArmed = false;
    function _armGesturePrompt() {
        if (_gestureArmed) return;
        var last = parseInt(localStorage.getItem(PERMISSION_ASK_KEY + '_ts') || '0', 10);
        if (last && (Date.now() - last) < PROMPT_RETRY_MS) return;
        _gestureArmed = true;
        function onGesture() {
            document.removeEventListener('click', onGesture, true);
            document.removeEventListener('touchend', onGesture, true);
            _gestureArmed = false;
            // Never swallow the tap: capture phase, no preventDefault/stopPropagation.
            Notification.requestPermission().then(function (perm) {
                localStorage.setItem(PERMISSION_ASK_KEY + '_ts', String(Date.now()));
                if (perm === 'granted' || perm === 'denied') localStorage.setItem(PERMISSION_ASK_KEY, '1');
                if (perm === 'granted') initPush();
            }).catch(function () {});
        }
        document.addEventListener('click', onGesture, true);
        document.addEventListener('touchend', onGesture, true);
    }

    async function initPush() {
        try {
            if (!('Notification' in window) || !('serviceWorker' in navigator)) {
                console.log('[Push] Not supported in this browser — skipping.');
                return;
            }
            if (typeof firebase === 'undefined' || !firebase.messaging) {
                console.warn('[Push] firebase-messaging-compat SDK not loaded — skipping.');
                return;
            }

            var cfg = await _getConfig();
            if (!cfg.fcm || !cfg.fcm.vapidKey) {
                console.warn('[Push] FCM_VAPID_KEY not configured on server — skipping push setup.');
                return;
            }

            // Only prompt for permission once per browser, and only if the
            // user hasn't already explicitly denied it (re-asking after a
            // denial just gets auto-rejected by the browser anyway).
            //
            // FIX (2026-08-02): the "asked" flag used to be set BEFORE
            // requestPermission() resolved. That meant if the prompt was
            // ever dismissed without a real answer — or fired during an
            // earlier period when the service worker registration below
            // was broken/misconfigured — this device would be permanently
            // marked "already asked" and would never prompt again, even
            // after the underlying issue was fixed. Now the flag is only
            // set once we have an actual answer from the browser.
            if (Notification.permission === 'denied') return;
            // SUPERSEDED (push fix): requestPermission() was called here with no
            // user gesture — mobile Chrome auto-suppresses/dismisses such prompts
            // and iOS Safari rejects them — and the "asked" flag was then set
            // for good even though the person never actually answered, so most
            // devices were never registered for push and never asked again.
            // Disabled, not deleted; replacement below.
            if (false && Notification.permission !== 'granted') {
                if (localStorage.getItem(PERMISSION_ASK_KEY)) return; // already asked once
                var perm = await Notification.requestPermission();
                localStorage.setItem(PERMISSION_ASK_KEY, '1');
                if (perm !== 'granted') return;
            }
            if (Notification.permission !== 'granted') {
                // Ask inside a real tap, and re-ask after a dismissal (3 days)
                // instead of never. The old PERMISSION_ASK_KEY is deliberately
                // ignored here so devices it already locked out get asked again.
                _armGesturePrompt();
                return;
            }

            // FIX (2026-08-02): isolate service worker registration so a
            // failure here (e.g. the file 404ing, as it did when it was
            // misplaced outside public/) only breaks background push —
            // not the entire initPush() flow including foreground toasts
            // and the /api/fcm/subscribe call below.
            var swReg = null;
            try {
                swReg = await _registerServiceWorker(cfg);
            } catch (err) {
                console.warn('[Push] service worker registration failed — background push will not work, but foreground push can still proceed:', err.message);
            }
            var messaging = firebase.messaging();

            var token = await messaging.getToken({
                vapidKey: cfg.fcm.vapidKey,
                serviceWorkerRegistration: swReg || undefined
            });
            if (!token) { console.warn('[Push] No token returned.'); return; }

            window._fcmToken = token;
            await _subscribeToken(token);

            // Foreground messages: Firebase delivers these to JS instead of
            // showing an OS notification, so route them into the existing
            // in-app bell/toast so the user still sees something.
            messaging.onMessage(function(payload) {
                var n = payload.notification || {};
                if (typeof window.pushNotification === 'function') {
                    window.pushNotification(n.body || n.title || 'New update', 'info', n.image);
                }
            });
        } catch (err) {
            console.warn('[Push] setup failed (non-fatal):', err.message);
        }
    }

    // Fire once the user is actually logged in — pushes are per-user and
    // prompting a guest for permission before they've done anything is a
    // fast way to get the permission auto-denied for good.
    // app-auth.js dispatches 'empyrean-user-ready' on document once
    // userState is populated after login/session-restore.
    document.addEventListener('empyrean-user-ready', initPush);

    // Also try on load in case a returning user's session is already live
    // by the time this script runs (e.g. persisted Firebase auth state).
    window.addEventListener('load', function() {
        setTimeout(function() {
            if (window.userState && window.userState.id && !window.isGuest) initPush();
        }, 1500);
    });
})();

// ── PART 2 REMOVED (2026-07-29) ─────────────────────────────────────────
// empyreanPostNotifyTrigger() used to live here: a Firestore onSnapshot
// listener on posts/sos_queue/crisis_reports that called /api/notify
// whenever a new doc appeared. It only ran while SOME browser tab had
// this script loaded and connected — if nobody had the app open anywhere
// when a post/SOS/crisis doc was created, no push went out until someone
// reconnected (see the header comment above, which documented this as a
// known limitation).
//
// Replaced with a listener living inside server.js itself
// (startServerNotifyListeners(), started when the Render server boots) —
// see the comment there for the full explanation. That listener runs
// inside the persistent Node process, not a browser tab, so it fires
// regardless of whether any client is open. Do NOT re-add this
// client-side listener alongside it — running both would double-send
// every notification.