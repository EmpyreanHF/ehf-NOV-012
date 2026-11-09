/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v10 (rev. 2 — fixes "chat stopped
   cross-populating between host/guests")
   app-patch-v10.js  |  Load AFTER app-patch-v9.js

   This is a DROP-IN REPLACEMENT for the existing app-patch-v10.js — same
   filename, same load position. §A1/§A1b/§B/§C are unchanged from the
   original file (still correct, still doing their jobs). Only §A2 (the
   RECEIVE side) is corrected below; the bug was never in broadcasting a
   message out, it was in a specific case of re-subscribing to receive them.

   ═══════════════════════════════════════════════════════════════════════
   ROOT CAUSE OF "CHAT STOPPED CROSS-POPULATING" (confirmed by reading the
   actual attach/detach logic, not guessed):
   ═══════════════════════════════════════════════════════════════════════
   The original §A2 receive listener used a boolean flag,
   `_pv10FeedFirstSnapshot`, to skip the pre-existing backlog of messages
   the instant it (re)attaches to `active_streams/{id}/liveFeed` — so a
   device joining mid-stream doesn't get the whole chat history replayed
   at once. That part is correct in isolation.

   The bug is in WHEN it resets. The file's own boot loop re-evaluates
   every second:

       setInterval(function () {
           if (currentStreamId() && isLiveScreenOpen()) {
               attachFeedListener();
           } else {
               detachFeedListener();
           }
       }, 1000);

   `isLiveScreenOpen()` is just `#go-live-modal-overlay` having the `.show`
   class. Anything that toggles that class off even momentarily for the
   SAME still-active stream (a modal re-render, a brief transition state,
   any of several sub-modals opening on top of it) makes this loop call
   `detachFeedListener()` — which tears the Firestore listener down — and
   then `attachFeedListener()` again shortly after, which sets
   `_pv10FeedFirstSnapshot = true` again. The very next snapshot after
   that reattach — which now includes any GENUINE new message that
   arrived during the gap — gets treated as "the pre-existing backlog"
   and is silently dropped, every single time this happens. Nothing
   after that point looked broken (the listener is live again and will
   correctly render the NEXT new message) — so this reads exactly like
   "chat stopped working," intermittently, rather than a clean full
   failure, because each dropped message is invisible and each
   subsequent one behaves normally.

   FIX: replace the boolean "first snapshot" flag with a per-stream
   watermark timestamp, captured ONCE the first time this device ever
   attaches to a given streamId — not reset by a detach/reattach cycle
   for that same stream, only reset when the streamId itself actually
   changes (a genuinely new/different stream). Every incoming doc is
   compared against that watermark instead of against "is this the first
   snapshot since the last attach" — so a transient detach/reattach can
   at worst introduce a brief listening GAP (a message sent in the exact
   split-second the listener was detached could still be missed — an
   unavoidable consequence of tearing down the listener at all, not of
   this fix), but can never again cause an indefinite "look, it just
   stopped" symptom, because the cutoff itself no longer moves forward
   every time the modal flickers.

   SECONDARY FIX: `broadcastFeedEvent()`'s failure path only ever
   console.warn'd on a permission-denied write — invisible to anyone not
   watching devtools, and indistinguishable from "the feature doesn't
   exist" to an actual tester. It now also surfaces ONE user-facing
   notification per stream (not per message, so a bad connection can't
   spam it) so a real permission gap on `active_streams/{id}/liveFeed`
   (see the original file's own note: this needs a firestore.rules entry
   allowing authenticated participants to create() documents there) is
   visible to whoever is testing, instead of looking identical to this
   bug from the outside.

   ═══════════════════════════════════════════════════════════════════════
   §E (2026-07-16 addition) — kill the recurring FALSE "host has ended
   the live stream" / "This live stream has ended" indicator that a
   viewer sees, on repeat, while the live screen is still open and the
   stream is genuinely still on the air
   ═══════════════════════════════════════════════════════════════════════
   ROOT CAUSE (confirmed by reading app-live.js, not guessed): every
   "is this stream still live" freshness check in that file —
   _isStreamFresh() (dashboard listener) and the user-left grace-period
   check — decides staleness by comparing THIS device's Date.now() against
   a lastHeartbeat ISO string that was written by the HOST's device.
   That's an implicit assumption that every device's clock agrees with
   every other device's clock, which mobile devices routinely don't
   (a phone with no NTP sync, one that just came off airplane mode, a
   wrong timezone/date setting — all common in the field). If a host's
   clock is even a few minutes off from a viewer's, the viewer's freshness
   check reads a perfectly live stream as stale — repeatedly, every time
   a new heartbeat/snapshot is evaluated, for as long as the skew exists.
   That's exactly the reported symptom: it keeps reappearing, and it
   doesn't go away on its own because the skew doesn't go away on its own.
   A fixed grace-period widening (already tried — see app-live.js's own
   HEARTBEAT_STALE_MS history and the 6s user-left grace window) can
   soften this but can never fully close it, because a large enough clock
   skew defeats any fixed threshold.

   FIX (root-cause-agnostic, since a clock on another device can't be
   corrected from here, and per explicit instruction to just stop this
   indicator from appearing): this device's OWN live screen being open
   for a given streamId IS local ground truth that the session is still
   active — a genuine end already tears that screen down as part of the
   very same teardown that fires the notification (stopAgoraViewer() /
   the End Live flow), so an "ended" notice for a streamId whose screen
   is still open on THIS device can only be a false alarm. This wraps
   window.showNotification (additive — the same wrap-not-replace pattern
   already used for openGiftCatalog in v29 and openHostPreviewModal in
   v32) and silently drops exactly those two known message strings
   whenever that's the case. Every other notification — including a
   genuine end shown to a viewer who has already navigated away from the
   live screen — is completely untouched and still shows normally.
   Nothing in app-live.js is edited; the wrap only observes calls already
   being made to a function every other file already treats as public API.
   ============================================================================= */

(function empyreanPatchV10() {
    'use strict';

    function onReady(fn) {
        if (document.readyState !== 'loading') fn();
        else document.addEventListener('DOMContentLoaded', fn);
    }

    function notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    }

    function myId() {
        return window.userState && window.userState.id;
    }

    function currentStreamId() {
        return window.liveStreamData && window.liveStreamData.streamId;
    }

    function liveFeedRef() {
        var db = window.fbDb;
        var sid = currentStreamId();
        if (!db || !sid || !window._firebaseLoaded) return null;
        return db.collection('active_streams').doc(sid).collection('liveFeed');
    }

    function fieldValue() {
        return (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
    }

    /* ═══════════════════════════════════════════════════════════════
       §A1 — Broadcast: wrap the two existing local-render functions
       (UNCHANGED from the original file)
       ═══════════════════════════════════════════════════════════════ */
    var _origCreateLiveComment = null;
    var _origCreateLiveGiftComment = null;

    // rev.2: one user-facing permission-denied notice per stream, not per
    // message — see SECONDARY FIX above.
    var _pv10PermissionWarnedForStream = null;

    function broadcastFeedEvent(payload) {
        var ref = liveFeedRef();
        if (!ref) {
            console.warn('[PV10-Feed] broadcast SKIPPED — no Firestore ref (firebaseLoaded=' +
                !!window._firebaseLoaded + ', fbDb=' + !!window.fbDb + ', streamId=' + currentStreamId() + ')');
            return;
        }
        var FV = fieldValue();
        var doc = Object.assign({
            senderId: myId() || null,
            createdAt: FV ? FV.serverTimestamp() : new Date().toISOString()
        }, payload);
        ref.add(doc).then(function () {
            console.log('[PV10-Feed] broadcast OK:', payload.type, payload.text || payload.giftName || '');
        }).catch(function (err) {
            console.warn('[PV10-Feed] broadcast FAILED (likely a firestore.rules denial):', err && err.message);
            var sid = currentStreamId();
            var isPermission = err && (err.code === 'permission-denied' || /insufficient permissions/i.test(err.message || ''));
            if (isPermission && _pv10PermissionWarnedForStream !== sid) {
                _pv10PermissionWarnedForStream = sid;
                notify('Chat isn\u2019t syncing to other viewers right now (server permissions) — you\u2019ll still see your own messages.', 'warning');
            }
        });
    }

    function wireCommentBroadcast() {
        if (window._pv10CommentWired) return;
        if (typeof window.createLiveComment !== 'function' || typeof window.createLiveGiftComment !== 'function') return;
        _origCreateLiveComment = window.createLiveComment;
        _origCreateLiveGiftComment = window.createLiveGiftComment;
        window._pv10CommentWired = true;
        console.log('[PatchV10] comment/gift render functions captured for remote playback.');
    }

    /* ═══════════════════════════════════════════════════════════════
       §A1b — Broadcast via DOM observation (UNCHANGED from the
       original file — this is the part that actually works, watching
       #live-comments-list for any newly-added .live-comment element
       regardless of which code path created it)
       ═══════════════════════════════════════════════════════════════ */
    function extractFeedEventFromElement(el) {
        if (!el || !el.classList || !el.classList.contains('live-comment')) return null;
        var isGift = el.classList.contains('tk-gift-comment');
        var strongEl = el.querySelector('.live-comment-body strong');
        var username = strongEl ? strongEl.textContent : 'Someone';
        var avatarImg = el.querySelector('.live-comment-avatar');
        var avatarUrl = avatarImg ? avatarImg.getAttribute('src') : '';
        if (isGift) {
            var emojiEl = el.querySelector('.tk-gift-emoji');
            return {
                type: 'gift',
                username: username,
                avatarUrl: avatarUrl,
                giftSymbol: emojiEl ? emojiEl.innerHTML : '\ud83c\udf81',
                giftName: el.dataset.giftName || ''
            };
        }
        var pEl = el.querySelector('.live-comment-body p');
        return {
            type: 'comment',
            username: username,
            avatarUrl: avatarUrl,
            text: pEl ? pEl.textContent : ''
        };
    }

    function attachCommentsDomObserver() {
        var list = document.getElementById('live-comments-list');
        if (!list || list._pv10Observed) return;
        list._pv10Observed = true;
        new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                    if (!node || node.nodeType !== 1) return;
                    if (node.dataset && node.dataset.pv10Remote === '1') return;
                    var evt = extractFeedEventFromElement(node);
                    if (evt) broadcastFeedEvent(evt);
                });
            });
        }).observe(list, { childList: true });
        console.log('[PV10-Feed] DOM observer attached to #live-comments-list.');
    }

    /* ═══════════════════════════════════════════════════════════════
       §A2 — Receive: REV.2 — watermark replaces the boolean
       "first snapshot" flag; see ROOT CAUSE writeup above.
       ═══════════════════════════════════════════════════════════════ */
    var _pv10FeedUnsub = null;
    var _pv10FeedStreamId = null;
    // streamId -> ms-since-epoch watermark. Only ever set the FIRST time
    // a given streamId is attached this pageload; a later detach/reattach
    // for the SAME streamId reuses the existing watermark instead of
    // moving it forward, which is the actual fix.
    var _pv10Watermarks = {};

    function toMillis(ts) {
        if (!ts) return 0;
        if (typeof ts.toMillis === 'function') return ts.toMillis();
        if (ts instanceof Date) return ts.getTime();
        var parsed = Date.parse(ts);
        return isNaN(parsed) ? 0 : parsed;
    }

    function renderRemoteFeedEvent(data) {
        if (!data) return;
        var list = document.getElementById('live-comments-list');
        if (data.type === 'gift') {
            if (typeof _origCreateLiveGiftComment === 'function') {
                _origCreateLiveGiftComment(data.username || 'Someone', data.avatarUrl || '', data.giftSymbol || '\ud83c\udf81', data.giftName || 'Gift', data.senderId || null);
                if (list && list.firstElementChild) list.firstElementChild.dataset.pv10Remote = '1';
            }
        } else {
            if (typeof _origCreateLiveComment === 'function') {
                _origCreateLiveComment(data.username || 'Someone', data.text || '', undefined, data.avatarUrl || '');
                if (list && list.firstElementChild) list.firstElementChild.dataset.pv10Remote = '1';
            }
        }
    }

    function attachFeedListener() {
        var sid = currentStreamId();
        if (!sid) { detachFeedListener(); return; }
        if (_pv10FeedUnsub && _pv10FeedStreamId === sid) return; // already listening to this stream, nothing to do

        // A genuinely different (or first-ever) stream: reset the
        // watermark. A reattach to the SAME stream (the bug case) is
        // handled by simply not resetting anything below.
        if (_pv10FeedStreamId !== sid) {
            _pv10Watermarks[sid] = _pv10Watermarks[sid] || Date.now();
        }

        detachFeedListener();

        var ref = liveFeedRef();
        if (!ref) {
            console.warn('[PV10-Feed] listener SKIPPED — no Firestore ref (firebaseLoaded=' +
                !!window._firebaseLoaded + ', fbDb=' + !!window.fbDb + ', streamId=' + sid + ')');
            return;
        }

        _pv10FeedStreamId = sid;
        var watermark = _pv10Watermarks[sid];
        console.log('[PV10-Feed] listener attached for stream:', sid, '| watermark:', new Date(watermark).toISOString());

        _pv10FeedUnsub = ref.orderBy('createdAt').onSnapshot(function (snapshot) {
            snapshot.docChanges().forEach(function (change) {
                if (change.type !== 'added') return;
                var data = change.doc.data() || {};
                if (data.senderId && data.senderId === myId()) {
                    return; // this device already rendered its own send locally
                }
                // rev.2: compare against the per-stream watermark instead
                // of "is this the first snapshot since the last attach" —
                // this is what stops a transient detach/reattach from
                // dropping a genuinely new message. Docs written with a
                // pending server timestamp (createdAt still null at the
                // moment of this snapshot) are always treated as new,
                // since they can only be a just-sent message, never
                // pre-existing backlog.
                var ts = toMillis(data.createdAt);
                if (ts && ts < watermark) return; // pre-existing backlog — skip
                console.log('[PV10-Feed] rendering remote event:', data.type, 'from', data.senderId);
                renderRemoteFeedEvent(data);
            });
        }, function (err) {
            console.warn('[PV10-Feed] listener error:', err && err.message);
        });
    }

    function detachFeedListener() {
        if (_pv10FeedUnsub) { _pv10FeedUnsub(); _pv10FeedUnsub = null; }
        _pv10FeedStreamId = null;
        // NOTE: _pv10Watermarks is intentionally NOT cleared here — that
        // is the actual fix. It's keyed by streamId, so it naturally stays
        // correct across any number of detach/reattach cycles for the
        // same stream, and simply accumulates one small timestamp entry
        // per distinct stream this device has watched this pageload.
    }

    function isLiveScreenOpen() {
        var overlay = document.getElementById('go-live-modal-overlay');
        return !!(overlay && overlay.classList.contains('show'));
    }

    // FIX (bug: "messages appear 2 times in the live streaming section"):
    // this file's §A1b/§A2 was a SECOND, entirely separate chat-sync
    // pipeline layered on top of the one that already works correctly —
    // app-fixes.js's live-comment-form handler writes each message to
    // the `live_comments` collection, and app-live-tiktok-patch.js's
    // attachChatListener() reads it back and renders it via
    // window.createLiveComment(), with a proper per-messageId dedupe
    // (window._liveSeenCommentIds) so a sender never sees their own
    // message rendered twice.
    //
    // §A1b's MutationObserver watches #live-comments-list for ANY newly
    // added .live-comment element — including ones that pipeline just
    // rendered — and re-broadcasts it AGAIN, to a DIFFERENT Firestore
    // path (active_streams/{id}/liveFeed). §A2 then reads that second
    // path back and renders it a second time by calling the original
    // createLiveComment()/createLiveGiftComment() directly, bypassing
    // the live_comments pipeline's dedupe entirely (it only skips a
    // message if THIS device is the one that just broadcast it — not if
    // the live_comments listener already rendered it). Net effect: every
    // message from another participant was rendered once by the working
    // live_comments listener and a second time by this one — the
    // reported double-message bug.
    //
    // Fix: stop wiring the DOM-observer broadcast and the liveFeed
    // receive listener. §A1/§A1b/§A2's functions are left in place
    // (harmless, unused) rather than deleted, in case a future dev needs
    // the history here; they're just never attached. §B and §C below are
    // untouched and still run normally.
    /*
    onReady(function () {
        wireCommentBroadcast();
        attachCommentsDomObserver();
        var wireRetry = setInterval(function () {
            wireCommentBroadcast();
            attachCommentsDomObserver();
            if (window._pv10CommentWired) clearInterval(wireRetry);
        }, 500);

        setInterval(function () {
            if (currentStreamId() && isLiveScreenOpen()) {
                attachFeedListener();
                attachCommentsDomObserver(); // list element is recreated when the live screen reopens
            } else {
                detachFeedListener();
            }
        }, 1000);
    });
    */

    /* ═══════════════════════════════════════════════════════════════
       §B — Guest "Request to Join" button hard-hide safety net
       (UNCHANGED from the original file)
       ═══════════════════════════════════════════════════════════════ */
    function isHostNow() {
        return !window.isGuest && window.userState && window.liveStreamData &&
            window.liveStreamData.hostUserId &&
            window.userState.id === window.liveStreamData.hostUserId;
    }

    function isAcceptedGuestNow() {
        var exitBtn = document.getElementById('tk-exit-guest-btn');
        return !!(exitBtn && exitBtn.style.display === 'flex');
    }

    function enforceRequestJoinBtnHiding() {
        var btn = document.getElementById('live-request-join-btn');
        if (!btn) return;
        if (isHostNow() || isAcceptedGuestNow()) {
            btn.style.setProperty('display', 'none', 'important');
        }
    }

    /* ═══════════════════════════════════════════════════════════════
       §C — Comments feed bottom-up stacking/scroll/fade safety net
       (UNCHANGED from the original file)
       ═══════════════════════════════════════════════════════════════ */
    function enforceCommentsFeedLayout() {
        var list = document.getElementById('live-comments-list');
        if (!list) return;
        var body = list.parentElement;
        if (body) body.style.setProperty('position', 'relative', 'important');
        list.style.setProperty('position', 'absolute', 'important');
        list.style.setProperty('left', '0', 'important');
        list.style.setProperty('right', '0', 'important');
        list.style.setProperty('bottom', '0', 'important');
        list.style.setProperty('top', 'auto', 'important');
        list.style.setProperty('display', 'flex', 'important');
        list.style.setProperty('flex-direction', 'column-reverse', 'important');
        list.style.setProperty('overflow-y', 'auto', 'important');
        list.style.setProperty('max-height', '50vh', 'important');
        list.style.setProperty('pointer-events', 'auto', 'important');
        /* 2026-11-08 FIX ("chat scrolls up then immediately comes back down"): the list is flex-direction:column-reverse, where
           scrollTop is 0 at the newest message and NEGATIVE once scrolled up, so the old check (scrollTop > 4) could never be true and
           this 500ms safety net reset the list to the bottom every tick. Math.abs() makes the guard work for either sign convention. */
        if (Math.abs(list.scrollTop) > 4) return; // they've scrolled up on purpose, don't yank it back
        list.scrollTop = 0;
    }

    onReady(function () {
        setInterval(function () {
            enforceRequestJoinBtnHiding();
            enforceCommentsFeedLayout();
        }, 500);
    });

    /* ═══════════════════════════════════════════════════════════════
       §E — suppress the false "stream ended" indicator while this
       device's own live screen is still open for that stream. See
       header comment for the full root-cause writeup (cross-device
       clock skew defeating every freshness check in app-live.js).
       ═══════════════════════════════════════════════════════════════ */
    function log(msg) { console.log('[PatchV10] ' + msg); }

    var PV10_FALSE_END_PATTERNS = [
        /host has ended the live stream/i,
        /this live stream has ended/i
    ];

    function pv10LiveScreenOpen() {
        var overlay = document.getElementById('go-live-modal-overlay');
        return !!(overlay && overlay.classList.contains('show'));
    }

    function pv10WrapShowNotification() {
        if (window._pv10EndGuardWrapped) return;
        if (typeof window.showNotification !== 'function') return;
        var orig = window.showNotification;
        var wrapped = function (msg, type) {
            if (typeof msg === 'string' && pv10LiveScreenOpen()) {
                for (var i = 0; i < PV10_FALSE_END_PATTERNS.length; i++) {
                    if (PV10_FALSE_END_PATTERNS[i].test(msg)) {
                        console.log('[PV10-EndGuard] suppressed false "stream ended" notice — this device\u2019s live screen is still open, so the stream is still genuinely on air. Message was:', msg);
                        return;
                    }
                }
            }
            return orig.apply(this, arguments);
        };
        wrapped._pv10EndGuardOrig = orig;
        window.showNotification = wrapped;
        window._pv10EndGuardWrapped = true;
        log('[PV10-EndGuard] window.showNotification wrapped — false end-of-stream notices will be suppressed while the live screen is open.');
    }

    onReady(pv10WrapShowNotification);
    (function pv10WrapRetry() {
        var tries = 0;
        var retryTimer = setInterval(function () {
            pv10WrapShowNotification();
            tries++;
            if (window._pv10EndGuardWrapped || tries > 40) clearInterval(retryTimer); // ~20s cap, matches other retry loops in this file
        }, 500);
    })();
    document.addEventListener('empyrean-init-done', pv10WrapShowNotification);

    console.log('[EmpyreanPatchV10] \u2705 rev.3 — \u00a7A1/\u00a7A1b/\u00a7A2 duplicate liveFeed comment/gift sync DISABLED (was double-rendering every message on top of the working live_comments pipeline in app-fixes.js/app-live-tiktok-patch.js — see comment above); guest request-btn hard-hide and comments feed layout safety net still wired; \u00a7E now suppresses the false "host has ended the live stream" / "this live stream has ended" indicator while this device\u2019s own live screen is still genuinely open (cross-device clock-skew false positive — see header).');

})();