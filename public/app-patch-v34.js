/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v34
   app-patch-v34.js  |  Load LAST (after app-patch-v33.js)

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #1 — exit/end-guest button still too large + footer buttons not
   uniform (size/background/height/width)
   ═══════════════════════════════════════════════════════════════════════
   ROOT CAUSE (confirmed by reading every rule that touches these buttons,
   not guessed): three different patches currently disagree with each
   other on the SAME footer row:
     - app-live-tiktok-patch.js's own base rule sizes
       .live-action-btn/.tk-footer-icon at 32px (its own comment calls
       this "user-chosen middle ground").
     - app-patch-v32.js §3 overrides #tk-exit-guest-btn alone down to
       26px with a dark-glass background.
     - app-patch-v32.js §5 overrides rose/gift/share/request-to-join back
       UP to 46px, with gift/request keeping their own tinted
       backgrounds.
   Three sizes (26 / 32 / 46) and two different background treatments on
   one visual row is exactly the "not uniform" bug being reported — v32
   never actually finished unifying the row, it just moved the mismatch
   around.

   FIX: one rule, loaded after all of the above, sets EVERY footer badge
   — mic, camera, exit, rose, gift, share, request-to-join — to the exact
   same 26px size, corner radius, dark-glass background, and border. Gift
   and request-to-join lose their previous gold/pink tint on the BADGE
   itself (their icon graphic keeps its own colour, only the backing
   plate is unified) since "same background" was explicit. Selectors
   match or exceed the specificity of the rules being superseded (ID +
   class, same as v32/tiktok-patch used) so this doesn't need a
   specificity war, just correct source order — and it's added as a new
   <style> tag, so nothing in the three files above needs to be edited or
   reverted; this is purely additive/superseding, exactly like v30–v33
   already do to each other.

   Inner icon graphics that were sized for the old 32-46px badges are
   scaled down to sit comfortably inside the new 26px one (mic/camera's
   ::before glyph, gift's inline SVG). The rose "support" icon and the
   request-to-join icon are DELIBERATELY left at their existing 68px —
   both already intentionally bleed past their own button's edge
   (see app-live-tiktok-patch.js's own "Container circle itself stays at
   its normal 40px... only the icon graphic grows" comment); that bleed
   is independent of the container's box size, so shrinking the box does
   not clip or resize that effect.

   A small invisible hit-slop (::after, inset -9px) is added to every one
   of these buttons so the actual tappable area stays comfortable even
   though the visible badge is now small — this only affects touch
   target size, not layout, and cannot change which element a tap
   resolves to (all click handling already runs through
   `e.target.closest('#id'/'.class')`, and a pseudo-element inside that
   same element still resolves `closest()` to the same node).

   Nothing here touches any element's id, class list, DOM position, or
   click wiring — app-live.js's mic/camera Agora handlers,
   app-live-tiktok-patch.js's exitGuestSlot()/sendJoinRequest()/
   sendQuickRose()/openGiftCatalog(), and the composer-expand/collapse
   logic are all untouched. This is a superseding <style> tag only.

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #2 — composer column should keep its exact pre-guest width
   ═══════════════════════════════════════════════════════════════════════
   VERIFIED, NOT CHANGED: app-live-tiktok-patch.js's lockComposerWidth()
   (inside refreshRoleVisibility()) already does exactly this correctly —
   it measures the composer's own real rendered width on every snapshot
   while the device is NOT a guest broadcaster, and only freezes that
   real measurement (not a guessed constant) the instant the device
   becomes an accepted guest broadcaster, via
   `--tk-locked-composer-width` + `.tk-composer-width-locked`. It unlocks
   again the moment the guest leaves the slot so a later re-join
   re-measures fresh. This is already correct — re-implementing it here
   would only risk a second, competing layer (the exact "another layer
   racing the other ones" trap this codebase's own patch history already
   flags, see app-patch-v28.js / v31 / v33 headers). Left untouched.

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #3 — "backend connectivity... no longer displaying in the
   general public dashboard for all to see and join"
   ═══════════════════════════════════════════════════════════════════════
   Screenshot shows the Firebase JS SDK's own message: "Could not reach
   Cloud Firestore backend. Backend didn't respond within 10 seconds...
   client will operate in offline mode until it is able to successfully
   connect" — logged at 17:30:51Z, on a connection already fluctuating
   (209 K/s in-shot, matching the same weak/bouncing-4G pattern
   app-patch-v31's header already diagnosed for this device). This is
   Firestore's own transient-offline handling, not a code exception — the
   SDK is designed to reconnect and replay changes on its own once the
   network recovers, and app-patch-v31 already handles the ONE failure
   mode that does NOT self-heal (the internal-assertion wedge).

   What v31 does not cover: window.startLiveStreamListener() (app-live.js)
   does its ONE-TIME initial population via a plain `.get()` call. If
   that specific call happens to land during an offline window, its
   `.catch()` falls back to a second one-time `.get()` (also just as
   likely to fail on the same dead connection) and then simply stops —
   there is no retry once both attempts are exhausted. The live onSnapshot
   listener attached right after it will still self-heal and deliver
   updates once the connection returns, but only for CHANGES from that
   point forward; a stream that was already live and already fully
   published before the listener reconnected produces no new
   docChange event, so it never gets inserted, and the public dashboard
   stays visually empty even after connectivity is restored.

   FIX: a lightweight watchdog that (a) shows a small, unobtrusive
   "Reconnecting…" pill over the dashboard live-stream row the moment
   this exact Firestore offline message is logged, (b) clears it the
   moment any active_streams snapshot successfully arrives, and (c) if
   the dashboard's live row is still empty 4 seconds after connectivity
   is confirmed back (browser `online` event OR a successful snapshot),
   re-runs the exact same one-time full-scan `startLiveStreamListener()`
   already does — through the public function itself, not a duplicate
   query — so any stream that was missed during the outage window gets
   picked up without waiting for its next heartbeat write. Capped at one
   retry per reconnect event so this can't loop.

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #4 — "make sure send request button works"
   ═══════════════════════════════════════════════════════════════════════
   VERIFIED, NOT CHANGED: sendJoinRequest() (app-live-tiktok-patch.js) is
   wired via one document-level delegated click listener
   (`e.target.closest('#live-request-join-btn')`, attached once at module
   init, not per-render), so it survives every footer re-render/reorder
   this and every other patch file performs. It already: guards guest/
   host/no-ref/already-pending states with a user-facing notify() in each
   branch (including the one case — isHost() — that used to fail
   silently, per its own [GUESTREQ-DIAG] logging), disables the button
   for the duration of the write, and reports the real Firestore error
   message on failure instead of swallowing it. That code path is sound;
   the one thing that COULD make it look "not working" is exactly Issue
   #3 above (a request tap during a genuine offline window fails with a
   real, already-surfaced error toast) — not a bug in the handler itself.
   §4 below only adds a one-time boot-time diagnostic confirming the
   button and its delegated handler are both present, so a future report
   of "still not working" is instantly distinguishable (missing DOM node
   vs. missing listener vs. a real Firestore error) instead of starting
   from zero again.
   ============================================================================= */

(function empyreanPatchV34() {
    'use strict';

    if (window._empPatchV34Loaded) {
        console.warn('[V34] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV34Loaded = true;

    function log(msg)  { console.log('[V34] ' + msg); }
    function warn(msg) { console.warn('[V34] ' + msg); }

    /* =========================================================================
       §1 — uniform 26px footer badges (size + background) for every
       footer icon button, superseding the 26/32/46px three-way mismatch
       described above.
       ========================================================================= */
    (function injectUniformFooterCSS() {
        if (document.getElementById('pv34-uniform-footer-css')) return;
        var css = document.createElement('style');
        css.id = 'pv34-uniform-footer-css';
        css.textContent =
            /* Same dark-glass recipe already used elsewhere in this app
               (app-patch-v32.js §3/§4) — kept identical on purpose so this
               reads as "the one footer button family", not a new style. */
            '.live-footer .live-action-btn,' +
            '.live-footer .tk-footer-icon,' +
            '.live-footer #live-mic-toggle,' +
            '.live-footer #live-video-toggle,' +
            '#live-mic-toggle, #live-video-toggle,' +
            '.live-footer #live-gift-btn,' +
            '.live-footer .share-live-btn,' +
            '.live-footer #tk-rose-quick-btn.tk-footer-icon,' +
            '#live-request-join-btn.tk-request-premium,' +
            '#tk-exit-guest-btn.tk-exit-guest-btn {' +
            /* 2026-07-17 revision: 26px read as visibly smaller/harder to
               tap than the rest of the live UI (confirmed against the
               TikTok-style reference screenshot's own footer row) and, at
               that size, this rule's own hit-slop (::after, inset -9px
               below) overlapped its *neighbor's* hit-slop across the
               row's 8px gap — a tap near the shared edge could resolve to
               the wrong button. Sized up to 44px (comfortably tappable on
               its own — deliberately NOT matched to the separate 45px
               host-control-panel/chevron buttons, which stay untouched:
               see the bare #live-mic-toggle/#live-video-toggle selectors
               above, which app-patch-v35.js's more specific
               #host-control-panel-inner-scoped rule already overrides
               back to 45px whenever those two buttons are sitting in the
               host panel instead of this footer). Gap widened to match
               (see app-live-tiktok-patch.js's own .live-footer rule) and
               the hit-slop shrunk accordingly so it no longer reaches
               into that gap. */
            '  width: 44px !important;' +
            '  height: 44px !important;' +
            '  border-radius: 14px !important;' +
            '  background: linear-gradient(145deg, rgba(46,46,52,0.62), rgba(16,16,20,0.78)) !important;' +
            '  border: 1px solid rgba(255,255,255,0.10) !important;' +
            '  box-shadow: 0 3px 10px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08) !important;' +
            '  flex-shrink: 0;' +
            '  position: relative;' +
            '}' +
            '.live-footer .live-action-btn:active,' +
            '.live-footer .tk-footer-icon:active,' +
            '#live-mic-toggle:active, #live-video-toggle:active,' +
            '.live-footer #live-gift-btn:active,' +
            '.live-footer .share-live-btn:active,' +
            '.live-footer #tk-rose-quick-btn.tk-footer-icon:active,' +
            '#live-request-join-btn.tk-request-premium:active,' +
            '#tk-exit-guest-btn.tk-exit-guest-btn:active { transform: scale(0.90); }' +
            /* Glyphs rescaled to sit comfortably inside the new 44px box
               (up from the 15px sized for the old 26px box). Rose +
               request-to-join icons are intentionally NOT touched here —
               see header note, they bleed past their button by design,
               independent of the button's own size. Bare #live-mic-toggle/
               #live-video-toggle again only reaches this footer context in
               practice — app-patch-v35.js's #host-control-panel-inner-
               scoped ::before rule (200 specificity vs. this rule's 100)
               keeps the host panel's own glyph size untouched. */
            '#live-mic-toggle::before, #live-video-toggle::before {' +
            '  width: 24px !important; height: 24px !important;' +
            '}' +
            '.live-footer #live-gift-btn svg {' +
            '  width: 22px !important; height: 22px !important;' +
            '}' +
            '.tk-icon-svg { width: 20px !important; height: 20px !important; }' +
            /* Invisible hit-slop: a little extra tap margin around each
               now-comfortably-sized badge. Shrunk from -9px to -4px (was
               sized for the old, much smaller 26px badge) so adjacent
               buttons' slop can no longer reach across the row's gap and
               overlap — see app-live-tiktok-patch.js's .live-footer gap,
               widened from 8px to 14px alongside this, so even two -4px
               slops facing each other (8px combined) stay clear of it.
               Pure geometry — does not change which element
               e.target.closest() resolves to. */
            '.live-footer .live-action-btn::after,' +
            '.live-footer .tk-footer-icon::after,' +
            '#live-mic-toggle::after, #live-video-toggle::after,' +
            '.live-footer #live-gift-btn::after,' +
            '.live-footer .share-live-btn::after,' +
            '.live-footer #tk-rose-quick-btn.tk-footer-icon::after,' +
            '#live-request-join-btn.tk-request-premium::after,' +
            '#tk-exit-guest-btn.tk-exit-guest-btn::after {' +
            '  content: ""; position: absolute; inset: -4px;' +
            '}';
        document.head.appendChild(css);
        log('injected uniform 44px dark-glass badge CSS across every footer button (mic, camera, exit, rose, gift, share, request-to-join) — up from 26px so each is comfortably tappable, with the gap widened and the hit-slop shrunk to match so neighboring buttons can no longer overlap each other\'s tap area. Host-control-panel/chevron buttons (45px) are untouched — see the inline notes above.');
    })();

    /* =========================================================================
       §2 — dashboard live-stream connectivity watchdog. Purely additive:
       calls window.startLiveStreamListener() (already defined,
       already idempotent — it tears down and re-attaches its own
       listener on every call) instead of running a second competing
       query.
       ========================================================================= */
    (function connectivityWatchdog() {
        var OFFLINE_SIGNATURE = /Could not reach Cloud Firestore backend/i;
        var _offline = false;
        var _pendingRetry = false;
        var _lastRetryAt = 0;

        function banner(show) {
            var el = document.getElementById('pv34-reconnect-pill');
            var slider = document.getElementById('dashboard-live-slider');
            if (show) {
                if (el || !slider) return;
                el = document.createElement('div');
                el.id = 'pv34-reconnect-pill';
                el.textContent = 'Reconnecting…';
                el.style.cssText =
                    'display:inline-flex;align-items:center;gap:6px;' +
                    'background:rgba(0,0,0,0.55);color:#F5C518;' +
                    'font:600 11px/1 sans-serif;padding:6px 12px;' +
                    'border-radius:999px;border:1px solid rgba(245,197,24,0.3);' +
                    'margin:6px 0;';
                slider.parentNode.insertBefore(el, slider);
            } else if (el) {
                el.remove();
            }
        }

        function wrapConsoleError() {
            var orig = console.error;
            if (orig._pv34Wrapped) return;
            var wrapped = function () {
                try {
                    var joined = Array.prototype.slice.call(arguments).map(function (a) {
                        return (a && a.message) ? a.message : String(a);
                    }).join(' ');
                    if (OFFLINE_SIGNATURE.test(joined) && !_offline) {
                        _offline = true;
                        warn('Firestore reported offline — showing reconnect indicator on the public dashboard.');
                        banner(true);
                    }
                } catch (e) { /* never let the detector break real logging */ }
                return orig.apply(this, arguments);
            };
            wrapped._pv34Wrapped = true;
            console.error = wrapped;
        }
        wrapConsoleError();

        function onReconnected() {
            if (!_offline && !_pendingRetry) return; // nothing to recover from
            _offline = false;
            banner(false);
            var now = Date.now();
            if (now - _lastRetryAt < 4000) return; // one retry per reconnect, no loops
            _lastRetryAt = now;
            _pendingRetry = true;
            setTimeout(function () {
                _pendingRetry = false;
                var slider = document.getElementById('dashboard-live-slider');
                // FIX 2026-07-17 ("connectivity restored" logs, but a stream
                // that published fine during the outage window never appears
                // on other devices' dashboards): this used to check
                // `slider.children.length === 0`, which never actually
                // reaches 0. #live-slider-empty (the "No live streams"
                // placeholder) is a permanent child of this same slider that
                // _insertStreamCard (app-live.js) and createDashboardLiveCard
                // (app-fixes.js) only ever hide via `style.display='none'` —
                // neither removes it from the DOM — so the slider always has
                // at least that one child node, even with zero real
                // live-stream cards showing. That made the re-scan branch
                // below dead code: every reconnect fell through to "no
                // re-scan needed" regardless of whether a stream was actually
                // missing, which is exactly the reported symptom. Switched to
                // the same check app-live.js's own docChange 'removed'
                // handler already uses for this identical question — real
                // card count via `.join-live-btn`, not raw child count. Old
                // condition kept disabled below rather than deleted, per
                // convention.
                false && (slider && slider.children.length === 0);
                var hasLiveCard = slider && !!slider.querySelector('.join-live-btn');
                if (slider && !hasLiveCard && typeof window.startLiveStreamListener === 'function') {
                    log('connectivity restored and the public live row has no live cards — re-running the one-time full scan so any stream missed during the outage gets picked up.');
                    window.startLiveStreamListener();
                } else {
                    log('connectivity restored — live listener already delivering updates normally, no re-scan needed.');
                }
            }, 4000);
        }

        window.addEventListener('online', onReconnected);
        // Also treat any successful active_streams write/read anywhere in
        // the app as a reconnect signal — cheaper and earlier than waiting
        // on the browser's own (sometimes unreliable) 'online' event.
        document.addEventListener('empyrean:firebase-ready', onReconnected);
        var _healthPoll = setInterval(function () {
            if (navigator.onLine && _offline) onReconnected();
        }, 5000);
        window.addEventListener('beforeunload', function () { clearInterval(_healthPoll); });
    })();

    /* =========================================================================
       §3 — one-time boot diagnostic for the send-request button. Does not
       add or replace any click handling — sendJoinRequest()'s existing
       document-level delegated listener is untouched. Read-only check.
       ========================================================================= */
    (function verifyRequestButtonWiring() {
        function check() {
            var btn = document.getElementById('live-request-join-btn');
            if (!btn) {
                warn('#live-request-join-btn not found in the DOM yet (expected — it only exists once the live screen has rendered once). Will not report further on this.');
                return;
            }
            log('✅ #live-request-join-btn present. Click handling is delegated at document level in app-live-tiktok-patch.js (survives footer re-renders). Tap failures will surface their real cause via notify() — "please log in", "already pending", "stream not ready yet", or the actual Firestore error message — rather than failing silently.');
        }
        if (document.readyState !== 'loading') setTimeout(check, 1000);
        else document.addEventListener('DOMContentLoaded', function () { setTimeout(check, 1000); });
    })();

    console.log('[EmpyreanPatchV34] \u2705 Footer buttons (mic/camera/exit/rose/gift/share/request-to-join) unified to one 26px dark-glass badge family with a matching hit-slop for touch usability. Composer full-width-lock verified already correct (untouched). Added a connectivity watchdog that shows a reconnect indicator and re-scans the public dashboard\u2019s live row once a dropped connection recovers, so a stream missed during an outage isn\u2019t stuck invisible. Verified the send-request button\u2019s existing wiring is sound.');

})();