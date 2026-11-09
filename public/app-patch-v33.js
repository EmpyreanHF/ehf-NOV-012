/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v33
   app-patch-v33.js  |  Load LAST (after app-live-tiktok-patch.js AND the
   edited app-live-final.js from this same session)

   FEATURE — CO-HOST / MODERATOR ROLE FOR LIVE STREAMS

   REQUESTED: let the host grant trusted accepted guests a "co-host" /
   moderator status so they can help moderate the stream — specifically,
   accept/decline join requests and mute guests — without needing to be
   the stream's actual owner.

   ═══════════════════════════════════════════════════════════════════════
   WHY THIS CAN'T BE A PURE "NEW FILE, NO EDITS" PATCH
   ═══════════════════════════════════════════════════════════════════════
   acceptGuest() / rejectGuest() / toggleGuestMute() (app-live-tiktok-
   patch.js) and _acceptPending() / _declinePending() / _removeGuest() /
   _toggleMute() (app-live-final.js) are private functions inside those
   files' own closures, and every one of them starts with a hard
   `if (!isHost()) return;` gate. A new file cannot reach into another
   file's closure and flip that check from outside — the only way to grant
   a non-host user through it is to either (a) edit the gate itself, or
   (b) reimplement the entire accept/decline/mute flow a second time in
   parallel. (b) is exactly the "another layer racing the other ones"
   trap this codebase has already burned time on (see app-patch-v28.js's
   own header, referenced again in app-patch-v31.js). So this session
   made the minimal (a) edits — swapping `isHost()` for
   `isHost() || isModerator()` at ONLY the accept/decline/mute gates, in
   both files — and everything else (the actual moderator data model, the
   grant/revoke UI, the permission cache) lives here, in this new file,
   where it belongs.

   Left deliberately untouched (still real-host-only, both at their gate
   AND at whatever icon/button would trigger them):
     - endLiveStreamHandler() — ending the stream is an ownership action,
       not a moderation action.
     - _selectSpotlight() / the "expand to big screen" icon — a moderator
       was never asked to control what appears on the host's own screen.
     - sendQuickRose()'s self-gift block — unrelated to moderation.
     - Minting/revoking OTHER moderators (window._empToggleModerator
       itself, below) — a moderator cannot promote a third person; only
       the real host can, so co-host status can't cascade past one hop.

   ═══════════════════════════════════════════════════════════════════════
   DATA MODEL
   ═══════════════════════════════════════════════════════════════════════
   No new Firestore collection and no rule changes needed. Each accepted
   guest is already an object inside active_streams/{streamId}'s `guests`
   array (userId, username, fullName, avatar, hostMuted — see
   app-live-tiktok-patch.js). This adds one more field to that same
   object: `isModerator: true`. Firestore's existing rule for this
   collection is `allow update: if request.auth != null;` (see
   firebase-rules.js) — already fully open to any authenticated user for
   this whole document, the same tradeoff already accepted and documented
   there for /messages, /chats, and /active_streams' other fields. This
   patch does not widen that; it uses the access that already exists.
   Enforcement of WHO gets to flip the flag is therefore client-side only
   (host-gated in _empToggleModerator below), consistent with how every
   other host-only action in this app already works (isHost() itself is
   just a client-side field comparison, not a security boundary — the
   security boundary for this whole feature area is "don't ship a public
   admin API," same as it's always been here).

   ═══════════════════════════════════════════════════════════════════════
   WHAT A MODERATOR CAN / CANNOT DO (enforced at the edited gates)
   ═══════════════════════════════════════════════════════════════════════
   CAN:  see the join-request bell + list, accept a join request, decline
         a join request, remove an accepted guest, mute/unmute a guest —
         from either the vertical guest-box stack OR the participants
         grid, whichever is on screen.
   CANNOT: end the live stream, spotlight/swap the big screen, promote or
         demote another moderator, or anything not explicitly listed
         above. Every one of those keeps its original host-only gate,
         untouched by this patch.
   ============================================================================= */

(function empyreanPatchV33() {
    'use strict';

    if (window._empPatchV33Loaded) {
        console.warn('[V33] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV33Loaded = true;

    function log(msg) { console.log('[V33] ' + msg); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

    function myId() { return window.userState && window.userState.id; }

    // Same host check every other file in this feature area already uses
    // (hostUserId falling back to hostId — see app-live-tiktok-patch.js /
    // app-live-final.js's own copies and comments for why both fields are
    // checked). Only the REAL host may grant/revoke co-host status.
    function isRealHost() {
        if (window.isGuest || !window.userState || !window.liveStreamData) return false;
        var sd = window.liveStreamData;
        var hid = sd.hostUserId || sd.hostId;
        return !!hid && window.userState.id === hid;
    }

    function currentStreamId() { return window.liveStreamData && window.liveStreamData.streamId; }
    function streamDocRef() {
        var db = window.fbDb, sid = currentStreamId();
        if (!db || !sid || !window._firebaseLoaded) return null;
        return db.collection('active_streams').doc(sid);
    }
    function fieldValue() {
        return (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
    }

    /* =========================================================================
       §1 — moderator-status cache. A SEPARATE, read-only onSnapshot listener
       scoped to just this one concern (deliberately not reusing
       app-live-tiktok-patch.js's own stream listener, which is private to
       that file's closure and already has plenty of responsibilities of
       its own) — this is the single source of truth every isHost()-gated
       check across both edited files now calls through.
       ========================================================================= */
    var _moderatorUids = {}; // userId -> true, for the CURRENT stream only
    var _cacheStreamId = null;
    var _wasModeratorMe = false; // tracks MY OWN previous status, to notify only on actual change
    var _modUnsub = null;

    function _resetCacheIfNewStream() {
        var sid = currentStreamId();
        if (sid !== _cacheStreamId) {
            _cacheStreamId = sid;
            _moderatorUids = {};
            _wasModeratorMe = false;
        }
    }

    window._empIsModerator = function () {
        var id = myId();
        return !!(id && _moderatorUids[id]);
    };
    window._empGuestIsModerator = function (uid) {
        return !!(uid && _moderatorUids[uid]);
    };

    function _attachModeratorListener() {
        _detachModeratorListener();
        var ref = streamDocRef();
        if (!ref) return;
        _resetCacheIfNewStream();
        _modUnsub = ref.onSnapshot(function (doc) {
            if (!doc.exists) return;
            var data = doc.data() || {};
            var guests = data.guests || [];
            var fresh = {};
            guests.forEach(function (g) { if (g.userId && g.isModerator) fresh[g.userId] = true; });
            _moderatorUids = fresh;

            var amModNow = window._empIsModerator();
            if (amModNow !== _wasModeratorMe) {
                if (amModNow) notify('👑 You were made a co-host — you can now accept/decline join requests and mute guests.', 'success');
                else if (_wasModeratorMe) notify('Your co-host status was removed.', 'info');
                _wasModeratorMe = amModNow;
            }
        }, function (err) {
            console.warn('[V33] moderator listener error:', err.message);
        });
    }
    function _detachModeratorListener() {
        if (_modUnsub) { _modUnsub(); _modUnsub = null; }
    }

    /* =========================================================================
       §2 — grant/revoke. Host-only, mirrors the exact read-modify-write
       pattern toggleGuestMute() (app-live-tiktok-patch.js) already uses for
       the same `guests` array, so this composes with concurrent edits the
       same way that function already does (no new conflict surface).
       ========================================================================= */
    window._empToggleModerator = async function (uid, makeModerator) {
        if (!isRealHost()) { log('blocked — only the real host can grant/revoke co-host status.'); return; }
        var ref = streamDocRef();
        var FV = fieldValue();
        if (!ref || !FV) return;
        try {
            var data = (await ref.get()).data() || {};
            var guests = data.guests || [];
            var idx = guests.findIndex(function (g) { return g.userId === uid; });
            if (idx === -1) { notify('That guest is no longer in the stream.', 'warning'); return; }
            var updated = guests.slice();
            updated[idx] = Object.assign({}, updated[idx], { isModerator: !!makeModerator });
            await ref.update({ guests: updated });
            var name = updated[idx].fullName || updated[idx].username || 'Guest';
            notify(makeModerator ? (name + ' is now a co-host.') : (name + ' is no longer a co-host.'), 'info');
        } catch (err) {
            notify('Could not update co-host status: ' + (err && err.message ? err.message : 'connection issue, try again.'), 'error');
        }
    };

    /* =========================================================================
       §3 — wiring: attach/detach alongside the live modal, same trigger
       app-live-tiktok-patch.js's own onLiveModalToggle() uses, observed
       independently here rather than requiring an edit to that function.
       ========================================================================= */
    function onModalToggle() {
        var modal = document.getElementById('go-live-modal-overlay');
        if (!modal) return;
        if (modal.classList.contains('show')) {
            _attachModeratorListener();
        } else {
            _detachModeratorListener();
            _moderatorUids = {};
            _cacheStreamId = null;
            _wasModeratorMe = false;
        }
    }

    ready(function () {
        var modal = document.getElementById('go-live-modal-overlay');
        if (modal) {
            new MutationObserver(onModalToggle).observe(modal, { attributes: true, attributeFilter: ['class'] });
            if (modal.classList.contains('show')) onModalToggle();
        }
    });

    console.log('[EmpyreanPatchV33] ✅ Co-host/moderator role added — host can grant an accepted guest permission to accept/decline join requests and mute guests (crown icon on their guest-box tile), independent of app-live-tiktok-patch.js and app-live-final.js\'s own accept/decline/mute logic, which those two files\' isHost() gates now also check.');

})();