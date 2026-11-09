/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v29
   app-patch-v29.js  |  Load LAST (after app-patch-v26.js AND app-live-final.js)

   NUMBERING NOTE: index.html already has commented-out, RETIRED entries
   for "app-patch-v27.js" and "app-patch-v28.js" (both absorbed into
   app-live-final.js on 2026-07-15 — see index.html's own history for
   that write-up). This file is unrelated to either of those and is
   numbered v29 specifically so it doesn't get confused with that retired
   history in the load list.

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #1a — "Host control: sending gifts worked once, then stopped"
   ═══════════════════════════════════════════════════════════════════════
   ROOT CAUSE (confirmed via console trace, not guessed — field log showed
   "[GiftModal][DIAG] classList.add(show) called... class is now:
   live-sub-modal show" firing every single tap, with nothing ever
   appearing on screen after the first open):

   #live-gift-catalog-modal has TWO independent open paths:
     1. #live-gift-btn (footer) -> app-patch-v7.js's _wireGiftBtn().
        That function ALREADY does `modalNow.style.removeProperty('display')`
        right before adding 'show' -- its own comment explains why: some
        close paths (e.g. app-nav.js's generic capture-phase close-button
        handler) leave a stale inline `display:none` on the modal, and an
        inline style always beats the `.live-sub-modal.show { display:flex }`
        CSS rule. v7 already patched THIS ONE button to clear that stale
        style before every open.
     2. Every guest/grid box gift affordance (.emp-gb-gift, the coin
        badge, .tk-gb-gift-hint) -> app-live-final.js's _giftFromBox() /
        app-live-tiktok-patch.js's box handler -> window.openGiftCatalog()
        (app-gifts.js) DIRECTLY. openGiftCatalog() only ever does
        `modal.classList.add('show')` -- it never got the same stale-style
        cleanup v7 gave the footer button. So: first tap on a box (no
        stale style yet) opens fine. The moment the modal is closed once
        by anything that leaves that inline style behind, every LATER tap
        on a box keeps re-adding 'show' (confirmed in the console) but
        the modal stays invisible underneath it -- exactly "worked once,
        then stopped."

   FIX: wrap window.openGiftCatalog itself -- the one function every path
   already funnels through -- with the exact same one-line cleanup v7
   already proved correct for the footer button. No new logic, no
   duplicate implementation of the open/populate flow; this only closes
   the gap between the two entry points.

   ═══════════════════════════════════════════════════════════════════════
   ISSUE #1b — "Swap to big screen: tap turns the screen blue, tap again
   turns it black, no way to tell what's selected"
   ═══════════════════════════════════════════════════════════════════════
   ROOT CAUSE: app-live-final.js's spotlight/self-swap logic decides
   whether to move a participant's video wrapper into .main-host-video
   purely by checking whether that wrapper DIV exists in the DOM -- not
   whether Agora has actually attached a live video track to it yet.
   Swapping in a wrapper with nothing playing leaves .main-host-video
   empty, so whatever sits behind it shows through instead: the stream's
   own background gradient (blue, #1B2B8B) when nothing at all is placed,
   or a bare <video> element's default solid-black fill when a wrapper
   IS placed but has no active track yet. Two different "nothing to show"
   states, and nothing on screen ever said which participant (if any) was
   actually selected.

   FIX (additive, read-only -- does not reach into app-live-final.js's
   private closure, so it can't duplicate or conflict with its placement
   logic): a MutationObserver on .main-host-video reports whatever wrapper
   is actually inside it right now, reading that participant's name off
   their OWN existing strip box label (kept in the DOM at all times per
   app-live-final.js's own design, even while the grid layout is showing)
   -- never a second hardcoded copy of names. Paired with a single
   read-only, non-blocking capture-phase tap listener (never calls
   stopPropagation/preventDefault, so it cannot interfere with any
   existing handler) that surfaces a short text label for every host
   control / box action as it's tapped, per the requested behaviour: "a
   visible text indicator should display the currently active option."
   ============================================================================= */

(function empyreanPatchV29() {
    'use strict';

    if (window._empPatchV29Loaded) {
        console.warn('[V29] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV29Loaded = true;

    function log(msg) { console.log('[V29] ' + msg); }
    function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

    /* =========================================================================
       §1 — gift modal: clear stale inline display before every open, no
       matter which entry point triggered it.
       ========================================================================= */
    function wrapOpenGiftCatalog() {
        var orig = window.openGiftCatalog;
        if (typeof orig !== 'function' || orig._pv29Wrapped) return;
        var wrapped = function (recipientId, recipientName) {
            var modal = document.getElementById('live-gift-catalog-modal');
            // Same one-line cleanup app-patch-v7.js already proved correct
            // for the footer button — see header comment for why an inline
            // display:none can otherwise survive a close and permanently
            // beat the .show CSS rule on every later open.
            if (modal) modal.style.removeProperty('display');
            return orig.apply(this, arguments);
        };
        wrapped._pv29Wrapped = true;
        window.openGiftCatalog = wrapped;
        log('wrapped window.openGiftCatalog — stale inline display now cleared before every open, on every entry point (footer button, strip box, grid box).');
    }
    wrapOpenGiftCatalog();
    setTimeout(wrapOpenGiftCatalog, 500);
    setTimeout(wrapOpenGiftCatalog, 1500);
    document.addEventListener('empyrean-init-done', function () { setTimeout(wrapOpenGiftCatalog, 200); });

    /* =========================================================================
       §2 — persistent text indicator: current big-screen occupant +
       last-tapped control. Purely observational; touches no existing
       handler or private state.
       ========================================================================= */
    function ensureIndicator() {
        var existing = document.getElementById('emp-action-indicator');
        if (existing) return existing;
        var host = document.querySelector('.live-body');
        if (!host) return null;
        var el = document.createElement('div');
        el.id = 'emp-action-indicator';
        el.style.cssText =
            'position:absolute;top:8px;left:50%;transform:translateX(-50%);' +
            'max-width:82%;padding:5px 14px;border-radius:999px;background:rgba(0,0,0,0.68);' +
            'color:#F5C518;font-size:0.7rem;font-weight:700;white-space:nowrap;overflow:hidden;' +
            'text-overflow:ellipsis;z-index:20;pointer-events:none;opacity:0;' +
            'transition:opacity 0.18s ease;text-align:center;';
        host.appendChild(el);
        return el;
    }

    var _hideTimer = null;
    var _persistentText = null; // current big-screen occupant label — stays on screen, unlike transient tap confirmations

    // FIX ("swap to big screen ... no way to tell what's selected"):
    // this used to fade EVERY message, including the big-screen occupant
    // status, after 2.4s — so the one piece of information the host
    // actually needs to keep seeing (who is on the big screen right now)
    // disappeared just as fast as a transient "Spotlighting…" tap
    // confirmation. Occupant status is now persistent (no auto-fade);
    // only short-lived action confirmations fade, and they restore the
    // persistent occupant label underneath once they do, instead of
    // fading to nothing.
    function showIndicator(text, isPersistentStatus) {
        var el = ensureIndicator();
        if (!el) return;
        el.textContent = text;
        el.style.opacity = '1';
        if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
        if (isPersistentStatus) {
            _persistentText = text;
            return; // no fade — stays visible until the occupant changes again
        }
        _hideTimer = setTimeout(function () {
            if (_persistentText) {
                el.textContent = _persistentText;
                el.style.opacity = '1'; // restore the persistent occupant label, not a blank fade
            } else {
                el.style.opacity = '0';
            }
        }, 2000);
    }

    // Name for whichever wrapper now occupies the big screen — reads it
    // straight off that participant's own persistent strip box (always
    // present in the DOM per app-live-final.js's own design, even while
    // the grid layout is the one visible), so this can never drift out
    // of sync with a second, separately-maintained name list.
    function _nameForWrapperId(id) {
        if (!id) return null;
        if (id === 'agora-local-video') return 'You';
        var m = /^agora-guest-(.+)$/.exec(id);
        if (!m) return null;
        var box = document.querySelector('.emp-live-box[data-agora-uid="' + m[1] + '"]');
        var nm = box && box.querySelector('.emp-gb-name');
        return nm ? nm.textContent : 'Guest';
    }

    function _hasLiveMedia(wrapper) {
        if (!wrapper) return false;
        var v = wrapper.querySelector('video');
        if (v && (v.srcObject || v.currentSrc)) return true;
        var img = wrapper.querySelector('img');
        return !!(img && img.src && img.style.display !== 'none');
    }

    function watchBigScreen() {
        var big = document.querySelector('.live-body .main-host-video');
        if (!big || big._pv29Watched) return;
        big._pv29Watched = true;
        function _checkOccupant() {
            var wrapper = null;
            for (var i = 0; i < big.children.length; i++) {
                if (/^agora-(local-video|guest-)/.test(big.children[i].id || '')) { wrapper = big.children[i]; break; }
            }
            if (!wrapper) return; // nothing placed — leave the last message to fade on its own rather than flashing blank
            var name = _nameForWrapperId(wrapper.id) || 'Big screen';
            showIndicator(_hasLiveMedia(wrapper) ? ('\uD83D\uDCFA Big screen: ' + name) : ('\uD83D\uDCFA Big screen: ' + name + ' (connecting\u2026)'), true);
        }
        var obs = new MutationObserver(_checkOccupant);
        obs.observe(big, { childList: true });
        // FIX: a MutationObserver only fires on FUTURE changes — if a
        // participant is already occupying the big screen at the moment
        // this attaches (e.g. the host reopens the live screen mid-
        // stream), nothing had "just changed" yet, so the persistent
        // label never appeared until the next manual swap. Check the
        // current state immediately too.
        _checkOccupant();
    }

    // Read-only tap reporter — deliberately never calls stopPropagation
    // or preventDefault, so every existing handler in app-live-final.js /
    // app-live-tiktok-patch.js / app-patch-v7.js keeps running exactly as
    // it did before. This only ever *reports* what was tapped.
    document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('#emp-self-swap-btn')) { showIndicator('\uD83D\uDCFA Switching big screen to you\u2026'); return; }
        if (t.closest('#emp-layout-toggle-btn')) { showIndicator('\uD83D\uDD00 Switching layout\u2026'); return; }
        if (t.closest('.emp-gb-spotlight')) { showIndicator('\uD83D\uDCFA Spotlighting\u2026'); return; }
        if (t.closest('.emp-gb-gift, .tk-gb-gift-hint')) { showIndicator('\uD83C\uDF81 Opening gift catalog\u2026'); return; }
        if (t.closest('.emp-gb-mute, .tk-gb-mute')) { showIndicator('\uD83C\uDFA4 Toggling mic\u2026'); return; }
        if (t.closest('.emp-gb-remove, .tk-gb-decline')) { showIndicator('\u274C Removing guest\u2026'); return; }
        if (t.closest('#live-mic-toggle')) { showIndicator('\uD83C\uDFA4 Mic toggled'); return; }
        if (t.closest('#live-video-toggle')) { showIndicator('\uD83D\uDCF7 Camera toggled'); return; }
        if (t.closest('#live-gift-btn, #tk-rose-quick-btn')) { showIndicator('\uD83C\uDF81 Opening gift catalog\u2026'); return; }
    }, true);

    ready(function () { setTimeout(watchBigScreen, 700); });
    document.addEventListener('empyrean-init-done', function () { setTimeout(watchBigScreen, 500); });
    document.addEventListener('empyrean-section-change', function (ev) {
        if (ev && ev.detail && ev.detail.section === 'live-stream-screen') setTimeout(watchBigScreen, 500);
    });
    setInterval(watchBigScreen, 1500);

    console.log('[EmpyreanPatchV29] \u2705 Gift catalog fixed for every open path (not just the footer button) + persistent text indicator added for host-control/box taps and the current big-screen occupant.');

})();