/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v42 + v50 + v51 + v52 (merged)
   app-patch-v42.js  |  filename unchanged — no index.html edit needed for
   this merge; none of v50/v51/v52 was ever deployed as its own file, so
   there's no old <script> tag to remove for any of them.

   MERGE NOTE (2026-08-02): app-patch-v50.js's clap-sound feature,
   app-patch-v51.js's live-polls/combo-burst/slow-mode-chat feature batch,
   and app-patch-v52.js's PK/Battle mode are all appended below UNCHANGED,
   each in its own IIFE with its own idempotency guard
   (window._empPatchV50Loaded / _empPatchV51Loaded / _empPatchV52Loaded) —
   the same mechanical, no-behavior-change combination already used by
   app-patch-v8-v19.js and app-patch-v30-v46.js in this codebase, done here
   to stay under the GitHub 100-file limit rather than shipping any of
   them as a 101st+ file. v42's own load-order requirement ("after every
   live-streaming file") already matches v50's, v51's, and v52's — v51 and
   v52 additionally require loading after v42 specifically (both reuse
   v42's host-panel button insertion point), which is automatically
   satisfied by all four now living in the same file, executed top to
   bottom. Verified no other file references any of the four modules'
   internals directly (all four only reach OUT to shared globals —
   window.createLiveComment, window.createLiveGiftComment,
   window.showGiftAnimation, window._fetchLiveAgoraToken,
   #go-live-modal-overlay, #host-control-panel-inner, the active_streams
   doc, etc.) — combining them changes nothing about what any of them
   does, only that they now ship from one <script> tag instead of four.
   v51 needs no new Firestore rule at all. v52 needs one new collection
   rule (`pk_battles`, same permissive pattern as the others — see its own
   header) but reuses active_streams' EXISTING permissive update rule for
   the one new field it adds there. Only v42 (live_engagement) and v50
   (live_reactions) still have their own pre-existing manual rule-addition
   steps, unchanged by this merge.

   Original v42 header follows, unchanged:
   ═══════════════════════════════════════════════════════════════════════
   EMPYREAN INTERNATIONAL — PATCH v42
   app-patch-v42.js  |  Load LAST (after app-patch-v41.js and every live-
   streaming file — app-live.js, app-live-tiktok-patch.js, app-live-final.js)

   FEATURE — LIVE STREAM GAMIFICATION: DAILY CHECK-IN, POINTS/LEVELS, AND A
   CONSPICUOUS DIAMOND RANK BADGE IN CHAT

   REQUESTED (per the reference screenshots): a daily check-in "Heart Me"
   system, a top-gifting ranking, and a diamond badge shown inline in chat
   next to a viewer's name — plus the existing "Viewer rankings" modal
   should show avatar, points, and badge per row, not just a bare amount.
   Delivered as ONE new, self-contained file, per this session's explicit
   request not to touch anything already working.

   ═══════════════════════════════════════════════════════════════════════
   WHAT ALREADY EXISTS (verified by reading the actual files, not assumed)
   — none of this is duplicated here
   ═══════════════════════════════════════════════════════════════════════
     - A real gift-amount leaderboard already exists: loadViewerRankings()
       in app-live-tiktok-patch.js reads `live_gifts` (streamId-scoped),
       sums by sender, and renders avatar + name + coin amount into the
       trophy-icon modal (#tk-viewer-rankings-modal). Untouched.
     - Gift sending, syncing across devices, and the live chat feed
       (createLiveComment / createLiveGiftComment in app-fixes.js;
       attachChatListener / attachGiftSyncListener in app-live-tiktok-
       patch.js) already work. Untouched.
     - The header heart icon already has its own free, unlimited tap-to-
       like counter with a floating-heart burst animation
       (app-live-tiktok-patch.js, "tap counting functionality"). Untouched
       — this file adds a SEPARATE, one-time-per-stream point CLAIM on top
       of it (see §4), it does not touch the like counter itself.
     - There is no daily check-in, no points/level system, and no rank/
       diamond badge anywhere in chat or the rankings modal today (verified
       by search — the only "level" hits in the whole live-streaming
       codebase are unrelated CSS z-index values). This file is genuinely
       new, not a rebuild of something broken.

   ═══════════════════════════════════════════════════════════════════════
   WHY THIS COULD BE BUILT AS A PURE ADDITIVE FILE (unlike v33/v37, no
   edits to any existing file were needed)
   ═══════════════════════════════════════════════════════════════════════
   The two places this feature needs to hook into —
   window.createLiveComment / window.createLiveGiftComment (chat rendering)
   — are already exposed on `window` (app-fixes.js) and this codebase
   already has an established, working precedent for wrapping them from a
   later-loaded file instead of editing the source (see app-live-tiktok-
   patch.js's own Rose-image swap, ~line 1134: "window.createLiveGiftComment
   = patched;"). This file follows that exact same pattern. Everything else
   (points, levels, check-in, the rankings-modal enrichment) is observed
   via independent Firestore listeners and a MutationObserver on modal
   visibility — the same techniques app-patch-v33.js already established
   for its own moderator-status cache, applied here to a new collection.

   ═══════════════════════════════════════════════════════════════════════
   DATA MODEL — one new collection, `live_engagement`
   ═══════════════════════════════════════════════════════════════════════
   Doc id: `{streamId}_{userId}` (deterministic, one doc per user per
   stream — mirrors this codebase's existing per-stream-scoped design:
   guests, live_gifts, and _giftTotals in app-live-final.js all reset per
   stream rather than persisting a global profile-level stat, so this
   follows the same convention rather than introducing a new one).
   Fields: streamId, userId, username, avatar, giftPoints (number),
   fanPoints (number), checkinDate (string, that user's local date —
   guards "once per day" without a server-time round trip), claimedHeartMe
   (bool), claimedComment (bool), superFan (bool). Written with
   FieldValue.increment() + {merge:true}, the exact same read-free-write
   pattern app-patch-v33.js's _empToggleModerator already uses for the
   `guests` array — no read-modify-write race.

   TWO POINT TRACKS, mirroring the two separate "Lv." chips visible in the
   reference screenshot (a diamond-icon level and a heart-icon level —
   TikTok's own wealth/fan split):
     - giftPoints ("💎 Diamond level") — 1 point per 1 EMPY gifted this
       stream, sourced from the same `live_gifts` collection the existing
       rankings modal already reads (a second, independent onSnapshot on
       it — the same multi-listener-on-one-collection pattern this
       codebase already uses for attachGiftCountListener +
       attachGiftSyncListener + loadViewerRankings, all separately
       querying live_gifts today).
     - fanPoints ("❤️ Heart level") — daily check-in (+10), first Heart-Me
       claim this stream (+25), first chat comment this stream (+10).
   A user's combined rank (the "No.1 / No.2 / No.3" pill shown in chat and
   in the enriched rankings modal) is giftPoints + fanPoints together —
   deliberately a richer ranking than the existing modal's raw-EMPY-only
   figure, not a replacement for it (see §7 — both are shown, on two tabs).

   "Become Super Fan" (from the reference screenshot's task list): once a
   viewer's giftPoints crosses SUPERFAN_THRESHOLD in a single stream, a
   one-time +SUPERFAN_BONUS is credited and `superFan` is set true. There
   is no "Super Fan Box" item in the real gift catalog (checked — see
   app-fixes.js's actual catalog array), so rather than inventing a gift
   that doesn't exist, this milestone is driven by cumulative gifting
   value already flowing through the real catalog, which is what the
   screenshot's own "+1000 per Super Fan Box" was ultimately measuring.

   Firestore rule needed: `live_engagement` needs the same permissive
   `allow read, write: if request.auth != null;` this codebase already
   uses for `active_streams` / `live_gifts` / `live_comments` (see
   firebase-rules.js) — no new rule pattern, just one more collection
   added to the existing allow-list.
   ============================================================================= */

(function empyreanPatchV42() {
    'use strict';

    if (window._empPatchV42Loaded) {
        console.warn('[V42] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV42Loaded = true;

    function log(msg) { console.log('[V42] ' + msg); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    /* =========================================================================
       DIAMOND-SHAPE LEVEL BADGE (refinement of the diamond chip below): a
       real diamond-cut SVG icon instead of a flat emoji, distinct per level
       so the badge visually communicates rank at a glance, not just via its
       number. Levels cycle through 7 real diamond cuts (round, princess,
       emerald, marquise, pear, heart, cushion) -- same set width/height as
       the emoji it replaces, so the chip stays exactly as compact.
       One hidden <svg> sprite is injected once; every badge instance then
       just <use>s the matching symbol, so N badges on screen cost N tiny
       <use> tags, not N copies of the path data.
       ========================================================================= */
    var GEM_SHAPES = 7;
    function _ensureGemDefs() {
        if (document.getElementById('pv42-gem-defs')) return;
        var wrap = document.createElement('div');
        wrap.id = 'pv42-gem-defs';
        wrap.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
        wrap.innerHTML =
            '<svg aria-hidden="true" focusable="false">' +
            '<defs>' +
            '<linearGradient id="pv42GemGrad" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0%" stop-color="#8EC5FF"/><stop offset="100%" stop-color="#1E40C4"/>' +
            '</linearGradient>' +
            '<symbol id="pv42-gem-1" viewBox="0 0 24 24">' + // round brilliant
                '<circle cx="12" cy="12" r="9.2" fill="url(#pv42GemGrad)" stroke="rgba(255,255,255,0.55)" stroke-width="0.9"/>' +
                '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" stroke="rgba(255,255,255,0.32)" stroke-width="0.6"/>' +
            '</symbol>' +
            '<symbol id="pv42-gem-2" viewBox="0 0 24 24">' + // princess (square)
                '<rect x="3.5" y="3.5" width="17" height="17" fill="url(#pv42GemGrad)" stroke="rgba(255,255,255,0.55)" stroke-width="0.9"/>' +
                '<path d="M3.5 3.5l17 17M20.5 3.5l-17 17" stroke="rgba(255,255,255,0.32)" stroke-width="0.6"/>' +
            '</symbol>' +
            '<symbol id="pv42-gem-3" viewBox="0 0 24 24">' + // emerald (step) cut
                '<path d="M8 3.5h8l4.5 4.5v8L16 20.5H8L3.5 16V8Z" fill="url(#pv42GemGrad)" stroke="rgba(255,255,255,0.55)" stroke-width="0.9"/>' +
                '<path d="M8 3.5v17M16 3.5v17" stroke="rgba(255,255,255,0.3)" stroke-width="0.55"/>' +
            '</symbol>' +
            '<symbol id="pv42-gem-4" viewBox="0 0 24 24">' + // marquise (pointed lens)
                '<path d="M12 2.2C17 5 21.2 8.3 21.2 12C21.2 15.7 17 19 12 21.8C7 19 2.8 15.7 2.8 12C2.8 8.3 7 5 12 2.2Z" fill="url(#pv42GemGrad)" stroke="rgba(255,255,255,0.55)" stroke-width="0.9"/>' +
                '<path d="M12 2.2v19.6" stroke="rgba(255,255,255,0.3)" stroke-width="0.55"/>' +
            '</symbol>' +
            '<symbol id="pv42-gem-5" viewBox="0 0 24 24">' + // pear (teardrop)
                '<path d="M12 2C14.3 6.2 19 10 19 15C19 19 15.5 22 12 22C8.5 22 5 19 5 15C5 10 9.7 6.2 12 2Z" fill="url(#pv42GemGrad)" stroke="rgba(255,255,255,0.55)" stroke-width="0.9"/>' +
            '</symbol>' +
            '<symbol id="pv42-gem-6" viewBox="0 0 24 24">' + // heart
                '<path d="M12 21C12 21 4 15.2 4 9.6C4 6.5 6.5 4 9.4 4C10.9 4 12 5 12 5C12 5 13.1 4 14.6 4C17.5 4 20 6.5 20 9.6C20 15.2 12 21 12 21Z" fill="url(#pv42GemGrad)" stroke="rgba(255,255,255,0.55)" stroke-width="0.9"/>' +
            '</symbol>' +
            '<symbol id="pv42-gem-7" viewBox="0 0 24 24">' + // cushion / asscher
                '<rect x="3.5" y="3.5" width="17" height="17" rx="6" fill="url(#pv42GemGrad)" stroke="rgba(255,255,255,0.55)" stroke-width="0.9"/>' +
                '<path d="M12 3.5v17M3.5 12h17" stroke="rgba(255,255,255,0.3)" stroke-width="0.55"/>' +
            '</symbol>' +
            '</defs></svg>';
        (document.body || document.documentElement).appendChild(wrap);
    }
    function _gemSvg(level) {
        _ensureGemDefs();
        var shape = ((Math.max(1, level | 0) - 1) % GEM_SHAPES) + 1;
        return '<svg class="pv42-gem" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><use href="#pv42-gem-' + shape + '"></use></svg>';
    }

    var CHECKIN_POINTS = 10;
    var HEARTME_POINTS = 25;
    var COMMENT_POINTS = 10;
    var GIFT_POINTS_PER_EMPY = 1;
    var SUPERFAN_THRESHOLD = 1000;   // giftPoints (== EMPY gifted) this stream
    var SUPERFAN_BONUS = 1350;
    var LEVEL_STEP = 100;            // points per level, either track

    function _us() { return window.userState || {}; }
    function myId() { return _us().id; }
    function currentStreamId() { return window.liveStreamData && window.liveStreamData.streamId; }
    function fbReady() { return !!(window.fbDb && window._firebaseLoaded); }
    function fieldValue() { return (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null; }
    function todayStr() { return new Date().toDateString(); }
    function levelOf(points) { return Math.floor((points || 0) / LEVEL_STEP) + 1; }
    function progressOf(points) { return (points || 0) % LEVEL_STEP; }

    /* =========================================================================
       §1 — engagement cache: one onSnapshot on `live_engagement` scoped to
       the CURRENT stream, keyed by userId. Every other section below reads
       from this cache rather than issuing its own fetch, so a level-up or
       a new gifter is reflected everywhere (chat badges, the popup, the
       enriched rankings modal) the moment Firestore delivers it.
       ========================================================================= */
    var _eng = {};              // userId -> entry
    var _engStreamId = null;
    var _engUnsub = null;

    function _blankEntry(uid) {
        return { userId: uid, username: '', avatar: '', giftPoints: 0, fanPoints: 0, checkinDate: '', claimedHeartMe: false, claimedComment: false, superFan: false };
    }
    function _entry(uid) {
        if (!uid) return _blankEntry('');
        if (!_eng[uid]) _eng[uid] = _blankEntry(uid);
        return _eng[uid];
    }
    function _total(uid) { var e = _entry(uid); return (e.giftPoints || 0) + (e.fanPoints || 0); }

    function _resetEngagementIfNewStream() {
        var sid = currentStreamId();
        if (sid !== _engStreamId) { _engStreamId = sid; _eng = {}; }
    }
    function _engRef(uid) {
        var sid = currentStreamId();
        if (!fbReady() || !sid || !uid) return null;
        return window.fbDb.collection('live_engagement').doc(sid + '_' + uid);
    }
    function _attachEngagementListener() {
        _detachEngagementListener();
        var sid = currentStreamId();
        if (!fbReady() || !sid) return;
        _resetEngagementIfNewStream();
        _engUnsub = window.fbDb.collection('live_engagement').where('streamId', '==', sid)
            .onSnapshot(function (snap) {
                snap.forEach(function (doc) {
                    var d = doc.data() || {};
                    if (!d.userId) return;
                    _eng[d.userId] = Object.assign(_blankEntry(d.userId), d);
                });
                _refreshLevelChip();
                _refreshPopupIfOpen();
                _refreshRankModalDecorations();
            }, function (err) { console.warn('[V42] engagement listener error:', err.message); });
    }
    function _detachEngagementListener() {
        if (_engUnsub) { _engUnsub(); _engUnsub = null; }
    }

    // Optimistic local bump (instant UI) + the real Firestore write. `extra`
    // carries any non-numeric fields to set alongside the increment (e.g.
    // checkinDate, claimedHeartMe) in the SAME merge write.
    function _award(uid, track, amount, extra) {
        if (!uid || !amount) return;
        var e = _entry(uid);
        e[track] = (e[track] || 0) + amount;
        if (extra) Object.assign(e, extra);
        var ref = _engRef(uid), FV = fieldValue();
        if (!ref || !FV) return;
        var payload = { streamId: currentStreamId(), userId: uid, updatedAt: new Date().toISOString() };
        payload[track] = FV.increment(amount);
        if (extra) Object.assign(payload, extra);
        var us = _us();
        if (uid === myId()) { payload.username = us.fullName || us.username || 'You'; payload.avatar = us.avatar || ''; }
        ref.set(payload, { merge: true }).catch(function (err) { console.warn('[V42] award write failed:', err && err.message); });
    }

    /* =========================================================================
       §2 — gift points (💎 wealth track). Independent, read-only listener
       on `live_gifts` — same collection loadViewerRankings() already
       reads, same multi-listener-on-one-collection pattern this codebase
       already relies on. Only NEW docs are processed (docChanges 'added'),
       so re-attaching never double-counts history already in the cache.
       ========================================================================= */
    var _giftPtsUnsub = null;
    var _giftPtsSeen = {};
    function _attachGiftPointsListener() {
        _detachGiftPointsListener();
        var sid = currentStreamId();
        if (!fbReady() || !sid) return;
        _giftPtsSeen = {};
        _giftPtsUnsub = window.fbDb.collection('live_gifts').where('streamId', '==', sid)
            .onSnapshot(function (snap) {
                snap.docChanges().forEach(function (change) {
                    if (change.type !== 'added') return;
                    var d = change.doc.data() || {};
                    var key = d.messageId || change.doc.id;
                    if (_giftPtsSeen[key]) return;
                    _giftPtsSeen[key] = true;
                    if (!d.senderId || !d.amount) return;
                    var pts = Math.round(d.amount * GIFT_POINTS_PER_EMPY);
                    _award(d.senderId, 'giftPoints', pts, { username: d.senderName || undefined, avatar: d.senderAvatar || undefined });

                    var afterTotal = _entry(d.senderId).giftPoints;
                    if (afterTotal >= SUPERFAN_THRESHOLD && !_entry(d.senderId).superFan) {
                        _award(d.senderId, 'giftPoints', SUPERFAN_BONUS, { superFan: true });
                        if (d.senderId === myId()) notify('\uD83D\uDC8E You just became a Super Fan! +' + SUPERFAN_BONUS + ' bonus points.', 'success');
                    }
                });
            }, function (err) { console.warn('[V42] gift-points listener error:', err.message); });
    }
    function _detachGiftPointsListener() { if (_giftPtsUnsub) { _giftPtsUnsub(); _giftPtsUnsub = null; } }

    /* =========================================================================
       §3 — sender lookup for TEXT chat messages. createLiveComment() (see
       §5) is only ever called with (username, text, messageId, avatarUrl)
       — no userId — so a badge for someone ELSE's message needs a separate
       way to resolve who sent it. This mirrors the exact read-only,
       independent-listener approach already used above for gift points:
       it watches the same `live_comments` collection attachChatListener()
       (app-live-tiktok-patch.js) already reads, and builds nothing but a
       messageId -> senderId lookup. For the sender's OWN device, the local
       echo renders synchronously (before the Firestore round trip even
       starts), so that path is resolved directly via myId() instead of
       waiting on this cache — see _resolveSenderId below.
       ========================================================================= */
    var _commentSenderUnsub = null;
    var _commentSenderCache = {};
    function _attachCommentSenderListener() {
        _detachCommentSenderListener();
        var sid = currentStreamId();
        if (!fbReady() || !sid) return;
        _commentSenderCache = {};
        _commentSenderUnsub = window.fbDb.collection('live_comments').where('streamId', '==', sid)
            .onSnapshot(function (snap) {
                snap.docChanges().forEach(function (change) {
                    if (change.type !== 'added') return;
                    var d = change.doc.data() || {};
                    var mid = d.messageId || change.doc.id;
                    if (d.senderId) _commentSenderCache[mid] = d.senderId;
                });
            }, function (err) { console.warn('[V42] comment-sender listener error:', err.message); });
    }
    function _detachCommentSenderListener() { if (_commentSenderUnsub) { _commentSenderUnsub(); _commentSenderUnsub = null; } }

    function _resolveSenderId(username, messageId) {
        if (messageId && _commentSenderCache[messageId]) return _commentSenderCache[messageId];
        var us = _us();
        if (username && (username === us.fullName || username === us.username)) return us.id;
        return null; // unknown — render without a badge rather than guess
    }

    /* =========================================================================
       §4 — daily check-in + Heart-Me claim + comment claim. All three are
       "once" actions guarded by a field on the user's own engagement doc,
       so a re-tap (or a page reload mid-stream) can never double-award.
       ========================================================================= */
    function _doCheckin() {
        var uid = myId();
        if (!uid) { notify('Sign in to check in.', 'warning'); return; }
        if (_entry(uid).checkinDate === todayStr()) { notify('Already checked in today \u2014 come back tomorrow!', 'info'); return; }
        _award(uid, 'fanPoints', CHECKIN_POINTS, { checkinDate: todayStr() });
        notify('\u2705 Checked in! +' + CHECKIN_POINTS + ' points.', 'success');
        _refreshPopupIfOpen();
    }
    function _claimHeartMe() {
        var uid = myId();
        if (!uid) return;
        if (_entry(uid).claimedHeartMe) return;
        _award(uid, 'fanPoints', HEARTME_POINTS, { claimedHeartMe: true });
        notify('\uD83D\uDC96 +' + HEARTME_POINTS + ' points for sending a Heart Me!', 'success');
        _refreshPopupIfOpen();
    }
    function _claimComment(username) {
        var uid = myId();
        if (!uid) return;
        var us = _us();
        if (username !== (us.fullName || us.username)) return; // not my own message
        if (_entry(uid).claimedComment) return;
        _award(uid, 'fanPoints', COMMENT_POINTS, { claimedComment: true });
        notify('\uD83D\uDCAC +' + COMMENT_POINTS + ' points for joining the conversation!', 'success');
        _refreshPopupIfOpen();
    }
    // The header heart (#live-like-count-container) already has its own
    // free, unlimited tap-to-like handler (app-live-tiktok-patch.js) — this
    // is a SEPARATE listener on the SAME element (elements can carry any
    // number of independent click listeners; this one never calls
    // stopPropagation/preventDefault, so the existing burst animation and
    // counter are completely unaffected) that only ever fires the point
    // claim once, on that element's first tap this stream.
    function _wireHeartMeClaim() {
        var el = document.getElementById('live-like-count-container');
        if (!el || el._pv42Wired) return;
        el._pv42Wired = true;
        el.addEventListener('click', function () { _claimHeartMe(); });
    }

    /* =========================================================================
       §5 — chat badge injection. Wraps window.createLiveComment /
       window.createLiveGiftComment (already-established pattern — see the
       file header). Both functions synchronously `list.prepend(commentEl)`
       before returning, so the newly-added row is always list.firstElementChild
       immediately after the original call resolves.
       ========================================================================= */
    function _rankPositionFor(uid) {
        if (!uid) return 0;
        var ranked = Object.keys(_eng)
            .map(function (id) { return { id: id, total: _total(id) }; })
            .filter(function (r) { return r.total > 0; })
            .sort(function (a, b) { return b.total - a.total; });
        for (var i = 0; i < Math.min(3, ranked.length); i++) {
            if (ranked[i].id === uid) return i + 1;
        }
        return 0; // not top 3 — no rank pill
    }
    function _badgeHTML(uid) {
        if (!uid) return '';
        var e = _entry(uid);
        var dLevel = levelOf(e.giftPoints);
        var rank = _rankPositionFor(uid);
        var html = '<span class="pv42-chip pv42-chip-diamond" title="Diamond level ' + dLevel + '">' + _gemSvg(dLevel) + dLevel + '</span>';
        if (rank) html += ' <span class="pv42-chip pv42-chip-rank">\uD83C\uDFC5No.' + rank + '</span>';
        if (e.superFan) html += ' <span class="pv42-chip pv42-chip-superfan" title="Super Fan">\uD83D\uDC8E</span>';
        /* FIX (bug report — badges rendered as long stretched bars, stacked
           vertically, dragging the whole comment row/avatar frame tall and
           blurry-looking): _decorateNewestRow() inserts this HTML directly
           as siblings inside .live-comment-body, which is a flex COLUMN
           container (style.css). Flex containers default to
           align-items:stretch, and each bare <span class="pv42-chip"> had
           no align-self override, so every chip stretched to the row's
           full width and took its own line — exactly the elongated,
           stacked pills reported. Wrapping all chips in ONE inline-flex
           row (with its own align-self:flex-start, set in the CSS below)
           keeps them compact and side-by-side, immune to the parent's
           column-stretch behavior, regardless of where this HTML gets
           inserted. Only used here and in the "Top Fans" rankings-modal
           row (§7), where it's already safely nested inside a flex ROW and
           this wrapper is a no-op change in size/position there. */
        return '<span class="pv42-badge-row">' + html + '</span>';
    }
    function _leftBadgeHTML(uid) {
        if (!uid) return '';
        var e = _entry(uid);
        var dLevel = levelOf(e.giftPoints);
        var html = '<span class="pv42-chip pv42-chip-diamond" title="Diamond level ' + dLevel + '">' + _gemSvg(dLevel) + dLevel + '</span>';
        if (e.superFan) html += ' <span class="pv42-chip pv42-chip-superfan" title="Super Fan">\uD83D\uDC8E</span>';
        return html;
    }
    function _rankBadgeHTML(uid) {
        if (!uid) return '';
        var rank = _rankPositionFor(uid);
        if (!rank) return '';
        return '<span class="pv42-chip pv42-chip-rank">\uD83C\uDFC5No.' + rank + '</span>';
    }
    /* FIX (visual match to reference screenshot): a TikTok-style chat row
       has the level/superfan chip(s) directly in front of the name on the
       left, and the rank pill (No.X) pinned flush right on that SAME
       line — not stacked underneath the name, and not trailing right after
       it either. Building that requires the name to sit inside its own
       full-width header row (.pv42-name-row) with two groups: a left
       group that can shrink/truncate (chips + name) and the rank chip
       pinned right via flex-shrink:0. This replaces the single combined
       _badgeHTML() call that used to run here; _badgeHTML() itself is
       unchanged and still used as-is by the rankings modal (§7), which
       already renders correctly in its own flex ROW context. */
    function _decorateNewestRow(list, senderId) {
        if (!list || !senderId) return;
        var row = list.firstElementChild;
        if (!row || row.dataset.pv42Badged) return;
        var body = row.querySelector('.live-comment-body');
        var strong = body && body.querySelector('strong');
        if (!strong) return;

        var headerRow = document.createElement('span');
        headerRow.className = 'pv42-name-row';
        var leftGroup = document.createElement('span');
        leftGroup.className = 'pv42-name-left';
        strong.parentNode.insertBefore(headerRow, strong);
        headerRow.appendChild(leftGroup);
        leftGroup.appendChild(strong);

        var leftHTML = _leftBadgeHTML(senderId);
        if (leftHTML) strong.insertAdjacentHTML('beforebegin', leftHTML);

        var rankHTML = _rankBadgeHTML(senderId);
        if (rankHTML) headerRow.insertAdjacentHTML('beforeend', rankHTML);

        row.dataset.pv42Badged = '1';
    }

    (function wrapCommentRenderers() {
        function armCreateLiveComment() {
            if (typeof window.createLiveComment !== 'function' || window.createLiveComment._pv42Wrapped) return false;
            var original = window.createLiveComment;
            function patched(username, text, messageId, avatarUrl, isGift) {
                var result = original.apply(this, arguments);
                try {
                    var senderId = _resolveSenderId(username, messageId);
                    _decorateNewestRow(document.getElementById('live-comments-list'), senderId);
                    _claimComment(username);
                } catch (e) { /* decoration must never break the real comment render */ }
                return result;
            }
            patched._pv42Wrapped = true;
            window.createLiveComment = patched;
            return true;
        }
        function armCreateLiveGiftComment() {
            if (typeof window.createLiveGiftComment !== 'function' || window.createLiveGiftComment._pv42Wrapped) return false;
            var original = window.createLiveGiftComment;
            function patched(username, avatarUrl, giftSymbol, giftName, userId) {
                var result = original.apply(this, arguments);
                try { _decorateNewestRow(document.getElementById('live-comments-list'), userId); } catch (e) {}
                return result;
            }
            patched._pv42Wrapped = true;
            window.createLiveGiftComment = patched;
            return true;
        }
        // Both may be assigned by app-fixes.js and re-assigned once more by
        // app-live-tiktok-patch.js's own Rose-image wrapper before this file
        // ever runs (load order: this file is last) — so a single attempt
        // at DOMContentLoaded is normally enough. The short retries are a
        // safety net only, matching the same belt-and-suspenders timing
        // v39/v40 already use elsewhere in this codebase.
        function tryArm() { armCreateLiveComment(); armCreateLiveGiftComment(); }
        tryArm();
        setTimeout(tryArm, 500);
        setTimeout(tryArm, 1500);
    })();

    /* =========================================================================
       §6 — header "Lv." chip + check-in/tasks popup.
       ========================================================================= */
    function _ensureLevelChip() {
        var statsRow = document.querySelector('.live-stats');
        if (!statsRow) return null;
        var chip = document.getElementById('pv42-level-chip');
        if (chip) return chip;
        chip = document.createElement('span');
        chip.id = 'pv42-level-chip';
        chip.className = 'live-stat-item pv42-level-chip';
        chip.title = 'Daily check-in & rewards';
        chip.style.cursor = 'pointer';
        chip.innerHTML = '<span aria-hidden="true"><svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.14em;color:#5cc8ff;"><path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg></span> <span id="pv42-level-num">Lv.1</span>';
        var rankBtn = document.getElementById('tk-viewer-rankings-btn');
        if (rankBtn && rankBtn.parentElement === statsRow) statsRow.insertBefore(chip, rankBtn.nextSibling);
        else statsRow.insertBefore(chip, statsRow.firstChild);
        chip.addEventListener('click', _openPopup);
        return chip;
    }
    function _refreshLevelChip() {
        var numEl = document.getElementById('pv42-level-num');
        if (!numEl) return;
        numEl.textContent = 'Lv.' + levelOf(_total(myId()));
    }

    var _popup = null;
    function _ensurePopup() {
        if (_popup) return _popup;
        var container = document.getElementById('live-stream-screen') || document.body;
        _popup = document.createElement('div');
        _popup.id = 'pv42-popup';
        _popup.className = 'live-sub-modal';
        _popup.innerHTML =
            '<button type="button" class="close-modal pv42-popup-close" style="color:white; z-index:5; top:5px; right:10px;">\u00d7</button>' +
            '<h3><span aria-hidden="true"><svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.14em;color:#5cc8ff;"><path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg></span> Daily Rewards</h3>' +
            '<div id="pv42-popup-body" style="overflow-y:auto; flex-grow:1;"></div>';
        container.appendChild(_popup);
        _popup.querySelector('.pv42-popup-close').addEventListener('click', function () { _popup.classList.remove('show'); });
        return _popup;
    }
    function _taskRow(icon, title, sub, actionLabel, done, onClick) {
        return '<div class="pv42-task-row">' +
            '<div class="pv42-task-icon">' + icon + '</div>' +
            '<div class="pv42-task-text"><div class="pv42-task-title">' + esc(title) + '</div><div class="pv42-task-sub">' + esc(sub) + '</div></div>' +
            '<button type="button" class="pv42-task-btn' + (done ? ' pv42-task-done' : '') + '" data-pv42-action="' + esc(onClick) + '"' + (done ? ' disabled' : '') + '>' + (done ? 'Claimed' : esc(actionLabel)) + '</button>' +
            '</div>';
    }
    function _renderPopupBody() {
        var body = document.getElementById('pv42-popup-body');
        if (!body) return;
        var uid = myId();
        var e = _entry(uid);
        var total = _total(uid);
        var lvl = levelOf(total);
        var prog = progressOf(total);
        var checkedInToday = e.checkinDate === todayStr();

        body.innerHTML =
            '<div class="pv42-level-card">' +
            '<div class="pv42-level-badge">Lv.' + lvl + '</div>' +
            '<div class="pv42-progress-track"><div class="pv42-progress-fill" style="width:' + prog + '%;"></div></div>' +
            '<div class="pv42-progress-label">' + prog + ' / ' + LEVEL_STEP + ' to Lv.' + (lvl + 1) + '</div>' +
            '</div>' +
            '<div class="pv42-section-label">Check in daily</div>' +
            _taskRow('\uD83C\uDF81', 'Daily Check-in', '+' + CHECKIN_POINTS + ' points', checkedInToday ? 'Claimed' : 'Check in', checkedInToday, 'checkin') +
            '<div class="pv42-section-label">Today\u2019s tasks</div>' +
            _taskRow('\uD83D\uDC96', 'Send a Heart Me', '+' + HEARTME_POINTS + ' points', 'Claim', !!e.claimedHeartMe, 'heartme') +
            _taskRow('\uD83D\uDCAC', 'Add a comment', '+' + COMMENT_POINTS + ' points', 'Go', !!e.claimedComment, 'comment') +
            '<div class="pv42-section-label">Level up faster</div>' +
            _taskRow('\uD83C\uDF81', 'Send a gift', GIFT_POINTS_PER_EMPY + ' point per EMPY gifted', 'Send', false, 'gift') +
            _taskRow('\uD83D\uDC8E', 'Become Super Fan', 'Gift ' + SUPERFAN_THRESHOLD + ' EMPY this stream for +' + SUPERFAN_BONUS, e.superFan ? 'Achieved' : (Math.min(100, Math.round(100 * (e.giftPoints || 0) / SUPERFAN_THRESHOLD)) + '%'), e.superFan, 'superfan');

        body.querySelectorAll('[data-pv42-action]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var action = btn.getAttribute('data-pv42-action');
                if (action === 'checkin') _doCheckin();
                else if (action === 'heartme') _claimHeartMe();
                else if (action === 'comment') {
                    _popup.classList.remove('show');
                    var input = document.getElementById('live-comment-input');
                    if (input) input.focus();
                } else if (action === 'gift') {
                    _popup.classList.remove('show');
                    var hostId = window.liveStreamData && window.liveStreamData.hostUserId;
                    var hostName = (document.getElementById('live-host-name') || {}).textContent || 'host';
                    if (typeof window.openGiftCatalogFor === 'function') window.openGiftCatalogFor(hostId, hostName);
                    else if (typeof window.openGiftCatalog === 'function') window.openGiftCatalog(hostId, hostName);
                }
            });
        });
    }
    function _openPopup() {
        _ensurePopup();
        _renderPopupBody();
        _popup.classList.add('show');
    }
    function _refreshPopupIfOpen() {
        if (_popup && _popup.classList.contains('show')) _renderPopupBody();
    }

    /* =========================================================================
       §7 — enrich the EXISTING rankings modal (avatar/name/amount already
       rendered by loadViewerRankings(), untouched) with a level badge + a
       second "Top Fans" tab driven by this file's own point totals. Purely
       observational: a MutationObserver on #tk-viewer-rankings-modal's
       `show` class (the same technique app-patch-v33.js already uses for
       its own moderator UI), so no click handler already wired to the
       trophy button needs to be touched.

       ROW-TO-USER MATCH: the existing rows carry no data-uid (only name +
       avatar + amount), so this recomputes the SAME ranked array
       loadViewerRankings() computes (same collection, same sum, same sort)
       and matches by position — reliable because both read the identical
       source data with identical sort criteria, so index i always refers
       to the same user in both renders.
       ========================================================================= */
    function _ensureTabs(modal) {
        if (!modal || modal.querySelector('.pv42-rank-tabs')) return;
        var h3 = modal.querySelector('h3');
        if (!h3) return;
        var tabs = document.createElement('div');
        tabs.className = 'pv42-rank-tabs';
        tabs.innerHTML =
            '<button type="button" class="pv42-rank-tab pv42-rank-tab-active" data-pv42-tab="viewers">Top Viewers</button>' +
            '<button type="button" class="pv42-rank-tab" data-pv42-tab="fans">Top Fans <span aria-hidden="true">\uD83D\uDC8E</span></button>';
        h3.insertAdjacentElement('afterend', tabs);
        tabs.addEventListener('click', function (e) {
            var btn = e.target.closest('.pv42-rank-tab');
            if (!btn) return;
            tabs.querySelectorAll('.pv42-rank-tab').forEach(function (b) { b.classList.remove('pv42-rank-tab-active'); });
            btn.classList.add('pv42-rank-tab-active');
            _renderTab(btn.getAttribute('data-pv42-tab'));
        });
    }
    var _viewersHTML = null; // last-known "Top Viewers" render, cached so switching to
                              // "Top Fans" and back doesn't lose the original list —
                              // see _decorateOriginalRows, which refreshes this cache
                              // every time loadViewerRankings() re-populates the list.
    function _renderTab(which) {
        var list = document.getElementById('tk-rank-list');
        if (!list) return;
        if (which === 'viewers') {
            if (_viewersHTML != null) list.innerHTML = _viewersHTML;
            return;
        }
        var ranked = Object.keys(_eng).map(function (id) { return Object.assign({}, _eng[id], { total: _total(id) }); })
            .filter(function (r) { return r.total > 0; })
            .sort(function (a, b) { return b.total - a.total; })
            .slice(0, 20);
        if (!ranked.length) {
            list.innerHTML = '<p style="text-align:center; color:#ccc; padding:20px;">No fan activity yet \u2014 check in or chat to be the first!</p>';
            return;
        }
        list.innerHTML = ranked.map(function (r, i) {
            var safeAvatar = r.avatar || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(r.username || '?');
            return '<div class="tk-rank-row">' +
                '<span class="tk-rank-num">' + (i + 1) + '</span>' +
                '<img src="' + safeAvatar + '" alt="">' +
                '<span class="tk-rank-name">' + esc(r.username || 'Someone') + ' ' + _badgeHTML(r.userId) + '</span>' +
                '<span class="tk-rank-amt"><i class="fa-solid fa-star"></i> ' + r.total.toLocaleString() + '</span>' +
                '</div>';
        }).join('');
    }
    function _decorateOriginalRows() {
        var list = document.getElementById('tk-rank-list');
        if (!list) return;
        // Recompute the identical gift-amount ranking loadViewerRankings()
        // just rendered, purely to recover WHICH userId belongs to row i —
        // see the "ROW-TO-USER MATCH" note above.
        var sid = currentStreamId();
        if (!fbReady() || !sid) return;
        window.fbDb.collection('live_gifts').where('streamId', '==', sid).get().then(function (snap) {
            var totals = {};
            snap.forEach(function (doc) {
                var g = doc.data();
                if (!g.senderId) return;
                if (!totals[g.senderId]) totals[g.senderId] = { userId: g.senderId, amount: 0 };
                totals[g.senderId].amount += (g.amount || 0);
            });
            var ranked = Object.keys(totals).map(function (uid) { return totals[uid]; })
                .sort(function (a, b) { return b.amount - a.amount; }).slice(0, 20);
            var rows = list.querySelectorAll('.tk-rank-row');
            rows.forEach(function (row, i) {
                if (row.dataset.pv42Badged || !ranked[i]) return;
                var nameEl = row.querySelector('.tk-rank-name');
                if (nameEl) nameEl.insertAdjacentHTML('beforeend', ' ' + _badgeHTML(ranked[i].userId));
                row.dataset.pv42Badged = '1';
            });
            _viewersHTML = list.innerHTML;
        }).catch(function () {});
    }
    function _refreshRankModalDecorations() {
        var modal = document.getElementById('tk-viewer-rankings-modal');
        if (!modal || !modal.classList.contains('show')) return;
        var activeTab = modal.querySelector('.pv42-rank-tab-active');
        if (activeTab && activeTab.getAttribute('data-pv42-tab') === 'fans') _renderTab('fans');
    }
    function _watchRankModal() {
        var modal = document.getElementById('tk-viewer-rankings-modal');
        if (!modal || modal._pv42Observed) return;
        modal._pv42Observed = true;
        new MutationObserver(function () {
            if (!modal.classList.contains('show')) return;
            _ensureTabs(modal);
            // loadViewerRankings() populates #tk-rank-list asynchronously
            // (it's an await'd Firestore .get()); give it a moment to land
            // before decorating rows, same margin app-patch-v40.js's own
            // transition timers already use for comparable async UI.
            setTimeout(_decorateOriginalRows, 450);
        }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    }

    /* =========================================================================
       §8 — CSS (all class names prefixed pv42- to guarantee zero collision
       with any existing selector).
       ========================================================================= */
    (function injectCSS() {
        if (document.getElementById('pv42-gamify-css')) return;
        var css = document.createElement('style');
        css.id = 'pv42-gamify-css';
        css.textContent =
            '.pv42-level-chip{display:inline-flex;align-items:center;gap:4px;}' +
            /* FIX (bug report — badges too long / avatar row dragged tall
               and blurry): this single wrapper is what actually gets
               inserted next to a comment's name now (see _badgeHTML).
               align-self:flex-start stops it from being stretched to the
               full row width by .live-comment-body's flex-column
               align-items:stretch default; flex-wrap:wrap keeps multiple
               chips from ever forcing overflow on a very long name. */
            '.pv42-badge-row{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;align-self:flex-start;max-width:100%;vertical-align:middle;}' +
            /* Chat-row header (name line): left group (chips + name) is
               allowed to shrink/truncate; the rank chip never shrinks and
               is pushed flush right by the header row's own space-between,
               matching the reference screenshot's layout exactly. */
            '.pv42-name-row{display:flex;align-items:center;gap:6px;width:100%;justify-content:space-between;}' +
            '.pv42-name-left{display:flex;align-items:center;gap:4px;min-width:0;flex:1 1 auto;overflow:hidden;}' +
            '.pv42-name-left strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
            '.pv42-name-row .pv42-chip-rank{flex-shrink:0;}' +
            '.pv42-chip{display:inline-flex;align-items:center;gap:2px;font-size:0.62rem;font-weight:800;border-radius:8px;padding:1px 6px;line-height:1.5;vertical-align:middle;letter-spacing:0.2px;align-self:flex-start;flex:0 0 auto;}' +
            '.pv42-gem{vertical-align:-1px;margin-right:2px;filter:drop-shadow(0 0 2px rgba(62,123,250,0.65));}' +
            '.pv42-chip-diamond{background:linear-gradient(135deg,#3E7BFA,#1E40C4);color:#EAF1FF;box-shadow:0 0 6px rgba(62,123,250,0.55);}' +
            '.pv42-chip-rank{background:linear-gradient(135deg,#FF6FA5,#D63A78);color:#fff;}' +
            '.pv42-chip-superfan{background:linear-gradient(135deg,#F5C518,#C98A00);color:#3a2600;}' +
            /* Popup */
            '.pv42-level-card{background:linear-gradient(135deg,rgba(62,123,250,0.18),rgba(30,64,196,0.10));border:1px solid rgba(62,123,250,0.35);border-radius:14px;padding:14px;margin-bottom:16px;text-align:center;}' +
            '.pv42-level-badge{font-size:1.3rem;font-weight:900;color:#EAF1FF;margin-bottom:8px;}' +
            '.pv42-progress-track{height:8px;border-radius:6px;background:rgba(255,255,255,0.12);overflow:hidden;}' +
            '.pv42-progress-fill{height:100%;background:linear-gradient(90deg,#3E7BFA,#8EC5FF);border-radius:6px;transition:width .35s ease;}' +
            '.pv42-progress-label{margin-top:6px;font-size:0.7rem;color:#cfd8ee;}' +
            '.pv42-section-label{font-size:0.72rem;font-weight:800;color:#9fb0d6;text-transform:uppercase;letter-spacing:0.5px;margin:14px 0 6px;}' +
            '.pv42-task-row{display:flex;align-items:center;gap:10px;padding:9px 6px;border-bottom:1px solid rgba(255,255,255,0.07);}' +
            '.pv42-task-icon{font-size:1.25rem;width:30px;text-align:center;flex-shrink:0;}' +
            '.pv42-task-text{flex:1;min-width:0;}' +
            '.pv42-task-title{font-weight:700;font-size:0.85rem;color:#fff;}' +
            '.pv42-task-sub{font-size:0.72rem;color:#a9b4d0;}' +
            '.pv42-task-btn{flex-shrink:0;border:none;border-radius:16px;padding:7px 16px;font-weight:800;font-size:0.78rem;color:#1a1a1a;background:linear-gradient(135deg,#F5C518,#F0A400);cursor:pointer;}' +
            '.pv42-task-btn.pv42-task-done{background:rgba(255,255,255,0.10);color:#9fb0d6;cursor:default;}' +
            /* Rankings-modal tabs */
            '.pv42-rank-tabs{display:flex;gap:8px;margin:-6px 0 12px;justify-content:center;}' +
            '.pv42-rank-tab{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.14);color:#cfd8ee;font-weight:700;font-size:0.76rem;border-radius:14px;padding:6px 14px;cursor:pointer;}' +
            '.pv42-rank-tab-active{background:linear-gradient(135deg,#3E7BFA,#1E40C4);color:#fff;border-color:transparent;}';
        document.head.appendChild(css);
    })();

    /* =========================================================================
       §9 — wiring: attach/detach everything alongside the live modal, same
       trigger (#go-live-modal-overlay class toggle) app-patch-v33.js
       already observes for its own moderator feature.
       ========================================================================= */
    function onModalToggle() {
        var modal = document.getElementById('go-live-modal-overlay');
        if (!modal) return;
        if (modal.classList.contains('show')) {
            _resetEngagementIfNewStream();
            _attachEngagementListener();
            _attachGiftPointsListener();
            _attachCommentSenderListener();
            setTimeout(function () {
                _ensureLevelChip();
                _refreshLevelChip();
                _wireHeartMeClaim();
                _watchRankModal();
            }, 400);
        } else {
            _detachEngagementListener();
            _detachGiftPointsListener();
            _detachCommentSenderListener();
            var chip = document.getElementById('pv42-level-chip');
            if (chip) chip.remove();
            if (_popup) { _popup.remove(); _popup = null; }
            _eng = {}; _engStreamId = null; _giftPtsSeen = {}; _commentSenderCache = {};
        }
    }
    function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
    ready(function () {
        var modal = document.getElementById('go-live-modal-overlay');
        if (modal) {
            new MutationObserver(onModalToggle).observe(modal, { attributes: true, attributeFilter: ['class'] });
            if (modal.classList.contains('show')) onModalToggle();
        }
        // Re-check periodically in case the heart-me listener or level chip
        // needs re-wiring after a guest/host role change re-renders the
        // header — cheap, idempotent (both guard on their own flags).
        setInterval(function () {
            var m = document.getElementById('go-live-modal-overlay');
            if (m && m.classList.contains('show')) { _ensureLevelChip(); _refreshLevelChip(); _wireHeartMeClaim(); _watchRankModal(); }
        }, 1500);
    });

    console.log('[EmpyreanPatchV42] \u2705 Live-stream gamification module armed \u2014 daily check-in, points/levels (\uD83D\uDD37 diamond wealth track + \uD83D\uDC96 heart fan track), a conspicuous rank/diamond badge inline in chat (both text and gift comments), and a "Top Fans" tab added alongside the existing, untouched "Top Viewers" gift-amount ranking. Pure addition \u2014 no existing file was edited.');

})();

/* ═══════════════════════════════════════════════════════════════════════
   app-patch-v50.js — Clap sound effects for live streaming
   ═══════════════════════════════════════════════════════════════════════
   Appended below UNCHANGED per the merge note at the top of this file. */
/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v50
   app-patch-v50.js  |  Load LAST (after every live-streaming file —
   app-live.js, app-live-tiktok-patch.js, app-live-final.js, app-fixes.js)

   FEATURE — CLAP SOUND EFFECTS FOR LIVE STREAMING

   REQUESTED: a clapping sound, triggered three ways —
     1. A dedicated 👏 button any viewer/guest can tap, in the live footer.
     2. Automatically whenever ANYONE sends a gift.
     3. A host-only "hype" clap, louder, from the host control panel.
   All three need to be heard by EVERYONE watching, not just the person who
   triggered it — same requirement gifts already meet.

   ═══════════════════════════════════════════════════════════════════════
   WHY THIS COULD BE BUILT AS A PURE ADDITIVE FILE
   ═══════════════════════════════════════════════════════════════════════
   Trigger #2 (gift claps) needs no new sync mechanism at all: every gift,
   whether sent locally or received via app-live-tiktok-patch.js's
   attachGiftSyncListener(), already funnels through ONE function —
   window.showGiftAnimation(symbol, giftName) (app-fixes.js, exposed on
   window; called at app-fixes.js:251 for local sends and
   app-live-tiktok-patch.js:2525 for synced remote gifts). Wrapping that
   single function, the same established pattern app-patch-v19.js /
   app-patch-v26.js already use elsewhere in this codebase, plays a clap on
   every device for every gift with no new listener needed.

   Triggers #1 and #3 (button taps) have no existing sync channel to piggy-
   back on, so this adds one small new collection, `live_reactions`
   (streamId, type: 'viewer_clap' | 'host_hype', senderId, ts), written on
   tap and read via a per-stream onSnapshot — the same
   attach-on-modal-open/detach-on-close lifecycle app-patch-v33.js's
   moderator cache and app-patch-v42.js's engagement cache already use. The
   sender plays their own clap instantly on tap (no round-trip delay) and
   is skipped when their own write echoes back, so nobody hears their own
   clap twice.

   Nothing in app-live.js / app-live-tiktok-patch.js / app-live-final.js /
   app-fixes.js needed editing — the one hook point (showGiftAnimation) was
   already exposed on window for exactly this kind of wrap.

   ═══════════════════════════════════════════════════════════════════════
   REQUIRED MANUAL STEPS (this patch cannot do these two on its own)
   ═══════════════════════════════════════════════════════════════════════
     1. Add an actual clap sound FILE to your static assets — e.g.
        public/sounds/clap.mp3 — and update CLAP_SOUND_URL below if you
        put it somewhere other than /sounds/clap.mp3. This patch is pure
        JS/CSS; it cannot generate or upload a binary audio file.
     2. Add `live_reactions` to firebase-rules.js with the same permissive
        rule already used for active_streams / live_gifts / live_comments:
          match /live_reactions/{doc} { allow read, write: if request.auth != null; }
   ============================================================================= */

(function empyreanPatchV50() {
    'use strict';

    if (window._empPatchV50Loaded) {
        console.warn('[V50] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV50Loaded = true;

    function log(msg) { console.log('[V50-Clap] ' + msg); }

    /* ── §0 — config ──────────────────────────────────────────────────── */
    // FIX (2026-08-02 — bug: "clap button blinks but no sound plays"):
    // this used to load CLAP_SOUND_URL ('/sounds/clap.mp3') into an
    // Audio() pool. That file was one of two "REQUIRED MANUAL STEPS"
    // this patch's own header always said it could not do by itself —
    // and it was never uploaded to static assets. Every a.play() call
    // therefore 404'd, and the try/catch around it (deliberately, so a
    // missing file could never break the live screen) swallowed that
    // failure completely: the button's pulse animation still ran (the
    // "blink" that was reported), but no sound was ever actually
    // produced, on any device, by design of that silent catch. Rather
    // than depend on a binary asset ever being uploaded (this project
    // is maintained from a phone with no desktop access — see this
    // codebase's own working-style notes — so pushing a new static
    // file is real friction), the clap is now synthesized at runtime
    // with the Web Audio API: a few short bursts of filtered noise,
    // shaped to sound like a hand-clap, need no file at all and can
    // never 404.
    var VIEWER_CLAP_COOLDOWN_MS = 350; // debounce accidental double-taps only — not a hard per-session limit

    /* ── §1 — synthesized clap playback (Web Audio API, no audio file) ── */
    var _actx = null;
    function _ensureAudioCtx() {
        if (_actx) return _actx;
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        try { _actx = new Ctx(); } catch (e) { _actx = null; }
        return _actx;
    }
    // 2026-11-08: higher-quality clap. A real hand-clap is several tiny noise bursts a few ms apart (the palms
    // never meet perfectly flat), a short low "body" thump, and a room tail. Everything runs through a
    // compressor + a small convolution room, and every clap is slightly randomised so repeats don't sound identical.
    var _clapNoise = null;
    var _clapBus = null;
    function _clapNoiseBuf(ctx) {
        if (_clapNoise && _clapNoise.sampleRate === ctx.sampleRate) return _clapNoise;
        var len = Math.floor(ctx.sampleRate * 0.8);
        var b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        _clapNoise = b;
        return b;
    }
    function _clapOut(ctx) {
        if (_clapBus && _clapBus.ctx === ctx) return _clapBus.node;
        var comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.14;
        var master = ctx.createGain(); master.gain.value = 0.95;
        comp.connect(master); master.connect(ctx.destination);
        var rl = Math.floor(ctx.sampleRate * 0.5), ir = ctx.createBuffer(2, rl, ctx.sampleRate);
        for (var ch = 0; ch < 2; ch++) {
            var dd = ir.getChannelData(ch);
            for (var i = 0; i < rl; i++) dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3);
        }
        var conv = ctx.createConvolver(); conv.buffer = ir;
        var wet = ctx.createGain(); wet.gain.value = 0.24;
        comp.connect(conv); conv.connect(wet); wet.connect(master);
        _clapBus = { ctx: ctx, node: comp };
        return comp;
    }
    function _clapBurst(ctx, dest, t, dur, freq, Q, vol) {
        var s = ctx.createBufferSource(); s.buffer = _clapNoiseBuf(ctx);
        var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = Q;
        var g = ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        s.connect(f); f.connect(g); g.connect(dest);
        s.start(t, Math.random() * 0.5, dur + 0.02);
    }
    function _synthOneClap(ctx, atTime, volume) {
        var out = _clapOut(ctx);
        var base = 1100 + Math.random() * 500;
        var offs = [0, 0.008, 0.016, 0.026, 0.037];
        var amps = [1, 0.85, 0.7, 0.55, 0.4];
        for (var i = 0; i < offs.length; i++) {
            _clapBurst(ctx, out, atTime + offs[i] + Math.random() * 0.003, 0.013, base + i * 140, 1.1, volume * amps[i]);
        }
        // room tail
        _clapBurst(ctx, out, atTime + 0.04, 0.16, 1500, 0.8, volume * 0.32);
        // low body thump
        var o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(200, atTime); o.frequency.exponentialRampToValueAtTime(95, atTime + 0.06);
        var og = ctx.createGain();
        og.gain.setValueAtTime(volume * 0.38, atTime); og.gain.exponentialRampToValueAtTime(0.001, atTime + 0.07);
        o.connect(og); og.connect(out); o.start(atTime); o.stop(atTime + 0.09);
    }
    function _playClap(volume) {
        try {
            var ctx = _ensureAudioCtx();
            if (!ctx) return; // Web Audio unavailable on this device — fail silent, never break the live screen
            // Autoplay/audio-context policies require a prior user gesture before sound can play; resuming here
            // (inside a click-triggered call) satisfies that instead of silently doing nothing forever.
            if (ctx.state === 'suspended') { ctx.resume().catch(function () {}); }
            var vol = volume == null ? 0.85 : volume;
            _synthOneClap(ctx, ctx.currentTime + 0.005, vol);
        } catch (e) { /* synthesis must never break the live screen */ }
    }

    /* ── §1b — visible clap effect (fix — root cause C: "didn't display
       on the screen"): v50 only ever animated the button itself; nothing
       on the actual video area showed a clap happened, unlike gifts.
       A brief floating 👏 burst over the stream now plays alongside
       every clap — local taps AND synced claps from other devices —
       so the reaction is visible to everyone watching, not just heard. */
    // 2026-11-08: premium classic "applause" glyph (two gold hands + burst lines) replaces the plain emoji.
    var _CLAP_SVG = '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' +
        '<defs><linearGradient id="pv50ClapGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1bd"/><stop offset="0.55" stop-color="#f7c545"/><stop offset="1" stop-color="#d9922b"/></linearGradient></defs>' +
        '<g stroke="#ffd45c" stroke-width="3" stroke-linecap="round" fill="none"><path d="M32 4v8"/><path d="M15 9l4 7"/><path d="M49 9l-4 7"/><path d="M6 22l7 3"/><path d="M58 22l-7 3"/></g>' +
        '<g stroke="#a8691a" stroke-width="1.6" stroke-linejoin="round">' +
        '<g transform="rotate(-24 25 42)"><rect x="14" y="22" width="22" height="36" rx="11" fill="url(#pv50ClapGold)"/><path d="M20 30v8M25 28v10M30 30v8" stroke="#c98a26" stroke-width="1.4" stroke-linecap="round" fill="none"/></g>' +
        '<g transform="rotate(24 39 42)"><rect x="28" y="22" width="22" height="36" rx="11" fill="url(#pv50ClapGold)"/><path d="M34 30v8M39 28v10M44 30v8" stroke="#c98a26" stroke-width="1.4" stroke-linecap="round" fill="none"/></g>' +
        '</g></svg>';
    // 2026-11-09: footer clap button = gold line-art applause glyph (same family as the rose / gift / request icons).
    var _CLAP_LINE_SVG = '<svg class="pv-clap-line" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1.8v2.4M5.8 3.6l1.2 2M18.2 3.6l-1.2 2M2.6 8.6l2.2.9M21.4 8.6l-2.2.9"/><g transform="rotate(-22 9.2 15.6)"><rect x="5.4" y="8.6" width="7.6" height="13" rx="3.8"/></g><g transform="rotate(22 14.8 15.6)"><rect x="11" y="8.6" width="7.6" height="13" rx="3.8"/></g></svg>';
    function _spawnClapBurst() {
        var stage = document.querySelector('#live-stream-screen .live-body') || document.getElementById('live-stream-screen');
        if (!stage) return;
        var n = 3 + Math.floor(Math.random() * 2); // 3-4 emoji per burst
        for (var i = 0; i < n; i++) {
            (function (i) {
                var el = document.createElement('span');
                el.className = 'pv53-clap-fx';
                el.innerHTML = _CLAP_SVG;
                var startX = 40 + Math.random() * 20; // cluster near center, small horizontal spread
                el.style.left = startX + '%';
                el.style.animationDelay = (i * 70) + 'ms';
                stage.appendChild(el);
                setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1400);
            })(i);
        }
    }

    function _us() { return window.userState || {}; }
    function myId() { return _us().id; }
    function currentStreamId() { return window.liveStreamData && window.liveStreamData.streamId; }
    function fbReady() { return !!(window.fbDb && window._firebaseLoaded); }
    // Same host check every other live-streaming patch in this codebase
    // already uses (app-patch-v33.js's isRealHost, app-live-tiktok-
    // patch.js / app-live-final.js's own copies).
    function isRealHost() {
        if (window.isGuest || !window.userState || !window.liveStreamData) return false;
        var sd = window.liveStreamData;
        var hid = sd.hostUserId || sd.hostId;
        return !!hid && window.userState.id === hid;
    }

    /* ── §2 — cross-device sync for viewer/host claps (gift claps use §4's
       existing showGiftAnimation hook instead — no new sync needed there) ── */
    var _reactUnsub = null;
    var _lastSeenTs = 0; // only play reactions that land AFTER this device starts listening — a fresh join must never replay the stream's whole clap history at once
    function _attachReactionListener() {
        _detachReactionListener();
        var sid = currentStreamId();
        if (!fbReady() || !sid) return;
        _lastSeenTs = Date.now();
        _reactUnsub = window.fbDb.collection('live_reactions').where('streamId', '==', sid)
            .onSnapshot(function (snap) {
                snap.docChanges().forEach(function (change) {
                    if (change.type !== 'added') return;
                    var d = change.doc.data() || {};
                    if (d.senderId && d.senderId === myId()) return; // sender already heard/saw it instantly, locally, on tap
                    if (!d.ts || d.ts < _lastSeenTs) return;
                    _playClap(d.type === 'host_hype' ? 1.0 : 0.85);
                    _spawnClapBurst();
                });
            }, function (err) { console.warn('[V50-Clap] reaction listener error:', err.message); });
    }
    function _detachReactionListener() { if (_reactUnsub) { _reactUnsub(); _reactUnsub = null; } }

    function _broadcastClap(type) {
        var sid = currentStreamId();
        if (!fbReady() || !sid) return;
        window.fbDb.collection('live_reactions').add({
            streamId: sid, type: type, senderId: myId() || null, ts: Date.now()
        }).catch(function (err) { console.warn('[V50-Clap] could not sync clap to other viewers:', err.message); });
    }

    /* ── §3 — viewer clap button, .live-footer, visible to everyone
       (host included — the footer is shared, same as the existing gift
       button) ── */
    var BTN_ID = 'live-clap-btn';
    var _lastViewerClap = 0;
    function _ensureViewerClapBtn() {
        // FIX (2026-08-02 — bug: "clap button appears on both host and
        // guest screen, abnormal duplication"): this footer button used
        // to be added unconditionally for every role, host included —
        // but the host already gets a dedicated, louder "hype clap"
        // button in the control panel (§5 below). Showing this plain
        // viewer version to the host too meant two claps buttons doing
        // almost the same thing on the same screen. Host now gets only
        // their own hype-clap button; everyone else (guests, viewers)
        // keeps this one, unchanged.
        if (isRealHost()) {
            var stale = document.getElementById(BTN_ID);
            if (stale) stale.remove();
            return;
        }
        var footer = document.querySelector('#live-stream-screen .live-footer');
        if (!footer || document.getElementById(BTN_ID)) return;
        var btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.type = 'button';
        btn.className = 'live-action-btn tk-footer-icon';
        btn.title = 'Clap';
        btn.innerHTML = _CLAP_LINE_SVG;
        // Right after the gift button, so it reads as one more reaction
        // alongside gifting rather than being buried before the composer.
        var giftBtn = document.getElementById('live-gift-btn');
        if (giftBtn && giftBtn.parentElement === footer) footer.insertBefore(btn, giftBtn.nextSibling);
        else footer.appendChild(btn);
        btn.addEventListener('click', function () {
            var now = Date.now();
            if (now - _lastViewerClap < VIEWER_CLAP_COOLDOWN_MS) return;
            _lastViewerClap = now;
            _playClap(0.85);
            _spawnClapBurst();
            _broadcastClap('viewer_clap');
            btn.classList.remove('pv50-clap-pulse');
            void btn.offsetWidth; // force reflow so the animation restarts on rapid taps
            btn.classList.add('pv50-clap-pulse');
        });
    }

    /* ── §4 — automatic clap on every gift. Wraps window.showGiftAnimation
       once; both local sends AND remote-synced gifts already call it, so
       this single wrap covers every device with no new listener. ── */
    (function armGiftClapWrap() {
        function tryArm() {
            var orig = window.showGiftAnimation;
            if (typeof orig !== 'function' || orig._pv50Wrapped) return;
            var wrapped = function (symbol, giftName) {
                var result = orig.apply(this, arguments);
                _playClap(0.7); // a touch quieter than a deliberate tap — this fires on every gift, including small ones
                return result;
            };
            wrapped._pv50Wrapped = true;
            window.showGiftAnimation = wrapped;
            log('wrapped window.showGiftAnimation — a clap now plays alongside every gift, local or synced.');
        }
        tryArm();
        // Same belt-and-suspenders retry timing v39/v40/v42 already use in
        // case app-fixes.js/app-live-tiktok-patch.js assign this function
        // slightly after this file first runs.
        setTimeout(tryArm, 500);
        setTimeout(tryArm, 1500);
    })();

    /* ── §5 — host "hype" clap: louder, host-only, broadcast to everyone ── */
    var HOST_BTN_ID = 'live-host-clap-btn';
    function _ensureHostClapBtn() {
        if (!isRealHost()) {
            var existing = document.getElementById(HOST_BTN_ID);
            if (existing) existing.remove();
            return;
        }
        var panel = document.getElementById('host-control-panel-inner');
        if (!panel || document.getElementById(HOST_BTN_ID)) return;
        var btn = document.createElement('button');
        btn.id = HOST_BTN_ID;
        btn.type = 'button';
        btn.className = 'live-action-btn';
        btn.title = 'Hype the crowd';
        /* FIX (2026-08-02 — broken/"X-box" icon report): this was a raw
           emoji glyph (\uD83D\uDC4F) in a <span>. Every OTHER button in this
           same panel (mic/video/goal/star/gamepad/pin, plus v55/v56/v59's
           later additions) uses the Font Awesome 6 icon font that's
           already loaded via CDN and reliably renders everywhere. Raw
           emoji instead depend on the DEVICE's own system emoji font —
           on the device this was reported from, that glyph has no local
           coverage and renders as Android's "tofu" (a box with an X),
           which is exactly the broken-icon symptom reported. Swapping to
           an FA6 icon removes that device-dependency entirely, matching
           every neighboring button in this same column. */
        btn.innerHTML = '<i class="fas fa-hands-clapping"></i>';
        panel.appendChild(btn);
        // FIX (2026-08-02 — bug 2, see the guaranteed-first capture
        // handler appended at the end of this file): exposed on window
        // so that handler can always reach the CURRENT version of this
        // action, the same "call through window.*" pattern app-patch-
        // v4.js already established for _submitQuote.
        window._pv50HostHypeClap = function () {
            _playClap(1.0);
            _spawnClapBurst();
            _broadcastClap('host_hype');
        };
        btn.addEventListener('click', function () {
            _playClap(1.0);
            _spawnClapBurst();
            _broadcastClap('host_hype');
        });
    }

    /* ── §6 — CSS: a small tap-feedback pulse on the viewer button only.
       Every button reuses the existing .live-action-btn / .tk-footer-icon
       classes for sizing, so it automatically matches its neighbors —
       nothing here overrides those. ── */
    (function injectCSS() {
        if (document.getElementById('pv50-clap-css')) return;
        var css = document.createElement('style');
        css.id = 'pv50-clap-css';
        css.textContent =
            '@keyframes pv50ClapPulse{0%{transform:scale(1);}40%{transform:scale(1.28);}100%{transform:scale(1);}}' +
            '.pv50-clap-pulse{animation:pv50ClapPulse .35s ease;}' +
            /* FIX (2026-08-02 — bug: clap "didn't display on the screen"):
               a floating 👏 that rises and fades over the stream, same
               general idea as this codebase's existing gift animations,
               so a clap is now visible to everyone watching, not just
               heard. Positioned/animated purely with CSS — no new JS
               animation loop needed. */
            '@keyframes pv53ClapFloat{0%{transform:translateY(0) scale(0.6) rotate(-8deg);opacity:0;}15%{opacity:1;transform:translateY(-20px) scale(1.15) rotate(6deg);}75%{opacity:1;}100%{transform:translateY(-160px) scale(0.9) rotate(-4deg);opacity:0;}}' +
            '#live-stream-screen .live-footer #live-clap-btn{color:#e8c766 !important;}' +
            '#live-stream-screen .live-footer #live-clap-btn .pv-clap-line{width:24px !important;height:24px !important;display:block;flex-shrink:0;}' +
            '.pv53-clap-fx svg{width:2.6rem;height:2.6rem;display:block;}' +
            '.pv53-clap-fx{position:absolute;bottom:22%;font-size:2.1rem;pointer-events:none;z-index:12;animation:pv53ClapFloat 1.3s ease-out forwards;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));}';
        document.head.appendChild(css);
    })();

    /* ── §7 — wiring: attach/detach alongside the live modal, the exact
       same #go-live-modal-overlay class-toggle trigger app-patch-v33.js /
       app-patch-v42.js already observe for their own features. ── */
    function onModalToggle() {
        var modal = document.getElementById('go-live-modal-overlay');
        if (!modal) return;
        if (modal.classList.contains('show')) {
            _attachReactionListener();
            _ensureViewerClapBtn();
            _ensureHostClapBtn();
        } else {
            _detachReactionListener();
            var vBtn = document.getElementById(BTN_ID); if (vBtn) vBtn.remove();
            var hBtn = document.getElementById(HOST_BTN_ID); if (hBtn) hBtn.remove();
        }
    }
    function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
    ready(function () {
        var modal = document.getElementById('go-live-modal-overlay');
        if (modal) {
            new MutationObserver(onModalToggle).observe(modal, { attributes: true, attributeFilter: ['class'] });
            if (modal.classList.contains('show')) onModalToggle();
        }
        // Cheap, idempotent recheck — covers a host/guest role flip mid-
        // stream (reconnect, promotion) the same way app-patch-v42.js's
        // own interval already does for its level chip.
        setInterval(function () {
            var m = document.getElementById('go-live-modal-overlay');
            if (m && m.classList.contains('show')) { _ensureViewerClapBtn(); _ensureHostClapBtn(); }
        }, 1500);
    });

    // FIX (2026-08-02 — root cause of bugs 1/2/3/4 all appearing "never
    // fixed" despite V53's fix-pack below already addressing them): this
    // closing log line referenced CLAP_SOUND_URL, a variable that no
    // longer exists now that the clap is synthesized at runtime (see the
    // §0 FIX note above — the constant was removed when the Audio()/mp3
    // approach was replaced, but this reference to it was missed).
    // Reading an undefined identifier throws a ReferenceError even just
    // to build this log string. Because empyreanPatchV50/V51/V52/V53 are
    // four separate top-level IIFE statements concatenated in ONE script
    // file, an uncaught throw from this one aborts the ENTIRE REMAINING
    // SCRIPT, not just this IIFE. Confirmed by direct execution: V51
    // (poll/chat-mode buttons), V52 (PK battle), and V53 (the bug-fix
    // pack that was supposed to fix bugs 2/3/4) never ran AT ALL, on any
    // page load, because this line always threw first. Everything in V50
    // ABOVE this line (button creation, isRealHost() gating, the Web
    // Audio synth, the floating burst) already executed by the time this
    // throws, so V50 itself was never actually broken — V53 simply never
    // got the chance to run.
    console.log('[EmpyreanPatchV50] \u2705 Clap sound wired \u2014 \uD83D\uDC4F button in the live footer for viewers, an automatic clap on every gift (local + synced, via the existing showGiftAnimation hook), and a louder host \u201chype\u201d clap in the control panel, all synced across devices via a new live_reactions collection. Pure addition \u2014 no existing live-streaming file was edited. Sound is synthesized at runtime (Web Audio) \u2014 no audio asset file required.');

})();
/* ═══════════════════════════════════════════════════════════════════════
   app-patch-v51.js — Live polls/Q&A, gift combo-streak bursts, and
   slow-mode/followers-only chat
   ═══════════════════════════════════════════════════════════════════════
   Appended below UNCHANGED per the merge note at the top of this file. */
/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v51
   app-patch-v51.js  |  Load LAST (after every live-streaming file —
   app-live.js, app-live-tiktok-patch.js, app-live-final.js, app-fixes.js —
   and after app-patch-v42.js, whose host-panel/footer button insertion
   points this file reuses)

   FEATURE BATCH — LIVE POLLS/Q&A, GIFT COMBO BURST, SLOW-MODE/FOLLOWERS-
   ONLY CHAT

   Three of the features suggested this session. The other seven (PK battle
   mode, beauty filters, scheduled streams, live shopping pin, stream
   replay, ambient music library, new-follower toast) are deliberately NOT
   in this file — see the chat message accompanying this patch for why each
   one needs either a backend/server change, a product decision, or more
   investigation before it can be built with the same confidence as these
   three. Building all ten at once risks exactly the kind of "another layer
   racing the other ones" failure this codebase's own patch history
   (app-patch-v28.js, referenced again in v31/v33/v37) already had to dig
   out of once.

   ═══════════════════════════════════════════════════════════════════════
   DATA MODEL — ZERO NEW FIRESTORE RULES NEEDED
   ═══════════════════════════════════════════════════════════════════════
   All three features store their state as FIELDS ON THE EXISTING
   active_streams/{streamId} DOCUMENT, not a new collection — the same
   approach app-patch-v33.js already used to add `isModerator` onto the
   existing `guests` array. active_streams already has a fully permissive
   `allow update: if request.auth != null;` rule (firebase-rules.js), so
   this needs no manual Firestore-rules edit at all, unlike app-patch-v42.js
   (live_engagement) and app-patch-v50.js (live_reactions), which do.

     - activePoll: { id, question, options:[{text,votes}], voterIds:{uid:optionIdx},
       open, createdBy, createdAt } — null/absent when no poll is running.
     - chatMode: 'off' | 'slow' | 'followers' , slowModeSeconds: number —
       absent/'off' by default.

   Enforcement for all of this is client-side only, same as every other
   host-only gate in this codebase (isHost() itself is a client-side field
   comparison, not a security boundary — see app-patch-v33.js's own header
   for why that's an accepted, already-documented tradeoff here, not a new
   one introduced by this file).
   ============================================================================= */

(function empyreanPatchV51() {
    'use strict';

    if (window._empPatchV51Loaded) {
        console.warn('[V51] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV51Loaded = true;

    function log(msg) { console.log('[V51] ' + msg); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function _us() { return window.userState || {}; }
    function myId() { return _us().id; }
    function currentStreamId() { return window.liveStreamData && window.liveStreamData.streamId; }
    function fbReady() { return !!(window.fbDb && window._firebaseLoaded); }
    function hostId() { var sd = window.liveStreamData; return sd && (sd.hostUserId || sd.hostId); }
    // Same host check every other live-streaming patch in this codebase
    // already uses (app-patch-v33.js / app-patch-v50.js's own copies).
    function isRealHost() {
        if (window.isGuest || !window.userState || !window.liveStreamData) return false;
        var hid = hostId();
        return !!hid && window.userState.id === hid;
    }
    function iFollowHost() {
        var hid = hostId(), fu = _us().followedUserIds;
        // userState.followedUserIds is already loaded locally with the
        // user's own profile (see app-fixes.js's follow handler) — no
        // extra Firestore read needed to answer "do I follow the host?".
        return !!(hid && fu && typeof fu.has === 'function' && fu.has(hid));
    }
    function streamDocRef() {
        var sid = currentStreamId();
        if (!fbReady() || !sid) return null;
        return window.fbDb.collection('active_streams').doc(sid);
    }

    /* =========================================================================
       §1 — one shared onSnapshot on the active_streams doc, covering both
       the poll and chat-mode fields (one listener, not two — keeps this
       file's Firestore footprint as small as app-patch-v33.js's own single
       moderator listener).
       ========================================================================= */
    var _docUnsub = null;
    var _docStreamId = null;
    var _poll = null;         // current activePoll object, or null
    var _myVoteIdx = null;    // this device's own vote on the CURRENT poll, or null
    var _chatMode = 'off';
    var _slowSeconds = 10;

    function _attachDocListener() {
        _detachDocListener();
        var ref = streamDocRef();
        if (!ref) return;
        _docStreamId = currentStreamId();
        _docUnsub = ref.onSnapshot(function (doc) {
            if (!doc.exists) return;
            var data = doc.data() || {};
            var incomingPoll = data.activePoll || null;
            var pollChangedId = !incomingPoll || !_poll || incomingPoll.id !== _poll.id;
            _poll = incomingPoll;
            if (pollChangedId) _myVoteIdx = _poll && _poll.voterIds && _poll.voterIds[myId()] != null ? _poll.voterIds[myId()] : null;
            else if (_poll && _poll.voterIds && _poll.voterIds[myId()] != null) _myVoteIdx = _poll.voterIds[myId()];

            _chatMode = data.chatMode || 'off';
            _slowSeconds = data.slowModeSeconds || 10;

            _renderPollCard();
            _refreshChatModeBanner();
            _refreshHostChatModeBtn();
        }, function (err) { console.warn('[V51] active_streams listener error:', err.message); });
    }
    function _detachDocListener() { if (_docUnsub) { _docUnsub(); _docUnsub = null; } _docStreamId = null; _poll = null; _myVoteIdx = null; _chatMode = 'off'; try { _refreshHostChatModeBtn(); } catch (eRf) {} /* 2026-11-08: keep icon in step with reset state */ }

    /* =========================================================================
       §2 — LIVE POLLS / Q&A
       ========================================================================= */
    function _openCreatePollModal() {
        var container = document.getElementById('live-stream-screen') || document.body;
        var modal = document.getElementById('pv51-poll-create-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'pv51-poll-create-modal';
            modal.className = 'live-sub-modal'; // reuse the existing sub-modal look (app-patch-v42.js's popup uses the same class) — no new modal CSS needed
            modal.innerHTML =
                '<button type="button" class="close-modal pv51-poll-close" style="color:white; z-index:5; top:5px; right:10px;">\u00d7</button>' +
                '<h3>\uD83D\uDCCA Start a Poll</h3>' +
                '<div style="padding:4px 2px;">' +
                '<input type="text" id="pv51-poll-q" placeholder="Ask a question\u2026" maxlength="120" style="width:100%;margin-bottom:10px;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.06);color:#fff;">' +
                '<input type="text" class="pv51-poll-opt" placeholder="Option 1" maxlength="40" style="width:100%;margin-bottom:8px;padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#fff;">' +
                '<input type="text" class="pv51-poll-opt" placeholder="Option 2" maxlength="40" style="width:100%;margin-bottom:8px;padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#fff;">' +
                '<input type="text" class="pv51-poll-opt" placeholder="Option 3 (optional)" maxlength="40" style="width:100%;margin-bottom:8px;padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#fff;">' +
                '<input type="text" class="pv51-poll-opt" placeholder="Option 4 (optional)" maxlength="40" style="width:100%;margin-bottom:12px;padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#fff;">' +
                '<button type="button" id="pv51-poll-start-btn" class="btn btn-accent" style="width:100%;">Start Poll</button>' +
                '</div>';
            container.appendChild(modal);
            modal.querySelector('.pv51-poll-close').addEventListener('click', function () { modal.classList.remove('show'); });
            modal.querySelector('#pv51-poll-start-btn').addEventListener('click', _createPoll);
        }
        // FIX (bug report: "works on the first tap, then stops responding"):
        // this used to be a plain `.classList.add('show')` — fine for the
        // FIRST tap, but every tap after that landed on an already-open
        // modal, so `.add('show')` was a true no-op: nothing visibly
        // changed, which reads exactly like the button had stopped
        // working. Same root cause and same fix as pv55's sound/beauty
        // modals and pv56's pin-a-product picker: toggle instead, so a
        // second tap on the poll icon closes it like every other
        // toggleable icon on this panel.
        if (!modal.classList.contains('show')) { if (window._empCloseOtherLiveSheets) window._empCloseOtherLiveSheets(modal); }
        modal.classList.toggle('show');
    }
    // FIX (2026-08-02 — bug 2): exposed on window for the same reason as
    // window._pv50HostHypeClap above — reached from the guaranteed-first
    // capture handler appended at the end of this file.
    window._pv51OpenPollModal = _openCreatePollModal;
    function _createPoll() {
        var q = (document.getElementById('pv51-poll-q') || {}).value || '';
        q = q.trim();
        if (!q) { notify('Add a question first.', 'warning'); return; }
        var opts = Array.prototype.slice.call(document.querySelectorAll('.pv51-poll-opt'))
            .map(function (i) { return (i.value || '').trim(); })
            .filter(Boolean);
        if (opts.length < 2) { notify('Add at least two options.', 'warning'); return; }
        var ref = streamDocRef();
        if (!ref) return;
        var poll = {
            id: 'poll-' + Date.now(),
            question: q,
            options: opts.map(function (t) { return { text: t, votes: 0 }; }),
            voterIds: {},
            open: true,
            createdBy: myId(),
            createdAt: Date.now()
        };
        ref.update({ activePoll: poll }).then(function () {
            var modal = document.getElementById('pv51-poll-create-modal');
            if (modal) modal.classList.remove('show');
            notify('\uD83D\uDCCA Poll started!', 'success');
        }).catch(function (err) { notify('Could not start poll: ' + (err.message || 'try again.'), 'error'); });
    }
    function _endPoll() {
        var ref = streamDocRef();
        if (!ref || !_poll) return;
        var closed = Object.assign({}, _poll, { open: false });
        ref.update({ 'activePoll.open': false }).catch(function (err) { console.warn('[V51] could not close poll:', err.message); });
    }
    function _vote(optionIdx) {
        var uid = myId();
        if (!uid) { notify('Sign in to vote.', 'warning'); return; }
        var ref = streamDocRef();
        if (!ref || !window.fbDb) return;
        window.fbDb.runTransaction(function (tx) {
            return tx.get(ref).then(function (doc) {
                var data = doc.data() || {};
                var poll = data.activePoll;
                if (!poll || !poll.open) throw new Error('pv51-no-active-poll');
                var voterIds = poll.voterIds || {};
                if (Object.prototype.hasOwnProperty.call(voterIds, uid)) throw new Error('pv51-already-voted');
                voterIds = Object.assign({}, voterIds);
                voterIds[uid] = optionIdx;
                var options = poll.options.slice();
                options[optionIdx] = Object.assign({}, options[optionIdx], { votes: (options[optionIdx].votes || 0) + 1 });
                tx.update(ref, { 'activePoll.voterIds': voterIds, 'activePoll.options': options });
            });
        }).then(function () {
            _myVoteIdx = optionIdx; // optimistic — the listener will confirm shortly
            _renderPollCard();
        }).catch(function (err) {
            if (err && err.message === 'pv51-already-voted') { /* another tab/device already recorded it — just resync silently */ }
            else if (err && err.message !== 'pv51-no-active-poll') notify('Could not record your vote — try again.', 'error');
        });
    }
    function _renderPollCard() {
        var existing = document.getElementById('pv51-poll-card');
        if (!_poll) { if (existing) existing.remove(); return; }

        var card = existing;
        if (!card) {
            var host = document.getElementById('live-stream-screen');
            if (!host) return;
            card = document.createElement('div');
            card.id = 'pv51-poll-card';
            host.appendChild(card);
        }

        var totalVotes = _poll.options.reduce(function (s, o) { return s + (o.votes || 0); }, 0);
        var optionsHTML = _poll.options.map(function (o, i) {
            var pct = totalVotes ? Math.round((100 * (o.votes || 0)) / totalVotes) : 0;
            var mine = _myVoteIdx === i;
            var voted = _myVoteIdx != null;
            return '<button type="button" class="pv51-poll-opt-btn' + (mine ? ' pv51-poll-opt-mine' : '') + '" data-pv51-opt="' + i + '"' + (voted ? ' disabled' : '') + '>' +
                '<span class="pv51-poll-opt-fill" style="width:' + (voted ? pct : 0) + '%;"></span>' +
                '<span class="pv51-poll-opt-label">' + esc(o.text) + (voted ? ' \u2014 ' + pct + '%' : '') + (mine ? ' \u2713' : '') + '</span>' +
                '</button>';
        }).join('');

        card.className = 'pv51-poll-card' + (_poll.open ? '' : ' pv51-poll-closed');
        card.innerHTML =
            '<div class="pv51-poll-head"><span>\uD83D\uDCCA ' + esc(_poll.question) + '</span>' +
            (isRealHost() && _poll.open ? '<button type="button" id="pv51-poll-end-btn" title="End poll">\u00d7</button>' : '') +
            '</div>' +
            optionsHTML +
            (!_poll.open ? '<div class="pv51-poll-final">Poll closed \u2014 ' + totalVotes + ' vote' + (totalVotes === 1 ? '' : 's') + '</div>' : '');

        if (isRealHost() && _poll.open) {
            var endBtn = document.getElementById('pv51-poll-end-btn');
            if (endBtn) endBtn.addEventListener('click', _endPoll);
        }
        if (_poll.open && _myVoteIdx == null) {
            card.querySelectorAll('[data-pv51-opt]').forEach(function (btn) {
                btn.addEventListener('click', function () { _vote(parseInt(btn.getAttribute('data-pv51-opt'), 10)); });
            });
        }
    }

    /* =========================================================================
       §3 — GIFT COMBO BURST. Wraps window.createLiveGiftComment (already
       wrapped once by app-patch-v42.js for badge decoration — wrapping it
       again here just adds one more layer, the same established decorator
       pattern, and doesn't touch v42's own wrap). createLiveGiftComment
       (app-fixes.js) stores the running per-row combo count in
       row.dataset.giftCount, incrementing IN PLACE on the same DOM node
       for repeat gifts from the same sender — this reads that count right
       after each call to decide whether a milestone was just crossed.
       ========================================================================= */
    var COMBO_MILESTONES = [5, 10, 25, 50, 100, 250, 500];
    function _showComboBurst(username, giftName, count) {
        var host = document.getElementById('live-stream-screen');
        if (!host) return;
        var el = document.createElement('div');
        el.className = 'pv51-combo-burst';
        el.innerHTML =
            '<div class="pv51-combo-x">\u00d7' + count + '</div>' +
            '<div class="pv51-combo-sub">' + esc(username) + ' \u2014 ' + esc(giftName) + ' COMBO!</div>';
        host.appendChild(el);
        el.addEventListener('animationend', function () { el.remove(); });
        setTimeout(function () { if (el.parentNode) el.remove(); }, 2200); // safety net if animationend is ever missed
    }
    (function armComboWrap() {
        function tryArm() {
            var orig = window.createLiveGiftComment;
            if (typeof orig !== 'function' || orig._pv51Wrapped) return;
            var wrapped = function (username, avatarUrl, giftSymbol, giftName, userId) {
                var result = orig.apply(this, arguments);
                try {
                    var list = document.getElementById('live-comments-list');
                    var row = list && list.firstElementChild;
                    if (row && row.classList.contains('tk-gift-comment')) {
                        var count = parseInt(row.dataset.giftCount, 10) || 1;
                        if (COMBO_MILESTONES.indexOf(count) !== -1) _showComboBurst(username, giftName, count);
                    }
                } catch (e) { /* a combo-animation glitch must never break gift rendering itself */ }
                return result;
            };
            wrapped._pv51Wrapped = true;
            window.createLiveGiftComment = wrapped;
        }
        tryArm();
        setTimeout(tryArm, 500);
        setTimeout(tryArm, 1500);
    })();

    /* =========================================================================
       §4 — SLOW MODE / FOLLOWERS-ONLY CHAT
       ========================================================================= */
    var _lastMyCommentAt = 0;
    function _cycleChatMode() {
        /* 2026-11-08 FIX ("clicking the chat icon does nothing"): the old version returned silently when
           it wasn't ready, and only moved the icon after the Firestore snapshot came back — which never
           happened when the stream-doc listener hadn't attached (see the interval re-attach below). It now
           applies the new mode instantly, tells the host, then saves it; a failed save rolls back with a
           visible message. Old guards kept for reference:
           if (!isRealHost()) return; var ref = streamDocRef(); if (!ref) return; */
        if (!isRealHost()) { notify('Only the host can change chat mode.', 'info'); return; }
        var ref = streamDocRef();
        var next = _chatMode === 'off' ? 'slow' : (_chatMode === 'slow' ? 'followers' : 'off');
        var _prevChatMode = _chatMode;
        _chatMode = next;
        _refreshHostChatModeBtn();
        _refreshChatModeBanner();
        var labels = { off: 'Chat mode: Off', slow: '\uD83D\uDC22 Slow mode on (' + (_slowSeconds || 10) + 's between messages)', followers: '\uD83D\uDD12 Followers-only chat on' };
        // 2026-11-08 (second pass, "icon still does nothing"): always confirm the tap on screen straight away - the
        // old code only toasted after the Firestore write came back, so a slow/failed/never-resolving write looked
        // exactly like a dead button.
        notify(labels[next], 'info');
        if (!ref) return; // local-only until the stream doc exists; the mode is already applied on this device
        ref.update({ chatMode: next, slowModeSeconds: _slowSeconds || 10 }).catch(function (err) {
            console.warn('[V51] could not change chat mode:', err && err.message);
            // The stream doc may simply not exist yet (broadcast still connecting): keep the mode on this device
            // instead of snapping the icon back, which also read as "nothing happened".
            if (err && (err.code === 'not-found' || /no document to update/i.test(err.message || ''))) {
                notify('Chat mode saved on this device; it will reach viewers once your broadcast connects.', 'info');
                return;
            }
            _chatMode = _prevChatMode; _refreshHostChatModeBtn(); _refreshChatModeBanner();
            notify('Could not change chat mode: ' + ((err && err.message) || 'try again.'), 'error');
        });
    }
    // FIX (2026-08-02 — bug 2): exposed on window, same reason as the two
    // window exposures above.
    window._pv51CycleChatMode = _cycleChatMode;
    window._pv51RefreshChatModeBtn = function () { try { _refreshHostChatModeBtn(); } catch (e) {} };
    function _refreshHostChatModeBtn() {
        var btn = document.getElementById('pv51-chatmode-btn');
        if (!btn) return;
        /* FIX (2026-08-02 — broken/"X-box" icon report): same root cause
           and fix as the clap/poll buttons above — this was a 3-state map
           of raw emoji glyphs, which is exactly what showed as a broken
           tofu box on the reporting device. Each state now maps to a FA6
           icon-font glyph instead, so it renders reliably regardless of
           the device's own emoji font coverage. */
        var icons = { off: 'fa-comment-dots', slow: 'fa-hourglass-half', followers: 'fa-lock' };
        /* 2026-11-08: drawn as inline SVG (always renders — on the Preview/offline build the icon-font glyph
           for this button came out blank, leaving an empty box). Old line kept for reference:
           btn.innerHTML = '<i class="fas ' + icons[_chatMode] + '"></i>'; */
        var _svgHead = '<svg viewBox="0 0 24 24" width="1.15em" height="1.15em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;margin:auto;">';
        var _svgBody = _chatMode === 'slow'
            ? '<path d="M6 3h12M6 21h12M7 3v3.5c0 1.6 1.2 2.9 2.7 4L12 12l2.3-1.5c1.5-1.1 2.7-2.4 2.7-4V3M7 21v-3.5c0-1.6 1.2-2.9 2.7-4L12 12l2.3 1.5c1.5 1.1 2.7 2.4 2.7 4V21"/>'
            : (_chatMode === 'followers'
                ? '<rect x="5" y="11" width="14" height="10" rx="2.2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'
                : '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.6-.8L3 20.5l1.5-4.6A8.4 8.4 0 0 1 3 11.5C3 6.8 7 3 12 3s9 3.8 9 8.5z"/><circle cx="8.5" cy="11.5" r=".9" fill="currentColor"/><circle cx="12" cy="11.5" r=".9" fill="currentColor"/><circle cx="15.5" cy="11.5" r=".9" fill="currentColor"/>');
        btn.innerHTML = _svgHead + _svgBody + '</svg>';
        btn.title = _chatMode === 'off' ? 'Chat: Off (tap to enable slow mode)' : (_chatMode === 'slow' ? 'Slow mode on (tap for followers-only)' : 'Followers-only on (tap to turn off)');
    }
    function _ensureHostChatModeBtn() {
        if (!isRealHost()) {
            var existing = document.getElementById('pv51-chatmode-btn');
            if (existing) existing.remove();
            var pollBtn = document.getElementById('pv51-poll-btn');
            if (pollBtn) pollBtn.remove();
            return;
        }
        var panel = document.getElementById('host-control-panel-inner');
        if (!panel) return;
        if (!document.getElementById('pv51-chatmode-btn')) {
            var btn = document.createElement('button');
            btn.id = 'pv51-chatmode-btn';
            btn.type = 'button';
            btn.className = 'live-action-btn';
            btn.addEventListener('click', _cycleChatMode);
            panel.appendChild(btn);
            _refreshHostChatModeBtn();
        }
        if (!document.getElementById('pv51-poll-btn')) {
            var pbtn = document.createElement('button');
            pbtn.id = 'pv51-poll-btn';
            pbtn.type = 'button';
            pbtn.className = 'live-action-btn';
            pbtn.title = 'Start a poll';
            /* FIX (2026-08-02 — broken/"X-box" icon report): same root
               cause and fix as the clap button above — raw emoji ->
               FA6 icon-font glyph, so it renders regardless of the
               device's own emoji font coverage. */
            pbtn.innerHTML = '<i class="fas fa-square-poll-vertical"></i>';
            pbtn.addEventListener('click', _openCreatePollModal);
            panel.appendChild(pbtn);
        }
    }
    function _refreshChatModeBanner() {
        var footer = document.querySelector('#live-stream-screen .live-footer');
        if (!footer) return;
        var existing = document.getElementById('pv51-chatmode-banner');
        var blocked = _chatMode === 'followers' && !isRealHost() && !iFollowHost();
        if (_chatMode === 'off' || isRealHost()) { if (existing) existing.remove(); return; }
        if (!existing) {
            existing = document.createElement('div');
            existing.id = 'pv51-chatmode-banner';
            footer.parentNode.insertBefore(existing, footer);
        }
        existing.className = 'pv51-chatmode-banner' + (blocked ? ' pv51-chatmode-blocked' : '');
        existing.textContent = _chatMode === 'slow'
            ? ('\uD83D\uDC22 Slow mode: ' + _slowSeconds + 's between messages')
            : (blocked ? '\uD83D\uDD12 Only followers of the host can chat right now' : '\uD83D\uDD12 Followers-only chat is on');
    }
    // Capture-phase gate, same established pattern app-patch-v49.js already
    // uses for #p2p-transfer-form: check the rule BEFORE app-fixes.js's own
    // bubble-phase 'live-comment-form' case runs, and only block — never
    // replace — the real submit logic when the rule isn't violated.
    document.addEventListener('submit', function (e) {
        var form = e.target;
        if (!form || form.id !== 'live-comment-form') return;
        if (isRealHost()) return; // the host is never subject to their own chat-mode restriction
        if (_chatMode === 'slow') {
            var now = Date.now();
            var remaining = _slowSeconds * 1000 - (now - _lastMyCommentAt);
            if (remaining > 0) {
                e.preventDefault(); e.stopImmediatePropagation();
                notify('\uD83D\uDC22 Slow mode \u2014 wait ' + Math.ceil(remaining / 1000) + 's before your next message.', 'warning');
                return;
            }
            _lastMyCommentAt = now;
        } else if (_chatMode === 'followers') {
            if (!iFollowHost()) {
                e.preventDefault(); e.stopImmediatePropagation();
                notify('\uD83D\uDD12 Only followers of the host can chat right now \u2014 follow to join in.', 'warning');
                return;
            }
        }
    }, true);

    /* =========================================================================
       §5 — CSS (all class names prefixed pv51- to guarantee zero collision
       with any existing selector).
       ========================================================================= */
    (function injectCSS() {
        if (document.getElementById('pv51-css')) return;
        var css = document.createElement('style');
        css.id = 'pv51-css';
        css.textContent =
            /* Poll card — floats near the top of the stream, out of the
               way of the host video and the guest-box grid on the right. */
            '.pv51-poll-card{position:absolute;top:70px;left:12px;right:100px;z-index:15;background:rgba(10,14,39,0.82);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.14);border-radius:14px;padding:10px 12px;max-width:320px;}' +
            '.pv51-poll-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:800;font-size:0.82rem;color:#fff;margin-bottom:8px;}' +
            '.pv51-poll-head button{background:rgba(255,255,255,0.12);border:none;color:#fff;width:22px;height:22px;border-radius:50%;font-size:0.9rem;line-height:1;cursor:pointer;flex-shrink:0;}' +
            '.pv51-poll-opt-btn{position:relative;display:block;width:100%;text-align:left;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.14);color:#fff;border-radius:9px;padding:8px 10px;margin-bottom:6px;font-size:0.78rem;font-weight:600;cursor:pointer;overflow:hidden;}' +
            '.pv51-poll-opt-btn:disabled{cursor:default;}' +
            '.pv51-poll-opt-fill{position:absolute;top:0;left:0;bottom:0;background:linear-gradient(90deg,rgba(62,123,250,0.55),rgba(62,123,250,0.25));transition:width .4s ease;}' +
            '.pv51-poll-opt-label{position:relative;z-index:1;}' +
            '.pv51-poll-opt-mine{border-color:#3E7BFA;}' +
            '.pv51-poll-final{font-size:0.7rem;color:#9fb0d6;margin-top:2px;}' +
            '.pv51-poll-closed{opacity:0.85;}' +
            /* Combo burst — brief full-width flash, center of the stream. */
            '@keyframes pv51ComboIn{0%{opacity:0;transform:translate(-50%,-40%) scale(0.6);}30%{opacity:1;transform:translate(-50%,-50%) scale(1.08);}70%{opacity:1;transform:translate(-50%,-50%) scale(1);}100%{opacity:0;transform:translate(-50%,-56%) scale(1);}}' +
            '.pv51-combo-burst{position:absolute;top:42%;left:50%;z-index:30;text-align:center;pointer-events:none;animation:pv51ComboIn 1.9s ease forwards;}' +
            '.pv51-combo-x{font-size:2.6rem;font-weight:900;color:#F5C518;text-shadow:0 0 14px rgba(245,197,24,0.75),0 2px 6px rgba(0,0,0,0.6);}' +
            '.pv51-combo-sub{font-size:0.85rem;font-weight:700;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,0.6);margin-top:2px;}' +
            /* Chat-mode banner, sits directly above the composer footer. */
            '.pv51-chatmode-banner{background:rgba(245,197,24,0.14);border-top:1px solid rgba(245,197,24,0.3);color:#F5C518;font-size:0.72rem;font-weight:700;text-align:center;padding:5px 10px;}' +
            '.pv51-chatmode-banner.pv51-chatmode-blocked{background:rgba(239,68,68,0.16);border-top-color:rgba(239,68,68,0.35);color:#f87171;}';
        document.head.appendChild(css);
    })();

    /* =========================================================================
       §6 — wiring: attach/detach alongside the live modal, the same
       #go-live-modal-overlay class-toggle trigger app-patch-v33.js /
       app-patch-v42.js / app-patch-v50.js already observe.
       ========================================================================= */
    function onModalToggle() {
        var modal = document.getElementById('go-live-modal-overlay');
        if (!modal) return;
        if (modal.classList.contains('show')) {
            _attachDocListener();
            setTimeout(_ensureHostChatModeBtn, 400);
        } else {
            _detachDocListener();
            var pollCard = document.getElementById('pv51-poll-card'); if (pollCard) pollCard.remove();
            var banner = document.getElementById('pv51-chatmode-banner'); if (banner) banner.remove();
            var cbtn = document.getElementById('pv51-chatmode-btn'); if (cbtn) cbtn.remove();
            var pbtn = document.getElementById('pv51-poll-btn'); if (pbtn) pbtn.remove();
            var createModal = document.getElementById('pv51-poll-create-modal'); if (createModal) createModal.remove();
        }
    }
    function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
    ready(function () {
        var modal = document.getElementById('go-live-modal-overlay');
        if (modal) {
            new MutationObserver(onModalToggle).observe(modal, { attributes: true, attributeFilter: ['class'] });
            if (modal.classList.contains('show')) onModalToggle();
        }
        // Cheap, idempotent recheck for a host/guest role flip mid-stream —
        // same interval pattern app-patch-v42.js already uses for its own
        // level chip.
        setInterval(function () {
            var m = document.getElementById('go-live-modal-overlay');
            if (m && m.classList.contains('show')) {
                _ensureHostChatModeBtn();
                /* 2026-11-08: the doc listener used to attach ONLY when the go-live modal first opened — before
                   the stream id exists — so it silently never attached. Retry until it does. */
                try { if (fbReady() && currentStreamId() && (_docStreamId !== currentStreamId() || !_docUnsub)) _attachDocListener(); } catch (eAtt) {}
            }
        }, 1500);
    });

    console.log('[EmpyreanPatchV51] \u2705 Live polls/Q&A (host \uD83D\uDCCA button in the control panel), gift combo-streak bursts (milestones: ' + COMBO_MILESTONES.join(', ') + '), and slow-mode/followers-only chat (host toggle, cycles Off \u2192 Slow \u2192 Followers-only) all wired \u2014 all three stored as fields on the existing active_streams document, so no new Firestore rule is needed. Pure addition \u2014 no existing live-streaming file was edited.');

})();
/* ═══════════════════════════════════════════════════════════════════════
   app-patch-v52.js — PK / Battle Mode (two hosts, split-screen, timed
   gift totals, forfeit animation)
   ═══════════════════════════════════════════════════════════════════════
   Appended below UNCHANGED per the merge note at the top of this file. */
/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v52
   app-patch-v52.js  |  Load LAST (after every live-streaming file —
   app-live.js, app-live-tiktok-patch.js, app-live-final.js, app-fixes.js —
   and after app-patch-v42.js/v50/v51, whose host-control-panel insertion
   point and listener lifecycle this file reuses)

   FEATURE — PK / BATTLE MODE

   REQUESTED: two hosts live simultaneously, split-screen, timed gift
   totals, loser gets a forfeit animation.

   ═══════════════════════════════════════════════════════════════════════
   WHY THIS COULD BE BUILT AS A PURE ADDITIVE FILE
   ═══════════════════════════════════════════════════════════════════════
   The brief for this feature says "Agora dual-client (already proven via
   guest-broadcast)". Verified directly against app-live-tiktok-patch.js's
   promoteToGuestBroadcaster(): a device already runs its normal
   host/viewer client PLUS one independent extra AgoraRTC.createClient()
   for a second role, side by side, with no interference between them (the
   existing echo-prevention convention — window._empOwnGuestUid — is the
   proof this already works safely in production here). PK battle reuses
   that exact proven shape one level further: every device already
   watching either side of the battle (that side's own host AND every one
   of that side's viewers) opens ONE MORE independent, audience-only Agora
   client that joins ONLY the opponent's channel (never the opponent's own
   viewer/chat data) purely to render their video into the other half of
   the screen. Nobody's existing client, channel membership, or chat feed
   is touched — each side's stream keeps running exactly as it already
   does; PK battle is a synchronized OVERLAY on top of two independently
   unmodified streams, not a merge of them.

   The other proven building block this reuses: gift totals. Every gift
   already lands in `live_gifts` (streamId, senderId, amount, createdAt) —
   the same collection app-patch-v42.js's own gift-points track and the
   existing viewer-rankings modal already read. This file adds two more
   independent, read-only listeners on that same collection (one per
   competing streamId), which is the same "many independent listeners on
   one collection" pattern already established by
   attachGiftCountListener + attachGiftSyncListener + loadViewerRankings +
   app-patch-v42.js's own gift-points listener. Verified the exact gift
   doc shape by reading the write site directly (app-fixes.js's gift-
   catalog send path) — `createdAt` is a client-set `new Date().toISOString()`
   string, which sorts and compares correctly as a battle-window cutoff
   without needing a Firestore range query (see §8 below for why that
   matters: an equality + range compound query would need a NEW composite
   index, which this file deliberately avoids needing).

   Nothing in app-live.js / app-live-tiktok-patch.js / app-live-final.js /
   app-fixes.js needed editing — window._fetchLiveAgoraToken and
   window._liveAgoraAppId (both already exposed on window for exactly
   this kind of second-client join) are reused as-is.

   ═══════════════════════════════════════════════════════════════════════
   DATA MODEL
   ═══════════════════════════════════════════════════════════════════════
   ONE new collection, `pk_battles` (a battle spans two independent stream
   documents, so — unlike v51's three features — this genuinely cannot be
   just a field on one existing doc; it needs its own doc both hosts and
   both audiences can read). Doc id = battleId.
     { battleId, status: 'invited'|'active'|'ended'|'declined'|'cancelled',
       inviterId, hostAId, hostBId,          // top-level, for querying
       hostA: {userId,streamId,name,avatar,channel,agoraUid},
       hostB: {userId,streamId,name,avatar,channel,agoraUid},
       durationSeconds, startedAt, endsAt, winnerId, createdAt }

   PLUS one new field on the EXISTING active_streams document (mirrors
   v51's own "fields on active_streams" convention for anything that only
   needs to live on one side): `activePkBattleId` — written by each host
   onto their OWN stream doc only, once their side has actually joined an
   active battle. This is how a brand-new viewer (or this device
   reconnecting) discovers "this stream is mid-battle" from the exact
   per-stream doc it's already subscribed to, without a separate query.

   Firestore rule needed (this file's one manual step, same category as
   app-patch-v42.js's live_engagement and app-patch-v50.js's
   live_reactions): `pk_battles` needs the same permissive
   `allow read, write: if request.auth != null;` this codebase already
   uses for active_streams/live_gifts/live_comments — no new rule pattern,
   just one more collection on the existing allow-list. active_streams
   itself already allows `update: if request.auth != null` (verified
   directly against firebase-rules.js), so activePkBattleId needs no rule
   change at all.

   ═══════════════════════════════════════════════════════════════════════
   WINNER DETERMINATION — single-writer-with-fallback, not a vote
   ═══════════════════════════════════════════════════════════════════════
   Every device (both hosts, every viewer on either side) computes the
   same two gift totals independently and locally, from the same
   `live_gifts` data with the same shared startedAt cutoff (read from the
   one battle doc) — so they agree by construction, not by coordination.
   Only writing "the battle is over" needs exactly one actor: host A's own
   device attempts it the instant its local countdown reaches endsAt,
   guarded by a Firestore transaction that only applies if status is still
   'active' (so a duplicate attempt is always a safe no-op, the same
   transaction-guard shape app-patch-v51.js's own poll-vote transaction
   already uses in this codebase). Host B's device attempts the same
   transaction 3s later ONLY if the battle doc is still 'active' at that
   point — a fallback for the (rare) case host A's tab closed right at the
   buzzer — so there is never a scenario where a battle is left "active"
   forever with nobody able to close it out.
   ============================================================================= */

(function empyreanPatchV52() {
    'use strict';

    if (window._empPatchV52Loaded) {
        console.warn('[V52] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV52Loaded = true;

    function log(msg) { console.log('[V52-PK] ' + msg); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    /* ── §0 — config ─────────────────────────────────────────────────── */
    var DURATION_PRESETS = [180, 300, 600]; // 3 / 5 / 10 minutes
    var DEFAULT_DURATION_IDX = 1;           // 5 minutes
    var INVITE_EXPIRE_MS = 25000;           // auto-decline/auto-cancel an unanswered invite
    var END_FALLBACK_DELAY_MS = 3000;       // host B's fallback end attempt, after host A's
    var FALLBACK_APP_ID = '056a96cf521d4d06887a84319c62912b'; // same fallback app-live-tiktok-patch.js already uses

    /* ── §1 — shared helpers, same shape every other live-streaming patch
       in this codebase already uses (app-patch-v33/v42/v50/v51's own
       copies) ── */
    function _us() { return window.userState || {}; }
    function myId() { return _us().id; }
    function currentStreamId() { return window.liveStreamData && window.liveStreamData.streamId; }
    function fbReady() { return !!(window.fbDb && window._firebaseLoaded); }
    function myHostAgoraUid() {
        /* 2026-11-08: prefer the uid this device actually joined Agora with; liveStreamData.hostAgoraUid only
           arrives after the Firestore round-trip, so an early challenge went out with a null uid and the
           opponent's video was never matched/rendered. Old: return window.liveStreamData && window.liveStreamData.hostAgoraUid; */
        var sd = window.liveStreamData || {};
        if (window._agoraActiveUid != null) return window._agoraActiveUid;
        if (sd.hostAgoraUid != null) return sd.hostAgoraUid;
        return sd._agoraUid != null ? sd._agoraUid : undefined;
    }
    function myChannel() {
        return window._agoraActiveChannel || (window.liveStreamData && window.liveStreamData.streamId ? ('empyrean-' + window.liveStreamData.streamId) : null);
    }
    function isRealHost() {
        if (window.isGuest || !window.userState || !window.liveStreamData) return false;
        var sd = window.liveStreamData;
        var hid = sd.hostUserId || sd.hostId;
        return !!hid && window.userState.id === hid;
    }
    function streamDocRef(sid) {
        sid = sid || currentStreamId();
        if (!fbReady() || !sid) return null;
        return window.fbDb.collection('active_streams').doc(sid);
    }
    function battleDocRef(id) {
        if (!fbReady() || !id) return null;
        return window.fbDb.collection('pk_battles').doc(id);
    }
    function agoraAppId() { return (window._liveAgoraAppId && window._liveAgoraAppId()) || FALLBACK_APP_ID; }
    function _pkAudienceUid() {
        // Distinct offset range (700001+) from the guest-broadcast formula
        // (100001+, see safeGuestUid/_agoraUidFor/_agoraUidForUserId — must
        // stay in sync across those three) so this third kind of client
        // can never collide with a guest uid inside the SAME channel.
        var base = String(myId() || Math.random());
        var h = 0;
        for (var i = 0; i < base.length; i++) h = ((h << 5) - h) + base.charCodeAt(i);
        return (Math.abs(h) % 900000) + 700001;
    }

    /* ── §2 — state (all reset in _teardownBattleUI / on modal close) ── */
    var _myStreamDocUnsub = null;      // watches OWN active_streams doc for activePkBattleId
    var _myStreamDocStreamId = null;
    var _battleUnsub = null;           // direct listener on the known pk_battles/{battleId} doc
    var _battleId = null;
    var _battle = null;                // last-known battle doc data
    var _iAmHostA = false;
    var _iAmHostB = false;
    var _pkOpponentClient = null;
    var _giftTotals = { A: 0, B: 0 };
    var _giftSeen = { A: {}, B: {} };
    var _giftUnsubA = null, _giftUnsubB = null;
    var _endTimer = null;
    var _incomingInviteUnsub = null;   // host-only, always-on while live: "am I being challenged?"
    var _pendingInviteBattleId = null; // host A's own outstanding invite, while status is still 'invited'

    /* =========================================================================
       §3 — OWN stream-doc listener: discovers activePkBattleId the same
       way any other independent per-stream listener in this codebase
       already does (its own onSnapshot on streamDocRef(), reading just
       the one field it needs — see app-live-tiktok-patch.js's
       attachStreamListener doing exactly this for hostAgoraUid).
       ========================================================================= */
    function _attachMyStreamDocListener() {
        _detachMyStreamDocListener();
        var ref = streamDocRef();
        if (!ref) return;
        _myStreamDocStreamId = currentStreamId();
        _myStreamDocUnsub = ref.onSnapshot(function (doc) {
            if (!doc.exists) return;
            var data = doc.data() || {};
            var incomingId = data.activePkBattleId || null;
            if (incomingId !== _battleId) {
                if (incomingId) _attachBattleListener(incomingId);
                /* 2026-11-08: don't drop the battle doc we're already watching for an outstanding invite —
                   host A's own stream doc has no activePkBattleId until the battle starts, so this used to
                   cancel the accept/decline listener on the first heartbeat update. */
                else if (_battleId && (_battleId === _pendingInviteBattleId || (_battle && _battle.status === 'invited'))) { /* keep watching */ }
                else _detachBattleListener();
            }
        }, function (err) { console.warn('[V52] stream-doc listener error:', err.message); });
    }
    function _detachMyStreamDocListener() { if (_myStreamDocUnsub) { _myStreamDocUnsub(); _myStreamDocUnsub = null; } _myStreamDocStreamId = null; }

    /* =========================================================================
       §4 — direct battle-doc listener. Everything downstream (split-
       screen entry/exit, score bar, end-of-battle) is driven from here.
       ========================================================================= */
    function _attachBattleListener(id) {
        if (_battleId === id && _battleUnsub) return; // already watching this exact battle
        _detachBattleListener();
        var ref = battleDocRef(id);
        if (!ref) return;
        _battleId = id;
        _battleUnsub = ref.onSnapshot(function (doc) {
            if (!doc.exists) { _detachBattleListener(); return; }
            var data = doc.data() || {};
            var prevStatus = _battle && _battle.status;
            _battle = data;
            _iAmHostA = data.hostAId === myId();
            _iAmHostB = data.hostBId === myId();

            if (data.status === 'active') {
                if (prevStatus !== 'active') {
                    _enterBattle(data);
                    /* 2026-11-08: only host B ever wrote activePkBattleId, so host A's viewers never saw the
                       split screen. Whichever host this is, mark my own stream doc so MY viewers enter it too. */
                    try { if (isRealHost()) { var _myRef = streamDocRef(); if (_myRef) _myRef.update({ activePkBattleId: id }).catch(function () {}); } } catch (ePk) {}
                }
                _refreshScoreBar();
                _armEndTimer(data);
            } else if (data.status === 'ended') {
                if (prevStatus !== 'ended') _showEndBanner(data);
                _clearOwnActiveBattleField();
                setTimeout(_teardownBattleUI, 4200); // let the winner/forfeit banner play first
            } else if (data.status === 'declined' || data.status === 'cancelled') {
                if (_iAmHostA && _pendingInviteBattleId === id) {
                    notify(data.status === 'declined' ? '\u274C The other host declined your PK invite.' : '\u23F1\uFE0F Your PK invite expired unanswered.', 'info');
                }
                _pendingInviteBattleId = null;
                var banner = document.getElementById('pv52-invite-wait-banner'); if (banner) banner.remove();
                _detachBattleListener();
            }
        }, function (err) { console.warn('[V52] battle listener error:', err.message); });
    }
    function _detachBattleListener() {
        if (_battleUnsub) { _battleUnsub(); _battleUnsub = null; }
        if (_battleId) _teardownBattleUI();
        _battleId = null; _battle = null; _iAmHostA = false; _iAmHostB = false;
    }
    function _clearOwnActiveBattleField() {
        if (!isRealHost()) return; // only a host writes their own stream doc
        var ref = streamDocRef();
        if (ref) ref.update({ activePkBattleId: null }).catch(function () {});
    }

    /* =========================================================================
       §5 — opponent picker + sending an invite (host-only)
       ========================================================================= */
    function _openPickerModal() {
        if (!isRealHost()) { notify('Only the host can start a PK battle.', 'info'); return; }
        if (_battleId) { notify('You\u2019re already in a PK battle.', 'info'); return; }
        var container = document.getElementById('live-stream-screen') || document.body;
        var modal = document.getElementById('pv52-picker-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'pv52-picker-modal';
            modal.className = 'live-sub-modal';
            modal.innerHTML =
                '<button type="button" class="close-modal pv52-picker-close" style="color:white; z-index:5; top:5px; right:10px;">\u00d7</button>' +
                '<h3>\u2694\uFE0F Challenge a Host to PK Battle</h3>' +
                '<div style="display:flex;gap:6px;justify-content:center;margin-bottom:10px;" id="pv52-duration-picker"></div>' +
                '<div id="pv52-picker-list" style="max-height:50vh;overflow-y:auto;"><p style="text-align:center;color:#ccc;padding:20px;">Loading live hosts\u2026</p></div>';
            container.appendChild(modal);
            modal.querySelector('.pv52-picker-close').addEventListener('click', function () { modal.classList.remove('show'); });

            var durWrap = modal.querySelector('#pv52-duration-picker');
            DURATION_PRESETS.forEach(function (secs, i) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'pv52-dur-btn' + (i === DEFAULT_DURATION_IDX ? ' pv52-dur-active' : '');
                b.dataset.secs = secs;
                b.textContent = Math.round(secs / 60) + ' min';
                b.addEventListener('click', function () {
                    durWrap.querySelectorAll('.pv52-dur-btn').forEach(function (x) { x.classList.remove('pv52-dur-active'); });
                    b.classList.add('pv52-dur-active');
                });
                durWrap.appendChild(b);
            });
        }
        // FIX (bug report: "works on the first tap, then stops responding"):
        // this used to be a plain `.classList.add('show')` — a no-op on
        // every tap after the first, since the modal was already showing.
        // Same root cause and same fix as pv51/pv55/pv56 above: toggle
        // instead, and only re-fetch the live-host list when the picker is
        // actually opening (not on the tap that closes it).
        var opening = !modal.classList.contains('show');
        if (opening) { if (window._empCloseOtherLiveSheets) window._empCloseOtherLiveSheets(modal); }
        modal.classList.toggle('show');
        if (opening) _loadOtherLiveHosts();
    }
    function _loadOtherLiveHosts() {
        var list = document.getElementById('pv52-picker-list');
        if (!list) return;
        if (!fbReady()) { list.innerHTML = '<p style="text-align:center;color:#f87171;padding:20px;">Not connected yet \u2014 check your internet and try again.</p>'; return; }
        window.fbDb.collection('active_streams').where('isLive', '==', true).limit(20).get()
            .then(function (snap) {
                var mySid = currentStreamId(), myHid = myId();
                var rows = [];
                snap.forEach(function (doc) {
                    var d = doc.data() || {};
                    if (doc.id === mySid || d.hostId === myHid) return;
                    // FIX (bug: "same host listed twice in the PK challenge
                    // picker"): a host can have more than one active_streams
                    // doc at once — an orphaned one left behind by an unclean
                    // end (crash/force-quit, no proper End Live teardown; see
                    // sweepGlobalStaleStreams()'s own comment on this exact
                    // failure mode) plus their current, actually-live doc.
                    // Keying rows only on doc.id let both render as separate
                    // picker entries with the same name/avatar. De-dupe by
                    // hostId here, keeping whichever doc is actually fresh —
                    // same lastHeartbeat-first/startedAt-fallback signal
                    // app-live-tiktok-patch.js's sweepGlobalStaleStreams()
                    // already uses to tell a live stream from an abandoned
                    // one, so a stale duplicate never wins over the real one.
                    var hb = d.lastHeartbeat ? Date.parse(d.lastHeartbeat) : NaN;
                    var started = d.startedAt ? Date.parse(d.startedAt) : NaN;
                    var freshness = !isNaN(hb) ? hb : (!isNaN(started) ? started : 0);
                    var row = {
                        streamId: doc.id, hostId: d.hostId, name: d.hostName || 'Host',
                        avatar: d.hostAvatar || '', agoraUid: d.hostAgoraUid,
                        channel: d.channel || ('empyrean-' + doc.id), _freshness: freshness
                    };
                    var dupeIdx = -1;
                    for (var i = 0; i < rows.length; i++) {
                        if (rows[i].hostId === d.hostId) { dupeIdx = i; break; }
                    }
                    if (dupeIdx === -1) rows.push(row);
                    else if (freshness > rows[dupeIdx]._freshness) rows[dupeIdx] = row;
                });
                if (!rows.length) {
                    list.innerHTML = '<p style="text-align:center;color:#ccc;padding:20px;">No other hosts are live right now.</p>';
                    return;
                }
                list.innerHTML = rows.map(function (r) {
                    var av = r.avatar || ('https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(r.name));
                    return '<div class="pv52-picker-row" data-sid="' + esc(r.streamId) + '">' +
                        '<img src="' + av + '" alt="">' +
                        '<span class="pv52-picker-name">' + esc(r.name) + '</span>' +
                        '<button type="button" class="btn btn-accent pv52-challenge-btn" data-sid="' + esc(r.streamId) + '">Challenge</button>' +
                        '</div>';
                }).join('');
                rows.forEach(function (r) {
                    var btn = list.querySelector('.pv52-challenge-btn[data-sid="' + r.streamId.replace(/"/g, '') + '"]');
                    if (btn) btn.addEventListener('click', function () { _sendInvite(r); });
                });
            })
            .catch(function (err) {
                list.innerHTML = '<p style="text-align:center;color:#f87171;padding:20px;">Could not load live hosts.</p>';
                console.warn('[V52] picker load failed:', err.message);
            });
    }
    function _sendInvite(target) {
        if (!fbReady() || !currentStreamId()) { notify('Your live stream is still connecting \u2014 try the challenge again in a moment.', 'warning'); return; }
        var durBtn = document.querySelector('#pv52-duration-picker .pv52-dur-active');
        var duration = durBtn ? parseInt(durBtn.dataset.secs, 10) : DURATION_PRESETS[DEFAULT_DURATION_IDX];
        var us = _us();
        var battleId = 'pk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        var battle = {
            battleId: battleId, status: 'invited', inviterId: myId(),
            hostAId: myId(), hostBId: target.hostId,
            hostA: { userId: myId(), streamId: currentStreamId(), name: us.fullName || us.username || 'Host', avatar: us.avatar || '', channel: myChannel(), agoraUid: myHostAgoraUid() || null },
            hostB: { userId: target.hostId, streamId: target.streamId, name: target.name, avatar: target.avatar, channel: target.channel, agoraUid: target.agoraUid || null },
            durationSeconds: duration, startedAt: null, endsAt: null, winnerId: null,
            createdAt: Date.now()
        };
        window.fbDb.collection('pk_battles').doc(battleId).set(battle).then(function () {
            var modal = document.getElementById('pv52-picker-modal');
            if (modal) modal.classList.remove('show');
            _pendingInviteBattleId = battleId;
            _attachBattleListener(battleId); // watch for accept/decline directly, by id
            notify('\u2694\uFE0F Challenge sent to ' + target.name + ' \u2014 waiting for a response\u2026', 'info');
            _showInviteWaitBanner(target.name);
            setTimeout(function () {
                if (_pendingInviteBattleId !== battleId) return; // already accepted/declined
                window.fbDb.collection('pk_battles').doc(battleId).get().then(function (snap) {
                    var d = snap.data();
                    if (d && d.status === 'invited') snap.ref.update({ status: 'cancelled' }).catch(function () {});
                }).catch(function () {});
            }, INVITE_EXPIRE_MS);
        }).catch(function (err) { notify('Could not send challenge: ' + (err.message || 'try again.'), 'error'); });
    }
    function _showInviteWaitBanner(name) {
        var existing = document.getElementById('pv52-invite-wait-banner'); if (existing) existing.remove();
        var host = document.getElementById('live-stream-screen'); if (!host) return;
        var b = document.createElement('div');
        b.id = 'pv52-invite-wait-banner';
        b.className = 'pv52-invite-wait-banner';
        b.textContent = '\u23F3 Waiting for ' + name + ' to accept\u2026';
        host.appendChild(b);
    }

    /* =========================================================================
       §6 — incoming invite listener (host-only, always-on while the host's
       own stream is live — attached alongside the modal, same lifecycle
       every other host-only feature in this codebase already uses).
       ========================================================================= */
    function _attachIncomingInviteListener() {
        _detachIncomingInviteListener();
        if (!isRealHost() || !fbReady()) return;
        _incomingInviteUnsub = window.fbDb.collection('pk_battles').where('hostBId', '==', myId())
            .onSnapshot(function (snap) {
                snap.docChanges().forEach(function (change) {
                    if (change.type !== 'added' && change.type !== 'modified') return;
                    var d = change.doc.data() || {};
                    if (d.status === 'invited' && !_battleId) _showIncomingInviteModal(change.doc.id, d);
                });
            }, function (err) { console.warn('[V52] incoming-invite listener error:', err.message); });
    }
    function _detachIncomingInviteListener() { if (_incomingInviteUnsub) { _incomingInviteUnsub(); _incomingInviteUnsub = null; } }

    function _showIncomingInviteModal(battleId, battle) {
        var existing = document.getElementById('pv52-incoming-modal'); if (existing) existing.remove();
        var container = document.getElementById('live-stream-screen') || document.body;
        var modal = document.createElement('div');
        modal.id = 'pv52-incoming-modal';
        modal.className = 'live-sub-modal show';
        var secondsLeft = Math.round(INVITE_EXPIRE_MS / 1000);
        modal.innerHTML =
            '<h3>\u2694\uFE0F PK Battle Challenge</h3>' +
            '<div style="text-align:center;padding:6px 0 16px;">' +
            '<img src="' + esc(battle.hostA.avatar || ('https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(battle.hostA.name))) + '" style="width:64px;height:64px;border-radius:50%;object-fit:cover;margin-bottom:8px;">' +
            '<p style="color:#fff;font-weight:700;">' + esc(battle.hostA.name) + ' wants to battle you!</p>' +
            '<p style="color:#9fb0d6;font-size:0.8rem;">' + Math.round((battle.durationSeconds || 300) / 60) + ' minute battle \u2014 highest gift total wins</p>' +
            '<p id="pv52-incoming-countdown" style="color:#F5C518;font-size:0.75rem;margin-top:6px;">Auto-declines in ' + secondsLeft + 's</p>' +
            '</div>' +
            '<div style="display:flex;gap:10px;">' +
            '<button type="button" id="pv52-decline-btn" class="btn" style="flex:1;background:rgba(255,255,255,0.1);color:#fff;">Decline</button>' +
            '<button type="button" id="pv52-accept-btn" class="btn btn-accent" style="flex:1;">Accept</button>' +
            '</div>';
        container.appendChild(modal);

        var tick = secondsLeft;
        var timer = setInterval(function () {
            tick--;
            var el = document.getElementById('pv52-incoming-countdown');
            if (el) el.textContent = tick > 0 ? ('Auto-declines in ' + tick + 's') : 'Declining\u2026';
            if (tick <= 0) { clearInterval(timer); _respondToInvite(battleId, false); }
        }, 1000);
        function cleanup() { clearInterval(timer); modal.remove(); }
        modal.querySelector('#pv52-accept-btn').addEventListener('click', function () { cleanup(); _respondToInvite(battleId, true); });
        modal.querySelector('#pv52-decline-btn').addEventListener('click', function () { cleanup(); _respondToInvite(battleId, false); });
    }
    function _respondToInvite(battleId, accept) {
        var ref = battleDocRef(battleId);
        if (!ref || !window.fbDb) return;
        if (!accept) { ref.update({ status: 'declined' }).catch(function () {}); return; }
        var us = _us();
        window.fbDb.runTransaction(function (tx) {
            return tx.get(ref).then(function (doc) {
                var d = doc.data();
                if (!d || d.status !== 'invited') throw new Error('pv52-invite-gone');
                var now = Date.now();
                var hostB = {
                    userId: myId(), streamId: currentStreamId(), name: us.fullName || us.username || 'Host',
                    avatar: us.avatar || '', channel: myChannel(), agoraUid: myHostAgoraUid() || null
                };
                tx.update(ref, {
                    status: 'active', startedAt: now, endsAt: now + (d.durationSeconds || 300) * 1000,
                    hostB: hostB
                });
            });
        }).then(function () {
            // Now that we're an accepted participant, make sure our OWN
            // battle listener is definitely on this exact doc (it may
            // already be, from the invite notification path).
            _attachBattleListener(battleId);
            var ref2 = streamDocRef();
            if (ref2) ref2.update({ activePkBattleId: battleId }).catch(function () {});
        }).catch(function (err) {
            if (err && err.message === 'pv52-invite-gone') notify('That challenge is no longer available.', 'info');
            else notify('Could not accept the challenge — try again.', 'error');
        });
    }

    /* =========================================================================
       §7 — enter battle: split-screen UI + the opponent's dedicated,
       audience-only Agora client (see the file header for why this is
       safe to add without touching any existing client).
       ========================================================================= */
    function _opponentSide() { if (!_battle) return null; return _iAmHostA ? _battle.hostB : _battle.hostA; }
    function _mySide() { if (!_battle) return null; return _iAmHostA ? _battle.hostA : _battle.hostB; }

    function _enterBattle(battle) {
        // If I'm neither hostA nor hostB, I'm a VIEWER of one side or the
        // other — figure out which side is "mine" from the stream I'm
        // actually watching, so the split-screen always puts MY stream on
        // the left and the opponent on the right, from every device's own
        // point of view (not a global left/right that would be backwards
        // for one side's viewers).
        if (!_iAmHostA && !_iAmHostB) {
            var mySid = currentStreamId();
            _iAmHostA = battle.hostA && battle.hostA.streamId === mySid;
            _iAmHostB = battle.hostB && battle.hostB.streamId === mySid;
            if (!_iAmHostA && !_iAmHostB) return; // watching neither side (shouldn't happen — safety net)
        }
        var opp = _opponentSide();
        if (!opp) return;

        var screen = document.getElementById('live-stream-screen');
        if (screen) screen.classList.add('pv52-split-active');
        _ensureScoreBar();
        _joinOpponentAsAudience(opp);
        _attachGiftListeners(battle);

        var pickBtn = document.getElementById('pv52-pk-btn'); if (pickBtn) pickBtn.style.display = 'none';
        var waitBanner = document.getElementById('pv52-invite-wait-banner'); if (waitBanner) waitBanner.remove();
    }

    async function _joinOpponentAsAudience(opp) {
        if (!window._agoraAvailable || typeof AgoraRTC === 'undefined' || !opp.channel) return;
        try {
            _pkOpponentClient = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
            await _pkOpponentClient.setClientRole('audience');
            var uid = _pkAudienceUid();
            var tokenRes = window._fetchLiveAgoraToken
                ? await window._fetchLiveAgoraToken(opp.channel, uid, 'viewer')
                : { token: null, appId: agoraAppId(), uid: uid };
            var joinAppId = tokenRes.appId || agoraAppId();
            var joinUid = (tokenRes.uid !== undefined && tokenRes.uid !== null) ? tokenRes.uid : uid;
            await _pkOpponentClient.join(joinAppId, opp.channel, tokenRes.token, joinUid);
            log('joined opponent channel ' + opp.channel + ' as audience-only for split-screen.');

            _pkOpponentClient.on('user-published', async function (remoteUser, mediaType) {
                try {
                    var isOppHost = opp.agoraUid != null && String(remoteUser.uid) === String(opp.agoraUid);
                    if (!isOppHost) return; // only render the OPPONENT HOST, never their guests/co-broadcasters — keeps the battle strictly 1v1 on screen
                    await _pkOpponentClient.subscribe(remoteUser, mediaType);
                    if (mediaType === 'video') {
                        var slot = document.getElementById('pv52-pk-opponent-video');
                        if (slot) {
                            remoteUser.videoTrack.play(slot);
                            var fallback = document.getElementById('pv52-pk-opponent-fallback');
                            if (fallback) fallback.style.display = 'none';
                        }
                    }
                    // Deliberately never play the opponent's audio track —
                    // matches the real product's PK behavior (you hear your
                    // own room's host; the opponent is seen, not heard) and
                    // avoids a second live mic mixing into this listener's
                    // audio uncontrolled.
                } catch (e) { console.warn('[V52] opponent subscribe error:', e.message); }
            });
            _pkOpponentClient.on('user-unpublished', function (remoteUser, mediaType) {
                var isOppHost = opp.agoraUid != null && String(remoteUser.uid) === String(opp.agoraUid);
                if (isOppHost && mediaType === 'video') {
                    var fallback = document.getElementById('pv52-pk-opponent-fallback');
                    if (fallback) fallback.style.display = 'flex';
                }
            });
        } catch (err) {
            console.warn('[V52] could not join opponent channel as audience:', err.message);
        }
    }
    async function _leaveOpponentClient() {
        try { if (_pkOpponentClient) { await _pkOpponentClient.leave(); } } catch (e) {}
        _pkOpponentClient = null;
    }

    /* =========================================================================
       §8 — score bar + gift-total tracking. Two independent read-only
       `live_gifts` listeners (one per streamId), each discarding any gift
       whose createdAt predates the battle's own startedAt — see the file
       header for why this client-side cutoff check is used instead of a
       Firestore range query (avoids needing a new composite index).
       ========================================================================= */
    function _ensureScoreBar() {
        if (document.getElementById('pv52-scorebar') || !_battle) return;
        var screen = document.getElementById('live-stream-screen');
        if (!screen) return;
        var mine = _mySide(), opp = _opponentSide();
        var leftSide = _iAmHostA ? _battle.hostA : _battle.hostB;   // always "my" side, left, matching the split
        var rightSide = _iAmHostA ? _battle.hostB : _battle.hostA;
        var bar = document.createElement('div');
        bar.id = 'pv52-scorebar';
        bar.innerHTML =
            '<div class="pv52-score-side pv52-score-left">' +
            '<img src="' + esc(leftSide.avatar || '') + '" alt="">' +
            '<span class="pv52-score-name">' + esc(leftSide.name) + '</span>' +
            '<span class="pv52-score-amt" id="pv52-score-amt-left">0</span>' +
            '</div>' +
            '<div class="pv52-score-mid">' +
            '<div class="pv52-score-fill-track"><div class="pv52-score-fill" id="pv52-score-fill" style="width:50%;"></div></div>' +
            '<span id="pv52-score-timer" class="pv52-score-timer">--:--</span>' +
            '</div>' +
            '<div class="pv52-score-side pv52-score-right">' +
            '<span class="pv52-score-amt" id="pv52-score-amt-right">0</span>' +
            '<span class="pv52-score-name">' + esc(rightSide.name) + '</span>' +
            '<img src="' + esc(rightSide.avatar || '') + '" alt="">' +
            '</div>' +
            (isRealHost() ? '<button type="button" id="pv52-end-early-btn" title="End battle early">\u00d7</button>' : '');
        screen.appendChild(bar);

        var oppSlot = document.createElement('div');
        oppSlot.id = 'pv52-pk-opponent-video';
        oppSlot.innerHTML = '<div id="pv52-pk-opponent-fallback" class="pv52-pk-opponent-fallback"><img src="' + esc(opp.avatar || '') + '" alt=""></div>';
        var mainVideo = document.querySelector('#live-stream-screen .main-host-video');
        if (mainVideo && mainVideo.parentElement) mainVideo.parentElement.appendChild(oppSlot);

        var endBtn = document.getElementById('pv52-end-early-btn');
        if (endBtn) {
            var confirming = false;
            endBtn.addEventListener('click', function () {
                if (!confirming) {
                    confirming = true;
                    endBtn.textContent = '\u2713';
                    endBtn.title = 'Tap again to confirm ending the battle';
                    setTimeout(function () { confirming = false; endBtn.textContent = '\u00d7'; endBtn.title = 'End battle early'; }, 3000);
                    return;
                }
                _tryEndBattle('manual');
            });
        }
    }
    function _attachGiftListeners(battle) {
        _detachGiftListeners();
        if (!fbReady()) return;
        _giftTotals = { A: 0, B: 0 };
        _giftSeen = { A: {}, B: {} };
        var startedAtMs = battle.startedAt || 0;

        function makeListener(streamId, sideKey) {
            if (!streamId) return null;
            return window.fbDb.collection('live_gifts').where('streamId', '==', streamId)
                .onSnapshot(function (snap) {
                    var changed = false;
                    snap.docChanges().forEach(function (change) {
                        if (change.type !== 'added') return;
                        var d = change.doc.data() || {};
                        var key = d.messageId || change.doc.id;
                        if (_giftSeen[sideKey][key]) return;
                        _giftSeen[sideKey][key] = true;
                        var ts = d.createdAt ? new Date(d.createdAt).getTime() : 0;
                        if (!ts || ts < startedAtMs) return; // sent before this battle started — doesn't count
                        _giftTotals[sideKey] += (d.amount || 0);
                        changed = true;
                    });
                    if (changed) _refreshScoreBar();
                }, function (err) { console.warn('[V52] gift listener (' + sideKey + ') error:', err.message); });
        }
        _giftUnsubA = makeListener(battle.hostA && battle.hostA.streamId, 'A');
        _giftUnsubB = makeListener(battle.hostB && battle.hostB.streamId, 'B');
    }
    function _detachGiftListeners() {
        if (_giftUnsubA) { _giftUnsubA(); _giftUnsubA = null; }
        if (_giftUnsubB) { _giftUnsubB(); _giftUnsubB = null; }
    }
    function _refreshScoreBar() {
        if (!document.getElementById('pv52-scorebar') || !_battle) return;
        var leftTotal = _iAmHostA ? _giftTotals.A : _giftTotals.B;
        var rightTotal = _iAmHostA ? _giftTotals.B : _giftTotals.A;
        var leftEl = document.getElementById('pv52-score-amt-left'); if (leftEl) leftEl.textContent = leftTotal.toLocaleString();
        var rightEl = document.getElementById('pv52-score-amt-right'); if (rightEl) rightEl.textContent = rightTotal.toLocaleString();
        var total = leftTotal + rightTotal;
        var pct = total ? Math.round((100 * leftTotal) / total) : 50;
        var fill = document.getElementById('pv52-score-fill'); if (fill) fill.style.width = pct + '%';
    }

    /* =========================================================================
       §9 — countdown + end-of-battle (single-writer-with-fallback — see
       file header). Timer display updates locally on every device
       regardless of who ends up writing the actual status flip.
       ========================================================================= */
    function _armEndTimer(battle) {
        clearInterval(_endTimer);
        var endsAt = battle.endsAt || 0;
        _endTimer = setInterval(function () {
            var remaining = endsAt - Date.now();
            var el = document.getElementById('pv52-score-timer');
            if (el) {
                if (remaining <= 0) { el.textContent = '00:00'; }
                else {
                    var s = Math.ceil(remaining / 1000);
                    el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
                }
            }
            if (remaining <= 0) {
                clearInterval(_endTimer);
                if (_iAmHostA) _tryEndBattle('timer');
                else if (_iAmHostB) setTimeout(function () { _tryEndBattle('timer-fallback'); }, END_FALLBACK_DELAY_MS);
            }
        }, 1000);
    }
    function _tryEndBattle(reason) {
        var ref = battleDocRef(_battleId);
        if (!ref || !window.fbDb) return;
        var myTotals = { A: _giftTotals.A, B: _giftTotals.B };
        window.fbDb.runTransaction(function (tx) {
            return tx.get(ref).then(function (doc) {
                var d = doc.data();
                if (!d || d.status !== 'active') throw new Error('pv52-already-ended');
                var winnerId = myTotals.A === myTotals.B ? null : (myTotals.A > myTotals.B ? d.hostAId : d.hostBId);
                tx.update(ref, { status: 'ended', winnerId: winnerId, endedReason: reason, giftTotalsAtEnd: myTotals });
            });
        }).catch(function (err) {
            if (err && err.message !== 'pv52-already-ended') console.warn('[V52] end-battle write failed:', err.message);
        });
    }
    function _showEndBanner(battle) {
        var screen = document.getElementById('live-stream-screen');
        if (!screen) return;
        var iWon = battle.winnerId && battle.winnerId === myId();
        var tie = !battle.winnerId;
        var mySide = _mySide(), opp = _opponentSide();
        var winnerName = tie ? null : (battle.winnerId === (battle.hostAId) ? battle.hostA.name : battle.hostB.name);

        var el = document.createElement('div');
        el.className = 'pv52-end-banner';
        el.innerHTML = tie
            ? '<div class="pv52-end-title">\uD83E\uDD1D It\u2019s a tie!</div>'
            : '<div class="pv52-end-title">' + (iWon || (!_iAmHostA && !_iAmHostB) ? '\uD83C\uDFC6' : '\uD83D\uDC94') + ' ' + esc(winnerName) + ' wins the battle!</div>';
        screen.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.remove(); }, 4000);

        // Forfeit tint on the losing side's own video half — purely visual,
        // matches the "loser gets a forfeit animation" ask.
        if (!tie && battle.winnerId) {
            var loserIsMine = mySide && ((_iAmHostA && battle.winnerId !== battle.hostAId) || (_iAmHostB && battle.winnerId !== battle.hostBId));
            var loserIsOpponent = opp && ((_iAmHostA && battle.winnerId === battle.hostAId) || (_iAmHostB && battle.winnerId === battle.hostBId));
            var mainVideo = document.querySelector('#live-stream-screen .main-host-video');
            var oppSlot = document.getElementById('pv52-pk-opponent-video');
            if (loserIsMine && mainVideo) mainVideo.classList.add('pv52-forfeit-tint');
            if (loserIsOpponent && oppSlot) oppSlot.classList.add('pv52-forfeit-tint');
        }
    }

    /* =========================================================================
       §10 — teardown: local cleanup only (never writes to Firestore except
       via _clearOwnActiveBattleField, which is host-only and already
       called separately when status becomes 'ended' — see §4).
       ========================================================================= */
    function _teardownBattleUI() {
        clearInterval(_endTimer); _endTimer = null;
        _detachGiftListeners();
        _leaveOpponentClient();
        var screen = document.getElementById('live-stream-screen');
        if (screen) screen.classList.remove('pv52-split-active');
        ['pv52-scorebar', 'pv52-pk-opponent-video'].forEach(function (id) { var el = document.getElementById(id); if (el) el.remove(); });
        var mainVideo = document.querySelector('#live-stream-screen .main-host-video');
        if (mainVideo) mainVideo.classList.remove('pv52-forfeit-tint');
        var pickBtn = document.getElementById('pv52-pk-btn'); if (pickBtn && isRealHost()) pickBtn.style.display = '';
        _giftTotals = { A: 0, B: 0 }; _giftSeen = { A: {}, B: {} };
    }

    /* =========================================================================
       §11 — CSS (all class names prefixed pv52- to guarantee zero
       collision with any existing selector).
       ========================================================================= */
    (function injectCSS() {
        if (document.getElementById('pv52-css')) return;
        var css = document.createElement('style');
        css.id = 'pv52-css';
        css.textContent =
            /* Split screen: left half is whatever was already rendering
               into .main-host-video (host's own preview OR the viewer's
               agora-viewer-video overlay, both already inset:0 inside it —
               see the file header for why width:50% + right:auto is safe
               to layer on top without touching either of those). */
            '.pv52-split-active .main-host-video{width:50% !important;right:auto !important;}' +
            '#pv52-pk-opponent-video{position:absolute;top:0;right:0;width:50%;height:100%;z-index:2;background:#000;overflow:hidden;border-left:2px solid rgba(245,197,24,0.55);}' +
            '#pv52-pk-opponent-video video{width:100%;height:100%;object-fit:cover;}' +
            '.pv52-pk-opponent-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#1B2B8B;}' +
            '.pv52-pk-opponent-fallback img{width:64px;height:64px;border-radius:50%;object-fit:cover;}' +
            '.pv52-forfeit-tint{filter:grayscale(0.85) brightness(0.55);transition:filter .6s ease;}' +
            /* Score bar */
            '#pv52-scorebar{position:absolute;top:64px;left:8px;right:8px;z-index:25;display:flex;align-items:center;gap:8px;background:rgba(10,14,39,0.78);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.14);border-radius:14px;padding:6px 10px;}' +
            '.pv52-score-side{display:flex;align-items:center;gap:6px;flex:1;min-width:0;}' +
            '.pv52-score-right{flex-direction:row-reverse;text-align:right;}' +
            '.pv52-score-side img{width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid rgba(245,197,24,0.6);}' +
            '.pv52-score-name{font-size:0.68rem;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70px;}' +
            '.pv52-score-amt{font-size:0.72rem;font-weight:900;color:#F5C518;flex-shrink:0;}' +
            '.pv52-score-mid{display:flex;flex-direction:column;align-items:center;gap:2px;width:88px;flex-shrink:0;}' +
            '.pv52-score-fill-track{width:100%;height:6px;border-radius:4px;background:rgba(59,130,246,0.35);overflow:hidden;}' +
            '.pv52-score-fill{height:100%;background:linear-gradient(90deg,#FF6FA5,#F5C518);border-radius:4px;transition:width .4s ease;}' +
            '.pv52-score-timer{font-size:0.62rem;font-weight:800;color:#cfd8ee;}' +
            '#pv52-end-early-btn{background:rgba(255,255,255,0.12);border:none;color:#fff;width:20px;height:20px;border-radius:50%;font-size:0.85rem;line-height:1;cursor:pointer;flex-shrink:0;}' +
            /* Picker + incoming-invite modals reuse .live-sub-modal, only
               their internal rows need styling. */
            '.pv52-dur-btn{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.14);color:#cfd8ee;font-weight:700;font-size:0.76rem;border-radius:14px;padding:6px 14px;cursor:pointer;}' +
            '.pv52-dur-active{background:linear-gradient(135deg,#3E7BFA,#1E40C4);color:#fff;border-color:transparent;}' +
            '.pv52-picker-row{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.07);}' +
            '.pv52-picker-row img{width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0;}' +
            '.pv52-picker-name{flex:1;color:#fff;font-weight:700;font-size:0.85rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
            '.pv52-invite-wait-banner{position:absolute;top:64px;left:12px;right:12px;z-index:25;text-align:center;background:rgba(245,197,24,0.16);border:1px solid rgba(245,197,24,0.35);color:#F5C518;font-size:0.75rem;font-weight:700;border-radius:12px;padding:8px 10px;}' +
            /* End-of-battle banner */
            '@keyframes pv52EndIn{0%{opacity:0;transform:translate(-50%,-50%) scale(0.7);}30%{opacity:1;transform:translate(-50%,-50%) scale(1.08);}70%{opacity:1;transform:translate(-50%,-50%) scale(1);}100%{opacity:0;transform:translate(-50%,-56%) scale(1);}}' +
            '.pv52-end-banner{position:absolute;top:44%;left:50%;z-index:40;text-align:center;pointer-events:none;animation:pv52EndIn 3.6s ease forwards;}' +
            '.pv52-end-title{font-size:1.5rem;font-weight:900;color:#fff;text-shadow:0 0 16px rgba(245,197,24,0.7),0 2px 8px rgba(0,0,0,0.7);background:rgba(10,14,39,0.5);padding:10px 20px;border-radius:16px;}';
        document.head.appendChild(css);
    })();

    /* =========================================================================
       §12 — wiring: attach/detach alongside the live modal, the same
       #go-live-modal-overlay class-toggle trigger app-patch-v33/v42/v50/
       v51 already observe.
       ========================================================================= */
    function _ensurePkButton() {
        if (!isRealHost() || _battleId) {
            var existing = document.getElementById('pv52-pk-btn');
            if (existing && _battleId) existing.style.display = 'none';
            else if (existing) existing.remove();
            return;
        }
        var panel = document.getElementById('host-control-panel-inner');
        if (!panel || document.getElementById('pv52-pk-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'pv52-pk-btn';
        btn.type = 'button';
        btn.className = 'live-action-btn host-control';
        btn.title = 'PK Battle';
        /* FIX (2026-08-02 — broken/"X-box" icon report): same root cause
           and fix as the clap/poll/chat-mode buttons above — raw
           crossed-swords emoji -> FA6 icon-font glyph. */
        btn.innerHTML = '<i class="fas fa-people-fighting"></i>';
        btn.addEventListener('click', _openPickerModal);
        panel.appendChild(btn);
    }

    // FIX (bug report: "control panel buttons unresponsive") — same
    // guaranteed-first capture-phase treatment as the other host-control-
    // panel buttons fixed this session; see pv55-sound-btn's comment
    // (app-patch-v42.js §5, "empyreanPatchV55") for the full explanation.
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        var btn = e.target.closest('#pv52-pk-btn');
        if (!btn) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        _openPickerModal();
    }, true);
    // (pv52-pk-btn already used stopImmediatePropagation — no change
    // needed here; confirmed correct while auditing the other buttons on
    // this panel for the same "click once, then stops responding" bug.)
    function onModalToggle() {
        var modal = document.getElementById('go-live-modal-overlay');
        if (!modal) return;
        if (modal.classList.contains('show')) {
            _attachMyStreamDocListener();
            _attachIncomingInviteListener();
            setTimeout(_ensurePkButton, 400);
        } else {
            _detachMyStreamDocListener();
            _detachIncomingInviteListener();
            _detachBattleListener();
            _pendingInviteBattleId = null;
            ['pv52-picker-modal', 'pv52-incoming-modal', 'pv52-invite-wait-banner'].forEach(function (id) { var el = document.getElementById(id); if (el) el.remove(); });
        }
    }
    function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
    ready(function () {
        var modal = document.getElementById('go-live-modal-overlay');
        if (modal) {
            new MutationObserver(onModalToggle).observe(modal, { attributes: true, attributeFilter: ['class'] });
            if (modal.classList.contains('show')) onModalToggle();
        }
        // Cheap, idempotent recheck for a host/guest role flip mid-stream —
        // same interval pattern app-patch-v42/v51 already use.
        setInterval(function () {
            var m = document.getElementById('go-live-modal-overlay');
            if (m && m.classList.contains('show')) {
                _ensurePkButton();
                /* 2026-11-08 FIX (battle invites never arrived / battle never started for the challenged host):
                   both listeners used to attach ONLY once, when the go-live modal first opened — before the
                   stream id and host id exist — so they silently never attached. Retry until they do. */
                try {
                    if (isRealHost() && fbReady() && currentStreamId()) {
                        if (!_myStreamDocUnsub || _myStreamDocStreamId !== currentStreamId()) _attachMyStreamDocListener();
                        if (!_incomingInviteUnsub) _attachIncomingInviteListener();
                    }
                } catch (ePkAtt) {}
            }
        }, 1500);
    });

    console.log('[EmpyreanPatchV52] \u2705 PK / Battle mode wired \u2014 host-only \u2694\uFE0F button opens an opponent picker (queries active_streams for other currently-live hosts), sends a 25s-expiring challenge via a new pk_battles doc, and on accept both sides (and every one of their viewers) independently join the opponent\u2019s channel as an audience-only third Agora client for a true split-screen \u2014 no existing client, channel, or chat feed touched. Gift totals are tallied client-side per side from the existing live_gifts collection (cutoff at the battle\u2019s own startedAt, no new index needed) and shown on a live score bar; the higher total when the timer ends wins, with a forfeit tint + banner for the loser. Pure addition \u2014 no existing live-streaming file was edited. Requires a `pk_battles` Firestore rule to be added (see header) \u2014 active_streams itself already allows the one new field this uses.');

})();

/* ═══════════════════════════════════════════════════════════════════════
   app-patch-v53.js — Live-stream bug-fix pack (2026-08-02)
   ═══════════════════════════════════════════════════════════════════════
   Appended per this codebase's additive-patch convention (fixes for
   app-patch-v50/v51's clap/poll/chat-mode buttons live inline, edited
   directly, above — this new section covers the two bugs that needed
   NEW code rather than a correction to existing code).

   [BUG 2] The 3 new host-control-panel buttons (poll, chat-mode,
   hype-clap) respond to taps once, then stop responding once a guest/
   co-host tile is on screen.
     This exact panel has hit the exact same symptom — "button used to
     work, then silently stopped responding to taps" — four times
     already (see app-live-tiktok-patch.js's own "SINGLE AUTHORITATIVE
     HANDLER" and its header comment: toggle button, viewer count,
     rank trophy, requests bell). Every time, the fix was the same:
     stop trusting a listener bound directly to the button node — this
     screen re-renders guest tiles, relocates the mic/camera nodes, and
     refreshes role visibility on EVERY Firestore snapshot of the
     stream doc (many times a minute, and specifically triggered by a
     guest being accepted/promoted) — and move to a capture-phase
     listener on `document`, which is guaranteed to run first no
     matter what else is happening in this DOM. These three buttons
     were added later (v50/v51) and never received that same
     treatment. This gives them the identical guaranteed-first
     handling already proven out on the other four buttons on this
     same panel, reusing the window._pv50HostHypeClap /
     window._pv51OpenPollModal / window._pv51CycleChatMode functions
     exposed for exactly this purpose above.

   [BUG 3 + BUG 4] Co-host / moderator (👑 crown icon) does nothing;
   promoted guest never shows a changed status or gains a control
   button; their camera never activates.
     CONFIRMED root cause, not a guess — app-live-tiktok-patch.js's own
     comments spell it out directly: window._empIsModerator() and
     window._empToggleModerator() were both defined in the separate
     app-patch-v33.js file, deliberately read everywhere through
     `typeof window._empToggleModerator === 'function'` guards so that,
     quoting that file's own comment, "if v33 is ever removed again,
     every one of these gates just silently falls back to host-only,
     exactly like before v33 existed, with no error and no behavior
     change." v33 is not part of the current build — most likely
     removed during a prior orphaned-file cleanup pass before this
     dependency was noticed (nothing referenced it by filename, only
     through these defensive window.* guards, so its removal broke
     nothing loudly). The practical effect: tapping the crown icon
     calls a function that no longer exists, silently, by design of
     that guard — no error, no Firestore write, no status change ever
     happens, so a "promoted" guest never actually gains moderator
     powers (accept/decline/mute other guests — gated on this same
     check in renderGuestBoxStack), never gets the host-requests bell
     (also gated on it, in refreshRoleVisibility), and nothing on
     screen, for them OR anyone watching, ever shows they were made a
     co-host. (Their camera, if they're already an accepted guest
     broadcaster, is unaffected either way — that already works from
     the original accept — but a viewer promoted to co-host status
     with the expectation that this alone starts their broadcast will
     correctly see nothing happen, since nothing about their
     guest/broadcaster state changes at all right now.)

     This section restores both functions directly — guarded so it
     never overrides a real v33 if one is ever restored — matching
     v33's own documented contract (guests[].isModerator field, same
     read-modify-write pattern this file's own toggleGuestMute-style
     functions already use elsewhere in this codebase). It also adds
     two things v33 apparently never had, to make "made co-host" README
     visible rather than silent on every side: a small read-only 👑
     badge on the guest's tile visible to EVERYONE watching (previously
     the interactive crown only ever rendered for the host, so no one
     else could tell who — if anyone — was moderating), and a one-time
     toast to the promoted guest themselves the moment their own status
     flips.
   ============================================================================= */

(function empyreanPatchV53() {
    'use strict';

    if (window._empPatchV53Loaded) {
        console.warn('[V53] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV53Loaded = true;

    function log(msg) { console.log('[V53] ' + msg); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function myId() { return window.userState && window.userState.id; }
    function currentStreamId() { return window.liveStreamData && window.liveStreamData.streamId; }
    function isRealHost() {
        if (window.isGuest || !window.userState || !window.liveStreamData) return false;
        var sd = window.liveStreamData;
        var hid = sd.hostUserId || sd.hostId;
        return !!hid && window.userState.id === hid;
    }
    function streamDocRef() {
        var db = window.fbDb, sid = currentStreamId();
        if (!db || !sid || !window._firebaseLoaded) return null;
        return db.collection('active_streams').doc(sid);
    }

    /* ═══════════════════════════════════════════════════════════════════
       BUG 2 — guaranteed-first capture handler for the poll / chat-mode /
       hype-clap buttons. Registered with capture:true on `document`, the
       same mechanism app-live-tiktok-patch.js's own "SINGLE AUTHORITATIVE
       HANDLER" already relies on for the toggle/viewers/trophy/requests
       buttons on this identical panel — capture-phase listeners on
       `document` always run before any listener bound to the button
       itself, before anything else on the page, regardless of what else
       this screen's frequent Firestore-snapshot-driven re-renders are
       doing at the moment of the tap. stopPropagation() here means the
       button's own original listener (still in place, untouched, in the
       v50/v51 sections above) never double-fires for the same tap — this
       handler performs the action itself, directly, via the window.*
       exposures added above, the same "call through window.* so the
       current version always runs" pattern already established in this
       codebase (app-patch-v4.js's _submitQuote, app-live-tiktok-patch.js's
       openHostPreviewModal).
       ═══════════════════════════════════════════════════════════════════ */
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;

        var pollBtn = e.target.closest('#pv51-poll-btn');
        if (pollBtn) {
            // FIX 2026-08-03: stopImmediatePropagation (not just
            // stopPropagation) — same defense-in-depth hardening applied to
            // pv55/pv56 this session, so no other listener for this exact
            // tap (from any file, any load order) can ever also fire.
            e.stopImmediatePropagation();
            e.preventDefault();
            if (typeof window._pv51OpenPollModal === 'function') {
                window._pv51OpenPollModal();
            } else {
                log('poll button tapped but its handler isn\'t ready yet — try again in a moment.');
            }
            return;
        }

        var chatModeBtn = e.target.closest('#pv51-chatmode-btn');
        if (chatModeBtn) {
            // FIX 2026-08-03: stopImmediatePropagation hardening, see the
            // poll-button note immediately above.
            e.stopImmediatePropagation();
            e.preventDefault();
            if (typeof window._pv51CycleChatMode === 'function') {
                window._pv51CycleChatMode();
            } else {
                log('chat-mode button tapped but its handler isn\'t ready yet — try again in a moment.');
            }
            return;
        }

        var hypeClapBtn = e.target.closest('#live-host-clap-btn');
        if (hypeClapBtn) {
            // FIX 2026-08-03: stopImmediatePropagation hardening, see the
            // poll-button note above.
            e.stopImmediatePropagation();
            e.preventDefault();
            if (typeof window._pv50HostHypeClap === 'function') {
                window._pv50HostHypeClap();
            } else {
                log('hype-clap button tapped but its handler isn\'t ready yet — try again in a moment.');
            }
            return;
        }
    }, true); // capture: true — guarantees this always runs first, exactly like the panel's other 4 buttons

    /* ═══════════════════════════════════════════════════════════════════
       BUG 3 + 4 — restore window._empIsModerator / window._empToggleModerator
       ═══════════════════════════════════════════════════════════════════ */

    // Guarded — if a real app-patch-v33.js is ever restored to the build,
    // its definitions (whichever loads second) win; this never fights it.
    if (typeof window._empIsModerator !== 'function') {
        window._empIsModerator = function () {
            var uid = myId();
            if (!uid) return false;
            // window._liveGuestsCache is kept current by app-live-tiktok-
            // patch.js's own stream listener on every snapshot — reusing
            // it here means this needs no listener of its own to answer
            // "am I a moderator right now?".
            var guests = window._liveGuestsCache || [];
            var mine = guests.filter(function (g) { return g && g.userId === uid; })[0];
            return !!(mine && mine.isModerator);
        };
        log('window._empIsModerator restored (was missing — see header note).');
    }

    if (typeof window._empToggleModerator !== 'function') {
        window._empToggleModerator = function (uid, grant) {
            if (!isRealHost()) { log('_empToggleModerator called by a non-host — ignored.'); return; }
            if (!uid) return;
            var ref = streamDocRef();
            if (!ref) { notify('Could not reach the stream right now — try again.', 'error'); return; }
            ref.get().then(function (snap) {
                var data = snap.data() || {};
                var guests = data.guests || [];
                var idx = -1;
                for (var i = 0; i < guests.length; i++) { if (guests[i] && guests[i].userId === uid) { idx = i; break; } }
                if (idx === -1) {
                    notify('That guest is no longer in the stream.', 'warning');
                    return;
                }
                var updated = guests.slice();
                updated[idx] = Object.assign({}, updated[idx], { isModerator: !!grant });
                return ref.update({ guests: updated }).then(function () {
                    notify(grant ? '\uD83D\uDC51 Co-host granted.' : 'Co-host removed.', 'success');
                });
            }).catch(function (err) {
                notify('Could not update co-host status: ' + (err && err.message ? err.message : 'try again.'), 'error');
            });
        };
        log('window._empToggleModerator restored (was missing — see header note).');
    }

    /* ── visible, read-only 👑 badge for everyone watching (not just the
       host, who already sees the interactive crown rendered by
       renderGuestBoxStack in app-live-tiktok-patch.js) ── */
    function _paintCoHostBadges() {
        var stack = document.getElementById('tk-guestbox-stack');
        if (!stack) return;
        var guests = window._liveGuestsCache || [];
        var modSet = {};
        guests.forEach(function (g) { if (g && g.isModerator) modSet[g.userId] = true; });
        var tiles = stack.querySelectorAll('.tk-guestbox[data-kind="guest"]');
        for (var i = 0; i < tiles.length; i++) {
            var tile = tiles[i];
            var uid = tile.getAttribute('data-uid');
            var hasInteractiveCrown = !!tile.querySelector('.tk-gb-mod'); // host already sees this version — don't double up
            var existingBadge = tile.querySelector('.pv53-cohost-badge');
            if (modSet[uid] && !hasInteractiveCrown) {
                if (!existingBadge) {
                    var badge = document.createElement('span');
                    badge.className = 'pv53-cohost-badge';
                    badge.title = 'Co-host';
                    badge.textContent = '\uD83D\uDC51';
                    tile.appendChild(badge);
                }
            } else if (existingBadge) {
                existingBadge.remove();
            }
        }
    }

    var _badgeObserver = null;
    function _watchGuestboxForBadges() {
        var stack = document.getElementById('tk-guestbox-stack');
        if (!stack || stack._pv53Watched) { _paintCoHostBadges(); return; }
        stack._pv53Watched = true;
        _badgeObserver = new MutationObserver(function () { _paintCoHostBadges(); });
        _badgeObserver.observe(stack, { childList: true, subtree: true });
        _paintCoHostBadges();
    }

    /* ── one-time toast to the promoted guest themselves, the moment
       THEIR OWN status flips (not visible from a badge on their own
       tile, since a guest doesn't see their own tile in the stack the
       same way the host does) ── */
    var _lastKnownOwnModStatus = false;
    function _checkOwnModStatus() {
        if (isRealHost()) return; // the host is never "promoted" to co-host of their own stream
        var now = window._empIsModerator();
        if (now !== _lastKnownOwnModStatus) {
            if (now) {
                notify('\uD83D\uDC51 You were made a co-host! You can now help approve guest requests.', 'success');
            } else if (_lastKnownOwnModStatus) {
                notify('Your co-host status was removed.', 'info');
            }
            _lastKnownOwnModStatus = now;
        }
    }

    /* ── wiring: same #go-live-modal-overlay class-toggle trigger every
       other section of this file already observes ── */
    function onModalToggle() {
        var modal = document.getElementById('go-live-modal-overlay');
        if (!modal) return;
        if (modal.classList.contains('show')) {
            _lastKnownOwnModStatus = window._empIsModerator();
            _watchGuestboxForBadges();
        } else {
            if (_badgeObserver) { _badgeObserver.disconnect(); _badgeObserver = null; }
            var stack = document.getElementById('tk-guestbox-stack');
            if (stack) stack._pv53Watched = false;
            _lastKnownOwnModStatus = false;
        }
    }
    function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
    ready(function () {
        var modal = document.getElementById('go-live-modal-overlay');
        if (modal) {
            new MutationObserver(onModalToggle).observe(modal, { attributes: true, attributeFilter: ['class'] });
            if (modal.classList.contains('show')) onModalToggle();
        }
        // Same interval pattern every other section of this file already
        // uses for a role flip mid-stream — cheap and idempotent.
        setInterval(function () {
            var m = document.getElementById('go-live-modal-overlay');
            if (m && m.classList.contains('show')) { _paintCoHostBadges(); _checkOwnModStatus(); }
        }, 1500);
    });

    /* ── CSS for the read-only co-host badge ── */
    (function injectCSS() {
        if (document.getElementById('pv53-css')) return;
        var css = document.createElement('style');
        css.id = 'pv53-css';
        css.textContent =
            '.pv53-cohost-badge{position:absolute;top:-7px;right:-7px;background:rgba(0,0,0,0.82);border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:0.72rem;border:1px solid rgba(245,197,24,0.65);}';
        document.head.appendChild(css);
    })();

    console.log('[EmpyreanPatchV53] \u2705 Live-stream bug-fix pack loaded \u2014 (1) clap button: no longer duplicated on the host\u2019s own screen, sound synthesized at runtime via Web Audio (no missing asset file), floating \uD83D\uDC4F burst now visible on every clap; (2) poll/chat-mode/hype-clap buttons on the host control panel now use the same guaranteed-first capture-phase handling already proven out on this panel\u2019s other four buttons; (3+4) window._empIsModerator/_empToggleModerator restored (were silently missing \u2014 defined only in app-patch-v33.js, which is not part of the current build), with a visible co-host badge for everyone watching and a one-time toast to the promoted guest.');

})();

/* ═══════════════════════════════════════════════════════════════════════
   app-patch-v54.js — Completion pack for the four reported bugs
   ═══════════════════════════════════════════════════════════════════════
   Appended per this codebase's additive-patch convention. This session's
   testing (actually executing app-patch-v42.js in a JS sandbox, not just
   reading it) found that V53's own bug-fix pack above never ran on any
   real page load — see the FIX note on V50's closing console.log for the
   root cause (a ReferenceError there aborted the rest of this script
   file, silently skipping V51/V52/V53 every time). That crash is now
   fixed above. This section is additional hardening on top of that fix,
   for the specific symptoms reported:

   BUG 1 (clap button duplicated host+guest, no sound, no on-screen
   effect): root-caused to the same script-abort — V50's own gating/
   synth/burst code (all of it ABOVE the crashing line) was already
   correct and already ran every time; it just looked broken because nothdc
   -after V50 in the file ever got a chance to run either, and repeat
   testing during an aborted-script session can't have been seeing V50's
   real behavior in isolation. Section §D below adds a cheap defensive
   sweep on top, since a false "still broken" report deserves an extra
   guarantee, not just a theory.

   BUG 2 (poll/chat-mode/hype-clap buttons in the host control panel stop
   responding once a co-host exists): V53's capture-phase handler (which
   fixes exactly this) can now actually register, since it's no longer
   skipped by the crash. Section §B below adds a second, independent
   layer: if any of the three buttons is ever missing from the DOM while
   this device is confirmed host — for any reason, not just the one
   already diagnosed — it's recreated on the spot, wired through the same
   window.* functions V53's capture handler already calls, so the button
   existing and the button responding are guaranteed together.

   BUG 3 (guest camera-switch button does nothing): app-patch-v37.js's
   own implementation is correct in isolation, but AgoraRTC.
   createCameraVideoTrack({facingMode:'environment'}) throws
   OverconstrainedError on any device that physically only has one
   camera (most laptops/desktops — a very likely test environment) or on
   browsers that don't support exact facingMode matching. V37 does show
   an error toast for that, but "toast says it failed" and "camera opens"
   are different outcomes, and the reported symptom ("does nothing") is
   consistent with that toast going unnoticed. Section §C replaces the
   switch behavior with a capture-phase handler (supersedes V37's bubble-
   phase one the same way V53 already supersedes button clicks elsewhere
   in this file) that retries WITHOUT a facingMode constraint if the
   exact request fails, so a tap always either flips the camera or
   successfully (re)acquires *a* camera — never a silent no-op — with a
   clear, specific notification either way.

   BUG 4 (co-host status invisible; promoted guest gets no control
   button): two independent contributors, both closed here.
     (a) V53's badge/toast/gating restoration above can now run (crash
         fixed), so the visible 👑 badge, the one-time toast, and the
         window._empIsModerator/_empToggleModerator restoration all take
         effect — IF app-patch-v33.js isn't present in this build, per
         V53's own guard.
     (b) app-patch-v33.js — which per this session's review of index.html
         *is* present in this build — has its own separate, independent
         moderator-status listener (_attachModeratorListener) that only
         ever attaches once, at the moment the live modal opens, with NO
         retry if window.liveStreamData.streamId isn't populated yet at
         that exact instant (a real, timing-dependent race — the same
         class of bug this codebase has hit and fixed with a retry loop
         in half a dozen other places, e.g. app-live-tiktok-patch.js's
         own attachStreamListener 15-retry loop). If that race is lost
         once, v33's moderator cache silently never updates again for the
         rest of that stream — which reads exactly like "co-host status
         never shows up." Section §A replaces window._empIsModerator /
         window._empToggleModerator outright (not guarded behind "only if
         undefined", since v33's IS defined but can be silently stale)
         with a version backed by window._liveGuestsCache — the SAME
         `guests` array, already kept fresh by app-live-tiktok-patch.js's
         own battle-tested, 15-retry attachStreamListener(), which every
         device (host, guest, and viewer alike) already depends on for
         the guest-box stack itself. Reusing that existing, already-
         race-resistant source of truth avoids needing a second listener
         (and a second chance to lose the same race) entirely. The write
         side (_empToggleModerator) is unchanged in behavior — same
         `guests[].isModerator` field, same host-only gate, same
         read-modify-write pattern — so nothing about the data model or
         Firestore rules changes; this only changes how the READ side
         answers "is this device a moderator right now?".
   ═══════════════════════════════════════════════════════════════════════ */

(function empyreanPatchV54() {
    'use strict';

    if (window._empPatchV54Loaded) {
        console.warn('[V54] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV54Loaded = true;

    function log(msg) { console.log('[V54] ' + msg); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function myId() { return window.userState && window.userState.id; }
    function currentStreamId() { return window.liveStreamData && window.liveStreamData.streamId; }
    function isRealHost() {
        if (window.isGuest || !window.userState || !window.liveStreamData) return false;
        var sd = window.liveStreamData;
        var hid = sd.hostUserId || sd.hostId;
        return !!hid && window.userState.id === hid;
    }
    function streamDocRef() {
        var db = window.fbDb, sid = currentStreamId();
        if (!db || !sid || !window._firebaseLoaded) return null;
        return db.collection('active_streams').doc(sid);
    }
    function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

    /* =========================================================================
       §A — BUG 4: robust co-host status, backed by _liveGuestsCache (see
       header note (b) above for why this is safer than v33's own
       separate listener). Deliberately NOT guarded behind "only if
       undefined" — v33's version IS a function (so V53's own guard above
       leaves it alone), but can be a permanently-stale one if its one-shot
       attach ever raced streamId's arrival, which this fixes.
       ========================================================================= */
    window._empIsModerator = function () {
        var uid = myId();
        if (!uid) return false;
        var guests = window._liveGuestsCache || [];
        for (var i = 0; i < guests.length; i++) {
            if (guests[i] && guests[i].userId === uid) return !!guests[i].isModerator;
        }
        return false;
    };

    window._empToggleModerator = function (uid, grant) {
        if (!isRealHost()) { log('_empToggleModerator called by a non-host — ignored.'); return; }
        if (!uid) return;
        var ref = streamDocRef();
        if (!ref) { notify('Could not reach the stream right now — try again.', 'error'); return; }
        ref.get().then(function (snap) {
            var data = snap.data() || {};
            var guests = data.guests || [];
            var idx = -1;
            for (var i = 0; i < guests.length; i++) { if (guests[i] && guests[i].userId === uid) { idx = i; break; } }
            if (idx === -1) { notify('That guest is no longer in the stream.', 'warning'); return; }
            var updated = guests.slice();
            updated[idx] = Object.assign({}, updated[idx], { isModerator: !!grant });
            return ref.update({ guests: updated }).then(function () {
                notify(grant ? '\uD83D\uDC51 Co-host granted.' : 'Co-host removed.', 'success');
            });
        }).catch(function (err) {
            notify('Could not update co-host status: ' + (err && err.message ? err.message : 'try again.'), 'error');
        });
    };
    log('window._empIsModerator / window._empToggleModerator installed \u2014 backed by _liveGuestsCache, race-resistant regardless of whether app-patch-v33.js is present.');

    /* =========================================================================
       §B — BUG 2: self-healing host-control-panel buttons. Belt-and-
       suspenders on top of V50/V51's own ensure-functions (and V53's
       capture handler, now unblocked): if any of the three buttons is
       ever missing from the DOM while this device is confirmed host, it
       gets recreated — wired to nothing itself, since V53's capture-
       phase handler on `document` already intercepts taps on these ids
       and dispatches to window._pv50HostHypeClap / _pv51OpenPollModal /
       _pv51CycleChatMode before any element-level listener would even
       run. That keeps "button exists" and "button responds" from ever
       drifting apart again.
       ========================================================================= */
    function _v54EnsureBtn(id, title, glyph) {
        if (!isRealHost()) {
            var stale = document.getElementById(id);
            if (stale) stale.remove();
            return;
        }
        var panel = document.getElementById('host-control-panel-inner');
        if (!panel || document.getElementById(id)) return; // nothing to heal
        var btn = document.createElement('button');
        btn.id = id;
        btn.type = 'button';
        btn.className = 'live-action-btn';
        btn.title = title;
        /* FIX (2026-08-02 — broken/"X-box" icon report): `glyph` used to
           be a raw emoji character rendered in a bare <span> — the same
           device-dependent "tofu box" issue fixed at each button's own
           primary creation site (v50's clap button, v51's poll/chat-mode
           buttons, above). This self-healing path recreates the exact
           same DOM node when it's found missing, so it needed the same
           fix or a self-heal would have silently reintroduced the broken
           icon. `glyph` is now an FA6 icon class name instead of an
           emoji character. */
        btn.innerHTML = '<i class="fas ' + glyph + '"></i>';
        panel.appendChild(btn);
        if (id === 'pv51-chatmode-btn' && typeof window._pv51RefreshChatModeBtn === 'function') window._pv51RefreshChatModeBtn(); // 2026-11-08: SVG icon
        log('self-healed missing #' + id + ' in the host control panel.');
    }
    function _v54EnsurePanelButtons() {
        _v54EnsureBtn('pv51-chatmode-btn', 'Chat mode', 'fa-comment-dots');
        _v54EnsureBtn('pv51-poll-btn', 'Start a poll', 'fa-square-poll-vertical');
        _v54EnsureBtn('live-host-clap-btn', 'Hype the crowd', 'fa-hands-clapping');
    }

    /* =========================================================================
       §C — BUG 3: robust guest camera-switch. Capture-phase handler
       supersedes app-patch-v37.js's bubble-phase one (same established
       pattern V53 already uses for the panel buttons) so a tap here is
       guaranteed to run first; falls back to an unconstrained camera
       request if the exact front/back facingMode match fails (the
       single-camera-device case), instead of leaving the tap a no-op.
       ========================================================================= */
    var SWITCH_BTN_ID = 'live-camera-switch-btn';
    var _v54Switching = false;
    var _v54Facing = 'user';

    function _v54IsPermDenied(err) {
        var s = ((err && (err.code || '')) + ' ' + (err && err.message || '')).toLowerCase();
        return s.indexOf('permission_denied') !== -1 || s.indexOf('notallowederror') !== -1 ||
            s.indexOf('permission denied') !== -1 || s.indexOf('securityerror') !== -1;
    }
    function _v54IsOverconstrained(err) {
        var s = ((err && (err.name || err.code || '')) + ' ' + (err && err.message || '')).toLowerCase();
        return s.indexOf('overconstrained') !== -1 || s.indexOf('constraint') !== -1 || s.indexOf('notfound') !== -1;
    }

    function _v54EnsureSwitchBtn() {
        var isBroadcaster = typeof window._empIsGuestBroadcaster === 'function' && window._empIsGuestBroadcaster();
        var footer = document.querySelector('.live-footer');
        var existing = document.getElementById(SWITCH_BTN_ID);
        if (!isBroadcaster || !footer) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return; // already present (created by this function or by v37) — nothing to heal
        var btn = document.createElement('button');
        btn.id = SWITCH_BTN_ID;
        btn.type = 'button';
        btn.title = 'Switch camera';
        btn.innerHTML = '<i class="fas fa-sync-alt"></i>';
        var camBtn = document.getElementById('live-video-toggle');
        if (camBtn && camBtn.parentElement === footer) footer.insertBefore(btn, camBtn.nextSibling);
        else footer.appendChild(btn);
        log('self-healed missing #' + SWITCH_BTN_ID + ' for the current guest broadcaster.');
    }

    async function _v54SwitchCamera(btn) {
        if (_v54Switching) return;
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
        var wasEnabled = !oldTrack || oldTrack.enabled !== false;
        var nextFacing = _v54Facing === 'user' ? 'environment' : 'user';

        _v54Switching = true;
        if (btn) btn.style.opacity = '0.5';

        async function acquire(constraints) {
            var t = await AgoraRTC.createCameraVideoTrack(constraints);
            if (!wasEnabled) { try { await t.setEnabled(false); } catch (eDis) {} }
            await client.publish([t]);
            return t;
        }

        try {
            var newTrack;
            var usedFallback = false;
            try {
                newTrack = await acquire({ facingMode: nextFacing });
            } catch (eExact) {
                if (_v54IsPermDenied(eExact)) throw eExact;
                if (!_v54IsOverconstrained(eExact)) throw eExact;
                // FIX (bug 3 — "switching camera does nothing"): the exact
                // front/back match isn't available on this device (most
                // laptops/desktops only expose one camera). Retry with no
                // facingMode constraint at all so the guest's camera still
                // (re)activates instead of the tap silently failing.
                usedFallback = true;
                newTrack = await acquire({});
            }

            if (oldTrack) {
                try { await client.unpublish([oldTrack]); } catch (eUnpub) {}
                try { oldTrack.stop(); oldTrack.close(); } catch (eClose) {}
            }

            if (!usedFallback) _v54Facing = nextFacing;
            if (typeof window._empSetGuestVideoTrack === 'function') window._empSetGuestVideoTrack(newTrack);

            if (usedFallback) {
                notify('\uD83D\uDCF7 This device only has one camera \u2014 reconnected it.', 'info');
            } else {
                notify(nextFacing === 'environment' ? '\uD83D\uDCF7 Switched to back camera.' : '\uD83E\uDD33 Switched to front camera.', 'success');
            }
            log('camera (re)acquired, facingMode=' + (usedFallback ? '(unconstrained fallback)' : nextFacing));
        } catch (err) {
            if (_v54IsPermDenied(err)) {
                notify('Camera permission is blocked for this app \u2014 allow camera access in your browser/device settings, then try again.', 'error');
            } else {
                notify('Could not open the camera: ' + (err && err.message ? err.message : 'try again.'), 'error');
            }
        } finally {
            _v54Switching = false;
            if (btn) btn.style.opacity = '';
        }
    }

    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        var btn = e.target.closest('#' + SWITCH_BTN_ID);
        if (!btn) return;
        // Capture-phase: stops app-patch-v37.js's own bubble-phase handler
        // for this same id from also firing on the same tap (avoids a
        // double camera-acquisition race), the same supersession pattern
        // already used above for the host-panel buttons.
        e.stopPropagation();
        e.preventDefault();
        _v54SwitchCamera(btn);
    }, true);

    /* =========================================================================
       §D — BUG 1: defensive duplicate-clap-button sweep. V50's own
       isRealHost() gating (above, and confirmed to already run correctly
       once the script-abort is fixed) should make this a no-op in
       practice — kept as a cheap, harmless guarantee rather than a bet.
       ========================================================================= */
    function _v54DedupeClapButtons() {
        var host = isRealHost();
        var viewerBtn = document.getElementById('live-clap-btn');
        var hostBtn = document.getElementById('live-host-clap-btn');
        if (host && viewerBtn) { viewerBtn.remove(); log('removed stray viewer clap button from the host\u2019s own screen.'); }
        if (!host && hostBtn) { hostBtn.remove(); log('removed stray host hype-clap button from a non-host screen.'); }
    }

    /* =========================================================================
       §E — wiring: react immediately to guest-box changes (every co-host
       promotion/demotion re-renders #tk-guestbox-stack — see
       app-live-tiktok-patch.js's renderGuestBoxStack) instead of waiting
       on a poll, plus a short-interval safety net and the same
       #go-live-modal-overlay show/hide trigger every other module in
       this file already observes.
       ========================================================================= */
    function _v54RunAllChecks() {
        _v54EnsurePanelButtons();
        _v54EnsureSwitchBtn();
        _v54DedupeClapButtons();
    }

    var _v54GuestboxObserver = null;
    function _v54WatchGuestbox() {
        var stack = document.getElementById('tk-guestbox-stack');
        if (!stack || stack._pv54Watched) return;
        stack._pv54Watched = true;
        _v54GuestboxObserver = new MutationObserver(function () { _v54RunAllChecks(); });
        _v54GuestboxObserver.observe(stack, { childList: true, subtree: true });
    }

    function onModalToggle() {
        var modal = document.getElementById('go-live-modal-overlay');
        if (!modal) return;
        if (modal.classList.contains('show')) {
            _v54WatchGuestbox();
            _v54RunAllChecks();
        } else {
            if (_v54GuestboxObserver) { _v54GuestboxObserver.disconnect(); _v54GuestboxObserver = null; }
            var stack = document.getElementById('tk-guestbox-stack');
            if (stack) stack._pv54Watched = false;
            var swBtn = document.getElementById(SWITCH_BTN_ID); if (swBtn) swBtn.remove();
        }
    }

    ready(function () {
        var modal = document.getElementById('go-live-modal-overlay');
        if (modal) {
            new MutationObserver(onModalToggle).observe(modal, { attributes: true, attributeFilter: ['class'] });
            if (modal.classList.contains('show')) onModalToggle();
        }
        // Short-interval safety net — catches anything the guestbox
        // observer wouldn't (e.g. a pure host/guest role flip with no
        // guest-array change), without depending on it exclusively.
        setInterval(function () {
            var m = document.getElementById('go-live-modal-overlay');
            if (m && m.classList.contains('show')) _v54RunAllChecks();
        }, 1000);
    });

    console.log('[EmpyreanPatchV54] \u2705 Completion pack applied \u2014 (bug 4) co-host status now backed by the race-resistant _liveGuestsCache instead of app-patch-v33.js\u2019s own one-shot listener; (bug 2) poll/chat-mode/hype-clap buttons self-heal if ever missing from the host panel; (bug 3) camera-switch now runs capture-first with an unconstrained-camera fallback for single-camera devices; (bug 1) defensive sweep removes any stray duplicate clap button. See the CLAP_SOUND_URL fix on app-patch-v50\u2019s closing log line above for the root cause that had been silently blocking app-patch-v51/v52/v53 from ever running at all.');

})();


/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v55 + v56 + v57  (STANDALONE — NOT YET
   MERGED INTO v42)
   app-patch-v55.js  |  Load LAST (after app-live.js, app-live-tiktok-patch.js,
   app-live-final.js, app-fixes.js, and app-patch-v42.js)

   FEATURES IN THIS FILE, IN ORDER (ALL FIVE NOW ACTUALLY IMPLEMENTED
   BELOW — see each feature's own header further down for how):
     v55 — Background Sound Library + Beauty/Filter Effects
     v56 — Live Shopping / Product Pin
     v57 — Stream Replay (host-device record \u2192 Cloudinary \u2192 playback)
     v58 — Scheduled Streams + Reminders
     v59 — Watermarked Screen-Share / Download
   Everything from the original punch list's "not yet implemented" tier
   is now covered by this file except New Follower Toast (lower-effort
   polish item, never in this file's own scope per any session's plan
   so far — a v59 candidate if wanted next).

   Per this session's instruction: this file is deliberately built and
   left UNMERGED. It does not get folded into app-patch-v42.js's own
   merged v42+v50+v51+v52(+v53) block yet — that happens in a later
   session once the in-flight v53 bugfix pass is done. Loading this file
   on its own, appended after the files listed above, is enough to turn
   all three features on; nothing here depends on anything from a future
   merge step. When that merge does happen, v55/v56/v57 can be folded in
   as three more back-to-back IIFEs, exactly like v50\u2192v51\u2192v52\u2192v53
   already are inside app-patch-v42.js today — see the previous session's
   own note on this for why that copy-paste is expected to be
   reconciliation-free.

   ═══════════════════════════════════════════════════════════════════════
   WHY THIS COULD BE BUILT AS A PURE ADDITIVE FILE — ZERO EDITS ANYWHERE
   ═══════════════════════════════════════════════════════════════════════
   Every previous feature in this area that needed to reach a private
   variable inside app-live.js / app-live-tiktok-patch.js's own closures
   (app-patch-v33.js's isHost() gates, app-patch-v37.js's _guestClient/
   _guestTracks getters) had to make a small, documented edit to that
   file, because the thing it needed — a live gate check, a currently-
   held track reference — only ever existed as a local variable with no
   reason to be exposed for its own sake.

   This patch needs two things from app-live.js's closure: the host's
   own `agoraClient` and the two local tracks it creates in
   initAgoraHost() (`micTrack`, `cameraTrack` — module-local as
   `agoraLocalTracks.audio` / `.video`). But those aren't reached by
   editing a gate — they're the DIRECT RETURN VALUES of two calls on the
   global `AgoraRTC` object: `AgoraRTC.createClient(...)` and
   `AgoraRTC.createMicrophoneAndCameraTracks(...)`. `AgoraRTC` is a
   single shared global loaded once via the Agora CDN script, and
   app-live.js doesn't call either of those until the host actually taps
   "Go Live" — well after every one of this session's own files has
   already loaded and run. That means this file can wrap both calls at
   load time (capturing whatever they return, without changing what they
   return) and see every track/client the moment app-live.js creates it,
   with no edit to app-live.js at all. §1 below does exactly that — nine
   lines of wrapping, and the wrapped functions still do precisely what
   they always did.

   The same technique already has precedent in this codebase two levels
   removed: `AgoraRTC.createCustomVideoTrack({ mediaStreamTrack })` is
   already called directly in app-fixes.js (screen-share path) — proof
   the SDK's custom-track constructors are already a supported, load-
   bearing part of this app, not a new/unproven API surface introduced
   here. This patch's own track-replacement step (§5) is the same call,
   used the same way, just fed a canvas/Web-Audio-graph output instead
   of a screen-capture stream.

   Distinguishing the REAL host's own client from every OTHER client
   this codebase creates on the same device (the guest-broadcast client
   in app-live-tiktok-patch.js, the PK-opponent audience client in
   app-patch-v42.js) doesn't need a second edit either: every one of
   those other clients either calls `setClientRole('audience')` (PK
   opponent — never matches) or, for the guest-broadcast case, calls
   `setClientRole('host')` from a device where `isRealHost()` is false
   (a promoted guest is never the stream's actual owner). So "the client
   whose `setClientRole('host')` was called while `isRealHost()` is
   true" is, by construction, always the real host's own client, on the
   real host's own device — verified directly against every
   `createClient(` / `setClientRole(` call site in app-live.js,
   app-live-tiktok-patch.js, and app-patch-v42.js before writing this.

   ═══════════════════════════════════════════════════════════════════════
   FEATURE 1 — BACKGROUND SOUND LIBRARY
   ═══════════════════════════════════════════════════════════════════════
   REQUESTED: ambient/worship tracks mixed under the host's mic, audible
   to every viewer, host-controlled volume.

   The punch-list's own note on this item was "needs curated audio
   assets uploaded to public/sounds/" — a real blocker for a project
   maintained from a phone with no desktop access to push new binary
   files (this codebase's own working-style constraint, already the
   documented reason app-patch-v50.js synthesizes its clap sound with
   the Web Audio API instead of shipping an mp3). Same fix, same reason,
   applied here: every track in the library is synthesized at runtime —
   filtered noise for ocean/rain, slow detuned-oscillator pads for
   worship/ambient/drone — so the feature ships today with no asset
   upload step and can never 404. §3 has the five presets; adding a
   sixth is one more function in that table, nothing else to touch.

   MIXING: the host's raw mic MediaStreamTrack (pulled off the captured
   Agora track via its own `getMediaStreamTrack()` — a real method on
   Agora's ILocalAudioTrack, not something this patch invented) feeds a
   MediaStreamAudioSourceNode. The selected ambient preset feeds its own
   generator into a separate gain node the host's volume slider controls.
   Both sides sum into a MediaStreamAudioDestinationNode, whose output
   MediaStreamTrack is wrapped with AgoraRTC.createCustomAudioTrack and
   published in place of the raw mic track (publish-new-before-unpublish-
   old, the same ordering app-patch-v37.js's camera swap already uses, so
   there's never a gap where nothing is published).

   The raw mic track is deliberately never closed — it stays alive as
   the graph's own input — so the existing mic-mute button
   (`#live-mic-toggle`, still calling `agoraLocalTracks.audio.setEnabled()`
   inside app-live.js exactly as before) keeps working completely
   unmodified: disabling the underlying track feeds the graph silence,
   which mutes the host's VOICE while the ambient bed keeps playing
   underneath — the correct behavior for background music, and it falls
   out of the existing button for free, no new wiring needed for it.

   ═══════════════════════════════════════════════════════════════════════
   FEATURE 2 — BEAUTY / FILTER EFFECTS
   ═══════════════════════════════════════════════════════════════════════
   REQUESTED: brightness/smoothing/AR-lite filter on the host's own
   camera. Flagged on the punch list as "the most architecturally
   involved" item — a canvas/WebGL pipeline between capture and publish.

   Built as canvas 2D, not WebGL: nothing else in this codebase uses
   WebGL anywhere (verified — grep across every file here turns up zero
   `getContext('webgl')` calls), while canvas 2D is already an
   established pattern for pixel-level work (app-fixes.js's watermark-on-
   download and image-crop paths both already draw a `<video>`/`<img>`
   into a `<canvas>`). Matching that gives this feature the same runtime
   footprint as code already proven to work on every device this app
   ships to, instead of gambling on WebGL support this project has never
   needed before. "Beauty" itself is a lightweight approximation, not a
   face-mesh AR pipeline — each preset is a `ctx.filter` CSS-filter
   string (brightness/contrast/saturation lift, a very small blur radius
   standing in for skin smoothing) plus, for the two warmer presets, one
   extra translucent color layer composited on top. A true landmark-
   tracked AR pipeline is a materially larger project and is NOT what
   this file builds — flagged here explicitly so that isn't discovered
   as a surprise later.

   PIPELINE: raw camera MediaStreamTrack → hidden `<video>` → each
   animation frame drawn into an offscreen `<canvas>` with the active
   preset's `ctx.filter` applied → `canvas.captureStream(30)` → its video
   track wrapped with `AgoraRTC.createCustomVideoTrack` → published in
   place of the raw camera track (same publish-before-unpublish swap as
   the audio side). Unlike audio, this DOES swap back to the raw camera
   track when the host selects "Original" — running the canvas loop has
   a real per-frame cost, so it only runs while a preset other than
   Original is actually active, the same "only pay for it while it's
   actually on" discipline app-patch-v37.js's button already follows for
   its own guest-only feature.

   The local preview (`#agora-local-video`) is redirected to show the
   SAME canvas the viewers see, not the raw camera feed — so what the
   host sees in their own preview is always exactly what's being
   published, with no separate "preview doesn't match what viewers see"
   drift.

   ═══════════════════════════════════════════════════════════════════════
   SCOPE — HOST ONLY, BOTH FEATURES
   ═══════════════════════════════════════════════════════════════════════
   Neither feature was requested for guest broadcasters, so — same
   discipline as app-patch-v37.js scoping its camera-flip button to
   guests only "per this session's own request" — both buttons here only
   ever render for `isRealHost()`. Extending either to guest broadcasters
   later is a real but separate piece of work (their tracks live in
   app-live-tiktok-patch.js's own closure, reached the app-patch-v37.js
   way, not the wrapping trick this file uses for the host).

   ═══════════════════════════════════════════════════════════════════════
   DATA MODEL / PERSISTENCE
   ═══════════════════════════════════════════════════════════════════════
   No Firestore collection, no rule change, nothing synced — both
   features are pure local media processing on the host's own device;
   every viewer simply receives the already-mixed audio track / already-
   filtered video track like any other published track, automatically,
   with no separate signaling needed. The only persistence is a plain
   `localStorage` entry (`emp_v55_prefs`) remembering the host's last-
   picked ambient track/volume and beauty preset/intensity so reopening
   either panel starts where they left off — convenience only, safe to
   delete at any time, nothing else reads or depends on it.
   ============================================================================= */

(function empyreanPatchV55() {
    'use strict';

    if (window._empPatchV55Loaded) {
        console.warn('[V55] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV55Loaded = true;

    function log(msg) { console.log('[V55] ' + msg); }
    function warn(msg) { console.warn('[V55] ' + msg); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    // Same host check every live-streaming patch in this codebase already
    // uses (app-patch-v33.js / app-patch-v37's own §2 / app-patch-v42.js's
    // v51+v52 sections all carry an identical copy).
    function isRealHost() {
        if (window.isGuest || !window.userState || !window.liveStreamData) return false;
        var sd = window.liveStreamData;
        var hid = sd.hostUserId || sd.hostId;
        return !!hid && window.userState.id === hid;
    }
    function isCurrentlyLive() {
        return !!(window.liveStreamData && window.liveStreamData.isLive && window._agoraActiveChannel);
    }

    /* =========================================================================
       §0 — tiny localStorage prefs (convenience only — see header)
       ========================================================================= */
    var PREFS_KEY = 'emp_v55_prefs';
    function _loadPrefs() {
        try {
            var raw = localStorage.getItem(PREFS_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }
    function _savePrefs(p) {
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* private-browsing/quota — non-fatal, just skip persistence */ }
    }
    var _prefs = _loadPrefs();

    /* =========================================================================
       §1 — AgoraRTC capture layer. Wraps the SDK's own factory functions to
       observe whatever app-live.js creates for the REAL host, without
       editing app-live.js. See header for why this is reliable.
       ========================================================================= */
    var _hostClient = null;       // this device's own host-role agoraClient, once seen
    var _rawMicTrack = null;      // the ORIGINAL Agora local audio track from initAgoraHost()
    var _rawCameraTrack = null;   // the ORIGINAL Agora local video track from initAgoraHost()
    var _capturedForChannel = null; // which channel these captures belong to, so a re-Go-Live resets cleanly

    function _resetCaptureIfNewChannel() {
        var ch = window._agoraActiveChannel;
        if (ch !== _capturedForChannel) {
            _capturedForChannel = ch;
            _hostClient = null;
            _rawMicTrack = null;
            _rawCameraTrack = null;
            _teardownAudioGraph();
            _teardownVideoPipeline(true);
        }
    }

    (function installAgoraWrappers() {
        function tryWrap() {
            if (typeof AgoraRTC === 'undefined' || AgoraRTC._empV55Wrapped) return;
            AgoraRTC._empV55Wrapped = true;

            var origCreateClient = AgoraRTC.createClient.bind(AgoraRTC);
            AgoraRTC.createClient = function () {
                var client = origCreateClient.apply(AgoraRTC, arguments);
                if (client && typeof client.setClientRole === 'function' && !client._empV55RoleWrapped) {
                    client._empV55RoleWrapped = true;
                    var origSetRole = client.setClientRole.bind(client);
                    client.setClientRole = function (role) {
                        var ret = origSetRole.apply(client, arguments);
                        if (role === 'host' && isRealHost()) {
                            _resetCaptureIfNewChannel();
                            _hostClient = client;
                            log('captured the real host\u2019s own Agora client.');
                        }
                        return ret;
                    };
                }
                return client;
            };

            if (typeof AgoraRTC.createMicrophoneAndCameraTracks === 'function') {
                var origBoth = AgoraRTC.createMicrophoneAndCameraTracks.bind(AgoraRTC);
                AgoraRTC.createMicrophoneAndCameraTracks = async function () {
                    var tracks = await origBoth.apply(AgoraRTC, arguments);
                    if (isRealHost()) {
                        _resetCaptureIfNewChannel();
                        _rawMicTrack = tracks && tracks[0] ? tracks[0] : _rawMicTrack;
                        _rawCameraTrack = tracks && tracks[1] ? tracks[1] : _rawCameraTrack;
                        log('captured host mic+camera tracks (' + (tracks ? tracks.length : 0) + ').');
                    }
                    return tracks;
                };
            }
            // Audio-only fallback path in initAgoraHost() (permission/camera
            // failure) — still worth capturing so the sound library keeps
            // working even when the host is broadcasting audio-only.
            if (typeof AgoraRTC.createMicrophoneAudioTrack === 'function') {
                var origMic = AgoraRTC.createMicrophoneAudioTrack.bind(AgoraRTC);
                AgoraRTC.createMicrophoneAudioTrack = async function () {
                    var track = await origMic.apply(AgoraRTC, arguments);
                    if (isRealHost() && track) {
                        _resetCaptureIfNewChannel();
                        _rawMicTrack = track;
                        log('captured host mic track (audio-only path).');
                    }
                    return track;
                };
            }
            log('AgoraRTC factory wrappers installed.');
        }
        tryWrap();
        // AgoraRTC loads via a CDN <script> tag — belt-and-suspenders retry
        // in case this file executes before that script has finished, the
        // same retry timing convention app-patch-v50.js's own gift-hook
        // arming already uses.
        setTimeout(tryWrap, 500);
        setTimeout(tryWrap, 1500);
        setTimeout(tryWrap, 4000);
        /* 2026-10-28: the SDK is lazy-loaded now (index.html's window._empLoadAgora) — wrap the moment it exists. */
        window.addEventListener('empyrean:agora-ready', tryWrap);
    })();

    /* 2026-11-08 FIX (Background Sound / Beauty-Filters answering "Go live first" while already live):
       the wrappers above only see tracks built by createMicrophoneAndCameraTracks/createMicrophoneAudioTrack.
       On Android, app-live.js's initAgoraHost() usually ends up on its held-camera path, which builds the
       host tracks with createCustomAudioTrack/createCustomVideoTrack — never wrapped, so _rawMicTrack /
       _rawCameraTrack stayed null and both panels refused to work. app-live.js now exposes the live host's
       own client + tracks as window._empLiveHost (read-only getters); adopt them here whenever the wrappers
       haven't captured anything (or captured a track that has since ended). */
    function _trackEnded(t) {
        try { var m = (t && typeof t.getMediaStreamTrack === 'function') ? t.getMediaStreamTrack() : null; return !!(m && m.readyState === 'ended'); }
        catch (e) { return false; }
    }
    function _adoptLiveHost() {
        try {
            var h = window._empLiveHost;
            if (!h || !isRealHost()) return;
            var hc = h.client;
            if (hc && hc !== _hostClient && (!_hostClient || _hostClient.connectionState === 'DISCONNECTED')) _hostClient = hc;
            var hm = h.mic, hv = h.cam;
            if (hm && (!_rawMicTrack || _trackEnded(_rawMicTrack))) _rawMicTrack = hm;
            if (hv && (!_rawCameraTrack || _trackEnded(_rawCameraTrack))) _rawCameraTrack = hv;
        } catch (e) { /* never let a lookup glitch break the live screen */ }
    }
    function _hostTracksReady() {
        _adoptLiveHost();
        return isRealHost() && isCurrentlyLive() && !!_hostClient && !!_rawMicTrack;
    }
    function _hostCameraReady() {
        return _hostTracksReady() && !!_rawCameraTrack;
    }
    /* Host is live on screen (possibly not yet connected to Agora) — used for the local-only fallbacks below. */
    function _localLiveOk() { return isRealHost() && !!(window.liveStreamData && window.liveStreamData.isLive); }

    /* =========================================================================
       §2 — shared Web Audio context (separate from app-patch-v42.js's own
       v50 clap-synthesis context — deliberately, same "one context per
       independent concern" discipline app-patch-v33.js's header already
       explains for why it runs its own listener instead of reusing
       another file's).
       ========================================================================= */
    var _actx = null;
    function _ensureAudioCtx() {
        if (_actx) return _actx;
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        try { _actx = new Ctx(); } catch (e) { _actx = null; }
        return _actx;
    }

    /* =========================================================================
       §3 — FEATURE 1: ambient sound library (synthesized, no audio files)
       ========================================================================= */
    var _ambient = {
        graphBuilt: false,
        micSource: null,
        ambientGain: null,   // host-controlled volume for the bed
        destination: null,   // MediaStreamAudioDestinationNode -> what gets published
        customTrack: null,   // the Agora custom audio track built from destination.stream
        activePresetId: null,
        activeStop: null,    // stop() fn for the currently-playing generator, or null
        published: false
    };

    // Each generator receives (ctx, outputGainNode) and must connect
    // whatever it builds into outputGainNode, then return a stop() fn that
    // tears its own nodes down. Kept intentionally simple/cheap — this
    // plays for the whole duration of a live stream, so no generator here
    // allocates more than a couple of oscillators/noise loops.
    // 2026-11-08: higher-quality synthesis. Pink/brown noise (instead of flat white noise), 8s stereo loops,
    // slow independent modulators so nothing sounds like a static loop, convolution reverb on the tonal beds,
    // and randomised crackle/drops. Still 100% generated at runtime - no audio files.
    function _ambNoise(ctx, kind) {
        var cache = ctx._empAmbNoise || (ctx._empAmbNoise = {});
        if (cache[kind]) return cache[kind];
        var len = Math.floor(ctx.sampleRate * 8);
        var buf = ctx.createBuffer(2, len, ctx.sampleRate);
        for (var ch = 0; ch < 2; ch++) {
            var d = buf.getChannelData(ch);
            var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
            for (var i = 0; i < len; i++) {
                var w = Math.random() * 2 - 1;
                if (kind === 'pink') {
                    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
                    b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
                    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
                } else if (kind === 'brown') {
                    last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5;
                } else { d[i] = w; }
            }
        }
        cache[kind] = buf;
        return buf;
    }
    function _ambLoop(ctx, kind) {
        var s = ctx.createBufferSource();
        s.buffer = _ambNoise(ctx, kind); s.loop = true;
        s.start(0, Math.random() * 4);
        return s;
    }
    function _ambReverb(ctx, secs, decay) {
        var len = Math.floor(ctx.sampleRate * secs);
        var ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (var ch = 0; ch < 2; ch++) {
            var d = ir.getChannelData(ch);
            for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
        var conv = ctx.createConvolver(); conv.buffer = ir;
        return conv;
    }
    function _ambLfo(ctx, freq, depth, target, nodes) {
        var o = ctx.createOscillator(); o.frequency.value = freq;
        var g = ctx.createGain(); g.gain.value = depth;
        o.connect(g); g.connect(target); o.start(); nodes.push(o);
        return o;
    }
    // Shared per-preset wrapper: one bus into `out`, every source/timer tracked, stop() fades out then tears down.
    function _ambRig(ctx, out) {
        var bus = ctx.createGain(); bus.gain.value = 1; bus.connect(out);
        var nodes = [], timers = [];
        return {
            bus: bus, nodes: nodes,
            timer: function (t) { timers.push(t); return t; },
            stop: function () {
                timers.forEach(function (t) { clearInterval(t); });
                try { bus.gain.cancelScheduledValues(ctx.currentTime); bus.gain.setTargetAtTime(0, ctx.currentTime, 0.06); } catch (e) {}
                setTimeout(function () {
                    nodes.forEach(function (n) { try { n.stop(); } catch (e) {} });
                    try { bus.disconnect(); } catch (e2) {}
                }, 500);
            }
        };
    }
    function _ambTick(ctx, dest, t, dur, type, freq, Q, vol) {
        var s = ctx.createBufferSource(); s.buffer = _ambNoise(ctx, 'white');
        var f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q;
        var g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
        s.connect(f); f.connect(g); g.connect(dest);
        s.start(t, Math.random() * 4, dur + 0.02);
    }

    var AMBIENT_PRESETS = [
        {
            id: 'ocean', label: '\uD83C\uDF0A Ocean Waves',
            build: function (ctx, out) {
                var r = _ambRig(ctx, out);
                // surf body: pink noise, cutoff and level swell together like a breaking wave
                var body = _ambLoop(ctx, 'pink'); r.nodes.push(body);
                var bodyLp = ctx.createBiquadFilter(); bodyLp.type = 'lowpass'; bodyLp.frequency.value = 650; bodyLp.Q.value = 0.5;
                var bodyG = ctx.createGain(); bodyG.gain.value = 0.34;
                _ambLfo(ctx, 0.085, 380, bodyLp.frequency, r.nodes);
                _ambLfo(ctx, 0.085, 0.24, bodyG.gain, r.nodes);
                body.connect(bodyLp); bodyLp.connect(bodyG); bodyG.connect(r.bus);
                // foam hiss: crests a little after the body (different LFO rate/phase)
                var foam = _ambLoop(ctx, 'pink'); r.nodes.push(foam);
                var foamHp = ctx.createBiquadFilter(); foamHp.type = 'highpass'; foamHp.frequency.value = 1900;
                var foamG = ctx.createGain(); foamG.gain.value = 0.07;
                _ambLfo(ctx, 0.113, 0.06, foamG.gain, r.nodes);
                foam.connect(foamHp); foamHp.connect(foamG); foamG.connect(r.bus);
                // deep sub rumble
                var deep = _ambLoop(ctx, 'brown'); r.nodes.push(deep);
                var deepLp = ctx.createBiquadFilter(); deepLp.type = 'lowpass'; deepLp.frequency.value = 160;
                var deepG = ctx.createGain(); deepG.gain.value = 0.32;
                deep.connect(deepLp); deepLp.connect(deepG); deepG.connect(r.bus);
                return r.stop;
            }
        },
        {
            id: 'rain', label: '\uD83C\uDF27\uFE0F Rain',
            build: function (ctx, out) {
                var r = _ambRig(ctx, out);
                var bed = _ambLoop(ctx, 'pink'); r.nodes.push(bed);
                var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 800;
                var pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 3800; pk.gain.value = 4; pk.Q.value = 0.7;
                var bedG = ctx.createGain(); bedG.gain.value = 0.2;
                _ambLfo(ctx, 0.05, 0.03, bedG.gain, r.nodes);
                bed.connect(hp); hp.connect(pk); pk.connect(bedG); bedG.connect(r.bus);
                var low = _ambLoop(ctx, 'brown'); r.nodes.push(low);
                var lowLp = ctx.createBiquadFilter(); lowLp.type = 'lowpass'; lowLp.frequency.value = 280;
                var lowG = ctx.createGain(); lowG.gain.value = 0.16;
                low.connect(lowLp); lowLp.connect(lowG); lowG.connect(r.bus);
                // individual drops
                r.timer(setInterval(function () {
                    var t = ctx.currentTime;
                    for (var k = 0; k < 2; k++) {
                        if (Math.random() < 0.6) _ambTick(ctx, r.bus, t + Math.random() * 0.06, 0.012 + Math.random() * 0.012, 'bandpass', 2800 + Math.random() * 4500, 7, 0.05 + Math.random() * 0.09);
                    }
                }, 60));
                return r.stop;
            }
        },
        {
            id: 'worship', label: '\uD83D\uDE4F Worship Pad',
            build: function (ctx, out) {
                var r = _ambRig(ctx, out);
                // C major add9 spread over four octaves, each voice = two slightly detuned saws -> warm "choir-synth" pad
                var freqs = [65.41, 130.81, 196.00, 261.63, 329.63, 392.00, 587.33];
                var padLp = ctx.createBiquadFilter(); padLp.type = 'lowpass'; padLp.frequency.value = 950; padLp.Q.value = 0.4;
                _ambLfo(ctx, 0.07, 320, padLp.frequency, r.nodes);
                var padG = ctx.createGain(); padG.gain.value = 0.0;
                padG.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 3.5);
                _ambLfo(ctx, 0.11, 0.07, padG.gain, r.nodes);
                var dry = ctx.createGain(); dry.gain.value = 0.7;
                var conv = _ambReverb(ctx, 3.8, 2.4); var wet = ctx.createGain(); wet.gain.value = 0.55;
                freqs.forEach(function (f, idx) {
                    [-7, 7].forEach(function (cents) {
                        var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = cents;
                        var vg = ctx.createGain(); vg.gain.value = (idx < 2 ? 0.05 : 0.03);
                        o.connect(vg); vg.connect(padLp); o.start(); r.nodes.push(o);
                    });
                });
                padLp.connect(padG); padG.connect(dry); dry.connect(r.bus);
                padG.connect(conv); conv.connect(wet); wet.connect(r.bus);
                return r.stop;
            }
        },
        {
            id: 'drone', label: '\uD83C\uDFB9 Soft Piano Drone',
            build: function (ctx, out) {
                var r = _ambRig(ctx, out);
                var conv = _ambReverb(ctx, 3.2, 2.2); var wet = ctx.createGain(); wet.gain.value = 0.5;
                var dry = ctx.createGain(); dry.gain.value = 0.8;
                var mix = ctx.createGain(); mix.gain.value = 1;
                mix.connect(dry); dry.connect(r.bus); mix.connect(conv); conv.connect(wet); wet.connect(r.bus);
                // quiet sustained low A underneath
                var sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 110;
                var subG = ctx.createGain(); subG.gain.value = 0.06;
                sub.connect(subG); subG.connect(mix); sub.start(); r.nodes.push(sub);
                // soft felt-piano notes: sine partials (1,2,3,4) with slightly different decay each, pentatonic A
                var scale = [220.00, 246.94, 277.18, 329.63, 369.99, 440.00];
                var partials = [[1, 0.5, 6.0], [2, 0.2, 4.0], [3, 0.09, 2.6], [4, 0.04, 1.6]];
                function strike() {
                    var t = ctx.currentTime + 0.02;
                    var f = scale[Math.floor(Math.random() * scale.length)];
                    var vel = 0.55 + Math.random() * 0.4;
                    partials.forEach(function (p) {
                        var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * p[0] * (1 + (Math.random() - 0.5) * 0.0015);
                        var g = ctx.createGain();
                        g.gain.setValueAtTime(0.0001, t);
                        g.gain.linearRampToValueAtTime(p[1] * vel * 0.35, t + 0.012);
                        g.gain.exponentialRampToValueAtTime(0.0001, t + p[2]);
                        o.connect(g); g.connect(mix); o.start(t); o.stop(t + p[2] + 0.1);
                    });
                }
                strike();
                r.timer(setInterval(strike, 3200 + Math.random() * 1200));
                return r.stop;
            }
        },
        {
            id: 'campfire', label: '\uD83D\uDD25 Campfire',
            build: function (ctx, out) {
                var r = _ambRig(ctx, out);
                var roar = _ambLoop(ctx, 'brown'); r.nodes.push(roar);
                var roarLp = ctx.createBiquadFilter(); roarLp.type = 'lowpass'; roarLp.frequency.value = 420;
                var roarG = ctx.createGain(); roarG.gain.value = 0.3;
                _ambLfo(ctx, 0.19, 0.06, roarG.gain, r.nodes);
                roar.connect(roarLp); roarLp.connect(roarG); roarG.connect(r.bus);
                var hiss = _ambLoop(ctx, 'pink'); r.nodes.push(hiss);
                var hissBp = ctx.createBiquadFilter(); hissBp.type = 'bandpass'; hissBp.frequency.value = 1500; hissBp.Q.value = 0.8;
                var hissG = ctx.createGain(); hissG.gain.value = 0.05;
                hiss.connect(hissBp); hissBp.connect(hissG); hissG.connect(r.bus);
                // randomised crackles and the occasional bigger pop
                r.timer(setInterval(function () {
                    var t = ctx.currentTime;
                    if (Math.random() < 0.55) _ambTick(ctx, r.bus, t, 0.004 + Math.random() * 0.02, 'highpass', 1400 + Math.random() * 2200, 0.7, 0.12 + Math.random() * 0.35);
                    if (Math.random() < 0.18) _ambTick(ctx, r.bus, t + 0.01, 0.02 + Math.random() * 0.03, 'bandpass', 650 + Math.random() * 500, 1.4, 0.35 + Math.random() * 0.3);
                }, 55));
                return r.stop;
            }
        }
    ];

    function _buildAudioGraphIfNeeded() {
        if (_ambient.graphBuilt) return true;
        if (!_hostTracksReady()) return false;
        var ctx = _ensureAudioCtx();
        if (!ctx) { warn('Web Audio unavailable — sound library cannot run on this device.'); return false; }
        try {
            var rawStreamTrack = typeof _rawMicTrack.getMediaStreamTrack === 'function' ? _rawMicTrack.getMediaStreamTrack() : null;
            if (!rawStreamTrack) { warn('could not read the raw MediaStreamTrack off the host mic track.'); return false; }
            _ambient.micSource = ctx.createMediaStreamSource(new MediaStream([rawStreamTrack]));
            _ambient.destination = ctx.createMediaStreamDestination();
            _ambient.ambientGain = ctx.createGain();
            var startVol = (_prefs.ambientVolume != null) ? _prefs.ambientVolume : 0.5;
            _ambient.ambientGain.gain.value = startVol;

            // Mic goes straight through, unaffected by the ambient volume
            // slider — only the bed's own gain is host-adjustable.
            _ambient.micSource.connect(_ambient.destination);
            _ambient.ambientGain.connect(_ambient.destination);

            _ambient.graphBuilt = true;
            return true;
        } catch (e) {
            warn('failed to build audio graph: ' + (e && e.message));
            return false;
        }
    }

    async function _publishMixedAudioIfNeeded() {
        if (_ambient.published) return true;
        if (!_buildAudioGraphIfNeeded()) return false;
        try {
            var mixedStreamTrack = _ambient.destination.stream.getAudioTracks()[0];
            _ambient.customTrack = AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: mixedStreamTrack });
            // Publish the mixed track BEFORE unpublishing the raw one — no
            // gap where the host is publishing zero audio (same ordering
            // app-patch-v37.js's own camera swap already uses).
            await _hostClient.publish([_ambient.customTrack]);
            try { await _hostClient.unpublish([_rawMicTrack]); } catch (eUnpub) { /* non-fatal — worst case both are briefly published together */ }
            _ambient.published = true;
            log('switched published audio to the mixed (mic + ambient) track.');
            return true;
        } catch (e) {
            notify('Could not enable the sound library: ' + (e && e.message ? e.message : 'try again.'), 'error');
            return false;
        }
    }

    /* 2026-11-08: when the host is live on screen but the Agora publish isn't connected (so there is no mic
       track to mix into), still play the bed on the host's own device so the panel visibly works, and say
       plainly that viewers get it once the broadcast connects. The remembered preset auto-applies through
       the normal mixed-track path the moment tracks become ready (see _tick). */
    function _playAmbientLocalOnly(presetId) {
        if (!_localLiveOk()) return false;
        var preset = AMBIENT_PRESETS.filter(function (p) { return p.id === presetId; })[0];
        if (!preset) return false;
        var ctx = _ensureAudioCtx();
        if (!ctx) return false;
        try { if (ctx.state === 'suspended') ctx.resume(); } catch (e) {}
        try {
            if (!_ambient.localGain) { _ambient.localGain = ctx.createGain(); _ambient.localGain.connect(ctx.destination); }
            _ambient.localGain.gain.value = (_prefs.ambientVolume != null) ? _prefs.ambientVolume : 0.5;
            if (_ambient.activeStop) { try { _ambient.activeStop(); } catch (e2) {} _ambient.activeStop = null; }
            _ambient.activeStop = preset.build(ctx, _ambient.localGain);
            _ambient.activePresetId = presetId;
            _prefs.ambientPreset = presetId;
            _savePrefs(_prefs);
            notify(preset.label + ' is playing on your device. It will reach viewers once your broadcast connects.', 'info');
            _renderSoundLibraryModal();
            return true;
        } catch (e3) {
            warn('local-only ambient failed: ' + (e3 && e3.message));
            return false;
        }
    }
    async function _playAmbient(presetId) {
        try { var _c0 = _ensureAudioCtx(); if (_c0 && _c0.state === 'suspended') _c0.resume(); } catch (e0) {}
        if (!_hostTracksReady()) {
            if (_playAmbientLocalOnly(presetId)) return;
            notify('Go live first, then pick a background sound.', 'warning'); return;
        }
        var preset = AMBIENT_PRESETS.filter(function (p) { return p.id === presetId; })[0];
        if (!preset) return;
        var ok = await _publishMixedAudioIfNeeded();
        if (!ok) return;
        if (_ambient.activeStop) { _ambient.activeStop(); _ambient.activeStop = null; }
        try {
            _ambient.activeStop = preset.build(_actx, _ambient.ambientGain);
            _ambient.activePresetId = presetId;
            _prefs.ambientPreset = presetId;
            _savePrefs(_prefs);
            notify(preset.label + ' is now playing under your mic.', 'success');
            _renderSoundLibraryModal();
        } catch (e) {
            warn('failed to start preset ' + presetId + ': ' + (e && e.message));
        }
    }
    function _stopAmbient() {
        if (_ambient.activeStop) { _ambient.activeStop(); _ambient.activeStop = null; }
        _ambient.activePresetId = null;
        _prefs.ambientPreset = null;
        _savePrefs(_prefs);
        // Deliberately does NOT swap back to the raw mic track — see
        // header (§1 of Feature 1): the mixed graph is a transparent
        // passthrough with the bed silenced, so there's no benefit to the
        // swap-back complexity the video pipeline needs for CPU reasons.
        _renderSoundLibraryModal();
    }
    function _setAmbientVolume(v) {
        v = Math.max(0, Math.min(1, v));
        _prefs.ambientVolume = v;
        _savePrefs(_prefs);
        if (_ambient.ambientGain) {
            try { _ambient.ambientGain.gain.setTargetAtTime(v, _actx.currentTime, 0.05); } catch (e) { _ambient.ambientGain.gain.value = v; }
        }
        if (_ambient.localGain) {
            try { _ambient.localGain.gain.setTargetAtTime(v, _actx.currentTime, 0.05); } catch (eL) { _ambient.localGain.gain.value = v; }
        }
    }

    function _teardownAudioGraph() {
        if (_ambient.activeStop) { try { _ambient.activeStop(); } catch (e) {} _ambient.activeStop = null; }
        try { if (_ambient.micSource) _ambient.micSource.disconnect(); } catch (e) {}
        try { if (_ambient.ambientGain) _ambient.ambientGain.disconnect(); } catch (e) {}
        try { if (_ambient.customTrack) { _ambient.customTrack.close(); } } catch (e) {}
        try { if (_ambient.localGain) _ambient.localGain.disconnect(); } catch (e) {}
        _ambient.localGain = null;
        _ambient.graphBuilt = false;
        _ambient.published = false;
        _ambient.micSource = null;
        _ambient.ambientGain = null;
        _ambient.destination = null;
        _ambient.customTrack = null;
        _ambient.activePresetId = null;
    }

    /* =========================================================================
       §4 — FEATURE 2: beauty / filter effects (canvas 2D pipeline)
       ========================================================================= */
    var BEAUTY_PRESETS = [
        { id: 'original', label: 'Original', filter: 'none', overlay: null },
        { id: 'glow', label: '\u2728 Natural Glow', filter: 'brightness(1.08) contrast(1.04) saturate(1.12) blur(0.4px)', overlay: null },
        { id: 'soft', label: '\uD83C\uDF19 Soft Focus', filter: 'brightness(1.05) contrast(0.97) blur(0.9px)', overlay: null },
        { id: 'bright', label: '\u2600\uFE0F Bright', filter: 'brightness(1.18) contrast(1.06) saturate(1.05)', overlay: null },
        { id: 'warm', label: '\uD83C\uDF45 Warm Tone', filter: 'brightness(1.06) contrast(1.03) saturate(1.15)', overlay: 'rgba(255,150,60,0.10)' }
    ];

    var _beauty = {
        video: null,      // hidden <video> playing the raw camera stream
        canvas: null,
        ctx2d: null,
        rafId: null,
        customTrack: null,
        activePresetId: 'original',
        published: false, // true while the CANVAS track (not raw camera) is what's published
        intensity: 1.0    // 0..1, scales how strongly the filter is applied
    };

    function _scaledFilter(preset, intensity) {
        if (preset.id === 'original' || intensity <= 0) return 'none';
        // Cheap linear interpolation toward "no filter" as intensity drops,
        // so the slider actually does something instead of being all-or-
        // nothing. Only touches the numeric filter functions; blur is
        // scaled directly in px.
        var m = intensity;
        return preset.filter.replace(/([\d.]+)(px)?/g, function (full, num, isPx) {
            var n = parseFloat(num);
            if (isPx) return (n * m).toFixed(2) + 'px';
            var delta = n - 1;
            return (1 + delta * m).toFixed(3);
        });
    }

    function _ensureCanvasPipeline() {
        if (_beauty.canvas) return true;
        if (!_hostCameraReady()) return false;
        try {
            var rawStreamTrack = typeof _rawCameraTrack.getMediaStreamTrack === 'function' ? _rawCameraTrack.getMediaStreamTrack() : null;
            if (!rawStreamTrack) { warn('could not read the raw MediaStreamTrack off the host camera track.'); return false; }

            var video = document.createElement('video');
            video.muted = true; video.playsInline = true; video.autoplay = true;
            video.srcObject = new MediaStream([rawStreamTrack]);
            video.play().catch(function () {});

            var canvas = document.createElement('canvas');
            var ctx2d = canvas.getContext('2d');

            _beauty.video = video;
            _beauty.canvas = canvas;
            _beauty.ctx2d = ctx2d;
            return true;
        } catch (e) {
            warn('failed to set up beauty pipeline: ' + (e && e.message));
            return false;
        }
    }

    function _drawLoop() {
        _beauty.rafId = requestAnimationFrame(_drawLoop);
        var v = _beauty.video, c = _beauty.canvas, ctx = _beauty.ctx2d;
        if (!v || v.readyState < 2) return; // not enough data yet this frame
        if (c.width !== v.videoWidth && v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
        if (!c.width) return;
        var preset = BEAUTY_PRESETS.filter(function (p) { return p.id === _beauty.activePresetId; })[0] || BEAUTY_PRESETS[0];
        ctx.filter = _scaledFilter(preset, _beauty.intensity);
        ctx.drawImage(v, 0, 0, c.width, c.height);
        if (preset.overlay && _beauty.intensity > 0) {
            ctx.filter = 'none';
            ctx.fillStyle = preset.overlay;
            ctx.globalCompositeOperation = 'soft-light';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.globalCompositeOperation = 'source-over';
        }
    }

    function _showCanvasAsPreview() {
        var wrapper = document.getElementById('agora-local-video');
        if (!wrapper) return;
        var existing = document.getElementById('pv55-beauty-canvas-preview');
        if (existing) return; // already swapped in
        _beauty.canvas.id = 'pv55-beauty-canvas-preview';
        _beauty.canvas.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        wrapper.appendChild(_beauty.canvas);
        var rawVideoEl = wrapper.querySelector('video');
        if (rawVideoEl) rawVideoEl.style.display = 'none'; // keep it in the DOM (still the capture source), just hide it
    }
    function _hideCanvasPreview() {
        var el = document.getElementById('pv55-beauty-canvas-preview');
        if (el) el.remove();
        var wrapper = document.getElementById('agora-local-video');
        var rawVideoEl = wrapper && wrapper.querySelector('video');
        if (rawVideoEl) rawVideoEl.style.display = '';
    }

    async function _publishCanvasVideoIfNeeded() {
        if (_beauty.published) return true;
        if (!_ensureCanvasPipeline()) return false;
        if (!_beauty.rafId) _drawLoop();
        try {
            var canvasStream = _beauty.canvas.captureStream(30);
            var canvasStreamTrack = canvasStream.getVideoTracks()[0];
            _beauty.customTrack = AgoraRTC.createCustomVideoTrack({ mediaStreamTrack: canvasStreamTrack });
            await _hostClient.publish([_beauty.customTrack]);
            try { await _hostClient.unpublish([_rawCameraTrack]); } catch (eUnpub) {}
            _beauty.published = true;
            _showCanvasAsPreview();
            log('switched published video to the beauty-filtered canvas track.');
            return true;
        } catch (e) {
            notify('Could not enable filters: ' + (e && e.message ? e.message : 'try again.'), 'error');
            return false;
        }
    }
    async function _revertToRawVideo() {
        if (!_beauty.published) return;
        try {
            await _hostClient.publish([_rawCameraTrack]);
            try { await _hostClient.unpublish([_beauty.customTrack]); } catch (eUnpub) {}
        } catch (e) {
            warn('could not cleanly revert to the raw camera track: ' + (e && e.message));
        }
        try { if (_beauty.customTrack) _beauty.customTrack.close(); } catch (e) {}
        _beauty.customTrack = null;
        _beauty.published = false;
        _hideCanvasPreview();
        if (_beauty.rafId) { cancelAnimationFrame(_beauty.rafId); _beauty.rafId = null; }
    }

    /* 2026-11-08: when the host is live on screen but the camera track isn't connected to the Agora publish,
       apply the filter to the host's own preview so the panel visibly works, and say that viewers get it once
       the camera is connected (the remembered preset then auto-applies through the canvas pipeline, see _tick). */
    function _localFilterTargets() {
        var out = [];
        var w = document.getElementById('agora-local-video');
        if (w) Array.prototype.forEach.call(w.querySelectorAll('video'), function (v) { out.push(v); });
        var hv = document.getElementById('host-main-video');
        if (hv) out.push(hv);
        return out;
    }
    function _applyLocalFilterPreview(presetId) {
        if (!_localLiveOk()) return false;
        var preset = BEAUTY_PRESETS.filter(function (p) { return p.id === presetId; })[0];
        if (!preset) return false;
        var targets = _localFilterTargets();
        if (!targets.length) return false;
        var f = _scaledFilter(preset, _beauty.intensity);
        targets.forEach(function (el) { el.style.filter = (f === 'none') ? '' : f; });
        _beauty.localFilterOn = (presetId !== 'original');
        return true;
    }
    function _clearLocalFilterPreview() {
        _localFilterTargets().forEach(function (el) { el.style.filter = ''; });
        _beauty.localFilterOn = false;
    }
    async function _selectBeautyPreset(presetId) {
        if (!_hostCameraReady()) {
            if (_applyLocalFilterPreview(presetId)) {
                _beauty.activePresetId = presetId;
                _prefs.beautyPreset = presetId;
                _savePrefs(_prefs);
                var _lp = BEAUTY_PRESETS.filter(function (p) { return p.id === presetId; })[0];
                notify(presetId === 'original' ? 'Filters off.' : ((_lp ? _lp.label : 'Filter') + ' applied to your preview. It will reach viewers once your camera connects to the broadcast.'), 'info');
                _renderBeautyModal();
                return;
            }
            notify('Go live with your camera on first, then pick a filter.', 'warning'); return;
        }
        _clearLocalFilterPreview();
        _beauty.activePresetId = presetId;
        _prefs.beautyPreset = presetId;
        _savePrefs(_prefs);
        if (presetId === 'original') {
            await _revertToRawVideo();
            notify('Filters off — back to your original camera.', 'info');
        } else {
            var ok = await _publishCanvasVideoIfNeeded();
            if (ok) {
                var preset = BEAUTY_PRESETS.filter(function (p) { return p.id === presetId; })[0];
                notify((preset ? preset.label : 'Filter') + ' applied.', 'success');
            }
        }
        _renderBeautyModal();
    }
    function _setBeautyIntensity(v) {
        v = Math.max(0, Math.min(1, v));
        _beauty.intensity = v;
        _prefs.beautyIntensity = v;
        _savePrefs(_prefs);
        if (_beauty.localFilterOn) _applyLocalFilterPreview(_beauty.activePresetId);
    }

    function _teardownVideoPipeline(hard) {
        if (_beauty.rafId) { cancelAnimationFrame(_beauty.rafId); _beauty.rafId = null; }
        _hideCanvasPreview();
        try { if (_beauty.customTrack) _beauty.customTrack.close(); } catch (e) {}
        _beauty.customTrack = null;
        _beauty.published = false;
        if (hard) {
            try { if (_beauty.video) { _beauty.video.pause(); _beauty.video.srcObject = null; } } catch (e) {}
            _beauty.video = null;
            _beauty.canvas = null;
            _beauty.ctx2d = null;
            _beauty.activePresetId = _prefs.beautyPreset || 'original';
        }
    }

    /* =========================================================================
       §5 — UI: CSS, the two host-control-panel buttons, and their modals.
       Everything below reuses the existing `.live-sub-modal` bottom-sheet
       class (no new modal chrome) and the existing `.live-action-btn
       host-control` button styling — the same reuse app-patch-v42.js's
       own poll/PK modals and app-patch-v33.js's crown icon already rely
       on, so nothing here needs new base CSS beyond a couple of grid/
       slider rules scoped to this file's own ids.
       ========================================================================= */
    (function injectCSS() {
        if (document.getElementById('pv55-css')) return;
        var css = document.createElement('style');
        css.id = 'pv55-css';
        css.textContent =
            '.pv55-preset-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:4px 2px;}' +
            '.pv55-preset-btn{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:12px;padding:14px 8px;text-align:center;cursor:pointer;font-size:var(--text-md);transition:var(--transition-base, all .15s ease);}' +
            '.pv55-preset-btn:active{transform:scale(0.96);}' +
            '.pv55-preset-btn.pv55-active{background:var(--accent-color, #f5a623);border-color:transparent;color:#1a1a1a;font-weight:600;}' +
            '.pv55-slider-row{display:flex;align-items:center;gap:10px;margin-top:14px;color:#eee;font-size:var(--text-sm);}' +
            '.pv55-slider-row input[type="range"]{flex:1;}' +
            '.pv55-stop-btn{width:100%;margin-top:14px;}';
        document.head.appendChild(css);
    })();

    // FIX (bug report: "works on the first tap, then stops responding"):
    // this used to be a plain `.classList.add('show')` — fine for OPENING
    // the modal once, but every tap after that landed on an ALREADY-open
    // modal, so `.add('show')` was a true no-op: nothing on screen changed,
    // which reads exactly like "the button stopped working," even though
    // the tap itself was reaching this function correctly every single
    // time (confirmed — this was never a click-propagation bug). Every
    // OTHER icon on this same panel (chevron/viewers/trophy/requests bell)
    // already opens AND closes via a single `.classList.toggle('show')` on
    // repeat taps of the SAME icon — these two didn't match that pattern.
    // Now they do: tapping the icon again while its own modal is showing
    // closes it, exactly like its neighbors, so a tap on this icon is
    // never a no-op. Also closes the OTHER of this pair (sound/beauty) so
    // the two can never both be open/stacked on top of each other at once.
    function _openSoundModal() {
        /* 2026-11-08 FIX (sound panel works once, then later taps do nothing): if the live screen was rebuilt the modal node is
           gone until the next 800ms tick, and this used to return silently. Re-create it on demand instead. */
        try { _ensureModals(); } catch (eEm) {}
        var m = document.getElementById('pv55-sound-modal');
        if (!m) return;
        var opening = !m.classList.contains('show');
        if (opening) { if (window._empCloseOtherLiveSheets) window._empCloseOtherLiveSheets(m); }
        m.classList.toggle('show');
        var other = document.getElementById('pv55-beauty-modal');
        if (opening && other) other.classList.remove('show');
        if (opening) _renderSoundLibraryModal();
    }
    function _openBeautyModal() {
        try { _ensureModals(); } catch (eEm2) {}
        var m = document.getElementById('pv55-beauty-modal');
        if (!m) return;
        var opening = !m.classList.contains('show');
        if (opening) { if (window._empCloseOtherLiveSheets) window._empCloseOtherLiveSheets(m); }
        m.classList.toggle('show');
        var other = document.getElementById('pv55-sound-modal');
        if (opening && other) other.classList.remove('show');
        if (opening) _renderBeautyModal();
    }

    function _ensureHostButtons() {
        if (!isRealHost()) { _removeHostButtons(); return; }
        var panel = document.getElementById('host-control-panel-inner');
        if (!panel) return;
        if (!document.getElementById('pv55-sound-btn')) {
            var soundBtn = document.createElement('button');
            soundBtn.id = 'pv55-sound-btn';
            soundBtn.type = 'button';
            soundBtn.className = 'live-action-btn host-control';
            soundBtn.title = 'Background Sound';
            soundBtn.innerHTML = '<i class="fas fa-music"></i>';
            panel.appendChild(soundBtn);
            soundBtn.addEventListener('click', _openSoundModal);
        }
        if (!document.getElementById('pv55-beauty-btn')) {
            var beautyBtn = document.createElement('button');
            beautyBtn.id = 'pv55-beauty-btn';
            beautyBtn.type = 'button';
            beautyBtn.className = 'live-action-btn host-control';
            beautyBtn.title = 'Beauty / Filters';
            beautyBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i>';
            panel.appendChild(beautyBtn);
            beautyBtn.addEventListener('click', _openBeautyModal);
        }
    }
    function _removeHostButtons() {
        var s = document.getElementById('pv55-sound-btn'); if (s) s.remove();
        var b = document.getElementById('pv55-beauty-btn'); if (b) b.remove();
    }

    // FIX (bug report: "control panel buttons — first click works, then
    // stop responding / never work at all"): #pv55-sound-btn and
    // #pv55-beauty-btn only ever had a plain bubble-phase listener bound
    // directly to the button. Every OTHER control on this exact panel
    // (toggle, viewers count, rank trophy, join-request, end-live) hit
    // this identical symptom and was fixed the same way — see
    // app-live-tiktok-patch.js's "SINGLE AUTHORITATIVE HANDLER" header —
    // a capture-phase listener on `document` always runs before
    // app-fixes.js's large body-level bubble delegate (registered at
    // document.body, handling most of the app's click routing) can ever
    // intercept or otherwise interfere with the same tap. Applying that
    // same proven fix here, for these two buttons specifically.
    // stopPropagation() prevents this from double-firing alongside the
    // button's own listener above.
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        var sBtn = e.target.closest('#pv55-sound-btn');
        if (sBtn) { e.stopImmediatePropagation(); e.preventDefault(); _openSoundModal(); return; }
        var bBtn = e.target.closest('#pv55-beauty-btn');
        if (bBtn) { e.stopImmediatePropagation(); e.preventDefault(); _openBeautyModal(); return; }
    }, true);

    function _ensureModals() {
        var container = document.getElementById('live-stream-screen') || document.body;
        if (!document.getElementById('pv55-sound-modal')) {
            var m1 = document.createElement('div');
            m1.id = 'pv55-sound-modal';
            m1.className = 'live-sub-modal';
            m1.innerHTML =
                '<button type="button" class="close-modal pv55-close" style="color:white; z-index:5; top:5px; right:10px;">\u00d7</button>' +
                '<h3>\uD83C\uDFB6 Background Sound</h3>' +
                '<div class="pv55-preset-grid" id="pv55-sound-grid"></div>' +
                '<button type="button" class="pv55-preset-btn" id="pv55-sound-upload" style="width:100%;margin:8px 0;">\uD83C\uDFB5 Add my own music (from this phone)</button>' +
                '<input type="file" id="pv55-sound-file" accept="audio/*" multiple style="display:none">' +
                '<div class="pv55-slider-row"><i class="fas fa-volume-down"></i><input type="range" id="pv55-sound-vol" min="0" max="100" value="50"><i class="fas fa-volume-up"></i></div>' +
                '<button type="button" class="btn btn-danger pv55-stop-btn" id="pv55-sound-stop">Stop Background Sound</button>';
            container.appendChild(m1);
            m1.querySelector('.pv55-close').addEventListener('click', function () { m1.classList.remove('show'); });
            m1.querySelector('#pv55-sound-stop').addEventListener('click', _stopAmbient);
            m1.querySelector('#pv55-sound-vol').addEventListener('input', function (e) { _setAmbientVolume(e.target.value / 100); });
            // 2026-11-08: user-supplied background music. A web page cannot browse the phone's music app
            // directly; the system file picker (accept="audio/*") is the supported route and lists the
            // phone's Music/Audio files. Files live only for this session (object URLs, not uploaded).
            var _upBtn = m1.querySelector('#pv55-sound-upload'), _upIn = m1.querySelector('#pv55-sound-file');
            _upBtn.addEventListener('click', function () { _upIn.click(); });
            _upIn.addEventListener('change', function () {
                var files = Array.prototype.slice.call(_upIn.files || []);
                _upIn.value = '';
                var firstId = null;
                files.forEach(function (f) {
                    if (!(/^audio\//.test(f.type) || /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(f.name))) { notify('"' + f.name + '" is not an audio file.', 'warning'); return; }
                    if (f.size > 60 * 1024 * 1024) { notify('"' + f.name + '" is over 60 MB — pick a smaller track.', 'warning'); return; }
                    var id = _addCustomAmbient(f);
                    if (!firstId) firstId = id;
                });
                _renderSoundLibraryModal();
                if (firstId) _playAmbient(firstId);
            });
        }
        if (!document.getElementById('pv55-beauty-modal')) {
            var m2 = document.createElement('div');
            m2.id = 'pv55-beauty-modal';
            m2.className = 'live-sub-modal';
            m2.innerHTML =
                '<button type="button" class="close-modal pv55-close" style="color:white; z-index:5; top:5px; right:10px;">\u00d7</button>' +
                '<h3>\u2728 Beauty / Filters</h3>' +
                '<div class="pv55-preset-grid" id="pv55-beauty-grid"></div>' +
                '<div class="pv55-slider-row"><span>Intensity</span><input type="range" id="pv55-beauty-intensity" min="0" max="100" value="100"></div>';
            container.appendChild(m2);
            m2.querySelector('.pv55-close').addEventListener('click', function () { m2.classList.remove('show'); });
            m2.querySelector('#pv55-beauty-intensity').addEventListener('input', function (e) { _setBeautyIntensity(e.target.value / 100); });
        }
    }

    var _customAmbientSeq = 0;
    function _addCustomAmbient(file) {
        var id = 'custom-' + (++_customAmbientSeq) + '-' + Date.now();
        var url = URL.createObjectURL(file);
        var name = String(file.name || 'My music').replace(/\.[^.]+$/, '');
        if (name.length > 26) name = name.slice(0, 25) + '\u2026';
        AMBIENT_PRESETS.push({
            id: id, label: '\uD83C\uDFB5 ' + esc(name), custom: true,
            build: function (ctx, out) {
                var a = new Audio();
                a.loop = true; a.preload = 'auto'; a.setAttribute('playsinline', '');
                a.src = url;
                var src = ctx.createMediaElementSource(a);
                src.connect(out);
                var pr = a.play(); if (pr && pr.catch) pr.catch(function (e) { warn('custom track play() blocked: ' + (e && e.message)); });
                return function stop() {
                    try { a.pause(); } catch (e1) {}
                    try { src.disconnect(); } catch (e2) {}
                    try { a.removeAttribute('src'); a.load(); } catch (e3) {}
                };
            }
        });
        return id;
    }

    function _renderSoundLibraryModal() {
        var grid = document.getElementById('pv55-sound-grid');
        if (!grid) return;
        grid.innerHTML = AMBIENT_PRESETS.map(function (p) {
            var active = p.id === _ambient.activePresetId ? ' pv55-active' : '';
            return '<button type="button" class="pv55-preset-btn' + active + '" data-pv55-sound="' + esc(p.id) + '">' + p.label + '</button>';
        }).join('');
        var vol = document.getElementById('pv55-sound-vol');
        if (vol) vol.value = Math.round(((_ambient.ambientGain ? _ambient.ambientGain.gain.value : (_prefs.ambientVolume != null ? _prefs.ambientVolume : 0.5))) * 100);
    }
    function _renderBeautyModal() {
        var grid = document.getElementById('pv55-beauty-grid');
        if (!grid) return;
        grid.innerHTML = BEAUTY_PRESETS.map(function (p) {
            var active = p.id === _beauty.activePresetId ? ' pv55-active' : '';
            return '<button type="button" class="pv55-preset-btn' + active + '" data-pv55-beauty="' + esc(p.id) + '">' + p.label + '</button>';
        }).join('');
        var intensity = document.getElementById('pv55-beauty-intensity');
        if (intensity) intensity.value = Math.round(_beauty.intensity * 100);
    }

    /* 2026-11-08 FIX (Background Sound / Beauty presets work on the first tap, then later taps do nothing): these preset
       buttons were handled by a bubble-phase listener, which app-fixes.js's body-level click delegate can swallow (it runs
       first and stops propagation for some taps inside the live screen) -- the same trap every other live-panel button here
       was already moved out of. Capture phase on document always runs first, so every tap reaches the preset code; a short
       debounce keeps one physical tap = one action, and each call is wrapped so one failure can never block the next tap. */
    var _pv55LastPresetTap = 0;
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        var soundBtn = e.target.closest('[data-pv55-sound]');
        var beautyBtn = soundBtn ? null : e.target.closest('[data-pv55-beauty]');
        if (!soundBtn && !beautyBtn) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        var _n = Date.now();
        if (_n - _pv55LastPresetTap < 250) return;
        _pv55LastPresetTap = _n;
        try {
            if (soundBtn) { var _pr = _playAmbient(soundBtn.getAttribute('data-pv55-sound')); if (_pr && _pr.catch) _pr.catch(function (eP) { warn('sound preset failed: ' + (eP && eP.message)); }); }
            else _selectBeautyPreset(beautyBtn.getAttribute('data-pv55-beauty'));
        } catch (ePreset) { warn('preset tap failed: ' + (ePreset && ePreset.message)); }
    }, true);

    /* =========================================================================
       §6 — lifecycle: poll for host+live+tracks-ready (same 800ms polling
       convention app-live-final.js's own _watchGuestSelfState and
       app-patch-v37.js's §2 already use, for the same reason — there's no
       single reliable DOM event covering every path into/out of this
       state), show/hide the two buttons accordingly, and tear everything
       down cleanly when the stream ends.
       ========================================================================= */
    var _wasLiveWithTracks = false;
    function _tick() {
        _ensureModals();
        _ensureHostButtons();
        var readyNow = _hostTracksReady();
        if (readyNow && !_wasLiveWithTracks) {
            // Re-apply a remembered preset from a previous session, if any —
            // convenience only (see §0). Never auto-starts anything the
            // host didn't already choose at least once before.
            if (_prefs.ambientPreset) _playAmbient(_prefs.ambientPreset);
            if (_prefs.beautyPreset && _prefs.beautyPreset !== 'original') {
                _beauty.intensity = _prefs.beautyIntensity != null ? _prefs.beautyIntensity : 1.0;
                _selectBeautyPreset(_prefs.beautyPreset);
            }
        }
        if (!readyNow && _wasLiveWithTracks) {
            // Stream ended (or this device is no longer the live host) —
            // tear both pipelines down so nothing leaks into a future
            // session's fresh tracks.
            _teardownAudioGraph();
            _teardownVideoPipeline(true);
        }
        /* 2026-11-08 FIX ("after exiting, the sound keeps playing"): the teardown above only runs if Agora tracks were
           ever ready (_wasLiveWithTracks). A bed started through the local-only path (broadcast not connected) never
           set that flag, so ending the live left the generator / uploaded track playing forever. Stop the bed as soon
           as this device is no longer the live host, whatever path started it. */
        if (!_localLiveOk() && (_ambient.activeStop || _ambient.localGain)) {
            _teardownAudioGraph();
            try { _renderSoundLibraryModal(); } catch (eRs) {}
        }
        _wasLiveWithTracks = readyNow;
    }
    setInterval(_tick, 800);
    document.addEventListener('empyrean-init-done', function () { setTimeout(_tick, 500); });

    console.log('[EmpyreanPatchV55] \u2705 Background sound library (5 synthesized ambient presets, host-volume-controlled, mixed under the mic via Web Audio) and beauty/filter effects (5 canvas-2D presets with an intensity slider) added for the real host only. Built as a fully standalone, unmerged file — zero edits to any other file, via AgoraRTC factory wrapping (see header \u00a71). Not yet folded into app-patch-v42.js\u2019s merged block, per this session\u2019s instruction.');

})();

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v56
   (lives inside app-patch-v55.js — see that file's own top header for why
   v55/v56/v57/v58/v59 are being built back-to-back in one standalone,
   unmerged file before a later merge into app-patch-v42.js)

   FEATURE — LIVE SHOPPING / PRODUCT PIN

   REQUESTED: let the host pin one of their own Marketplace listings while
   live, so every viewer sees a small tappable product card over the
   stream and can jump straight to that listing.

   ═══════════════════════════════════════════════════════════════════════
   DATA MODEL
   ═══════════════════════════════════════════════════════════════════════
   One new optional field on the EXISTING active_streams/{streamId} doc:
   `pinnedProduct: { listingId, name, price, currency, image, sellerId,
   pinnedAt } | <deleted>`. No new collection, no new security rule —
   this reuses active_streams' own existing permissive update rule, the
   same reuse app-patch-v42.js's poll/chat-mode fields (§1 of that file)
   and app-patch-v37.js already rely on for the same doc.

   REQUIRED FIRESTORE INDEX ADDITION (only needed the first time the host
   opens the picker — Firestore requires a composite index for an
   equality filter combined with an orderBy on a different field):
     Collection: marketplace_listings
     Fields:     sellerId  Ascending,  createdAt  Descending
   Firestore's own console throws a direct "create index" link with this
   exact spec the first time the query below runs, so this isn't
   guesswork — the fallback in §2 also degrades gracefully (client-side
   sort) if that index isn't in place yet, so the feature still works,
   just unsorted-from-the-server, until the index finishes building.

   ═══════════════════════════════════════════════════════════════════════
   WHY THIS NEEDED NO EDIT TO ANY OTHER FILE
   ═══════════════════════════════════════════════════════════════════════
   Same discipline as v55's own AgoraRTC-wrapping section: the pinned-
   product card is a floating overlay appended into `#live-stream-screen`
   (already the container every other live sub-modal in this codebase
   appends into), and the doc listener is this patch's OWN onSnapshot on
   active_streams/{streamId} — the exact "one shared onSnapshot, don't
   reach into another file's" pattern app-patch-v42.js's §1 already
   documents doing for polls/chat-mode. Tapping the card to jump to the
   listing reuses the SAME deep-link-by-polling-the-DOM technique
   app-startup.js's own `_openReelById` already uses for shared post/reel
   links — search for `.property-card[data-id="…"]` under
   `#property-grid-container` (the id app-fixes.js's own listing-card
   builder already sets — verified against that file directly) rather
   than inventing a new per-listing route, since this app doesn't have
   one (see app-fixes.js's own comment: "no per-listing deep-link view
   anywhere in this app").
   ============================================================================= */

(function empyreanPatchV56() {
    'use strict';

    if (window._empPatchV56Loaded) {
        console.warn('[V56] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV56Loaded = true;

    function log(msg) { console.log('[V56] ' + msg); }
    function warn(msg) { console.warn('[V56] ' + msg); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function isRealHost() {
        if (window.isGuest || !window.userState || !window.liveStreamData) return false;
        var sd = window.liveStreamData;
        var hid = sd.hostUserId || sd.hostId;
        return !!hid && window.userState.id === hid;
    }
    function isCurrentlyLive() {
        return !!(window.liveStreamData && window.liveStreamData.isLive);
    }
    function _streamId() { return window.liveStreamData && window.liveStreamData.streamId; }
    function _streamRef() {
        var db = window.fbDb, sid = _streamId();
        if (!db || !sid || !window._firebaseLoaded) return null;
        return db.collection('active_streams').doc(sid);
    }
    function _fmtPrice(p, cur) {
        var n = Number(p);
        return (cur || '') + ' ' + (isNaN(n) ? p : n.toLocaleString());
    }

    /* FIX (2026-10-03 — "picture of the pinned product listing is broken"):
       listing.media[0] was dropped straight into <img src>. That breaks when
       the first media item is (a) a VIDEO (Cloudinary .mp4 / /video/upload/
       url — an <img> can't render it), (b) an {url,type} object instead of a
       plain string, or (c) a blob:/empty value. Now every media entry is
       normalised to a real still-image URL (Cloudinary video -> jpg frame,
       Cloudinary image -> small cropped thumbnail), images are preferred
       over videos, the marketplace card's own <img> is used as a fallback,
       and a broken <img> falls back to the shopping-bag icon. */
    function _isVidUrl(u) {
        return /\/video\/upload\//i.test(u) || /\.(mp4|webm|mov|avi|mkv|ogg)(\?|#|$)/i.test(u);
    }
    function _normThumb(m) {
        var u = '';
        if (typeof m === 'string') u = m;
        else if (m && typeof m === 'object') u = m.thumbnail || m.thumb || m.poster || m.url || m._cloudUrl || '';
        u = String(u || '').trim();
        if (!u || /^blob:/i.test(u)) return '';
        if (_isVidUrl(u)) {
            if (/res\.cloudinary\.com/i.test(u) && /\/video\/upload\//i.test(u)) {
                return u.replace('/video/upload/', '/video/upload/so_0,w_200,h_200,c_fill,f_jpg/')
                        .replace(/\.(mp4|webm|mov|avi|mkv|ogg)(\?.*)?$/i, '.jpg');
            }
            return '';
        }
        if (/res\.cloudinary\.com/i.test(u) && /\/image\/upload\//i.test(u) && !/\/image\/upload\/[^\/]*(w_|c_|h_)/i.test(u)) {
            u = u.replace('/image/upload/', '/image/upload/w_200,h_200,c_fill,q_auto/');
        }
        return u;
    }
    function _pickThumb(media) {
        if (!Array.isArray(media)) return '';
        var firstVid = '';
        for (var i = 0; i < media.length; i++) {
            var raw = typeof media[i] === 'string' ? media[i] : (media[i] && (media[i].url || media[i]._cloudUrl)) || '';
            var t = _normThumb(media[i]);
            if (!t) continue;
            if (_isVidUrl(String(raw))) { if (!firstVid) firstVid = t; continue; }
            return t;
        }
        return firstVid;
    }
    function _domThumbFor(listingId) {
        try {
            var c = document.querySelector('#property-grid-container .property-card[data-id="' + listingId + '"]');
            if (!c) return '';
            var m = []; try { m = JSON.parse(c.dataset.media || '[]'); } catch (e) {}
            var t = _pickThumb(m);
            if (t) return t;
            var im = c.querySelector('img[src]');
            return im ? _normThumb(im.getAttribute('src')) : '';
        } catch (e) { return ''; }
    }
    function _pinThumb(p) {
        return _normThumb(p && p.image) || _domThumbFor(p && p.listingId) || '';
    }
    function _readPins(data) {
        var list = [];
        if (data && Array.isArray(data.pinnedProducts)) list = data.pinnedProducts.filter(function (x) { return x && x.listingId; });
        else if (data && data.pinnedProduct && data.pinnedProduct.listingId) list = [data.pinnedProduct]; // legacy single pin
        return list;
    }

    /* =========================================================================
       §1 — one onSnapshot on the active_streams doc, scoped to just the
       pinnedProduct field (own listener — see header for why).
       ========================================================================= */
    var _docUnsub = null;
    var _docStreamId = null;
    var _pinnedList = []; // current pinned products (array, oldest first)

    function _attachDocListener() {
        var sid = _streamId();
        if (_docUnsub && _docStreamId === sid) return; // already watching this stream
        _detachDocListener();
        var ref = _streamRef();
        if (!ref) return;
        _docStreamId = sid;
        _docUnsub = ref.onSnapshot(function (doc) {
            var data = doc.exists ? (doc.data() || {}) : {};
            _pinnedList = _readPins(data);
            _renderPinnedCard();
            _renderPickerModalIfOpen();
            try { if (typeof window._pv56bOnDoc === 'function') window._pv56bOnDoc(data); } catch (eC) { warn('consult hook: ' + (eC && eC.message)); }
        }, function (err) { warn('active_streams listener error: ' + err.message); });
    }
    function _detachDocListener() {
        if (_docUnsub) { _docUnsub(); _docUnsub = null; }
        _docStreamId = null;
        _pinnedList = [];
        try { if (typeof window._pv56bReset === 'function') window._pv56bReset(); } catch (eR) {}
    }

    /* =========================================================================
       §2 — host's own listings picker. Fetched fresh each time the modal
       opens (a host's catalog changes rarely enough that a cache would
       just be one more stale-state bug to chase — see the "no separate
       notification needed" discipline v55's header already argues for
       the same reason).
       ========================================================================= */
    var _myListings = [];
    var _loadingListings = false;

    /* FIX (2026-10-03 — "Pin a Product stays on 'Loading your listings…'
       forever"): old query needed a composite index and had no timeout or
       error state. Now: grid-first (instant, offline-safe), equality-only
       Firestore query merged in the background (no index; sorted
       client-side), 8s timeout, cache fallback, and a Retry button. */
    var _listingsError = false;
    function _withTimeout(p, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }
    function _sortListings(arr) {
        return arr.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
    }
    function _snapToListings(snap) {
        return _sortListings(snap.docs.map(function (d) {
            var x = d.data() || {};
            if (!x.id) x.id = d.id;
            return x;
        }));
    }
    function _listingsFromGrid(uid) {
        var out = [];
        try {
            document.querySelectorAll('#property-grid-container .property-card[data-id]').forEach(function (c) {
                if (!uid || c.dataset.sellerId !== uid) return;
                var media = [];
                try { media = JSON.parse(c.dataset.media || '[]'); } catch (e) {}
                out.push({
                    id: c.dataset.id,
                    name: c.dataset.name || 'Listing',
                    price: c.dataset.price,
                    currency: c.dataset.displayCurrency || '',
                    media: media,
                    thumb: _pickThumb(media) || _domThumbFor(c.dataset.id),
                    sellerId: c.dataset.sellerId,
                    createdAt: c.dataset.createdAtTs ? new Date(Number(c.dataset.createdAtTs)).toISOString() : ''
                });
            });
        } catch (e) { warn('grid read failed: ' + (e && e.message)); }
        return _sortListings(out);
    }
    function _mergeListings(a, b) {
        var map = {};
        a.forEach(function (l) { map[l.id] = l; });
        b.forEach(function (l) { map[l.id] = l; });
        return _sortListings(Object.keys(map).map(function (k) { return map[k]; }));
    }
    async function _fetchMyListingsRemote() {
        _listingsError = false;
        var db = window.fbDb;
        var uid = window.userState && window.userState.id;
        if (!db || !window._firebaseLoaded || !uid) { _listingsError = true; return []; }
        var q = db.collection('marketplace_listings').where('sellerId', '==', uid).limit(50);
        try {
            return _snapToListings(await _withTimeout(q.get(), 5000));
        } catch (e1) {
            warn('listing fetch failed (' + (e1 && e1.message) + ') — trying cache.');
            try {
                var c = await _withTimeout(q.get({ source: 'cache' }), 2000);
                if (c && c.docs && c.docs.length) return _snapToListings(c);
            } catch (e2) { /* fall through */ }
            _listingsError = true;
            return [];
        }
    }
    async function _fetchMyListings() {
        var uid0 = window.userState && window.userState.id;
        var gridList = _listingsFromGrid(uid0);
        if (gridList.length) {
            _fetchMyListingsRemote().then(function (remote) {
                if (!remote.length) return;
                _myListings = _mergeListings(_myListings.length ? _myListings : gridList, remote);
                _renderPickerModalIfOpen();
            }).catch(function () {});
            return gridList;
        }
        return _fetchMyListingsRemote();
    }

    /* FEATURE (2026-10-03 — "product listings in the live should come automatically,
       it's one app"): the moment the host is live, a Firestore listener on THEIR
       marketplace_listings (sellerId == their uid, equality-only so no composite index
       is needed) keeps _myListings filled and fresh in the background. The Pin picker
       therefore opens instantly with every listing already loaded — nothing depends on
       the host having opened the Marketplace tab first. Also serves from Firestore's
       local cache when the connection is weak. */
    var _listingsUnsub = null, _listingsUid = null;
    function _startListingsListener() {
        var db = window.fbDb, uid = window.userState && window.userState.id;
        if (!db || !window._firebaseLoaded || !uid) return;
        if (_listingsUnsub && _listingsUid === uid) return;
        _stopListingsListener();
        _listingsUid = uid;
        try {
            _listingsUnsub = db.collection('marketplace_listings').where('sellerId', '==', uid).limit(50).onSnapshot(function (snap) {
                _myListings = _mergeListings(_listingsFromGrid(uid), _snapToListings(snap));
                _loadingListings = false; _listingsError = false;
                _renderPickerModalIfOpen();
            }, function (err) { warn('listings listener error: ' + (err && err.message)); });
        } catch (e) { warn('listings listener failed: ' + (e && e.message)); }
    }
    function _stopListingsListener() {
        if (_listingsUnsub) { try { _listingsUnsub(); } catch (e) {} }
        _listingsUnsub = null; _listingsUid = null;
    }
    function _pinAll() {
        var add = _myListings.filter(function (l) { return !_isPinned(l.id); });
        if (!add.length) return;
        var room = MAX_PINS - _pinnedList.length;
        if (room <= 0) { notify('You can pin up to ' + MAX_PINS + ' products at a time.', 'warning'); return; }
        add = add.slice(0, room);
        _mutatePins(function (list) {
            add.forEach(function (l) {
                list.push({
                    listingId: l.id, name: l.name || 'Listing', price: l.price != null ? l.price : '', currency: l.currency || '',
                    image: _pickThumb(l.media) || _normThumb(l.thumb) || _domThumbFor(l.id) || '',
                    sellerId: l.sellerId || (window.userState && window.userState.id) || '', pinnedAt: new Date().toISOString()
                });
            });
            return list;
        }, '\uD83D\uDECD\uFE0F Pinned ' + add.length + ' product' + (add.length > 1 ? 's' : '') + '.');
    }

    // FIX (bug report: "works on the first tap, then stops responding"):
    // same root cause and fix as pv55-sound-btn/pv55-beauty-btn above —
    // this only ever called `.add('show')`, so a second tap on the SAME
    // icon while the picker was already open changed nothing on screen
    // (a genuine no-op, not a broken click), which reads exactly like the
    // button had stopped responding. Tapping the icon again now closes
    // the picker instead, matching every other toggleable icon on this
    // panel.
    var _pickSeq = 0, _lastPickTap = 0;
    function _pickerVisible(m) {
        return m.classList.contains('show') && m.offsetParent !== null && window.getComputedStyle(m).display !== 'none';
    }
    // FIX (2026-10-03 — "opens once, then refuses to open"): (1) the picker used to wait on
    // the network (8s + 3s timeouts when offline) before showing anything, so a second tap
    // landed while it sat on "Loading" and toggled it CLOSED, which read as "does nothing";
    // it now paints instantly from what's already known and refreshes in the background.
    // (2) "close" is only taken when the sheet is genuinely visible — if it carries the
    // 'show' class but isn't on screen it is re-shown instead. (3) duplicate touch+click
    // events within 350ms are ignored; stale inline display/visibility is cleared and the
    // sheet is moved to the front of the live screen on every open.
    async function _openPicker() {
        if (!isRealHost()) return;
        if (!isCurrentlyLive()) { notify('Go live first, then pin a product.', 'warning'); return; }
        var now = Date.now();
        if (now - _lastPickTap < 350) return;
        _lastPickTap = now;
        _ensurePickerModal();
        var _pickModal = document.getElementById('pv56-pick-modal');
        if (_pickerVisible(_pickModal)) { _pickModal.classList.remove('show'); return; }
        _pickModal.style.removeProperty('display');
        _pickModal.style.removeProperty('visibility');
        if (_pickModal.parentNode) _pickModal.parentNode.appendChild(_pickModal);
        if (window._empCloseOtherLiveSheets) window._empCloseOtherLiveSheets(_pickModal);
        _pickModal.classList.add('show');
        var seq = ++_pickSeq;
        var uid0 = window.userState && window.userState.id;
        var known = _mergeListings(_myListings || [], _listingsFromGrid(uid0));
        _myListings = known;
        _loadingListings = !known.length;
        _listingsError = false;
        _renderPickerModalIfOpen();
        var fresh = [];
        try { fresh = await _fetchMyListings(); } catch (e) { warn('picker fetch: ' + (e && e.message)); }
        if (seq !== _pickSeq) return;
        if (fresh && fresh.length) _myListings = _mergeListings(_myListings, fresh);
        _loadingListings = false;
        _renderPickerModalIfOpen();
    }

    function _ensurePickerModal() {
        if (document.getElementById('pv56-pick-modal')) return;
        var container = document.getElementById('live-stream-screen') || document.body;
        var m = document.createElement('div');
        m.id = 'pv56-pick-modal';
        m.className = 'live-sub-modal';
        m.innerHTML =
            '<button type="button" class="close-modal pv56-close" style="color:white; z-index:5; top:5px; right:10px;">\u00d7</button>' +
            '<h3>\uD83D\uDECD\uFE0F Pin Products</h3>' +
            '<p style="text-align:center;color:#bbb;font-size:12px;margin:-8px 0 10px;">Tap listings to pin or unpin \u2014 you can pin several.</p>' +
            '<div id="pv56-unpin-row" style="display:none;margin-bottom:10px;">' +
            '<button type="button" class="btn btn-danger" id="pv56-unpin-btn" style="width:100%;">Unpin all</button>' +
            '</div>' +
            '<div id="pv56-pick-list" style="overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;"></div>';
        container.appendChild(m);
        m.querySelector('.pv56-close').addEventListener('click', function () { m.classList.remove('show'); });
        m.querySelector('#pv56-unpin-btn').addEventListener('click', _unpinProduct);
        m.addEventListener('click', function (e) {
            if (e.target.closest('[data-pv56-pinall]')) { _pinAll(); return; }
            var card = e.target.closest('[data-pv56-listing]');
            if (!card) return;
            var id = card.getAttribute('data-pv56-listing');
            var listing = _myListings.filter(function (l) { return l.id === id; })[0];
            if (listing) _togglePin(listing);
        });
    }

    function _renderPickerModalIfOpen() {
        var modal = document.getElementById('pv56-pick-modal');
        if (!modal || !modal.classList.contains('show')) return;
        var unpinRow = document.getElementById('pv56-unpin-row');
        if (unpinRow) {
            unpinRow.style.display = _pinnedList.length ? '' : 'none';
            var _ub = document.getElementById('pv56-unpin-btn');
            if (_ub) _ub.textContent = 'Unpin all (' + _pinnedList.length + ')';
        }
        var list = document.getElementById('pv56-pick-list');
        if (!list) return;
        if (_loadingListings) {
            list.innerHTML = '<p style="text-align:center;color:#ccc;padding:20px 0;">Loading your listings\u2026</p>';
            return;
        }
        if (_listingsError && !_myListings.length) {
            list.innerHTML = '<p style="text-align:center;color:#ccc;padding:20px 0;">Couldn\u2019t reach the Marketplace (weak connection?).</p>' +
                '<button type="button" class="btn" id="pv56-retry-btn">Retry</button>';
            var rb = document.getElementById('pv56-retry-btn');
            if (rb) rb.addEventListener('click', async function () {
                _loadingListings = true; _renderPickerModalIfOpen();
                _myListings = await _fetchMyListings();
                _loadingListings = false; _renderPickerModalIfOpen();
            });
            return;
        }
        if (!_myListings.length) {
            list.innerHTML = '<p style="text-align:center;color:#ccc;padding:20px 0;">You don\u2019t have any Marketplace listings yet.</p>';
            return;
        }
        var _unp = _myListings.filter(function (l) { return !_isPinned(l.id); }).length;
        list.innerHTML = (_unp > 1 ? '<button type="button" class="btn" data-pv56-pinall="1" style="width:100%;margin-bottom:8px;">Pin all my listings (' + Math.min(_unp, Math.max(0, MAX_PINS - _pinnedList.length)) + ')</button>' : '') + _myListings.map(function (l) {
            var img = _pickThumb(l.media) || _normThumb(l.thumb) || '';
            var active = _isPinned(l.id) ? ' pv56-active' : '';
            return '' +
                '<div class="pv56-listing-row' + active + '" data-pv56-listing="' + esc(l.id) + '">' +
                (img ? '<img src="' + esc(img) + '" alt="">' : '<div class="pv56-listing-noimg"><i class="fas fa-image"></i></div>') +
                '<div class="pv56-listing-meta">' +
                '<strong>' + esc(l.name || 'Listing') + '</strong>' +
                '<span>' + esc(_fmtPrice(l.price, l.currency)) + '</span>' +
                '</div>' +
                (active ? '<i class="fas fa-check-circle pv56-pinned-check"></i>' : '') +
                '</div>';
        }).join('');
    }

    /* =========================================================================
       §3 — pin / unpin (host only, writes the shared field on the doc).
       ========================================================================= */
    var MAX_PINS = 10;
    function _isPinned(id) { return _pinnedList.some(function (p) { return p.listingId === id; }); }
    // FIX (2026-10-03 — "clicking pin product does nothing"): the previous version
    // used a Firestore transaction, which needs a live server round-trip — on a weak
    // or offline connection it never completes, so nothing seemed to happen. A plain
    // update() is applied locally at once (the onSnapshot listener fires immediately
    // with the pending write, so the strip + picker update instantly) and syncs when
    // the connection is back. We build the new list from the live local list.
    function _mutatePins(fn, okMsg) {
        var ref = _streamRef();
        if (!ref) { notify('Not connected to the live stream yet \u2014 try again in a moment.', 'warning'); return; }
        var FV = window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue;
        var list = fn(_pinnedList.slice());
        var upd = { pinnedProducts: list };
        upd.pinnedProduct = list.length ? list[list.length - 1] : (FV ? FV.delete() : null); // keeps older clients working
        if (okMsg) notify(okMsg, 'success'); // optimistic — don't wait on the network
        ref.update(upd).catch(function (e) { notify('Could not update pinned products: ' + (e && e.message ? e.message : 'try again.'), 'error'); });
    }
    function _togglePin(listing) {
        if (_isPinned(listing.id)) { _unpinOne(listing.id); return; }
        if (_pinnedList.length >= MAX_PINS) { notify('You can pin up to ' + MAX_PINS + ' products at a time.', 'warning'); return; }
        var img = _pickThumb(listing.media) || _normThumb(listing.thumb) || _domThumbFor(listing.id) || '';
        _mutatePins(function (list) {
            if (list.some(function (p) { return p.listingId === listing.id; })) return list;
            list.push({
                listingId: listing.id,
                name: listing.name || 'Listing',
                price: listing.price != null ? listing.price : '',
                currency: listing.currency || '',
                image: img,
                sellerId: listing.sellerId || (window.userState && window.userState.id) || '',
                pinnedAt: new Date().toISOString()
            });
            return list;
        }, '\uD83D\uDECD\uFE0F Pinned \"' + (listing.name || 'listing') + '\" for viewers.');
    }
    function _unpinOne(id) {
        _mutatePins(function (list) { return list.filter(function (p) { return p.listingId !== id; }); }, 'Product unpinned.');
    }
    function _unpinProduct() { // "Unpin all"
        _mutatePins(function () { return []; }, 'All products unpinned.');
    }

    /* =========================================================================
       §4 — the floating pinned-product card everyone (host + every
       viewer) sees, driven purely off _pinned from §1's listener.
       ========================================================================= */
    function _goAway() {
        var ov = document.getElementById('go-live-modal-overlay');
        if (!ov) return;
        if (!document.getElementById('pv56-away-css')) {
            var st = document.createElement('style');
            st.id = 'pv56-away-css';
            st.textContent = '#go-live-modal-overlay.pv56-away{display:none!important;}' +
                '#pv56-back-live{position:fixed;left:50%;transform:translateX(-50%);bottom:90px;z-index:99999;background:#e11d48;color:#fff;border:none;border-radius:24px;padding:10px 20px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,.4);cursor:pointer;}';
            document.head.appendChild(st);
        }
        ov.classList.add('pv56-away');
        if (!document.getElementById('pv56-back-live')) {
            var b = document.createElement('button');
            b.id = 'pv56-back-live'; b.type = 'button';
            b.innerHTML = '<i class="fas fa-broadcast-tower"></i> Back to live';
            b.addEventListener('click', _comeBack);
            document.body.appendChild(b);
        }
    }
    function _comeBack() {
        var ov = document.getElementById('go-live-modal-overlay');
        if (ov) ov.classList.remove('pv56-away');
        var b = document.getElementById('pv56-back-live');
        if (b) b.remove();
    }
    function _goToPinnedListing(id) {
        var _p = _pinnedList.filter(function (x) { return x.listingId === id; })[0];
        if (!_p) return;
        var targetId = _p.listingId;
        var name = _p.name;
        _goAway(); // live overlay is position:fixed above every section — hide it (stream stays connected) and show a Back-to-live pill
        if (typeof window.navigateTo === 'function') window.navigateTo('marketplace');
        // Same poll-for-the-DOM-node technique app-startup.js's own deep-link
        // handler already uses (see that file's `_openReelById`) — the
        // marketplace card for this listing may not exist in the DOM yet
        // if the section just mounted.
        var attempts = 0, maxAttempts = 20;
        var poll = setInterval(function () {
            attempts++;
            var card = document.querySelector('#property-grid-container .property-card[data-id="' + targetId + '"]');
            if (card) {
                clearInterval(poll);
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('pv56-flash-highlight');
                setTimeout(function () { card.classList.remove('pv56-flash-highlight'); }, 2200);
                return;
            }
            if (attempts >= maxAttempts) {
                clearInterval(poll);
                notify('"' + name + '" isn\u2019t showing in the Marketplace right now — it may have been removed.', 'info');
            }
        }, 500);
    }

    // FIX (bug report: "the product listing pin is intercepting the chat
    // message" in the TikTok live screen): #pv56-pinned-card is docked
    // absolutely at bottom:96px, right above the footer — which is exactly
    // where #live-comments-list stacks its newest rows (column-reverse, flush
    // against the footer), so the card sat on top of the latest messages.
    // Rather than float the card up over the video/guest grid, keep the TikTok
    // Shop layout (product card docked above the input bar) and lift the CHAT
    // above the card instead: measure how far the card's top edge intrudes into
    // the chat list and push the list up by that much (+8px breathing room) via
    // margin-bottom. Margin is cleared when the card goes away. Measured, not
    // hard-coded, so it follows the card's real height (caption wrap, 1 vs many
    // pins, fullscreen, rotation).
    function _liftChatAbovePin() {
        var list = document.getElementById('live-comments-list');
        if (!list) return;
        var card = document.getElementById('pv56-pinned-card');
        if (!card) { if (list.style.marginBottom) list.style.marginBottom = ''; return; }
        var lr = list.getBoundingClientRect(), cr = card.getBoundingClientRect();
        if (!cr.height || !lr.height) return; // hidden/minimized — nothing to measure
        var cur = parseFloat(list.style.marginBottom) || 0;
        var need = Math.ceil((lr.bottom + cur) - cr.top + 8);
        var next = need > 0 ? need : 0;
        if (Math.abs(next - cur) > 1) list.style.marginBottom = next ? next + 'px' : '';
    }
    window.addEventListener('resize', function () { setTimeout(_liftChatAbovePin, 120); });

    // FEATURE (requested: "make the live streaming product listing card thumbnail
    // auto scrollable"): when several products are pinned, the strip now advances
    // itself to the next product every few seconds (and loops back to the first),
    // so viewers see every pinned item without having to swipe. Any touch/drag on
    // the strip pauses it for 7s so it never fights a manual swipe. A single pin
    // has nothing to scroll, so it stays still; reduced-motion users are skipped.
    var _pinAutoPauseUntil = 0;
    function _pausePinAuto() { _pinAutoPauseUntil = Date.now() + 7000; }
    function _pinAutoAdvance() {
        try {
            if (Date.now() < _pinAutoPauseUntil || document.hidden) return;
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            var sc = document.querySelector('#pv56-pinned-card .pv56-strip-scroll');
            if (!sc || sc.scrollWidth <= sc.clientWidth + 2) return;
            var items = sc.querySelectorAll('.pv56-item');
            if (items.length < 2) return;
            var base = items[0].offsetLeft, cur = 0, best = Infinity;
            for (var i = 0; i < items.length; i++) {
                var d = Math.abs((items[i].offsetLeft - base) - sc.scrollLeft);
                if (d < best) { best = d; cur = i; }
            }
            var next = (cur + 1) % items.length;
            var maxLeft = sc.scrollWidth - sc.clientWidth;
            var target = Math.min(items[next].offsetLeft - base, maxLeft);
            if (next === 0) target = 0;
            sc.scrollTo({ left: target, behavior: 'smooth' });
        } catch (eAuto) { /* cosmetic only */ }
    }
    setInterval(_pinAutoAdvance, 3500);

    function _renderPinnedCard() {
        var existing = document.getElementById('pv56-pinned-card');
        if (!_pinnedList.length || !isCurrentlyLive()) {
            if (existing) existing.remove();
            _liftChatAbovePin();
            return;
        }
        var container = document.getElementById('live-stream-screen');
        if (!container) return;
        if (!existing) {
            existing = document.createElement('div');
            existing.id = 'pv56-pinned-card';
            // keep horizontal swipes inside the strip (don't let the stream's own swipe/gesture handlers eat them)
            ['touchstart', 'touchmove', 'touchend', 'pointerdown'].forEach(function (ev) {
                existing.addEventListener(ev, function (e) { _pausePinAuto(); e.stopPropagation(); }, { passive: true });
            });
            existing.addEventListener('wheel', _pausePinAuto, { passive: true });
            existing.addEventListener('click', function (e) {
                var x = e.target.closest('.pv56-x');
                if (x) { e.stopPropagation(); _unpinOne(x.getAttribute('data-pv56-unpin')); return; }
                var it = e.target.closest('.pv56-item');
                if (it) _goToPinnedListing(it.getAttribute('data-pv56-id'));
            });
            container.appendChild(existing);
        }
        var oldSc = existing.querySelector('.pv56-strip-scroll');
        var prevLeft = oldSc ? oldSc.scrollLeft : 0;
        var multi = _pinnedList.length > 1;
        var host = isRealHost();
        existing.innerHTML =
            '<div class="pv56-cap"><i class="fas fa-shopping-bag"></i> <span>For sale \u2022 tap a product to open it in the Marketplace' +
            (multi ? ' \u2022 swipe for more \u2192' : '') + '</span></div>' +
            '<div class="pv56-strip-scroll' + (multi ? ' pv56-multi' : '') + '">' +
            _pinnedList.map(function (p) {
                var img = _pinThumb(p);
                return '<div class="pv56-item" data-pv56-id="' + esc(p.listingId) + '">' +
                    (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
                    '<div class="pv56-pinned-noimg"' + (img ? ' style="display:none;"' : '') + '><i class="fas fa-shopping-bag"></i></div>' +
                    '<div class="pv56-pinned-meta">' +
                    '<strong>' + esc(p.name) + '</strong>' +
                    '<span>' + esc(_fmtPrice(p.price, p.currency)) + '</span>' +
                    '<em class="pv56-sale">FOR SALE \u2022 View in Marketplace</em>' +
                    '</div>' +
                    (host ? '<button type="button" class="pv56-x" data-pv56-unpin="' + esc(p.listingId) + '" title="Unpin">\u00d7</button>'
                          : '<i class="fas fa-chevron-right pv56-pinned-chevron"></i>') +
                    '</div>';
            }).join('') + '</div>';
        existing.querySelectorAll('.pv56-item img').forEach(function (im) {
            im.addEventListener('error', function () {
                im.style.display = 'none';
                var ph = im.nextElementSibling;
                if (ph) ph.style.display = 'flex';
            });
        });
        var sc = existing.querySelector('.pv56-strip-scroll');
        if (sc && prevLeft) sc.scrollLeft = prevLeft;
        _liftChatAbovePin();
        requestAnimationFrame(_liftChatAbovePin); // re-measure once images/fonts settle
    }

    /* =========================================================================
       §5 — CSS + host control button (reuses `.live-action-btn
       host-control` / `.live-sub-modal`, same reuse discipline as v55's
       own §5).
       ========================================================================= */
    (function injectCSS() {
        if (document.getElementById('pv56-css')) return;
        var css = document.createElement('style');
        css.id = 'pv56-css';
        css.textContent =
            '.pv56-listing-row{display:flex;align-items:center;gap:10px;padding:8px;border-radius:10px;cursor:pointer;margin-bottom:6px;background:rgba(255,255,255,0.04);}' +
            '.pv56-listing-row:active{transform:scale(0.98);}' +
            '.pv56-listing-row.pv56-active{background:rgba(245,166,35,0.18);}' +
            '.pv56-listing-row img,.pv56-listing-noimg{width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;color:#999;}' +
            '.pv56-listing-meta{display:flex;flex-direction:column;min-width:0;flex:1;}' +
            '.pv56-listing-meta strong{color:#fff;font-size:var(--text-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.pv56-listing-meta span{color:var(--accent-color,#f5a623);font-size:var(--text-xs);}' +
            '.pv56-pinned-check{color:var(--accent-color,#f5a623);font-size:18px;}' +
            '#pv56-pinned-card{position:absolute;left:12px;right:70px;bottom:96px;display:flex;flex-direction:column;gap:5px;z-index:6;}' +
            '.pv56-cap{align-self:flex-start;background:rgba(245,166,35,0.95);color:#1a1a1a;font-size:10.5px;font-weight:700;line-height:1.2;padding:3px 9px;border-radius:10px;max-width:100%;box-shadow:0 2px 8px rgba(0,0,0,0.3);}' +
            '.pv56-cap i{margin-right:3px;}' +
            '.pv56-strip-scroll{display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;touch-action:pan-x;scrollbar-width:none;overscroll-behavior-x:contain;}' +
            '.pv56-strip-scroll::-webkit-scrollbar{display:none;}' +
            '.pv56-item{position:relative;flex:0 0 100%;min-width:0;box-sizing:border-box;scroll-snap-align:start;display:flex;align-items:center;gap:10px;background:rgba(20,20,24,0.85);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:8px 10px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.35);}' +
            '.pv56-multi .pv56-item{flex-basis:84%;}' +
            '.pv56-item:active{transform:scale(0.97);}' +
            '.pv56-item img,.pv56-pinned-noimg{width:42px;height:42px;border-radius:8px;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;color:#f5a623;}' +
            '.pv56-pinned-meta{display:flex;flex-direction:column;min-width:0;flex:1;}' +
            '.pv56-pinned-meta strong{color:#fff;font-size:var(--text-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.pv56-pinned-meta span{color:var(--accent-color,#f5a623);font-size:var(--text-xs);}' +
            '.pv56-sale{font-style:normal;font-size:9.5px;font-weight:700;letter-spacing:.03em;color:#9be39b;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.pv56-pinned-chevron{color:#ccc;flex-shrink:0;}' +
            '.pv56-x{flex-shrink:0;width:26px;height:26px;border-radius:50%;border:none;background:rgba(255,255,255,0.15);color:#fff;font-size:18px;line-height:1;cursor:pointer;}' +
            '.pv56-flash-highlight{outline:3px solid var(--accent-color,#f5a623);outline-offset:2px;transition:outline-color 2s ease;}';
        document.head.appendChild(css);
    })();

    function _ensureHostButton() {
        var panel = document.getElementById('host-control-panel-inner');
        if (!panel || document.getElementById('pv56-pin-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'pv56-pin-btn';
        btn.type = 'button';
        btn.className = 'live-action-btn host-control';
        btn.title = 'Pin a Product';
        btn.innerHTML = '<i class="fas fa-shopping-bag"></i>';
        panel.appendChild(btn);
        btn.addEventListener('click', _openPicker);
    }
    function _removeHostButton() {
        var b = document.getElementById('pv56-pin-btn');
        if (b) b.remove();
    }

    // FIX (bug report: "control panel buttons unresponsive") — same
    // guaranteed-first capture-phase treatment as pv55-sound-btn/
    // pv55-beauty-btn above; see that fix's comment for the full
    // explanation. stopPropagation() prevents double-firing alongside
    // the button's own bubble-phase listener registered above.
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        var btn = e.target.closest('#pv56-pin-btn');
        if (!btn) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        _openPicker();
    }, true);

    /* =========================================================================
       §6 — lifecycle: same 800ms poll convention every other patch in
       this area already uses (see v55 §6 / app-patch-v37.js §2 for why).
       ========================================================================= */
    function _tick() {
        if (isRealHost() && isCurrentlyLive()) _ensureHostButton(); else _removeHostButton();
        if (isCurrentlyLive() && (window.fbDb && window._firebaseLoaded)) _attachDocListener();
        else _detachDocListener();
        if (isRealHost() && isCurrentlyLive()) _startListingsListener(); else _stopListingsListener();
        if (!isCurrentlyLive() && document.getElementById('pv56-back-live')) _comeBack();
        if (!isCurrentlyLive()) {
            var card = document.getElementById('pv56-pinned-card');
            if (card) card.remove();
        }
        _liftChatAbovePin();
    }
    setInterval(_tick, 800);
    document.addEventListener('empyrean-init-done', function () { setTimeout(_tick, 500); });

    console.log('[EmpyreanPatchV56] \u2705 Live shopping / product pin added — host can pin several of their own Marketplace listings (horizontally scrollable strip) from the live control panel; every viewer sees a tappable card that jumps to it in Marketplace. Own onSnapshot on active_streams, no edits to any other file.');

})();


/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v56B (lives right after v56, same file)

   FEATURE — GO PRIVATE / ONE-ON-ONE PRIVATE VIDEO CONSULTATION

   REQUESTED: the host can go private, or take a one-on-one private video
   consultation with a client when the client asks for it, and either side
   can cancel/decline/end it.

   FLOW
   - Viewer taps "1:1 Consult" (top-right of the live screen) -> request goes
     to the host (pending). Viewer can tap again to CANCEL the request.
   - Host taps the lock button in the live control panel -> panel lists
     pending requests with Accept / Decline, a "Go private" switch (pauses the
     public stream; viewers see a "private session" cover) and, during a
     consultation, an "End consultation" (cancel) button.
   - Accept -> host + that one client join a separate private Agora channel
     (2-way video/audio, own client, same /api/agora-token endpoint as the
     public stream). Everyone else sees the private-session cover. Either
     side can End at any time; the public stream resumes automatically.

   DATA MODEL (no new collection / no new security rule — same reuse as v56:
   fields on the EXISTING active_streams/{streamId} doc):
     consultRequests.<uid> = { uid, name, avatar, status, requestedAt, channel }
         status: pending | accepted | declined | cancelled | ended
     privateMode = { on, uid, name, since }
   ============================================================================= */
(function empyreanPatchV56B() {
    'use strict';
    if (window._empPatchV56BLoaded) return;
    window._empPatchV56BLoaded = true;

    function warn(m) { console.warn('[V56B] ' + m); }
    function notify(m, t) { if (typeof window.showNotification === 'function') window.showNotification(m, t || 'info'); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function LS() { return window.liveStreamData || null; }
    function me() { return (window.isGuest || !window.userState) ? null : window.userState; }
    function isHost() { var m = me(), sd = LS(); if (!m || !sd) return false; var hid = sd.hostUserId || sd.hostId; return !!hid && m.id === hid; }
    function isLive() { var sd = LS(); return !!(sd && sd.isLive); }
    function sid() { var sd = LS(); return sd && sd.streamId; }
    function ref() {
        var db = window.fbDb, s = sid();
        if (!db || !s || !window._firebaseLoaded) return null;
        return db.collection('active_streams').doc(s);
    }
    function FV() { return window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue; }
    function key(uid) { return String(uid || '').replace(/[^\w\-]/g, '_'); }
    function uidNum(userId) {
        if (!userId) return Math.floor(Math.random() * 1000000) + 1;
        var h = 0;
        for (var i = 0; i < userId.length; i++) { h = ((h << 5) - h + userId.charCodeAt(i)) | 0; }
        return (Math.abs(h) % 1000000) + 1;
    }
    function agoraOK() {
        return typeof AgoraRTC !== 'undefined' && window._agoraAvailable !== false &&
            window._appConfig && window._appConfig.agora && window._appConfig.agora.appId;
    }
    function fetchToken(channel, uid) {
        var base = typeof window._empApiBase === 'function' ? window._empApiBase() : '';
        return fetch(base + '/api/agora-token', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelName: channel, uid: uid, role: 'host' }) // 'host' role = may publish (both sides publish in a 1:1)
        }).then(function (r) { if (!r.ok) throw new Error('Token request failed: HTTP ' + r.status); return r.json(); });
    }

    /* ------------------------------------------------------------------ state */
    var _req = {};            // consultRequests map from the doc
    var _priv = null;         // privateMode from the doc
    var _client = null, _tracks = [], _clones = [];
    var _callKey = null;      // request key of the call we're in
    var _starting = false;
    var _paused = false;      // host's public tracks currently paused by us
    var _seen = {};
    var _raw = {};            // consultRequests exactly as stored (client-writable, so never trusted for money)
    var _holds = {};          // active_streams/{id}/consultHolds — written ONLY by the server (proof of payment + real terms)
    var _holdsUnsub = null, _holdsFor = null;
    var _terms = {};          // host device: the terms the host actually accepted, to catch edits made afterwards
    var _cfg = null;          // consultSettings from the doc: host's free/paid options + rate per minute
    var _busy = {};           // per-request guards so billing steps never run twice
    var _tick = null;         // 1s timer for the in-call clock / auto-end
    var _pickSel = null;      // viewer's selected option in the request picker
    var DURATIONS = [5, 10, 15, 30];   // minutes offered for paid 1:1s
    var MIN_BILLABLE_SEC = 15;         // ended sooner than this = full refund (connection failures)

    /* _req = raw requests with the server's hold doc laid over them: a request that has a matching hold is paid,
       with the server's price/duration/start/settlement; anything the viewer edits on the request afterwards is ignored. */
    function rebuild() {
        var out = {};
        Object.keys(_raw).forEach(function (k) {
            var r = _raw[k], h = _holds[k];
            if (r && h && String(h.requestedAt) === String(r.requestedAt || '')) {
                out[k] = Object.assign({}, r, {
                    type: 'paid', minutes: h.minutes, rate: h.rate, price: h.price, held: true, startedAt: h.startedAt,
                    settled: h.status === 'settled', usedMinutes: h.usedMinutes, charged: h.charged, refunded: h.refunded
                });
            } else out[k] = r;
        });
        _req = out;
    }
    function watchHolds() {
        var id = sid();
        if (!id || _holdsFor === id) return;
        var r = ref(); if (!r) return;
        if (_holdsUnsub) { try { _holdsUnsub(); } catch (e) {} }
        _holdsFor = id;
        _holdsUnsub = r.collection('consultHolds').onSnapshot(function (snap) {
            var o = {}; snap.forEach(function (d) { o[d.id] = d.data(); });
            _holds = o; rebuild(); sync();
        }, function (e) { warn('holds listener: ' + (e && e.message)); });
    }
    function cfg() {
        var c = _cfg || {};
        return {
            freeEnabled: c.freeEnabled !== false,
            paidEnabled: c.paidEnabled !== false,
            // FIX (bug report: "the price for 1:1 private is too high"): the fallback used
            // when the host has not set a price was 10 EMPY/min (5 min = 50, 30 min = 300).
            // Default is now 2 EMPY/min (5 min = 10, 30 min = 60). The host can change it any
            // time from Private / 1:1 -> "Consultation options & pricing".
            rate: Math.max(1, Math.floor(Number(c.rate) || 2))
        };
    }
    function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
    function hostUid() { var sd = LS(); return sd && (sd.hostUserId || sd.hostId); }
    function isPaid(r) { return !!(r && r.type === 'paid' && Number(r.price) > 0); }
    function elapsedSec(r) {
        var t0 = r && (r.startedAt || r.acceptedAt); if (!t0) return 0;
        var t1 = (r.status === 'ended' && r.endedAt) ? new Date(r.endedAt).getTime() : Date.now();
        return Math.max(0, Math.floor((t1 - new Date(t0).getTime()) / 1000));
    }
    function setBalance(nb) {
        var m = me(); if (m) m.empyBalance = nb;
        try { if (typeof window.updateWalletUI === 'function') window.updateWalletUI(); } catch (e) {}
    }

    function setReq(k, patch) {
        var r = ref(); if (!r) return Promise.resolve();
        var u = {};
        Object.keys(patch).forEach(function (f) { u['consultRequests.' + k + '.' + f] = patch[f]; });
        return r.update(u).catch(function (e) { notify('Could not update consultation: ' + (e && e.message || 'try again'), 'error'); });
    }
    function newReq(k, obj) {
        var r = ref(); if (!r) return Promise.resolve();
        var u = {}; u['consultRequests.' + k] = obj;
        return r.update(u).catch(function (e) { notify('Could not send request: ' + (e && e.message || 'try again'), 'error'); });
    }
    function rawDel(k) {
        var r = ref(), f = FV(); if (!r || !f) return;
        var u = {}; u['consultRequests.' + k] = f.delete();
        r.update(u).catch(function () {});
    }
    function delReq(k) {
        var q = _req[k];
        // a paid session that already took tokens must be settled (charge + refund) before it disappears
        if (isPaid(q) && q.held && !q.settled) { maybeSettle(k); return; } // server settles first, then the row is removed
        rawDel(k);
    }
    function saveCfg(patch) {
        var next = Object.assign({}, cfg(), patch);
        _cfg = next;
        try { localStorage.setItem('pv56b_cfg', JSON.stringify(next)); } catch (e) {}
        var r = ref();
        if (r) r.update({ consultSettings: next }).catch(function (e) { notify('Could not save pricing: ' + (e && e.message || 'try again'), 'error'); });
        renderHostModal();
    }

    /* ---------------------------------------------------------- billing (paid 1:1)
       Viewer prepays the chosen duration when the host accepts ("buys tokens for a set
       duration"). When the session ends, the viewer's device bills the time actually used
       (rounded up to the minute, never above what was bought), pays the host and refunds the rest. */
    /* Billing runs on the server (server.js /api/consult/hold and /api/consult/settle): the wallet rules let an
       account only lower its own balance, so refunds and host payouts cannot be written from the browser. */
    function billingCall(path, body) {
        var auth = window.fbAuth || (window.firebase && window.firebase.auth && window.firebase.auth());
        var u = auth && auth.currentUser;
        if (!u) return Promise.reject(new Error('Please sign in again.'));
        var base = typeof window._empApiBase === 'function' ? window._empApiBase() : '';
        return u.getIdToken().then(function (tok) {
            return fetch(base + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
                body: JSON.stringify(body)
            });
        }).then(function (resp) {
            return resp.json().catch(function () { return {}; }).then(function (j) {
                if (!resp.ok) { var e = new Error(j.error || ('HTTP ' + resp.status)); e.code = j.code; throw e; }
                return j;
            });
        });
    }
    function holdForRequest(k) {
        var r = _req[k]; if (!r || _busy['hold:' + k]) return;
        _busy['hold:' + k] = 1;
        notify('Reserving ' + fmt(r.price) + ' EMPY for your ' + r.minutes + '-minute consultation\u2026', 'info');
        billingCall('/api/consult/hold', { streamId: sid(), key: k }).then(function (j) {
            if (typeof j.newBalance === 'number') setBalance(j.newBalance);
        }).catch(function (e) {
            if (e && e.code === 'insufficient') notify('Not enough EMPY for this consultation. Top up your wallet and request again.', 'error');
            else { notify('Could not reserve your tokens \u2014 ' + ((e && e.message) || 'please try again') + '.', 'error'); setReq(k, { status: 'cancelled' }); }
        }).then(function () { delete _busy['hold:' + k]; });
    }
    function maybeSettle(k) {
        var r = _req[k];
        if (!isPaid(r) || !r.held || r.settled || r.status === 'accepted' || r.status === 'pending') return;
        if (_busy['settle:' + k]) return;
        _busy['settle:' + k] = 1;
        var viewer = !isHost();
        billingCall('/api/consult/settle', { streamId: sid(), key: k }).then(function (j) {
            if (j.nothing || j.already) { if (viewer) setTimeout(function () { rawDel(k); }, 2500); return; }
            if (viewer) {
                var cost = j.charged || 0, refund = j.refunded || 0, used = j.usedMinutes || 0;
                var me0 = me(); if (me0) setBalance((Number(me0.empyBalance) || 0) + refund);
                notify(cost > 0 ? ('Consultation ended \u2014 you were charged ' + fmt(cost) + ' EMPY for ' + used + ' min' + (refund ? ' and ' + fmt(refund) + ' EMPY was refunded.' : '.'))
                                : ('Consultation ended \u2014 no charge. ' + fmt(refund) + ' EMPY was returned to your wallet.'), 'success');
                setTimeout(function () { rawDel(k); }, 2500);
            }
        }).catch(function (e) {
            warn('settle failed: ' + (e && e.message));
            if (e && e.code === 'in-progress') { setTimeout(function () { if (_req[k]) maybeSettle(k); }, 3000); return; }
            if (viewer) notify('Could not finish billing \u2014 it will retry shortly.', 'warning');
        }).then(function () { setTimeout(function () { delete _busy['settle:' + k]; }, 8000); });
    }

    /* in-call clock: shows time + cost so far, and ends a paid session when the purchased time is used up */
    function startTick() {
        stopTick();
        _tick = setInterval(function () {
            var r = _callKey && _req[_callKey]; var el = document.getElementById('pv56b-clock');
            if (!r || !el) return;
            var s = elapsedSec(r), mm = Math.floor(s / 60), ss = s % 60;
            var t = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
            if (isPaid(r)) {
                var total = (Number(r.minutes) || 0) * 60, left = Math.max(0, total - s);
                var billed = Math.min(Number(r.minutes) || 0, Math.max(1, Math.ceil(s / 60))) * (Number(r.rate) || 0);
                el.textContent = t + ' \u00b7 ' + fmt(Math.min(billed, Number(r.price) || 0)) + ' EMPY so far \u00b7 ' + Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2) + ' left';
                if (r.held && s >= total) { stopTick(); notify('Purchased time is up \u2014 ending the consultation.', 'info'); endByUser(); }
            } else { el.textContent = t + ' \u00b7 free consultation'; }
        }, 1000);
    }
    function stopTick() { if (_tick) { clearInterval(_tick); _tick = null; } }
    function setPrivate(on, extra) {
        var r = ref(), f = FV(); if (!r) return Promise.resolve();
        var v = on ? Object.assign({ on: true, since: new Date().toISOString() }, extra || {}) : (f ? f.delete() : null);
        return r.update({ privateMode: v }).catch(function (e) { notify('Could not change private mode: ' + (e && e.message || 'try again'), 'error'); });
    }

    /* ------------------------------------------------------------- doc hooks */
    window._pv56bOnDoc = function (data) {
        _raw = (data && data.consultRequests) || {};
        watchHolds(); rebuild();
        _priv = (data && data.privateMode) || null;
        _cfg = (data && data.consultSettings) || null;
        sync();
    };
    window._pv56bReset = function () {
        _req = {}; _raw = {}; _holds = {}; _terms = {}; _priv = null; _cfg = null; _busy = {}; _pickSel = null; stopTick();
        if (_holdsUnsub) { try { _holdsUnsub(); } catch (e) {} _holdsUnsub = null; } _holdsFor = null;
        endCall(true);
        applyPause(false);
        removeEl('pv56b-private-ov'); removeEl('pv56b-req-btn'); removeEl('pv56b-modal'); removeEl('pv56b-priv-btn'); removeEl('pv56b-picker'); removeEl('pv56b-host-chip');
        if (typeof restoreLive === 'function' && (document.getElementById('pv58-bubble') || document.body.classList.contains('pv58-live-minimized'))) restoreLive();
    };
    function removeEl(id) { var e = document.getElementById(id); if (e) e.remove(); }

    /* -------------------------------------------------------------- sync core */
    function pendingList() {
        return Object.keys(_req).map(function (k) { return _req[k]; }).filter(function (r) { return r && r.status === 'pending'; })
            .sort(function (a, b) { return String(a.requestedAt || '').localeCompare(String(b.requestedAt || '')); });
    }
    function acceptedKey() {
        var ks = Object.keys(_req);
        for (var i = 0; i < ks.length; i++) if (_req[ks[i]] && _req[ks[i]].status === 'accepted') return ks[i];
        return null;
    }
    function sync() {
        if (!isLive()) return;
        var m = me(), host = isHost();
        var myKey = m ? key(m.id) : null;
        var ak = acceptedKey();

        // --- who is in a call? host: the accepted request; viewer: only if it's theirs
        var wantKey = null;
        if (host) wantKey = ak;
        else if (myKey && _req[myKey] && _req[myKey].status === 'accepted') wantKey = myKey;

        // host: the request must still match what the host accepted. A viewer who edits it afterwards (paid -> free,
        // fewer minutes, lower price) is refused; any tokens already reserved are refunded by the server.
        if (host && ak && _terms[ak] && _terms[ak].requestedAt === String(_req[ak].requestedAt || '')) {
            var tm = _terms[ak], cr = _req[ak];
            var bad = tm.type === 'paid' && (!isPaid(cr) ? (_raw[ak] && _raw[ak].type !== 'paid') || (cr.held && Number(cr.price) !== tm.price) : Number(cr.price) !== tm.price || Number(cr.minutes) !== tm.minutes);
            if (tm.type === 'free' && isPaid(cr)) bad = false;
            if (bad) {
                delete _terms[ak];
                notify('The request was changed after you accepted it \u2014 the consultation was cancelled.', 'error');
                setReq(ak, { status: 'cancelled' });
                return;
            }
        }
        // paid 1:1: nobody joins until the SERVER has reserved the viewer's tokens (a matching consultHolds doc exists)
        if (wantKey && isPaid(_req[wantKey]) && !_req[wantKey].held) {
            if (!host && wantKey === myKey) holdForRequest(myKey);
            wantKey = null;
        }
        // viewer: bill any finished paid session that is still unsettled (also covers re-opening the app later)
        if (myKey && _req[myKey]) maybeSettle(myKey);
        if (host) Object.keys(_req).forEach(function (kk) { if (_req[kk] && _req[kk].held && !_req[kk].settled) maybeSettle(kk); });
        // host: tell them what they earned
        if (host) Object.keys(_req).forEach(function (kk) {
            var q = _req[kk];
            if (q && q.settled && q.charged > 0 && !_seen['earn:' + kk + q.requestedAt]) {
                _seen['earn:' + kk + q.requestedAt] = 1;
                notify('You earned ' + fmt(q.charged) + ' EMPY from a ' + q.usedMinutes + '-minute consultation with ' + (q.name || 'a viewer') + '.', 'success');
            }
        });
        // host: publish saved pricing once so viewers can see it
        if (host && !_cfg && ref()) {
            var saved = null; try { saved = JSON.parse(localStorage.getItem('pv56b_cfg') || 'null'); } catch (e) {}
            if (saved) { _cfg = saved; ref().update({ consultSettings: saved }).catch(function () {}); }
        }

        if (wantKey && wantKey !== _callKey && !_client && !_starting) {
            startCall(wantKey, _req[wantKey]);
        } else if (_callKey && (!_req[_callKey] || _req[_callKey].status !== 'accepted')) {
            var st = _req[_callKey] && _req[_callKey].status;
            var _ck = _callKey; stampEnd(_ck);
            endCall(false);
            if (!host) notify(st === 'ended' ? 'The private consultation has ended.' : 'The private consultation was cancelled.', 'info');
            else { notify('The private consultation has ended.', 'info'); }
            if (host && !(_priv && _priv.manual)) setPrivate(false);
        }

        // --- host: heads-up when a client asks for a 1:1
        if (host) {
            pendingList().forEach(function (r) {
                var t = 'req:' + r.uid + ':' + (r.requestedAt || '');
                if (!_seen[t]) { _seen[t] = 1; notify('\uD83D\uDD12 ' + (r.name || 'A viewer') + ' is asking for a ' + (isPaid(r) ? 'paid (' + r.minutes + ' min, ' + fmt(r.price) + ' EMPY)' : 'free') + ' private 1:1 video consultation \u2014 tap \u201cPrivate / 1:1\u201d.', 'info'); }
            });
        }

        // --- host: pause/resume the PUBLIC tracks while private
        if (host) applyPause(!!(_priv && _priv.on));

        // --- viewer-side status notices for my own request
        if (!host && myKey && _req[myKey]) {
            var s = _req[myKey].status, tag = myKey + ':' + s + ':' + (_req[myKey].requestedAt || '');
            if ((s === 'declined') && !_seen[tag]) { _seen[tag] = 1; notify('The host can\u2019t take a private consultation right now.', 'info'); setTimeout(function () { delReq(myKey); }, 2500); }
            if ((s === 'cancelled' || s === 'ended') && !_seen[tag]) { _seen[tag] = 1; setTimeout(function () { delReq(myKey); }, 2500); }
        }

        renderViewerBtn(); renderHostBtn(); renderHostModal(); renderCover();
    }

    /* ------------------------------------------------- host: pause public feed */
    function applyPause(want) {
        var ls = LS(), ms = ls && ls._localStream;
        if (!ms || want === _paused) return;
        _paused = want;
        ms.getTracks().forEach(function (t) {
            if (want) { t.__pvPrev = t.enabled; t.enabled = false; }
            else { t.enabled = (t.__pvPrev === undefined ? true : t.__pvPrev); delete t.__pvPrev; }
        });
    }

    /* ----------------------------------------------------------- private call */
    function ensureCallUI(title) {
        var c = document.getElementById('live-stream-screen'); if (!c) return null;
        var ui = document.getElementById('pv56b-call');
        if (!ui) {
            ui = document.createElement('div'); ui.id = 'pv56b-call';
            ui.innerHTML =
                '<div id="pv56b-remote"><div class="pv56b-wait"><i class="fas fa-circle-notch fa-spin"></i><br>Connecting\u2026</div></div>' +
                '<div id="pv56b-local"></div>' +
                '<div class="pv56b-top"><span class="pv56b-lock"><i class="fas fa-lock"></i> <b id="pv56b-title"></b></span><span id="pv56b-clock" class="pv56b-lock" style="display:block;margin-top:6px;"></span></div>' +
                '<div class="pv56b-bar">' +
                '<button type="button" id="pv56b-mic" title="Mute"><i class="fas fa-microphone"></i></button>' +
                '<button type="button" id="pv56b-end" class="pv56b-endbtn"><i class="fas fa-phone-slash"></i> End</button>' +
                '<button type="button" id="pv56b-cam" title="Camera"><i class="fas fa-video"></i></button></div>';
            c.appendChild(ui);
            ui.querySelector('#pv56b-end').addEventListener('click', endByUser);
            ui.querySelector('#pv56b-mic').addEventListener('click', function (e) { toggleTrack('audio', e.currentTarget); });
            ui.querySelector('#pv56b-cam').addEventListener('click', function (e) { toggleTrack('video', e.currentTarget); });
        }
        ui.querySelector('#pv56b-title').textContent = title || 'Private consultation';
        return ui;
    }
    function toggleTrack(kind, btn) {
        _tracks.forEach(function (t) {
            var isA = typeof t.setVolume === 'function';
            if ((kind === 'audio') === isA) {
                var next = !t.enabled;
                try { t.setEnabled(next); } catch (e) {}
                btn.style.opacity = next ? '1' : '0.45';
            }
        });
    }
    async function startCall(k, entry) {
        if (_client || _starting) return;
        _starting = true; _callKey = k;
        var host = isHost();
        // clone the host's public tracks FIRST (synchronously) so the private feed keeps flowing when the public tracks are paused
        var ls = LS(), ms = ls && ls._localStream, cloned = [];
        if (host && ms) { try { cloned = ms.getTracks().map(function (t) { return t.clone(); }); } catch (e) {} }
        _clones = cloned;
        var peerName = host ? (entry && entry.name || 'client') : 'the host';
        ensureCallUI('Private consultation with ' + peerName);
        if (host) applyPause(true); // after cloning
        startTick();
        try {
            if (!agoraOK()) throw new Error('Video service unavailable');
            var channel = entry.channel || ('pv56priv-' + sid() + '-' + k);
            var uid = uidNum(me() && me().id);
            _client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
            _client.on('user-published', async function (user, mt) {
                try {
                    await _client.subscribe(user, mt);
                    if (mt === 'video') {
                        var box = document.getElementById('pv56b-remote');
                        if (box) { var w = box.querySelector('.pv56b-wait'); if (w) w.remove(); user.videoTrack.play(box); }
                    }
                    if (mt === 'audio') user.audioTrack.play();
                } catch (e) { warn('subscribe failed: ' + (e && e.message)); }
            });
            _client.on('user-left', function () { /* the other side ended — doc status drives teardown */ });
            var tok = await fetchToken(channel, uid);
            await _client.join(tok.appId || window._appConfig.agora.appId, channel, tok.token, tok.uid || uid);
            _tracks = [];
            var aT = null, vT = null;
            if (cloned.length) {
                cloned.forEach(function (t) {
                    if (t.kind === 'audio') aT = AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: t });
                    if (t.kind === 'video') vT = AgoraRTC.createCustomVideoTrack({ mediaStreamTrack: t });
                });
            } else {
                var pair = await AgoraRTC.createMicrophoneAndCameraTracks();
                aT = pair[0]; vT = pair[1];
            }
            if (aT) _tracks.push(aT); if (vT) _tracks.push(vT);
            if (_tracks.length) await _client.publish(_tracks);
            var lb = document.getElementById('pv56b-local');
            if (lb && vT) vT.play(lb);
        } catch (err) {
            warn('call failed: ' + (err && err.message));
            notify('Could not start the private video: ' + (err && err.message || 'check camera/mic permission'), 'error');
            _starting = false;
            endByUser();
            return;
        }
        _starting = false;
    }
    async function endCall(silent) {
        var c = _client, t = _tracks, cl = _clones;
        _client = null; _tracks = []; _clones = []; _callKey = null; _starting = false;
        removeEl('pv56b-call'); stopTick();
        try { if (c) { try { await c.unpublish(t); } catch (e) {} } } catch (e) {}
        t.forEach(function (x) { try { x.close(); } catch (e) {} });
        cl.forEach(function (x) { try { x.stop(); } catch (e) {} });
        try { if (c) await c.leave(); } catch (e) {}
    }
    function stampEnd(kk) {
        var q = _req[kk]; if (!isPaid(q) || !q.held || q.settled) return Promise.resolve();
        return billingCall('/api/consult/end', { streamId: sid(), key: kk }).catch(function (e) { warn('end stamp: ' + (e && e.message)); });
    }
    function endByUser() {
        var k = _callKey, host = isHost(), m = me();
        var kk = k || (m && key(m.id));
        if (kk && _req[kk]) setReq(kk, { status: 'ended', endedAt: new Date().toISOString() }).then(function () { return stampEnd(kk); }).then(function () { if (_req[kk]) maybeSettle(kk); });
        endCall(false);
        if (host) { setPrivate(false); }
    }

    /* ------------------------------------------------------------- host panel */
    function ensureHostBtn() {
        var panel = document.getElementById('host-control-panel-inner');
        if (!panel || document.getElementById('pv56b-priv-btn')) return;
        var b = document.createElement('button');
        b.id = 'pv56b-priv-btn'; b.type = 'button'; b.className = 'live-action-btn host-control';
        b.title = 'Private & 1:1 consultations';
        b.innerHTML = '<i class="fas fa-lock"></i><span id="pv56b-badge" style="display:none;"></span>';
        panel.appendChild(b);
    }
    function renderHostBtn() {
        if (!(isHost() && isLive())) { removeEl('pv56b-priv-btn'); removeEl('pv56b-host-chip'); return; }
        ensureHostBtn();
        var n = pendingList().length;
        var bd = document.getElementById('pv56b-badge');
        if (bd) { bd.textContent = n; bd.style.display = n ? 'flex' : 'none'; }
        /* FIX (2026-10-03 — "I'm not seeing anything that indicates the 1:1 private video"):
           the lock button was appended to the END of the host control panel, which is a long
           vertical strip that is clipped on phones — so it sat off-screen. A clearly labelled
           chip is now pinned top-right (under Minimize) so the host can always see it. */
        var c = document.getElementById('live-stream-screen');
        var ch = document.getElementById('pv56b-host-chip');
        if (c && !ch) {
            ch = document.createElement('button'); ch.id = 'pv56b-host-chip'; ch.type = 'button';
            c.appendChild(ch);
        }
        if (ch) { var _row = window.__pvChipRow && window.__pvChipRow(); if (_row && ch.parentNode !== _row) _row.appendChild(ch); }
        if (ch) {
            var on = !!(_priv && _priv.on), inCall = !!acceptedKey();
            ch.className = n ? 'pv56b-alert' : '';
            ch.innerHTML = '<i class="fas fa-lock"></i> ' + (inCall ? 'In 1:1' : (on ? 'Private' : 'Private / 1:1')) +
                (n ? ' <span class="pv56b-chipn">' + n + '</span>' : '');
        }
    }
    // FIX (bug report: "the private icon should be in the same line with the minimize
    // icon"): the Private / 1:1 chip and the Minimize chip were two separate absolutely
    // positioned buttons (top:64px, right:104px / right:12px), so any override, font
    // scaling or width change put them on different rows (see screenshot). They now live
    // in ONE flex row pinned top-right: same line by construction, Private to the left of
    // Minimize, equal height, no overlap. The row is shared with the v58 Minimize chip
    // below via window.__pvChipRow, and its CSS is injected here so the chips look right
    // even before the Private modal has ever been opened.
    window.__pvChipRow = function () {
        var c = document.getElementById('live-stream-screen'); if (!c) return null;
        if (!document.getElementById('pv-chip-row-css')) {
            var st = document.createElement('style'); st.id = 'pv-chip-row-css';
            st.textContent =
                '#live-stream-screen #pv-chip-row{position:absolute!important;top:64px!important;right:12px!important;left:auto!important;bottom:auto!important;z-index:9;display:flex!important;flex-direction:row!important;flex-wrap:nowrap;align-items:center;justify-content:flex-end;gap:6px;pointer-events:none;}' +
                '#live-stream-screen #pv-chip-row>button{pointer-events:auto;position:static!important;top:auto!important;right:auto!important;left:auto!important;bottom:auto!important;margin:0!important;flex:0 0 auto;white-space:nowrap;background:rgba(20,20,24,.85);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:14px;padding:4px 10px;font-size:11px;line-height:16px;font-weight:700;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.35);}' +
                '#live-stream-screen #pv-chip-row>#pv56b-host-chip{order:1;}' +
                '#live-stream-screen #pv-chip-row>#pv58-min-chip{order:2;}';
            document.head.appendChild(st);
        }
        var r = document.getElementById('pv-chip-row');
        if (!r) { r = document.createElement('div'); r.id = 'pv-chip-row'; c.appendChild(r); }
        return r;
    };
    function ensureModal() {
        if (document.getElementById('pv56b-modal')) return;
        var c = document.getElementById('live-stream-screen') || document.body;
        var m = document.createElement('div');
        m.id = 'pv56b-modal'; m.className = 'live-sub-modal';
        m.innerHTML = '<button type="button" class="close-modal pv56b-close" style="color:white;z-index:5;top:5px;right:10px;">\u00d7</button>' +
            '<h3>\uD83D\uDD12 Private &amp; 1:1</h3><div id="pv56b-body" style="overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;"></div>';
        c.appendChild(m);
        m.querySelector('.pv56b-close').addEventListener('click', function () { m.classList.remove('show'); });
        m.addEventListener('click', function (e) {
            var b = e.target.closest('[data-pv56b]'); if (!b) return;
            var act = b.getAttribute('data-pv56b'), k = b.getAttribute('data-k');
            if (act === 'accept') {
                if (acceptedKey()) { notify('Finish the current consultation first.', 'warning'); return; }
                var r = _req[k]; if (!r) return;
                _terms[k] = { type: isPaid(r) ? 'paid' : 'free', minutes: Number(r.minutes) || 0, price: Number(r.price) || 0, requestedAt: String(r.requestedAt || '') };
                setReq(k, { status: 'accepted', channel: 'pv56priv-' + sid() + '-' + k, acceptedAt: new Date().toISOString() });
                setPrivate(true, { uid: r.uid || k, name: r.name || '' });
                m.classList.remove('show');
            } else if (act === 'decline') { setReq(k, { status: 'declined' }); }
            else if (act === 'end') { endByUser(); }
            else if (act === 'toggle') { setPrivate(!(_priv && _priv.on), { manual: true, name: '' }); }
            else if (act === 'cfg-free') { saveCfg({ freeEnabled: !cfg().freeEnabled }); }
            else if (act === 'cfg-paid') { saveCfg({ paidEnabled: !cfg().paidEnabled }); }
            else if (act === 'cfg-preset') {
                var pv = Math.floor(Number(b.getAttribute('data-v')));
                if (pv >= 1 && pv <= 100000) { saveCfg({ rate: pv }); notify('Price saved: ' + fmt(pv) + ' EMPY per minute.', 'success'); }
            }
            else if (act === 'cfg-rate') {
                var inp = document.getElementById('pv56b-rate-input'), v = Math.floor(Number(inp && inp.value));
                if (!(v >= 1 && v <= 100000)) { notify('Enter a price between 1 and 100,000 EMPY per minute.', 'warning'); return; }
                saveCfg({ rate: v }); notify('Price saved: ' + fmt(v) + ' EMPY per minute.', 'success');
            }
        });
    }
    function renderHostModal() {
        var m = document.getElementById('pv56b-modal');
        if (!m || !m.classList.contains('show')) return;
        var body = document.getElementById('pv56b-body'); if (!body) return;
        if (document.activeElement && document.activeElement.id === 'pv56b-rate-input') return;
        var ak = acceptedKey(), on = !!(_priv && _priv.on), h = '';
        if (ak) {
            h += '<div class="pv56b-card pv56b-active"><b>In a private consultation</b><span>' + esc(_req[ak].name || 'Client') + (isPaid(_req[ak]) ? (_req[ak].held ? ' \u00b7 paid ' + esc(_req[ak].minutes) + ' min (' + fmt(_req[ak].price) + ' EMPY)' : ' \u00b7 waiting for payment\u2026') : ' \u00b7 free') + '</span>' +
                 '<button type="button" class="btn btn-danger" data-pv56b="end">End / cancel consultation</button></div>';
        } else {
            h += '<div class="pv56b-card"><b>Go private</b><span>' + (on ? 'Your public stream is paused \u2014 viewers see a private-session cover.' : 'Pause the public stream and show viewers a private-session cover.') + '</span>' +
                 '<button type="button" class="btn ' + (on ? '' : 'btn-danger') + '" data-pv56b="toggle">' + (on ? 'Resume public live' : 'Go private') + '</button></div>';
        }
        var c = cfg();
        h += '<div class="pv56b-card" style="margin-top:10px;"><b>Consultation options &amp; pricing</b>' +
             '<label class="pv56b-opt"><input type="checkbox" data-pv56b="cfg-free"' + (c.freeEnabled ? ' checked' : '') + '> Offer free consultations <span>(you accept or decline each request)</span></label>' +
             '<label class="pv56b-opt"><input type="checkbox" data-pv56b="cfg-paid"' + (c.paidEnabled ? ' checked' : '') + '> Offer paid consultations <span>(billed per minute used)</span></label>' +
             '<div class="pv56b-rate"><input id="pv56b-rate-input" type="number" min="1" max="100000" step="1" inputmode="numeric" value="' + c.rate + '"><span>EMPY / min</span>' +
             '<button type="button" class="pv56b-ok" data-pv56b="cfg-rate">Save</button></div>' +
             '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">' +
             [1, 2, 5, 10, 20].map(function (n) {
                 return '<button type="button" data-pv56b="cfg-preset" data-v="' + n + '" style="border:1px solid ' + (c.rate === n ? '#f5a623' : 'rgba(255,255,255,.25)') + ';background:' + (c.rate === n ? 'rgba(245,166,35,.18)' : 'rgba(255,255,255,.08)') + ';color:#fff;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;">' + n + '/min</button>';
             }).join('') + '</div>' +
             '<div style="color:#aaa;font-size:11px;margin-top:8px;">Viewers will see: ' + DURATIONS.map(function (d) { return d + ' min = ' + fmt(d * c.rate); }).join(' \u00b7 ') + ' EMPY</div></div>';
        var pend = pendingList();
        h += '<h4 style="color:#fff;margin:12px 0 6px;">1:1 consultation requests (' + pend.length + ')</h4>';
        if (!pend.length) h += '<p style="color:#bbb;text-align:center;padding:10px 0;">No requests right now. Viewers can ask from the \u201c1:1 Consult\u201d button.</p>';
        h += pend.map(function (r) {
            var k = key(r.uid);
            return '<div class="pv56b-row">' + (r.avatar ? '<img src="' + esc(r.avatar) + '" alt="">' : '<div class="pv56b-noav"><i class="fas fa-user"></i></div>') +
                '<div class="pv56b-meta"><strong>' + esc(r.name || 'Viewer') + '</strong><span>' + (isPaid(r) ? 'Paid \u00b7 ' + esc(r.minutes) + ' min \u00b7 ' + fmt(r.price) + ' EMPY (' + fmt(r.rate) + '/min)' : 'Free consultation') + '</span></div>' +
                '<button type="button" class="pv56b-ok" data-pv56b="accept" data-k="' + esc(k) + '">Accept</button>' +
                '<button type="button" class="pv56b-no" data-pv56b="decline" data-k="' + esc(k) + '">Decline</button></div>';
        }).join('');
        body.innerHTML = h;
    }

    /* ------------------------------------------------------------ viewer button */
    function renderViewerBtn() {
        var m = me();
        var show = isLive() && !isHost() && !_callKey && !(_priv && _priv.on && !(m && _req[key(m.id)]));
        var b = document.getElementById('pv56b-req-btn');
        if (!isLive() || isHost() || _callKey) { if (b) b.remove(); return; }
        var c = document.getElementById('live-stream-screen'); if (!c) return;
        if (!b) {
            b = document.createElement('button'); b.id = 'pv56b-req-btn'; b.type = 'button'; c.appendChild(b);
            b.addEventListener('click', onViewerTap);
        }
        var mine = m && _req[key(m.id)];
        var pending = mine && mine.status === 'pending';
        b.className = pending ? 'pv56b-pending' : '';
        b.innerHTML = pending ? '<i class="fas fa-times"></i> Cancel request' : '<i class="fas fa-lock"></i> 1:1 Consult';
        b.style.display = (show || pending) ? '' : 'none';
    }
    function onViewerTap() {
        var m = me();
        if (!m) { notify('Please log in to request a private consultation.', 'warning'); return; }
        var k = key(m.id), mine = _req[k];
        if (mine && mine.status === 'pending') {
            setReq(k, { status: 'cancelled' }); notify('Request cancelled.', 'info');
            setTimeout(function () { delReq(k); }, 2500);
            return;
        }
        openPicker();
    }
    function sendRequest(sel) {
        var m = me(); if (!m || !sel) return;
        var c = cfg(), k = key(m.id);
        var req = {
            uid: m.id, name: m.fullName || m.username || 'Viewer',
            avatar: m.avatar || m.profilePic || m.profilePicture || m.photoURL || '',
            status: 'pending', requestedAt: new Date().toISOString(), channel: '', type: sel.type
        };
        if (sel.type === 'paid') {
            if (!c.paidEnabled) { notify('The host is not offering paid consultations right now.', 'info'); return; }
            req.minutes = sel.minutes; req.rate = c.rate; req.price = sel.minutes * c.rate;
            if (balance() < req.price) { notify('Not enough EMPY \u2014 you need ' + fmt(req.price) + ' and have ' + fmt(balance()) + '.', 'error'); return; }
        } else if (!c.freeEnabled) { notify('The host is not offering free consultations right now.', 'info'); return; }
        newReq(k, req).then(function () {
            notify(sel.type === 'paid' ? 'Request sent \u2014 you are only charged if the host accepts, for the time you use.' : 'Request sent \u2014 waiting for the host to accept\u2026', 'success');
        });
    }
    function balance() { var m = me(); return m ? Number(m.empyBalance || 0) : 0; }

    /* ---- price picker (viewer): choose free or a paid duration, see the price before confirming */
    function ensurePicker() {
        var p = document.getElementById('pv56b-picker'); if (p) return p;
        var c = document.getElementById('live-stream-screen') || document.body;
        p = document.createElement('div'); p.id = 'pv56b-picker'; p.className = 'live-sub-modal';
        p.innerHTML = '<button type="button" class="close-modal pv56b-pclose" style="color:white;z-index:5;top:5px;right:10px;">\u00d7</button>' +
            '<h3>\uD83D\uDD12 Request a 1:1 consultation</h3><div id="pv56b-pbody" style="overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;"></div>';
        c.appendChild(p);
        p.querySelector('.pv56b-pclose').addEventListener('click', function () { p.classList.remove('show'); });
        p.addEventListener('click', function (e) {
            var b = e.target.closest('[data-pick]'); if (!b) return;
            var a = b.getAttribute('data-pick');
            if (a === 'free') _pickSel = { type: 'free' };
            else if (a === 'paid') _pickSel = { type: 'paid', minutes: Number(b.getAttribute('data-min')) };
            else if (a === 'send') { if (_pickSel) { sendRequest(_pickSel); p.classList.remove('show'); } return; }
            renderPicker();
        });
        return p;
    }
    function renderPicker() {
        var body = document.getElementById('pv56b-pbody'); if (!body) return;
        var c = cfg(), bal = balance(), h = '';
        if (!c.freeEnabled && !c.paidEnabled) {
            body.innerHTML = '<p style="color:#bbb;text-align:center;padding:16px 0;">The host is not taking 1:1 requests right now.</p>'; return;
        }
        if (c.freeEnabled) {
            h += '<div class="pv56b-pick' + (_pickSel && _pickSel.type === 'free' ? ' sel' : '') + '" data-pick="free"><b>Free consultation</b><span>No charge \u2014 the host can accept or decline.</span></div>';
        }
        if (c.paidEnabled) {
            h += '<div class="pv56b-pickhead">Paid \u00b7 ' + fmt(c.rate) + ' EMPY per minute \u00b7 billed for time used, unused minutes refunded</div><div class="pv56b-durs">';
            DURATIONS.forEach(function (d) {
                var price = d * c.rate, sel = _pickSel && _pickSel.type === 'paid' && _pickSel.minutes === d;
                h += '<button type="button" class="pv56b-dur' + (sel ? ' sel' : '') + (bal < price ? ' low' : '') + '" data-pick="paid" data-min="' + d + '"><b>' + d + ' min</b><span>' + fmt(price) + ' EMPY</span></button>';
            });
            h += '</div><div class="pv56b-bal">Your balance: ' + fmt(bal) + ' EMPY</div>';
        }
        var ok = !!_pickSel, label = 'Choose an option';
        if (_pickSel && _pickSel.type === 'free') label = 'Send free request';
        if (_pickSel && _pickSel.type === 'paid') {
            var pr = _pickSel.minutes * c.rate;
            if (bal < pr) { ok = false; label = 'Not enough EMPY (' + fmt(pr) + ' needed)'; }
            else label = 'Send request \u00b7 up to ' + fmt(pr) + ' EMPY';
        }
        h += '<button type="button" class="pv56b-send" data-pick="send"' + (ok ? '' : ' disabled') + '>' + label + '</button>';
        body.innerHTML = h;
    }
    function openPicker() {
        var c = cfg();
        _pickSel = c.freeEnabled && !c.paidEnabled ? { type: 'free' } : null;
        var p = ensurePicker(); p.classList.add('show'); renderPicker();
    }

    /* ------------------------------------------------- cover for other viewers */
    function renderCover() {
        var m = me(), mine = m && _req[key(m.id)];
        var covered = _priv && _priv.on && !isHost() && !_callKey;
        var ov = document.getElementById('pv56b-private-ov');
        if (!covered) { if (ov) ov.remove(); return; }
        var c = document.getElementById('live-stream-screen'); if (!c) return;
        if (!ov) {
            ov = document.createElement('div'); ov.id = 'pv56b-private-ov';
            ov.innerHTML = '<div><i class="fas fa-lock"></i><h3>Private session</h3><p>The host stepped away for a private consultation.<br>The live will resume shortly.</p></div>';
            c.appendChild(ov);
        }
    }

    /* -------------------------------------------------------------- events/CSS */
    // FIX (bug report: "private button not working"): was a document-level capture
    // listener, which runs AFTER any capture listener another patch registered on
    // `window`/earlier on `document` — so a swallowed tap never reached it. It now
    // sits on `window` in the capture phase (the very first stop for a click), and
    // a 350ms re-entry guard stops one physical tap from toggling the modal twice
    // (open -> instantly closed reads exactly like "nothing happens"). It also logs
    // why it bailed out, so a still-dead button is diagnosable from the console.
    var _lastChipToggle = 0;
    window.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        var b = e.target.closest('#pv56b-priv-btn, #pv56b-host-chip'); if (!b) return;
        e.stopImmediatePropagation(); e.preventDefault();
        var now = Date.now();
        if (now - _lastChipToggle < 350) return;
        _lastChipToggle = now;
        if (!isHost() || !isLive()) {
            console.warn('[V56B] private chip tap ignored — isHost=' + isHost() + ' isLive=' + isLive());
            return;
        }
        try {
            ensureModal();
            var m = document.getElementById('pv56b-modal');
            if (m.classList.contains('show')) { m.classList.remove('show'); return; }
            if (window._empCloseOtherLiveSheets) window._empCloseOtherLiveSheets(m);
            m.classList.add('show'); renderHostModal();
        } catch (eChip) { console.warn('[V56B] private chip handler error: ' + (eChip && eChip.message)); }
    }, true);

    (function css() {
        if (document.getElementById('pv56b-css')) return;
        var s = document.createElement('style'); s.id = 'pv56b-css';
        s.textContent =
            '#pv56b-priv-btn{position:relative;}' +
            '#pv56b-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;border-radius:8px;background:#e11d48;color:#fff;font-size:10px;font-weight:700;align-items:center;justify-content:center;padding:0 4px;}' +
            '#pv56b-host-chip{position:absolute;top:64px;right:104px;z-index:9;background:rgba(20,20,24,.85);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:14px;padding:4px 10px;font-size:11px;line-height:16px;font-weight:700;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.35);}' +
            '#pv56b-host-chip.pv56b-alert{background:#e11d48;border-color:#e11d48;animation:pv58pulse 1.2s ease-in-out infinite;}' +
            '.pv56b-chipn{background:#fff;color:#e11d48;border-radius:9px;padding:0 6px;margin-left:2px;}' +
            '#pv56b-req-btn{position:absolute;top:64px;right:12px;z-index:9;background:rgba(20,20,24,.85);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:14px;padding:4px 10px;font-size:11px;line-height:16px;font-weight:700;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.35);}' +
            '#pv56b-req-btn.pv56b-pending{background:#e11d48;border-color:#e11d48;}' +
            '#pv56b-private-ov{position:absolute;inset:0;z-index:8;background:rgba(10,10,18,.88);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;text-align:center;color:#fff;padding:30px;}' +
            '#pv56b-private-ov i{font-size:34px;color:#f5a623;} #pv56b-private-ov h3{margin:10px 0 6px;color:#fff;} #pv56b-private-ov p{color:#ccc;font-size:13px;}' +
            '#pv56b-call{position:absolute;inset:0;z-index:10;background:#000;}' +
            '#pv56b-remote{position:absolute;inset:0;} #pv56b-remote video{object-fit:cover!important;}' +
            '.pv56b-wait{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:#ddd;font-size:14px;line-height:2;}' +
            '#pv56b-local{position:absolute;right:12px;top:84px;width:96px;height:140px;border-radius:12px;overflow:hidden;background:#222;border:2px solid rgba(255,255,255,.4);z-index:2;} #pv56b-local video{object-fit:cover!important;}' +
            '.pv56b-top{position:absolute;left:12px;top:84px;z-index:2;} .pv56b-lock{background:rgba(0,0,0,.6);color:#fff;font-size:12px;padding:5px 10px;border-radius:12px;}' +
            '.pv56b-bar{position:absolute;left:0;right:0;bottom:28px;display:flex;justify-content:center;gap:18px;z-index:2;}' +
            '.pv56b-bar button{border:none;border-radius:28px;min-width:52px;height:52px;background:rgba(255,255,255,.2);color:#fff;font-size:18px;cursor:pointer;padding:0 16px;}' +
            '.pv56b-bar .pv56b-endbtn{background:#e11d48;font-size:15px;font-weight:700;padding:0 22px;}' +
            '.pv56b-card{background:rgba(255,255,255,.07);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:6px;color:#fff;} .pv56b-card span{color:#bbb;font-size:12px;} .pv56b-card.pv56b-active{background:rgba(225,29,72,.2);}' +
            '.pv56b-row{display:flex;align-items:center;gap:8px;padding:8px;border-radius:10px;background:rgba(255,255,255,.05);margin-bottom:6px;}' +
            '.pv56b-row img,.pv56b-noav{width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;color:#aaa;}' +
            '.pv56b-meta{display:flex;flex-direction:column;min-width:0;flex:1;} .pv56b-meta strong{color:#fff;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;} .pv56b-meta span{color:#aaa;font-size:11px;}' +
            '.pv56b-ok,.pv56b-no{border:none;border-radius:8px;padding:7px 10px;font-size:12px;font-weight:700;cursor:pointer;} .pv56b-ok{background:#16a34a;color:#fff;} .pv56b-no{background:rgba(255,255,255,.15);color:#fff;}' +
            '.pv56b-opt{display:flex;align-items:center;gap:8px;font-size:13px;color:#fff;} .pv56b-opt span{color:#aaa;font-size:11px;} .pv56b-opt input{width:18px;height:18px;flex-shrink:0;}' +
            '.pv56b-rate{display:flex;align-items:center;gap:8px;color:#fff;} .pv56b-rate input{width:90px;padding:7px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.35);color:#fff;font-size:14px;} .pv56b-rate span{color:#bbb;font-size:12px;flex:1;}' +
            '.pv56b-pick{background:rgba(255,255,255,.07);border:2px solid transparent;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:4px;color:#fff;cursor:pointer;margin-bottom:10px;} .pv56b-pick span{color:#bbb;font-size:12px;}' +
            '.pv56b-pick.sel,.pv56b-dur.sel{border-color:#f5a623;background:rgba(245,166,35,.15);}' +
            '.pv56b-pickhead{color:#ccc;font-size:12px;margin:4px 0 8px;} .pv56b-durs{display:grid;grid-template-columns:1fr 1fr;gap:8px;}' +
            '.pv56b-dur{background:rgba(255,255,255,.07);border:2px solid transparent;border-radius:12px;padding:10px;color:#fff;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;} .pv56b-dur span{color:#f5a623;font-size:13px;font-weight:700;} .pv56b-dur.low span{color:#f87171;}' +
            '.pv56b-bal{color:#bbb;font-size:12px;text-align:center;margin:10px 0;}' +
            '.pv56b-send{width:100%;border:none;border-radius:12px;padding:13px;font-size:14px;font-weight:700;background:#e11d48;color:#fff;cursor:pointer;margin-top:6px;} .pv56b-send:disabled{opacity:.45;cursor:not-allowed;}';
        document.head.appendChild(s);
    })();


    /* =========================================================================
       FEATURE (2026-10-03 — "host should be able to minimize the live so they can
       check other sections and come back"): host-only Minimize. The live overlay is
       hidden with a class (NOT closed) so the camera, Agora publishing, comments and
       viewers all carry on; the app underneath (bottom nav, every section) becomes
       usable, and a small draggable floating preview "bubble" with a LIVE badge stays
       on top of every section — tap it to return to the live screen exactly as left.
       Ending the live (power button) or the stream ending removes the bubble.
       ========================================================================= */
    function isMinimized() { var ov = document.getElementById('go-live-modal-overlay'); return !!(ov && ov.classList.contains('pv58-min')); }
    // FIX (bug report: "when minimized it doesn't show the bottom navigation bar"):
    // app-live-tiktok-patch.js hides #mobile-bottom-nav / .mobile-menu-toggle whenever
    // #go-live-modal-overlay has class `show` (body.tk-live-open + an inline
    // `display:none !important` set from a MutationObserver on that overlay). Minimizing
    // only ADDS `pv58-min` to the overlay — `show` stays — and that class change even
    // re-fires their observer, which re-asserts "hide the nav". So the nav stayed hidden
    // over the feed. While minimized we now undo that (inline important beats any
    // stylesheet rule, so it has to be done on the elements, not with CSS) and re-apply
    // it after their observer has run. On return (restoreLive) pv58-min is removed, their
    // observer fires with `show` still set, and the nav hides again by itself.
    function _pvNavWhileMinimized() {
        if (!document.body.classList.contains('pv58-live-minimized')) return;
        document.body.classList.remove('tk-live-open');
        var els = [document.getElementById('mobile-bottom-nav')];
        var tg = document.querySelectorAll('.mobile-menu-toggle');
        for (var i = 0; i < tg.length; i++) els.push(tg[i]);
        els.forEach(function (el) {
            if (!el) return;
            var prev = el.dataset.tkPrevDisplay;
            el.style.removeProperty('display');
            if (prev) el.style.display = prev;
            delete el.dataset.tkPrevDisplay;
        });
    }
    var _pvNavObs = false;
    function _pvWatchNavWhileMinimized(ov) {
        if (_pvNavObs || !ov || typeof MutationObserver === 'undefined') return;
        _pvNavObs = true;
        // deferred so it always lands AFTER the tiktok patch's own observer callback
        new MutationObserver(function () { setTimeout(_pvNavWhileMinimized, 0); })
            .observe(ov, { attributes: true, attributeFilter: ['class'] });
    }
    function minimizeLive() {
        if (!isHost() || !isLive()) return;
        var ov = document.getElementById('go-live-modal-overlay'); if (!ov) return;
        _pvWatchNavWhileMinimized(ov);
        ov.classList.add('pv58-min');
        document.body.classList.add('pv58-live-minimized');
        _pvNavWhileMinimized(); setTimeout(_pvNavWhileMinimized, 0); setTimeout(_pvNavWhileMinimized, 250);
        document.body.classList.remove('modal-open'); document.body.style.overflow = ''; // live overlay set modal-open (overflow:hidden) — that is what froze scrolling while minimized
        var m1 = document.getElementById('pv56-pick-modal'); if (m1) m1.classList.remove('show');
        var m2 = document.getElementById('pv56b-modal'); if (m2) m2.classList.remove('show');
        buildBubble();
        notify('You are still live. Tap the floating bubble to return.', 'info');
    }
    function restoreLive() {
        var ov = document.getElementById('go-live-modal-overlay'); if (ov) ov.classList.remove('pv58-min');
        document.body.classList.remove('pv58-live-minimized');
        if (ov && ov.classList.contains('show') && isLive()) document.body.classList.add('modal-open'); // back on the live screen: lock the page behind it again
        removeEl('pv58-bubble');
        var b = document.getElementById('pv56-back-live'); if (b) b.remove();
    }
    function buildBubble() {
        if (document.getElementById('pv58-bubble')) return;
        var b = document.createElement('div');
        b.id = 'pv58-bubble';
        b.innerHTML = '<video id="pv58-prev" muted playsinline autoplay></video><div class="pv58-noprev"><i class="fas fa-broadcast-tower"></i></div>' +
            '<span class="pv58-live">\u25CF LIVE</span><span class="pv58-tap">Tap to return</span>';
        document.body.appendChild(b);
        var v = b.querySelector('#pv58-prev'), ls = LS();
        var ms = ls && ls._localStream;
        if (ms && ms.getVideoTracks && ms.getVideoTracks().length) {
            try { v.srcObject = new MediaStream(ms.getVideoTracks()); v.play().catch(function () {}); b.classList.add('pv58-hasvid'); v.addEventListener('pause', function () { if (document.getElementById('pv58-bubble')) v.play().catch(function () {}); }); /* app-nav's _stopAllVideos() pauses every video outside the live overlay on navigation — keep the preview running */ } catch (e) {}
        }
        // drag + tap (tap = movement under 8px)
        var sx = 0, sy = 0, ox = 0, oy = 0, moved = false, down = false;
        b.addEventListener('pointerdown', function (e) {
            down = true; moved = false; sx = e.clientX; sy = e.clientY;
            var r = b.getBoundingClientRect(); ox = r.left; oy = r.top;
            try { b.setPointerCapture(e.pointerId); } catch (x) {}
        });
        b.addEventListener('pointermove', function (e) {
            if (!down) return;
            var dx = e.clientX - sx, dy = e.clientY - sy;
            if (Math.abs(dx) + Math.abs(dy) > 8) moved = true;
            if (!moved) return;
            var w = b.offsetWidth, h = b.offsetHeight;
            b.style.left = Math.max(0, Math.min(window.innerWidth - w, ox + dx)) + 'px';
            b.style.top = Math.max(0, Math.min(window.innerHeight - h, oy + dy)) + 'px';
            b.style.right = 'auto'; b.style.bottom = 'auto';
        });
        b.addEventListener('pointerup', function () { if (down && !moved) restoreLive(); down = false; });
        b.addEventListener('pointercancel', function () { down = false; });
    }
    function renderMinBtns() {
        var show = isHost() && isLive() && !isMinimized();
        var panel = document.getElementById('host-control-panel-inner');
        var pb = document.getElementById('pv58-min-btn');
        if (show && panel && !pb) {
            pb = document.createElement('button'); pb.id = 'pv58-min-btn'; pb.type = 'button';
            pb.className = 'live-action-btn host-control'; pb.title = 'Minimize live';
            pb.innerHTML = '<i class="fas fa-compress-alt"></i>';
            panel.appendChild(pb);
        } else if (!show && pb) pb.remove();
        var c = document.getElementById('live-stream-screen');
        var cb = document.getElementById('pv58-min-chip');
        if (show && c && !cb) {
            cb = document.createElement('button'); cb.id = 'pv58-min-chip'; cb.type = 'button';
            cb.innerHTML = '<i class="fas fa-chevron-down"></i> Minimize';
            c.appendChild(cb);
        } else if (!show && cb) cb.remove();
        if (show && cb) { var _row2 = window.__pvChipRow && window.__pvChipRow(); if (_row2 && cb.parentNode !== _row2) _row2.appendChild(cb); }
        if (!isLive() && (isMinimized() || document.getElementById('pv58-bubble'))) restoreLive();
    }
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        if (!e.target.closest('#pv58-min-btn, #pv58-min-chip')) return;
        e.stopImmediatePropagation(); e.preventDefault();
        minimizeLive();
    }, true);
    (function css2() {
        if (document.getElementById('pv58-css')) return;
        var s = document.createElement('style'); s.id = 'pv58-css';
        s.textContent =
            '#go-live-modal-overlay.pv58-min{display:none!important;}' +
            '#pv58-min-chip{position:absolute;top:64px;right:12px;z-index:9;background:rgba(20,20,24,.85);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:14px;padding:4px 10px;font-size:11px;line-height:16px;font-weight:700;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.35);}' +
            '#pv58-bubble{position:fixed;right:12px;top:130px;width:92px;height:136px;border-radius:14px;overflow:hidden;z-index:2147483000;background:linear-gradient(160deg,#1b2b8b,#e11d48);border:2px solid #e11d48;box-shadow:0 6px 18px rgba(0,0,0,.45);touch-action:none;cursor:pointer;}' +
            '#pv58-bubble video{display:none;width:100%;height:100%;object-fit:cover;} #pv58-bubble.pv58-hasvid video{display:block;} #pv58-bubble.pv58-hasvid .pv58-noprev{display:none;}' +
            '.pv58-noprev{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;}' +
            '.pv58-live{position:absolute;top:6px;left:6px;background:#e11d48;color:#fff;font-size:10px;font-weight:800;padding:2px 6px;border-radius:8px;animation:pv58pulse 1.4s ease-in-out infinite;}' +
            '.pv58-tap{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);color:#fff;font-size:10px;text-align:center;padding:3px 0;}' +
            '@keyframes pv58pulse{50%{opacity:.55;}}';
        document.head.appendChild(s);
    })();

    setInterval(function () { renderMinBtns(); if (isLive()) { renderViewerBtn(); renderHostBtn(); } }, 1000);
    console.log('[EmpyreanPatchV56B] \u2705 Go private + 1:1 private video consultation (request / accept / decline / cancel / end) added.');
})();


/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v57
   (lives inside app-patch-v55.js — see that file's own top header)

   FEATURE — STREAM REPLAY (RECORD \u2192 CLOUD SAVE \u2192 PLAYBACK)

   REQUESTED: viewers should be able to watch a stream again after it
   ends. The punch-list's own note flagged this as needing "Agora Cloud
   Recording, which is a server-side/backend piece (Agora RESTful API +
   storage), not something a client-only patch file can do" — that
   assessment is correct and still true here: real Agora Cloud
   Recording (server-composited audio/video across every participant,
   started/stopped via Agora's REST API with an app-certificate-signed
   request) needs a backend to hold that certificate. A client-only
   patch file can never do that safely.

   WHAT THIS BUILDS INSTEAD, HONESTLY SCOPED: a HOST-DEVICE-ONLY local
   recording — MediaRecorder capturing whatever is on the host's own
   screen (their camera or, if v55's beauty filter is active, the
   filtered canvas \u2014 see \u00a72) plus the host's own mic \u2014 uploaded to
   Cloudinary and saved as a `stream_replays` doc the moment the stream
   ends. This is real, working, cross-device, permanently-playable
   replay \u2014 it just doesn't composite in guest-broadcaster video/audio
   the way server-side Agora Cloud Recording would. Flagged explicitly
   so that gap isn't discovered as a surprise later; extending to a true
   multi-participant composited recording is a separate, backend-owned
   project.

   ═══════════════════════════════════════════════════════════════════════
   REUSING THE EXISTING #live-record-btn INSTEAD OF ADDING A NEW ONE
   ═══════════════════════════════════════════════════════════════════════
   index.html already ships a `#live-record-btn` ("Start Recording"),
   and app-fixes.js already has TWO pieces of code touching it: an
   early delegated click handler that now just early-returns with the
   comment "Recording removed", and a later "FIX 4: LIVE RECORDING --
   USE ACTUAL BLOB" block that DOES start a real MediaRecorder off
   `#host-main-video` \u2014 but only keeps the result as a same-session
   blob: URL in an in-memory card (`addRecordedLiveStream`), with no
   Cloudinary upload and no Firestore doc, so it's gone the moment the
   tab closes and was never visible to anyone but the host, on that one
   device, that one session.

   Rather than add a second, competing button, this patch neutralizes
   BOTH of those existing handlers for this one button id and replaces
   them with the full record\u2192upload\u2192persist\u2192playback pipeline below.
   Neutralizing is done the same way this codebase already resolved an
   identical duplicate-handler conflict (see live-streaming fix notes:
   "migrating from per-node event binding to a single capture-phase
   document-delegated handler" for the gift/share icons) \u2014 a listener
   added in the CAPTURE phase runs before any bubble-phase listener
   (which is what both of app-fixes.js's own handlers are), so calling
   `stopImmediatePropagation()` there, scoped ONLY to clicks on
   `#live-record-btn`, cleanly stops both older handlers from ever
   running for this button while touching zero bytes of app-fixes.js
   and leaving every other button on that same delegated listener
   completely alone.

   ═══════════════════════════════════════════════════════════════════════
   REQUIRED FIRESTORE RULE ADDITION (new collection \u2014 active_streams'
   existing rule does not cover this):
     match /stream_replays/{replayId} {
       allow read: if true;
       allow create: if request.auth != null
                     && request.resource.data.hostId == request.auth.uid;
       allow update: if request.auth != null
                     && request.resource.data.diff(resource.data)
                          .affectedKeys().hasOnly(['views']);
       allow delete: if request.auth != null
                     && resource.data.hostId == request.auth.uid;
     }
   (mirrors the read-public / write-owner-only shape this codebase
   already uses for marketplace_listings.)
   ============================================================================= */

(function empyreanPatchV57() {
    'use strict';

    if (window._empPatchV57Loaded) {
        console.warn('[V57] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV57Loaded = true;

    function log(msg) { console.log('[V57] ' + msg); }
    function warn(msg) { console.warn('[V57] ' + msg); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function isRealHost() {
        if (window.isGuest || !window.userState || !window.liveStreamData) return false;
        var sd = window.liveStreamData;
        var hid = sd.hostUserId || sd.hostId;
        return !!hid && window.userState.id === hid;
    }
    function isCurrentlyLive() {
        return !!(window.liveStreamData && window.liveStreamData.isLive);
    }

    /* =========================================================================
       §1 — minimal, SEPARATE AgoraRTC capture wrap (own flag
       `_empV57Wrapped`, distinct from v55's `_empV55Wrapped`) — only
       needs the host's raw mic track, nothing else, so this is a much
       smaller wrap than v55's own §1. Safe to coexist: each patch wraps
       whatever `AgoraRTC.createMicrophoneAndCameraTracks` currently
       points to at the moment it runs, so whichever of v55/v57 loads
       second simply wraps the first one's wrapper — both still fire,
       order-independent (same chaining v55's own header already
       explains for why this technique is reliable).
       ========================================================================= */
    var _rawMicTrack = null;
    var _capturedForChannel = null;
    function _resetIfNewChannel() {
        var ch = window._agoraActiveChannel;
        if (ch !== _capturedForChannel) { _capturedForChannel = ch; _rawMicTrack = null; }
    }
    (function installWrap() {
        function tryWrap() {
            if (typeof AgoraRTC === 'undefined' || AgoraRTC._empV57Wrapped) return;
            AgoraRTC._empV57Wrapped = true;
            if (typeof AgoraRTC.createMicrophoneAndCameraTracks === 'function') {
                var origBoth = AgoraRTC.createMicrophoneAndCameraTracks.bind(AgoraRTC);
                AgoraRTC.createMicrophoneAndCameraTracks = async function () {
                    var tracks = await origBoth.apply(AgoraRTC, arguments);
                    if (isRealHost()) { _resetIfNewChannel(); _rawMicTrack = tracks && tracks[0] ? tracks[0] : _rawMicTrack; }
                    return tracks;
                };
            }
            if (typeof AgoraRTC.createMicrophoneAudioTrack === 'function') {
                var origMic = AgoraRTC.createMicrophoneAudioTrack.bind(AgoraRTC);
                AgoraRTC.createMicrophoneAudioTrack = async function () {
                    var t = await origMic.apply(AgoraRTC, arguments);
                    if (isRealHost()) { _resetIfNewChannel(); _rawMicTrack = t || _rawMicTrack; }
                    return t;
                };
            }
        }
        tryWrap();
        setTimeout(tryWrap, 500);
        setTimeout(tryWrap, 1500);
        setTimeout(tryWrap, 4000);
        /* 2026-10-28: the SDK is lazy-loaded now (index.html's window._empLoadAgora) — wrap the moment it exists. */
        window.addEventListener('empyrean:agora-ready', tryWrap);
    })();

    /* =========================================================================
       §2 — pick whatever the host is CURRENTLY publishing on screen: the
       v55 beauty canvas if that's active (found purely via its DOM id,
       never by reaching into v55's own closure — same discipline v55's
       own header already documents for staying out of OTHER files'
       private state), else the raw local camera <video>.
       ========================================================================= */
    function _pickMimeType() {
        var candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/webm;codecs=h264,opus', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
        for (var i = 0; i < candidates.length; i++) {
            if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
        }
        /* 2026-11-08 FIX (record icon "still not working"): Android WebViews often report false for every explicit type above
           yet record fine with the engine's own default. Returning '' (not null) means "MediaRecorder exists, let it choose";
           only a missing MediaRecorder is a real "can't record" (null). */
        if (typeof MediaRecorder !== 'undefined') return '';
        return null;
    }
    // Extension point for v59's watermark compositor (defined later in
    // THIS SAME FILE — see v59's own §4 header note for why registering
    // an override function here, rather than v59 reaching into v57's
    // vars directly, is the chosen wiring: it keeps v57 loadable and
    // fully functional on its own even if v59 is stripped out before
    // the eventual v42 merge, since this array just stays empty).
    var _videoSourceOverrides = [];
    window._empV57RegisterVideoSourceOverride = function (fn) {
        if (typeof fn === 'function') _videoSourceOverrides.push(fn);
    };
    function _getVideoTrackForRecording() {
        // Ask every registered override first (highest-priority one is
        // whichever registered — currently only v59's watermark canvas
        // ever registers one, so this is a 0-or-1-entry list in
        // practice today).
        for (var i = 0; i < _videoSourceOverrides.length; i++) {
            var overrideCanvas = null;
            try { overrideCanvas = _videoSourceOverrides[i](); } catch (e) {}
            if (overrideCanvas && typeof overrideCanvas.captureStream === 'function') {
                try { var so = overrideCanvas.captureStream(30); var to = so.getVideoTracks()[0]; if (to) return to; } catch (eo) {}
            }
        }
        var canvas = document.getElementById('pv55-beauty-canvas-preview');
        if (canvas && typeof canvas.captureStream === 'function') {
            try { var s = canvas.captureStream(30); var t = s.getVideoTracks()[0]; if (t) return t; } catch (e) {}
        }
        var wrapper = document.getElementById('agora-local-video');
        var vEl = wrapper && wrapper.querySelector('video');
        if (vEl && typeof vEl.captureStream === 'function') {
            try { var s2 = vEl.captureStream(30); var t2 = s2.getVideoTracks()[0]; if (t2) return t2; } catch (e2) {}
        }
        // 2026-11-08: raw preview fallback (Agora camera track not connected yet)
        var rawV = document.getElementById('host-main-video');
        if (rawV && rawV.srcObject) {
            var rt = rawV.srcObject.getVideoTracks && rawV.srcObject.getVideoTracks()[0];
            if (rt && rt.readyState === 'live') return rt;
        }
        /* 2026-11-08 FIX (record icon): the host's own live camera track (exposed by app-live.js as window._empLiveHost, which
           also covers the held-camera custom-track path the element lookups above can miss), then any playing <video> on the
           live screen. */
        try {
            var _lh = window._empLiveHost, _lc = _lh && _lh.cam;
            var _lt = (_lc && typeof _lc.getMediaStreamTrack === 'function') ? _lc.getMediaStreamTrack() : null;
            if (_lt && _lt.readyState === 'live') return _lt;
        } catch (eLiveCam) {}
        try {
            var _vs = document.querySelectorAll('#live-stream-screen video');
            for (var vi = 0; vi < _vs.length; vi++) {
                var _v = _vs[vi];
                if (_v.srcObject && _v.srcObject.getVideoTracks) {
                    var _st = _v.srcObject.getVideoTracks()[0];
                    if (_st && _st.readyState === 'live') return _st;
                }
                if (typeof _v.captureStream === 'function' && _v.readyState >= 2) {
                    var _cs = _v.captureStream(); var _ct = _cs.getVideoTracks()[0];
                    if (_ct) return _ct;
                }
            }
        } catch (eAnyVid) {}
        return null;
    }

    /* =========================================================================
       §3 — recording lifecycle.
       ========================================================================= */
    var _rec = {
        active: false,
        cloud: false, // true when this recording is running via /api/agora-recording (§2b) rather than the local MediaRecorder below
        recorder: null,
        chunks: [],
        startedAt: null,
        mimeType: null,
        warnTimer: null,
        hardStopTimer: null
    };
    var LONG_RECORDING_WARN_MS = 20 * 60 * 1000; // 20 min — memory-usage heads-up
    var LONG_RECORDING_HARD_STOP_MS = 45 * 60 * 1000; // 45 min — hard safety cap; a
    // client-side MediaRecorder holds every chunk in page memory until
    // upload, so an unbounded recording is a real tab-crash risk on a
    // long stream — this cap exists for that reason alone, not a
    // product decision about replay length.

    /* 2026-11-08 FIX (recording never reached Home Replays): endLiveStreamHandler() (app-live-tiktok-patch.js) tears Agora down
       and sets liveStreamData.streamId = null / isLive = false BEFORE the recorder's onstop -> _finishRecording() runs, so the
       saved doc lost its streamId and could be keyed off a throw-away timestamp. The stream facts are frozen here at start. */
    function _snapshotRecMeta() {
        var sd = window.liveStreamData || {}, us = window.userState || {};
        _rec.meta = {
            streamId: sd.streamId || null,
            title: sd.title || '',
            hostId: us.id || null,
            hostName: us.fullName || us.username || 'Host',
            hostAvatar: us.avatar || ''
        };
    }

    function _updateRecordBtnUI() {
        var btn = document.getElementById('live-record-btn');
        if (!btn) return;
        btn.classList.toggle('recording', _rec.active);
        // 2026-11-08: icon-only so it matches every other rail button's size (was an icon + "Rec" label)
        btn.innerHTML = _rec.active ? '<i class="fas fa-stop" style="color:#ef4444"></i>' : '<i class="fas fa-circle" style="color:#ef4444"></i>';
        btn.title = _rec.active ? 'Stop Recording' : 'Start Recording';
    }

    /* =========================================================================
       §2b — Cloud Recording upgrade. Checked ONCE (server config doesn't
       change mid-session) via /api/config's recording.cloudAvailable flag
       (see server.js) — true only when a full Agora Customer ID/Secret +
       storage bucket are actually configured on the server. When it's
       false (the common case until those env vars are set), _rec.cloud
       never becomes true and every existing device-recording code path
       below runs completely unmodified — this is purely additive.
       ========================================================================= */
    var _cloudAvailable = null; // null = not checked yet, true/false once known
    (function _checkCloudAvailability() {
        // FIX (2026-08-02 — merge-time hardening): this call is invoked
        // synchronously at the top level of this IIFE. `fetch` is a
        // standard global in every real browser this app targets, so
        // this was never expected to throw in production — but this
        // file is one of several back-to-back top-level IIFEs sharing a
        // single script tag (same layout as V50→V51→V52→V53 in this
        // same file), and that exact layout is what turned one unguarded
        // reference into a silent script-wide abort in the previous
        // session (see V50's own fix note further up). Guarding this
        // one call costs nothing and closes off that entire failure
        // class here too, regardless of whether it would ever actually
        // fire.
        if (typeof fetch !== 'function') { _cloudAvailable = false; return; }
        try {
            fetch('/api/config').then(function (r) { return r.json(); }).then(function (cfg) {
                _cloudAvailable = !!(cfg && cfg.recording && cfg.recording.cloudAvailable);
                if (_cloudAvailable) log('server-side Cloud Recording available — recordings will composite every guest broadcaster, not just the host.');
            }).catch(function () { _cloudAvailable = false; });
        } catch (eFetch) {
            _cloudAvailable = false;
        }
    })();


    async function _startCloudRecording() {
        var channelName = window.liveStreamData && window.liveStreamData._agoraChannel;
        if (!channelName) { notify('Stream channel isn\u2019t ready yet — try again in a moment.', 'warning'); return false; }
        try {
            var res = await fetch('/api/agora-recording/start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channelName: channelName,
                    hostId: window.userState && window.userState.id,
                    hostName: window.userState && (window.userState.fullName || window.userState.username) || 'Host',
                    hostAvatar: window.userState && window.userState.avatar || '',
                    title: (window.liveStreamData && window.liveStreamData.title) || 'Live stream',
                    streamId: window.liveStreamData && window.liveStreamData.streamId
                })
            });
            var data = await res.json();
            if (!res.ok || !data.recording) throw new Error(data.error || 'server declined to start recording');
            return true;
        } catch (e) {
            warn('cloud recording start failed, falling back to device recording: ' + (e && e.message));
            return false;
        }
    }
    async function _stopCloudRecording() {
        var channelName = window.liveStreamData && window.liveStreamData._agoraChannel;
        if (!channelName) return;
        try {
            var res = await fetch('/api/agora-recording/stop', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channelName: channelName })
            });
            var data = await res.json();
            if (data.savedToReplays) notify('\uD83D\uDCFC Replay saved — this one includes every guest who was on with you.', 'success');
            else notify('Recording stopped, but couldn\u2019t be saved — check server logs (RECORDING_PUBLIC_BASE_URL may be unset).', 'warning');
        } catch (e) {
            warn('cloud recording stop failed: ' + (e && e.message));
            notify('Couldn\u2019t confirm the recording stopped cleanly — check Replays in a moment.', 'warning');
        }
    }

    function _startRecording() {
        if (_rec.active) return;
        if (!isRealHost()) { notify('Only the host can record this stream.', 'warning'); return; }
        if (!isCurrentlyLive()) { notify('Go live first, then start recording.', 'warning'); return; }

        // Cloud path takes priority when available — it's a strict upgrade
        // (composites every guest broadcaster, survives a page close,
        // doesn't hold anything in this tab's memory). Falls through to
        // the existing device-recording code below on any failure, same
        // "never leave the host with nothing" discipline the rest of this
        // patch file already follows for its own AgoraRTC-availability
        // checks.
        if (_cloudAvailable) {
            _rec.active = true; // set optimistically so a second tap while the request is in flight is treated as "already recording", not a second start
            _rec.cloud = true;
            _rec.startedAt = Date.now();
            _snapshotRecMeta(); // 2026-11-08: freeze streamId/title now -- End Live nulls liveStreamData.streamId before the upload runs
            if (window.liveStreamData) window.liveStreamData.isRecording = true;
            if (typeof window.updateLiveUI === 'function') window.updateLiveUI();
            _updateRecordBtnUI();
            _startCloudRecording().then(function (ok) {
                if (ok) {
                    notify('\uD83D\uDD34 Cloud recording started — every guest broadcaster will be included in the replay.', 'success');
                } else {
                    // Roll the optimistic state back and retry through the
                    // device path instead of leaving the button stuck in a
                    // "recording" state for a recording that never started.
                    _rec.active = false; _rec.cloud = false;
                    if (window.liveStreamData) window.liveStreamData.isRecording = false;
                    _updateRecordBtnUI();
                    _startDeviceRecording();
                }
            });
            return;
        }
        _startDeviceRecording();
    }

    // Renamed from the original _startRecording body — see §2b above for
    // why this is now reached via a fallback rather than being the only
    // path. Logic itself is completely unchanged from before this upgrade.
    function _startDeviceRecording() {
        var mt = _pickMimeType();
        if (mt === null) { notify('This browser can\u2019t record video locally — try a recent Chrome/Edge/Firefox.', 'error'); return; }
        var videoTrack = _getVideoTrackForRecording();
        if (!videoTrack) { notify('Camera preview isn\u2019t ready yet — try again in a moment.', 'warning'); return; }
        var tracks = [videoTrack];
        var audioTrack = (_rawMicTrack && typeof _rawMicTrack.getMediaStreamTrack === 'function') ? _rawMicTrack.getMediaStreamTrack() : null;
        /* 2026-11-08 FIX (record icon): held-camera path builds the mic with createCustomAudioTrack, which the v57 wrapper never
           saw; adopt the live host's own mic so the replay has sound. */
        if (!audioTrack) { try { var _lm = window._empLiveHost && window._empLiveHost.mic; if (_lm && typeof _lm.getMediaStreamTrack === 'function') audioTrack = _lm.getMediaStreamTrack(); } catch (eLm) {} }
        if (audioTrack) tracks.push(audioTrack);

        var combined;
        try { combined = new MediaStream(tracks); } catch (e) { notify('Could not start recording: ' + (e && e.message), 'error'); return; }

        try { _rec.recorder = mt ? new MediaRecorder(combined, { mimeType: mt }) : new MediaRecorder(combined); }
        catch (e) { notify('Could not start recording: ' + (e && e.message), 'error'); return; }
        if (!mt) mt = (_rec.recorder && _rec.recorder.mimeType) || 'video/webm';

        /* 2026-11-08 (one button = start AND stop, any number of times, live keeps running): every recording gets its OWN chunk
           list / start time / meta / mime, bound to its own recorder. Stopping and instantly starting again can no longer wipe the
           previous segment's chunks before its onstop fires, and each segment is saved as its own replay. The live stream itself
           is never touched by start/stop -- only End Live (or the 45-min cap) ends a recording on its own. */
        var _seg = { chunks: [], startedAt: Date.now(), meta: null, mime: mt };
        _rec.chunks = _seg.chunks;
        _rec.cloud = false;
        _rec.recorder.ondataavailable = function (e) { if (e.data && e.data.size > 0) _seg.chunks.push(e.data); };
        _rec.recorder.onstop = function () { _seg.meta = _seg.meta || _rec.meta; _finishRecording(_seg); };
        _rec.recorder.start(1000); // 1s timeslice — same periodic-flush discipline v55's ambient/beauty pipelines use for their own long-running work, so a crash mid-stream loses at most ~1s, not the whole recording
        _rec.active = true;
        _rec.startedAt = Date.now();
        _snapshotRecMeta(); // 2026-11-08: freeze streamId/title now -- End Live nulls liveStreamData.streamId before the upload runs
        _seg.meta = _rec.meta; _seg.startedAt = _rec.startedAt;
        _rec.mimeType = mt;
        if (window.liveStreamData) window.liveStreamData.isRecording = true;
        if (typeof window.updateLiveUI === 'function') window.updateLiveUI();
        _updateRecordBtnUI();
        notify('\uD83D\uDD34 Recording started — this replay will be saved for playback after the stream ends.', 'success');

        _rec.warnTimer = setTimeout(function () {
            if (_rec.active) notify('This recording is getting long — it\u2019ll keep going, just know it\u2019s using more memory the longer it runs.', 'info');
        }, LONG_RECORDING_WARN_MS);
        _rec.hardStopTimer = setTimeout(function () {
            if (_rec.active) { notify('Recording hit the 45-minute safety limit and has been stopped/saved automatically.', 'info'); _stopRecording(); }
        }, LONG_RECORDING_HARD_STOP_MS);
    }

    function _stopRecording() {
        if (!_rec.active) return;
        clearTimeout(_rec.warnTimer); clearTimeout(_rec.hardStopTimer);
        var wasCloud = _rec.cloud;
        _rec.active = false;
        _rec.cloud = false;
        if (window.liveStreamData) window.liveStreamData.isRecording = false;
        if (typeof window.updateLiveUI === 'function') window.updateLiveUI();
        _updateRecordBtnUI();
        if (wasCloud) { _stopCloudRecording(); return; } // no local recorder exists for the cloud path — nothing to .stop()
        try { if (_rec.recorder && _rec.recorder.state !== 'inactive') _rec.recorder.stop(); }
        catch (e) { warn('recorder.stop() failed: ' + (e && e.message)); }
    }

    // 2026-11-08: superseded by the local-first _finishRecording below (kept for reference, unused)
    async function _finishRecordingPrev(seg) {
        seg = seg || { chunks: _rec.chunks, startedAt: _rec.startedAt, meta: _rec.meta, mime: _rec.mimeType };
        var blob = new Blob(seg.chunks, { type: (seg.mime || 'video/webm').split(';')[0] });
        if (!blob.size) { warn('recording produced 0 bytes — nothing to upload.'); return; }
        var durationSec = seg.startedAt ? Math.round((Date.now() - seg.startedAt) / 1000) : null;
        /* 2026-11-08: meta frozen at record start (see _snapshotRecMeta); falls back to live values only if it is missing. */
        var meta = seg.meta || {};
        var us = window.userState || {};
        var sid = meta.streamId || (window.liveStreamData && window.liveStreamData.streamId) || String(Date.now());
        var hostId = meta.hostId || us.id;
        var title = meta.title || ((meta.hostName || us.fullName || 'Live') + '\u2019s stream');
        notify('Uploading your replay\u2026 this can take a moment depending on length.', 'info');
        /* 2026-11-08: up to 3 attempts (a weak connection used to lose the whole recording on the first hiccup); the blob is
           kept in window._empPendingReplay until the stream_replays doc is actually written. */
        var pending = { blob: blob, sid: sid }; window._empPendingReplay = pending; // per-call copy below so a 2nd recording can't clobber this one's retry state
        var lastErr = null;
        for (var attempt = 1; attempt <= 3; attempt++) {
            try {
                var file = new File([blob], 'replay-' + sid + (/mp4/i.test(blob.type) ? '.mp4' : '.webm'), { type: blob.type });
                if (typeof window.uploadToCloudinary !== 'function') throw new Error('upload helper unavailable');
                var url = pending.url || await window.uploadToCloudinary(file);
                if (!url) throw new Error('no URL returned from upload');
                pending.url = url; // upload done -- a retry only needs to redo the doc write

                var db = window.fbDb;
                if (!(db && window._firebaseLoaded && hostId)) throw new Error('not connected to your account yet');
                var replayId = 'replay_' + sid + '_' + (seg.startedAt || Date.now()); // 2026-11-08: was 'replay_'+sid -- a 2nd recording in the same stream overwrote the 1st
                await db.collection('stream_replays').doc(replayId).set({
                    id: replayId,
                    streamId: meta.streamId || (window.liveStreamData && window.liveStreamData.streamId) || null,
                    hostId: hostId,
                    hostName: meta.hostName || us.fullName || us.username || 'Host',
                    hostAvatar: meta.hostAvatar || us.avatar || '',
                    title: title,
                    videoUrl: url,
                    durationSec: durationSec,
                    createdAt: new Date().toISOString(),
                    views: 0
                });
                if (window._empPendingReplay === pending) window._empPendingReplay = null;
                notify('\uD83D\uDCFC Replay saved — anyone can watch it from Replays anytime.', 'success');
                try { _homeReplaysSig = ''; _homeReplaysBusy = false; _loadHomeReplays(true); } catch (_hrErr) {} // 2026-11-08: show it on Home right away
                return;
            } catch (e) {
                lastErr = e;
                warn('replay upload/save attempt ' + attempt + ' failed: ' + (e && e.message));
                if (attempt < 3) await new Promise(function (r) { setTimeout(r, attempt * 3000); });
            }
        }
        notify('Couldn\u2019t save this replay: ' + (lastErr && lastErr.message ? lastErr.message : 'please try again next time.'), 'error');
    }

    async function _finishRecording(seg) {
        seg = seg || { chunks: _rec.chunks, startedAt: _rec.startedAt, meta: _rec.meta, mime: _rec.mimeType };
        var blob = new Blob(seg.chunks, { type: (seg.mime || 'video/webm').split(';')[0] });
        if (!blob.size) { warn('recording produced 0 bytes — nothing to upload.'); return; }
        var durationSec = seg.startedAt ? Math.round((Date.now() - seg.startedAt) / 1000) : null;
        var meta = seg.meta || {};
        var us = window.userState || {};
        var sid = meta.streamId || (window.liveStreamData && window.liveStreamData.streamId) || String(Date.now());
        var hostId = meta.hostId || us.id;
        var title = meta.title || ((meta.hostName || us.fullName || 'Live') + '\u2019s stream');
        notify('Uploading your replay\u2026 this can take a moment depending on length.', 'info');
        var lastErr = null, url = null;
        for (var attempt = 1; attempt <= 3 && !url; attempt++) {
            try {
                var file = new File([blob], 'replay-' + sid + (/mp4/i.test(blob.type) ? '.mp4' : '.webm'), { type: blob.type });
                if (typeof window.uploadToCloudinary !== 'function') throw new Error('upload helper unavailable');
                url = await window.uploadToCloudinary(file);
                if (!url) throw new Error('no URL returned from upload');
            } catch (e) {
                lastErr = e; url = null;
                warn('replay upload attempt ' + attempt + ' failed: ' + (e && e.message));
                if (attempt < 3) await new Promise(function (r) { setTimeout(r, attempt * 3000); });
            }
        }
        if (!url) { notify('Couldn\u2019t save this replay: ' + (lastErr && lastErr.message ? lastErr.message : 'please try again next time.'), 'error'); return; }
        /* The video is now permanently stored. Record it LOCALLY first (instant, no network) so it shows on Home and in
           Replays immediately, then let _syncPendingReplays() push the public stream_replays doc in the background. */
        var replayId = 'replay_' + sid + '_' + (seg.startedAt || Date.now());
        _localAdd({
            id: replayId,
            streamId: meta.streamId || (window.liveStreamData && window.liveStreamData.streamId) || null,
            hostId: hostId || null,
            hostName: meta.hostName || us.fullName || us.username || 'Host',
            hostAvatar: meta.hostAvatar || us.avatar || '',
            title: title,
            videoUrl: url,
            durationSec: durationSec,
            createdAt: new Date().toISOString(),
            views: 0,
            synced: false
        });
        notify('\uD83D\uDCFC Replay saved — it\u2019s on your Home page now and will be shared with everyone as soon as your connection allows.', 'success');
        try { _homeReplaysSig = ''; _homeReplaysBusy = false; _loadHomeReplays(true); } catch (_hrErr) {}
        _lastSyncAt = Date.now();
        _syncPendingReplays();
    }

    // Auto-stop + flush if the stream ends while still recording (host
    // taps "End Live", connection drops, etc.) — same "tear down when
    // the ready-state flips false" discipline as v55's own §6.
    var _wasLive = false;
    function _watchLiveEnd() {
        var live = isCurrentlyLive();
        if (_wasLive && !live && _rec.active) _stopRecording();
        _wasLive = live;

    }

    /* =========================================================================
       §4 — neutralize app-fixes.js's two existing #live-record-btn
       handlers (capture phase — see header for why this is safe/precedented)
       and wire this file's own start/stop.
       ========================================================================= */
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        var btn = e.target.closest('#live-record-btn');
        if (!btn) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (!isRealHost()) { notify('Only the host can record this stream.', 'warning'); return; }
        if (_rec.active) _stopRecording(); else _startRecording();
    }, true /* capture phase — must win the race against app-fixes.js's bubble-phase handlers */);

    /* 2026-11-08 FIX (recording never reached Home Replays): End Live / the x close button tear the camera + mic tracks down
       first, so the recorder died mid-teardown and the upload often never ran. A capture-phase tap on either now stops the
       recorder cleanly FIRST (its final chunk is flushed, then _finishRecording uploads + writes the stream_replays doc), and
       the original handlers still run untouched right after. */
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        if (!e.target.closest('#tk-end-live-btn, #live-close-btn')) return;
        if (_rec.active && isRealHost()) { try { _stopRecording(); } catch (eStop) { warn('pre-end stop failed: ' + (eStop && eStop.message)); } }
    }, true);

    // 2026-11-08: direct entry point for the footer Record button (v59). It used to click the hidden #live-record-btn and
    // rely on the capture handler above; calling the same start/stop logic directly removes that indirection.
    window._empToggleStreamRecording = function () {
        if (!isRealHost()) { notify('Only the host can record this stream.', 'warning'); return; }
        if (_rec.active) _stopRecording(); else _startRecording();
    };

    /* =========================================================================
       §5 — REPLAY BROWSING / PLAYBACK. A small floating "Replays" launcher
       (own id/CSS, fixed-position, hidden while a live stream is open so
       it never competes with the live-view UI) plus a lightweight, own
       list+player modal. Global/public feed (read: true, per the rule
       above) mirrors this app's existing public-marketplace-listing
       model — nothing here is DM/private.
       ========================================================================= */
    (function injectCSS() {
        if (document.getElementById('pv57-css')) return;
        var css = document.createElement('style');
        css.id = 'pv57-css';
        css.textContent =
            '#pv57-float-btn{position:fixed;right:16px;bottom:86px;width:52px;height:52px;border-radius:50%;background:linear-gradient(145deg,rgba(46,46,52,0.9),rgba(16,16,20,0.95));border:1px solid rgba(255,255,255,0.12);box-shadow:0 4px 14px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;z-index:900;cursor:pointer;touch-action:none;user-select:none;}' +
            '#pv57-float-btn:active{transform:scale(0.93);}' +
            /* FIX (dashboard clash follow-up, round 2 \u2014 button still
               overlapping other fixed controls at its default corner on
               some layouts): rather than chase every possible overlap by
               retuning coordinates again, the button is now draggable \u2014
               see _makeDraggable() below. While actively being dragged it
               gets a slightly lifted look and no transition, so it tracks
               the finger/cursor with zero lag instead of animating toward
               it late. */
            '#pv57-float-btn.pv57-dragging{transition:none!important;opacity:0.88;box-shadow:0 10px 26px rgba(0,0,0,0.55);cursor:grabbing;}' +
            '#pv57-replays-modal{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:100002;display:none;align-items:flex-end;justify-content:center;}' +
            '#pv57-replays-modal.show{display:flex;}' +
            '#pv57-replays-sheet{width:100%;max-width:520px;max-height:82vh;min-height:34vh;background:#161618;border-radius:18px 18px 0 0;padding:14px 14px calc(18px + env(safe-area-inset-bottom,0px));overflow-y:auto;-webkit-overflow-scrolling:touch;}' +
            /* FIX (2026-11-08): the sheet sat at z-index 2000, UNDER the bottom nav and the Quick Post / Help FABs, so the list was hidden behind them and only a sliver ("Loading replays…") showed. It now layers above everything, and those FABs hide while it is open. */
            'body.pv57-replays-open #pv57-float-btn,body.pv57-replays-open #quick-post-fab,body.pv57-replays-open #emp-help-fab,body.pv57-replays-open #submit-complaint-fab{display:none!important;}' +
            '.pv57-replay-thumb{position:relative;overflow:hidden;}' +
            '.pv57-replay-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}' +
            '.pv57-replay-thumb i{position:relative;z-index:1;text-shadow:0 1px 4px rgba(0,0,0,0.7);}' +
            '#pv57-retry{margin-top:8px;padding:8px 18px;border-radius:999px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.08);color:#fff;font-weight:700;cursor:pointer;}' +
            '.pv57-replay-row{display:flex;align-items:center;gap:10px;padding:8px;border-radius:10px;cursor:pointer;margin-bottom:6px;background:rgba(255,255,255,0.04);}' +
            '.pv57-replay-row:active{transform:scale(0.98);}' +
            '.pv57-replay-thumb{width:56px;height:56px;border-radius:10px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;color:#f5a623;flex-shrink:0;}' +
            '.pv57-replay-meta{display:flex;flex-direction:column;min-width:0;flex:1;}' +
            '.pv57-replay-meta strong{color:#fff;font-size:var(--text-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.pv57-replay-meta span{color:#aaa;font-size:var(--text-xs);}' +
            '#pv57-player-modal{position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:100003;display:none;align-items:center;justify-content:center;flex-direction:column;}' +
            '#pv57-player-modal.show{display:flex;}' +
            '#pv57-player-modal video{width:100%;max-width:520px;max-height:70vh;background:#000;}' +
            '#pv57-player-close{position:absolute;top:16px;right:16px;color:#fff;font-size:28px;background:none;border:none;cursor:pointer;}' +
            /* 2026-11-08: Home "Recorded Livestreams" card thumbnails (public, from stream_replays) */
            '.pv57-home-card{flex:0 0 168px;width:168px;border-radius:16px;overflow:hidden;background:#0f1433;border:1px solid rgba(245,197,24,0.22);box-shadow:0 4px 16px rgba(10,14,39,0.28);cursor:pointer;display:flex;flex-direction:column;scroll-snap-align:start;}' +
            '.pv57-home-card:active{transform:scale(0.97);}' +
            '.pv57-hc-thumb{position:relative;width:100%;aspect-ratio:3/4;background:linear-gradient(160deg,#1b2260,#0a0e27);overflow:hidden;}' +
            '.pv57-hc-thumb img.pv57-hc-poster,.pv57-hc-thumb video.pv57-hc-poster{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;background:#0a0e27;}' +
            '.pv57-hc-thumb:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0.30) 0%,rgba(0,0,0,0) 32%,rgba(0,0,0,0) 55%,rgba(5,8,28,0.88) 100%);pointer-events:none;}' +
            '.pv57-hc-badge{position:absolute;top:8px;left:8px;z-index:2;background:#e5194f;color:#fff;font-size:9px;font-weight:800;letter-spacing:.6px;padding:3px 7px;border-radius:6px;}' +
            '.pv57-hc-dur{position:absolute;top:8px;right:8px;z-index:2;background:rgba(0,0,0,0.55);color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;}' +
            '.pv57-hc-play{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);z-index:2;width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,0.22);border:1px solid rgba(255,255,255,0.45);display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;}' +
            '.pv57-hc-del{position:absolute;right:8px;bottom:8px;z-index:4;width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,0.35);background:rgba(0,0,0,0.6);color:#fff;font-size:13px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;}' +
            '.pv57-hc-del:active{transform:scale(0.9);background:#e5194f;}' +
            '.pv57-hc-views{position:absolute;left:8px;bottom:8px;z-index:2;color:#fff;font-size:11px;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,0.7);}' +
            '.pv57-hc-info{padding:8px 10px 10px;display:flex;flex-direction:column;gap:5px;}' +
            '.pv57-hc-title{color:#fff;font-size:12px;font-weight:700;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}' +
            '.pv57-hc-host{display:flex;align-items:center;gap:6px;color:#aab2e6;font-size:11px;min-width:0;}' +
            '.pv57-hc-host img{width:18px;height:18px;border-radius:50%;object-fit:cover;flex-shrink:0;background:#2a3170;}' +
            '.pv57-hc-host span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            /* 2026-11-08: Stream Replays overlay = 2-column thumbnail grid + sort chips */
            '.pv57-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}' +
            '.pv57-grid .pv57-home-card{flex:none;width:auto;}' +
            '.pv57-chips{display:flex;gap:8px;margin-bottom:12px;}' +
            '.pv57-chip{font-size:12px;padding:5px 13px;border-radius:999px;border:1px solid #3a3f6b;background:none;color:#aab2e6;cursor:pointer;}' +
            '.pv57-chip.on{background:#f5c518;border-color:#f5c518;color:#2a2000;font-weight:700;}';
        document.head.appendChild(css);
    })();

    /* =========================================================================
       MOVEABLE BUTTON — lets the person drag #pv57-float-btn anywhere on
       screen so it can never sit permanently on top of another fixed
       control again (quick-post FAB, help center, report button, a
       marketplace card price, etc. \u2014 whatever happens to be under its
       default corner on a given screen). Position is remembered across
       reloads via localStorage and re-clamped on resize/rotation so it
       can never end up dragged partly off-screen.
       ========================================================================= */
    var DRAG_POS_KEY = 'empyrean_pv57_float_btn_pos';

    function _loadSavedPos() {
        try {
            var raw = localStorage.getItem(DRAG_POS_KEY);
            if (!raw) return null;
            var pos = JSON.parse(raw);
            if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') return pos;
        } catch (e) {}
        return null;
    }
    function _savePos(left, top) {
        try { localStorage.setItem(DRAG_POS_KEY, JSON.stringify({ left: left, top: top })); } catch (e) {}
    }
    function _clamp(left, top, size) {
        var w = window.innerWidth, h = window.innerHeight;
        return {
            left: Math.min(Math.max(left, 4), Math.max(4, w - size - 4)),
            top:  Math.min(Math.max(top, 4), Math.max(4, h - size - 4))
        };
    }
    function _applySavedPos(btn) {
        var pos = _loadSavedPos();
        if (!pos) return; // no saved position yet \u2014 keep the default right/bottom corner from CSS
        var c = _clamp(pos.left, pos.top, btn.offsetWidth || 52);
        btn.style.left = c.left + 'px';
        btn.style.top = c.top + 'px';
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
    }
    function _reclampOnResize() {
        var btn = document.getElementById('pv57-float-btn');
        if (!btn || btn.style.left === '') return; // still sitting at the default corner \u2014 CSS keeps that in-bounds already
        var c = _clamp(parseFloat(btn.style.left) || 0, parseFloat(btn.style.top) || 0, btn.offsetWidth || 52);
        btn.style.left = c.left + 'px';
        btn.style.top = c.top + 'px';
    }
    window.addEventListener('resize', _reclampOnResize);

    // A tap (no meaningful pointer movement) still opens Replays exactly as
    // before; only a real drag (movement past DRAG_THRESHOLD) repositions
    // the button and suppresses the click that would otherwise fire right
    // after mouseup/touchend, so dragging never ALSO opens the Replays
    // sheet.
    function _makeDraggable(btn) {
        if (btn._pv57DragWired) return;
        btn._pv57DragWired = true;

        var DRAG_THRESHOLD = 8;
        var dragging = false, moved = false;
        var startX = 0, startY = 0, startLeft = 0, startTop = 0;

        function toXY(e) {
            if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            return { x: e.clientX, y: e.clientY };
        }

        function onDown(e) {
            var p = toXY(e);
            dragging = true; moved = false;
            startX = p.x; startY = p.y;
            var rect = btn.getBoundingClientRect();
            startLeft = rect.left; startTop = rect.top;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onUp);
        }

        function onMove(e) {
            if (!dragging) return;
            var p = toXY(e);
            var dx = p.x - startX, dy = p.y - startY;
            if (!moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
                moved = true;
                btn.classList.add('pv57-dragging');
            }
            if (!moved) return;
            if (e.cancelable) e.preventDefault(); // stop the page from scrolling while dragging on touch

            var c = _clamp(startLeft + dx, startTop + dy, btn.offsetWidth || 52);
            btn.style.left = c.left + 'px';
            btn.style.top = c.top + 'px';
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
        }

        function onUp() {
            if (!dragging) return;
            dragging = false;
            btn.classList.remove('pv57-dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);

            if (moved) {
                var rect = btn.getBoundingClientRect();
                _savePos(rect.left, rect.top);
                btn._pv57SuppressClick = true;
                setTimeout(function () { btn._pv57SuppressClick = false; }, 50);
            }
        }

        btn.addEventListener('mousedown', onDown);
        btn.addEventListener('touchstart', onDown, { passive: true });
    }

    function _ensureFloatBtn() {
        if (document.getElementById('pv57-float-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'pv57-float-btn';
        btn.type = 'button';
        btn.title = 'Stream Replays \u2014 press and drag to move';
        btn.innerHTML = '<i class="fas fa-clapperboard"></i>';
        document.body.appendChild(btn);
        _applySavedPos(btn);
        _makeDraggable(btn);
        btn.addEventListener('click', function (e) {
            if (btn._pv57SuppressClick) { e.preventDefault(); e.stopPropagation(); return; }
            _openReplaysList(e);
        });
    }
    // FIX (dashboard clash — "replay button clashing with Quick Post,
    // Help Center, Report"): this used to only hide the button while the
    // live-stream screen was open, so document.body.appendChild placed it
    // fixed at right:16px/bottom:86px on EVERY section — dashboard,
    // marketplace, chat, settings, all of them — competing for the same
    // corner as #quick-post-fab and #emp-help-fab (self-help-assistance-
    // center.js) on every screen instead of just the one it's meant for.
    // Scoped to the home dashboard only, per this session's explicit ask
    // ("replay button only displays on the home screen"). Checks the
    // actual DOM state of #dashboard rather than caching the last
    // 'empyrean-section-change' event, so it stays correct even if this
    // poll tick runs before that listener ever fires (first load).
    function _onDashboard() {
        var dash = document.getElementById('dashboard');
        return !!(dash && dash.classList.contains('active'));
    }
    function _floatBtnVisibility() {
        var btn = document.getElementById('pv57-float-btn');
        if (!btn) return;
        var liveScreen = document.getElementById('live-stream-screen');
        var liveOpen = liveScreen && (liveScreen.classList.contains('active') || liveScreen.classList.contains('show') || liveScreen.style.display === 'flex' || liveScreen.style.display === 'block');
        btn.style.display = (!liveOpen && _onDashboard()) ? 'flex' : 'none';
    }

    function _ensureModals() {
        if (!document.getElementById('pv57-replays-modal')) {
            var m = document.createElement('div');
            m.id = 'pv57-replays-modal';
            m.innerHTML =
                '<div id="pv57-replays-sheet">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
                '<h3 style="margin:0;color:#fff;">\uD83D\uDCFC Stream Replays</h3>' +
                '<button type="button" id="pv57-replays-close" style="background:none;border:none;color:#fff;font-size:24px;cursor:pointer;">\u00d7</button>' +
                '</div>' +
                '<div id="pv57-replays-list"></div>' +
                '</div>';
            document.body.appendChild(m);
            m.addEventListener('click', function (e) { if (e.target === m) _closeReplays(); });
            m.querySelector('#pv57-replays-close').addEventListener('click', _closeReplays);
            m.querySelector('#pv57-replays-list').addEventListener('click', function (e) {
                if (e.target.closest('#pv57-retry')) { _openReplaysList(); return; }
                var _chip = e.target.closest('[data-pv57-sort]');
                if (_chip) { _renderReplaySheet(_chip.getAttribute('data-pv57-sort')); return; }
                var row = e.target.closest('[data-pv57-replay]');
                if (row && !row.classList.contains('pv57-home-card')) _playReplay(row.getAttribute('data-pv57-replay'), row.getAttribute('data-pv57-url')); // cards are handled by the document-level handler (avoids a double play/view count)
            });
        }
        if (!document.getElementById('pv57-player-modal')) {
            var p = document.createElement('div');
            p.id = 'pv57-player-modal';
            p.innerHTML = '<button type="button" id="pv57-player-close"><i class="fas fa-times"></i></button><video id="pv57-player-video" controls playsinline></video>';
            document.body.appendChild(p);
            p.querySelector('#pv57-player-close').addEventListener('click', _closePlayer);
        }
    }

    function _closeReplays() {
        var m = document.getElementById('pv57-replays-modal');
        if (m) m.classList.remove('show');
        document.body.classList.remove('pv57-replays-open');
    }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') _closeReplays(); });
    var RETRY_HTML = '<button type="button" id="pv57-retry">Try again</button>';
    /* Cloudinary can serve a frame of any hosted video as a JPG — used as the row thumbnail. Non-Cloudinary URLs just keep the play icon. */
    function _posterFor(url) {
        if (!url || url.indexOf('/video/upload/') === -1) return '';
        return url.replace('/video/upload/', '/video/upload/so_0,w_160,h_160,c_fill/').replace(/\.[a-z0-9]+(\?.*)?$/i, '.jpg');
    }
    /* 2026-11-08 FIX (\"Couldn't load replays right now\" / stuck on \"Loading replays…\"): one shared, resilient reader for
       stream_replays. (1) newest-first query with a timeout; (2) if that fails or hangs, the same collection WITHOUT orderBy
       (orderBy silently drops any doc that has no createdAt, e.g. one written by the server-side recorder) sorted here;
       (3) last resort, whatever the local cache holds. A permission error is rethrown so the sheet can still say so. */
    /* =========================================================================
       2026-11-08 — LOCAL-FIRST REPLAYS (console proof: the video upload to Firebase Storage succeeds, but every Firestore call
       on this connection times out -- the stream_replays write is never acknowledged and the list read never returns, so the
       Replays sheet and the Home card stayed empty). Fix: (1) the moment the upload succeeds the replay is stored on THIS device
       and shown at once; (2) the Firestore write is retried in the background until it lands (that is what makes it visible to
       everyone else); (3) the last good public list is cached and shown instantly while a fresh one loads.
       ========================================================================= */
    var LOCAL_KEY = 'emp_v57_local_replays', CACHE_KEY = 'emp_v57_replay_cache';
    function _lsRead(key) { try { var a = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function _lsWrite(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {} }
    function _localAdd(rec) {
        var a = _lsRead(LOCAL_KEY).filter(function (x) { return x && x.id !== rec.id; });
        a.unshift(rec);
        _lsWrite(LOCAL_KEY, a.slice(0, 30));
    }
    function _localPatch(id, patch) {
        var a = _lsRead(LOCAL_KEY);
        a.forEach(function (x) { if (x && x.id === id) Object.keys(patch).forEach(function (k) { x[k] = patch[k]; }); });
        _lsWrite(LOCAL_KEY, a);
    }
    function _lsRows() { return _lsRead(LOCAL_KEY).filter(function (x) { return x && x.id && x.videoUrl; }).map(function (x) { return { id: x.id, r: x }; }); }
    function _cacheRows() { return _lsRead(CACHE_KEY).filter(function (x) { return x && x.id && x.r && x.r.videoUrl; }); }
    // first list wins on a duplicate id: pass (remote, local, cache) so the server copy beats this device's copy, which beats the stale cache
    function _mergeRows() {
        var seen = {}, out = [];
        for (var i = 0; i < arguments.length; i++) {
            (arguments[i] || []).forEach(function (x) { if (x && x.id && !seen[x.id] && !_isDeleted(x.id)) { seen[x.id] = 1; out.push(x); } });
        }
        out.sort(function (a, b) { return _replayTime(b.r) - _replayTime(a.r); });
        return out;
    }
    function _immediateRows() { return _mergeRows(_lsRows(), _cacheRows()); }

    /* =========================================================================
       2026-11-08 — DELETE A REPLAY. A trash button sits on every replay card (Home slider + Replays sheet) for the host who
       recorded it (and admins). It removes the card at once, forgets the copy kept on this device, deletes the public
       stream_replays doc, and makes a best-effort delete of the stored video file. If the connection is too weak to confirm
       the server delete right now, the id is remembered and retried in the background, and it is hidden from every list
       on this device in the meantime.
       ========================================================================= */
    var DEL_KEY = 'emp_v57_deleted_replays';
    function _deletedList() { return _lsRead(DEL_KEY).filter(function (x) { return x && x.id; }); }
    function _isDeleted(id) { return _deletedList().some(function (x) { return x.id === id; }); }
    function _canDeleteReplay(r) {
        var me = window.userState;
        if (!me || window.isGuest) return false;
        return !!((r && r.hostId && r.hostId === me.id) || window.isAdmin === true);
    }
    function _delBtnHtml(r, id) {
        return _canDeleteReplay(r) ? '<button type="button" class="pv57-hc-del" data-pv57-del="' + esc(id) + '" title="Delete replay" aria-label="Delete replay"><i class="fas fa-trash"></i></button>' : '';
    }
    async function _deleteReplayRemote(id, url) {
        var db = window.fbDb;
        if (!db || !window._firebaseLoaded) return false;
        try {
            await _withTimeoutP(db.collection('stream_replays').doc(id).delete(), 20000);
        } catch (e) {
            if (e && /permission|insufficient/i.test(e.message || '')) { notify('The server refused to delete this replay (permission) — it is hidden on this device only.', 'warning'); return true; }
            return false; // timed out / offline: keep it queued
        }
        try { // best effort: free the stored video too (storage rules may refuse -- that is fine)
            if (url && window.firebase && window.firebase.storage) await _withTimeoutP(window.firebase.storage().refFromURL(url).delete(), 15000);
        } catch (eSt) {}
        return true;
    }
    var _delBusy = false;
    async function _syncPendingDeletes() {
        if (_delBusy) return;
        var list = _deletedList();
        if (!list.length || !window.fbDb || !window._firebaseLoaded) return;
        _delBusy = true;
        try {
            for (var i = 0; i < list.length; i++) {
                if (await _deleteReplayRemote(list[i].id, list[i].url)) {
                    _lsWrite(DEL_KEY, _deletedList().filter(function (x) { return x.id !== list[i].id; }));
                }
            }
        } finally { _delBusy = false; }
    }
    document.addEventListener('click', function (e) {
        var b = e.target && e.target.closest && e.target.closest('[data-pv57-del]');
        if (!b) return;
        e.stopImmediatePropagation(); e.preventDefault(); // never also opens the player
        var id = b.getAttribute('data-pv57-del');
        var card = b.closest('.pv57-home-card');
        var url = card ? card.getAttribute('data-pv57-url') : '';
        if (!window.confirm('Delete this replay? This can\u2019t be undone.')) return;
        var dl = _deletedList(); dl.push({ id: id, url: url }); _lsWrite(DEL_KEY, dl);
        _lsWrite(LOCAL_KEY, _lsRead(LOCAL_KEY).filter(function (x) { return x && x.id !== id; }));
        _lsWrite(CACHE_KEY, _lsRead(CACHE_KEY).filter(function (x) { return x && x.id !== id; }));
        _sheetRows = _sheetRows.filter(function (x) { return x.id !== id; });
        document.querySelectorAll('.pv57-home-card').forEach(function (c) { if (c.getAttribute('data-pv57-replay') === id) c.remove(); });
        _homeReplaysSig = '';
        notify('Replay deleted.', 'success');
        _syncPendingDeletes();
    }, true);



    var _syncBusy = false, _lastSyncAt = 0;
    async function _syncPendingReplays() {
        var db = window.fbDb, me = window.userState;
        if (_syncBusy || !db || !window._firebaseLoaded || !me) return;
        var todo = _lsRead(LOCAL_KEY).filter(function (x) { return x && !x.synced && !x.denied && x.hostId === me.id; });
        if (!todo.length) return;
        _syncBusy = true;
        try {
            for (var i = 0; i < todo.length; i++) {
                var rec = todo[i], docData = {};
                Object.keys(rec).forEach(function (k) { if (k !== 'synced' && k !== 'denied') docData[k] = rec[k]; });
                try {
                    await _withTimeoutP(db.collection('stream_replays').doc(rec.id).set(docData), 25000);
                    _localPatch(rec.id, { synced: true });
                    log('replay ' + rec.id + ' is now public');
                    _homeReplaysSig = '';
                } catch (e) {
                    if (e && /permission|insufficient/i.test(e.message || '')) {
                        _localPatch(rec.id, { denied: true });
                        window._empReplayLastError = 'write denied: ' + e.message;
                        notify('Replay saved on this device, but the server refused to share it (permission). The stream_replays Firestore rule needs publishing.', 'warning');
                    } else {
                        warn('replay sync pending (' + (e && e.message) + ') -- will retry');
                    }
                }
            }
        } finally { _syncBusy = false; }
    }

    function _replayTime(r) {
        var v = r && (r.createdAt || r.endedAt || r.savedAt);
        if (!v) return 0;
        if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (e) {} }
        if (typeof v.seconds === 'number') return v.seconds * 1000;
        var t = typeof v === 'number' ? v : Date.parse(v);
        return isNaN(t) ? 0 : t;
    }
    function _withTimeoutP(p, ms) {
        return Promise.race([p, new Promise(function (_res, rej) { setTimeout(function () { rej(new Error('timed out')); }, ms); })]);
    }
    async function _fetchReplayRows(limit) {
        var db = window.fbDb, col = db.collection('stream_replays'), snap = null, lastErr = null;
        var attempts = [
            function () { return _withTimeoutP(col.orderBy('createdAt', 'desc').limit(limit).get(), 20000); },
            function () { return _withTimeoutP(col.limit(100).get(), 12000); },
            function () { return _withTimeoutP(col.limit(100).get({ source: 'cache' }), 4000); }
        ];
        var errs = [];
        for (var i = 0; i < attempts.length && !snap; i++) {
            try { snap = await attempts[i](); }
            catch (e) {
                lastErr = e; errs.push((i + 1) + ') ' + ((e && (e.code || e.name)) || 'error') + ': ' + ((e && e.message) || ''));
                if (e && /permission|insufficient/i.test(e.message || '')) throw e;
            }
        }
        if (!snap) {
            /* 2026-11-08: surface WHY it failed (shown in small print under the message + kept on window._empReplayLastError) */
            var fe = new Error((lastErr && lastErr.message) || 'replay fetch failed');
            fe.detail = errs.join('  |  ');
            window._empReplayLastError = fe.detail;
            throw fe;
        }
        var rows = [];
        snap.forEach(function (d) {
            var r = d.data() || {};
            if (!r.videoUrl) r.videoUrl = r.recordingUrl || r.playbackUrl || r.url || '';
            if (r.videoUrl) rows.push({ id: r.id || d.id, r: r });
        });
        rows.sort(function (a, b) { return _replayTime(b.r) - _replayTime(a.r); });
        rows = rows.slice(0, limit);
        try { _lsWrite(CACHE_KEY, rows.slice(0, 20)); } catch (eC) {} // 2026-11-08: last good public list, shown instantly next time
        return rows;
    }
    var _sheetRows = [], _sheetSort = 'latest';
    function _renderReplaySheet(mode) {
        _sheetSort = mode === 'views' ? 'views' : 'latest';
        var list = document.getElementById('pv57-replays-list');
        if (!list) return;
        var rows = _sheetRows.slice();
        if (_sheetSort === 'views') rows.sort(function (a, b) { return (b.r.views || 0) - (a.r.views || 0); });
        list.innerHTML =
            '<div class="pv57-chips">' +
            '<button type="button" class="pv57-chip' + (_sheetSort === 'latest' ? ' on' : '') + '" data-pv57-sort="latest">Latest</button>' +
            '<button type="button" class="pv57-chip' + (_sheetSort === 'views' ? ' on' : '') + '" data-pv57-sort="views">Most viewed</button>' +
            '</div><div class="pv57-grid">' + rows.map(function (x) { return _homeCardHtml(x.r, x.id); }).join('') + '</div>';
    }
    async function _openReplaysList() {
        _ensureModals();
        var modal = document.getElementById('pv57-replays-modal');
        modal.classList.add('show');
        document.body.classList.add('pv57-replays-open');
        var list = document.getElementById('pv57-replays-list');
        list.innerHTML = '<p style="text-align:center;color:#ccc;padding:20px 0;">Loading replays\u2026</p>';
        var db = window.fbDb;
        if (!db || !window._firebaseLoaded) { list.innerHTML = '<p style="text-align:center;color:#ccc;padding:20px 0;">Replays need a connection — try again shortly.</p><div style="text-align:center;">' + RETRY_HTML + '</div>'; return; }
        try {
            /* 2026-11-08: was a single orderBy query with a 15s race (original kept below as a comment) -- now the resilient reader. */
            // var snap = await Promise.race([ db.collection('stream_replays').orderBy('createdAt', 'desc').limit(30).get(), <15s timeout> ]);
            /* 2026-11-08: show this device's replays + the last good public list INSTANTLY, then refresh from the server. */
            var _imm = _immediateRows();
            if (_imm.length) {
                _sheetRows = _imm;
                _renderReplaySheet(_sheetSort);
                list.insertAdjacentHTML('afterbegin', '<p id="pv57-sheet-note" style="text-align:center;color:#999;font-size:12px;margin:0 0 8px;">Updating\u2026</p>');
            }
            var _remote = null;
            try { _remote = await _fetchReplayRows(30); }
            catch (eRemote) {
                if (_imm.length) { var _n = document.getElementById('pv57-sheet-note'); if (_n) _n.textContent = 'Can\u2019t reach the server right now \u2014 showing saved replays.'; return; }
                throw eRemote;
            }
            _sheetRows = _mergeRows(_remote, _lsRows());
            if (!_sheetRows.length) { list.innerHTML = '<p style="text-align:center;color:#ccc;padding:20px 0;">No replays yet \u2014 recordings show up here once a host records a stream.</p>'; return; }
            _renderReplaySheet(_sheetSort);
            return;
            list.innerHTML = snap.docs.map(function (d) {
                var r = d.data();
                var mins = r.durationSec ? Math.max(1, Math.round(r.durationSec / 60)) : null;
                return '' +
                    '<div class="pv57-replay-row" data-pv57-replay="' + esc(r.id || d.id) + '" data-pv57-url="' + esc(r.videoUrl) + '">' +
                    '<div class="pv57-replay-thumb">' + (_posterFor(r.videoUrl) ? '<img src="' + esc(_posterFor(r.videoUrl)) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '<i class="fas fa-play"></i></div>' +
                    '<div class="pv57-replay-meta">' +
                    '<strong>' + esc(r.title || 'Live replay') + '</strong>' +
                    '<span>' + esc(r.hostName || 'Host') + (mins ? ' \u00b7 ' + mins + ' min' : '') + '</span>' +
                    '</div>' +
                    '</div>';
            }).join('');
        } catch (e) {
            warn('replay list fetch failed: ' + (e && e.message));
            list.innerHTML = '<p style="text-align:center;color:#ccc;padding:20px 0 0;">' + (e && /permission|insufficient/i.test(e.message || '') ? 'Replays aren\u2019t available yet (database permission).' : 'Couldn\u2019t load replays right now.') + '</p>' +
                /* 2026-11-08: real reason in small print so a failure can be diagnosed from a screenshot */
                '<p style="text-align:center;color:#888;font-size:11px;padding:0 14px;word-break:break-word;">' + esc((e && (e.detail || e.code || e.message)) || 'unknown error') + '</p>' +
                '<div style="text-align:center;">' + RETRY_HTML + '</div>';
        }
    }

    /* 2026-11-08 — PLAY NEXT. When a replay ends, the next one in the list the viewer opened it from (the Replays sheet if it
       is open, otherwise the Home slider) starts by itself, and after the last one it wraps back to the first. If there is only
       ONE replay in that list, it loops instead. */
    function _replayQueue() {
        var sheet = document.getElementById('pv57-replays-modal');
        var root = (sheet && sheet.classList.contains('show')) ? document.getElementById('pv57-replays-list') : document.getElementById('livestream-wrapper');
        var out = [], seen = {};
        if (!root) return out;
        Array.prototype.forEach.call(root.querySelectorAll('.pv57-home-card'), function (c) {
            var id = c.getAttribute('data-pv57-replay'), u = c.getAttribute('data-pv57-url');
            if (id && u && !seen[id]) { seen[id] = 1; out.push({ id: id, url: u }); }
        });
        return out;
    }
    var _curReplayId = null, _playQueue = [];
    function _playReplay(replayId, url) {
        _ensureModals();
        var video = document.getElementById('pv57-player-video');
        _curReplayId = replayId;
        _playQueue = _replayQueue();
        video.loop = _playQueue.length <= 1; // a lone replay loops; with 2+ the 'ended' handler below moves to the next
        if (!video._pv57NextWired) {
            video._pv57NextWired = true;
            video.addEventListener('ended', function () {
                if (_playQueue.length <= 1) return; // loop attribute already restarts a single replay
                var i = -1;
                for (var k = 0; k < _playQueue.length; k++) { if (_playQueue[k].id === _curReplayId) { i = k; break; } }
                var nxt = _playQueue[(i + 1) % _playQueue.length];
                if (nxt) _playReplay(nxt.id, nxt.url);
            });
        }
        video.src = url;
        document.getElementById('pv57-player-modal').classList.add('show');
        video.play().catch(function () {});
        var db = window.fbDb;
        var FV = window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue;
        if (db && window._firebaseLoaded && FV && replayId) {
            db.collection('stream_replays').doc(replayId).update({ views: FV.increment(1) }).catch(function () {});
        }
    }
    function _closePlayer() {
        var video = document.getElementById('pv57-player-video');
        _curReplayId = null; _playQueue = []; // 2026-11-08: stop play-next once the player is closed
        if (video) { try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) {} }
        var modal = document.getElementById('pv57-player-modal');
        if (modal) modal.classList.remove('show');
    }

    /* =========================================================================
       §5b — HOME "Recorded Livestreams" CARD (2026-11-08). index.html ships
       #recorded-livestreams-card (display:none) with an empty #livestream-wrapper
       slider, but the only code that ever un-hid it (app-fixes.js
       addRecordedLiveStream) looks for '.recorded-livestreams, #recorded-livestreams-section'
       -- neither exists -- and it only ever added the HOST's own same-session blob
       card. So nobody else could see recorded streams. This fills the slider from the
       public stream_replays collection (read: true) with thumbnail cards for everyone,
       and un-hides the card by its REAL id. Tapping a card uses the same _playReplay.
       ========================================================================= */
    var _homeReplaysAt = 0, _homeReplaysBusy = false, _homeReplaysSig = '';
    function _fmtDur(sec) {
        if (!sec) return '';
        var m = Math.floor(sec / 60), s = Math.round(sec % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }
    function _homeCardHtml(r, id) {
        var poster = _posterFor(r.videoUrl);
        var dur = _fmtDur(r.durationSec);
        var views = r.views > 0 ? '<span class="pv57-hc-views"><i class="fas fa-eye"></i> ' + esc(r.views) + '</span>' : '';
        return '' +
            '<div class="pv57-home-card" data-pv57-replay="' + esc(id) + '" data-pv57-url="' + esc(r.videoUrl) + '">' +
            '<div class="pv57-hc-thumb">' +
            (poster ? '<img class="pv57-hc-poster" src="' + esc(poster.replace('w_160,h_160', 'w_360,h_480')) + '" alt="" loading="lazy" onerror="this.remove()">'
                /* 2026-11-08 FIX (no thumbnail): replays are uploaded to Firebase Storage, not Cloudinary, so there is no JPG poster
                   URL to derive. Use the video's own first frame instead (muted, metadata-only preload, never autoplays). */
                : (r.thumbUrl ? '<img class="pv57-hc-poster" src="' + esc(r.thumbUrl) + '" alt="" loading="lazy" onerror="this.remove()">'
                    : '<video class="pv57-hc-poster" src="' + esc(String(r.videoUrl).split('#')[0] + '#t=0.5') + '" preload="metadata" muted playsinline webkit-playsinline disablepictureinpicture tabindex="-1" onerror="this.remove()"></video>')) +
            '<span class="pv57-hc-badge">REPLAY</span>' + (dur ? '<span class="pv57-hc-dur">' + esc(dur) + '</span>' : '') +
            '<span class="pv57-hc-play"><i class="fas fa-play"></i></span>' + views + _delBtnHtml(r, id) +
            '</div>' +
            '<div class="pv57-hc-info"><div class="pv57-hc-title">' + esc(r.title || 'Live replay') + '</div>' +
            '<div class="pv57-hc-host">' + (r.hostAvatar ? '<img src="' + esc(r.hostAvatar) + '" alt="" onerror="this.remove()">' : '') + '<span>' + esc(r.hostName || 'Host') + '</span></div></div>' +
            '</div>';
    }
    async function _loadHomeReplaysPrev(force) {
        var card = document.getElementById('recorded-livestreams-card');
        var wrap = document.getElementById('livestream-wrapper');
        if (!card || !wrap || _homeReplaysBusy) return;
        if (!force && Date.now() - _homeReplaysAt < 60000) return;
        var db = window.fbDb;
        if (!db || !window._firebaseLoaded) return;
        _homeReplaysBusy = true;
        try {
            // 2026-11-08: was a bare orderBy().get() with no timeout -- one hung request left _homeReplaysBusy true forever, so the
            // Home card never filled. Now the shared resilient reader (timeouts + no-orderBy + cache fallbacks).
            // var snap = await db.collection('stream_replays').orderBy('createdAt', 'desc').limit(20).get();
            var rows = await _fetchReplayRows(20);
            _homeReplaysAt = Date.now();
            var sig = rows.map(function (x) { return x.id + ':' + (x.r.views || 0); }).join('|');
            if (sig === _homeReplaysSig) { return; }
            _homeReplaysSig = sig;
            Array.prototype.slice.call(wrap.querySelectorAll('.pv57-home-card')).forEach(function (n) { n.remove(); });
            // a host's own same-session blob card (app-fixes.js) would now duplicate the saved replay -- drop it
            rows.forEach(function (x) {
                Array.prototype.slice.call(wrap.querySelectorAll('.livestream-card')).forEach(function (c) {
                    if (c.dataset && c.dataset.title && c.dataset.title === (x.r.title || '')) c.remove();
                });
            });
            var tmp = document.createElement('div');
            tmp.innerHTML = rows.map(function (x) { return _homeCardHtml(x.r, x.id); }).join('');
            while (tmp.lastChild) wrap.insertBefore(tmp.lastChild, wrap.firstChild);
            if (rows.length || wrap.children.length) card.style.display = 'block';
        } catch (e) {
            warn('home replays fetch failed: ' + (e && e.message));
            _homeReplaysAt = Date.now() - 50000; // 2026-11-08: retry in ~10s instead of hammering every 800ms tick
        } finally {
            _homeReplaysBusy = false;
        }
    }
    /* 2026-11-08: the previous _loadHomeReplays (server-only; blank whenever Firestore hung) is kept above as _loadHomeReplaysPrev. */
    function _paintHomeRows(rows) {
        var card = document.getElementById('recorded-livestreams-card');
        var wrap = document.getElementById('livestream-wrapper');
        if (!card || !wrap) return;
        var sig = rows.map(function (x) { return x.id + ':' + (x.r.views || 0) + (x.r.synced === false ? 'L' : ''); }).join('|');
        if (sig === _homeReplaysSig) return;
        _homeReplaysSig = sig;
        Array.prototype.slice.call(wrap.querySelectorAll('.pv57-home-card')).forEach(function (n) { n.remove(); });
        rows.forEach(function (x) {
            Array.prototype.slice.call(wrap.querySelectorAll('.livestream-card')).forEach(function (c) {
                if (c.dataset && c.dataset.title && c.dataset.title === (x.r.title || '')) c.remove();
            });
        });
        var tmp = document.createElement('div');
        tmp.innerHTML = rows.map(function (x) { return _homeCardHtml(x.r, x.id); }).join('');
        while (tmp.lastChild) wrap.insertBefore(tmp.lastChild, wrap.firstChild);
        if (rows.length || wrap.children.length) card.style.display = 'block';
    }
    async function _loadHomeReplays(force) {
        var card = document.getElementById('recorded-livestreams-card');
        var wrap = document.getElementById('livestream-wrapper');
        if (!card || !wrap) return;
        if (!_homeReplaysSig) { var imm = _immediateRows(); if (imm.length) _paintHomeRows(imm); } // instant: this device's replays + last good public list
        if (_homeReplaysBusy) return;
        if (!force && Date.now() - _homeReplaysAt < 60000) return;
        var db = window.fbDb;
        if (!db || !window._firebaseLoaded) return;
        _homeReplaysBusy = true;
        try {
            var remote = await _fetchReplayRows(20);
            _homeReplaysAt = Date.now();
            _paintHomeRows(_mergeRows(remote, _lsRows()));
        } catch (e) {
            warn('home replays fetch failed: ' + (e && e.message));
            _homeReplaysAt = Date.now() - 50000; // retry in ~10s
        } finally {
            _homeReplaysBusy = false;
        }
    }
    document.addEventListener('click', function (e) {
        var c = e.target && e.target.closest && e.target.closest('.pv57-home-card');
        if (!c) return;
        if (c.parentElement && c.parentElement.classList.contains('is-dragging')) return; // slider drag, not a tap
        _playReplay(c.getAttribute('data-pv57-replay'), c.getAttribute('data-pv57-url'));
    });
    document.addEventListener('empyrean-section-change', function () { setTimeout(function () { if (_onDashboard()) _loadHomeReplays(true); }, 300); });

    /* =========================================================================
       §6 — lifecycle poll (800ms — same convention every patch in this
       area uses).
       ========================================================================= */
    function _tick() {
        _ensureFloatBtn();
        _floatBtnVisibility();
        if (_onDashboard()) _loadHomeReplays(false); // 2026-11-08: fills the Home Recorded Livestreams card for everyone
        if (Date.now() - _lastSyncAt > 30000) { _lastSyncAt = Date.now(); _syncPendingReplays(); _syncPendingDeletes(); } // 2026-11-08: push any replay still waiting to become public
        _updateRecordBtnUI();
        _watchLiveEnd();
    }
    setInterval(_tick, 800);
    document.addEventListener('empyrean-init-done', function () { setTimeout(_tick, 500); });

    console.log('[EmpyreanPatchV57] \u2705 Stream replay added: host-device local recording (MediaRecorder \u2192 Cloudinary \u2192 stream_replays doc) reusing the existing #live-record-btn, plus a floating Replays browser/player for everyone. Honestly scoped as host-device-only capture, NOT server-side multi-participant Agora Cloud Recording (see header) \u2014 zero edits to any other file, via capture-phase button takeover + AgoraRTC wrapping.');

})();


/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v58
   (lives inside app-patch-v55.js — see that file's own top header)

   FEATURE — SCHEDULED STREAMS + REMINDERS

   REQUESTED: a "Going live at 6pm" card + reminder notification, ahead
   of the punch-list's own open question ("push infra needs checking
   against what already exists").

   ═══════════════════════════════════════════════════════════════════════
   WHAT PUSH INFRA ALREADY EXISTS — AND WHY THIS USES THE IN-APP BELL,
   NOT IT, FOR NOW
   ═══════════════════════════════════════════════════════════════════════
   index.html's own script-tag comments confirm real infrastructure
   exists: app-push-setup.js registers an FCM Web Push device token and
   fires actual broadcast notifications through a backend `/api/notify`
   route. That's genuine native push, and reminders SHOULD eventually go
   through it. But app-push-setup.js itself wasn't provided this
   session, so `/api/notify`'s exact request contract (payload shape,
   auth, targeting-by-user-vs-topic) is unknown here — guessing at a
   backend contract and shipping a fetch() call against it would either
   silently no-op or, worse, hit that endpoint with malformed requests.
   So this patch uses ONLY the confirmed-working, already-everywhere
   `window.pushNotification()` in-app bell/panel system for reminders
   (reliable — every file in this codebase already calls it the same
   way). Wiring true FCM push for reminders is flagged here as the
   explicit next step once app-push-setup.js's contract is available in
   a session.

   ═══════════════════════════════════════════════════════════════════════
   DATA MODEL
   ═══════════════════════════════════════════════════════════════════════
   New collection `scheduled_streams/{id}`:
     { id, hostId, hostName, hostAvatar, title, description,
       scheduledFor (ISO string), createdAt, remindMe: [uid, …] }

   REQUIRED FIRESTORE RULE ADDITION:
     match /scheduled_streams/{id} {
       allow read: if true;
       allow create: if request.auth != null
                     && request.resource.data.hostId == request.auth.uid;
       allow update: if request.auth != null
                     && (resource.data.hostId == request.auth.uid
                         || request.resource.data.diff(resource.data)
                              .affectedKeys().hasOnly(['remindMe']));
       allow delete: if request.auth != null
                     && resource.data.hostId == request.auth.uid;
     }
   (read-public / owner-write, same shape as v57's stream_replays rule —
   with a carve-out so any signed-in user can toggle their OWN
   membership in `remindMe` without needing host-level write access.)

   REQUIRED FIRESTORE INDEX: none — the "streams starting soon" query
   below range-filters on the single field `scheduledFor`, which
   Firestore indexes automatically. (Unlike v56's picker, there's no
   second field being sorted/filtered here.)

   ═══════════════════════════════════════════════════════════════════════
   WHY THIS NEEDED NO EDIT TO index.html / app-fixes.js
   ═══════════════════════════════════════════════════════════════════════
   The "Schedule for later" toggle is injected into the EXISTING
   `#go-live-form` purely via DOM insertion (append before its own
   `.golive-v2-actions` row) once that form is found in the DOM — the
   same append-don't-edit technique this codebase's own comments
   describe other Go-Live patches (v43's "premium redesign") already
   using on this identical form. Submission is intercepted with a
   CAPTURE-phase `submit` listener scoped to `#go-live-form`, but ONLY
   calls `stopImmediatePropagation()` when the toggle is actually
   checked — otherwise it does nothing and the existing go-live-form
   handler in app-fixes.js runs exactly as before, completely
   unaffected. Same selective-interception discipline v57 uses for
   `#live-record-btn`, just gated on a checkbox instead of always-on.
   ============================================================================= */

(function empyreanPatchV58() {
    'use strict';

    if (window._empPatchV58Loaded) {
        console.warn('[V58] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV58Loaded = true;

    function log(msg) { console.log('[V58] ' + msg); }
    function warn(msg) { console.warn('[V58] ' + msg); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function fbReady() { return !!(window.fbDb && window._firebaseLoaded); }

    function _fmtWhen(iso) {
        var d;
        try { d = new Date(iso); } catch (e) { return iso; }
        if (isNaN(d.getTime())) return iso;
        var now = new Date();
        var sameDay = d.toDateString() === now.toDateString();
        var tomorrow = new Date(now.getTime() + 86400000);
        var isTomorrow = d.toDateString() === tomorrow.toDateString();
        var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        if (sameDay) return 'Today, ' + time;
        if (isTomorrow) return 'Tomorrow, ' + time;
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + time;
    }

    /* =========================================================================
       §1 — inject the "Schedule for later" toggle into the existing
       go-live form, and intercept submission only when it's checked.
       ========================================================================= */
    function _ensureScheduleToggle() {
        var form = document.getElementById('go-live-form');
        if (!form || document.getElementById('pv58-schedule-row')) return;
        var actions = form.querySelector('.golive-v2-actions');
        if (!actions) return;
        var row = document.createElement('div');
        row.id = 'pv58-schedule-row';
        row.className = 'form-group golive-v2-field pv58-schedule-row';
        row.innerHTML =
            '<label class="pv58-schedule-check-label">' +
            '<input type="checkbox" id="pv58-schedule-toggle"> \uD83D\uDDD3\uFE0F Schedule for later instead of going live now' +
            '</label>' +
            '<input type="datetime-local" id="pv58-schedule-when" style="display:none;">';
        actions.parentNode.insertBefore(row, actions);

        var toggle = row.querySelector('#pv58-schedule-toggle');
        var when = row.querySelector('#pv58-schedule-when');
        var submitBtn = actions.querySelector('.golive-v2-submit-btn');
        var submitBtnDefaultHTML = submitBtn ? submitBtn.innerHTML : '';
        toggle.addEventListener('change', function () {
            when.style.display = toggle.checked ? '' : 'none';
            if (submitBtn) submitBtn.innerHTML = toggle.checked ? '<i class="fas fa-calendar-check"></i> Schedule Stream' : submitBtnDefaultHTML;
        });
    }

    document.addEventListener('submit', function (e) {
        var form = e.target;
        if (!form || form.id !== 'go-live-form') return;
        var toggle = document.getElementById('pv58-schedule-toggle');
        if (!toggle || !toggle.checked) return; // let the real go-live handler run untouched
        e.preventDefault();
        e.stopImmediatePropagation();
        _createScheduledStream();
    }, true /* capture phase — must run before app-fixes.js's own go-live-form handler */);

    async function _createScheduledStream() {
        if (!fbReady() || !window.userState) { notify('You need to be signed in and online to schedule a stream.', 'warning'); return; }
        var titleEl = document.getElementById('live-title');
        var descEl = document.getElementById('live-description');
        var whenEl = document.getElementById('pv58-schedule-when');
        var title = titleEl ? titleEl.value.trim() : '';
        var whenVal = whenEl ? whenEl.value : '';
        if (!title) { notify('Add a stream title first.', 'warning'); return; }
        if (!whenVal) { notify('Pick a date and time first.', 'warning'); return; }
        var whenDate = new Date(whenVal);
        if (isNaN(whenDate.getTime()) || whenDate.getTime() <= Date.now()) { notify('Pick a time in the future.', 'warning'); return; }

        var id = 'sched_' + window.userState.id + '_' + Date.now();
        try {
            await window.fbDb.collection('scheduled_streams').doc(id).set({
                id: id,
                hostId: window.userState.id,
                hostName: window.userState.fullName || window.userState.username || 'Host',
                hostAvatar: window.userState.avatar || '',
                title: title,
                description: descEl ? descEl.value.trim() : '',
                scheduledFor: whenDate.toISOString(),
                createdAt: new Date().toISOString(),
                remindMe: []
            });
            notify('\uD83D\uDDD3\uFE0F Stream scheduled for ' + _fmtWhen(whenDate.toISOString()) + '.', 'success');
            // Reset just this patch's own fields + collapse the create panel,
            // same toggle-visibility convention .section-create-toggle-btn
            // already drives elsewhere in this app.
            if (titleEl) titleEl.value = '';
            if (descEl) descEl.value = '';
            var toggle = document.getElementById('pv58-schedule-toggle');
            if (toggle) { toggle.checked = false; toggle.dispatchEvent(new Event('change')); }
            var panel = document.getElementById('golive-create-panel');
            if (panel) panel.style.display = 'none';
            _refreshUpcomingList();
        } catch (e) {
            notify('Could not schedule stream: ' + (e && e.message ? e.message : 'try again.'), 'error');
        }
    }

    /* =========================================================================
       §2 — "Upcoming Streams" list, shown on the Go Live section itself
       so anyone visiting it (not just the host) can see what's coming
       and opt into a reminder.
       ========================================================================= */
    function _ensureUpcomingList() {
        var section = document.getElementById('go-live');
        var content = section && section.querySelector('.card-content');
        if (!content || document.getElementById('pv58-upcoming-wrap')) return;
        var wrap = document.createElement('div');
        wrap.id = 'pv58-upcoming-wrap';
        wrap.innerHTML = '<h3 class="golive-v2-title" style="margin-top:18px;">\uD83D\uDCC5 Upcoming Streams</h3><div id="pv58-upcoming-list"></div>';
        // Above the "Start a Live Stream" toggle button, so it's the
        // first thing anyone lands on when they open this section.
        content.insertBefore(wrap, content.firstChild);
        _refreshUpcomingList();
    }

    async function _refreshUpcomingList() {
        var list = document.getElementById('pv58-upcoming-list');
        if (!list || !fbReady()) return;
        try {
            var nowIso = new Date().toISOString();
            var snap = await window.fbDb.collection('scheduled_streams')
                .where('scheduledFor', '>=', nowIso)
                .orderBy('scheduledFor', 'asc')
                .limit(20)
                .get();
            if (snap.empty) { list.innerHTML = '<p style="color:#999;font-size:var(--text-sm);">No streams scheduled right now.</p>'; return; }
            var myId = window.userState && window.userState.id;
            list.innerHTML = snap.docs.map(function (d) {
                var s = d.data();
                var reminded = myId && Array.isArray(s.remindMe) && s.remindMe.indexOf(myId) !== -1;
                var isOwner = myId && s.hostId === myId;
                return '' +
                    '<div class="pv58-upcoming-card" data-pv58-id="' + esc(s.id) + '">' +
                    '<div class="pv58-upcoming-meta">' +
                    '<strong>' + esc(s.title || 'Live stream') + '</strong>' +
                    '<span>' + esc(s.hostName || 'Host') + ' \u00b7 ' + esc(_fmtWhen(s.scheduledFor)) + '</span>' +
                    '</div>' +
                    (isOwner
                        ? '<button type="button" class="pv58-cancel-btn" data-pv58-cancel="' + esc(s.id) + '" title="Cancel"><i class="fas fa-trash"></i></button>'
                        : '<button type="button" class="pv58-remind-btn' + (reminded ? ' pv58-reminded' : '') + '" data-pv58-remind="' + esc(s.id) + '" title="Remind me"><i class="fas fa-bell' + (reminded ? '' : '-slash') + '"></i></button>') +
                    '</div>';
            }).join('');
        } catch (e) {
            warn('upcoming list fetch failed: ' + (e && e.message));
            list.innerHTML = '<p style="color:#999;font-size:var(--text-sm);">Couldn\u2019t load upcoming streams right now.</p>';
        }
    }

    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        var remindBtn = e.target.closest('[data-pv58-remind]');
        if (remindBtn) { _toggleRemindMe(remindBtn.getAttribute('data-pv58-remind'), remindBtn); return; }
        var cancelBtn = e.target.closest('[data-pv58-cancel]');
        if (cancelBtn) { _cancelScheduledStream(cancelBtn.getAttribute('data-pv58-cancel')); return; }
    });

    async function _toggleRemindMe(id, btn) {
        if (!fbReady() || !window.userState) { notify('Sign in to set a reminder.', 'warning'); return; }
        var FV = window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue;
        if (!FV) return;
        var alreadyOn = btn.classList.contains('pv58-reminded');
        try {
            await window.fbDb.collection('scheduled_streams').doc(id).update({
                remindMe: alreadyOn ? FV.arrayRemove(window.userState.id) : FV.arrayUnion(window.userState.id)
            });
            notify(alreadyOn ? 'Reminder turned off.' : '\uD83D\uDD14 You\u2019ll get a reminder 15 minutes before this stream.', 'success');
            _refreshUpcomingList();
        } catch (e) { notify('Could not update reminder: ' + (e && e.message ? e.message : 'try again.'), 'error'); }
    }
    async function _cancelScheduledStream(id) {
        if (!fbReady()) return;
        try {
            await window.fbDb.collection('scheduled_streams').doc(id).delete();
            notify('Scheduled stream canceled.', 'info');
            _refreshUpcomingList();
        } catch (e) { notify('Could not cancel: ' + (e && e.message ? e.message : 'try again.'), 'error'); }
    }

    /* =========================================================================
       §3 — reminder polling. Runs once a minute (this doesn't need
       v55/v56/v57's 800ms responsiveness — it's firing minutes-ahead
       reminders, not reacting to a live UI state). Tracks which
       stream/phase pairs this DEVICE has already notified for in
       localStorage, so a reload/re-render never re-fires the same
       reminder twice on the same device.
       ========================================================================= */
    var NOTIFIED_KEY = 'emp_v58_notified';
    function _loadNotified() { try { return JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]'); } catch (e) { return []; } }
    function _saveNotified(arr) {
        // Cap at the most recent 200 entries so this never grows unbounded
        // across a long-lived install.
        try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(arr.slice(-200))); } catch (e) {}
    }
    var _notified = _loadNotified();
    function _markNotified(key) { if (_notified.indexOf(key) === -1) { _notified.push(key); _saveNotified(_notified); } }

    async function _checkReminders() {
        if (!fbReady() || !window.userState) return;
        var myId = window.userState.id;
        var now = Date.now();
        var soonIso = new Date(now + 16 * 60 * 1000).toISOString(); // 16-min window catches anything due in the next ~15 min even with a slightly-late poll tick
        var nowIso = new Date(now).toISOString();
        try {
            var snap = await window.fbDb.collection('scheduled_streams')
                .where('scheduledFor', '>=', nowIso)
                .where('scheduledFor', '<=', soonIso)
                .get();
            snap.forEach(function (doc) {
                var s = doc.data();
                var iAmIn = s.hostId === myId || (Array.isArray(s.remindMe) && s.remindMe.indexOf(myId) !== -1);
                if (!iAmIn) return;
                var key = s.id + ':15min';
                if (_notified.indexOf(key) !== -1) return;
                _markNotified(key);
                var who = s.hostId === myId ? 'Your' : (esc(s.hostName || 'A stream') + '\u2019s');
                notify('\u23F0 ' + who + ' stream "' + s.title + '" starts ' + _fmtWhen(s.scheduledFor) + '.', 'info');
            });
        } catch (e) { warn('reminder check failed: ' + (e && e.message)); }
    }

    /* =========================================================================
       §4 — CSS
       ========================================================================= */
    (function injectCSS() {
        if (document.getElementById('pv58-css')) return;
        var css = document.createElement('style');
        css.id = 'pv58-css';
        css.textContent =
            '.pv58-schedule-row{margin-top:6px;}' +
            '.pv58-schedule-check-label{display:flex;align-items:center;gap:8px;font-size:var(--text-sm);color:#ddd;cursor:pointer;}' +
            '#pv58-schedule-when{width:100%;margin-top:8px;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.06);color:#fff;}' +
            '.pv58-upcoming-card{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border-radius:12px;background:rgba(255,255,255,0.04);margin-bottom:8px;}' +
            '.pv58-upcoming-meta{display:flex;flex-direction:column;min-width:0;}' +
            '.pv58-upcoming-meta strong{color:#fff;font-size:var(--text-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.pv58-upcoming-meta span{color:#999;font-size:var(--text-xs);}' +
            '.pv58-remind-btn,.pv58-cancel-btn{background:rgba(255,255,255,0.08);border:none;border-radius:50%;width:36px;height:36px;color:#ccc;cursor:pointer;flex-shrink:0;}' +
            '.pv58-remind-btn.pv58-reminded{background:var(--accent-color,#f5a623);color:#1a1a1a;}';
        document.head.appendChild(css);
    })();

    /* =========================================================================
       §5 — lifecycle
       ========================================================================= */
    setInterval(function () { _ensureScheduleToggle(); _ensureUpcomingList(); }, 1500);
    setInterval(_checkReminders, 60 * 1000);
    document.addEventListener('empyrean-init-done', function () {
        setTimeout(function () { _ensureScheduleToggle(); _ensureUpcomingList(); _checkReminders(); }, 800);
    });

    console.log('[EmpyreanPatchV58] \u2705 Scheduled streams + reminders added: "Schedule for later" toggle on the Go Live form, an Upcoming Streams list with per-user remind-me, and a once-a-minute reminder check via the existing in-app notification bell. True FCM push wiring flagged as a follow-up (see header) since app-push-setup.js\u2019s /api/notify contract wasn\u2019t available this session.');

})();


/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v59
   (lives inside app-patch-v55.js — see that file's own top header)

   FEATURE — WATERMARKED SCREEN-SHARE / DOWNLOAD

   REQUESTED: downloads/captures from a live stream (including while the
   host is screen-sharing via the existing `#live-share-screen-btn`)
   should carry the Empyrean watermark, and the punch-list explicitly
   ties this to "the existing save-to-gallery flow (v47)".

   ═══════════════════════════════════════════════════════════════════════
   TWO PIECES, BOTH REUSING EXISTING HOOKS RATHER THAN NEW MACHINERY
   ═══════════════════════════════════════════════════════════════════════
   (A) A "\uD83D\uDCF8 Snapshot" button in the live footer, for HOST AND VIEWERS
   alike (unlike v37/v55's host-or-guest-only features, there's no
   reason to restrict who can save a frame). Captures whatever is
   currently on screen — which, with zero special-casing, already
   includes a screen-share, since `#agora-local-video`'s `<video>` (or
   a viewer's own `#agora-viewer-video`) shows exactly what's being
   published regardless of source — draws the Empyrean corner-badge
   watermark on top (own lightweight drawing routine, §2 below — NOT a
   reach into app-fixes.js's own private `_drawWatermark`-style
   routines used for post/reel downloads, since those are that file's
   local closures; same "can't reach another file's private helpers
   without an edit" limit v55's header already explains, so this is a
   deliberately separate, visually-matching implementation, not the
   same function reused), then triggers a real file download AND
   dispatches the SAME `empyrean:download-complete` CustomEvent
   app-fixes.js's own download handler already dispatches (confirmed at
   its exact call site: `detail: { urls, fileWord }`) — which is the
   real, documented hook app-patch-v47.js listens on to offer its
   native "Save to Gallery" share-sheet prompt. That's the literal tie-
   in the punch list asked for: this patch produces a watermarked file
   and hands it to v47's EXISTING flow instead of building a second,
   competing save-to-gallery prompt.

   (B) An OPT-IN "Watermark Recording" host toggle that, when on, runs a
   continuous compositor canvas (§3 — same one-frame-at-a-time
   `requestAnimationFrame` technique as v55's own beauty pipeline, same
   "only pay for the per-frame cost while a host actually asked for it"
   discipline) drawing the live source + the same corner badge, 30fps.
   v57's own `_getVideoTrackForRecording()` (defined earlier in THIS
   SAME FILE — not a cross-file reach, since v55\u2192v58 are being built
   together in one file this session, per this session's own build
   plan) is updated to prefer this compositor canvas when it's running,
   so a host who wants a saved replay to visibly carry the Empyrean
   mark end-to-end gets that automatically, with the one-shot Snapshot
   button in (A) staying watermarked unconditionally either way.
   ============================================================================= */

(function empyreanPatchV59() {
    'use strict';

    if (window._empPatchV59Loaded) {
        console.warn('[V59] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV59Loaded = true;

    function log(msg) { console.log('[V59] ' + msg); }
    function warn(msg) { console.warn('[V59] ' + msg); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }

    function isRealHost() {
        if (window.isGuest || !window.userState || !window.liveStreamData) return false;
        var sd = window.liveStreamData;
        var hid = sd.hostUserId || sd.hostId;
        return !!hid && window.userState.id === hid;
    }
    function isCurrentlyLive() {
        return !!(window.liveStreamData && window.liveStreamData.isLive);
    }

    /* =========================================================================
       §1 — find whatever local/remote video element is currently
       showing the stream, for host OR viewer. Same DOM-only reach
       discipline as v57 §2 — never touches another file's JS closures.
       ========================================================================= */
    function _findActiveStreamVideoEl() {
        var localWrap = document.getElementById('agora-local-video');
        var localVideo = localWrap && localWrap.querySelector('video');
        if (localVideo && localVideo.videoWidth) return localVideo;
        // Viewer side: app-live.js/app-live-tiktok-patch.js render the
        // host's remote video into a wrapper matching this id pattern
        // (see v37's own `_isVideoWrapper` regex, which this reuses the
        // spirit of rather than re-deriving a new one).
        var candidates = document.querySelectorAll('[id^="agora-viewer-video"] video, [id^="agora-guest-"] video, #agora-remote-video video');
        for (var i = 0; i < candidates.length; i++) {
            if (candidates[i].videoWidth) return candidates[i];
        }
        // 2026-11-08: host is live but Agora has not published a camera track yet, so the only live preview
        // is the raw getUserMedia one in #host-main-video (app-fixes.js startHostCamera). Use it.
        var raw = document.getElementById('host-main-video');
        if (raw && raw.srcObject && raw.videoWidth) return raw;
        return null;
    }

    /* =========================================================================
       §2 — the watermark drawing routine itself. Bottom-right rounded
       badge, semi-transparent dark background + a small ring "logo" +
       "Empyrean" wordmark — visually in the same family as the
       existing post/reel watermark description (corner badge + logo
       circle + wordmark) without reusing its code (see header).
       ========================================================================= */
    function _drawWatermarkBadge(ctx, w, h) {
        var pad = Math.max(10, Math.round(w * 0.02));
        var badgeH = Math.max(26, Math.round(h * 0.05));
        var fontSize = Math.max(12, Math.round(badgeH * 0.5));
        ctx.save();
        ctx.font = fontSize + 'px sans-serif';
        var text = 'Empyrean';
        var textW = ctx.measureText(text).width;
        var ringD = badgeH * 0.6;
        var badgeW = ringD + 10 + textW + 24;
        var x = w - pad - badgeW;
        var y = h - pad - badgeH;

        ctx.globalAlpha = 0.82;
        ctx.fillStyle = 'rgba(10,10,12,0.55)';
        var r = badgeH / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + badgeW, y, x + badgeW, y + badgeH, r);
        ctx.arcTo(x + badgeW, y + badgeH, x, y + badgeH, r);
        ctx.arcTo(x, y + badgeH, x, y, r);
        ctx.arcTo(x, y, x + badgeW, y, r);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#f5a623';
        ctx.lineWidth = Math.max(1.5, ringD * 0.12);
        ctx.beginPath();
        ctx.arc(x + 12 + ringD / 2, y + badgeH / 2, ringD / 2 - ctx.lineWidth, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 12 + ringD + 8, y + badgeH / 2);
        ctx.restore();
    }

    /* =========================================================================
       §3 — continuous compositor canvas (opt-in, host only, off by
       default — see header for the CPU-cost reasoning, same discipline
       v55's own beauty canvas already follows).
       ========================================================================= */
    var _compositor = { canvas: null, ctx: null, rafId: null, sourceVideo: null, active: false };

    function _startCompositor() {
        if (_compositor.active) return;
        var video = _findActiveStreamVideoEl();
        if (!video) { notify('Camera preview isn\u2019t ready yet — try again in a moment.', 'warning'); return; }
        var canvas = document.createElement('canvas');
        canvas.id = 'pv59-watermark-canvas';
        canvas.style.cssText = 'position:absolute;left:-99999px;top:-99999px;'; // never shown directly — only used as a recording source (§4), same off-screen-canvas approach v55's beauty pipeline uses for its own capture buffer, just not swapped into the visible preview here since the raw view already shows the unwatermarked feed live
        document.body.appendChild(canvas);
        _compositor.canvas = canvas;
        _compositor.ctx = canvas.getContext('2d');
        _compositor.sourceVideo = video;
        _compositor.active = true;
        _drawCompositorFrame();
        notify('\uD83D\uDCA7 Watermark enabled — your saved replay will carry the Empyrean mark.', 'success');
    }
    function _drawCompositorFrame() {
        _compositor.rafId = requestAnimationFrame(_drawCompositorFrame);
        var v = _compositor.sourceVideo, c = _compositor.canvas, ctx = _compositor.ctx;
        if (!v || v.readyState < 2 || !v.videoWidth) return;
        if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
        ctx.drawImage(v, 0, 0, c.width, c.height);
        _drawWatermarkBadge(ctx, c.width, c.height);
    }
    function _stopCompositor() {
        if (_compositor.rafId) cancelAnimationFrame(_compositor.rafId);
        if (_compositor.canvas) _compositor.canvas.remove();
        _compositor = { canvas: null, ctx: null, rafId: null, sourceVideo: null, active: false };
    }
    function _toggleCompositor() {
        if (!isRealHost()) { notify('Only the host can turn this on.', 'warning'); return; }
        if (_compositor.active) { _stopCompositor(); notify('Watermark turned off.', 'info'); }
        else _startCompositor();
        _updateWatermarkBtnUI();
    }
    function _updateWatermarkBtnUI() {
        var btn = document.getElementById('pv59-watermark-btn');
        if (btn) btn.classList.toggle('pv59-active', _compositor.active);
    }

    /* =========================================================================
       §4 — v57 integration: prefer this compositor canvas as the
       recording source when it's running. Defined here, in the SAME
       FILE as v57 (see header for why this isn't a cross-file reach).
       ========================================================================= */
    if (typeof window._empV57RegisterVideoSourceOverride === 'function') {
        // Defensive: only wire in if v57 exposed the extension point
        // below (it always does when loaded — see the matching line
        // added at the bottom of v57's own §2). Guarded so this file
        // still loads cleanly even if v57 is ever stripped out ahead of
        // this feature during the eventual v42 merge.
        window._empV57RegisterVideoSourceOverride(function () {
            return (_compositor.active && _compositor.canvas) ? _compositor.canvas : null;
        });
    }

    /* =========================================================================
       §5 — the Snapshot button (host + viewers), always watermarked
       regardless of the compositor toggle above, and wired straight
       into v47's existing Save-to-Gallery hook.
       ========================================================================= */
    function _takeSnapshot() {
        var video = _findActiveStreamVideoEl();
        if (!video) { notify('Nothing to capture right now.', 'warning'); return; }
        var canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        _drawWatermarkBadge(ctx, canvas.width, canvas.height);

        canvas.toBlob(function (blob) {
            if (!blob) { notify('Could not capture a snapshot — try again.', 'error'); return; }
            var url = URL.createObjectURL(blob);
            var filename = 'empyrean-live-' + Date.now() + '.png';
            var a = document.createElement('a');
            a.href = url; a.download = filename; a.rel = 'noopener';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 4000);

            notify('\uD83D\uDCF8 Snapshot saved with the Empyrean watermark.', 'success');
            // Reuses app-fixes.js's OWN download-complete hook, verbatim
            // event name + detail shape (see header) — this is the exact
            // signal app-patch-v47.js listens for to offer its native
            // "Save to Gallery" share-sheet prompt, so that prompt now
            // appears for this download too, with zero new UI built for it.
            document.dispatchEvent(new CustomEvent('empyrean:download-complete', {
                detail: { urls: [url], fileWord: 'file' }
            }));
        }, 'image/png');
    }

    /* =========================================================================
       §6 — CSS + buttons (footer Snapshot button for everyone, host-
       control Watermark toggle for the host only).
       ========================================================================= */
    (function injectCSS() {
        if (document.getElementById('pv59-css')) return;
        var css = document.createElement('style');
        css.id = 'pv59-css';
        css.textContent =
            '#pv59-snapshot-btn,#pv59-watermark-btn{width:44px;height:44px;border-radius:14px;background:linear-gradient(145deg,rgba(46,46,52,0.62),rgba(16,16,20,0.78));border:1px solid rgba(255,255,255,0.10);display:flex;align-items:center;justify-content:center;color:#fff;font-size:17px;cursor:pointer;flex-shrink:0;}' +
            '#pv59-snapshot-btn:active,#pv59-watermark-btn:active{transform:scale(0.90);}' +
            '#pv59-watermark-btn.pv59-active{background:var(--accent-color,#f5a623);color:#1a1a1a;}' +
            /* 2026-11-08: one size for every live-screen control. Host rail: 45px buttons, 20px glyphs. Footer: 20px glyphs.
               Sizing only - no display rules - so buttons that are hidden on purpose stay hidden. */
            '#host-control-panel #host-control-panel-inner>button,#host-control-panel #host-control-panel-inner .live-action-btn{width:45px!important;height:45px!important;min-width:45px!important;min-height:45px!important;max-width:45px!important;padding:0!important;box-sizing:border-box!important;flex:0 0 45px!important;align-items:center!important;justify-content:center!important;font-size:20px!important;line-height:1!important;}' +
            '#host-control-panel #host-control-panel-inner>button i,#host-control-panel #host-control-panel-inner .live-action-btn i{font-size:20px!important;width:20px!important;height:20px!important;line-height:20px!important;text-align:center;margin:0!important;}' +
            '#host-control-panel #host-control-panel-inner>button svg,#host-control-panel #host-control-panel-inner .live-action-btn svg,#host-control-panel #host-control-panel-inner>button img,#host-control-panel #host-control-panel-inner .live-action-btn img{width:20px!important;height:20px!important;margin:0!important;}' +
            '.live-footer .live-action-btn,.live-footer .tk-footer-icon,#pv59-snapshot-btn{font-size:20px!important;}' +
            '.live-footer .live-action-btn i,.live-footer .tk-footer-icon i,#pv59-snapshot-btn i{font-size:20px!important;width:20px!important;height:20px!important;line-height:20px!important;}' +
            '.live-footer .live-action-btn svg,.live-footer .tk-footer-icon svg,.live-footer .live-action-btn img:not(.tk-rose-img),.live-footer .tk-footer-icon img:not(.tk-rose-img){width:20px!important;height:20px!important;}';
        document.head.appendChild(css);
    })();

    // 2026-11-08: self-contained SVG glyphs (no icon-font dependency, so they can never render as a ring/tofu box).
    var _REC_SVG_START = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style="display:block;pointer-events:none"><circle cx="12" cy="12" r="9.5" fill="none" stroke="#ef4444" stroke-width="2"/><circle cx="12" cy="12" r="5.6" fill="#ef4444"/></svg>';
    var _REC_SVG_STOP = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style="display:block;pointer-events:none"><circle cx="12" cy="12" r="9.5" fill="none" stroke="#ef4444" stroke-width="2"/><rect x="8" y="8" width="8" height="8" rx="1.8" fill="#ef4444"/></svg>';
    function _ensureSnapshotBtn() {
        var footer = document.querySelector('.live-footer');
        if (!footer || document.getElementById('pv59-snapshot-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'pv59-snapshot-btn'; // id kept on purpose (CSS + lifecycle); this is now the footer RECORD button
        btn.type = 'button';
        btn.title = 'Start Recording';
        btn.innerHTML = _REC_SVG_START;
        footer.appendChild(btn);
        // 2026-11-08: the footer camera used to take a snapshot (_takeSnapshot, now unused). It now starts/stops the
        // stream recording by driving v57's #live-record-btn handler (capture-phase listener on document),
        // so there is exactly one recording code path.
        /* 2026-11-08 FIX (record icon still not working): the tap is now handled by the capture-phase document listener
           registered just below (always runs before any other file's handler, same treatment as every other live-screen
           button). This direct listener is kept as a no-op guard so a tap can never toggle twice. */
        btn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); });
    }
    var _recFooterLastTap = 0;
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        var fb = e.target.closest('#pv59-snapshot-btn');
        if (!fb) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        var now = Date.now();
        if (now - _recFooterLastTap < 400) return; // one physical tap = one toggle
        _recFooterLastTap = now;
        try {
            if (typeof window._empToggleStreamRecording === 'function') { window._empToggleStreamRecording(); return; }
            var rb = document.getElementById('live-record-btn');
            if (rb) rb.click();
        } catch (eRecTap) {
            if (typeof window.showNotification === 'function') window.showNotification('Could not start recording: ' + (eRecTap && eRecTap.message ? eRecTap.message : 'please try again.'), 'error');
        }
    }, true);
    function _syncFooterRecordBtn() {
        var b = document.getElementById('pv59-snapshot-btn');
        if (!b) return;
        var rec = !!(window.liveStreamData && window.liveStreamData.isRecording);
        if (b.getAttribute('data-rec') === (rec ? '1' : '0')) return;
        b.setAttribute('data-rec', rec ? '1' : '0');
        b.title = rec ? 'Stop Recording' : 'Start Recording';
        b.innerHTML = rec ? _REC_SVG_STOP : _REC_SVG_START;
    }
    function _ensureWatermarkToggle() {
        var panel = document.getElementById('host-control-panel-inner');
        if (!panel || document.getElementById('pv59-watermark-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'pv59-watermark-btn';
        btn.type = 'button';
        btn.className = 'live-action-btn host-control';
        btn.title = 'Watermark Recording';
        btn.innerHTML = '<i class="fas fa-droplet"></i>';
        panel.appendChild(btn);
        btn.addEventListener('click', _toggleCompositor);
    }
    function _removeHostOnlyUI() {
        var b = document.getElementById('pv59-watermark-btn');
        if (b) b.remove();
        if (_compositor.active) _stopCompositor();
    }

    // FIX (bug report: "control panel buttons unresponsive") — same
    // guaranteed-first capture-phase treatment as pv55/pv56 above; see
    // those fixes' comments for the full explanation. stopImmediatePropagation()
    // (FIX 2026-08-03: upgraded from stopPropagation, the same
    // defense-in-depth hardening applied to every other button on this
    // panel this session) prevents double-firing alongside the button's
    // own bubble-phase listener registered above.
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        var btn = e.target.closest('#pv59-watermark-btn');
        if (!btn) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        _toggleCompositor();
    }, true);
    function _removeSnapshotBtn() {
        var b = document.getElementById('pv59-snapshot-btn');
        if (b) b.remove();
    }

    /* =========================================================================
       §7 — lifecycle (800ms — same convention as every other button in
       this footer/panel family).
       ========================================================================= */
    function _tick() {
        if (isCurrentlyLive() && isRealHost()) { _ensureSnapshotBtn(); _syncFooterRecordBtn(); } else _removeSnapshotBtn();
        if (isRealHost() && isCurrentlyLive()) _ensureWatermarkToggle(); else _removeHostOnlyUI();
        _updateWatermarkBtnUI();
    }
    setInterval(_tick, 800);
    document.addEventListener('empyrean-init-done', function () { setTimeout(_tick, 500); });

    console.log('[EmpyreanPatchV59] \u2705 Watermarked screen-share/download added: a Snapshot button (host + viewers, always watermarked, wired into v47\u2019s existing Save-to-Gallery hook) and an opt-in host \u201cWatermark Recording\u201d toggle that v57\u2019s replay recorder now prefers as its source when on. Screen-share needs no special-casing — it\u2019s captured the same as any other published video.');

})();

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v60 (appended into app-patch-v42.js)
   Load: already covered — this ships from the same <script> tag as the
   v42/v50-v59 modules above, executes after all of them.

   FIXES (per this session's report + screenshot):
     [1] Help & Assistance Center "?" floating button (self-help-
         assistance-center.js's #emp-help-fab, position:fixed, appended
         directly to <body>) stays visible OVER the full-screen live
         stream view, sitting on top of the live UI. It has nothing to
         do with being live, so it's hidden for the duration of a live
         session.

   WHY THIS COULDN'T BE A PLAIN CSS RULE ALONE
   #emp-help-fab is appended straight to <body> by
   self-help-assistance-center.js, and #go-live-modal-overlay (per
   index.html) is not guaranteed to be that same element's immediate
   DOM sibling — so a CSS sibling-combinator rule
   (`#go-live-modal-overlay.show ~ #emp-help-fab`) can't be relied on to
   match. Instead, this watches the same `.show` class toggle every
   other live-related patch in this codebase already watches
   (app-patch-v30/v33/v37/v52's own onModalToggle) and mirrors it onto a
   `body.emp-live-active` class, which style.css's new
   `body.emp-live-active #emp-help-fab { display:none!important; }` rule
   (see style.css) then targets directly — no DOM-order assumption
   needed, and it composes cleanly with anything else that might also
   read `body.emp-live-active` later.
   ============================================================================= */
(function empyreanPatchV60() {
    'use strict';

    if (window._empPatchV60Loaded) {
        console.warn('[V60] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV60Loaded = true;

    var ACTIVE_CLASS = 'emp-live-active';

    function _sync(modal) {
        var isLive = modal && modal.classList.contains('show');
        document.body.classList.toggle(ACTIVE_CLASS, !!isLive);
    }

    function _wire() {
        var modal = document.getElementById('go-live-modal-overlay');
        if (!modal || modal._pv60Watched) return;
        modal._pv60Watched = true;
        new MutationObserver(function () { _sync(modal); })
            .observe(modal, { attributes: true, attributeFilter: ['class'] });
        _sync(modal); // cover the case where it's already open when this runs
    }

    if (document.readyState !== 'loading') _wire();
    else document.addEventListener('DOMContentLoaded', _wire);
    document.addEventListener('empyrean-init-done', function () { setTimeout(_wire, 300); });

    console.log('[EmpyreanPatchV60] \u2705 Help & Assistance Center "?" button now hides for the duration of a live stream (body.emp-live-active, toggled off #go-live-modal-overlay.show) \u2014 see the matching style.css rule.');

})();

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v61 (appended into app-patch-v42.js)
   Load: already covered — same <script> tag, executes after v60 above.

   FIX (per this session's report + screenshot):
     [1] Help & Assistance Center "?" button (#emp-help-fab) and the
         Report/Complaint FAB (#submit-complaint-fab) both float on top
         of the Reel viewer's right-side engagement column (like/
         comment/share/download), blocking taps on those icons. Neither
         has anything to do with reels, so both are hidden for the
         duration of the reel viewer — same treatment v60 above already
         gives them during a live stream.
     [2] (companion CSS-only fix, see style.css) — the Report/Complaint
         FAB overlapped the quick-post FAB on the home page; moved to
         sit to its left instead of stacked above it.

   Mirrors v60's own approach exactly: watch the one class toggle that
   already marks the feature as open/visible (#reel-viewer-modal-overlay
   .show, set by openReelViewer()/closeReelViewer() in app-nav.js/
   app-reel.js) and reflect it onto a body class
   (body.emp-reel-active) that style.css's selectors target directly —
   no DOM-order assumption needed, composes cleanly with v60's own
   body.emp-live-active for the same two buttons.
   ============================================================================= */
(function empyreanPatchV61() {
    'use strict';

    if (window._empPatchV61Loaded) {
        console.warn('[V61] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV61Loaded = true;

    var ACTIVE_CLASS = 'emp-reel-active';

    function _isVisible(el) {
        if (!el) return false;
        if (el.classList.contains('show')) return true;
        var cs = window.getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    function _sync(modal) {
        document.body.classList.toggle(ACTIVE_CLASS, _isVisible(modal));
    }

    function _wire() {
        var modal = document.getElementById('reel-viewer-modal-overlay');
        if (!modal || modal._pv61Watched) return;
        modal._pv61Watched = true;
        new MutationObserver(function () { _sync(modal); })
            .observe(modal, { attributes: true, attributeFilter: ['class', 'style'] });
        _sync(modal); // cover the case where it's already open when this runs
    }

    if (document.readyState !== 'loading') _wire();
    else document.addEventListener('DOMContentLoaded', _wire);
    document.addEventListener('empyrean-init-done', function () { setTimeout(_wire, 300); });

    console.log('[EmpyreanPatchV61] \u2705 Help & Assistance Center "?" button and Report/Complaint FAB now hide for the duration of the Reel viewer (body.emp-reel-active, toggled off #reel-viewer-modal-overlay.show) \u2014 see the matching style.css rule. Report/Complaint FAB also moved left of the quick-post FAB on the home page so the two no longer overlap.');

})();
