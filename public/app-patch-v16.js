/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v16 (merged: v16 + v17 + v18)
   app-patch-v16.js  |  Load AFTER app-patch-v15.js

   MERGED (file-count reduction, no behavior change): this file used to be
   three separate files — app-patch-v16.js, app-patch-v17.js,
   app-patch-v18.js — loaded back-to-back with nothing else between them.
   All three are fixes to the SAME feature (the "End Live" button) applied
   in sequence, each addressing what the previous one exposed:

     PART 1 (was v16) — guaranteed-execution handler: fixes the button
       silently no-op'ing on a stale per-click isHost() check.
     PART 2 (was v17) — the real root cause: hostId written to
       active_streams didn't match the real Firebase Auth uid the
       security rules check, so delete/update permanently failed with
       permission-denied. Also makes the button un-retappable, sweeps
       leftover dashboard cards, auto-transfers guests to another live
       host when their stream ends, and adds vertical swipe between live
       streams for guests.
     PART 3 (was v18) — watchdog: forces End Live's modal closed and the
       button re-enabled if teardown hasn't finished within 6s, so a
       Firestore permission failure (stale hostId on a doc published
       before Part 2 loaded) or a hung Agora teardown can never leave the
       button spinning forever again.

   Each part is still its own IIFE below, verbatim, in original load
   order — splitting them back into separate files is safe if ever needed.
   ============================================================================= */

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v16
   app-patch-v16.js  |  Load AFTER app-patch-v15.js

   ISSUE: Host-side "End Live" button (#tk-end-live-btn) — tap does nothing.

   ROOT CAUSE (confirmed by reading the full chain, not guessed):
   The tap ALREADY reaches endLiveStreamHandler() correctly — the capture-
   phase "SINGLE AUTHORITATIVE HANDLER" in app-live-tiktok-patch.js (search
   that file for that exact comment) guarantees that part. The failure is
   the very first line of endLiveStreamHandler() itself:

       async function endLiveStreamHandler() {
           if (!isHost()) return;      // <-- silent no-op, no log, no error

   isHost() there is:
       !window.isGuest && window.userState && window.liveStreamData &&
       window.liveStreamData.hostUserId &&
       window.userState.id === window.liveStreamData.hostUserId

   All four of those have to be true at the EXACT millisecond of the tap.
   Any transient staleness in any one of them (liveStreamData getting
   replaced by a Firestore snapshot, userState getting reassigned by
   unrelated code, etc.) makes this line bail out completely silently —
   which matches the reported symptom exactly ("doesn't work at all", no
   console error).

   A second, independent risk: inside the real teardown,
   `await window._agora.stopHost()` has no timeout. On a slow/bad mobile
   connection, if that promise never settles, everything after it
   (Firestore cleanup, modal close) never runs either.

   FIX (does not touch any existing file):
     1. A window-level capture-phase listener intercepts the tap on
        #tk-end-live-btn BEFORE it can reach the old document-level
        handler at all (window capture always runs before document
        capture, regardless of file load order — same guarantee your own
        "SINGLE AUTHORITATIVE HANDLER" comment already documents), and
        stops it there.
     2. Authorization is decided from the BUTTON'S OWN VISIBILITY plus the
        one host-identity signal that's stable for the whole session
        (window.isGuest, set once at login — not re-derived per click),
        instead of re-deriving isHost()'s full, flakier per-click check
        at click time. The button is only ever made visible (display:flex)
        for the real host in the first place — by both
        app-live-tiktok-patch.js's refreshRoleVisibility() AND
        app-patch-v9.js's §A guest hard-hide — so visibility is already a
        strong signal; window.isGuest is added on top as defense-in-depth
        for the one edge case where the button is wrongly visible to a
        non-host (a display bug), since v9's own guest-block runs on the
        same "window" node as this listener and its stopPropagation()
        there doesn't stop this sibling listener from also firing (that
        only works against handlers on OTHER nodes, like document's).
        Net effect: the flaky per-click hostUserId/userState.id equality
        that's the suspected actual bug is dropped, while the one stable
        guest/non-guest signal is kept as a safety net.
     3. The real teardown (Agora stop, Firestore delete/update, dashboard
        card removal, notification) is re-run here with every step in its
        own try/catch, PLUS a 4s timeout guard around the Agora stop so a
        hung promise can never block the rest of the cleanup.
     4. The modal close + local state reset happens unconditionally at the
        end, regardless of whether any single step above failed — so the
        button always visibly does something, never nothing.
     5. window.endLiveStream is re-pointed at this hardened version too,
        so the same fix also covers app-fix-final.js's × > endLiveStream()
        fallback path for free.

   Diagnostics: every step logs under the [V16-EndLive] tag. If this still
   somehow doesn't fully resolve it, those logs will show exactly which
   step failed instead of another guessing round.
   ============================================================================= */

(function empyreanPatchV16() {
    'use strict';

    function log(msg) { console.log('[V16-EndLive] ' + msg); }
    function warn(msg, err) { console.warn('[V16-EndLive] ' + msg, err && (err.message || err)); }

    function withTimeout(promise, ms, label) {
        return new Promise(function (resolve) {
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                warn(label + ' timed out after ' + ms + 'ms — continuing teardown anyway.');
                resolve();
            }, ms);
            Promise.resolve(promise).then(function () {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve();
            }, function (err) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                warn(label + ' rejected — continuing teardown anyway.', err);
                resolve();
            });
        });
    }

    function isVisiblyAuthorized(btn) {
        if (!btn) return false;
        // Button only ever gets display:flex when the app itself has
        // already decided this session is the host (see rationale above).
        // Covers the case where inline style + the class's own !important
        // rule disagree, by checking the actually-rendered value.
        var cs = window.getComputedStyle(btn);
        var visible = cs && cs.display !== 'none';

        // DEFENSE IN DEPTH: app-patch-v9.js's own window-capture guest-
        // block runs on this exact same node ("window") before this
        // listener does. Its stopPropagation() there stops the event from
        // reaching OTHER nodes (like document's handler) — it does NOT
        // stop this sibling listener on the same node from also running.
        // So visibility alone isn't quite enough to fully restore v9's
        // guest-safety net for the one edge case where the button is
        // wrongly visible to a non-host (a display bug elsewhere). Adding
        // back the one host-identity signal that's actually STABLE across
        // a session (window.isGuest is set once at login, not re-derived
        // per click — see app-fixes.js's initializeApp) closes that gap
        // without reintroducing the flaky per-click hostUserId/userState.id
        // equality check that's the actual suspected cause of the original
        // bug.
        return visible && !window.isGuest;
    }

    async function hardenedEndLiveStream() {
        var btn = document.getElementById('tk-end-live-btn');
        var sd = window.liveStreamData || {};
        var sid = sd.streamId;

        var cs = btn && window.getComputedStyle(btn);
        log('invoked | streamId=' + sid + ' | btnDisplay=' + (cs && cs.display) +
            ' | isGuestFlag=' + !!window.isGuest +
            ' | authorized=' + isVisiblyAuthorized(btn) +
            ' | myId=' + (window.userState && window.userState.id) +
            ' | hostUserId=' + sd.hostUserId);

        if (!isVisiblyAuthorized(btn)) {
            // Not visible to this session per the app's own gating — do
            // nothing, same as the original safe default for a non-host.
            log('blocked — button not visibly shown to this session, treating as non-host.');
            return;
        }

        // Optimistic: remove this host's own card from the feed immediately
        try {
            if (sid) {
                document.querySelectorAll('.join-live-btn[data-stream-id="' + sid + '"]').forEach(function (c) {
                    c.style.opacity = '0';
                    setTimeout(function () { c.remove(); }, 300);
                });
            }
        } catch (e1) { warn('optimistic card removal failed (non-fatal)', e1); }

        // Real teardown: stop Agora, timeout-guarded so a hang here can
        // never block the Firestore cleanup / modal close below.
        try {
            if (window._agora && typeof window._agora.stopHost === 'function') {
                await withTimeout(window._agora.stopHost(), 4000, 'Agora stopHost()');
                log('Agora stopHost() settled.');
            }
        } catch (e2) { warn('Agora stopHost() threw synchronously (non-fatal)', e2); }

        // Firestore cleanup — same shape as the original handler's, each
        // write independently guarded so one failure can't skip the rest.
        var db = window.fbDb;
        if (db && sid && window._firebaseLoaded) {
            try { await db.collection('active_streams').doc(sid).delete(); log('active_streams doc deleted.'); }
            catch (e3) { warn('active_streams delete failed', e3); }

            try { await db.collection('active_streams').doc(sid).update({ isLive: false }); }
            catch (e4) { warn('active_streams isLive:false update failed (ok if delete already succeeded)', e4); }

            try { await db.collection('active_streams').doc(sid).update({ joinRequests: [], guests: [] }); }
            catch (e5) { /* ok if doc already gone */ }
        } else {
            warn('Firestore not ready — db=' + !!db + ' sid=' + sid + ' firebaseLoaded=' + !!window._firebaseLoaded);
        }

        if (typeof window.showNotification === 'function') {
            window.showNotification('Live stream ended.', 'info');
        }

        // Unconditional close + reset — runs regardless of any failure above,
        // so the host is never stuck staring at a live view that won't exit.
        try {
            var goLiveOverlay = document.getElementById('go-live-modal-overlay');
            if (goLiveOverlay) {
                goLiveOverlay.classList.remove('show');
                goLiveOverlay.style.display = 'none';
                goLiveOverlay.style.visibility = 'hidden';
            }
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.querySelectorAll('.live-sub-modal.show, #tk-guest-requests-modal.show, #tk-viewer-rankings-modal.show')
                .forEach(function (m) { m.classList.remove('show'); });
            if (window.liveStreamData) {
                window.liveStreamData.isLive = false;
                window.liveStreamData.streamId = null;
            }
            log('modal closed, state reset — done.');
        } catch (e6) { warn('final modal-close step failed', e6); }
    }

    // Re-point window.endLiveStream at the hardened version so the ×
    // fallback path in app-fix-final.js benefits too, for free.
    window.endLiveStream = hardenedEndLiveStream;

    // Guaranteed-first interception: window capture always runs before
    // document capture, so this pre-empts the old handler's silent bail
    // regardless of load order.
    window.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        var btn = e.target.closest('#tk-end-live-btn');
        if (!btn) return;
        log('tap intercepted at window-capture.');
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        hardenedEndLiveStream();
    }, true);

    console.log('[EmpyreanPatchV16] ✅ End Live button: guaranteed-execution handler wired, no longer silently no-ops on a stale isHost() check.');

})();

/* ───────────────────────────── Part 2 (was app-patch-v17.js) ───────────────────────────── */

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v17
   app-patch-v17.js  |  Load AFTER app-patch-v16.js

   §1 — ROOT CAUSE of "End Live needs multiple taps" / repeated
        [V16-EndLive] "active_streams delete failed — Missing or insufficient
        permissions" in the console.

        firestore.rules (active_streams) requires, to update/delete a doc:
            request.auth.uid == resource.data.hostId
        request.auth.uid is Firebase AUTH's real uid for this signed-in
        session — it is NOT the same value as the app's own
        window.userState.id in every case. app-live.js's
        publishLiveStreamToFirestore() writes:
            hostId: streamData.hostUserId || window.userState.id || 'unknown'
        Firestore's `create` rule only checks `request.auth != null` — it
        never checks that hostId actually equals request.auth.uid — so a
        doc can be (and was) CREATED successfully with a hostId that does
        NOT match the real auth uid. Every later update/delete against that
        exact same doc then permanently fails the rule check, forever,
        regardless of retries — exactly the symptom in both screenshots
        (not intermittent, not timing-related: every single attempt fails
        the same way).

        FIX: from here on, every NEWLY published stream's `hostId` is
        forced to the one value the security rule actually trusts —
        firebase.auth().currentUser.uid, read at the exact moment of
        publish — instead of the app's own (possibly different)
        window.userState.id. This is done as a thin wrapper around
        publishLiveStreamToFirestore that overrides ONLY the copy of the
        data sent to Firestore; it does not touch window.liveStreamData
        itself, so none of the existing isHost()/isCurrentUserHost checks
        elsewhere (which intentionally compare against userState.id) are
        affected.

        NOTE: any stream doc already stuck live from BEFORE this patch was
        loaded still has the old, wrong hostId baked in — no client-side
        fix can delete that specific doc (that's what the rule is FOR).
        Clear it once from the Firebase console, or from an isAdmin()
        account, and every stream published after this patch loads will
        clean up correctly on its own.

   §2 — "have to tap End Live multiple times": even once §1 stops the
        permission error, Agora's stopHost() can legitimately take a
        second or two, and the button gave zero immediate feedback while
        that ran — so extra taps landed on it faster than the async
        teardown could finish, plausibly re-invoking it several times (the
        double/triple "[V16-EndLive] modal closed" lines seen back-to-back
        in the console). FIX: the very first touch/mousedown on the
        button (fires before "click") instantly disables it and swaps its
        icon for a spinner, and — because a disabled, pointer-events:none
        element cannot be the target of any later tap — every subsequent
        tap physically cannot reach it again, no matter how fast the user
        retaps.

   §3 — Dashboard cleanup: once §1 lets the real Firestore delete succeed,
        the EXISTING listener in app-live.js (onSnapshot → change.type
        'removed'/'modified'+!isLive → card.remove()) already removes the
        card on every device, host included — that mechanism was correct,
        it just never received a successful write to react to. Belt and
        suspenders: this patch also sweeps for any leftover/duplicate card
        for this host (matched by data-host-id, not just data-stream-id)
        on the host's own device at teardown, in case an earlier broken
        session left a stale tile behind.

   §4 — Guest transfer: when the stream a guest is currently watching
        ends, they're now auto-joined to another currently-live stream
        (if one exists) instead of being dropped back to a dead screen.

   §5 — Vertical scroll: guests can now swipe up/down over the live video
        to move to the next/previous currently-live stream, TikTok-style.
        Disabled for the host's own stream (hosts don't get swiped away
        from their own broadcast).
   ============================================================================= */

(function empyreanPatchV17() {
    'use strict';

    function log(msg)  { console.log('[V17] ' + msg); }
    function warn(msg, e) { console.warn('[V17] ' + msg, e && (e.message || e)); }

    /* ─────────────────────────────────────────────────────────────────
       §0 — ROOT CAUSE of the repeating "[Agora] [Live] Publish failed:
       Missing or insufficient permissions" loop.

       This is a DIFFERENT failure than §1 below: it's not the hostId
       mismatch, it's that active_streams' rules require
       `request.auth != null` for CREATE too — and this session has no
       Firebase Auth principal at all. The app only ever calls real
       Firebase Auth (signInWithEmailAndPassword) when someone logs in
       with an account; a guest / localStorage-only session (confirmed by
       app-fixes.js's own comment: "fbAuth.currentUser is null for
       localStorage-only sessions — that is OK, the Firestore SDK still
       works with the anonymous/unauthenticated rules") never gets ANY
       Firebase Auth session — anonymous or otherwise. That assumption is
       wrong specifically for active_streams, whose rules don't allow
       unauthenticated writes at all. So publishLiveStreamToFirestore's
       very first write is rejected, its own catch-block retries it again
       3s later, which fails the exact same way, forever — the loop seen
       in the console.

       FIX: silently sign in anonymously (no password, no UI, invisible
       to the person) the moment a session isn't already authenticated,
       BEFORE the first publish attempt is allowed to run. Once signed in
       (even anonymously), request.auth.uid is a real, stable uid for the
       rest of this browser session — which is also exactly the uid §1
       below writes into hostId, so create and the later end-live
       delete/update now agree on the same value throughout.
       ───────────────────────────────────────────────────────────────── */
    function ensureFirebaseAuth() {
        return new Promise(function (resolve) {
            if (window.fbAuth && window.fbAuth.currentUser) return resolve(window.fbAuth.currentUser);
            if (!window.fbAuth || typeof window.fbAuth.signInAnonymously !== 'function') return resolve(null);
            log('No Firebase Auth session for this device yet — signing in anonymously before publishing...');
            window.fbAuth.signInAnonymously().then(function (cred) {
                var user = cred && cred.user;
                log('Anonymous sign-in ' + (user ? ('succeeded — uid: ' + user.uid) : 'returned no user') + '.');
                resolve(user || null);
            }).catch(function (err) {
                warn('Anonymous sign-in failed — publish will likely still be rejected by rules.', err);
                resolve(null);
            });
        });
    }

    /* ─────────────────────────────────────────────────────────────────
       §1 — force hostId written to Firestore to match the real auth uid
       ───────────────────────────────────────────────────────────────── */
    (function fixHostIdMismatch() {
        function wrap() {
            if (typeof window.publishLiveStreamToFirestore !== 'function') return false;
            if (window.publishLiveStreamToFirestore._v17Wrapped) return true;
            var _orig = window.publishLiveStreamToFirestore;
            var wrapped = function (streamData) {
                return ensureFirebaseAuth().then(function (user) {
                    var authUid = user && user.uid;
                    var toSend = streamData;
                    if (authUid && streamData && streamData.hostUserId !== authUid) {
                        // Shallow copy only — does NOT mutate window.liveStreamData,
                        // so isHost()/isCurrentUserHost checks elsewhere (which
                        // compare against userState.id on purpose) are untouched.
                        toSend = Object.assign({}, streamData, { hostUserId: authUid });
                        log('hostId corrected to real auth uid for Firestore write (was: ' +
                            (streamData.hostUserId || 'unset') + ').');
                    }
                    return _orig(toSend);
                });
            };
            wrapped._v17Wrapped = true;
            window.publishLiveStreamToFirestore = wrapped;
            log('publishLiveStreamToFirestore wrapped — auth bootstrap + hostId/auth-uid mismatch fixed going forward.');
            return true;
        }
        if (!wrap()) {
            var tries = 0;
            var iv = setInterval(function () {
                tries++;
                if (wrap() || tries > 40) clearInterval(iv); // ~20s ceiling, matches other patches' retry style
            }, 500);
        }
        // Also kick off sign-in proactively as soon as Firebase is ready,
        // rather than waiting for the first go-live attempt — so by the
        // time someone actually taps "Go Live", auth is usually already
        // settled instead of adding a visible delay to that first publish.
        if (window._firebaseLoaded) ensureFirebaseAuth();
        else window.addEventListener('empyrean:firebase-ready', function () { ensureFirebaseAuth(); }, { once: true });
    })();

    /* ─────────────────────────────────────────────────────────────────
       §2 — instant, un-retappable feedback on End Live

       ───────────────────────────────────────────────────────────────── */
    // §3's helper is declared up here so §2's touch handler (below) can call
    // it directly — see note in §2 on why this can't be a separate 'click'
    // listener.
    function sweepOwnLiveCards() {
        try {
            var myId = (window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid) ||
                       (window.userState && window.userState.id);
            if (!myId) return;
            document.querySelectorAll('.join-live-btn[data-host-id="' + myId + '"]').forEach(function (c) {
                c.style.opacity = '0';
                setTimeout(function () { if (c.parentNode) c.remove(); }, 300);
            });
        } catch (e) { warn('sweepOwnLiveCards failed', e); }
    }

    (function hardenEndLiveTap() {
        function disableBtn(btn) {
            if (!btn || btn._v17Disabled) return;
            btn._v17Disabled = true;
            // BUGFIX: this used to set pointer-events:none SYNCHRONOUSLY here,
            // inside the touchstart handler. On mobile, 'click' is synthesized
            // AFTER touchend — so by the time it fired, the button already had
            // pointer-events:none and failed hit-testing entirely. The click
            // landed on whatever was underneath instead of the button, so
            // V16's #tk-end-live-btn handler never ran at all. That wasn't
            // "stuck processing" — End Live never fired, ever, which is why
            // the spinner just sat there. Deferring one tick lets THIS tap's
            // own click dispatch first (a real second tap is physically much
            // slower than a setTimeout(0)), so it still blocks repeat taps
            // without eating the one that's supposed to work.
            setTimeout(function () {
                btn.style.pointerEvents = 'none';
                btn.style.opacity = '0.55';
                var icon = btn.querySelector('svg, i');
                if (icon) icon.style.animation = 'v17-end-spin 0.8s linear infinite';
                if (!document.getElementById('_v17_end_spin_style')) {
                    var s = document.createElement('style');
                    s.id = '_v17_end_spin_style';
                    s.textContent = '@keyframes v17-end-spin{to{transform:rotate(360deg)}}';
                    document.head.appendChild(s);
                }
            }, 0);
        }
        // Capture on window, same node V16 uses, but on 'pointerdown'/'touchstart'/
        // 'mousedown' — which all fire strictly BEFORE 'click' — so the button is
        // already disabled by the time V16's own click-capture handler runs.
        //
        // IMPORTANT: this is also why §3's dashboard-sweep is triggered from
        // HERE and not from its own 'click' listener. V16's window-capture
        // click handler calls e.stopImmediatePropagation() on every tap on
        // this button — which, since V16 loads before V17, silently stops
        // ANY click listener added after it on the same node (window) from
        // ever firing, ours included. touchstart/mousedown are a different
        // event type entirely and are never touched by that call, so this
        // is the one place in this file guaranteed to actually run.
        ['pointerdown', 'touchstart', 'mousedown'].forEach(function (evt) {
            window.addEventListener(evt, function (e) {
                var btn = e.target && e.target.closest && e.target.closest('#tk-end-live-btn');
                if (!btn) return;
                disableBtn(btn);
                setTimeout(sweepOwnLiveCards, 800);
                setTimeout(sweepOwnLiveCards, 3000);
            }, true);
        });
        log('End Live button now disables itself on first touch — repeat taps can no longer reach it.');
    })();

    /* ─────────────────────────────────────────────────────────────────
       Shared helpers for §4/§5: read the live, already-synced list of
       joinable streams straight from the dashboard slider's DOM (kept
       current in real time by app-live.js's own onSnapshot listener —
       no extra Firestore query needed).
       ───────────────────────────────────────────────────────────────── */
    function liveCards() {
        return Array.prototype.slice.call(document.querySelectorAll('#dashboard-live-slider .join-live-btn'));
    }
    function amHost() {
        return !window.isGuest && window.userState && window.liveStreamData &&
            window.liveStreamData.hostUserId && window.userState.id === window.liveStreamData.hostUserId;
    }
    function currentStreamId() {
        return window.liveStreamData && window.liveStreamData.streamId;
    }
    function pickCard(direction /* 'next' | 'prev', or a specific predicate fn */) {
        var cards = liveCards();
        var sid = currentStreamId();
        var idx = cards.findIndex(function (c) { return c.dataset.streamId === sid; });
        if (typeof direction === 'function') {
            return cards.find(function (c) { return c.dataset.streamId !== sid && direction(c); }) || null;
        }
        if (!cards.length) return null;
        if (idx === -1) {
            // Not currently one of the visible cards (e.g. transfer case) — just take the first other one.
            return cards.find(function (c) { return c.dataset.streamId !== sid; }) || null;
        }
        var nextIdx = direction === 'next'
            ? (idx + 1) % cards.length
            : (idx - 1 + cards.length) % cards.length;
        // Skip forward/back past our own current card if the feed only has one entry.
        var card = cards[nextIdx];
        return (card && card.dataset.streamId !== sid) ? card : null;
    }
    function switchToCard(card, reasonMsg) {
        if (!card) return false;
        try { if (window._agora && typeof window._agora.stopViewer === 'function') window._agora.stopViewer(); } catch (e) {}
        if (reasonMsg && typeof window.showNotification === 'function') window.showNotification(reasonMsg, 'info');
        setTimeout(function () { card.click(); }, 250);
        return true;
    }

    /* ─────────────────────────────────────────────────────────────────
       §4 — guest auto-transfer to next available host when the stream
       they're watching ends
       ───────────────────────────────────────────────────────────────── */
    (function guestAutoTransfer() {
        var watchedSid = null;
        var unsub = null;
        var _endCheckToken = null;

        // FIX (bug: "That stream ended — no other live streams" shown to
        // a guest while the host is still actively broadcasting):
        // widened from 90s to match app-live.js's own fix for the same
        // root cause — confirmed via live diagnostics that this app
        // regularly runs on ~2-9 K/s connections, where a heartbeat
        // write (now retried on failure — see app-live.js) can still
        // legitimately take well over a minute to land. 90s was treating
        // routine slow-connection delay as proof the stream had ended.
        function isFreshDoc(data) {
            return !data || !data.lastHeartbeat || (Date.now() - Date.parse(data.lastHeartbeat)) < 180000;
        }

        function attach() {
            var db = window.fbDb;
            var sid = currentStreamId();
            if (amHost()) {
                // Never watch-for-transfer on our own stream. Also covers the
                // edge case where this session started as a guest (listener
                // attached) and then became a host mid-session — without this,
                // the old guest-side listener would keep running forever in
                // the background instead of being cleaned up.
                if (unsub) { try { unsub(); } catch (e) {} unsub = null; watchedSid = null; }
                return;
            }
            if (!db || !window._firebaseLoaded || !sid) return;
            if (sid === watchedSid && unsub) return;
            if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
            watchedSid = sid;
            unsub = db.collection('active_streams').doc(sid).onSnapshot(function (doc) {
                var data = doc.exists ? (doc.data() || {}) : null;
                var stillLive = !!(data && data.isLive === true && isFreshDoc(data));
                if (stillLive) {
                    _endCheckToken = null; // confirmed live again — cancel any pending "declare ended" check below
                    return;
                }

                // FIX (bug: "'That stream ended — no other live streams'
                // shown while the stream is still on"): this used to act
                // the instant THIS SINGLE snapshot showed isLive:false or
                // a missing doc, with no cross-check at all — the same
                // class of false positive already fixed for the in-view
                // Agora path in app-live.js (a transient write/heartbeat
                // blip can momentarily flip isLive without the stream
                // actually ending). Now: wait a few seconds and re-verify
                // with a fresh read before actually transferring the guest
                // or showing "no other live streams". If a newer snapshot
                // arrives in the meantime showing the stream live again
                // (stillLive above), this pending check is cancelled.
                var myToken = {};
                _endCheckToken = myToken;
                setTimeout(function () {
                    if (_endCheckToken !== myToken) return; // superseded by a fresher "still live" snapshot
                    if (amHost()) return;
                    if (currentStreamId() !== watchedSid) return; // already moved on

                    function actOnEnd() {
                        var next = pickCard('next');
                        if (next) {
                            log('Watched stream ended — transferring guest to next live host: ' + next.dataset.hostName);
                            switchToCard(next, '📡 That stream ended — joining ' + (next.dataset.hostName || 'another host') + '\u2019s live stream...');
                        } else if (typeof window.showNotification === 'function') {
                            window.showNotification('📴 That stream ended. No other live streams right now.', 'info');
                        }
                        if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
                        watchedSid = null;
                    }

                    db.collection('active_streams').doc(sid).get().then(function (freshDoc) {
                        if (_endCheckToken !== myToken) return;
                        var freshData = freshDoc.exists ? (freshDoc.data() || {}) : null;
                        if (freshData && freshData.isLive === true && isFreshDoc(freshData)) {
                            log('isLive:false was a transient blip — fresh read shows the stream still live. Ignoring.');
                            return;
                        }
                        actOnEnd();
                    }).catch(function () {
                        if (_endCheckToken !== myToken) return;
                        actOnEnd(); // can't verify — fall back to the pre-fix behavior rather than get stuck forever
                    });
                }, 10000); // widened from 6s alongside the staleness-threshold fix above — gives a slow connection's fresh read (and any in-flight heartbeat retry) realistic time to land before committing to "ended"
            }, function (err) { warn('guestAutoTransfer listener error', err); });
        }

        setInterval(attach, 1000);
        attach();
    })();

    /* ─────────────────────────────────────────────────────────────────
       §5 — vertical swipe between live streams (guests only)
       ───────────────────────────────────────────────────────────────── */
    (function verticalSwipeFeed() {
        var startY = null, startX = null, swiping = false;
        var THRESHOLD = 70;

        function inSwipeZone(target) {
            if (!target || !target.closest) return false;
            if (amHost()) return false; // hosts never get swiped off their own broadcast
            var liveStreamScreen = document.getElementById('live-stream-screen');
            if (!liveStreamScreen || !liveStreamScreen.classList.contains('show')) {
                // container may not use a 'show' class the same way the modal overlay does —
                // fall back to just checking the overlay is visible.
                var overlay = document.getElementById('go-live-modal-overlay');
                if (!overlay || !overlay.classList.contains('show')) return false;
            }
            // Same background region app-patch-v11.js already treats as "the stream
            // itself" rather than any overlay/control surface — reused here so swipe
            // and tap-to-love never fight over the same gesture area.
            return (
                target === document.getElementById('host-main-video') ||
                target === document.getElementById('host-video-fallback-avatar') ||
                target === liveStreamScreen ||
                !!target.closest('.main-host-video') ||
                !!target.closest('.live-body')
            ) && !target.closest(
                '.live-header, .live-footer, #host-control-panel, #multi-guest-container, ' +
                '.live-overlay-box, .live-sub-modal, #tk-guestbox-stack, .live-comments-container'
            );
        }

        document.addEventListener('touchstart', function (e) {
            if (!e.touches || e.touches.length !== 1) return;
            if (!inSwipeZone(e.target)) return;
            startY = e.touches[0].clientY;
            startX = e.touches[0].clientX;
            swiping = true;
        }, { passive: true });

        document.addEventListener('touchend', function (e) {
            if (!swiping || startY === null) { swiping = false; return; }
            swiping = false;
            var endY = (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientY) || startY;
            var endX = (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientX) || startX;
            var dy = startY - endY;
            var dx = Math.abs(startX - endX);
            startY = null; startX = null;
            if (Math.abs(dy) < THRESHOLD || dx > Math.abs(dy)) return; // mostly-horizontal or too small — ignore
            var direction = dy > 0 ? 'next' : 'prev'; // swipe up = next stream, swipe down = previous
            var target = pickCard(direction);
            if (target) {
                switchToCard(target, direction === 'next'
                    ? '⬆️ ' + (target.dataset.hostName || 'Next host') + '\u2019s live stream'
                    : '⬇️ ' + (target.dataset.hostName || 'Previous host') + '\u2019s live stream');
            } else if (typeof window.showNotification === 'function') {
                window.showNotification('No other live streams to switch to right now.', 'info');
            }
        }, { passive: true });

        log('Vertical swipe between live streams wired for guests (host stream excluded).');
    })();

    console.log('[EmpyreanPatchV17] ✅ anonymous-auth bootstrap added (root cause of repeating Publish-failed loop), ' +
        'hostId/auth-uid mismatch fixed (root cause of stuck End Live), button now un-retappable, ' +
        'dashboard cleanup swept, guest auto-transfer + vertical swipe feed added.');

})();

/* ───────────────────────────── Part 3 (was app-patch-v18.js) ───────────────────────────── */

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v18
   app-patch-v18.js  |  Load AFTER app-patch-v17.js

   ISSUE: End Live button spins forever / never closes the modal.

   ROOT CAUSE (confirmed, not guessed): v17's hardenEndLiveTap() disables
   #tk-end-live-btn (pointer-events:none) and starts an INFINITE spin
   animation on first touch, on the assumption that v16's
   hardenedEndLiveStream() will finish shortly after and close the modal
   (which hides the button along with it). That assumption breaks whenever
   the Firestore delete/update permanently fails — which happens for any
   stream doc whose `hostId` doesn't match the real auth uid (e.g. any doc
   published before v17's hostId fix was loaded — see v17 §1). Firestore
   rules reject that doc's delete/update FOREVER, not just once. Nothing
   in v16 or v17 ever removes the disabled state or the animation if the
   teardown doesn't fully finish, so the button is left spinning with no
   recovery path, indefinitely.

   FIX: a hard ceiling. The moment the button is touched, arm a timer. If,
   after WATCHDOG_MS, the button is STILL visibly disabled (meaning
   hardenedEndLiveStream() never reached its own final "unconditional
   close" step), this patch forces the modal closed and the button back to
   normal itself — independent of whatever Firestore/Agora are doing. This
   does not fix a bad Firestore doc (that still needs a one-time manual
   clear from the Firebase console — see v17 §1 NOTE), but it guarantees
   the UI itself can never be stuck longer than WATCHDOG_MS again, for
   this or any future cause of a hung teardown.
   ============================================================================= */

(function empyreanPatchV18() {
    'use strict';

    function log(msg) { console.log('[V18-Watchdog] ' + msg); }

    var WATCHDOG_MS = 6000; // generous: Agora's own stopHost() timeout in v16 is 4000ms

    function forceReleaseEndLiveUI(reason) {
        var btn = document.getElementById('tk-end-live-btn');
        if (btn) {
            btn._v17Disabled = false;
            btn.style.pointerEvents = '';
            btn.style.opacity = '';
            var icon = btn.querySelector('svg, i');
            if (icon) icon.style.animation = '';
        }
        try {
            var goLiveOverlay = document.getElementById('go-live-modal-overlay');
            if (goLiveOverlay) {
                goLiveOverlay.classList.remove('show');
                goLiveOverlay.style.display = 'none';
                goLiveOverlay.style.visibility = 'hidden';
            }
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.querySelectorAll('.live-sub-modal.show, #tk-guest-requests-modal.show, #tk-viewer-rankings-modal.show')
                .forEach(function (m) { m.classList.remove('show'); });
        } catch (e) { console.warn('[V18-Watchdog] modal-close step failed', e && e.message); }

        if (window.liveStreamData) {
            window.liveStreamData.isLive = false;
            window.liveStreamData.streamId = null;
        }
        if (typeof window.showNotification === 'function') {
            try {
                window.showNotification('Live ended locally. If it still shows live for viewers, it will clear shortly.', 'warning');
            } catch (e) { /* never let a notification failure block the release */ }
        }
        log('forced release after ' + WATCHDOG_MS + 'ms (' + reason + ') — server-side teardown may still be retried in the background, but the UI is never allowed to stay stuck.');
    }

    ['pointerdown', 'touchstart', 'mousedown'].forEach(function (evt) {
        window.addEventListener(evt, function (e) {
            var btn = e.target && e.target.closest && e.target.closest('#tk-end-live-btn');
            if (!btn) return;
            if (btn._v18WatchdogArmed) return;
            btn._v18WatchdogArmed = true;
            setTimeout(function () {
                btn._v18WatchdogArmed = false;
                var cs = window.getComputedStyle(btn);
                if (cs.pointerEvents === 'none') {
                    forceReleaseEndLiveUI('button still disabled after watchdog window');
                }
            }, WATCHDOG_MS);
        }, true);
    });

    console.log('[EmpyreanPatchV18] ✅ End Live can no longer stay stuck longer than ' + WATCHDOG_MS + 'ms, regardless of Firestore permission state or a hung Agora teardown.');

})();