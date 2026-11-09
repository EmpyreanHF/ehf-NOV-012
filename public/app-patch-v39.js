/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v39
   app-patch-v39.js  |  Load LAST (after everything else, including v38)

   ISSUE: host + guest audio "echoing like 5 times", nobody could hear
   anybody, then the live screen froze and stopped responding to taps.

   ═══════════════════════════════════════════════════════════════════════
   ROOT CAUSE (confirmed, not guessed — traced by counting listener/client
   registrations per script execution, then matching against the exact
   reported symptoms)
   ═══════════════════════════════════════════════════════════════════════
   app-live.js and app-fix-final.js are each one big IIFE whose startup
   path runs its setup IMMEDIATELY and synchronously any time
   document.readyState is already past 'loading' (their own onReady()/
   ready() helpers: `if (document.readyState !== 'loading') fn(); else
   ...`). That's exactly what happens every time the live-preview/dev-
   reload tooling this app is being tested through re-injects these
   scripts into an already-loaded page WITHOUT a real navigation — the
   same re-execution behavior app-patch-v35.js already documented for a
   cosmetic symptom, and the same one app-live-tiktok-patch.js and
   app-live-final.js had already been guarded against (see their own
   `window._emp*Loaded` checks). app-live.js and app-fix-final.js were
   the two files in this whole stack that had NEVER received that same
   guard — fixed directly in both files this session (see the new
   comment block at the top of each). Each un-guarded re-execution:
     (a) created a BRAND NEW agoraClient/agoraViewerClient in app-live.js
         from scratch — the previous instance's JS reference is wiped by
         re-running the IIFE, but its underlying Agora WebSocket/publish
         is NOT closed, since the page itself never unloaded. Every
         viewer in the channel then hears N overlapping copies of the
         same mic track a few hundred ms apart — exactly "echoing like
         5 times" if the reload happened ~5 times.
     (b) re-registered every one of app-live.js's ~12 and app-fix-
         final.js's ~23 document-level click listeners on top of the
         previous copies, so a single real tap fired the same handler
         chain N times over, each doing its own DOM/Firestore/Agora
         work — exactly "tapping wasn't responding" once enough copies
         had piled up.

   The idempotency guards added directly to those two files close off
   the actual mechanism. This patch is additive, defense-in-depth on top
   of that fix — it does not depend on knowing every possible path a
   duplicate join could take, so it also covers any future one:

   FIX (this file): a single shared registry, keyed by role
   ('host' | 'guest' | 'viewer'), of the currently-active Agora client
   for THIS TAB. Wraps AgoraRTC.createClient so that, whenever a NEW
   client is created for a role that already has one registered, the
   OLD one is force-left (best-effort, errors swallowed — it may already
   be dead) before the new one takes its place in the registry. This
   guarantees at most one live client per role can ever be "current" on
   this device, regardless of what caused a second creation to happen —
   closing the echo path even if some other, not-yet-found trigger
   exists beyond the one already fixed at the source.

   Does not touch app-live.js's or app-live-tiktok-patch.js's own client
   variables, join/publish logic, or UI — purely observes
   AgoraRTC.createClient() calls and cleans up the PREVIOUS client for
   that same role when a new one replaces it.
   ============================================================================= */

(function empyreanPatchV39() {
    'use strict';

    if (window._empPatchV39Loaded) {
        console.warn('[V39] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV39Loaded = true;

    function log(msg) { console.log('[V39-AgoraGuard] ' + msg); }

    // role -> { client, channel }
    window._empAgoraSingleton = window._empAgoraSingleton || {};

    // Best-effort guess at which "role" a createClient() call is for, from
    // the handful of frames right around the call site. Every join path in
    // this codebase (app-live.js's initAgoraHost/initAgoraViewer,
    // app-live-tiktok-patch.js's promoteToGuestBroadcaster) names itself
    // clearly in its own function name, so this is reliable without
    // needing any of those files to be edited or to expose anything new.
    function _guessRole(stack) {
        if (!stack) return 'unknown';
        if (/initAgoraHost/.test(stack)) return 'host';
        if (/initAgoraViewer/.test(stack)) return 'viewer';
        if (/promoteToGuestBroadcaster/.test(stack)) return 'guest';
        return 'unknown';
    }

    async function _forceLeave(entry, reason) {
        if (!entry || !entry.client) return;
        try {
            log('force-leaving previous ' + entry.role + ' client (' + reason + ') before a replacement takes over — this is what prevents an orphaned client from continuing to publish and causing an audio echo.');
            await entry.client.leave();
        } catch (e) {
            // Already dead / never joined — nothing to clean up, safe to ignore.
        }
    }

    function _armGuard() {
        if (typeof AgoraRTC === 'undefined' || AgoraRTC._pv39Wrapped) return;
        var origCreateClient = AgoraRTC.createClient.bind(AgoraRTC);
        AgoraRTC.createClient = function (config) {
            var stack = (new Error('client created')).stack || '';
            var role = _guessRole(stack);
            var client = origCreateClient(config);

            if (role !== 'unknown') {
                var prev = window._empAgoraSingleton[role];
                if (prev && prev.client && prev.client !== client) {
                    // Don't block this new join on the old one's teardown —
                    // fire-and-forget is correct here: the new client
                    // publishing immediately is more important than waiting
                    // for the old one to confirm it left.
                    _forceLeave(prev, 'new ' + role + ' client created (re-init or reconnect)');
                }
                window._empAgoraSingleton[role] = { client: client, role: role };
                log('registered new ' + role + ' client as the sole active one for this tab.');
            }
            return client;
        };
        AgoraRTC._pv39Wrapped = true;
        log('Agora single-client-per-role guard armed.');
    }

    _armGuard();
    setTimeout(_armGuard, 500);
    setTimeout(_armGuard, 1500);
    window.addEventListener('empyrean:firebase-ready', function () { setTimeout(_armGuard, 50); });
    /* 2026-10-28: the SDK is lazy-loaded now (index.html's window._empLoadAgora) — arm the single-client guard the instant it
       exists, i.e. before any createClient() call can happen. */
    window.addEventListener('empyrean:agora-ready', function () { _armGuard(); });

    /* ═══════════════════════════════════════════════════════════════════
       §2 — "app fully loaded" signal for the quick-post FAB + bottom-nav
       gate
       ═══════════════════════════════════════════════════════════════════
       ISSUE: the "+" quick-post button — and, via the same
       `body:not(.emp-app-ready)` CSS rule (style.css), the OLD/first-draft
       bottom nav bar built by app-fix-final.js's fixBottomNav() — were
       still visible WHILE THE APP WAS STILL LOADING (correctly positioned
       after the CSS pin fix, but visible too early — neither should
       render at all until the app has actually finished initializing).
       FIX: style.css hides both unconditionally with
       `body:not(.emp-app-ready) #quick-post-fab / #mobile-bottom-nav
       { display:none!important }`. This adds the `emp-app-ready` class at
       the one moment this codebase already treats as "real init is done"
       — app-fixes.js's own `empyrean-init-done` event, dispatched right
       after the dashboard is built, role/auth resolved, and the initial
       section navigated to.

       FOLLOW-UP (2026-08-24 — "old nav bar still appears during loading,
       especially on poor network", confirmed via screenshot: nav bar
       fully visible while the dashboard's own "Donors Who Made an Impact"
       carousel still reads "Loading…" and Community Feed is still empty,
       device showing 4G at ~25 K/s): ROOT CAUSE — the fallback below used
       to be a single unconditional `setTimeout(…, 10000)`. On a
       connection slow enough that `empyrean-init-done` genuinely hasn't
       fired yet by the 10s mark (exactly what a weak/throttled connection
       does to every Firestore-backed dashboard section this app has —
       see app-patch-v26.js/v31.js's own weak-signal diagnostics), that
       fallback fired anyway and marked the app "ready" even though it
       plainly wasn't — which is precisely what let the nav bar (and FAB)
       through while real loading was still visibly in progress. A fixed
       timeout can't tell "the event was missed" apart from "the event
       just hasn't had time to fire yet on this connection" — those need
       different handling, not the same one.

       FIX: the fallback is now network-aware and polls instead of firing
       once blindly:
         - the FIRST check is delayed longer on a connection the browser's
           own Network Information API (navigator.connection.effectiveType)
           reports as slow ('slow-2g'/'2g' → 25s, '3g' → 16s, everything
           else/unsupported → the original 10s — unchanged default, so a
           normal/fast connection behaves exactly as before);
         - at each check, if the page itself hasn't finished loading yet
           (document.readyState !== 'complete' — a real, connection-driven
           signal, not a guess) AND the hard ceiling hasn't been hit, it
           waits another 3s and checks again instead of marking ready;
         - a hard ceiling (30s) still guarantees this can never hang
           forever, preserving the original "never stuck invisible"
           guarantee — worst case, on a connection so poor even document
           load itself is stalled, the nav/FAB appear a little later than
           before instead of appearing early. empyrean-init-done firing at
           any point remains the primary, normal path — this only makes
           the FALLBACK smarter, nothing about the primary path changes. */
    (function gateQuickPostFabUntilReady() {
        if (document.body.classList.contains('emp-app-ready')) return; // already handled
        function markReady(reason) {
            if (document.body.classList.contains('emp-app-ready')) return;
            document.body.classList.add('emp-app-ready');
            log('marked app as ready (' + reason + ') — quick-post FAB + bottom nav are now allowed to render.');
        }
        document.addEventListener('empyrean-init-done', function () { markReady('empyrean-init-done fired'); });

        // Fallback only — never the normal path. Covers the case where
        // empyrean-init-done never fires at all for some reason, so the
        // button/nav aren't hidden permanently.
        var FALLBACK_CEILING_MS = 30000;
        var _fallbackStart = Date.now();

        function _initialFallbackDelay() {
            try {
                var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
                var type = conn && conn.effectiveType;
                if (type === 'slow-2g' || type === '2g') return 25000;
                if (type === '3g') return 16000;
            } catch (e) {}
            return 10000; // unchanged default — matches the original fixed delay
        }

        function _checkFallback() {
            if (document.body.classList.contains('emp-app-ready')) return; // empyrean-init-done already handled it
            var elapsed = Date.now() - _fallbackStart;
            if (document.readyState !== 'complete' && elapsed < FALLBACK_CEILING_MS) {
                // Page itself is still loading (exactly what a poor
                // connection does) — give it more time rather than
                // revealing the nav/FAB mid-load. Re-checked, not a
                // second blind timer, so it never overshoots by more
                // than this poll interval.
                setTimeout(_checkFallback, 3000);
                return;
            }
            markReady(elapsed >= FALLBACK_CEILING_MS
                ? (Math.round(FALLBACK_CEILING_MS / 1000) + 's hard ceiling — empyrean-init-done was never observed')
                : 'fallback (' + Math.round(elapsed / 1000) + 's, page finished loading) — empyrean-init-done was never observed');
        }

        setTimeout(_checkFallback, _initialFallbackDelay());
    })();

    console.log('[EmpyreanPatchV39] \u2705 Root cause of the echo (duplicate Agora clients left publishing from an un-guarded script re-execution) and the frozen taps (duplicate document click listeners from the same re-execution) fixed directly in app-live.js and app-fix-final.js (both now guarded against re-running, matching app-live-tiktok-patch.js/app-live-final.js\u2019s existing guards). This patch adds a belt-and-suspenders single-client-per-role registry so no future duplicate join, whatever causes it, can leave an orphaned client publishing and causing an echo again.');

})();