/* =============================================================================
   EMPYREAN INTERNATIONAL — REELS ENGAGEMENT MODULE  (v2 — Full Engagement)
   app-reels.js

   FEATURES
   ────────
   • Full comment & sub-comment thread with collapse/expand
   • Bubble like on posts, comments, and sub-comments
   • Retweet with count
   • Share button
   • Real-time downloadable button (downloads to device)
   • Exit / close button at top of viewer
   • Swipeable vertically (IntersectionObserver + touch)
   • Connects to impact mining (CREATE_REEL, ENGAGE_LIKE, ENGAGE_COMMENT)
   ============================================================================= */

(function empyreanReelsModule() {
    'use strict';

    if (window._empyreanReelsLoaded) { return; }
    window._empyreanReelsLoaded = true;

    function _S()       { return window.EmpState || {}; }
    function _us()      { return _S().userState || window.userState || {}; }
    function _isGuest() { var s = _S(); return s.isGuest != null ? s.isGuest : (window.isGuest !== undefined ? window.isGuest : true); }
    /* FIX (2026-08-12 — "Missing or insufficient permissions" on Share):
       _isGuest() only reflects this app's own client-side S.isGuest flag —
       it says nothing about whether the live Firebase Auth session behind
       it is actually attached, or whether it's real vs anonymous. Two
       collections this file writes to (`posts` via
       _shareReelLiveBroadcast, `reels` via _rebroadcastReel) require
       isRealAccount() server-side (firebase-rules.js: request.auth != null
       AND sign_in_provider != 'anonymous') — stricter than the plain
       "any authenticated session" posture reel_live_broadcasts itself
       uses. A tap that passes _isGuest() while that live session hasn't
       attached yet, or is still the anonymous fallback session guests get
       signed into automatically (same restoreLocalSession() timing gap
       already fixed for the Go-Live submit handler above), reached the
       .set() write anyway and got denied — surfacing as exactly this
       error. Mirrors the Go-Live submit handler's own currentUser check,
       plus the extra non-anonymous check these two collections actually
       need. */
    function _requireRealAccountForShare() {
        var live = window.fbAuth && window.fbAuth.currentUser;
        if (!live) {
            _notify('Your session is still connecting — please wait a moment and try again.', 'info');
            return false;
        }
        if (live.isAnonymous) {
            _notify('Log in to share this — guest sessions can\u2019t post to the feed.', 'info');
            return false;
        }
        return true;
    }
    /* FIX ("Missing or insufficient permissions" on Like/Gift): unlike
       _requireRealAccountForShare() above, reel_live_broadcasts/
       live_gifts/the empyBalance-credit path on users/{hostId} (see
       firebase-rules.js) only require SOME Firebase Auth session to
       exist — anonymous is fine, there's no isRealAccount() gate on any
       of these. But Like/Gift's write paths previously only checked
       window._firebaseLoaded && window.fbDb — that reflects whether the
       Firestore SDK object itself is ready, not whether a session has
       actually finished signing in. Firebase Auth attaches asynchronously
       (real session restore, or the anonymous fallback sign-in guests get
       — see app-patch-v12.js/v31.js's own header notes on this exact
       timing gap), so a tap that lands in that gap reached the Firestore
       write anyway and got denied server-side with exactly this error —
       indistinguishable from a real bug to whoever tapped it. Checking
       window.fbAuth.currentUser first (any session, anonymous included)
       catches that gap client-side and gives a clear, recoverable message
       instead of a raw permission-denied one screen away. */
    function _requireAnySessionForWrite() {
        if (!(window.fbAuth && window.fbAuth.currentUser)) {
            _notify('Your session is still connecting — please wait a moment and try again.', 'info');
            return false;
        }
        return true;
    }
    function _esc(s)    { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _notify(m, t) { if (typeof window.showNotification === 'function') window.showNotification(m, t||'info'); }
    function _reward(action, uid) { if (typeof window.rewardUserForAction === 'function') window.rewardUserForAction(action, uid); }
    function _timeAgo(ts) { return typeof window._timeAgo === 'function' ? window._timeAgo(ts) : 'now'; }

    /* FIX (2026-08-22 — reel thumbnails rendering inconsistently, some
       showing solid black, some rendering "bigger"/differently than
       others): every reel <video> across the app (main grid, profile
       gallery, profile mid-feed strip, fullscreen viewer) was created
       with no `poster` attribute at all, so — with only `preload=
       "metadata"` set — the box stays solid black until the browser
       actually decodes a frame, which lands at a different moment for
       every card depending on that card's own network timing. Combined
       with each card's aspect-ratio/max-height CSS being computed from
       its box, not its (still-absent) video content, a still-loading
       black card and an already-painted one can visibly read as
       differently sized/rendering "wrong" even though their CSS box is
       identical. Generating a real poster frame up front — the same
       Cloudinary poster-frame trick server.js's own
       _videoPosterFromCloudinary() already uses for share-link previews,
       mirrored here client-side — means every card shows its actual
       first frame immediately, consistently, the moment it's added to
       the DOM, instead of racing decode timing. Mirrors server.js's own
       branch order: an in-account Cloudinary video URL is rewritten in
       place; a migrated Firebase-Storage (or any other https) URL goes
       through Cloudinary's `video/fetch` delivery, which can derive a
       poster frame from any public URL on the fly. Returns '' (no
       poster attribute set — falls back to the plain black-until-decode
       behavior this already had) if the URL isn't usable or Cloudinary
       isn't configured, so this can only ever add a poster, never break
       an existing video. */
    function _empReelPosterUrl(videoUrl) {
        if (!videoUrl) return '';
        try {
            if (/res\.cloudinary\.com/i.test(videoUrl) && /\/video\/upload\//.test(videoUrl)) {
                return videoUrl
                    .replace('/video/upload/', '/video/upload/so_0,w_500,h_600,c_fill,q_auto,f_jpg/')
                    .replace(/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i, '.jpg');
            }
            var cfg = (window._appConfig && window._appConfig.cloudinary) || {};
            var cloud = cfg.cloud;
            if (cloud && /^https?:\/\//i.test(videoUrl)) {
                return 'https://res.cloudinary.com/' + cloud + '/video/fetch/so_0,w_500,h_600,c_fill,q_auto,f_jpg/' + encodeURIComponent(videoUrl) + '.jpg';
            }
        } catch (e) { /* fall through to no-poster, same as before this fix */ }
        return '';
    }
    window._empReelPosterUrl = _empReelPosterUrl;

    /* ── CSS ── */
    (function _css() {
        if (document.getElementById('_reels_eng_style')) return;
        var s = document.createElement('style');
        s.id = '_reels_eng_style';
        s.textContent = [
            /* Reel viewer overlay */
            '#reel-viewer-modal-overlay { position:fixed;inset:0;z-index:9900;background:#000;display:none;flex-direction:column;overflow:hidden; }',
            '#reel-viewer-modal-overlay.show { display:flex !important; }',
            /* Exit button — fixed to viewport, shown only when overlay is active */
            '#reel-exit-btn { position:fixed;top:18px;right:18px;z-index:10000;background:rgba(10,14,30,0.75);border:1.5px solid rgba(255,255,255,0.22);cursor:pointer;color:white;width:46px;height:46px;border-radius:50%;display:none;align-items:center;justify-content:center;font-size:1.15rem;backdrop-filter:blur(10px);box-shadow:0 4px 22px rgba(0,0,0,0.6);transition:background 0.2s,transform 0.15s; }',
            '#reel-viewer-modal-overlay.show ~ #reel-exit-btn, body.reel-open #reel-exit-btn { display:flex !important; }',
            '#reel-exit-btn:hover { background:rgba(229,57,53,0.8);transform:scale(1.1); }',
            '#reel-exit-btn:active { transform:scale(0.94); }',
            /* Hide the app's fixed bottom nav while the fullscreen reel viewer
               is open. #mobile-bottom-nav is position:fixed, z-index:10000 —
               higher than #reel-viewer-modal-overlay's z-index:9900 — so it was
               physically sitting on top of the bottom 60px of every reel,
               covering the avatar/username/caption strip underneath it.
               Scoped to body.reel-open only, so the nav still works normally
               on the reel grid tab before a reel is opened. */
            'body.reel-open #mobile-bottom-nav { display:none !important; }',
            /* Hide the top-left mobile hamburger menu toggle while the fullscreen
               reel viewer is open. .mobile-menu-toggle is position:fixed with a
               z-index (9998) higher than #reel-viewer-modal-overlay's (9900), so
               it was sitting on top of the reel's top-left corner along with its
               drop shadow. The reel viewer already has its own exit (X) button,
               so the hamburger toggle is redundant here — hide it (and its
               shadow) completely, scoped to body.reel-open only so it still
               works normally everywhere else. */
            'body.reel-open .mobile-menu-toggle { display:none !important; box-shadow:none !important; }',
            /* ═══════════════════════════════════════════════════════════════
               PERMANENT GAP FIX — ACTUAL ROOT CAUSE (2026-08-11, this session,
               SUPERSEDES every earlier "permanent" attempt below/above): the
               gap between the topbar/status-bar and the first avatar/reel
               card kept coming back no matter how many times
               _syncReelsTopbar() was hardened (ResizeObserver, MutationObserver,
               fonts.ready — see that function further down) because none of
               those ever measured the true culprit: app-fixes.js
               unconditionally injects a #nav-breadcrumb element as the very
               first child of <main class="main-content">, directly BEFORE
               #status-bar-container in the DOM, on every section, with no
               existing rule to hide it anywhere. It is NOT position:fixed —
               it sits in normal document flow, so while #reels-fixed-topbar
               (fixed, painted on top of it) visually hides it from view, it
               still physically occupies its own ~35px of real height
               (padding:7px 20px + text) ABOVE #status-bar-container and the
               grid, a gap nothing in this file's topbar-height accounting
               ever knew existed. That's why every fix here "worked" the
               moment it shipped (the topbar/status-bar math was always
               internally correct) and then "came back" the next time anyone
               looked — the actual extra element was never touched. Hiding it
               only while on this section — same scoped pattern already used
               for #mobile-bottom-nav and .mobile-menu-toggle above — removes
               the phantom space at the source instead of trying to keep
               compensating for it. */
            'body.emp-section-reels #nav-breadcrumb { display:none !important; }',
            /* Reel container — vertical scroll */
            '#reel-viewer-container { flex:1;overflow-y:auto;scroll-snap-type:y mandatory;scrollbar-width:none; }',
            '#reel-viewer-container::-webkit-scrollbar { display:none; }',
            /* Each reel item */
            '.reel-viewer-item { position:relative;width:100%;height:100vh;height:100dvh;background:#000;flex-shrink:0;display:flex;align-items:center;justify-content:center;scroll-snap-align:start; }',
            '.reel-viewer-item video { width:100%;height:100%;object-fit:contain;display:block; }',
            /* Right-side engagement bar */
            '.reel-engagement-bar { position:absolute;right:12px;bottom:calc(70px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;align-items:center;gap:18px;z-index:10; }',
            '.reel-eng-btn { background:rgba(0,0,0,0.5);border:none;cursor:pointer;color:white;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px;border-radius:12px;font-size:0.7rem;backdrop-filter:blur(4px);transition:transform 0.15s,background 0.15s;min-width:44px; }',
            /* Views indicator (this session — "live counts... viewing") is a
               <div>, not a button — read-only, so no pointer cursor/tap
               feedback, everything else about its look matches its
               .reel-eng-btn siblings. */
            '.reel-view-indicator { cursor:default; }',
            '.reel-view-indicator:active { transform:none; }',
            '.reel-eng-btn:active { transform:scale(0.92); }',
            '.reel-eng-btn i { font-size:1.3rem; }',
            '.reel-eng-btn.liked i { color:#f87171; }',
            '.reel-eng-btn.retweeted i { color:#00D4AA; }',
            /* Bottom info strip — now that the bottom nav is hidden while the
               viewer is open there is no overlap left to clear, but the extra
               bottom padding (plus safe-area awareness for gesture-nav phones)
               keeps the avatar/username/caption comfortably clear of the very
               edge of the screen instead of sitting flush against it. */
            '.reel-info-strip { position:absolute;bottom:0;left:0;right:0;padding:60px 16px calc(34px + env(safe-area-inset-bottom,0px));background:linear-gradient(transparent,rgba(0,0,0,0.80));color:white; }',
            '.reel-info-strip .reel-username { font-weight:700;font-size:0.92rem;display:flex;align-items:center;gap:8px;margin-bottom:4px; }',
            '.reel-info-strip .reel-caption { font-size:0.85rem;opacity:0.9;max-height:60px;overflow:hidden; }',
            /* Comments drawer — lives on <body>, never inside a scroll container */
            '#reel-shared-comments-drawer { position:fixed;bottom:0;left:0;right:0;background:rgba(15,15,25,0.97);border-radius:18px 18px 0 0;max-height:65vh;display:flex;flex-direction:column;transform:translateY(100%);transition:transform 0.35s cubic-bezier(0.32,0.72,0,1);z-index:10200; }',
            '#reel-shared-comments-drawer.open { transform:translateY(0) !important; }',
            /* Backdrop scrim behind drawer */
            '#reel-comments-scrim { position:fixed;inset:0;background:rgba(0,0,0,0);z-index:10199;display:none;transition:background 0.3s; }',
            '#reel-comments-scrim.active { display:block;background:rgba(0,0,0,0.45); }',
            '#reel-shared-comments-drawer .reel-comments-header { padding:14px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0; }',
            '#reel-shared-comments-drawer .reel-comments-list { flex:1;overflow-y:auto;padding:12px 16px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent; }',
            /* Comment item */
            '.reel-comment { display:flex;gap:10px;margin-bottom:14px; }',
            '.reel-comment-avatar { width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0; }',
            '.reel-comment-body { flex:1;min-width:0; }',
            '.reel-comment-username { font-weight:700;font-size:0.82rem;color:#E8F0FF;margin-bottom:2px; }',
            '.reel-comment-text { font-size:0.85rem;color:rgba(255,255,255,0.85);word-break:break-word; }',
            '.reel-comment-actions { display:flex;align-items:center;gap:10px;margin-top:4px; }',
            '.reel-comment-like-btn { background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.5);font-size:0.75rem;padding:0;display:flex;align-items:center;gap:4px; }',
            '.reel-comment-like-btn.liked { color:#f87171; }',
            '.reel-comment-reply-btn { background:none;border:none;cursor:pointer;color:rgba(0,212,170,0.8);font-size:0.75rem;padding:0; }',
            /* Sub-comments */
            '.reel-subcomments { margin-left:46px;margin-top:8px; }',
            /* Comment input */
            '#reel-shared-comments-drawer .reel-comment-input-row { padding:12px 16px;display:flex;gap:10px;align-items:center;border-top:1px solid rgba(255,255,255,0.15);flex-shrink:0;background:rgba(15,15,25,1);padding-bottom:calc(14px + env(safe-area-inset-bottom,0px)); }',
            '.reel-comment-input { flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:8px 14px;color:white;font-size:0.88rem;outline:none; }',
            '.reel-comment-input::placeholder { color:rgba(255,255,255,0.4); }',
            '.reel-comment-send-btn { background:#00D4AA;border:none;cursor:pointer;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#0A0F1E; }',

            /* =====================================================================
               REEL SECTION REDESIGN (2026-08-10) — the main #reels-grid-container
               feed only. Scoped entirely to that id so the profile "Reels" gallery
               tab and the profile mid-feed reel strip (app-profile.js's
               .emp-profile-reel-thumb / .emp-profile-reel-strip-card — a totally
               different, deliberately compact layout) are completely untouched.
               ===================================================================== */
            /* Single vertical column instead of the old auto-fit card grid. */
            '#reels-grid-container.reels-grid { display:flex !important;flex-direction:column;gap:22px; }',
            '#reels-grid-container #reels-empty-state { display:block; }',
            '#reels-grid-container .reel-card { position:relative;height:auto;min-height:0;padding:0;display:block;background:var(--color-white,#fff);border:1px solid rgba(10,14,39,0.08) !important;width:100%;margin-left:0;margin-right:0; }',
            /* EDGE-TO-EDGE (this session, point 3): explicit, high-specificity
               width:100%/zero-margin guarantee for every ordinary (non-pinned)
               grid card, so the thumbnail always fills the full device width
               regardless of any padding an ancestor container might carry —
               same "always edge-to-edge, never dependent on an ancestor
               happening to be zero-padded" guarantee the pinned/active card
               already gets for free from its position:fixed;left:0;right:0
               rule further down. */
            '#reels-grid-container .reel-card::before { display:none; }', /* old on-video gradient overlay — replaced by the real meta row below the thumbnail */
            /* DURATION BADGE (this session, point 1): small dark pill in the
               bottom-right corner of the thumbnail showing the clip length
               (e.g. "0:16"), filled in by _wireReelDurations() below once
               each video's metadata loads. Starts empty — an empty badge is
               hidden via :empty so nothing shows before the duration is known. */
            '.reel-duration-badge { position:absolute;right:8px;bottom:8px;z-index:5;background:rgba(0,0,0,0.75);color:#fff;font-size:0.72rem;font-weight:700;padding:2px 7px;border-radius:5px;letter-spacing:0.2px;pointer-events:none; }',
            '.reel-duration-badge:empty { display:none; }',
            /* Fallback avatar-tap profile-preview sheet (this session, point
               3) — only ever built if window.openHostPreviewModal isn't
               loaded; see _openReelProfilePreviewFallback(). */
            '#reel-profile-preview-sheet { position:fixed;inset:0;z-index:10300;display:flex;align-items:center;justify-content:center; }',
            '.reel-profile-preview-backdrop { position:absolute;inset:0;background:rgba(0,0,0,0.55); }',
            '.reel-profile-preview-card { position:relative;background:var(--color-white,#fff);border-radius:18px;padding:28px 22px 22px;width:min(86vw,320px);text-align:center;box-shadow:0 18px 50px rgba(10,14,39,0.35); }',
            '.reel-profile-preview-close { position:absolute;top:10px;right:10px;background:rgba(10,14,39,0.08);border:none;width:30px;height:30px;border-radius:50%;font-size:1.1rem;line-height:1;cursor:pointer;color:var(--secondary,#1B2B8B); }',
            '.reel-profile-preview-avatar-wrap { width:84px;height:84px;border-radius:50%;overflow:hidden;margin:0 auto 14px;background:var(--color-neutral-100,#eee); }',
            '.reel-profile-preview-avatar { width:100%;height:100%;object-fit:cover;display:block; }',
            '.reel-profile-preview-username { font-weight:800;font-size:1rem;color:var(--primary,#0A0E27);margin-bottom:6px; }',
            '.reel-profile-preview-bio { font-size:0.85rem;color:var(--text-muted,#5b6472);margin-bottom:18px;max-height:90px;overflow-y:auto; }',
            '.reel-profile-preview-full-btn { background:var(--secondary,#1B2B8B);color:#fff;border:none;border-radius:24px;padding:10px 22px;font-weight:700;font-size:0.85rem;cursor:pointer; }',
            /* Video "player" — wrapped in .reel-video-wrap (holds the video
               itself plus the play/pause + mute/unmute controls). SIZE FIX
               (2026-08-10): the player was reading as far too tall/long —
               capped down to a compact, fixed-feeling size that matches the
               reference screenshot instead of stretching toward 70vh. */
            '#reels-grid-container .reel-video-wrap { position:relative;width:100%;background:#000; }',
            '#reels-grid-container .reel-video-wrap > video { position:relative;inset:auto;width:100%;aspect-ratio:4/5;max-height:44vh;object-fit:cover;display:block;background:#000; }',
            /* SIZE FIX (2026-08-11, this session — "reduce the vertical square
               scrollable card"): the ORDINARY (non-pinned) card's video above
               is a 4:5 portrait box capped at 44vh — this is the tall
               "square-ish" thumbnail the request is about, distinct from the
               pinned/active card's own height rules further down (those are
               untouched — see the revert note near the active-card comment-
               indicator rule). Narrowed the aspect ratio a little and lowered
               the vh cap so each scrollable card takes up noticeably less
               vertical space while scrolling, without affecting the pinned
               "now playing" card at all. Same "later-in-source-order wins on
               this identical selector" convention — nothing above is
               deleted, only superseded. */
            '#reels-grid-container .reel-card:not(.reel-card-active) .reel-video-wrap > video { aspect-ratio:4/3;max-height:34vh; }',
            /* SIZE FIX (this session, follow-up — "slightly reduce the size
               of the vertical scrolling reel card for better layout
               balance"): one further, deliberately SMALL trim on top of the
               34vh cap above (same "later wins" convention, nothing above
               deleted) — enough to visibly tighten the column without
               shrinking the thumbnail into an unreadable postage stamp. The
               card-to-card gap is nudged down to match, so the whole column
               reads proportionally tighter rather than just the videos. */
            '#reels-grid-container .reel-card:not(.reel-card-active) .reel-video-wrap > video { max-height:30vh; }',
            '#reels-grid-container.reels-grid { gap:16px; }',
            /* The reel currently pinned as "now playing" — either the newest
               reel (default) or whichever one the person most recently tapped
               — is now TRULY fixed to the top of the viewport (position:fixed,
               not sticky) so it never scrolls at all: every other card in the
               feed scrolls upward and passes underneath/behind it, exactly
               like a native reels/shorts "now playing" header. Edge-to-edge:
               fixed positioning is relative to the VIEWPORT, so left:0/right:0
               here bleeds past .main-content's own 30px padding automatically
               — no negative-margin trick needed. Border-radius removed and a
               solid background added so cards scrolling underneath are fully
               hidden, not just outlined.
               A same-height spacer (.reel-active-spacer, inserted by
               app-reel.js's own _applyActiveReelOrdering()/_syncActiveSpacer())
               is what keeps the rest of the feed from jumping up into the
               space the fixed card no longer occupies in normal flow.
               top offset (2026-08-10, this session): was a flat 0, which
               pinned this card directly under the device status bar,
               covering #reels-fixed-topbar (search bar + "Reels (Shorts)"
               title + upload trigger — see index.html) underneath it. Now
               reads the same --reels-topbar-h custom property that sizes
               #reels-topbar-spacer (kept in sync by _syncReelsTopbar()
               further down this file), so the pinned card always sits
               directly BELOW that top bar instead of covering it — i.e.
               the search bar and upload option now render BEFORE (above)
               this card, not behind it. */
            /* PINNED CARD TOP OFFSET — SIMPLIFIED (2026-08-11, this
               session): used to add --reels-statusbar-h on top of
               --reels-topbar-h here so the pinned card cleared BOTH the
               fixed topbar AND the (then also fixed) status bar stacked
               above it. The status bar is no longer fixed while unpinned
               (see the "STATUS BAR — GENUINE SCROLL" rewrite further down
               this file) and is always display:none while a card IS
               pinned, so it never occupies any screen space the pinned
               card would need to clear any more — only the topbar does.
               Dropping the statusbar term here (rather than leaving it as
               dead weight, since it now always resolves to 0 while pinned
               anyway) keeps this in sync with the CSS var it now actually
               depends on. */
            '#reels-grid-container .reel-card.reel-card-active { position:fixed !important;top:var(--reels-topbar-h,96px);left:0;right:0;width:100%;margin:0;border-radius:0 !important;z-index:500;box-shadow:0 10px 24px rgba(10,14,39,0.3);background:var(--color-white,#fff); }',
            /* SIZE FIX (2026-08-10, follow-up): a true 1:1 square at full
               device width was still far too tall in absolute pixels (on a
               ~400px-wide phone that's a ~400px player before the caption/
               meta row even starts) — it was swallowing the next scrollable
               card almost entirely. Dropped the aspect-ratio approach for
               the active card in favor of a fixed, compact height — still
               full edge-to-edge WIDTH (object-fit:cover keeps the crop
               centered, so it still reads as a clean, classic square-ish
               "now playing" frame), just deliberately short so the next
               card is clearly visible/peeking right underneath it. */
            '#reels-grid-container .reel-card.reel-card-active .reel-video-wrap > video { aspect-ratio:auto;height:26vh;max-height:230px;object-fit:cover; }',
            /* SIZE FIX (2026-08-10, second follow-up): still swallowing the
               next scrollable card, so the pinned player is capped smaller
               again, and the caption/meta strip beneath it (which also adds
               to the fixed card's total on-screen height) is tightened into
               a single compact row instead of its full grid-card size. This
               block only touches the ACTIVE/pinned card — ordinary cards
               further down the feed keep their normal, roomier spacing. */
            '#reels-grid-container .reel-card.reel-card-active .reel-video-wrap > video { height:16vh;max-height:150px; }',
            /* SIZE FIX (2026-08-10, third follow-up — THIS SESSION): the
               pinned card was reported as too small after the two shrinks
               above. Sized back up — still well short of the original
               26vh/230px so the next card keeps peeking underneath it, but
               noticeably larger than the 16vh/150px it had shrunk to. This
               is the ONLY active-card video height rule that should apply
               now; it simply overrides both earlier ones (same selector,
               later in source order wins) rather than deleting them, so the
               size history above stays intact. */
            /* SIZE FIX (2026-08-10, fourth follow-up — THIS SESSION):
               requested a slight increase over the third follow-up's
               24vh/220px — still well short of the original 26vh/230px
               (and far short of the very first, too-tall 16vh shrink) so
               the next card keeps peeking underneath it, just a bit more
               breathing room for the pinned video itself. Same
               "later-in-source-order wins on this identical selector"
               convention as the earlier follow-ups above — nothing above
               this line is deleted, only superseded. */
            /* CROP FIX (this session, point 4): the box above is short and
               wide (27vh/245px tall, full device width) but reels video is
               tall/portrait — object-fit:cover (set on the base rule near
               the top of this block) scales a portrait video up until it
               fills that short wide box completely, which crops off the
               top and bottom of the picture (e.g. cutting faces in half).
               object-fit:contain instead scales the video down to fit
               entirely INSIDE the box — letterboxed with the video-wrap's
               own black background filling the leftover strips left/right
               (or top/bottom) — so the full picture is always visible and
               nothing is ever cut off, at the cost of some black bars. */
            '#reels-grid-container .reel-card.reel-card-active .reel-video-wrap > video { height:27vh;max-height:245px;object-fit:contain;object-position:left center; }',
            /* CROP FIX (this session, follow-up — reported "video shifted to
               the left corner"): object-position:left center above is
               exactly what caused that — it deliberately anchors the
               letterboxed video to the LEFT edge of the box, leaving a
               visible black gap on the right. Per this session's request
               ("should be full screen but crop to render very well"),
               switched back to object-fit:cover (fills the box completely,
               centered, no black bars) instead of contain+left-anchor. This
               reintroduces the top/bottom crop the earlier CROP FIX was
               trying to avoid, but that's the explicit trade-off asked for
               this time — "crop to render very well" over "never crop".
               Same "later-in-source-order wins on this identical selector"
               convention as every fix above — nothing above this line is
               deleted, only superseded. */
            '#reels-grid-container .reel-card.reel-card-active .reel-video-wrap > video { object-fit:cover;object-position:center center; }',
            '#reels-grid-container .reel-card.reel-card-active .reel-caption-line { padding:9px 14px 0;font-size:0.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }',
            '#reels-grid-container .reel-card.reel-card-active .reel-meta-row { padding:9px 14px 12px; }',
            '#reels-grid-container .reel-card.reel-card-active .reel-meta-avatar { width:30px;height:30px; }',
            '#reels-grid-container .reel-card.reel-card-active .reel-meta-username { font-size:0.8rem; }',
            '#reels-grid-container .reel-card.reel-card-active .reel-meta-time { font-size:0.68rem; }',
            /* SUPERSEDED (this session, point 2): .reel-meta-comment-btn no
               longer exists in the markup — Comment moved into the kebab
               menu (.reel-kebab-item.reel-comment-btn) — so this rule now
               matches nothing. Left in place rather than deleted per this
               project's convention; the standalone-pill CSS below it is
               likewise dead for the same reason. */
            '#reels-grid-container .reel-card.reel-card-active .reel-meta-comment-btn { padding:6px 11px;font-size:0.73rem; }',
            '#reels-grid-container .reel-card.reel-card-active .reel-kebab-btn { width:30px;height:30px;font-size:0.78rem; }',
            /* Compact version of the new comment-count indicator (see the
               base .reel-grid-comment-indicator rule further up) for the
               pinned "now playing" card, matching the same size reduction
               already applied to its avatar/username/kebab neighbors above. */
            '#reels-grid-container .reel-card.reel-card-active .reel-grid-comment-indicator { height:30px;padding:0 9px;font-size:0.72rem; }',
            /* REVERTED (2026-08-11, this session): a same-day attempt to trim
               the PINNED/fixed card's video down to 22vh/196px (plus a tighten
               on its caption/meta strip) was reported back as targeting the
               wrong card — the fixed card's height should stay as the
               27vh/245px + cover/center rule set above. That attempt is fully
               reverted here rather than deleted, per this project's "never
               delete, only supersede" convention; the actual height reduction
               requested belongs to the ordinary (non-pinned) scrollable card
               instead — see the SIZE FIX note on `.reel-video-wrap > video`
               near the top of this block. */
            /* INLINE UPLOAD ICON (2026-08-10, this session) — point 4: small
               trigger anchored on the pinned card's video itself (added to
               every card's markup in app-feed.js, but only ever shown while
               that particular card is the active one, same pattern as
               .reel-audio-controls below). Sits top-right of the video,
               clear of the "Now Playing" badge (top-left) and the audio
               controls (bottom-right). */
            /* REMOVED (this session, point 2): there were two upload
               triggers on screen at once — this inline one on the pinned/
               active card, and .reel-topbar-upload-btn in #reels-fixed-
               topbar above. Kept only the topbar one; this button's
               markup is untouched (still added to every card by
               app-feed.js) but the rule that revealed it on the active
               card is gone, so it now stays permanently display:none like
               every other (non-active) grid card already had it. */
            '.reel-inline-upload-btn { display:none;position:absolute;top:10px;right:10px;z-index:6;width:32px;height:32px;border-radius:50%;background:rgba(10,14,39,0.55);border:1.5px solid rgba(255,255,255,0.5);color:#fff;font-size:0.85rem;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(6px);box-shadow:0 3px 10px rgba(0,0,0,0.3); }',
            '.reel-inline-upload-btn:active { transform:scale(0.9); }',
            /* SWIPE TRANSITION (2026-08-10): a short, tasteful horizontal
               slide-in whenever the pinned card advances to a new reel —
               either automatically (its video finished playing) or from a
               manual horizontal swipe — so the change reads as a deliberate
               "swipe to next/previous" motion instead of an abrupt cut.
               Direction-specific: sliding in FROM the right (reel-swipe-next)
               for "next", FROM the left (reel-swipe-prev) for "previous". */
            '#reels-grid-container .reel-card.reel-card-active.reel-swipe-next { animation:reelSwipeInNext 0.32s cubic-bezier(0.22,0.61,0.36,1); }',
            '#reels-grid-container .reel-card.reel-card-active.reel-swipe-prev { animation:reelSwipeInPrev 0.32s cubic-bezier(0.22,0.61,0.36,1); }',
            '@keyframes reelSwipeInNext { from { transform:translateX(36px);opacity:0.4; } to { transform:translateX(0);opacity:1; } }',
            '@keyframes reelSwipeInPrev { from { transform:translateX(-36px);opacity:0.4; } to { transform:translateX(0);opacity:1; } }',
            /* UPLOAD FAB (2026-08-10, SUPERSEDED this session — kept, not
               deleted, per project convention; the <button class="...
               reel-upload-fab"> markup itself was removed from index.html
               and replaced with .reel-topbar-upload-btn / .reel-inline-
               upload-btn, so this selector no longer matches anything, but
               the rule is left here rather than deleted): the existing
               "Upload a New Reel" button lived at the top of this section's
               markup — but the pinned/fixed "now playing" card above is
               position:fixed at top:0 with a solid background and sits ON
               TOP of that exact screen position at all times (fixed
               elements ignore scroll), so that button was permanently
               covered and untappable whenever a reel is active (i.e.
               basically always). This FAB was a second trigger for the same
               panel (#reels-create-panel, toggled generically off the
               shared .section-create-toggle-btn handler — see
               app-fixes.js), pinned at a z-index above the "now playing"
               card so it was always visible and reachable. Per this
               session's request #2 ("hide all FAB buttons from the reel
               section"), the FAB approach itself is retired in favor of
               inline triggers that scroll/pin naturally with the section
               instead of floating over it — see #reels-fixed-topbar and
               .reel-inline-upload-btn. */
            '.reel-upload-fab { position:fixed;right:16px;bottom:calc(78px + env(safe-area-inset-bottom,0px));z-index:600;width:52px;height:52px;border-radius:50%;background:var(--g-navy,linear-gradient(135deg,var(--color-navy),var(--color-royal)));border:2px solid rgba(255,255,255,0.85);color:#fff;font-size:1.15rem;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 22px rgba(10,14,39,0.4);transition:transform 0.15s; }',
            '.reel-upload-fab:active { transform:scale(0.92); }',
            /* FIXED TOP BAR (2026-08-10, this session) — point 6: wraps the
               search bar + section title (+ .reel-topbar-upload-btn, the
               relocated upload trigger) and pins them above the "now
               playing" card via position:fixed, same edge-to-edge approach
               (left:0/right:0 bleeding past .main-content's own padding) as
               the active card below it, so the two stay visually flush.
               Higher z-index (550) than the active card (500) keeps it
               painted on top / in front, i.e. visually BEFORE it. Height is
               measured at runtime by _syncReelsTopbar() further down this
               file and written to the --reels-topbar-h custom property,
               which both #reels-topbar-spacer (reserves the space in normal
               flow) and the active card's `top` offset above read from, so
               there is never a hardcoded/guessed pixel gap between them. */
            '#reels-fixed-topbar { position:fixed;top:0;left:0;right:0;z-index:550;background:var(--color-white,#fff);box-shadow:0 2px 12px rgba(10,14,39,0.08);padding:8px 16px 4px; }',
            '#reels-fixed-topbar-row { display:flex;align-items:center;gap:10px; }',
            '#reels-fixed-topbar .section-search-bar { flex:1 1 auto;min-width:0;margin:0 !important; }',
            '#reels-fixed-topbar .header { padding:4px 0 0 !important;margin:0 !important; }',
            '.reel-topbar-upload-btn { flex-shrink:0;width:38px;height:38px;border-radius:50%;background:var(--g-navy,linear-gradient(135deg,var(--color-navy),var(--color-royal)));border:none;color:#fff;font-size:1rem;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 3px 10px rgba(10,14,39,0.28); }',
            '.reel-topbar-upload-btn:active { transform:scale(0.92); }',
            '#reels-topbar-spacer { width:100%; }',
            /* STATUS BAR — GENUINE SCROLL, NOT FIXED (2026-08-11, this
               session, SUPERSEDES the "STATUS BAR RESTORED + PINNED"
               design this replaces): that earlier design made the status
               bar ALSO position:fixed (permanently pinned under the
               topbar) specifically to stop it overlapping the also-fixed
               #reels-fixed-topbar. Reported back (2026-08-11, later the
               same day) as two problems: (1) "so much space" — a follow-up
               fix layered a scroll-direction hide (translateY) on TOP of
               that fixed positioning, but #reels-topbar-spacer still
               reserved the status bar's full height regardless of whether
               the transform had slid it off-screen, so hiding it just
               left that reserved height behind as blank dead space; and
               (2) "the status/avatar cards not moving or scrolling like
               others" — a translateY hide/show is not the same thing as
               genuinely scrolling with the page, which is what was asked
               for ("every card including status bar should scroll
               upwards").
               Fixed properly this time by taking the status bar OUT of
               position:fixed entirely and letting it sit in normal
               document flow (its default site-wide behavior almost
               everywhere else) — it now scrolls away with the rest of the
               page exactly like any other element above the grid, no
               reserved-space bookkeeping required. The only wrinkle: it's
               the first thing in <main class="main-content">, physically
               BEFORE <section id="reels"> in the DOM, so without an
               explicit push it would render right underneath the always-
               fixed topbar (which covers the very top of the viewport
               regardless of scroll) rather than below it. margin-top:
               var(--reels-topbar-h) supplies exactly that push — the same
               custom property #reels-topbar-spacer already reads to
               reserve the topbar's height inside the Reels section itself
               (see _syncReelsTopbar() further down), just applied here
               instead so the status bar clears the topbar too. */
            'body.emp-section-reels #status-bar-container { position:static !important;margin:0 0 0 0 !important;margin-top:var(--reels-topbar-h,96px) !important;top:auto !important;box-shadow:0 2px 12px rgba(10,14,39,0.04) !important; }',
            /* The Facebook-style hide-on-scroll transform app-status.js
               applies app-wide (.status-bar-hidden → translateY(-100%))
               is neutralised here, same as the original "STATUS BAR
               RESTORED" fix did — now for a different reason: the status
               bar already disappears the honest way (scrolling out of
               view in normal flow, per the rule above), so layering the
               transform-based hide on top of that would just fight it —
               possibly sliding it away before it's even scrolled past, or
               snapping it back visible mid-scroll out of sync with its
               real position. */
            'body.emp-section-reels #status-bar-container.status-bar-hidden { transform:translateY(0) !important; }',
            /* STATUS BAR — HIDE WHILE A REEL IS PINNED (2026-08-11, this
               session), §2 of the spec ("when a reel avatar card is
               pinned, the status bar should disappear or hide"): a hard
               display:none, keyed off the .reel-active-pinned class
               _applyActiveReelOrdering() toggles on <body> whenever
               _activeReelId is set/cleared (see that function). The
               instant the card is unpinned (class removed, see
               _unpinActiveReel()), this rule stops matching and the
               status bar falls straight back into normal scrollable flow
               per the rule above — exactly the "return to its normal
               state" behaviour §2 asks for, with nothing further to reset
               by hand. */
            'body.emp-section-reels.reel-active-pinned #status-bar-container { display:none !important; }',
            /* Once opened, the upload panel becomes a TRUE full-screen
               camera-capture composer (fixed, covers the entire viewport,
               high z-index) instead of an inline collapsible panel or a
               small centered card — an inline panel would render at the
               same buried position as the old button and be just as
               invisible behind the pinned "now playing" card, and a small
               card can't fit a live camera preview. z-index 10050 clears
               #mobile-bottom-nav (10000) too. Only #reels-create-panel is
               targeted, so every other section's own .section-create-panel
               (marketplace, donor hub, etc.) is completely unaffected.
               The panel's own inline style.display is still just toggled
               'block'/'none' by the shared .section-create-toggle-btn
               handler in app-fixes.js -- the flex layout below lives on
               .reel-composer-form (the form INSIDE the panel), so that
               generic toggle doesn't need to know anything about this
               panel being special. See the "REEL COMPOSER" module appended
               at the end of this file for the camera/recorder/gallery-pick
               logic that drives all of this. */
            '#reels-create-panel { position:fixed !important;inset:0 !important;left:0;right:0;top:0;bottom:0;transform:none;max-height:100vh;overflow:hidden;z-index:10050;background:#0a0a0a;border-radius:0;box-shadow:none;padding:0 !important; }',
            '.reel-composer-form { display:flex;flex-direction:column;height:100vh;height:100dvh;width:100%;position:relative;color:#fff; }',
            /* Top bar: close (X), "Add sound" pill, flip-camera */
            '.reel-composer-topbar { display:flex;align-items:center;justify-content:space-between;gap:10px;padding:calc(14px + env(safe-area-inset-top,0px)) 16px 10px;position:relative;z-index:3;flex-shrink:0; }',
            '.reel-composer-icon-btn { background:rgba(255,255,255,0.14);border:none;color:#fff;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.05rem;cursor:pointer;backdrop-filter:blur(6px);flex-shrink:0; }',
            '.reel-composer-icon-btn:active { transform:scale(0.9); }',
            '.reel-composer-icon-btn:disabled { opacity:0.4;cursor:default; }',
            '.reel-composer-close-btn { font-size:1.6rem;font-weight:300;line-height:1; }',
            '.reel-composer-sound-pill { display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.14);border:none;color:#fff;padding:9px 16px;border-radius:22px;font-size:0.82rem;font-weight:600;cursor:pointer;backdrop-filter:blur(6px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }',
            '.reel-composer-sound-pill i { font-size:0.78rem; }',
            /* Camera stage — live preview / recorded-clip review / fallback */
            '.reel-composer-stage { flex:1 1 auto;position:relative;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;min-height:0; }',
            '.reel-composer-video { width:100%;height:100%;object-fit:cover;display:block;background:#000; }',
            '.reel-composer-timer { position:absolute;top:14px;left:50%;transform:translateX(-50%);background:rgba(220,38,38,0.88);color:#fff;font-weight:700;font-size:0.82rem;padding:5px 14px 5px 10px;border-radius:20px;display:flex;align-items:center;gap:7px;z-index:3; }',
            '.reel-composer-timer::before { content:"";width:8px;height:8px;border-radius:50%;background:#fff;animation:reelComposerPulse 1s infinite; }',
            '@keyframes reelComposerPulse { 0%,100% { opacity:1; } 50% { opacity:0.25; } }',
            '.reel-composer-cam-fallback { position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:rgba(255,255,255,0.65);text-align:center;padding:0 34px;z-index:2; }',
            '.reel-composer-cam-fallback i { font-size:2.3rem;color:rgba(255,255,255,0.4); }',
            '.reel-composer-cam-fallback p { font-size:0.85rem;line-height:1.45; }',
            /* Caption + Post step (shown after a clip is recorded or picked) */
            '.reel-composer-caption-step { flex-shrink:0;padding:14px 16px calc(14px + env(safe-area-inset-bottom,0px));background:#0a0a0a;display:flex;flex-direction:column;gap:12px;z-index:3; }',
            '.reel-composer-caption-input { width:100%;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.18);color:#fff;border-radius:12px;padding:12px 14px;font-size:0.9rem; }',
            '.reel-composer-caption-input::placeholder { color:rgba(255,255,255,0.45); }',
            '.reel-composer-caption-actions { display:flex;align-items:center;gap:10px; }',
            '.reel-composer-retake-btn { flex:0 0 auto;display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;padding:12px 16px;border-radius:24px;font-size:0.84rem;font-weight:600;cursor:pointer; }',
            '.reel-composer-retake-btn:active { transform:scale(0.96); }',
            '.reel-composer-post-btn { flex:1;background:linear-gradient(135deg,#00D4AA,#00b394);border:none;color:#052018;padding:13px 18px;border-radius:24px;font-size:0.95rem;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px; }',
            '.reel-composer-post-btn:active { transform:scale(0.97); }',
            '.reel-composer-post-btn:disabled { opacity:0.6;cursor:default; }',
            /* Pin-a-product row (2026-10-04) */
            '.reel-composer-pin-wrap { display:flex;flex-direction:column;gap:8px; }',
            '.reel-composer-pin-btn { display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:rgba(0,212,170,0.12);border:1px dashed rgba(0,212,170,0.55);color:#00D4AA;padding:11px 14px;border-radius:12px;font-size:0.84rem;font-weight:600;letter-spacing:0.01em;cursor:pointer; }',
            '.reel-composer-pin-btn:active { transform:scale(0.98); }',
            '.reel-composer-pin-chips { display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch; }',
            '.reel-composer-pin-chips::-webkit-scrollbar { display:none; }',
            '.reel-composer-pin-chips:empty { display:none; }',
            '.reel-composer-pin-chip { flex:0 0 auto;display:flex;align-items:center;gap:8px;max-width:78%;padding:5px 8px 5px 5px;border-radius:12px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.16);color:#fff; }',
            '.reel-composer-pin-chip img, .reel-composer-pin-chip .reel-pin-noimg { width:34px;height:34px;border-radius:8px;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;color:#00D4AA; }',
            '.reel-composer-pin-chip-meta { display:flex;flex-direction:column;min-width:0;line-height:1.25; }',
            '.reel-composer-pin-chip-meta strong { font-size:0.78rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }',
            '.reel-composer-pin-chip-meta span { font-size:0.72rem;color:#00D4AA;font-weight:600; }',
            '.reel-composer-pin-chip-x { flex-shrink:0;width:22px;height:22px;border-radius:50%;border:none;background:rgba(255,255,255,0.16);color:#fff;font-size:15px;line-height:1;cursor:pointer;padding:0; }',
            /* Bottom bar: mode label + gallery-pick / record button */
            '.reel-composer-bottombar { flex-shrink:0;padding:14px 20px calc(20px + env(safe-area-inset-bottom,0px));background:#0a0a0a;display:flex;flex-direction:column;align-items:center;gap:14px;z-index:3; }',
            '.reel-composer-modes { display:flex;gap:18px;font-size:0.7rem;font-weight:700;letter-spacing:0.04em;color:rgba(255,255,255,0.4); }',
            '.reel-composer-mode.active { color:#fff; }',
            '.reel-composer-capture-row { display:flex;align-items:center;justify-content:center;width:100%;position:relative;min-height:72px; }',
            '.reel-composer-record-btn { width:72px;height:72px;border-radius:50%;background:#fff;border:5px solid rgba(255,255,255,0.35);cursor:pointer;transition:border-radius 0.2s,background 0.2s,width 0.2s,height 0.2s; }',
            '.reel-composer-record-btn:active { transform:scale(0.95); }',
            '.reel-composer-record-btn.recording { background:#e53935;border-radius:16px;width:52px;height:52px; }',
            '.reel-composer-record-btn:disabled { opacity:0.35;cursor:default; }',
            '.reel-composer-gallery-btn { position:absolute;left:0;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:10px;background:rgba(255,255,255,0.14);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.1rem;cursor:pointer; }',
            '.reel-composer-gallery-btn:active { transform:translateY(-50%) scale(0.92); }',
            /* Hide the bottom nav + hamburger toggle while the composer is
               open, same pattern already used for the fullscreen reel
               VIEWER above (body.reel-open) — mirrored here under its own
               class so opening the composer doesn't affect the viewer and
               vice versa. */
            'body.reel-composer-open #mobile-bottom-nav { display:none !important; }',
            'body.reel-composer-open .mobile-menu-toggle { display:none !important; box-shadow:none !important; }',
            '.sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }',
            /* GAP FIX (2026-08-10, this session): requested tighter spacing
               specifically between the pinned "now playing" card and the
               next scrollable card peeking underneath it. #reels-grid-
               container's flex `gap:22px` (see .reels-grid above) applies
               uniformly between EVERY card in the column, including
               ordinary card-to-card spacing further down the feed that
               wasn't part of this request — so the fix is scoped to just
               the spacer (which always sits directly before the active
               card and reserves its footprint; see _syncActiveSpacer()
               below) rather than lowering the shared `gap` value. A
               negative margin-bottom here pulls the very next card up
               closer, without changing spacing between any other pair of
               cards in the list. */
            /* GAP FIX, FOLLOW-UP (this session): most of the remaining
               visible gap here was actually the hidden status bar's
               reserved space (see the body.emp-section-reels #status-bar-
               container rule above, next to #reels-topbar-spacer) — now
               that it's removed, the true card-to-card gap is tightened
               a bit further too, per this session's request. */
            '.reel-active-spacer { width:100%;margin-bottom:-20px; }',
            '#reels-grid-container .reel-card.reel-card-active .reel-now-playing-badge { display:flex; }',
            /* MOVED TO EXTREME TOP-LEFT (this session): was shifted right to
               left:58px to clear the fixed hamburger menu button
               (.mobile-menu-toggle, top:15px;left:15px), which otherwise
               visually collided with/clipped this badge's text. Per this
               session's request the badge now sits flush in the true
               top-left corner (left:10px) instead, so the hamburger is
               hidden while a reel is pinned (see the body.reel-active-pinned
               .mobile-menu-toggle rule right below) rather than the badge
               being pushed out of the way of it — the pinned card already
               has its own exit/back control (.reel-grid-unpin-btn), so the
               hamburger isn't needed here anyway. */
            '.reel-now-playing-badge { display:none;position:absolute;top:10px;left:10px;z-index:5;align-items:center;gap:6px;background:rgba(10,14,39,0.65);backdrop-filter:blur(4px);color:#fff;font-size:0.68rem;font-weight:700;letter-spacing:0.02em;padding:5px 11px 5px 9px;border-radius:20px; }',
            'body.emp-section-reels.reel-active-pinned .mobile-menu-toggle { display:none !important; box-shadow:none !important; }',
            '.reel-now-playing-badge i { font-size:0.6rem;color:#00D4AA; }',
            /* EXIT/COLLAPSE BUTTON (2026-08-11), §3 of the spec — same
               "hidden until pinned" pattern as .reel-now-playing-badge
               above (a plain rule keyed off .reel-card-active). Anchored
               bottom-LEFT of the video, the one corner nothing else on the
               pinned card ever occupies: top-right is
               .reel-inline-upload-btn (app-feed.js), bottom-right is
               .reel-duration-badge + .reel-audio-controls, and top-left is
               the "Now Playing" badge (which starts at left:58px, so this
               sits comfortably clear of it on the row below instead). */
            '.reel-grid-unpin-btn { display:none;position:absolute;left:10px;bottom:10px;z-index:6;background:rgba(10,14,39,0.55);border:1.5px solid rgba(255,255,255,0.4);color:#fff;width:32px;height:32px;border-radius:50%;align-items:center;justify-content:center;font-size:0.85rem;cursor:pointer;backdrop-filter:blur(6px);box-shadow:0 3px 10px rgba(0,0,0,0.3); }',
            '.reel-card.reel-card-active .reel-grid-unpin-btn { display:flex; }',
            '.reel-grid-unpin-btn:active { transform:scale(0.92); }',
            /* Audio play/pause + mute/unmute controls — MODERN ICON PASS
               (2026-08-10): swapped the old solid-glyph fa-play/fa-pause for
               a glassy, premium circular button (soft blur + thin ring),
               larger tap target, subtle press animation. Only shown on the
               active (currently playing) card, bottom-right corner of the
               player. Reels autoplay muted (browser requirement); tapping
               the speaker icon is the required user gesture to turn sound
               on. */
            /* REPOSITIONED (this session) — .reel-audio-controls used to sit
               at bottom:12px, right on top of .reel-duration-badge
               (bottom:8px, same right-aligned corner), so the pause button's
               own glyph visually covered the duration count. Lifted clear
               above the badge (bottom:48px, i.e. the badge's own height +
               a comfortable margin) so both are always fully readable at
               once, with nothing else changed about how/when this row shows. */
            '.reel-audio-controls { display:none;position:absolute;right:12px;bottom:48px;z-index:8;gap:10px; }',
            '.reel-card.reel-card-active .reel-audio-controls { display:flex; }',
            /* .reel-mute-btn RESTORED (2026-08-11) — see the "AUDIO FIX" note
               next to its markup in app-feed.js: without it the pinned/
               "fixed" reel had no audio at all, ever. Shares the same look
               as .reel-playpause-btn (same pill, same size) so the pair
               reads as one connected control cluster bottom-right of the
               player. */
            /* PREMIUM ICON PASS (this session): fa-circle-play/fa-circle-pause
               each already draw their own ring baked into the glyph, so
               inside this glass circular button it read as a "circle inside
               a circle" — swapped for the plain fa-play/fa-pause glyphs
               (see the matching class-toggle update in _promoteActiveReel()
               and the delegated click handler below, and the initial glyph
               in app-feed.js) so only the one, intentional outer ring shows. */
            '.reel-playpause-btn, .reel-mute-btn { background:rgba(10,14,39,0.42);border:1px solid rgba(255,255,255,0.28);color:#fff;width:38px;height:38px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.95rem;backdrop-filter:blur(10px);box-shadow:0 4px 14px rgba(0,0,0,0.35);transition:transform 0.15s,background 0.15s; }',
            '.reel-playpause-btn:active, .reel-mute-btn:active { transform:scale(0.88); }',
            '.reel-mute-btn.reel-mute-btn-unmuted { background:rgba(0,212,170,0.32);border-color:rgba(0,212,170,0.55); }',
            '/* PREMIUM SVG ICONS (2026-10-22 — "change the play and pause icons from emojis"):',
            '   index.html ships an offline Font Awesome fallback that swaps fa-pause /',
            '   fa-play / fa-volume-mute / fa-volume-up for the ⏸ ▶ 🔇 🔊 emoji whenever the',
            '   FA CDN is slow or blocked — which is what rendered as a flat orange emoji',
            '   in the player. These rules draw the same four glyphs as crisp inline-SVG',
            '   masks instead, so they look identical with or without the CDN. Only the',
            '   <i> inside the two buttons is restyled; the existing JS that toggles',
            '   fa-play/fa-pause and fa-volume-up/fa-volume-mute keeps working untouched. */',
            '.reel-playpause-btn i, .reel-mute-btn i, .reels-live-tv-play i.fa-play { font-size:0 !important;line-height:0 !important;display:block !important;width:18px !important;height:18px !important;background:currentColor !important;color:#fff;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45)); }',
            '.reel-playpause-btn i::before, .reel-mute-btn i::before, .reels-live-tv-play i.fa-play::before { content:none !important;display:none !important; }',
            '.reel-playpause-btn i.fa-pause { -webkit-mask-image:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%3E%3Crect%20x=%275.6%27%20y=%274.6%27%20width=%274.6%27%20height=%2714.8%27%20rx=%271.5%27%20fill=%27black%27/%3E%3Crect%20x=%2713.8%27%20y=%274.6%27%20width=%274.6%27%20height=%2714.8%27%20rx=%271.5%27%20fill=%27black%27/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%3E%3Crect%20x=%275.6%27%20y=%274.6%27%20width=%274.6%27%20height=%2714.8%27%20rx=%271.5%27%20fill=%27black%27/%3E%3Crect%20x=%2713.8%27%20y=%274.6%27%20width=%274.6%27%20height=%2714.8%27%20rx=%271.5%27%20fill=%27black%27/%3E%3C/svg%3E"); }',
            '.reel-playpause-btn i.fa-play, .reels-live-tv-play i.fa-play { -webkit-mask-image:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%3E%3Cpath%20d=%27M8.2%205.3v13.4a1%201%200%200%200%201.52.85l10.6-6.7a1%201%200%200%200%200-1.7L9.72%204.45A1%201%200%200%200%208.2%205.3z%27%20fill=%27black%27/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%3E%3Cpath%20d=%27M8.2%205.3v13.4a1%201%200%200%200%201.52.85l10.6-6.7a1%201%200%200%200%200-1.7L9.72%204.45A1%201%200%200%200%208.2%205.3z%27%20fill=%27black%27/%3E%3C/svg%3E"); }',
            '.reel-mute-btn i.fa-volume-mute { -webkit-mask-image:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%3E%3Cpath%20d=%27M11.2%204.9%206.6%208.8H3.6a1%201%200%200%200-1%201v4.4a1%201%200%200%200%201%201h3l4.6%203.9a.8.8%200%200%200%201.3-.6V5.5a.8.8%200%200%200-1.3-.6z%27%20fill=%27black%27/%3E%3Cpath%20d=%27M16.2%209.4l5%205.2M21.2%209.4l-5%205.2%27%20fill=%27none%27%20stroke=%27black%27%20stroke-width=%272%27%20stroke-linecap=%27round%27/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%3E%3Cpath%20d=%27M11.2%204.9%206.6%208.8H3.6a1%201%200%200%200-1%201v4.4a1%201%200%200%200%201%201h3l4.6%203.9a.8.8%200%200%200%201.3-.6V5.5a.8.8%200%200%200-1.3-.6z%27%20fill=%27black%27/%3E%3Cpath%20d=%27M16.2%209.4l5%205.2M21.2%209.4l-5%205.2%27%20fill=%27none%27%20stroke=%27black%27%20stroke-width=%272%27%20stroke-linecap=%27round%27/%3E%3C/svg%3E"); }',
            '.reel-mute-btn i.fa-volume-up { -webkit-mask-image:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%3E%3Cpath%20d=%27M11.2%204.9%206.6%208.8H3.6a1%201%200%200%200-1%201v4.4a1%201%200%200%200%201%201h3l4.6%203.9a.8.8%200%200%200%201.3-.6V5.5a.8.8%200%200%200-1.3-.6z%27%20fill=%27black%27/%3E%3Cpath%20d=%27M15.8%208.6a5%205%200%200%201%200%206.8M18.6%205.8a9%209%200%200%201%200%2012.4%27%20fill=%27none%27%20stroke=%27black%27%20stroke-width=%272%27%20stroke-linecap=%27round%27/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%3E%3Cpath%20d=%27M11.2%204.9%206.6%208.8H3.6a1%201%200%200%200-1%201v4.4a1%201%200%200%200%201%201h3l4.6%203.9a.8.8%200%200%200%201.3-.6V5.5a.8.8%200%200%200-1.3-.6z%27%20fill=%27black%27/%3E%3Cpath%20d=%27M15.8%208.6a5%205%200%200%201%200%206.8M18.6%205.8a9%209%200%200%201%200%2012.4%27%20fill=%27none%27%20stroke=%27black%27%20stroke-width=%272%27%20stroke-linecap=%27round%27/%3E%3C/svg%3E"); }',
            '.reels-live-tv-play i.fa-play { width:12px !important;height:12px !important;margin-left:1px; }',
            /* Three-dot "more options" menu — MOVED (2026-08-10): now sits
               inline in .reel-meta-actions, directly after the Comment button,
               instead of floating over the top-right corner of the video. */
            '.reel-meta-actions { display:flex;align-items:center;gap:8px;flex-shrink:0; }',
            /* COMMENT COUNT INDICATOR (2026-08-11) — small icon+number sitting
               right before the kebab wrap (see the comment above its markup in
               app-feed.js), so a reel's comment count is visible WITHOUT
               opening the three-dot menu. Deliberately compact/pill-shaped
               rather than reusing the fuller .reel-eng-btn look (which is
               sized/styled for the dark, floating fullscreen-viewer overlay,
               not this light meta row) — same muted background + accent
               color already established for .reel-kebab-btn just to its
               right, so the two read as a matched pair. */
            '.reel-grid-comment-indicator { display:flex;align-items:center;gap:5px;background:rgba(10,14,39,0.08);border:none;color:var(--secondary,#1B2B8B);height:34px;padding:0 11px;border-radius:17px;cursor:pointer;font-size:0.78rem;font-weight:600;flex-shrink:0; }',
            '.reel-grid-comment-indicator:active { transform:scale(0.94); }',
            '.reel-grid-comment-indicator i { font-size:0.85rem; }',
            '.reel-kebab-wrap { position:relative; }',
            '.reel-kebab-btn { background:rgba(10,14,39,0.08);border:none;color:var(--secondary,#1B2B8B);width:34px;height:34px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.85rem; }',
            '.reel-kebab-btn:active { transform:scale(0.92); }',
            '.reel-kebab-menu { display:none;position:absolute;top:auto;bottom:40px;right:0;background:var(--color-white,#fff);border-radius:12px;min-width:172px;box-shadow:0 10px 30px rgba(10,14,39,0.26);overflow:hidden;z-index:60; }',
            '.reel-kebab-menu.open { display:block; }',
            '.reel-kebab-item { display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:11px 14px;font-size:0.83rem;font-weight:600;background:none;border:none;border-bottom:1px solid rgba(10,14,39,0.06);cursor:pointer;color:var(--secondary,#1B2B8B);text-decoration:none; }',
            '.reel-kebab-item:last-child { border-bottom:none; }',
            '.reel-kebab-item:active { background:rgba(10,14,39,0.05); }',
            '.reel-kebab-item.danger { color:#e53935; }',
            '.reel-kebab-item i { width:14px;text-align:center;flex-shrink:0; }',
            '.reel-kebab-item.reel-like-btn.liked { color:#f87171; }',
            '.reel-kebab-item.reel-like-btn.liked i { color:#f87171; }',
            '.reel-kebab-reason-row { display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:11px 14px;font-size:0.8rem;font-weight:600;background:none;border:none;border-bottom:1px solid rgba(10,14,39,0.06);cursor:pointer;color:var(--primary,#0A0E27); }',
            '.reel-kebab-reason-row:active { background:rgba(10,14,39,0.05); }',
            '.reel-kebab-menu-header { padding:10px 14px 6px;font-size:0.72rem;font-weight:700;letter-spacing:0.03em;color:var(--text-muted,#8A94A6);text-transform:uppercase; }',
            /* Caption line (title-style, above the meta row) */
            '.reel-caption-line { padding:12px 14px 0;font-size:0.9rem;font-weight:700;color:var(--primary,#0A0E27);line-height:1.35; }',
            /* Below-thumbnail two-column meta row: creator+time on the left, a
               direct comment button on the right. */
            '.reel-meta-row { display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px 14px; }',
            '.reel-meta-left { display:flex;align-items:center;gap:10px;min-width:0;cursor:pointer;flex:1 1 auto; }',
            '.reel-meta-avatar { width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--color-neutral-100,#eee); }',
            '.reel-meta-text { min-width:0;display:flex;flex-direction:column;gap:1px; }',
            '.reel-meta-username { font-weight:700;font-size:0.85rem;color:var(--primary,#0A0E27);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }',
            '.reel-meta-time { font-size:0.72rem;color:var(--text-muted,#8A94A6); }',
            '.reel-meta-comment-btn { flex-shrink:0;display:flex;align-items:center;gap:6px;background:rgba(0,212,170,0.09);border:1px solid rgba(0,212,170,0.28);color:#0f766e;border-radius:20px;padding:8px 14px;font-size:0.78rem;font-weight:700;cursor:pointer; }',
            '.reel-meta-comment-btn:active { transform:scale(0.96); }',

            /* ═══════════════════════════════════════════════════════════
               PREMIUM REPOST CARD (this session) — replaces the old
               instant-toggle Retweet button in the fullscreen viewer with
               a small "Add a comment / Repost" card. See
               _openReelRepostCard() / _submitReelRetweet() further down
               this file. Highest z-index in this file so it sits above
               every other overlay (viewer, comments drawer, exit button). */
            '#reel-repost-card-scrim { position:fixed;inset:0;background:rgba(0,0,0,0);z-index:10300;display:none;transition:background 0.25s; }',
            '#reel-repost-card-scrim.active { display:block;background:rgba(0,0,0,0.55); }',
            '#reel-repost-card-overlay { position:fixed;left:0;right:0;bottom:0;z-index:10301;display:flex;justify-content:center;transform:translateY(100%);transition:transform 0.3s cubic-bezier(0.32,0.72,0,1);pointer-events:none; }',
            '#reel-repost-card-overlay.open { transform:translateY(0);pointer-events:auto; }',
            '#reel-repost-card { background:#fff;width:100%;max-width:460px;border-radius:20px 20px 0 0;padding:20px 20px calc(22px + env(safe-area-inset-bottom,0px));position:relative;box-shadow:0 -8px 30px rgba(10,14,39,0.3); }',
            '#reel-repost-card-close { position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:50%;background:rgba(10,14,39,0.06);border:none;cursor:pointer;color:#5b6472;display:flex;align-items:center;justify-content:center;font-size:0.85rem; }',
            '#reel-repost-card-head { display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-right:34px; }',
            '#reel-repost-card-icon { width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#1B2B8B,#00D4AA);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1rem;flex-shrink:0; }',
            /* "Sleek premium card thumbnail" (this session) — the reel's own
               poster frame, shown instead of the generic icon whenever one
               is available (see _openReelRepostCard()'s poster lookup). */
            '#reel-repost-card-thumb { width:44px;height:44px;border-radius:10px;object-fit:cover;flex-shrink:0;box-shadow:0 2px 8px rgba(10,14,39,0.25); }',
            '#reel-repost-card-head h4, #reel-repost-card-title { margin:0;font-size:1.02rem;font-weight:800;color:#0A0E27; }',
            '#reel-repost-card-options { display:flex;flex-direction:column;gap:6px; }',
            '.reel-repost-option { display:flex;align-items:center;gap:12px;width:100%;padding:13px 10px;background:none;border:none;border-radius:14px;cursor:pointer;text-align:left;transition:background 0.15s; }',
            '.reel-repost-option:hover, .reel-repost-option:active { background:rgba(10,14,39,0.05); }',
            '.reel-repost-option-icon { width:38px;height:38px;border-radius:50%;background:rgba(10,14,39,0.06);display:flex;align-items:center;justify-content:center;color:#0A0E27;font-size:0.95rem;flex-shrink:0; }',
            '.reel-repost-option-icon-accent { background:rgba(0,212,170,0.14);color:#00A986; }',
            '.reel-repost-option-text { flex:1;min-width:0;display:flex;flex-direction:column;gap:2px; }',
            '.reel-repost-option-text strong { font-size:0.92rem;color:#0A0E27;font-weight:700; }',
            '.reel-repost-option-text small { font-size:0.78rem;color:#6B7280;font-weight:400; }',
            '.reel-repost-option-chevron { color:#c7cbd4;font-size:0.8rem; }',
            '#reel-repost-card-composer { display:none;flex-direction:column;gap:12px; }',
            '#reel-repost-card-overlay.reel-repost-card-composing #reel-repost-card-options { display:none; }',
            '#reel-repost-card-overlay.reel-repost-card-composing #reel-repost-card-composer { display:flex; }',
            '#reel-repost-comment-inp { width:100%;border:1px solid rgba(10,14,39,0.14);border-radius:14px;padding:12px 14px;font-size:0.9rem;font-family:inherit;color:#0A0E27;resize:none;outline:none;box-sizing:border-box; }',
            '#reel-repost-comment-inp:focus { border-color:#1B2B8B; }',
            '#reel-repost-comment-submit { align-self:flex-end;display:inline-flex;align-items:center;gap:7px;padding:10px 22px;border:none;border-radius:24px;background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:#fff;font-weight:700;font-size:0.88rem;cursor:pointer; }',
            '#reel-repost-comment-submit:active { transform:scale(0.97); }',

            /* ═══════════════════════════════════════════════════════════
               "GROW YOUR REACH" PROMO CARD (this session) — small premium
               nudge shown once, the first time the "Reel & Live Broadcast
               Channel" section (#reels) opens, encouraging an upload. See
               _maybeShowReelPromoCard() further down this file. */
            '#reel-promo-scrim { position:fixed;inset:0;background:rgba(10,14,39,0);z-index:10305;display:none;align-items:center;justify-content:center;padding:20px;transition:background 0.25s; }',
            '#reel-promo-scrim.active { display:flex;background:rgba(10,14,39,0.55); }',
            '#reel-promo-card { background:#fff;width:100%;max-width:360px;border-radius:22px;padding:22px 20px 20px;position:relative;box-shadow:0 14px 40px rgba(10,14,39,0.35);transform:scale(0.92);opacity:0;transition:transform 0.22s cubic-bezier(0.34,1.56,0.64,1),opacity 0.2s; }',
            '#reel-promo-scrim.active #reel-promo-card { transform:scale(1);opacity:1; }',
            '#reel-promo-close { position:absolute;top:12px;right:12px;width:28px;height:28px;border-radius:50%;background:rgba(10,14,39,0.06);border:none;cursor:pointer;color:#5b6472;display:flex;align-items:center;justify-content:center;font-size:0.8rem; }',
            /* FIX (2026-08-29 — "Empyrean app logo should be in the blank
               square box"): this box used to hold a Font Awesome
               fa-satellite-dish glyph. On a device where the Font Awesome
               webfont fails to load (see app-platform's own recurring
               "Font Awesome CDN failures cause blank icons app-wide"
               note), the box rendered as an empty gradient square with no
               glyph at all — exactly the blank box in the screenshot.
               Switched to the app's own logo image (see markup below),
               which has no font-loading dependency and reads as
               intentional branding instead of a placeholder either way. */
            '#reel-promo-icon { width:54px;height:54px;border-radius:16px;background:#fff;display:flex;align-items:center;justify-content:center;color:#1B2B8B;font-size:1.5rem;margin-bottom:14px;box-shadow:0 6px 16px rgba(27,43,139,0.22);padding:8px;box-sizing:border-box; }',
            '#reel-promo-icon img { width:100%;height:100%;object-fit:contain; }',
            '#reel-promo-card h4 { margin:0 0 8px;font-size:1.12rem;font-weight:800;color:#0A0E27; }',
            '#reel-promo-card p { margin:0 0 20px;font-size:0.87rem;line-height:1.5;color:#5b6472; }',
            '#reel-promo-actions { display:flex;gap:10px; }',
            '#reel-promo-dismiss { flex:1;padding:12px;border-radius:26px;border:1px solid rgba(10,14,39,0.14);background:none;color:#3a4152;font-weight:700;font-size:0.86rem;cursor:pointer; }',
            '#reel-promo-cta { flex:1.3;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:12px;border-radius:26px;border:none;background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:#fff;font-weight:700;font-size:0.86rem;cursor:pointer; }',
            '#reel-promo-cta:active, #reel-promo-dismiss:active { transform:scale(0.97); }',
        ].join('\n');
        document.head.appendChild(s);
    })();


    /* =========================================================================
       §0a  ONE-LINE CAPTIONS (chevron to expand) + MARKETPLACE LISTINGS PINNED TO REELS
       =========================================================================
       (requested 2026-10-04)
       1) Reel captions — in the reel grid card AND the fullscreen viewer — are
          now a single line with an ellipsis. A small chevron at the end of the
          line (only shown when the text actually overflows) expands/collapses
          the full text.
       2) Same idea as the Live "pin a product" card: a reel's owner can pin up
          to MAX_PINS of their own Marketplace listings to a reel (kebab menu ->
          "Pin a product"). Pins are stored on the reel doc as `pinnedProducts`
          and shown as a swipeable, auto-advancing "FOR SALE" strip under the
          caption (grid card) and above the username (fullscreen viewer).
          Tapping a pin opens that listing in the Marketplace.
       Markup is produced here and called from app-feed.js (the card builder)
       through guarded window.* hooks, so nothing breaks if load order changes.
       ========================================================================= */
    (function empyreanReelCaptionsAndPins() {
        'use strict';
        if (window._empReelCapPinsLoaded) return;
        window._empReelCapPinsLoaded = true;

        var MAX_PINS = 5, AUTO_MS = 3500;
        var CHEV = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
        var BAG  = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>';

        /* ------------------------------------------------------------- CSS */
        (function css() {
            if (document.getElementById('reel-capin-css')) return;
            var s = document.createElement('style'); s.id = 'reel-capin-css';
            s.textContent = [
                '.reel-cap-row{display:flex;align-items:flex-end;gap:6px;}',
                '.reel-cap-row .reel-cap-text{flex:1 1 auto;min-width:0;white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:anywhere;}',
                '.reel-cap-row.reel-cap-open .reel-cap-text{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;}',
                '.reel-cap-toggle{flex:0 0 auto;display:none;align-items:center;justify-content:center;min-width:26px;height:26px;gap:3px;margin:-2px 0;padding:0 9px 0 10px;border:none;border-radius:13px;background:rgba(10,14,39,0.07);color:inherit;font-size:.74rem;font-weight:700;line-height:1;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
                '.reel-cap-toggle::before{content:"more";}',
                '.reel-cap-row.reel-cap-more .reel-cap-toggle{display:inline-flex;}',
                '.reel-cap-toggle svg{transition:transform .2s ease;}',
                '.reel-cap-row.reel-cap-open .reel-cap-toggle svg{transform:rotate(180deg);}',
                /* FIX (2026-11-08): chevron on feed/pinned cards expands the caption INLINE; the fullscreen overlay is viewer-only. */
                '.reel-cap-row.reel-cap-open .reel-cap-text{display:block;-webkit-line-clamp:unset;line-clamp:unset;max-height:none;overflow:visible;white-space:pre-wrap;}',
                '.reel-cap-row.reel-cap-open .reel-cap-toggle::before{content:"less";}',
                /* grid card: beat the older nowrap/overflow rules on the container itself */
                '#reels-grid-container .reel-card .reel-caption-line.reel-cap-row{white-space:normal !important;overflow:visible !important;text-overflow:clip !important;}',
                /* fullscreen viewer: keep the caption clear of the engagement rail */
                '.reel-info-strip .reel-cap-row{margin-right:64px;}',
                '.reel-info-strip .reel-cap-row .reel-caption{flex:1 1 auto;min-width:0;max-height:none;overflow:hidden;white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow-wrap:anywhere;}',
                '.reel-info-strip .reel-cap-row.reel-cap-open .reel-caption{white-space:normal;max-height:34vh;overflow-y:auto;text-overflow:clip;overflow-wrap:anywhere;}',
                '.reel-info-strip .reel-cap-toggle{background:rgba(255,255,255,0.18);color:#fff;}',
                /* full-screen faint caption overlay: the reel/video stays visible behind it */
                '#reel-capov{position:fixed;top:0;right:0;bottom:0;left:0;z-index:100000;display:flex;flex-direction:column;box-sizing:border-box;padding:calc(70px + env(safe-area-inset-top,0px)) 22px calc(24px + env(safe-area-inset-bottom,0px));background:rgba(0,0,0,0.5);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#fff;}',
                '#reel-capov .reel-capov-scroll{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-width:none;}',
                '#reel-capov .reel-capov-scroll::-webkit-scrollbar{display:none;}',
                '#reel-capov .reel-capov-text{font-size:1rem;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;text-shadow:0 1px 4px rgba(0,0,0,0.5);}',
                '#reel-capov .reel-capov-less{align-self:flex-end;display:inline-flex;align-items:center;gap:5px;margin-top:12px;padding:8px 16px;border:none;border-radius:999px;background:rgba(255,255,255,0.18);color:#fff;font-size:.85rem;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
                '#reel-capov .reel-capov-less svg{transform:rotate(180deg);}',
                /* UPGRADE (2026-10-25 — "expand from the bottom up, not top to bottom"): the caption now
                   grows UPWARD from the bottom edge (text anchored just above "less"), revealed with a
                   bottom->top clip animation over a bottom-weighted scrim. Later rules override the
                   top-anchored ones above, which are intentionally left in place. Chevron directions
                   follow the motion: "more" points UP (it opens upward), "less" points DOWN. */
                '#reel-capov{justify-content:flex-end;padding:calc(70px + env(safe-area-inset-top,0px)) 18px calc(18px + env(safe-area-inset-bottom,0px));background:linear-gradient(to top,rgba(0,0,0,0.80) 0%,rgba(0,0,0,0.45) 38%,rgba(0,0,0,0) 72%);-webkit-backdrop-filter:none;backdrop-filter:none;animation:reelCapovFade .22s ease-out both;}',
                '#reel-capov .reel-capov-scroll{flex:0 1 auto;max-height:64vh;padding:0 64px 0 4px;transform-origin:bottom center;animation:reelCapovRise .34s cubic-bezier(.2,.8,.2,1) both;}',
                '#reel-capov .reel-capov-less{animation:reelCapovFade .3s ease-out .12s both;}',
                '#reel-capov .reel-capov-less svg{transform:none;}',
                '.reel-cap-toggle svg{transform:rotate(180deg);}',
                '.reel-cap-row.reel-cap-open .reel-cap-toggle svg{transform:none;}',
                '@keyframes reelCapovFade{from{opacity:0}to{opacity:1}}',
                '@keyframes reelCapovRise{from{transform:translateY(28px);opacity:0}to{transform:none;opacity:1}}',
                /* FIX (2026-10-26 — \"caption cut off / expand malfunctions in some browsers\"): the rise used an animated clip-path
                   (unsupported/janky on several WebViews and older browsers) and closing just vanished. Now transform+opacity only
                   (compositor-friendly everywhere), a matching slide-down on close, dvh-aware max-height, contained scrolling. */
                '#reel-capov{overscroll-behavior:contain;touch-action:pan-y;-webkit-tap-highlight-color:transparent;}',
                '#reel-capov .reel-capov-scroll{max-height:64vh;max-height:64dvh;will-change:transform,opacity;}',
                '#reel-capov.reel-capov-out{pointer-events:none;animation:reelCapovFadeOut .2s ease-in both;}',
                '#reel-capov.reel-capov-out .reel-capov-scroll{animation:reelCapovSink .2s ease-in both;}',
                '@keyframes reelCapovFadeOut{from{opacity:1}to{opacity:0}}',
                '@keyframes reelCapovSink{from{transform:none;opacity:1}to{transform:translateY(24px);opacity:0}}',
                '@media (prefers-reduced-motion:reduce){#reel-capov,#reel-capov .reel-capov-scroll,#reel-capov .reel-capov-less{animation-duration:.01s !important;animation-delay:0s !important;}}',

                '.reel-pin-strip{padding:8px 14px 0;}',
                '.reel-pin-scroll{display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y;scrollbar-width:none;overscroll-behavior-x:contain;}',
                '.reel-pin-scroll::-webkit-scrollbar{display:none;}',
                '.reel-pin-item{position:relative;flex:0 0 100%;min-width:0;box-sizing:border-box;scroll-snap-align:start;display:flex;align-items:center;gap:10px;padding:7px 10px 7px 7px;border-radius:14px;border:1px solid rgba(10,14,39,0.10);background:rgba(10,14,39,0.04);color:#0A0E27;text-align:left;cursor:pointer;font:inherit;-webkit-tap-highlight-color:transparent;}',
                '.reel-pin-scroll.reel-pin-multi .reel-pin-item{flex-basis:84%;}',
                '.reel-pin-item:active{transform:scale(0.98);}',
                '.reel-pin-item img,.reel-pin-noimg{width:44px;height:44px;border-radius:9px;object-fit:cover;flex-shrink:0;background:rgba(10,14,39,0.08);display:flex;align-items:center;justify-content:center;color:var(--accent-color,#7c3aed);}',
                '.reel-pin-meta{display:flex;flex-direction:column;min-width:0;flex:1;line-height:1.25;}',
                '.reel-pin-meta strong{font-size:0.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                '.reel-pin-price{font-size:0.78rem;font-weight:700;color:var(--accent-color,#7c3aed);}',
                '.reel-pin-meta em{font-style:normal;font-size:0.64rem;font-weight:700;letter-spacing:.03em;color:#15803d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                '.reel-pin-go{flex-shrink:0;color:#7a8190;font-size:1.2rem;line-height:1;}',
                '.reel-pin-x{flex-shrink:0;width:24px;height:24px;border-radius:50%;background:rgba(10,14,39,0.10);display:inline-flex;align-items:center;justify-content:center;font-size:16px;line-height:1;}',
                '.reel-info-strip .reel-pin-strip{padding:0 64px 8px 0;}',
                '.reel-info-strip .reel-pin-item{background:rgba(20,20,24,0.85);border-color:rgba(255,255,255,0.14);color:#fff;}',
                '.reel-info-strip .reel-pin-price{color:#c4b5fd;} .reel-info-strip .reel-pin-meta em{color:#9be39b;} .reel-info-strip .reel-pin-go{color:#ccc;} .reel-info-strip .reel-pin-x{background:rgba(255,255,255,0.15);}',
                '.reel-pin-flash{outline:3px solid var(--accent-color,#7c3aed);outline-offset:2px;}',

                '#reel-pin-scrim{position:fixed;inset:0;z-index:10400;background:rgba(10,14,39,0.55);display:none;}',
                '#reel-pin-scrim.show{display:block;}',
                '#reel-pin-sheet{position:fixed;left:0;right:0;bottom:0;z-index:10401;max-height:72vh;display:none;flex-direction:column;background:#fff;color:#0A0E27;border-radius:20px 20px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px));box-shadow:0 -10px 40px rgba(10,14,39,0.35);}',
                '#reel-pin-sheet.show{display:flex;}',
                '#reel-pin-sheet h4{margin:0;font-size:1.02rem;font-weight:800;}',
                '#reel-pin-sheet .reel-pin-sub{margin:4px 0 10px;font-size:0.78rem;color:#5b6472;}',
                '#reel-pin-sheet .reel-pin-close{position:absolute;top:12px;right:12px;width:28px;height:28px;border-radius:50%;border:none;background:rgba(10,14,39,0.08);color:#0A0E27;font-size:18px;line-height:1;cursor:pointer;}',
                '#reel-pin-list{overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;}',
                '.reel-pin-row{display:flex;align-items:center;gap:10px;padding:8px;border-radius:12px;cursor:pointer;margin-bottom:6px;background:rgba(10,14,39,0.04);}',
                '.reel-pin-row.on{background:rgba(124,58,237,0.12);}',
                '.reel-pin-row img,.reel-pin-row .reel-pin-noimg{width:44px;height:44px;}',
                '.reel-pin-row .reel-pin-meta strong{font-size:0.86rem;}',
                '.reel-pin-check{color:var(--accent-color,#7c3aed);font-size:18px;font-weight:800;}'
            ].join('\n');
            document.head.appendChild(s);
        })();

        /* --------------------------------------------------------- helpers */
        function esc(s) { return _esc(s); }
        function me()   { return _us() || {}; }
        function stop(e) { e.stopPropagation(); e.preventDefault(); }
        function fmtPrice(p, cur) {
            var n = Number(String(p == null ? '' : p).replace(/,/g, ''));
            return ((cur || '') + ' ' + ((p === '' || p == null || isNaN(n)) ? (p == null ? '' : p) : n.toLocaleString('en-US'))).trim();
        }
        /* same still-image normalisation the Live pin card uses (video/object/blob media -> a real <img> url) */
        function isVid(u) { return /\/video\/upload\//i.test(u) || /\.(mp4|webm|mov|avi|mkv|ogg)(\?|#|$)/i.test(u); }
        function normThumb(m) {
            var u = '';
            if (typeof m === 'string') u = m; else if (m && typeof m === 'object') u = m.thumbnail || m.thumb || m.poster || m.url || m._cloudUrl || '';
            u = String(u || '').trim();
            if (!u || /^blob:/i.test(u)) return '';
            if (isVid(u)) {
                if (/res\.cloudinary\.com/i.test(u) && /\/video\/upload\//i.test(u)) {
                    return u.replace('/video/upload/', '/video/upload/so_0,w_200,h_200,c_fill,f_jpg/').replace(/\.(mp4|webm|mov|avi|mkv|ogg)(\?.*)?$/i, '.jpg');
                }
                return '';
            }
            if (/res\.cloudinary\.com/i.test(u) && /\/image\/upload\//i.test(u) && !/\/image\/upload\/[^\/]*(w_|c_|h_)/i.test(u)) {
                u = u.replace('/image/upload/', '/image/upload/w_200,h_200,c_fill,q_auto/');
            }
            return u;
        }
        function pickThumb(media) {
            if (!Array.isArray(media)) return '';
            var firstVid = '';
            for (var i = 0; i < media.length; i++) {
                var raw = typeof media[i] === 'string' ? media[i] : (media[i] && (media[i].url || media[i]._cloudUrl)) || '';
                var t = normThumb(media[i]);
                if (!t) continue;
                if (isVid(String(raw))) { if (!firstVid) firstVid = t; continue; }
                return t;
            }
            return firstVid;
        }
        function pinsOf(reel) {
            return (reel && Array.isArray(reel.pinnedProducts)) ? reel.pinnedProducts.filter(function (x) { return x && x.listingId; }) : [];
        }
        function cardFor(id) { return document.querySelector('#reels-grid-container .reel-card[data-post-id="' + id + '"]'); }
        function readPins(card) { try { return JSON.parse(card.dataset.pins || '[]') || []; } catch (e) { return []; } }

        /* ------------------------------------------------------ pin markup */
        function itemHtml(p, reelId, canEdit) {
            var img = normThumb(p.image);
            return '<button type="button" class="reel-pin-item" data-reel-id="' + esc(reelId) + '" data-listing-id="' + esc(p.listingId) + '">'
                + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' : '')
                + '<span class="reel-pin-noimg"' + (img ? ' style="display:none"' : '') + '>' + BAG + '</span>'
                + '<span class="reel-pin-meta"><strong>' + esc(p.name || 'Listing') + '</strong><span class="reel-pin-price">' + esc(fmtPrice(p.price, p.currency)) + '</span><em>FOR SALE \u2022 View in Marketplace</em></span>'
                + (canEdit ? '<span class="reel-pin-x" role="button" aria-label="Unpin" title="Unpin" data-reel-id="' + esc(reelId) + '" data-reel-unpin="' + esc(p.listingId) + '">\u00d7</span>' : '<span class="reel-pin-go">\u203a</span>')
                + '</button>';
        }
        function stripHtml(pins, reelId, canEdit) {
            if (!pins.length) return '';
            return '<div class="reel-pin-strip" data-reel-id="' + esc(reelId) + '"><div class="reel-pin-scroll' + (pins.length > 1 ? ' reel-pin-multi' : '') + '">'
                + pins.map(function (p) { return itemHtml(p, reelId, canEdit); }).join('') + '</div></div>';
        }
        function ownerOf(card) { var u = me().id; return !!u && card.dataset.userId === u; }

        /* put/refresh/remove the strip inside `host`, before the element matching `beforeSel` */
        function renderInto(host, beforeSel, pins, reelId, canEdit) {
            if (!host) return;
            var old = host.querySelector(':scope > .reel-pin-strip');
            var prevLeft = 0;
            if (old) { var sc = old.querySelector('.reel-pin-scroll'); if (sc) prevLeft = sc.scrollLeft; old.remove(); }
            if (!pins.length) return;
            var tmp = document.createElement('div'); tmp.innerHTML = stripHtml(pins, reelId, canEdit);
            var strip = tmp.firstChild, before = beforeSel ? host.querySelector(':scope > ' + beforeSel) : null;
            if (before) host.insertBefore(strip, before); else host.appendChild(strip);
            if (prevLeft) { var sc2 = strip.querySelector('.reel-pin-scroll'); if (sc2) sc2.scrollLeft = prevLeft; }
        }
        function applyPins(card, pins) {
            var sig = pins.length ? JSON.stringify(pins) : '';
            var has = !!card.querySelector(':scope > .reel-pin-strip');
            if ((card.dataset.pins || '') === sig && has === !!pins.length) return; // nothing changed
            card.dataset.pins = sig;
            var id = card.dataset.postId || '', canEdit = ownerOf(card);
            renderInto(card, '.reel-meta-row', pins, id, canEdit);
            /* an open fullscreen viewer item for the same reel */
            var vi = document.querySelector('.reel-viewer-item[data-reel-id="' + id + '"] .reel-info-strip');
            if (vi) renderInto(vi, '.reel-username', pins, id, canEdit);
            if (card.classList.contains('reel-card-active')) { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }
        }

        /* --------------------------------------------- hooks for the builders */
        window._empReelCapRowHtml = function (text) {
            return '<div class="reel-caption-line reel-cap-row"><span class="reel-cap-text">' + esc(text) + '</span>'
                + '<button type="button" class="reel-cap-toggle" aria-expanded="false" aria-label="Show full caption" title="Show more">' + CHEV + '</button></div>';
        };
        window._empReelViewerCapHtml = function (text) {
            return '<div class="reel-cap-row"><div class="reel-caption">' + esc(text) + '</div>'
                + '<button type="button" class="reel-cap-toggle" aria-expanded="false" aria-label="Show full caption" title="Show more">' + CHEV + '</button></div>';
        };
        window._empReelPinSync = function (card, reel) { try { applyPins(card, pinsOf(reel)); } catch (e) { console.warn('[ReelPins] sync: ' + (e && e.message)); } };
        window._empReelViewerPinsHtml = function (card) {
            try { return stripHtml(readPins(card), card.dataset.postId || card.dataset.reelId || '', ownerOf(card)); } catch (e) { return ''; }
        };
        window._empReelPinMenuItemHtml = function (reelId) {
            return '<button type="button" class="reel-kebab-item reel-pin-menu-item" data-reel-id="' + esc(reelId) + '"><span style="display:inline-flex;vertical-align:-3px;margin-right:6px;">' + BAG.replace('width="20" height="20"', 'width="14" height="14"') + '</span>Pin a product</button>';
        };

        /* ------------------------------------------- one-line caption logic */
        /* FIX (2026-10-26): the "more" chevron was decided from scrollHeight>clientHeight of a line-clamped box. Browsers
           disagree on what scrollHeight reports for -webkit-line-clamp (Firefox/Safari/some WebViews return the clamped
           height), so the button stayed hidden there; and rows built while the viewer was display:none (clientWidth 0)
           were skipped and never re-checked because nothing re-fired when the viewer was shown. Now: measure the full text
           height with an off-screen unclamped clone (identical in every engine), compare to the clamped line count, and
           re-run whenever a caption gets a real width (ResizeObserver) or the viewer's visibility class changes. */
        function capOverflows(t) {
            try {
                var cs = window.getComputedStyle(t);
                var lines = parseInt(cs.webkitLineClamp || cs.lineClamp, 10); if (!(lines > 0)) lines = 2;
                var fs = parseFloat(cs.fontSize) || 14;
                var lh = parseFloat(cs.lineHeight); if (!(lh > 0)) lh = fs * 1.45;
                var c = t.cloneNode(true);
                c.removeAttribute('id');
                c.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;display:block;height:auto;max-height:none;overflow:visible;'
                    + '-webkit-line-clamp:unset;line-clamp:unset;flex:none;width:' + t.clientWidth + 'px;';
                (t.parentNode || document.body).appendChild(c);
                var full = c.getBoundingClientRect().height;
                c.parentNode.removeChild(c);
                if (full > lh * lines + 1) return true;
                return t.scrollHeight > t.clientHeight + 1; // legacy signal as a second opinion
            } catch (e) { return t.scrollHeight > t.clientHeight + 1; }
        }
        var _capRO = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(function () { capSoon(); }) : null;
        function capSync() {
            var rows = document.querySelectorAll('.reel-cap-row:not(.reel-cap-open)');
            for (var i = 0; i < rows.length; i++) {
                var t = rows[i].querySelector('.reel-cap-text, .reel-caption');
                if (!t) continue;
                if (_capRO && !t._capObs) { t._capObs = true; try { _capRO.observe(t); } catch (e) {} }
                if (!t.clientWidth) continue; // hidden right now — the ResizeObserver re-fires when it gets a width
                var sig = t.clientWidth + '|' + (t.textContent || '').length;
                if (rows[i]._capSig === sig) continue;
                rows[i]._capSig = sig;
                rows[i].classList.toggle('reel-cap-more', capOverflows(t));
            }
        }
        var _capT = null;
        function capSoon() { clearTimeout(_capT); _capT = setTimeout(capSync, 120); }
        function closeCapOverlay() {
            var ov = document.getElementById('reel-capov');
            if (!ov) return false;
            if (ov.classList.contains('reel-capov-out')) return true; // already closing
            if (ov._btn) { ov._btn.setAttribute('aria-expanded', 'false'); ov._btn.setAttribute('aria-label', 'Show full caption'); ov._btn.title = 'Show more'; }
            ov.classList.add('reel-capov-out');
            var _gone = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
            ov.addEventListener('animationend', function (e) { if (e.target === ov) _gone(); });
            setTimeout(_gone, 320); // safety net where animationend never fires (reduced-motion / hidden tab)
            return true;
        }
        function toggleCap(btn) {
            /* FIX (2026-11-08): only the FULLSCREEN viewer uses the bottom-up overlay; cards expand in place. */
            var row0 = btn.closest('.reel-cap-row');
            if (row0 && !row0.closest('.reel-info-strip, .reel-viewer-item, #reel-viewer-modal-overlay')) {
                var isOpen = row0.classList.toggle('reel-cap-open');
                btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                btn.setAttribute('aria-label', isOpen ? 'Hide full caption' : 'Show full caption');
                btn.title = isOpen ? 'Show less' : 'Show more';
                try { window.dispatchEvent(new Event('resize')); } catch (e) {} /* re-measure the pinned card's spacer */
                return;
            }
            if (closeCapOverlay()) return;
            var row = btn.closest('.reel-cap-row'); if (!row) return;
            var t = row.querySelector('.reel-cap-text, .reel-caption');
            var ov = document.createElement('div'); ov.id = 'reel-capov';
            ov.innerHTML = '<div class="reel-capov-scroll"><div class="reel-capov-text"></div></div>'
                + '<button type="button" class="reel-capov-less" aria-label="Hide full caption">less ' + CHEV + '</button>';
            ov.querySelector('.reel-capov-text').textContent = t ? t.textContent : '';
            ov._btn = btn;
            /* keep taps/swipes on the overlay from reaching the reel feed or viewer underneath */
            ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'wheel'].forEach(function (ev) {
                ov.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true });
            });
            ov.addEventListener('click', function (e) {
                e.stopPropagation();
                if (e.target.closest('.reel-capov-less') || !e.target.closest('.reel-capov-text')) closeCapOverlay();
            });
            document.body.appendChild(ov);
            btn.setAttribute('aria-expanded', 'true');
            btn.setAttribute('aria-label', 'Hide full caption');
            btn.title = 'Show less';
        }
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCapOverlay(); });
        if (typeof MutationObserver !== 'undefined') {
            var _startObs = function () { new MutationObserver(capSoon).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); };
            if (document.body) _startObs(); else document.addEventListener('DOMContentLoaded', _startObs);
        }
        window.addEventListener('resize', capSoon);
        function capReset() { var r = document.querySelectorAll('.reel-cap-row'); for (var i = 0; i < r.length; i++) r[i]._capSig = null; capSoon(); }
        window.addEventListener('load', function () { capReset(); setTimeout(capReset, 1500); });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(capReset);

        /* ---------------------------------------------- auto-advancing strip */
        var _pauseUntil = 0;
        function pauseAuto(e) { if (e.target && e.target.closest && e.target.closest('.reel-pin-scroll')) _pauseUntil = Date.now() + 7000; }
        ['touchstart', 'pointerdown', 'wheel'].forEach(function (ev) { document.addEventListener(ev, pauseAuto, { passive: true, capture: true }); });
        function advance(sc) {
            var r = sc.getBoundingClientRect();
            if (!r.height || r.bottom < 0 || r.top > window.innerHeight || sc.scrollWidth <= sc.clientWidth + 2) return;
            var items = sc.querySelectorAll('.reel-pin-item'); if (items.length < 2) return;
            var base = items[0].offsetLeft, cur = 0, best = Infinity;
            for (var i = 0; i < items.length; i++) {
                var d = Math.abs((items[i].offsetLeft - base) - sc.scrollLeft);
                if (d < best) { best = d; cur = i; }
            }
            var next = (cur + 1) % items.length;
            var target = next === 0 ? 0 : Math.min(items[next].offsetLeft - base, sc.scrollWidth - sc.clientWidth);
            sc.scrollTo({ left: target, behavior: 'smooth' });
        }
        setInterval(function () {
            try {
                if (document.hidden || Date.now() < _pauseUntil) return;
                if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
                var list = document.querySelectorAll('.reel-pin-scroll.reel-pin-multi');
                for (var i = 0; i < list.length; i++) advance(list[i]);
            } catch (e) {}
        }, AUTO_MS);

        /* --------------------------------------------- open listing on tap */
        function openListing(reelId, listingId) {
            var pin = null, c = cardFor(reelId);
            if (c) pin = readPins(c).filter(function (p) { return p.listingId === listingId; })[0];
            var name = (pin && pin.name) || 'This item';
            var ov = document.getElementById('reel-viewer-modal-overlay');
            if (ov && ov.classList.contains('show')) { try { _closeReelViewer(); } catch (e) {} }
            function go() {
                if (typeof window.navigateTo === 'function') window.navigateTo('marketplace');
                var tries = 0, poll = setInterval(function () {
                    tries++;
                    var card = document.querySelector('#property-grid-container .property-card[data-id="' + listingId + '"]');
                    if (card) {
                        clearInterval(poll);
                        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        card.classList.add('reel-pin-flash');
                        setTimeout(function () { card.classList.remove('reel-pin-flash'); }, 2200);
                    } else if (tries >= 20) {
                        clearInterval(poll);
                        _notify('\u201c' + name + '\u201d isn\u2019t showing in the Marketplace right now \u2014 it may have been removed.', 'info');
                    }
                }, 500);
            }
            var db = window.fbDb;
            if (!db || !listingId) { go(); return; }
            db.collection('marketplace_listings').doc(listingId).get().then(function (snap) {
                if (!snap.exists) { _notify('\u201c' + name + '\u201d is no longer listed.', 'info'); return; }
                var d = snap.data() || {};
                if (d.status === 'sold' || d.status === 'delisted') { _notify('\u201c' + name + '\u201d has been ' + (d.status === 'sold' ? 'sold.' : 'removed from the Marketplace.'), 'info'); return; }
                go();
            }).catch(function () { go(); });
        }

        /* ---------------------------------------------------- pin / unpin */
        function savePins(reelId, pins) {
            if (reelId === DRAFT) { _draftPins = pins; renderSheet(); if (typeof _draftCb === 'function') { try { _draftCb(pins.slice()); } catch (e) {} } return; }
            var card = cardFor(reelId); if (!card) return;
            var prev = readPins(card);
            applyPins(card, pins); renderSheet();
            if (!window.fbDb) { _notify('You appear to be offline \u2014 pins can\u2019t be saved right now.', 'error'); applyPins(card, prev); renderSheet(); return; }
            window.fbDb.collection('reels').doc(reelId).update({ pinnedProducts: pins }).catch(function (err) {
                applyPins(card, prev); renderSheet();
                _notify('Could not update pins: ' + ((err && err.code === 'permission-denied') ? 'permission denied (the reels Firestore rule must let the owner write pinnedProducts).' : ((err && err.message) || 'try again.')), 'error');
            });
        }
        function unpin(reelId, listingId) {
            var card = cardFor(reelId); if (!card) return;
            savePins(reelId, readPins(card).filter(function (p) { return p.listingId !== listingId; }));
        }

        /* ------------------------------------------------- listing picker */
        var _pickReel = null, _mine = [], _mineUid = null, _loading = false;
        var DRAFT = '__composer__', _draftPins = [], _draftCb = null; /* reel being composed (not posted yet) */
        function sortL(a) { return a.sort(function (x, y) { return String(y.createdAt || '').localeCompare(String(x.createdAt || '')); }); }
        function mergeL(a, b) { var m = {}; a.forEach(function (l) { m[l.id] = l; }); b.forEach(function (l) { m[l.id] = Object.assign({}, m[l.id] || {}, l); }); return sortL(Object.keys(m).map(function (k) { return m[k]; })); }
        function fromGrid(uid) {
            var out = [];
            try {
                document.querySelectorAll('#property-grid-container .property-card[data-id]').forEach(function (c) {
                    if (c.dataset.sellerId !== uid) return;
                    var media = []; try { media = JSON.parse(c.dataset.media || '[]'); } catch (e) {}
                    var im = c.querySelector('img[src]');
                    out.push({ id: c.dataset.id, name: c.dataset.name || 'Listing', price: c.dataset.price, currency: c.dataset.displayCurrency || '', media: media,
                        thumb: pickThumb(media) || (im ? normThumb(im.getAttribute('src')) : ''), sellerId: uid,
                        createdAt: c.dataset.createdAtTs ? new Date(Number(c.dataset.createdAtTs)).toISOString() : '' });
                });
            } catch (e) {}
            return sortL(out);
        }
        function fetchRemote(uid) {
            var db = window.fbDb; if (!db || !window._firebaseLoaded) return Promise.resolve([]);
            return Promise.race([
                db.collection('marketplace_listings').where('sellerId', '==', uid).limit(50).get(),
                new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, 6000); })
            ]).then(function (snap) { return snap.docs.map(function (d) { var x = d.data() || {}; if (!x.id) x.id = d.id; return x; }); })
              .catch(function () { return []; });
        }
        function ensureSheet() {
            if (document.getElementById('reel-pin-sheet')) return;
            var sc = document.createElement('div'); sc.id = 'reel-pin-scrim';
            var sh = document.createElement('div'); sh.id = 'reel-pin-sheet';
            sh.innerHTML = '<button type="button" class="reel-pin-close" aria-label="Close">\u00d7</button>'
                + '<h4>Pin products to this reel</h4>'
                + '<p class="reel-pin-sub">Tap a listing to pin or unpin it (up to ' + MAX_PINS + '). Viewers can tap a pin to open it in the Marketplace.</p>'
                + '<div id="reel-pin-list"></div>';
            document.body.appendChild(sc); document.body.appendChild(sh);
        }
        function closeSheet() {
            var a = document.getElementById('reel-pin-sheet'), b = document.getElementById('reel-pin-scrim');
            if (a) a.classList.remove('show'); if (b) b.classList.remove('show'); _pickReel = null;
        }
        function renderSheet() {
            var list = document.getElementById('reel-pin-list');
            var sh = document.getElementById('reel-pin-sheet');
            if (!list || !sh || !sh.classList.contains('show') || !_pickReel) return;
            var card = cardFor(_pickReel), pinned = (_pickReel === DRAFT) ? _draftPins : (card ? readPins(card) : []);
            var rows = _mine.filter(function (l) { return l.status !== 'sold' && l.status !== 'delisted'; });
            if (_loading && !rows.length) { list.innerHTML = '<p style="text-align:center;color:#5b6472;padding:20px 0;">Loading your listings\u2026</p>'; return; }
            if (!rows.length) { list.innerHTML = '<p style="text-align:center;color:#5b6472;padding:20px 0;">You don\u2019t have any active Marketplace listings yet. Post one in the Marketplace, then pin it here.</p>'; return; }
            list.innerHTML = rows.map(function (l) {
                var on = pinned.some(function (p) { return p.listingId === l.id; });
                var img = pickThumb(l.media) || normThumb(l.thumb);
                return '<div class="reel-pin-row' + (on ? ' on' : '') + '" data-listing-id="' + esc(l.id) + '">'
                    + (img ? '<img src="' + esc(img) + '" alt="" onerror="this.style.display=\'none\'">' : '<span class="reel-pin-noimg">' + BAG + '</span>')
                    + '<span class="reel-pin-meta"><strong>' + esc(l.name || 'Listing') + '</strong><span class="reel-pin-price">' + esc(fmtPrice(l.price, l.currency)) + '</span></span>'
                    + (on ? '<span class="reel-pin-check">\u2713</span>' : '') + '</div>';
            }).join('');
        }
        function openPicker(reelId) {
            if (_isGuest()) { _notify('Sign in to pin products to your reel.', 'warning'); return; }
            var uid = me().id; if (!uid) return;
            var card = cardFor(reelId);
            if (!card || card.dataset.userId !== uid) { _notify('Only the reel\u2019s owner can pin products.', 'warning'); return; }
            _pickReel = reelId; ensureSheet();
            document.getElementById('reel-pin-scrim').classList.add('show');
            document.getElementById('reel-pin-sheet').classList.add('show');
            if (_mineUid !== uid) { _mine = []; _mineUid = uid; }
            _mine = mergeL(_mine, fromGrid(uid));
            _loading = !_mine.length; renderSheet();
            fetchRemote(uid).then(function (remote) { _mine = mergeL(_mine, remote); _loading = false; renderSheet(); });
        }
        /* Composer entry point (2026-10-04): same sheet, but works on a draft list instead of a posted reel. */
        function openDraftPicker(pins, cb) {
            if (_isGuest()) { _notify('Sign in to pin products to your reel.', 'warning'); return; }
            var uid = me().id; if (!uid) { _notify('Sign in to pin products to your reel.', 'warning'); return; }
            _draftPins = (Array.isArray(pins) ? pins : []).slice(); _draftCb = cb; _pickReel = DRAFT; ensureSheet();
            document.getElementById('reel-pin-scrim').classList.add('show');
            document.getElementById('reel-pin-sheet').classList.add('show');
            if (_mineUid !== uid) { _mine = []; _mineUid = uid; }
            _mine = mergeL(_mine, fromGrid(uid));
            _loading = !_mine.length; renderSheet();
            fetchRemote(uid).then(function (remote) { _mine = mergeL(_mine, remote); _loading = false; renderSheet(); });
        }
        window._empReelOpenDraftPicker = openDraftPicker;
        window._empReelPinNormThumb = normThumb; window._empReelPinFmtPrice = fmtPrice;
        function togglePin(listingId) {
            if (!_pickReel) return;
            var card = cardFor(_pickReel); if (!card && _pickReel !== DRAFT) return;
            var pins = (_pickReel === DRAFT) ? _draftPins.slice() : readPins(card), idx = -1;
            pins.forEach(function (p, i) { if (p.listingId === listingId) idx = i; });
            if (idx >= 0) { pins.splice(idx, 1); }
            else {
                if (pins.length >= MAX_PINS) { _notify('You can pin up to ' + MAX_PINS + ' products to one reel.', 'warning'); return; }
                var l = _mine.filter(function (x) { return x.id === listingId; })[0]; if (!l) return;
                pins.push({ listingId: l.id, name: l.name || 'Listing', price: l.price != null ? l.price : '', currency: l.currency || '',
                    image: pickThumb(l.media) || normThumb(l.thumb) || '', sellerId: l.sellerId || me().id || '', pinnedAt: new Date().toISOString() });
            }
            savePins(_pickReel, pins);
        }

        /* ------------------------------------------------- click routing
           window + capture so these taps win over the card-open / viewer
           handlers further down this file (same technique as app-patch-v42). */
        window.addEventListener('click', function (e) {
            var t = e.target; if (!t || !t.closest) return;
            var tg = t.closest('.reel-cap-toggle');
            if (tg) { stop(e); toggleCap(tg); return; }
            var x = t.closest('.reel-pin-x');
            if (x) { stop(e); unpin(x.getAttribute('data-reel-id'), x.getAttribute('data-reel-unpin')); return; }
            var it = t.closest('.reel-pin-item');
            if (it) { stop(e); openListing(it.getAttribute('data-reel-id'), it.getAttribute('data-listing-id')); return; }
            var mi = t.closest('.reel-pin-menu-item');
            if (mi) {
                stop(e);
                document.querySelectorAll('.reel-kebab-menu.open').forEach(function (m) { m.classList.remove('open'); });
                openPicker(mi.getAttribute('data-reel-id')); return;
            }
            if (t.closest('.reel-pin-close') || t.id === 'reel-pin-scrim') { stop(e); closeSheet(); return; }
            var row = t.closest('.reel-pin-row');
            if (row) { stop(e); togglePin(row.getAttribute('data-listing-id')); }
        }, true);
    })();

    /* =========================================================================
       §0  REEL GRID FEED — auto-play-at-top ordering + kebab menu
       =========================================================================
       Scoped entirely to #reels-grid-container (the main "Reels (Shorts)"
       section grid built in app-feed.js). By default NOTHING is pinned —
       every card is a normal, vertically-scrollable poster-frame thumbnail
       (spec §1). Tapping a card makes it "active": pinned (position:fixed)
       at the top of that grid and the only one actually playing, while
       every other card stays scrollable beneath it (spec §2) — see
       _promoteActiveReel(). Pressing the exit/back button (or the
       collapse button on the pinned card itself) unpins it and restores
       the default fully-scrollable layout (spec §3) — see
       _unpinActiveReel() and the popstate listener just below it. Tapping
       ANY card (including the pinned one) also still opens the full
       fullscreen viewer exactly as before — see the existing "Reel card
       click (from grid)" handler further down, which calls
       _promoteActiveReel() before opening it.
       ========================================================================= */
    var _activeReelId = null;

    function _reelGrid() { return document.getElementById('reels-grid-container'); }

    /* EXIT/BACK-BUTTON UNPIN (2026-08-11), §3 of the spec: a single history
       entry is pushed the moment a card FIRST becomes pinned (i.e. the grid
       transitions from "nothing pinned" to "something pinned") — not on
       every subsequent auto-advance/swipe while already pinned, so pressing
       Back always drops straight back to the fully-scrollable unpinned grid
       in one press rather than stepping backwards through every reel that
       was watched in between. _reelPinNavInProgress guards against the
       popstate handler's own call back into this code creating a loop. */
    var _reelPinNavInProgress = false;

    function _promoteActiveReel(reelId, direction) {
        if (!reelId) return;
        var wasPinned = !!_activeReelId;
        _activeReelId = reelId;
        _applyActiveReelOrdering(direction);
        if (!wasPinned && !_reelPinNavInProgress) {
            try { history.pushState({ reelPinned: true }, '', location.href); }
            catch (e) { /* pushState can't fail in a way that should block pinning */ }
        }
    }

    /* Unpins whatever reel is currently pinned/playing and restores the
       grid to its default fully-scrollable state — the exit/back-button
       behaviour required by §3 of the spec. Safe to call even when nothing
       is pinned (no-op). Does NOT itself touch browser history — the two
       ways this gets triggered (the inline collapse button, and the
       popstate listener below) each own that decision themselves. */
    function _unpinActiveReel() {
        if (!_activeReelId) return;
        var grid = _reelGrid();
        var activeCard = grid && grid.querySelector('.reel-card.reel-card-active');
        if (activeCard) {
            var vid = activeCard.querySelector('video');
            if (vid) {
                try { vid.pause(); vid.currentTime = 0; vid.muted = true; } catch (e) {}
            }
        }
        _activeReelId = null;
        _applyActiveReelOrdering();
    }
    window._empReelsUnpinActive = _unpinActiveReel;

    /* Hardware/browser Back button support for the pinned reel — mirrors
       the same pushState/popstate pattern already used elsewhere in this
       codebase (app-nav.js's own top-level section listener, marketplace's
       mktDeepLink, the chat overlay's _ocChatOpen — see app-nav.js's
       "Hardware/browser Back button support" comment for the full
       rationale). Scoped to only act when a reel is actually pinned right
       now AND the state landed on doesn't itself carry reelPinned, so it
       never fights with app-nav.js's own section-level listener over the
       same Back press. */
    window.addEventListener('popstate', function (e) {
        var st = e.state;
        if (_activeReelId && !(st && st.reelPinned)) {
            /* If the person also opened the fullscreen swipeable viewer off
               of the pinned card (tapping it does both — see the "Reel
               card click" handler further down), a Back press should feel
               like it backs out of THAT first, same as it would for any
               other modal in this app, rather than leaving it open on top
               of a grid that just silently unpinned underneath it. */
            var ov = document.getElementById('reel-viewer-modal-overlay');
            if (ov && ov.classList.contains('show')) _closeReelViewer();
            _reelPinNavInProgress = true;
            _unpinActiveReel();
            _reelPinNavInProgress = false;
        }
    });

    /* AUTO-ADVANCE / SWIPE (2026-08-10): canonical reel order used to find
       "next"/"previous", independent of the grid's actual DOM order — the
       active card is physically moved to sit right after the spacer on
       every promotion (see below), so DOM order alone can't be trusted to
       mean "reel order" once anything has ever advanced. Sorted newest-
       first by data-created-at instead, which stays stable regardless of
       how many times a card has been pinned/unpinned. */
    function _orderedReelCards() {
        var grid = _reelGrid();
        if (!grid) return [];
        var cards = Array.prototype.slice.call(grid.querySelectorAll('.reel-card:not(.reels-live-tv-card)'));
        cards.sort(function (a, b) {
            return (Date.parse(b.dataset.createdAt) || 0) - (Date.parse(a.dataset.createdAt) || 0);
        });
        return cards;
    }

    function _advanceActiveReel(direction) {
        var cards = _orderedReelCards();
        if (cards.length < 2) return;
        var idx = cards.findIndex(function (c) { return c.dataset.postId === _activeReelId; });
        if (idx === -1) idx = 0;
        var nextIdx = direction === 'prev'
            ? (idx - 1 + cards.length) % cards.length
            : (idx + 1) % cards.length;
        var target = cards[nextIdx];
        if (target && target.dataset.postId !== _activeReelId) {
            _promoteActiveReel(target.dataset.postId, direction === 'prev' ? 'prev' : 'next');
        }
    }
    window._empReelsAdvanceActive = _advanceActiveReel;

    function _applyActiveReelOrdering(direction) {
        var grid = _reelGrid();
        if (!grid) return;
        var cards = Array.prototype.slice.call(grid.querySelectorAll('.reel-card'));
        if (!cards.length) return;

        /* PIN-ON-TAP (2026-08-11): nothing is pinned by default any more —
           the grid opens fully vertically scrollable (every card just a
           normal poster-frame thumbnail) until the person actually taps
           one, exactly per the "Reel Section Playback & Navigation
           Requirements" spec (§1/§2). _activeReelId therefore starts (and
           can return to) null instead of always falling back to the
           newest card — see _promoteActiveReel() for how a tap sets it,
           and _unpinActiveReel()/the popstate listener further down for
           how the exit/back button clears it again. If the previously
           active reel got removed from the DOM (deleted post, etc.) this
           also just drops back to the unpinned state rather than silently
           re-pinning some other card the person never chose. */
        var targetId = _activeReelId;
        if (targetId && !grid.querySelector('.reel-card[data-post-id="' + targetId + '"]')) {
            targetId = null;
            _activeReelId = null;
        }

        /* STATUS BAR HIDE-ON-PIN (2026-08-11), §2 of the spec: single
           source of truth for whether a reel is currently pinned, read by
           the 'body.emp-section-reels.reel-active-pinned #status-bar-
           container { display:none !important; }' rule above. Toggled
           here (not in _promoteActiveReel()/_unpinActiveReel() directly)
           so every path that can change _activeReelId — a tap, auto-
           advance, a swipe, the exit/back button, a deleted-post fallback
           to unpinned — stays in sync automatically, since they all funnel
           through this one function. */
        document.body.classList.toggle('reel-active-pinned', !!targetId);

        cards.forEach(function (card) {
            var isTarget = !!targetId && card.dataset.postId === targetId;
            card.classList.toggle('reel-card-active', isTarget);
            var vid = card.querySelector('video');
            if (!vid) return;
            if (isTarget) {
                if (!card.querySelector('.reel-now-playing-badge')) {
                    var badge = document.createElement('div');
                    badge.className = 'reel-now-playing-badge';
                    badge.innerHTML = '<i class="fas fa-circle"></i><span>Now Playing</span>';
                    card.appendChild(badge);
                }
                /* EXIT/COLLAPSE BUTTON (2026-08-11), §3 of the spec: an
                   explicit, always-visible way to unpin the card besides
                   the hardware/browser Back button (not every platform this
                   runs on has a reliable Back gesture — e.g. desktop web).
                   Tapping it just calls history.back(), so it always goes
                   through the exact same popstate → _unpinActiveReel() path
                   as a real Back press, rather than duplicating that logic
                   and risking the two drifting out of sync. */
                if (!card.querySelector('.reel-grid-unpin-btn')) {
                    var videoWrap = card.querySelector('.reel-video-wrap');
                    if (videoWrap) {
                        var unpinBtn = document.createElement('button');
                        unpinBtn.className = 'reel-grid-unpin-btn';
                        unpinBtn.type = 'button';
                        unpinBtn.setAttribute('aria-label', 'Collapse reel');
                        unpinBtn.title = 'Collapse reel';
                        unpinBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
                        /* Appended into .reel-video-wrap (not the outer
                           .reel-card) so its bottom/left offsets land right
                           at the corner of the VIDEO itself — matching where
                           .reel-duration-badge and .reel-audio-controls
                           already anchor (see the CSS comment on
                           .reel-grid-unpin-btn) — rather than the bottom of
                           the whole card (which also includes the caption
                           and meta rows below the video). */
                        videoWrap.appendChild(unpinBtn);
                    }
                }
                /* AUTO-ADVANCE (2026-08-10): the markup gives every reel
                   video a native `loop` attribute (so it reads as a nice
                   ambient preview before it's ever pinned) — but that same
                   attribute means the browser NEVER fires 'ended' on it, it
                   just silently restarts, which is why nothing advanced to
                   the next reel before now. Looping is turned off only once
                   this card is the pinned/active one, so it can actually
                   finish and hand off to the next reel; every other card
                   keeps loop=true (harmless, they're always paused). */
                vid.loop = false;
                if (!vid._reelAutoAdvanceWired) {
                    vid._reelAutoAdvanceWired = true;
                    vid.addEventListener('ended', function () {
                        /* Guard against a stale listener firing after this
                           card was already deactivated elsewhere. */
                        if (card.dataset.postId === _activeReelId) _advanceActiveReel('next');
                    });
                }
                /* SOUND ON AUTOPLAY (2026-11-08): old line commented out, not deleted.
                if (vid.paused) { vid.play().catch(function () {}); }
                */
                _empReelPlayWithSound(vid);
                /* Reset the play/pause + mute icons to match a fresh
                   autoplay (playing, muted) every time a card newly becomes
                   the active one — otherwise a stale icon from a previous
                   activation (e.g. it was left paused/unmuted last time it
                   was active) would be shown without matching reality. */
                var ppIcon2 = card.querySelector('.reel-playpause-btn i');
                if (ppIcon2) { ppIcon2.classList.remove('fa-play'); ppIcon2.classList.add('fa-pause'); }
                /* AUDIO FIX (2026-08-11): vid.muted is force-reset to true
                   right below (in the else branch, when a card is
                   deactivated) so every freshly-pinned reel always starts
                   silent, matching the browser's autoplay-must-be-muted
                   rule — so the mute icon/class must be reset to match
                   THAT state here too, every time a card newly becomes
                   active, instead of possibly showing a stale "unmuted"
                   speaker icon left over from whatever this card looked
                   like the last time it was active. */
                /* SOUND ON AUTOPLAY (2026-11-08): the old forced-muted icon reset is
                   replaced by a sync to the video's real muted state. */
                _empReelSyncMuteUi(card, vid);
            } else if (!vid.paused) {
                vid.pause();
                try { vid.currentTime = 0; } catch (e) {}
                vid.muted = true; /* re-mute so it's ready for autoplay again next time it becomes active */
            }
        });

        /* UNPINNED STATE (2026-08-11): no reel selected — every card is
           just an ordinary, vertically-scrollable poster-frame thumbnail
           (see §1 of the spec). The spacer that normally reserves room for
           the fixed/pinned card is collapsed to 0 so nothing leaves a gap,
           and there's no active card to reposition, so the rest of this
           function (which only concerns the pinned card) is skipped. The
           fixed search-bar/title topbar itself stays put regardless —
           it's independent of whether a reel is pinned. */
        if (!targetId) {
            var idleSpacer = document.getElementById('reel-active-spacer');
            if (idleSpacer) idleSpacer.style.height = '0px';
            _syncReelsTopbar();
            return;
        }

        /* Move the active card to sit right after the spacer (the spacer is
           kept as the grid's true first child — see _syncActiveSpacer()
           below), so the two settle into a stable order and don't keep
           re-triggering the childList MutationObserver that also calls this
           function (see _watchReelGrid() further down). */
        var targetCard = grid.querySelector('.reel-card[data-post-id="' + targetId + '"]');
        var spacer = document.getElementById('reel-active-spacer');
        if (!spacer) {
            spacer = document.createElement('div');
            spacer.id = 'reel-active-spacer';
            spacer.className = 'reel-active-spacer';
        }
        if (grid.firstElementChild !== spacer) grid.insertBefore(spacer, grid.firstElementChild);
        if (targetCard && spacer.nextElementSibling !== targetCard) {
            grid.insertBefore(targetCard, spacer.nextSibling);
        }

        /* The active card is now position:fixed (see its CSS above) — fixed
           elements are removed from normal document flow, so without
           something reserving its footprint the rest of the feed would jump
           straight up to fill that gap the instant a card becomes active.
           The spacer above is sized here to match the active card's actual
           rendered height; the fixed card visually sits on top of it. */
        if (targetCard) _syncActiveSpacer(spacer, targetCard);
        _syncReelsTopbar();

        /* SWIPE TRANSITION (2026-08-10): only animate when a direction was
           explicitly passed in (auto-advance or a manual horizontal swipe)
           — an ordinary tap-to-promote from the grid, or the very first
           card becoming active on load, stays instant as before. */
        if (targetCard && direction) {
            targetCard.classList.remove('reel-swipe-next', 'reel-swipe-prev');
            void targetCard.offsetWidth; /* force reflow so the animation restarts if reused quickly */
            var animClass = direction === 'prev' ? 'reel-swipe-prev' : 'reel-swipe-next';
            targetCard.classList.add(animClass);
            targetCard.addEventListener('animationend', function _clearSwipeClass() {
                targetCard.classList.remove(animClass);
                targetCard.removeEventListener('animationend', _clearSwipeClass);
            });
        }
    }

    function _syncActiveSpacer(spacer, activeCard) {
        function _measure() {
            spacer.style.height = activeCard.getBoundingClientRect().height + 'px';
        }
        /* Measure after the browser has actually laid the fixed card out
           (its own aspect-ratio-driven height isn't known synchronously on
           the same tick it was made active). */
        requestAnimationFrame(function () { requestAnimationFrame(_measure); });

        if (!window._empReelSpacerResizeWired) {
            window._empReelSpacerResizeWired = true;
            window.addEventListener('resize', function () {
                var g = _reelGrid();
                var active = g && g.querySelector('.reel-card.reel-card-active');
                var sp = document.getElementById('reel-active-spacer');
                if (g && active && sp) sp.style.height = active.getBoundingClientRect().height + 'px';
            });
        }
    }

    /* TOPBAR SYNC (2026-08-10, this session; DOUBLE-GAP FIX 2026-08-11
       later same day) — measures #reels-fixed-topbar's actual rendered
       height (search bar + title + upload trigger — see index.html) and
       writes it to the --reels-topbar-h custom property. Three things
       read this one number: #reels-topbar-spacer, the pinned "now
       playing" card's `top` offset (.reel-card-active rule above), and
       #status-bar-container's own margin-top (the "STATUS BAR — GENUINE
       SCROLL" rule above) — which clears the always-fixed topbar before
       the status bar starts its normal scrollable run through the
       document.
       BUG FIXED HERE: #reels-topbar-spacer used to unconditionally
       reserve barH too, on top of the status bar's own margin-top — but
       once the status bar is visible and in flow, ITS margin-top already
       supplies that exact clearance before section#reels even begins, so
       reserving it a second time inside the section left a large dead
       gap between the status row and the first card (reported: "the
       space... is too large, wide and broad"). The spacer now only
       reserves barH when the status bar is NOT currently providing that
       clearance itself — i.e. hidden while a card is pinned (see the
       .reel-active-pinned rule above), or simply not present/visible at
       all (logged-out state, etc.) — the two cases where nothing else in
       the layout accounts for the topbar's height. */
    function _syncReelsTopbar() {
        var bar = document.getElementById('reels-fixed-topbar');
        var spacer = document.getElementById('reels-topbar-spacer');
        var statusBar = document.getElementById('status-bar-container');
        if (!bar || !spacer) return;
        function _measure() {
            var barH = bar.getBoundingClientRect().height;
            if (!barH) return;
            var statusProvidesClearance = statusBar && getComputedStyle(statusBar).display !== 'none';
            spacer.style.height = statusProvidesClearance ? '0px' : (barH + 'px');
            document.documentElement.style.setProperty('--reels-topbar-h', barH + 'px');
        }
        _measure();
        requestAnimationFrame(function () { requestAnimationFrame(_measure); });

        /* PERMANENT GAP FIX (this session) — the status-bar/avatar-row gap
           has been "fixed" several times before and kept coming back.
           Every earlier version of this sync only ever re-measured on a
           window `resize` event (plus one initial double-rAF pass on
           load). That misses every OTHER thing that changes either box's
           real rendered height after that first paint: a webfont finishing
           its swap (Font Awesome icons in the topbar/search bar), the
           avatar row's own images loading in and reflowing, the status
           bar being hidden/shown by the .reel-active-pinned toggle, or
           simply some unrelated future edit elsewhere nudging either
           element's padding/font-size. None of those fire a `resize`
           event, so the cached --reels-topbar-h / spacer height went
           stale until someone eyeballed the gap again and hand-patched
           this one call site — hence it kept recurring.
           Fixed for good by watching the two boxes directly instead of a
           proxy event: a ResizeObserver picks up ANY future size change to
           either one automatically, and a MutationObserver on <body>'s
           class list re-measures the instant .emp-section-reels or
           .reel-active-pinned toggles (nav into/out of Reels, pin/unpin) —
           both are ongoing subscriptions, not a one-off measurement, so
           nothing else in this app can silently invalidate them again. */
        if (!window._empReelsTopbarResizeWired) {
            window._empReelsTopbarResizeWired = true;
            window.addEventListener('resize', _measure);
            window.addEventListener('orientationchange', function () {
                requestAnimationFrame(function () { requestAnimationFrame(_measure); });
            });
            if (typeof ResizeObserver !== 'undefined') {
                var ro = new ResizeObserver(function () { _measure(); });
                ro.observe(bar);
                if (statusBar) ro.observe(statusBar);
                window._empReelsTopbarRO = ro;
            }
            var mo = new MutationObserver(function () { _measure(); });
            mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
            /* GAP FIX, FOLLOW-UP (this session): app-status.js toggles the
               status bar's OWN .visible class directly on #status-bar-
               container, not on <body> — so the mutation observer above
               (scoped to body's class list) never caught that toggle. If
               it fired after this one-time setup ran (e.g. statuses finish
               loading async, after the reels section is already open), the
               spacer's statusProvidesClearance check in _measure() went
               stale until something else happened to re-trigger it,
               leaving a large, unexplained gap between the status/avatar
               row and the first reel card below it. Observing statusBar's
               own class attribute too closes that gap at the source. */
            if (statusBar) mo.observe(statusBar, { attributes: true, attributeFilter: ['class'] });
            window._empReelsTopbarMO = mo;
            if (window.document && document.fonts && typeof document.fonts.ready === 'object' && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
                document.fonts.ready.then(_measure);
            }
        }
    }
    window._empReelsApplyActiveOrdering = _applyActiveReelOrdering;

    /* ═══════════════════════════════════════════════════════════════════
       REEL & LIVE BROADCAST CHANNEL (2026-08-11, REBUILT — DECOUPLED from
       the main dashboard Go Live pipeline): "The reel and broadcast channel
       in the reel section should not be connected to the already go live
       streaming section at all — the reel go live should be entirely
       different from the TikTok-style go live. Implement YouTube go live
       style independently from the already existing go live streaming
       section, don't link them at all."

       This REPLACES the previous design (see git history / prior comment
       here), which reused #go-live-form → initAgoraHost() → the
       active_streams collection — i.e. it was secretly the same TikTok-
       style native camera/mic broadcast under a different composer. That
       is exactly what this session's instruction rules out. This version:

         • Never touches #go-live-form, initAgoraHost(), Agora, camera/mic
           permission, or the active_streams collection. Zero shared code
           path with the dashboard "Go Live" button.
         • Is a YOUTUBE-GO-LIVE-STYLE flow: the host supplies a YouTube
           Live URL (the stream source lives on YouTube, the same way
           YouTube's own "Go Live" doesn't run video through a third
           party) plus a title/category, and Empyrean just hosts the
           listing + embedded playback UI around it — for Church, Football
           & Sports, TV Station, and General Public channels.
         • Lives entirely in its own Firestore collection,
           `reel_live_broadcasts`, completely separate from
           `active_streams` (see the Firestore rules note near the bottom
           of this file for the matching security rule to add).

       HOST FLOW: composer (#reels-live-connect-form) → writes a
       reel_live_broadcasts doc directly → opens a dedicated "You're Live"
       host panel (#reels-live-host-panel-overlay, built dynamically below)
       showing the broadcast + a heartbeat keep-alive, with its own
       explicit Exit button that ends the broadcast (deletes the doc, stops
       the heartbeat). Closing/refreshing the tab without tapping Exit is
       covered by the same staleness rule the strip already used
       (HEARTBEAT_STALE_MS below) so a dead broadcast still ages out.

       VIEWER FLOW: the "Live Now" strip renders a plain button per
       category-tagged broadcast; tapping it opens the YouTube embed watch
       overlay directly (no Agora join, no .join-live-btn) — with its own
       explicit Exit button to leave. */
    (function empyreanReelsLiveBroadcastChannel() {

        /* Accepts a bare 11-char video ID, a full watch URL, a youtu.be
           short link, or a /live/ URL. Returns null on anything that
           doesn't clearly resolve to one — used only to validate the now-
           OPTIONAL companion YouTube field below. */
        function _parseYouTubeId(input) {
            if (!input) return null;
            input = String(input).trim();
            if (!input) return null;
            if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
            var patterns = [
                /[?&]v=([a-zA-Z0-9_-]{11})/,
                /youtu\.be\/([a-zA-Z0-9_-]{11})/,
                /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
                /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
                /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
            ];
            for (var i = 0; i < patterns.length; i++) {
                var m = input.match(patterns[i]);
                if (m && m[1]) return m[1];
            }
            return null;
        }

        var _categoryMeta = {
            church: { label: 'Church Service',  icon: 'fa-place-of-worship', extra: 'church' },
            sports: { label: 'Football & Sports', icon: 'fa-futbol',         extra: 'sports' },
            tv:     { label: 'TV Broadcast',     icon: 'fa-tv',              extra: 'tv' },
            public: { label: 'Live Program',     icon: 'fa-satellite-dish', extra: 'public' }
        };
        function _catMeta(c) { return _categoryMeta[c] || _categoryMeta.public; }

        /* ── Category extras toggle (2026-08-11 — Reel & Live Broadcast
           Channel feature layer): shows only the one #reels-live-extras-*
           group that matches the currently-selected category, hides the
           other three. Wired to the select's change event plus run once on
           modal open so it's correct even before the person touches the
           dropdown (church is the first <option>, so it's the default). */
        function _syncExtrasVisibility() {
            var sel = document.getElementById('reels-live-category');
            var cat = sel ? sel.value : 'church';
            ['church', 'sports', 'tv', 'public'].forEach(function (c) {
                var el = document.getElementById('reels-live-extras-' + c);
                if (el) el.style.display = (c === cat) ? 'block' : 'none';
            });
        }
        document.addEventListener('change', function (e) {
            if (e.target && e.target.id === 'reels-live-category') _syncExtrasVisibility();
        });

        /* ── Broadcast-source mode toggle (2026-08-11 — native camera
           broadcasting): switches which composer fields are required/shown.
           Purely a UI concern here — it just decides what the submit
           handler below does with the form, no Agora/Firestore touched
           yet. ── */
        function _setBroadcastMode(mode) {
            var hidden = document.getElementById('reels-live-broadcast-mode');
            if (hidden) hidden.value = mode;
            var nativeBtn = document.getElementById('reels-live-mode-native-btn');
            var youtubeBtn = document.getElementById('reels-live-mode-youtube-btn');
            if (nativeBtn) nativeBtn.classList.toggle('active', mode === 'native');
            if (youtubeBtn) youtubeBtn.classList.toggle('active', mode === 'youtube');
            var ytGroup = document.getElementById('reels-live-youtube-field-group');
            var ytInput = document.getElementById('reels-live-youtube-url');
            var nativeNote = document.getElementById('reels-live-native-note');
            if (ytGroup) ytGroup.style.display = (mode === 'youtube') ? 'block' : 'none';
            if (ytInput) { if (mode === 'youtube') ytInput.setAttribute('required', 'required'); else ytInput.removeAttribute('required'); }
            if (nativeNote) nativeNote.style.display = (mode === 'native') ? 'block' : 'none';
        }
        document.addEventListener('click', function (e) {
            var modeBtn = e.target.closest && e.target.closest('.reels-live-mode-btn');
            if (modeBtn) { _setBroadcastMode(modeBtn.dataset.mode); }
        });

        /* ── Modal open/close ── */
        document.addEventListener('click', function (e) {
            var t = e.target;
            /* FIX (2026-08-12): the idle "off-air" placeholder card
               (rendered by _renderLiveStrip below whenever nothing is
               currently live) is the only entry point into going live from
               inside the grid itself — route its tap through the EXACT
               same #reels-connect-live-btn open logic just below (guest
               gate, modal show, broadcast-mode reset, Agora SDK preload)
               instead of duplicating any of it. Matches either the inner
               screen div's id (#reels-live-tv-idle-card, the "screen"
               portion) OR the outer card's idle class
               (.reels-live-tv-card-idle, added to the whole
               .reel-card-sized card — see _renderLiveStrip) so a tap
               anywhere on the idle card (screen OR the meta row below it)
               opens the composer, not just the screen area. */
            if (t.closest && t.closest('#reels-live-tv-idle-card, .reels-live-tv-card-idle')) {
                var liveBtn = document.getElementById('reels-connect-live-btn');
                if (liveBtn) liveBtn.click();
                return;
            }
            if (t.closest && t.closest('#reels-connect-live-btn')) {
                if (_isGuest()) { _notify('Log in to open the Reel & Live Broadcast Channel.', 'info'); return; }
                var ov = document.getElementById('reels-live-connect-modal-overlay');
                if (ov) { ov.classList.add('show'); ov.style.display = 'flex'; document.body.classList.add('modal-open'); }
                _syncExtrasVisibility();
                _setBroadcastMode('native'); // default every time the composer opens fresh
                /* PRELOAD (this session) — fixes "Live video is taking too
                   long to load" on slow connections: _startNativeAgoraHost()
                   used to only start downloading the Agora SDK AFTER the
                   person filled in the title/category and tapped "Go Live
                   Now", so the entire 15s (now 45s) budget had to fit
                   inside that one wait, with the person staring at a
                   spinner the whole time. Starting the same download here,
                   the instant the composer opens, means it's already been
                   running in the background for however long they spend on
                   the form — often the whole budget, sometimes the whole
                   download — by the time they actually submit. Fire-and-
                   forget: any failure here is silently ignored and simply
                   surfaces again (and gets one more real attempt) inside
                   _startNativeAgoraHost() at submit time, so nothing about
                   the existing error handling changes, this just gives it
                   a head start. */
                _ensureAgoraSdkLoaded(45000).catch(function () {});
                /* 2026-11-04: wake the API host while the person fills in the form, so the token request at Go Live isn't the one that pays the cold-start cost. Fire-and-forget. */
                try { if (typeof window._empApiBase === 'function') fetch(window._empApiBase() + '/api/config', { cache: 'no-store' }).catch(function () {}); } catch (eWarm) {}
                return;
            }
            if (t.closest && (t.closest('#reels-live-connect-close-btn') || t.closest('#reels-live-connect-exit-btn') || t.id === 'reels-live-connect-modal-overlay')) {
                var ov2 = document.getElementById('reels-live-connect-modal-overlay');
                if (ov2) { ov2.classList.remove('show'); ov2.style.display = 'none'; document.body.classList.remove('modal-open'); }
                return;
            }
        });

        /* ── Current host broadcast session on THIS device (if any). Only
           one at a time — starting a new one while already live is blocked
           below rather than silently orphaning the first heartbeat. ── */
        window._empReelLiveSession = window._empReelLiveSession || null;

        function _closeComposerModal() {
            var ov = document.getElementById('reels-live-connect-modal-overlay');
            if (ov) { ov.classList.remove('show'); ov.style.display = 'none'; document.body.classList.remove('modal-open'); }
        }

        /* =========================================================================
           NATIVE CAMERA BROADCAST (2026-08-11)
           ─────────────────────────────────────────────────────────────────
           Uses the SAME Agora Web SDK already loaded on the page (index.html's
           own <script src=".../AgoraRTC_N-4.22.0.js">) and the SAME generic
           /api/agora-token server route app-live.js already calls — that
           endpoint just signs a token for whatever channel name/uid/role it's
           given, it has no idea which feature is asking. Reusing it is reusing
           shared INFRASTRUCTURE (like both features running on the same
           Express server), not linking this channel to the dashboard's
           TikTok-style Go Live feature:
             - its own Agora CLIENT instances (_reelAgoraHostClient/
               _reelAgoraViewerClient below), never app-live.js's
               agoraClient/agoraViewerClient
             - its own CHANNEL per broadcast (the streamId itself — never an
               active_streams channel name)
             - its own Firestore doc (reel_live_broadcasts, as always)
             - its own UI (#reels-live-host-panel-overlay /
               #reels-yt-live-overlay, as always)
           Nothing here calls into app-live.js, app-live-tiktok-patch.js, or
           app-live-final.js, and nothing there calls into this file.
           ========================================================================= */
        var _reelAgoraHostClient = null;
        var _reelAgoraHostTracks = { mic: null, cam: null };
        /* VIEWER (2026-08-11 — completes the build): the comment above
           always referenced "_reelAgoraViewerClient below" as the intended
           counterpart to the host client, but it was never actually
           written — so a native-camera broadcast published successfully
           (host's own camera/mic WERE going out over Agora) but no viewer
           anywhere could ever join and watch it; tapping its card always
           fell into the "no youtubeId → not available" dead end regardless
           of whether the host was really live. This is the missing half. */
        var _reelAgoraViewerClient = null;
        var _reelAgoraViewerJoined = false;
        /* 2026-11-08 — "live must show on the small card AND full screen, and
           joining full screen takes time": ONE audience session now feeds
           whichever surface is on screen. The card joins quietly (video only);
           expanding to full screen re-plays the SAME already-connected track
           into the overlay (instant, no new token/join) and turns audio on;
           minimize/exit re-plays it back into the card. */
        var _reelViewerChannel = null;
        var _reelViewerJoinPromise = null;
        var _reelViewerVideoEl = null;
        var _reelViewerOnVideo = null;
        var _reelViewerWantAudio = true;
        /* SWITCH CAMERA (2026-08-11): tracks which physical camera the
           current native broadcast is using, so repeated taps keep
           alternating front/back instead of always trying the same
           direction. Reset to 'user' at the start of every fresh broadcast
           in _startNativeAgoraHost() below. */
        var _reelHostFacingMode = 'user';
        var _reelHostSwitchingCam = false; // re-entrancy guard — see _switchNativeCamera()
        /* LOCAL CAMERA FALLBACK (this session) — see the big comment inside
           _startNativeAgoraHost() below for why this exists: mirrors
           app-live.js's own `_localFallbackStream` used by its TikTok-style
           Go Live feature. */
        var _reelLocalFallbackStream = null;

        function _reelSafeUid(userId) {
            // Same "hash the app userId into an unsigned 32-bit-ish int"
            // approach app-live.js's _safeUid() and app-live-tiktok-patch.js's
            // _agoraUidFor() each already use — duplicated here (rather than
            // reaching into either file's private closure) so this stays a
            // genuinely separate module, per this session's own instruction.
            var base = String(userId || '');
            var h = 0;
            for (var i = 0; i < base.length; i++) h = ((h << 5) - h) + base.charCodeAt(i);
            return (Math.abs(h) % 900000) + 100001;
        }

        /* COMPLETING THE BUILD (2026-08-11): index.html loads the Agora SDK
           via a single synchronous <script src="...AgoraRTC_N-4.22.0.js">
           tag, and app-live.js/app-startup.js each stamp
           window._agoraAvailable = (typeof AgoraRTC !== 'undefined') once,
           at whatever moment their own script runs. On a slow/flaky mobile
           connection that check can land BEFORE the SDK file has actually
           finished downloading (or after a transient failure), permanently
           freezing _agoraAvailable at false for the rest of the page's
           life — which is exactly the "Live video isn't available on this
           device/browser right now" error this channel's own composer hit
           in testing. Rather than trust that one-shot flag, give native
           mode its own on-demand loader: if AgoraRTC isn't defined yet,
           make ONE fresh attempt (a brand-new <script> element, not reusing
           index.html's — reusing an already-errored tag's load/error
           events won't refire on a flaky connection, a new element gets a
           genuinely new network request) with a generous timeout, and only
           surface the "not available" error if that attempt itself fails
           or times out. Self-contained to this file — doesn't touch
           index.html's tag, app-live.js, or window._agoraAvailable's
           existing readers anywhere else. */
        /* FIX (2026-11-04 — "difficult to connect when you go live" / viewers
           see "Connecting…" forever): every Agora join starts with one POST
           to /api/agora-token. That call had NO timeout and NO retry, so a
           single slow/failed response (the API host waking from idle, a weak
           mobile link) threw straight into the "Live video service is
           unreachable — broadcasting locally" fallback — after which no
           viewer could ever see video. This wraps window._fetchLiveAgoraToken
           (still the shared helper from app-live.js, untouched) with a
           per-attempt timeout and up to 3 attempts with short backoff, used
           by the host join, the background upgrade retry and the viewer
           join below. */
        function _reelFetchToken(channelName, uid, role) {
            var attempts = 0;
            function once() {
                attempts++;
                return new Promise(function (resolve, reject) {
                    var done = false;
                    var timer = setTimeout(function () {
                        if (done) return; done = true;
                        reject(new Error('Token request timed out'));
                    }, attempts === 1 ? 7000 : 12000); /* 2026-11-05: first try gives up sooner so a cold/slow host is retried quickly instead of making the viewer wait 15s */
                    window._fetchLiveAgoraToken(channelName, uid, role).then(function (r) {
                        if (done) return; done = true; clearTimeout(timer);
                        if (!r || !r.token) { reject(new Error('Token response was empty')); return; }
                        resolve(r);
                    }, function (err) {
                        if (done) return; done = true; clearTimeout(timer);
                        reject(err);
                    });
                }).catch(function (err) {
                    if (attempts >= 3) throw err;
                    return new Promise(function (r) { setTimeout(r, 400 * attempts); }).then(once);
                });
            }
            return once();
        }

        /* FIX (2026-11-05 — "delay to connect when users click join the live
           stream"): the viewer join used to run strictly one step after
           another AFTER the tap — leave old session -> SDK check -> set role
           -> token POST (the slow one, cold API host) -> join. Now:
             - the token is requested the moment a live card renders / is
               touched (pointerdown) and cached for 5 min per channel, so by
               the time the tap completes the token is usually already here;
             - SDK load, old-session teardown, setClientRole and the token
               request all run in parallel inside _joinReelLiveAudience.
           The viewer uid is kept stable per channel so a prefetched token
           (signed for that uid) is valid for the later join. */
        var _reelTokenPrefetch = {};
        var _reelViewerUidByChannel = {};
        function _reelViewerUid(channel) {
            if (!_reelViewerUidByChannel[channel]) {
                _reelViewerUidByChannel[channel] = _reelSafeUid(((_us() || {}).id || '') + '-viewer-' + Date.now());
            }
            return _reelViewerUidByChannel[channel];
        }
        function _reelPrefetchViewerToken(channel) {
            if (!channel || typeof window._fetchLiveAgoraToken !== 'function') return null;
            var hit = _reelTokenPrefetch[channel];
            if (hit && (Date.now() - hit.ts) < 5 * 60 * 1000) return hit;
            var entry = { uid: _reelViewerUid(channel), ts: Date.now(), promise: null };
            entry.promise = _reelFetchToken(channel, entry.uid, 'viewer');
            entry.promise.catch(function () { if (_reelTokenPrefetch[channel] === entry) delete _reelTokenPrefetch[channel]; });
            _reelTokenPrefetch[channel] = entry;
            return entry;
        }
        function _reelWarmLiveJoin(channel) {
            try { if (typeof window._empLoadAgora === 'function' && typeof AgoraRTC === 'undefined') window._empLoadAgora(); } catch (eW) {}
            if (channel) _reelPrefetchViewerToken(channel);
        }
        /* touch/mouse down on any live card = the person is about to join; start warming before the click finishes */
        document.addEventListener('pointerdown', function (e) {
            var b = e.target && e.target.closest && e.target.closest('.reels-live-watch-btn');
            if (b && b.dataset && b.dataset.agoraChannel) _reelWarmLiveJoin(b.dataset.agoraChannel);
        }, true);

        /* FIX (2026-11-04 — "typing a comment in the full-screen broadcast,
           the screen is not stable but split"): the watch overlay and the
           comment sheet are position:fixed;inset:0. On Android Chrome the
           on-screen keyboard shrinks only the VISUAL viewport, not the
           layout viewport those fixed layers are sized to, so the page
           pans/splits instead of re-flowing. This pins the overlay's box to
           window.visualViewport (top/left/width/height) and keeps it
           synced on every resize/scroll of that viewport, so the video,
           comment list and input all re-flow inside the visible area.
           Self-cleaning: stops listening once the element leaves the DOM. */
        function _fitOverlayToVisualViewport(el) {
            if (!el || !window.visualViewport) return;
            var vv = window.visualViewport;
            function fit() {
                if (!el.isConnected) {
                    vv.removeEventListener('resize', fit);
                    vv.removeEventListener('scroll', fit);
                    return;
                }
                el.style.right = 'auto';
                el.style.bottom = 'auto';
                el.style.top = vv.offsetTop + 'px';
                el.style.left = vv.offsetLeft + 'px';
                el.style.width = vv.width + 'px';
                el.style.height = vv.height + 'px';
            }
            vv.addEventListener('resize', fit);
            vv.addEventListener('scroll', fit);
            fit();
        }

        function _ensureAgoraSdkLoaded(timeoutMs, _attempt) {
            /* 2026-10-28 (page-load speed): delegate to the single shared loader in index.html (window._empLoadAgora) so the SDK is
               never injected twice and its own retry/blip handling is reused. The original self-contained loader below is kept as
               the fallback if that shared loader is somehow absent. */
            if (typeof window._empLoadAgora === 'function') {
                return window._empLoadAgora(timeoutMs || 45000).then(function (ok) {
                    if (!ok) throw new Error('Live video isn\u2019t available on this device/browser right now \u2014 check your connection and try again.');
                });
            }
            _attempt = _attempt || 1;
            return new Promise(function (resolve, reject) {
                if (typeof AgoraRTC !== 'undefined') { window._agoraAvailable = true; resolve(); return; }
                var settled = false;
                var timer = setTimeout(function () {
                    if (settled) return;
                    settled = true;
                    reject(new Error('Live video is taking too long to load on this connection \u2014 please try again.'));
                }, timeoutMs || 45000);
                var script = document.createElement('script');
                script.crossOrigin = 'anonymous';
                script.addEventListener('load', function () {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    if (typeof AgoraRTC === 'undefined') {
                        window._agoraAvailable = false;
                        reject(new Error('Live video isn\u2019t available on this device/browser right now.'));
                        return;
                    }
                    window._agoraAvailable = true;
                    resolve();
                }, { once: true });
                script.addEventListener('error', function () {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    // FIX (this session \u2014 confirmed via console log on a weak
                    // 4G connection, 2 bars / ~8 K/s: the SDK script tag's
                    // OWN 'error' event was firing, i.e. a genuine one-shot
                    // network failure fetching download.agora.io, not a
                    // timeout). A single blip failing the whole Go Live
                    // attempt with no retry is exactly what turns "one bad
                    // request out of many on a bouncing connection" into
                    // "Go Live doesn't work" from the host's side. Same
                    // "retry once on a transient failure" treatment
                    // app-patch-v35.js already gave sendJoinRequest() for
                    // this identical connection shape \u2014 one retry, short
                    // delay, before actually falling back to local-only.
                    // A connection that's truly unable to reach this host
                    // at all still falls back on the second attempt \u2014 this
                    // only absorbs a blip, it can't fix a dead link.
                    if (_attempt < 2) {
                        setTimeout(function () {
                            _ensureAgoraSdkLoaded(timeoutMs, _attempt + 1).then(resolve, reject);
                        }, 1500);
                        return;
                    }
                    window._agoraAvailable = false;
                    reject(new Error('Live video isn\u2019t available on this device/browser right now \u2014 check your connection and try again.'));
                }, { once: true });
                script.src = 'https://download.agora.io/sdk/release/AgoraRTC_N-4.22.0.js';
                document.head.appendChild(script);
            });
        }

        /* Joins a fresh Agora client as host on channel=streamId, acquires
           mic+camera (HD, falling back to basic quality, mirroring
           app-live.js's own fallback ladder), and publishes. Resolves with
           {agoraUid} on success so the caller can store it on the Firestore
           doc; rejects with a human-readable message on failure (permission
           denied, SDK missing, token fetch failed, etc.) so the composer can
           show a real error instead of silently going live with no video. */
        /* LOCAL CAMERA FALLBACK (this session) — fixes "camera didn't open
           at all" reported when the Agora SDK/CDN (download.agora.io) is
           unreachable from this device/network, even though the dashboard's
           TikTok-style Go Live feature (app-live.js) still opens the camera
           fine on the exact same connection. Root cause: app-live.js's
           initAgoraHost() NEVER lets an Agora failure block the camera —
           it catches the failure and falls straight back to a plain
           `getUserMedia({video:true,audio:true})` local preview (see its
           own `_localFallbackStream`), so the host always sees their own
           camera even when Agora can't be reached; only remote viewers are
           affected. This function used to have no equivalent: an SDK-load
           or join failure threw straight out of the whole function, so the
           camera was never even requested. Ported the exact same fallback
           here. */
        async function _localCameraFallback() {
            if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
                throw new Error('Camera/microphone permission is needed to go live — allow access and try again.');
            }
            var stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            } catch (e) {
                throw new Error('Camera/microphone permission is needed to go live — allow access and try again.');
            }
            _reelLocalFallbackStream = stream;
            _notify('Live video service is unreachable right now — broadcasting your camera locally. Viewers on other networks may not see video until this clears up.', 'warning');
            return { agoraUid: null, localOnly: true };
        }

        async function _startNativeAgoraHost(streamId, uid) {
            _reelHostFacingMode = 'user'; // every fresh broadcast starts on the front camera
            if (!window._agoraAvailable || typeof AgoraRTC === 'undefined') {
                try {
                    await _ensureAgoraSdkLoaded(45000); // one real retry before giving up — see comment above
                } catch (eSdk) {
                    // DIAGNOSTIC (this session — "Go Live always shows the
                    // local-only warning"): this branch, the missing-token-
                    // function branch right below, and the join try/catch
                    // further down are the ONLY three places that produce
                    // that exact warning, and all three used to fall back
                    // silently — no console line said which of the three
                    // actually fired. app-live.js's own initAgoraHost()
                    // already logs its equivalent join failure
                    // (_agoraWarn('Host init error: ' + err.message)); this
                    // brings app-reel.js's host path up to the same
                    // standard so the real cause is visible next time this
                    // is reproduced, instead of guessing at one of three
                    // possibilities from the generic message alone.
                    console.warn('[Reel & Live Broadcast Channel] Agora SDK failed to load — falling back to local-only camera:', eSdk && eSdk.message);
                    return _localCameraFallback(); // SDK/CDN unreachable — camera still opens, see comment above
                }
            }
            if (typeof window._fetchLiveAgoraToken !== 'function') {
                console.warn('[Reel & Live Broadcast Channel] window._fetchLiveAgoraToken is not defined (app-live.js may not have loaded/run yet) — falling back to local-only camera.');
                return _localCameraFallback();
            }
            try {
                _reelAgoraHostClient = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
                await _reelAgoraHostClient.setClientRole('host');

                var tokenRes = await _reelFetchToken(streamId, uid, 'host');
                var appId = tokenRes.appId || window._liveAgoraAppId();
                var joinUid = (tokenRes.uid !== undefined && tokenRes.uid !== null) ? tokenRes.uid : uid;
                try {
                    await _reelAgoraHostClient.join(appId, streamId, tokenRes.token, joinUid);
                } catch (eJoin1) {
                    // 2026-11-04: one fresh-token retry before giving up to the local-only fallback
                    console.warn('[Reel & Live Broadcast Channel] Agora host join failed, retrying once:', eJoin1 && eJoin1.message);
                    await new Promise(function (r) { setTimeout(r, 1500); });
                    tokenRes = await _reelFetchToken(streamId, uid, 'host');
                    joinUid = (tokenRes.uid !== undefined && tokenRes.uid !== null) ? tokenRes.uid : uid;
                    await _reelAgoraHostClient.join(tokenRes.appId || appId, streamId, tokenRes.token, joinUid);
                }
            } catch (eJoin) {
                console.warn('[Reel & Live Broadcast Channel] Agora host join failed — falling back to local-only camera:', eJoin && eJoin.message, eJoin);
                try { if (_reelAgoraHostClient) await _reelAgoraHostClient.leave(); } catch (eLeave) {}
                _reelAgoraHostClient = null;
                return _localCameraFallback(); // Agora reachable-but-failing (gateway/token/network) — same fallback
            }

            var micTrack = null, camTrack = null;
            try {
                var tracks = await AgoraRTC.createMicrophoneAndCameraTracks(
                    { AEC: true, ANS: true, AGC: true },
                    { facingMode: 'user', encoderConfig: { width: 640, height: 480, frameRate: 24, bitrateMin: 400, bitrateMax: 1000 } }
                );
                micTrack = tracks[0]; camTrack = tracks[1];
            } catch (e1) {
                try {
                    var tracks2 = await AgoraRTC.createMicrophoneAndCameraTracks({ AEC: true, ANS: true, AGC: true, encoderConfig: 'high_quality' });
                    micTrack = tracks2[0]; camTrack = tracks2[1];
                } catch (e2) {
                    try { await _reelAgoraHostClient.leave(); } catch (eLeave) {}
                    _reelAgoraHostClient = null;
                    throw new Error('Camera/microphone permission is needed to go live — allow access and try again.');
                }
            }
            _reelAgoraHostTracks.mic = micTrack;
            _reelAgoraHostTracks.cam = camTrack;
            await _reelAgoraHostClient.publish([micTrack, camTrack]);
            return { agoraUid: joinUid };
        }

        /* FIX (this session — "live stream does not display in the guest/
           viewer/recipient section... broadcast is no longer available"):
           a host who fell into _localCameraFallback() above (Agora
           unreachable at the exact moment they tapped Go Live) previously
           stayed unwatchable by anyone else for the ENTIRE broadcast, even
           if the connection recovered 10 seconds later — nothing ever
           re-attempted Agora once the fallback kicked in. That's the
           direct cause of "viewers can't see it" / the dead-end "no
           longer available" tap: docData.agoraChannel simply never got
           written for the rest of the session. This retries in the
           background (spaced out, capped) and, the moment Agora is
           reachable again, swaps the local getUserMedia stream out for a
           real published Agora track and updates the Firestore doc —
           turning the broadcast watchable without the host needing to end
           and restart (which the feature request explicitly asked to
           avoid: "should remain available until the host ends the
           session"). Purely additive: does not touch _startNativeAgoraHost
           or the initial go-live flow above, only what happens AFTER a
           local-only session is already running. */
        var _reelUpgradeRetryTimer = null;
        var _reelUpgradeAttempts = 0;
        var REEL_UPGRADE_MAX_ATTEMPTS = 20; // ~10 tries, spaced below — stops retrying forever on a genuinely dead connection

        function _armReelAgoraUpgradeRetry(streamId, uid) {
            _reelUpgradeAttempts = 0;
            clearTimeout(_reelUpgradeRetryTimer);
            function scheduleNext() {
                clearTimeout(_reelUpgradeRetryTimer);
                if (_reelUpgradeAttempts >= REEL_UPGRADE_MAX_ATTEMPTS) return;
                /* 2026-11-04: fast ladder (3s, 6s, 10s, then every 15s) instead of a flat 20s, so a viewer isn't left on "Connecting…" for minutes after a one-off failure at Go Live. */
                var _ladder = [3000, 6000, 10000];
                _reelUpgradeRetryTimer = setTimeout(attempt, _reelUpgradeAttempts < _ladder.length ? _ladder[_reelUpgradeAttempts] : 15000);
            }
            function attempt() {
                var session = window._empReelLiveSession;
                // Session ended, or a different broadcast started, or this
                // one already upgraded (agoraChannel present) — stop.
                if (!session || session.streamId !== streamId || (session.docData && session.docData.agoraChannel)) return;
                _reelUpgradeAttempts++;
                if (!window._agoraAvailable || typeof AgoraRTC === 'undefined' || typeof window._fetchLiveAgoraToken !== 'function') {
                    // 2026-11-04: actively try to load the SDK again instead of only waiting for it to appear
                    _ensureAgoraSdkLoaded(30000).catch(function () {}).then(scheduleNext);
                    return;
                }
                var newClient = null;
                (async function () {
                    try {
                        newClient = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
                        await newClient.setClientRole('host');
                        var tokenRes = await _reelFetchToken(streamId, uid, 'host');
                        var appId = tokenRes.appId || window._liveAgoraAppId();
                        var joinUid = (tokenRes.uid !== undefined && tokenRes.uid !== null) ? tokenRes.uid : uid;
                        await newClient.join(appId, streamId, tokenRes.token, joinUid);

                        /* 2026-11-04: the local-only fallback still HOLDS the camera/mic. On Android a second capture
                           of the same camera usually fails (NotReadableError), which is why the old upgrade never
                           succeeded. Re-use the live fallback tracks as Agora custom tracks instead; only open fresh
                           device tracks when there is no live fallback stream to reuse. */
                        var usedCustom = false;
                        var tracks;
                        var _fs = _reelLocalFallbackStream;
                        var _vt = _fs && _fs.getVideoTracks()[0];
                        var _at = _fs && _fs.getAudioTracks()[0];
                        if (_vt && _at && _vt.readyState === 'live' && _at.readyState === 'live'
                            && typeof AgoraRTC.createCustomVideoTrack === 'function' && typeof AgoraRTC.createCustomAudioTrack === 'function') {
                            tracks = [
                                AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: _at }),
                                AgoraRTC.createCustomVideoTrack({ mediaStreamTrack: _vt })
                            ];
                            usedCustom = true;
                        } else {
                            tracks = await AgoraRTC.createMicrophoneAndCameraTracks(
                                { AEC: true, ANS: true, AGC: true },
                                { facingMode: _reelHostFacingMode || 'user', encoderConfig: { width: 640, height: 480, frameRate: 24, bitrateMin: 400, bitrateMax: 1000 } }
                            );
                        }
                        await newClient.publish([tracks[0], tracks[1]]);

                        // Real Agora publish is live — retire the local-only
                        // fallback stream/tracks and hand control over to
                        // the same module-level vars _startNativeAgoraHost
                        // itself uses, so the existing mic/cam toggle
                        // handlers keep working exactly as if this had
                        // succeeded on the very first attempt.
                        // When the fallback tracks were re-used as custom tracks they must keep running (and the
                        // stream ref stays set so _stopNativeAgoraHost still stops the camera at the end).
                        if (_reelLocalFallbackStream && !usedCustom) {
                            try { _reelLocalFallbackStream.getTracks().forEach(function (t) { t.stop(); }); } catch (eStop) {}
                            _reelLocalFallbackStream = null;
                        }
                        _reelAgoraHostClient = newClient;
                        _reelAgoraHostTracks.mic = tracks[0];
                        _reelAgoraHostTracks.cam = tracks[1];
                        // Re-render the host's own preview onto the real track.
                        var frame = document.getElementById('reels-live-host-local-video');
                        if (frame) { frame.innerHTML = ''; try { tracks[1].play('reels-live-host-local-video'); } catch (ePlay) {} }

                        if (window._firebaseLoaded && window.fbDb) {
                            await window.fbDb.collection('reel_live_broadcasts').doc(streamId).update({
                                agoraChannel: streamId,
                                agoraUid: joinUid
                            });
                        }
                        if (session.docData) { session.docData.agoraChannel = streamId; session.docData.agoraUid = joinUid; }
                        _notify('Your live video is now reachable by remote viewers.', 'success');
                        // Upgraded — nothing left to retry.
                    } catch (eUpgrade) {
                        if (newClient) { try { await newClient.leave(); } catch (eLeave) {} }
                        scheduleNext();
                    }
                })();
            }
            scheduleNext();
        }

        async function _stopNativeAgoraHost() {
            try { if (_reelAgoraHostTracks.mic) { _reelAgoraHostTracks.mic.stop(); _reelAgoraHostTracks.mic.close(); } } catch (e) {}
            try { if (_reelAgoraHostTracks.cam) { _reelAgoraHostTracks.cam.stop(); _reelAgoraHostTracks.cam.close(); } } catch (e) {}
            _reelAgoraHostTracks = { mic: null, cam: null };
            try { if (_reelAgoraHostClient) await _reelAgoraHostClient.leave(); } catch (e) {}
            _reelAgoraHostClient = null;
            /* Stop the local getUserMedia fallback stream too (see
               _localCameraFallback() above) — otherwise the camera light
               stays on and the next Go Live attempt reuses a dead/detached
               stream, same reasoning as app-live.js's own stopAgoraHost(). */
            try { if (_reelLocalFallbackStream) _reelLocalFallbackStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
            _reelLocalFallbackStream = null;
        }

        /* ── VIEWER: join a native-camera broadcast as audience (2026-08-11)
           ─────────────────────────────────────────────────────────────────
           Mirrors app-live.js's initAgoraViewer() pattern exactly (same
           SDK, same generic /api/agora-token route via
           window._fetchLiveAgoraToken, same 'live'/'vp8' client mode,
           setClientRole('audience'), subscribe on 'user-published') but
           with its OWN client instance/channel/UI, per this feature's
           "shared infrastructure, not a shared session" design (see the
           big comment at the top of the native-broadcast section above).
           videoEl is the <div> the host's video track gets played into;
           onHostVideo(hasVideo) lets the caller toggle a "connecting…"
           placeholder once real video actually starts flowing. */
        function _reelRebindViewer(videoEl, onHostVideo, withAudio) {
            _reelViewerVideoEl = videoEl;
            _reelViewerOnVideo = onHostVideo || null;
            _reelViewerWantAudio = withAudio !== false;
            var hasVideo = false;
            ((_reelAgoraViewerClient && _reelAgoraViewerClient.remoteUsers) || []).forEach(function (u) {
                try {
                    if (u.videoTrack && videoEl) { try { u.videoTrack.stop(); } catch (eS) {} u.videoTrack.play(videoEl); hasVideo = true; }
                    if (u.audioTrack) { if (_reelViewerWantAudio) u.audioTrack.play(); else u.audioTrack.stop(); }
                } catch (eR) { console.warn('[Reel live viewer] rebind:', eR && eR.message); }
            });
            if (onHostVideo) onHostVideo(hasVideo);
        }

        async function _joinReelLiveAudience(agoraChannel, hostAgoraUid, videoEl, onHostVideo, withAudio) {
            withAudio = (withAudio !== false);
            if (_reelViewerChannel === agoraChannel && (_reelViewerJoinPromise || (_reelAgoraViewerClient && _reelAgoraViewerJoined))) {
                if (_reelViewerJoinPromise) await _reelViewerJoinPromise;
                if (_reelAgoraViewerClient && _reelAgoraViewerJoined && _reelViewerChannel === agoraChannel) {
                    _reelRebindViewer(videoEl, onHostVideo, withAudio);
                    return;
                }
            }
            _reelViewerVideoEl = videoEl;
            _reelViewerOnVideo = onHostVideo || null;
            _reelViewerWantAudio = withAudio;
            var p = _joinReelLiveAudienceFresh(agoraChannel, hostAgoraUid);
            _reelViewerJoinPromise = p;
            try { await p; }
            catch (eJ) { if (_reelViewerJoinPromise === p) _reelViewerChannel = null; throw eJ; }
            finally { if (_reelViewerJoinPromise === p) _reelViewerJoinPromise = null; }
        }

        async function _joinReelLiveAudienceFresh(agoraChannel, hostAgoraUid) {
            if (typeof window._fetchLiveAgoraToken !== 'function') {
                throw new Error('Live video service is unavailable right now.');
            }
            /* 2026-11-05: kick off the token request FIRST so it overlaps with the SDK load + teardown below */
            var pre = _reelPrefetchViewerToken(agoraChannel);
            var needSdk = (!window._agoraAvailable || typeof AgoraRTC === 'undefined');
            var sdkP = needSdk ? _ensureAgoraSdkLoaded(45000) : Promise.resolve();
            try { await Promise.all([sdkP, _leaveReelLiveAudience()]); } // leave = in case a previous viewer session wasn't torn down
            catch (e) { throw new Error('Live video isn\u2019t available on this device/browser right now.'); }
            _reelViewerChannel = agoraChannel; // (leave above clears it)
            var uid = pre ? pre.uid : _reelViewerUid(agoraChannel);
            var client = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
            _reelAgoraViewerClient = client;

            /* FIX (2026-11-04 — "from the viewer's side live video does not play"):
               (1) the user-published listener used to be attached only AFTER
               join() resolved, so a host who was already publishing could be
               missed; it is now attached BEFORE join, and anything already
               published is subscribed explicitly right after join.
               (2) the host-uid filter silently dropped the stream whenever the
               uid on the doc differed from the uid Agora reported — this is a
               single-publisher channel, so any publisher is the host. */
            async function _subscribeHost(remoteUser, mediaType) {
                try {
                    await client.subscribe(remoteUser, mediaType);
                    if (mediaType === 'video' && _reelViewerVideoEl) {
                        remoteUser.videoTrack.play(_reelViewerVideoEl);
                        if (_reelViewerOnVideo) _reelViewerOnVideo(true);
                    } else if (mediaType === 'audio' && _reelViewerWantAudio) {
                        remoteUser.audioTrack.play();
                    }
                } catch (e) { console.warn('[Reel live viewer] subscribe error:', e && e.message); }
            }
            client.on('user-published', _subscribeHost);
            client.on('user-unpublished', function (remoteUser, mediaType) {
                if (mediaType === 'video' && _reelViewerOnVideo) _reelViewerOnVideo(false);
            });

            var _par = await Promise.all([
                client.setClientRole('audience'),
                pre ? pre.promise : _reelFetchToken(agoraChannel, uid, 'viewer')
            ]);
            var tokenRes = _par[1];
            var appId  = tokenRes.appId || window._liveAgoraAppId();
            var joinUid = (tokenRes.uid !== undefined && tokenRes.uid !== null) ? tokenRes.uid : uid;
            try {
                await client.join(appId, agoraChannel, tokenRes.token, joinUid);
            } catch (eVJoin) {
                console.warn('[Reel live viewer] join failed, retrying once:', eVJoin && eVJoin.message);
                delete _reelTokenPrefetch[agoraChannel]; // cached token may be the problem - get a fresh one
                await new Promise(function (r) { setTimeout(r, 400); });
                tokenRes = await _reelFetchToken(agoraChannel, uid, 'viewer');
                joinUid = (tokenRes.uid !== undefined && tokenRes.uid !== null) ? tokenRes.uid : uid;
                await client.join(tokenRes.appId || appId, agoraChannel, tokenRes.token, joinUid);
            }
            _reelAgoraViewerJoined = true;

            // Catch up on anything the host had already published before this viewer joined.
            (client.remoteUsers || []).forEach(function (u) {
                if (u.hasVideo) _subscribeHost(u, 'video');
                if (u.hasAudio) _subscribeHost(u, 'audio');
            });
        }

        async function _leaveReelLiveAudience() {
            try { if (_reelAgoraViewerClient) await _reelAgoraViewerClient.leave(); } catch (e) {}
            _reelAgoraViewerClient = null;
            _reelAgoraViewerJoined = false;
            _reelViewerChannel = null;
        }

        /* Card-side (small screen) live preview: joins the featured native
           broadcast video-only into #reels-live-card-video. Skips: overlay open
           (it owns the video), the host's own broadcast, YouTube-mode (keeps its
           thumbnail), and a card that is off-screen (saves data on weak links). */
        function _reelRefreshCardPreview() {
            try {
                if (document.getElementById('reels-yt-live-overlay')) return;
                var card = _liveBroadcastCardEl;
                var screenEl = card && card.querySelector('#reels-live-featured-screen');
                var hostSess = window._empReelLiveSession;
                var ch = screenEl && screenEl.getAttribute('data-agora-channel');
                var mine = hostSess && screenEl && hostSess.streamId === screenEl.getAttribute('data-stream-id');
                var onScreen = !!(card && card.isConnected && card.offsetParent !== null && _reelCardInView !== false);
                if (!screenEl || !ch || screenEl.getAttribute('data-youtube-id') || mine || !onScreen) {
                    if (_reelAgoraViewerClient && !mine) _leaveReelLiveAudience();
                    return;
                }
                var videoEl = screenEl.querySelector('#reels-live-card-video');
                if (!videoEl) return;
                if (_reelViewerChannel === ch && _reelAgoraViewerJoined && videoEl.querySelector('video')) return; // already playing here
                _joinReelLiveAudience(ch, screenEl.getAttribute('data-agora-uid'), videoEl, function (hasVideo) {
                    screenEl.classList.toggle('reels-live-card-has-video', !!hasVideo);
                }, !_reelCardMuted).catch(function (err) {
                    console.warn('[Reel live card preview]', err && err.message);
                });
            } catch (eP) { console.warn('[Reel live card preview]', eP && eP.message); }
        }
        var _reelCardInView = true;
        /* 2026-11-08: small-screen audio. On by default; the speaker button on the card mutes it. Browsers can block
           audio until the page has had a tap, so the first touch anywhere re-starts any audio that was blocked. */
        var _reelCardMuted = false;
        function _reelSyncSoundBtn() {
            var b = document.querySelector('#reels-live-featured-screen .reels-live-mini-sound');
            if (!b) return;
            b.classList.toggle('muted', _reelCardMuted);
            var i = b.querySelector('i');
            if (i) i.className = _reelCardMuted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
        }
        function _reelResumeViewerAudio() {
            if (!_reelViewerWantAudio || !_reelAgoraViewerClient) return;
            ((_reelAgoraViewerClient.remoteUsers) || []).forEach(function (u) {
                try { if (u.audioTrack && !u.audioTrack.isPlaying) u.audioTrack.play(); } catch (eA) {}
            });
        }
        ['pointerdown', 'touchend', 'click'].forEach(function (ev) {
            document.addEventListener(ev, _reelResumeViewerAudio, { passive: true, capture: true });
        });
        var _reelCardIO = null;
        function _reelArmCardPreviewObserver() {
            if (_reelCardIO || !_liveBroadcastCardEl || typeof IntersectionObserver === 'undefined') return;
            _reelCardIO = new IntersectionObserver(function (entries) {
                var vis = entries.some(function (en) { return en.isIntersecting; });
                if (vis === _reelCardInView) return;
                _reelCardInView = vis;
                _reelRefreshCardPreview();
            }, { threshold: 0.2 });
            _reelCardIO.observe(_liveBroadcastCardEl);
        }

        /* ── SWITCH CAMERA — toggle to the back camera and back (2026-08-11).
           Two independent paths, matching the two ways this host's camera
           can be flowing (same split every other control in this panel
           already handles):
             - Agora path: the currently-published camTrack has no live
               "flip" API, so this closes it and publishes a brand-new
               camera track opened with the opposite facingMode, then swaps
               it into _reelAgoraHostTracks.cam and re-attaches the preview
               — the same unpublish-old/publish-new shape Agora's own docs
               recommend for a camera switch mid-broadcast.
             - Local fallback path: _reelLocalFallbackStream is a plain
               getUserMedia MediaStream (no Agora involved at all — see
               _localCameraFallback() above), so this re-requests just a
               video track with the opposite facingMode, swaps it into the
               existing stream object in place (removeTrack/addTrack) so
               the already-bound <video srcObject> keeps playing without
               needing to be re-created, and carries the current mic
               track/mute state across untouched. ── */
        async function _switchNativeCamera() {
            if (_reelHostSwitchingCam) return; // ignore rapid double-taps mid-switch
            var nextFacing = (_reelHostFacingMode === 'user') ? 'environment' : 'user';
            var btn = document.getElementById('reels-live-native-switch-cam-btn');

            if (_reelAgoraHostTracks.cam && _reelAgoraHostClient) {
                _reelHostSwitchingCam = true;
                if (btn) btn.disabled = true;
                var wasMuted = document.getElementById('reels-live-native-cam-btn') &&
                    document.getElementById('reels-live-native-cam-btn').dataset.on !== '1';
                try {
                    var newCamTrack = await AgoraRTC.createCameraVideoTrack({
                        facingMode: nextFacing,
                        encoderConfig: { width: 640, height: 480, frameRate: 24, bitrateMin: 400, bitrateMax: 1000 }
                    });
                    var oldCamTrack = _reelAgoraHostTracks.cam;
                    await _reelAgoraHostClient.unpublish([oldCamTrack]);
                    try { oldCamTrack.stop(); oldCamTrack.close(); } catch (eClose) {}
                    if (wasMuted) newCamTrack.setEnabled(false); // carry the mute state across the switch
                    await _reelAgoraHostClient.publish([newCamTrack]);
                    _reelAgoraHostTracks.cam = newCamTrack;
                    var frame = document.getElementById('reels-live-host-local-video');
                    if (frame) newCamTrack.play('reels-live-host-local-video');
                    _reelHostFacingMode = nextFacing;
                } catch (eSwitch) {
                    _notify('Couldn\u2019t switch camera on this device.', 'error');
                    console.warn('[Reel live switch camera]', eSwitch && eSwitch.message);
                } finally {
                    _reelHostSwitchingCam = false;
                    if (btn) btn.disabled = false;
                }
                return;
            }

            if (_reelLocalFallbackStream) {
                _reelHostSwitchingCam = true;
                if (btn) btn.disabled = true;
                try {
                    var newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nextFacing } });
                    var newVideoTrack = newStream.getVideoTracks()[0];
                    var oldVideoTrack = _reelLocalFallbackStream.getVideoTracks()[0];
                    var camMuted = document.getElementById('reels-live-native-cam-btn') &&
                        document.getElementById('reels-live-native-cam-btn').dataset.on !== '1';
                    if (camMuted) newVideoTrack.enabled = false;
                    if (oldVideoTrack) { _reelLocalFallbackStream.removeTrack(oldVideoTrack); oldVideoTrack.stop(); }
                    _reelLocalFallbackStream.addTrack(newVideoTrack);
                    _reelHostFacingMode = nextFacing;
                } catch (eSwitch2) {
                    _notify('Couldn\u2019t switch camera on this device.', 'error');
                    console.warn('[Reel live switch camera]', eSwitch2 && eSwitch2.message);
                } finally {
                    _reelHostSwitchingCam = false;
                    if (btn) btn.disabled = false;
                }
            }
        }

        /* ── Submit: writes DIRECTLY to `reel_live_broadcasts` — its own
           collection, entirely separate from `active_streams`. Two source
           modes (2026-08-11): "native" acquires this device's own camera/mic
           via the reel channel's own dedicated Agora client (see above) —
           the actual in-app broadcasting this channel was missing; "youtube"
           keeps the original YouTube-Live-URL listing behavior unchanged. ── */
        document.addEventListener('submit', function (e) {
            var form = e.target;
            if (!form || form.id !== 'reels-live-connect-form') return;
            e.preventDefault();

            if (_isGuest()) { _notify('Please log in to start a live broadcast.', 'info'); return; }

            /* FIX (2026-08-11 — "insufficient permissions" repeating in the
               console while a broadcast is live): reel_live_broadcasts'
               create/update rules require request.auth != null. Every
               write below (the initial set(), the 20s heartbeat, the Exit
               update, the beforeunload update) was already being attempted
               even when the live Firebase Auth session hadn't attached yet
               — this app's own documented restoreLocalSession()/
               initializeApp() timing gap (see app-auth.js's 2026-08-10 fix
               note) means userState can look "logged in" for a moment
               before window.fbAuth.currentUser is actually set. Writing
               through that gap doesn't just fail once — it fails on EVERY
               heartbeat tick until the tab is closed, which is exactly the
               repeating burst reported. Checking here, before anything is
               written, turns that into one clear message instead. */
            if (!(window.fbAuth && window.fbAuth.currentUser)) {
                _notify('Your session is still connecting — please wait a moment and tap Go Live again.', 'info');
                return;
            }

            if (window._empReelLiveSession) {
                // FIX (2026-08-12 — "after the last fix I was unable to go
                // live"): minimizing (added this session) intentionally
                // keeps window._empReelLiveSession set so the panel can be
                // restored later — but that means it's now possible to
                // still be "live" here without any panel visibly open,
                // which this message didn't account for. Points straight
                // at the fix (tap the card to get back in, then End Live)
                // instead of a generic "exit first" that gives no path
                // forward when there's nothing on screen to exit from.
                _notify('You\u2019re already broadcasting on this channel — tap your live card in the grid to reopen it, then End Live before starting a new one.', 'info');
                _closeComposerModal();
                _openHostLivePanel(window._empReelLiveSession);
                return;
            }

            var modeEl  = document.getElementById('reels-live-broadcast-mode');
            var titleEl = document.getElementById('reels-live-title');
            var catEl   = document.getElementById('reels-live-category');
            var urlEl   = document.getElementById('reels-live-youtube-url');
            var mode     = (modeEl ? modeEl.value : 'native') === 'youtube' ? 'youtube' : 'native';
            var title    = titleEl ? titleEl.value.trim() : '';
            var category = catEl ? catEl.value : 'public';
            var rawUrl   = urlEl ? urlEl.value.trim() : '';

            if (!title) { _notify('Give your broadcast a title.', 'error'); return; }

            var youtubeVideoId = null;
            if (mode === 'youtube') {
                youtubeVideoId = _parseYouTubeId(rawUrl);
                if (!youtubeVideoId) {
                    _notify('Paste a valid YouTube Live URL to go live \u2014 or switch to Camera to broadcast natively.', 'error');
                    return;
                }
            }

            if (!(window._firebaseLoaded && window.fbDb)) {
                _notify('Live broadcasting isn\u2019t ready yet — please try again in a moment.', 'error');
                return;
            }

            var us = _us();
            var streamId = 'reel-live-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            var meta = _catMeta(category);
            var nowIso = new Date().toISOString();

            /* ── Category-specific extras (2026-08-11): built from whichever
               #reels-live-extras-<category> group is currently visible.
               Every field is optional — an empty/blank input just means
               that piece of the extras object is omitted, so the viewer
               overlay simply doesn't render a scoreboard/donate button/
               program note/poll for this broadcast. Nothing here is
               required to go live. Same for both broadcast source modes. */
            var extras = null;
            if (category === 'church') {
                var donationUrl = (document.getElementById('reels-live-donation-url') || {}).value;
                donationUrl = donationUrl ? donationUrl.trim() : '';
                if (donationUrl) extras = { donationUrl: donationUrl };
            } else if (category === 'sports') {
                var teamAEl = document.getElementById('reels-live-team-a');
                var teamBEl = document.getElementById('reels-live-team-b');
                var teamA = (teamAEl && teamAEl.value.trim()) || 'Team A';
                var teamB = (teamBEl && teamBEl.value.trim()) || 'Team B';
                extras = { scoreboard: { teamA: teamA, teamB: teamB, scoreA: 0, scoreB: 0 } };
            } else if (category === 'tv') {
                var noteEl = document.getElementById('reels-live-program-note');
                var note = noteEl ? noteEl.value.trim() : '';
                if (note) extras = { programNote: note };
            } else if (category === 'public') {
                var qEl = document.getElementById('reels-live-poll-question');
                var o1El = document.getElementById('reels-live-poll-opt-1');
                var o2El = document.getElementById('reels-live-poll-opt-2');
                var q = qEl ? qEl.value.trim() : '';
                var o1 = o1El ? o1El.value.trim() : '';
                var o2 = o2El ? o2El.value.trim() : '';
                if (q && o1 && o2) {
                    extras = { poll: { question: q, options: [
                        { text: o1, votes: 0 },
                        { text: o2, votes: 0 }
                    ], voterIds: [] } };
                }
            }

            var docData = {
                streamId:        streamId,
                title:           title,
                channelCategory: category,
                broadcastMode:   mode,
                hostId:          us.id || '',
                hostName:        us.name || us.username || 'Broadcaster',
                hostUsername:    us.username || '',
                hostAvatar:      us.avatar || us.profilePic || '',
                origin:          'reels',
                startedAt:       nowIso,
                lastHeartbeat:   nowIso,
                isLive:          true
            };
            if (mode === 'youtube') docData.youtubeVideoId = youtubeVideoId;
            if (extras) docData.extras = extras;

            /* FIX (2026-08-11 — duplicate avatar cards in the Reels live
               strip / dashboard banner): nothing ever marked a host's
               PREVIOUS reel_live_broadcasts doc as ended when they started
               a new one (e.g. testing "Go Live Now" more than once, or the
               app closing without the host tapping "End Broadcast"). Each
               attempt got its own streamId, and since _isFresh() treats
               anything with a recent heartbeat/startedAt as live, several
               of that SAME host's old docs could all still read as "live"
               at once — rendering one avatar per doc instead of one per
               host. Best-effort, fire-and-forget: end any of this host's
               other still-live docs right before publishing the new one.
               (_renderLiveStrip below also dedupes defensively by hostId,
               so any doc this cleanup misses — e.g. an offline write — still
               can't produce more than one visible avatar.) */
            function _endOtherLiveDocsForHost() {
                // FIX (2026-08-12 — "indicator appearing multiple times"):
                // this used to bail out completely whenever us.id was blank
                // (a guest, or a session where the custom identity hadn't
                // finished attaching yet at the moment "Go Live" was
                // tapped) — every prior attempt's doc was left isLive:true
                // in Firestore forever, each rendering its own duplicate
                // avatar. Falls back to hostUsername so those sessions'
                // stale docs still get closed out server-side instead of
                // only being hidden client-side (see the render-time dedup
                // fallback below, which is the last line of defense if
                // neither identity field is available at all).
                var idField = us.id ? 'hostId' : (us.username ? 'hostUsername' : null);
                var idValue = us.id || us.username;
                if (!idField || !idValue) return Promise.resolve();
                return window.fbDb.collection('reel_live_broadcasts')
                    .where(idField, '==', idValue)
                    .where('isLive', '==', true)
                    .get()
                    .then(function (snap) {
                        if (!snap || snap.empty) return;
                        var batch = window.fbDb.batch();
                        snap.forEach(function (doc) {
                            if (doc.id !== streamId) batch.update(doc.ref, { isLive: false });
                        });
                        return batch.commit();
                    })
                    .catch(function (err) {
                        console.warn('[Reel live] cleanup of old broadcasts failed:', err && err.message);
                    });
            }

            function _writeAndOpen() {
                return _endOtherLiveDocsForHost().then(function () {
                return window.fbDb.collection('reel_live_broadcasts').doc(streamId).set(docData).then(function () {
                    _closeComposerModal();
                    form.reset();
                    _setBroadcastMode('native');

                    var _heartbeatFailStreak = 0;
                    var heartbeatTimer = setInterval(function () {
                        window.fbDb.collection('reel_live_broadcasts').doc(streamId)
                            .update({ lastHeartbeat: new Date().toISOString() })
                            .then(function () { _heartbeatFailStreak = 0; })
                            .catch(function (err) {
                                _heartbeatFailStreak++;
                                /* CIRCUIT BREAKER (2026-08-11): a failing
                                   heartbeat used to retry silently forever,
                                   every 20s, for the rest of the broadcast
                                   — the actual source of the "repeated"
                                   permission-denied bursts seen in the
                                   console. Three strikes and it stops
                                   retrying and says so once, instead of
                                   spamming indefinitely. The broadcast
                                   itself keeps running either way — this
                                   only governs the "still alive" heartbeat
                                   the strip's staleness check reads. */
                                if (_heartbeatFailStreak >= 3) {
                                    clearInterval(heartbeatTimer);
                                    console.warn('[Reel live heartbeat] stopped after repeated failures —', err && err.message);
                                    _notify('Your connection to the live channel is having trouble — your broadcast may drop off the "Live Now" list soon.', 'warning');
                                }
                            });
                    }, 20000);

                    window._empReelLiveSession = { streamId: streamId, heartbeatTimer: heartbeatTimer, docData: docData };
                    _openHostLivePanel(window._empReelLiveSession);
                    _notify(meta.label + ' is now live!', 'success');
                }).catch(function (err) {
                    if (mode === 'native') _stopNativeAgoraHost(); // don't leave camera/mic publishing to a channel with no Firestore doc behind it
                    _notify('Couldn\u2019t start the broadcast — please try again.', 'error');
                    console.warn('[Reel & Live Broadcast Channel]', err && err.message);
                });
                }); // FIX (2026-08-12): closes the _endOtherLiveDocsForHost().then( opened above — this was missing entirely, a syntax error that broke the whole file's parsing.
            }

            if (mode === 'native') {
                var submitBtn = document.getElementById('reels-live-connect-submit-btn');
                if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Starting camera…'; }
                var agoraUid = _reelSafeUid(us.id);
                _startNativeAgoraHost(streamId, agoraUid).then(function (res) {
                    /* FIX (2026-08-11 — "tapping a live camera broadcast
                       shows nothing / no longer available"): this used to
                       set docData.agoraChannel = streamId UNCONDITIONALLY,
                       even when _startNativeAgoraHost() fell back to
                       _localCameraFallback() (Agora unreachable — host's
                       OWN camera still opens locally via plain
                       getUserMedia, but nothing is actually published to
                       any Agora channel). Viewers were then handed a
                       channel name to join that had no publisher on it at
                       all — worse than not offering a watch button, since
                       it looked joinable but silently showed nothing.
                       Only advertise agoraChannel to viewers when a real
                       Agora publish happened (res.localOnly is not set). */
                    if (!res.localOnly) {
                        docData.agoraChannel = streamId;
                        docData.agoraUid = res.agoraUid;
                    }
                    _writeAndOpen();
                    if (res.localOnly) {
                        // Background retry so this broadcast stops being a
                        // dead end for viewers the moment Agora becomes
                        // reachable again — see _armReelAgoraUpgradeRetry's
                        // own header comment for the full reasoning.
                        _armReelAgoraUpgradeRetry(streamId, agoraUid);
                    }
                }).catch(function (err) {
                    _notify(err && err.message ? err.message : 'Couldn\u2019t start the camera broadcast.', 'error');
                }).finally(function () {
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-broadcast-tower"></i> Go Live Now'; }
                });
            } else {
                _writeAndOpen();
            }
        });

        /* ── Ends the current device's broadcast: stops the heartbeat and
           deletes the reel_live_broadcasts doc so the strip drops it
           immediately for every viewer (rather than waiting out the
           staleness window). ── */
        function _endHostBroadcast(session) {
            /* FIX (2026-11-05 — "clicking End Live should end the live
               streaming"): this used to (1) return silently when
               window._empReelLiveSession was empty, leaving the panel open and
               the broadcast live, (2) tear the UI down only AFTER nothing was
               guaranteed, and (3) swallow a failed Firestore update, so the
               card stayed on every viewer's dashboard. Now the UI/camera/
               heartbeat are torn down first and unconditionally, the card is
               dropped locally at once, and the Firestore end is retried as a
               delete if the update is refused. */
            session = session || window._empReelLiveSession || null;
            var streamId = session && session.streamId;
            if (session && session.heartbeatTimer) clearInterval(session.heartbeatTimer);
            clearTimeout(_reelUpgradeRetryTimer); // stop any pending Agora-upgrade retry for this (now-ended) broadcast
            /* camera/mic/Agora host client: stop whenever anything is still open, not only when docData says native */
            if ((session && session.docData && session.docData.broadcastMode === 'native') || _reelAgoraHostClient || _reelLocalFallbackStream || _reelAgoraHostTracks.cam || _reelAgoraHostTracks.mic) {
                _stopNativeAgoraHost(); // leave the Agora channel + close mic/camera tracks (viewers see the host drop immediately)
            }
            window._empReelLiveSession = null;
            var panel = document.getElementById('reels-live-host-panel-overlay');
            if (panel) panel.remove();
            document.body.classList.remove('modal-open');
            if (streamId && typeof window._empReelStripDrop === 'function') window._empReelStripDrop(streamId); // card disappears from Reels + home dashboard right away

            if (window._firebaseLoaded && window.fbDb) {
                var col = window.fbDb.collection('reel_live_broadcasts');
                var endedAt = new Date().toISOString();
                function _endDoc(id) {
                    return col.doc(id).update({ isLive: false, endedAt: endedAt }).catch(function () {
                        return col.doc(id).delete().catch(function (err) { console.warn('[Reel live end]', err && err.message); });
                    });
                }
                if (streamId) {
                    _endDoc(streamId);
                } else {
                    /* no session in memory (page was reloaded mid-broadcast, etc.): end any live doc this account still owns */
                    var myId = (_us() || {}).id;
                    if (myId) {
                        col.where('hostId', '==', myId).where('isLive', '==', true).get().then(function (snap) {
                            snap.forEach(function (d) {
                                if (typeof window._empReelStripDrop === 'function') window._empReelStripDrop(d.id);
                                _endDoc(d.id);
                            });
                        }).catch(function () {});
                    }
                }
            }
        }
        /* Best-effort: if the host closes/refreshes the tab instead of
           tapping Exit, at least try to mark the broadcast over so it
           doesn't linger as a dead "LIVE" card for the full staleness
           window. Not guaranteed to complete (browsers may kill the
           request mid-flight), which is exactly why the heartbeat
           staleness check in _isFresh() below still exists as a backstop. */
        window.addEventListener('beforeunload', function () {
            var s = window._empReelLiveSession;
            if (s && window._firebaseLoaded && window.fbDb) {
                window.fbDb.collection('reel_live_broadcasts').doc(s.streamId).update({ isLive: false }).catch(function () {});
            }
        });

        /* ── Host "You're Live" panel — built fresh each time (mirrors the
           pattern already used for the viewer's YouTube watch overlay
           below). Shows what's actually live plus a prominent, explicitly
           labeled Exit button that ends the broadcast — this is the "exit
           button to exit from the reel go live tab" this session asked
           for. ── */
        function _openHostLivePanel(session) {
            var existing = document.getElementById('reels-live-host-panel-overlay');
            if (existing) existing.remove();
            var meta = _catMeta(session.docData.channelCategory);
            var extras = session.docData.extras || null;
            var isNative = session.docData.broadcastMode === 'native';
            var ov = document.createElement('div');
            ov.id = 'reels-live-host-panel-overlay';
            ov.innerHTML =
                '<div class="reels-live-host-panel-top">'
                    + '<div class="reels-live-host-panel-badge"><i class="fas fa-circle"></i> LIVE</div>'
                    + '<div class="reels-live-host-panel-info">'
                        + '<div class="reels-live-host-panel-title">' + _esc(session.docData.title) + '</div>'
                        + '<div class="reels-live-host-panel-cat"><i class="fas ' + meta.icon + '"></i> ' + _esc(meta.label) + '</div>'
                    + '</div>'
                    + '<button type="button" id="reels-live-host-minimize-btn" class="reels-live-exit-btn" title="Minimize — broadcast keeps running"><i class="fas fa-compress-alt"></i></button>'
                    + '<button type="button" id="reels-live-host-exit-btn" class="reels-live-exit-btn reels-live-end-btn" title="End this broadcast and remove it from the dashboard"><i class="fas fa-circle-stop"></i> End Live</button>'
                + '</div>'
                + '<div class="reels-live-host-panel-frame">'
                    + (isNative
                        ? '<div id="reels-live-host-local-video" class="reels-live-native-frame"></div>'
                            + '<div class="reels-live-native-controls">'
                                + '<button type="button" id="reels-live-native-mic-btn" class="reels-live-native-ctrl-btn" data-on="1">' + _reelsPremiumMicIconSvg(false) + '</button>'
                                + '<button type="button" id="reels-live-native-cam-btn" class="reels-live-native-ctrl-btn" data-on="1"><i class="fas fa-video"></i></button>'
                                + '<button type="button" id="reels-live-native-switch-cam-btn" class="reels-live-native-ctrl-btn" title="Switch to back camera"><i class="fas fa-sync-alt"></i></button>'
                            + '</div>'
                        : '<iframe src="https://www.youtube.com/embed/' + encodeURIComponent(session.docData.youtubeVideoId) + '?autoplay=1&mute=1&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>')
                + '</div>'
                + _hostExtrasHtml(session.docData.channelCategory, extras)
                + '<p class="reels-live-host-panel-note">' + (isNative
                    ? 'You\u2019re broadcasting live from this device\u2019s camera to the Reel &amp; Live Broadcast Channel. Tap Exit to end the broadcast.'
                    : 'You\u2019re broadcasting to the Reel &amp; Live Broadcast Channel. Viewers watch your YouTube Live stream through Empyrean. Tap Exit to end the broadcast.') + '</p>';
            document.body.appendChild(ov);
            document.body.classList.add('modal-open');
            if (isNative && _reelAgoraHostTracks.cam) {
                _reelAgoraHostTracks.cam.play('reels-live-host-local-video');
            } else if (isNative && _reelLocalFallbackStream) {
                /* LOCAL CAMERA FALLBACK (this session) — see
                   _localCameraFallback() above. A plain MediaStream doesn't
                   have Agora's .play(elementId) helper, so build a real
                   <video> element and wire srcObject directly instead,
                   same as app-live.js's own fallback does with
                   host-main-video. */
                var frame = document.getElementById('reels-live-host-local-video');
                if (frame) {
                    var localVid = document.createElement('video');
                    localVid.autoplay = true; localVid.muted = true; localVid.playsInline = true;
                    localVid.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                    localVid.srcObject = _reelLocalFallbackStream;
                    frame.appendChild(localVid);
                    localVid.play().catch(function () {});
                }
            }
        }

        /* Host mic/camera mute toggles — native mode only. Simple
           setEnabled() flip on the already-published track (same call
           app-live.js's own mic/camera toggle uses), no republish needed. */
        document.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('#reels-live-native-switch-cam-btn')) {
                _switchNativeCamera();
                return;
            }
            var micBtn = e.target.closest && e.target.closest('#reels-live-native-mic-btn');
            var camBtn = e.target.closest && e.target.closest('#reels-live-native-cam-btn');
            /* LOCAL FALLBACK (this session): _reelLocalFallbackStream is a
               plain MediaStream (see _localCameraFallback() above), which
               has no Agora-style .setEnabled() — the equivalent there is
               flipping the raw MediaStreamTrack's own .enabled flag. */
            var fbMicTrack = _reelLocalFallbackStream ? _reelLocalFallbackStream.getAudioTracks()[0] : null;
            var fbCamTrack = _reelLocalFallbackStream ? _reelLocalFallbackStream.getVideoTracks()[0] : null;
            if (micBtn && (_reelAgoraHostTracks.mic || fbMicTrack)) {
                var micOn = micBtn.dataset.on === '1';
                if (_reelAgoraHostTracks.mic) _reelAgoraHostTracks.mic.setEnabled(!micOn);
                // FIX (2026-08-12 — "toggle broken camera icon" / mic silently
                // never actually muting on the local-camera-fallback path):
                // this set the raw track's .enabled to micOn — the CURRENT
                // (pre-toggle) state — instead of its negation, so it was a
                // no-op flip: turning the mic "off" (micOn true) set
                // enabled = true, i.e. left it exactly as it was. The
                // Agora-track branch just above does this correctly
                // (setEnabled(!micOn)); this branch's own comment even says
                // "was on -> now off, and vice versa" while the code did the
                // opposite. Only ever visible on the local fallback (weak
                // connection, no Agora reachable — see _localCameraFallback
                // above), which is exactly the condition in the reported
                // screenshots, and only affected the real track — the
                // button's own icon/label always flipped correctly, which
                // is what made it look like a UI bug ("broken icon") rather
                // than the dead mute it actually was.
                else if (fbMicTrack) fbMicTrack.enabled = !micOn;
                micBtn.dataset.on = micOn ? '0' : '1';
                micBtn.classList.toggle('muted', micOn);
                // FIX (2026-08-12 — "replace the mic icon with the premium
                // icon"): swapped the plain Font Awesome fa-microphone /
                // fa-microphone-slash glyph for a self-contained inline SVG
                // matching the requested reference icon (dark rounded-
                // square badge, white gradient mic glyph, diagonal slash
                // when muted) — see #reels-live-native-mic-btn's dedicated
                // CSS a few hundred lines below for the badge styling. Inline
                // SVG also means this glyph no longer depends on the
                // Font-Awesome webfont having finished loading over
                // whatever connection is available, unlike the other two
                // buttons here.
                micBtn.innerHTML = _reelsPremiumMicIconSvg(/* muted= */ micOn);
            }
            if (camBtn && (_reelAgoraHostTracks.cam || fbCamTrack)) {
                var camOn = camBtn.dataset.on === '1';
                if (_reelAgoraHostTracks.cam) _reelAgoraHostTracks.cam.setEnabled(!camOn);
                // Same inverted-flag bug as the mic branch above, same fix.
                else if (fbCamTrack) fbCamTrack.enabled = !camOn;
                camBtn.dataset.on = camOn ? '0' : '1';
                camBtn.classList.toggle('muted', camOn);
                camBtn.innerHTML = '<i class="fas ' + (camOn ? 'fa-video-slash' : 'fa-video') + '"></i>';
            }
        });

        /* Inline SVG mic glyph matching the requested "premium" reference
           icon — dark rounded-square badge (handled by CSS on
           #reels-live-native-mic-btn) + a white capsule-mic glyph, with a
           diagonal slash through it when muted. Kept as one small function
           since it's built twice: once for the button's initial HTML
           (_openHostLivePanel) and once on every toggle above. No <defs>/
           gradient ids inside it on purpose — this can render more than
           once in the DOM at a time (e.g. mid-transition), and duplicate
           SVG element ids on a page silently break whichever copy loses. */
        function _reelsPremiumMicIconSvg(muted) {
            return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">'
                + '<path d="M12 3.5a2.5 2.5 0 0 1 2.5 2.5v5.5a2.5 2.5 0 0 1-5 0V6a2.5 2.5 0 0 1 2.5-2.5Z" fill="#fff"/>'
                + '<path d="M7 11a5 5 0 0 0 10 0" stroke="#fff" stroke-width="1.8" stroke-linecap="round" fill="none"/>'
                + '<line x1="12" y1="16" x2="12" y2="19" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>'
                + '<line x1="8.5" y1="19.5" x2="15.5" y2="19.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>'
                + (muted ? '<line x1="4.5" y1="4.5" x2="19.5" y2="19.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>' : '')
                + '</svg>';
        }


        /* ── Host-side control strip for whichever extra this category has
           (2026-08-11). Sports gets live +1 score buttons (the only extra
           that needs a HOST control — donation link/program note are
           display-only for viewers, and a poll's votes come from viewers,
           not the host). Returns '' for categories/extras with nothing for
           the host to control. */
        function _hostExtrasHtml(category, extras) {
            if (category === 'sports' && extras && extras.scoreboard) {
                var sb = extras.scoreboard;
                return '<div class="reels-live-host-scoreboard">'
                    + '<div class="reels-live-host-scoreboard-team">'
                        + '<span>' + _esc(sb.teamA) + '</span>'
                        + '<span class="reels-live-host-score-val" id="reels-live-host-score-a">' + sb.scoreA + '</span>'
                        + '<button type="button" class="reels-live-score-btn" data-team="A" data-delta="1">+1</button>'
                        + '<button type="button" class="reels-live-score-btn" data-team="A" data-delta="-1">-1</button>'
                    + '</div>'
                    + '<div class="reels-live-host-scoreboard-team">'
                        + '<span>' + _esc(sb.teamB) + '</span>'
                        + '<span class="reels-live-host-score-val" id="reels-live-host-score-b">' + sb.scoreB + '</span>'
                        + '<button type="button" class="reels-live-score-btn" data-team="B" data-delta="1">+1</button>'
                        + '<button type="button" class="reels-live-score-btn" data-team="B" data-delta="-1">-1</button>'
                    + '</div>'
                + '</div>';
            }
            if (category === 'public' && extras && extras.poll) {
                return '<p class="reels-live-host-panel-note" style="padding-top:0;">Poll live: "' + _esc(extras.poll.question) + '" — viewers can vote from the watch overlay; results update there in real time.</p>';
            }
            return '';
        }

        /* Host score +1/-1 taps — direct Firestore increment on the ONE
           broadcast doc this host is currently running (window._empReelLiveSession),
           so this can never touch anyone else's scoreboard even if two
           sports broadcasts are live on the channel at once. Clamped at 0
           so a stray -1 tap can't send a score negative. */
        document.addEventListener('click', function (e) {
            var btn = e.target.closest && e.target.closest('.reels-live-score-btn');
            if (!btn) return;
            var session = window._empReelLiveSession;
            if (!session || !window._firebaseLoaded || !window.fbDb) return;
            var team = btn.dataset.team === 'A' ? 'scoreA' : 'scoreB';
            var delta = parseInt(btn.dataset.delta, 10) || 0;
            var sb = (session.docData.extras && session.docData.extras.scoreboard) || null;
            if (!sb) return;
            var next = Math.max(0, (sb[team] || 0) + delta);
            sb[team] = next; // keep the local copy in sync so repeated taps compound correctly
            var field = {};
            field['extras.scoreboard.' + team] = next;
            window.fbDb.collection('reel_live_broadcasts').doc(session.streamId).update(field).catch(function () {});
            var valEl = document.getElementById(team === 'scoreA' ? 'reels-live-host-score-a' : 'reels-live-host-score-b');
            if (valEl) valEl.textContent = next;
        });

        document.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('#reels-live-host-exit-btn')) {
                _endHostBroadcast(window._empReelLiveSession);
                return;
            }
            // FIX (2026-08-12 — "click to expand to full screen and insert
            // a minimization button"): the fullscreen host panel opened
            // automatically the moment a broadcast started, but the only
            // way out of it was Exit — which calls _endHostBroadcast and
            // actually ends the stream. There was no way to just step back
            // to the normal grid card while staying live. Minimize tears
            // down only the overlay DOM (no track/heartbeat/Firestore
            // changes — the broadcast keeps running exactly as it was),
            // and leaves window._empReelLiveSession set so the featured
            // grid card's own click handler below can rebuild the exact
            // same panel — with the same live video reattached from the
            // still-live Agora tracks / local fallback stream — the moment
            // the host taps their own card again.
            if (e.target.closest && e.target.closest('#reels-live-host-minimize-btn')) {
                var hostOv = document.getElementById('reels-live-host-panel-overlay');
                if (hostOv) hostOv.remove();
                document.body.classList.remove('modal-open');
                return;
            }
        });

        /* ── "Live Now" strip inside Reels — mirrors app-live.js's own
           _isStreamFresh() staleness rule so a broadcast that's gone quiet
           (host closed the tab, heartbeat stopped) ages out of this strip
           the same way it ages out of the dashboard slider, instead of
           lingering forever as a dead "LIVE" card. ── */
        var HEARTBEAT_STALE_MS = 10 * 60 * 1000;
        function _isFresh(s) {
            if (!s) return false;
            if (s.lastHeartbeat) {
                var age = Date.now() - Date.parse(s.lastHeartbeat);
                return isFinite(age) && age < HEARTBEAT_STALE_MS;
            }
            var started = s.startedAt ? Date.parse(s.startedAt) : 0;
            return started && (Date.now() - started) < (2 * 60 * 1000);
        }

        /* ── "Live Now" card inside the Reels grid (REBUILT — this session):
           previous versions of this feature lived in a separate strip
           (#reels-live-strip) ABOVE the grid and never actually matched
           .reel-card's real dimensions despite comments claiming so (the
           CSS was never actually updated to match — .reels-live-tv-card
           was still a fixed 190px horizontally-scrolling chip). This
           rebuild:
             1. Renders exactly ONE live-broadcast card, reusing the SAME
                .reel-card class the real reel posts use — so it inherits
                #reels-grid-container's real card rules (full width, white
                background, border, etc.) automatically instead of a
                hand-maintained approximation that can drift out of sync
                again.
             2. Is spliced directly INTO #reels-grid-container itself, at
                the midpoint of the real reel posts, and kept there by a
                MutationObserver every time posts are added/removed — so
                it's genuinely in the middle of the feed, not just above
                it.
             3. When more than one broadcast is live at once, they no
                longer stack as separate full-size cards — ONE card is
                shown, with a horizontally-scrollable row of host avatars
                inside it; tapping an avatar swaps which broadcast is
                "featured" in the screen area without leaving the card,
                and tapping the screen opens the watch overlay for
                whichever one is currently featured.
           #reels-live-strip itself is left in the DOM (other code still
           references its id for the highlight-on-arrival behavior) but is
           no longer populated here — see the CSS rule hiding it below. */
        var _liveBroadcastCardEl   = null;
        var _liveBroadcastFresh    = [];
        var _liveGridObserver      = null;
        var _liveRepositioning     = false;
        /* FIX (bug: "engagement buttons make the live card thumbnail
           blink/unstable"): Like/Comment/Gift/Share all write straight to
           this SAME broadcast doc (likeCount, etc.) — see the like/gift
           handlers below. That write echoes right back into THIS file's
           own onSnapshot listener (_watchReelsLiveBroadcasts), which used
           to call the full featured-card rebuild (card.innerHTML = ...,
           see the `else` branch below) on every single snapshot, tearing
           out and recreating the thumbnail (<img>/on-air span) and
           restarting its pulsing "LIVE" badge animation each time — that
           re-mount is what read as "blinking"/"unstable" on every tap.
           This tracks whichever streamId the featured card's screen
           (#reels-live-featured-screen) was last FULLY built for, so a
           snapshot that's still about the SAME featured broadcast can
           patch just the parts that actually change (like count, caption,
           share/gift button data) in place and leave the thumbnail alone
           — a full rebuild only happens when the featured broadcast
           itself changes (new host went live, previous one ended/aged
           out) or nothing has been rendered yet. */
        var _lastFeaturedStreamId  = null;

        function _liveBroadcastScreenInnerHtml(s) {
            var meta = _catMeta(s.channelCategory);
            var screenHtml = s.youtubeVideoId
                ? '<img class="reels-live-tv-frame" src="https://i.ytimg.com/vi/' + _esc(s.youtubeVideoId) + '/hqdefault.jpg" alt="">'
                : '<span class="reels-live-tv-frame reels-live-tv-onair"><i class="fas fa-broadcast-tower"></i></span>';
            var _meMini = (_us() || {}).id || null;
            var _sidAttr = _esc(s.streamId || '');
            var _hnAttr = _esc(s.hostName || 'Broadcaster');
            /* 2026-11-08: live video plays right here on the small card (native broadcasts) */
            var cardVideoHtml = s.youtubeVideoId ? '' : '<div id="reels-live-card-video" class="reels-live-native-frame reels-live-card-video"></div>';
            /* 2026-11-08: engagement ON the small screen, before expanding to full screen */
            var miniHtml = '<div class="reels-live-card-mini-actions">'
                + (s.youtubeVideoId ? '' : '<button type="button" class="reels-live-card-mini-btn reels-live-mini-sound' + (_reelCardMuted ? ' muted' : '') + '" aria-label="Sound"><i class="fas ' + (_reelCardMuted ? 'fa-volume-mute' : 'fa-volume-up') + '"></i></button>')
                /* 2026-11-08: Like/Comment/Gift are NOT duplicated here — they live once, in the engagement row under the screen. Only the sound toggle sits on the video. */
                + '</div>';
            return screenHtml
                + cardVideoHtml
                + miniHtml
                + '<span class="reels-live-tv-badge"><i class="fas fa-circle"></i> LIVE</span>'
                + '<span class="reels-live-tv-cat"><i class="fas ' + meta.icon + '"></i> ' + _esc(meta.label) + '</span>'
                /* FEATURE (2026-08-13 — viewer count indicator): bottom-left,
                   mirrors .reels-live-tv-play's own bottom-right placement.
                   id is safe as a fixed, non-repeated id because this
                   function only ever builds the ONE featured/pinned card's
                   screen (#reels-live-featured-screen) — see this
                   function's two call sites. Starts at whatever
                   s.viewerCount already holds (0 if never set) and is kept
                   live afterward by the extras onSnapshot listener inside
                   _openReelLiveWatchOverlay's caller / _watchReelsLiveBroadcasts
                   below, the same doc-level field that join/leave below
                   increments and decrements. */
                + '<span class="reels-live-tv-viewers" id="reels-live-featured-viewer-count"><i class="fas fa-eye"></i> ' + (s.viewerCount || 0) + '</span>'
                + '<span class="reels-live-tv-play"><i class="fas fa-play"></i></span>';
        }

        function _applyLiveBroadcastScreenAttrs(screenEl, s) {
            screenEl.setAttribute('data-stream-id', s.streamId || '');
            screenEl.setAttribute('data-youtube-id', s.youtubeVideoId || '');
            screenEl.setAttribute('data-agora-channel', s.agoraChannel || '');
            screenEl.setAttribute('data-agora-uid', s.agoraUid != null ? String(s.agoraUid) : '');
            screenEl.setAttribute('data-broadcast-mode', s.broadcastMode || '');
            screenEl.setAttribute('data-title', s.title || 'Live');
            screenEl.setAttribute('data-category', s.channelCategory || 'public');
            screenEl.setAttribute('data-host-name', s.hostName || 'Broadcaster');
            /* GIFTING (this session): the watch overlay's Gift button needs
               to know WHO to credit — s.hostId is already written on every
               broadcast doc (composer submit handler), just never threaded
               onto the card/button before now. */
            screenEl.setAttribute('data-host-id', s.hostId || '');
        }

        /* ADDED 2026-10-06: a slim horizontally-scrollable strip at the TOP of the live broadcast card (before the screen)
           that labels it "Live Broadcast Channel" and lists what's on — one chip per live broadcaster when something is
           live, otherwise the four channel categories. Display-only: a chip just forwards its tap to the matching
           existing avatar button (.live-broadcast-avatar-item), so no new broadcast logic is involved. */
        function _liveStripHtml(list) {
            var chips;
            if (list && list.length) {
                chips = list.map(function (s, i) {
                    var m = _catMeta(s.channelCategory);
                    return '<button type="button" class="reels-live-chip reels-live-chip-on" data-index="' + i + '"><i class="fas ' + m.icon + '"></i> ' + _esc(s.hostName || 'Broadcaster') + '</button>';
                }).join('');
            } else {
                chips = ['church', 'sports', 'tv', 'public'].map(function (c) {
                    var m = _catMeta(c);
                    return '<span class="reels-live-chip"><i class="fas ' + m.icon + '"></i> ' + _esc(m.label) + '</span>';
                }).join('');
            }
            return '<div class="reels-live-tv-strip" id="reels-live-tv-strip">'
                + '<span class="reels-live-tv-strip-label"><i class="fas fa-circle"></i> LIVE BROADCAST CHANNEL</span>'
                + chips + '</div>';
        }

        function _ensureLiveBroadcastCardEl() {
            if (_liveBroadcastCardEl) return _liveBroadcastCardEl;
            var el = document.createElement('div');
            el.id = 'reels-live-broadcast-card';
            el.className = 'reel-card reels-live-tv-card';
            _liveBroadcastCardEl = el;
            return el;
        }

        /* Splices the live card into #reels-grid-container at the midpoint
           of the REAL reel posts (every other .reel-card, i.e. everything
           except this card itself and the empty-state placeholder). Safe
           to call repeatedly/on every grid mutation — a MutationObserver
           re-runs this any time the grid's children change (new reel
           posted, one deleted, initial batch loaded), and the
           _liveRepositioning re-entrancy guard stops that observer from
           reacting to the very insertion this function performs. */
        function _positionLiveBroadcastCard() {
            var grid = _reelGrid();
            var card = _liveBroadcastCardEl;
            if (!grid || !card) return;
            var emptyState = document.getElementById('reels-empty-state');
            var others = Array.prototype.slice.call(grid.children).filter(function (el) {
                return el !== card && el !== emptyState;
            });
            var midIdx   = Math.floor(others.length / 2);
            var refNode  = others.length ? (others[midIdx] || null) : (emptyState || null);
            if (card.parentNode === grid && card.nextSibling === refNode) return; // already correctly placed
            _liveRepositioning = true;
            grid.insertBefore(card, refNode);
            setTimeout(function () { _liveRepositioning = false; }, 0);
        }

        function _armLiveBroadcastGridObserver() {
            var grid = _reelGrid();
            if (!grid || _liveGridObserver) return;
            _liveGridObserver = new MutationObserver(function () {
                if (_liveRepositioning) return;
                _positionLiveBroadcastCard();
            });
            _liveGridObserver.observe(grid, { childList: true });
        }

        /* 2026-11-04 — "general users should be notified when a broadcast goes
           live". The first render after load only SEEDS the known set (someone
           opening the app mid-broadcast already sees the dashboard card — no
           toast storm). After that, any broadcast id not seen before, started
           in the last 3 minutes and not hosted by this user, raises one
           in-app toast + bell entry, plus an OS notification if the tab is in
           the background and permission was granted. Ids are remembered so a
           re-render, heartbeat or reconnect can never notify twice. */
        var _announcedLiveIds = {};
        var _liveAnnounceArmed = false;
        function _announceNewLiveBroadcasts(fresh) {
            try {
                var myId = (_us() || {}).id || null;
                (fresh || []).forEach(function (s) {
                    if (!s || !s.streamId || _announcedLiveIds[s.streamId]) return;
                    _announcedLiveIds[s.streamId] = true;
                    if (!_liveAnnounceArmed) return;
                    if (myId && s.hostId === myId) return;
                    var started = s.startedAt ? Date.parse(s.startedAt) : 0;
                    if (!started || (Date.now() - started) > 3 * 60 * 1000) return;
                    var meta = _catMeta(s.channelCategory);
                    var msg = '\uD83D\uDD34 ' + (s.hostName || 'A broadcaster') + ' is LIVE \u2014 ' + (s.title || meta.label) + ' (' + meta.label + ')';
                    if (typeof window.pushNotification === 'function') window.pushNotification(msg, 'info');
                    else _notify(msg, 'info');
                    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
                        try { new Notification('Live now on Empyrean', { body: msg, icon: '/icon-192.png', tag: 'reel-live-' + s.streamId }); } catch (eN) {}
                    }
                });
                _liveAnnounceArmed = true;
            } catch (eAnn) { console.warn('[Reel live announce]', eAnn && eAnn.message); }
        }

        /* 2026-11-05: the home-page card now renders in its OWN function, called inside try/catch before any Reels-grid work,
           so a problem in the Reels grid (not mounted yet for a visitor who never opened Reels) can never stop the live
           card from appearing/disappearing on the public dashboard. */
        function _renderDashLiveCard(fresh) {
            var dashCard = document.getElementById('dashboard-reel-live-banner-card');
            var dashBanner = document.getElementById('dashboard-reel-live-banner');
            if (dashCard && dashBanner) {
                if (!fresh.length) {
                    dashBanner.innerHTML = '';
                    dashCard.style.display = 'none';
                } else {
                    dashCard.style.display = '';
                    dashBanner.innerHTML = fresh.map(function (s) {
                        var meta = _catMeta(s.channelCategory);
                        var av = s.hostAvatar
                            ? '<img src="' + _esc(s.hostAvatar) + '" alt="">'
                            : '<i class="fas ' + meta.icon + '"></i>';
                        /* 2026-11-04 — tapping a dashboard live card now opens the
                           watch overlay directly (same .reels-live-watch-btn handler
                           the Reels section uses, same data-* attributes as
                           _applyLiveBroadcastScreenAttrs) instead of just navigating
                           to Reels. The overlay is built on <body>, so it works from
                           the home page. */
                        return '<div role="button" tabindex="0" class="reels-live-strip-card dashboard-reel-live-card reels-live-watch-btn"'
                            + ' data-stream-id="' + _esc(s.streamId || '') + '"'
                            + ' data-youtube-id="' + _esc(s.youtubeVideoId || '') + '"'
                            + ' data-agora-channel="' + _esc(s.agoraChannel || '') + '"'
                            + ' data-agora-uid="' + _esc(s.agoraUid != null ? String(s.agoraUid) : '') + '"'
                            + ' data-broadcast-mode="' + _esc(s.broadcastMode || '') + '"'
                            + ' data-title="' + _esc(s.title || 'Live') + '"'
                            + ' data-category="' + _esc(s.channelCategory || 'public') + '"'
                            + ' data-host-name="' + _esc(s.hostName || 'Broadcaster') + '"'
                            + ' data-host-id="' + _esc(s.hostId || '') + '">'
                            + '<span class="dash-live-top">'
                                + '<span class="dash-live-avatar">' + av + '</span>'
                                + '<span class="reels-live-strip-tag"><i class="fas fa-circle"></i> LIVE</span>'
                            + '</span>'
                            + '<span class="reels-live-strip-cat"><i class="fas ' + meta.icon + '"></i> ' + _esc(meta.label) + '</span>'
                            + '<span class="reels-live-strip-title">' + _esc(s.title || 'Live') + '</span>'
                            + '<span class="reels-live-strip-host">' + _esc(s.hostName || 'Broadcaster') + '</span>'
                            + '<a class="dash-live-cta dash-live-join-link" href="' + _esc(_reelJoinLink(s.streamId)) + '" data-stream-id="' + _esc(s.streamId || '') + '"><i class="fas fa-play"></i> Join live</a>'
                            + '</div>';
                    }).join('');
                }
            }
        }

        /* 2026-11-05 — JOIN LINK for the home-page live card. The link is a real
           URL (?joinLive=<streamId>) so it can be tapped, long-pressed/copied or
           shared; a plain tap is intercepted below and opens the broadcast
           without a page reload. Opening such a link on load waits for the
           broadcast to appear in the live list and then joins it; if it has
           already ended the person is told so instead of hitting a dead card. */
        function _reelJoinLink(streamId) {
            var base = window.location.origin + window.location.pathname;
            return base + '?joinLive=' + encodeURIComponent(streamId || '');
        }
        window._empReelJoinLink = _reelJoinLink;
        var _pendingJoinLiveId = null;
        try {
            var _jlParam = new URLSearchParams(window.location.search).get('joinLive');
            if (_jlParam) {
                _pendingJoinLiveId = _jlParam;
                setTimeout(function () {
                    if (_pendingJoinLiveId === _jlParam) {
                        _pendingJoinLiveId = null;
                        _notify('That live broadcast has ended.', 'info');
                    }
                }, 20000);
            }
        } catch (eJl) {}
        function _tryOpenPendingJoinLive(fresh) {
            if (!_pendingJoinLiveId) return;
            for (var i = 0; i < fresh.length; i++) {
                if (fresh[i].streamId === _pendingJoinLiveId) {
                    var s = fresh[i];
                    _pendingJoinLiveId = null;
                    try { history.replaceState(null, '', window.location.pathname + window.location.hash); } catch (eH) {}
                    _openReelLiveWatchOverlay(s.streamId, s.youtubeVideoId || '', s.title || 'Live', s.hostName || 'Broadcaster', s.channelCategory || 'public', s.agoraChannel || '', s.agoraUid != null ? String(s.agoraUid) : '', s.hostId || '');
                    return;
                }
            }
        }

        function _renderLiveStrip(docsById) {
            var fresh = Object.keys(docsById)

                .map(function (k) { return docsById[k]; })
                .filter(_isFresh)
                .sort(function (a, b) { return Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0); });

            /* FIX (2026-08-11 — "indicator showing multiple times"): a host
               restarting "Go Live Now" (or losing connection without
               properly ending the previous broadcast) could leave more than
               one of THEIR OWN docs reading as fresh/live at once (see the
               cleanup added in the composer's submit handler above, which
               stops this happening going forward). This is the defensive
               half — even if a stale duplicate slips through for any
               reason, only the single most-recent broadcast per hostId is
               ever rendered. `fresh` is already sorted newest-first, so
               keeping the FIRST occurrence per hostId is exactly the
               most-recent one. */
            var seenHosts = {};
            fresh = fresh.filter(function (s) {
                // FIX (2026-08-12 — "indicator appearing multiple times"):
                // hostId is blank for any doc written before this device's
                // identity finished attaching (see docData.hostId's
                // `us.id || ''` fallback in the composer submit handler) —
                // falling straight through to streamId meant every such
                // attempt got its own permanently-unique key, so the SAME
                // host's repeated/failed attempts all rendered as separate
                // avatars instead of collapsing into one. hostUsername/
                // hostName are set independently of that identity race, so
                // they're tried first; streamId (never shared between two
                // docs) is now only the last-resort fallback for a
                // broadcast with no identifying info at all.
                var key = s.hostId || s.hostUsername || s.hostName || s.streamId;
                if (seenHosts[key]) return false;
                seenHosts[key] = true;
                return true;
            });

            /* FIX (2026-08-12 — "no screen to watch it", TV/YouTube-style
               broadcast card): the 2026-08-11 redesign above turned this
               into a tiny circular avatar (ring + dot + name) — enough to
               notice a broadcast exists, but nothing that reads as an
               actual live SCREEN the way YouTube's live video cards do.
               Replaced with a real "television" card: a video-frame
               thumbnail (the broadcast's own live frame for YouTube mode,
               a pulsing on-air placeholder for native mode with no
               pre-fetchable still), a pulsing red "● LIVE" badge, a
               category pill, a center watch/play glyph, and — BELOW the
               screen, YouTube-video-card style — the host's channel avatar
               next to the title/host name. Same button classes/data-*
               attributes as before, so the existing .reels-live-watch-btn
               click handler and _openReelLiveWatchOverlay() need no
               changes at all.
               FIX (2026-08-12 — "still no screen at the middle of the reel
               section"): the row used to render nothing at all
               (strip.innerHTML = '') whenever no broadcast was currently
               live, and #reels-live-strip:empty was hidden via CSS — so on
               a normal day with nobody broadcasting, the entire "TV" was
               invisible. A television doesn't disappear when nothing's
               on — it shows a screen, just an idle one. Now the strip
               ALWAYS renders at least one card: every actual live
               broadcast if any are running, otherwise a single "off-air"
               placeholder screen that doubles as the entry point to start
               one (taps straight into the existing #reels-connect-live-btn
               flow — see the click delegate a few lines below — so this
               adds zero new modal/auth logic).
               FIX (2026-08-12 — "same card size as other card"): this was
               still a separate 190px horizontally-scrolling strip, sized
               nothing like the actual reel posts underneath it. Rebuilt to
               reuse the SAME dimensions/skin as .reel-card in the feed
               below — full width, identical border/background, identical
               4:3-capped-at-30vh video-frame box, identical meta-row
               layout (avatar + name/title, matching .reel-meta-avatar/
               .reel-meta-username sizing) — see the .reels-live-tv-card
               CSS rules further down, which now mirror .reel-card's rules
               1:1 instead of defining their own separate small-card look.
               #reels-live-strip itself switched from a horizontal-scroll
               row to a plain vertical stack (same column/gap as
               #reels-grid-container) to match, since a full-width card has
               nothing to scroll sideways through.
               FIX (this session — "middle of the reel section" / "same
               card size" / "avatar scrollable horizontally", the request
               that prompted this rebuild): the two fixes above were only
               ever described in comments — .reels-live-tv-card's actual
               CSS still had a hardcoded 190px width and #reels-live-strip
               was still a horizontal-scroll row ABOVE the grid, not inside
               it. This is the real implementation: ONE .reel-card-classed
               element (_ensureLiveBroadcastCardEl(), created once and
               reused across every re-render so its DOM identity is stable
               for the MutationObserver below), spliced directly into
               #reels-grid-container at the midpoint of the real posts
               (_positionLiveBroadcastCard()) and kept there
               (_armLiveBroadcastGridObserver()) as posts are added/
               removed. Multiple simultaneous broadcasts no longer render
               as separate stacked cards — one "featured" broadcast fills
               the screen area, and every live host gets a circular avatar
               in a horizontally-scrollable strip below it; tapping an
               avatar re-features that broadcast in place (see the
               '.live-broadcast-avatar-item' click handler further down)
               without rebuilding the whole card. */
            _announceNewLiveBroadcasts(fresh);
            _liveBroadcastFresh = fresh;
            /* 2026-11-05: warm the join path (SDK + viewer token) for the newest live card so tapping Join connects fast */
            if (fresh.length && fresh[0].agoraChannel && !(window._empReelLiveSession && window._empReelLiveSession.streamId === fresh[0].streamId)) {
                _reelWarmLiveJoin(fresh[0].agoraChannel);
            }
            _tryOpenPendingJoinLive(fresh);
            try { _renderDashLiveCard(fresh); } catch (eDash) { console.warn('[Reel live dashboard card]', eDash && eDash.message); }
            var card = _ensureLiveBroadcastCardEl();
            card.dataset.createdAt = ''; // never part of the pinnable/orderable reel rotation (see _orderedReelCards exclusion)

            if (!fresh.length) {
                _lastFeaturedStreamId = null; // next time a broadcast goes live, force a full (real) rebuild
                card.classList.add('reels-live-tv-card-idle');
                card.innerHTML = _liveStripHtml([])
                    + '<div class="reel-video-wrap reels-live-tv-screen-wrap reels-live-tv-screen-idle" id="reels-live-tv-idle-card">'
                        + '<span class="reels-live-tv-frame reels-live-tv-offair"><i class="fas fa-tv"></i></span>'
                        + '<span class="reels-live-tv-badge reels-live-tv-badge-idle"><i class="fas fa-circle"></i> OFF AIR</span>'
                    + '</div>'
                    + '<div class="reel-meta-row">'
                        + '<div class="reel-meta-left">'
                            + '<span class="reel-meta-avatar reels-live-tv-avatar-fallback-solo"><i class="fas fa-broadcast-tower"></i></span>'
                            + '<div class="reel-meta-text">'
                                + '<span class="reel-meta-username">No live broadcast right now</span>'
                                + '<span class="reel-meta-time">Tap to start one — Church, Sports, TV or Public</span>'
                            + '</div>'
                        + '</div>'
                    + '</div>';
            } else {
                card.classList.remove('reels-live-tv-card-idle');
                var featured = fresh[0];

                /* PATCH-IN-PLACE PATH — see _lastFeaturedStreamId's own
                   comment above. Still the same featured broadcast as last
                   render and the screen element is actually present (i.e.
                   this isn't the very first live render after an idle
                   state) — update only what a Like/Comment/Gift/Share tap
                   or a routine 30s freshness re-check could actually have
                   changed, and leave #reels-live-featured-screen (the
                   thumbnail + its pulsing LIVE badge) completely untouched
                   so it never blinks/reloads. */
                var existingScreenEl = card.querySelector('#reels-live-featured-screen');
                var _sameStreamStillFeatured = (_lastFeaturedStreamId === featured.streamId && !!existingScreenEl);

                if (_sameStreamStillFeatured) {
                    var stripElInPlace = card.querySelector('#reels-live-tv-strip');
                    if (stripElInPlace) stripElInPlace.outerHTML = _liveStripHtml(fresh);
                    var likeCountElInPlace = card.querySelector('#reels-live-featured-like-count');
                    if (likeCountElInPlace) likeCountElInPlace.textContent = featured.likeCount || 0;
                    var captionElInPlace = card.querySelector('#reels-live-featured-caption');
                    if (captionElInPlace) captionElInPlace.textContent = (featured.title || 'Live') + ' \u2014 ' + (featured.hostName || 'Broadcaster');
                    var shareBtnElInPlace = card.querySelector('#reels-live-featured-share-btn');
                    if (shareBtnElInPlace) {
                        shareBtnElInPlace.dataset.title = featured.title || 'Live';
                        shareBtnElInPlace.dataset.hostName = featured.hostName || 'Broadcaster';
                        shareBtnElInPlace.dataset.category = featured.channelCategory || '';
                    }
                    var giftBtnElInPlace = card.querySelector('.reels-live-tv-engagement-row .reels-live-gift-btn');
                    if (giftBtnElInPlace) giftBtnElInPlace.dataset.hostName = featured.hostName || 'Broadcaster';
                    var commentBtnElInPlace = card.querySelector('.reels-live-card-comment-btn');
                    if (commentBtnElInPlace) commentBtnElInPlace.dataset.hostName = featured.hostName || 'Broadcaster';
                    /* Refresh data-* attrs (agoraChannel/agoraUid can change
                       as a broadcast upgrades from local-camera fallback to
                       real Agora) WITHOUT touching the element's children —
                       setAttribute never causes a repaint/reload the way
                       replacing innerHTML does. */
                    _applyLiveBroadcastScreenAttrs(existingScreenEl, featured);
                } else {
                    _lastFeaturedStreamId = featured.streamId;
                    card.innerHTML = _liveStripHtml(fresh)
                    + '<div class="reel-video-wrap reels-live-tv-screen-wrap reels-live-watch-btn" id="reels-live-featured-screen">'
                        + _liveBroadcastScreenInnerHtml(featured)
                    + '</div>'
                    + '<div class="reel-caption-line reels-live-tv-caption" id="reels-live-featured-caption">' + _esc(featured.title || 'Live') + ' \u2014 ' + _esc(featured.hostName || 'Broadcaster') + '</div>'
                    /* ENGAGEMENT ON THE PINNED CARD (this session — "viewers
                       who prefer not to expand to full screen should still
                       be able to comment, like, share, and send gifts"):
                       this row used to carry Share only — Like/Comment/
                       Gift existed nowhere except inside the fullscreen
                       watch overlay (_openReelLiveWatchOverlay), so a
                       viewer who never tapped into fullscreen had no way
                       to do any of those from the grid. Like/Share/Gift
                       reuse the exact same globally-delegated click
                       handlers the overlay's own buttons already use
                       (.reels-live-card-like-btn is matched alongside
                       #reels-live-watch-like-btn in the shared like
                       handler below; .reels-live-gift-btn/
                       .reels-live-tv-share-btn are already
                       handler-agnostic about WHERE the button lives) —
                       Comment opens the new lightweight
                       _openReelLiveCommentSheet() bottom sheet instead of
                       the fullscreen overlay, so commenting genuinely
                       never requires leaving the grid. */
                    + '<div class="reels-live-tv-share-row reels-live-tv-engagement-row">'
                        + '<button type="button" class="reels-live-tv-share-btn reels-live-card-like-btn" id="reels-live-featured-like-btn" data-stream-id="' + _esc(featured.streamId || '') + '"><i class="far fa-heart"></i> <span id="reels-live-featured-like-count">' + (featured.likeCount || 0) + '</span></button>'
                        + '<button type="button" class="reels-live-tv-share-btn reels-live-card-comment-btn" data-stream-id="' + _esc(featured.streamId || '') + '" data-host-name="' + _esc(featured.hostName || 'Broadcaster') + '"><i class="fas fa-comment-dots"></i> Comment</button>'
                        /* FIX (2026-08-12, REVISED — reverses this same
                           day's earlier "icon-only round button" change
                           just below/above in history. That change chased
                           "consistency" from a vague description; this one
                           follows an explicit reference image the person
                           supplied (a white rounded pill: share icon + bold
                           "Share" label) and asks for every share entry
                           point in this feature to match THAT look instead.
                           This is now also what the row's Like/Comment/Gift
                           siblings already look like (.reels-live-tv-share-btn's
                           own base rule below is already that exact white
                           pill), so dropping the circle-only
                           .reels-live-card-share-btn override also makes
                           this button consistent with its own row again.
                           Keeps the .reels-live-tv-share-btn class so the
                           existing delegated click handler
                           (_shareReelLiveBroadcast) still matches it
                           untouched — only the markup/style changes.
                           ICON (2026-08-12): swapped the fa-share glyph
                           (renders as a plain "↗" per index.html's
                           .fa-share:before override) for the same 3-node
                           share SVG the reel fullscreen viewer's own Share
                           button already uses (.reel-share-btn below) —
                           the exact icon in the person's reference image,
                           and now the same one everywhere Share appears
                           in the Reels feature. stroke="currentColor" so
                           it inherits this pill's own text color. */
                        + '<button type="button" class="reels-live-tv-share-btn" id="reels-live-featured-share-btn" data-stream-id="' + _esc(featured.streamId || '') + '" data-title="' + _esc(featured.title || 'Live') + '" data-host-name="' + _esc(featured.hostName || 'Broadcaster') + '" data-category="' + _esc(featured.channelCategory || '') + '"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share</button>'
                        + (featured.hostId && featured.hostId !== ((_us() || {}).id || null) ?
                            '<button type="button" class="reels-live-tv-share-btn reels-live-gift-btn" data-stream-id="' + _esc(featured.streamId || '') + '" data-host-id="' + _esc(featured.hostId || '') + '" data-host-name="' + _esc(featured.hostName || 'Broadcaster') + '"><i class="fas fa-gift"></i> Gift</button>' : '')
                    + '</div>'
                    + '<div class="reel-meta-row">'
                        + '<div class="live-broadcast-avatar-scroll" id="reels-live-avatar-scroll">'
                            + fresh.map(function (s, i) {
                                var meta = _catMeta(s.channelCategory);
                                var avatarImg = s.hostAvatar
                                    ? '<img src="' + _esc(s.hostAvatar) + '" alt="">'
                                    : '<span class="reels-live-tv-avatar-fallback"><i class="fas ' + meta.icon + '"></i></span>';
                                return '<button type="button" class="live-broadcast-avatar-item' + (i === 0 ? ' active' : '') + '" data-index="' + i + '" aria-label="' + _esc(s.hostName || 'Broadcaster') + '">'
                                    + avatarImg
                                + '</button>';
                            }).join('')
                        + '</div>'
                    + '</div>';
                    var screenEl = card.querySelector('#reels-live-featured-screen');
                    if (screenEl) _applyLiveBroadcastScreenAttrs(screenEl, featured);
                } /* end else (full rebuild) */
            }

            _armLiveBroadcastGridObserver();
            _positionLiveBroadcastCard();
            _reelArmCardPreviewObserver();
            _reelRefreshCardPreview();

            /* HOME/DASHBOARD "LIVE NOW" INDICATOR (this session) — same
               `fresh` list, rendered a second time into the dashboard card
               (#dashboard-reel-live-banner, see index.html) so a live
               church service/match/broadcast is visible from the home page
               too, not only inside the Reels section itself. The whole
               card (#dashboard-reel-live-banner-card) is hidden entirely
               whenever nothing is live, same :empty-driven pattern already
               used for #reels-live-strip. Cards here use
               .dashboard-reel-live-card (their own class, NOT
               .reels-live-watch-btn) and simply navigate into the Reels
               section on tap rather than trying to reopen a watch overlay
               directly from the dashboard — the Reels section already has
               everything needed to watch either mode correctly. */

        }

        function _watchReelsLiveBroadcasts() {
            if (!(window._firebaseLoaded && window.fbDb)) { setTimeout(_watchReelsLiveBroadcasts, 1500); return; }
            var docsById = {};
            var unsub = null, retryTimer = null, attempts = 0;
            /* Its OWN collection — reel_live_broadcasts — never
               active_streams. Matching security rule lives in
               firebase-rules.js (see the Firestore rules note further
               down this file for the full rationale).
               FIX (2026-11-04 — general/guest users not seeing live cards):
               the error callback used to only log, which permanently
               killed the listener. A guest's anonymous Firebase session
               often attaches a moment AFTER this first subscribe, so the
               first attach was denied and never retried — the dashboard card
               stayed empty for exactly the general-public audience. Now an
               error re-attaches with backoff, and any auth-state change
               re-attaches too. */
            function attach() {
                clearTimeout(retryTimer);
                if (unsub) { try { unsub(); } catch (eU) {} unsub = null; }
                unsub = window.fbDb.collection('reel_live_broadcasts')
                    .onSnapshot(function (snap) {
                        if (!snap) return;
                        attempts = 0;
                        snap.docChanges().forEach(function (change) {
                            var s = change.doc.data();
                            if (!s || !s.streamId) return;
                            if (change.type === 'removed' || s.isLive === false) { delete docsById[s.streamId]; }
                            else { docsById[s.streamId] = s; }
                        });
                        _renderLiveStrip(docsById);
                    }, function (err) {
                        console.warn('[Reels live strip]', err && err.message);
                        unsub = null;
                        attempts++;
                        retryTimer = setTimeout(attach, Math.min(30000, 3000 * attempts));
                    });
            }
            attach();
            /* 2026-11-05: lets End Live (host) and the viewer overlay (broadcast ended) remove a card locally,
               immediately, instead of waiting for the Firestore round-trip / 30s freshness timer. */
            window._empReelStripDrop = function (streamId) {
                if (streamId && docsById[streamId]) { delete docsById[streamId]; }
                _renderLiveStrip(docsById);
            };
            try {
                if (window.fbAuth && typeof window.fbAuth.onAuthStateChanged === 'function') {
                    window.fbAuth.onAuthStateChanged(function () { if (!unsub) { attempts = 0; attach(); } });
                }
            } catch (eAuth) {}
            /* Re-check freshness on a timer too, independent of new
               snapshots, so a card whose heartbeat simply stopped arriving
               (rather than the doc being deleted/flagged) still ages out
               of the strip on its own. */
            setInterval(function () { _renderLiveStrip(docsById); }, 30000);
        }
        _watchReelsLiveBroadcasts();

        /* ── Replay archive (2026-08-11): once a broadcast ends,
           _endHostBroadcast() above now marks it isLive:false instead of
           deleting it, so it can be listed here. Reuses the exact same
           YouTube video id/watch overlay/.reels-live-watch-btn click
           handling the live strip already uses — a YouTube Live stream's
           watch URL keeps playing as a normal video once the stream ends,
           so no separate recording/download/storage step is needed to
           make this work. Capped to the most recent 20 so the strip can't
           grow unbounded as more broadcasts end over time. */
        function _renderReplayStrip(docs) {
            var strip = document.getElementById('reels-live-replay-strip');
            if (!strip) return;
            if (!docs.length) { strip.innerHTML = ''; return; }
            /* FIX (2026-08-12): upgraded to the same .reels-live-tv-card
               thumbnail-screen layout as the live strip above (see
               _renderLiveStrip) instead of the old text-only rectangle —
               every replay here always has a youtubeVideoId (see the
               `d.youtubeVideoId` filter in _watchReelsLiveReplays below),
               so there's always a real thumbnail frame to show, same as a
               finished livestream on YouTube's own Live tab. */
            strip.innerHTML = docs.map(function (s) {
                var meta = _catMeta(s.channelCategory);
                return '<button type="button" class="reels-live-tv-card reels-live-watch-btn"'
                    + ' data-stream-id="' + _esc(s.streamId) + '"'
                    + ' data-youtube-id="' + _esc(s.youtubeVideoId || '') + '"'
                    + ' data-title="' + _esc(s.title || 'Replay') + '"'
                    + ' data-category="' + _esc(s.channelCategory || 'public') + '"'
                    + ' data-host-name="' + _esc(s.hostName || 'Broadcaster') + '">'
                    + '<span class="reels-live-tv-screen">'
                        + '<img class="reels-live-tv-frame" src="https://i.ytimg.com/vi/' + _esc(s.youtubeVideoId) + '/hqdefault.jpg" alt="">'
                        + '<span class="reels-live-tv-badge reels-live-tv-badge-replay"><i class="fas fa-play"></i> REPLAY</span>'
                        + '<span class="reels-live-tv-cat"><i class="fas ' + meta.icon + '"></i> ' + _esc(meta.label) + '</span>'
                        + '<span class="reels-live-tv-play"><i class="fas fa-play"></i></span>'
                    + '</span>'
                    + '<span class="reels-live-tv-info">'
                        + '<span class="reels-live-tv-avatar"><span class="reels-live-tv-avatar-fallback"><i class="fas ' + meta.icon + '"></i></span></span>'
                        + '<span class="reels-live-tv-text">'
                            + '<span class="reels-live-tv-title">' + _esc(s.title || 'Replay') + '</span>'
                            + '<span class="reels-live-tv-host">' + _esc(s.hostName || 'Broadcaster') + '</span>'
                        + '</span>'
                    + '</span>'
                    + '</button>';
            }).join('');
        }

        function _watchReelsLiveReplays() {
            if (!(window._firebaseLoaded && window.fbDb)) { setTimeout(_watchReelsLiveReplays, 1500); return; }
            window.fbDb.collection('reel_live_broadcasts')
                .where('isLive', '==', false)
                .orderBy('startedAt', 'desc')
                .limit(20)
                .onSnapshot(function (snap) {
                    if (!snap) return;
                    var docs = [];
                    snap.forEach(function (doc) {
                        var d = doc.data();
                        if (d && d.youtubeVideoId) docs.push(d);
                    });
                    _renderReplayStrip(docs);
                }, function (err) {
                    /* Most likely a missing composite index (isLive + startedAt) the
                       first time this query ever runs — Firestore's error message
                       includes a direct console link to create it. Fails silently
                       here (same tolerance as the live strip listener above) so a
                       missing index degrades to "no replays shown yet" instead of
                       a console error loop. */
                    console.warn('[Reels live replays]', err && err.message);
                });
        }
        _watchReelsLiveReplays();

        /* ── Viewer watch overlay ── */
        var _watchOverlayExtrasUnsub = null;   // extras onSnapshot for whichever broadcast is open
        var _watchOverlayCommentsUnsub = null; // comments onSnapshot for whichever broadcast is open
        /* FEATURE (2026-08-13 — viewer count indicator): streamId -> true
           for every broadcast THIS TAB currently counts itself as watching.
           Needed because minimize (see the minimize click handler below)
           deliberately does NOT tear the overlay/session down — the viewer
           is still watching, just not looking at the overlay right now —
           so re-opening via the watch button again must not increment a
           SECOND time for the same still-open viewing session. Only a real
           Exit (which does tear everything down) clears the flag and
           decrements. */
        var _reelViewerCountedStreams = {};
        /* Comments listener for the lightweight inline sheet opened from the
           pinned/featured grid card's own Comment button (see
           _openReelLiveCommentSheet below) — kept separate from
           _watchOverlayCommentsUnsub above since the whole point of that
           sheet is letting a viewer comment WITHOUT the fullscreen watch
           overlay ever opening, so the two can't just share one variable. */
        var _cardCommentSheetUnsub = null;

        /* ── LIVE COMMENTS (2026-08-11 — "comments in the comments
           section" fix): a lightweight realtime comment thread, shared by
           BOTH watch overlays (YouTube-mode and native-Agora-mode) so
           viewers can talk while they watch, same as any other live
           broadcast platform. Lives in its own Firestore subcollection —
           reel_live_broadcasts/{streamId}/comments (see firebase-rules.js)
           — kept separate from the broadcast doc itself so a burst of
           comments never triggers the strip/extras listeners above to
           re-render. Returns the unsubscribe function; caller is
           responsible for calling it when the overlay closes. */
        function _mountLiveComments(streamId, hostEl) {
            if (!hostEl) return null;
            hostEl.innerHTML =
                '<div class="reels-live-comments-list" id="reels-live-comments-list"></div>'
                + '<form id="reels-live-comments-form" class="reels-live-comments-form" autocomplete="off">'
                    + '<input type="text" id="reels-live-comment-input" maxlength="240" placeholder="Say something…" enterkeyhint="send" autocomplete="off" autocorrect="off">'
                    + '<button type="submit" aria-label="Send"><i class="fas fa-paper-plane"></i></button>'
                + '</form>';

            var listEl = hostEl.querySelector('#reels-live-comments-list');
            /* FIX (2026-11-04 — "comments don't send nor stay in the comments
               section"): a sent comment used to appear ONLY if the Firestore
               round trip + snapshot succeeded; any failure (rules, session
               not attached yet, slow link) left an empty list with nothing
               on screen. Now: (1) the comment shows immediately as a local
               "pending" row and is swapped for the server copy when the
               snapshot confirms it; (2) a failed send removes the row and
               says WHY; (3) a blocked listener shows a message in the list
               instead of failing silently. */
            var serverComments = [];
            var pending = [];
            var listError = '';

            function rowHtml(c, isPending) {
                if (c.type === 'gift') {
                    return '<div class="reels-live-comment-row reels-live-comment-row-gift">'
                        + '<img class="reels-live-comment-avatar" src="' + _esc(c.authorAvatar || '') + '" alt="" onerror="this.style.visibility=\'hidden\'">'
                        + '<div class="reels-live-comment-body">'
                            + '<span class="reels-live-comment-author">' + _esc(c.authorName || 'Viewer') + '</span> '
                            + '<span class="reels-live-comment-gift-text">sent a ' + _esc(c.giftName || 'gift') + '</span> '
                            + '<span class="reels-live-comment-gift-icon">' + (c.giftSymbol || '\uD83C\uDF81') + '</span>'
                            + (c.amount ? ' <span class="reels-live-comment-gift-amt">' + _esc(String(c.amount)) + ' EMPY</span>' : '')
                        + '</div>'
                    + '</div>';
                }
                return '<div class="reels-live-comment-row"' + (isPending ? ' style="opacity:0.6;"' : '') + '>'
                    + '<img class="reels-live-comment-avatar" src="' + _esc(c.authorAvatar || '') + '" alt="" onerror="this.style.visibility=\'hidden\'">'
                    + '<div class="reels-live-comment-body"><span class="reels-live-comment-author">' + _esc(c.authorName || 'Viewer') + '</span> '
                    + '<span class="reels-live-comment-text">' + _esc(c.text || '') + '</span></div>'
                + '</div>';
            }
            function paint() {
                if (!listEl) return;
                var wasNearBottom = (listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight) < 60;
                var html = serverComments.map(function (c) { return rowHtml(c, false); }).join('')
                         + pending.map(function (c) { return rowHtml(c, true); }).join('');
                if (listError && !html) html = '<div class="reels-live-comment-body" style="opacity:0.7;">' + _esc(listError) + '</div>';
                listEl.innerHTML = html;
                if (wasNearBottom || pending.length) listEl.scrollTop = listEl.scrollHeight;
            }

            var unsub = null;
            if (window._firebaseLoaded && window.fbDb && streamId) {
                unsub = window.fbDb.collection('reel_live_broadcasts').doc(streamId)
                    .collection('comments').orderBy('createdAt', 'asc').limitToLast(50)
                    .onSnapshot(function (snap) {
                        if (!snap) return;
                        listError = '';
                        serverComments = snap.docs.map(function (doc) { return doc.data() || {}; });
                        // drop pending rows the server has now confirmed
                        pending = pending.filter(function (p) {
                            return !serverComments.some(function (c) { return c.authorId === p.authorId && c.text === p.text && c.type !== 'gift'; });
                        });
                        paint();
                    }, function (err) {
                        console.warn('[Reel live comments]', err && err.message);
                        listError = (err && err.code === 'permission-denied')
                            ? 'Comments are blocked by the database rules for this broadcast.'
                            : 'Comments couldn\u2019t load — check your connection.';
                        paint();
                    });
            } else {
                listError = 'Comments are still connecting…';
                paint();
            }

            var form = hostEl.querySelector('#reels-live-comments-form');
            if (form) {
                form.addEventListener('submit', function (e) {
                    e.preventDefault();
                    var input = hostEl.querySelector('#reels-live-comment-input');
                    var text = input && input.value.trim();
                    if (!text) return;
                    var me = _us() || {};
                    if (!me.id) { _notify('Log in to comment.', 'info'); return; }
                    if (!(window._firebaseLoaded && window.fbDb && streamId)) { _notify('Still connecting — please try again in a moment.', 'info'); return; }
                    if (!_requireAnySessionForWrite()) return;
                    input.value = '';
                    var doc = {
                        text: text.slice(0, 240),
                        authorId: me.id,
                        authorName: me.name || me.username || 'Viewer',
                        authorAvatar: me.avatar || me.profilePic || '',
                        createdAt: new Date().toISOString()
                    };
                    pending.push(doc);
                    paint();
                    window.fbDb.collection('reel_live_broadcasts').doc(streamId).collection('comments').add(doc)
                    .catch(function (err) {
                        pending = pending.filter(function (p) { return p !== doc; });
                        paint();
                        console.warn('[Reel live comments] send failed:', err && err.code, err && err.message);
                        _notify((err && err.code === 'permission-denied')
                            ? 'Comments are blocked by the database rules — the comments subcollection of reel_live_broadcasts needs a create rule.'
                            : 'Couldn\u2019t send your comment — please try again.', 'error');
                    });
                });
            }
            return unsub;
        }

        /* ── Inline comment sheet for the pinned/featured "TV" card
           (this session — "engagement buttons remain visible in the
           fixed-screen ... card. Viewers who prefer not to expand to full
           screen should still be able to comment, like, share, and send
           gifts"): Like/Share/Gift on that card already act directly (see
           the card's engagement row further down) with no fullscreen
           overlay involved, but Comment has nowhere to render a whole
           thread ON the card itself — it needs the same list+input UI the
           fullscreen watch overlay uses. Rather than duplicate
           _mountLiveComments' rendering/listener/submit logic a second
           time, this just reopens THAT exact function against a small
           bottom sheet instead of the fullscreen overlay's own comments
           panel — same live subcollection, same gift-highlighted rows,
           same submit handling, zero video/overlay involved. */
        function _openReelLiveCommentSheet(streamId, hostName) {
            if (!streamId) { _notify('This broadcast is no longer available.', 'info'); return; }
            var existing = document.getElementById('reels-live-comment-sheet');
            if (existing) existing.remove();
            if (_cardCommentSheetUnsub) { _cardCommentSheetUnsub(); _cardCommentSheetUnsub = null; }

            var pop = document.createElement('div');
            pop.id = 'reels-live-comment-sheet';
            pop.innerHTML =
                '<div class="reels-live-comment-sheet-inner">'
                    + '<div class="reels-live-comment-sheet-head">'
                        + '<span>Comments \u2014 ' + _esc(hostName || 'Live') + '</span>'
                        + '<button type="button" id="reels-live-comment-sheet-close"><i class="fas fa-times"></i></button>'
                    + '</div>'
                    + '<div class="reels-live-comment-sheet-body" id="reels-live-comment-sheet-body"></div>'
                + '</div>';
            document.body.appendChild(pop);
            _fitOverlayToVisualViewport(pop); // 2026-11-04: same keyboard fix for the inline comment sheet
            _cardCommentSheetUnsub = _mountLiveComments(streamId, document.getElementById('reels-live-comment-sheet-body'));
        }

        function _closeReelLiveCommentSheet() {
            var sheet = document.getElementById('reels-live-comment-sheet');
            if (sheet) sheet.remove();
            if (_cardCommentSheetUnsub) { _cardCommentSheetUnsub(); _cardCommentSheetUnsub = null; }
        }

        /* ── Renders the live extras bar under the video for whichever
           category this broadcast is (2026-08-11). Rebuilt on every
           snapshot tick so scoreboard/poll numbers update in real time
           without the viewer needing to reopen the overlay. streamId/
           category/myVoted are closed over from the caller so a poll
           vote tap always targets the CORRECT doc even if the viewer
           later opens a different broadcast in the same overlay element. */
        function _renderWatchExtras(streamId, category, extras, myId) {
            var host = document.getElementById('reels-yt-live-extras');
            if (!host) return;
            if (!extras) { host.innerHTML = ''; host.style.display = 'none'; return; }
            host.style.display = 'block';
            host.dataset.streamId = streamId;

            if (category === 'sports' && extras.scoreboard) {
                var sb = extras.scoreboard;
                host.innerHTML = '<div class="reels-live-vt-scoreboard">'
                    + '<span class="reels-live-vt-team">' + _esc(sb.teamA) + '</span>'
                    + '<span class="reels-live-vt-score">' + sb.scoreA + ' \u2013 ' + sb.scoreB + '</span>'
                    + '<span class="reels-live-vt-team">' + _esc(sb.teamB) + '</span>'
                + '</div>';
            } else if (category === 'church' && extras.donationUrl) {
                host.innerHTML = '<a class="reels-live-vt-donate-btn" href="' + _esc(extras.donationUrl) + '" target="_blank" rel="noopener noreferrer"><i class="fas fa-hand-holding-heart"></i> Give / Donate</a>';
            } else if (category === 'tv' && extras.programNote) {
                host.innerHTML = '<div class="reels-live-vt-program-note"><i class="fas fa-tv"></i> ' + _esc(extras.programNote) + '</div>';
            } else if (category === 'public' && extras.poll) {
                var poll = extras.poll;
                var totalVotes = poll.options.reduce(function (sum, o) { return sum + (o.votes || 0); }, 0);
                var already = myId && poll.voterIds && poll.voterIds.indexOf(myId) !== -1;
                host.innerHTML = '<div class="reels-live-vt-poll">'
                    + '<div class="reels-live-vt-poll-q">' + _esc(poll.question) + '</div>'
                    + poll.options.map(function (o, i) {
                        var pct = totalVotes ? Math.round((o.votes || 0) / totalVotes * 100) : 0;
                        return '<button type="button" class="reels-live-vt-poll-opt' + (already ? ' voted' : '') + '" data-opt-index="' + i + '"' + (already ? ' disabled' : '') + '>'
                            + '<span class="reels-live-vt-poll-fill" style="width:' + (already ? pct : 0) + '%;"></span>'
                            + '<span class="reels-live-vt-poll-label">' + _esc(o.text) + (already ? ' \u2014 ' + pct + '%' : '') + '</span>'
                        + '</button>';
                    }).join('')
                + '</div>';
            } else {
                host.innerHTML = '';
                host.style.display = 'none';
            }
        }

        function _openReelLiveWatchOverlay(streamId, youtubeId, title, hostName, category, agoraChannel, agoraUid, hostId) {
            var existing = document.getElementById('reels-yt-live-overlay');
            if (existing) existing.remove();
            // FIX (2026-08-12 — "can't watch the broadcast"): this file
            // declares _watchOverlayExtrasUnsub/_watchOverlayCommentsUnsub
            // at the top of this section specifically for this function,
            // but the code below was still reading/writing an undeclared
            // `_watchOverlayUnsub` global instead — so it never actually
            // used either declared variable, and never tore down a comment
            // listener at all (comments were never mounted here in the
            // first place). Also leaves any previous native-viewer Agora
            // session before opening a new one, same as the host side
            // already does.
            if (_watchOverlayExtrasUnsub) { _watchOverlayExtrasUnsub(); _watchOverlayExtrasUnsub = null; }
            if (_watchOverlayCommentsUnsub) { _watchOverlayCommentsUnsub(); _watchOverlayCommentsUnsub = null; }
            /* 2026-11-08: no leave here any more — _joinReelLiveAudience re-uses the card's already-connected session for the same channel (instant), and leaves/rejoins itself only for a different one. */
            if (_reelViewerChannel && agoraChannel && _reelViewerChannel !== agoraChannel) _leaveReelLiveAudience();

            /* FEATURE (2026-08-13 — viewer count indicator): count a real
               viewer (not the host looking at their own broadcast, and not
               a repeat count if minimize->reopen brings this same person
               back to an already-counted session — see
               _reelViewerCountedStreams' own comment above) exactly once
               per person per broadcast. Same "any authenticated session,
               anonymous included" write posture reel_live_broadcasts
               already uses for likeCount/extras (firebase-rules.js) — no
               rule change needed — so this only needs the same
               _requireAnySessionForWrite() guard every other write in this
               file already uses, not a stricter one. Fire-and-forget: a
               failed increment just means the count is off by one, not
               worth blocking playback over. */
            var _FVvc = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) || null;
            if (streamId && _FVvc && hostId !== ((_us() || {}).id || null) && !_reelViewerCountedStreams[streamId]
                && window._firebaseLoaded && window.fbDb && _requireAnySessionForWrite()) {
                window.fbDb.collection('reel_live_broadcasts').doc(streamId).update({
                    viewerCount: _FVvc.increment(1)
                }).then(function () {
                    _reelViewerCountedStreams[streamId] = true;
                }).catch(function (err) {
                    console.warn('[Reel live viewer count]', err && err.message);
                });
            }

            // FIX (2026-08-12 — "watching the broadcast" / Issue 2): a
            // native-camera broadcast has no youtubeId, only an
            // agoraChannel (see the composer's docData.agoraChannel gating
            // — only set when the host's stream actually reached Agora,
            // not on the local-only fallback). Previously this function
            // only knew how to render a YouTube iframe, so the caller
            // below had to reject every native broadcast before ever
            // reaching here. _joinReelLiveAudience already existed
            // (audience-only join — no guest-box accept/decline, exactly
            // the "watch like TV" behavior asked for) but was never
            // called from anywhere in this file until now.
            //
            // FIX (this session — "not seeing comments/share/like/gift
            // icons, can't expand, can't see host video"): a broadcast
            // with NEITHER youtubeId NOR agoraChannel yet (host still
            // mid-upgrade from the local-camera fallback — see
            // _armReelAgoraUpgradeRetry) used to be rejected by the CALLER
            // before this function ever ran, so the whole overlay —
            // comments, like, share, gift, all of it — never appeared.
            // Comments/like/share/gift don't depend on Agora at all, only
            // the video frame does, so this now always builds the full
            // overlay; a broadcast with no video source yet gets the same
            // "Connecting…" video frame a native broadcast shows while
            // Agora is joining, and the extras listener below auto-joins
            // the moment agoraChannel actually lands on the doc — no
            // reopen needed.
            var pendingAgora = !youtubeId && !agoraChannel; // real live broadcast, video not reachable YET
            var isNative = !youtubeId && (!!agoraChannel || pendingAgora);
            var frameHtml = youtubeId
                ? '<iframe src="https://www.youtube.com/embed/' + encodeURIComponent(youtubeId) + '?autoplay=1&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>'
                : '<div id="reels-live-viewer-video" class="reels-live-native-frame"></div>'
                  + '<div id="reels-live-viewer-connecting" class="reels-live-viewer-connecting">Connecting\u2026</div>';

            var ov = document.createElement('div');
            ov.id = 'reels-yt-live-overlay';
            ov.innerHTML =
                /* FIX (this session — "move the engagement and interactive
                   buttons to the bottom of the screen ... compact ...
                   hide them inside a chevron"): Like/Gift/Share used to sit
                   in this top bar crowding the title/host name and the
                   navigation controls (Minimize/Exit) into a single
                   overflow-prone row. Top bar now carries ONLY navigation
                   (title/host + Minimize + Exit); Like/Gift/Share moved into
                   a small floating cluster anchored to the bottom-right of
                   the video frame (see .reels-live-overlay-bottom-bar
                   below), collapsed by default behind a chevron toggle so
                   the video itself reads clean until a viewer actually
                   wants to engage. */
                '<div class="reels-yt-live-overlay-top">'
                    + '<div class="reels-yt-live-overlay-info"><div class="reels-yt-live-overlay-title">' + _esc(title || 'Live') + '</div>'
                    /* FEATURE (2026-08-13 — viewer count indicator): kept
                       live by the same extras onSnapshot below that already
                       drives the Like button's count/state, so no separate
                       subscription is needed. */
                    + '<div class="reels-yt-live-overlay-host">' + _esc(hostName || '') + ' <span class="reels-live-watch-viewer-badge"><i class="fas fa-eye"></i> <span id="reels-live-watch-viewer-count">0</span></span></div></div>'
                    + '<button type="button" id="reels-live-watch-minimize-btn" class="reels-live-exit-btn" title="Minimize — keep watching from the grid"><i class="fas fa-compress-alt"></i></button>'
                    + '<button type="button" id="reels-yt-live-close-btn" class="reels-live-exit-btn"><i class="fas fa-right-from-bracket"></i> Exit</button>'
                + '</div>'
                + '<div class="reels-yt-live-overlay-frame">'
                    + frameHtml
                    + '<div class="reels-live-overlay-bottom-bar">'
                        + '<div class="reels-live-bottom-actions collapsed" id="reels-live-bottom-actions">'
                            + '<button type="button" id="reels-live-watch-like-btn" class="reels-live-bottom-action-btn" data-stream-id="' + _esc(streamId || '') + '"><i class="far fa-heart"></i><span id="reels-live-watch-like-count">0</span></button>'
                            /* GIFTING (this session — "gifting system within
                               the reel live broadcast channel... similar to
                               the TikTok model"): opens a small gift picker
                               scoped to THIS broadcast (see
                               _openReelGiftPicker/_sendReelLiveGift below)
                               — separate from app-gifts.js's own catalog
                               modal, which is hardwired to window.
                               liveStreamData / #live-gift-catalog-modal for
                               the dashboard "Go Live" flow and has no
                               concept of a reel_live_broadcasts streamId or
                               hostId. Hidden for the host watching their
                               own card (nothing to gift yourself), and
                               hidden entirely for a REPLAY (the strip's
                               replay cards — see _renderReplayStrip — never
                               set data-host-id at all, unlike a live card
                               via _applyLiveBroadcastScreenAttrs, so an
                               absent hostId here reliably means "this isn't
                               a live broadcast," not just "we don't know
                               the host" — gifting only makes sense in real
                               time, during the live stream, per the
                               feature request itself). */
                            + (hostId && hostId !== ((_us() || {}).id || null) ?
                                '<button type="button" class="reels-live-bottom-action-btn reels-live-gift-btn" data-stream-id="' + _esc(streamId || '') + '" data-host-id="' + _esc(hostId || '') + '" data-host-name="' + _esc(hostName || 'Broadcaster') + '"><i class="fas fa-gift"></i></button>' : '')
                            /* FIX (2026-08-12 — matches the same-day change
                               to the featured card's share button above:
                               dropping reels-live-bottom-action-btn (the
                               42px dark circle used by its Like/Gift
                               siblings here) so this falls back to
                               .reels-live-tv-share-btn's own white-pill-
                               with-label look instead, per the person's
                               reference image. Traded deliberately: this
                               button now looks different from its Like/
                               Gift neighbors in this floating cluster, in
                               exchange for looking the same as every other
                               Share entry point in the feature. ICON: same
                               3-node share SVG swap as the featured card
                               above — see that comment for why. */
                            + '<button type="button" class="reels-live-tv-share-btn" data-stream-id="' + _esc(streamId || '') + '" data-title="' + _esc(title || 'Live') + '" data-host-name="' + _esc(hostName || 'Broadcaster') + '" data-category="' + _esc(category || '') + '"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share</button>'
                        + '</div>'
                        + '<button type="button" class="reels-live-bottom-toggle-btn collapsed" id="reels-live-bottom-toggle-btn" aria-label="Show like, gift and share"><i class="fas fa-chevron-up"></i></button>'
                    + '</div>'
                + '</div>'
                + '<div id="reels-yt-live-extras" style="display:none;"></div>'
                + '<div id="reels-live-viewer-comments" class="reels-live-viewer-comments"></div>';
            document.body.appendChild(ov);
            _fitOverlayToVisualViewport(ov); // 2026-11-04: keeps the layout stable when the keyboard opens for a comment

            // Live comments — mountable widget already existed
            // (_mountLiveComments) but had no caller anywhere, so the
            // requirement that "comments should be visible in the
            // comments section during the broadcast" was never actually
            // reachable for any broadcast, YouTube or native.
            _watchOverlayCommentsUnsub = _mountLiveComments(streamId, document.getElementById('reels-live-viewer-comments'));

            if (isNative && agoraChannel) {
                var videoEl = document.getElementById('reels-live-viewer-video');
                var connectingEl = document.getElementById('reels-live-viewer-connecting');
                _joinReelLiveAudience(agoraChannel, agoraUid, videoEl, function (hasVideo) {
                    if (connectingEl) connectingEl.style.display = hasVideo ? 'none' : 'flex';
                }).catch(function (err) {
                    _notify(err && err.message ? err.message : 'Couldn\u2019t connect to this broadcast.', 'error');
                    console.warn('[Reel live viewer]', err && err.message);
                });
            }
            // pendingAgora (neither youtubeId nor agoraChannel at open
            // time) intentionally does NOT try to join here — there's
            // nothing to join yet. The extras onSnapshot below watches for
            // agoraChannel landing on the doc and joins automatically the
            // moment it does, via the shared _joinOverlayAgoraIfNeeded
            // helper so this isn't duplicated.
            var _overlayJoinedAgora = !!(isNative && agoraChannel);
            function _joinOverlayAgoraIfNeeded(d) {
                if (_overlayJoinedAgora || !d.agoraChannel) return;
                _overlayJoinedAgora = true;
                var videoEl2 = document.getElementById('reels-live-viewer-video');
                var connectingEl2 = document.getElementById('reels-live-viewer-connecting');
                _joinReelLiveAudience(d.agoraChannel, d.agoraUid, videoEl2, function (hasVideo) {
                    if (connectingEl2) connectingEl2.style.display = hasVideo ? 'none' : 'flex';
                }).catch(function (err) {
                    _overlayJoinedAgora = false; // let a LATER snapshot retry if this attempt itself failed
                    console.warn('[Reel live viewer] auto-join failed:', err && err.message);
                });
            }

            /* Live extras: a dedicated onSnapshot scoped to just THIS one
               broadcast doc, separate from the strip's own collection-wide
               listener — so scoreboard taps/poll votes reflect here within
               a second without re-rendering the whole strip. Unsubscribed
               on close (see the click handler below) so it never keeps
               running after the viewer exits. */
            if (window._firebaseLoaded && window.fbDb && streamId) {
                var myId = (_us() || {}).id;
                _watchOverlayExtrasUnsub = window.fbDb.collection('reel_live_broadcasts').doc(streamId)
                    .onSnapshot(function (doc) {
                        /* 2026-11-05: host tapped End Live (doc ended/removed) -> a camera broadcast has no replay, so close the
                           viewer overlay and drop the card. YouTube-mode streams keep playing as a normal video, so they're left open. */
                        if (isNative && (!doc.exists || (doc.data() || {}).isLive === false)) {
                            var _endedClose = document.getElementById('reels-yt-live-close-btn');
                            if (typeof window._empReelStripDrop === 'function') window._empReelStripDrop(streamId);
                            if (_endedClose) { _notify('This live broadcast has ended.', 'info'); _endedClose.click(); }
                            return;
                        }
                        if (!doc.exists) return;
                        var d = doc.data() || {};
                        _renderWatchExtras(streamId, d.channelCategory || category, d.extras || null, myId);
                        /* FEATURE (2026-08-13 — viewer count indicator):
                           reuses this already-open per-doc listener rather
                           than opening a second subscription just for one
                           field — same "no separate subscription needed"
                           precedent as the Like count line just below. */
                        var watchViewerEl = document.getElementById('reels-live-watch-viewer-count');
                        if (watchViewerEl) watchViewerEl.textContent = d.viewerCount || 0;
                        var cardViewerEl = document.getElementById('reels-live-featured-viewer-count');
                        if (cardViewerEl) cardViewerEl.innerHTML = '<i class="fas fa-eye"></i> ' + (d.viewerCount || 0);
                        // Auto-join the moment the host's broadcast upgrades
                        // from local-only to real Agora (see
                        // _armReelAgoraUpgradeRetry) — this is what turns
                        // "can't see host video" into video actually
                        // appearing, without the viewer needing to close
                        // and reopen the overlay.
                        _joinOverlayAgoraIfNeeded(d);
                        // Like count/state — same doc, same listener, no
                        // separate subscription needed.
                        var likeBtn = document.getElementById('reels-live-watch-like-btn');
                        if (likeBtn) {
                            var countEl = document.getElementById('reels-live-watch-like-count');
                            if (countEl) countEl.textContent = d.likeCount || 0;
                            var iAlreadyLiked = myId && (d.likedBy || []).indexOf(myId) !== -1;
                            likeBtn.classList.toggle('liked', !!iAlreadyLiked);
                            var icon = likeBtn.querySelector('i');
                            if (icon) icon.className = iAlreadyLiked ? 'fas fa-heart' : 'far fa-heart';
                        }
                    }, function () { /* offline — extras just stop updating, video keeps playing */ });
            }
        }

        /* Poll vote tap — reads the CURRENT vote counts for a fresh
           increment rather than blindly writing "1", so two viewers voting
           within the same second don't clobber each other's tally (the
           small window between read and write is the same tradeoff every
           other click-triggered Firestore write in this codebase already
           accepts, e.g. app-live-tiktok-patch.js's toggleGuestMute). Each
           voter's id is recorded in voterIds so they can't vote twice on
           the same poll, and the option their id is already in that array
           for is what "already voted, showing results" is based on. */
        document.addEventListener('click', function (e) {
            var optBtn = e.target.closest && e.target.closest('.reels-live-vt-poll-opt');
            if (optBtn && !optBtn.disabled) {
                var host = document.getElementById('reels-yt-live-extras');
                var streamId = host && host.dataset.streamId;
                var idx = parseInt(optBtn.dataset.optIndex, 10);
                var myId = (_us() || {}).id;
                if (!streamId || isNaN(idx) || !myId) { _notify('Log in to vote.', 'info'); return; }
                if (!window._firebaseLoaded || !window.fbDb) return;
                var ref = window.fbDb.collection('reel_live_broadcasts').doc(streamId);
                ref.get().then(function (doc) {
                    if (!doc.exists) return;
                    var d = doc.data() || {};
                    var poll = d.extras && d.extras.poll;
                    if (!poll || (poll.voterIds || []).indexOf(myId) !== -1) return; // already voted or no poll — no-op
                    var options = poll.options.slice();
                    options[idx] = Object.assign({}, options[idx], { votes: (options[idx].votes || 0) + 1 });
                    var voterIds = (poll.voterIds || []).concat([myId]);
                    ref.update({ 'extras.poll.options': options, 'extras.poll.voterIds': voterIds }).catch(function () {});
                }).catch(function (err) {
                    /* FIX (2026-08-11 — "insufficient permissions" console
                       spam): this .get() had NO .catch() at all, so a
                       permission-denied/offline read (e.g. this viewer's
                       Firebase Auth session hasn't finished attaching yet)
                       fell straight through as an unhandled promise
                       rejection instead of being handled like every other
                       Firestore call in this file. Silently ignored here
                       (same tolerance the update() right above it already
                       has) — worst case the tap just doesn't register and
                       the viewer can try again. */
                    console.warn('[Reel live poll vote]', err && err.message);
                });
                return;
            }
            /* FIX (this session — "engagement buttons remain visible in
               the fixed-screen ... card"): Like now also lives on the
               pinned/featured grid card (.reels-live-card-like-btn), not
               only inside the fullscreen watch overlay
               (#reels-live-watch-like-btn). The overlay's own copy stays
               in sync via the extras onSnapshot listener above (real-time,
               shared with every other viewer), but the card has no such
               listener of its own — updating it here, optimistically, the
               moment ITS tap succeeds is what actually makes liking work
               from the grid at all, not just cosmetically. */
            /* FIX (2026-08-12 — "enable multiple click send like"): this
               used to permanently lock the button after the first
               successful like (classList.contains('liked') return, plus a
               server-side likedBy-membership check below that no-op'd any
               repeat tap) — a one-like-per-viewer model. Per explicit
               request, switched to a TikTok-style repeatable like: every
               tap increments likeCount again, no matter how many times
               this viewer has already liked. likedBy (via arrayUnion,
               below) is kept as a harmless "has liked at least once" flag
               only — arrayUnion is idempotent so it never grows past one
               entry per viewer — but it no longer gates anything. */
            var likeBtn = e.target.closest && e.target.closest('#reels-live-watch-like-btn, .reels-live-card-like-btn, .reels-live-mini-like');
            if (likeBtn) {
                /* FIX (2026-11-04 — "like icon is not responding to click"):
                   the old handler did a read (get) THEN a write, and every
                   failure path (no Firebase yet, no session, rules, doc
                   missing) just returned silently — so a tap that didn't
                   land looked like a dead button. Now: the heart + count
                   react instantly on tap, the write goes straight out, a
                   narrower write (count only) is retried if the first is
                   refused, and a real failure rolls the UI back with a
                   message. */
                var likeStreamId = likeBtn.dataset.streamId;
                var likeMyId = (_us() || {}).id;
                if (!likeStreamId) { _notify('This broadcast is no longer available.', 'info'); return; }
                if (!window._firebaseLoaded || !window.fbDb) { _notify('Still connecting — please try again in a moment.', 'info'); return; }
                if (!likeMyId) { _notify('Log in to like.', 'info'); return; }
                if (!_requireAnySessionForWrite()) return;
                var likeRef = window.fbDb.collection('reel_live_broadcasts').doc(likeStreamId);
                var FVlike = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) || null;
                var likeIcon = likeBtn.querySelector('i');
                var likeCountEl = likeBtn.querySelector('span') || document.getElementById('reels-live-featured-like-count');
                var prevCount = likeCountEl ? (parseInt(likeCountEl.textContent, 10) || 0) : 0;
                likeBtn.classList.add('liked');
                if (likeIcon) likeIcon.className = 'fas fa-heart';
                if (likeCountEl) likeCountEl.textContent = String(prevCount + 1);
                var countOnly = { likeCount: FVlike ? FVlike.increment(1) : prevCount + 1 };
                var withWho = { likeCount: countOnly.likeCount, likedBy: FVlike ? FVlike.arrayUnion(likeMyId) : [likeMyId] };
                likeRef.update(withWho).catch(function () {
                    return likeRef.update(countOnly); // rules may not allow touching likedBy
                }).catch(function (err) {
                    if (likeCountEl) likeCountEl.textContent = String(prevCount);
                    likeBtn.classList.remove('liked');
                    if (likeIcon) likeIcon.className = 'far fa-heart';
                    console.warn('[Reel live watch like]', err && err.code, err && err.message);
                    _notify('Couldn\u2019t register your like — please try again.', 'error');
                });
                return;
            }
            /* Comment button on the pinned/featured grid card — opens the
               lightweight inline sheet instead of the fullscreen overlay
               (see _openReelLiveCommentSheet above). */
            var cardCommentBtn = e.target.closest && e.target.closest('.reels-live-card-comment-btn, .reels-live-mini-comment');
            if (cardCommentBtn) {
                _openReelLiveCommentSheet(cardCommentBtn.dataset.streamId, cardCommentBtn.dataset.hostName);
                return;
            }
            if (e.target.closest && e.target.closest('#reels-live-comment-sheet-close')) {
                _closeReelLiveCommentSheet();
                return;
            }
            if (e.target.id === 'reels-live-comment-sheet') {
                _closeReelLiveCommentSheet();
                return;
            }
            /* Chevron toggle for the fullscreen watch overlay's compact
               bottom engagement cluster (see the overlay markup above) —
               collapsed by default so the video stays clean; tapping the
               chevron reveals Like/Gift/Share, tapping again re-collapses. */
            var bottomToggleBtn = e.target.closest && e.target.closest('#reels-live-bottom-toggle-btn');
            if (bottomToggleBtn) {
                var bottomActionsEl = document.getElementById('reels-live-bottom-actions');
                if (bottomActionsEl) bottomActionsEl.classList.toggle('collapsed');
                bottomToggleBtn.classList.toggle('collapsed');
                return;
            }
            /* Horizontally-scrollable avatar strip inside the single live
               broadcast card (this session's rebuild) — tapping a host's
               avatar re-features THEIR broadcast in the screen area above
               without rebuilding the whole card (keeps the scroll position
               of the avatar row itself intact). Lives in .reel-meta-row, a
               sibling of the screen's .reels-live-watch-btn element (not a
               descendant of it), so this never reaches/conflicts with the
               watch-button branch below. */
            var stripChip = e.target.closest && e.target.closest('.reels-live-chip-on');
            if (stripChip) {
                var chipCard = stripChip.closest('#reels-live-broadcast-card');
                var chipAv = chipCard && chipCard.querySelector('.live-broadcast-avatar-item[data-index="' + stripChip.dataset.index + '"]');
                if (chipAv) chipAv.click();
                return;
            }
            var avatarItem = e.target.closest && e.target.closest('.live-broadcast-avatar-item');
            if (avatarItem) {
                var avCard = avatarItem.closest('#reels-live-broadcast-card');
                var idx = parseInt(avatarItem.dataset.index, 10);
                var s = avCard && isFinite(idx) ? _liveBroadcastFresh[idx] : null;
                if (!avCard || !s) return;
                var scrollWrap = avCard.querySelector('#reels-live-avatar-scroll');
                if (scrollWrap) {
                    Array.prototype.forEach.call(scrollWrap.querySelectorAll('.live-broadcast-avatar-item.active'), function (b) { b.classList.remove('active'); });
                    avatarItem.classList.add('active');
                }
                var screenEl2 = avCard.querySelector('#reels-live-featured-screen');
                if (screenEl2) {
                    screenEl2.innerHTML = _liveBroadcastScreenInnerHtml(s);
                    _applyLiveBroadcastScreenAttrs(screenEl2, s);
                    screenEl2.classList.remove('reels-live-card-has-video');
                    _leaveReelLiveAudience(); // different broadcaster -> new channel
                    _reelRefreshCardPreview();
                }
                var captionEl = avCard.querySelector('#reels-live-featured-caption');
                if (captionEl) captionEl.textContent = (s.title || 'Live') + ' \u2014 ' + (s.hostName || 'Broadcaster');
                // Keep the Share button pointed at whichever broadcast is
                // now actually featured — without this it would keep
                // sharing the ORIGINAL card[0] stream after switching.
                var shareBtnEl = avCard.querySelector('#reels-live-featured-share-btn');
                if (shareBtnEl) {
                    shareBtnEl.dataset.streamId = s.streamId || '';
                    shareBtnEl.dataset.title = s.title || 'Live';
                    shareBtnEl.dataset.hostName = s.hostName || 'Broadcaster';
                    shareBtnEl.dataset.category = s.channelCategory || '';
                }
                // Same re-pointing for the Like/Comment/Gift buttons added
                // alongside Share this session — same "would keep acting on
                // the ORIGINAL card[0] stream" bug if left stale.
                var likeBtnEl = avCard.querySelector('#reels-live-featured-like-btn');
                if (likeBtnEl) {
                    likeBtnEl.dataset.streamId = s.streamId || '';
                    likeBtnEl.classList.remove('liked');
                    var likeIconEl = likeBtnEl.querySelector('i');
                    if (likeIconEl) likeIconEl.className = 'far fa-heart';
                    var likeCountEl = avCard.querySelector('#reels-live-featured-like-count');
                    if (likeCountEl) likeCountEl.textContent = s.likeCount || 0;
                }
                var commentBtnEl = avCard.querySelector('.reels-live-card-comment-btn');
                if (commentBtnEl) {
                    commentBtnEl.dataset.streamId = s.streamId || '';
                    commentBtnEl.dataset.hostName = s.hostName || 'Broadcaster';
                }
                var giftBtnEl = avCard.querySelector('.reels-live-tv-engagement-row .reels-live-gift-btn');
                var meNow = (_us() || {}).id;
                if (s.hostId && s.hostId !== meNow) {
                    if (giftBtnEl) {
                        giftBtnEl.dataset.streamId = s.streamId || '';
                        giftBtnEl.dataset.hostId = s.hostId || '';
                        giftBtnEl.dataset.hostName = s.hostName || 'Broadcaster';
                    } else if (shareBtnEl) {
                        // Broadcast switched to one that now DOES have a
                        // gift-able host but didn't before (Gift button was
                        // omitted at render time) — insert it fresh right
                        // after Share (its normal position) rather than
                        // leaving gifting unreachable until the whole card
                        // next re-renders.
                        var freshGiftBtn = document.createElement('button');
                        freshGiftBtn.type = 'button';
                        freshGiftBtn.className = 'reels-live-tv-share-btn reels-live-gift-btn';
                        freshGiftBtn.dataset.streamId = s.streamId || '';
                        freshGiftBtn.dataset.hostId = s.hostId || '';
                        freshGiftBtn.dataset.hostName = s.hostName || 'Broadcaster';
                        freshGiftBtn.innerHTML = '<i class="fas fa-gift"></i> Gift';
                        shareBtnEl.insertAdjacentElement('afterend', freshGiftBtn);
                    }
                } else if (giftBtnEl) {
                    // Switched to featuring ourselves (or a broadcast with
                    // no known host) — nothing to gift, same as at render
                    // time above.
                    giftBtnEl.remove();
                }
                return;
            }
            var watchBtn = e.target.closest && e.target.closest('.reels-live-watch-btn');
            var soundBtn = e.target.closest && e.target.closest('.reels-live-mini-sound');
            if (soundBtn) {
                _reelCardMuted = !_reelCardMuted;
                _reelSyncSoundBtn();
                if (!document.getElementById('reels-yt-live-overlay')) {
                    _reelViewerWantAudio = !_reelCardMuted;
                    ((_reelAgoraViewerClient && _reelAgoraViewerClient.remoteUsers) || []).forEach(function (u) {
                        try { if (u.audioTrack) { if (_reelViewerWantAudio) u.audioTrack.play(); else u.audioTrack.stop(); } } catch (eM) {}
                    });
                }
                return;
            }
            if (watchBtn && e.target.closest && e.target.closest('.reels-live-card-mini-actions')) return; // like/comment/gift on the small screen must NOT also expand it
            if (watchBtn && e.target.closest && e.target.closest('.dash-live-join-link')) e.preventDefault(); // Join link: open in-app, no reload
            if (watchBtn) {
                // FIX (2026-08-12 — "the click to expand button didn't
                // work"): the restore-from-minimize check below used to
                // run AFTER the youtubeId/agoraChannel "is this even
                // watchable" gate just below it. A local-camera-fallback
                // broadcast (no Agora reachable — exactly the weak-
                // connection case in the reported screenshots) never gets
                // an agoraChannel written to its doc at all (see
                // publishLiveStreamToFirestore's own gating elsewhere), so
                // for a host whose OWN stream is running in fallback mode,
                // that gate fired first and returned "This broadcast is no
                // longer available" before this restore check ever ran —
                // minimizing your own fallback-mode broadcast left no way
                // to tap back into it. Moved above the gate: whether this
                // broadcast is remotely "watchable" by anyone else is
                // irrelevant to whether the HOST can reopen their own
                // panel, which only ever needs the tracks/local stream
                // already sitting in memory, never Agora reachability.
                if (window._empReelLiveSession && window._empReelLiveSession.streamId === watchBtn.dataset.streamId) {
                    _openHostLivePanel(window._empReelLiveSession);
                    return;
                }
                // FIX (this session — "not seeing the comments/share/like/
                // gift icons; can't expand to full screen; can't see host
                // video"): this used to hard-block opening the overlay AT
                // ALL for a broadcast with neither youtubeId nor
                // agoraChannel — but comments, like, share, and gift live
                // INSIDE the overlay (built in _openReelLiveWatchOverlay),
                // not on the strip card itself. Gating the tap here meant a
                // viewer got NONE of those features while a native
                // broadcast was mid-upgrade from the local-camera fallback
                // (see _armReelAgoraUpgradeRetry above) — exactly what was
                // reported: no icons, no expand, no video, just a toast.
                // Comments/like/share/gift don't need Agora at all — only
                // the video frame does. So this now ALWAYS opens the
                // overlay for any live card (every card that reaches this
                // button has a real streamId); the overlay itself shows a
                // "connecting to host's video…" placeholder in the video
                // frame only, and upgrades itself to real video
                // automatically the moment agoraChannel appears on the doc
                // (see the extras onSnapshot inside
                // _openReelLiveWatchOverlay) — no need to close/reopen.
                _openReelLiveWatchOverlay(watchBtn.dataset.streamId, watchBtn.dataset.youtubeId, watchBtn.dataset.title, watchBtn.dataset.hostName, watchBtn.dataset.category, watchBtn.dataset.agoraChannel, watchBtn.dataset.agoraUid, watchBtn.dataset.hostId);
                return;
            }
            /* FIX (Reel Live Broadcast Indicator spec — "Banner integration"):
               #dashboard-reel-live-banner-card (and the .dashboard-reel-live-card
               buttons rendered inside it by _renderLiveStrip above) previously had
               no click handler at all anywhere in the codebase — tapping the
               dashboard banner did nothing. As noted in _renderLiveStrip's own
               comment, these cards deliberately don't reuse .reels-live-watch-btn's
               handler (that one only knows how to reopen the YouTube-mode watch
               overlay and dead-ends on native camera broadcasts) — instead this
               just takes the viewer into the Reels section, where the live
               broadcast card (now spliced into the middle of the grid itself —
               see _renderLiveStrip's rebuild) already has everything needed to
               watch either broadcast mode correctly, and scrolls/highlights
               THAT card into view so it's immediately visible. */
            var dashLiveCard = e.target.closest && e.target.closest('.dashboard-reel-live-card');
            if (dashLiveCard) {
                if (typeof window.navigateTo === 'function') window.navigateTo('reels');
                setTimeout(function () {
                    var liveCardEl = document.getElementById('reels-live-broadcast-card');
                    if (liveCardEl && liveCardEl.scrollIntoView) {
                        liveCardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        liveCardEl.classList.add('reels-live-strip-highlight');
                        setTimeout(function () { liveCardEl.classList.remove('reels-live-strip-highlight'); }, 1600);
                    }
                }, 350);
                return;
            }
            if (e.target.closest && e.target.closest('#reels-yt-live-close-btn')) {
                if (_watchOverlayExtrasUnsub) { _watchOverlayExtrasUnsub(); _watchOverlayExtrasUnsub = null; }
                if (_watchOverlayCommentsUnsub) { _watchOverlayCommentsUnsub(); _watchOverlayCommentsUnsub = null; }
                _reelViewerOnVideo = null; // overlay is going away
                /* FEATURE (2026-08-13 — viewer count indicator): mirror
                   image of the increment in _openReelLiveWatchOverlay above
                   — only fires for a broadcast THIS viewer was actually
                   counted for (never for the host, never twice for a
                   minimize->reopen session, see _reelViewerCountedStreams'
                   own comment). The like button already carries
                   data-stream-id for exactly this broadcast, so it's reused
                   here rather than threading streamId through yet another
                   closure. */
                var exitLikeBtn = document.getElementById('reels-live-watch-like-btn');
                var exitStreamId = exitLikeBtn ? exitLikeBtn.dataset.streamId : '';
                if (exitStreamId && _reelViewerCountedStreams[exitStreamId] && window._firebaseLoaded && window.fbDb) {
                    var _FVvcExit = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) || null;
                    delete _reelViewerCountedStreams[exitStreamId];
                    if (_FVvcExit) {
                        window.fbDb.collection('reel_live_broadcasts').doc(exitStreamId).update({
                            viewerCount: _FVvcExit.increment(-1)
                        }).catch(function (err) {
                            console.warn('[Reel live viewer count]', err && err.message);
                        });
                    }
                }
                var ov = document.getElementById('reels-yt-live-overlay');
                if (ov) ov.remove();
                _reelRefreshCardPreview(); // back to the small screen (or leave if the card isn't showing it)
                return;
            }
            // FIX (2026-08-12 — minimize, viewer side): unlike Exit, this
            // does NOT call _leaveReelLiveAudience or tear down the extras/
            // comments listeners — the viewer stays joined to the Agora
            // channel and keeps receiving live comments/extras in the
            // background, exactly as if they'd just switched tabs within
            // the app. Tapping the featured card's watch button again
            // reopens a fresh overlay (that flow already calls
            // _leaveReelLiveAudience then rejoins cleanly, so there's no
            // duplicate-subscription risk either way).
            if (e.target.closest && e.target.closest('#reels-live-watch-minimize-btn')) {
                var watchOv = document.getElementById('reels-yt-live-overlay');
                if (watchOv) watchOv.remove();
                _reelViewerOnVideo = null;
                var _mcard = _liveBroadcastCardEl, _mscr = _mcard && _mcard.querySelector('#reels-live-featured-screen'), _mvid = _mscr && _mscr.querySelector('#reels-live-card-video');
                if (_mvid && _reelAgoraViewerClient && _reelAgoraViewerJoined) {
                    _reelRebindViewer(_mvid, function (h) { _mscr.classList.toggle('reels-live-card-has-video', !!h); }, !_reelCardMuted);
                } else { _reelRefreshCardPreview(); }
                return;
            }
            /* FIX (bug: "like/gift stopped working" on the featured card):
               .reels-live-tv-share-btn is the shared base pill class for
               EVERY button in the card's engagement row — Like
               (reels-live-card-like-btn), Comment
               (reels-live-card-comment-btn), Gift (reels-live-gift-btn),
               and the actual Share button all carry it, since they're
               meant to look like one visual family (see that class's own
               CSS comment further down this file). Like and Comment are
               matched by their OWN more specific classes earlier in this
               same listener and `return` before ever reaching here, but
               Gift has no earlier match in THIS listener (its real
               handling lives in a separate, correctly-scoped listener
               further down this file) — so a Gift tap fell through
               everything above it and landed here, on the base-class
               match alone, and this branch treated it as a Share tap: it
               called _shareReelLiveBroadcast() with the gift button's own
               dataset (no title/category — Gift never sets those), which
               in turn requires a REAL non-anonymous Firebase Auth session
               (_requireRealAccountForShare(), firebase-rules.js's
               isRealAccount() gate on `posts`) — exactly the "Missing or
               insufficient permissions" pattern reported, racing a
               confusing notification against the real gift picker that
               the OTHER listener still opened underneath it. Excluding
               every other pill in this row by class makes this match
               Share buttons only, regardless of what else ever gets added
               to this row in the future. */
            var shareBtnClicked = e.target.closest && e.target.closest('.reels-live-tv-share-btn:not(.reels-live-card-like-btn):not(.reels-live-card-comment-btn):not(.reels-live-gift-btn)');
            if (shareBtnClicked) {
                _shareReelLiveBroadcast(
                    shareBtnClicked.dataset.streamId,
                    shareBtnClicked.dataset.title,
                    shareBtnClicked.dataset.hostName,
                    shareBtnClicked.dataset.category
                );
                return;
            }
        });

        /* FIX (2026-08-12 — "enable the share button... clicking should
           rebroadcast or reshare the live in the user's feed"): no share
           entry point existed anywhere on the live broadcast card or
           watch overlay before this session — .reels-live-tv-share-btn
           above is new. A live broadcast can't be reposted the way a
           finished reel is (_rebroadcastReel above clones a video URL
           that doesn't exist yet for something still in progress), so
           this posts a normal text post to the sharer's own feed
           announcing the stream instead — same `posts` collection and
           shape app-fixes.js's own retweet/repost writes already use
           (id/userId/username/avatar/text/media/createdAt), so it needs
           no new feed-rendering code to show up correctly. Carries
           liveStreamId/liveChannelCategory too so a future feed click-
           through straight into the broadcast is a small, additive
           change rather than a schema migration.

           FIX (this session — "clicking share should open the share tab
           to enable copy link and share to other app"): the repost-to-
           feed above was the ONLY thing Share did — there was no way to
           actually copy a link or hand the broadcast to WhatsApp/Gmail/
           SMS/etc. the way every other Share button in this app already
           does (see app-thread.js's _openShareSheet, exposed as
           window._empShare — native OS share drawer on mobile, a copy-
           link sheet with working social links as its desktop fallback).
           Reusing THAT exact entry point here — rather than building a
           second, parallel share-sheet implementation — is what this
           does now. It's called FIRST and synchronously, before any of
           the guest/account/in-flight checks below: navigator.share()
           must fire synchronously inside the click's own call stack to
           satisfy the browser's user-gesture requirement (same
           constraint app-thread.js's own header already documents), and
           opening a share sheet to copy/forward a link is a read-only
           action that doesn't actually need the poster to be logged in
           — unlike the feed-repost below, which still is (and stays)
           gated exactly as before. */
        var _reelLiveShareInFlight = {};
        function _shareReelLiveBroadcast(streamId, title, hostName, category) {
            if (!streamId) { _notify('This broadcast is no longer available.', 'info'); return; }

            if (typeof window._empShare === 'function') {
                var meta0 = _catMeta(category);
                var shareText = '🔴 LIVE NOW: ' + (title || 'Live Broadcast') + ' — hosted by ' + (hostName || 'a broadcaster') + '. ' + (meta0.label || 'Broadcast') + ' on the Reel & Live Broadcast Channel — tap in to watch!';
                window._empShare(shareText, null);
            }

            if (_isGuest()) { return; } // guest can still use the share tab above; feed-repost below stays login-only
            if (!_requireRealAccountForShare()) return;
            var us = _us();
            var uid = us && us.id;
            if (!uid) return;
            if (_reelLiveShareInFlight[streamId]) return;
            _reelLiveShareInFlight[streamId] = true;
            function _done() { _reelLiveShareInFlight[streamId] = false; }
            if (!(window._firebaseLoaded && window.fbDb)) {
                _notify('Still connecting — please try again in a moment.', 'error');
                _done();
                return;
            }
            var meta = _catMeta(category);
            var postId = 'live-share-' + Date.now();
            var postDoc = {
                id: postId,
                userId: uid,
                username: us.fullName || us.username || 'User',
                avatar: us.avatar || '',
                text: '🔴 LIVE NOW: ' + (title || 'Live Broadcast') + ' — hosted by ' + (hostName || 'a broadcaster') + '. ' + (meta.label || 'Broadcast') + ' on the Reel & Live Broadcast Channel — tap in to watch!',
                media: [],
                isLiveShare: true,
                liveStreamId: streamId,
                liveChannelCategory: category || '',
                createdAt: new Date().toISOString()
            };
            window.fbDb.collection('posts').doc(postId).set(postDoc)
                .then(function () {
                    _notify('Shared to your feed! 🔁', 'success');
                    _reward('SHARE_POST');
                    _done();
                })
                .catch(function (err) {
                    _notify('Couldn\u2019t share right now — please try again.', 'error');
                    console.warn('[Reel live share]', err && err.message);
                    _done();
                });
        }

        /* ═══════════════════════════════════════════════════════════════
           GIFTING (this session) — "Implement a gifting system within the
           reel live broadcast channel. Viewers should be able to send
           gifts in real-time, similar to the TikTok model, with gifts
           appearing in the comments section during the live stream."

           Deliberately self-contained rather than reusing app-gifts.js's
           #live-gift-catalog-modal / window.handleSendGift / window.
           openGiftCatalog: that whole path is hardwired to window.
           liveStreamData and the dashboard's own #go-live-modal-overlay
           chat (window.createLiveComment) — it has no idea reel_live_
           broadcasts or its {streamId}/comments subcollection even exist.
           Wiring THIS channel through it would mean either editing that
           shared, already-fragile module (see its own header notes on
           the double-handler bugs already fought there) or duplicating
           its recipient-resolution logic on top of a data model it
           wasn't built for. Instead this reuses its DATA only — the
           already-published window.empyGiftCatalog (same gift list,
           prices, icons the rest of the app shows) — and drives its own
           picker, its own send handler, scoped to reel_live_broadcasts.

           Balance handling mirrors the existing convention in this
           codebase for gift/wallet moves that aren't run through a
           staking-style server API (see app-gifts.js's own
           handleSendGift and app-wallet.js's withdrawal-queue write):
           deduct locally from window.userState.empyBalance and persist
           via a direct client Firestore write — not a secured server
           transaction. That's a pre-existing tradeoff of this app's
           gifting feature in general, not something newly introduced
           here. */

        var _reelGiftFallbackCatalog = [
            { name: 'Rose',    symbol: '\uD83C\uDF39', price: 10 },
            { name: 'Heart',   symbol: '\u2764\uFE0F', price: 25 },
            { name: 'Star',    symbol: '\u2B50', price: 50 },
            { name: 'Crown',   symbol: '\uD83D\uDC51', price: 200 },
            { name: 'Rocket',  symbol: '\uD83D\uDE80', price: 500 }
        ];
        function _reelGiftCatalog() {
            var cat = window.empyGiftCatalog;
            return (Array.isArray(cat) && cat.length) ? cat : _reelGiftFallbackCatalog;
        }

        /* FIX (2026-08-12 — "enable multiple click send gift"): removed.
           This used to be a single global in-flight boolean that blocked
           ANY second gift send — from this stream, another stream, even a
           different gift — until the previous send's Firestore round trip
           finished, AND _sendReelLiveGift() closed the picker sheet on
           every successful send regardless. Together those meant only one
           gift could ever be sent per picker-open, full stop. Removed both
           the lock and the auto-close below so rapid repeat taps (TikTok-
           style multi-gift) each fire their own independent send; the
           sheet now only closes via its own close button or backdrop tap. */

        function _openReelGiftPicker(streamId, hostId, hostName) {
            if (_isGuest()) { _notify('Log in to send a gift.', 'info'); return; }
            if (!streamId) { _notify('This broadcast is no longer available.', 'info'); return; }
            var existing = document.getElementById('reels-live-gift-picker');
            if (existing) existing.remove();

            var pop = document.createElement('div');
            pop.id = 'reels-live-gift-picker';
            pop.dataset.streamId = streamId;
            pop.dataset.hostId = hostId || '';
            pop.dataset.hostName = hostName || 'Broadcaster';
            pop.innerHTML =
                '<div class="reels-live-gift-picker-sheet">'
                    + '<div class="reels-live-gift-picker-head">'
                        + '<span>Send a gift to ' + _esc(hostName || 'Broadcaster') + '</span>'
                        + '<button type="button" id="reels-live-gift-picker-close"><i class="fas fa-times"></i></button>'
                    + '</div>'
                    + '<div class="reels-live-gift-picker-grid">'
                        + _reelGiftCatalog().map(function (g) {
                            return '<button type="button" class="reels-live-gift-item" data-name="' + _esc(g.name) + '" data-symbol="' + _esc(g.symbol || '\uD83C\uDF81') + '" data-price="' + (g.price || 0) + '">'
                                + '<span class="reels-live-gift-item-icon">' + (g.symbol || '\uD83C\uDF81') + '</span>'
                                + '<span class="reels-live-gift-item-name">' + _esc(g.name) + '</span>'
                                + '<span class="reels-live-gift-item-price">' + (g.price || 0) + ' EMPY</span>'
                            + '</button>';
                        }).join('')
                    + '</div>'
                + '</div>';
            document.body.appendChild(pop);
        }

        function _sendReelLiveGift(streamId, hostId, hostName, gift) {
            if (_isGuest()) { _notify('Log in to send a gift.', 'info'); return; }
            var us = _us();
            if (!us.id) return;
            if (!gift || !gift.name) return;
            var price = Number(gift.price) || 0;
            if ((us.empyBalance || 0) < price) {
                _notify('Insufficient EMPY balance to send this gift.', 'error');
                return;
            }
            if (!(window._firebaseLoaded && window.fbDb)) {
                _notify('Still connecting — please try again in a moment.', 'error');
                return;
            }
            if (!_requireAnySessionForWrite()) return;

            // Deduct locally, same "client is the source of truth for this
            // feature" tradeoff app-gifts.js's own handleSendGift already
            // has (see the header note above).
            us.empyBalance -= price;
            if (typeof window.updateWalletUI === 'function') window.updateWalletUI();

            var FV = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) || null;
            var authorName   = us.name || us.username || 'Viewer';
            var authorAvatar = us.avatar || us.profilePic || '';

            // 1) Comment feed — this IS the "gifts appearing in the
            //    comments section" requirement; _mountLiveComments' own
            //    listener (already open on this streamId) picks this up
            //    and renders it with the highlighted gift treatment added
            //    above, no separate subscription needed.
            var commentWrite = window.fbDb.collection('reel_live_broadcasts').doc(streamId)
                .collection('comments').add({
                    type: 'gift',
                    text: '',
                    giftName: gift.name,
                    giftSymbol: gift.symbol || '\uD83C\uDF81',
                    amount: price,
                    authorId: us.id,
                    authorName: authorName,
                    authorAvatar: authorAvatar,
                    createdAt: new Date().toISOString()
                });

            // 2) Ledger entry — mirrors app-gifts.js's own `live_gifts`
            //    write (same collection, same shape) so this channel's
            //    gifts show up alongside every other gift transaction in
            //    that collection instead of forking a second one.
            var ledgerWrite = window.fbDb.collection('live_gifts').add({
                senderId: us.id,
                senderName: authorName,
                recipientId: hostId || null,
                recipientName: hostName || 'Broadcaster',
                streamId: streamId,
                origin: 'reels',
                giftName: gift.name,
                giftSymbol: gift.symbol || '\uD83C\uDF81',
                amount: price,
                createdAt: new Date().toISOString()
            });

            // 3) Credit the host's balance, best-effort — same direct
            //    client increment already used a few hundred lines up for
            //    like counts on this exact collection.
            var creditWrite = Promise.resolve();
            if (hostId && hostId !== us.id) {
                creditWrite = window.fbDb.collection('users').doc(hostId).update({
                    empyBalance: FV ? FV.increment(price) : price
                }).catch(function () {}); // best-effort — don't block the send on this
            }

            /* 2026-11-08: confirm instantly (the balance already dropped above) instead of waiting for three Firestore round trips; the catch below still refunds + reports a real failure. */
            _notify('\uD83C\uDF81 Sent ' + gift.name + ' (' + price + ' EMPY) to ' + (hostName || 'the host') + '!', 'success');
            Promise.all([commentWrite, ledgerWrite, creditWrite]).then(function () {
                _reward('SEND_GIFT');
            }).catch(function (err) {
                // Refund locally — the write(s) didn't confirm, don't leave
                // the sender's own balance display wrong.
                us.empyBalance += price;
                if (typeof window.updateWalletUI === 'function') window.updateWalletUI();
                _notify('Couldn\u2019t send the gift — please try again.', 'error');
                console.warn('[Reel live gift]', err && err.message);
            }).finally(function () {
                // Sheet intentionally stays open (see FIX comment above
                // _reelGiftSendInFlight's removal) so the person can tap
                // another gift, or the same one again, right away.
            });
        }

        document.addEventListener('click', function (e) {
            var giftBtn = e.target.closest && e.target.closest('.reels-live-gift-btn');
            if (giftBtn) {
                _openReelGiftPicker(giftBtn.dataset.streamId, giftBtn.dataset.hostId, giftBtn.dataset.hostName);
                return;
            }
            if (e.target.closest && e.target.closest('#reels-live-gift-picker-close')) {
                var pop1 = document.getElementById('reels-live-gift-picker');
                if (pop1) pop1.remove();
                return;
            }
            // Tapping the dimmed backdrop (outside the sheet) also closes it.
            if (e.target.id === 'reels-live-gift-picker') {
                e.target.remove();
                return;
            }
            var giftItemBtn = e.target.closest && e.target.closest('.reels-live-gift-item');
            if (giftItemBtn) {
                var pop2 = document.getElementById('reels-live-gift-picker');
                if (!pop2) return;
                _sendReelLiveGift(pop2.dataset.streamId, pop2.dataset.hostId, pop2.dataset.hostName, {
                    name: giftItemBtn.dataset.name,
                    symbol: giftItemBtn.dataset.symbol,
                    price: parseFloat(giftItemBtn.dataset.price) || 0
                });
                return;
            }
        });

        /* CSS for the strip/cards, the viewer watch overlay, and the host
           "You're Live" panel — all independent of anything app-live.js
           styles for the dashboard Go Live flow. */
        var liveStyle = document.createElement('style');
        liveStyle.textContent = [
            '#reels-live-strip { display:flex;gap:10px;overflow-x:auto;padding:0 16px 12px;scrollbar-width:none;scroll-snap-type:x proximity; }',
            '#reels-live-strip::-webkit-scrollbar { display:none; }',
            /* FIX (this session): the 2026-08-11 rebuild stopped populating
               this element entirely (the single live card now lives inside
               #reels-grid-container instead — see _renderLiveStrip), but it
               was left in the DOM at full padding, leaving a dead ~14px gap
               between "My Status" and the reel grid. Collapses to nothing
               now that it's always empty; the id stays for the
               highlight-on-arrival behavior elsewhere in this file. */
            '#reels-live-strip:empty { display:none; }',
            /* FIX (Reel Live Broadcast Indicator spec): brief highlight pulse
               so a viewer arriving here via the dashboard banner tap (see the
               .dashboard-reel-live-card click handler above) can immediately
               see which strip they were sent to. */
            '#reels-live-strip.reels-live-strip-highlight { animation:reelsLiveStripPulse 1.6s ease; }',
            '@keyframes reelsLiveStripPulse { 0%,100%{background:transparent;} 25%,75%{background:rgba(229,57,53,0.12);} }',
            /* Reel-section LIVE "television" cards (FIX 2026-08-12 —
               "no screen to watch it" / YouTube-style live card).
               #reels-live-strip's own flex/scroll rules above are
               unchanged — only the card inside it changed shape, from a
               72px circular avatar to a 190px video-thumbnail card. */
            '.reels-live-tv-card { flex:0 0 auto;width:190px;scroll-snap-align:center;background:#0d0d12;border:1px solid rgba(229,57,53,0.3);border-radius:14px;padding:0;overflow:hidden;text-align:left;cursor:pointer;display:flex;flex-direction:column;transition:transform 0.15s; }',
            '.reels-live-tv-card:active { transform:scale(0.97); }',
            '.reels-live-tv-screen { position:relative;width:100%;aspect-ratio:16/9;background:#000;overflow:hidden;display:block; }',
            '.reels-live-tv-frame { position:absolute;inset:0;width:100%;height:100%;object-fit:cover; }',
            /* Native-camera broadcasts have no pre-fetchable still frame —
               an animated "on-air" gradient (subtle scanline drift + a
               pulsing broadcast-tower glyph) stands in for a real preview
               frame so the card still reads as a live screen rather than
               a blank box. */
            '.reels-live-tv-onair { display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a0f0f,#2b1010,#1a0f0f);background-size:200% 200%;animation:reelsLiveOnAirDrift 6s ease infinite;color:rgba(255,255,255,0.35);font-size:1.6rem; }',
            '.reels-live-tv-onair i { animation:reelsLiveOnAirPulse 1.8s ease infinite; }',
            '@keyframes reelsLiveOnAirDrift { 0%,100%{background-position:0% 50%;} 50%{background-position:100% 50%;} }',
            '@keyframes reelsLiveOnAirPulse { 0%,100%{opacity:0.35;transform:scale(1);} 50%{opacity:0.8;transform:scale(1.12);} }',
            '.reels-live-tv-badge { position:absolute;top:7px;left:7px;display:inline-flex;align-items:center;gap:4px;background:#e53935;color:#fff;font-size:0.62rem;font-weight:800;letter-spacing:0.03em;padding:3px 8px;border-radius:20px;animation:reelsLiveBadgePulse 2s ease infinite; }',
            '.reels-live-tv-badge i { font-size:0.4rem; }',
            '@keyframes reelsLiveBadgePulse { 0%,100%{box-shadow:0 0 0 0 rgba(229,57,53,0.55);} 50%{box-shadow:0 0 0 4px rgba(229,57,53,0);} }',
            '.reels-live-tv-cat { position:absolute;top:7px;right:7px;display:inline-flex;align-items:center;gap:4px;background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);color:rgba(255,255,255,0.9);font-size:0.6rem;font-weight:600;padding:3px 7px;border-radius:20px; }',
            /* FEATURE (2026-08-13 — viewer count indicator): bottom-left,
               mirrors .reels-live-tv-badge's top-left placement so the two
               "LIVE" / "N watching" badges read as a matched pair on
               opposite corners from the play button. */
            '.reels-live-tv-viewers { position:absolute;bottom:8px;left:8px;display:inline-flex;align-items:center;gap:4px;background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);color:rgba(255,255,255,0.9);font-size:0.62rem;font-weight:700;padding:3px 8px;border-radius:20px; }',
            '.reels-live-tv-viewers i { font-size:0.62rem; }',
            '.reels-live-tv-play { position:absolute;bottom:8px;right:8px;width:26px;height:26px;border-radius:50%;background:rgba(0,0,0,0.55);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.62rem; }',
            '.reels-live-tv-info { display:flex;align-items:flex-start;gap:8px;padding:9px 10px 11px; }',
            '.reels-live-tv-avatar { flex-shrink:0;width:28px;height:28px;border-radius:50%;overflow:hidden;background:#1a0f0f;border:1.5px solid #e53935;display:flex;align-items:center;justify-content:center; }',
            '.reels-live-tv-avatar img { width:100%;height:100%;object-fit:cover; }',
            '.reels-live-tv-avatar-fallback { color:rgba(255,255,255,0.55);font-size:0.7rem; }',
            '.reels-live-tv-text { min-width:0;display:flex;flex-direction:column;gap:2px; }',
            '.reels-live-tv-title { color:#fff;font-size:0.76rem;font-weight:700;line-height:1.25;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical; }',
            '.reels-live-tv-host { color:rgba(255,255,255,0.55);font-size:0.66rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }',
            /* Idle "off-air" placeholder (FIX 2026-08-12) — same card
               shape as a live one, dimmer, static (no pulsing) so it
               reads as "the screen is here, just off" rather than an
               active broadcast. */
            '.reels-live-tv-card-idle { border-color:rgba(255,255,255,0.14); }',
            '.reels-live-tv-offair { display:flex;align-items:center;justify-content:center;background:#161616;color:rgba(255,255,255,0.28);font-size:1.5rem; }',
            '.reels-live-tv-badge-idle { background:rgba(255,255,255,0.16);color:rgba(255,255,255,0.75);animation:none; }',
            '.reels-live-tv-card-idle .reels-live-tv-title { color:rgba(255,255,255,0.85); }',
            '.reels-live-tv-card-idle .reels-live-tv-avatar { border-color:rgba(255,255,255,0.25); }',
            /* Replay cards reuse .reels-live-tv-badge but shouldn't pulse
               red like an actual live indicator — grey + no animation. */
            '.reels-live-tv-badge-replay { background:#455a64;animation:none; }',
            /* FIX (this session — "same card size as other card" / "avatar
               scrollable horizontally", the request that prompted the
               _renderLiveStrip rebuild above): .reels-live-tv-card is
               shared between two different things — the small 190px
               replay-strip buttons above (#reels-live-replay-strip,
               untouched, still exactly the card those rules describe) and
               the single #reels-live-broadcast-card spliced into the
               middle of #reels-grid-container. That second one already
               wins on width/background/border against the 190px rules
               above (id+class beats plain class, and the white/border
               rules on '#reels-grid-container .reel-card' — see the top of
               this file — take priority), so it was already exactly as
               wide as a real reel post. Two things were still genuinely
               missing, not just mis-overridden:
               1. .reels-live-tv-screen-wrap (the .reel-video-wrap used for
                  the featured screen) never had a height of its own — its
                  frame/badge/category/play children are all
                  position:absolute, so with no aspect-ratio the wrap
                  collapsed to 0px tall and the entire "screen" was
                  invisible, which is what actually produced the blank
                  card gap in the reported screenshots. Matched to the
                  exact aspect-ratio/max-height an ordinary (non-active)
                  reel post's own video uses (see
                  '#reels-grid-container .reel-card:not(.reel-card-active)
                  .reel-video-wrap > video' near the top of this file) so
                  the live card's screen is genuinely the same size as a
                  real reel's video, not an approximation.
               2. .live-broadcast-avatar-scroll / .live-broadcast-avatar-
                  item (new markup this session, see _renderLiveStrip) had
                  no CSS anywhere in the codebase at all — the row of host
                  avatars rendered as unstyled inline images with no
                  horizontal scrolling whatsoever. */
            '#reels-live-broadcast-card .reels-live-tv-screen-wrap { aspect-ratio:4/3;max-height:30vh;overflow:hidden; }',
            '.live-broadcast-avatar-scroll { display:flex;align-items:center;gap:10px;overflow-x:auto;padding:0 14px 2px;scrollbar-width:none;-webkit-overflow-scrolling:touch; }',
            '.live-broadcast-avatar-scroll::-webkit-scrollbar { display:none; }',
            '.live-broadcast-avatar-item { flex:0 0 auto;width:36px;height:36px;border-radius:50%;overflow:hidden;padding:0;border:2px solid transparent;background:var(--color-neutral-100,#eee);cursor:pointer;display:flex;align-items:center;justify-content:center; }',
            '.live-broadcast-avatar-item img { width:100%;height:100%;object-fit:cover;display:block; }',
            '.live-broadcast-avatar-item .reels-live-tv-avatar-fallback { width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-muted,#8A94A6);font-size:0.85rem; }',
            '.live-broadcast-avatar-item.active { border-color:#e53935; }',
            '.live-broadcast-avatar-item:active { transform:scale(0.92); }',
            '.reels-live-tv-strip { display:flex;align-items:center;gap:8px;overflow-x:auto;padding:10px 14px;background:#0d0d12;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity; }',
            '.reels-live-tv-strip::-webkit-scrollbar { display:none; }',
            '.reels-live-tv-strip-label { flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;color:#fff;background:#f00;font-size:12px;font-weight:500;letter-spacing:.5px;line-height:16px;padding:4px 10px;border-radius:4px; }',
            '.reels-live-tv-strip-label i { font-size:0.45rem; }',
            '.reels-live-chip { flex:0 0 auto;scroll-snap-align:start;display:inline-flex;align-items:center;gap:6px;color:#fff;background:rgba(255,255,255,0.12);border:0;border-radius:16px;padding:5px 12px;font-size:13px;font-weight:500;line-height:18px;white-space:nowrap;cursor:pointer;font-family:inherit; }',
            '.reels-live-chip i { font-size:0.75rem;opacity:.85; }',
            '.reels-live-chip-on { background:rgba(255,255,255,0.2); }',
            '.reels-live-chip:active { transform:scale(0.96); }',
            /* Idle "no broadcast" fallback icon in the meta row — reuses
               .reel-meta-avatar's own 36x36/round sizing (it's applied as
               a second class on that exact span), just needed centering/
               colour for the icon glyph inside it. */
            '.reels-live-tv-avatar-fallback-solo { display:flex;align-items:center;justify-content:center;background:var(--color-neutral-100,#eee);color:var(--text-muted,#8A94A6); }',
            /* Rectangular info-card style — still used by the dashboard's
               #dashboard-reel-live-banner mini-preview (see index.html /
               .dashboard-reel-live-card), just no longer by the Reels
               section's own strip above. */
            '.reels-live-strip-card { flex:0 0 auto;width:150px;text-align:left;background:linear-gradient(160deg,#1a0f0f,#2b1010);border:1px solid rgba(229,57,53,0.35);border-radius:14px;padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;gap:4px; }',
            '.reels-live-strip-card:active { transform:scale(0.97); }',
            '.reels-live-strip-tag { display:inline-flex;align-items:center;gap:4px;background:#e53935;color:#fff;font-size:0.62rem;font-weight:800;letter-spacing:0.03em;padding:2px 7px;border-radius:20px;width:fit-content; }',
            '.reels-live-strip-tag i { font-size:0.4rem; }',
            '.reels-live-strip-cat { color:rgba(255,255,255,0.65);font-size:0.66rem;font-weight:600; }',
            '.reels-live-strip-title { color:#fff;font-size:0.78rem;font-weight:700;line-height:1.25;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical; }',
            '.reels-live-strip-host { color:rgba(255,255,255,0.55);font-size:0.68rem; }',
            /* 2026-11-04 — dashboard "live now" cards: horizontally scrollable, snap, tappable to watch */
            '#dashboard-reel-live-banner { display:flex;gap:12px;overflow-x:auto;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity;padding:2px 2px 8px; }',
            '.reels-live-strip-card.dashboard-reel-live-card { width:200px;scroll-snap-align:start;gap:6px;padding:12px;border-radius:16px; }',
            '.dash-live-top { display:flex;align-items:center;justify-content:space-between;gap:8px; }',
            '.dash-live-avatar { width:40px;height:40px;border-radius:50%;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.1);color:#fff;box-shadow:0 0 0 2px #e53935;animation:dashLiveRing 1.6s ease-in-out infinite; }',
            '.dash-live-avatar img { width:100%;height:100%;object-fit:cover;display:block; }',
            '.dash-live-cta { margin-top:4px;display:inline-flex;align-items:center;gap:6px;color:#fff;font-size:0.72rem;font-weight:700;background:rgba(229,57,53,0.85);padding:5px 10px;border-radius:20px;width:fit-content; }',
            '.dash-live-join-link, .dash-live-join-link:visited { text-decoration:none;color:#fff; }',
            '.dash-live-join-link:active { transform:scale(0.96); }',
            '@keyframes dashLiveRing { 0%,100% { box-shadow:0 0 0 2px #e53935,0 0 0 4px rgba(229,57,53,0.0); } 50% { box-shadow:0 0 0 2px #e53935,0 0 0 6px rgba(229,57,53,0.28); } }',
            '.reel-topbar-live-btn { background:linear-gradient(135deg,#e53935,#c62828) !important; }',
            /* Shared "Exit" button look, used by BOTH the viewer watch
               overlay and the host live panel. */
            '.reels-live-exit-btn { flex-shrink:0;display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.28);color:#fff;padding:9px 14px;border-radius:20px;font-size:0.82rem;font-weight:700;cursor:pointer; }',
            '.reels-live-exit-btn:hover { background:rgba(229,57,53,0.8); }',
            '.reels-live-exit-btn:active { transform:scale(0.95); }',
            /* End Live (2026-08-12) — always visibly red/destructive, not
               just on hover, so it reads as distinct from the neutral
               Minimize button right next to it. */
            '.reels-live-end-btn { background:rgba(229,57,53,0.85);border-color:transparent; }',
            '.reels-live-end-btn:hover { background:rgba(200,35,30,0.95); }',
            /* Viewer watch overlay */
            '#reels-yt-live-overlay { position:fixed;inset:0;z-index:10400;background:#000;display:flex;flex-direction:column;overflow:hidden; }',
            '.reels-yt-live-overlay-top { display:flex;align-items:center;justify-content:space-between;gap:10px;padding:calc(12px + env(safe-area-inset-top,0px)) 14px 12px;background:#0a0a0a;flex-shrink:0; }',
            '.reels-yt-live-overlay-info { min-width:0; }',
            '.reels-yt-live-overlay-title { color:#fff;font-weight:700;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }',
            '.reels-yt-live-overlay-host { color:rgba(255,255,255,0.6);font-size:0.75rem; }',
            '.reels-yt-live-overlay-frame { flex:1;position:relative;min-height:90px; }',
            '.reels-yt-live-overlay-frame iframe { position:absolute;inset:0;width:100%;height:100%;border:0; }',
            /* Native-viewer "connecting" placeholder + live comments panel
               (2026-08-12) — both wired into _openReelLiveWatchOverlay for
               the first time this session (see that function's own
               comment), so neither had any styling anywhere before now. */
            '.reels-live-viewer-connecting { position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.75);font-size:0.85rem;font-weight:600;text-align:center;padding:0 24px;background:rgba(0,0,0,0.35); }',
            '.reels-live-viewer-comments { flex-shrink:0;max-height:34vh;display:flex;flex-direction:column;background:#0a0a0a;border-top:1px solid rgba(255,255,255,0.08); }',
            '.reels-live-comments-list { flex:1;min-height:60px;max-height:26vh;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px; }',
            '.reels-live-comment-row { display:flex;align-items:flex-start;gap:8px; }',
            '.reels-live-comment-avatar { width:24px;height:24px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,0.12);flex-shrink:0; }',
            '.reels-live-comment-body { color:#fff;font-size:0.78rem;line-height:1.35;word-break:break-word; }',
            '.reels-live-comment-author { font-weight:700;color:rgba(255,255,255,0.85); }',
            '.reels-live-comment-text { color:rgba(255,255,255,0.9); }',
            '.reels-live-comments-form { display:flex;align-items:center;gap:8px;padding:10px 14px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(255,255,255,0.08);flex-shrink:0; }',
            '.reels-live-comments-form input { flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);color:#fff;border-radius:20px;padding:9px 14px;font-size:0.82rem;min-width:0; }',
            '.reels-live-comments-form input::placeholder { color:rgba(255,255,255,0.4); }',
            '.reels-live-comments-form button { flex-shrink:0;width:36px;height:36px;border-radius:50%;background:#e53935;border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer; }',
            '.reels-live-comments-form button:active { transform:scale(0.92); }',
            /* Host "You're Live" panel */
            '#reels-live-host-panel-overlay { position:fixed;inset:0;z-index:10400;background:#000;display:flex;flex-direction:column; }',
            '.reels-live-host-panel-top { display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top,0px)) 14px 12px;background:#0a0a0a;flex-shrink:0; }',
            '.reels-live-host-panel-badge { display:inline-flex;align-items:center;gap:5px;background:#e53935;color:#fff;font-size:0.68rem;font-weight:800;letter-spacing:0.03em;padding:4px 10px;border-radius:20px;flex-shrink:0; }',
            '.reels-live-host-panel-badge i { font-size:0.45rem; }',
            '.reels-live-host-panel-info { min-width:0;flex:1; }',
            '.reels-live-host-panel-title { color:#fff;font-weight:700;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }',
            '.reels-live-host-panel-cat { color:rgba(255,255,255,0.65);font-size:0.72rem; }',
            '.reels-live-host-panel-frame { flex:1;position:relative; }',
            '.reels-live-host-panel-frame iframe { position:absolute;inset:0;width:100%;height:100%;border:0; }',
            '.reels-live-host-panel-note { margin:0;padding:12px 16px calc(14px + env(safe-area-inset-bottom,0px));background:#0a0a0a;color:rgba(255,255,255,0.6);font-size:0.75rem;line-height:1.4;flex-shrink:0; }',
            /* Native camera preview + its control row — FIX (2026-08-11):
               these three classes were used in the host panel markup above
               but had no CSS anywhere in the codebase at all, so the
               preview had no explicit sizing/position and the mic/camera/
               switch-camera buttons rendered as bare unstyled browser
               buttons stacked over the video instead of the floating
               pill-row every other live-panel control here uses. */
            '.reels-live-native-frame { position:absolute;inset:0;width:100%;height:100%;background:#000;overflow:hidden; }',
            '.reels-live-card-video { background:transparent;pointer-events:none;z-index:1; }',
            '.reels-live-card-has-video .reels-live-tv-onair { display:none; }',
            '.reels-live-card-mini-actions { position:absolute;right:8px;bottom:42px;z-index:6;display:flex;flex-direction:column;gap:8px; }',
            '.reels-live-card-mini-btn { width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,0.28);background:rgba(10,10,10,0.55);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.95rem;cursor:pointer;padding:0;-webkit-tap-highlight-color:transparent; }',
            '.reels-live-card-mini-btn:active { transform:scale(0.9); }',
            '.reels-live-card-mini-btn.liked i { color:#f87171; }',
            '.reels-live-card-mini-btn.reels-live-gift-btn { color:#ffd166; }',
            '#reels-live-featured-screen .reels-live-tv-badge, #reels-live-featured-screen .reels-live-tv-cat, #reels-live-featured-screen .reels-live-tv-viewers, #reels-live-featured-screen .reels-live-tv-play { z-index:3; }',
            '.reels-live-native-frame video { width:100%;height:100%;object-fit:cover; }',
            '.reels-live-native-controls { position:absolute;left:0;right:0;bottom:14px;display:flex;align-items:center;justify-content:center;gap:12px;z-index:2; }',
            '.reels-live-native-ctrl-btn { width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.16);border:1px solid rgba(255,255,255,0.3);color:#fff;font-size:1rem;display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(6px); }',
            '.reels-live-native-ctrl-btn:active { transform:scale(0.92); }',
            '.reels-live-native-ctrl-btn.muted { background:rgba(229,57,53,0.85);border-color:transparent; }',
            '.reels-live-native-ctrl-btn:disabled { opacity:0.45;cursor:default; }',
            '#reels-live-native-switch-cam-btn i { transition:transform 0.3s ease; }',
            /* Premium mic badge (2026-08-12) — rounded-square dark-gradient
               button matching the requested reference icon, overriding the
               generic translucent-circle look the other two controls keep.
               ID selector beats the plain-class rule above regardless of
               source order, so no !important needed. Kept dark in both
               states on purpose (matches the reference icon, which signals
               muted purely via the slash glyph, not a color change) — the
               red .muted background above is overridden back to the same
               gradient here so this one button doesn't flash red while its
               two siblings do. */
            '#reels-live-native-mic-btn { border-radius:14px;background:linear-gradient(160deg,#2b3140,#05060a);border:none;box-shadow:0 2px 8px rgba(0,0,0,0.35); }',
            '#reels-live-native-mic-btn.muted { background:linear-gradient(160deg,#2b3140,#05060a); }',
            /* Share row (2026-08-12) on the featured grid card, between the
               caption and the avatar strip. */
            '.reels-live-tv-share-row { padding:0 14px 6px; }',
            /* FIX (2026-08-12 — "only gift icon renders correctly, others
               are broken"): color:var(--text-secondary) was resolving to
               something invisible against this pill's white background —
               icon AND label both vanished, leaving just the empty
               outlined pill shape (Gift survived only because its own
               rule further down already overrides this with an explicit
               color). Swapped to the same explicit color the rest of the
               app's action-row icons already use (see .action-btn in
               style.css/index.html) so this can't silently break again if
               that token ever changes. */
            '.reels-live-tv-share-btn { display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:6px 12px;border-radius:999px;border:1px solid var(--border);background:var(--color-white);color:#536471;font-size:0.82rem;font-weight:600;cursor:pointer; }',
            '.reels-live-tv-share-btn:active { transform:scale(0.96); }',
            /* REMOVED (2026-08-12): .reels-live-card-share-btn forced the
               featured card's Share button into a 34px icon-only circle.
               No longer applied to any markup — both this card's Share
               button and the watch-overlay cluster's now use
               .reels-live-tv-share-btn's own white-pill-with-label style
               unmodified (see that rule below). Left this note instead of
               silently deleting the rule so a future session searching
               for "reels-live-card-share-btn" finds why it's gone rather
               than assuming it was missed. */
            /* ENGAGEMENT ROW (this session — "engagement buttons remain
               visible in the fixed-screen horizontal scrollable card"):
               Like/Comment/Share/Gift now share this row on the pinned/
               featured card (previously Share-only, hence the row itself
               being renamed to add the -engagement- class alongside the
               original -share- one rather than replacing it, so nothing
               that already targeted .reels-live-tv-share-row breaks).
               Horizontally scrollable rather than wrapping, so a narrow
               phone never pushes the row taller than one compact line —
               same "stay compact" instruction this session's overlay
               bottom-bar redesign below is also built around. */
            '.reels-live-tv-engagement-row { display:flex;align-items:center;gap:8px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch; }',
            '.reels-live-tv-engagement-row::-webkit-scrollbar { display:none; }',
            '.reels-live-tv-engagement-row .reels-live-tv-share-btn { flex-shrink:0; }',
            /* Like button on the card — same pill look as its Share/Comment
               siblings, but reads red once liked (mirrors the fullscreen
               overlay's own far/fas heart-icon swap). */
            '.reels-live-card-like-btn.liked { color:#e53935;border-color:rgba(229,57,53,0.35); }',
            '.reels-live-card-like-btn.liked i { color:#e53935; }',
            /* Gift button on the card reuses .reels-live-gift-btn's own
               accent color rule further down (color:#ffd166) — but that
               rule was written for the DARK overlay bottom-bar, and this
               card is light-mode, so it needs its own override here to
               stay legible against the white pill background. */
            '.reels-live-tv-engagement-row .reels-live-gift-btn { color:#b8860b;border-color:rgba(184,134,11,0.3); }',
            /* Same button reused inside the dark viewer-overlay top bar
               (see .reels-yt-live-overlay-top below) — needs light-on-dark
               colors there instead of the card's light-mode ones. */
            '.reels-yt-live-overlay-top .reels-live-tv-share-btn { border-radius:20px; }',
            /* COMPACT BOTTOM ENGAGEMENT BAR (this session — "move the
               engagement and interactive buttons to the bottom of the
               screen and ensure they are compact... hide them inside a
               chevron icon"): floats over the bottom-right corner of the
               video frame instead of crowding the top bar. Collapsed by
               default (.collapsed on both the actions cluster and the
               toggle button itself, set at markup time in
               _openReelLiveWatchOverlay) — icon-only 42px circles instead
               of the top bar's old text-label pills, which is what keeps
               this genuinely compact rather than just relocated. */
            '.reels-live-overlay-bottom-bar { position:absolute;right:12px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:6;display:flex;flex-direction:column;align-items:flex-end;gap:10px; }',
            '.reels-live-bottom-actions { display:flex;flex-direction:column;align-items:center;gap:10px;max-height:220px;opacity:1;transition:opacity 0.2s ease,transform 0.2s ease,max-height 0.2s ease; }',
            '.reels-live-bottom-actions.collapsed { opacity:0;max-height:0;overflow:hidden;pointer-events:none;transform:translateY(8px); }',
            '.reels-live-bottom-action-btn { width:42px;height:42px;border-radius:50%;background:rgba(10,10,10,0.6);border:1px solid rgba(255,255,255,0.24);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:pointer;font-size:0.58rem;font-weight:700;line-height:1;backdrop-filter:blur(6px); }',
            '.reels-live-bottom-action-btn i { font-size:1.05rem; }',
            '.reels-live-bottom-action-btn:active { transform:scale(0.92); }',
            '.reels-live-bottom-action-btn.liked i { color:#f87171; }',
            '.reels-live-bottom-toggle-btn { width:36px;height:36px;border-radius:50%;background:rgba(10,10,10,0.7);border:1px solid rgba(255,255,255,0.28);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer; }',
            '.reels-live-bottom-toggle-btn i { transition:transform 0.25s ease; }',
            '.reels-live-bottom-toggle-btn:active { transform:scale(0.92); }',
            '.reels-live-bottom-toggle-btn.collapsed i { transform:rotate(180deg); }',
            /* Inline comment sheet (this session) opened from the pinned
               card's own Comment button — same bottom-sheet pattern as the
               gift picker (#reels-live-gift-picker) just below, but dark to
               match the comment list/form styles _mountLiveComments()
               already renders into it (.reels-live-comments-list/-form
               further up were built for a dark host, not the gift picker's
               white one). */
            '#reels-live-comment-sheet { position:fixed;inset:0;z-index:1000000;background:rgba(0,0,0,0.5);display:flex;align-items:flex-end;justify-content:center; }',
            '.reels-live-comment-sheet-inner { background:#0f0f19;width:100%;max-width:520px;border-radius:18px 18px 0 0;display:flex;flex-direction:column;max-height:72vh;overflow:hidden; }',
            '.reels-live-comment-sheet-head { display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.1);color:#fff;font-weight:700;font-size:0.9rem;flex-shrink:0; }',
            '.reels-live-comment-sheet-head button { background:none;border:none;color:rgba(255,255,255,0.6);font-size:1rem;cursor:pointer; }',
            '.reels-live-comment-sheet-body { display:flex;flex-direction:column;flex:1;min-height:0; }',
            '.reels-live-comment-sheet-body .reels-live-comments-list { max-height:none; }',
            /* ── Category extras (2026-08-11) ── */
            '.reels-live-extras-group { display:none; }',
            '.reels-live-replay-tag { background:#455a64 !important; }',
            /* Host scoreboard controls */
            '.reels-live-host-scoreboard { display:flex;gap:10px;padding:12px 16px;background:#0a0a0a;flex-shrink:0;border-top:1px solid rgba(255,255,255,0.08); }',
            '.reels-live-host-scoreboard-team { flex:1;display:flex;align-items:center;gap:8px;color:#fff;font-size:0.78rem;font-weight:700; }',
            '.reels-live-host-score-val { margin-left:auto;font-size:1rem;min-width:22px;text-align:center; }',
            '.reels-live-score-btn { background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.25);color:#fff;width:30px;height:30px;border-radius:8px;font-size:0.75rem;font-weight:800;cursor:pointer; }',
            '.reels-live-score-btn:active { transform:scale(0.92); }',
            /* Viewer-facing extras bar (under the video in the watch overlay) */
            '#reels-yt-live-extras { flex-shrink:0;background:#0a0a0a;border-top:1px solid rgba(255,255,255,0.08); }',
            '.reels-live-vt-scoreboard { display:flex;align-items:center;justify-content:center;gap:14px;padding:12px 16px;color:#fff; }',
            '.reels-live-vt-team { font-size:0.8rem;font-weight:700;max-width:38vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }',
            '.reels-live-vt-score { font-size:1.15rem;font-weight:800;letter-spacing:0.02em; }',
            '.reels-live-vt-donate-btn { display:flex;align-items:center;justify-content:center;gap:8px;margin:12px 16px;padding:11px;background:linear-gradient(135deg,#2e7d32,#1b5e20);color:#fff;border-radius:20px;font-weight:700;font-size:0.85rem;text-decoration:none; }',
            '.reels-live-vt-program-note { padding:11px 16px;color:rgba(255,255,255,0.85);font-size:0.8rem;display:flex;align-items:center;gap:8px; }',
            '.reels-live-vt-poll { padding:12px 16px; }',
            '.reels-live-vt-poll-q { color:#fff;font-weight:700;font-size:0.82rem;margin-bottom:10px; }',
            '.reels-live-vt-poll-opt { position:relative;display:block;width:100%;text-align:left;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);color:#fff;border-radius:10px;padding:10px 12px;font-size:0.8rem;font-weight:600;margin-bottom:8px;cursor:pointer;overflow:hidden; }',
            '.reels-live-vt-poll-opt:disabled { cursor:default; }',
            '.reels-live-vt-poll-fill { position:absolute;top:0;left:0;bottom:0;background:rgba(229,57,53,0.35);transition:width 0.3s ease;z-index:0; }',
            '.reels-live-vt-poll-label { position:relative;z-index:1; }',
            /* ── Composer modal (#reels-live-connect-modal-overlay) — FIX
               (2026-08-11): this modal uses the generic .modal-overlay/
               .modal-content/.modal-header/.modal-close-btn classes, but
               NONE of those four classes had any CSS anywhere in this
               codebase (cart-modal-overlay, the only other .modal-overlay
               consumer, self-positions via its own .cart-modal class and
               never relied on them either) — so this composer rendered
               completely unstyled: no centering, no card background, no
               scroll clamp, and its header (title + × close button) had
               no sticky/z-index handling, so on a tall viewport or with a
               toast up top it could scroll or get covered out of reach —
               reported back as "no way to exit the go-live tab". Also
               #reels-fixed-topbar sits at z-index:550 (see below in this
               file) while the generic --z-overlay tier this modal
               inherited is only 100, so the Reels topbar visually
               overlapped the modal too. All fixed here, scoped to this
               modal's own id so cart-modal-overlay is untouched. */
            '#reels-live-connect-modal-overlay.modal-overlay { z-index:601;align-items:flex-start;justify-content:center;padding:5vh 14px;overflow-y:auto; }',
            '#reels-live-connect-modal-overlay .modal-content { background:var(--color-white,#fff);border-radius:var(--radius-xl,16px);box-shadow:var(--shadow-xl,0 20px 40px rgba(0,0,0,0.25));width:100%;max-width:420px;max-height:92vh;overflow-y:auto;padding:0 20px 20px;position:relative; }',
            '#reels-live-connect-modal-overlay .modal-header { position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--color-white,#fff);margin:0 -20px 14px;padding:18px 20px 12px;border-bottom:1px solid rgba(10,14,39,0.08); }',
            '#reels-live-connect-modal-overlay .modal-header h3 { margin:0;font-size:0.98rem;display:flex;align-items:center;gap:8px; }',
            '#reels-live-connect-modal-overlay .modal-close-btn { background:rgba(10,14,39,0.06);border:none;width:32px;height:32px;border-radius:50%;font-size:1.4rem;line-height:1;color:var(--text-muted,#5b6472);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center; }',
            '#reels-live-connect-modal-overlay .modal-close-btn:active { background:rgba(10,14,39,0.12); }',
            /* Broadcast-source toggle (Camera / YouTube) — had no styling
               at all, so it rendered as bare default browser buttons. */
            '.reels-live-mode-btn { flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:#f3f4f6;border:1px solid rgba(10,14,39,0.12);color:var(--text-muted,#5b6472);font-weight:700;font-size:0.82rem;padding:10px 8px;border-radius:10px;cursor:pointer; }',
            '.reels-live-mode-btn.active { background:linear-gradient(135deg,#e53935,#c62828);border-color:transparent;color:#fff; }',
            '.reels-live-mode-btn:active { transform:scale(0.97); }',
            /* Composer footer Exit button (2026-08-11 — "insert an exit
               button to navigate out from the go-live tab"): the header's
               × close button already worked functionally, but sat in the
               same top-right corner #reward-notification's toast uses
               (top:20px;right:20px, pointer-events:auto while .show) — so
               while an error toast was visible (exactly what happened when
               the native camera attempt failed) it could sit on top of and
               intercept taps meant for that × for the toast's ~3.5s
               lifetime. This second, clearly-labeled Exit button lives in
               the footer instead, next to Go Live Now — a screen region
               the toast never reaches — so there is always at least one
               reachable way out of this modal regardless of toast state.
               Reuses the same light, card-friendly button look (the shared
               .reels-live-exit-btn class above is styled for the DARK
               video-overlay panels, wrong contrast on this white card). */
            '.reels-live-composer-footer { display:flex;gap:10px;margin-top:4px; }',
            '.reels-live-composer-exit-btn { flex:0 0 auto;background:#f3f4f6;border:1px solid rgba(10,14,39,0.12);color:var(--text-muted,#5b6472);padding:13px 18px;border-radius:24px;font-weight:700;font-size:0.9rem;cursor:pointer;display:inline-flex;align-items:center;gap:6px; }',
            '.reels-live-composer-exit-btn:active { background:rgba(10,14,39,0.1); }',
            /* FIX (2026-08-11, this session — "2 reel live broadcast
               indicators on the dashboard"): the separate small
               avatar-thumbnail strip added last session duplicated this
               same "someone's live" signal already shown by the
               dashCard/dashBanner card below, so it's been removed —
               back down to one dashboard indicator. In its place, the
               existing strip/banner cards below now carry the host's own
               avatar directly (see .reels-live-strip-avatar), so the
               "avatar" part of that request isn't lost, just folded into
               the one card instead of living in a second element. */
            '.reels-live-strip-top-row { display:flex;align-items:center;gap:6px; }',
            '.reels-live-strip-avatar { width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid rgba(255,255,255,0.5); }',

            /* GIFTING (this session) */
            '.reels-live-gift-btn { color:#ffd166; }',
            '.reels-live-comment-row-gift { background:rgba(255,209,102,0.14);border-radius:10px;padding:4px 8px;margin:2px -8px; }',
            '.reels-live-comment-gift-text { color:#b8860b;font-weight:600; }',
            '.reels-live-comment-gift-icon { font-size:1rem; }',
            /* FIX (2026-08-12 — "rose and Empy token doesn't render well
               after sending", screenshots show each filling almost the
               whole screen): same root cause already documented and fixed
               for the gift PICKER's tiles below
               (.reels-live-gift-item-icon img) — app-gifts.js's
               GIFT_ICONS['Empy Token']/['Rose'] are <img> HTML, not emoji
               text, and c.giftSymbol here (in _mountLiveComments' gift-row
               renderer above) gets echoed straight into this span as-is.
               An <img> ignores a sibling emoji's font-size and rendered at
               its native resolution instead — that fix only ever capped
               the picker's copy of the same markup, not this comment-feed
               copy. Capped to the same ~1rem/16px footprint as the emoji
               gift icons this line already sits next to (Like/Coffee/Star
               etc.), so Rose/Empy Token read as one more inline icon in
               the gift line instead of taking over the screen. */
            '.reels-live-comment-gift-icon img { width:16px;height:16px;object-fit:contain;display:inline-block;vertical-align:-3px; }',
            '.reels-live-comment-gift-amt { color:#b8860b;font-size:0.78rem;font-weight:700; }',
            '#reels-live-gift-picker { position:fixed;inset:0;z-index:1000000;background:rgba(0,0,0,0.5);display:flex;align-items:flex-end;justify-content:center; }',
            '.reels-live-gift-picker-sheet { background:#fff;width:100%;max-width:520px;border-radius:18px 18px 0 0;padding:14px 16px 20px;max-height:60vh;overflow-y:auto; }',
            '.reels-live-gift-picker-head { display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:0.95rem;margin-bottom:12px; }',
            '.reels-live-gift-picker-head button { background:none;border:none;font-size:1rem;color:var(--text-muted,#5b6472);cursor:pointer; }',
            '.reels-live-gift-picker-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:10px; }',
            '.reels-live-gift-item { display:flex;flex-direction:column;align-items:center;gap:2px;background:#f8f9fb;border:1px solid rgba(10,14,39,0.08);border-radius:12px;padding:10px 6px;cursor:pointer; }',
            '.reels-live-gift-item:active { background:rgba(0,212,170,0.12); }',
            '.reels-live-gift-item-icon { font-size:1.6rem;display:flex;align-items:center;justify-content:center;height:26px; }',
            /* FIX (this session — "Empy Token/Rose gift icons oversized"):
               g.symbol for these two entries isn't emoji text like every
               other gift here — app-gifts.js's GIFT_ICONS['Empy Token']/
               ['Rose'] are real <img> HTML strings (EMPY_TOKEN_IMG_HTML/
               ROSE_IMG_HTML), reused as-is by _reelGiftCatalog() above so
               this picker shows the exact same art as the rest of the app.
               An <img> has its own intrinsic pixel size and doesn't shrink
               to match a sibling emoji's font-size the way text does, so
               without an explicit cap it rendered at its native (much
               larger) resolution — filling the whole tile instead of
               sitting inside it like Heart/Coffee/Star/Like. Capped to the
               same visual footprint as the 1.6rem (~26px) emoji glyphs
               above so every tile in this grid reads as the same size. */
            '.reels-live-gift-item-icon img { width:26px;height:26px;object-fit:contain;display:block; }',
            '.reels-live-gift-item-name { font-size:0.76rem;font-weight:600; }',
            '.reels-live-gift-item-price { font-size:0.7rem;color:#C9A66B;font-weight:700; }',
        ].join('\n');
        document.head.appendChild(liveStyle);
    })();

    /* FIRESTORE RULES — REEL & LIVE BROADCAST CHANNEL (2026-08-11, DEPLOYED):
       this channel writes to its own `reel_live_broadcasts` collection
       (see above), not `active_streams`. The matching rule now actually
       lives in firebase-rules.js (search that file for
       `match /reel_live_broadcasts`) — this used to be a draft-only
       comment here with nothing deployed, which is exactly the kind of
       gap that produces a silent "insufficient permissions" failure with
       no visible error in this codebase's history (see stream_replays/
       scheduled_streams' own comments in that file for two prior
       examples). The deployed rule intentionally does NOT match the
       strict `hostId == request.auth.uid` shape drafted below — it
       follows active_streams' own relaxed `auth != null` precedent
       instead, because hostId here is written from the app's own
       userState.id, which is not guaranteed to equal the real Firebase
       Auth uid (see firebase-rules.js's comment on this collection for
       the full explanation). The shape originally sketched here:

         match /reel_live_broadcasts/{streamId} {
           allow read: if true;
           allow create: if request.auth != null
             && request.resource.data.hostId == request.auth.uid
             && request.resource.data.isLive == true;
           // UPDATED (2026-08-11 — category extras): update is no longer
           // host-only. Poll voting (_openReelLiveWatchOverlay's click
           // handler above) writes extras.poll.options/voterIds from ANY
           // logged-in viewer, not just the host — same "any authenticated
           // user can update" tradeoff this codebase already accepts for
           // active_streams (see app-firebase-rules.js's own comment on
           // that collection, and app-live-tiktok-patch.js's guests array).
           // hostId itself still can't be reassigned by anyone.
           allow update: if request.auth != null
             && request.resource.data.hostId == resource.data.hostId;
           allow delete: if request.auth != null
             && resource.data.hostId == request.auth.uid;
         }

       (read: public, same as active_streams, so the "Live Now" strip works
       for logged-out viewers too; create: only as your own hostId;
       update: any logged-in user, but hostId can never change — this is
       what lets a viewer vote on a poll while only the host can move the
       scoreboard/end the broadcast, enforced client-side the same way
       every other host-only action in this app already is; delete: only
       the broadcasting host's own uid.) */

    /* MANUAL HORIZONTAL SWIPE (2026-08-10): lets the person swipe left/right
       on the pinned "now playing" card itself to move to the next/previous
       reel on demand, on top of the automatic advance-on-finish above.
       Delegated on document (cards are re-created/reordered constantly) and
       scoped to only the currently-active card's video/caption area — never
       a control (play/pause, mute, kebab, comment, avatar) — so a swipe
       never hijacks a button press, and never fires from a swipe started
       elsewhere in the page. */
    (function _wireGridSwipe() {
        var startX = 0, startY = 0, tracking = false;
        var IGNORE_SEL = '.reel-audio-controls, .reel-kebab-wrap, .reel-meta-comment-btn, .reel-meta-left, .reel-now-playing-badge, .reel-grid-comment-indicator';

        document.addEventListener('touchstart', function (e) {
            var activeCard = e.target.closest('#reels-grid-container .reel-card.reel-card-active');
            if (!activeCard || e.target.closest(IGNORE_SEL)) { tracking = false; return; }
            var touch = e.touches[0];
            if (!touch) { tracking = false; return; }
            startX = touch.clientX;
            startY = touch.clientY;
            tracking = true;
        }, { passive: true });

        document.addEventListener('touchend', function (e) {
            if (!tracking) return;
            tracking = false;
            var touch = e.changedTouches[0];
            if (!touch) return;
            var dx = touch.clientX - startX;
            var dy = touch.clientY - startY;
            /* Require a deliberate, mostly-horizontal drag so ordinary
               vertical page scrolling is never misread as a reel swipe. */
            if (Math.abs(dx) < 46 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
            _advanceActiveReel(dx < 0 ? 'next' : 'prev');
        }, { passive: true });
    })();

    /* DURATION BADGES (this session, point 1): reads each grid video's
       length off its metadata (available thanks to preload="metadata" on
       the <video> markup in app-feed.js — no playback needed) and writes it
       into that card's .reel-duration-badge as "M:SS"/"H:MM:SS". Runs once
       per <video> element (guarded via _durationWired) and is safe to call
       repeatedly — new cards picked up by _watchReelGrid() below just get
       skipped-over already-wired ones cheaply. */
    function _formatDuration(totalSeconds) {
        if (!isFinite(totalSeconds) || totalSeconds < 0) return '';
        var secs = Math.floor(totalSeconds);
        var h = Math.floor(secs / 3600);
        var m = Math.floor((secs % 3600) / 60);
        var s = secs % 60;
        var mm = (h > 0 && m < 10) ? ('0' + m) : String(m);
        var ss = s < 10 ? ('0' + s) : String(s);
        return h > 0 ? (h + ':' + mm + ':' + ss) : (mm + ':' + ss);
    }
    function _wireReelDurations() {
        var grid = _reelGrid();
        if (!grid) return;
        grid.querySelectorAll('.reel-video-wrap > video').forEach(function (vid) {
            if (vid._durationWired) return;
            vid._durationWired = true;
            var badge = vid.parentNode && vid.parentNode.querySelector('.reel-duration-badge');
            if (!badge) return;
            function _update() {
                if (vid.duration && isFinite(vid.duration)) badge.textContent = _formatDuration(vid.duration);
            }
            if (vid.readyState >= 1) _update(); /* metadata may already be loaded (fast cache hit) */
            vid.addEventListener('loadedmetadata', _update);
            vid.addEventListener('durationchange', _update);
        });
    }

    /* Belt-and-suspenders: re-apply whenever the grid's children change for
       any reason (covers the normal path already nudged directly from
       app-feed.js's listener, plus any future code path that touches this
       grid without knowing about this module). */
    (function _watchReelGrid() {
        function attach() {
            var grid = _reelGrid();
            if (!grid || grid._empReelsWatched) return;
            grid._empReelsWatched = true;
            new MutationObserver(function () { _applyActiveReelOrdering(); _wireReelDurations(); }).observe(grid, { childList: true });
            _applyActiveReelOrdering();
            _wireReelDurations();
        }
        attach();
        document.addEventListener('empyrean-section-change', function (e) {
            if (e && e.detail && e.detail.section === 'reels') setTimeout(attach, 50);
        });
        document.addEventListener('empyrean-init-done', function () { setTimeout(attach, 500); });
        setTimeout(attach, 1500);
    })();

    /* ── Kebab ("more options") menu open/close ── */
    function _closeAllKebabMenus(exceptMenu) {
        document.querySelectorAll('.reel-kebab-menu.open').forEach(function (m) {
            if (m !== exceptMenu) m.classList.remove('open');
        });
    }
    /* Every open kebab menu's DEFAULT content (main list) — restored after a
       Report sub-panel is shown and then dismissed/cancelled/submitted, so
       the next time that same menu opens it shows the normal options again
       rather than being stuck on the reasons list. */
    function _restoreKebabMenuDefault(menu) {
        if (menu && menu.dataset.defaultHtml) menu.innerHTML = menu.dataset.defaultHtml;
    }

    /* "Child sexual abuse or exploitation" listed first and worded
       explicitly (not folded into "Inappropriate content") — this is the
       in-app reporting path Google Play's Child Safety Standards
       declaration references. Selecting it routes to _submitReelReport's
       high-priority write below (moderation_flags, not just `reports`),
       so it surfaces to admins immediately instead of sitting in the
       normal report queue. */
    var REPORT_REASONS = ['Child sexual abuse or exploitation', 'Spam', 'Inappropriate content', 'Harassment or bullying', 'Something else'];

    function _showReportReasons(reelId, menu) {
        if (!menu.dataset.defaultHtml) menu.dataset.defaultHtml = menu.innerHTML;
        var html = '<div class="reel-kebab-menu-header">Report this reel</div>';
        REPORT_REASONS.forEach(function (reason) {
            html += '<button class="reel-kebab-reason-row reel-report-reason-btn" data-reel-id="' + _esc(reelId) + '" data-reason="' + _esc(reason) + '">' + _esc(reason) + '</button>';
        });
        html += '<button class="reel-kebab-item reel-report-cancel-btn"><i class="fas fa-arrow-left"></i> Cancel</button>';
        menu.innerHTML = html;
    }

    /* Keep the kebab menu's Like row honest with whatever this session
       already knows about that reel (e.g. liked earlier from the
       fullscreen viewer) instead of always showing a stale "0". */
    function _syncKebabMenuLikeState(menu, reelId) {
        if (!menu || !reelId) return;
        var likeRow = menu.querySelector('.reel-like-btn');
        if (!likeRow) return;
        var data  = _getReelData(reelId);
        var liked = data.likedBy.indexOf(_us().id) > -1;
        likeRow.classList.toggle('liked', liked);
        var countEl = likeRow.querySelector('.reel-like-count');
        if (countEl) countEl.textContent = data.likes;
    }

    function _submitReelReport(reelId, reason) {
        var us = _us();
        var isCsae = reason === 'Child sexual abuse or exploitation';
        _notify(isCsae
            ? 'Reported — thank you. Reports like this are prioritized for immediate review.'
            : 'Reported — thanks for flagging this, our team will review it.', 'success');
        if (window.fbDb && reelId) {
            /* FIX (2026-08-12): this was wrapped in a plain try/catch,
               which only catches SYNCHRONOUS throws — .add() is async and
               returns a Promise, so a rejection (e.g. the missing
               /reports rule this session also fixed in firebase-rules.js)
               sailed straight past that try/catch as an unhandled
               rejection. Real .catch() added below so any future write
               failure here is at least logged instead of silently lost —
               matches this function's own "best-effort" framing, it just
               now actually behaves that way. */
            window.fbDb.collection('reports').add({
                type: 'reel',
                reelId: reelId,
                reason: reason || 'Unspecified',
                reporterId: us.id || null,
                createdAt: (window.fbDb.FieldValue && window.fbDb.FieldValue.serverTimestamp) ? window.fbDb.FieldValue.serverTimestamp() : new Date().toISOString()
            }).catch(function (err) {
                console.warn('[Reel report] failed to save — reporter already saw a success message, this is best-effort:', err && err.message);
            });

            /* CSAE reports additionally go into moderation_flags — the
               same collection app-fixes.js's own auto-moderation writer
               already uses (see its "Explicit content" flag a few
               thousand lines away in that file) — so this reuses an
               existing admin-reviewed collection rather than introducing
               a second, parallel one nothing reads. Kept as its own write
               (not a field on the `reports` doc above) so it can't be
               missed by anyone scanning moderation_flags specifically for
               urgent items. */
            if (isCsae) {
                window.fbDb.collection('moderation_flags').add({
                    type: 'reel',
                    reelId: reelId,
                    reason: 'Child sexual abuse or exploitation (user report)',
                    severity: 'urgent',
                    reporterId: us.id || null,
                    flaggedAt: new Date().toISOString()
                }).catch(function (err) {
                    console.warn('[Reel report] CSAE moderation_flags write failed:', err && err.message);
                });
            }
        }
    }

    /* =========================================================================
       §1  REEL VIEWER — build / open
       ========================================================================= */

    /* Reel data store: reelId → { likes, comments, retweets, likedBy, retweetedBy, shares, downloads, views }.
       FIX (this session — "the rebroadcast feature was absent" / "enable
       live counts indicator"): every field here used to start at 0 and
       stay purely local/in-memory for the whole session — never read from
       or written to Firestore (except comments, loaded separately by the
       comments drawer). That's why retweeting/liking looked like it did
       nothing to anyone else: the numbers were real only to the tapper's
       own browser tab and vanished on reload. shares/downloads/views are
       new fields, added for the same reason. */
    var _reelData = {};

    function _getReelData(reelId) {
        if (!_reelData[reelId]) {
            _reelData[reelId] = { likes: 0, likedBy: [], retweets: 0, retweetedBy: [], shares: 0, downloads: 0, views: 0, comments: [] };
        }
        return _reelData[reelId];
    }

    /* Merges REAL counts from a reels/{id} doc into the local cache,
       without touching `comments` (loaded/managed separately by the
       comments drawer elsewhere in this file — clobbering it here would
       wipe an already-open comment thread every time a live update
       arrives). Called once on viewer-open (initial hydrate) and on every
       onSnapshot tick thereafter (see _attachReelLiveCounts below). */
    function _seedReelDataFromDoc(reelId, d) {
        var data = _getReelData(reelId);
        data.likes      = d.likeCount    || 0;
        data.likedBy    = Array.isArray(d.likedBy)     ? d.likedBy.slice()     : (data.likedBy || []);
        data.retweets   = d.retweetCount || 0;
        data.retweetedBy = Array.isArray(d.retweetedBy) ? d.retweetedBy.slice() : (data.retweetedBy || []);
        data.shares     = d.shareCount   || 0;
        data.downloads  = d.downloadCount || 0;
        data.views      = d.viewCount    || 0;
        /* FIX (2026-10-20 — "reel comments disappear after logging out, but the comment count still
           shows"): comments ARE saved to reels/{id}.comments, but this function (and nothing else)
           never loaded them back — a fresh page/login started every reel with an empty local list, so
           the drawer said "No comments yet" while the card's count (read from the same doc) said 1.
           Comments are now hydrated from the doc here — on viewer-open, on every live tick, and when
           the drawer opens — and an open drawer for this reel re-renders when the list changes. */
        if (Array.isArray(d.comments)) {
            var _prevLen = data.comments.length;
            data.comments = d.comments.slice();
            var _dr = document.getElementById('reel-shared-comments-drawer');
            if (_dr && _dr.classList.contains('open') && _dr.dataset.reelId === reelId) {
                var _bdg = document.getElementById('reel-comments-count-badge');
                if (_bdg) _bdg.textContent = data.comments.length ? '(' + data.comments.length + ')' : '';
                if (_prevLen !== data.comments.length) _renderComments(reelId, document.getElementById('reel-shared-comments-list'));
            }
        }
        return data;
    }

    /* Pushes the current local cache for one reel onto its engagement bar
       in the DOM — called after every optimistic local change AND after
       every live onSnapshot tick, so it's the single place that keeps the
       UI in sync with `_reelData`, whichever side updated it. */
    function _refreshReelEngagementUI(reelId) {
        var data = _getReelData(reelId);
        var item = document.querySelector('.reel-viewer-item[data-reel-id="' + reelId + '"]');
        if (!item) return;
        var uid = _us().id;

        var likeBtn = item.querySelector('.reel-like-btn');
        if (likeBtn) {
            likeBtn.classList.toggle('liked', uid ? data.likedBy.indexOf(uid) > -1 : false);
            var lc = likeBtn.querySelector('.reel-like-count');
            if (lc) lc.textContent = data.likes;
        }
        var rtBtn = item.querySelector('.reel-retweet-btn');
        if (rtBtn) {
            rtBtn.classList.toggle('retweeted', uid ? data.retweetedBy.indexOf(uid) > -1 : false);
            var rc = rtBtn.querySelector('.reel-retweet-count');
            if (rc) rc.textContent = data.retweets;
        }
        var shareCountEl = item.querySelector('.reel-share-count');
        if (shareCountEl) shareCountEl.textContent = data.shares;
        var dlCountEl = item.querySelector('.reel-download-count');
        if (dlCountEl) dlCountEl.textContent = data.downloads;
        var viewCountEl = item.querySelector('.reel-view-count');
        if (viewCountEl) viewCountEl.textContent = data.views;
    }

    /* ── Live counts while a reel is actually on screen ──────────────────
       "Enable live counts indicator to indicate the numbers of persons
       viewing/retweeting/downloading/liking/sharing" (this session): one
       onSnapshot per reel, attached only while that specific
       .reel-viewer-item is the one intersecting the viewport (wired from
       _setupReelObserver below — the SAME IntersectionObserver that
       already plays/pauses the video, so this rides along with logic that
       already exists rather than adding a second, competing observer) and
       detached the instant it scrolls off — mirrors this codebase's own
       established pattern of attach/detach-alongside-visibility (see
       app-patch-v33.js's moderator listener for the same shape). Keeps
       this to at most one live Firestore listener per reel actually being
       watched, never one per reel merely loaded into the DOM. */
    var _reelLiveListeners = {}; // reelId -> unsubscribe fn

    function _attachReelLiveCounts(reelId) {
        if (!reelId || !window.fbDb || _reelLiveListeners[reelId]) return;
        _reelLiveListeners[reelId] = window.fbDb.collection('reels').doc(reelId)
            .onSnapshot(function (doc) {
                if (!doc || !doc.exists) return;
                _seedReelDataFromDoc(reelId, doc.data() || {});
                _refreshReelEngagementUI(reelId);
            }, function (err) {
                console.warn('[Reel live counts] listener error for', reelId, '-', err && err.message);
            });
    }
    function _detachReelLiveCounts(reelId) {
        var unsub = _reelLiveListeners[reelId];
        if (unsub) { try { unsub(); } catch (e) {} delete _reelLiveListeners[reelId]; }
    }
    function _detachAllReelLiveCounts() {
        Object.keys(_reelLiveListeners).forEach(_detachReelLiveCounts);
    }

    /* One-time-per-session view count — fires the first time a reel
       actually becomes visible in the fullscreen viewer (from the same
       IntersectionObserver hook as the live-counts attach above), not on
       every scroll back past it or every loop of the video. */
    if (!window._reelViewedIds) window._reelViewedIds = {};
    function _registerReelView(reelId) {
        if (!reelId || !window.fbDb) return;
        var uid = _us().id || 'guest-' + (window._empGuestSessionId || 'anon');
        var key = reelId + '::' + uid;
        if (window._reelViewedIds[key]) return;
        window._reelViewedIds[key] = true;
        var fv = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
        if (!fv || typeof fv.increment !== 'function') return; // no reliable atomic increment available — skip rather than risk a lost-update race
        window.fbDb.collection('reels').doc(reelId).update({ viewCount: fv.increment(1) })
            .catch(function () { /* best-effort — a view count miss isn't worth surfacing an error for */ });
    }

    /* Real, persisted Share-tap count (2026-08-29 — "share button should
       share externally and internally"). Same shape as the Download
       counter just below in the click handler: every tap is its own
       event (no per-account dedupe/toggle — sharing the same reel to
       several different people is meaningful, unlike Like/Retweet), and
       it fires the moment the share sheet opens rather than waiting to
       confirm which destination (if any) the person actually finishes
       picking, matching how Download already counts on tap, not on
       confirmed completion. */
    function _registerReelShare(reelId) {
        if (!reelId) return;
        var data = _getReelData(reelId);
        data.shares = (data.shares || 0) + 1;
        _refreshReelEngagementUI(reelId);
        if (!window.fbDb) return;
        var fv = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
        window.fbDb.collection('reels').doc(reelId).update({
            shareCount: (fv && typeof fv.increment === 'function') ? fv.increment(1) : data.shares
        }).catch(function () { /* best-effort — a share count miss isn't worth surfacing an error for */ });
    }

    /* ═══════════════════════════════════════════════════════════════════
       REBROADCAST (this session — "clicking share button should
       rebroadcast the original reel; users should see the shared post in
       their reel section and their profile"): previously Share only ever
       opened the OS share sheet or copied a link — it never actually
       reposted anything, so nothing tapping it produced was ever visible
       anywhere in the app itself. Mirrors the existing feed Repost flow
       (see app-fixes.js's retweet-confirm handler, which creates a new
       `posts` doc with isRetweet/retweetOf rather than just bumping a
       counter): this creates a real `reels` doc, owned by the current
       user, pointing back at the original via repostOf. Because
       app-feed.js's reels listener renders every doc in the `reels`
       collection, and app-profile.js's profile reel grid queries
       `reels where userId == <owner>`, writing this one doc is what makes
       the reel automatically show up both in the main Reels feed and on
       the sharer's own profile — no separate mirroring code required,
       same as how the post-level repost feature already works. */
    var _reelRebroadcastInFlight = {};
    if (!window._reelRebroadcastedIds) window._reelRebroadcastedIds = {};

    function _rebroadcastReel(originalReelId, captionOverride, mode) {
        if (!originalReelId) return;
        if (_isGuest()) { _notify('Log in to share a reel.', 'info'); return; }
        if (!_requireRealAccountForShare()) return;
        mode = (mode === 'retweet') ? 'retweet' : 'share'; // undo path below (._reel-retweet-btn handler) needs to know which counter this repost counts against
        var uid = _us().id;
        /* FIX (2026-08-22 — "share still not working", confirmed via
           console: tapping Share alone, nothing else, produces
           FirebaseError: Missing or insufficient permissions with no
           visible feedback): this used to just `return` here with zero
           notification if uid was falsy — a genuinely silent failure that
           matches someone re-tapping Share because nothing happened.
           Given _requireRealAccountForShare() just confirmed a live,
           non-anonymous fbAuth.currentUser exists, _us().id should always
           be set at this point — but the app's own internal userState.id
           is a SEPARATE value from the real Firebase Auth uid throughout
           this codebase (the exact "app id != Auth uid" gap already
           documented and fixed for reel.userId, reel_live_broadcasts'
           hostId, and Storage's uploads/{owner} — see those files' own
           comments). Surfacing this instead of silently bailing at least
           turns a dead tap into an actionable message. */
        if (!uid) { _notify('Your session is still loading — please try again in a moment.', 'error'); return; }
        /* Dedupe key guards two different failure modes: the in-flight
           flag stops a rapid double-tap from firing a second write before
           the first Firestore round-trip resolves; the persisted
           _reelRebroadcastedIds map stops a later, separate tap on the
           same reel from silently creating a second repost doc — mirrors
           the retweetedBy-array pattern the Retweet button above already
           uses to keep one account from repeating the same action. */
        var dedupeKey = originalReelId + '::' + uid + '::' + mode;
        if (_reelRebroadcastInFlight[dedupeKey] || window._reelRebroadcastedIds[dedupeKey]) {
            if (window._reelRebroadcastedIds[dedupeKey]) _notify(mode === 'retweet' ? 'You already retweeted this reel.' : 'You already shared this reel.', 'info');
            return;
        }
        _reelRebroadcastInFlight[dedupeKey] = true;
        function _done() { _reelRebroadcastInFlight[dedupeKey] = false; }

        if (!(window._firebaseLoaded && window.fbDb)) {
            _notify('Still connecting — please try again in a moment.', 'error');
            _done();
            return;
        }

        /* FIX (2026-08-22 — "share still not working", confirmed via
           console: FirebaseError: Missing or insufficient permissions
           firing on a bare Share tap, no Like/Edit involved, with the
           write chain below otherwise matching this app's own relaxed
           rules for `reels` exactly): every other explanation this
           session (reward-target mismatch, missing dedupe/session
           guards, a synthetic unresolvable id) has been ruled out or
           already fixed, and rules-as-written already allow this exact
           write for any signed-in session. The remaining, well-precedented
           explanation this codebase has hit repeatedly (app-patch-v12/
           v26/v31's own auth-retry fixes) is a live ID token that hasn't
           actually finished attaching/refreshing on this device at the
           moment the write fires — fbAuth.currentUser can be non-null
           client-side (passing _requireRealAccountForShare() above)
           slightly before the token backing actual Firestore requests is
           valid server-side. _attemptRebroadcastWrite() below is tried
           once; on a permission-denied specifically (never on any other
           error — a real "you truly can't do this" denial shouldn't
           retry) it forces a fresh ID token via getIdToken(true) and
           retries exactly once before giving up with a real, visible
           error message instead of the previous silence. */
        function _attemptRebroadcastWrite() {
            return window.fbDb.collection('reels').doc(originalReelId).get()
                .then(function (doc) {
                    if (!doc || !doc.exists) { _notify('This reel is no longer available.', 'error'); _done(); return; }
                    var orig = doc.data() || {};
                    /* Reposting your own reel isn't a meaningful action — same
                       guard the feed's post-level repost flow has. */
                    if (orig.userId && orig.userId === uid) { _notify("That's your own reel.", 'info'); _done(); return; }

                    var us        = _us();
                    var repostId  = 'reel-' + Date.now();
                    var repostData = {
                        id:        repostId,
                        videoUrl:  orig.videoUrl || orig.url || '',
                        url:       orig.videoUrl || orig.url || '',
                        caption:   (typeof captionOverride === 'string' && captionOverride.trim()) ? captionOverride.trim() : (orig.caption || ''),
                        userId:    uid,
                        username:  us.fullName || us.username || 'User',
                        avatar:    us.avatar || '',
                        poster:    orig.poster || '',
                        likes:     0,
                        views:     0,
                        createdAt: new Date().toISOString(),
                        isRepost:  true,
                        repostOf:  originalReelId,
                        repostOriginalUsername: orig.username || 'user',
                        repostOriginalUserId:   orig.userId || ''
                    };
                    return window.fbDb.collection('reels').doc(repostId).set(repostData).then(function () {
                        window._reelRebroadcastedIds[dedupeKey] = repostId; // was `true` — now the actual doc id, so the retweet-undo path (below) can delete exactly this doc
                        _notify(mode === 'retweet'
                            ? (captionOverride ? 'Reel reposted with your comment! 🔁' : 'Reel retweeted!')
                            : 'Reel shared to your profile! 🔁', 'success');
                        _reward(mode === 'retweet' ? 'RETWEET_POST' : 'SHARE_POST');
                        if (typeof window.pushNotification === 'function' && orig.userId && orig.userId !== uid) {
                            window.pushNotification((us.fullName || 'Someone') + (mode === 'retweet' ? ' retweeted your reel! 🔁' : ' shared your reel! 🔁'), 'info');
                        }
                        /* Visible, PERSISTED social-proof counts on the ORIGINAL
                           reel — this session's fix for "should indicate the
                           number of persons who have reshared": retweetCount/
                           retweetedBy for the Retweet-button path, shareCount
                           (unchanged field/behavior) for the Share-button path
                           — two separate real counters instead of one fake
                           local one. Both live-update in every open viewer via
                           _attachReelLiveCounts()'s onSnapshot below. */
                        var fv = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
                        var counterField = mode === 'retweet' ? 'retweetCount' : 'shareCount';
                        var updatePayload = {};
                        updatePayload[counterField] = (fv && typeof fv.increment === 'function') ? fv.increment(1) : ((orig[counterField] || 0) + 1);
                        if (mode === 'retweet') {
                            updatePayload.retweetedBy = (fv && typeof fv.arrayUnion === 'function')
                                ? fv.arrayUnion(uid)
                                : (Array.isArray(orig.retweetedBy) ? orig.retweetedBy.concat([uid]) : [uid]);
                        }
                        return window.fbDb.collection('reels').doc(originalReelId).update(updatePayload).catch(function () {});
                    });
                });
        }

        var _rebroadcastRetried = false;
        _attemptRebroadcastWrite()
            .catch(function (err) {
                var deniedCode = err && (err.code === 'permission-denied' || err.code === 'permission_denied');
                if (deniedCode && !_rebroadcastRetried && window.fbAuth && window.fbAuth.currentUser && typeof window.fbAuth.currentUser.getIdToken === 'function') {
                    _rebroadcastRetried = true;
                    console.warn('[Reel rebroadcast] permission-denied on first attempt — forcing a fresh ID token and retrying once:', err.message);
                    return window.fbAuth.currentUser.getIdToken(true)
                        .catch(function () { /* token refresh itself failed — fall through to the retry anyway, it'll fail the same way and hit the outer catch with a clean message */ })
                        .then(_attemptRebroadcastWrite);
                }
                throw err;
            })
            .catch(function (err) {
                console.error('[Reel rebroadcast]', (err && err.code) || '', err && err.message);
                _notify('Could not share this reel — please try again.', 'error');
            })
            .then(_done, _done);
    }
    /* Exposed so app-fix-final.js's now-superseded duplicate share
       handler (see the no-op left in its place there) and any other
       future entry point can trigger the exact same real rebroadcast
       instead of quietly re-implementing a second, divergent copy. */
    window._empReelRebroadcast = _rebroadcastReel;

    /* Undo a retweet — deletes the actual repost doc this account created
       (its id is now what window._reelRebroadcastedIds stores, see
       _rebroadcastReel above) and reverses the counter/array bump on the
       ORIGINAL reel. Un-liking is a plain field toggle so it doesn't need
       this; un-retweeting has to clean up the extra doc a retweet
       actually created, or the repost would keep showing on the user's
       profile/the main feed after they'd "removed" it from their own
       button's point of view. */
    function _undoReelRetweet(reelId, repostId, uid) {
        var dedupeKey = reelId + '::' + uid + '::retweet';
        var data = _getReelData(reelId);
        data.retweetedBy = data.retweetedBy.filter(function (id) { return id !== uid; });
        data.retweets = Math.max(0, data.retweets - 1);
        _refreshReelEngagementUI(reelId);
        delete window._reelRebroadcastedIds[dedupeKey];
        if (!window.fbDb) return;
        window.fbDb.collection('reels').doc(repostId).delete().catch(function (err) {
            console.warn('[Reel un-retweet] could not delete repost doc:', err && err.message);
        });
        var fv = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
        var updatePayload = { retweetCount: fv ? fv.increment(-1) : Math.max(0, data.retweets) };
        if (fv) updatePayload.retweetedBy = fv.arrayRemove(uid);
        window.fbDb.collection('reels').doc(reelId).update(updatePayload).catch(function () {});
    }

    /* FIX (2026-08-29 — "the tweets/retweet button does nothing"):
       window._reelRebroadcastedIds (which maps reelId::uid::retweet to
       the actual repost doc id, so _undoReelRetweet knows exactly which
       doc to delete) is a plain in-memory object — it only ever gets
       populated by _rebroadcastReel() during THIS SAME browser tab's
       lifetime, and is never restored from Firestore. retweetedBy itself
       IS persisted, so a reel correctly still shows as "retweeted" after
       a reload or on a different device — but the click handler's own
       `if (repostId6) _undoReelRetweet(...)` had no else branch, so on
       any reel already shown as retweeted from a PRIOR session, tapping
       it to undo looked up an id that was never there and did precisely
       nothing: no toast, no error, no visible response at all — exactly
       the reported symptom. This looks the repost doc up directly from
       Firestore instead of only trusting the local, tab-lifetime cache,
       so undo works regardless of when/where the original retweet
       happened. */
    function _undoReelRetweetByLookup(reelId, uid) {
        if (!window.fbDb) { _notify('Still connecting — please try again in a moment.', 'error'); return; }
        window.fbDb.collection('reels')
            .where('repostOf', '==', reelId)
            .where('userId', '==', uid)
            .limit(1)
            .get()
            .then(function (snap) {
                if (snap.empty) {
                    /* No repost doc exists server-side either — the local
                       "retweeted" state is stale (e.g. the repost was
                       already deleted some other way). Clear it so the
                       button stops showing an active state that no
                       longer reflects anything real, instead of staying
                       stuck forever. */
                    var data = _getReelData(reelId);
                    data.retweetedBy = data.retweetedBy.filter(function (id) { return id !== uid; });
                    _refreshReelEngagementUI(reelId);
                    return;
                }
                _undoReelRetweet(reelId, snap.docs[0].id, uid);
            })
            .catch(function (err) {
                console.warn('[Reel un-retweet] lookup failed:', err && err.message);
                _notify('Could not undo retweet — please try again.', 'error');
            });
    }

    function openReelViewer(clickedCard) {
        var overlay   = document.getElementById('reel-viewer-modal-overlay');
        var container = document.getElementById('reel-viewer-container');
        if (!overlay || !container) {
            _buildReelViewerDOM();
            overlay   = document.getElementById('reel-viewer-modal-overlay');
            container = document.getElementById('reel-viewer-container');
            if (!overlay || !container) return;
        }

        /* DUPLICATE PLAYBACK FIX (this session, point 4): the grid's pinned
           "now playing" card (position:fixed, always visible behind
           anything that isn't itself fixed/higher-z-index) keeps its own
           <video> autoplaying regardless of what else is on screen — so
           without this, opening the fullscreen viewer just started a SECOND
           video (and a second audio track) for the same reel on top of it,
           and the two played independently/out of sync until the fixed card
           happened to scroll out of view. Pausing every grid card's video
           here, before the fullscreen viewer's own videos are built/shown,
           guarantees only ONE copy of the reel is ever playing at a time.
           Playback on the grid resumes automatically when the viewer is
           closed — see _closeReelViewer() below. */
        document.querySelectorAll('#reels-grid-container .reel-card video').forEach(function (v) {
            try { v.pause(); } catch (e) {}
        });

        container.innerHTML = '';

        /* Collect all reel cards from the grid — excludes .reels-live-tv-card
           (the single live-broadcast card, see _renderLiveStrip above): it
           has no video/postId and isn't a real reel post, so it must never
           enter the fullscreen swipe rotation. */
        var allCards = Array.from(document.querySelectorAll('#reels-grid-container .reel-card:not(.reels-live-tv-card), .reel-preview-card'));
        if (!allCards.length) allCards = [clickedCard];

        /* De-dupe by reel id (postId/reelId). The same reel can now
           legitimately render in more than one place in the DOM at once —
           e.g. a profile's dedicated "Reels" gallery tab AND its mid-feed
           reel strip both show the SAME set of reels simultaneously (a
           hidden tab panel stays in the DOM, it's just display:none, not
           removed — see app-profile.js's §9 owner reel gallery/feed-strip
           section). Without this, swiping past the tapped reel would
           eventually land on the exact same reel a second time. Whichever
           card is the one ACTUALLY CLICKED always wins the slot for its id,
           so startIdx below still finds it correctly no matter which of its
           duplicates happened to be encountered first. */
        (function _dedupeReelCardsById() {
            var winnerForId = {};
            var order       = [];
            allCards.forEach(function (c) {
                var rid = c.dataset.postId || c.dataset.reelId || '';
                if (!rid) { order.push(c); return; } /* no id to key on — can't dedupe, keep as-is */
                if (!(rid in winnerForId)) order.push(c); /* reserve this id's slot in the final order */
                if (!(rid in winnerForId) || c === clickedCard) winnerForId[rid] = c;
            });
            allCards = order.map(function (c) {
                var rid = c.dataset.postId || c.dataset.reelId || '';
                return (rid && winnerForId[rid]) ? winnerForId[rid] : c;
            });
        })();

        var startIdx = 0, startItem = null;
        allCards.forEach(function (card, idx) {
            if (card === clickedCard) startIdx = idx;
            var item = _buildReelViewerItem(card);
            if (card === clickedCard) startItem = item;
            container.appendChild(item);
        });
        /* 2026-11-07: sponsored slides between reels (admin adverts + Ad Manager campaigns) — see window.EmpAds in app-feed.js */
        try { if (window.EmpAds && window.EmpAds.decorateReelViewer) window.EmpAds.decorateReelViewer(container); } catch (_adErr) {}

        overlay.classList.add('show');
        document.body.classList.add('modal-open', 'reel-open');

        /* Scroll to clicked reel */
        setTimeout(function () {
            var items = container.querySelectorAll('.reel-viewer-item');
            var _target = (startItem && startItem.isConnected) ? startItem : items[startIdx];
            if (_target) _target.scrollIntoView({ behavior: 'auto' });
        }, 50);

        /* Intersection observer for auto-play */
        _setupReelObserver(container);

        /* Touch swipe support */
        _setupSwipe(container);
    }
    window.openReelViewer  = openReelViewer;
    /* Register the full viewer so app-feed.js defers to this module
       rather than overwriting it with its simplified stub. */
    window._reelViewerFull = openReelViewer;

    function _buildReelViewerDOM() {
        if (document.getElementById('reel-viewer-modal-overlay')) return;
        var overlay = document.createElement('div');
        overlay.id = 'reel-viewer-modal-overlay';

        var container = document.createElement('div');
        container.id = 'reel-viewer-container';

        overlay.appendChild(container);
        document.body.appendChild(overlay);

        /* Exit button appended to <body> at fixed position — never clipped by
           the overlay scroll container or video stacking context (bug 2 fix). */
        var exitBtn = document.createElement('button');
        exitBtn.id = 'reel-exit-btn';
        exitBtn.setAttribute('aria-label', 'Close reels');
        exitBtn.title = 'Close reels';
        exitBtn.innerHTML = '<i class="fas fa-times"></i>';
        document.body.appendChild(exitBtn);

        exitBtn.addEventListener('click', function () {
            _closeReelViewer();
        });

        /* ── Shared comments drawer — built eagerly on load; just ensure it exists ── */
        _ensureSharedDrawer();
    }

    function _closeReelViewer() {
        var overlay = document.getElementById('reel-viewer-modal-overlay');
        if (!overlay) return;
        /* Pause all videos */
        overlay.querySelectorAll('video').forEach(function (v) {
            try { v.pause(); v.src = ''; } catch(e) {}
        });
        overlay.classList.remove('show');
        document.body.classList.remove('modal-open', 'reel-open');
        /* Close shared comments drawer */
        _closeCommentsDrawer();
        /* "Enable live counts indicator" (this session): every reel's
           onSnapshot listener attached while it was on screen (see
           _attachReelLiveCounts, wired from the IntersectionObserver in
           _setupReelObserver) needs to come down when the whole viewer
           closes, not just when an individual item scrolls off — the
           observer itself stops firing once its items are gone. */
        _detachAllReelLiveCounts();
        /* DUPLICATE PLAYBACK FIX (this session, point 4), continued: the
           grid's pinned "now playing" card was paused when the fullscreen
           viewer opened (see openReelViewer() above) — resume it now that
           we're back, via the same logic that drives normal autoplay, so
           returning to the grid doesn't leave the preview sitting frozen. */
        _applyActiveReelOrdering();
    }
    /* FIX (2026-08-30 — Share-to-Status follow-up): app-patch-v13.js's
       _closeAnyOpenChatScreen() (called at the start of every Share-to-
       Status hand-off) can only reach app-fix-final.js's OWN, separate
       window._closeReelViewer — a shorter teardown (pause+clear video,
       drop the overlay/body classes, empty the container, hide the exit
       button) that does not know about this file's comments drawer,
       live-count listeners, or grid-playback resume, because this file
       never exposed its own, more complete _closeReelViewer above. Two
       different functions were answering to the same name; only the
       thinner one was ever reachable from outside this closure. Exposed
       here under its own name (not overwriting window._closeReelViewer,
       so app-fix-final.js's existing callers — exit button, Escape key,
       backdrop tap — are untouched) so external callers like
       _closeAnyOpenChatScreen() can opt into the real, full teardown
       instead. */
    window._empReelCloseViewer = _closeReelViewer;

    function _closeCommentsDrawer() {
        var d = document.getElementById('reel-shared-comments-drawer');
        var scrim = document.getElementById('reel-comments-scrim');
        if (d) d.classList.remove('open');
        if (scrim) scrim.classList.remove('active');
    }

    function _buildReelViewerItem(card) {
        /* FIX (2026-08-22 — reel share link not working): this used to
           fall back to a synthetic `'reel-' + Date.now()` id whenever a
           card reached the viewer without a real data-post-id/data-reel-
           id. That id is never a real Firestore doc — every card that
           takes this branch got a Share button whose /?post=<fake-id>
           link can NEVER resolve (404s into the generic fallback card
           server-side, and _rebroadcastReel()'s own .get() lookup fails
           silently client-side too). Every known card builder today does
           set one of the two real attributes, but this fallback is what a
           card WITHOUT one silently produces, so it's fixed at the
           source rather than left as a trap for the next card type that
           forgets to set an id. Falls through to '' instead — see the
           share/download button construction below, which now shares the
           raw playable video URL when there's no real id to build an app
           permalink from, instead of a link that can never work. */
        var reelId   = card.dataset.postId || card.dataset.reelId || '';
        var videoUrl = card.dataset.videoUrl || (card.querySelector('video') ? card.querySelector('video').src : '') || '';
        var username = card.dataset.username || (card.querySelector('[class*=username]') ? card.querySelector('[class*=username]').textContent : 'user');
        var caption  = card.dataset.caption  || (card.querySelector('p') ? card.querySelector('p').textContent : '');
        var avatar   = card.dataset.avatar   || (card.querySelector('img') ? card.querySelector('img').src : '');
        var userId   = card.dataset.userId   || '';

        var data = _getReelData(reelId);
        var uid  = _us().id;
        var liked     = data.likedBy.includes(uid);
        var retweeted = data.retweetedBy.includes(uid);

        var item = document.createElement('div');
        item.className = 'reel-viewer-item';
        item.dataset.reelId = reelId;

        var vid = document.createElement('video');
        vid.src = videoUrl;
        /* FIX (2026-08-22 — reel thumbnails rendering inconsistently /
           solid black): see _empReelPosterUrl's own header comment above. */
        var _viewerPoster = _empReelPosterUrl(videoUrl);
        if (_viewerPoster) vid.poster = _viewerPoster;
        vid.loop = true;
        vid.muted = false;
        vid.playsinline = true;
        vid.preload = 'metadata';
        vid.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
        item.appendChild(vid);

        /* ── Engagement bar ── */
        var engBar = document.createElement('div');
        engBar.className = 'reel-engagement-bar';
        engBar.innerHTML = [
            /* "Enable live counts indicator... viewing" (this session) —
               non-interactive, just a live read-out; see _registerReelView/
               _attachReelLiveCounts below for how it gets its number. */
            '<div class="reel-eng-btn reel-view-indicator" title="Views">',
            '<i class="fas fa-eye"></i><span class="reel-view-count">' + data.views + '</span></div>',

            '<button class="reel-eng-btn reel-like-btn' + (liked ? ' liked' : '') + '" data-reel-id="' + _esc(reelId) + '" data-user-id="' + _esc(userId) + '">',
            '<i class="fas fa-heart"></i><span class="reel-like-count">' + data.likes + '</span></button>',

            '<button class="reel-eng-btn reel-comment-btn" data-reel-id="' + _esc(reelId) + '">',
            '<i class="fas fa-comment-dots"></i><span class="reel-comment-count">' + data.comments.length + '</span></button>',

            '<button class="reel-eng-btn reel-retweet-btn' + (retweeted ? ' retweeted' : '') + '" data-reel-id="' + _esc(reelId) + '">',
            '<i class="fas fa-retweet"></i><span class="reel-retweet-count">' + data.retweets + '</span></button>',

            // FIX: this used to be data-url="' + videoUrl + '" — the raw
            // Cloudinary video URL. Sharing that directly meant WhatsApp/
            // Facebook never saw an app link at all, so the rich preview
            // card (title/author/follower-count/poster-frame) built in
            // server.js's crawler route never had a chance to run — the
            // crawler just tried (and typically failed) to preview a bare
            // .mp4 URL. Using the app's own ?post=<reelId> permalink routes
            // the share through that same preview logic, same as every
            // other content type.
            '<button class="reel-eng-btn reel-share-btn" data-reel-id="' + _esc(reelId) + '" data-url="' + _esc(reelId ? (window.location.origin + '/?post=' + encodeURIComponent(reelId)) : videoUrl) + '">',
            '<svg style="vertical-align:-3px;margin-right:2px;" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg><span class="reel-share-count">' + data.shares + '</span></button>',

            '<button class="reel-eng-btn reel-download-btn" data-url="' + _esc(videoUrl) + '" data-reel-id="' + _esc(reelId) + '" data-username="' + _esc(username) + '">',
            '<i class="fas fa-download"></i><span class="reel-download-count">' + data.downloads + '</span></button>',
        ].join('');
        item.appendChild(engBar);

        /* Hydrate REAL counts for this reel from Firestore — the markup
           above renders instantly from whatever's already in the local
           cache (0s on a first open), then this fills in the true numbers
           a moment later. Live updates while the reel is actually on
           screen are handled separately by _attachReelLiveCounts, wired
           from the IntersectionObserver in _setupReelObserver below. */
        if (reelId && window.fbDb) {
            window.fbDb.collection('reels').doc(reelId).get().then(function (doc) {
                if (!doc.exists) return;
                _seedReelDataFromDoc(reelId, doc.data() || {});
                _refreshReelEngagementUI(reelId);
            }).catch(function () {});
        }

        /* ── Info strip ── */
        var infoStrip = document.createElement('div');
        infoStrip.className = 'reel-info-strip';
        infoStrip.innerHTML = (typeof window._empReelViewerPinsHtml === 'function' ? window._empReelViewerPinsHtml(card) : '')
            + '<div class="reel-username">'
            /* PROFILE TAP SPLIT (this session, point 3): same split as the
               grid card (see app-feed.js) — avatar opens the quick preview
               sheet, the @username text jumps straight to the full profile. */
            + '<img src="' + _esc(avatar) + '" data-preview-profile="' + _esc(userId) + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;cursor:pointer;" onerror="this.style.display=\'none\'">'
            + '<span style="cursor:pointer;" data-view-profile="' + _esc(userId) + '">@' + _esc(username) + '</span>'
            + '</div>'
            /* ONE-LINE CAPTION (2026-10-04): single line + chevron to expand — see §0a. */
            + (typeof window._empReelViewerCapHtml === 'function' ? window._empReelViewerCapHtml(caption) : '<div class="reel-caption">' + _esc(caption) + '</div>');
        item.appendChild(infoStrip);

        return item;
    }

    function _buildCommentEl(c, reelId, uid) {
        var liked = c.likedBy && c.likedBy.includes(uid);
        var cEl = document.createElement('div');
        cEl.className = 'reel-comment';
        cEl.dataset.commentId = c.id;
        cEl.innerHTML = [
            '<img class="reel-comment-avatar" src="' + _esc(c.avatar || '') + '" onerror="this.style.display=\'none\'">',
            '<div class="reel-comment-body">',
            '<div class="reel-comment-username">' + _esc(c.username || 'User') + ' <span style="font-weight:400;font-size:0.72rem;color:rgba(255,255,255,0.4);">' + _timeAgo(c.createdAt) + '</span></div>',
            '<div class="reel-comment-text">' + _esc(c.text) + '</div>',
            '<div class="reel-comment-actions">',
            '<button class="reel-comment-like-btn' + (liked ? ' liked' : '') + '" data-comment-id="' + _esc(c.id) + '" data-reel-id="' + _esc(reelId) + '"><i class="fas fa-heart"></i> ' + (c.likes || 0) + '</button>',
            '<button class="reel-comment-reply-btn" data-comment-id="' + _esc(c.id) + '" data-reel-id="' + _esc(reelId) + '">Reply</button>',
            '</div>',
            /* Sub-comments */
            _renderSubComments(c, reelId),
            '</div>'
        ].join('');
        return cEl;
    }

    /* Whether the comment list is scrolled close enough to the bottom that
       auto-scrolling to reveal a brand-new comment won't yank the user away
       from comments they're currently reading further up. */
    function _isNearBottom(container) {
        return (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
    }

    /* Append a single new top-level comment without re-rendering the whole
       list, so existing scroll position is preserved and new comments enter
       seamlessly rather than causing a visible jump/flicker. */
    function _appendComment(reelId, container, comment) {
        if (!container) container = document.getElementById('reel-shared-comments-list') || document.getElementById('reel-cl-' + reelId);
        if (!container) return;
        var emptyMsg = container.querySelector('p');
        if (emptyMsg) emptyMsg.remove();
        var wasNearBottom = _isNearBottom(container);
        var cEl = _buildCommentEl(comment, reelId, _us().id);
        container.appendChild(cEl);
        if (wasNearBottom) container.scrollTop = container.scrollHeight;
    }

    function _renderComments(reelId, container) {
        var data = _getReelData(reelId);
        var uid  = _us().id;
        if (!container) container = document.getElementById('reel-shared-comments-list') || document.getElementById('reel-cl-' + reelId);
        if (!container) return;

        container.innerHTML = '';
        if (!data.comments.length) {
            container.innerHTML = '<p style="color:rgba(255,255,255,0.45);text-align:center;padding:20px 0;font-size:0.88rem;">No comments yet. Be the first!</p>';
            return;
        }

        data.comments.forEach(function (c) {
            container.appendChild(_buildCommentEl(c, reelId, uid));
        });
    }

    /* FIX (2026-10-20 — "comments disappear when I come back to the comments section, not only after
       logout"): app-fix-final.js's capture-phase handler opens the comments drawer by calling THIS
       exposed function directly — it never goes through _openReelCommentsDrawer — so the saved thread
       was never fetched and the drawer rendered an empty local cache. The exposed renderer now draws
       what it has AND loads the saved comments from Firestore; _seedReelDataFromDoc re-renders the open
       drawer (and the count badge) when they arrive. */
    window._empReelRenderComments = function (reelId, container) {
        _renderComments(reelId, container);
        if (window.fbDb && reelId) {
            window.fbDb.collection('reels').doc(reelId).get().then(function (doc) {
                if (doc && doc.exists) _seedReelDataFromDoc(reelId, doc.data() || {});
            }).catch(function (err) { console.warn('[Reel comments load]', err && err.message); });
        }
    };

    function _renderSubComments(comment, reelId) {
        var subs = comment.replies || [];
        if (!subs.length) return '<div class="reel-subcomments" data-parent-id="' + _esc(comment.id) + '" data-reel-id="' + _esc(reelId) + '"></div>';
        var uid = _us().id;
        var html = '<div class="reel-subcomments" data-parent-id="' + _esc(comment.id) + '" data-reel-id="' + _esc(reelId) + '">';
        subs.forEach(function (sub) {
            var liked = sub.likedBy && sub.likedBy.includes(uid);
            html += '<div class="reel-comment" data-subcomment-id="' + _esc(sub.id) + '">'
                + '<img class="reel-comment-avatar" src="' + _esc(sub.avatar || '') + '" style="width:28px;height:28px;" onerror="this.style.display=\'none\'">'
                + '<div class="reel-comment-body">'
                + '<div class="reel-comment-username" style="font-size:0.78rem;">' + _esc(sub.username || 'User') + ' <span style="font-weight:400;font-size:0.68rem;color:rgba(255,255,255,0.4);">' + _timeAgo(sub.createdAt) + '</span></div>'
                + '<div class="reel-comment-text" style="font-size:0.82rem;">' + _esc(sub.text) + '</div>'
                + '<div class="reel-comment-actions">'
                + '<button class="reel-comment-like-btn' + (liked ? ' liked' : '') + '" data-subcomment-id="' + _esc(sub.id) + '" data-parent-id="' + _esc(comment.id) + '" data-reel-id="' + _esc(reelId) + '"><i class="fas fa-heart"></i> ' + (sub.likes || 0) + '</button>'
                + '</div></div></div>';
        });
        html += '</div>';
        return html;
    }


    /* =========================================================================
       §1a  REEL AUTOPLAY WITH SOUND (2026-11-08)
       Reels now try to autoplay WITH sound. Browsers only allow that after the
       person has tapped something on the page, so: try unmuted first; if the
       browser blocks it, play muted (so the video still moves) and unmute on the
       very next tap/touch/key. If the person taps the mute button, that choice
       is remembered and every later reel follows it. */
    var _empReelSoundPref = true;
    function _empReelSyncMuteUi(card, vid) {
        try {
            var btn = card && card.querySelector('.reel-mute-btn');
            if (!btn) return;
            var ic = btn.querySelector('i');
            if (vid.muted) {
                btn.classList.remove('reel-mute-btn-unmuted');
                if (ic) { ic.classList.remove('fa-volume-up'); ic.classList.add('fa-volume-mute'); }
            } else {
                btn.classList.add('reel-mute-btn-unmuted');
                if (ic) { ic.classList.remove('fa-volume-mute'); ic.classList.add('fa-volume-up'); }
            }
        } catch (e) {}
    }
    var _empReelUnlockArmed = false;
    function _empReelArmUnlock() {
        if (_empReelUnlockArmed) return;
        _empReelUnlockArmed = true;
        var evs = ['pointerdown', 'touchend', 'click', 'keydown'];
        var go = function () {
            evs.forEach(function (n) { document.removeEventListener(n, go, true); });
            _empReelUnlockArmed = false;
            if (!_empReelSoundPref) return;
            document.querySelectorAll('#reels-grid-container .reel-card video').forEach(function (v) {
                if (!v.paused && v.muted) {
                    v.muted = false;
                    var pr = v.play(); if (pr && pr.catch) pr.catch(function () { v.muted = true; });
                    _empReelSyncMuteUi(v.closest('.reel-card'), v);
                }
            });
        };
        evs.forEach(function (n) { document.addEventListener(n, go, true); });
    }
    function _empReelPlayWithSound(vid) {
        if (!vid) return;
        var card = vid.closest ? vid.closest('.reel-card') : null;
        try { vid.playsInline = true; } catch (e) {}
        vid.muted = !_empReelSoundPref;
        _empReelSyncMuteUi(card, vid);
        var pr; try { pr = vid.play(); } catch (e) {}
        if (pr && pr.catch) {
            pr.catch(function () {
                /* Blocked (no tap yet): fall back to muted playback, unmute on first tap. */
                if (!vid.muted) {
                    vid.muted = true;
                    _empReelSyncMuteUi(card, vid);
                    var p2 = vid.play(); if (p2 && p2.catch) p2.catch(function () {});
                    _empReelArmUnlock();
                }
            });
        }
    }

    /* =========================================================================
       §1b  SCROLL PREVIEW / AUTOPLAY (2026-11-08)
       The most-visible reel card plays MUTED and loops; others stay paused. Yields to a pinned card,
       the fullscreen viewer, a hidden tab and data-saver. Never touches pin state. */
    (function _reelScrollPreview() {
        if (window._empReelPreviewWired) return;
        window._empReelPreviewWired = true;
        if (!('IntersectionObserver' in window)) return;
        var vis = new Map(), io = null, raf = 0, current = null;
        function saveData() { try { return !!(navigator.connection && navigator.connection.saveData); } catch (e) { return false; } }
        function viewerOpen() { var ov = document.getElementById('reel-viewer-modal-overlay'); return !!(ov && ov.classList.contains('show')); }
        function previewable(c) { return c && !c.classList.contains('reel-card-active') && !c.classList.contains('reels-live-tv-card') && c.querySelector('video'); }
        function pauseVid(v) { if (v && !v.paused) { try { v.pause(); } catch (e) {} } }
        function evaluate() {
            raf = 0;
            var grid = _reelGrid(); if (!grid) return;
            var others = grid.querySelectorAll('.reel-card:not(.reel-card-active) video');
            if (_activeReelId || viewerOpen() || document.hidden || saveData()) {
                current = null; others.forEach(pauseVid); return;
            }
            var best = null, bestScore = -1, mid = window.innerHeight / 2;
            vis.forEach(function (ratio, card) {
                if (!card.isConnected || ratio < 0.55 || !previewable(card)) return;
                var r = card.getBoundingClientRect();
                var score = ratio * 1000 - Math.abs((r.top + r.height / 2) - mid) / 10;
                if (score > bestScore) { bestScore = score; best = card; }
            });
            others.forEach(function (v) { if (!(best && best.contains(v))) pauseVid(v); });
            current = best;
            if (!best) return;
            var vid = best.querySelector('video');
            /* SOUND ON AUTOPLAY (2026-11-08): old forced-mute lines commented out.
            vid.muted = true; vid.loop = true; vid.playsInline = true;
            if (vid.paused) { var pr = vid.play(); if (pr && pr.catch) pr.catch(function () {}); }
            */
            vid.loop = true; vid.playsInline = true;
            if (vid.paused) { _empReelPlayWithSound(vid); }
            else { vid.muted = !_empReelSoundPref; _empReelSyncMuteUi(best, vid); }
        }
        function schedule() { if (!raf) raf = requestAnimationFrame(evaluate); }
        function scan() {
            var grid = _reelGrid(); if (!grid) return;
            grid.querySelectorAll('.reel-card').forEach(function (card) {
                if (card._empPrevWatched) return; card._empPrevWatched = true;
                try { io.observe(card); } catch (e) {}
            });
        }
        function init() {
            var grid = _reelGrid();
            if (!grid) { setTimeout(init, 800); return; }
            io = new IntersectionObserver(function (entries) {
                entries.forEach(function (en) { if (en.isIntersecting) vis.set(en.target, en.intersectionRatio); else vis.delete(en.target); });
                schedule();
            }, { threshold: [0, 0.25, 0.55, 0.75, 1] });
            scan();
            new MutationObserver(function () {
                scan();
                vis.forEach(function (_r, c) { if (!c.isConnected) { vis.delete(c); try { io.unobserve(c); } catch (e) {} } });
                schedule();
            }).observe(grid, { childList: true, subtree: true });
            new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
            var ov = document.getElementById('reel-viewer-modal-overlay');
            if (ov) new MutationObserver(schedule).observe(ov, { attributes: true, attributeFilter: ['class', 'style'] });
            document.addEventListener('visibilitychange', schedule);
            window.addEventListener('resize', schedule);
            schedule();
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    })();

    /* =========================================================================
       §2  IntersectionObserver — auto play/pause
       ========================================================================= */
    function _setupReelObserver(container) {
        if (!('IntersectionObserver' in window)) return;
        /* Disconnect any observer from a previous openReelViewer() call —
           container.innerHTML is reset on each open but the container node
           itself persists, so the old observer would otherwise leak. */
        if (container._reelObs) { try { container._reelObs.disconnect(); } catch (e) {} }
        var obs = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                var vid = entry.target.querySelector('video');
                var reelId = entry.target.dataset.reelId;
                if (entry.isIntersecting) {
                    if (vid) vid.play && vid.play().catch(function () {});
                    if (reelId) { try { if (window.EmpAds) window.EmpAds.videoPlaying(entry.target, entry.target.dataset.userId || ''); } catch (_pe) {} }
                    /* "Enable live counts indicator" (this session): only
                       the reel actually on screen gets a live Firestore
                       listener, and its view gets counted — see
                       _attachReelLiveCounts/_registerReelView above. */
                    if (reelId) { _attachReelLiveCounts(reelId); _registerReelView(reelId); }
                } else {
                    if (vid) vid.pause && vid.pause();
                    try { if (window.EmpAds) window.EmpAds.videoLeft(entry.target); } catch (_pe2) {}
                    if (reelId) _detachReelLiveCounts(reelId);
                }
            });
        }, { root: container, threshold: 0.6 });
        container.querySelectorAll('.reel-viewer-item').forEach(function (item) {
            obs.observe(item);
        });
        container._reelObs = obs;
    }

    /* ── Vertical swipe paging ──────────────────────────────────────────
       Previously this handler let the browser's native touch-scroll run
       (the container has scroll-snap-type:y mandatory, so a raw finger
       drag already moves/settles the scroll position on its own) and THEN
       fired an extra container.scrollBy(±clientHeight) on touchend. That
       stacked a full extra viewport-height jump on top of whatever the
       native drag had already scrolled, so a single swipe landed two (or
       more) reels away instead of one.

       Fix: take full manual control of the vertical gesture (block native
       scroll via touch-action + preventDefault), compute the reel nearest
       the current scroll position, and always page to exactly index ± 1
       via scrollIntoView — never an arbitrary pixel distance. A short
       lock prevents a second touch from re-triggering mid-animation. ── */
    function _setupSwipe(container) {
        if (container._swipeBound) return; /* guard against duplicate binding on reopen */
        container._swipeBound = true;

        var startY = 0;
        var startX = 0;
        var tracking = false;
        var locked = false;
        var SWIPE_THRESHOLD = 40;  /* px of intentional vertical movement to count as a swipe */
        var LOCK_MS = 450;         /* matches the smooth-scroll settle time */

        /* Let horizontal gestures pass through untouched; we take over
           vertical movement ourselves so it can't run alongside the
           browser's own native scroll-snap. */
        container.style.touchAction = 'pan-x';

        function _nearestIndex() {
            var items = Array.prototype.slice.call(container.querySelectorAll('.reel-viewer-item'));
            var top = container.scrollTop;
            var best = 0, bestDist = Infinity;
            items.forEach(function (it, i) {
                var dist = Math.abs(it.offsetTop - top);
                if (dist < bestDist) { bestDist = dist; best = i; }
            });
            return { items: items, index: best };
        }

        function _goTo(index, items) {
            if (index < 0 || index >= items.length) return;
            locked = true;
            items[index].scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(function () { locked = false; }, LOCK_MS);
        }

        container.addEventListener('touchstart', function (e) {
            if (locked) return;
            startY = e.touches[0].clientY;
            startX = e.touches[0].clientX;
            tracking = true;
        }, { passive: true });

        container.addEventListener('touchmove', function (e) {
            if (!tracking || locked) return;
            var dy = Math.abs(e.touches[0].clientY - startY);
            var dx = Math.abs(e.touches[0].clientX - startX);
            /* Block native vertical scroll so it can never combine with
               our own programmatic paging below. */
            if (dy > dx) e.preventDefault();
        }, { passive: false });

        container.addEventListener('touchend', function (e) {
            if (!tracking || locked) { tracking = false; return; }
            tracking = false;
            var deltaY = startY - e.changedTouches[0].clientY;
            if (Math.abs(deltaY) < SWIPE_THRESHOLD) return;
            var cur = _nearestIndex();
            var targetIndex = deltaY > 0 ? cur.index + 1 : cur.index - 1;
            _goTo(targetIndex, cur.items);
        }, { passive: true });
    }


    /* Minimal self-contained fallback for the avatar-tap profile preview —
       only used if window._openAvatarPreviewSheet (app-chat.js's real,
       shared bottom-sheet preview, exposed 2026-08-11) hasn't loaded for
       some reason. Fetches just enough (avatar/username/bio) directly from
       Firestore and shows it in a small centered sheet with a "View Full
       Profile" button that hands off to the same full-navigate path the
       username tap uses. */
    function _openReelProfilePreviewFallback(uid) {
        var existing = document.getElementById('reel-profile-preview-sheet');
        if (existing) existing.remove();
        var sheet = document.createElement('div');
        sheet.id = 'reel-profile-preview-sheet';
        sheet.innerHTML =
            '<div class="reel-profile-preview-backdrop"></div>'
            + '<div class="reel-profile-preview-card">'
                + '<button class="reel-profile-preview-close" aria-label="Close">&times;</button>'
                + '<div class="reel-profile-preview-avatar-wrap"><img class="reel-profile-preview-avatar" src=""></div>'
                + '<div class="reel-profile-preview-username">@user</div>'
                + '<div class="reel-profile-preview-bio">Loading…</div>'
                + '<button class="reel-profile-preview-full-btn" data-view-profile="' + _esc(uid) + '">View Full Profile</button>'
            + '</div>';
        document.body.appendChild(sheet);
        var close = function () { sheet.remove(); };
        sheet.querySelector('.reel-profile-preview-backdrop').addEventListener('click', close);
        sheet.querySelector('.reel-profile-preview-close').addEventListener('click', close);
        sheet.querySelector('.reel-profile-preview-full-btn').addEventListener('click', function () {
            close();
            if (typeof window.renderUserProfile === 'function') window.renderUserProfile(uid);
            if (typeof window.navigateTo === 'function') window.navigateTo('profile');
            _closeReelViewer();
        });
        if (window.fbDb && uid) {
            window.fbDb.collection('users').doc(uid).get().then(function (doc) {
                if (!doc.exists) return;
                var u = doc.data() || {};
                var av = sheet.querySelector('.reel-profile-preview-avatar');
                var un = sheet.querySelector('.reel-profile-preview-username');
                var bio = sheet.querySelector('.reel-profile-preview-bio');
                if (av) av.src = u.avatar || '';
                if (un) un.textContent = '@' + (u.username || 'user');
                if (bio) bio.textContent = u.bio || 'No bio yet.';
            }).catch(function () {});
        }
    }

    /* Opens the shared body-level comments drawer for a given reel. Shared
       by both the fullscreen viewer's engagement-bar Comment button
       (.reel-eng-btn.reel-comment-btn) and the grid card's kebab-menu
       Comment item (.reel-kebab-item.reel-comment-btn, added this session
       per point 2) — both just carry the same .reel-comment-btn class +
       data-reel-id, so one shared implementation covers both entry points. */
    function _openReelCommentsDrawer(reelId) {
        var sharedDr    = document.getElementById('reel-shared-comments-drawer');
        var sharedList  = document.getElementById('reel-shared-comments-list');
        var scrim2      = document.getElementById('reel-comments-scrim');
        var badge       = document.getElementById('reel-comments-count-badge');
        var avatarImg   = document.getElementById('reel-commenter-avatar');
        if (!sharedDr || !sharedList) return;
        /* Tag drawer with the current reel so send/reply handlers know which reel */
        sharedDr.dataset.reelId = reelId;
        /* Reset reply state on input */
        var sharedInput = document.getElementById('reel-shared-comment-input');
        if (sharedInput) { sharedInput.value = ''; delete sharedInput.dataset.replyTo; sharedInput.placeholder = 'Add a comment…'; }
        /* Set commenter avatar */
        if (avatarImg) avatarImg.src = _us().avatar || '';
        /* Render existing comments */
        _renderComments(reelId, sharedList);
        /* FIX (2026-10-20): load the saved comments from Firestore every time the drawer opens, so a
           reel opened from the grid (no viewer hydrate yet) or after a re-login shows its real thread.
           _seedReelDataFromDoc re-renders the open drawer + badge once they arrive. */
        if (window.fbDb && reelId) {
            window.fbDb.collection('reels').doc(reelId).get().then(function (doc) {
                if (doc && doc.exists) _seedReelDataFromDoc(reelId, doc.data() || {});
            }).catch(function (err) { console.warn('[Reel comments load]', err && err.message); });
        }
        /* Update count badge */
        var countData = _getReelData(reelId);
        if (badge) badge.textContent = countData.comments.length ? '(' + countData.comments.length + ')' : '';
        /* Show */
        sharedDr.classList.add('open');
        if (scrim2) scrim2.classList.add('active');
        /* Focus input */
        setTimeout(function () { if (sharedInput) sharedInput.focus(); }, 350);
    }

    /* =========================================================================
       §3  EVENT DELEGATION for reel viewer
       ========================================================================= */
    document.addEventListener('click', function (e) {
        var t = e.target;

        /* ── Grid card kebab ("more options") menu ── */
        var kebabWrap = t.closest('.reel-kebab-wrap');
        if (!kebabWrap) {
            /* Clicked anywhere outside any kebab menu — close whatever's
               open and keep going; this isn't a return, the click may still
               need to do something else (e.g. open the reel viewer). */
            _closeAllKebabMenus(null);
        } else {
            /* COMMENT RELOCATION (this session, point 2): "Comment" is now
               the first item inside this same kebab menu (see the card
               template in app-feed.js) instead of its own pill next to the
               three-dot button. It reuses the exact .reel-comment-btn class
               the shared handler further down this listener already knows
               how to open the drawer for — this branch just needs to run
               FIRST (before the generic ".reel-kebab-item" catch-all a few
               lines down, which would otherwise just close the menu and
               stop) so tapping it both closes the menu AND opens the
               drawer, then hands off to that shared drawer-opening logic. */
            var kebabCommentBtn = t.closest('.reel-comment-btn');
            if (kebabCommentBtn) {
                var kMenu = kebabWrap.querySelector('.reel-kebab-menu');
                if (kMenu) kMenu.classList.remove('open');
                _openReelCommentsDrawer(kebabCommentBtn.dataset.reelId);
                e.stopPropagation();
                return;
            }

            var kebabToggle = t.closest('.reel-kebab-btn');
            if (kebabToggle) {
                var menu = kebabWrap.querySelector('.reel-kebab-menu');
                if (menu) {
                    var willOpen = !menu.classList.contains('open');
                    _closeAllKebabMenus(willOpen ? menu : null);
                    if (willOpen) { _restoreKebabMenuDefault(menu); _syncKebabMenuLikeState(menu, kebabToggle.dataset.reelId); menu.classList.add('open'); }
                    else { menu.classList.remove('open'); }
                }
                e.stopPropagation();
                return;
            }

            var reportBtn = t.closest('.reel-report-btn');
            if (reportBtn) {
                var reportMenu = kebabWrap.querySelector('.reel-kebab-menu');
                if (reportMenu) _showReportReasons(reportBtn.dataset.reelId, reportMenu);
                e.stopPropagation();
                return;
            }

            var reportCancelBtn = t.closest('.reel-report-cancel-btn');
            if (reportCancelBtn) {
                var cancelMenu = kebabWrap.querySelector('.reel-kebab-menu');
                if (cancelMenu) _restoreKebabMenuDefault(cancelMenu);
                e.stopPropagation();
                return;
            }

            var reasonBtn = t.closest('.reel-report-reason-btn');
            if (reasonBtn) {
                _submitReelReport(reasonBtn.dataset.reelId, reasonBtn.dataset.reason);
                var reasonMenu = kebabWrap.querySelector('.reel-kebab-menu');
                if (reasonMenu) { _restoreKebabMenuDefault(reasonMenu); reasonMenu.classList.remove('open'); }
                e.stopPropagation();
                return;
            }

            /* BUGFIX (2026-08-22 — kebab-menu "Share" tap did nothing at
               all): the comment that used to sit here claimed Share
               (along with Download/Like) "already has its own dedicated
               handler further down in this same delegated listener" —
               true for the FULLSCREEN VIEWER's separate
               .reel-eng-btn.reel-share-btn (not inside .reel-kebab-wrap),
               but false for THIS grid-card kebab menu's
               .reel-kebab-item.reel-share-btn: same class name, different
               element. The generic ".reel-kebab-item" catch-all a few
               lines below unconditionally closes the menu and returns for
               EVERY item in this menu — including Share — before the
               real handler (further down, ~line 5565) ever runs. Comment
               and Report already got their own explicit case above for
               this exact reason; Share needed the same. Scoped to Share
               only (the one reported broken) — Download/Like sit behind
               this identical structural gap but weren't part of this
               report, so they're deliberately left as-is to avoid scope
               creep; see the updated comment below.

               FOLLOW-UP (same day — "open a list of social media apps to
               share to, matching other sections"): now opens
               window._empShowShareSheet(url, text) — the SAME "share to
               WhatsApp / Facebook / Twitter / Telegram / LinkedIn / Email"
               sheet every other section of this app already uses (see
               app-thread.js's _showFallbackSheet/_desktopLinks, exposed
               globally there for exactly this kind of reuse). Each option
               in that sheet is a real <a target="_blank"> to that
               platform's own share URL, so picking one opens it in a new
               tab. This replaces the OS share-drawer/clipboard-copy this
               case used a moment ago — the in-app rebroadcast-to-profile
               action alongside it (_rebroadcastReel, unrelated to which
               UI shows the outbound share options) is untouched. */
            var kebabShareBtn = t.closest('.reel-share-btn');
            if (kebabShareBtn) {
                var kShareMenu = kebabWrap.querySelector('.reel-kebab-menu');
                if (kShareMenu) kShareMenu.classList.remove('open');
                var kShareReelId = kebabShareBtn.dataset.reelId || '';
                var kShareUrl    = kebabShareBtn.dataset.url || window.location.href;
                if (kShareReelId) _rebroadcastReel(kShareReelId);
                if (typeof window._empShowShareSheet === 'function') {
                    window._empShowShareSheet(kShareUrl, 'Check out this reel on Empyrean!');
                } else if (navigator.share) {
                    navigator.share({ title: 'Empyrean Reel', url: kShareUrl }).catch(function () {});
                } else {
                    navigator.clipboard && navigator.clipboard.writeText(kShareUrl);
                    _notify('Link copied!', 'success');
                }
                e.stopPropagation();
                return;
            }

            /* Any other action inside the kebab menu (Download / Like /
               Edit / Delete) — Download/Like/Report already have their
               own dedicated handlers further down in this same delegated
               listener (identical classnames used by the fullscreen
               viewer's own engagement bar) — though, same structural gap
               just fixed for Share above, those two remain unreachable
               from THIS menu specifically. Not touched here — out of
               scope for this fix, see the BUGFIX note above. Edit/Delete
               are handled by their own listener elsewhere (app-fixes.js).
               Just close the menu as a courtesy either way. */
            if (t.closest('.reel-kebab-item')) {
                menu = kebabWrap.querySelector('.reel-kebab-menu');
                if (menu) menu.classList.remove('open');
            }

            /* BUGFIX (this session) — "3 dots opens full screen": Edit and
               Delete have no dedicated case in THIS listener (their own
               handler lives in app-fixes.js), and a plain click was ALSO
               possible on the kebab wrap's own padding, so control used to
               fall all the way through every remaining check below —
               including the unconditional "Reel card click (from grid)"
               one at the very end of this listener — and quietly open the
               fullscreen viewer underneath whatever the person actually
               tapped. Every click that lands inside .reel-kebab-wrap
               (toggle, any menu item, or its own padding) is this kebab's
               business alone, never the card's — so it always returns
               here now, regardless of which specific case above matched. */
            e.stopPropagation();
            return;
        }

        /* ── Grid card: play/pause the active reel's audio+video ── */
        var playPauseBtn = t.closest('.reel-playpause-btn');
        if (playPauseBtn) {
            var ppCard = playPauseBtn.closest('.reel-card');
            var ppVid  = ppCard && ppCard.querySelector('.reel-video-wrap > video');
            if (ppVid) {
                var ppIcon = playPauseBtn.querySelector('i');
                if (ppVid.paused) {
                    ppVid.play().catch(function () {});
                    if (ppIcon) { ppIcon.classList.remove('fa-play'); ppIcon.classList.add('fa-pause'); }
                } else {
                    ppVid.pause();
                    if (ppIcon) { ppIcon.classList.remove('fa-pause'); ppIcon.classList.add('fa-play'); }
                }
            }
            e.stopPropagation();
            return;
        }

        /* ── Grid card: mute/unmute the active reel's audio — RESTORED
           (2026-08-11): the pinned/"fixed" reel autoplays muted (a hard
           browser requirement) and, with this control missing, there was
           no way left for a person to ever actually hear it. Tapping this
           is the required user gesture that lets the browser allow sound. */
        var muteBtn = t.closest('.reel-mute-btn');
        if (muteBtn) {
            var muCard = muteBtn.closest('.reel-card');
            var muVid  = muCard && muCard.querySelector('.reel-video-wrap > video');
            if (muVid) {
                muVid.muted = !muVid.muted;
                _empReelSoundPref = !muVid.muted; /* remember choice so later reels follow it */
                var muIcon = muteBtn.querySelector('i');
                if (muVid.muted) {
                    muteBtn.classList.remove('reel-mute-btn-unmuted');
                    if (muIcon) { muIcon.classList.remove('fa-volume-up'); muIcon.classList.add('fa-volume-mute'); }
                } else {
                    muteBtn.classList.add('reel-mute-btn-unmuted');
                    if (muIcon) { muIcon.classList.remove('fa-volume-mute'); muIcon.classList.add('fa-volume-up'); }
                    /* Some browsers won't actually play unmuted audio unless
                       playback is (re)kicked off inside this same user-
                       gesture handler — cheap and harmless if it was
                       already playing. */
                    muVid.play().catch(function () {});
                }
            }
            e.stopPropagation();
            return;
        }

        /* ── Like reel ── */
        var likeBtn = t.closest('.reel-like-btn');
        if (likeBtn) {
            if (_isGuest()) { _notify('Login to like reels.', 'info'); return; }
            var reelId = likeBtn.dataset.reelId;
            var uid    = _us().id;
            if (!reelId || !uid) return;
            var data   = _getReelData(reelId);
            var idx    = data.likedBy.indexOf(uid);
            var wasLiked = idx > -1;
            /* Optimistic UI first — the live listener already attached for
               this on-screen reel (_attachReelLiveCounts, from
               _setupReelObserver) reconciles the authoritative number a
               moment later; this just avoids a dead-feeling tap while that
               round-trip is in flight. */
            if (wasLiked) {
                data.likedBy.splice(idx, 1); data.likes = Math.max(0, data.likes - 1);
            } else {
                data.likedBy.push(uid); data.likes++;
                /* FIX (2026-08-22 — "Missing or insufficient permissions"
                   FirebaseError + unhandled promise rejection on reel Like,
                   traced via console diagnostics): this passed
                   likeBtn.dataset.userId — the REEL OWNER's id (see the
                   engagement bar's own markup, data-user-id="<reel
                   owner>") — as the reward's targetUserId. app-impactmining.js's
                   _processReward() resolves ITS recipient from that id, so
                   this was crediting the reel's OWNER, not the person who
                   tapped Like. ENGAGE_LIKE is documented (app-impactmining.js,
                   SELF_MINING_SERVER_ACTIONS comment) as a SELF-target
                   action — the liker is the recipient, same as the OTHER
                   ENGAGE_LIKE call site a few hundred lines down (comment
                   likes), which already calls _reward('ENGAGE_LIKE') with
                   no target for exactly that reason. Because the recipient
                   here resolved to someone OTHER than the acting user, the
                   selfDelta/server-authoritative-claim branch in
                   _processReward never fired (it requires recipient.id ===
                   the acting user's id), so this fell through to the old
                   direct client Firestore balance write for a stranger's
                   /users/{uid} doc — a write firebase-rules.js's rules
                   (correctly) don't grant for a bare engagement reward,
                   producing exactly this permission error on every reel
                   like. Dropping the second argument makes this self-target,
                   matching every other ENGAGE_LIKE call site and routing
                   through the same secure server claim endpoint the rest of
                   this reward already uses — no more direct client write at
                   all for this action. */
                _reward('ENGAGE_LIKE');
            }
            _refreshReelEngagementUI(reelId);
            /* FIX (this session — "the rebroadcast feature was absent" /
               "indicate the numbers... liking"): this used to stop here —
               a purely local counter, invisible to anyone else and reset
               on reload. Now a real, persisted toggle, same
               increment/arrayUnion-or-arrayRemove shape _rebroadcastReel
               already uses for retweetCount/retweetedBy above. */
            if (window.fbDb) {
                var fvLike = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
                var likeUpdate = {};
                likeUpdate.likeCount = fvLike ? fvLike.increment(wasLiked ? -1 : 1) : data.likes;
                if (fvLike) likeUpdate.likedBy = wasLiked ? fvLike.arrayRemove(uid) : fvLike.arrayUnion(uid);
                window.fbDb.collection('reels').doc(reelId).update(likeUpdate).catch(function (err) {
                    console.warn('[Reel like] write failed:', err && err.message);
                });
            }
            return;
        }

        /* ── Open comments (shared body-level drawer) ── */
        var commentBtn = t.closest('.reel-comment-btn');
        if (commentBtn) {
            _openReelCommentsDrawer(commentBtn.dataset.reelId);
            return;
        }

        /* ── Close comments ── */
        var closeCom = t.closest('.reel-comments-close-btn');
        if (closeCom) {
            _closeCommentsDrawer();
            return;
        }

        /* ── Send comment ── */
        var sendBtn = t.closest('.reel-comment-send-btn');
        if (sendBtn) {
            if (_isGuest()) { _notify('Login to comment.', 'info'); return; }
            /* FIX (2026-08-13 — "Missing or insufficient permissions" /
               unhandled promise rejection on #reel-shared-send-btn,
               confirmed via console): this button was the one write path
               in this file that never got the _requireAnySessionForWrite()
               guard already applied to Like/Gift/Rebroadcast above (see
               that helper's own comment for the root cause — a tap that
               lands in the gap before window.fbAuth.currentUser has
               actually attached, real OR anonymous, reaches the Firestore
               write anyway and is denied server-side). Same fix here:
               check for a live session first and give a clear, recoverable
               message instead of letting the write fail silently/loudly
               later. */
            if (!_requireAnySessionForWrite()) return;
            var inputRow = sendBtn.closest('.reel-comment-input-row');
            var inputEl  = inputRow ? inputRow.querySelector('.reel-comment-input') : null;
            if (!inputEl || !inputEl.value.trim()) return;
            /* Shared body-level drawer (has id, not class) */
            var drawer3  = document.getElementById('reel-shared-comments-drawer');
            var reelId3  = drawer3 ? drawer3.dataset.reelId : '';
            if (!reelId3) return;
            var text3 = inputEl.value.trim();
            /* Check if it's a reply */
            var parentId = inputEl.dataset.replyTo || '';
            var us = _us();
            var comment = {
                id:        'c-' + Date.now(),
                reelId:    reelId3,
                parentId:  parentId,
                userId:    us.id,
                username:  us.fullName || us.username || 'User',
                avatar:    us.avatar || '',
                text:      text3,
                createdAt: new Date().toISOString(),
                likes:     0, likedBy: [], replies: []
            };
            var data3 = _getReelData(reelId3);
            if (parentId) {
                var parent = data3.comments.find(function (c) { return c.id === parentId; });
                if (parent) { if (!parent.replies) parent.replies = []; parent.replies.push(comment); }
            } else {
                data3.comments.push(comment);
            }
            inputEl.value = '';
            delete inputEl.dataset.replyTo;
            var placeholder = inputEl.getAttribute('data-original-placeholder') || 'Add a comment…';
            inputEl.placeholder = placeholder;
            /* Update Firestore */
            /* FIX (2026-08-13 — unhandled promise rejection, confirmed via
               console): .update() returns a promise — wrapping the CALL in
               a synchronous try/catch (the previous code) only catches a
               synchronous throw, never an async rejection, so a
               permission-denied response from the server was surfacing as
               an unhandled promise rejection instead of being handled here.
               A real .catch() actually receives it now. The comment stays
               visible locally either way (same optimistic-UI tradeoff this
               file already accepts for Like/Retweet) — this only stops the
               failure from being silent/uncaught and tells the person their
               comment may not have saved, instead of leaving them thinking
               it did. */
            if (window.fbDb && reelId3) {
                /* FIX (2026-10-20): a new TOP-LEVEL comment is appended with arrayUnion instead of
                   rewriting the whole array from the local copy — previously a reel whose comments
                   hadn't been loaded yet would have its existing thread OVERWRITTEN by just the new
                   comment. Replies still rewrite the array (they edit a parent), which is safe now
                   that the drawer loads the saved thread before anyone can reply. */
                var _FV3 = window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue;
                var _cPayload = (!parentId && _FV3) ? { comments: _FV3.arrayUnion(comment) } : { comments: data3.comments };
                window.fbDb.collection('reels').doc(reelId3).update(_cPayload)
                    .catch(function (err) {
                        console.warn('[Reel comment send]', err && err.message);
                        _notify('Your comment may not have saved — check your connection and try again.', 'warning');
                    });
            }
            var listEl3 = document.getElementById('reel-shared-comments-list') || (drawer3 ? drawer3.querySelector('.reel-comments-list') : null);
            if (parentId) {
                /* Reply nests inside an existing comment's sub-thread — re-render
                   so the parent's sub-comment block reflects the new reply. */
                _renderComments(reelId3, listEl3);
            } else {
                /* New top-level comment — append in place so the list doesn't
                   flicker or reset scroll position for anyone reading older
                   comments above. */
                _appendComment(reelId3, listEl3, comment);
            }
            var cc = document.querySelector('.reel-viewer-item[data-reel-id="' + reelId3 + '"] .reel-comment-count');
            if (cc) cc.textContent = data3.comments.length;
            /* Update badge in header */
            var badge3 = document.getElementById('reel-comments-count-badge');
            if (badge3) badge3.textContent = data3.comments.length ? '(' + data3.comments.length + ')' : '';
            _reward('ENGAGE_COMMENT');
            return;
        }

        /* ── Reply to comment ── */
        var replyBtn = t.closest('.reel-comment-reply-btn');
        if (replyBtn) {
            var inputEl2 = document.getElementById('reel-shared-comment-input');
            if (!inputEl2) return;
            var commentId4 = replyBtn.dataset.commentId;
            inputEl2.dataset.replyTo = commentId4;
            if (!inputEl2.dataset.originalPlaceholder) inputEl2.dataset.originalPlaceholder = inputEl2.placeholder;
            inputEl2.placeholder = 'Replying…';
            inputEl2.focus();
            return;
        }

        /* ── Like a comment ── */
        var commentLikeBtn = t.closest('.reel-comment-like-btn');
        if (commentLikeBtn && commentLikeBtn.dataset.commentId) {
            if (_isGuest()) { _notify('Login to like comments.', 'info'); return; }
            var reelId5  = commentLikeBtn.dataset.reelId;
            var cId5     = commentLikeBtn.dataset.commentId;
            var subId5   = commentLikeBtn.dataset.subcommentId;
            var parentId5= commentLikeBtn.dataset.parentId;
            var uid5     = _us().id;
            var data5    = _getReelData(reelId5);
            var targetComment;
            if (subId5 && parentId5) {
                var parent5 = data5.comments.find(function (c) { return c.id === parentId5; });
                if (parent5) targetComment = (parent5.replies || []).find(function (r) { return r.id === subId5; });
            } else {
                targetComment = data5.comments.find(function (c) { return c.id === cId5; });
            }
            if (!targetComment) return;
            if (!targetComment.likedBy) targetComment.likedBy = [];
            var cIdx = targetComment.likedBy.indexOf(uid5);
            if (cIdx > -1) {
                targetComment.likedBy.splice(cIdx, 1);
                targetComment.likes = Math.max(0, (targetComment.likes || 0) - 1);
                commentLikeBtn.classList.remove('liked');
            } else {
                targetComment.likedBy.push(uid5);
                targetComment.likes = (targetComment.likes || 0) + 1;
                commentLikeBtn.classList.add('liked');
                _reward('ENGAGE_LIKE');
            }
            commentLikeBtn.innerHTML = '<i class="fas fa-heart"></i> ' + targetComment.likes;
            return;
        }

        /* ── Retweet reel ── */
        var rtBtn = t.closest('.reel-retweet-btn');
        if (rtBtn) {
            if (_isGuest()) { _notify('Login to retweet.', 'info'); return; }
            var reelId6 = rtBtn.dataset.reelId;
            var uid6    = _us().id;
            if (!reelId6 || !uid6) return;
            var data6   = _getReelData(reelId6);
            var idx6    = data6.retweetedBy.indexOf(uid6);
            if (idx6 > -1) {
                /* Already reposted — tap undoes it. FIX (this session —
                   "the rebroadcast feature was absent"): this used to just
                   decrement a local counter, leaving the actual repost doc
                   (now a real Firestore write, see _rebroadcastReel) still
                   sitting on the person's profile/the main feed forever —
                   removing it here now really deletes it. The premium "Add
                   a comment / Repost" card is only for CREATING a new
                   repost, so removing an existing one doesn't need to go
                   through it. */
                var repostId6 = window._reelRebroadcastedIds && window._reelRebroadcastedIds[reelId6 + '::' + uid6 + '::retweet'];
                if (repostId6) {
                    _undoReelRetweet(reelId6, repostId6, uid6);
                } else {
                    /* FIX (2026-08-29 — "does nothing"): the local id cache
                       above doesn't survive a reload/new session — look the
                       repost doc up directly instead of silently giving up.
                       See _undoReelRetweetByLookup()'s own header. */
                    _undoReelRetweetByLookup(reelId6, uid6);
                }
            } else {
                /* NEW (this session — premium repost card): instead of
                   reposting instantly, open a small card offering "Add a
                   comment" (opens a text composer) or "Repost" (instant —
                   the exact behavior this button used to have on its
                   own). See _openReelRepostCard()/_submitReelRetweet(). */
                _openReelRepostCard(reelId6, 'retweet');
            }
            return;
        }

        /* ── Share reel → external apps + internal Empyrean 1:1/group
           chat/status ── (FIX 2026-08-29 — "share button should share to
           external app and internal empyrean 1:1, group chat and
           status"): Share used to open the SAME repost-to-own-profile
           card the Retweet button uses, with "Share externally" bolted
           on as a third row inside it — so the two buttons did almost
           the same thing, and there was no way to actually send a reel
           into a specific person's chat, a group, or your own Status.
           Routes through window.EmpShare.open() instead — the same
           universal "Share to…" sheet app-feed.js's own post-Share
           button already uses (Empyrean tile → My Status / Groups /
           Direct chats with multi-select and a real Send; WhatsApp tile;
           native "More" share sheet for Facebook/Instagram/Telegram/
           everything else the OS offers) — so a reel now shares exactly
           the way a feed post already does, instead of a second,
           divergent implementation. Falls back to the previous repost-
           card share flow only if EmpShare hasn't loaded, so this can
           never regress to a dead tap. Retweet (above) is untouched —
           "repost this to my own profile" stays exactly what it does. */
        var shareBtn = t.closest('.reel-share-btn');
        if (shareBtn) {
            var reelId7 = shareBtn.dataset.reelId || '';
            var url7 = shareBtn.dataset.url || window.location.href;

            /* Real, persisted share-tap count — see _registerReelShare()'s
               own header for why this fires on tap, same as Download. */
            if (reelId7) _registerReelShare(reelId7);

            if (window.EmpShare && typeof window.EmpShare.open === 'function') {
                var itemEl7    = reelId7 ? document.querySelector('.reel-viewer-item[data-reel-id="' + reelId7 + '"]') : null;
                var captionEl7 = itemEl7 ? itemEl7.querySelector('.reel-caption') : null;
                var srcVideo7  = itemEl7 ? itemEl7.querySelector('video') : null;
                window.EmpShare.open({
                    text: captionEl7 ? captionEl7.textContent.trim() : '',
                    mediaUrl: srcVideo7 ? (srcVideo7.currentSrc || srcVideo7.src || '') : '',
                    mediaType: 'video',
                    pageUrl: url7,
                    onMore: function () {
                        /* FIX (2026-08-30 — bug: "clicking More does
                           nothing"): navigator.share()'s rejection was
                           caught and discarded with an empty function —
                           any failure (lost transient-activation between
                           the tap and the async call, no share targets,
                           an invalid url, etc.) produced total silence,
                           no native sheet and no fallback. Now falls back
                           to copy-link + a toast on any real failure,
                           matching the exact fallback this same file
                           already uses one branch up when navigator.share
                           isn't available at all, and matching
                           app-patch-v13.js's own generic _shareNative()
                           fallback for the same tile when this file's own
                           onMore isn't supplied. AbortError (the person
                           just closed the native sheet themselves) is left
                           silent on purpose — that's not a failure. */
                        if (navigator.share) {
                            navigator.share({ title: 'Empyrean Reel', url: url7 }).catch(function (err) {
                                if (err && err.name === 'AbortError') return;
                                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url7);
                                _notify('Could not open the share menu — link copied instead.', 'info');
                            });
                        }
                        else { navigator.clipboard && navigator.clipboard.writeText(url7); _notify('Link copied!', 'success'); }
                    }
                });
                return;
            }

            /* Fallback — EmpShare not loaded for some reason. Previous
               behavior, unchanged. */
            if (!reelId7) {
                if (navigator.share) navigator.share({ title: 'Empyrean Reel', url: url7 }).catch(function () {});
                else { navigator.clipboard && navigator.clipboard.writeText(url7); _notify('Link copied!', 'success'); }
                return;
            }
            _openReelRepostCard(reelId7, 'share', url7);
            return;
        }

        /* ── Download reel ── */
        var dlBtn = t.closest('.reel-download-btn');
        if (dlBtn) {
            var url8 = dlBtn.dataset.url || '';
            if (!url8) { _notify('Video URL not available.', 'error'); return; }
            var reelId8 = dlBtn.dataset.reelId;
            var _dlAncestor8 = dlBtn.closest('.reel-card, .reel-viewer-item');
            var _dlUsername8 = dlBtn.dataset.username || (_dlAncestor8 && _dlAncestor8.dataset.username) || '';
            var _dlFilename8 = 'empyrean-reel-' + (reelId8 || Date.now());

            /* "Enable live counts indicator... downloading" (earlier session):
               real, persisted count — every reel downloaded by anyone,
               same increment-only shape as viewCount above (no per-user
               toggle/dedupe needed here; each download is its own event,
               unlike like/retweet which are on/off states). Runs regardless
               of whether the watermark step below succeeds or falls back —
               a download is a download either way. */
            function _countReelDownload8() {
                _notify('Download started!', 'success');
                if (reelId8 && window.fbDb) {
                    var data8 = _getReelData(reelId8);
                    data8.downloads = (data8.downloads || 0) + 1;
                    _refreshReelEngagementUI(reelId8);
                    var fv8 = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
                    if (fv8 && typeof fv8.increment === 'function') {
                        window.fbDb.collection('reels').doc(reelId8).update({ downloadCount: fv8.increment(1) }).catch(function () {});
                    }
                }
            }

            /* FIX (2026-09-01 — "clicking download opens the video instead
               of downloading it, especially in Reels; show a progress
               tracker"): ROOT CAUSE — this button's old fallback
               (_plainReelDownload8, now removed) built a raw
               `<a href="https://res.cloudinary.com/...mp4" target="_blank"
               download>`. Browsers ignore the `download` attribute on a
               CROSS-ORIGIN href, which is exactly what a Cloudinary URL
               always is here — so all that was left was `target="_blank"`,
               which just navigates the new tab to the raw video (i.e. it
               opens/plays instead of saving). That fallback fired on
               EVERY download whenever the watermark re-encode path below
               failed or wasn't supported — which, on a lot of devices, is
               most of the time (captureStream()+MediaRecorder needs a
               clean, CORS-served source; a slow/blip connection or an
               older Android WebView is enough to fail the re-encode and
               fall through to the broken fallback). Two fixes, both
               reusing app-fixes.js's already-fixed helpers instead of a
               second, separate implementation of the same logic:
                 1. The fallback now goes through _triggerDownloadClick()
                    (app-fixes.js), which prefers Cloudinary's own
                    `fl_attachment` flag — that makes CLOUDINARY'S response
                    itself carry `Content-Disposition: attachment`, forcing
                    a real save-to-device independent of CORS/target
                    entirely. A raw cross-origin `target="_blank"` open is
                    now the last resort only for a non-Cloudinary URL, not
                    the default path.
                 2. A visible progress pill (_createDownloadTracker, same
                    one every other download button in this app already
                    uses) is now anchored to this button for the whole
                    fetch (0-40%) + re-encode (40-100%) sequence, instead of
                    downloads reel-side happening silently with no feedback
                    on a large video over a slow connection. */
            var _dlTracker8 = (typeof window._createDownloadTracker === 'function')
                ? window._createDownloadTracker(dlBtn, 1)
                : { update: function () {}, finish: function () {} };

            function _plainReelDownload8() {
                if (typeof window._triggerDownloadClick === 'function') {
                    window._triggerDownloadClick(url8, _dlFilename8 + '.mp4');
                } else {
                    // Extremely defensive fallback if app-fixes.js somehow
                    // hasn't loaded yet — same-tab, no target="_blank", so
                    // at worst the browser's native "Save As"/download bar
                    // kicks in rather than a blank opened tab.
                    var a = document.createElement('a');
                    a.href = url8;
                    a.download = _dlFilename8 + '.mp4';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                }
                _dlTracker8.update(0, 100);
                _dlTracker8.finish();
                _countReelDownload8();
            }

            /* FEATURE (2026-08-31 — "add the Empyrean watermark to video
               downloads in the reel section and other videos across the
               site, dynamically inserting the username of the poster, just
               like TikTok"): reuses app-fixes.js's own watermark engine —
               window._fetchWithProgress / _canWatermarkVideo /
               _watermarkVideoBlob, exposed on window there for exactly this
               reuse — instead of a second, separate watermarking
               implementation (the same "another layer racing the other
               ones" trap this codebase has repeatedly called out, e.g.
               app-patch-v42.js's own note that it could NOT reach these
               same private routines before they were exposed). This gives
               reel downloads the identical corner watermark feed/news/
               marketplace video downloads already had, now with the
               reel's own poster's @username burned in as the dynamic
               second line — captured off the card at render time onto
               data-username (see this button's markup above and
               app-feed.js's matching kebab-menu button). Falls back to a
               real, working plain download (see _plainReelDownload8 above)
               on any unsupported browser or failed re-encode — a download
               must never be lost over a watermarking hiccup. */
            function _clientWatermarkReelDownload8() {
                if (typeof window._canWatermarkVideo === 'function' && window._canWatermarkVideo()
                    && typeof window._fetchWithProgress === 'function' && typeof window._watermarkVideoBlob === 'function') {
                    _notify('⬇ Preparing your download with the Empyrean watermark…', 'info');
                    window._fetchWithProgress(url8, function (pct) { _dlTracker8.update(0, Math.round(pct * 0.4)); }).then(function (blob) {
                        return window._watermarkVideoBlob(blob, function (pct) { _dlTracker8.update(0, 40 + Math.round(pct * 0.6)); }, _dlUsername8).then(function (wmBlob) {
                            // FIX (2026-09-03 — same "downloads but never
                            // reaches device storage" bug as app-fixes.js's
                            // feed download, applies identically here since
                            // this is the same blob-anchor pattern): route
                            // through the shared _empSaveBlobToDevice helper
                            // (app-fixes.js) instead of a raw blob: anchor
                            // click, so this saves correctly in a standalone/
                            // installed PWA on Android too, not just a normal
                            // browser tab. Falls back to the exact previous
                            // anchor-click behavior if app-fixes.js somehow
                            // hasn't loaded yet.
                            return (typeof window._empSaveBlobToDevice === 'function'
                                ? window._empSaveBlobToDevice(wmBlob, _dlFilename8 + '.webm')
                                : new Promise(function (resolve) {
                                    var objUrl = URL.createObjectURL(wmBlob);
                                    var a = document.createElement('a');
                                    a.href = objUrl;
                                    a.download = _dlFilename8 + '.webm';
                                    document.body.appendChild(a); a.click(); a.remove();
                                    setTimeout(function () { URL.revokeObjectURL(objUrl); }, 30000);
                                    resolve();
                                })
                            ).then(function () {
                                _dlTracker8.update(0, 100);
                                _dlTracker8.finish();
                                _countReelDownload8();
                            });
                        }).catch(function (wmErr) {
                            // Re-encode failed partway (codec quirk, playback
                            // error, etc.) — we already HAVE the plain blob
                            // fetched above, so save that directly instead of
                            // re-fetching or falling through to a raw
                            // cross-origin anchor.
                            console.warn('[Reels] watermark re-encode failed, saving the plain fetched file instead:', wmErr && wmErr.message);
                            return (typeof window._empSaveBlobToDevice === 'function'
                                ? window._empSaveBlobToDevice(blob, _dlFilename8 + '.mp4')
                                : new Promise(function (resolve) {
                                    var objUrl2 = URL.createObjectURL(blob);
                                    var a2 = document.createElement('a');
                                    a2.href = objUrl2;
                                    a2.download = _dlFilename8 + '.mp4';
                                    document.body.appendChild(a2); a2.click(); a2.remove();
                                    setTimeout(function () { URL.revokeObjectURL(objUrl2); }, 30000);
                                    resolve();
                                })
                            ).then(function () {
                                _dlTracker8.update(0, 100);
                                _dlTracker8.finish();
                                _countReelDownload8();
                            });
                        });
                    }).catch(function (err) {
                        // The fetch itself failed (CORS/network) — no blob to
                        // fall back to, so go through the fixed
                        // Cloudinary-attachment path instead of a raw open.
                        console.warn('[Reels] download fetch failed, falling back to direct download:', err && err.message);
                        _plainReelDownload8();
                    });
                } else {
                    _plainReelDownload8();
                }
            }

            /* FEATURE (2026-08-31 follow-up — server-side .mp4 watermark):
               tried FIRST, ahead of the client canvas re-encode above —
               calls the new /api/watermark/video route (watermark-routes.js
               on the backend, exposed here as window._watermarkVideoServer
               by app-fixes.js) for a real .mp4 produced by ffmpeg, instead
               of the client-only .webm re-encode. window._empWatermarkServerAvailable
               is a cached health check (also set up in app-fixes.js) so a
               deployment without the server feature — or a signed-out
               session, which the route requires — skips straight to the
               existing client path below rather than attempting (and
               waiting on) a POST that can't succeed. On ANY failure here
               (network error, 413 too-long, 429 server-busy, 503
               unavailable) this falls straight through to
               _clientWatermarkReelDownload8() above, unchanged — so nothing
               about the existing two-tier fallback (client watermark, then
               plain download) is altered, this only adds one more tier
               ahead of it. */
            if (typeof window._watermarkVideoServer === 'function' && window._empWatermarkServerAvailable !== false) {
                _notify('⬇ Preparing your download with the Empyrean watermark…', 'info');
                _dlTracker8.update(0, 15);
                window._watermarkVideoServer(url8, _dlUsername8).then(function (mp4Blob) {
                    // FIX (2026-09-03): same shared-helper swap as the client-
                    // watermark tier above — see its comment for why.
                    return (typeof window._empSaveBlobToDevice === 'function'
                        ? window._empSaveBlobToDevice(mp4Blob, _dlFilename8 + '.mp4')
                        : new Promise(function (resolve) {
                            var objUrl = URL.createObjectURL(mp4Blob);
                            var a = document.createElement('a');
                            a.href = objUrl;
                            a.download = _dlFilename8 + '.mp4';
                            document.body.appendChild(a); a.click(); a.remove();
                            setTimeout(function () { URL.revokeObjectURL(objUrl); }, 30000);
                            resolve();
                        })
                    ).then(function () {
                        _dlTracker8.update(0, 100);
                        _dlTracker8.finish();
                        _countReelDownload8();
                    });
                }).catch(function (serverErr) {
                    console.warn('[Reels] server watermark failed, falling back to client watermark:', serverErr && serverErr.message);
                    _clientWatermarkReelDownload8();
                });
            } else {
                _clientWatermarkReelDownload8();
            }
            return;
        }

        /* ── Avatar tap in reel → open the reel author's picture + bio in
           the SAME bottom-sheet preview the Messages section already uses
           for its own inbox-avatar tap (request, 2026-08-11: "open a
           preview modal like it's done in the message section" — the
           earlier new-tab '?post=profile-<uid>' deep-link this replaces
           landed on a bare native image viewer instead, not a bio
           preview, because '_blank' on this WebView hands the tap off to
           the OS's own image handler rather than staying in-app).
           window._openAvatarPreviewSheet is app-chat.js's real,
           already-built implementation (picture, name, @username, bio,
           profession/location, "View full profile" button) — exposed on
           window specifically so this one implementation covers both the
           inbox and the reel section instead of a second copy. Falls back
           to this file's own minimal sheet (_openReelProfilePreviewFallback,
           further down) only if app-chat.js hasn't loaded for some reason. */
        var avatarPreviewTap = t.closest('[data-preview-profile]');
        if (avatarPreviewTap && avatarPreviewTap.dataset.previewProfile) {
            var puid = avatarPreviewTap.dataset.previewProfile;
            if (puid) {
                if (typeof window._openAvatarPreviewSheet === 'function') {
                    window._openAvatarPreviewSheet(puid, avatarPreviewTap.src || avatarPreviewTap.dataset.fullAvatar || '');
                } else {
                    _openReelProfilePreviewFallback(puid);
                }
            }
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        /* ── Profile tap in reel ── */
        var profTap = t.closest('[data-view-profile]');
        if (profTap && profTap.dataset.viewProfile) {
            var uid9 = profTap.dataset.viewProfile;
            if (uid9) {
                if (typeof window.renderUserProfile === 'function') window.renderUserProfile(uid9);
                if (typeof window.navigateTo === 'function') window.navigateTo('profile');
                _closeReelViewer();
            }
            return;
        }

        /* ── Close reel viewer ── */
        if (t.id === 'reel-exit-btn' || t.closest('#reel-exit-btn')) {
            _closeReelViewer();
            return;
        }

        /* ── Collapse/unpin the grid's pinned "now playing" card (§3) ──
           Routed through history.back() rather than calling
           _unpinActiveReel() directly so this button and a real Back press
           always behave identically and can't drift out of sync — see the
           popstate listener near _unpinActiveReel() above. */
        if (t.closest('.reel-grid-unpin-btn')) {
            if (_activeReelId) { try { history.back(); } catch (e) { _unpinActiveReel(); } }
            return;
        }

        /* ── Reel card click (from grid) ──
           Excludes .reels-live-tv-card (the single live-broadcast card —
           see _renderLiveStrip above): it has no postId/video and its own
           dedicated click handling (watch-btn / avatar-switch, wired
           earlier in this same delegate) — letting it fall through here
           would wrongly try to "pin"/open-viewer on a card that isn't a
           real reel post whenever the person tapped its caption or meta
           row instead of an avatar or the screen itself. */
        var reelCard = t.closest('.reel-card:not(.reels-live-tv-card), .reel-preview-card, .dashboard-reel-card');
        if (reelCard) {
            /* dashboard cards navigate to reels section AND open the EXACT
               reel that was tapped.
               FIX (report — "clicking the card does not currently open
               that particular video but only opens the video at the
               top"): this used to just call navigateTo('reels') with no
               regard for which of the horizontal dashboard thumbnails was
               actually tapped, so the reels section always opened
               whatever the main grid renders on top (newest reel) instead
               of the one the person chose. Every dashboard card already
               carries data-reel-id (see app-feed.js's dashboard slider
               markup); the main grid's own cards carry the SAME id as
               data-post-id (see app-feed.js's "Main reels grid" block).
               This mirrors the exact find-or-wait-then-open pattern
               app-startup.js's own shared-reel-link deep-link handler
               already uses, so a tapped id that hasn't rendered into the
               grid yet (grid may still be loading) is retried briefly
               instead of silently falling back to "whatever's on top". */
            if (reelCard.dataset.navTarget === 'reels' || reelCard.classList.contains('dashboard-reel-card')) {
                var _dashReelId = reelCard.dataset.reelId || '';
                if (typeof window.navigateTo === 'function') window.navigateTo('reels');
                if (_dashReelId) {
                    var _findDashReelEl = function () {
                        return document.querySelector(
                            '.reel-card[data-post-id="' + _dashReelId + '"], .reel-preview-card[data-post-id="' + _dashReelId + '"]'
                        );
                    };
                    var _existingDashReel = _findDashReelEl();
                    if (_existingDashReel) {
                        setTimeout(function () { openReelViewer(_existingDashReel); }, 250);
                    } else {
                        var _dashReelAttempts = 0;
                        var _dashReelPoll = setInterval(function () {
                            _dashReelAttempts++;
                            var _el = _findDashReelEl();
                            if (_el) {
                                clearInterval(_dashReelPoll);
                                setTimeout(function () { openReelViewer(_el); }, 250);
                            } else if (_dashReelAttempts >= 20) {
                                clearInterval(_dashReelPoll);
                            }
                        }, 500);
                    }
                }
                return;
            }
            /* If this card lives in the main reels grid, whatever the person
               just tapped becomes the pinned "now playing" card for that
               grid the next time they're looking at it — see §0 above.
               Scoped to #reels-grid-container only so tapping a reel from a
               profile gallery/strip (a totally different, unrelated set of
               DOM nodes) never disturbs the main grid's own ordering.
               TWO-TAP BEHAVIOR (this session): the first tap on a card that
               isn't the pinned card yet should only pin/play it in the
               fixed "now playing" spot — NOT also jump straight into the
               fullscreen viewer, which used to happen unconditionally on
               every tap. Only a second tap, on the card that's already
               pinned/active, now opens the fullscreen viewer. Checked
               BEFORE promoting (promoting adds .reel-card-active to
               whichever card was just tapped, so the check has to look at
               the card's state as it was before this click). */
            if (reelCard.classList.contains('reel-card') && reelCard.closest('#reels-grid-container')) {
                /* GRID VIEW (2026-10-19): in the two-column grid there is no
                   fixed "now playing" slot to pin into (that pattern is the
                   single-column Feed view's), so a tap opens the fullscreen
                   viewer straight away on the tapped reel. Feed view below is
                   unchanged. See empyreanReelsViewToggle() for the toggle. */
                if (reelCard.closest('#reels-grid-container.reels-view-grid')) {
                    openReelViewer(reelCard);
                    return;
                }
                var wasAlreadyActive = reelCard.classList.contains('reel-card-active');
                _promoteActiveReel(reelCard.dataset.postId || reelCard.dataset.reelId);
                if (!wasAlreadyActive) return;
            }
            openReelViewer(reelCard);
            return;
        }
    });

    /* Enter key to send comment */
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            var active = document.activeElement;
            if (active && active.classList.contains('reel-comment-input')) {
                e.preventDefault();
                var sendBtn2 = active.closest('.reel-comment-input-row') ? active.closest('.reel-comment-input-row').querySelector('.reel-comment-send-btn') : null;
                if (sendBtn2) sendBtn2.click();
            }
        }
    });

    /* Keyboard exit */
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            var ov = document.getElementById('reel-viewer-modal-overlay');
            if (ov && ov.classList.contains('show')) _closeReelViewer();
        }
    });

    /* ── Build shared drawer immediately on load so it's available
       before the first reel is ever opened (app-fix-final.js capture-phase
       handler checks for it synchronously on the first comment-btn click). ── */
    function _ensureSharedDrawer() {
        if (document.getElementById('reel-shared-comments-drawer')) return;
        var scrim = document.createElement('div');
        scrim.id = 'reel-comments-scrim';
        document.body.appendChild(scrim);

        var sharedDrawer = document.createElement('div');
        sharedDrawer.id = 'reel-shared-comments-drawer';
        sharedDrawer.innerHTML = [
            '<div class="reel-comments-header">',
            '<span style="color:white;font-weight:700;font-size:0.95rem;"><i class="fas fa-comment-dots" style="color:#00D4AA;margin-right:6px;"></i>Comments <span id="reel-comments-count-badge" style="font-size:0.78rem;font-weight:400;opacity:0.6;margin-left:4px;"></span></span>',
            '<button class="reel-comments-close-btn" style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.6);font-size:1.1rem;padding:4px 8px;"><i class="fas fa-chevron-down"></i></button>',
            '</div>',
            '<div class="reel-comments-list" id="reel-shared-comments-list"></div>',
            '<div class="reel-comment-input-row">',
            '<img id="reel-commenter-avatar" src="" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display=\'none\'">',
            '<input type="text" class="reel-comment-input" placeholder="Add a comment…" id="reel-shared-comment-input">',
            '<button class="reel-comment-send-btn" id="reel-shared-send-btn" style="background:#00D4AA;border:none;cursor:pointer;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#0A0F1E;">',
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
            '</button>',
            '</div>',
        ].join('');
        document.body.appendChild(sharedDrawer);
        scrim.addEventListener('click', function () { _closeCommentsDrawer(); });
    }

    /* Run immediately if DOM is ready, otherwise wait */
    if (document.body) {
        _ensureSharedDrawer();
    } else {
        document.addEventListener('DOMContentLoaded', _ensureSharedDrawer);
    }

    /* TOPBAR INITIAL SYNC (2026-08-10, this session): #reels-fixed-topbar is
       static markup (always in the DOM, unlike the active reel card, which
       only gets its spacer synced once a reel is promoted — see
       _applyActiveReelOrdering()). Runs once up front so the spacer/CSS var
       are correct even before any reel exists/becomes active; the same
       resize listener wired inside _syncReelsTopbar() keeps it correct
       after that. */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _syncReelsTopbar);
    } else {
        _syncReelsTopbar();
    }

    /* Also expose a global so app-fix-final.js can trigger it as a fallback */
    window._empReelEnsureDrawer = _ensureSharedDrawer;

    /* =========================================================================
       REELS VIEW TOGGLE — GRID (default) / FEED (2026-10-19)
       Two layouts for the SAME #reels-grid-container and the SAME cards:
         • grid — two-column thumbnails, tap opens the fullscreen viewer
         • feed — the original single-column list with the pinned "now
                  playing" card (unchanged)
       Only a class on the container differs (reels-view-grid /
       reels-view-feed); every layout rule lives in style.css under that
       class, and feed mode has no rules of its own, so it renders exactly as
       before. The choice is remembered per device (localStorage 'empReelsView',
       anything other than 'feed' means grid, so first-time visitors get grid).
       The toggle button is injected into #reels-fixed-topbar-row, so no
       index.html edit is needed. Switching to grid while a reel is pinned in
       feed mode first unpins it, through history.back() — the same path the
       collapse button uses — so the fixed card never lingers over the grid.
       ========================================================================= */
    (function empyreanReelsViewToggle() {
        var KEY = 'empReelsView';
        var ICON_GRID = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
        var ICON_FEED = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/></svg>';

        function _saved() {
            try { return localStorage.getItem(KEY) === 'feed' ? 'feed' : 'grid'; }
            catch (e) { return 'grid'; }
        }
        function _current() {
            var g = _reelGrid();
            return (g && g.classList.contains('reels-view-feed')) ? 'feed' : 'grid';
        }

        function _ensureBtn() {
            var row = document.getElementById('reels-fixed-topbar-row');
            if (!row) return null;
            var btn = document.getElementById('reels-view-toggle-btn');
            if (btn) return btn;
            btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'reels-view-toggle-btn';
            btn.className = 'reel-topbar-upload-btn reel-topbar-view-btn';
            var live = document.getElementById('reels-connect-live-btn');
            if (live && live.parentNode === row) row.insertBefore(btn, live); else row.appendChild(btn);
            btn.addEventListener('click', function () {
                _apply(_current() === 'grid' ? 'feed' : 'grid', true);
            });
            return btn;
        }

        function _apply(mode, persist) {
            var grid = _reelGrid();
            if (!grid) return;
            mode = mode === 'feed' ? 'feed' : 'grid';
            if (mode === 'grid' && _activeReelId) {
                try { history.back(); } catch (e) { _unpinActiveReel(); }
            }
            grid.classList.toggle('reels-view-grid', mode === 'grid');
            grid.classList.toggle('reels-view-feed', mode === 'feed');
            var btn = _ensureBtn();
            if (btn) {
                var toFeed = mode === 'grid';
                btn.innerHTML = toFeed ? ICON_FEED : ICON_GRID;
                btn.setAttribute('aria-label', toFeed ? 'Switch to feed view' : 'Switch to grid view');
                btn.title = toFeed ? 'Feed view' : 'Grid view';
            }
            if (persist) { try { localStorage.setItem(KEY, mode); } catch (e) {} }
            try { _syncReelsTopbar(); } catch (e) {}
        }

        function _init() { _apply(_saved(), false); }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
        else _init();
        /* Cheap, idempotent re-assert whenever the Reels section opens, in
           case the container or topbar was rebuilt after first load. */
        document.addEventListener('empyrean-section-change', function (e) {
            if (e && e.detail && e.detail.section === 'reels') _apply(_saved(), false);
        });
    })();

    /* =========================================================================
       PREMIUM REPOST CARD (this session — "clicking retweet in the reel
       fullscreen should open a sleek card with instructions to add a
       comment and retweet; tapping 'add comments' opens a text
       composer"). Two steps in one shared card (built once, reused for
       every reel):
         Step 1 (options) — "Add a comment" or "Repost". "Repost" performs
                 the EXACT instant behavior the Retweet button already had
                 (bump retweetedBy/retweets, mark the button active).
         Step 2 (composer) — reached only via "Add a comment": a plain
                 textarea + Repost button. Submitting reposts AND stores
                 the comment text locally alongside it, in the same
                 local-only store (_reelData) likes/retweets already use —
                 this does not add any new Firestore write, matching how
                 the Retweet button already behaved before this change.
       ========================================================================= */
    var _repostCardReelId = null;
    /* FIX (this session — "clicking share should open the sleek premium
       card thumbnail and display the composer column to write a post"):
       the card is now mode-aware. 'retweet' is the original Retweet-
       button behavior (local-only counter, unchanged). 'share' is new —
       opened by the .reel-share-btn handler above — and its two existing
       options ("Add a comment" / "Repost") now drive the REAL
       _rebroadcastReel() Firestore write (so the result actually shows
       up in the main Reels feed, the dashboard strip, and the poster's
       own profile — see _rebroadcastReel()'s own header for why that's
       automatic once the doc exists), plus a third "Share externally"
       row that does what this button used to do unconditionally
       (native OS share sheet / copy link). */
    var _repostCardMode  = 'retweet';
    var _repostCardUrl   = '';

    function _buildReelRepostCard() {
        if (document.getElementById('reel-repost-card-overlay')) return;

        var scrim = document.createElement('div');
        scrim.id = 'reel-repost-card-scrim';
        document.body.appendChild(scrim);

        var overlay = document.createElement('div');
        overlay.id = 'reel-repost-card-overlay';
        overlay.innerHTML = [
            '<div id="reel-repost-card">',
                '<button type="button" id="reel-repost-card-close" aria-label="Close"><i class="fas fa-times"></i></button>',
                '<div id="reel-repost-card-head">',
                    '<span id="reel-repost-card-icon"><i class="fas fa-retweet"></i></span>',
                    '<img id="reel-repost-card-thumb" alt="" style="display:none;">',
                    '<h4 id="reel-repost-card-title">Repost this reel</h4>',
                '</div>',
                '<div id="reel-repost-card-options">',
                    '<button type="button" class="reel-repost-option" id="reel-repost-opt-comment">',
                        '<span class="reel-repost-option-icon"><i class="fas fa-pen-fancy"></i></span>',
                        '<span class="reel-repost-option-text"><strong id="reel-repost-opt-comment-title">Add a comment</strong><small id="reel-repost-opt-comment-sub">Share your thoughts along with this repost</small></span>',
                        '<i class="fas fa-chevron-right reel-repost-option-chevron"></i>',
                    '</button>',
                    '<button type="button" class="reel-repost-option" id="reel-repost-opt-instant">',
                        '<span class="reel-repost-option-icon reel-repost-option-icon-accent"><i class="fas fa-retweet"></i></span>',
                        '<span class="reel-repost-option-text"><strong id="reel-repost-opt-instant-title">Repost</strong><small id="reel-repost-opt-instant-sub">Instantly repost this reel to your followers</small></span>',
                        '<i class="fas fa-chevron-right reel-repost-option-chevron"></i>',
                    '</button>',
                    '<button type="button" class="reel-repost-option" id="reel-repost-opt-external" style="display:none;">',
                        '<span class="reel-repost-option-icon"><i class="fas fa-paper-plane"></i></span>',
                        '<span class="reel-repost-option-text"><strong>Share externally</strong><small>Send a link via WhatsApp, Messages, or another app</small></span>',
                        '<i class="fas fa-chevron-right reel-repost-option-chevron"></i>',
                    '</button>',
                '</div>',
                '<div id="reel-repost-card-composer">',
                    '<textarea id="reel-repost-comment-inp" placeholder="Add a comment…" rows="3" maxlength="280"></textarea>',
                    '<button type="button" id="reel-repost-comment-submit"><i class="fas fa-retweet"></i> <span id="reel-repost-comment-submit-label">Repost</span></button>',
                '</div>',
            '</div>'
        ].join('');
        document.body.appendChild(overlay);

        scrim.addEventListener('click', _closeReelRepostCard);
        overlay.querySelector('#reel-repost-card-close').addEventListener('click', _closeReelRepostCard);
        overlay.querySelector('#reel-repost-opt-instant').addEventListener('click', function () {
            if (_repostCardMode === 'share') _submitReelShare(_repostCardReelId, '');
            else _submitReelRetweet(_repostCardReelId, '');
        });
        overlay.querySelector('#reel-repost-opt-comment').addEventListener('click', function () {
            overlay.classList.add('reel-repost-card-composing');
            var ta = document.getElementById('reel-repost-comment-inp');
            if (ta) { ta.value = ''; setTimeout(function () { ta.focus(); }, 60); }
        });
        overlay.querySelector('#reel-repost-comment-submit').addEventListener('click', function () {
            var ta = document.getElementById('reel-repost-comment-inp');
            var text = ta ? ta.value.trim() : '';
            if (_repostCardMode === 'share') _submitReelShare(_repostCardReelId, text);
            else _submitReelRetweet(_repostCardReelId, text);
        });
        overlay.querySelector('#reel-repost-opt-external').addEventListener('click', function () {
            var url = _repostCardUrl || window.location.href;
            if (navigator.share) {
                navigator.share({ title: 'Empyrean Reel', url: url }).catch(function () {});
            } else {
                navigator.clipboard && navigator.clipboard.writeText(url);
                _notify('Link copied!', 'success');
            }
            _closeReelRepostCard();
        });
    }

    /* mode: 'retweet' (default, unchanged) | 'share' (new — real repost +
       thumbnail + external-share row). url: only needed for 'share'
       mode's external-share row. */
    function _openReelRepostCard(reelId, mode, url) {
        _buildReelRepostCard();
        _repostCardReelId = reelId;
        _repostCardMode   = mode === 'share' ? 'share' : 'retweet';
        _repostCardUrl    = url || '';
        var overlay = document.getElementById('reel-repost-card-overlay');
        var scrim   = document.getElementById('reel-repost-card-scrim');
        if (!overlay || !scrim) return;

        var isShare = _repostCardMode === 'share';
        var title   = document.getElementById('reel-repost-card-title');
        if (title) title.textContent = isShare ? 'Share this reel' : 'Repost this reel';
        var extOpt = document.getElementById('reel-repost-opt-external');
        if (extOpt) extOpt.style.display = isShare ? 'flex' : 'none';
        var commentSub = document.getElementById('reel-repost-opt-comment-sub');
        if (commentSub) commentSub.textContent = isShare ? 'Write a post to go along with this share' : 'Share your thoughts along with this repost';
        var instantTitle = document.getElementById('reel-repost-opt-instant-title');
        if (instantTitle) instantTitle.textContent = isShare ? 'Share' : 'Repost';
        var instantSub = document.getElementById('reel-repost-opt-instant-sub');
        if (instantSub) instantSub.textContent = isShare ? 'Instantly post this reel to your profile' : 'Instantly repost this reel to your followers';
        var submitLabel = document.getElementById('reel-repost-comment-submit-label');
        if (submitLabel) submitLabel.textContent = isShare ? 'Share' : 'Repost';

        /* "Sleek premium card thumbnail" — pull the real poster frame off
           the reel currently open in the viewer, same source
           _buildReelViewerItem() already set on its <video>, so this
           never needs its own fetch. */
        var thumbImg = document.getElementById('reel-repost-card-thumb');
        var iconEl   = document.getElementById('reel-repost-card-icon');
        var srcVideo = document.querySelector('.reel-viewer-item[data-reel-id="' + reelId + '"] video');
        var poster   = srcVideo ? (srcVideo.poster || '') : '';
        if (thumbImg && poster) {
            thumbImg.src = poster;
            thumbImg.style.display = 'block';
            if (iconEl) iconEl.style.display = 'none';
        } else if (thumbImg) {
            thumbImg.style.display = 'none';
            if (iconEl) iconEl.style.display = '';
        }

        overlay.classList.remove('reel-repost-card-composing');
        overlay.classList.add('open');
        scrim.classList.add('active');
    }

    function _closeReelRepostCard() {
        var overlay = document.getElementById('reel-repost-card-overlay');
        var scrim   = document.getElementById('reel-repost-card-scrim');
        if (overlay) { overlay.classList.remove('open'); overlay.classList.remove('reel-repost-card-composing'); }
        if (scrim) scrim.classList.remove('active');
        _repostCardReelId = null;
        _repostCardUrl    = '';
    }

    /* 'share' mode submit — routes through the REAL Firestore repost
       (_rebroadcastReel), tagged 'share' so it lands on shareCount rather
       than retweetCount — see _submitReelRetweet below for the parallel
       'retweet'-mode path. */
    function _submitReelShare(reelId, commentText) {
        if (!reelId) { _closeReelRepostCard(); return; }
        _rebroadcastReel(reelId, commentText);
        _closeReelRepostCard();
    }

    /* 'retweet' mode submit — NEW (this session: "the rebroadcast feature
       was absent" / "indicate the numbers of persons who have reshared").
       This used to be _submitReelRepost(), a purely local, in-memory
       counter that reset on every reload and was never visible to anyone
       but the tapper's own current session — exactly why retweeting
       looked like it "did nothing" from the outside. Now routes through
       the same real _rebroadcastReel() Firestore write the Share card
       already uses, just tagged 'retweet' so the count lands on
       retweetCount/retweetedBy (below) instead of shareCount — two
       separate, real, persisted counters instead of one fake one. */
    function _submitReelRetweet(reelId, commentText) {
        if (!reelId) { _closeReelRepostCard(); return; }
        _rebroadcastReel(reelId, commentText, 'retweet');
        _closeReelRepostCard();
    }

    /* Escape closes the repost card too (mirrors the reel-viewer Escape
       handler above) — a separate, additive listener so the existing one
       doesn't need to change. */
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            var rpOverlay = document.getElementById('reel-repost-card-overlay');
            if (rpOverlay && rpOverlay.classList.contains('open')) _closeReelRepostCard();
        }
    });

    /* =========================================================================
       "GROW YOUR REACH" PROMO CARD (this session — "implement the pop up
       sleek premium card with the description and upload button in the
       reel and live broadcast channel"). Shown once, the first time
       someone opens the "Reel & Live Broadcast Channel" section (#reels —
       see index.html's own <h1> for that section, which covers both reel
       uploads and the church/sports/TV/public live broadcast feature).
       The CTA opens the real upload composer by clicking the SAME topbar
       "+" button the section already has
       (.reel-topbar-upload-btn[data-panel="reels-create-panel"]) — no
       separate upload logic is introduced here. Shows at most once ever
       per browser (localStorage flag), so it never nags on every visit.
       ========================================================================= */
    var REEL_PROMO_SEEN_KEY = 'empyrean_reels_upload_promo_seen_v1';

    function _buildReelPromoCard() {
        if (document.getElementById('reel-promo-scrim')) return;
        var scrim = document.createElement('div');
        scrim.id = 'reel-promo-scrim';
        scrim.innerHTML = [
            '<div id="reel-promo-card">',
                '<button type="button" id="reel-promo-close" aria-label="Not now"><i class="fas fa-times"></i></button>',
                '<div id="reel-promo-icon"><img id="reel-promo-logo" src="/icon-192.png" alt="Empyrean"></div>',
                '<h4>Grow Your Reach</h4>',
                '<p>Post reels and go live regularly to reach more people, grow your audience, and earn more EMPY rewards.</p>',
                '<div id="reel-promo-actions">',
                    '<button type="button" id="reel-promo-dismiss">Not now</button>',
                    '<button type="button" id="reel-promo-cta"><i class="fas fa-upload"></i> Upload Reel</button>',
                '</div>',
            '</div>'
        ].join('');
        document.body.appendChild(scrim);

        /* Fallback if the logo image itself ever fails to load (offline
           first paint, wrong path after a future asset move, etc.) — swap
           back to the original glyph instead of leaving a broken-image
           icon, mirroring how every other <img> fallback in this codebase
           (e.g. EmpAvatar.wire() in app-patch-v15.js) never leaves a
           broken box on screen. */
        var promoLogo = document.getElementById('reel-promo-logo');
        if (promoLogo) {
            promoLogo.addEventListener('error', function () {
                var iconBox = document.getElementById('reel-promo-icon');
                if (iconBox) iconBox.innerHTML = '<i class="fas fa-satellite-dish"></i>';
            });
        }

        function _dismiss() {
            try { localStorage.setItem(REEL_PROMO_SEEN_KEY, '1'); } catch (e) {}
            scrim.classList.remove('active');
        }
        scrim.addEventListener('click', function (e) { if (e.target === scrim) _dismiss(); });
        document.getElementById('reel-promo-close').addEventListener('click', _dismiss);
        document.getElementById('reel-promo-dismiss').addEventListener('click', _dismiss);
        document.getElementById('reel-promo-cta').addEventListener('click', function () {
            _dismiss();
            var uploadBtn = document.querySelector('.reel-topbar-upload-btn[data-panel="reels-create-panel"]');
            if (uploadBtn) uploadBtn.click();
        });
    }

    function _maybeShowReelPromoCard() {
        if (_isGuest()) return;
        var seen = false;
        try { seen = !!localStorage.getItem(REEL_PROMO_SEEN_KEY); } catch (e) {}
        if (seen) return;
        _buildReelPromoCard();
        var scrim = document.getElementById('reel-promo-scrim');
        if (scrim) scrim.classList.add('active');
    }

    document.addEventListener('empyrean-section-change', function (e) {
        if (e && e.detail && e.detail.section === 'reels') {
            setTimeout(_maybeShowReelPromoCard, 450);
        }
    });

    console.log('[EmpReels] ✅ Reels engagement module ready — comments/likes/retweet/share/download/swipe active.');

})();


/* =============================================================================
   REEL COMPOSER (2026-08-10) — full-screen camera-capture "create reel" UI
   ─────────────────────────────────────────────────────────────────────────
   BUGFIX this replaces: the old #reels-create-panel was a plain <form> with
   a native "Choose File" input. On at least one device it was getting stuck
   open after a failed/ambiguous submit (e.g. a Firestore permission-denied
   on the save-reel write, AFTER the Cloudinary video upload had already
   succeeded) with no way to dismiss it except leaving the page — there was
   no explicit close control, so the panel only ever hid itself on a fully
   successful submit. This module adds a real, always-available close (X)
   button (see closeComposer()/#reel-composer-close-btn) that works
   regardless of upload/save outcome, on top of the full camera-capture UI.

   WHAT THIS DOES: lets the user either (a) record a video directly via
   getUserMedia + MediaRecorder, with a flip-camera control and a recording
   timer, or (b) pick an existing video from their device gallery — both
   paths land the resulting File on the existing #reel-video-file input
   (using a DataTransfer for the recorded case), then reveal a caption +
   Post step.

   WHAT THIS DELIBERATELY DOES NOT TOUCH: the actual Cloudinary-upload +
   Firestore-save flow, which already lives in app-fixes.js's
   'reel-upload-form' submit-case (case 'reel-upload-form': in the big
   document.body 'submit' switch). This module's only contract with that
   code is "put a File on #reel-video-file and let the user tap the
   type=submit Post button" — everything past that point (progress bar,
   Cloudinary call, Firestore .set()/verify, notifications, reward,
   form.reset(), closing #reels-create-panel) is 100% unchanged.
   ============================================================================= */
(function empyreanReelComposer() {
    'use strict';
    if (window._empReelComposerLoaded) { return; }
    window._empReelComposerLoaded = true;

    var panel, liveVideo, reviewVideo, timerEl, fallbackEl, captionStep,
        recordBtn, flipBtn, closeBtn, retakeBtn, galleryInput, bottombar, soundBtn;

    var _stream = null;
    var _facingMode = 'user';
    var _recorder = null;
    var _chunks = [];
    var _recording = false;
    var _recordStart = 0;
    var _timerInterval = null;
    var _recordedObjectUrl = null;
    /* Listings pinned to the reel being composed (2026-10-04). Read by app-fixes.js's reel-upload-form submit case. */
    window._empReelComposerPins = [];
    function _renderComposerPins() {
        var pins = window._empReelComposerPins || [];
        var lab = _byId('reel-composer-pin-label'), chips = _byId('reel-composer-pin-chips');
        if (lab) lab.textContent = pins.length ? (pins.length + (pins.length === 1 ? ' product pinned' : ' products pinned') + ' \u2014 tap to edit') : 'Pin a product from Marketplace';
        if (!chips) return;
        var nt = window._empReelPinNormThumb || function (x) { return x || ''; };
        var fp = window._empReelPinFmtPrice || function (p, c) { return ((c || '') + ' ' + (p == null ? '' : p)).trim(); };
        function e(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
        chips.innerHTML = pins.map(function (p) {
            var img = nt(p.image);
            return '<div class="reel-composer-pin-chip">'
                + (img ? '<img src="' + e(img) + '" alt="" onerror="this.style.display=\'none\'">' : '<span class="reel-pin-noimg"><i class="fas fa-shopping-bag"></i></span>')
                + '<span class="reel-composer-pin-chip-meta"><strong>' + e(p.name || 'Listing') + '</strong><span>' + e(fp(p.price, p.currency)) + '</span></span>'
                + '<button type="button" class="reel-composer-pin-chip-x" data-unpin="' + e(p.listingId) + '" aria-label="Remove pin">\u00d7</button></div>';
        }).join('');
        chips.querySelectorAll('.reel-composer-pin-chip-x').forEach(function (b) {
            b.addEventListener('click', function (ev) {
                ev.preventDefault(); ev.stopPropagation();
                window._empReelComposerPins = (window._empReelComposerPins || []).filter(function (p) { return p.listingId !== b.getAttribute('data-unpin'); });
                _renderComposerPins();
            });
        });
    }
    function _openComposerPinPicker() {
        if (typeof window._empReelOpenDraftPicker !== 'function') { _notify('Product pinning is still loading \u2014 try again in a moment.', 'info'); return; }
        window._empReelOpenDraftPicker(window._empReelComposerPins, function (pins) { window._empReelComposerPins = pins; _renderComposerPins(); });
    }

    var MAX_RECORD_MS = 60000; // 60s cap, matches the "60s" mode most short-form composers default to

    function _byId(id) { return document.getElementById(id); }

    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    }

    function _cacheEls() {
        panel        = _byId('reels-create-panel');
        liveVideo    = _byId('reel-composer-live-preview');
        reviewVideo  = _byId('reel-composer-review-preview');
        timerEl      = _byId('reel-composer-timer');
        fallbackEl   = _byId('reel-composer-cam-fallback');
        captionStep  = _byId('reel-composer-caption-step');
        recordBtn    = _byId('reel-composer-record-btn');
        flipBtn      = _byId('reel-composer-flip-btn');
        closeBtn     = _byId('reel-composer-close-btn');
        soundBtn     = _byId('reel-composer-sound-btn');
        retakeBtn    = _byId('reel-composer-retake-btn');
        galleryInput = _byId('reel-video-file');
        bottombar    = _byId('reel-composer-bottombar');
        // Only the elements this module actually drives need to exist —
        // if a future edit strips the composer markup back down to a plain
        // form, this quietly no-ops instead of throwing.
        return !!(panel && liveVideo && recordBtn && galleryInput && captionStep && bottombar);
    }

    function _fmtTime(ms) {
        var s = Math.floor(ms / 1000);
        var m = Math.floor(s / 60);
        s = s % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function _showFallback(msg) {
        if (liveVideo) liveVideo.style.display = 'none';
        if (fallbackEl) {
            fallbackEl.style.display = 'flex';
            var p = fallbackEl.querySelector('p');
            if (p && msg) p.textContent = msg;
        }
        if (recordBtn) recordBtn.disabled = true;
    }

    async function _startCamera() {
        _stopCamera();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            _showFallback('Camera isn\u2019t supported in this browser. Pick a video from your gallery below.');
            return;
        }
        try {
            _stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: _facingMode },
                audio: true
            });
            if (liveVideo) {
                liveVideo.srcObject = _stream;
                liveVideo.style.display = '';
            }
            if (fallbackEl) fallbackEl.style.display = 'none';
            if (recordBtn) recordBtn.disabled = false;
        } catch (err) {
            console.warn('[ReelComposer] camera unavailable:', err && err.message);
            _showFallback('Camera access was denied or unavailable. Pick a video from your gallery below.');
        }
    }

    function _stopCamera() {
        if (_stream) {
            _stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
            _stream = null;
        }
        if (liveVideo) liveVideo.srcObject = null;
    }

    function _pickMimeType() {
        if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
        var candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
        for (var i = 0; i < candidates.length; i++) {
            if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
        }
        return '';
    }

    function _startRecording() {
        if (!_stream || !window.MediaRecorder) {
            _notify('Recording isn\u2019t available on this device \u2014 pick a video from your gallery instead.', 'error');
            return;
        }
        _chunks = [];
        var mimeType = _pickMimeType();
        try {
            _recorder = mimeType ? new MediaRecorder(_stream, { mimeType: mimeType }) : new MediaRecorder(_stream);
        } catch (err) {
            console.error('[ReelComposer] MediaRecorder init failed:', err.message);
            _notify('Couldn\u2019t start recording \u2014 pick a video from your gallery instead.', 'error');
            return;
        }
        _recorder.ondataavailable = function (e) { if (e.data && e.data.size > 0) _chunks.push(e.data); };
        _recorder.onstop = _onRecordingStop;
        _recorder.start();
        _recording = true;
        _recordStart = Date.now();
        if (recordBtn) recordBtn.classList.add('recording');
        if (timerEl) { timerEl.style.display = 'flex'; timerEl.textContent = '00:00'; }
        if (flipBtn) flipBtn.disabled = true;
        _timerInterval = setInterval(function () {
            var elapsed = Date.now() - _recordStart;
            if (timerEl) timerEl.textContent = _fmtTime(elapsed);
            if (elapsed >= MAX_RECORD_MS) _stopRecording();
        }, 250);
    }

    function _stopRecording() {
        if (!_recording || !_recorder) return;
        _recording = false;
        clearInterval(_timerInterval);
        if (recordBtn) recordBtn.classList.remove('recording');
        if (timerEl) timerEl.style.display = 'none';
        if (flipBtn) flipBtn.disabled = false;
        try { _recorder.stop(); } catch (e) {}
    }

    function _onRecordingStop() {
        if (!_chunks.length) {
            _notify('That recording came out empty \u2014 please try again.', 'error');
            return;
        }
        var blob = new Blob(_chunks, { type: (_recorder && _recorder.mimeType) || 'video/webm' });
        var ext = (blob.type.indexOf('mp4') > -1) ? 'mp4' : 'webm';
        var file = new File([blob], 'reel-' + Date.now() + '.' + ext, { type: blob.type });
        if (_assignFileToInput(file)) _showReview(file);
    }

    // DataTransfer lets us hand a recorded (or otherwise programmatically
    // built) File to a real <input type="file"> so the existing submit
    // handler in app-fixes.js can read it via videoInput.files[0] exactly
    // like a normal user-picked file — no changes needed on that side.
    function _assignFileToInput(file) {
        try {
            var dt = new DataTransfer();
            dt.items.add(file);
            galleryInput.files = dt.files;
            return true;
        } catch (err) {
            console.error('[ReelComposer] could not attach recorded file to input:', err.message);
            _notify('Couldn\u2019t attach the recording \u2014 please pick a video from your gallery instead.', 'error');
            return false;
        }
    }

    function _showReview(file) {
        if (_recordedObjectUrl) { URL.revokeObjectURL(_recordedObjectUrl); _recordedObjectUrl = null; }
        _recordedObjectUrl = URL.createObjectURL(file);
        if (reviewVideo) {
            reviewVideo.src = _recordedObjectUrl;
            reviewVideo.style.display = '';
            reviewVideo.play().catch(function () {});
        }
        if (liveVideo) liveVideo.style.display = 'none';
        if (fallbackEl) fallbackEl.style.display = 'none';
        if (bottombar) bottombar.style.display = 'none';
        if (captionStep) captionStep.style.display = 'flex';
        var captionInput = _byId('reel-caption');
        if (captionInput) captionInput.focus();
    }

    function _retake() {
        if (galleryInput) galleryInput.value = '';
        if (_recordedObjectUrl) { URL.revokeObjectURL(_recordedObjectUrl); _recordedObjectUrl = null; }
        if (reviewVideo) {
            reviewVideo.pause();
            reviewVideo.removeAttribute('src');
            reviewVideo.load();
            reviewVideo.style.display = 'none';
        }
        if (captionStep) captionStep.style.display = 'none';
        if (bottombar) bottombar.style.display = 'flex';
        if (_stream && liveVideo) { liveVideo.style.display = ''; }
        else { _startCamera(); }
    }

    function _onGalleryChange() {
        var file = galleryInput.files && galleryInput.files[0];
        if (!file) return;
        _showReview(file);
    }

    function _onFlip() {
        _facingMode = (_facingMode === 'user') ? 'environment' : 'user';
        _startCamera();
    }

    function _resetToggleIcons() {
        // Mirrors the shared .section-create-toggle-btn handler's own icon
        // swap (app-fixes.js) so a manual close via our X button leaves the
        // "Upload a New Reel" button / FAB showing "+" again, not "×".
        document.querySelectorAll('.section-create-toggle-btn[data-panel="reels-create-panel"]').forEach(function (btn) {
            var icon = btn.querySelector('.section-create-icon');
            if (icon) { icon.textContent = '+'; icon.style.transform = 'rotate(0deg)'; }
        });
    }

    // Always-available manual close — this is the fix for the panel
    // getting stuck open with no way out. Just flips the same inline
    // style.display the shared toggle handler already uses, so the
    // MutationObserver below (single source of truth for "is this open")
    // picks it up and runs all the actual teardown in _onHide().
    function closeComposer() {
        if (panel) panel.style.display = 'none';
        _resetToggleIcons();
    }

    function _onShow() {
        document.body.classList.add('reel-composer-open');
        _facingMode = 'user';
        if (captionStep) captionStep.style.display = 'none';
        if (bottombar) bottombar.style.display = 'flex';
        if (reviewVideo) reviewVideo.style.display = 'none';
        if (fallbackEl) fallbackEl.style.display = 'none';
        if (liveVideo) liveVideo.style.display = '';
        _startCamera();
    }

    function _onHide() {
        document.body.classList.remove('reel-composer-open');
        if (_recording) _stopRecording();
        _stopCamera();
        if (_recordedObjectUrl) { URL.revokeObjectURL(_recordedObjectUrl); _recordedObjectUrl = null; }
        if (reviewVideo) {
            reviewVideo.pause();
            reviewVideo.removeAttribute('src');
            reviewVideo.load();
            reviewVideo.style.display = 'none';
        }
        if (captionStep) captionStep.style.display = 'none';
        if (bottombar) bottombar.style.display = 'flex';
        if (timerEl) timerEl.style.display = 'none';
        var captionInput = _byId('reel-caption');
        if (captionInput) captionInput.value = '';
        window._empReelComposerPins = []; _renderComposerPins(); // pins reset with the caption (a failed post keeps the panel open, so they survive a retry)
        // #reel-video-file itself is deliberately left alone here: on a
        // successful post, app-fixes.js's own form.reset() already clears
        // it; on a failed one we want the recorded/picked file to survive
        // a manual reopen-and-retry without forcing the user to re-record.
    }

    /* =========================================================================
       MUSIC LIBRARY (this session — "clicking music does nothing please
       add the music library"): #reel-composer-sound-btn (the "Add sound"
       pill, index.html) had markup and CSS but was never wired to
       anything anywhere in the codebase — confirmed by searching every
       file for its id before writing this. Tapping it now opens a small
       preset-track picker, each with a tap-to-preview using the same
       "no audio asset files needed" Web Audio synthesis approach already
       used for the live-streaming ambient sound library (app-patch-v42.js
       §v55) and the clap effect (app-patch-v42.js §v50) — this project has
       no /public/sounds/ assets checked in, so synthesizing here matches
       the one approach already proven to work in this codebase rather
       than introducing a dependency on files that don't exist. Picking a
       track updates the pill's own label/icon to show what's selected
       (tap again to change or clear) and records the choice on
       window._empReelSelectedSound so a future edit wiring it into the
       actual recorded/posted reel doc has a ready value to read, without
       this module needing to know anything about that write path itself.
       ========================================================================= */
    var _soundLibraryPresets = [
        { id: 'none',      label: 'No sound',      icon: 'fa-ban',        freq: 0,   type: 'sine' },
        { id: 'upbeat',    label: 'Upbeat Pop',     icon: 'fa-bolt',       freq: 440, type: 'square' },
        { id: 'chill',     label: 'Chill Vibes',    icon: 'fa-cloud',      freq: 220, type: 'sine' },
        { id: 'cinematic', label: 'Cinematic',      icon: 'fa-film',       freq: 110, type: 'sawtooth' },
        { id: 'afrobeat',  label: 'Afrobeat Groove',icon: 'fa-drum',       freq: 330, type: 'triangle' },
        { id: 'lofi',      label: 'Lo-Fi Beats',    icon: 'fa-record-vinyl', freq: 165, type: 'sine' }
    ];
    var _selectedSoundId = 'none';
    var _previewCtx = null, _previewOsc = null, _previewGain = null, _previewingId = null;

    function _stopSoundPreview() {
        if (_previewOsc) { try { _previewOsc.stop(); } catch (e) {} _previewOsc = null; }
        _previewingId = null;
        var playing = document.querySelectorAll('.pv-sound-preview-btn.playing');
        for (var i = 0; i < playing.length; i++) playing[i].classList.remove('playing');
    }

    function _playSoundPreview(preset, btnEl) {
        if (_previewingId === preset.id) { _stopSoundPreview(); return; }
        _stopSoundPreview();
        if (preset.freq === 0) return; // "No sound" has nothing to preview
        try {
            if (!_previewCtx) _previewCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (_previewCtx.state === 'suspended') _previewCtx.resume();
            _previewOsc = _previewCtx.createOscillator();
            _previewGain = _previewCtx.createGain();
            _previewOsc.type = preset.type || 'sine';
            _previewOsc.frequency.value = preset.freq;
            _previewGain.gain.value = 0.08; // preview only — kept quiet, this is a snippet, not playback
            _previewOsc.connect(_previewGain).connect(_previewCtx.destination);
            _previewOsc.start();
            _previewingId = preset.id;
            if (btnEl) btnEl.classList.add('playing');
            setTimeout(function () { if (_previewingId === preset.id) _stopSoundPreview(); }, 2500);
        } catch (err) {
            console.warn('[ReelComposer] sound preview unavailable:', err && err.message);
        }
    }

    function _updateSoundPillLabel() {
        if (!soundBtn) return;
        var preset = _soundLibraryPresets.filter(function (p) { return p.id === _selectedSoundId; })[0];
        var isNone = !preset || preset.id === 'none';
        soundBtn.innerHTML = '<i class="fas ' + (isNone ? 'fa-music' : 'fa-check') + '"></i> ' + (isNone ? 'Add sound' : preset.label);
    }

    function _buildMusicLibraryModal() {
        if (document.getElementById('reel-music-library-scrim')) return;
        if (document.getElementById('pv-sound-lib-css') === null) {
            var css = document.createElement('style');
            css.id = 'pv-sound-lib-css';
            css.textContent = [
                '#reel-music-library-scrim { position:fixed;inset:0;background:rgba(0,0,0,0);z-index:10310;display:none;transition:background 0.25s;align-items:flex-end;justify-content:center; }',
                '#reel-music-library-scrim.active { display:flex;background:rgba(0,0,0,0.6); }',
                '#reel-music-library-sheet { background:#12121a;color:#fff;width:100%;max-width:460px;border-radius:20px 20px 0 0;padding:18px 18px calc(20px + env(safe-area-inset-bottom,0px));max-height:72vh;overflow-y:auto; }',
                '#reel-music-library-head { display:flex;align-items:center;justify-content:space-between;margin-bottom:14px; }',
                '#reel-music-library-head h4 { margin:0;font-size:1.02rem;font-weight:800; }',
                '#reel-music-library-close { width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;color:#fff;cursor:pointer; }',
                '.pv-sound-track { display:flex;align-items:center;gap:12px;width:100%;padding:11px 8px;background:none;border:none;border-radius:14px;color:#fff;text-align:left;cursor:pointer; }',
                '.pv-sound-track:active, .pv-sound-track.selected { background:rgba(0,212,170,0.14); }',
                '.pv-sound-preview-btn { width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.85rem; }',
                '.pv-sound-preview-btn.playing { background:#00D4AA;color:#052018; }',
                '.pv-sound-track-label { flex:1;font-size:0.9rem;font-weight:600; }',
                '.pv-sound-track .fa-check-circle { color:#00D4AA;display:none; }',
                '.pv-sound-track.selected .fa-check-circle { display:block; }'
            ].join('\n');
            document.head.appendChild(css);
        }
        var scrim = document.createElement('div');
        scrim.id = 'reel-music-library-scrim';
        scrim.innerHTML =
            '<div id="reel-music-library-sheet">' +
                '<div id="reel-music-library-head"><h4><i class="fas fa-music"></i> Add sound</h4>' +
                '<button type="button" id="reel-music-library-close" aria-label="Close"><i class="fas fa-times"></i></button></div>' +
                '<div id="reel-music-library-list"></div>' +
            '</div>';
        document.body.appendChild(scrim);
        scrim.addEventListener('click', function (e) { if (e.target === scrim) _closeMusicLibrary(); });
        scrim.querySelector('#reel-music-library-close').addEventListener('click', _closeMusicLibrary);
        _renderMusicLibraryList();
    }

    function _renderMusicLibraryList() {
        var list = document.getElementById('reel-music-library-list');
        if (!list) return;
        list.innerHTML = _soundLibraryPresets.map(function (p) {
            var selected = p.id === _selectedSoundId ? ' selected' : '';
            return '<div class="pv-sound-track' + selected + '" data-sound-id="' + p.id + '">' +
                (p.freq ? '<button type="button" class="pv-sound-preview-btn" data-preview-id="' + p.id + '"><i class="fas fa-play"></i></button>'
                        : '<span class="pv-sound-preview-btn"><i class="fas ' + p.icon + '"></i></span>') +
                '<span class="pv-sound-track-label">' + p.label + '</span>' +
                '<i class="fas fa-check-circle"></i>' +
            '</div>';
        }).join('');
        list.querySelectorAll('.pv-sound-preview-btn[data-preview-id]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var preset = _soundLibraryPresets.filter(function (p) { return p.id === btn.dataset.previewId; })[0];
                if (preset) _playSoundPreview(preset, btn);
            });
        });
        list.querySelectorAll('.pv-sound-track').forEach(function (row) {
            row.addEventListener('click', function () {
                _selectedSoundId = row.dataset.soundId;
                window._empReelSelectedSound = _selectedSoundId;
                _updateSoundPillLabel();
                _closeMusicLibrary();
            });
        });
    }

    function _openMusicLibrary() {
        _buildMusicLibraryModal();
        _renderMusicLibraryList();
        var scrim = document.getElementById('reel-music-library-scrim');
        if (scrim) scrim.classList.add('active');
    }

    function _closeMusicLibrary() {
        _stopSoundPreview();
        var scrim = document.getElementById('reel-music-library-scrim');
        if (scrim) scrim.classList.remove('active');
    }

    function _wireEvents() {
        if (closeBtn) closeBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closeComposer(); });
        if (soundBtn) soundBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); _openMusicLibrary(); });
        var pinBtn = _byId('reel-composer-pin-btn');
        if (pinBtn) pinBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); _openComposerPinPicker(); });
        if (flipBtn) flipBtn.addEventListener('click', function (e) { e.preventDefault(); _onFlip(); });
        if (retakeBtn) retakeBtn.addEventListener('click', function (e) { e.preventDefault(); _retake(); });
        if (recordBtn) recordBtn.addEventListener('click', function (e) {
            e.preventDefault();
            if (_recording) _stopRecording(); else _startRecording();
        });
        if (galleryInput) galleryInput.addEventListener('change', _onGalleryChange);

        // Single source of truth for "is the composer open": watch the
        // panel's own style attribute rather than duplicating open/close
        // logic. This fires identically whether the panel was opened/closed
        // via the FAB, the "Upload a New Reel" button, our own X button, OR
        // a successful post (app-fixes.js sets display:none on success) —
        // so camera teardown happens on every path, not just some of them.
        if (panel) {
            var mo = new MutationObserver(function () {
                var visible = panel.style.display !== 'none' && panel.style.display !== '';
                if (visible) _onShow(); else _onHide();
            });
            mo.observe(panel, { attributes: true, attributeFilter: ['style'] });
        }
    }

    function _init() {
        if (!_cacheEls()) { return; } // composer markup not present in this build — nothing to wire up
        _wireEvents();
        window._empReelComposerClose = closeComposer; // exposed in case another module ever needs to force-close it
        console.log('[EmpReels] \u2705 Reel composer ready \u2014 camera capture + gallery pick wired.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

})();