/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v35
   app-patch-v35.js  |  Load LAST (after app-patch-v34.js)

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #1 — mic/camera too small in the HOST control panel (screenshot:
   the chevron-slide-out panel with screen-share/goal/fan-club/games/pin)
   ═══════════════════════════════════════════════════════════════════════
   ROOT CAUSE: #live-mic-toggle / #live-video-toggle are the SAME two
   button nodes in both places — app-live-tiktok-patch.js physically
   relocates them into `.live-footer` for an accepted guest broadcaster
   and back into `#host-control-panel-inner` for the host (see that
   file's own relocateMicCamButtons()/refreshRoleVisibility()). Both
   app-patch-v32.js and app-patch-v34.js styled these two ids with a bare
   `#live-mic-toggle, #live-video-toggle { width:26px!important; ... }`
   rule — bare, i.e. not scoped to which container they're currently
   sitting in — so the 26px footer size was being applied in the host
   panel too, where every OTHER button (`#live-share-screen-btn`,
   `#live-goal-settings-btn`, `#live-fan-club-btn`, `#live-games-btn`,
   `#live-pin-message-btn`) is untouched at its original 45px
   (`#host-control-panel .live-action-btn` in style.css). That's the
   visible mismatch in the screenshot — mic/cam noticeably smaller than
   their five neighbors in the same slide-out panel.

   (This directly follows up the earlier "should mic/camera be identical
   between host and guest screens" question — the answer, now confirmed
   against the actual screenshot, is that mic/camera should match
   whichever row they're CURRENTLY part of: the footer's 26px family when
   relocated into `.live-footer` for a guest broadcaster, and the host
   panel's 45px family when sitting in `#host-control-panel-inner` — not
   one fixed size regardless of context. Since it's a relocated shared
   node, that just means scoping the CSS by container, done below.)

   FIX: a container-scoped rule, `#host-control-panel-inner
   #live-mic-toggle` / `#live-video-toggle` (two ID selectors —
   higher specificity than v32/v34's bare single-ID rule on its own,
   plus `!important` and later load order as backup), restores the
   45px size — and the same dark-glass badge look already used
   everywhere else in this app, so it still reads as one visual family,
   just at the size that matches its actual neighbors — whenever these
   two buttons are inside the host panel. The `.live-footer` version
   (26px) from v34 is completely untouched; nothing here changes what a
   guest broadcaster sees. The glyph inside is scaled up to match the
   larger box, at the same proportion v34 already used for the small
   version.

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #2 (no code change — explanation) — "client is offline" /
   "[Own status fetch] unavailable" even though the device shows 4G bars
   ═══════════════════════════════════════════════════════════════════════
   This message is Firestore's OWN client-side heuristic, not a read of
   the device's actual radio/OS network state. The SDK keeps an internal
   "am I online" flag that flips to false the moment ANY request fails to
   get a server round-trip within its timeout — then every read that
   needs a fresh (non-cached) document short-circuits immediately with
   this exact error until the SDK's own backoff-and-retry logic proves a
   round-trip succeeds again. So "4G, 2 bars, X Kb/s" and "Firestore
   thinks it's offline" are not contradictory — a mobile connection can
   be technically up but slow/lossy enough that one request times out,
   which is enough to flip that flag even though the next request two
   seconds later might succeed fine. All three of tonight's screenshots
   show exactly that pattern: signal bars present the whole time,
   throughput bouncing (222 K/s → 473 K/s → 32 K/s across them) — the
   same weak/bouncing-4G shape app-patch-v31 already diagnosed for this
   device, not a true offline device.

   Two concrete, targeted responses to this, not a blanket "ignore the
   error":
     - The dashboard/public-stream-list side was already covered by
       v34's connectivity watchdog (confirmed working in the screenshot's
       own console: "[V34] connectivity restored — live listener already
       delivering updates normally, no re-scan needed.").
     - The JOIN-request side specifically — the actual "users should be
       able to join" ask — is fixed directly in
       app-live-tiktok-patch.js's sendJoinRequest() this session (see the
       diff shipped alongside this patch): a tap that fails with
       Firestore's `unavailable` code (which is what backs both "client
       is offline" and a real timeout) now gets ONE automatic retry
       1.5s later before showing any failure toast, instead of failing
       on the first blip. A genuinely dead connection (retry also fails)
       still reports a clear error rather than hanging silently. This
       could not be done as a pure additive patch — sendJoinRequest() is
       private inside that file's closure and reached only through one
       document-level delegated listener defined in the same closure, the
       same constraint app-patch-v33's header already ran into for
       accept/decline/mute — so, like v33, the minimal necessary edit was
       made directly in that function rather than duplicating the whole
       flow in a new file.
     - The "[Own status fetch] unavailable" line in the screenshot is a
       DIFFERENT feature (status/story fetching) hitting the same
       underlying heuristic — left as-is here since it wasn't the
       reported symptom ("join live streaming") and applying the same
       retry treatment there is a separate, equally surgical edit to
       whichever function owns that fetch, better done as its own
       explicit request than bundled in here as a guess.

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #3 — screenshot 3, "⚠ [V32] Already loaded — skipping duplicate."
   ═══════════════════════════════════════════════════════════════════════
   REVIEWED — this is not a bug and nothing was changed for it.
   app-patch-v32.js appears exactly ONCE in index.html's <script> list
   (confirmed by re-checking the file directly), and no other file
   dynamically injects a second copy. This warning is v32's own
   self-guard — `if (window._empPatchV32Loaded) { console.warn(...);
   return; }`, the same idempotency pattern v30/v31/v33/v34/this file all
   use — firing because the local dev preview server (localhost:26543,
   the same host every one of tonight's screenshots is on) re-executes
   page scripts on a hot-reload/live-preview refresh without a full page
   navigation. That guard is exactly what stops a real double-run (double
   event listeners, double MutationObservers, etc.) in that situation —
   it is working as designed. It will not appear at all on a normal cold
   page load/production deploy, only in this kind of dev-preview
   in-place-refresh. Nothing to fix.
   ============================================================================= */

(function empyreanPatchV35() {
    'use strict';

    if (window._empPatchV35Loaded) {
        console.warn('[V35] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV35Loaded = true;

    function log(msg) { console.log('[V35] ' + msg); }

    (function injectHostPanelMicCamCSS() {
        if (document.getElementById('pv35-host-panel-miccam-css')) return;
        var css = document.createElement('style');
        css.id = 'pv35-host-panel-miccam-css';
        css.textContent =
            /* Container-scoped: only applies while these two buttons are
               physically inside the host control panel (host role) — the
               `.live-footer` version from app-patch-v34.js (guest
               broadcaster) is untouched. Two ID selectors beat v32/v34's
               bare single-ID rule on specificity alone; !important +
               later load order is the same backup those files already
               rely on for each other. */
            '#host-control-panel-inner #live-mic-toggle,' +
            '#host-control-panel-inner #live-video-toggle {' +
            '  width: 45px !important;' +
            '  height: 45px !important;' +
            '  border-radius: 12px !important;' +
            '}' +
            /* Glyph scaled up to match — same ratio v34 used for the 26px
               footer version (15px glyph / 26px box ≈ 0.58), applied to
               the larger 45px host-panel box. */
            '#host-control-panel-inner #live-mic-toggle::before,' +
            '#host-control-panel-inner #live-video-toggle::before {' +
            '  width: 26px !important; height: 26px !important;' +
            '}';
        document.head.appendChild(css);
        log('restored host-control-panel mic/camera to 45px (matching share-screen/goal/fan-club/games/pin in the same slide-out panel) — the .live-footer guest-broadcaster size from app-patch-v34.js is untouched.');
    })();

    console.log('[EmpyreanPatchV35] \u2705 Host control panel mic/camera now match their five panel neighbors at 45px (was incorrectly inheriting the 26px footer size). sendJoinRequest() now retries once on a transient Firestore "unavailable" (client-offline heuristic) instead of failing on the first weak-signal blip \u2014 see the accompanying app-live-tiktok-patch.js diff. app-patch-v32.js\u2019s "already loaded" console warning reviewed \u2014 confirmed to be the dev-preview hot-reload re-executing scripts, not a real duplicate include; no fix needed.');

})();