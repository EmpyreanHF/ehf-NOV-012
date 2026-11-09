/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v11 (merged: v11 + v12)
   app-patch-v11.js  |  Load AFTER app-patch-v10.js

   MERGED (file-count reduction, no behavior change): this file used to be
   two separate files — app-patch-v11.js, app-patch-v12.js — loaded
   back-to-back with nothing else between them. v12 exists because of v11:

     PART 1 (was v11) — "guest love count" fix: counts each real tap
       exactly once (capture-phase, independent of three legacy handlers'
       own local increments) and displays the number straight from
       Firestore's active_streams.likes, so host and guest see the same
       total.
     PART 2 (was v12) — the actual reason PART 1's writes were silently
       failing for many sessions: no real or anonymous Firebase Auth
       session existed (`request.auth == null`), which active_streams'
       security rules reject. Signs in anonymously once Firebase's own
       onAuthStateChanged reports there's no real session pending (with a
       grace window so a real, still-restoring session is never pre-empted).

   Each part is still its own IIFE below, verbatim, in original load
   order — splitting them back into separate files is safe if ever needed.
   ============================================================================= */

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v11 (rev. 2)
   app-patch-v11.js  |  Load AFTER app-patch-v10.js

   ISSUE #2 ONLY: "guest love count" abnormality — host and guest dashboards
   showing DIFFERENT numbers instead of one shared, growing count.

   REV.1 MISTAKE: rev.1 watched #live-like-count's on-screen text for
   increases and mirrored each increase into Firestore. That assumed there
   was exactly ONE thing incrementing that text per real tap. There isn't —
   there are THREE separate legacy handlers that each bump it independently
   for their own bubble/burst animation:
     1. app-fixes.js  (~line 5024)   — original tap-to-like, `liveLikeCount++`
     2. app-patch-v9.js §B (~line 264) — "tap does nothing" fix, its own ++
     3. app-live-tiktok-patch.js (~line 618) — header heart icon, its own ++
   #1 is attached on document.body (bubble phase), #2 on document (bubble
   phase) and calls e.stopPropagation() — but that fires AFTER #1 already
   ran (body is reached before document going up the bubble), so a single
   tap on the shared background area was very often counted TWICE before
   rev.1 ever saw the number. Rev.1 then dutifully copied that inflated,
   device-specific total into Firestore, which is why host and guest ended
   up with two different growing numbers instead of one shared one.

   FIX (rev.2): stop trusting the on-screen text as the count of "how many
   real taps happened." Instead:
     §1 — a SINGLE capture-phase listener on `document` (runs before every
          legacy bubble-phase handler above, so it always sees each real
          tap exactly once, unaffected by any of their own increments or
          stopPropagation() calls) queues exactly +1 per genuine background
          tap and batch-flushes an atomic Firestore increment ~every 500ms.
     §2 — a Firestore listener on the stream doc treats the server's
          `likes` value (plus any not-yet-flushed local taps) as the ONLY
          authoritative number, and simply overwrites #live-like-count with
          it. Whatever the three legacy handlers scribble onto that element
          in between gets corrected on the next snapshot (near-instant),
          instead of permanently compounding into a device-specific total.
   The legacy handlers' own bubble/burst/pulse animations are untouched —
   only the actual NUMBER shown is now decided here.

   IF, AFTER THIS FIX, ONLY THE HOST'S OWN TAPS MOVE THE SHARED NUMBER AND
   GUEST TAPS STILL DON'T: that would point to Firestore security rules
   blocking guest writes to active_streams/{id} — a server-side rules file
   we haven't been given yet, not something fixable from client code.
   ============================================================================= */

(function empyreanPatchV11() {
    'use strict';

    /* FIX (2026-07-21 — echo/frozen-tap follow-up audit): this file had no
       guard against running twice on the same page load (the same re-
       execution behavior documented in app-patch-v35.js's header, and the
       same mechanism fixed at the source in app-live.js/app-fix-final.js
       this session). A second execution would re-register this file's
       document-level click listener(s) on top of the first copy. Guarding
       here matches the convention already used by app-patch-v30.js onward. */
    if (window._empPatchV11Loaded) {
        console.warn('[V11] Already loaded — skipping duplicate execution (prevents duplicate click listeners).');
        return;
    }
    window._empPatchV11Loaded = true;

    function streamRef() {
        var db = window.fbDb;
        var sid = window.liveStreamData && window.liveStreamData.streamId;
        if (!db || !sid || !window._firebaseLoaded) return null;
        return db.collection('active_streams').doc(sid);
    }

    /* ── §1: count each real tap exactly once, independent of the DOM ── */
    var _pendingDelta = 0;
    var _flushTimer = null;

    function flushPending() {
        if (_pendingDelta <= 0) return;
        var ref = streamRef();
        if (!ref) return; // not ready yet — stays queued, retried on next flush
        var delta = _pendingDelta;
        _pendingDelta = 0;
        var fv = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
        ref.set({
            likes: (fv && typeof fv.increment === 'function') ? fv.increment(delta) : delta
        }, { merge: true }).catch(function (err) {
            console.warn('[V11-Love] write failed, will retry:', err && err.message);
            _pendingDelta += delta; // put it back for the next attempt
        });
    }

    function scheduleFlush() {
        if (_flushTimer) return;
        _flushTimer = setTimeout(function () {
            _flushTimer = null;
            flushPending();
        }, 500);
    }

    // Same "what counts as a background tap" rule the legacy handlers use
    // (kept identical on purpose, so this counts a real tap exactly where
    // the existing bubble/burst animations already fire — never more,
    // never less, never a DIFFERENT set of taps than what the person sees).
    function isBackgroundTap(e) {
        if (!window.liveStreamData || !window.liveStreamData.isLive) return false;
        if (!e.target || !e.target.closest) return false;
        var liveStreamScreen = document.getElementById('live-stream-screen');
        var hostMainVideo = document.getElementById('host-main-video');
        var hostVideoFallbackAvatar = document.getElementById('host-video-fallback-avatar');
        return (
            e.target === liveStreamScreen ||
            e.target === hostMainVideo ||
            e.target === hostVideoFallbackAvatar ||
            !!e.target.closest('.main-host-video') ||
            !!e.target.closest('.live-body')
        ) && !e.target.closest(
            '.live-header, .live-footer, #host-control-panel, #multi-guest-container, ' +
            '.live-overlay-box, .live-sub-modal, #tk-guestbox-stack, .live-comments-container'
        );
    }

    // Capture phase = runs before every legacy bubble-phase handler, so it
    // always sees the tap first and counts it exactly once — regardless of
    // how many of the three legacy handlers also fire afterward, and
    // regardless of any e.stopPropagation() any of them call later.
    document.addEventListener('click', function (e) {
        if (!isBackgroundTap(e)) return;
        _pendingDelta++;
        scheduleFlush();
    }, true);

    /* ── §2: Firestore is the only source of truth for the number shown ─ */
    var _v11Unsub = null;
    var _v11LastSid = null;

    function ensureRemoteListener() {
        var sid = window.liveStreamData && window.liveStreamData.streamId;
        if (!sid) return;
        if (sid === _v11LastSid && _v11Unsub) return;
        if (_v11Unsub) { _v11Unsub(); _v11Unsub = null; }
        _v11LastSid = sid;
        var ref = streamRef();
        if (!ref) return;

        _v11Unsub = ref.onSnapshot(function (doc) {
            if (!doc.exists) return;
            var data = doc.data() || {};
            var el = document.getElementById('live-like-count');
            if (!el) return;
            // Server total + whatever this device has tapped but not yet
            // flushed — so the number never visibly drops right after a
            // tap, it just settles onto the true total once the flush lands.
            var authoritative = (data.likes || 0) + _pendingDelta;
            el.textContent = authoritative.toLocaleString();
        }, function (err) {
            console.warn('[V11-Love] remote listener error:', err && err.message);
        });
    }

    function tick() {
        ensureRemoteListener();
    }

    document.addEventListener('DOMContentLoaded', tick);
    setInterval(tick, 1000);
    tick();

    console.log('[EmpyreanPatchV11] ✅ Issue #2 (rev.2): love-tap count now counted once per real tap (capture-phase, independent of the 3 legacy handlers\' own local increments) and displayed straight from Firestore\'s active_streams.likes — the same number on every screen, host included.');

})();

/* ───────────────────────────── Part 2 (was app-patch-v12.js) ───────────────────────────── */

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v12
   app-patch-v12.js  |  Load AFTER app-patch-v11.js

   ISSUE #2, ROOT CAUSE CONFIRMED VIA firestore.rules:

     match /active_streams/{streamId} {
       allow update: if request.auth != null &&
         (... || isLiveGuestSafeUpdate(resource.data, request.resource.data));
     }
     function isLiveGuestSafeUpdate(existing, incoming) {
       return incoming.diff(existing).affectedKeys()
         .hasOnly(['joinRequests', 'guests', 'shares', 'views', 'likes', 'lastHeartbeat']);
     }

   'likes' is ALREADY explicitly whitelisted here — any signed-in user can
   update it, no ownership check needed. The one hard requirement is
   `request.auth != null`. app-fixes.js's own comment ("fbAuth.currentUser
   is null for localStorage-only sessions -- that is OK, the Firestore SDK
   still works with the anonymous/unauthenticated rules") confirms this app
   routinely runs sessions with NO real Firebase Auth user at all — for
   those sessions request.auth is null, so every write to active_streams
   (the v11 like-tap sync included) is rejected with exactly the
   "Missing or insufficient permissions" error seen in console, regardless
   of host/guest role. That's why the count climbs on tap then snaps back:
   v11's optimistic local number gets corrected back down to the real
   (unwritten) server value on the next snapshot.

   FIX: if there's no real Firebase Auth user yet, sign in anonymously.

   ═══════════════════════════════════════════════════════════════════════
   REVISION 2 — CRITICAL RACE CONDITION FIX (confirmed via live console
   diagnostic across multiple independent accounts/devices, both on the
   local preview and the real production URL: `fbAuth.currentUser` was
   non-null but `isAnonymous: true` for accounts that had actually LOGGED
   IN with a real account):

   The original version below called signInAnonymously() the instant
   `window.fbAuth.currentUser` was falsy. But currentUser is ALSO falsy
   for up to several seconds after page load while Firebase is still
   restoring a REAL, previously-signed-in user's persisted session —
   app-auth.js's own restoreLocalSession() gives this exact restore an
   800ms head start elsewhere in the codebase, and app-fixes.js extends
   its own safety-net wait to 6s for slow mobile networks, both BECAUSE
   this restore is known to be slow and asynchronous.

   signInAnonymously() is a lightweight network call that, on a real
   device/connection, routinely resolves FASTER than that real-session
   restore. Once it resolves, Firebase Auth's client SDK has exactly one
   "current" signed-in user — the anonymous one now occupies that slot,
   and the real persisted session never gets to take over it. Firebase
   persistence then remembers the anonymous session as "last signed in,"
   so this repeats on every subsequent load too. Every Firestore write
   requiring `request.auth.uid == <the real account's id>` (messages,
   calls, notifications — anything with real per-user ownership, not
   just the broad `request.auth != null` check active_streams uses)
   then fails permission-denied, silently, forever, for that
   device/account — while the UI still shows the person as logged in,
   because that part reads from a separate localStorage cache, not
   live Firebase Auth state.

   FIX: never guess based on a single currentUser snapshot. Instead,
   wait for Firebase's OWN onAuthStateChanged to report its first
   verdict — this fires exactly once with either the restored real user
   or null, and is the one authoritative signal for "is there a real
   session or not." Only fall back to anonymous once that verdict is in,
   and if a real session is expected to restore (a stored session email
   exists in localStorage), give it the same generous grace window the
   rest of the app already relies on (7s) before concluding there truly
   is no real user. True guests (no stored session at all) are
   unaffected — they still go anonymous immediately, exactly as before.

   NOTE FOR ANY DEVICE ALREADY AFFECTED: this fix prevents the race from
   happening again on a fresh sign-in, but a device that already has a
   persisted anonymous session from before this fix will keep loading
   that same anonymous session on refresh (Firebase persistence just
   remembers "last signed in," anonymous or not). Those accounts need to
   log out and log back in ONCE (a real signInWithEmailAndPassword call
   always replaces whatever is currently signed in, anonymous included)
   to clear it.

   REQUIRES: "Anonymous" sign-in provider enabled in Firebase Console →
   Authentication → Sign-in method. If it isn't, signInAnonymously() will
   reject with auth/admin-restricted-operation or auth/operation-not-allowed
   — logged clearly below so that's easy to tell apart from any other cause.
   ============================================================================= */

(function empyreanPatchV12() {
    'use strict';

    /* FIX (2026-07-21 — echo/frozen-tap follow-up audit): this file had no
       guard against running twice on the same page load (the same re-
       execution behavior documented in app-patch-v35.js's header, and the
       same mechanism fixed at the source in app-live.js/app-fix-final.js
       this session). A second execution would re-register this file's
       document-level click listener(s) on top of the first copy. Guarding
       here matches the convention already used by app-patch-v30.js onward. */
    if (window._empPatchV12Loaded) {
        console.warn('[V12] Already loaded — skipping duplicate execution (prevents duplicate click listeners).');
        return;
    }
    window._empPatchV12Loaded = true;

    var _attempted = false;

    function log(msg)  { console.log('[V12-Auth] ' + msg); }
    function warn(msg) { console.warn('[V12-Auth] ' + msg); }

    function hasExpectedRealSession() {
        try { return !!localStorage.getItem('empyrean_session_email'); } catch (e) { return false; }
    }

    function trySignInAnonymously() {
        if (_attempted) return;
        if (!window._firebaseLoaded || !window.fbAuth) return;
        if (window.fbAuth.currentUser) return; // already have SOME session (real or anon) — nothing to do
        _attempted = true;

        if (typeof window.fbAuth.signInAnonymously !== 'function') {
            warn('signInAnonymously() not available on this Firebase SDK build — cannot self-heal request.auth for unauthenticated sessions.');
            return;
        }

        window.fbAuth.signInAnonymously().then(function () {
            log('✅ Anonymous Firebase session established (confirmed no real session was pending) — Firestore writes that only require request.auth != null will now succeed for this tab.');
        }).catch(function (err) {
            warn('Anonymous sign-in failed (' + (err && err.code) + '): ' + (err && err.message) +
                (err && (err.code === 'auth/admin-restricted-operation' || err.code === 'auth/operation-not-allowed')
                    ? ' — enable "Anonymous" under Firebase Console → Authentication → Sign-in method, then reload.'
                    : ''));
            _attempted = false; // allow a later retry (e.g. next tick) if this was transient
        });
    }

    /* The one place that decides whether/when to fall back to anonymous.
       Waits for Firebase's own authoritative first verdict instead of
       guessing off a currentUser snapshot mid-restore. */
    function armAuthWatcher() {
        if (!window._firebaseLoaded || !window.fbAuth || typeof window.fbAuth.onAuthStateChanged !== 'function') return;
        if (window._v12AuthWatcherArmed) return;
        window._v12AuthWatcherArmed = true;

        var settled = false;

        window.fbAuth.onAuthStateChanged(function (fbUser) {
            if (fbUser && !fbUser.isAnonymous) {
                /* Real, non-anonymous user confirmed — this is the thing
                   we must never pre-empt. Permanently disarm the
                   anonymous fallback for this session. */
                settled = true;
                _attempted = true;
                return;
            }
            if (settled) return; // already made our one decision
            settled = true;

            var delay = hasExpectedRealSession() ? 7000 : 0;
            if (delay) log('no real session yet, but one is expected to restore — waiting ' + delay + 'ms before considering anonymous fallback.');

            setTimeout(function () {
                var u = window.fbAuth.currentUser;
                if (u && !u.isAnonymous) return; // real user arrived during the wait — nothing to do
                trySignInAnonymously();
            }, delay);
        });
    }

    if (window._firebaseLoaded) armAuthWatcher();
    window.addEventListener('empyrean:firebase-ready', armAuthWatcher);

    // Belt-and-suspenders: also re-check right when someone actually opens
    // a live stream (host or viewer). Safe to call any time — trySignInAnonymously
    // itself still refuses to act if any session (real or anon) already exists.
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('.join-live-btn, #go-live-btn, .go-live-btn, #go-live-modal-overlay')) {
            setTimeout(trySignInAnonymously, 500);
        }
    });

    /* FIX (2026-08-01 — "group message not sent" follow-up #3, see
       app-patch-v13.js's _writeWithRetry): exposes this file's own
       already-safe/idempotent trySignInAnonymously() (still refuses to
       act if ANY session — real or anon — already exists, or one is
       already in flight) so a write that hits permission-denied with no
       session at all yet can proactively nudge it instead of passively
       waiting out this file's own grace window before the caller's own
       retry budget runs out. No new fallback logic — just a narrow,
       read-only-safe door into the one that already exists here. */
    window._empTrySignInAnonymously = trySignInAnonymously;

    console.log('[EmpyreanPatchV12] ✅ Anonymous fallback now waits for Firebase\'s own real-session verdict (plus a 7s grace window when a real session is expected to restore) before ever engaging — real accounts can no longer be pre-empted into a permanent anonymous session.');

})();