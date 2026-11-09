/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v37
   app-patch-v37.js  |  Load LAST (after app-patch-v36.js AND the edited
   app-live-tiktok-patch.js from this same session)

   FEATURE — GUEST BROADCASTER CAMERA SWITCH (FRONT / BACK)

   REQUESTED: guest broadcasters could not switch between front and back
   camera while live. Confirmed by search across every live-streaming
   file (app-live.js, app-live-tiktok-patch.js, app-live-final.js,
   app-fixes.js) — there is no facingMode toggle, no switch-camera
   button, and no handler for one anywhere in the app, for host or
   guest. This isn't a regression; it was never built. Scoped to
   GUEST BROADCASTERS ONLY, per this session's own request — the host's
   camera is untouched by this patch.

   ═══════════════════════════════════════════════════════════════════════
   WHY THIS NEEDED (a small) EDIT TO app-live-tiktok-patch.js
   ═══════════════════════════════════════════════════════════════════════
   The guest's live Agora client (_guestClient) and its currently-
   published video track (_guestTracks.video) are private to that file's
   own closure — the same constraint app-patch-v33.js's and
   app-patch-v35.js's own headers already ran into for their features.
   Reimplementing a second, parallel guest-broadcast connection here
   just to reach them would be exactly the "another layer racing the
   other ones" trap this codebase has already burned time on (see
   app-patch-v28.js's header, referenced again in v31/v33/v35). So, like
   those patches, the minimal necessary exposure was added directly in
   app-live-tiktok-patch.js: a getter for _guestClient, a setter for
   _guestTracks.video, and a read-only "is this an accepted guest
   broadcaster, not the host" check — three lines, nothing else in that
   closure touched. See that file's own diff/comment for the exact spot.

   ═══════════════════════════════════════════════════════════════════════
   WHAT THIS DOES
   ═══════════════════════════════════════════════════════════════════════
   Adds one button (flip-camera icon) into `.live-footer`, visible only
   while window._empIsGuestBroadcaster() is true (accepted guest,
   currently broadcasting, not the host) — polled the same way
   app-live-final.js's own _watchGuestSelfState already polls guest
   state (800ms interval; this codebase's established pattern for
   "state that can't be reached via a single reliable DOM event").

   Tapping it:
     1. Reads the CURRENT published video track via
        window._empGuestVideoTrack() (already exposed) and the live
        client via the new window._empGetGuestClient().
     2. Acquires a fresh camera track with the OPPOSITE facingMode via
        AgoraRTC.createCameraVideoTrack({ facingMode }) — same call
        app-live-tiktok-patch.js's own promoteToGuestBroadcaster()/
        camera-recovery handler already use, so this doesn't introduce
        a second, different way of acquiring a camera track.
     3. Publishes the new track BEFORE unpublishing/closing the old one
        (avoids a one-frame gap where nothing is published — mirrors
        how Agora's own docs recommend a track swap), then unpublishes
        and closes the old track.
     4. Carries over the guest's existing camera-on/off state onto the
        new track via setEnabled(), so switching cameras while the
        guest had their camera off doesn't silently turn it back on.
     5. Writes the new track back via window._empSetGuestVideoTrack()
        so every existing consumer of the "current guest video track"
        (the mic/cam footer icons, app-live-final.js's self-preview
        watcher) picks it up automatically — no separate notification
        needed, since those already re-check that value on their own
        existing polling/tap paths.

   Left deliberately untouched: the host's own camera (no switch button
   added to the host control panel — this session asked for guest-only),
   the mic track, and every other guest control (mute, exit, gift, etc.).
   ============================================================================= */

(function empyreanPatchV37() {
    'use strict';

    if (window._empPatchV37Loaded) {
        console.warn('[V37] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV37Loaded = true;

    function log(msg) { console.log('[V37] ' + msg); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }

    var BTN_ID = 'live-camera-switch-btn';
    var _facingMode = 'user'; // tracks what the guest is CURRENTLY on, starts matching promoteToGuestBroadcaster()'s own default
    var _switching = false;   // re-entrancy guard — ignore a second tap while a switch is already in flight

    function _isPermDenied(err) {
        var s = ((err && (err.code || '')) + ' ' + (err && err.message || '')).toLowerCase();
        return s.indexOf('permission_denied') !== -1 ||
            s.indexOf('notallowederror') !== -1 ||
            s.indexOf('permission denied') !== -1 ||
            s.indexOf('securityerror') !== -1;
    }

    /* =========================================================================
       §1 — inject the button's CSS once. Matches the existing 44px
       dark-glass footer-badge family (app-patch-v34.js) so this reads as
       one more member of that same row, not a new style — but scoped to
       its own id only, so it can never affect any of v34's existing
       selectors or vice versa.
       ========================================================================= */
    (function injectCSS() {
        if (document.getElementById('pv37-camera-switch-css')) return;
        var css = document.createElement('style');
        css.id = 'pv37-camera-switch-css';
        css.textContent =
            '#' + BTN_ID + ' {' +
            '  width: 44px; height: 44px; border-radius: 14px;' +
            '  background: linear-gradient(145deg, rgba(46,46,52,0.62), rgba(16,16,20,0.78));' +
            '  border: 1px solid rgba(255,255,255,0.10);' +
            '  box-shadow: 0 3px 10px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08);' +
            '  display: flex; align-items: center; justify-content: center;' +
            '  flex-shrink: 0; position: relative; cursor: pointer;' +
            '  color: #fff; font-size: 17px;' +
            '}' +
            '#' + BTN_ID + ':active { transform: scale(0.90); }' +
            '#' + BTN_ID + '.pv37-busy { opacity: 0.5; pointer-events: none; }' +
            /* Same -4px hit-slop convention as v34's footer row, sized to
               match so this button's tap margin behaves identically to
               its neighbors and can't overlap them (v34's own gap width
               already accounts for a slop this size across the row). */
            '#' + BTN_ID + '::after { content: ""; position: absolute; inset: -4px; }';
        document.head.appendChild(css);
    })();

    /* =========================================================================
       §2 — show/hide the button alongside guest-broadcast state. Polled
       rather than event-driven for the same reason app-live-final.js's
       _watchGuestSelfState is polled: there is no single reliable DOM
       event that fires exactly when a guest becomes/stops being an
       accepted broadcaster across every path that can cause it (accept,
       host removal, self-exit, stream end).
       ========================================================================= */
    function _ensureButton() {
        var footer = document.querySelector('.live-footer');
        if (!footer) return null;
        var btn = document.getElementById(BTN_ID);
        if (btn) return btn;
        btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.type = 'button';
        btn.title = 'Switch camera';
        btn.innerHTML = '<i class="fas fa-sync-alt"></i>';
        // Placed right after the camera toggle so it reads as "camera,
        // then camera options" — falls back to appending if that button
        // isn't in the footer yet at this exact poll tick.
        var camBtn = document.getElementById('live-video-toggle');
        if (camBtn && camBtn.parentElement === footer && camBtn.nextSibling) {
            footer.insertBefore(btn, camBtn.nextSibling);
        } else if (camBtn && camBtn.parentElement === footer) {
            footer.appendChild(btn);
        } else {
            footer.appendChild(btn);
        }
        return btn;
    }
    function _removeButton() {
        var btn = document.getElementById(BTN_ID);
        if (btn) btn.remove();
    }
    function _watchGuestBroadcasterState() {
        var isBroadcaster = typeof window._empIsGuestBroadcaster === 'function' && window._empIsGuestBroadcaster();
        if (isBroadcaster) _ensureButton();
        else _removeButton();
    }
    setInterval(_watchGuestBroadcasterState, 800);
    document.addEventListener('empyrean-init-done', function () { setTimeout(_watchGuestBroadcasterState, 500); });

    /* =========================================================================
       §3 — the actual switch: publish-before-unpublish track swap.
       ========================================================================= */
    async function _switchCamera() {
        if (_switching) return;
        if (typeof AgoraRTC === 'undefined' || !window._agoraAvailable) {
            notify('Camera switch needs the Agora SDK, which isn\u2019t available right now.', 'warning');
            return;
        }
        var client = typeof window._empGetGuestClient === 'function' ? window._empGetGuestClient() : null;
        if (!client) {
            notify('You\u2019re not currently broadcasting, so there\u2019s no camera to switch.', 'warning');
            return;
        }
        var oldTrack = typeof window._empGuestVideoTrack === 'function' ? window._empGuestVideoTrack() : null;
        var wasEnabled = !oldTrack || oldTrack.enabled !== false; // preserve on/off across the switch
        var nextFacing = _facingMode === 'user' ? 'environment' : 'user';

        _switching = true;
        var btn = document.getElementById(BTN_ID);
        if (btn) btn.classList.add('pv37-busy');

        try {
            var newTrack = await AgoraRTC.createCameraVideoTrack({ facingMode: nextFacing });
            if (!wasEnabled) { try { await newTrack.setEnabled(false); } catch (eDisable) {} }

            // Publish the replacement first so there's no gap where this
            // device is publishing zero video tracks.
            await client.publish([newTrack]);

            if (oldTrack) {
                try { await client.unpublish([oldTrack]); } catch (eUnpub) {}
                try { oldTrack.stop(); oldTrack.close(); } catch (eClose) {}
            }

            _facingMode = nextFacing;
            if (typeof window._empSetGuestVideoTrack === 'function') window._empSetGuestVideoTrack(newTrack);
            log('switched guest camera to facingMode=' + nextFacing);
            notify(nextFacing === 'environment' ? '\uD83D\uDCF7 Switched to back camera.' : '\uD83E\uDD33 Switched to front camera.', 'success');
        } catch (err) {
            if (_isPermDenied(err)) {
                notify('Camera permission is blocked for this app — allow camera access in your browser/device settings, then try switching again.', 'error');
            } else {
                notify('Could not switch camera: ' + (err && err.message ? err.message : 'device may not have a second camera.'), 'error');
            }
        } finally {
            _switching = false;
            if (btn) btn.classList.remove('pv37-busy');
        }
    }

    document.addEventListener('click', function (e) {
        if (!e.target.closest) return;
        var btn = e.target.closest('#' + BTN_ID);
        if (!btn) return;
        e.preventDefault();
        _switchCamera();
    });

    console.log('[EmpyreanPatchV37] \u2705 Guest broadcasters now have a front/back camera-switch button in the live footer (host camera untouched, guest-only per this session\u2019s request). Uses a publish-before-unpublish track swap so there\u2019s no gap in the guest\u2019s published video.');

})();