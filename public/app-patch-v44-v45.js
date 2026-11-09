/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v44-v45 (MERGED)
   app-patch-v44-v45.js  |  Load in the same relative position v44/v45
   previously occupied (after app-patch-v43.js).

   MERGE NOTE: this file is the untouched concatenation of the former
   app-patch-v44.js (Picture-in-Picture "minimize video" button) and
   app-patch-v45.js (PWA installability — service worker + install
   banner), combined only to reduce file count toward GitHub's repo file
   limit. Merge candidate chosen deliberately: v45's own header already
   required "Load AFTER app-patch-v44.js" with no other file in between,
   and the two files share no DOM ids, CSS classes, or function calls —
   each is a fully self-contained IIFE with its own
   `window._empPatchVxxLoaded` idempotency guard, so this is a straight
   concatenation with zero logic changes to either patch. Both original
   patches are reproduced below verbatim, each still guarded
   independently, in their original load order (v44 first, v45 second).
   ============================================================================= */

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v44
   app-patch-v44.js  |  Load AFTER app-patch-v43.js

   FEATURE: "Minimize video" — a floating button that puts whatever video is
   currently playing (feed post, reel, quick post, story, or live stream —
   host or guest) into the browser's native Picture-in-Picture window, so it
   keeps playing in a small floating window while the person backgrounds the
   browser/app and uses something else. Same mechanism YouTube's mobile PiP
   uses; this is a real OS-level floating window, not a custom in-page
   overlay, which is the only way playback survives leaving the page.

   WHY ONE GENERIC BUTTON INSTEAD OF PER-VIDEO CONTROLS
   Every video surface in this codebase — app-feed.js's feed/story/reel
   <video> tags, and the live screen — ends up as a plain <video> element in
   the DOM (Agora's track.play(container) creates its own <video> inside
   whatever container id/slot div it's given: #agora-local-video,
   #agora-viewer-video, .agora-guest-video-slot, or directly onto
   #host-main-video). Rather than injecting a button into each of those
   containers individually — which would mean duplicating this across
   app-feed.js's card markup, the reel viewer, the story viewer, AND every
   Agora container id, and re-doing it again the next time any of those
   layouts change — this file tracks "the video currently playing" at the
   document level and shows ONE floating button for it. Simpler, and it
   automatically covers any future video surface without another patch.

   HOW THE ACTIVE VIDEO IS TRACKED
   `play`/`pause`/`ended` listeners are bound in the CAPTURE phase on
   `document` — capture-phase listeners fire for every element in the tree
   regardless of that event's own bubbling rules (play/pause do not bubble),
   so this sees every video's state change exactly once, no matter which
   container it's nested in or when it was created. A periodic sweep
   (matching the tick-loop convention already used by app-patch-v40.js)
   is a fallback for autoplaying video that started before this heard about
   it. "Active" = the most recently started video that is still playing;
   if it pauses/ends, the next tick falls back to any other video still
   playing.

   INTERACTION WITH app-feed.js §10 (SCROLL-PAUSE OBSERVER)
   That observer pauses a feed video once it's <30% visible. Once a video
   enters real PiP, the person is by definition looking at something else —
   its on-page element being "not intersecting" is expected, not a signal to
   pause it. This file does not modify app-feed.js; instead it relies on the
   fact that a video already in Picture-in-Picture reports
   `document.pictureInPictureElement === video`, and only ever calls
   requestPictureInPicture() — it never calls .pause() on anything, so it
   cannot fight that observer. (If a future patch needs the observer itself
   to skip a PiP'd video, guard it there with that same check.)

   BROWSER SUPPORT
   - Chromium/Android (the primary target per this app's own dev environment):
     standard `video.requestPictureInPicture()`.
   - iOS/Safari: no standard PiP API on <video>; falls back to the WebKit-
     only `webkitSetPresentationMode('picture-in-picture')` where present.
   - Neither supported (older WebView, PiP disabled by device policy): the
     button simply never appears — feature-detected via
     `document.pictureInPictureEnabled` / `webkitSupportsPresentationMode`,
     never assumed.

   BEST-EFFORT AUTO-MINIMIZE ON BACKGROUND
   Most browsers only grant requestPictureInPicture() in response to a
   direct user gesture (the button tap). As a bonus, this also tries it
   automatically the instant the tab is backgrounded (visibilitychange →
   hidden) while a video is playing — several current Chromium builds do
   allow this specific case (an already-playing video, tab going to
   background) without a fresh gesture. If a browser rejects it, the
   rejection is caught and logged; the person still has the manual button
   for every case where the automatic attempt doesn't apply.
   ============================================================================= */

(function empyreanPatchV44() {
    'use strict';

    if (window._empPatchV44Loaded) {
        console.warn('[V44] Already loaded — skipping duplicate execution (prevents duplicate PiP buttons/listeners).');
        return;
    }
    window._empPatchV44Loaded = true;

    /* ── feature detection — never assumed, always checked per video ── */
    function supportsPiP(v) {
        if (!v) return false;
        if (document.pictureInPictureEnabled && !v.disablePictureInPicture) return true;
        if (typeof v.webkitSupportsPresentationMode === 'function') {
            try { return !!v.webkitSupportsPresentationMode('picture-in-picture'); } catch (e) { return false; }
        }
        return false;
    }

    function isInPiP(v) {
        if (!v) return false;
        if (document.pictureInPictureElement === v) return true;
        if (v.webkitPresentationMode === 'picture-in-picture') return true;
        return false;
    }

    function requestPiP(v) {
        if (!v || isInPiP(v)) return;
        if (document.pictureInPictureEnabled && !v.disablePictureInPicture) {
            v.requestPictureInPicture().then(function () {
                updateButton();
            }).catch(function (err) {
                console.warn('[V44-PiP] requestPictureInPicture() rejected:', err && err.message);
            });
        } else if (typeof v.webkitSetPresentationMode === 'function') {
            try { v.webkitSetPresentationMode('picture-in-picture'); } catch (e) { /* ignore */ }
        }
    }

    /* ── §1: track "the currently playing video", document-wide ── */
    var activeVideo = null;

    function findAnyPlayingVideo() {
        var vids = document.querySelectorAll('video');
        for (var i = 0; i < vids.length; i++) {
            var v = vids[i];
            if (!v.paused && !v.ended && v.readyState > 2) return v;
        }
        return null;
    }

    document.addEventListener('play', function (e) {
        if (e.target && e.target.tagName === 'VIDEO') {
            activeVideo = e.target;
            updateButton();
        }
    }, true);

    document.addEventListener('pause', function (e) {
        if (e.target === activeVideo) {
            activeVideo = findAnyPlayingVideo();
            updateButton();
        }
    }, true);

    document.addEventListener('ended', function (e) {
        if (e.target === activeVideo) {
            activeVideo = findAnyPlayingVideo();
            updateButton();
        }
    }, true);

    /* leavepictureinpicture/enterpictureinpicture also don't bubble —
       same reasoning as above, capture phase catches them regardless. */
    document.addEventListener('enterpictureinpicture', function () { updateButton(); }, true);
    document.addEventListener('leavepictureinpicture', function () { updateButton(); }, true);

    /* Fallback sweep — covers autoplay video that started before this
       file's listeners were attached, and self-heals if activeVideo's
       element was ever removed from the DOM (section re-render, feed
       card unmount, reel viewer closing, live modal closing). */
    function tick() {
        if (!activeVideo || activeVideo.paused || activeVideo.ended || !document.body.contains(activeVideo)) {
            activeVideo = findAnyPlayingVideo();
        }
        updateButton();
    }
    document.addEventListener('DOMContentLoaded', tick);
    setInterval(tick, 1500);

    /* ── §2: best-effort auto-minimize when the app is backgrounded ── */
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'hidden') return;
        if (!activeVideo || activeVideo.paused || isInPiP(activeVideo)) return;
        if (!supportsPiP(activeVideo)) return;
        requestPiP(activeVideo); // rejection is caught/logged inside requestPiP
    });

    /* ── §3: the floating button itself ── */
    var PIP_ICON_SVG =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 ' +
        '2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zm-2-9h-8v6h8v-6z"/></svg>';

    /* DEACTIVATED (2026-10-03 — "remove or deactivate the blue minimize circular icon"):
       the floating blue round Minimize button covered live participants and feed content.
       Flip this to true to bring it back. The automatic PiP-on-background behaviour (§2)
       is separate and still active. */
    var PIP_FAB_ENABLED = false;

    var btn = null;
    function ensureButton() {
        if (btn) return btn;
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'emp-pip-fab';
        btn.setAttribute('aria-label', 'Minimize video (Picture-in-Picture)');
        btn.title = 'Minimize video';
        btn.innerHTML = PIP_ICON_SVG + '<span class="emp-pip-fab-label">Minimize</span>';
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            requestPiP(activeVideo);
        });
        document.body.appendChild(btn);
        return btn;
    }

    function updateButton() {
        if (!PIP_FAB_ENABLED) return; // button is never created while deactivated
        var b = ensureButton();
        var show = !!activeVideo && !activeVideo.paused && !activeVideo.ended &&
            supportsPiP(activeVideo) && !isInPiP(activeVideo);
        b.style.display = show ? 'flex' : 'none';
    }

    /* ── §4: styles, injected at runtime (never edits style.css directly,
       matching the convention already used by app-patch-v43.js) ── */
    var style = document.createElement('style');
    style.textContent =
        /* FIX (2026-08-06): moved to the RIGHT side, in its own vertical
           lane clear of both other bottom-right FABs — #quick-post-fab
           (bottom:90px, 46px tall → occupies 90-136px from the bottom)
           and #submit-complaint-fab (bottom:120px, 40px tall → occupies
           120-160px). Placing this button's own 52px-tall box starting
           at bottom:172px (172-224px) sits entirely above both of them,
           so all three FABs now coexist without any pair overlapping —
           this button, the quick-post "+", and the report/complaint flag
           each keep their own independent slot. (Previously placed on
           the LEFT at left:16px;bottom:96px specifically to dodge the
           quick-post FAB — that workaround is no longer needed now that
           this button has its own non-colliding slot on the right.) */
        '#emp-pip-fab{position:fixed;right:16px;bottom:172px;z-index:9999;width:52px;height:52px;' +
        'border:none;border-radius:50%;background:#1B2B8B;box-shadow:0 4px 14px rgba(0,0,0,.35);' +
        'display:none;flex-direction:column;align-items:center;justify-content:center;color:#fff;' +
        'cursor:pointer;padding:0;-webkit-tap-highlight-color:transparent;}' +
        '#emp-pip-fab svg{width:20px;height:20px;fill:#fff;}' +
        '#emp-pip-fab .emp-pip-fab-label{font-size:8px;font-weight:600;margin-top:1px;line-height:1;}' +
        '#emp-pip-fab:active{transform:scale(0.93);}' +
        '@media (min-width:768px){#emp-pip-fab{right:24px;bottom:32px;}}';
    document.head.appendChild(style);

    tick();

    console.log('[EmpyreanPatchV44] \u2705 Minimize-to-Picture-in-Picture wired: one floating button tracks whichever video is currently playing anywhere in the app (feed, reels, quick posts, stories, live host/guest) and requests native OS-level PiP so playback survives backgrounding the app. Best-effort auto-minimize also attempted on visibilitychange.');

})();

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v45
   app-patch-v45.js  |  Load AFTER app-patch-v44.js

   FEATURE: makes the site installable to the home screen, and caches the
   app shell for offline loading — so it behaves like a downloaded app
   instead of a browser tab, without needing anything from an app store.

   AN HONEST LIMIT, UP FRONT: no website can install itself with zero taps.
   Both Android and iOS deliberately require one explicit action from the
   person before anything gets written to their home screen or storage —
   that's a browser security boundary, not something any client-side code
   can route around. What this file does instead is remove every OTHER step:
   it registers the service worker automatically, listens for the browser's
   own install-eligibility signal, and — the moment that signal fires —
   surfaces a ready-made "Install" banner without the person ever having to
   find it in a browser menu. On Android/Chrome that's a single tap. iOS
   Safari doesn't expose an install API to websites at all (Apple's
   restriction, not a gap here), so there the banner instead shows the
   manual Share → Add to Home Screen steps, automatically, on first visit.

   §1 — registers service-worker.js (see that file for the offline caching
        strategy itself).
   §2 — captures the `beforeinstallprompt` event Chrome fires when it
        decides the site qualifies (has a manifest + service worker + is
        served over https) and shows the banner as soon as that happens.
   §3 — iOS Safari fallback: no beforeinstallprompt exists there, so this
        shows manual instructions instead, once, on first visit.

   Dismissing the banner (× or completing install) sets a localStorage
   timestamp so it doesn't reappear on every single visit — re-offered
   after 7 days if still not installed, so it isn't gone forever from one
   accidental tap.
   ============================================================================= */

(function empyreanPatchV45() {
    'use strict';

    if (window._empPatchV45Loaded) {
        console.warn('[V45] Already loaded — skipping duplicate execution (prevents duplicate service-worker registration/banners).');
        return;
    }
    window._empPatchV45Loaded = true;

    /* ── §1: service worker registration ── */
    /* FIX (2026-08-04 — root cause of "I fixed X but the browser still runs
       the old broken code"): service-worker.js's fetch handler is
       stale-while-revalidate — it serves the CACHED index.html/app-*.js
       response immediately and only updates the cache in the BACKGROUND
       for the *next* load. Registration alone (the two lines below, as
       this file originally had them) has no way to get a page that's
       already open onto the new files — a new service worker can finish
       installing and activating in the background while the open tab
       keeps running entirely on old cached JS with no visible sign
       anything is stale. That's exactly what made this session's admin
       Media Migration button fix (and, per this codebase's own patch
       history, likely earlier ones too) look like it "did nothing" even
       after being correctly deployed: the tap ran the OLD app-admin.js
       still sitting in that tab's cache, not the fixed one already on the
       server. service-worker.js already calls self.skipWaiting() +
       clients.claim() on the new worker, so it takes control almost
       immediately — the only piece missing was reacting to that moment.
       controllerchange fires exactly once a NEW service worker has taken
       over this page; reloading right then hands the page the fresh
       cache instead of leaving it running stale code until someone
       thinks to hard-refresh. Guarded with a one-shot sessionStorage flag
       (same pattern app-patch-v31.js's Firestore-wedge recovery already
       uses) so a browser that fires controllerchange more than once in a
       row can never reload-loop. */
    /* RETIRED (2026-08-04): the offline-cache service worker was confirmed
       to be the cause of fresh deploys (the admin Media Migration button
       fix specifically) silently not reaching a device that had already
       installed an earlier copy of service-worker.js — see that file's own
       header for the full explanation. Registration is switched off here so
       no NEW installs happen going forward. This does NOT remove a copy
       that's already installed on a device from before this change shipped
       — that requires the browser to actually fetch service-worker.js
       again and run its (now self-unregistering) activate handler, which
       normally only happens on the browser's own periodic update-check
       schedule. The block below shortcuts that: on every page load, if a
       service worker is already controlling this page, force an immediate
       update check plus a direct unregister of every registration and a
       manual wipe of every Cache Storage entry — so a device that already
       has the old worker installed gets cleaned up on its very next visit
       instead of waiting on browser timing. Safe to leave running
       indefinitely (each of these calls is a no-op once nothing is left to
       clean up), but can be deleted once enough time has passed that no
       visitor could plausibly still be running the pre-2026-08-04 worker. */
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.getRegistrations().then(function (regs) {
                regs.forEach(function (reg) {
                    // Ask this registration to check for a byte-fresh
                    // service-worker.js right now rather than waiting for
                    // the browser's own ~24h check — the fresh copy is the
                    // self-unregistering kill-switch version, so this is
                    // what actually removes an old install quickly.
                    reg.update().catch(function () {});
                    // Belt-and-suspenders: unregister directly too, in case
                    // this device never revisits again for the updated
                    // worker's own activate handler to get a chance to run.
                    reg.unregister().catch(function () {});
                });
            }).catch(function () {});

            if (window.caches && caches.keys) {
                caches.keys().then(function (keys) {
                    keys.forEach(function (k) {
                        if (k.indexOf('empyrean-shell') === 0) caches.delete(k);
                    });
                }).catch(function () {});
            }
        });
    }

    /* ── shared helpers ── */
    var DISMISS_KEY = 'empInstallBannerDismissedAt';
    var DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

    function isStandalone() {
        return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
            window.navigator.standalone === true; // iOS's own flag for "already added to home screen"
    }

    function recentlyDismissed() {
        try {
            var t = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
            return (Date.now() - t) < DISMISS_COOLDOWN_MS;
        } catch (e) {
            return false; // if storage is unavailable, err on the side of still offering the banner
        }
    }

    function markDismissed() {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) { /* ignore */ }
    }

    var deferredPrompt = null;

    function showBanner(kind) {
        if (isStandalone() || recentlyDismissed() || document.getElementById('emp-install-banner')) return;

        var bar = document.createElement('div');
        bar.id = 'emp-install-banner';
        bar.innerHTML =
            '<span class="emp-install-text">' +
            (kind === 'ios'
                ? 'Install Empyrean: tap <strong>Share</strong> \u2192 <strong>Add to Home Screen</strong>'
                : 'Get the Empyrean app on your home screen for faster, offline-ready access') +
            '</span>' +
            (kind === 'ios' ? '' : '<button type="button" class="emp-install-btn">Install</button>') +
            '<button type="button" class="emp-install-close" aria-label="Dismiss">\u00d7</button>';
        document.body.appendChild(bar);

        bar.querySelector('.emp-install-close').addEventListener('click', function () {
            markDismissed();
            bar.remove();
        });

        var installBtn = bar.querySelector('.emp-install-btn');
        if (installBtn) {
            installBtn.addEventListener('click', function () {
                bar.remove();
                if (!deferredPrompt) return;
                deferredPrompt.prompt();
                deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
            });
        }
    }

    /* ── §2: Android/Chrome — real one-tap install ── */
    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault(); // stop Chrome's own mini-infobar so our banner is the single, consistent UI
        deferredPrompt = e;
        setTimeout(function () { showBanner('android'); }, 0);
    });

    window.addEventListener('appinstalled', function () {
        var bar = document.getElementById('emp-install-banner');
        if (bar) bar.remove();
        deferredPrompt = null;
        markDismissed();
        console.log('[V45-PWA] app installed to home screen.');
    });

    /* ── §3: iOS Safari — no install API exists there, so show the manual steps ── */
    (function () {
        var ua = navigator.userAgent || '';
        var isIOS = /iphone|ipad|ipod/i.test(ua);
        var isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
        if (isIOS && isSafari && !isStandalone()) {
            setTimeout(function () { showBanner('ios'); }, 0);
        }
    })();

    /* ── styles, injected at runtime (matches app-patch-v43.js's convention
       of never editing style.css directly) ── */
    /* FIX (2026-08-22 — "APK installation link is hidden beneath the
       [bottom] navigation bar"): #mobile-bottom-nav (app-fix-final.js's
       §1 fixBottomNav()) is position:fixed;bottom:0;height:60px, plus
       env(safe-area-inset-bottom,0px) of its own padding underneath that
       — and, critically, z-index:10000!important. This banner used the
       exact same z-index (10000, no !important), so which one actually
       painted on top came down to an unreliable DOM-order/specificity
       tie instead of a real stacking guarantee, AND — even on the runs
       where the banner did win that tie — it sat at bottom:12px, i.e.
       physically inside the nav bar's own 60px-plus-safe-area footprint,
       so it read as sitting "under"/behind the bar rather than as its
       own clearly separate, tappable strip above it. Fixed both parts:
       a z-index well above the nav bar's (kept !important so this can't
       lose a future tie the same way again), and a bottom offset that
       clears the nav bar's actual height + safe-area inset, so the
       banner now floats as a distinct bar sitting above the navigation,
       always on top and always reachable. */
    var style = document.createElement('style');
    style.textContent =
        '#emp-install-banner{position:fixed;left:12px;right:12px;' +
        'bottom:calc(60px + env(safe-area-inset-bottom,0px) + 12px);z-index:10050!important;' +
        'background:#1B2B8B;color:#fff;border-radius:12px;padding:10px 12px;display:flex;' +
        'align-items:center;gap:10px;box-shadow:0 6px 20px rgba(0,0,0,.3);font-size:13px;}' +
        '#emp-install-banner .emp-install-text{flex:1;line-height:1.3;}' +
        '#emp-install-banner .emp-install-btn{background:#fff;color:#1B2B8B;border:none;' +
        'border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer;flex-shrink:0;}' +
        '#emp-install-banner .emp-install-close{background:transparent;border:none;color:#fff;' +
        'font-size:18px;line-height:1;cursor:pointer;padding:0 2px;flex-shrink:0;}';
    document.head.appendChild(style);

    console.log('[EmpyreanPatchV45] \u2705 PWA installability wired: service worker registered for offline app-shell caching; install prompt captured and offered automatically on Android/Chrome; manual Add-to-Home-Screen guidance shown automatically on iOS Safari.');

})();