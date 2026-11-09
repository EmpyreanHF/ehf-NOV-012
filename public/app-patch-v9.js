/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v9
   app-patch-v9.js  |  Load AFTER app-live-tiktok-patch.js / app-patch-v8.js

   Covers, additively only (nothing already-working is touched):

   §A  Guest-side safety net: forces #tk-host-requests-btn (host "accept
       request" bell) and #tk-end-live-btn (host "End Live" button) hidden
       for anyone who is NOT the host, on a MutationObserver + interval,
       independent of and in addition to app-live-tiktok-patch.js's own
       refreshRoleVisibility(). Never forces these visible — only ever
       hides them further — so it cannot regress the host's own view.

   §B  Guaranteed-first tap-to-like handler for the live video background.
       Same "capture-phase listener on document" pattern already proven in
       app-live-tiktok-patch.js for the chevron/viewers/trophy/requests/
       end-live controls, applied here to the screen-tap heart-bubble so it
       no longer depends on the tap successfully threading through
       app-fixes.js's much longer document.body bubble-phase delegate.
       Calls e.stopPropagation() ONLY for taps that match the background
       criteria, so every other click (guest box, share, gift, etc.) still
       falls through completely untouched.

   §C  "Live Streaming Income" wallet section — separate from the general
       EMPY balance, sourced from the `liveStreamIncome` field now written
       to the recipient's real Firestore user doc whenever a gift is sent
       (see the matching fix in app-fixes.js's _empySendGiftNow). Withdraw
       is gated on userState.isVerified (KYC).

   §D  Guest self mic/camera controls — new #tk-guest-mic-btn and
       #tk-guest-cam-btn buttons next to #tk-exit-guest-btn, visible only
       while this device is broadcasting as an accepted guest. Lets a
       guest mute/unmute their own mic and turn their own camera on/off,
       independently of (but coordinated with) the host's existing
       remote-mute (`hostMuted`) control in app-live-tiktok-patch.js.

       app-live-tiktok-patch.js keeps its own real Agora track handles
       (mic/cam) in a private closure variable nothing outside that file
       can reach, and never plays them to a local <video>/<audio> element
       (the guest never previews their own outgoing feed) — so there is
       no DOM element to grab a MediaStream from either. Rather than
       duplicate or edit that file's guest-join flow, this section
       transparently wraps window.AgoraRTC.createMicrophoneAndCameraTracks
       / createMicrophoneAudioTrack so it can see the exact same track
       objects the instant they're created, for BOTH the host's own
       go-live flow (app-live.js) and the guest's broadcast-promotion flow
       (app-live-tiktok-patch.js's promoteToGuestBroadcaster) — every call
       is passed straight through to the real Agora SDK unchanged, and
       only the guest-flow tracks are additionally kept here, so nothing
       about the host's own mic/camera (#live-mic-toggle /
       #live-video-toggle, driven by app-live.js's own agoraLocalTracks)
       is touched. Guest-flow calls are told apart from host calls by
       checking whether #tk-exit-guest-btn is already visible at the
       moment the tracks resolve — promoteToGuestBroadcaster always makes
       it visible (via refreshRoleVisibility()) before it ever creates a
       track, and it's never visible during the host's own go-live flow.

       A guest can always mute their own mic. Un-muting is blocked (with
       a notice) while the host has independently muted them, so tapping
       this button can never fight with / silently override the host's
       control — the two states combine as "enabled only if neither the
       guest nor the host has muted it", read from the same `guests`
       array / `hostMuted` field on the live stream doc that the host's
       control already writes to, via its own read-only Firestore
       listener here (existing writers/readers of that field are
       untouched). Camera on/off has no host-side equivalent, so it's a
       plain local toggle with no such interaction.
   ============================================================================= */

(function empyreanPatchV9() {
    'use strict';

    /* FIX (2026-07-21 — echo/frozen-tap follow-up audit): this file had no
       guard against running twice on the same page load (the same re-
       execution behavior documented in app-patch-v35.js's header, and the
       same mechanism fixed at the source in app-live.js/app-fix-final.js
       this session). A second execution would re-register this file's
       document-level click listener(s) on top of the first copy. Guarding
       here matches the convention already used by app-patch-v30.js onward. */
    if (window._empPatchV9Loaded) {
        console.warn('[V9] Already loaded — skipping duplicate execution (prevents duplicate click listeners).');
        return;
    }
    window._empPatchV9Loaded = true;

    function onReady(fn) {
        if (document.readyState !== 'loading') fn();
        else document.addEventListener('DOMContentLoaded', fn);
    }

    function isHost() {
        return !window.isGuest && window.userState && window.liveStreamData &&
            window.liveStreamData.hostUserId &&
            window.userState.id === window.liveStreamData.hostUserId;
    }

    /* ═══════════════════════════════════════════════════════════════
       §A — Guest-side hard-hide safety net
       ═══════════════════════════════════════════════════════════════ */
    function enforceGuestIconHiding() {
        if (!document.getElementById('live-stream-screen')) return;
        var host = isHost();

        var hostReqBtn = document.getElementById('tk-host-requests-btn');
        var endLiveBtn = document.getElementById('tk-end-live-btn');

        // DIAGNOSTIC ONLY — logs only when something is actually visible
        // that shouldn't be, so this won't spam the console on every tick.
        // Safe to remove once the guest-icon-visibility bug is confirmed
        // fixed or its real cause is found.
        if (!host && ((hostReqBtn && hostReqBtn.style.display !== 'none') ||
                      (endLiveBtn && endLiveBtn.style.display !== 'none'))) {
            console.log('[GUESTICON-DIAG] non-host still sees a host icon | isGuest=' + !!window.isGuest +
                ' | myId=' + (window.userState && window.userState.id) +
                ' | hostUserId=' + (window.liveStreamData && window.liveStreamData.hostUserId) +
                ' | hostReqBtn.display=' + (hostReqBtn && hostReqBtn.style.display) +
                ' | endLiveBtn.display=' + (endLiveBtn && endLiveBtn.style.display));
        }

        if (host) return; // never touches anything for the actual host

        // ROOT CAUSE (why these stayed visible despite the checks above):
        // .tk-host-req-btn and .tk-end-live-btn are both defined in
        // app-live-tiktok-patch.js's injected CSS with `display:flex
        // !important`. A plain `el.style.display = 'none'` is a normal-
        // priority inline declaration, which always loses to an
        // !important rule in a stylesheet regardless of specificity —
        // so it was silently doing nothing. setProperty(..., 'important')
        // sets an inline !important declaration instead, which — being
        // inline — outranks the class-based !important rule and actually
        // hides the element.
        if (hostReqBtn) {
            hostReqBtn.style.setProperty('display', 'none', 'important');
        }
        if (endLiveBtn) {
            endLiveBtn.style.setProperty('display', 'none', 'important');
        }
    }

    onReady(function () {
        // Re-check on any DOM change inside the live screen (covers the
        // Firestore-snapshot re-renders that create/replace these buttons)
        // AND on any inline style attribute change (covers
        // refreshRoleVisibility() flipping display:'flex' back on via a
        // plain attribute mutation, which childList-only observation does
        // not see — this is what let the icon stay visibly shown between
        // enforceGuestIconHiding() re-checks, even though §A2 below always
        // blocked the tap itself regardless of visibility).
        var target = document.body;
        new MutationObserver(function () {
            enforceGuestIconHiding();
        }).observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

        // Belt-and-braces: also re-check on a slow interval in case a
        // mutation batch is missed (e.g. attribute-only style changes on
        // an element the observer above doesn't happen to re-scan).
        setInterval(enforceGuestIconHiding, 1000);
        enforceGuestIconHiding();
    });

    /* ═══════════════════════════════════════════════════════════════
       §A2 — Root cause fix: non-host taps on the host-requests bell /
       end-live button were still executing their host-only actions
       (toggling #tk-guest-requests-modal, calling endLiveStreamHandler())
       even while §A's style.display='none' hard-hide was active, because
       app-live-tiktok-patch.js's own capture-phase document click handler
       (the "SINGLE AUTHORITATIVE HANDLER" block) matches these buttons by
       id alone — e.target.closest('#tk-host-requests-btn') /
       closest('#tk-end-live-btn') — with no isHost() check anywhere in
       that branch. So any tap that still lands on the element (a brief
       display:none race, a stale hit-testing box, etc.) fires the host
       action for a plain viewer.

       This does NOT touch that handler, endLiveStreamHandler(), the
       chevron/host-control-panel, ranked-viewer counts, or viewer counts —
       all keep working exactly as-is for the real host, since this guard
       returns immediately when isHost() is true, before doing anything.
       It only closes the gap for everyone else, by intercepting the click
       one step earlier in the capture phase than that handler can reach.

       Capture-phase listeners run top-down: window fires before document.
       app-live-tiktok-patch.js's handler is registered on `document`, so a
       capture-phase listener registered here on `window` is guaranteed to
       run first — regardless of script load order — and stopPropagation()
       here prevents the event from ever reaching document, so that
       handler's host-only branches never execute for a non-host tap.
       ═══════════════════════════════════════════════════════════════ */
    window.addEventListener('click', function (e) {
        if (isHost()) return; // never touches anything for the real host
        if (!e.target || !e.target.closest) return;

        var blocked = e.target.closest('#tk-host-requests-btn') ||
                      e.target.closest('#tk-end-live-btn');
        if (blocked) {
            console.log('[GUESTICON-DIAG] blocked non-host tap on #' + blocked.id +
                ' | isGuest=' + !!window.isGuest +
                ' | myId=' + (window.userState && window.userState.id) +
                ' | hostUserId=' + (window.liveStreamData && window.liveStreamData.hostUserId));
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);

    /* ═══════════════════════════════════════════════════════════════
       §B — Guaranteed tap-to-like for the live video background
       ═══════════════════════════════════════════════════════════════ */
    /* ═══════════════════════════════════════════════════════════════
       DIAGNOSTIC ONLY — temporary, safe to remove once the tap issue
       is identified. Does not call stopPropagation/preventDefault and
       does not alter any existing behavior. Logs, for every click
       inside #live-stream-screen while a stream is "live":
         - what element the click actually landed on (e.target)
         - what element is really at that x/y per the browser's own
           hit-testing (elementFromPoint) — if these two disagree with
           what §B below expects, something is stacked on top of the
           video/like area and eating the tap before it can count as
           "background".
         - the computed pointer-events / z-index of both, so we can
           see at a glance whether a comments/guestbox/overlay element
           is the blocker.
         - whether window.liveStreamData.isLive is true at click time
           — if this is false/undefined, §B's very first line bails
           out silently, which alone would explain "tap does nothing"
           for BOTH host and guest.
       Registered capture:true so it always fires and reports the
       truth regardless of what any other handler does afterward.
       ═══════════════════════════════════════════════════════════════ */
    var _pv9LikeStreak = 0;
    var _pv9LikeBurstTimer = null;

    document.addEventListener('click', function (e) {
        var screen = document.getElementById('live-stream-screen');
        if (!screen || !screen.contains(e.target)) return;
        var real = document.elementFromPoint(e.clientX, e.clientY);
        function describe(el) {
            if (!el) return 'null';
            var cs = window.getComputedStyle(el);
            return (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().replace(/\s+/g, '.') : '') +
                ' [pointer-events=' + cs.pointerEvents + ', z-index=' + cs.zIndex + ', position=' + cs.position + ']';
        }
        console.log(
            '[TAP-DIAG] e.target=' + describe(e.target) +
            ' | elementFromPoint=' + describe(real) +
            ' | liveStreamData.isLive=' + !!(window.liveStreamData && window.liveStreamData.isLive) +
            ' | isGuest=' + !!window.isGuest +
            ' | hostUserId=' + (window.liveStreamData && window.liveStreamData.hostUserId) +
            ' | myId=' + (window.userState && window.userState.id)
        );
    }, true);



    document.addEventListener('click', function (e) {
        if (!window.liveStreamData || !window.liveStreamData.isLive) return;
        if (!e.target || !e.target.closest) return;

        var liveStreamScreen = document.getElementById('live-stream-screen');
        var hostMainVideo = document.getElementById('host-main-video');
        var hostVideoFallbackAvatar = document.getElementById('host-video-fallback-avatar');
        var liveBodyEl = e.target.closest && e.target.closest('.live-body');

        // FIX (bug: "tap does nothing" for host AND guest, confirmed via
        // [TAP-DIAG] console output — e.target and elementFromPoint both
        // resolved to `.live-body`, not any of the elements below): the
        // video wrapper `.main-host-video` is `pointer-events:none` by
        // design (style.css), with only its `<video>`/`<img>` children set
        // back to `pointer-events:auto`. Whenever there's no painted video
        // frame yet (no active Agora track, or the element is hidden while
        // waiting for one) those children have nothing for the browser to
        // hit-test, so the tap falls straight through the wrapper to
        // `.live-body` itself underneath — which was never in this
        // isBackground list, so the whole tap silently counted as "not
        // background" and did nothing. Treating a tap that lands on
        // `.live-body` (but not one of the excluded UI regions below) as a
        // background tap too closes that gap without changing anything
        // about how a tap on an actual video frame already behaves.
        var isBackground = (
            e.target === liveStreamScreen || 
            e.target === hostMainVideo ||
            e.target === hostVideoFallbackAvatar ||
            !!e.target.closest('.main-host-video') ||
            !!liveBodyEl
        ) && !e.target.closest(
            '.live-header, .live-footer, #host-control-panel, #multi-guest-container, ' +
            '.live-overlay-box, .live-sub-modal, #tk-guestbox-stack, .live-comments-container, ' +
            // FIX (bug: "host can no longer tap a guest box to gift them"):
            // #emp-grid-overlay (app-live-final.js's current 9-box live
            // participants grid, and its spotlight/gift/mute icons) is
            // appended directly inside .live-body, so every tap inside it
            // was being classified as a background tap here and eaten via
            // e.stopPropagation() below before the grid's own overlay click
            // handler ever got a chance to run. Confirmed via this file's
            // own [PV9-TAP] diagnostic firing on a grid tap. (The strip
            // layout and its self-preview mic/cam buttons already live
            // inside #multi-guest-container above, so they were never
            // affected by this gap.)
            '#emp-grid-overlay'
        );

        if (!isBackground) return;

        console.log('[PV9-TAP] background tap registered, target =', e.target.className || e.target.id || e.target.tagName);

        // Stop this specific event from also reaching app-fixes.js's own
        // (currently unreliable) copy of this same feature further down
        // the bubble phase — prevents a double bubble/double count once
        // that copy starts firing again for any reason.
        e.stopPropagation();

        var liveLikeCountEl = document.getElementById('live-like-count');
        if (liveLikeCountEl) {
            var current = parseInt((liveLikeCountEl.textContent || '0').replace(/,/g, ''), 10) || 0;
            liveLikeCountEl.textContent = (current + 1).toLocaleString();
        }

        var bubble = document.createElement('span');
        bubble.textContent = '❤️';
        bubble.style.cssText = 'position:fixed;left:' + (e.clientX - 12) + 'px;top:' + (e.clientY - 12) +
            'px;pointer-events:none;font-size:2.2rem;z-index:99999;animation:likeBubblePop 1.2s ease-out forwards;';
        document.body.appendChild(bubble);
        setTimeout(function () { bubble.remove(); }, 1500);

        var likeCountEl = document.getElementById('live-like-count-container');
        if (likeCountEl) {
            likeCountEl.classList.add('tk-like-pulse');
            setTimeout(function () { likeCountEl.classList.remove('tk-like-pulse'); }, 120);
            _pv9LikeStreak++;
            if (_pv9LikeBurstTimer) clearTimeout(_pv9LikeBurstTimer);
            _pv9LikeBurstTimer = setTimeout(function () {
                var existingBurst = likeCountEl.querySelector('.tk-like-burst');
                if (existingBurst) existingBurst.remove();
                var burst = document.createElement('span');
                burst.className = 'tk-like-burst';
                burst.textContent = '+' + _pv9LikeStreak;
                likeCountEl.appendChild(burst);
                setTimeout(function () { burst.remove(); }, 750);
                _pv9LikeStreak = 0;
                _pv9LikeBurstTimer = null;
            }, 260);
        }
    }, true); // capture: true — guaranteed to run before app-fixes.js's copy

    /* ═══════════════════════════════════════════════════════════════
       §C — "Live Streaming Income" wallet section (KYC-gated withdraw)
       ═══════════════════════════════════════════════════════════════ */
    function injectWalletIncomeSection() {
        // CONSOLIDATED (dashboard update): no-op now — Live Streaming Income
        // renders as part of app-wallet.js's Earnings Breakdown card
        // (#earnings-summary-container) instead of this separate card, so
        // gifting and live-streaming income appear together in one place.
        // Defensively remove a stale card from a page that hasn't reloaded
        // since this change, so it can't linger duplicated alongside the
        // new consolidated one.
        var stale = document.getElementById('live-income-card');
        if (stale) stale.remove();
    }

    function refreshWalletIncomeUI() {
        // CONSOLIDATED (dashboard update): the balance this used to paint
        // into #live-income-balance is now shown by app-wallet.js's
        // renderEarningsSummary() instead — ask it to refresh so the
        // real-time listener below still keeps the consolidated card
        // current, without maintaining a second render path here.
        if (typeof window.renderEarningsSummary === 'function') window.renderEarningsSummary();
    }

    // Keep userState.liveStreamIncome in sync in real time so a host sees
    // gift income arrive live without needing to reload the app.
    function attachIncomeListener() {
        if (!window.fbDb || !window._firebaseLoaded || !window.userState || !window.userState.id) return;
        if (window._pv9IncomeUnsub) return; // already attached
        try {
            window._pv9IncomeUnsub = window.fbDb.collection('users').doc(window.userState.id)
                .onSnapshot(function (doc) {
                    if (!doc.exists) return;
                    var data = doc.data() || {};
                    if (typeof data.liveStreamIncome === 'number' && window.userState) {
                        window.userState.liveStreamIncome = data.liveStreamIncome;
                        refreshWalletIncomeUI();
                    }
                }, function (err) {
                    console.warn('[PV9-Wallet] income listener error:', err && err.message);
                });
        } catch (e) {
            console.warn('[PV9-Wallet] could not attach income listener:', e && e.message);
        }
    }

    onReady(function () {
        var tries = 0;
        var initRetry = setInterval(function () {
            tries++;
            if (document.getElementById('my-wallet')) {
                clearInterval(initRetry);
                injectWalletIncomeSection();
            } else if (tries > 40) {
                clearInterval(initRetry);
            }
        }, 500);

        var authTries = 0;
        var authRetry = setInterval(function () {
            authTries++;
            if (window.userState && window.userState.id) {
                clearInterval(authRetry);
                attachIncomeListener();
            } else if (authTries > 60) {
                clearInterval(authRetry);
            }
        }, 500);

        // Refresh the displayed balance every time the wallet section is
        // actually navigated to (covers the case where the listener above
        // attached before the DOM card existed yet).
        document.addEventListener('click', function (e) {
            var navLink = e.target.closest && e.target.closest('[data-target="my-wallet"]');
            if (navLink) {
                setTimeout(function () {
                    injectWalletIncomeSection();
                    refreshWalletIncomeUI();
                }, 150);
            }
        });
    });

    /* ═══════════════════════════════════════════════════════════════
       §D — Guest self mic/camera controls
       ═══════════════════════════════════════════════════════════════ */
    function myId() {
        return window.userState && window.userState.id;
    }

    function streamDocRef() {
        var db = window.fbDb;
        var sid = window.liveStreamData && window.liveStreamData.streamId;
        if (!db || !sid || !window._firebaseLoaded) return null;
        return db.collection('active_streams').doc(sid);
    }

    var _pv9SelfMicMuted = false;   // guest tapped their own mic button
    var _pv9SelfCamOff = false;     // guest tapped their own camera button
    var _pv9HostMutedMe = false;    // mirrors `guests[].hostMuted` for this user, read-only
    var _pv9GuestStreamUnsub = null;

    // ---- capture the guest's real Agora tracks without touching
    // app-live-tiktok-patch.js's private closure state (see §D doc above) ----
    function looksLikeGuestTrackFlow() {
        var exitBtn = document.getElementById('tk-exit-guest-btn');
        return !!exitBtn && exitBtn.style.display === 'flex' && !isHost();
    }

    function captureGuestTracks(audioTrack, videoTrack) {
        window._pv9GuestTracks = {
            audio: audioTrack || (window._pv9GuestTracks && window._pv9GuestTracks.audio) || null,
            video: videoTrack || (window._pv9GuestTracks && window._pv9GuestTracks.video) || null
        };
        _pv9SelfMicMuted = false;
        _pv9SelfCamOff = false;
        ensureGuestControlButtons();
        updateGuestControlButtons();
        attachGuestMuteListener();
    }

    function patchAgoraForGuestTracks() {
        if (!window.AgoraRTC || window.AgoraRTC._pv9TrackPatch) return;
        var origBoth = window.AgoraRTC.createMicrophoneAndCameraTracks;
        var origMicOnly = window.AgoraRTC.createMicrophoneAudioTrack;

        if (typeof origBoth === 'function') {
            window.AgoraRTC.createMicrophoneAndCameraTracks = function () {
                var wasGuestFlow = looksLikeGuestTrackFlow();
                return origBoth.apply(window.AgoraRTC, arguments).then(function (tracks) {
                    if (wasGuestFlow) captureGuestTracks(tracks[0], tracks[1]);
                    return tracks;
                });
            };
        }
        if (typeof origMicOnly === 'function') {
            window.AgoraRTC.createMicrophoneAudioTrack = function () {
                var wasGuestFlow = looksLikeGuestTrackFlow();
                return origMicOnly.apply(window.AgoraRTC, arguments).then(function (track) {
                    if (wasGuestFlow) captureGuestTracks(track, null);
                    return track;
                });
            };
        }
        window.AgoraRTC._pv9TrackPatch = true;
    }

    // ---- read-only mirror of this guest's `hostMuted` flag, so a
    // self-unmute attempt can be blocked while the host has muted them,
    // and so a host unmute doesn't get silently undone by our own
    // self-mute state (see combine logic in applyMicEnabledState) ----
    function attachGuestMuteListener() {
        if (_pv9GuestStreamUnsub) return;
        var ref = streamDocRef();
        if (!ref) return;
        _pv9GuestStreamUnsub = ref.onSnapshot(function (doc) {
            if (!doc.exists) return;
            var data = doc.data() || {};
            var guests = data.guests || [];
            var mine = guests.find(function (g) { return g.userId === myId(); });
            var hostMuted = !!(mine && mine.hostMuted);
            if (_pv9HostMutedMe !== hostMuted) {
                _pv9HostMutedMe = hostMuted;
                applyMicEnabledState();
            }
        }, function (err) {
            console.warn('[PV9-GuestMic] listener error:', err && err.message);
        });
    }

    function detachGuestMuteListener() {
        if (_pv9GuestStreamUnsub) { _pv9GuestStreamUnsub(); _pv9GuestStreamUnsub = null; }
    }

    // Re-applies the combined enabled state any time either the guest's
    // own toggle OR the host's remote-mute flag changes, so neither one
    // can silently undo the other.
    function applyMicEnabledState() {
        var audio = window._pv9GuestTracks && window._pv9GuestTracks.audio;
        if (audio && typeof audio.setEnabled === 'function') {
            var shouldBeEnabled = !_pv9SelfMicMuted && !_pv9HostMutedMe;
            audio.setEnabled(shouldBeEnabled).catch(function () {});
        }
        updateGuestControlButtons();
    }

    function ensureGuestControlButtons() {
        // RETIRED 2026-07-17 ("remove the redundant 2 old icons... they
        // are not more needed"): this used to create its OWN separate
        // mic/camera button pair (#tk-guest-mic-btn / #tk-guest-cam-btn)
        // in the footer, entirely independent of app-live-tiktok-patch.js's
        // real #live-mic-toggle / #live-video-toggle. That made TWO mic
        // controls and TWO camera controls exist for the same guest at
        // once -- the real ones (now correctly relocated into the footer
        // right after the exit button, with the premium dark-glass SVG
        // icon set from app-patch-v32.js) and this file's own plain-
        // Font-Awesome pair next to them. The plain-FA pair is also what
        // was rendering as a "no-entry" 🚫 glyph on weak connections --
        // #tk-guest-cam-btn's `fa-video` icon was never covered by
        // app-patch-v32.js's font-independent ::before/data-URI icon fix
        // (that fix only ever targeted #live-mic-toggle / #live-video-
        // toggle and this file's own buttons were unknown to it), so a
        // failed Font Awesome webfont load fell back to the browser's
        // generic missing-glyph glyph there.
        // No longer creating the pair (early return, function kept
        // in place and still safely callable from every existing call
        // site below, per this codebase's no-deletion convention) --
        // plus a one-time defensive cleanup of any copies that may
        // already exist in the DOM from a session that loaded before
        // this fix (e.g. a page that hasn't been reloaded yet).
        var staleMic = document.getElementById('tk-guest-mic-btn');
        if (staleMic) staleMic.remove();
        var staleCam = document.getElementById('tk-guest-cam-btn');
        if (staleCam) staleCam.remove();
        return;

        // eslint-disable-next-line no-unreachable
        var exitBtn = document.getElementById('tk-exit-guest-btn');
        if (!exitBtn || !exitBtn.parentElement) return;
        var footer = exitBtn.parentElement;

        var micBtn = document.getElementById('tk-guest-mic-btn');
        if (!micBtn) {
            micBtn = document.createElement('button');
            micBtn.type = 'button';
            micBtn.id = 'tk-guest-mic-btn';
            micBtn.className = 'live-action-btn tk-guest-self-btn';
            micBtn.title = 'Mute my mic';
            micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            micBtn.style.display = 'none';
            footer.insertBefore(micBtn, exitBtn.nextSibling);
        }
        var camBtn = document.getElementById('tk-guest-cam-btn');
        if (!camBtn) {
            camBtn = document.createElement('button');
            camBtn.type = 'button';
            camBtn.id = 'tk-guest-cam-btn';
            camBtn.className = 'live-action-btn tk-guest-self-btn';
            camBtn.title = 'Turn off my camera';
            camBtn.innerHTML = '<i class="fas fa-video"></i>';
            camBtn.style.display = 'none';
            footer.insertBefore(camBtn, micBtn.nextSibling);
        }
    }

    function updateGuestControlButtons() {
        var exitBtn = document.getElementById('tk-exit-guest-btn');
        var micBtn = document.getElementById('tk-guest-mic-btn');
        var camBtn = document.getElementById('tk-guest-cam-btn');
        if (!exitBtn) return;
        var broadcasting = exitBtn.style.display === 'flex';

        if (!broadcasting) {
            if (micBtn) micBtn.style.display = 'none';
            if (camBtn) camBtn.style.display = 'none';
            return;
        }

        if (micBtn) {
            micBtn.style.display = 'flex';
            var effectivelyMuted = _pv9SelfMicMuted || _pv9HostMutedMe;
            micBtn.classList.toggle('muted', effectivelyMuted);
            micBtn.classList.toggle('host-locked', _pv9HostMutedMe && !_pv9SelfMicMuted);
            micBtn.innerHTML = '<i class="fas fa-microphone' + (effectivelyMuted ? '-slash' : '') + '"></i>';
            micBtn.title = _pv9HostMutedMe ? 'Muted by host' : (_pv9SelfMicMuted ? 'Unmute my mic' : 'Mute my mic');
        }
        if (camBtn) {
            var hasVideoTrack = !!(window._pv9GuestTracks && window._pv9GuestTracks.video);
            // FIX (bug: "guest camera icon not visible" — was flickering
            // between shown/hidden): this used to set display:none the
            // instant there was no track yet, which fought against
            // app-patch-v25.js's own competing poll that forces it back to
            // flex (see that file's cameraRetryFix comment). Two
            // independent 500ms loops fighting over the same style.display
            // is what produced the flicker/invisible-icon symptom. Now this
            // button simply stays visible the whole time this device is
            // broadcasting — "no track yet" is shown as a distinct
            // reconnect state (reusing v25's own .tk-cam-no-track styling)
            // instead of being hidden, so there's nothing left to race.
            camBtn.style.display = 'flex';
            camBtn.classList.toggle('off', _pv9SelfCamOff);
            camBtn.classList.toggle('tk-cam-no-track', !hasVideoTrack);
            camBtn.innerHTML = '<i class="fas fa-video' + ((_pv9SelfCamOff || !hasVideoTrack) ? '-slash' : '') + '"></i>';
            camBtn.title = !hasVideoTrack ? 'Camera unavailable — tap to retry' : (_pv9SelfCamOff ? 'Turn on my camera' : 'Turn off my camera');
        }
    }

    (function injectGuestControlCSS() {
        if (document.getElementById('_pv9_guest_controls_css')) return;
        var s = document.createElement('style');
        s.id = '_pv9_guest_controls_css';
        s.textContent = [
            '.tk-guest-self-btn { background:rgba(255,255,255,0.14)!important; color:#fff!important; }',
            '.tk-guest-self-btn.muted, .tk-guest-self-btn.off { background:rgba(225,29,72,0.20)!important; color:#ff6b81!important; border-color:rgba(225,29,72,0.6)!important; }',
            '.tk-guest-self-btn.host-locked { opacity:0.65; }'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    })();

    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;

        var micBtn = e.target.closest('#tk-guest-mic-btn');
        if (micBtn) {
            e.preventDefault();
            var wantMuted = !_pv9SelfMicMuted;
            if (!wantMuted && _pv9HostMutedMe) {
                notify2('The host has muted you — ask them to unmute you first.', 'warning');
                return;
            }
            _pv9SelfMicMuted = wantMuted;
            applyMicEnabledState();
            return;
        }

        var camBtn = e.target.closest('#tk-guest-cam-btn');
        if (camBtn) {
            e.preventDefault();
            var video = window._pv9GuestTracks && window._pv9GuestTracks.video;
            if (!video || typeof video.setEnabled !== 'function') return;
            _pv9SelfCamOff = !_pv9SelfCamOff;
            video.setEnabled(!_pv9SelfCamOff).catch(function () {});
            updateGuestControlButtons();
            return;
        }
    });

    function notify2(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    }

    function pollGuestButtonState() {
        ensureGuestControlButtons();
        var exitBtn = document.getElementById('tk-exit-guest-btn');
        var broadcasting = !!(exitBtn && exitBtn.style.display === 'flex');
        if (!broadcasting && (window._pv9GuestTracks || _pv9SelfMicMuted || _pv9SelfCamOff || _pv9HostMutedMe)) {
            // guest slot session ended (exit / removed by host) — reset for next time
            window._pv9GuestTracks = null;
            _pv9SelfMicMuted = false;
            _pv9SelfCamOff = false;
            _pv9HostMutedMe = false;
            detachGuestMuteListener();
        }
        updateGuestControlButtons();
    }

    onReady(function () {
        patchAgoraForGuestTracks();
        var patchRetry = setInterval(function () {
            patchAgoraForGuestTracks();
            if (window.AgoraRTC && window.AgoraRTC._pv9TrackPatch) clearInterval(patchRetry);
        }, 500);

        setInterval(pollGuestButtonState, 500);
        pollGuestButtonState();
    });

    console.log('[EmpyreanPatchV9] ✅ Guest icon safety-net, guaranteed tap-to-like, Live Streaming Income wallet section, and guest self mic/camera controls wired.');

})();