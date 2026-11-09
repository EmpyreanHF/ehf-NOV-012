/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v30 + v46 (merged)
   app-patch-v30-v46.js  |  Load LAST (after app-patch-v29.js), can load
   anywhere relative to other UI-only patches.

   MERGE NOTE (2026-07-31): combined into one file to reduce repo file
   count (GitHub 100-file limit on this plan). Purely mechanical —
   app-patch-v30.js and app-patch-v46.js are concatenated below UNCHANGED,
   each still in its own IIFE with its own idempotency guard
   (window._empPatchV30Loaded / form._empLayersInit), so they remain two
   independent modules that happen to ship in one file. Verified no other
   file in the codebase references either module's internals directly —
   v30 only reaches OUT to the DOM (#live-join-banner, window.userState)
   and v46 only touches #profile-info-form's own fields — so combining
   them changes nothing about what either does or when it can run, only
   that they now load from one <script> tag instead of two.

   Original v30 header: host no longer sees a "Join Now" banner/
   notification for their own live stream.
   Original v46 header: Settings > Profile progressive-disclosure layers
   (Basic Info / Contact & Location / About You unlock in sequence).
   ============================================================================= */

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v30
   app-patch-v30.js  |  Load LAST (after app-patch-v29.js)

   ISSUE — host sees their own "<name> is LIVE! Join Now" banner and
   notification for their OWN stream, on their OWN device (confirmed via
   screenshot).

   ROOT CAUSE (confirmed by reading the actual check, not guessed):
   app-live.js's active_streams onSnapshot handler decides whether a
   stream belongs to "me" like this, at the exact instant each Firestore
   change event fires:

       var myId = window.userState && window.userState.id;
       var isMe = myId && myId === s.hostId;

   The very first 'added' event for a stream can arrive from Firestore's
   own local-write echo almost immediately after publish — sometimes
   before window.userState.id has finished loading in that same tab.
   When that happens, myId is undefined, isMe is (incorrectly) false,
   and the host gets shown a banner/notification for their own stream.

   Worse: the code that decides whether to show the banner also does
   this in the same block, unconditionally:

       if (!isMe && !_knownStreamIds[sid + '-notified']) {
           _knownStreamIds[sid + '-notified'] = true;
           ... show banner + notification ...
       }

   That "-notified" flag is a ONE-SHOT latch. Once tripped by the false
   isMe reading, it can never be corrected later even after userState.id
   finishes loading — every future snapshot for that same stream is
   already marked "already notified" and skipped. So this isn't
   intermittent noise, it's a race that — once lost — sticks for the
   rest of that stream's life.

   FIX (additive, does not touch app-live.js's closure or its private
   _knownStreamIds map — cannot conflict with or duplicate that logic):
   watch for #live-join-banner appearing in the DOM and, the moment it
   does, compare the host name embedded in it against the CURRENTLY
   logged-in user's own name. If they match, this is unambiguously the
   host seeing their own stream — remove the banner immediately. This
   treats the one visible symptom directly and reliably, using the one
   piece of identity information actually available in the DOM at that
   point (the banner already renders the host's display name).
   ============================================================================= */

(function empyreanPatchV30() {
    'use strict';

    if (window._empPatchV30Loaded) {
        console.warn('[V30] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV30Loaded = true;

    function log(msg) { console.log('[V30] ' + msg); }

    function myName() {
        return (window.userState && window.userState.fullName) || null;
    }

    function checkBanner(banner) {
        if (!banner || banner._pv30Checked) return;
        banner._pv30Checked = true;
        var name = myName();
        if (!name) {
            // userState not hydrated yet even now — try again shortly rather
            // than assuming either way.
            setTimeout(function () { banner._pv30Checked = false; checkBanner(banner); }, 300);
            return;
        }
        var infoEl = banner.querySelector('strong');
        var bannerHost = infoEl ? infoEl.textContent.replace(/\s*is LIVE!\s*$/, '').trim() : '';
        if (bannerHost && bannerHost === name.trim()) {
            log('removed self-notification banner — host name "' + bannerHost + '" matches the current logged-in user (this device\'s userState.id likely wasn\'t hydrated yet when app-live.js\'s onSnapshot fired).');
            banner.remove();
        }
    }

    var obs = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            m.addedNodes && m.addedNodes.forEach(function (node) {
                if (node.nodeType === 1 && node.id === 'live-join-banner') {
                    checkBanner(node);
                }
            });
        });
    });
    obs.observe(document.body, { childList: true });

    // Cover the case where the banner already exists at the moment this
    // script runs (e.g. hot-reload / late script attach).
    var existing = document.getElementById('live-join-banner');
    if (existing) checkBanner(existing);

    console.log('[EmpyreanPatchV30] \u2705 Host no longer sees a "Join Now" banner for their own stream — suppressed at the point it would otherwise render, without touching app-live.js\'s internal notified-state tracking.');

})();

/* ═══════════════════════════════════════════════════════════════════════
   app-patch-v46.js — Settings > Profile progressive-disclosure layers
   ═══════════════════════════════════════════════════════════════════════
   Scope: #settings-profile only. Splits the profile form into three
   "layers" (Basic Info / Contact & Location / About You + Preferences),
   marked in index.html with .emp-form-card[data-settings-layer] and
   .emp-layer-locked. A layer stays visually collapsed (0 height, no
   border, non-interactive) until every required field in the layer
   before it validates, at which point it animates open.

   Layers 2 and 3 start locked and ONLY unlock in response to the user
   actively completing the layer before them (input/blur events) — never
   on page load, even if the fields already carry saved values. This is
   deliberate: an on-load check was tried first but it meant a profile
   with existing saved data unlocked every layer at once on render,
   which defeats the point of a progressive reveal.

   Purely additive: does not edit app-fixes.js's existing
   #profile-info-form submit handler, only adds visibility/animation
   behaviour on top of the same fields. Safe to remove by deleting this
   file's <script> tag — the form still works, just without the
   progressive reveal. Must load after app-fixes.js (fields must exist)
   and can load anywhere relative to the other UI-only patches. ═══════ */
(function empyreanSettingsProfileLayers() {
    'use strict';

    function isValid(el) {
        if (!el) return true; // field doesn't exist in this layer — don't block on it
        return el.checkValidity ? el.checkValidity() && el.value.trim() !== '' : el.value.trim() !== '';
    }

    function init() {
        var form = document.getElementById('profile-info-form');
        if (!form || form._empLayersInit) return;
        form._empLayersInit = true;

        var layer2Cards = form.querySelectorAll('[data-settings-layer="2"]');
        var layer3Cards = form.querySelectorAll('[data-settings-layer="3"]');

        var fullname = document.getElementById('profile-fullname');
        var username = document.getElementById('profile-username');
        var email    = document.getElementById('profile-email');
        var phone    = document.getElementById('profile-phone');

        var progressFill  = document.getElementById('settings-profile-progress-fill');
        var progressCount = document.getElementById('settings-profile-progress-count');
        var progressTitle = document.getElementById('settings-profile-progress-title');

        function reveal(cards) {
            cards.forEach(function(card) {
                if (!card.classList.contains('emp-layer-locked')) return;
                card.classList.remove('emp-layer-locked');
                card.classList.add('emp-layer-revealed');
            });
        }

        function updateProgress() {
            var layer2Open = layer2Cards.length && !layer2Cards[0].classList.contains('emp-layer-locked');
            var layer3Open = layer3Cards.length && !layer3Cards[0].classList.contains('emp-layer-locked');
            var reached = layer3Open ? 3 : (layer2Open ? 2 : 1);
            var titles = ['Basic Info', 'Contact & Location', 'About You'];
            if (progressFill)  progressFill.style.width = ((reached / 3) * 100) + '%';
            if (progressCount) progressCount.textContent = 'Layer ' + reached + ' of 3';
            if (progressTitle) progressTitle.textContent = titles[reached - 1];
        }

        function checkLayers() {
            if (isValid(fullname) && isValid(username) && isValid(email)) {
                reveal(layer2Cards);
            }
            if (isValid(phone) && layer2Cards.length && !layer2Cards[0].classList.contains('emp-layer-locked')) {
                reveal(layer3Cards);
            }
            updateProgress();
        }

        [fullname, username, email, phone].forEach(function(el) {
            if (!el) return;
            el.addEventListener('input', checkLayers);
            el.addEventListener('blur', checkLayers);
        });

        // Deliberately NO initial checkLayers() call here — layers 2/3
        // stay locked on render regardless of any pre-existing field
        // values, and only open in response to the user interacting with
        // the layer before them. Just paint the progress bar at Layer 1.
        updateProgress();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Settings loads inside a SPA content-section that can be (re)shown
    // after this script first runs, and the section may also re-render
    // its inner markup — re-run init defensively whenever Settings opens.
    document.addEventListener('empyrean-section-change', function(e) {
        if (e && e.detail && e.detail.section === 'settings') {
            setTimeout(init, 0);
        }
    });
})();