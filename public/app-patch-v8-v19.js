/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v8 + v19 (merged)
   app-patch-v8-v19.js  |  Load AFTER app-patch-v7.js

   MERGE NOTE (2026-07-31): combined into one file to reduce repo file
   count (GitHub 100-file limit on this plan). Purely mechanical —
   app-patch-v8.js and app-patch-v19.js are concatenated below UNCHANGED,
   each still in its own IIFE with its own idempotency guard
   (window._empPatchV8Loaded / window._empPatchV19Loaded), so they remain
   two independent modules that happen to ship in one file. Neither file
   is referenced by id/path from any other file in the codebase (verified:
   no other file reads _empPatchV8Loaded, _empPatchV19Loaded, or calls
   fitHostName()/wrapOnce() directly) — both only reach OUT to shared globals
   (window.notifyFriendsUserIsLive, #live-host-name, etc.), so combining
   them changes nothing about what either module does or when it can run,
   only that they now load from one <script> tag instead of two.

   Original v8 header: Issue #1 header icons back into single row with
   host name, with name-shrinking + first-name-only fallback.
   Original v19 header: dedupe the "went live" notification that fired
   twice (toast + duplicate bell entry) for the same stream.
   ============================================================================= */

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v8
   app-patch-v8.js  |  Load AFTER app-patch-v7.js

   ISSUE #1 ONLY: Header icons back into a single row with the host name,
   with name-shrinking + first-name-only fallback so the row never breaks
   again the way it did before app-patch-v?/style.css split it into two
   rows (see style.css comment above .live-header).
   ============================================================================= */

(function empyreanPatchV8() {
    'use strict';

    /* FIX (2026-07-21 — echo/frozen-tap follow-up audit): this file had no
       guard against running twice on the same page load (the same re-
       execution behavior documented in app-patch-v35.js's header, and the
       same mechanism fixed at the source in app-live.js/app-fix-final.js
       this session). A second execution would re-register this file's
       document-level click listener(s) on top of the first copy. Guarding
       here matches the convention already used by app-patch-v30.js onward. */
    if (window._empPatchV8Loaded) {
        console.warn('[V8] Already loaded — skipping duplicate execution (prevents duplicate click listeners).');
        return;
    }
    window._empPatchV8Loaded = true;

    /* ---- CSS: put .live-host-info and .live-stats back on one row ---- */
    (function injectSingleRowCSS() {
        if (document.getElementById('_pv8_header_row')) return;
        var s = document.createElement('style');
        s.id = '_pv8_header_row';
        s.textContent = [
            '.live-header {',
            '    display: flex !important;',
            '    flex-direction: row !important;',
            '    align-items: center !important;',
            '    justify-content: space-between !important;',
            '    flex-wrap: nowrap !important;',
            '    gap: 6px !important;',
            '}',
            /* let the name side actually shrink instead of being capped by
               a fixed calc(100vw - Npx) that assumes a 2-row layout */
            '.live-header .live-host-info {',
            '    flex: 1 1 auto !important;',
            '    min-width: 0 !important;',
            '    max-width: none !important;',
            '}',
            '.live-header .live-host-name-block {',
            '    min-width: 0 !important;',
            '}',
            /* icon row never shrinks or wraps — it's the fixed side */
            '.live-header .live-stats {',
            '    flex: 0 0 auto !important;',
            '    flex-wrap: nowrap !important;',
            '}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    })();

    /* ---- JS: shrink host name font, then fall back to first name ---- */
    function fitHostName() {
        var el = document.getElementById('live-host-name');
        if (!el || !el.dataset.pv8Full) return;
        var full = el.dataset.pv8Full;

        // Disconnect while we write — otherwise our own textContent/fontSize
        // writes trigger the observer below, which calls fitHostName() again,
        // forever. (This was the cause of the tab freeze.)
        if (el._pv8Observer) el._pv8Observer.disconnect();

        el.textContent = full;
        el.style.fontSize = '';

        var sizes = [0.92, 0.84, 0.76, 0.7];
        for (var i = 0; i < sizes.length; i++) {
            el.style.fontSize = sizes[i] + 'rem';
            if (el.scrollWidth <= el.clientWidth + 1) break;
        }

        if (el.scrollWidth > el.clientWidth + 1) {
            var first = full.split(/\s+/)[0];
            if (first && first !== full) el.textContent = first;
        }

        if (el._pv8Observer) {
            el._pv8Observer.observe(el, { childList: true, characterData: true, subtree: true });
        }
    }

    function scheduleFit() {
        // run after layout settles (avatar image load, modal transition, etc.)
        requestAnimationFrame(function () {
            requestAnimationFrame(fitHostName);
        });
    }

    // Re-fit whenever the name text is (re)written by other code.
    (function watchName() {
        var el = document.getElementById('live-host-name');
        if (!el) {
            // header may not exist yet at load time — retry briefly
            var tries = 0;
            var retry = setInterval(function () {
                tries++;
                el = document.getElementById('live-host-name');
                if (el || tries > 20) {
                    clearInterval(retry);
                    if (el) watchName();
                }
            }, 300);
            return;
        }
        if (el._pv8Watched) return;
        el._pv8Watched = true;

        el.dataset.pv8Full = (el.textContent || '').trim();

        var observer = new MutationObserver(function () {
            // Only reached for GENUINE external changes — our own writes in
            // fitHostName() happen while this observer is disconnected.
            el.dataset.pv8Full = (el.textContent || '').trim();
            scheduleFit();
        });
        el._pv8Observer = observer;
        observer.observe(el, { childList: true, characterData: true, subtree: true });

        scheduleFit();
    })();

    // Refit on viewport rotation/resize and whenever the live modal opens.
    window.addEventListener('resize', scheduleFit);
    document.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('#go-live-modal-overlay.show')) {
            scheduleFit();
        }
    });
    (function watchModalOpen() {
        var modal = document.getElementById('go-live-modal-overlay');
        if (!modal) return;
        new MutationObserver(function () {
            if (modal.classList.contains('show')) scheduleFit();
        }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    })();

    console.log('[EmpyreanPatchV8] ✅ Issue #1: live header back to single row, name shrink/first-name fallback wired.');

})();

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v19
   app-patch-v19.js  |  Load AFTER app-patch-v18.js

   ISSUE: "went live" notification fires TWICE — both as a toast popup and
   as a duplicate bell entry, for the exact same stream.

   ROOT CAUSE (confirmed by tracing both call sites, not guessed):
   window.notifyFriendsUserIsLive is called from TWO independent places
   every time a host goes live:

     1. app-fixes.js (~line 8291-8292) — inside the go-live-form submit
        handler, fired synchronously the instant the form is submitted,
        BEFORE the Firestore active_streams doc even exists yet.
     2. app-live.js (~line 1667-1671) — inside publishLiveStreamToFirestore(),
        fired AGAIN after the Firestore write actually succeeds.

   Both calls hit the SAME active implementation: app-fixes.js's own
   definition of window.notifyFriendsUserIsLive (~line 1800) unconditionally
   overwrites app-notifications.js's version at load time (app-fixes.js
   loads after app-notifications.js in index.html, no "already defined"
   guard the way the pushNotification fix has). That implementation
   batch-writes ONE 'user_notifications' doc PER FOLLOWER on every call —
   so a single Go Live tap writes TWO docs per follower.

   Every follower's onSnapshot listener on 'user_notifications' (app-fixes.js
   ~line 9693) treats each new doc as an independent 'added' event and
   fires pushNotification()/showNotification() for it. Two docs per stream
   = two toasts + two bell entries per follower, for the same "X is now
   LIVE" event.

   FIX: don't touch either call site (both have legitimate standalone
   reasons documented in their own comments — one guards the immediate-
   feedback case, the other guards the "only after Firestore confirms"
   case). Instead, wrap window.notifyFriendsUserIsLive itself so that a
   second call for the SAME streamId within a short window is a no-op,
   regardless of which call site fires first or whether app-live.js's own
   publish-retry-on-failure path (setTimeout → publishLiveStreamToFirestore
   again, 3s later) adds a third attempt. One streamId → one dispatch.
   ============================================================================= */

(function empyreanPatchV19() {
    'use strict';

    function log(msg) { console.log('[V19-LiveNotifyDedupe] ' + msg); }

    // Comfortably covers the gap between the two known call sites (form
    // submit → Firestore write ack, normally well under a second) plus
    // app-live.js's own 3s publish-retry-on-failure path, without risking
    // suppressing a GENUINE second "went live" from the same host minutes
    // later (e.g. a stream ended and restarted).
    var DEDUPE_WINDOW_MS = 8000;

    var _lastDispatch = {}; // streamId -> timestamp

    function wrapOnce() {
        var orig = window.notifyFriendsUserIsLive;
        if (typeof orig !== 'function' || orig._pv19Wrapped) return;

        var wrapped = function (hostName, streamId) {
            var key = streamId || '__no_stream_id__';
            var now = Date.now();
            var last = _lastDispatch[key];
            if (last && (now - last) < DEDUPE_WINDOW_MS) {
                log('suppressed duplicate call for streamId=' + key + ' (' + (now - last) + 'ms after previous dispatch)');
                return;
            }
            _lastDispatch[key] = now;
            return orig.apply(this, arguments);
        };
        wrapped._pv19Wrapped = true;
        wrapped._pv19Orig = orig;
        window.notifyFriendsUserIsLive = wrapped;
        log('wrapped window.notifyFriendsUserIsLive with per-streamId dedupe (' + DEDUPE_WINDOW_MS + 'ms window).');
    }

    // Wrap now, plus a couple of defensive re-checks shortly after load in
    // case some other script reassigns window.notifyFriendsUserIsLive
    // after this file runs (wrapOnce() is a no-op once already wrapped,
    // so this can never stack multiple wrappers).
    wrapOnce();
    setTimeout(wrapOnce, 500);
    setTimeout(wrapOnce, 1500);
    document.addEventListener('empyrean-init-done', function () { setTimeout(wrapOnce, 200); });

    console.log('[EmpyreanPatchV19] ✅ Duplicate "went live" notification fixed — notifyFriendsUserIsLive() now dispatches at most once per streamId per ' + DEDUPE_WINDOW_MS + 'ms, so the two independent call sites (app-fixes.js go-live submit handler + app-live.js publishLiveStreamToFirestore) can no longer both fire for the same stream.');

})();