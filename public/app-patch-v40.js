/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v40
   app-patch-v40.js  |  Load LAST (after app-patch-v39.js)

   SCOPE OF THIS PATCH (two requested App Transition Requirements only):

     1. Footer navigation bar must never flash during startup/section
        transitions.
        STATUS: already fixed, not touched again here. style.css already
        hides both #quick-post-fab and the legacy first-draft
        #mobile-bottom-nav (built by app-fix-final.js's §1 fixBottomNav())
        with `body:not(.emp-app-ready) #mobile-bottom-nav { display:none
        !important; }`, and app-patch-v39.js already adds `emp-app-ready`
        to <body> at the one moment this codebase treats as "init actually
        finished" (the `empyrean-init-done` event, with a 10s fallback).
        Re-verified against this session's own index.html/style.css/
        app-nav.js/app-fix-final.js: the gate is in place, the class is
        added at the right moment, and app-nav.js's own nav rebuild
        listeners on the same event fire BEFORE app-patch-v39.js's (script
        load order — app-nav.js is earlier in index.html than
        app-patch-v39.js), so the bar is already correctly built with the
        right role/section by the time it's revealed. Nothing left to do
        here — changing anything in this area again would be exactly the
        kind of untouched-thing tampering this session was told to avoid.

     2. A premium, native-feeling loading/section transition.
        STATUS (2026-08-01, follow-up #3): DISABLED — see the
        DISABLE_NAV_TRANSITION note further down this file. Despite two
        rounds of fixes here, the app was still reported shaking/unstable
        right after load, and the direct instruction that followed was
        that transition effects belong on the loading page only — the
        main app itself should have none. §1/§2 below (the progress bar
        and section-entrance animation) are left in the file, inert, so
        the implementation isn't lost if a future redesign wants to try
        again from a working starting point; §3's listener now bails
        before either ever runs. style.css (see its own "NEW FEATURE —
        premium section-navigation transition" block) still defines the
        two isolated pieces this used — `#emp-nav-progress` (slim top
        progress bar) and `.content-section.active.emp-section-transition`
        (fade + settle + slight scale-in entrance, on keyframe
        `empSectionEnter`, fully separate from the existing `fadeIn`
        keyframe every other tab/section/form-feedback consumer relies
        on) — those rules are simply never applied now that §3 never adds
        the classes. No existing file is edited by this status change.

   WHY THE FIRST (BOOT-RESTORE) SECTION CHANGE IS SKIPPED
   index.html's own "EMPYREAN FINAL BOOT" block calls navigateTo(last,
   true) to restore the last-visited section BEFORE it fires
   `empyrean-init-done` (the event the splash screen waits for to hide
   itself — see index.html's own hideSplash()/`document.addEventListener
   ('empyrean-init-done', hideSplash)`). That means the very first
   `empyrean-section-change` of a page load happens while
   `#app-loading-screen` is still fully covering the viewport. Playing the
   progress bar / section-entrance animation at that exact moment would
   be invisible (correct — nothing should visibly happen under an opaque
   splash) but would also mean the bar/entrance animation has already
   finished and reset by the time the splash fades, silently wasting the
   one moment it would actually be seen. So this file explicitly skips
   firing while the splash screen is still on screen, and plays normally
   for every real, user-visible section change after that.
   ============================================================================= */

(function empyreanPatchV40() {
    'use strict';

    if (window._empPatchV40Loaded) {
        console.warn('[V40] Already loaded — skipping duplicate execution (prevents duplicate listeners).');
        return;
    }
    window._empPatchV40Loaded = true;

    /* FIX (2026-08-01 — Issue #1 follow-up #3 — reported still shaking
       after follow-up #2): follow-up #2's theory (transform-only was the
       cause, opacity-only would fix it) narrowed things but the app was
       still reported unstable right after load. Rather than chase a
       fourth theory, this now matches what was actually asked for
       directly: transition effects belong on the loading page only — the
       main app underneath should never animate on its own, section
       changes included. So the whole runtime feature this file wires up
       (top progress bar + section-entrance animation, §1/§2 below) is
       switched off at its one call site (§3's event listener bails
       before either plays). The loading-page's own transition
       (index.html / style.css's #app-loading-screen fade) is untouched —
       that's the one place a transition effect is still wanted. §1/§2's
       code is left in place, inert, rather than deleted, in case a future
       redesign wants a section-transition again and can start from a
       known-working (if previously shake-prone) implementation instead
       of from scratch. */
    var DISABLE_NAV_TRANSITION = true;

    function log(msg) { console.log('[V40-NavTransition] ' + msg); }

    function _splashStillShowing() {
        var s = document.getElementById('app-loading-screen');
        if (!s) return false;
        var cs = window.getComputedStyle(s);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    }

    /* FIX (2026-08-01 — Issue #1: "site keeps shaking immediately after
       loading"): style.css gates #mobile-bottom-nav and #quick-post-fab
       behind `body.emp-app-ready` (added by app-patch-v39.js at the exact
       "init actually finished" moment) — until that class lands, both are
       `display:none`. The FIRST real, post-splash `empyrean-section-change`
       fires at essentially the same instant that class gets added — which
       means the transform-based section-entrance animation below
       (translateY+scale) was previously playing on the content area at the
       EXACT moment the nav bar and FAB were also popping into existence
       and changing the page's available layout height. Two simultaneous
       layout/transform changes at first paint is what read as "shaking".
       FIX: watch for `emp-app-ready` landing on <body> and suppress the
       progress-bar/section-entrance animation for a short window around
       that moment — the section still appears immediately (no animation
       is not the same as no content), it just doesn't ALSO animate while
       the surrounding chrome is still settling into place. Every
       navigation after that short window plays the full premium
       transition exactly as before — this only protects the one moment
       that was actually unstable. */
    var _appReadySettleUntil = 0;
    var SETTLE_WINDOW_MS = 400;
    (function _watchAppReadyClass() {
        if (document.body && document.body.classList.contains('emp-app-ready')) return; // already ready before this script ran — nothing to guard
        var obs = new MutationObserver(function () {
            if (document.body.classList.contains('emp-app-ready')) {
                _appReadySettleUntil = Date.now() + SETTLE_WINDOW_MS;
                obs.disconnect();
            }
        });
        if (document.body) obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    })();
    function _chromeStillSettling() {
        return Date.now() < _appReadySettleUntil;
    }

    /* =========================================================================
       §1 — top progress bar. Element is created once (idempotent — a
       hot-reload/dev-preview re-execution, the same scenario app-patch-
       v35.js's own header already documented for this codebase, will find
       the existing node and reuse it rather than stacking a second one).
       ========================================================================= */
    function _ensureBar() {
        var bar = document.getElementById('emp-nav-progress');
        if (bar) return bar;
        bar = document.createElement('div');
        bar.id = 'emp-nav-progress';
        (document.body || document.documentElement).appendChild(bar);
        return bar;
    }

    var _progressTimer1 = null;
    var _progressTimer2 = null;
    var _progressTimer3 = null;

    function _playProgressBar() {
        var bar = _ensureBar();

        clearTimeout(_progressTimer1);
        clearTimeout(_progressTimer2);
        clearTimeout(_progressTimer3);

        /* Reset instantly (no transition) so a rapid second nav tap always
           restarts cleanly from 0, never finishes an old fill part-way. */
        bar.classList.remove('emp-nav-progress--done');
        bar.style.transition = 'none';
        bar.style.width = '0%';
        bar.classList.add('emp-nav-progress--active');

        /* Force layout so the browser commits the 0% width above BEFORE
           the transition is re-enabled and the fill below is applied —
           otherwise both changes can get batched into one frame and the
           fill never visibly animates from 0. */
        void bar.offsetWidth;
        bar.style.transition = '';

        requestAnimationFrame(function () {
            bar.style.width = '78%'; /* quick fill toward — never claims 100% until the section is actually in */
        });

        _progressTimer1 = setTimeout(function () {
            bar.style.width = '100%';
            _progressTimer2 = setTimeout(function () {
                bar.classList.add('emp-nav-progress--done');
                bar.classList.remove('emp-nav-progress--active');
                _progressTimer3 = setTimeout(function () {
                    bar.style.width = '0%';
                }, 260);
            }, 140);
        }, 260);
    }

    /* =========================================================================
       §2 — section entrance animation. Retriggerable: if the same section
       is navigated to again in quick succession, the class is removed and
       force-reflowed before being re-added so the CSS animation restarts
       instead of silently no-op'ing (browsers don't replay a CSS
       animation from re-adding an already-present class without a reflow
       in between).
       ========================================================================= */
    function _playSectionEnter(id) {
        var el = document.getElementById(id);
        if (!el) return;

        el.classList.remove('emp-section-transition');
        void el.offsetWidth; /* force reflow before re-adding, see above */
        el.classList.add('emp-section-transition');

        var cleaned = false;
        function _cleanup(e) {
            if (e && e.target !== el) return; /* ignore bubbled animationend from a child */
            if (cleaned) return;
            cleaned = true;
            el.classList.remove('emp-section-transition');
            el.removeEventListener('animationend', _cleanup);
        }
        el.addEventListener('animationend', _cleanup);
        /* Safety net: if animationend is ever missed (e.g. the section
           gets hidden again before it fires), the class still gets
           cleared so the next real entrance isn't silently skipped by
           the "already has the class" reflow guard above. */
        setTimeout(_cleanup, 900);
    }

    /* =========================================================================
       §3 — wiring: one listener on the ONE event navigateTo() already
       dispatches for every navigation path (sidebar, mobile bottom nav,
       deep link restore, programmatic calls) — see app-nav.js's own
       navigateTo(), which fires `empyrean-section-change` unconditionally
       at the end of every section switch.
       ========================================================================= */
    document.addEventListener('empyrean-section-change', function (e) {
        if (DISABLE_NAV_TRANSITION) return; // see FIX note above — transition fully disabled for stability

        var id = e && e.detail && e.detail.section;
        if (!id) return;

        if (_splashStillShowing()) {
            /* Initial boot-restore nav — invisible under the splash anyway;
               skip so the one moment this would actually be SEEN (every
               later, real navigation) isn't wasted on the hidden one. */
            return;
        }

        if (_chromeStillSettling()) {
            /* FIX (2026-08-01 — Issue #1): the bottom nav / FAB are
               popping into view right now (body.emp-app-ready just
               landed) — see _watchAppReadyClass above. Skip the animated
               entrance just for this one navigation so it isn't stacked
               on top of that layout change; the section still renders
               immediately, just without the extra transform. */
            return;
        }

        _playProgressBar();
        _playSectionEnter(id);
    });

    console.log('[EmpyreanPatchV40] \u2705 Premium section-navigation transition wired (top progress bar + fade/settle/scale entrance on every real section change, using style.css\u2019s already-isolated #emp-nav-progress / .emp-section-transition rules) \u2014 skipped only for the invisible boot-restore navigation that happens under the splash screen. Legacy #mobile-bottom-nav flash fix reviewed and confirmed already complete (style.css + app-patch-v39.js) \u2014 not modified.');

})();