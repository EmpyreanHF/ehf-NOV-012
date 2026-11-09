/* =============================================================================
   EMPYREAN INTERNATIONAL — THREAD MODULE
   app-thread.js  |  v2.0  |  Full X/Twitter-style repost, quote, thread, live counts

   WHAT'S NEW IN v2.0
   ──────────────────
   • X-style Repost popup menu: "Repost" / "Quote" (or "Undo repost" when active)
   • Repost creates a REAL new card in #feed-container with "You reposted" label
   • Quote creates a REAL new card with embedded quoted-post preview card
   • Both save to Firestore posts collection (type:'retweet' / type:'quote')
   • Live count sync: onSnapshot keeps thread counts in sync with Firestore
   • Reply send: optimistic render + Firestore persist + commentCount increment
   • Mirror: reply count badge on source feed card increments immediately
   • Quote modal shows embedded post preview exactly like X
   • Timestamp formatting: "3h", "Jun 9" style like X
   • Feed repost/quote cards rendered via createNewPostElement if available,
     otherwise built inline — works regardless of load order
   • All feed action buttons (like / repost / quote / share / bookmark)
     wired via the same X-style popup for repost

   SURGICAL CONTRACT
   ─────────────────
   • Replaces app-thread.js only. Zero changes to any other file.
   • Defines window._vfOpenThread, window._vfCloseThread, window._submitQuote
   • Does NOT redefine window.renderBusinessPage, navigateTo, or anything
     owned by another module.
   • app-patch-v2.js §P2/§P3/§P4 are unaffected.
   • app-fix-final.js §43 mining wrapper still wraps window._submitQuote.

   LOAD ORDER (index.html — unchanged)
   ────────────────────────────────────
     <script src="app-fix-final.js"></script>
     <script src="app-thread.js"></script>      ← this file
     <script src="app-patch-v2.js"></script>
     <script src="app-patch-v3.js"></script>
     <script src="app-patch-v4.js"></script>
   ============================================================================= */

(function empyreanThreadModule() {
    'use strict';

    /* ── Module guard ── */
    if (window._empyreanThreadLoaded) {
        console.warn('[Thread] Already loaded — skipping.');
        return;
    }
    window._empyreanThreadLoaded = true;

    /* ─────────────────────────────────────────────────────────────────────────
       HELPERS
    ───────────────────────────────────────────────────────────────────────── */
    function _S()       { return window.EmpState || {}; }
    function _us()      { return _S().userState || window.userState || {}; }
    /* 2026-10-20 — a poster can't repost/quote their OWN post. Checked at every entry point below. */
    function _isOwnPostEl(el) {
        var uid = (_us() || {}).id;
        var pid = el && el.dataset && (el.dataset.userId || el.dataset.authorId);
        return !!(uid && pid && uid === pid);
    }
    function _blockSelfRepost() { _notify('You can\u2019t repost your own post.', 'warning'); }
    function _isGuest() { var s = _S(); return s.isGuest != null ? !!s.isGuest : !!window.isGuest; }
    function _fbOk()    { return !!(window._firebaseLoaded && window.fbDb); }
    /* FIX (collection routing): mirrors _col45() in app-fix-final.js. Every
       Firestore write in this module previously hardcoded .collection('posts'),
       which is wrong for crisis-report posts (live in 'crisis_reports') and
       business posts (live in 'business_posts'). _col(el) resolves the correct
       collection from the source card's class, falling back to 'posts' for
       ordinary feed posts and SOS requests (whose engagement-facing copy is
       mirrored into 'posts' by app-sos.js _handleApproveSos). Pass the actual
       card element when available (e.g. postEl in _doRepost); falls back to
       the module-level _activePostEl (the card the open thread view was
       launched from) when only a postId is at hand. */
    function _col(el) {
        var card = el || _activePostEl;
        if (card && card.dataset && card.dataset.collection) return card.dataset.collection;
        if (card && card.classList && card.classList.contains('crisis-report')) return 'crisis_reports';
        if (card && card.classList && card.classList.contains('biz-post-card'))  return 'business_posts';
        return 'posts';
    }
    /* FIX (live count on visit/open): session-deduped views increment for
       opening a post in the thread/detail view. Separate Set from the feed's
       IntersectionObserver dedup (app-fixes.js) — scrolling past a post in
       the feed and then opening it are two distinct engagement signals, but
       re-opening the SAME post repeatedly in one sitting should only count
       once, same as the feed observer's own behavior. */
    var _threadViewSeen = new Set();
    function _registerThreadView(postId, postEl) {
        if (!postId || _threadViewSeen.has(postId)) return;
        _threadViewSeen.add(postId);
        if (!_fbOk()) return;
        try {
            window.fbDb.collection(_col(postEl)).doc(postId).update({
                views: _inc(1)
            }).catch(function () {});
        } catch (e) {}
    }
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    }
    function _esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function _attr(s) { return _esc(s); }
    function _ready(fn) {
        if (document.readyState !== 'loading') fn();
        else document.addEventListener('DOMContentLoaded', fn);
    }
    function _avatar(u) {
        return u.avatar || u.profilePhoto ||
            'https://ui-avatars.com/api/?name=' +
            encodeURIComponent(u.fullName || u.username || 'U') +
            '&background=1B2B8B&color=fff&size=80';
    }
    /* X-style relative timestamp: "3h", "Jun 9", "Jun 9, 2024" */
    function _tsRelative(val) {
        if (!val) return '';
        try {
            var d = val.toDate ? val.toDate() : new Date(val);
            var now = Date.now();
            var diff = now - d.getTime();
            if (diff < 60000)        return 'now';
            if (diff < 3600000)      return Math.floor(diff / 60000) + 'm';
            if (diff < 86400000)     return Math.floor(diff / 3600000) + 'h';
            var opts = { month: 'short', day: 'numeric' };
            if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
            return d.toLocaleDateString('en-GB', opts);
        } catch (e) { return ''; }
    }
    /* Full timestamp for tooltip / quote preview */
    function _tsFull(val) {
        if (!val) return '';
        try {
            var d = val.toDate ? val.toDate() : new Date(val);
            return d.toLocaleString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        } catch (e) { return ''; }
    }
    function _openAuth() {
        if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
    }
    /* FieldValue helper */
    function _FV() {
        return (window.firebase && window.firebase.firestore &&
                window.firebase.firestore.FieldValue) || null;
    }
    /* Firestore increment shim */
    function _inc(n) {
        var fv = _FV();
        return (fv && typeof fv.increment === 'function') ? fv.increment(n) : n;
    }
    function _serverTs() {
        var fv = _FV();
        return (fv && fv.serverTimestamp) ? fv.serverTimestamp() : new Date();
    }
    /* Safely read a count span text as int */
    function _cnt(el) { return el ? (parseInt(el.textContent || '0', 10) || 0) : 0; }


    /* ─────────────────────────────────────────────────────────────────────────
       STYLES
    ───────────────────────────────────────────────────────────────────────── */
    _ready(function () {
        if (document.getElementById('_thread_module_css_v2')) return;
        var s = document.createElement('style');
        s.id = '_thread_module_css_v2';
        s.textContent = `
/* ═══════════════════════════════════════════════════
   THREAD OVERLAY
═══════════════════════════════════════════════════ */
#vf-thread {
    position: fixed; inset: 0; z-index: 2147483647;
    background: #ffffff;
    display: flex; flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    overscroll-behavior: contain;
    /* NO isolation:isolate — that would cap child z-indexes */
}
#vf-thread.vf-open { transform: translateX(0); }
/* All interactive elements inside thread must always be clickable */
#vf-thread *        { pointer-events: auto !important; }
#vf-thread button,
#vf-thread a,
#vf-thread input,
#vf-thread textarea,
#vf-thread select   { pointer-events: auto !important; cursor: pointer !important; position: relative; z-index: 1; }
#vf-thread input,
#vf-thread textarea { cursor: text !important; }

/* Top bar */
#vf-th-topbar {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(10,14,39,0.08);
    background: rgba(255,255,255,0.95);
    backdrop-filter: blur(10px);
    flex-shrink: 0; z-index: 2;
}
#vf-th-back {
    width: 36px; height: 36px; border-radius: 50%; border: none;
    background: transparent; color: #0A0E27;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; font-size: 1rem; flex-shrink: 0;
    transition: background 0.15s;
}
#vf-th-back:hover  { background: rgba(10,14,39,0.08); }
#vf-th-back:active { background: rgba(10,14,39,0.14); }
#vf-th-topbar-title {
    font-size: 1.05rem; font-weight: 800; color: #0A0E27;
}

/* Scrollable body */
#vf-th-body {
    flex: 1; overflow-y: auto; overscroll-behavior: contain;
    padding-bottom: 90px;
}

/* ═══════════════════════════════════════════════════
   POST AREA
═══════════════════════════════════════════════════ */
#vf-th-post-area {
    padding: 16px 16px 0;
    border-bottom: 8px solid rgba(10,14,39,0.04);
}
#vf-th-post-area .story-header {
    display: flex; gap: 10px; align-items: center; margin-bottom: 12px;
}
#vf-th-post-area .avatar-placeholder,
#vf-th-post-area .avatar-placeholder img {
    width: 44px; height: 44px; border-radius: 50%; overflow: hidden; flex-shrink: 0;
}
#vf-th-post-area .avatar-placeholder img { width: 100%; height: 100%; object-fit: cover; }
#vf-th-post-area .story-user-info strong {
    display: block; font-weight: 700; color: #0A0E27; font-size: 0.95rem;
}
#vf-th-post-area .story-user-info span { font-size: 0.75rem; color: #6B7280; }
.vf-th-post-text {
    font-size: 1.15rem; line-height: 1.6; color: #0A0E27;
    margin: 0 0 16px; font-weight: 400;
}
/* FIX (report — thread view dropping every paragraph but the first):
   .vf-th-post-text is now a <div> that can contain the post's own
   multiple <p> tags (previously it was always a single <p> holding one
   flattened string) — give those inner paragraphs the same spacing
   .story-content's own multi-paragraph posts already use elsewhere,
   and drop the last one's bottom margin so it doesn't add extra gap
   before the media/timestamp that follows.
*/
.vf-th-post-text p { margin: 0 0 12px; }
.vf-th-post-text p:last-child { margin-bottom: 0; }
#vf-th-post-area .story-media-container {
    border-radius: 16px; overflow: hidden; margin-bottom: 14px;
    border: 1px solid rgba(10,14,39,0.08);
}
#vf-th-post-area .story-media-item img,
#vf-th-post-area .story-media-item video {
    width: 100%; display: block; max-height: 340px; object-fit: cover;
}

/* Full timestamp line (X shows this below the post) */
#vf-th-post-ts {
    font-size: 0.82rem; color: #6B7280; padding: 10px 0;
    border-top: 1px solid rgba(10,14,39,0.07);
    border-bottom: 1px solid rgba(10,14,39,0.07);
    margin-bottom: 4px;
}

/* Count bar (retweets · likes) */
#vf-th-count-bar {
    display: flex; gap: 20px; padding: 10px 0;
    border-bottom: 1px solid rgba(10,14,39,0.07);
}
.vf-th-count-item {
    font-size: 0.88rem; color: #6B7280; cursor: pointer;
}
.vf-th-count-item strong { color: #0A0E27; font-weight: 700; }
.vf-th-count-item:hover { text-decoration: underline; }

/* ═══════════════════════════════════════════════════
   ACTION BAR
═══════════════════════════════════════════════════ */
#vf-th-post-actions {
    display: flex; padding: 6px 0 10px;
    border-bottom: 1px solid rgba(10,14,39,0.07);
}
.vf-th-act-btn {
    flex: 1; display: flex; align-items: center; justify-content: center;
    gap: 6px; padding: 10px 4px; border: none; background: none;
    border-radius: 50%; cursor: pointer; font-size: 0.78rem;
    font-weight: 500; color: #536471;
    transition: color 0.15s;
    -webkit-tap-highlight-color: transparent;
    position: relative;
}
.vf-th-act-btn .vf-act-wrap {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 10px; border-radius: 50px;
    transition: background 0.15s;
}
.vf-th-act-btn:hover .vf-act-wrap { background: rgba(10,14,39,0.06); }
.vf-th-act-btn:active .vf-act-wrap { background: rgba(10,14,39,0.12); }
.vf-th-act-btn i, .vf-th-act-btn svg { width: 20px; height: 20px; flex-shrink: 0; }
.vf-th-act-btn.liked      .vf-act-wrap { color: #F91880; }
.vf-th-act-btn.liked      i, .vf-th-act-btn.liked svg { color: #F91880; stroke: #F91880; fill: #F91880; }
.vf-th-act-btn.retweeted  .vf-act-wrap { color: #00BA7C; }
.vf-th-act-btn.retweeted  i, .vf-th-act-btn.retweeted svg { color: #00BA7C; stroke: #00BA7C; }
.vf-th-act-btn.bookmarked .vf-act-wrap { color: #1D9BF0; }
.vf-th-act-btn.bookmarked i, .vf-th-act-btn.bookmarked svg { color: #1D9BF0; stroke: #1D9BF0; }
/* Like pop animation */
@keyframes vf-like-pop {
    0%  { transform: scale(1); }
    40% { transform: scale(1.4); }
    70% { transform: scale(0.9); }
    100%{ transform: scale(1); }
}
.vf-th-act-btn.liked i, .vf-th-act-btn.liked svg { animation: vf-like-pop 0.35s ease; }

/* ═══════════════════════════════════════════════════
   REPOST POPUP MENU (X-style)
═══════════════════════════════════════════════════ */
#vf-rt-popup {
    position: fixed; z-index: 2147483643;
    background: #fff; border-radius: 16px;
    box-shadow: 0 8px 40px rgba(10,14,39,0.18), 0 2px 8px rgba(10,14,39,0.08);
    min-width: 200px; overflow: hidden;
    animation: vfPopIn 0.15s cubic-bezier(0.34,1.56,0.64,1);
}
@keyframes vfPopIn {
    from { opacity:0; transform: scale(0.85) translateY(6px); }
    to   { opacity:1; transform: scale(1)    translateY(0);   }
}
.vf-rt-popup-item {
    display: flex; align-items: center; gap: 14px;
    padding: 16px 20px; cursor: pointer; font-size: 0.95rem;
    font-weight: 600; color: #0A0E27;
    transition: background 0.13s;
    border: none; background: none; width: 100%; text-align: left;
}
.vf-rt-popup-item:hover { background: rgba(10,14,39,0.05); }
.vf-rt-popup-item:active { background: rgba(10,14,39,0.1); }
.vf-rt-popup-item.undo  { color: #F91880; }
.vf-rt-popup-item i     { font-size: 1.05rem; width: 18px; text-align: center; }
#vf-rt-popup-backdrop {
    position: fixed; inset: 0; z-index: 2147483642;
    background: transparent;
}

/* ═══════════════════════════════════════════════════
   COMMENTS
═══════════════════════════════════════════════════ */
#vf-th-comment-hdr {
    padding: 14px 16px 6px;
    font-size: 0.88rem; font-weight: 800; color: #0A0E27;
    display: flex; align-items: center; gap: 7px;
}
#vf-th-comment-cnt { font-size: 0.78rem; font-weight: 500; color: #9CA3AF; }
#vf-th-comment-list { padding: 0 16px 16px; }

.vf-th-comment-item {
    display: flex; gap: 10px;
    padding: 12px 0;
    border-bottom: 1px solid rgba(10,14,39,0.05);
}
.vf-th-comment-item:last-child { border-bottom: none; }
.vf-th-comment-avatar {
    width: 38px; height: 38px; border-radius: 50%;
    object-fit: cover; flex-shrink: 0; margin-top: 2px; cursor: pointer;
}
.vf-th-comment-right { flex: 1; min-width: 0; }
.vf-th-comment-header {
    display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
}
.vf-th-comment-name {
    font-size: 0.88rem; font-weight: 700; color: #0A0E27;
}
.vf-th-comment-handle {
    font-size: 0.82rem; color: #536471; font-weight: 400;
}
.vf-th-comment-dot { color: #536471; font-size: 0.72rem; }
.vf-th-comment-time { font-size: 0.82rem; color: #536471; }
.vf-th-comment-text {
    margin: 4px 0 8px; font-size: 0.9rem; color: #0A0E27; line-height: 1.55;
}
.vf-th-no-comments {
    padding: 40px 16px; text-align: center;
    color: #6B7280; font-size: 0.9rem; line-height: 1.6;
}
.vf-th-no-comments i { font-size: 2.5rem; opacity: 0.15; display: block; margin-bottom: 12px; }

/* Per-comment action row */
.vf-th-comment-actions {
    display: flex; gap: 2px; margin-top: 2px;
}
.vf-th-cmt-act {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 6px 10px; border: none; background: none;
    border-radius: 50px; cursor: pointer; font-size: 0.78rem;
    font-weight: 500; color: #536471;
    transition: color 0.13s;
    -webkit-tap-highlight-color: transparent;
}
.vf-th-cmt-act:hover { color: #0A0E27; }
.vf-th-cmt-act:hover i { opacity: 0.7; }
.vf-th-cmt-act.liked     { color: #F91880; }
.vf-th-cmt-act.retweeted { color: #00BA7C; }
.vf-th-cmt-act i { font-size: 0.85rem; }

/* Sub-replies */
.vf-th-subreplies {
    margin-top: 8px; padding-left: 14px;
    border-left: 2px solid rgba(27,43,139,0.12);
}
.vf-th-subreply-item { display: flex; gap: 8px; margin-bottom: 8px; }
.vf-th-subreply-item img {
    width: 28px; height: 28px; border-radius: 50%;
    object-fit: cover; flex-shrink: 0; margin-top: 2px;
}
.vf-th-subreply-bubble { flex: 1; }
.vf-th-subreply-name { font-size: 0.8rem; font-weight: 700; color: #0A0E27; }
.vf-th-subreply-bubble p { margin: 2px 0 0; font-size: 0.85rem; color: #374151; line-height: 1.45; }

/* Sub-reply composer */
.vf-th-subreply-composer {
    display: flex; align-items: center; gap: 8px;
    margin: 8px 0 10px; padding-left: 14px;
}
.vf-th-subreply-composer img {
    width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
}
.vf-th-subreply-inp {
    flex: 1; padding: 7px 14px; border-radius: 20px;
    background: rgba(10,14,39,0.05); border: 1.5px solid rgba(10,14,39,0.1);
    font-size: 0.85rem; font-family: inherit; outline: none;
    transition: border-color 0.2s;
}
.vf-th-subreply-inp:focus { border-color: #1D9BF0; background: #fff; }
.vf-th-subreply-send {
    width: 30px; height: 30px; border-radius: 50%;
    background: #1D9BF0; border: none;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; flex-shrink: 0; color: #fff; font-size: 0.75rem;
    transition: opacity 0.18s;
}
.vf-th-subreply-send:active { opacity: 0.7; }

/* ═══════════════════════════════════════════════════
   REPLY COMPOSER (inside overlay at bottom)
═══════════════════════════════════════════════════ */
#vf-th-composer {
    flex-shrink: 0;
    display: flex; flex-direction: column; align-items: stretch; gap: 0;
    padding: 8px 14px;
    padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
    background: #fff; border-top: 1px solid rgba(10,14,39,0.09);
    box-shadow: 0 -4px 20px rgba(10,14,39,0.07);
    z-index: 2;
}
/* ── Input row: all children on ONE horizontal line ── */
#vf-th-comp-input-row {
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
    gap: 8px;
    width: 100%;
    min-width: 0;
}
#vf-th-comp-av,
#vf-th-comp-input-row #vf-th-comp-av {
    width: 36px; height: 36px; border-radius: 50%;
    object-fit: cover;
    flex: 0 0 36px !important;
}
#vf-th-comp-inp,
#vf-th-comp-input-row #vf-th-comp-inp {
    flex: 1 1 0% !important;
    min-width: 0 !important;
    max-width: none;
    padding: 10px 16px; border-radius: 24px;
    background: rgba(10,14,39,0.05); border: 1.5px solid transparent;
    font-size: 0.92rem; font-family: inherit; outline: none;
    transition: border-color 0.2s, background 0.2s;
}
#vf-th-comp-inp::placeholder { color: #9CA3AF; }
#vf-th-comp-inp:focus {
    border-color: #1D9BF0;
    background: #fff;
    box-shadow: 0 0 0 3px rgba(29,155,240,0.1);
}
#vf-th-comp-media-btn,
#vf-th-comp-input-row #vf-th-comp-media-btn {
    flex: 0 0 38px !important;
    width: 38px; height: 38px; border-radius: 50%; border: none;
    background: rgba(29,155,240,0.12); color: #1D9BF0;
    display: flex !important; align-items: center; justify-content: center;
    cursor: pointer; font-size: 1rem;
    transition: background 0.15s;
    -webkit-tap-highlight-color: transparent;
}
#vf-th-comp-media-btn:hover  { background: rgba(29,155,240,0.2); }
#vf-th-comp-media-btn:active { background: rgba(29,155,240,0.3); }
#vf-th-comp-send,
#vf-th-comp-input-row #vf-th-comp-send {
    flex: 0 0 38px !important;
    width: 38px; height: 38px; border-radius: 50%; border: none;
    background: #1D9BF0; color: #fff;
    display: flex !important; align-items: center; justify-content: center;
    cursor: pointer; font-size: 0.95rem;
    transition: opacity 0.18s, transform 0.15s;
    box-shadow: 0 2px 8px rgba(29,155,240,0.4);
}
#vf-th-comp-send:active { opacity: 0.85; transform: scale(0.93); }
#vf-th-comp-send:disabled { background: #93C5FD; cursor: default; }

/* ═══════════════════════════════════════════════════
   QUOTE TWEET MODAL
═══════════════════════════════════════════════════ */
#vf-th-quote-modal {
    position: fixed; inset: 0; z-index: 2147483641;
    background: rgba(10,14,39,0.55);
    backdrop-filter: blur(4px);
    display: none; align-items: flex-end; justify-content: center;
}
#vf-th-quote-modal.vf-open { display: flex; }
#vf-th-quote-inner {
    background: #fff; border-radius: 20px 20px 0 0;
    width: 100%; max-width: 600px;
    padding: 0 0 calc(20px + env(safe-area-inset-bottom, 0px));
    display: flex; flex-direction: column;
    animation: vfSlideUp 0.26s cubic-bezier(0.34,1.56,0.64,1);
    max-height: 85vh; overflow: hidden;
}
@keyframes vfSlideUp {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
}
#vf-th-quote-topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px 12px;
    border-bottom: 1px solid rgba(10,14,39,0.08);
    flex-shrink: 0;
}
#vf-th-quote-topbar h4 {
    margin: 0; font-size: 1rem; font-weight: 800; color: #0A0E27;
}
#vf-th-quote-close {
    width: 32px; height: 32px; border-radius: 50%; border: none;
    background: rgba(10,14,39,0.06); color: #374151;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; font-size: 0.9rem; transition: background 0.15s;
}
#vf-th-quote-close:hover { background: rgba(10,14,39,0.12); }
/* Composer row at top of modal (avatar + textarea) */
#vf-th-quote-compose-row {
    display: flex; gap: 10px; padding: 14px 20px 0;
    flex-shrink: 0;
}
#vf-th-quote-comp-av {
    width: 38px; height: 38px; border-radius: 50%;
    object-fit: cover; flex-shrink: 0;
}
#vf-th-quote-inp {
    flex: 1; padding: 8px 0;
    border: none; outline: none; resize: none;
    font-size: 0.95rem; font-family: inherit;
    line-height: 1.5; min-height: 72px;
    background: transparent; color: #0A0E27;
}
#vf-th-quote-inp::placeholder { color: #9CA3AF; }
/* Embedded quoted post preview inside modal */
#vf-th-quote-preview {
    position: relative; overflow: hidden;
    margin: 10px 20px 0;
    border: 1px solid rgba(10,14,39,0.09); border-radius: 16px;
    padding: 12px 14px 12px 18px; font-size: 0.85rem; color: #374151;
    line-height: 1.5; flex-shrink: 0;
    background: #fff; box-shadow: 0 1px 2px rgba(10,14,39,0.05), 0 8px 20px rgba(10,14,39,0.07);
}
#vf-th-quote-preview::before {
    content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 4px;
    background: linear-gradient(180deg,#1B2B8B,#5B0EA6 60%,#C9A66B);
}
#vf-th-quote-preview .vf-qt-prev-author {
    font-weight: 700; color: #0A0E27; font-size: 0.85rem; margin-bottom: 3px;
    display: flex; align-items: center; gap: 6px;
}
#vf-th-quote-preview .vf-qt-prev-author img {
    width: 26px; height: 26px; border-radius: 50%; object-fit: cover;
    border: 2px solid #fff; box-shadow: 0 0 0 1.5px rgba(201,166,107,0.85);
}
#vf-th-quote-preview .vf-qt-prev-text {
    color: #374151; font-size: 0.85rem; line-height: 1.55;
    display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
    overflow: hidden; max-height: calc(1.55em * 4);
}
#vf-th-quote-preview .vf-qt-prev-img {
    width: 100%; border-radius: 10px; margin-top: 8px;
    aspect-ratio: 16 / 9; object-fit: cover; display: block;
}
/* FIX (2026-09-16 — "integrate exactly the code and maintain the
   quality"): quoting a VIDEO post previously showed no media at all in
   this modal's preview — _openQuote() only ever looked for an <img>
   (see .vf-qt-prev-img above), so a video post's preview silently
   dropped the media even though _doSubmitQuote() further down already
   captures the video src correctly for the actual persisted card. This
   gives the pre-submit preview the same 16:9 frosted-play-button
   treatment as the feed's own vf-quote-video-wrap (app-feed.js) so the
   compose modal doesn't look like a downgrade from what the person is
   about to post. Reuses the vf-quote-video-wrap/vf-quote-embed-img/
   vf-quote-play-btn class names on purpose — app-feed.js injects the
   shared rules for those into <head> the first time any quote card
   renders, and _wireQuoteModal() below now also guarantees they exist
   even if no quote card has rendered yet this session (e.g. the very
   first quote of a fresh page load). */
#vf-th-quote-preview .vf-qt-prev-video-wrap {
    margin-top: 8px; border-radius: 10px; overflow: hidden;
}
/* Bottom action row */
#vf-th-quote-actions {
    display: flex; align-items: center; justify-content: flex-end;
    padding: 10px 20px 0;
    border-top: 1px solid rgba(10,14,39,0.08);
    margin-top: 12px; flex-shrink: 0;
}
.vf-th-quote-submit {
    padding: 9px 22px; border-radius: 24px; border: none;
    background: #0A0E27; color: #fff;
    font-size: 0.9rem; font-weight: 700; cursor: pointer;
    display: inline-flex; align-items: center; gap: 7px;
    transition: opacity 0.18s, transform 0.15s;
}
.vf-th-quote-submit:hover  { opacity: 0.88; }
.vf-th-quote-submit:active { opacity: 0.8; transform: scale(0.97); }

/* ═══════════════════════════════════════════════════
   FEED — RETWEET LABEL ("You reposted")
═══════════════════════════════════════════════════ */
.vf-retweet-label {
    display: flex; align-items: center; gap: 7px;
    font-size: 0.78rem; font-weight: 600; color: #536471;
    padding: 6px 12px 2px;
    margin-bottom: -4px;
}
.vf-retweet-label i { font-size: 0.82rem; }
/* Quote embed block inside a feed post card */
.vf-quote-embed {
    border: 1.5px solid rgba(10,14,39,0.12); border-radius: 14px;
    padding: 12px 14px; margin: 8px 0;
    background: rgba(10,14,39,0.02); cursor: pointer;
    transition: background 0.15s;
}
.vf-quote-embed:hover { background: rgba(10,14,39,0.04); }
.vf-quote-embed-author {
    display: flex; align-items: center; gap: 6px;
    font-size: 0.83rem; font-weight: 700; color: #0A0E27;
    margin-bottom: 4px;
}
.vf-quote-embed-author img {
    width: 18px; height: 18px; border-radius: 50%; object-fit: cover;
}
.vf-quote-embed-handle { font-weight: 400; color: #536471; }
.vf-quote-embed-text {
    font-size: 0.85rem; color: #374151; line-height: 1.5;
    display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
    overflow: hidden;
}
.vf-quote-embed::after {
    content: 'Tap to read full post ↗';
    display: block;
    font-size: 0.72rem; color: #1D9BF0; font-weight: 600;
    margin-top: 6px;
}
.vf-quote-embed-img {
    width: 100%; border-radius: 10px; margin-top: 8px;
    max-height: 200px; object-fit: cover; display: block;
}
/* ═══════════════════════════════════════════════════
   HIDE NAV WHILE THREAD OPEN
═══════════════════════════════════════════════════ */
body.vf-thread-open #mobile-bottom-nav   { display: none !important; }
body.vf-thread-open .mobile-menu-toggle  { display: none !important; }

/* ═══════════════════════════════════════════════════
   SHARE SHEET
═══════════════════════════════════════════════════ */
#vf-share-sheet {
    position: fixed; inset: 0; z-index: 2147483644;
    background: rgba(10,14,39,0.55);
    backdrop-filter: blur(4px);
    display: none; align-items: flex-end; justify-content: center;
}
#vf-share-sheet.vf-open { display: flex; }
#vf-share-inner {
    background: #fff; border-radius: 20px 20px 0 0;
    width: 100%; max-width: 600px;
    padding: 0 0 calc(20px + env(safe-area-inset-bottom, 0px));
    animation: vfSlideUp 0.26s cubic-bezier(0.34,1.56,0.64,1);
}
#vf-share-handle {
    width: 36px; height: 4px; border-radius: 2px;
    background: rgba(10,14,39,0.15);
    margin: 12px auto 0;
}
#vf-share-title {
    font-size: 0.82rem; font-weight: 700; color: #6B7280;
    text-align: center; padding: 10px 20px 6px;
    text-transform: uppercase; letter-spacing: 0.06em;
}
#vf-share-preview {
    margin: 0 16px 12px;
    padding: 10px 14px;
    border: 1.5px solid rgba(10,14,39,0.1);
    border-radius: 12px;
    font-size: 0.85rem; color: #374151; line-height: 1.45;
    background: rgba(10,14,39,0.02);
    max-height: 56px; overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
#vf-share-grid {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 6px 0; padding: 4px 12px 10px;
}
.vf-share-app {
    display: flex; flex-direction: column; align-items: center;
    gap: 7px; padding: 12px 6px; border: none; background: none;
    cursor: pointer; border-radius: 14px;
    transition: background 0.15s;
    -webkit-tap-highlight-color: transparent;
}
.vf-share-app:hover  { background: rgba(10,14,39,0.05); }
.vf-share-app:active { background: rgba(10,14,39,0.1); }
.vf-share-app-icon {
    width: 52px; height: 52px; border-radius: 14px;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.5rem; color: #fff; flex-shrink: 0;
}
.vf-share-app-label {
    font-size: 0.72rem; font-weight: 600; color: #374151;
    text-align: center; line-height: 1.2;
}
#vf-share-copy-row {
    margin: 0 16px;
    display: flex; align-items: center; gap: 10px;
    padding: 12px 14px;
    border: 1.5px solid rgba(10,14,39,0.1);
    border-radius: 14px; background: rgba(10,14,39,0.02);
}
#vf-share-url-txt {
    flex: 1; font-size: 0.82rem; color: #536471;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#vf-share-copy-btn {
    padding: 7px 16px; border-radius: 20px; border: none;
    background: #0A0E27; color: #fff;
    font-size: 0.82rem; font-weight: 700; cursor: pointer;
    flex-shrink: 0; transition: opacity 0.18s;
}
#vf-share-copy-btn:active { opacity: 0.75; }
#vf-share-cancel {
    display: block; width: calc(100% - 32px);
    margin: 10px 16px 0;
    padding: 13px; border: none; border-radius: 14px;
    background: rgba(10,14,39,0.06); color: #0A0E27;
    font-size: 0.95rem; font-weight: 700; cursor: pointer;
    transition: background 0.15s;
}
#vf-share-cancel:active { background: rgba(10,14,39,0.12); }

/* ═══════════════════════════════════════════════════
   QUOTED POST FULL-VIEW MODAL
═══════════════════════════════════════════════════ */
#vf-quote-full-modal {
    position: fixed; inset: 0; z-index: 2147483645;
    background: var(--bg, #fff);
    display: flex; flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    overscroll-behavior: contain;
}
#vf-quote-full-modal.vf-open { transform: translateX(0); }
#vf-qfm-topbar {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(10,14,39,0.08);
    background: rgba(255,255,255,0.95);
    backdrop-filter: blur(10px);
    flex-shrink: 0;
}
#vf-qfm-back {
    width: 36px; height: 36px; border-radius: 50%; border: none;
    background: transparent; color: #0A0E27;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; font-size: 1rem; flex-shrink: 0;
    transition: background 0.15s;
}
#vf-qfm-back:hover  { background: rgba(10,14,39,0.08); }
#vf-qfm-title {
    font-size: 1.05rem; font-weight: 800; color: #0A0E27;
}
#vf-qfm-body {
    flex: 1; overflow-y: auto; overscroll-behavior: contain;
    padding: 16px;
}
.vf-qfm-author-row {
    display: flex; gap: 12px; align-items: center; margin-bottom: 14px;
}
.vf-qfm-avatar {
    width: 46px; height: 46px; border-radius: 50%;
    object-fit: cover; flex-shrink: 0;
}
.vf-qfm-author-name {
    font-size: 0.95rem; font-weight: 700; color: #0A0E27; display: block;
}
.vf-qfm-author-time {
    font-size: 0.78rem; color: #6B7280;
}
.vf-qfm-text {
    font-size: 1.1rem; line-height: 1.65; color: #0A0E27;
    margin: 0 0 16px; font-weight: 400; white-space: pre-wrap;
}
.vf-qfm-media {
    width: 100%; border-radius: 16px; overflow: hidden;
    margin-bottom: 14px; border: 1px solid rgba(10,14,39,0.08);
}
.vf-qfm-media img, .vf-qfm-media video {
    width: 100%; display: block; max-height: 380px; object-fit: cover;
}
.vf-qfm-sep {
    border: none; border-top: 1px solid rgba(10,14,39,0.07); margin: 10px 0;
}

/* ═══════════════════════════════════════════════════
   REPLY COMPOSER — MEDIA UPLOAD
═══════════════════════════════════════════════════ */
/* Media preview strip — full width row above input row */
#vf-th-media-preview-row {
    display: none;
    width: 100%;
    gap: 8px;
    padding: 6px 0 4px;
    align-items: flex-start;
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
}
#vf-th-media-preview-row.has-media { display: flex; }
.vf-th-media-thumb {
    position: relative; flex-shrink: 0;
    width: 72px; height: 72px; border-radius: 10px;
    overflow: hidden; border: 1.5px solid rgba(10,14,39,0.12);
    background: rgba(10,14,39,0.04);
}
.vf-th-media-thumb img,
.vf-th-media-thumb video {
    width: 100%; height: 100%; object-fit: cover; display: block;
}
.vf-th-media-thumb-remove {
    position: absolute; top: 3px; right: 3px;
    width: 18px; height: 18px; border-radius: 50%;
    background: rgba(10,14,39,0.7); color: #fff;
    border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.6rem; line-height: 1;
    padding: 0;
}
.vf-th-media-thumb-remove:active { background: rgba(10,14,39,0.9); }
/* Video play badge */
.vf-th-media-thumb-vid::after {
    content: '\f144';
    font-family: 'Font Awesome 5 Free';
    font-weight: 900;
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.85); font-size: 1.5rem;
    pointer-events: none;
}
/* Upload progress overlay on thumb */
.vf-th-media-thumb-progress {
    position: absolute; inset: 0;
    background: rgba(10,14,39,0.55);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 4px;
}
.vf-th-media-thumb-progress-bar {
    width: 80%; height: 3px; background: rgba(255,255,255,0.3);
    border-radius: 2px; overflow: hidden;
}
.vf-th-media-thumb-progress-fill {
    height: 100%; background: #1D9BF0;
    border-radius: 2px; transition: width 0.2s;
    width: 0%;
}
.vf-th-media-thumb-progress span {
    font-size: 0.6rem; color: #fff; font-weight: 700;
}
/* (media-btn styles consolidated into composer block above) */
/* Media inside a rendered comment */
.vf-th-comment-media {
    margin: 8px 0 4px;
    border-radius: 12px; overflow: hidden;
    border: 1px solid rgba(10,14,39,0.08);
    max-height: 260px;
}
.vf-th-comment-media img,
.vf-th-comment-media video {
    width: 100%; display: block;
    max-height: 260px; object-fit: cover;
}
.vf-th-comment-media video { cursor: pointer; }
`;
        document.head.appendChild(s);
    });


    /* ─────────────────────────────────────────────────────────────────────────
       STATE
    ───────────────────────────────────────────────────────────────────────── */
    var _activePostId      = null;   /* Firestore doc id of the open post */
    var _activePostEl      = null;   /* DOM .impact-story element */
    var _rtPopupTarget     = null;   /* The repost button that triggered the popup */
    var _rtPopupSourceCard = null;   /* The .impact-story the popup is for */
    var _unsubComments     = null;   /* Firestore onSnapshot unsubscribe for comments */
    var _unsubCounts       = null;   /* Firestore onSnapshot unsubscribe for like/rt counts */
    /* Media upload state for reply composer */
    var _pendingMedia      = [];     /* Array of { file, objectUrl, uploaded:bool, url:'', type:'' } */


    /* ─────────────────────────────────────────────────────────────────────────
       BUILD DOM (once)
    ───────────────────────────────────────────────────────────────────────── */
    function _buildOverlay() {
        if (document.getElementById('vf-thread')) return;

        /* Thread overlay */
        var ov = document.createElement('div');
        ov.id = 'vf-thread';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.setAttribute('aria-label', 'Post Thread');

        /* Top bar */
        var topbar = document.createElement('div');
        topbar.id = 'vf-th-topbar';
        topbar.innerHTML =
            '<button id="vf-th-back" aria-label="Back"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>' +
            '<span id="vf-th-topbar-title">Post</span>';
        ov.appendChild(topbar);

        /* Scrollable body */
        var body = document.createElement('div');
        body.id = 'vf-th-body';
        body.innerHTML =
            '<div id="vf-th-post-area"></div>' +
            '<div id="vf-th-comment-hdr">Replies <span id="vf-th-comment-cnt"></span></div>' +
            '<div id="vf-th-comment-list"></div>';
        ov.appendChild(body);

        /* Reply composer — flex child at bottom of overlay */
        var composer = document.createElement('div');
        composer.id = 'vf-th-composer';
        composer.innerHTML =
            '<div id="vf-th-media-preview-row"></div>' +
            '<div id="vf-th-comp-input-row">' +
                '<img id="vf-th-comp-av" src="" alt="You" onerror="this.src=\'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=80\'">' +
                '<input id="vf-th-comp-inp" type="text" placeholder="Post your reply…" autocomplete="off">' +
                '<button id="vf-th-comp-media-btn" type="button" aria-label="Attach photo or video"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></button>' +
                '<input id="vf-th-comp-file" type="file" accept="image/*,video/*" multiple style="display:none" aria-hidden="true">' +
                '<button id="vf-th-comp-send" aria-label="Send reply"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
            '</div>';
        ov.appendChild(composer);

        document.body.appendChild(ov);

        /* Quote modal — separate body child so it can sit above the overlay */
        if (!document.getElementById('vf-th-quote-modal')) {
            var qm = document.createElement('div');
            qm.id = 'vf-th-quote-modal';
            qm.innerHTML =
                '<div id="vf-th-quote-inner">' +
                    '<div id="vf-th-quote-topbar">' +
                        '<h4>Quote</h4>' +
                        '<button id="vf-th-quote-close" aria-label="Close"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
                    '</div>' +
                    '<div id="vf-th-quote-compose-row">' +
                        '<img id="vf-th-quote-comp-av" src="" alt="You" ' +
                            'onerror="this.src=\'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=80\'">' +
                        '<textarea id="vf-th-quote-inp" placeholder="Add a comment!" rows="3"></textarea>' +
                    '</div>' +
                    '<div id="vf-th-quote-preview"></div>' +
                    '<div id="vf-th-quote-actions">' +
                        '<button class="vf-th-quote-submit">' +
                            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Post' +
                        '</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(qm);
        }

        _wireOverlay(ov, composer);
    }


    /* ─────────────────────────────────────────────────────────────────────────
       WIRE
    ───────────────────────────────────────────────────────────────────────── */
    function _wireOverlay(ov, composer) {
        /* Back */
        ov.querySelector('#vf-th-back').addEventListener('click', _close);

        /* Reply send */
        var inp      = composer.querySelector('#vf-th-comp-inp');
        var send     = composer.querySelector('#vf-th-comp-send');
        var mediaBtn = composer.querySelector('#vf-th-comp-media-btn');
        var fileInp  = composer.querySelector('#vf-th-comp-file');

        function _updateSendState() {
            var hasText  = !!(inp.value || '').trim();
            var hasMedia = _pendingMedia.length > 0;
            send.disabled = !(hasText || hasMedia);
        }

        send.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            _sendReply();
        });
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendReply(); }
        });
        inp.addEventListener('input', _updateSendState);
        send.disabled = true;

        /* Media picker button triggers hidden file input */
        if (mediaBtn && fileInp) {
            mediaBtn.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                if (_isGuest()) { _openAuth(); return; }
                fileInp.click();
            });
            fileInp.addEventListener('change', function () {
                var files = Array.from(fileInp.files || []);
                if (!files.length) return;
                files.forEach(function (file) {
                    /* Limit: 4 attachments max */
                    if (_pendingMedia.length >= 4) {
                        _notify('Maximum 4 attachments per reply.', 'warning');
                        return;
                    }
                    var objectUrl = URL.createObjectURL(file);
                    var isVideo   = file.type.startsWith('video/');
                    _pendingMedia.push({ file: file, objectUrl: objectUrl, uploaded: false, url: '', type: isVideo ? 'video' : 'image' });
                    _addMediaThumb(_pendingMedia[_pendingMedia.length - 1]);
                });
                /* Reset so same file can be re-selected */
                fileInp.value = '';
                _updateSendState();
            });
        }

        /* Wire quote modal (may be injected later) */
        setTimeout(_wireQuoteModal, 0);

        /* Escape closes */
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { _closeRtPopup(); _closeQuote(); _close(); }
        });
    }

    function _wireQuoteModal() {
        var qm = document.getElementById('vf-th-quote-modal');
        if (!qm || qm._tWired) return;
        qm._tWired = true;

        qm.querySelector('#vf-th-quote-close').addEventListener('click', _closeQuote);
        qm.addEventListener('click', function (e) { if (e.target === qm) _closeQuote(); });

        var submitBtn = qm.querySelector('.vf-th-quote-submit');
        submitBtn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            /* Honour any mining wrapper installed by app-fix-final.js §43 */
            if (typeof window._submitQuote === 'function' && window._submitQuote !== _doSubmitQuote) {
                window._submitQuote();
            } else {
                _doSubmitQuote();
            }
        });

        var ta = qm.querySelector('#vf-th-quote-inp');
        if (ta && !ta._tKeyWired) {
            ta._tKeyWired = true;
            ta.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    if (typeof window._submitQuote === 'function' && window._submitQuote !== _doSubmitQuote) {
                        window._submitQuote();
                    } else {
                        _doSubmitQuote();
                    }
                }
            });
        }
    }


    /* ─────────────────────────────────────────────────────────────────────────
       OPEN / CLOSE THREAD
    ───────────────────────────────────────────────────────────────────────── */
    /* ─────────────────────────────────────────────────────────────────────────
       THREAD SHIELD — disables every fixed/absolute overlay that could sit
       above or intercept clicks on #vf-thread while it is open.
       Stores original styles and fully restores them on _close().
    ───────────────────────────────────────────────────────────────────────── */
    /* ── NO SHIELD. #vf-thread wins purely via z-index (CSS) ── */
    /* VFS video pause/resume still happens — just not pointer-events hijacking */
    function _shieldThread() {
        /* Pause VFS video playback while thread is open — no pointer-events changes */
        if (typeof window._vfsPauseForThread === 'function') window._vfsPauseForThread();
    }

    function _unshieldThread() {
        /* Resume VFS video when thread closes */
        if (typeof window._vfsResumeFromThread === 'function') window._vfsResumeFromThread();
        try { document.dispatchEvent(new CustomEvent('vfs:threadClosed')); } catch(ex) {}
        /* Restore mobile nav in case it was hidden */
        var nav = document.getElementById('mobile-bottom-nav');
        if (nav) nav.style.removeProperty('display');
    }

    /* Exposed so other modules (e.g. app-suggested-contacts.js's "You've
       Been Tagged" row, or any future notification-style UI) can open a
       specific post's full view without needing to know app-thread.js's
       internals — see window.openPostById below for the id-based entry
       point most callers actually want. */
    window.openThread = openThread;

    /**
     * Open a post's full thread view given only its id — the thing a
     * notification or a "You've Been Tagged" row actually has, rather than
     * a DOM element. Handles the post not currently being rendered (e.g.
     * user isn't on the feed, or the post has scrolled out of the
     * Firestore listener's most-recent-40 window) by navigating to the
     * feed, polling briefly for the card to appear, and — if it still
     * hasn't shown up — falling back to a direct Firestore read.
     *
     * @param {string} postId
     */
    window.openPostById = function openPostById(postId) {
        if (!postId) {
            if (typeof window.showNotification === 'function') {
                window.showNotification("Couldn't find that post.", 'info');
            }
            return;
        }

        function _findEl() {
            return document.querySelector('.impact-story[data-post-id="' + postId + '"]');
        }

        function _openIt(el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(function () { openThread(el); }, 250);
        }

        var existing = _findEl();
        if (existing) { _openIt(existing); return; }

        /* Not currently rendered — go to the feed and poll for it.
           Posts collection listener only keeps the most recent 40, so an
           older post genuinely may never appear via the listener — give
           it a few seconds, then fall back to a direct Firestore read
           (below) instead of just telling the person it's missing. */
        if (typeof window.navigateTo === 'function') window.navigateTo('dashboard');

        /* FIX (2026-10-28 — shared photo/video link sat on the dashboard for ~10s before opening): the feed
           listener only keeps the most recent posts, so waiting the full 10s for the card was dead time for
           anything older. Poll ~1.5s (enough for a card the listener is about to render), then go straight to the
           direct Firestore read — _fetchAndOpenPostDirect already de-dupes if the listener catches up meanwhile. */
        var attempts = 0;
        var maxAttempts = 3; // ~1.5s at 500ms (was 20 / ~10s)
        var poll = setInterval(function () {
            attempts++;
            var el = _findEl();
            if (el) {
                clearInterval(poll);
                _openIt(el);
                return;
            }
            if (attempts >= maxAttempts) {
                clearInterval(poll);
                _fetchAndOpenPostDirect(postId);
            }
        }, 500);
    };

    /* FIX (2026-08-08 — shared post links landed on the dashboard instead
       of the post): the 40-doc live feed listener never rendered an older
       post, so openPostById's own poll above always timed out and just
       told the person it "couldn't be found." Mirrors the same "poll
       first, then fall back to a direct Firestore read" shape already
       used by app-status.js's _fetchAndOpenStatusDirect() and
       app-news.js's openNewsArticleById() for the identical class of
       problem — and builds the card with the exact same construction
       app-feed.js's own posts listener uses for a freshly-added doc (see
       its 'added' branch), so a directly-fetched post renders identically
       to one the listener picked up normally, and stays in sync with any
       later 'modified' events for the same id. */
    function _fetchAndOpenPostDirect(postId) {
        if (!window._firebaseLoaded || !window.fbDb) {
            if (typeof window.showNotification === 'function') {
                window.showNotification("That post couldn't be found — it may be older than the current feed, or may have been deleted.", 'info');
            }
            return;
        }
        window.fbDb.collection('posts').doc(postId).get().then(function (doc) {
            if (!doc.exists) {
                if (typeof window.showNotification === 'function') {
                    window.showNotification("That post couldn't be found — it may have been deleted.", 'info');
                }
                return;
            }
            /* The listener may have caught up while the direct read was in
               flight — don't render a second copy of the same card. */
            var already = document.querySelector('.impact-story[data-post-id="' + postId + '"]');
            if (already) {
                already.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(function () { openThread(already); }, 250);
                return;
            }
            if (typeof window.createNewPostElement !== 'function') {
                if (typeof window.showNotification === 'function') {
                    window.showNotification("That post couldn't be found.", 'info');
                }
                return;
            }

            var post = doc.data() || {};
            post.id = post.id || doc.id;

            var media = (post.media || [])
                .filter(function (u) { return u && !u.startsWith('blob:'); })
                .map(function (u) {
                    return {
                        _cloudUrl: u, url: u,
                        type: (/\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(u) || /\/video\/upload\//i.test(u))
                            ? 'video/mp4' : 'image/jpeg'
                    };
                });
            var av = post.avatar
                || ('https://ui-avatars.com/api/?name='
                    + encodeURIComponent(post.username || 'U')
                    + '&background=5B0EA6&color=fff&size=150');
            var el = window.createNewPostElement(
                post.text || '', media,
                {
                    id: post.userId,
                    fullName: post.username || post.authorName || post.retweeterName || 'User',
                    avatar: av
                }
            );
            el.dataset.postId = post.id;
            el.dataset.userId = post.userId;

            var tsEl = el.querySelector('.story-user-info span');
            if (tsEl && post.createdAt) {
                var _createdDate = (post.createdAt && typeof post.createdAt.toDate === 'function')
                    ? post.createdAt.toDate()   // Firestore Timestamp object
                    : new Date(post.createdAt); // ISO string / number / already a Date
                if (!isNaN(_createdDate.getTime())) {
                    tsEl.textContent = _createdDate.toLocaleString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                    });
                }
            }
            var fmt = function (n) { return n > 0 ? new Intl.NumberFormat().format(n) : ''; };
            var lc = el.querySelector('.like-count');     if (lc) lc.textContent = fmt(post.likes || 0);
            var rc = el.querySelector('.retweet-count');  if (rc) rc.textContent = fmt(post.retweetCount || post.retweets || 0);
            var qc = el.querySelector('.quote-count');    if (qc) qc.textContent = fmt(post.quoteCount || 0);
            var sc = el.querySelector('.share-count');    if (sc) sc.textContent = fmt(post.shareCount || 0);
            var dc = el.querySelector('.download-count'); if (dc) dc.textContent = fmt(post.downloadCount || 0);
            var vc = el.querySelector('.view-count');     if (vc) vc.textContent = fmt(post.views || 0);
            var cc = el.querySelector('.comment-count');  if (cc) cc.textContent = fmt(post.commentCount || 0);

            var fc = document.getElementById('feed-container');
            if (fc) {
                fc.appendChild(el);
                var es = document.getElementById('feed-empty-state');
                if (es) es.style.display = 'none';
            }

            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(function () { openThread(el); }, 250);
        }).catch(function (err) {
            console.warn('[Thread] direct fetch for deep link failed:', err && err.message);
            if (typeof window.showNotification === 'function') {
                window.showNotification("Couldn't load that post — please try again.", 'error');
            }
        });
    }

    function openThread(postEl) {
        if (!postEl) return;
        _buildOverlay();
        _wireQuoteModal();

        /* Detach previous listeners */
        if (typeof _unsubComments === 'function') { _unsubComments(); _unsubComments = null; }
        if (typeof _unsubCounts   === 'function') { _unsubCounts();   _unsubCounts   = null; }

        _activePostEl = postEl;
        _activePostId = postEl.dataset.postId || postEl.dataset.id || null;

        // FIX (live count): opening a post in the detail view never counted
        // as a "view" — only scrolling past it in the feed did (the
        // IntersectionObserver in app-fixes.js). Visiting/reading a post
        // directly is at least as strong a signal as a scroll-by, so it
        // should increment views too. Deduped per session the same way the
        // feed observer dedupes, so repeatedly re-opening the same post in
        // one sitting doesn't inflate the count.
        _registerThreadView(_activePostId, postEl);

        /* Populate post area */
        var area = document.getElementById('vf-th-post-area');
        area.innerHTML = '';
        _renderPostArea(area, postEl);
        /* Stamp postId here (not just kept in the private _activePostId
           closure var above) so other modules — e.g. app-feed.js's
           comment-section advert injector — can read which thread is
           currently open straight off the DOM, the same way that module
           already reads #profile-follower-count instead of reaching into
           app-profile.js's internals. */
        area.dataset.postId = _activePostId || '';

        /* Load comments */
        _loadComments();

        /* Subscribe to live counts */
        _subscribeCounts();

        /* Composer avatar */
        var u = _us();
        var av = document.getElementById('vf-th-comp-av');
        if (av) av.src = _avatar(u);

        /* Shield ALL overlays that could intercept thread touches — MUST happen
           before classList.add('vf-open') so the thread is already highest z */
        _shieldThread();

        /* Open UI */
        var ov = document.getElementById('vf-thread');
        ov.classList.add('vf-open');
        document.body.classList.add('vf-thread-open');

        var body = document.getElementById('vf-th-body');
        if (body) body.scrollTop = 0;
    }
    window._vfOpenThread = openThread;

    function _close() {
        var ov = document.getElementById('vf-thread');
        if (ov) ov.classList.remove('vf-open');
        document.body.classList.remove('vf-thread-open');

        var inp = document.getElementById('vf-th-comp-inp');
        if (inp) { inp.value = ''; }
        var send = document.getElementById('vf-th-comp-send');
        if (send) send.disabled = true;

        /* Clear any pending media attachments */
        _clearPendingMedia();

        if (typeof _unsubComments === 'function') { _unsubComments(); _unsubComments = null; }
        if (typeof _unsubCounts   === 'function') { _unsubCounts();   _unsubCounts   = null; }

        /* Unshield all overlays that were blocked during thread view */
        _unshieldThread();

        var _closedArea = document.getElementById('vf-th-post-area');
        if (_closedArea) _closedArea.dataset.postId = '';

        _activePostId = null;
        _activePostEl = null;
    }
    window._vfCloseThread = _close;


    /* ─────────────────────────────────────────────────────────────────────────
       RENDER POST AREA
    ───────────────────────────────────────────────────────────────────────── */
    function _renderPostArea(area, postEl) {
        /* Clone header (avatar + name) */
        var header = postEl.querySelector('.story-header');
        if (header) area.appendChild(header.cloneNode(true));

        /* Post text — rendered larger like X thread view */
        // FIX (report — "the full and complete post text was not fully
        // displayed... only the first paragraph appears", and separately
        // "understanding firstAn ignorant man" merging two lines with no
        // space between them): this used to grab ONLY the FIRST <p> found
        // anywhere inside .story-content (querySelector returns a single
        // element) and copy it with .textContent. Two things got lost:
        //   1. A post with multiple paragraphs has more than one <p> —
        //      app-fixes.js's _empInitLineClamp wraps 2+ of them into one
        //      .post-text-wrap div once it's had a chance to run, but
        //      even before that they're just multiple direct <p> siblings
        //      of .story-content. Either way, querySelector's single
        //      result only ever returned the FIRST one — every later
        //      paragraph (here, the whole numbered list) was silently
        //      dropped, not just hidden/truncated.
        //   2. Even within that one captured <p>, a <br> line break
        //      contributes nothing to .textContent — it isn't a space or
        //      a newline, it's simply skipped — so "...understanding
        //      first" and "An ignorant man..." (two lines separated by a
        //      <br> in the same paragraph) got concatenated with no
        //      separator at all.
        // Fixed by cloning the ENTIRE .story-content (which always has
        // every paragraph, wrapped or not) and using its real innerHTML
        // instead of flattening to one .textContent string, so every
        // paragraph and every line break survives exactly as authored.
        // The feed card's own "Show more" toggle button (also a child of
        // .story-content) and any inline clamp height/overflow it applied
        // are stripped from the clone — the thread view is the full,
        // already-expanded reading view, so neither is relevant here.
        var storyContent = postEl.querySelector('.story-content');
        var contentEl = storyContent || postEl.querySelector('.post-text');
        if (contentEl) {
            var _contentClone = contentEl.cloneNode(true);
            var _toggle = _contentClone.querySelector('.post-expand-toggle');
            if (_toggle) _toggle.remove();
            var _clamped = _contentClone.querySelector('.post-text-wrap') || _contentClone.querySelector('p') || _contentClone;
            _clamped.style.maxHeight = '';
            _clamped.style.overflow = '';
            var p = document.createElement('div');
            p.className = 'vf-th-post-text';
            p.innerHTML = _contentClone.innerHTML;
            area.appendChild(p);
        }

        /* Quote embed (if this is a quote post) */
        var existingEmbed = postEl.querySelector('.vf-quote-embed');
        if (existingEmbed) {
            var clonedEmbed = existingEmbed.cloneNode(true);
            /* Stamp data attributes so full-view modal can reconstruct faithfully */
            if (!clonedEmbed.dataset.origAuthor) {
                var _eaEl = existingEmbed.querySelector('.vf-quote-embed-author');
                var _etEl = existingEmbed.querySelector('.vf-quote-embed-text');
                var _eiEl = existingEmbed.querySelector('.vf-quote-embed-img');
                var _eavEl = existingEmbed.querySelector('.vf-quote-embed-author img');
                if (_eaEl) clonedEmbed.dataset.origAuthor = _eaEl.textContent.trim();
                if (_etEl) clonedEmbed.dataset.origText   = _etEl.textContent.trim();
                if (_eiEl) clonedEmbed.dataset.origImg    = _eiEl.src || '';
                if (_eavEl) clonedEmbed.dataset.origAvatar = _eavEl.src || '';
            }
            area.appendChild(clonedEmbed);
        }

        /* Media */
        var media = postEl.querySelector('.story-media-container');
        if (media) area.appendChild(media.cloneNode(true));

        /* Full timestamp line */
        var ts = document.createElement('div');
        ts.id = 'vf-th-post-ts';
        var rawTs = postEl.querySelector('.story-user-info span');
        ts.textContent = rawTs ? rawTs.textContent : _tsFull(new Date());
        area.appendChild(ts);

        /* Count bar — retweets · likes */
        var rtEl    = postEl.querySelector('.retweet-count');
        var likeEl  = postEl.querySelector('.like-count');
        var rtCount = _cnt(rtEl);
        var lkCount = _cnt(likeEl);

        var countBar = document.createElement('div');
        countBar.id = 'vf-th-count-bar';
        countBar.innerHTML =
            '<span class="vf-th-count-item" id="vf-th-rt-count">' +
                '<strong>' + rtCount + '</strong> Reposts</span>' +
            '<span class="vf-th-count-item" id="vf-th-lk-count">' +
                '<strong>' + lkCount + '</strong> Likes</span>';
        area.appendChild(countBar);

        /* Action bar */
        _renderActionBar(area, postEl, rtCount, lkCount);
    }


    /* ─────────────────────────────────────────────────────────────────────────
       ACTION BAR  (Like · Repost · Quote · Share · Bookmark)
    ───────────────────────────────────────────────────────────────────────── */
    function _renderActionBar(area, postEl, rtCount, lkCount) {
        var existing = area.querySelector('#vf-th-post-actions');
        if (existing) existing.remove();

        var postId  = _activePostId || '';
        var u       = _us();
        var uid     = u.id || '';
        var likeEl  = postEl.querySelector('.like-count');
        var rtEl    = postEl.querySelector('.retweet-count');

        var bar = document.createElement('div');
        bar.id = 'vf-th-post-actions';

        /* ── Comment ── */
        var commentBtn = _makeActBtn('far fa-comment', '');
        commentBtn.dataset.action = 'comment';
        commentBtn.title = 'Reply';
        commentBtn.addEventListener('click', function () {
            if (_isGuest()) { _openAuth(); return; }
            var inp = document.getElementById('vf-th-comp-inp');
            if (inp) {
                inp.focus();
                var body = document.getElementById('vf-th-body');
                if (body) body.scrollTop = body.scrollHeight;
            }
        });

        /* ── Repost ── (X popup: Repost | Quote) */
        var rtBtn = _makeActBtn('fas fa-retweet', rtCount || '');
        rtBtn.dataset.action = 'retweet';
        rtBtn.title = 'Repost';
        rtBtn.addEventListener('click', function (e) {
            if (_isGuest()) { _openAuth(); return; }
            e.stopPropagation();
            _openRtPopup(rtBtn, postEl, rtBtn, function (action) {
                if (action === 'repost') {
                    var isOn = rtBtn.classList.toggle('retweeted');
                    rtCount = Math.max(0, rtCount + (isOn ? 1 : -1));
                    rtBtn.querySelector('.vf-act-count').textContent = rtCount || '';
                    /* Update count bar */
                    var cb = document.getElementById('vf-th-rt-count');
                    if (cb) cb.innerHTML = '<strong>' + rtCount + '</strong> Reposts';
                    if (rtEl) rtEl.textContent = String(rtCount);
                    if (isOn) {
                        _doRepost(postEl);
                    } else {
                        _undoRepost(postId);
                        _notify('Repost removed', 'info');
                    }
                } else if (action === 'quote') {
                    _openQuote(postEl);
                }
            });
        });

        /* ── Like ── */
        var likeBtn = _makeActBtn('far fa-heart', lkCount || '');
        likeBtn.dataset.action = 'like';
        likeBtn.title = 'Like';
        likeBtn.addEventListener('click', function () {
            if (_isGuest()) { _openAuth(); return; }
            var isOn = likeBtn.classList.toggle('liked');
            // FIX: querySelector('i') always returned null here — every action
            // button in this view renders an inline <svg>, never an <i> — so
            // this line threw and silently aborted the handler before the
            // Firestore write, count sync, and impact-mining reward below
            // ever ran. The .liked class (toggled above) already drives the
            // correct color via CSS (see .vf-th-act-btn.liked svg), so no
            // icon-swap is needed.
            lkCount = Math.max(0, lkCount + (isOn ? 1 : -1));
            likeBtn.querySelector('.vf-act-count').textContent = lkCount || '';
            /* Count bar */
            var cb = document.getElementById('vf-th-lk-count');
            if (cb) cb.innerHTML = '<strong>' + lkCount + '</strong> Likes';
            if (likeEl) likeEl.textContent = String(lkCount);
            /* Firestore */
            if (postId && _fbOk()) {
                var ref = window.fbDb.collection(_col()).doc(postId);
                var fv = _FV();
                try {
                    ref.update({
                        likes: isOn ? _inc(1) : _inc(-1),
                        likedBy: fv ? (isOn ? fv.arrayUnion(uid) : fv.arrayRemove(uid)) : []
                    });
                } catch (e) {}
            }
            if (typeof window.toggleLike === 'function') window.toggleLike(postId);
            if (typeof window._awardImpactMining === 'function' && isOn) {
                window._awardImpactMining('LIKE_POST', postId || ('lp-' + Date.now()));
            }
        });

        /* ── Share ── */
        var shareBtn = _makeActBtn('fas fa-share-alt', '');
        shareBtn.dataset.action = 'share';
        shareBtn.title = 'Share';
        shareBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var text = _getPostText(postEl);
            _openShareSheet(text, postId);
        });

        /* ── Bookmark ── */
        var bmBtn = _makeActBtn('far fa-bookmark', '');
        bmBtn.dataset.action = 'bookmark';
        bmBtn.title = 'Bookmark';

        // FIX (bookmark state never restored on open): this button always
        // rendered as "not bookmarked" regardless of actual saved state —
        // it only reflected reality after a fresh click in THIS session.
        // One lightweight existence check against the user's own bookmark
        // doc fixes that, mirroring the feed-card restore logic in
        // app-fixes.js (_applyBookmarkState).
        (function _restoreBookmarkState() {
            var u = _us();
            if (!postId || !u.id || !_fbOk()) return;
            window.fbDb.collection('users').doc(u.id).collection('bookmarks').doc(postId).get()
                .then(function(doc) {
                    if (!doc.exists) return;
                    bmBtn.classList.add('bookmarked');
                })
                .catch(function() {});
        })();

        bmBtn.addEventListener('click', function () {
            if (_isGuest()) { _openAuth(); return; }
            // FIX (bookmark was purely cosmetic — CSS class toggle only, no
            // persistence anywhere). Now writes to the same
            // users/{uid}/bookmarks/{postId} subcollection the feed-card
            // bookmark button uses (see app-fixes.js), so a bookmark made
            // from either surface is consistent and survives refresh.
            var wasOn = bmBtn.classList.contains('bookmarked');
            var isOn  = !wasOn;
            bmBtn.classList.toggle('bookmarked', isOn);
            // FIX: same null-querySelector('i') crash as the like button
            // above — this button is SVG-only, so this line threw and
            // silently aborted the handler before the toast or the
            // Firestore write below ever ran. The .bookmarked class
            // (toggled above) already drives the correct color via CSS.
            _notify(isOn ? 'Added to Bookmarks' : 'Removed from Bookmarks', 'success');

            var u = _us();
            var bmPostId = _activePostId;
            if (bmPostId && u.id && _fbOk()) {
                var bmRef = window.fbDb.collection('users').doc(u.id).collection('bookmarks').doc(bmPostId);
                var bmCol = _col(postEl);
                var bmPromise = isOn
                    ? bmRef.set({
                          postId: bmPostId,
                          collection: bmCol,
                          bookmarkedAt: (window.firebase && window.firebase.firestore &&
                                         window.firebase.firestore.FieldValue.serverTimestamp())
                                         || new Date().toISOString()
                      })
                    : bmRef.delete();

                // FEATURE (bookmark notifications — parity with the feed-card
                // bookmark button in app-fixes.js): notify the post's owner
                // via Firestore on add, and drop a self-facing bell entry
                // that deep-links back to the Saved section. The owner's
                // authorId isn't on postEl's dataset in this view (only the
                // postId is), so it's read off the post doc itself.
                if (isOn) {
                    window.fbDb.collection(bmCol).doc(bmPostId).get().then(function(doc) {
                        var ownerId = doc.exists ? (doc.data().authorId || doc.data().userId) : null;
                        if (ownerId && ownerId !== u.id) {
                            window.fbDb.collection('notifications').add({
                                userId:    ownerId,
                                message:   (u.fullName || u.username || 'Someone') + ' bookmarked your post! 🔖',
                                type:      'bookmark',
                                read:      false,
                                createdAt: new Date().toISOString()
                            }).catch(function(err) {
                                console.warn('[bookmark] owner notification write failed:', err && err.message);
                            });
                        }
                    }).catch(function() {});

                    if (typeof window.pushNotification === 'function') {
                        window.pushNotification('Saved to your bookmarks 🔖', 'bookmark', null, { navTarget: 'saved-posts' });
                    }
                }

                bmPromise.catch(function (err) {
                    bmBtn.classList.toggle('bookmarked', wasOn);
                    _notify('Bookmark failed to save — please try again.', 'error');
                    console.warn('[bookmark] Firestore error:', err && err.message);
                });
            }
        });

        [commentBtn, rtBtn, likeBtn, shareBtn, bmBtn].forEach(function (b) { bar.appendChild(b); });
        area.appendChild(bar);
    }

    function _getPostText(postEl) {
        var el = postEl && postEl.querySelector('.story-content p, .post-text, .vf-th-post-text');
        return el ? el.textContent.trim() : 'Check this out on Empyrean';
    }


    function _fallbackCopy(text) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            _notify('Link copied!', 'success');
        } catch (e) {}
    }

    /* ─────────────────────────────────────────────────────────────────────────
       SHARE — uses native OS share drawer (navigator.share) on mobile,
       falls back to a simple copy-link sheet on desktop.
    ───────────────────────────────────────────────────────────────────────── */

    function _openShareSheet(text, postId) {
        var shareUrl = window.location.origin +
            (postId ? '/?post=' + encodeURIComponent(postId) : window.location.pathname);
        var shareText = text || 'Check this out on Empyrean';

        /* ── Increment share count + mining reward ── */
        if (postId && _fbOk()) {
            try { window.fbDb.collection(_col()).doc(postId).update({ shareCount: _inc(1) }).catch(function(){}); } catch(e){}
        }
        if (typeof window._awardImpactMining === 'function') {
            window._awardImpactMining('SHARE_POST', 'sh-' + (postId || Date.now()));
        }

        /* ── Native OS Share API ──────────────────────────────────────────────
           navigator.share() opens the real phone share drawer (WhatsApp, Gmail,
           Telegram, Instagram, Messenger, SMS, Bluetooth — everything installed).
           It MUST be called synchronously inside the user-gesture call stack.
           We pass ONLY title + url (no `text`) because some targets (Twitter/X)
           reject the share if `text` duplicates the url — keeping it minimal
           maximises compatibility across Android and iOS.
        ─────────────────────────────────────────────────────────────────────── */
        if (typeof navigator.share === 'function') {
            navigator.share({
                title: 'Empyrean International',
                url:   shareUrl
            })
            .then(function () {
                /* Share completed — nothing more needed */
            })
            .catch(function (err) {
                /* AbortError = user swiped away the drawer — that's fine, do nothing.
                   Any other error (permissions, unsupported target) → copy to clipboard. */
                if (err && err.name !== 'AbortError') {
                    _copyToClipboard(shareUrl);
                }
            });
            return; /* Always return here — never show the fake sheet on mobile */
        }

        /* ── Desktop fallback: show share sheet with working social links ── */
        _showFallbackSheet(shareText, shareUrl);
    }

    /* Clipboard helper used by the desktop fallback */
    function _copyToClipboard(url) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url)
                .then(function () { _notify('Link copied to clipboard!', 'success'); })
                .catch(function () { _fallbackCopy(url); });
        } else {
            _fallbackCopy(url);
        }
    }

    function _buildFallbackSheet() {
        if (document.getElementById('vf-share-sheet')) return;
        var sheet = document.createElement('div');
        sheet.id = 'vf-share-sheet';
        sheet.innerHTML =
            '<div id="vf-share-inner">' +
                '<div id="vf-share-handle"></div>' +
                '<div id="vf-share-title">SHARE POST</div>' +
                '<div id="vf-share-preview"></div>' +
                '<div id="vf-share-copy-row">' +
                    '<span id="vf-share-url-txt"></span>' +
                    '<button id="vf-share-copy-btn">Copy</button>' +
                '</div>' +
                '<div id="vf-share-desktop-links"></div>' +
                '<button id="vf-share-cancel">Cancel</button>' +
            '</div>';
        document.body.appendChild(sheet);
        sheet.addEventListener('click', function (e) { if (e.target === sheet) _closeShareSheet(); });
        sheet.querySelector('#vf-share-cancel').addEventListener('click', _closeShareSheet);
        sheet.querySelector('#vf-share-copy-btn').addEventListener('click', function () {
            var url = sheet.querySelector('#vf-share-url-txt').textContent;
            if (navigator.clipboard) {
                navigator.clipboard.writeText(url).then(function () { _notify('Link copied!', 'success'); }).catch(function () { _fallbackCopy(url); });
            } else { _fallbackCopy(url); }
        });
    }

    /* Desktop share links — real brand SVG icons */
    var _desktopLinks = [
        { label: 'WhatsApp',  bg: '#25D366',
          icon: '<svg viewBox="0 0 24 24" width="26" height="26" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.135.566 4.14 1.549 5.875L0 24l6.335-1.52A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 0 1-5.006-1.374l-.36-.213-3.727.977.995-3.635-.234-.374A9.818 9.818 0 1 1 12 21.818z"/></svg>',
          fn: function(t,u) { return 'https://wa.me/?text=' + encodeURIComponent(t + '\n' + u); } },
        { label: 'Facebook',  bg: '#1877F2',
          icon: '<svg viewBox="0 0 24 24" width="26" height="26" fill="#fff"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.268h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>',
          fn: function(t,u) { return 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(u); } },
        { label: 'Twitter/X', bg: '#000',
          icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.258 5.639 5.906-5.639zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
          fn: function(t,u) { return 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(t) + '&url=' + encodeURIComponent(u); } },
        { label: 'Telegram',  bg: '#229ED9',
          icon: '<svg viewBox="0 0 24 24" width="26" height="26" fill="#fff"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>',
          fn: function(t,u) { return 'https://t.me/share/url?url=' + encodeURIComponent(u) + '&text=' + encodeURIComponent(t); } },
        { label: 'LinkedIn',  bg: '#0A66C2',
          icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
          fn: function(t,u) { return 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(u); } },
        { label: 'Email',     bg: '#EA4335',
          icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg>',
          fn: function(t,u) { return 'mailto:?subject=Check+this+on+Empyrean&body=' + encodeURIComponent(t + '\n\n' + u); } }
    ];

    function _showFallbackSheet(shareText, shareUrl) {
        _buildFallbackSheet();
        var sheet   = document.getElementById('vf-share-sheet');
        var preview = document.getElementById('vf-share-preview');
        var urlTxt  = document.getElementById('vf-share-url-txt');
        var links   = document.getElementById('vf-share-desktop-links');
        if (!sheet) return;
        if (preview) preview.textContent = shareText;
        if (urlTxt)  urlTxt.textContent  = shareUrl;
        if (links) {
            links.innerHTML = '';
            links.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:12px 0;';
            _desktopLinks.forEach(function (app) {
                var btn = document.createElement('a');
                btn.href   = app.fn(shareText, shareUrl);
                btn.target = '_blank';
                btn.rel    = 'noopener noreferrer';
                btn.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;text-decoration:none;';
                btn.innerHTML =
                    '<span style="width:52px;height:52px;border-radius:14px;background:' + app.bg + ';' +
                    'display:flex;align-items:center;justify-content:center;">' + (app.icon || app.label.charAt(0)) + '</span>' +
                    '<span style="font-size:0.72rem;color:#374151;">' + app.label + '</span>';
                btn.addEventListener('click', function () { _closeShareSheet(); });
                links.appendChild(btn);
            });
        }
        sheet.classList.add('vf-open');
    }

    function _closeShareSheet() {
        var sheet = document.getElementById('vf-share-sheet');
        if (sheet) sheet.classList.remove('vf-open');
    }


    /* ─────────────────────────────────────────────────────────────────────────
       QUOTED POST FULL-VIEW MODAL
       Clicking a .vf-quote-embed opens a slide-in panel showing the full
       original post text, media, author, and timestamp.
    ───────────────────────────────────────────────────────────────────────── */
    function _buildQuoteFullModal() {
        if (document.getElementById('vf-quote-full-modal')) return;
        var modal = document.createElement('div');
        modal.id = 'vf-quote-full-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML =
            '<div id="vf-qfm-topbar">' +
                '<button id="vf-qfm-back" aria-label="Back"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>' +
                '<span id="vf-qfm-title">Original Post</span>' +
            '</div>' +
            '<div id="vf-qfm-body"></div>';
        document.body.appendChild(modal);

        modal.querySelector('#vf-qfm-back').addEventListener('click', _closeQuoteFullModal);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && modal.classList.contains('vf-open')) _closeQuoteFullModal();
        });
    }

    function _openQuoteFullModal(embedEl) {
        _buildQuoteFullModal();
        var modal = document.getElementById('vf-quote-full-modal');
        var body  = document.getElementById('vf-qfm-body');
        if (!modal || !body) return;

        /* Read data from embed element */
        var authorEl = embedEl.querySelector('.vf-quote-embed-author, .vf-qt-prev-author');
        var textEl   = embedEl.querySelector('.vf-quote-embed-text, .vf-qt-prev-text');
        var imgEl    = embedEl.querySelector('.vf-quote-embed-img, .vf-qt-prev-img');
        var avatarEl = embedEl.querySelector('img');

        /* Also try to pull from data attributes if set */
        var authorName = embedEl.dataset.origAuthor  || (authorEl ? authorEl.textContent.trim().replace(/^[@·\s]+/, '') : 'User');
        var postText   = embedEl.dataset.origText    || (textEl   ? textEl.textContent.trim()   : '');
        var avatarSrc  = embedEl.dataset.origAvatar  || (avatarEl ? avatarEl.src                : '');
        var origVideo  = embedEl.dataset.origVideo  || (imgEl && imgEl.tagName === 'VIDEO' ? (imgEl.getAttribute('src') || imgEl.src || '') : '');
        var imgSrc     = embedEl.dataset.origImg     || (!origVideo && imgEl ? imgEl.src : '');
        var timestamp  = embedEl.dataset.origTs      || '';

        var fallbackAva = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(authorName) + '&background=1B2B8B&color=fff&size=80';

        body.innerHTML =
            '<div class="vf-qfm-author-row">' +
                '<img class="vf-qfm-avatar" src="' + _esc(avatarSrc || fallbackAva) + '" alt="' + _esc(authorName) + '" ' +
                    'onerror="this.src=\'' + fallbackAva + '\'">' +
                '<div>' +
                    '<span class="vf-qfm-author-name">' + _esc(authorName) + '</span>' +
                    (timestamp ? '<span class="vf-qfm-author-time">' + _esc(timestamp) + '</span>' : '') +
                '</div>' +
            '</div>' +
            (postText ?
                '<p class="vf-qfm-text">' + _esc(postText) + '</p>' :
                '<p class="vf-qfm-text" style="color:#9CA3AF;font-style:italic;">No text in this post.</p>') +
            (origVideo ?
                '<div class="vf-qfm-media"><video src="' + _esc(origVideo) + '" controls playsinline style="width:100%;border-radius:10px;"></video></div>' :
             imgSrc ?
                '<div class="vf-qfm-media"><img src="' + _esc(imgSrc) + '" alt="media" loading="lazy"></div>' : '') +
            '<hr class="vf-qfm-sep">' +
            '<p style="font-size:0.82rem;color:#9CA3AF;text-align:center;">Original post</p>';

        modal.classList.add('vf-open');
    }

    function _closeQuoteFullModal() {
        var modal = document.getElementById('vf-quote-full-modal');
        if (modal) modal.classList.remove('vf-open');
    }

    /* Delegate click on .vf-quote-embed anywhere in the document */
    document.addEventListener('click', function (e) {
        var embed = e.target.closest && e.target.closest('.vf-quote-embed');
        if (!embed) return;
        e.preventDefault();
        e.stopPropagation();
        _openQuoteFullModal(embed);
    }, true);

    /* FIX (report — "clicking the original tweeted [embed] should take
       users to the original post, [instead] clicking the ... upper
       retweeted part [is what] should take users to comment section"):
       app-fixes.js's live posts listener (the "QUOTE BLOCK" section of
       its posts onSnapshot handler) builds the quoted-post embed for a
       real, persisted quote post with NO CSS class at all — only a
       dataset.quotedPostId + inline cursor:pointer — so it never matched
       the .vf-quote-embed selector just above, which only ever matches
       the quote-COMPOSER's own preview (_openQuote()) or a thread-view
       clone of it. With no click handler of its own, a tap on that real
       embed fell through to the "OPEN THREAD on post card click"
       bubble-phase listener further down this file, which opened the
       CURRENT (quoting) post's own comment section instead of navigating
       to the ORIGINAL quoted post. Fix: a delegated handler for the exact
       dataset attribute that renderer already stamps, using the same
       capture-phase + stopPropagation technique as the .vf-quote-embed
       block above so this always wins over that later bubble-phase
       handler regardless of listener registration order, then hand off
       to window.openPostById() (app-thread.js's own id-based post opener,
       already used for shared post links) to actually navigate to the
       original post. Everywhere else on the card (the quoter's own
       text/header/media) is untouched and still opens THAT post's own
       comment section exactly as before. */
    document.addEventListener('click', function (e) {
        var qEmbed = e.target.closest && e.target.closest('[data-quoted-post-id]');
        if (!qEmbed) return;
        var qid = qEmbed.dataset.quotedPostId;
        if (!qid) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.openPostById === 'function') {
            window.openPostById(qid);
        } else if (typeof window.showNotification === 'function') {
            window.showNotification("Couldn't open the original post.", 'info');
        }
    }, true);

    /* SVG icon map — keyed by the old FA class string for drop-in compatibility */
    var _SVG = {
        'far fa-comment':   '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
        'fas fa-retweet':   '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
        'far fa-heart':     '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
        'fas fa-share-alt': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
        'far fa-bookmark':  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
        'fas fa-chart-bar': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
        'fas fa-quote-right':'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
        'fas fa-pen':       '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>'
    };

    function _makeActBtn(iconClass, label) {
        var btn = document.createElement('button');
        btn.className = 'vf-th-act-btn';
        var iconHTML = _SVG[iconClass] || ('<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25"><circle cx="12" cy="12" r="10"/></svg>');
        btn.innerHTML =
            '<span class="vf-act-wrap">' +
                iconHTML +
                (label !== '' ? '<span class="vf-act-count">' + _esc(String(label)) + '</span>' : '') +
            '</span>';
        return btn;
    }


    /* ─────────────────────────────────────────────────────────────────────────
       REPOST POPUP MENU  (X-style)
    ───────────────────────────────────────────────────────────────────────── */
    function _openRtPopup(anchorBtn, postEl, rtBtn, callback) {
        if (_isOwnPostEl(postEl)) { _blockSelfRepost(); return; }
        _closeRtPopup();

        /* Backdrop */
        var bd = document.createElement('div');
        bd.id = 'vf-rt-popup-backdrop';
        bd.addEventListener('click', _closeRtPopup);
        document.body.appendChild(bd);

        /* Popup */
        var popup = document.createElement('div');
        popup.id = 'vf-rt-popup';

        var isRetweeted = rtBtn.classList.contains('retweeted');
        if (isRetweeted) {
            popup.innerHTML =
                '<button class="vf-rt-popup-item undo" data-rt-action="repost">' +
                    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.932 9.48.568 8.02 5 3.88zM19.5 20.12l-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2H11V4h5.5c2.209 0 4 1.79 4 4v8.45l1.568-1.93 1.364 1.46-4.432 4.14z"/></svg> Undo repost' +
                '</button>' +
                '<button class="vf-rt-popup-item" data-rt-action="quote">' +
                    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg> Quote' +
                '</button>';
        } else {
            popup.innerHTML =
                '<button class="vf-rt-popup-item" data-rt-action="repost">' +
                    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.932 9.48.568 8.02 5 3.88zM19.5 20.12l-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2H11V4h5.5c2.209 0 4 1.79 4 4v8.45l1.568-1.93 1.364 1.46-4.432 4.14z"/></svg> Repost' +
                '</button>' +
                '<button class="vf-rt-popup-item" data-rt-action="quote">' +
                    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg> Quote' +
                '</button>';
        }

        popup.addEventListener('click', function (e) {
            var item = e.target.closest('[data-rt-action]');
            if (!item) return;
            var action = item.dataset.rtAction;
            _closeRtPopup();
            callback(action);
        });

        document.body.appendChild(popup);

        /* Position relative to anchor */
        var rect = anchorBtn.getBoundingClientRect();
        var popupW = 200;
        var left = Math.min(rect.left, window.innerWidth - popupW - 10);
        var top  = rect.bottom + 4;
        /* Flip up if too close to bottom */
        if (top + 100 > window.innerHeight) {
            top = rect.top - popup.offsetHeight - 4;
        }
        popup.style.left = Math.max(10, left) + 'px';
        popup.style.top  = top + 'px';
    }

    function _closeRtPopup() {
        var bd = document.getElementById('vf-rt-popup-backdrop');
        var pp = document.getElementById('vf-rt-popup');
        if (bd) bd.remove();
        if (pp) pp.remove();
    }


    /* ─────────────────────────────────────────────────────────────────────────
       REPOST — saves to Firestore + injects card into feed
    ───────────────────────────────────────────────────────────────────────── */
    async function _doRepost(postEl) {
        var u        = _us();
        var postId   = _activePostId || '';
        var authorEl = postEl.querySelector('.story-user-info strong, .post-author');
        var textEl   = postEl.querySelector('.story-content p, .vf-th-post-text, .post-text');
        var imgEl    = postEl.querySelector('.story-media-item img, .story-main-image');
        var vidEl    = postEl.querySelector('.story-media-item video, video');
        var avatarEl = postEl.querySelector('.avatar-placeholder img');

        var origAuthor  = (authorEl  && authorEl.textContent.trim())  || 'User';
        var origText    = (textEl    && textEl.textContent.trim())     || '';
        var origImg     = imgEl    ? (imgEl.src    || '')              : '';
        var origVideo   = vidEl    ? (vidEl.src    || vidEl.currentSrc || vidEl.getAttribute('src') || '') : '';
        var origAvatar  = avatarEl ? (avatarEl.src || '')              : '';
        var retweeterName = u.fullName || u.username || 'You';

        // FIX (permanent permission-denied on retweet cards — root cause):
        // Previously this function rendered the repost card into the live
        // feed FIRST (via _injectRetweetCard, which generated its own
        // 'rt-'+Date.now() id), then fired an unawaited Firestore .add()
        // AFTER, whose auto-generated doc id was NEVER connected back to the
        // card's data-post-id. Two separate bugs stacked:
        //   1. Race — the card was visible/scrollable before any Firestore
        //      doc existed at all, so a view-count tick could fire on it
        //      mid-write (same class of bug as app-sos.js _handleApproveSos).
        //   2. Permanent mismatch — even once the .add() succeeded, the
        //      resulting Firestore id was random and never matched the
        //      card's own self-generated id, so the doc that views/likes
        //      tried to write to never existed under that id, ever.
        // Fix: generate the id up front with .doc() (lets us pick the id
        // before writing, unlike .add()), await the .set(), THEN render the
        // card using that exact same confirmed id.
        var rtPostId = 'rt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

        if (_fbOk()) {
            /* FIX (bug: reposts render as "User" / "Invalid Date" in the
               main feed, 2026-07-18): every other place in this codebase
               that writes a post document — including app-fixes.js's own
               parallel retweet-writer — uses `username` (not `authorName`)
               and `createdAt: new Date().toISOString()` (a plain string,
               not a Firestore Timestamp). app-feed.js's posts listener
               reads exactly that shape: `post.username || 'User'` for the
               name, and `new Date(post.createdAt)` for the date — the
               second of which produces the literal text "Invalid Date"
               when handed a Firestore Timestamp object instead of a string
               or number. Keeping authorName too since other code in this
               file already reads it, but username is now set so the main
               feed card renders correctly. */
            var doc = {
                id:              rtPostId,
                type:            'retweet',
                retweeterName:   retweeterName,
                retweeterId:     u.id || '',
                retweeterAvatar: _avatar(u),
                origPostId:      postId,
                origAuthor:      origAuthor,
                origText:        origText,
                origImg:         origImg,
                origVideo:       origVideo,
                origAvatar:      origAvatar,
                createdAt:       new Date().toISOString(),
                username:        retweeterName,
                authorName:      retweeterName,
                authorId:        u.id || '',
                text:            origText,
                views: 0, likes: 0, likedBy: [], retweetCount: 0,
                shareCount: 0, downloadCount: 0, quoteCount: 0, commentCount: 0
            };
            try {
                await window.fbDb.collection('posts').doc(rtPostId).set(doc);
                /* FIX (report — "clicking retweet doesn't indicate"): this
                   used to only bump retweetCount — it never recorded WHO
                   retweeted on the original post's own doc, the same way
                   likedBy already does for likes. Without that, there was
                   no real per-user record for _subscribeCounts' new
                   restore logic (above) to read back on a future open, so
                   the button could never correctly remember "you already
                   reposted this" — only a same-session class toggle did,
                   which a reopen always lost. Mirrors the main feed's own
                   retweet handler (app-fixes.js), which already writes
                   this same field. */
                var _rtFv = _FV();
                var _rtUpdate = { retweetCount: _inc(1) };
                if (_rtFv && u.id) _rtUpdate.retweetedBy = _rtFv.arrayUnion(u.id);
                await window.fbDb.collection(_col(postEl)).doc(postId).update(_rtUpdate);
            } catch (e) {
                _notify('Failed to repost — please try again.', 'error');
                return; // Don't render a phantom card backed by no document.
            }
        }

        /* Local mirror of the write above, so this holds immediately even
           before the next Firestore snapshot round-trips back. */
        if (window.userState && window.userState.retweetedPostIds) {
            window.userState.retweetedPostIds.add(postId);
        }

        _notify('Reposted!', 'success');

        /* ── Optimistic live-count update in the thread UI ── */
        var rtCBar = document.getElementById('vf-th-rt-count');
        if (rtCBar) {
            var cur = parseInt((rtCBar.querySelector('strong') || rtCBar).textContent, 10) || 0;
            rtCBar.innerHTML = '<strong>' + (cur + 1) + '</strong> Reposts';
        }
        /* Also bump the count badge on the original feed card */
        if (_activePostEl) {
            var srcRt = _activePostEl.querySelector('.retweet-count, .retweet-btn span, [class*="retweet"] span');
            if (srcRt) {
                var srcN = parseInt(srcRt.textContent, 10) || 0;
                srcRt.textContent = String(srcN + 1);
            }
        }

        /* Award mining */
        if (typeof window._awardImpactMining === 'function') {
            window._awardImpactMining('RETWEET_POST', rtPostId);
        }

        /* Build the repost card via this app's OWN canonical post renderer
           (window.createNewPostElement, app-feed.js) instead of this
           file's separate hand-built _injectRetweetCard markup.
           FIX (report — "quote and retweet is still not working very well
           or optimally... retweeted post should display as retweeted
           message"): _injectRetweetCard below is a second, independent
           reimplementation of the SAME card the main feed's own retweet
           handler already builds correctly (app-fixes.js, ~line 8894) via
           createNewPostElement's built-in retweetData support — different
           markup, different CSS hooks, none of the other patches/behaviors
           already wired specifically to createNewPostElement's own output
           apply to it. Calling the same canonical function this app
           already trusts everywhere else guarantees this card looks and
           behaves exactly like a retweet made from the main feed, not a
           parallel one-off. */
        var _rtMediaFiles = origVideo ? [origVideo] : (origImg ? [origImg] : []);
        var _rtOriginalAuthor = { id: '', fullName: origAuthor, avatar: origAvatar };
        var _rtCardEl = window.createNewPostElement(
            origText, _rtMediaFiles, _rtOriginalAuthor, false,
            { retweeterName: retweeterName, isQuote: false, origPostId: postId }
        );
        _rtCardEl.dataset.postId = rtPostId;
        _prependToFeed(_rtCardEl);
    }

    function _undoRepost(postId) {
        if (!_fbOk() || !postId) return;
        var u = _us();
        try {
            var _rtFv = _FV();
            var _rtUpdate = { retweetCount: _inc(-1) };
            if (_rtFv && u.id) _rtUpdate.retweetedBy = _rtFv.arrayRemove(u.id);
            window.fbDb.collection(_col()).doc(postId).update(_rtUpdate).catch(function () {});
        } catch (e) {}
        if (window.userState && window.userState.retweetedPostIds) {
            window.userState.retweetedPostIds.delete(postId);
        }
    }

    /* Inject a retweet card at the top of the feed */
    function _injectRetweetCard(opts) {
        var card = document.createElement('div');
        card.className = 'impact-story';
        // FIX (permanent views/likes permission-denied on retweet cards):
        // previously this generated its OWN 'rt-'+Date.now() id, completely
        // disconnected from the id actually used by the Firestore .add() call
        // in _doRepost — so the rendered card's data-post-id could never match
        // any real document. Any view/like write against it was guaranteed to
        // fail forever, not just race. opts.postId is now the SAME id the
        // Firestore doc was created with (see _doRepost), so the two always
        // agree. Falls back to a local id only if none was supplied (should
        // not happen on the normal path, but keeps this function safe to call
        // standalone).
        card.dataset.postId = opts.postId || ('rt-' + Date.now());
        card.dataset.isRetweet = '1';

        /* Build media block — prefer video over still image */
        var mediaHTML = '';
        if (opts.origVideo) {
            mediaHTML = '<div class="story-media-container"><div class="story-media-item">' +
                '<video src="' + _esc(opts.origVideo) + '" controls playsinline muted loop ' +
                    'poster="' + _esc(opts.origImg || '') + '" ' +
                    'style="width:100%;border-radius:14px;max-height:360px;object-fit:cover;">' +
                '</video></div></div>';
        } else if (opts.origImg) {
            mediaHTML = '<div class="story-media-container"><div class="story-media-item">' +
                '<img src="' + _esc(opts.origImg) + '" alt="media" loading="lazy" ' +
                    'style="width:100%;border-radius:14px;">' +
                '</div></div>';
        }

        var origAvatarSrc = opts.origAvatar ||
            ('https://ui-avatars.com/api/?name=' + encodeURIComponent(opts.origAuthor) + '&background=1B2B8B&color=fff&size=80');

        card.innerHTML =
            /* Prominent retweeted-by banner */
            '<div class="retweet-header" style="display:flex;align-items:center;gap:7px;' +
                'padding:8px 14px 4px;font-size:0.80rem;font-weight:700;color:#1B2B8B;">' +
                '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#1B2B8B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> ' +
                _esc(opts.retweeterName) + ' Retweeted' +
            '</div>' +
            '<div class="story-header">' +
                '<div class="avatar-placeholder" style="width:40px;height:40px;min-width:40px;border-radius:50%;overflow:hidden;">' +
                    '<img src="' + _esc(origAvatarSrc) + '" alt="' + _esc(opts.origAuthor) + '" style="width:40px;height:40px;object-fit:cover;display:block;" ' +
                        'onerror="this.src=\'https://ui-avatars.com/api/?name=' + encodeURIComponent(opts.origAuthor) + '&background=1B2B8B&color=fff&size=80\'">' +
                '</div>' +
                '<div class="story-user-info">' +
                    '<strong>' + _esc(opts.origAuthor) + '</strong>' +
                    '<span>' + _tsFull(new Date()) + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="story-content"><p>' + _esc(opts.origText) + '</p></div>' +
            mediaHTML +
            '<div class="story-actions">' +
                '<a class="action-btn comment-btn" data-action="comment" title="Reply"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/></svg><span class="comment-count x-count">0</span></span></a>' +
                '<a class="action-btn retweet-btn" data-action="retweet" title="Repost"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.932 9.48.568 8.02 5 3.88zM19.5 20.12l-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2H11V4h5.5c2.209 0 4 1.79 4 4v8.45l1.568-1.93 1.364 1.46-4.432 4.14z"/></svg><span class="retweet-count x-count">0</span></span></a>' +
                '<a class="action-btn like-btn" data-action="like" title="Like"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z"/></svg><span class="like-count x-count">0</span></span></a>' +
                '<a class="action-btn bookmark-btn" data-action="bookmark" title="Bookmark"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l.5 1v16.5l-6-3.5-6 3.5V4l.5-1z"/></svg></span></a>' +
                '<a class="action-btn share-btn" data-action="share" title="Share"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></span></a>' +
            '</div>' +
            '<div class="comment-section"><div class="comment-list"></div>' +
                '<form class="comment-form" novalidate>' +
                    '<input type="text" name="comment-text" placeholder="Add a comment..." required>' +
                    '<button type="submit"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
                '</form></div>';

        _prependToFeed(card);
    }

    function _prependToFeed(el) {
        /* Insert into every known feed container so the card appears regardless
           of which section/tab is currently visible.
           FIX (report — "reports should share and display it in the
           general dashboard"): 'feed-container' is the real general-
           dashboard feed (confirmed against app-fixes.js's own main-feed
           retweet handler, which uses the exact same id) and was already
           covered. That same handler ALSO mirrors every repost into
           '#profile-dash-feed' — the profile page's own feed — which this
           function never did, so a repost/quote made from the Post detail
           page reached the main dashboard but never showed up on the
           reposting user's own profile the way one made from the main
           feed already does. Added for parity. Guards against double-
           inserting the same card if it's already present (can happen if
           the main dashboard feed and the profile dashboard feed are, in
           fact, the same underlying element on some layouts). */
        var inserted = false;
        ['feed-container', 'posts-feed', 'dashboard-feed', 'home-feed', 'profile-dash-feed'].forEach(function (id) {
            var feed = document.getElementById(id);
            if (!feed) return;
            if (el.dataset.postId && feed.querySelector('[data-post-id="' + el.dataset.postId + '"]')) return;
            feed.prepend(inserted ? el.cloneNode(true) : el);
            inserted = true;
        });

        /* Scroll whichever feed is visible to the top so user sees new post */
        setTimeout(function () {
            ['feed-container', 'posts-feed', 'dashboard-feed', 'home-feed', 'profile-dash-feed'].forEach(function (id) {
                var feed = document.getElementById(id);
                if (feed) feed.scrollTop = 0;
            });
            if (window.scrollTo) window.scrollTo(0, 0);

            /* Re-wire action buttons on the newly inserted card */
            if (typeof window._rewireFeedButtons === 'function') window._rewireFeedButtons();
            if (typeof window._vfsDecorateAll    === 'function') window._vfsDecorateAll();
        }, 80);
    }


    /* ─────────────────────────────────────────────────────────────────────────
       QUOTE TWEET — open modal / submit / inject card
    ───────────────────────────────────────────────────────────────────────── */
    /* FIX (2026-09-16): app-feed.js only injects the shared
       vf-quote-video-wrap/vf-quote-embed-img/vf-quote-play-btn rules into
       <head> the first time IT renders a quote card with video — which may
       not have happened yet the first time someone opens THIS modal (e.g.
       the very first quote of a fresh session, on a post with no other
       quote cards above it in the feed). Same id guard as app-feed.js's
       own _injectQuoteEmbedStyles, so whichever file gets there first wins
       and the other is a harmless no-op — never two copies. */
    function _ensureQuotePreviewMediaStyles() {
        if (document.getElementById('vf-quote-embed-styles')) return;
        var s = document.createElement('style');
        s.id = 'vf-quote-embed-styles';
        s.textContent = [
            '.vf-quote-video-wrap { position:relative; width:100%; aspect-ratio:16/9; background:#000; overflow:hidden; }',
            '.vf-quote-video-wrap .vf-quote-embed-img { width:100%; height:100%; object-fit:cover; display:block; }',
            '.vf-quote-play-btn { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:46px; height:46px; border-radius:50%; background:rgba(10,14,39,0.55); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); border:1px solid rgba(255,255,255,0.25); color:#fff; display:flex; align-items:center; justify-content:center; font-size:1.05rem; cursor:pointer; z-index:2; transition:opacity .18s ease, transform .18s ease; }',
            '.vf-quote-play-btn:hover { transform:translate(-50%,-50%) scale(1.08); }',
            '.vf-quote-play-btn--hidden { opacity:0; pointer-events:none; }'
        ].join('\n');
        document.head.appendChild(s);
    }

    function _openQuote(postEl) {
        if (_isOwnPostEl(postEl)) { _blockSelfRepost(); return; }
        _buildOverlay();
        _wireQuoteModal();

        var qm = document.getElementById('vf-th-quote-modal');
        var qp = document.getElementById('vf-th-quote-preview');
        var qi = document.getElementById('vf-th-quote-inp');
        var av = document.getElementById('vf-th-quote-comp-av');
        if (!qm || !qp || !qi) return;

        /* Fill composer avatar */
        var u = _us();
        if (av) av.src = _avatar(u);

        /* Fill quoted post preview */
        var authorEl = postEl.querySelector('.story-user-info strong, .post-author');
        var handleEl = postEl.querySelector('.story-user-info span');
        var textEl   = postEl.querySelector('.story-content p, .post-text');
        var imgEl    = postEl.querySelector('.story-media-item img, .story-main-image');
        /* FIX (2026-09-16 — see the matching CSS comment above): _doSubmitQuote
           already looks for a video element on the source card; this modal's
           OWN preview never did, so quoting a video post rendered no media
           at all here (a mismatch only visible for a few seconds, right
           before the correctly-video-inclusive final card gets posted). */
        var vidEl    = postEl.querySelector('.story-media-item video, video');
        var avatarEl = postEl.querySelector('.avatar-placeholder img');

        var author   = (authorEl && authorEl.textContent.trim()) || 'User';
        var handle   = (handleEl && handleEl.textContent.trim()) || '';
        var text     = (textEl   && textEl.textContent.trim())   || '';
        var img      = imgEl    ? (imgEl.src || '')    : '';
        var video    = vidEl    ? (vidEl.src || vidEl.currentSrc || vidEl.getAttribute('src') || '') : '';
        var ava      = avatarEl ? (avatarEl.src || '') : '';

        /* Video gets the same 16:9 frosted-play-button treatment as the
           feed's own quote-embed card (app-feed.js's vf-quote-video-wrap) —
           see _ensureQuotePreviewMediaStyles() below for why these class
           names are safe to reuse here even before any quote card has
           rendered in the feed this session. Image keeps the existing
           cropped-strip preview, unchanged. */
        var mediaHTML = video
            ? '<div class="vf-qt-prev-video-wrap vf-quote-video-wrap">'
                + '<video src="' + _esc(video) + '" class="vf-quote-embed-img"'
                + ' muted loop autoplay playsinline preload="auto"'
                + ' onerror="this.parentElement.style.display=\'none\'"'
                + ' onplay="this.nextElementSibling.classList.add(\'vf-quote-play-btn--hidden\')"'
                + ' onpause="this.nextElementSibling.classList.remove(\'vf-quote-play-btn--hidden\')"></video>'
                + '<button type="button" class="vf-quote-play-btn vf-quote-play-btn--hidden"'
                + ' aria-label="Play or pause preview"'
                + ' onclick="event.stopPropagation();var v=this.previousElementSibling;if(v.paused){v.play();}else{v.pause();}">'
                + '<i class="fas fa-play"></i>'
                + '</button>'
                + '</div>'
            : (img ? '<img class="vf-qt-prev-img" src="' + _esc(img) + '" alt="media" loading="lazy">' : '');

        _ensureQuotePreviewMediaStyles();

        qp.innerHTML =
            '<div class="vf-qt-prev-author">' +
                '<img src="' + _esc(ava) + '" alt="' + _esc(author) + '" ' +
                    'onerror="this.src=\'https://ui-avatars.com/api/?name=' + encodeURIComponent(author) + '&background=1B2B8B&color=fff&size=80\'">' +
                _esc(author) +
                (handle ? '<span class="vf-qt-prev-handle">· ' + _esc(handle) + '</span>' : '') +
            '</div>' +
            '<div class="vf-qt-prev-text">' + _esc(text) + '</div>' +
            mediaHTML +
            '<div style="font-size:0.75rem;color:#1D9BF0;margin-top:6px;font-weight:600;">Tap to read full post ↗</div>';

        /* Stamp data so the click delegate can open full view */
        qp.classList.add('vf-quote-embed');
        qp.dataset.origAuthor = author;
        qp.dataset.origText   = text;
        qp.dataset.origImg    = img;
        qp.dataset.origVideo  = video;
        qp.dataset.origAvatar = ava;

        qi.value = '';
        qm.classList.add('vf-open');
        setTimeout(function () { qi.focus(); }, 120);
    }

    function _closeQuote() {
        var qm = document.getElementById('vf-th-quote-modal');
        if (qm) qm.classList.remove('vf-open');
    }

    /*
     * _doSubmitQuote — single source of truth for quote submission.
     * window._submitQuote is set to this; §43 may wrap it for mining.
     */
    async function _doSubmitQuote() {
        var qi   = document.getElementById('vf-th-quote-inp');
        var text = qi ? (qi.value || '').trim() : '';
        if (!text) { _notify('Add a thought before posting.', 'warning'); return; }
        if (_isGuest()) { _openAuth(); return; }

        // FIX (quote could be submitted on the same post indefinitely, each
        // one paying QUOTE_POST and incrementing quoteCount/retweetCount
        // again): there was no cap at all here. Mirrors the downloadedPostIds
        // gate — quoting isn't reversible like a like/retweet toggle, so once
        // counted for this account+post, later attempts are blocked outright
        // rather than toggled off. userState.quotedPostIds is restored from
        // Firestore's quotedBy array by app-fix-final.js's _applyCounts45,
        // the same way retweetedBy/downloadedBy already are, so this holds
        // across reloads and devices, not just this tab.
        var _qtGateId = _activePostId || '';
        if (_qtGateId && window.userState && window.userState.quotedPostIds && window.userState.quotedPostIds.has(_qtGateId)) {
            _notify('You already quoted this post.', 'info');
            return;
        }

        _closeQuote();

        /* Snapshot the quoted post data now */
        var postEl = _activePostEl;
        var postId = _activePostId || '';
        var u      = _us();

        var authorEl = postEl && postEl.querySelector('.story-user-info strong, .post-author');
        var textEl   = postEl && postEl.querySelector('.story-content p, .post-text');
        var imgEl    = postEl && postEl.querySelector('.story-media-item img, .story-main-image');
        var vidEl    = postEl && postEl.querySelector('.story-media-item video, video');
        var avatarEl = postEl && postEl.querySelector('.avatar-placeholder img');

        var origAuthor = (authorEl && authorEl.textContent.trim()) || 'User';
        var origText   = (textEl   && textEl.textContent.trim())   || '';
        var origImg    = imgEl    ? (imgEl.src || '')    : '';
        var origVideo  = vidEl    ? (vidEl.src || vidEl.currentSrc || vidEl.getAttribute('src') || '') : '';
        var origAva    = avatarEl ? (avatarEl.src || '') : '';

        // FIX (permanent permission-denied on quote cards — same root cause
        // as _doRepost): generate the id up front with .doc() instead of
        // .add(), await the .set(), THEN render the card using that exact
        // confirmed id. Previously the card rendered immediately with its
        // own disconnected 'qt-'+Date.now() id while the Firestore .add()
        // (with an unrelated auto-generated id) fired afterward, unawaited —
        // so the card's data-post-id never matched any real document, ever.
        var qtPostId = 'qt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

        if (_fbOk()) {
            /* FIX (same schema-mismatch bug as _doRepost above): add
               username (app-feed.js's reader falls back to the literal
               string "User" without it) and store createdAt as an ISO
               string instead of a raw Firestore Timestamp (the reader does
               new Date(post.createdAt) directly, which yields "Invalid
               Date" when given a Timestamp object). */
            var doc = {
                id:           qtPostId,
                type:         'quote',
                text:         text,
                quotedPostId: postId,
                authorId:     u.id          || '',
                username:     u.fullName    || u.username || 'User',
                authorName:   u.fullName    || u.username || 'User',
                authorAvatar: _avatar(u),
                origAuthor:   origAuthor,
                origText:     origText,
                origImg:      origImg,
                origVideo:    origVideo,
                origAva:      origAva,
                createdAt:    new Date().toISOString(),
                views: 0, likes: 0, likedBy: [], retweetCount: 0,
                shareCount: 0, downloadCount: 0, quoteCount: 0, commentCount: 0
            };
            try {
                await window.fbDb.collection('posts').doc(qtPostId).set(doc);
                if (postId) {
                    // FIX (quote could be repeated indefinitely) — write quotedBy
                    // alongside the counts, mirroring likedBy/retweetedBy/
                    // downloadedBy, so the gate at the top of this function
                    // holds across reloads via _applyCounts45's restore.
                    var _qtFv  = _FV();
                    var _qtUid = u && u.id;
                    var _qtUpd = {
                        retweetCount: _inc(1),
                        quoteCount:   _inc(1)
                    };
                    if (_qtFv && _qtUid) _qtUpd.quotedBy = _qtFv.arrayUnion(_qtUid);
                    await window.fbDb.collection(_col(postEl)).doc(postId).update(_qtUpd);
                }
            } catch (e) {
                _notify('Failed to post quote — please try again.', 'error');
                return; // Don't render a phantom card backed by no document.
            }
        }
        if (_qtGateId && window.userState && window.userState.quotedPostIds) {
            window.userState.quotedPostIds.add(_qtGateId);
        }

        _notify('Your post was sent!', 'success');

        /* ── Optimistic live-count update ── */
        /* Quotes count as reposts in the thread count bar */
        var qtCBar = document.getElementById('vf-th-rt-count');
        if (qtCBar) {
            var curQ = parseInt((qtCBar.querySelector('strong') || qtCBar).textContent, 10) || 0;
            qtCBar.innerHTML = '<strong>' + (curQ + 1) + '</strong> Reposts';
        }
        /* Bump the count badge on the source feed card */
        if (_activePostEl) {
            var srcQRt = _activePostEl.querySelector('.retweet-count, .retweet-btn span, [class*="retweet"] span');
            if (srcQRt) {
                var srcQN = parseInt(srcQRt.textContent, 10) || 0;
                srcQRt.textContent = String(srcQN + 1);
            }
        }

        /* Mining */
        if (typeof window._awardImpactMining === 'function') {
            window._awardImpactMining('QUOTE_POST', qtPostId);
        }

        /* Build the quote card via this app's OWN canonical post renderer
           (window.createNewPostElement, app-feed.js), using its built-in
           isQuote/originalPost embed support, instead of this file's
           separate hand-built _injectQuoteCard markup — same reasoning as
           the retweet card above: one shared, already-correct renderer
           instead of a second one-off reimplementation that other patches
           and behaviors in this app were never wired to recognize. */
        var _qtOriginalMedia = origVideo ? [origVideo] : (origImg ? [origImg] : []);
        var _qtQuoterAuthor = { id: u.id || '', fullName: u.fullName || u.username || 'You', avatar: _avatar(u) };
        var _qtCardEl = window.createNewPostElement(
            text, [], _qtQuoterAuthor, false,
            {
                isQuote: true,
                originalPost: {
                    id:           postId,
                    authorName:   origAuthor,
                    authorAvatar: origAva,
                    text:         origText,
                    media:        _qtOriginalMedia
                }
            }
        );
        _qtCardEl.dataset.postId = qtPostId;
        _prependToFeed(_qtCardEl);
    }
    window._submitQuote = _doSubmitQuote;

    /* Inject a quote tweet card into the top of the feed */
    function _injectQuoteCard(opts) {
        var card = document.createElement('div');
        card.className = 'impact-story';
        // FIX (permanent views/likes permission-denied on quote cards): same
        // root cause as _injectRetweetCard — previously generated its own
        // disconnected 'qt-'+Date.now() id instead of using the id the
        // Firestore doc was actually created with. See _doSubmitQuote.
        card.dataset.postId = opts.postId || ('qt-' + Date.now());
        card.dataset.isQuote = '1';

        /* Build the embedded quoted post block — include video if present */
        var embedMediaHTML = '';
        if (opts.origVideo) {
            embedMediaHTML = '<video class="vf-quote-embed-img" src="' + _esc(opts.origVideo) + '" ' +
                'controls playsinline muted loop poster="' + _esc(opts.origImg || '') + '" ' +
                'style="max-height:100px;width:auto;max-width:100%;border-radius:8px;object-fit:cover;"></video>';
        } else if (opts.origImg) {
            embedMediaHTML = '<img class="vf-quote-embed-img" src="' + _esc(opts.origImg) + '" alt="media" loading="lazy">';
        }

        var embedHTML =
            '<div class="vf-quote-embed"' +
                ' data-orig-post-id="' + _attr(opts.origPostId) + '"' +
                ' data-orig-author="'  + _attr(opts.origAuthor) + '"' +
                ' data-orig-text="'    + _attr(opts.origText)   + '"' +
                ' data-orig-img="'     + _attr(opts.origImg)    + '"' +
                ' data-orig-video="'   + _attr(opts.origVideo || '') + '"' +
                ' data-orig-avatar="'  + _attr(opts.origAva)    + '"' +
            '>' +
                '<div class="vf-quote-embed-author">' +
                    '<img src="' + _esc(opts.origAva) + '" alt="' + _esc(opts.origAuthor) + '" ' +
                        'onerror="this.src=\'https://ui-avatars.com/api/?name=' + encodeURIComponent(opts.origAuthor) + '&background=1B2B8B&color=fff&size=80\'">' +
                    _esc(opts.origAuthor) +
                '</div>' +
                '<div class="vf-quote-embed-text">' + _esc(opts.origText) + '</div>' +
                embedMediaHTML +
            '</div>';

        var fallbackAva = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(opts.quoterName) + '&background=1B2B8B&color=fff&size=80';
        card.innerHTML =
            /* Quote indicator banner */
            '<div class="retweet-header" style="display:flex;align-items:center;gap:7px;' +
                'padding:8px 14px 4px;font-size:0.76rem;font-weight:600;letter-spacing:0.01em;color:#5B6478;">' +
                '<svg viewBox="0 0 24 24" width="13" height="13" fill="#5B0EA6"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg> ' +
                'Reposted with a comment' +
            '</div>' +
            '<div class="story-header">' +
                '<div class="avatar-placeholder" style="width:40px;height:40px;min-width:40px;border-radius:50%;overflow:hidden;">' +
                    '<img src="' + _esc(opts.quoterAvatar) + '" alt="' + _esc(opts.quoterName) + '" style="width:40px;height:40px;object-fit:cover;display:block;" ' +
                        'onerror="this.src=\'' + fallbackAva + '\'">' +
                '</div>' +
                '<div class="story-user-info">' +
                    '<strong>' + _esc(opts.quoterName) + '</strong>' +
                    '<span>' + _tsFull(new Date()) + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="story-content"><p>' + _esc(opts.quoteText) + '</p></div>' +
            embedHTML +
            '<div class="story-actions">' +
                '<a class="action-btn comment-btn" data-action="comment" title="Reply"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/></svg><span class="comment-count x-count">0</span></span></a>' +
                '<a class="action-btn retweet-btn" data-action="retweet" title="Repost"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.932 9.48.568 8.02 5 3.88zM19.5 20.12l-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2H11V4h5.5c2.209 0 4 1.79 4 4v8.45l1.568-1.93 1.364 1.46-4.432 4.14z"/></svg><span class="retweet-count x-count">0</span></span></a>' +
                '<a class="action-btn like-btn" data-action="like" title="Like"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z"/></svg><span class="like-count x-count">0</span></span></a>' +
                '<a class="action-btn bookmark-btn" data-action="bookmark" title="Bookmark"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l.5 1v16.5l-6-3.5-6 3.5V4l.5-1z"/></svg></span></a>' +
                '<a class="action-btn share-btn" data-action="share" title="Share"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></span></a>' +
            '</div>' +
            '<div class="comment-section"><div class="comment-list"></div>' +
                '<form class="comment-form" novalidate>' +
                    '<input type="text" name="comment-text" placeholder="Add a comment..." required>' +
                    '<button type="submit"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
                '</form></div>';

        _prependToFeed(card);
    }


    /* ─────────────────────────────────────────────────────────────────────────
       LIVE COUNT SYNC (Firestore onSnapshot)
    ───────────────────────────────────────────────────────────────────────── */
    function _subscribeCounts() {
        if (!_fbOk() || !_activePostId) return;
        try {
            _unsubCounts = window.fbDb.collection(_col()).doc(_activePostId)
                .onSnapshot(function (doc) {
                    if (!doc.exists) return;
                    var d = doc.data();
                    var rtCount = d.retweetCount || d.retweets || 0;
                    var lkCount = d.likes        || 0;
                    var cmCount = d.commentCount || 0;
                    var qtCount = d.quoteCount   || 0;
                    var shCount = d.shareCount   || 0;
                    var dlCount = d.downloadCount|| 0;
                    var vcCount = d.views        || 0;

                    function _fmt(n) {
                        if (!n) return '';
                        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
                        if (n >= 1000)    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
                        return String(n);
                    }

                    /* Update thread count bar */
                    var rtCB = document.getElementById('vf-th-rt-count');
                    var lkCB = document.getElementById('vf-th-lk-count');
                    var qtCB = document.getElementById('vf-th-qt-count');
                    var vcCB = document.getElementById('vf-th-vc-count');
                    if (rtCB) rtCB.innerHTML = '<strong>' + rtCount + '</strong> Reposts';
                    if (lkCB) lkCB.innerHTML = '<strong>' + lkCount + '</strong> Likes';
                    if (qtCB) qtCB.innerHTML = '<strong>' + qtCount + '</strong> Quotes';
                    if (vcCB) vcCB.innerHTML = '<strong>' + vcCount + '</strong> Views';

                    /* Update thread action bar spans */
                    var bar = document.getElementById('vf-th-post-actions');
                    if (bar) {
                        var rtBtn = bar.querySelector('[data-action="retweet"] .vf-act-count');
                        var lkBtn = bar.querySelector('[data-action="like"] .vf-act-count');
                        var qtBtn = bar.querySelector('[data-action="quote"] .vf-act-count');
                        var cmBtn = bar.querySelector('[data-action="comment"] .vf-act-count');
                        var shBtn = bar.querySelector('[data-action="share"] .vf-act-count');
                        var dlBtn = bar.querySelector('[data-action="download"] .vf-act-count');
                        if (rtBtn) rtBtn.textContent = _fmt(rtCount);
                        if (lkBtn) lkBtn.textContent = _fmt(lkCount);
                        if (qtBtn) qtBtn.textContent = _fmt(qtCount);
                        if (cmBtn) cmBtn.textContent = _fmt(cmCount);
                        if (shBtn) shBtn.textContent = _fmt(shCount);
                        if (dlBtn) dlBtn.textContent = _fmt(dlCount);
                    }

                    /* FIX (report — "retweet, quote, and like button and the
                       indicator count doesn't work... clicking any of the
                       above should indicate"): this listener already kept
                       every COUNT live and accurate straight from Firestore
                       — that part worked. What it never did is restore
                       WHETHER THE CURRENT USER personally already liked/
                       reposted/quoted this post: the 'liked'/'retweeted'
                       classes that drive both the filled-heart/colored-icon
                       look AND the repost popup's "Repost" vs. "Undo
                       repost" choice were only ever set by a click
                       happening in THIS SAME page instance — reopening the
                       same post (or opening it fresh, having already acted
                       on it via the main feed) always started from a blank
                       slate, regardless of the real per-user data already
                       sitting in likedBy/retweetedBy/quotedBy on this exact
                       document. Restoring it here, from the same doc this
                       listener already has in hand, is what makes the
                       indicator (and the popup's own state) correct on
                       open, not just after a click. */
                    var uid = (_us() || {}).id;
                    if (uid && bar) {
                        var rtActBtn = bar.querySelector('[data-action="retweet"]');
                        var lkActBtn = bar.querySelector('[data-action="like"]');
                        if (rtActBtn) rtActBtn.classList.toggle('retweeted', (d.retweetedBy || []).indexOf(uid) !== -1);
                        if (lkActBtn) lkActBtn.classList.toggle('liked', (d.likedBy || []).indexOf(uid) !== -1);
                        if ((d.quotedBy || []).indexOf(uid) !== -1 && window.userState && window.userState.quotedPostIds) {
                            window.userState.quotedPostIds.add(_activePostId);
                        }
                        if ((d.retweetedBy || []).indexOf(uid) !== -1 && window.userState && window.userState.retweetedPostIds) {
                            window.userState.retweetedPostIds.add(_activePostId);
                        }
                    }

                    /* Mirror ALL counts back to the source feed card */
                    if (_activePostEl) {
                        var srcRt = _activePostEl.querySelector('.retweet-count');
                        var srcLk = _activePostEl.querySelector('.like-count');
                        var srcCm = _activePostEl.querySelector('.comment-count');
                        var srcQt = _activePostEl.querySelector('.quote-count');
                        var srcSh = _activePostEl.querySelector('.share-count');
                        var srcDl = _activePostEl.querySelector('.download-count');
                        var srcVc = _activePostEl.querySelector('.view-count');
                        if (srcRt) srcRt.textContent = _fmt(rtCount);
                        if (srcLk) srcLk.textContent = _fmt(lkCount);
                        if (srcCm) srcCm.textContent = _fmt(cmCount);
                        if (srcQt) srcQt.textContent = _fmt(qtCount);
                        if (srcSh) srcSh.textContent = _fmt(shCount);
                        if (srcDl) srcDl.textContent = _fmt(dlCount);
                        if (srcVc) srcVc.textContent = _fmt(vcCount);
                    }
                }, function () { /* ignore permission errors */ });
        } catch (e) {}
    }


    /* ─────────────────────────────────────────────────────────────────────────
       COMMENTS — load, render, real-time, send
    ───────────────────────────────────────────────────────────────────────── */
    function _loadComments() {
        var list  = document.getElementById('vf-th-comment-list');
        var cntEl = document.getElementById('vf-th-comment-cnt');
        if (!list) return;
        list.innerHTML = '';

        /* FIX (duplicate comments): this used to ALWAYS seed the list from
           the feed card's own local .comment-list DOM AND THEN ALSO
           subscribe to Firestore for the same post's comments -- so every
           comment that existed in Firestore rendered twice: once from the
           DOM copy (no real id, no timestamp) and once again from the live
           onSnapshot (real id, "now"/real timestamp). Firestore is now the
           single source of truth whenever it's reachable; the DOM seed is
           ONLY used as a fallback when Firestore genuinely isn't -- never
           both at once. */
        var fsReady = !!(_activePostId && _fbOk());

        if (!fsReady) {
            var srcList  = _activePostEl && _activePostEl.querySelector('.comment-list');
            var existing = srcList
                ? Array.from(srcList.querySelectorAll('.comment-item, [class*="comment"]'))
                : [];
            if (existing.length === 0) {
                _showNoComments(list);
            } else {
                existing.forEach(function (c) { _renderCommentFromEl(list, c); });
            }
            if (cntEl) cntEl.textContent = existing.length ? '(' + existing.length + ')' : '';
            return;
        }

        _showNoComments(list);
        if (cntEl) cntEl.textContent = '';

        /* Firestore real-time */
        var knownIds = new Set();
        try {
            _unsubComments = window.fbDb.collection(_col()).doc(_activePostId)
                .collection('comments')
                .orderBy('createdAt', 'asc')
                .limit(200)
                .onSnapshot(function (snap) {
                    snap.docChanges().forEach(function (change) {
                        if (change.type === 'added') {
                            if (knownIds.has(change.doc.id)) return;
                            knownIds.add(change.doc.id);
                            /* Already rendered optimistically by _sendReply()
                               (which now reserves this same Firestore id up
                               front) -- don't render a second copy. */
                            if (list.querySelector('.vf-th-comment-item[data-comment-id="' + change.doc.id + '"]')) return;
                            var ph = list.querySelector('.vf-th-no-comments');
                            if (ph) ph.remove();
                            var d = change.doc.data();
                            _renderCommentData(list, {
                                id:           change.doc.id,
                                text:         d.text || d.comment || '',
                                authorName:   d.authorName  || d.username || 'User',
                                authorAvatar: d.authorAvatar || '',
                                createdAt:    d.createdAt,
                                mediaUrl:     d.mediaUrl  || '',
                                mediaType:    d.mediaType || 'image'
                            });
                        }
                    });
                    var n = list.querySelectorAll('.vf-th-comment-item').length;
                    if (cntEl) cntEl.textContent = n ? '(' + n + ')' : '';
                }, function () { /* ignore errors */ });
        } catch (e) {}
    }

    function _showNoComments(list) {
        list.innerHTML =
            '<div class="vf-th-no-comments">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/></svg>' +
            'No replies yet.<br>Be the first to reply!' +
            '</div>';
    }

    function _renderCommentFromEl(list, el) {
        var img    = el.querySelector('img');
        var strong = el.querySelector('strong, .comment-author');
        var p      = el.querySelector('p, .comment-text');
        _renderCommentData(list, {
            text:         p      ? p.textContent.trim()      : el.textContent.trim(),
            authorName:   strong ? strong.textContent.trim() : 'User',
            authorAvatar: img    ? img.src                   : ''
        });
    }

    function _renderCommentData(list, data) {
        var text = data.text || data.comment || '';
        /* Allow media-only comments (no text required if media present) */
        if (!text && !data.mediaUrl) return;

        var commentId = data.id || ('cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
        var name      = data.authorName || 'User';
        var fallback  = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=1B2B8B&color=fff&size=80';
        var ts        = _tsRelative(data.createdAt);

        /* Build optional media block */
        var mediaHTML = '';
        if (data.mediaUrl) {
            var mType = data.mediaType || 'image';
            if (mType === 'video') {
                mediaHTML =
                    '<div class="vf-th-comment-media">' +
                        '<video src="' + _esc(data.mediaUrl) + '" controls playsinline preload="metadata" ' +
                            'style="width:100%;max-height:260px;display:block;"></video>' +
                    '</div>';
            } else {
                mediaHTML =
                    '<div class="vf-th-comment-media">' +
                        '<img src="' + _esc(data.mediaUrl) + '" alt="attachment" loading="lazy">' +
                    '</div>';
            }
        }

        var item = document.createElement('div');
        item.className       = 'vf-th-comment-item';
        item.dataset.commentId = commentId;
        item.innerHTML =
            '<img class="vf-th-comment-avatar" src="' + _esc(data.authorAvatar || fallback) + '" alt="' + _esc(name) + '" ' +
                'onerror="this.src=\'' + fallback + '\'">' +
            '<div class="vf-th-comment-right">' +
                '<div class="vf-th-comment-header">' +
                    '<span class="vf-th-comment-name">' + _esc(name) + '</span>' +
                    (ts ? '<span class="vf-th-comment-dot">·</span><span class="vf-th-comment-time">' + _esc(ts) + '</span>' : '') +
                '</div>' +
                /* FIX ("make https/www/YouTube/WhatsApp links clickable in
                   the feed"): comment text used to go through _esc() only —
                   correctly safe against HTML injection, but that also meant
                   a pasted https://, www., youtube.com, or wa.me/whatsapp.com
                   link rendered as inert plain text, never a real <a href>,
                   so there was nothing for a tap to open. formatWhatsAppText()
                   already escapes the text itself before linkifying it (same
                   safety _esc() gave), then wraps any URL it finds in a real
                   anchor tag — falling back to the old plain-escaped version
                   if that function isn't loaded for some reason, so this
                   never regresses to a worse state than before. */
                (text ? '<p class="vf-th-comment-text">' + (typeof window.formatWhatsAppText === 'function' ? window.formatWhatsAppText(text) : _esc(text)) + '</p>' : '') +
                mediaHTML +
                '<div class="vf-th-comment-actions">' +
                    '<button class="vf-th-cmt-act vf-cmt-reply" title="Reply"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/></svg> Reply</button>' +
                    '<button class="vf-th-cmt-act vf-cmt-like" title="Like"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z"/></svg> <span>0</span></button>' +
                    '<button class="vf-th-cmt-act vf-cmt-retweet" title="Repost"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.932 9.48.568 8.02 5 3.88zM19.5 20.12l-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2H11V4h5.5c2.209 0 4 1.79 4 4v8.45l1.568-1.93 1.364 1.46-4.432 4.14z"/></svg></button>' +
                    '<button class="vf-th-cmt-act vf-cmt-share" title="Share"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>' +
                '</div>' +
                '<div class="vf-th-subreplies" style="display:none;"></div>' +
            '</div>';

        /* Wire comment actions */
        var likeBtn    = item.querySelector('.vf-cmt-like');
        var replyBtn   = item.querySelector('.vf-cmt-reply');
        var rtBtn      = item.querySelector('.vf-cmt-retweet');
        var shareBtn   = item.querySelector('.vf-cmt-share');

        likeBtn.addEventListener('click', function () {
            if (_isGuest()) { _openAuth(); return; }
            var on = likeBtn.classList.toggle('liked');
            likeBtn.querySelector('svg').setAttribute('fill', on ? 'crimson' : 'none'); likeBtn.querySelector('svg').setAttribute('stroke', on ? 'crimson' : 'currentColor');
            var sp = likeBtn.querySelector('span');
            sp.textContent = Math.max(0, parseInt(sp.textContent || '0', 10) + (on ? 1 : -1));
            if (typeof window._awardImpactMining === 'function' && on) {
                window._awardImpactMining('LIKE_COMMENT', commentId || ('cl-' + Date.now()));
            }
        });

        replyBtn.addEventListener('click', function () {
            if (_isGuest()) { _openAuth(); return; }
            var repliesEl = item.querySelector('.vf-th-subreplies');
            if (repliesEl) repliesEl.style.display = '';
            _openSubReplyComposer(item, commentId);
        });

        rtBtn.addEventListener('click', function () {
            if (_isGuest()) { _openAuth(); return; }
            var on = rtBtn.classList.toggle('retweeted');
            _notify(on ? 'Reply reposted!' : 'Repost removed', on ? 'success' : 'info');
            if (typeof window._awardImpactMining === 'function' && on) {
                window._awardImpactMining('RETWEET_COMMENT', commentId || ('crt-' + Date.now()));
            }
        });

        shareBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            _openShareSheet(text, null);
        });

        list.appendChild(item);
    }

    function _openSubReplyComposer(commentItem, commentId) {
        /* Remove any open sub-reply composers */
        commentItem.querySelectorAll('.vf-th-subreply-composer').forEach(function (c) { c.remove(); });
        var u        = _us();
        var fallback = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(u.fullName || 'U') + '&background=1B2B8B&color=fff&size=80';

        var comp = document.createElement('div');
        comp.className = 'vf-th-subreply-composer';
        comp.innerHTML =
            '<img src="' + _esc(_avatar(u)) + '" alt="You" onerror="this.src=\'' + fallback + '\'">' +
            '<input class="vf-th-subreply-inp" type="text" placeholder="Reply…" autocomplete="off">' +
            '<button class="vf-th-subreply-send" aria-label="Send"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>';

        var right = commentItem.querySelector('.vf-th-comment-right') || commentItem;
        right.appendChild(comp);

        var inp  = comp.querySelector('.vf-th-subreply-inp');
        var send = comp.querySelector('.vf-th-subreply-send');
        inp.focus();

        function _doSend() {
            var txt = (inp.value || '').trim();
            if (!txt) return;

            var repliesEl = commentItem.querySelector('.vf-th-subreplies');
            if (repliesEl) repliesEl.style.display = '';

            var fb2 = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(u.fullName || 'U') + '&background=1B2B8B&color=fff&size=80';
            var reply = document.createElement('div');
            reply.className = 'vf-th-subreply-item';
            reply.innerHTML =
                '<img src="' + _esc(_avatar(u)) + '" alt="' + _esc(u.fullName || 'You') + '" onerror="this.src=\'' + fb2 + '\'">' +
                '<div class="vf-th-subreply-bubble">' +
                    '<span class="vf-th-subreply-name">' + _esc(u.fullName || u.username || 'You') + '</span>' +
                    '<p>' + _esc(txt) + '</p>' +
                '</div>';
            if (repliesEl) repliesEl.appendChild(reply);
            inp.value = '';
            comp.remove();

            /* Firestore */
            if (_fbOk() && _activePostId && commentId) {
                try {
                    window.fbDb.collection(_col()).doc(_activePostId)
                        .collection('comments').doc(commentId)
                        .collection('replies').add({
                            text:         txt,
                            authorId:     u.id       || '',
                            authorName:   u.fullName || u.username || 'User',
                            authorAvatar: _avatar(u),
                            createdAt:    _serverTs()
                        }).catch(function () {});
                } catch (e) {}
            }
        }

        send.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation(); _doSend();
        });
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _doSend(); }
        });
    }


    /* ─────────────────────────────────────────────────────────────────────────
       MEDIA UPLOAD HELPERS
    ───────────────────────────────────────────────────────────────────────── */

    /* Add a thumbnail card to the preview row for a pending media item */
    function _addMediaThumb(item) {
        var row = document.getElementById('vf-th-media-preview-row');
        if (!row) return;
        row.classList.add('has-media');

        var thumb = document.createElement('div');
        thumb.className = 'vf-th-media-thumb' + (item.type === 'video' ? ' vf-th-media-thumb-vid' : '');

        if (item.type === 'video') {
            var vid = document.createElement('video');
            vid.src = item.objectUrl;
            vid.muted = true;
            vid.preload = 'metadata';
            thumb.appendChild(vid);
        } else {
            var img = document.createElement('img');
            img.src = item.objectUrl;
            img.alt = 'attachment';
            thumb.appendChild(img);
        }

        /* Progress overlay (hidden until upload starts) */
        var prog = document.createElement('div');
        prog.className = 'vf-th-media-thumb-progress';
        prog.style.display = 'none';
        prog.innerHTML =
            '<div class="vf-th-media-thumb-progress-bar">' +
                '<div class="vf-th-media-thumb-progress-fill"></div>' +
            '</div>' +
            '<span>0%</span>';
        thumb.appendChild(prog);
        item._progEl = prog;

        /* Remove button */
        var removeBtn = document.createElement('button');
        removeBtn.className = 'vf-th-media-thumb-remove';
        removeBtn.type = 'button';
        removeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        removeBtn.setAttribute('aria-label', 'Remove attachment');
        removeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            URL.revokeObjectURL(item.objectUrl);
            var idx = _pendingMedia.indexOf(item);
            if (idx >= 0) _pendingMedia.splice(idx, 1);
            thumb.remove();
            if (_pendingMedia.length === 0) row.classList.remove('has-media');
            /* Update send button state */
            var inp  = document.getElementById('vf-th-comp-inp');
            var send = document.getElementById('vf-th-comp-send');
            if (send) send.disabled = !((inp && (inp.value || '').trim()) || _pendingMedia.length > 0);
        });
        thumb.appendChild(removeBtn);
        item._thumbEl = thumb;

        row.appendChild(thumb);
    }

    /* Revoke object URLs and reset pending list after a reply is sent */
    function _clearPendingMedia() {
        _pendingMedia.forEach(function (item) {
            try { URL.revokeObjectURL(item.objectUrl); } catch (e) {}
        });
        _pendingMedia = [];
        var row = document.getElementById('vf-th-media-preview-row');
        if (row) { row.innerHTML = ''; row.classList.remove('has-media'); }
    }

    /*
     * Upload one comment-media file. Resolves with the media's permanent
     * URL string, or rejects on failure.
     *
     * MIGRATED (2026-08-03): this used to be its OWN independent
     * direct-to-Cloudinary XHR upload — a private duplicate of the exact
     * same job app-dom.js's window.uploadToCloudinary() already does for
     * every other upload path in the app (posts, status, SOS, KYC, etc.).
     * That meant comment media kept uploading straight to Cloudinary even
     * after app-dom.js was migrated to Firebase Storage, since this
     * function never called it. Now it delegates instead of duplicating —
     * one upload implementation for the whole app, so a future storage
     * change (or bug fix) only ever needs to happen in one place.
     * app-dom.js loads before this file in index.html, so
     * window.uploadToCloudinary is guaranteed to exist here.
     */
    function _uploadToCloudinary(item) {
        return new Promise(function (resolve, reject) {
            if (typeof window.uploadToCloudinary !== 'function') {
                /* app-dom.js failed to load — cannot persist media across
                   sessions. Notify and skip rather than storing a broken
                   blob URL. */
                _notify('Media upload unavailable — please retry.', 'warning');
                resolve('');
                return;
            }

            window.uploadToCloudinary(item.file, function (pct) {
                if (item._progEl) {
                    item._progEl.style.display = 'flex';
                    var fill = item._progEl.querySelector('.vf-th-media-thumb-progress-fill');
                    var lbl  = item._progEl.querySelector('span');
                    if (fill) fill.style.width = pct + '%';
                    if (lbl)  lbl.textContent  = pct + '%';
                }
            }).then(function (url) {
                item.uploaded = true;
                item.url      = url;
                /* Hide progress overlay */
                if (item._progEl) item._progEl.style.display = 'none';
                resolve(url);
            }).catch(reject);
        });
    }


    /* ─────────────────────────────────────────────────────────────────────────
       SEND REPLY
    ───────────────────────────────────────────────────────────────────────── */
    function _sendReply() {
        if (_isGuest()) { _openAuth(); return; }
        var inp  = document.getElementById('vf-th-comp-inp');
        var send = document.getElementById('vf-th-comp-send');
        if (!inp) return;
        var text      = (inp.value || '').trim();
        var hasMedia  = _pendingMedia.length > 0;
        if (!text && !hasMedia) return;

        var u    = _us();
        var list = document.getElementById('vf-th-comment-list');
        var cnt  = document.getElementById('vf-th-comment-cnt');

        /* FIX (duplicate on send): reserve the Firestore doc ID up front so
           the optimistic render below and the realtime listener's "added"
           event (once Firestore echoes this comment back) refer to the
           exact same element -- _loadComments()'s onSnapshot handler skips
           rendering if an item with this id is already in the DOM, so this
           is what actually stops the just-sent comment from appearing a
           second time a moment later. */
        var newCommentRef = (_fbOk() && _activePostId)
            ? window.fbDb.collection(_col()).doc(_activePostId).collection('comments').doc()
            : null;
        var newCommentId = newCommentRef ? newCommentRef.id : null;

        /* Lock UI while uploading/sending */
        if (send) send.disabled = true;
        inp.value = '';

        /* Snapshot pending media and clear the queue from the composer */
        var mediaToUpload = _pendingMedia.slice();
        _clearPendingMedia();

        /* Scroll hint */
        var body = document.getElementById('vf-th-body');

        /* Upload all attached files, then fire the comment */
        var uploadPromises = mediaToUpload.map(function (item) {
            return _uploadToCloudinary(item).catch(function (err) {
                console.warn('[Thread] Media upload failed:', err);
                _notify('One attachment failed to upload — sending text only.', 'warning');
                return '';  /* Don't block the reply; just skip that file */
            });
        });

        Promise.all(uploadPromises).then(function (uploadedUrls) {
            /* Build final mediaUrl (first successful upload) + mediaUrls (all) */
            var validUrls = uploadedUrls.filter(Boolean);
            var mediaUrl  = validUrls[0] || '';
            var mediaType = (mediaToUpload[0] && mediaToUpload[0].type) || 'image';

            /* ── Optimistic render ── */
            var ph = list && list.querySelector('.vf-th-no-comments');
            if (ph) ph.remove();
            _renderCommentData(list, {
                id:           newCommentId || undefined,
                text:         text,
                authorName:   u.fullName || u.username || 'You',
                authorAvatar: _avatar(u),
                createdAt:    new Date(),
                mediaUrl:     mediaUrl,
                mediaType:    mediaType
            });

            var n = list ? list.querySelectorAll('.vf-th-comment-item').length : 0;
            if (cnt) cnt.textContent = '(' + n + ')';

            /* Mirror reply count on source feed card */
            if (_activePostEl) {
                var badge = _activePostEl.querySelector('.comment-count');
                if (badge) badge.textContent = String(parseInt(badge.textContent || '0', 10) + 1);
            }

            /* Scroll to bottom */
            if (body) setTimeout(function () { body.scrollTop = body.scrollHeight; }, 80);

            /* Mining */
            if (typeof window._awardImpactMining === 'function') {
                window._awardImpactMining('REPLY_POST', _activePostId || ('rp-' + Date.now()));
            }

            /* Firestore persist */
            if (newCommentRef) {
                var doc = {
                    text:         text,
                    authorId:     u.id       || '',
                    authorName:   u.fullName || u.username || 'User',
                    authorAvatar: _avatar(u),
                    createdAt:    _serverTs()
                };
                if (mediaUrl)               doc.mediaUrl   = mediaUrl;
                if (mediaUrl && mediaType)  doc.mediaType  = mediaType;
                if (validUrls.length > 1)   doc.mediaUrls  = validUrls;

                try {
                    newCommentRef.set(doc)
                        .then(function () {
                            try {
                                window.fbDb.collection(_col()).doc(_activePostId)
                                    .update({ commentCount: _inc(1) })
                                    .catch(function () {});
                            } catch (_e) {}
                        })
                        .catch(function () {
                            _notify('Could not save reply — check your connection.', 'warning');
                        });
                } catch (e) {}
            }
        });
    }


    /* ─────────────────────────────────────────────────────────────────────────
       FEED REPOST BUTTON delegation  (on .action-btn.retweet-btn in feed cards)

       FIX (2026-07-29 — "retweet fires multiple times" / inflated engagement
       counts): this handler and app-fixes.js's master click handler
       (setupMasterEventListeners, its own `closest('.retweet-btn')` branch)
       BOTH matched the exact same feed-card retweet button and BOTH ran on
       every click — this one via a bubble-phase listener on `document`,
       app-fixes.js's via a bubble-phase listener on `document.body`. Bubble
       order reaches `document.body` first, then `document`, and
       app-fixes.js's branch never called stopPropagation() for retweet, so
       the click always fell through to this handler too. Result: TWO
       independent popups (app-fixes.js's `._rt_picker` AND this file's
       `#vf-rt-popup`) and, if either/both were completed, TWO separate
       retweetCount increments, TWO reward payouts, and TWO repost documents
       written to Firestore for one tap — exactly the reported "retweet
       triggered multiple times, each click counted."

       app-fixes.js's picker is the actively-maintained implementation (it
       already has the crisis_reports/business_posts collection routing, the
       one-time RETWEET_POST dedup key, and the live-count Firestore writes —
       see its own "FIX (double mining reward)" comment, which already
       documents app-fix-final.js's capture-phase mining engine deferring to
       it for the same reason). So rather than keep two parallel repost
       implementations racing each other, this file's retweet-btn branch is
       disabled here — the dedicated .action-btn.quote-btn branch just below
       is untouched, since app-fixes.js's picker has no equivalent for that
       button (only for the "Quote" option inside ITS OWN retweet popup).
    ───────────────────────────────────────────────────────────────────────── */
    document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;

        /* Close popup on any outside click */
        if (!t.closest('#vf-rt-popup') && document.getElementById('vf-rt-popup')) {
            _closeRtPopup();
        }

        /* Feed card repost button — DISABLED, see fix note above.
           app-fixes.js's own `.retweet-btn` handler (setupMasterEventListeners)
           is now the sole handler for this button in the feed; this file's
           #vf-rt-popup flow no longer runs for it, so only one popup and one
           counted retweet happens per click. */

        /* Feed card quote button (.action-btn.quote-btn) */
        var qtBtn = t.closest('.action-btn.quote-btn');
        if (qtBtn) {
            var card2 = qtBtn.closest('.impact-story');
            if (!card2) return;
            e.preventDefault(); e.stopPropagation();
            if (_isGuest()) { _openAuth(); return; }
            if (_isOwnPostEl(card2)) { _blockSelfRepost(); return; }
            _activePostId = card2.dataset.postId || card2.dataset.id || null;
            _activePostEl = card2;
            openThread(card2);
            setTimeout(function () { _openQuote(card2); }, 200);
            return;
        }
    });


    /* ─────────────────────────────────────────────────────────────────────────
       OPEN THREAD on post card click (not on interactive children)
    ───────────────────────────────────────────────────────────────────────── */
    document.addEventListener('click', function (e) {
        var t = e.target;
        if (t.closest(
            'button,a,input,textarea,select,' +
            '.options-btn,.options-menu,.action-btn,.comment-form,' +
            '.story-actions,.sos-button,.help-now-btn,.donate-post-btn,' +
            '#vf-rt-popup,#vf-rt-popup-backdrop,' +
            /* FEATURE (report — "original tweeted axis"/"original quote box"
               should redirect to the original post, not this card's own
               thread): both now have their own dedicated handler further
               below that sends the tap to the ORIGINAL post instead —
               excluded here so this generic handler doesn't also fire and
               open the wrong (this card's) thread underneath it. */
            '.retweet-header,.vf-quote-card-embed'
        )) return;

        var post = t.closest(
            '#feed-container .impact-story,' +
            '#posts-feed .impact-story,' +
            '.feed-section .impact-story,' +
            '[id="dashboard"] .impact-story'
        );
        if (!post) return;
        e.preventDefault();
        e.stopPropagation();
        openThread(post);
    });

    /* Comment button opens thread */
    document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('.comment-btn, .action-btn[title="Comment"]');
        if (!btn) return;
        var post = btn.closest('.impact-story');
        if (!post) return;
        e.preventDefault();
        e.stopPropagation();
        openThread(post);
    }, true);

    /* ─────────────────────────────────────────────────────────────────────────
       RETWEET-HEADER / QUOTE-EMBED -> ORIGINAL POST
       Both the "X Retweeted" banner (app-feed.js's retweetHeaderHTML) and the
       embedded quoted-post card (app-feed.js's quoteEmbedHTML, and the
       equivalent hand-built block in app-fixes.js's own quote-compose flow)
       now carry a data-orig-post-id attribute when the original post's id is
       known (older cached posts saved before this feature won't have one —
       those elements render with no cursor:pointer and this handler simply
       has nothing to do, same as before). window.openPostById (this file)
       already handles the original post not currently being rendered on
       screen — it navigates to the feed, polls briefly, and falls back to a
       direct Firestore read, so this works whether or not the original is
       one of the ~40 most recent posts still live in the feed listener.
    ───────────────────────────────────────────────────────────────────────── */
    document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;

        var link = t.closest('.retweet-header[data-orig-post-id], .vf-quote-card-embed[data-orig-post-id]');
        if (!link) return;

        /* Let a tap on the embedded preview VIDEO control the media itself
           (play/pause, native controls, scrub) instead of hijacking it into
           a navigation away from the card the person is looking at. An
           image thumbnail has no competing interaction, so it still
           navigates like the rest of the box. */
        if (t.closest('video')) return;

        e.preventDefault();
        e.stopPropagation();
        var origId = link.dataset.origPostId;
        if (origId && typeof window.openPostById === 'function') {
            openPostById(origId);
        }
    });

    /* Back button failsafe */
    document.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('#vf-th-back')) {
            e.preventDefault(); e.stopPropagation(); _close();
        }
    }, true);


    /* ─────────────────────────────────────────────────────────────────────────
       INIT
    ───────────────────────────────────────────────────────────────────────── */
    _ready(function () {
        setTimeout(function () {
            _buildOverlay();
            _buildQuoteFullModal();
        }, 300);
    });
    document.addEventListener('empyrean-init-done', function () {
        setTimeout(function () {
            _buildOverlay();
            _wireQuoteModal();
            _buildQuoteFullModal();
        }, 400);
    });

    /* Expose globally so all sections (feed, business, crisis, news) can use native share */
    window._empShare = _openShareSheet;
    window._empShowShareSheet = function(url, text) {
        _showFallbackSheet(text || 'Check this out on Empyrean', url || window.location.href);
    };

    console.log('[Thread] ✅ app-thread.js v2.2 loaded — comment media upload (Cloudinary), share sheet, quoted-post full-view, X-style repost popup, live counts, real-time replies.');

})();