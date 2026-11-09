/* =============================================================================
   EMPYREAN INTERNATIONAL — LIVE STREAMING, SINGLE-OWNER, SELF-CONTAINED
   app-live-final.js  |  Load in place of app-live-box-final.js,
   app-patch-v27.js AND app-patch-v28.js (all three retired — see index.html).
   Load AFTER app-live-tiktok-patch.js, BEFORE app-patch-v26.js.

   ═══════════════════════════════════════════════════════════════════════
   2026-07-18 REVISION — 9-box grid: icons repositioned to true corners;
   mic icon restyled to match the footer; tap-to-preview
   ═══════════════════════════════════════════════════════════════════════
   REPORTED (with screenshot): the expand/spotlight icon sat dead-center
   at the top of every guest tile, directly over the person's face, and
   the coin badge sat dead-center at the bottom, directly over their
   name — both icons used `left:50%` to center themselves, which is
   exactly what put them on top of the two things a viewer actually
   wants to see (the face, the name) instead of out of the way.

   FIX, in _renderGrid() below: spotIcon now hugs the top-right corner
   (or stacks just under removeIcon, top:26px, when both apply to the
   same tile — same vertical-stacking idea app-live-tiktok-patch.js
   already uses for its co-host crown above its mute icon); coinBadge
   now hugs the top-left corner (or stacks just under the YOU/HOST tag
   when both apply). giftIcon/removeIcon/muteIcon were already at true
   corners and are unchanged. Net result: all four corners carry small
   edge badges, the avatar and name are fully clear in the middle.

   Also requested: "the mic icon should be the same as the one in the
   footer." The grid's mute/mic icon (.emp-gb-mute) now uses the exact
   same dark-glass gradient/border/shadow recipe app-patch-v34.js
   already applies to every footer badge (#live-mic-toggle included),
   kept at this tile's own 20px circular size rather than the footer's
   44px/14px-radius box — same "match whichever row it's actually part
   of" principle app-patch-v35.js already established for this same
   shared button across the footer vs. host-panel contexts.

   Also requested: tapping a guest/host tile should open a preview (name,
   avatar, contact info if the owner's opted in, message, follow) rather
   than the old host-only "tap the whole tile to spotlight" behavior —
   redundant now that spotlight has its own dedicated corner icon. The
   overlay's click handler now calls window.openHostPreviewModal(uid)
   (app-live-tiktok-patch.js's existing, generic, any-uid profile sheet —
   already wired for Follow/Message/bio, and generic despite its name)
   for a plain tap on any non-empty, non-pending tile. See that file's
   own 2026-07-18 header for the Message button now actually opening a
   real chat thread, and for the matching vertical-guest-strip changes.
   ═══════════════════════════════════════════════════════════════════════
   2026-07-15 REVISION — restores the 9-box grid, adds a host layout
   toggle, explicit spotlight buttons, and guest self camera/mic controls
   ═══════════════════════════════════════════════════════════════════════
   The previous version of this file (see git history / prior deploy)
   replaced app-live-box-final.js's 9-box grid with an always-visible
   corner strip and dropped the grid entirely. Testing showed the grid
   was still a required feature, not a discarded one — both UIs are
   needed side by side, with the HOST choosing which one is on screen.
   This revision does NOT re-introduce a second competing implementation
   of anything: the grid is a pure rendering + roster layer that calls
   the exact same accept/decline/remove/mute/gift functions the strip
   already uses (see [2]), so there is still only one canonical handler
   per action — just two visual presentations of the same data.

   THIS FILE NOW CONTAINS, ALL SELF-CONTAINED, NOTHING SCATTERED ELSEWHERE:
     [1] THE ONE PLACEMENT RULE — unchanged, proven correct. A video
         wrapper is placed by exactly one function, which always clears
         its target container first.
     [2] PERSISTENT STRIP BOXES — always-visible corner boxes, one per
         accepted guest / pending request, built proactively from
         Firestore (not from Agora publish timing). Each guest box now
         also carries an explicit spotlight button (host-only), in
         addition to gift / remove / mute.
     [3] COIN COUNTER — unchanged, wired to the existing
         'empyrean:gift-sent' event.
     [4] GUEST SELF-PREVIEW + SELF CAMERA/MIC CONTROLS — a guest sees
         their own camera locally (unchanged, proven correct) and can
         now tap dedicated mic/camera icons directly on their own box.
         These proxy the existing #live-mic-toggle / #live-video-toggle
         buttons (already wired to real Agora mute/publish logic in
         app-live-tiktok-patch.js) rather than re-implementing track
         control here — this file has no access to that file's private
         track closure, and re-implementing it would risk exactly the
         "duplicate handler silently blocks canonical implementation"
         bug already seen elsewhere in this codebase.
     [5] BIG-SCREEN SPOTLIGHT — host taps a spotlight button (or the box
         itself) to swap any participant into the big screen; whoever
         was there returns to their own persistent box.
     [6] NINE-BOX GRID (RESTORED) — the always-available alternative
         layout from app-live-box-final.js, ported forward with the same
         roster logic (host tile + guest tiles + pending tiles, padded to
         9 slots). Re-uses [2]'s accept/decline/remove/mute/gift
         functions directly — no duplicate logic.
     [7] LAYOUT TOGGLE (NEW) — host-only control-panel button that
         switches the broadcast layout between the strip (small boxes,
         corner) and the 9-box grid (large panel). The two coexist in
         the DOM; only one is visible at a time. The host's choice is
         written to the stream doc (`boxLayoutMode`) so every guest and
         viewer's screen mirrors it — this is a shared broadcast layout
         choice, not a private per-viewer preference.
     [8] SYNC — one Firestore listener drives everything: strip boxes,
         grid roster, and layout-mode mirroring.

   NOT TOUCHED BY THIS FILE (confirmed already correct, left alone):
     - Agora connect/publish/track lifecycle (app-live.js)
     - Join-request accept/decline modal (app-live-tiktok-patch.js's
       renderHostRequests() / window.acceptGuest())
     - Chat + gift real-time sync (attachChatListener / attachGiftSyncListener)
     - "Live streaming ended" detection (app-patch-v17.js)
   ============================================================================= */

(function empyreanLiveFinal() {
    'use strict';

    if (window._empLiveFinalLoaded) {
        console.warn('[LiveFinal] Already loaded — skipping duplicate.');
        return;
    }
    window._empLiveFinalLoaded = true;

    function log(msg)  { console.log('[LiveFinal] ' + msg); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function _ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
    function _us() { var s = window.EmpState || {}; return s.userState || window.userState || {}; }
    function _myId() { return (_us() || {}).id; }
    function _isHost() {
        // FIX (bug: "click to spotlight / place guest in the big screen
        // not working"): this used to check ONLY liveStreamData.hostUserId.
        // app-live-tiktok-patch.js's host-avatar-link handler already
        // documents that the SAME stream doc is sometimes read back with
        // the host id under `hostId` instead of `hostUserId` (field-name
        // drift between writers), with hostUserId winning only once it
        // resolves. Every host-only action in this file --
        // _selectSpotlight (tap-to-spotlight), the layout-toggle button,
        // the self-swap button, and gift/mute/remove icon visibility --
        // is gated on this one function, so that gap silently broke all
        // of them for the real host whenever hostUserId hadn't resolved
        // yet. Falling back to hostId, exactly like the already-working
        // host-link handler does, closes it here too.
        if (window.isGuest || !window.userState || !window.liveStreamData) return false;
        var sd = window.liveStreamData;
        var hid = sd.hostUserId || sd.hostId;
        return !!hid && window.userState.id === hid;
    }
    // Added for app-patch-v33.js's co-host/moderator feature. Same
    // pattern as app-live-tiktok-patch.js's own copy of this helper —
    // read through window, guarded by typeof, so this file has zero
    // hard dependency on v33 ever being loaded. Used ONLY at the four
    // gates v33's own header names (accept/decline/remove/mute) plus
    // the matching UI-visibility spots for those same four actions;
    // spotlight/big-screen and everything else stays _isHost()-only,
    // untouched.
    function _isModerator() {
        return typeof window._empIsModerator === 'function' && window._empIsModerator();
    }
    function _streamId() { return window.liveStreamData && window.liveStreamData.streamId; }
    function _streamRef() {
        var db = window.fbDb, sid = _streamId();
        if (!db || !sid || !window._firebaseLoaded) return null;
        return db.collection('active_streams').doc(sid);
    }
    function _FV() { return (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null; }
    function _escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Same formula app-live.js's _agoraUidFor / app-live-tiktok-patch.js's
    // safeGuestUid already use — must stay byte-identical across all
    // three so a box id built here always matches the one Agora events
    // build. Do not change this without changing it in every other file.
    function _agoraUidForUserId(userId) {
        var base = String(userId || '');
        var h = 0;
        for (var i = 0; i < base.length; i++) h = ((h << 5) - h) + base.charCodeAt(i);
        return (Math.abs(h) % 900000) + 100001;
    }

    /* =========================================================================
       [0] RETIRE LEGACY UIs — belt-and-suspenders in case any old script
       tag is ever accidentally re-added. Hides, doesn't remove, so we
       never fight a listener still attached elsewhere. NOTE: pv25-grid-*
       ids are deliberately NOT in this list — this file owns a brand
       new, differently-named grid (#emp-grid-overlay / #emp-grid-toggle
       family) so there is zero risk of this sweep hiding our own,
       currently-in-use grid.

       FIX 2026-07-16 ("the vertical box that coexists with the grid
       suddenly disappeared" — confirmed root cause, not guessed):
       'tk-guestbox-stack' was in this hide list. That id is NOT a
       retired UI — it is app-live-tiktok-patch.js's real, actively-
       maintained vertical box (renderGuestBoxStack(), driven live off
       the same active_streams onSnapshot listener that already runs
       chat/gifts/join-requests — see that file's own "Guest box stack
       (screenshot 1)" section). This is the exact same mistake
       app-live-box-final.js was retired for (see index.html's own
       retirement comment for that file: "mistaking it for one of the
       four legacy systems... It wasn't; it was never broken"),
       reintroduced here by carrying the old sweep list forward without
       re-checking it against this file's own [2] PERSISTENT STRIP BOXES
       design, which was always meant to coexist with it, not hide it.
       Removed from the sweep — this box can no longer be force-hidden.
       ========================================================================= */
    (function sweepLegacy() {
        function sweep() {
            ['tk-small-slot', 'tk-grid-overlay', 'tk-spotlight-popover',
             'live-shape-toggle', 'live-selfbox-toggle', 'live-spotlight-btn', 'live-grid-toggle',
             'pv25-grid-overlay', 'pv25-grid-toggle'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            var mgc = document.getElementById('multi-guest-container');
            if (mgc && mgc.classList.contains('tk-grid9')) mgc.classList.remove('tk-grid9');
        }
        sweep();
        setInterval(sweep, 1000);
    })();

    /* =========================================================================
       [1] THE ONE PLACEMENT RULE — unchanged from app-live-box-final.js.
       Every video wrapper placement in the whole live-stream feature goes
       through this. Clears the target first, always.
       ========================================================================= */
    function _isVideoWrapper(el) {
        return !!(el && el.id && /^agora-(local-video|guest-\d+|viewer-video|self-preview)$/.test(el.id));
    }
    // FIX 2026-07-17 ("2 guest screens" / "avatar frame box at left" —
    // confirmed root cause, not guessed): #multi-guest-container (built
    // here) and #tk-guestbox-stack (app-live-tiktok-patch.js's real
    // vertical box) were BOTH visible at the same time in "strip" layout
    // mode — see the old CSS rule this replaces, which docked this
    // container to the left edge specifically so it wouldn't overlap
    // #tk-guestbox-stack on the right. Docking it somewhere else was
    // never the fix; showing it AT ALL, next to the box that already
    // covers this exact job (accept/decline/mute tiles per guest), is
    // what produced one guest box per guest on the LEFT plus a second,
    // completely separate one for the same guest on the RIGHT. This
    // container is still required — it's the only place _place()/
    // _returnToStrip() (section [1]) have to put a guest's real Agora
    // video element when that guest isn't the one spotlighted to the
    // big screen, so their track keeps playing and is ready for an
    // instant spotlight swap — but it must never again render as a
    // second, on-screen guest-box UI. It is now permanently hidden
    // off-screen (see the matching #multi-guest-container CSS rule in
    // [9] STYLES) regardless of layout mode, in both "strip" (now just
    // "vertical box") and "grid" mode.
    function _ensureGuestContainer() {
        var gc = document.getElementById('multi-guest-container');
        if (gc) {
            if (gc.classList.contains('tk-grid9')) gc.classList.remove('tk-grid9');
            return gc;
        }
        gc = document.createElement('div');
        gc.id = 'multi-guest-container';
        gc.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:8px;';
        var liveFooter = document.querySelector('.live-footer, #host-control-panel');
        if (liveFooter && liveFooter.parentElement) liveFooter.parentElement.insertBefore(gc, liveFooter);
        else document.body.appendChild(gc);
        return gc;
    }
    function _returnToStrip(wrapper) {
        if (!wrapper) return;
        if (wrapper._pvConnectWatch) { clearInterval(wrapper._pvConnectWatch); wrapper._pvConnectWatch = null; }
        var _staleOverlay = wrapper.querySelector('.emp-connecting-overlay');
        if (_staleOverlay) _staleOverlay.remove();
        if (wrapper.id === 'agora-viewer-video' || wrapper.id === 'agora-self-preview') {
            if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
            return;
        }
        wrapper.style.cssText = 'position:relative;width:90px;height:90px;border-radius:12px;overflow:hidden;flex-shrink:0;';
        _ensureGuestContainer().appendChild(wrapper);
    }
    function _clearContainer(container, exceptEl) {
        if (!container) return;
        Array.prototype.slice.call(container.children).forEach(function (child) {
            if (child === exceptEl || !_isVideoWrapper(child)) return;
            _returnToStrip(child);
        });
    }
    function _place(wrapper, container) {
        if (!wrapper || !container) return;
        _clearContainer(container, wrapper);
        wrapper.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;border-radius:inherit;overflow:hidden;';
        container.appendChild(wrapper);
        _watchForConnectingState(wrapper);
    }
    window._empPlaceVideoWrapper = _place;

    /* FIX ("swap to big screen: tap turns the screen blue, tap again
       turns it black, no way to tell what's selected"): swapping in a
       wrapper is purely a DOM move — it says nothing about whether Agora
       has actually attached a live video track to it yet. A guest
       wrapper with no track yet shows only its avatar-fallback div
       (background #1B2B8B — the "blue screen"); a bare wrapper with a
       <video> tag already inserted but no frames yet shows that video
       element's own default black fill (the "black screen"). Both are
       legitimate "still connecting" states, not bugs, but neither one
       ever told the host that's what was happening. This adds one
       unmissable, self-removing overlay — name + spinner — so a swap
       ALWAYS shows either the real video or a clearly-labeled
       "connecting" state, never an unexplained flat color. */
    function _hasLiveMedia(wrapper) {
        if (!wrapper) return false;
        var v = wrapper.querySelector('video');
        return !!(v && v.readyState >= 2 && v.videoWidth > 0);
    }
    function _nameFor(wrapperId) {
        if (wrapperId === 'agora-local-video') return (_us().fullName || _us().username || 'You');
        var box = document.getElementById(wrapperId);
        var nm = box && box.querySelector('.emp-gb-name');
        return nm ? nm.textContent : 'Guest';
    }
    function _watchForConnectingState(wrapper) {
        if (!wrapper) return;
        if (wrapper._pvConnectWatch) { clearInterval(wrapper._pvConnectWatch); wrapper._pvConnectWatch = null; }
        function _sync() {
            if (!wrapper.isConnected) { clearInterval(wrapper._pvConnectWatch); wrapper._pvConnectWatch = null; return; }
            var overlay = wrapper.querySelector('.emp-connecting-overlay');
            if (_hasLiveMedia(wrapper)) {
                if (overlay) overlay.remove();
                clearInterval(wrapper._pvConnectWatch);
                wrapper._pvConnectWatch = null;
                return;
            }
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'emp-connecting-overlay';
                overlay.style.cssText =
                    'position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
                    'background:rgba(0,0,0,0.35);color:#fff;font-size:0.78rem;font-weight:700;gap:8px;pointer-events:none;';
                overlay.innerHTML =
                    '<i class="fas fa-circle-notch fa-spin" style="font-size:1.3rem;color:#F5C518;"></i>' +
                    '<span class="emp-connecting-label"></span>';
                wrapper.appendChild(overlay);
            }
            overlay.querySelector('.emp-connecting-label').textContent = 'Connecting ' + _nameFor(wrapper.id) + '\u2026';
        }
        _sync();
        wrapper._pvConnectWatch = setInterval(_sync, 500);
    }

    /* =========================================================================
       [2] PERSISTENT STRIP BOXES — always visible in
       #multi-guest-container, built proactively from Firestore, not from
       Agora publish timing. Reuses app-live.js's exact ids/classes
       (agora-guest-<uid>, .agora-guest-video-slot,
       .agora-guest-avatar-fallback) so whichever file creates the box
       first, the other one's `if (!box)` guard is a no-op — never two
       boxes for the same person.

       Every action button here (gift / remove / mute / spotlight) uses
       shared class names (.emp-gb-*) so section [6]'s grid can re-use
       these SAME handler functions with zero duplication — a grid tile
       and a strip tile both just need `.dataset.uid` and the matching
       class name; which layout is on screen doesn't matter to the logic.
       ========================================================================= */
    function _ensureGuestBox(uid, name, avatar) {
        var agoraUid = _agoraUidForUserId(uid);
        var id = 'agora-guest-' + agoraUid;
        var box = document.getElementById(id);
        if (box) { _updateGuestBoxIdentity(box, name, avatar); return box; }
        box = document.createElement('div');
        box.id = id;
        box.className = 'emp-live-box';
        box.dataset.agoraUid = String(agoraUid);
        box.dataset.uid = uid;
        box.dataset.kind = 'guest';
        box.style.cssText = 'width:90px;height:90px;border-radius:14px;overflow:hidden;background:#111;flex-shrink:0;position:relative;border:2px solid rgba(245,197,24,0.45);cursor:pointer;';
        box.innerHTML =
            '<div class="agora-guest-video-slot" style="position:absolute;inset:0;"></div>' +
            '<div class="agora-guest-avatar-fallback" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#1B2B8B;">' +
                (avatar ? '<img src="' + avatar + '" style="width:100%;height:100%;object-fit:cover;">' : '<span style="color:#fff;font-weight:700;font-size:1.1rem;">' + _escapeHtml((name || 'G').charAt(0).toUpperCase()) + '</span>') +
            '</div>' +
            '<div class="emp-gb-name" style="position:absolute;bottom:4px;left:6px;right:6px;font-size:0.6rem;color:#fff;font-weight:700;background:rgba(0,0,0,0.55);padding:2px 5px;border-radius:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _escapeHtml(name || 'Guest') + '</div>' +
            '<div class="emp-gb-coin" style="position:absolute;top:3px;left:3px;background:rgba(245,197,24,0.95);color:#000;font-size:0.55rem;font-weight:800;padding:1px 5px;border-radius:8px;"><i class="fa-solid fa-coins"></i> 0</div>' +
            '<span class="emp-gb-spotlight" title="Spotlight to big screen" style="position:absolute;top:3px;left:50%;transform:translateX(-50%);width:20px;height:20px;border-radius:50%;display:none;align-items:center;justify-content:center;border:2px solid #000;background:rgba(27,43,139,0.92);color:#F5C518;font-size:0.6rem;z-index:4;"><i class="fas fa-up-right-and-down-left-from-center"></i></span>' +
            '<span class="emp-gb-gift" style="position:absolute;bottom:4px;left:4px;width:22px;height:22px;border-radius:50%;display:none;align-items:center;justify-content:center;border:2px solid #000;background:rgba(245,197,24,0.95);color:#000;font-size:0.68rem;z-index:3;"><i class="fas fa-gift"></i></span>' +
            '<span class="emp-gb-remove" style="position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:50%;display:none;align-items:center;justify-content:center;border:2px solid #000;background:rgba(225,29,72,0.92);color:#fff;font-size:0.62rem;z-index:3;"><i class="fas fa-times"></i></span>' +
            '<span class="emp-gb-mute" style="position:absolute;bottom:4px;right:4px;width:20px;height:20px;border-radius:50%;display:none;align-items:center;justify-content:center;border:2px solid #000;background:rgba(20,20,24,0.9);color:#fff;font-size:0.62rem;z-index:3;"><i class="fas fa-microphone"></i></span>';
        _ensureGuestContainer().appendChild(box);
        _wireBoxInteractions(box);
        return box;
    }
    function _updateGuestBoxIdentity(box, name, avatar) {
        var fb = box.querySelector('.agora-guest-avatar-fallback');
        var nm = box.querySelector('.emp-gb-name');
        if (fb && avatar && !fb.dataset.avatarSet) {
            fb.innerHTML = '<img src="' + avatar + '" style="width:100%;height:100%;object-fit:cover;">';
            fb.dataset.avatarSet = '1';
        }
        if (nm && name) nm.textContent = name;
    }
    function _removeGuestBoxByUid(uid) {
        var box = document.querySelector('.emp-live-box[data-uid="' + uid + '"][data-kind="guest"]');
        if (box) box.remove();
    }

    // Pending join-request tile — visually distinct (dashed border), no
    // video slot, tap-to-accept for the host. Separate id space
    // ('emp-pending-<uid>') so _isVideoWrapper() never mistakes it for a
    // real video wrapper.
    function _ensurePendingBox(uid, name, avatar) {
        var id = 'emp-pending-' + uid;
        var box = document.getElementById(id);
        if (box) return box;
        box = document.createElement('div');
        box.id = id;
        box.className = 'emp-live-box emp-live-box-pending';
        box.dataset.uid = uid;
        box.dataset.kind = 'pending';
        box.style.cssText = 'width:90px;height:90px;border-radius:14px;overflow:hidden;background:rgba(255,255,255,0.06);flex-shrink:0;position:relative;border:2px dashed rgba(245,197,24,0.6);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;';
        box.innerHTML =
            (avatar ? '<img src="' + avatar + '" style="width:46%;height:46%;border-radius:50%;object-fit:cover;margin-bottom:4px;">' : '<i class="fas fa-user-clock" style="color:#F5C518;font-size:1.2rem;margin-bottom:4px;"></i>') +
            '<div class="emp-gb-name" style="font-size:0.58rem;color:#fff;font-weight:700;text-align:center;padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">' + _escapeHtml(name || 'Guest') + '</div>' +
            '<div style="position:absolute;bottom:3px;left:3px;right:3px;text-align:center;background:rgba(245,197,24,0.92);color:#000;font-size:0.52rem;font-weight:800;padding:1px 4px;border-radius:6px;">Requesting</div>' +
            '<span class="emp-gb-remove" style="position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #000;background:rgba(225,29,72,0.92);color:#fff;font-size:0.62rem;z-index:3;"><i class="fas fa-times"></i></span>';
        _ensureGuestContainer().appendChild(box);
        box.addEventListener('click', function (e) {
            if (e.target.closest('.emp-gb-remove')) { e.stopPropagation(); _declinePending(uid); return; }
            _acceptPending(uid, box);
        });
        return box;
    }
    function _removePendingBox(uid) {
        var box = document.getElementById('emp-pending-' + uid);
        if (box) box.remove();
    }

    function _wireBoxInteractions(box) {
        box.addEventListener('click', function (e) {
            if (e.target.closest('.emp-gb-gift')) { e.stopPropagation(); _giftFromBox(box); return; }
            if (e.target.closest('.emp-gb-remove')) { e.stopPropagation(); _removeGuest(box.dataset.uid); return; }
            if (e.target.closest('.emp-gb-mute')) { e.stopPropagation(); _toggleMute(box); return; }
            if (e.target.closest('.emp-gb-spotlight')) { e.stopPropagation(); _selectSpotlight(box.dataset.uid); return; }
            if (!_isHost()) return; // spotlight-by-tap is host-only, per spec
            _selectSpotlight(box.dataset.kind === 'self' ? 'self' : box.dataset.uid);
        });
    }
    function _refreshHostControls() {
        var host = _isHost();
        var canModerate = host || _isModerator();
        document.querySelectorAll('.emp-live-box[data-kind="guest"]').forEach(function (box) {
            // FIX (bug: "select a guest to send a gift" not working for
            // anyone but the host): _giftFromBox() has no host check at
            // all — sending a gift to a guest is a viewer-facing action,
            // not a host control. This icon was being hidden from every
            // non-host, which is the entire reason tapping a guest box to
            // gift them silently did nothing for hosts AND guests alike.
            // Gift is now visible to everyone EXCEPT on your own box —
            // see the matching _giftFromBox guard for why (a guest's own
            // entry is `kind:"guest"` too, so without this check a guest
            // saw a gift icon on themselves). remove/mute are now also
            // visible to a co-host/moderator (app-patch-v33.js) — spotlight
            // stays host-only, unchanged.
            var isMe = box.dataset.uid === _myId();
            box.querySelector('.emp-gb-gift').style.display = isMe ? 'none' : 'flex';
            box.querySelector('.emp-gb-remove').style.display = canModerate ? 'flex' : 'none';
            box.querySelector('.emp-gb-mute').style.display = canModerate ? 'flex' : 'none';
            var sp = box.querySelector('.emp-gb-spotlight');
            if (sp) sp.style.display = host ? 'flex' : 'none';
        });
    }

    async function _acceptPending(uid, box) {
        if ((!_isHost() && !_isModerator()) || typeof window.acceptGuest !== 'function') return;
        if (box) box.style.opacity = '0.5';
        try { await window.acceptGuest(uid); }
        catch (e) { notify('Could not accept: ' + e.message, 'error'); if (box) box.style.opacity = '1'; }
    }
    async function _declinePending(uid) {
        if (!_isHost() && !_isModerator()) return;
        var ref = _streamRef(), FV = _FV();
        if (!ref || !FV) return;
        try {
            var data = (await ref.get()).data() || {};
            var entry = (data.joinRequests || []).find(function (r) { return r.userId === uid; });
            if (entry) await ref.update({ joinRequests: FV.arrayRemove(entry) });
        } catch (e) { notify('Could not decline: ' + e.message, 'error'); }
    }
    async function _removeGuest(uid) {
        if (!_isHost() && !_isModerator()) return;
        var ref = _streamRef(), FV = _FV();
        if (!ref || !FV) return;
        try {
            var data = (await ref.get()).data() || {};
            var entry = (data.guests || []).find(function (g) { return g.userId === uid; });
            if (entry) await ref.update({ guests: FV.arrayRemove(entry) });
        } catch (e) { notify('Could not remove: ' + e.message, 'error'); }
    }
    async function _toggleMute(box) {
        if (!_isHost() && !_isModerator()) return;
        var uid = box.dataset.uid;
        var ref = _streamRef(), FV = _FV();
        if (!ref || !FV) return;
        try {
            var data = (await ref.get()).data() || {};
            var entry = (data.guests || []).find(function (g) { return g.userId === uid; });
            if (!entry) return;
            var updated = Object.assign({}, entry, { hostMuted: !entry.hostMuted });
            await ref.update({ guests: FV.arrayRemove(entry) });
            await ref.update({ guests: FV.arrayUnion(updated) });
        } catch (e) { notify('Could not update mic: ' + e.message, 'error'); }
    }
    function _giftFromBox(box) {
        var uid = box.dataset.uid;
        // FIX (bug: "select a guest, sending gift says can't gift
        // yourself"): a guest broadcaster's OWN entry is still `kind:
        // 'guest'` in the roster (see _buildRoster's `isMe` flag / the
        // strip's guests.forEach in _watchGuestList) -- neither the grid
        // nor the strip excluded isMe when deciding whether to draw a
        // gift icon, so a guest saw a gift icon on their OWN box too.
        // Tapping it opened the catalog targeted at themselves, and
        // app-fixes.js's _empySendGiftNowInner correctly refused to send
        // -- but from the guest's side that looked exactly like "sending
        // gift does not send". Blocking it here, before the catalog even
        // opens, means the correct guest box (someone else's) still works
        // exactly as before; only tapping your own box changes behavior.
        if (uid && uid === _myId()) {
            notify("That's your own box -- pick a different guest to gift.", 'info');
            return;
        }
        var name = (box.querySelector('.emp-gb-name') || {}).textContent || 'Guest';
        if (typeof window.openGiftCatalogFor === 'function') window.openGiftCatalogFor(uid, name);
        else if (typeof window.openGiftCatalog === 'function') window.openGiftCatalog(uid, name);
        else notify('Gift catalog not available right now.', 'warning');
    }

    /* =========================================================================
       [3] COIN COUNTER — wired to the existing 'empyrean:gift-sent' event
       (already dispatched by app-fixes.js / app-live-tiktok-patch.js the
       moment a gift is credited). No changes needed to gift sending or
       sync; this only updates the visible badge (strip box; the grid
       re-reads its own total straight off this same object at render
       time — see [6]).
       ========================================================================= */
    var _giftTotals = {};
    var _giftTrackStreamId = null;
    function _resetGiftTotalsIfNewStream() {
        var sid = _streamId();
        if (sid !== _giftTrackStreamId) { _giftTrackStreamId = sid; _giftTotals = {}; }
    }
    document.addEventListener('empyrean:gift-sent', function (e) {
        var d = e.detail || {};
        if (!d.recipientId || !d.amount) return;
        _resetGiftTotalsIfNewStream();
        _giftTotals[d.recipientId] = (_giftTotals[d.recipientId] || 0) + d.amount;
        var coinEl = document.querySelector('.emp-live-box[data-uid="' + d.recipientId + '"] .emp-gb-coin');
        if (coinEl) coinEl.innerHTML = '<i class="fa-solid fa-coins"></i> ' + _giftTotals[d.recipientId];
        _refreshGridIfVisible();
    });

    /* =========================================================================
       [4] GUEST SELF-PREVIEW — self-preview (local camera thumbnail)
       unchanged from app-live-box-final.js (already proven correct): a
       guest sees their own camera locally, independent of any Agora
       round-trip.

       FIX 2026-07-17 ("duplicate mic and camera icon in the guest
       screen"): this box used to ALSO carry its own pair of mic/cam
       toggle badges (.emp-self-mic-btn / .emp-self-cam-btn) that proxied
       a click through to #live-mic-toggle / #live-video-toggle. Those
       two real buttons are now relocated directly into .live-footer for
       an accepted guest broadcaster (see app-live-tiktok-patch.js's
       refreshRoleVisibility()), so a guest already has one working mic
       control and one working camera control in the footer, in the same
       place every other footer action (rose, gift, share, exit) already
       lives. Keeping this second pair here as well was the literal
       duplicate — two separate on-screen toggles for the same two real
       buttons. The badge markup/wiring is disabled below (not deleted,
       per this codebase's no-deletion convention) rather than reworked,
       since the footer buttons are the real controls and this box's job
       is now only to show the guest their own camera preview, nothing
       else.
       ========================================================================= */
    function _ensureSelfPreviewBox() {
        var gc = _ensureGuestContainer();
        var id = 'self-preview-box';
        var box = document.getElementById(id);
        if (box) return box;
        var us = _us();
        box = document.createElement('div');
        box.id = id;
        box.className = 'emp-live-box';
        box.style.cssText = 'width:90px;height:90px;border-radius:14px;overflow:hidden;background:#111;flex-shrink:0;position:relative;border:2px solid rgba(245,197,24,0.6);';
        box.innerHTML =
            '<div class="self-preview-slot" style="position:absolute;inset:0;"></div>' +
            '<div class="self-preview-fallback" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#1B2B8B;">' +
                (us.avatar ? '<img src="' + us.avatar + '" style="width:100%;height:100%;object-fit:cover;">' : '<span style="color:#fff;font-weight:700;">' + ((us.fullName || us.username || 'Y').charAt(0).toUpperCase()) + '</span>') +
            '</div>' +
            '<div style="position:absolute;top:2px;left:4px;font-size:0.58rem;color:#F5C518;font-weight:800;background:rgba(0,0,0,0.5);padding:1px 5px;border-radius:5px;z-index:4;">YOU</div>';
            // RETIRED 2026-07-17 — .emp-self-controls (mic/cam badge pair)
            // intentionally no longer rendered here; see the fix note
            // above. The real mic/camera controls now live in
            // .live-footer for the whole duration of the guest's
            // broadcast, so nothing on this box needs to proxy to them
            // any more.
        gc.insertBefore(box, gc.firstChild);
        return box;
    }
    function _proxyToggle(controlId) {
        // RETIRED 2026-07-17 — no longer called (the self-preview box no
        // longer renders its own mic/cam badges to wire up), kept inert
        // rather than removed per this codebase's no-deletion convention.
        var btn = document.getElementById(controlId);
        if (btn) btn.click();
        else notify('Control not available right now.', 'warning');
    }
    function _syncSelfControlIcons() {
        // RETIRED 2026-07-17 — the badges this used to sync
        // (.emp-self-mic-btn / .emp-self-cam-btn) are no longer rendered
        // on the self-preview box (see _ensureSelfPreviewBox above), so
        // this is now a no-op. Left in place (rather than removed) and
        // still safely callable from every existing call site below,
        // per this codebase's no-deletion convention.
        var box = document.getElementById('self-preview-box');
        if (!box) return;
    }
    function _showSelfPreview(track) {
        var box = _ensureSelfPreviewBox();
        var slot = box.querySelector('.self-preview-slot');
        var fallback = box.querySelector('.self-preview-fallback');
        if (!track || !slot) { if (fallback) fallback.style.display = 'flex'; return; }
        try {
            track.play(slot);
            slot.style.display = 'block';
            if (fallback) fallback.style.display = 'none';
        } catch (e) { log('self-preview play() failed: ' + e.message); }
    }
    function _hideSelfPreview() {
        var box = document.getElementById('self-preview-box');
        if (box) box.remove();
    }
    var _selfPreviewArmed = false;
    var _selfPreviewTrack = null;
    function _watchGuestSelfState() {
        var camToggle = document.getElementById('live-video-toggle');
        if (!camToggle || !camToggle.closest('#host-control-panel')) return;
        var isLiveIcon = camToggle.innerHTML.indexOf('fa-video-slash') === -1 && camToggle.innerHTML.indexOf('fa-video') !== -1;
        var panel = document.getElementById('host-control-panel');
        var guestMode = panel && panel.classList.contains('tk-guest-broadcast-mode');
        if (!guestMode) { if (_selfPreviewArmed) { _selfPreviewArmed = false; _selfPreviewTrack = null; _hideSelfPreview(); } return; }
        if (!isLiveIcon) { if (_selfPreviewArmed) { _selfPreviewArmed = false; _selfPreviewTrack = null; _showSelfPreview(null); } _syncSelfControlIcons(); return; }
        _syncSelfControlIcons();

        // FIX 2026-07-16 ("guest screen camera no longer responds when
        // clicked" — confirmed root cause, not guessed): this used to call
        // its OWN independent navigator.mediaDevices.getUserMedia({video:
        // true}) here, on an 800ms poll, purely to show this local
        // preview. That request competed with app-live-tiktok-patch.js's
        // real Agora camera acquisition (promoteToGuestBroadcaster) for
        // the SAME physical camera device at nearly the same moment a
        // guest goes live — a classic "two concurrent handlers fight over
        // one resource" bug, same shape as others already fixed elsewhere
        // in this codebase (see app-patch-v31.js's anonymous-sign-in-vs-
        // real-login fix for the same pattern). Whichever request lost
        // that race got nothing; when it was Agora's own track that lost,
        // _guestTracks.video stayed empty and the camera toggle button
        // silently stopped responding for the rest of the session. Now
        // this just plays the REAL Agora track (exposed via
        // window._empGuestVideoTrack — see that file's own fix note) —
        // there is no second camera request left to race with, at all.
        var liveTrack = typeof window._empGuestVideoTrack === 'function' ? window._empGuestVideoTrack() : null;
        if (!liveTrack) {
            if (_selfPreviewArmed) { _selfPreviewArmed = false; _selfPreviewTrack = null; _showSelfPreview(null); }
            return;
        }
        if (_selfPreviewArmed && _selfPreviewTrack === liveTrack) return; // already showing this exact track — nothing to redo
        _selfPreviewArmed = true;
        _selfPreviewTrack = liveTrack;
        _showSelfPreview(liveTrack);
    }
    setInterval(_watchGuestSelfState, 800);
    document.addEventListener('empyrean-init-done', function () { setTimeout(_watchGuestSelfState, 500); });

    /* =========================================================================
       [5] BIG-SCREEN SPOTLIGHT — host-only. Tapping a box's spotlight
       icon (or the box itself) swaps it into the big screen; whoever
       was there returns to their own persistent box in whichever layout
       (strip or grid) is currently on screen.
       ========================================================================= */
    function _wrapperFor(occupant) {
        if (!occupant) return null;
        if (occupant === 'self') return document.getElementById('agora-local-video');
        return document.getElementById('agora-guest-' + _agoraUidForUserId(occupant));
    }
    var _bigOccupant = 'self';
    function _selectSpotlight(userId) {
        if (!_isHost()) return;
        if (_bigOccupant === userId) return;
        var big = document.querySelector('.live-body .main-host-video');
        var nextWrapper = _wrapperFor(userId);
        if (!nextWrapper) { notify('That participant\u2019s video isn\u2019t connected yet.', 'warning'); return; }
        var prevWrapper = _wrapperFor(_bigOccupant);
        _place(nextWrapper, big);
        if (prevWrapper && prevWrapper !== nextWrapper) _returnToStrip(prevWrapper);
        _bigOccupant = userId;
        _refreshActiveHighlight();
        _refreshGridIfVisible();
    }
    // FIX 2026-07-16 ("expand-to-large-screen never worked" — confirmed
    // root cause: not tied to the vertical box at all): this function was
    // only ever reachable from THIS file's own .emp-live-box tiles (the
    // strip/grid boxes it builds) via _wireBoxInteractions/_renderGrid's
    // click handling. app-live-tiktok-patch.js's #tk-guestbox-stack — the
    // real, always-visible vertical box (see sweepLegacy() fix above) —
    // has its own, completely separate click handler for its .tk-guestbox
    // tiles (accept/decline/mute/gift-hint only) and had no way at all to
    // call into this one. Exposing it here lets that file wire a tap on
    // its own tiles to the exact same spotlight logic, instead of
    // duplicating it — one canonical implementation, reachable from
    // whichever box is actually on screen. Resolves by userId, not by
    // which DOM box was tapped, so it works identically from either box.
    window._empSelectSpotlight = _selectSpotlight;
    function _refreshActiveHighlight() {
        document.querySelectorAll('.emp-live-box').forEach(function (box) {
            var mine = (box.dataset.kind === 'self' && _bigOccupant === 'self') || (box.dataset.uid === _bigOccupant && box.dataset.kind === 'guest');
            box.style.borderColor = mine ? '#F5C518' : 'rgba(245,197,24,0.45)';
            box.style.boxShadow = mine ? '0 0 0 2px rgba(245,197,24,0.35)' : 'none';
        });
    }
    function _anchorSelfIfEmpty() {
        if (!_isHost()) return;
        var big = document.querySelector('.live-body .main-host-video');
        if (!big) return;
        var hasVideo = Array.prototype.some.call(big.children, _isVideoWrapper);
        if (hasVideo) return;
        var self = document.getElementById('agora-local-video');
        if (self) _place(self, big);
    }
    // Give the host a way to swap themselves back into the big screen
    // without needing a guest box to tap — a small dedicated control.
    function _injectSelfSwapButton() {
        var panel = document.getElementById('host-control-panel');
        if (!panel || document.getElementById('emp-self-swap-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'emp-self-swap-btn';
        btn.className = 'live-action-btn host-control';
        btn.innerHTML = '<i class="fas fa-user"></i>';
        btn.title = 'Show me in the big screen';
        btn.addEventListener('click', function (e) { e.stopPropagation(); _selectSpotlight('self'); });
        (document.getElementById('host-control-panel-inner') || panel).appendChild(btn);
    }
    function _refreshSelfSwapVisibility() {
        var btn = document.getElementById('emp-self-swap-btn');
        if (btn) btn.style.display = (_isHost() && _bigOccupant !== 'self') ? 'flex' : 'none';
    }

    /* =========================================================================
       [6] NINE-BOX GRID (RESTORED) — same roster concept as the retired
       app-live-box-final.js grid: host tile first, then one tile per
       accepted guest, then one per pending join request (host view
       only), padded to 9 total slots. Calls straight into [2]'s
       accept/decline/remove/mute/gift functions — this section owns NO
       action logic of its own, only rendering + the roster data.
       ========================================================================= */
    var GRID_SLOTS = 9;
    var _lastKnownGuests = [];
    var _lastKnownRequests = [];

    function _rosterHostEntry() {
        var sd = window.liveStreamData || {};
        var amHost = _isHost();
        var us = _us();
        return {
            kind: 'host', uid: amHost ? 'self' : (sd.hostUserId || 'host'),
            name: amHost ? (us.fullName || us.username || 'You') : ((document.getElementById('live-host-name') || {}).textContent || 'Host'),
            avatar: amHost ? (us.avatar || '') : (sd.hostAvatar || ''), isMe: amHost
        };
    }
    function _buildRoster() {
        var roster = [_rosterHostEntry()];
        var myId = _myId();
        _lastKnownGuests.forEach(function (g) {
            roster.push({ kind: 'guest', uid: g.userId, name: g.fullName || g.username || 'Guest', avatar: g.avatar || '', isMe: g.userId === myId, muted: !!g.hostMuted, coins: _giftTotals[g.userId] || 0 });
        });
        if (_isHost() || _isModerator()) {
            _lastKnownRequests.forEach(function (r) { roster.push({ kind: 'pending', uid: r.userId, name: r.fullName || r.username || 'Guest', avatar: r.avatar || '' }); });
        }
        while (roster.length < GRID_SLOTS) roster.push({ kind: 'empty' });
        return roster.slice(0, GRID_SLOTS);
    }
    function _ensureGridOverlay() {
        var overlay = document.getElementById('emp-grid-overlay');
        if (overlay) return overlay;
        var body = document.querySelector('.live-body');
        if (!body) return null;
        overlay = document.createElement('div');
        overlay.id = 'emp-grid-overlay';
        body.appendChild(overlay);
        // Single delegated listener drives every tile — re-uses [2]'s
        // canonical accept/decline/remove/mute/gift/spotlight functions.
        overlay.addEventListener('click', function (e) {
            var giftIcon = e.target.closest('.emp-gb-gift');
            if (giftIcon) { e.stopPropagation(); _giftFromBox(giftIcon.closest('.emp-grid-box')); return; }
            var removeIcon = e.target.closest('.emp-gb-remove');
            if (removeIcon) {
                e.stopPropagation();
                var rbox = removeIcon.closest('.emp-grid-box');
                if (rbox.dataset.kind === 'pending') _declinePending(rbox.dataset.uid);
                else _removeGuest(rbox.dataset.uid);
                return;
            }
            var muteIcon = e.target.closest('.emp-gb-mute');
            if (muteIcon) { e.stopPropagation(); _toggleMute(muteIcon.closest('.emp-grid-box')); return; }
            var spotIcon = e.target.closest('.emp-gb-spotlight');
            if (spotIcon) { e.stopPropagation(); _selectSpotlight(spotIcon.closest('.emp-grid-box').dataset.uid); return; }
            var box = e.target.closest('.emp-grid-box');
            if (!box) return;
            if (box.classList.contains('emp-grid-empty')) { _handleEmptyBoxTap(); return; }
            if (box.dataset.kind === 'pending') { _acceptPending(box.dataset.uid, box); return; }
            // FEATURE ("click a guest card to see their preview — avatar,
            // name, contact info, message/follow"): a plain tap anywhere on
            // a host/guest tile that isn't one of the action icons above
            // now opens the same profile-preview sheet already used for
            // tapping the host's name/avatar in the live header
            // (app-live-tiktok-patch.js's openHostPreviewModal — generic,
            // takes any uid, not host-specific despite its name). This
            // replaces the old host-only "tap the whole tile to spotlight"
            // behavior, which is no longer needed now that spotlight has
            // its own dedicated corner icon (see spotIcon above) — so
            // nothing is lost, and viewers (who previously couldn't tap a
            // tile for anything) now get the preview too.
            if (typeof window.openHostPreviewModal === 'function') {
                window.openHostPreviewModal(box.dataset.uid);
            }
        });
        return overlay;
    }
    function _handleEmptyBoxTap() {
        if (!_isHost()) return;
        notify('Guests can join by requesting to broadcast — accept their request from the live comments or the pending tile here.', 'info');
    }

    // FIX ("mic icon in the guest box on the host screen — still the old
    // icon"): the 2026-07-18 revision above (see file header) only matched
    // this badge's BACKGROUND/border/shadow to the footer's dark-glass
    // look — the glyph inside was still the plain Font Awesome
    // fa-microphone / fa-microphone-slash webfont icon, which is exactly
    // what the reported screenshot shows on this grid tile. app-live-
    // tiktok-patch.js already solved this for its OWN guest-box stack
    // (.tk-guestbox) with an inline SVG built to match the requested
    // reference icon (rounded capsule head, arched stand, base bar,
    // diagonal slash when muted) — that function is private to that
    // file's closure, so it can't be called from here; this is the same
    // SVG, defined locally so both guest-box UIs render an identical
    // glyph. Uses currentColor, so it still inherits this badge's own
    // white / muted-red coloring from .emp-gb-mute /
    // .emp-gb-mute.emp-grid-muted (both untouched) — only the glyph
    // changed.
    function _premiumMicSvg(muted) {
        return '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<rect x="9" y="2.5" width="6" height="12" rx="3" fill="currentColor"/>' +
            '<path d="M5.5 10.5v1a6.5 6.5 0 0 0 13 0v-1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
            '<line x1="12" y1="18" x2="12" y2="20.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
            '<line x1="8.2" y1="21" x2="15.8" y2="21" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
            (muted ? '<line x1="3.5" y1="20.5" x2="20.5" y2="3.5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>' : '') +
            '</svg>';
    }

    function _renderGrid() {
        var overlay = _ensureGridOverlay();
        if (!overlay) return;
        var host = _isHost();
        var canModerate = host || _isModerator();
        var roster = _buildRoster();
        var html = '<div class="emp-grid-title">' + (host ? 'Live participants — tap to spotlight' : 'Live participants') + '</div>';
        html += roster.map(function (p) {
            if (p.kind === 'empty') return '<div class="emp-grid-box emp-grid-empty" data-kind="empty"><i class="fas fa-plus" style="color:rgba(255,255,255,0.35);font-size:1.1rem;"></i></div>';
            var isActive = p.kind !== 'pending' && p.uid === _bigOccupant;
            var cls = 'emp-grid-box' + (p.kind === 'pending' ? ' emp-grid-pending' : '') + (isActive ? ' emp-grid-active' : '');
            var tag = p.kind === 'host' ? '<span class="emp-grid-tag">' + (p.isMe ? 'YOU \u00b7 HOST' : 'HOST') + '</span>'
                : (p.isMe ? '<span class="emp-grid-tag">YOU</span>' : '');
            var pendingTag = p.kind === 'pending' ? '<span class="emp-grid-pending-tag">Requesting</span>' : '';
            // FIX (bug #1, same root cause as the strip boxes above): gift
            // is a viewer-facing action, not a host control — must render
            // for every guest tile regardless of who's looking, not just
            // when `host` is true.
            // FIX (bug: "select a guest, sending gift says can't gift
            // yourself"): same gap as the strip -- a guest's own tile is
            // still `kind: 'guest'` (just with `isMe: true`), so this
            // used to draw a gift icon on your own box too.
            // remove/mute now also render for a co-host/moderator
            // (app-patch-v33.js); spotIcon stays host-only, unchanged —
            // tap-to-spotlight is deliberately not a moderator capability.
            var giftIcon = (p.kind === 'guest' && !p.isMe) ? '<span class="emp-gb-gift emp-grid-icon" style="display:flex;bottom:4px;left:4px;"><i class="fas fa-gift"></i></span>' : '';
            var removeIcon = (canModerate && (p.kind === 'guest' || p.kind === 'pending')) ? '<span class="emp-gb-remove emp-grid-icon" style="display:flex;top:4px;right:4px;"><i class="fas fa-times"></i></span>' : '';
            // FIX ("mic icon still the outdated one, requested to be
            // changed to the premium classic icon"): was rendering the
            // plain fa-microphone / fa-microphone-slash webfont glyph
            // here — swapped for _premiumMicSvg() above, the same glyph
            // app-live-tiktok-patch.js already uses on its own guest-box
            // stack, so both guest-box UIs now show the identical icon.
            var muteIcon = (canModerate && p.kind === 'guest') ? '<span class="emp-gb-mute emp-grid-icon' + (p.muted ? ' emp-grid-muted' : '') + '" style="display:flex;bottom:4px;right:4px;">' + _premiumMicSvg(p.muted) + '</span>' : '';
            // FIX ("expand icon blocking the guest's face"): was pinned
            // dead-center at top:4px;left:50% — directly over the avatar,
            // which is exactly what a viewer taps to see the person's face.
            // Now hugs a true corner instead: top-right when nothing else
            // wants that corner (host's own tile — removeIcon never renders
            // for kind==='host'), or stacked just below removeIcon on the
            // same edge when both apply to the same guest tile (same
            // vertical-stacking convention app-live-tiktok-patch.js already
            // uses for its co-host crown above its mute icon).
            var spotTop = removeIcon ? '26px' : '4px';
            var spotIcon = (host && (p.kind === 'guest' || p.kind === 'host')) ? '<span class="emp-gb-spotlight emp-grid-icon" style="display:flex;top:' + spotTop + ';right:4px;background:rgba(27,43,139,0.92);color:#F5C518;"><i class="fas fa-up-right-and-down-left-from-center"></i></span>' : '';
            // FIX ("coin icon blocking the name"): was pinned dead-center at
            // bottom:3px;left:50%, sitting right on top of the name label
            // beneath the avatar. Now a true top-left corner badge (matches
            // the vertical guest strip's own coin placement, which never had
            // this problem) — stacked below the YOU/HOST tag on the rare
            // tile where both apply (a moderator viewing their own guest
            // tile) instead of overlapping it.
            var coinTop = tag ? '24px' : '4px';
            var coinBadge = p.kind === 'guest' ? '<div class="emp-grid-coin" style="top:' + coinTop + ';left:4px;"><i class="fa-solid fa-coins"></i> ' + (p.coins || 0) + '</div>' : '';
            return '<div class="' + cls + '" data-uid="' + p.uid + '" data-kind="' + p.kind + '">' + tag + pendingTag + spotIcon + giftIcon + removeIcon + muteIcon + coinBadge +
                '<img src="' + (p.avatar || '') + '" onerror="this.style.visibility=\'hidden\'">' +
                '<div class="emp-gb-name emp-grid-name">' + _escapeHtml(p.isMe ? 'You' : p.name) + '</div></div>';
        }).join('');
        overlay.innerHTML = html;
    }
    function _refreshGridIfVisible() {
        var overlay = document.getElementById('emp-grid-overlay');
        if (overlay && _layoutMode === 'grid') _renderGrid();
    }

    /* =========================================================================
       [7] LAYOUT TOGGLE — host-only control switching the shared
       broadcast layout between the vertical box (#tk-guestbox-stack,
       owned by app-live-tiktok-patch.js) and the 9-box grid
       (#emp-grid-overlay). #multi-guest-container is NOT part of this
       toggle — it is permanently hidden off-screen in both modes (see
       [9] STYLES); it only ever holds video elements, never renders as
       a guest-box UI. Both the vertical box and the grid stay in the
       DOM at all times; only `display` changes, and never both at once.
       The chosen mode is written to the stream doc so every guest/
       viewer mirrors the host's choice — see [8] SYNC for the read side.
       ========================================================================= */
    var _layoutMode = 'strip'; // data value kept as-is for backward compatibility with already-broadcasting streams' boxLayoutMode field; now means "vertical box" (#tk-guestbox-stack), not the retired on-screen strip
    function _applyLayoutModeToDom() {
        var grid = _ensureGridOverlay();
        // FIX 2026-07-17: #multi-guest-container is no longer toggled here
        // at all — it's permanently hidden off-screen via CSS (see [9]
        // STYLES) in every layout mode, so it can never again render as a
        // second guest-box UI next to #tk-guestbox-stack or the grid (see
        // _ensureGuestContainer()'s fix note for the full root cause).
        // Only #tk-guestbox-stack (vertical box) and #emp-grid-overlay
        // (grid) actually toggle visibility, and never both at once.
        var vbox = document.getElementById('tk-guestbox-stack');
        if (vbox) vbox.style.display = (_layoutMode === 'grid') ? 'none' : 'flex';
        if (grid) grid.style.display = (_layoutMode === 'grid') ? 'grid' : 'none';
        if (_layoutMode === 'grid') _renderGrid();
        var btn = document.getElementById('emp-layout-toggle-btn');
        if (btn) {
            btn.innerHTML = _layoutMode === 'grid' ? '<i class="fas fa-grip-lines"></i>' : '<i class="fas fa-th"></i>';
            btn.title = _layoutMode === 'grid' ? 'Switch to corner boxes' : 'Switch to 9-box grid';
        }
    }
    function _setLayoutMode(mode, fromSync) {
        if (mode !== 'grid' && mode !== 'strip') return;
        if (_layoutMode === mode) { _applyLayoutModeToDom(); return; }
        _layoutMode = mode;
        _applyLayoutModeToDom();
        if (_isHost() && !fromSync) {
            var ref = _streamRef();
            if (ref) ref.update({ boxLayoutMode: mode }).catch(function () {});
        }
    }
    function _injectLayoutToggleButton() {
        var panel = document.getElementById('host-control-panel');
        if (!panel || document.getElementById('emp-layout-toggle-btn') || !_isHost()) return;
        var btn = document.createElement('button');
        btn.id = 'emp-layout-toggle-btn';
        btn.className = 'live-action-btn host-control';
        btn.innerHTML = '<i class="fas fa-th"></i>';
        btn.title = 'Switch to 9-box grid';
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            _setLayoutMode(_layoutMode === 'grid' ? 'strip' : 'grid');
        });
        (document.getElementById('host-control-panel-inner') || panel).appendChild(btn);
    }

    /* =========================================================================
       [8] SYNC — one Firestore listener drives everything: creates/
       removes persistent strip boxes, keeps the grid roster current,
       and mirrors the host's chosen layout mode for every guest/viewer.
       ========================================================================= */
    var _lastKnownGuestIds = [];
    var _lastKnownRequestIds = [];
    var _guestListUnsub = null;
    function _watchGuestList() {
        var ref = _streamRef();
        if (!ref || _guestListUnsub) return;
        _guestListUnsub = ref.onSnapshot(function (doc) {
            var data = (doc && doc.exists && doc.data()) || {};
            var guests = data.guests || [];
            var requests = data.joinRequests || [];
            var guestIds = guests.map(function (g) { return g.userId; });
            var reqIds = requests.map(function (r) { return r.userId; });

            _lastKnownGuests = guests;
            _lastKnownRequests = requests;

            guests.forEach(function (g) {
                _ensureGuestBox(g.userId, g.fullName || g.username || 'Guest', g.avatar || '');
                _removePendingBox(g.userId); // accepted — no longer "pending"
            });
            _lastKnownGuestIds.forEach(function (uid) {
                if (guestIds.indexOf(uid) === -1) {
                    _removeGuestBoxByUid(uid);
                    if (_bigOccupant === uid) { _bigOccupant = 'self'; _anchorSelfIfEmpty(); _refreshActiveHighlight(); }
                }
            });
            _lastKnownGuestIds = guestIds;

            if (_isHost()) {
                requests.forEach(function (r) {
                    _ensurePendingBox(r.userId, r.fullName || r.username || 'Guest', r.avatar || '');
                });
                _lastKnownRequestIds.forEach(function (uid) {
                    if (reqIds.indexOf(uid) === -1) _removePendingBox(uid);
                });
            }
            _lastKnownRequestIds = reqIds;

            // FIX (root cause of "toggle button never appears" -- confirmed
            // live: window._empLiveFinalLoaded === true, #emp-grid-overlay
            // exists, but #emp-layout-toggle-btn does NOT, even minutes into
            // a fully-connected stream): _injectSelfSwapButton() /
            // _injectLayoutToggleButton() were only ever called from _boot(),
            // on fixed one-shot timers (600ms/500ms/400ms after page-ready /
            // init-done / section-change). _isHost() depends on
            // window.liveStreamData.hostUserId, which is populated by its own
            // separate async fetch elsewhere in the codebase and is not
            // guaranteed to have resolved by any of those fixed delays. If
            // _isHost() reads false at every one of those one-shot attempts,
            // the buttons were gated out permanently -- nothing ever retried
            // them again for the rest of the session. This Firestore
            // listener already fires repeatedly, authoritatively, for the
            // entire lifetime of the stream, so re-attempting injection here
            // (both functions already no-op safely once their button exists
            // or the viewer still isn't the host) guarantees the buttons
            // appear the moment host status actually resolves, not just at
            // one lucky boot timing.
            _injectSelfSwapButton();
            _injectLayoutToggleButton();
            _refreshHostControls();
            _refreshSelfSwapVisibility();
            _refreshGridIfVisible();

            // FIX 2026-07-16: #tk-guestbox-stack is created by
            // app-live-tiktok-patch.js on its own timing, which can land
            // AFTER this file's own _boot() already ran _applyLayoutModeToDom()
            // once. Without this, a box created late would default to its
            // own CSS's visible state and stay wrongly shown until the next
            // manual toggle tap. Re-asserting here (this listener already
            // fires repeatedly for the stream's whole lifetime, and the
            // function is idempotent/cheap) guarantees it's always in sync.
            _applyLayoutModeToDom();

            // Non-host viewers/guests mirror the host's chosen layout;
            // the host is the source of truth and never overwritten by
            // its own snapshot echo (fromSync=true skips the re-write).
            if (!_isHost() && typeof data.boxLayoutMode === 'string') {
                _setLayoutMode(data.boxLayoutMode, true);
            }
        }, function () {});
    }

    /* =========================================================================
       [9] STYLES
       ========================================================================= */
    (function injectStyles() {
        if (document.getElementById('emp-live-final-style')) return;
        var css = [
            '.emp-live-box { transition: border-color 0.15s, transform 0.1s; }',
            '.emp-live-box:active { transform: scale(0.95); }',
            // FIX 2026-07-17 ("2 guest screens" — see _ensureGuestContainer()'s
            // own fix note above for the full root-cause writeup): docking
            // this container to a screen edge (previously the left edge,
            // before that the right edge on top of #tk-guestbox-stack) was
            // never going to work — ANY visible position here duplicates
            // #tk-guestbox-stack, which already shows one tile per guest.
            // This container now renders nowhere on screen, in either
            // layout mode. It's kept in the DOM (not display:none) purely
            // so it keeps holding whichever guest/self video elements
            // aren't currently spotlighted — their Agora tracks keep
            // playing, ready for an instant swap to the big screen — with
            // zero footprint or visual presence of its own.
            '#multi-guest-container { position: fixed !important; top: -9999px !important; left: -9999px !important; width: 1px !important; height: 1px !important; min-height: 0 !important; overflow: hidden !important; opacity: 0 !important; pointer-events: none !important; }',

            '#emp-grid-overlay { position: absolute; top: 4px; left: 8px; right: 8px; max-height: 62%; z-index: 15; display: none;',
            '  background: rgba(0,0,0,0.55); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); border-radius: 16px;',
            '  padding: 12px; box-sizing: border-box; overflow-y: auto;',
            '  grid-template-columns: repeat(3, 1fr); grid-auto-rows: min-content; gap: 10px; align-content: start; }',
            '#emp-grid-overlay .emp-grid-title { grid-column: 1 / -1; color: #fff; font-size: 0.8rem; font-weight: 700; text-align: center; margin-bottom: 4px; opacity: 0.85; }',
            '.emp-grid-box { position: relative; border-radius: 14px; overflow: hidden; cursor: pointer; background: rgba(255,255,255,0.06); border: 2px solid rgba(255,255,255,0.15); display: flex; flex-direction: column; align-items: center; justify-content: center; aspect-ratio: 1 / 1; transition: border-color 0.15s, transform 0.1s; }',
            '.emp-grid-box:active { transform: scale(0.95); }',
            '.emp-grid-box.emp-grid-active { border-color: #F5C518; box-shadow: 0 0 0 2px rgba(245,197,24,0.35); }',
            '.emp-grid-box.emp-grid-empty { cursor: default; opacity: 0.4; border-style: dashed; }',
            '.emp-grid-box.emp-grid-pending { border-color: rgba(245,197,24,0.55); border-style: dashed; }',
            '.emp-grid-box img { width: 54%; height: 54%; border-radius: 50%; object-fit: cover; background: #333; margin-bottom: 6px; }',
            '.emp-grid-box .emp-grid-name { position: static; background: none; padding: 0 4px; color: #fff; font-size: 0.66rem; font-weight: 600; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }',
            '.emp-grid-box .emp-grid-tag { position: absolute; top: 4px; left: 4px; background: rgba(245,197,24,0.92); color: #000; font-size: 0.55rem; font-weight: 800; padding: 1px 5px; border-radius: 6px; }',
            '.emp-grid-box .emp-grid-icon { position: absolute; width: 20px; height: 20px; border-radius: 50%; align-items: center; justify-content: center; border: 2px solid #000; z-index: 3; cursor: pointer; font-size: 0.62rem; }',
            '.emp-grid-box .emp-gb-gift.emp-grid-icon { background: rgba(245,197,24,0.95); color:#000; }',
            '.emp-grid-box .emp-gb-remove.emp-grid-icon { background: rgba(225,29,72,0.92); color:#fff; }',
            /* FIX ("mic icon should match the footer mic icon"): swapped the
               flat rgba(20,20,24,0.9) fill for the same dark-glass gradient/
               border/shadow recipe app-patch-v34.js already uses on every
               footer badge (#live-mic-toggle included) and app-patch-v35.js
               reuses at host-panel size for the same two buttons — so every
               mic icon in the app now reads as one visual family. Kept
               circular + 20px here (matching this tile's other action
               icons) rather than the footer's 44px/14px-radius box, per the
               same "match whichever row it's actually part of" principle
               v35 already established for this shared button. */
            '.emp-grid-box .emp-gb-mute.emp-grid-icon {',
            '  background: linear-gradient(145deg, rgba(46,46,52,0.85), rgba(16,16,20,0.92));',
            '  border: 1px solid rgba(255,255,255,0.14);',
            '  box-shadow: 0 2px 6px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08);',
            '  color:#fff;',
            '}',
            '.emp-grid-box .emp-gb-mute.emp-grid-icon.emp-grid-muted { background: linear-gradient(145deg, rgba(225,29,72,0.92), rgba(160,15,50,0.92)); border-color: rgba(255,255,255,0.14); color:#fff; }',
            '.emp-grid-box .emp-grid-pending-tag { position: absolute; bottom: 4px; left: 4px; right: 4px; text-align: center; background: rgba(245,197,24,0.92); color:#000; font-size:0.55rem; font-weight:800; padding: 1px 4px; border-radius: 6px; }',
            /* FIX ("coin icon blocking the name" / "expand icon blocking the
               face"): both used to sit dead-center (bottom-center / top-
               center) directly over the avatar/name. _renderGrid() now sets
               top/left inline per-tile so this badge sits in a true corner,
               stacking under the YOU/HOST tag when both are present on the
               same tile instead of overlapping it — mirroring the vertical
               guest strip's own top-left coin badge, which never had this
               problem. This class only supplies the look now. */
            '.emp-grid-box .emp-grid-coin { position: absolute; background: rgba(0,0,0,0.72); color: #F5C518; font-size: 0.5rem; font-weight: 800; padding: 1px 5px; border-radius: 8px; z-index: 3; white-space: nowrap; }',
            '#emp-layout-toggle-btn.host-control { }'
        ].join('\n');
        var s = document.createElement('style');
        s.id = 'emp-live-final-style';
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
    })();

    /* =========================================================================
       [10] BOOT
       ========================================================================= */
    function _boot() {
        _watchGuestList();
        _injectSelfSwapButton();
        _injectLayoutToggleButton();
        _refreshSelfSwapVisibility();
        _anchorSelfIfEmpty();
        _applyLayoutModeToDom();
    }
    // Safety net for the same race described at the _watchGuestList()
    // snapshot handler above: keeps retrying in case _streamRef() itself
    // isn't ready yet (window.fbDb / streamId not set at boot time), so the
    // Firestore listener hasn't even attached to catch the later retry.
    // Both injector calls are no-ops once their button exists or the
    // viewer isn't the host, so this is safe to run indefinitely.
    setInterval(function () {
        _watchGuestList();
        _injectSelfSwapButton();
        _injectLayoutToggleButton();
    }, 1500);
    _ready(function () { setTimeout(_boot, 600); });
    document.addEventListener('empyrean-init-done', function () { setTimeout(_boot, 500); });
    document.addEventListener('empyrean-section-change', function (ev) {
        if (ev && ev.detail && ev.detail.section === 'live-stream-screen') setTimeout(_boot, 400);
    });
    document.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('#go-live-btn, .join-live-btn')) {
            _bigOccupant = 'self';
            _layoutMode = 'strip';
        }
    });

    console.log('[EmpyreanLiveFinal] \u2705 Persistent strip boxes + restored 9-box grid, host layout toggle, explicit spotlight buttons, and guest self camera/mic controls — all self-contained in one file, sharing one set of accept/decline/remove/mute/gift handlers.');

})();