/* =============================================================================
   EMPYREAN INTERNATIONAL — USER PROFILE SYSTEM
   app-profile.js  |  Step 0.9  |  Refactor Roadmap v1.0
   =============================================================================

   PURPOSE
   ───────
   Complete profile system extracted from app-fixes.js.  Covers:

     • renderUserProfile(userId)   — full profile page builder
     • renderMonetizationTab()     — earnings / withdrawal eligibility
     • renderBusinessPage()        — business page (create + view)
     • populateProfileGallery()    — 3-col gallery from DOM feed posts
     • _populateHomeBioCard()      — home card trigger (delegates to renderSuggestedUsers)
     • showFollowersModal(tab)     — followers / following modal
     • showFollowingModal()        — alias
     • Story-header click → navigate to user profile (delegated)
     • Profile tab switching
     • Profile post submit (inside dashboard tab)

   LOAD ORDER
   ──────────
   Must come AFTER: firebase-init, app-state, app-helpers, app-contracts,
   app-notifications, app-tags, app-dom (when extracted), app-auth, app-feed.

   DEPENDS ON
   ──────────
   • window.EmpState / window.userState / window.isGuest / window.isAdmin
   • window.mockUsers / window.registeredUsers
   • window.fbDb / window._firebaseLoaded
   • window.formatUsdPrice          (app-helpers.js)
   • window.showNotification        (app-helpers.js)
   • window.uploadMediaFilesToCloudinary (app-helpers.js)
   • window.createNewPostElement    (app-feed.js)
   • window.navigateTo              (app-dom.js)
   • window.showMarketplaceGallery  (app-marketplace.js — optional)
   • window.populateDobSelectors    (app-helpers.js)

   PUBLIC API
   ──────────
   window.renderUserProfile(userId)
   window.renderMonetizationTab()
   window.renderBusinessPage()
   window.populateProfileGallery(userId)
   window._populateHomeBioCard()
   window.showFollowersModal(tab?)
   window.showFollowingModal()

   SECTION MAP
   ───────────
   §1  renderUserProfile — full profile page builder
   §2  renderMonetizationTab
   §3  renderBusinessPage
   §4  populateProfileGallery
   §5  _populateHomeBioCard
   §6  showFollowersModal / showFollowingModal
   §7  Profile tab switching (MutationObserver delegated)
   §8  Story-header click → user profile navigation

   ============================================================================= */

(function empyreanProfileModule() {
    'use strict';

    if (window._empyreanProfileLoaded) {
        console.warn('[EmpProfile] Already loaded — skipping duplicate.');
        return;
    }
    window._empyreanProfileLoaded = true;

    /* Shorthand helpers */
    function _S()       { return window.EmpState || {}; }
    function _us()      { return _S().userState || window.userState || {}; }
    function _mu()      { return (_S().mockUsers) || window.mockUsers || {}; }
    function _isGuest() { var s = _S(); return s.isGuest != null ? s.isGuest : window.isGuest; }
    function _isAdmin() { var s = _S(); return s.isAdmin != null ? s.isAdmin : window.isAdmin; }

    /* Ranking tiers referenced by renderMonetizationTab — DISPLAY COPY ONLY.
       MUST stay identical to app-wallet.js's RANKS (the table that actually
       pays out via checkAndAwardRank) or this tab promises a reward amount
       the user won't actually receive.

       FIX (2026-08-15 — token-allocation review): this list previously used
       completely different tier names/thresholds/amounts than the ones
       app-wallet.js actually paid out (e.g. this said reaching 50,000
       followers earned 50,000 EMPY; app-wallet.js's real payout for that
       same threshold was 1,000 EMPY) — a genuine broken promise to users,
       not just a stale comment. Replaced with an exact copy of
       app-wallet.js's now-reduced canonical list. */
    var RANKS = [
        { id: 'rank-1', name: 'Rising Star',     followers: 500,      reward: 5    },
        { id: 'rank-2', name: 'Community Voice',  followers: 1000,     reward: 10   },
        { id: 'rank-3', name: 'Influencer',       followers: 5000,     reward: 25   },
        { id: 'rank-4', name: 'Advocate',         followers: 10000,    reward: 50   },
        { id: 'rank-5', name: 'Leader',           followers: 50000,    reward: 100  },
        { id: 'rank-6', name: 'Beacon',           followers: 100000,   reward: 250  },
        { id: 'rank-7', name: 'Champion',         followers: 250000,   reward: 500  },
        { id: 'rank-8', name: 'Ambassador',       followers: 500000,   reward: 1000 },
        { id: 'rank-9', name: 'Legend',           followers: 1000000,  reward: 2500 }
    ];

    function _attr(s) { return String(s || '').replace(/"/g, '&quot;'); }
    function _esc(s)  {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* FIX (2026-08-10 — reel strip duplicating + landing at the bottom
       instead of mid-feed): renderUserProfile() rebuilds #profile's
       entire innerHTML synchronously, then schedules
       _mountProfileFeedReelStrip() 500ms later via setTimeout. If
       renderUserProfile() runs again before that timeout fires — a second
       nav to the same/another profile, a story-header click re-render
       (§8), anything re-invoking it — the EARLIER call's still-pending
       timeout was never cancelled. It fires later, does a fresh
       document.getElementById() lookup, finds the CURRENT (later) DOM
       tree, and mounts a strip into it — on top of whichever strip the
       later call's own timeout already mounted. Each stale timeout adds
       one more duplicate strip; that's the "3 horizontal cards instead
       of 1". This token makes every scheduled mount check, right before
       it runs, that it's still the most recent renderUserProfile() call
       for this profile — a stale one is a no-op instead of mounting into
       DOM it no longer "owns". */
    var _profileReelStripToken = 0;

    /* Same staleness-guard as _profileReelStripToken above, for the
       quote/meme thumbnail strip's own delayed mount (see
       _mountProfileFeedQuoteMemeStrip() near the bottom of this file). */
    var _profileQuoteMemeStripToken = 0;

    /* Same staleness-guard pattern as _profileReelStripToken above, for the
       Birthday Messages section's own delayed mount (see
       _mountProfileBirthdayFeed() near the bottom of this file). */
    var _profileBirthdayToken = 0;

    /* =========================================================================
       Owner reel gallery / feed-strip CSS (§9) — injected at runtime per this
       codebase's convention (style.css/token.css are never edited directly).
       ========================================================================= */
    (function _injectReelGalleryCSS() {
        if (document.getElementById('_emp_profile_reel_css')) return;
        var s = document.createElement('style');
        s.id = '_emp_profile_reel_css';
        s.textContent = [
            /* "Reels" tab thumbnail grid — visually distinct from the plain
               Photos/Videos gallery grid (indigo/violet accent border+glow,
               matching the KYC/verification accent color already used
               elsewhere on this same profile page) so it reads as its own
               section, not a variant of the media gallery. */
            '.emp-profile-reel-thumb {',
            /* FIX (report — "implement exactly the video gallery grid in
               screenshot 1, let all the video frames be of equal size"):
               was 9/16 (portrait reel-shaped) — the reference grid uses
               uniform square tiles, same as the new Pictures tab below,
               so every tile in both tabs now shares one frame shape. */
            '  position: relative; aspect-ratio: 1 / 1; border-radius: 10px;',
            '  overflow: hidden; background: #0A0E27; cursor: pointer;',
            '  box-shadow: 0 2px 8px rgba(10,14,39,0.12);',
            '  border: 1.5px solid rgba(91,14,166,0.18);',
            '  transition: transform 0.18s, box-shadow 0.18s;',
            '}',
            '.emp-profile-reel-thumb:hover { transform: scale(1.035); box-shadow: 0 6px 18px rgba(91,14,166,0.28); }',
            '.emp-profile-reel-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }',
            '.emp-profile-reel-play {',
            '  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;',
            '  background: linear-gradient(135deg, rgba(27,43,139,0.15), rgba(91,14,166,0.28)); pointer-events: none;',
            '}',
            '.emp-profile-reel-play span {',
            '  width: 30px; height: 30px; background: rgba(255,255,255,0.92); border-radius: 50%;',
            '  display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.25);',
            '}',
            '.emp-profile-reel-play i { color: #5B0EA6; font-size: 0.7rem; margin-left: 2px; }',
            /* view-count badge, bottom-left play-triangle + number, matching
               the reference screenshot's "▷ 321" style overlay. Shared by
               both the Reels tab (populateProfileReelsGallery) and the
               Videos tab (populateProfileGallery) — same look, same class,
               each just feeds it a different count source. */
            '.emp-profile-reel-viewcount {',
            '  position: absolute; left: 8px; bottom: 7px; color: #fff; font-size: 0.82rem; font-weight: 700;',
            '  display: flex; align-items: center; gap: 5px; text-shadow: 0 1px 3px rgba(0,0,0,0.55); pointer-events: none;',
            '}',
            '.emp-profile-reel-viewcount i { font-size: 0.72rem; }',
            /* NEW — Pictures tab thumbnail: same square footprint as the
               Reels tab above (report item #2 — "same frame size"), plain
               neutral border since there's no play glyph to accent here. */
            '.emp-profile-pic-thumb {',
            '  position: relative; aspect-ratio: 1 / 1; border-radius: 10px;',
            '  overflow: hidden; background: #e8eaf0; cursor: pointer;',
            '  box-shadow: 0 2px 8px rgba(10,14,39,0.10); border: 1.5px solid rgba(10,14,39,0.07);',
            '  transition: transform 0.18s, box-shadow 0.18s;',
            '}',
            '.emp-profile-pic-thumb:hover { transform: scale(1.035); box-shadow: 0 6px 18px rgba(10,14,39,0.18); }',
            '.emp-profile-pic-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }',
            /* NEW — Gallery tab thumbnail (now videos-only — see
               populateProfileGallery's own header comment for why photos
               moved out to the Pictures tab). Same square footprint and
               same hover polish as the other two tabs' thumbnails, so all
               three galleries now read as one consistent, "premium"
               family of tiles rather than three different-looking grids. */
            '.emp-profile-video-thumb {',
            '  position: relative; aspect-ratio: 1 / 1; border-radius: 10px;',
            '  overflow: hidden; background: #0A0E27; cursor: pointer;',
            '  box-shadow: 0 2px 8px rgba(10,14,39,0.10); border: 1.5px solid rgba(10,14,39,0.07);',
            '  transition: transform 0.18s, box-shadow 0.18s;',
            '}',
            '.emp-profile-video-thumb:hover { transform: scale(1.035); box-shadow: 0 6px 18px rgba(10,14,39,0.18); }',
            '.emp-profile-video-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }',
            '.emp-profile-video-play {',
            '  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;',
            '  background: rgba(0,0,0,0.22); pointer-events: none;',
            '}',
            '.emp-profile-video-play span {',
            '  width: 34px; height: 34px; background: rgba(255,255,255,0.92); border-radius: 50%;',
            '  display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.25);',
            '}',
            '.emp-profile-video-play i { color: #0A0E27; font-size: 0.78rem; margin-left: 3px; }',
            '.emp-profile-video-count {',
            '  position: absolute; top: 6px; right: 6px; background: rgba(0,0,0,0.55); color: #fff;',
            '  border-radius: 50px; padding: 2px 7px; font-size: 0.7rem; font-weight: 700;',
            '}',
            /* Feed-strip card — same footprint as .dashboard-reel-card so it
               sits comfortably inside the existing .horizontal-slider-wrapper
               swipe/scroll-snap machinery, but its own class so it never
               triggers app-reel.js's "dashboard card → navigate to Reels
               section" click behavior (see .reel-preview-card below instead,
               which opens the actual reel in place). */
            '.emp-profile-feed-reel-card {',
            '  width: 150px; height: 240px; flex-shrink: 0; position: relative;',
            '  border-radius: 16px; overflow: hidden; display: inline-block; cursor: pointer;',
            '  box-shadow: 0 4px 16px rgba(91,14,166,0.20), 0 1px 3px rgba(10,14,39,0.10);',
            '  transition: transform 0.22s ease, box-shadow 0.22s ease;',
            '}',
            '.emp-profile-feed-reel-card:hover { transform: translateY(-4px); box-shadow: 0 10px 28px rgba(91,14,166,0.28); }',
            '.emp-profile-feed-reel-card::before {',
            '  content: ""; position: absolute; inset: 0; z-index: 2;',
            '  background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%);',
            '}',
            '.emp-profile-feed-reel-card video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 1; }',
            '.emp-profile-feed-reel-card .emp-pfrc-avatar {',
            '  position: absolute; bottom: 10px; left: 10px; z-index: 3; width: 30px; height: 30px;',
            '  border-radius: 50%; overflow: hidden; border: 2px solid #fff; box-shadow: 0 2px 8px rgba(10,14,39,0.35);',
            '}',
            '.emp-profile-feed-reel-card .emp-pfrc-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }',
            '.emp-profile-reel-strip-card { border: 1px solid rgba(91,14,166,0.14); }',
            '.emp-profile-reel-strip-card .emp-pfrs-header {',
            '  display: flex; align-items: center; gap: 8px; padding: 14px 16px 2px;',
            '}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    })();

    /* =========================================================================
       PREMIUM PROFILE MEDIA v2 (2026-10-26). Everything is scoped under
       #profile, so the public dashboard/home feed is untouched.
       v2: the Videos catalog keeps its ORIGINAL look (square tile, white play
       circle, count bottom-left) but is larger (2 columns) and shows a real
       preview; the suggested row is hydrated after render (local users, then
       Firestore) instead of being rendered inline; new engagement bar.
       ========================================================================= */
    (function _injectPremiumProfileMediaCSS() {
        if (document.getElementById('_emp_profile_premium_media_css')) return;
        var P = '#profile ' + new Array(8).join('.impact-story');      /* beats the stacked premium-card !important rules */
        var A = P + ' .story-actions';
        var N = ':not(.liked):not(.retweeted):not(.bookmarked)';
        /* X-style post card: ONLY the direct post cards of the two profile feeds (Posts + Dashboard "Your Feed").
           #feed-container (public home) is never matched; SOS / crisis / election cards keep their own designs. */
        var CARD = new Array(7).join('.impact-story') + ':not(.sos-request):not(.crisis-report):not(.em-election-post)';
        function X(suffix) {
            return ['#profile-posts-feed > ', '#profile-dash-feed > '].map(function (f) { return f + CARD + (suffix || ''); }).join(', ');
        }
        var s = document.createElement('style');
        s.id = '_emp_profile_premium_media_css';
        s.textContent = [
            /* Cover */
            '#profile .cover-photo-container { height: 180px; }',
            '#profile .cover-photo-container::after { content:""; position:absolute; inset:0; background:linear-gradient(to top, rgba(10,14,39,.45), rgba(10,14,39,0) 55%); pointer-events:none; }',
            '#profile .cover-photo-container .upload-overlay { top:auto; bottom:12px; right:12px; min-height:44px; display:flex; align-items:center; gap:6px; padding:0 14px; border-radius:999px; background:rgba(255,255,255,.92); color:#0A0E39; font-size:.78rem; font-weight:700; z-index:3; }',
            /* Reels: tall 9:16, two columns */
            '#profile #profile-reels-gallery { grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:12px !important; }',
            '#profile .emp-profile-reel-thumb { aspect-ratio:9 / 16; border:0; border-radius:20px; box-shadow:0 8px 22px rgba(10,14,63,.16); }',
            '#profile .emp-profile-reel-thumb::after { content:""; position:absolute; left:0; right:0; bottom:0; height:55%; background:linear-gradient(to top, rgba(5,7,30,.85), rgba(5,7,30,0)); pointer-events:none; }',
            '#profile .emp-profile-reel-play { background:none; }',
            '#profile .emp-profile-reel-play span { width:46px; height:46px; background:rgba(255,255,255,.2); border:1px solid rgba(255,255,255,.45); box-shadow:none; }',
            '#profile .emp-profile-reel-play i { color:#fff; font-size:.9rem; }',
            '#profile .emp-profile-reel-viewcount { left:10px; bottom:10px; z-index:2; padding:4px 10px; border-radius:999px; background:rgba(10,14,63,.55); text-shadow:none; font-size:.76rem; }',
            /* Videos: ORIGINAL look, bigger (2 columns), live preview */
            '#profile #profile-gallery { grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:10px !important; }',
            '#profile .emp-profile-video-thumb video { background:#0A0E27; }',
            '#profile .emp-profile-video-play span { width:48px; height:48px; }',
            '#profile .emp-profile-video-thumb.is-previewing .emp-profile-video-play { opacity:0; transition:opacity .25s; }',
            /* Pictures: 4:5, two columns */
            '#profile #profile-pictures-gallery { grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:12px !important; }',
            '#profile .emp-profile-pic-thumb { aspect-ratio:4 / 5; border:0; border-radius:20px; box-shadow:0 8px 22px rgba(10,14,63,.14); }',
            /* Suggested for you */
            '#profile .emp-sfy { margin:6px 0 4px; }',
            '#profile .emp-sfy-head { display:flex; align-items:center; justify-content:space-between; padding:10px 16px 6px; }',
            '#profile .emp-sfy-head b { font-size:1rem; font-weight:800; color:#0A0E39; }',
            '#profile .emp-sfy-row { display:flex; gap:12px; overflow-x:auto; scroll-snap-type:x mandatory; padding:4px 16px 10px; scrollbar-width:none; -webkit-overflow-scrolling:touch; }',
            '#profile .emp-sfy-row::-webkit-scrollbar { display:none; }',
            '#profile .emp-sfy-card { flex:0 0 156px; width:156px; min-width:156px; max-width:156px; overflow:hidden; scroll-snap-align:start; position:relative; box-sizing:border-box; background:#fff; border-radius:20px; padding:18px 12px 14px; text-align:center; box-shadow:0 6px 18px rgba(10,14,63,.09); }',
            '#profile .emp-sfy-x { position:absolute; top:4px; right:4px; width:36px; height:36px; border:0; border-radius:50%; background:none; color:#5A6385; cursor:pointer; display:flex; align-items:center; justify-content:center; }',
            /* FIX (2026-10-27 - gold avatar ring cut off flat at the top): the ring is a 5px box-shadow, which paints OUTSIDE the 68px image,
               and this wrapper's overflow:hidden (needed for the name/sub ellipsis) sliced off the part above the image. Padding gives the
               ring room inside the clip box so it renders as a complete circle on every side. */
            '#profile .emp-sfy-open { cursor:pointer; min-width:0; max-width:100%; overflow:hidden; box-sizing:border-box; padding:8px 8px 0; }',
            '#profile .emp-sfy-av { width:68px; height:68px; border-radius:50%; margin:0 auto; object-fit:cover; display:block; box-shadow:0 0 0 3px #fff, 0 0 0 5px #C9A66B; background:#E8ECF8; }',
            '#profile .emp-sfy-name { font-size:.88rem; font-weight:700; margin-top:12px; color:#0A0E39; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
            '#profile .emp-sfy-sub { font-size:.74rem; color:#5A6385; margin-top:2px; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
            '#profile .emp-sfy-card .follow-btn { width:100%; min-height:44px; margin-top:12px; border:1.5px solid #1B2B8B; border-radius:999px; background:#fff; color:#1B2B8B; font-size:.8rem; font-weight:700; cursor:pointer; }',
            /* ---- X-style post card (profile feeds only): avatar column on the left, content indented ---- */
            '#profile #profile-posts-feed { gap:0 !important; }',
            X() + ' { position:relative !important; display:block !important; margin:0 !important; padding:0 12px 0 62px !important; background:#fff !important; border:0 !important; border-bottom:1px solid #E9ECF6 !important; border-radius:0 !important; box-shadow:none !important; overflow:visible !important; }',
            X(':hover') + ' { background:#FBFCFF !important; }',
            X(' .story-header') + ' { display:flex !important; align-items:flex-start !important; gap:8px !important; margin:0 !important; padding:12px 0 0 !important; position:static !important; }',
            X(' .story-header .avatar-placeholder') + ' { position:absolute !important; left:12px !important; top:12px !important; width:42px !important; height:42px !important; min-width:42px !important; margin:0 !important; border-radius:50% !important; box-shadow:0 0 0 1px #E3E7F3 !important; overflow:hidden !important; }',
            X('[data-is-retweet="1"] .story-header .avatar-placeholder') + ', ' + X('[data-is-quote="1"] .story-header .avatar-placeholder') + ' { top:46px !important; }',
            X(' .retweet-header') + ' { margin:0 !important; padding:10px 0 0 !important; font-size:13px !important; color:#6B7394 !important; }',
            X(' .story-user-info') + ' { display:block !important; flex:1 1 auto !important; min-width:0 !important; }',
            X(' .story-user-info strong') + ' { display:block !important; font-size:15px !important; font-weight:700 !important; line-height:1.3 !important; color:#0F1536 !important; }',
            X(' .story-user-info > span') + ' { display:block !important; margin:1px 0 0 !important; font-size:12.5px !important; line-height:1.3 !important; color:#6B7394 !important; }',
            X(' .story-user-info > span::before') + ' { content:none !important; }',
            X(' .story-header .post-options') + ' { align-self:flex-start; margin:-2px -8px 0 0; }',
            X(' .story-content') + ' { padding:2px 0 6px !important; font-size:15px !important; line-height:1.5 !important; color:#0F1536 !important; }',
            X(' .story-content p') + ' { margin:0 !important; font-size:15px !important; line-height:1.5 !important; color:#0F1536 !important; }',
            X(' .story-media-container + .story-content') + ' { padding-top:6px !important; }',
            X(' .story-media-container + .story-content::before') + ' { display:none !important; }',
            X(' .story-media-container') + ' { margin:6px 0 10px !important; border-radius:16px !important; border:1px solid #E3E7F3 !important; box-shadow:none !important; overflow:hidden !important; }',
            /* FIX (2026-10-30 - "multiple pictures should swipe horizontally in the profile page dashboard"): the rule above (and style.css's
               matching profile-feed rule) force overflow:hidden !important on EVERY media container, which silently killed the native
               scroll-snap swipe that 2+ item posts rely on (style.css .story-media-container[data-count]:not([data-count="1"])). Only
               multi-item containers get horizontal scrolling back; single-media posts keep overflow:hidden exactly as before. Scoped to
               #profile-posts-feed / #profile-dash-feed through X(), so the public home feed (#feed-container) is never matched. */
            X(' .story-media-container[data-count]:not([data-count="1"])') + ' { display:flex !important; overflow-x:auto !important; overflow-y:hidden !important; scroll-snap-type:x mandatory !important; -webkit-overflow-scrolling:touch; overscroll-behavior-x:contain; touch-action:pan-x pan-y; scrollbar-width:none; }',
            X(' .story-media-container[data-count]:not([data-count="1"])::-webkit-scrollbar') + ' { display:none; height:0; }',
            X(' .story-media-container[data-count]:not([data-count="1"]) .story-media-item') + ' { flex:0 0 100% !important; scroll-snap-align:start; scroll-snap-stop:always; }',
            /* FIX (2026-10-30 - "remove the space at the top and bottom"): style.css gives every slide a fixed 420px stage with object-fit:contain
               and a grey fill, so a photo that isn't exactly that shape showed grey bars above and below it. In the profile feeds the slide now
               takes the photo's own height (full photo still shown - contain, never cropped; very tall photos capped), and the grey fill is removed. */
            X(' .story-media-container[data-count]:not([data-count="1"])') + ' { background:transparent !important; align-items:center; }',
            X(' .story-media-container[data-count]:not([data-count="1"]) .story-media-item') + ' { height:auto !important; max-height:none !important; aspect-ratio:auto !important; background:transparent !important; }',
            X(' .story-media-container[data-count]:not([data-count="1"]) .story-media-item img') + ', ' + X(' .story-media-container[data-count]:not([data-count="1"]) .story-media-item video') + ' { width:100% !important; height:auto !important; max-height:min(125vw,85vh) !important; object-fit:contain !important; background:transparent !important; }',
            /* action row breaks out of the indent so all 8 controls fit on a phone */
            X(' .story-actions') + ' { margin:6px -4px 12px -54px !important; border-top:0 !important; }',
            '#profile #profile-dash-feed, #profile #profile-posts-feed { margin-left:-24px !important; margin-right:-24px !important; }',
            '@media (max-width:768px) { #profile #profile-dash-feed, #profile #profile-posts-feed { margin-left:-16px !important; margin-right:-16px !important; } }',
            /* Chevron expand / collapse (appears only when the text runs past 3 lines) */
            X(' .post-expand-toggle') + ' { -webkit-appearance:none !important; appearance:none !important; display:inline-flex !important; align-items:center !important; justify-content:center !important; gap:0 !important; width:30px !important; height:30px !important; margin:4px 0 2px !important; padding:0 !important; border:1px solid #DDE2F1 !important; border-radius:50% !important; background:#fff !important; color:#1B2B8B !important; box-shadow:0 1px 2px rgba(15,21,54,.06) !important; font-size:0 !important; }',
            X(' .post-expand-toggle:active') + ' { transform:scale(.92); background:#EEF1FB !important; }',
            X(' .post-expand-toggle .post-expand-label') + ' { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }',
            X(' .post-expand-toggle .post-expand-chevron') + ' { width:16px !important; height:16px !important; stroke:#1B2B8B !important; stroke-width:2.2 !important; }',
            /* ---- Engagement bar (2026-10-27 premium redesign — profile feeds only) ----
               Equal-width grid: every control gets exactly 1/N of the row no matter what is
               inside it (counts are small labels under the icon, absolutely positioned, so a
               "217" or "1.2K" can never widen its cell). The like "bar" injected by
               app-fix-final.js's initLikeBar() is hidden here only — it was a block element
               inside the like pill, which showed as a stray dash and stretched that cell. */
            A + ' { display:grid !important; grid-auto-flow:column !important; grid-auto-columns:minmax(0,1fr) !important; align-items:stretch !important; gap:2px !important; padding:3px 4px !important; background:#F6F8FD !important; border:1px solid #E6EAF6 !important; border-radius:18px !important; box-shadow:none !important; overflow:hidden !important; }',
            A + '::-webkit-scrollbar { display:none; }',
            A + ' .action-btn { position:relative !important; flex:none !important; width:auto !important; min-width:0 !important; height:50px !important; min-height:50px !important; margin:0 !important; padding:0 !important; display:flex !important; align-items:center !important; justify-content:center !important; border-radius:14px !important; box-sizing:border-box; }',
            A + ' .action-btn' + N + ' { color:#5B6488 !important; }',
            A + ' .x-pill { position:relative; display:flex !important; align-items:center; justify-content:center; width:100% !important; height:100% !important; min-height:0 !important; min-width:0 !important; padding:0 0 11px !important; gap:0 !important; border-radius:14px !important; background:transparent !important; transition:background .18s, transform .12s; }',
            A + ' .x-pill:active, ' + A + ' .action-btn:active { transform:scale(.92); }',
            A + ' .action-btn svg { width:20px !important; height:20px !important; flex:none; stroke-width:1.5 !important; }',
            A + ' .action-btn' + N + ' svg { stroke:#5B6488 !important; }',
            /* counts: tiny centred label under the icon, identical position in every cell */
            A + ' .x-count { position:absolute !important; left:0; right:0; bottom:6px; text-align:center; overflow:hidden; text-overflow:clip; white-space:nowrap; font-size:.625rem !important; line-height:1 !important; font-weight:600 !important; letter-spacing:.01em; font-variant-numeric:tabular-nums; pointer-events:none; }',
            A + ' .action-btn' + N + ' .x-count { color:#5B6488 !important; }',
            /* the stray dash */
            A + ' .emp-like-bar-wrap { display:none !important; }',
            /* reply / quote: navy */
            A + ' .comment-btn:hover .x-pill, ' + A + ' .quote-btn:hover .x-pill { background:#E9EDFB !important; }',
            A + ' .comment-btn:hover svg, ' + A + ' .quote-btn:hover svg { stroke:#1B2B8B !important; }',
            /* repost: emerald */
            A + ' .retweet-btn:hover .x-pill { background:#E3F3EC !important; }',
            A + ' .retweet-btn:hover svg { stroke:#17805A !important; }',
            A + ' .retweet-btn.retweeted svg { stroke:#17805A !important; }',
            A + ' .retweet-btn.retweeted .x-count { color:#17805A !important; }',
            /* like: claret */
            A + ' .like-btn:hover .x-pill { background:#FBE8EE !important; }',
            A + ' .like-btn:hover svg { stroke:#B4234A !important; }',
            A + ' .like-btn.liked svg { stroke:#B4234A !important; fill:#B4234A !important; }',
            A + ' .like-btn.liked .x-count { color:#B4234A !important; }',
            /* like icon size (2026-10-27): the heart path only fills ~15x12 of its 24x24 box (the
               reply/repost icons fill ~20x17+), so at the same 20px it looked noticeably smaller.
               Drawn in a larger box so its visible size matches the rest. Profile feeds only. */
            A + ' .like-btn svg { width:27px !important; height:27px !important; }',
            /* views: quiet read-only cell (no .x-pill wrapper, so it carries its own layout) */
            A + ' .action-btn.view-count-display { padding:0 0 11px !important; gap:0 !important; pointer-events:none; }',
            A + ' .action-btn.view-count-display' + N + ' svg { stroke:#9AA1BC !important; }',
            A + ' .action-btn.view-count-display' + N + ' .x-count, ' + A + ' .action-btn.view-count-display' + N + ' { color:#9AA1BC !important; }',
            /* bookmark / share / download: brass, separated from the rest by a hairline */
            A + ' .bookmark-btn::before { content:""; position:absolute; left:-2px; top:12px; bottom:12px; width:1px; background:#DDD3B4; pointer-events:none; }',
            A + ' .bookmark-btn' + N + ' svg, ' + A + ' .share-btn svg, ' + A + ' .download-media-btn svg { stroke:#8F7130 !important; }',
            A + ' .bookmark-btn:hover .x-pill, ' + A + ' .share-btn:hover .x-pill, ' + A + ' .download-media-btn:hover .x-pill { background:#F5EEDB !important; }',
            A + ' .action-btn.bookmarked { color:#8F7130 !important; }',
            A + ' .action-btn.bookmarked svg { stroke:#8F7130 !important; fill:rgba(201,166,107,.4) !important; }'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    })();

    /* Videos tab tiles: pause/play + mute/unmute buttons on the live preview.
       Tapping either button only controls that video — it never opens the
       gallery viewer (the tile's own click handler also ignores .emp-vt-ctrl). */
    (function _injectVideoTileCtrlCSS() {
        if (document.getElementById('_emp_profile_video_tile_ctrl_css')) return;
        var s = document.createElement('style');
        s.id = '_emp_profile_video_tile_ctrl_css';
        s.textContent = [
            '#profile .emp-vt-ctrl { position:absolute; right:8px; bottom:8px; z-index:6; display:flex; gap:8px; }',
            '#profile .emp-vt-ctrl button { position:relative; width:32px; height:32px; padding:0; border-radius:50%; border:1px solid rgba(255,255,255,.35);',
            '  background:rgba(10,14,39,.55); color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer;',
            '  -webkit-tap-highlight-color:transparent; backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }',
            '#profile .emp-vt-ctrl button::after { content:""; position:absolute; inset:-5px; }',
            '#profile .emp-vt-ctrl button svg { width:16px; height:16px; display:block; pointer-events:none; }',
            '#profile .emp-vt-ctrl button.is-on { background:rgba(255,255,255,.94); color:#0A0E39; }'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    })();
    var _VT_SVG = function (inner, fill) {
        return '<svg viewBox="0 0 24 24" ' + (fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"') + ' aria-hidden="true">' + inner + '</svg>';
    };
    var _VT_PLAY  = _VT_SVG('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>', true);
    var _VT_PAUSE = _VT_SVG('<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>', true);
    var _VT_MUTED = _VT_SVG('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/>');
    var _VT_SOUND = _VT_SVG('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>');

    function _videoTileControls(card) {
        var v = card.querySelector('video'); if (!v) return;
        var wrap = document.createElement('div');
        wrap.className = 'emp-vt-ctrl';
        wrap.innerHTML = '<button type="button" class="emp-vt-pp"></button><button type="button" class="emp-vt-mute"></button>';
        card.appendChild(wrap);
        var pp = wrap.querySelector('.emp-vt-pp'), mu = wrap.querySelector('.emp-vt-mute');
        function sync() {
            pp.innerHTML = v.paused ? _VT_PLAY : _VT_PAUSE;
            pp.setAttribute('aria-label', v.paused ? 'Play' : 'Pause');
            mu.innerHTML = v.muted ? _VT_MUTED : _VT_SOUND;
            mu.classList.toggle('is-on', !v.muted);
            mu.setAttribute('aria-label', v.muted ? 'Unmute' : 'Mute');
        }
        ['play', 'pause', 'volumechange'].forEach(function (evt) { v.addEventListener(evt, sync); });
        sync();
        /* nothing inside the control cluster may reach the tile / page handlers */
        ['click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'].forEach(function (evt) {
            wrap.addEventListener(evt, function (e) { e.stopPropagation(); });
        });
    }

    /* Live preview for the Videos catalog: muted looping playback while a tile
       is mostly on screen (max 2 at once). Skipped on Data Saver / 2G, where
       the poster / first frame is shown instead. */
    function _attachVideoPreviews(root) {
        if (!root || !('IntersectionObserver' in window)) return;
        var conn = navigator.connection || {};
        if (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')) return;
        if (root._empPreviewIO) root._empPreviewIO.disconnect();
        var playing = [];
        function stop(v) {
            try { v.pause(); } catch (e) {}
            if (v.parentNode) v.parentNode.classList.remove('is-previewing');
            var k = playing.indexOf(v); if (k > -1) playing.splice(k, 1);
        }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                var v = en.target.querySelector('video'); if (!v) return;
                if (en.isIntersecting && en.intersectionRatio >= 0.6) {
                    while (playing.length >= 2) stop(playing[0]);
                    v.muted = true;
                    var pr = v.play();
                    if (pr && pr.then) pr.then(function () { en.target.classList.add('is-previewing'); if (playing.indexOf(v) < 0) playing.push(v); }).catch(function () {});
                } else { stop(v); }
            });
        }, { threshold: [0, 0.6] });
        root._empPreviewIO = io;
        Array.prototype.forEach.call(root.querySelectorAll('.emp-profile-video-thumb'), function (t) { io.observe(t); });
    }

    /* Profile feed videos (Posts tab + Dashboard "Your Feed"): play muted automatically while the video is
       on screen, one at a time, and pause when it scrolls away or the tab/section is hidden. A video the
       person pauses by hand stays paused until it leaves the screen. Skipped on Data Saver / 2G.
       Only videos inside #profile-posts-feed / #profile-dash-feed are touched (never the home feed). */
    (function _profileFeedAutoplay() {
        if (window._empProfileAutoplayInit) return;
        window._empProfileAutoplayInit = true;
        if (!('IntersectionObserver' in window)) return;
        var conn = navigator.connection || {};
        if (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')) return;
        var SEL = '#profile-posts-feed video.story-video, #profile-dash-feed video.story-video';
        var current = null;
        function stop(v) {
            if (!v) return;
            v._empAuto = true;
            try { v.pause(); } catch (e) {}
            v._empAuto = false;
            if (current === v) current = null;
        }
        function start(v) {
            if (v._empUserPaused || !v.paused) return;
            if (current && current !== v) stop(current);
            v.muted = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
            var pr = v.play();
            current = v;
            if (pr && pr.catch) pr.catch(function () { if (current === v) current = null; });
        }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                var v = en.target;
                var vh = (en.rootBounds && en.rootBounds.height) || window.innerHeight;
                var visible = en.isIntersecting && (en.intersectionRatio >= 0.6 || en.intersectionRect.height >= vh * 0.5);
                if (visible) start(v);
                else { v._empUserPaused = false; stop(v); }
            });
        }, { threshold: [0, 0.25, 0.5, 0.6, 0.8, 1] });
        function scan() {
            Array.prototype.forEach.call(document.querySelectorAll(SEL), function (v) {
                if (v._empAP) return;
                v._empAP = true;
                v.addEventListener('pause', function () { if (!v._empAuto && !v.ended) v._empUserPaused = true; });
                v.addEventListener('play', function () { if (!v._empAuto) v._empUserPaused = false; });
                io.observe(v);
            });
        }
        var t = null;
        function later() { clearTimeout(t); t = setTimeout(scan, 150); }
        function hook() {
            var root = document.getElementById('profile');
            if (!root) return false;
            new MutationObserver(later).observe(root, { childList: true, subtree: true });
            scan();
            return true;
        }
        if (!hook()) {
            var tries = 0, iv = setInterval(function () { if (hook() || ++tries > 60) clearInterval(iv); }, 1000);
        }
        document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.profile-tab')) setTimeout(scan, 200); });
        document.addEventListener('visibilitychange', function () { if (document.hidden) stop(current); });
    })();

    /* =========================================================================
       PROFILE REEL CARDS — auto-preview (2026-10-27)
       Scope: #profile only (Reels tab tiles + the mid-feed reel strip).
       Cards play a muted, looping preview while mostly on screen (max 2 at
       once; skipped on Data Saver / 2G, where the poster/first frame shows).
       There is deliberately NO sound button on these cards.
       ========================================================================= */
    (function _injectProfileReelAudioCSS() {
        if (document.getElementById('_emp_profile_reel_audio_css')) return;
        var s = document.createElement('style');
        s.id = '_emp_profile_reel_audio_css';
        s.textContent = '#profile .emp-profile-reel-thumb.is-previewing .emp-profile-reel-play { opacity:0; transition:opacity .25s; }';
        (document.head || document.documentElement).appendChild(s);
    })();

    (function _profileReelCards() {
        if (window._empProfileReelCardsInit) return;
        window._empProfileReelCardsInit = true;
        var SEL = '#profile .emp-profile-reel-thumb, #profile .emp-profile-feed-reel-card';
        var conn = navigator.connection || {};
        var saver = !!(conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''));
        var playing = [];
        var io = null;

        function stop(card) {
            var v = card.querySelector('video');
            if (v) { try { v.pause(); } catch (e) {} v.muted = true; }
            card.classList.remove('is-previewing');
            var k = playing.indexOf(card); if (k > -1) playing.splice(k, 1);
        }
        function start(card) {
            var v = card.querySelector('video'); if (!v) return;
            v.loop = true; v.muted = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
            while (playing.length >= 2) stop(playing[0]);
            var pr = v.play();
            var mark = function () { card.classList.add('is-previewing'); if (playing.indexOf(card) < 0) playing.push(card); };
            if (pr && pr.then) pr.then(mark).catch(function () {}); else mark();
        }
        function stopAll() { playing.slice().forEach(stop); }

        /* Opening the fullscreen reel viewer: pause the previews underneath. */
        document.addEventListener('click', function (e) {
            if (e.target && e.target.closest && e.target.closest(SEL)) stopAll();
        }, true);

        function scan() {
            if (saver || !io) return;
            Array.prototype.forEach.call(document.querySelectorAll(SEL), function (c) {
                if (c._empPRC) return; c._empPRC = true; io.observe(c);
            });
        }
        function rescan() {
            if (!io) return;
            Array.prototype.forEach.call(document.querySelectorAll(SEL), function (c) { io.unobserve(c); io.observe(c); });
        }
        if ('IntersectionObserver' in window && !saver) {
            io = new IntersectionObserver(function (entries) {
                entries.forEach(function (en) {
                    if (en.isIntersecting && en.intersectionRatio >= 0.6) start(en.target); else stop(en.target);
                });
            }, { threshold: [0, 0.6] });
        }
        var t = null; function later() { clearTimeout(t); t = setTimeout(scan, 150); }
        function hook() {
            var root = document.getElementById('profile'); if (!root) return false;
            new MutationObserver(later).observe(root, { childList: true, subtree: true });
            var ov = document.getElementById('reel-viewer-modal-overlay');
            if (ov) new MutationObserver(function () { if (ov.style.display === 'none') setTimeout(rescan, 200); }).observe(ov, { attributes: true, attributeFilter: ['style'] });
            scan(); return true;
        }
        if (!hook()) { var tries = 0, iv = setInterval(function () { if (hook() || ++tries > 60) clearInterval(iv); }, 1000); }
        document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.profile-tab')) setTimeout(scan, 200); });
        document.addEventListener('visibilitychange', function () { if (document.hidden) stopAll(); });
    })();

    /* =========================================================================
       PROFILE FEED VIDEOS — own pause / unmute / seek bar + no letterbox bars
       (2026-10-27)
       Scope: video posts inside #profile-posts-feed / #profile-dash-feed only.

       WHY: the browser's built-in video controls fire ordinary click events on
       the <video> element, which other scripts (tap/double-tap-to-open the
       fullscreen viewer) can't tell apart from a tap on the picture — so
       pausing or unmuting opened fullscreen. These videos now use a small
       control bar of our own. Its events are intercepted at window-capture
       level and handled here, so nothing else on the page ever sees them.
       The existing top-right fullscreen button is untouched.

       Also: the media box is sized to the video's own aspect ratio, which
       removes the dark bars above and below the picture.
       ========================================================================= */
    (function _profileFeedVideoControls() {
        if (window._empProfileVideoCtrlInit) return;
        window._empProfileVideoCtrlInit = true;

        var SEL = '#profile-posts-feed video.story-video, #profile-dash-feed video.story-video';
        var SVG = function (inner, fill) {
            return '<svg viewBox="0 0 24 24" ' + (fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"') + ' aria-hidden="true">' + inner + '</svg>';
        };
        var I_PLAY  = SVG('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>', true);
        var I_PAUSE = SVG('<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>', true);
        var I_MUTED = SVG('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/>');
        var I_SOUND = SVG('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>');

        var css = document.createElement('style');
        css.id = '_emp_profile_video_ctrl_css';
        css.textContent = [
            '#profile .story-media-item.emp-vc-host { position:relative; }',
            '#profile-posts-feed video.story-video::-webkit-media-controls, #profile-dash-feed video.story-video::-webkit-media-controls, #profile-posts-feed video.story-video::-webkit-media-controls-enclosure, #profile-dash-feed video.story-video::-webkit-media-controls-enclosure { display:none !important; }',
            '#profile .emp-vc { position:absolute; left:0; right:0; bottom:0; z-index:7; display:flex; align-items:center; gap:10px; padding:22px 10px 8px; color:#fff;',
            '  background:linear-gradient(to top, rgba(5,7,30,.72), rgba(5,7,30,0)); -webkit-tap-highlight-color:transparent; user-select:none; -webkit-user-select:none; }',
            '#profile .emp-vc button { position:relative; width:34px; height:34px; padding:0; border:0; border-radius:50%; background:rgba(255,255,255,.18); color:#fff;',
            '  display:flex; align-items:center; justify-content:center; flex-shrink:0; cursor:pointer; }',
            '#profile .emp-vc button::after { content:""; position:absolute; inset:-6px; }',
            '#profile .emp-vc button svg { width:17px; height:17px; display:block; pointer-events:none; }',
            '#profile .emp-vc-seek { position:relative; flex:1; height:30px; display:flex; align-items:center; cursor:pointer; touch-action:none; }',
            '#profile .emp-vc-seek::before { content:""; position:absolute; left:0; right:0; height:4px; border-radius:2px; background:rgba(255,255,255,.3); }',
            '#profile .emp-vc-fill { position:absolute; left:0; height:4px; border-radius:2px; background:#fff; width:0; pointer-events:none; }',
            '#profile .emp-vc-time { font-size:.72rem; font-weight:600; letter-spacing:.2px; white-space:nowrap; text-shadow:0 1px 2px rgba(0,0,0,.5); }'
        ].join('\n');
        (document.head || document.documentElement).appendChild(css);

        function fmt(s) {
            if (!isFinite(s) || s < 0) s = 0;
            var m = Math.floor(s / 60), r = Math.floor(s % 60);
            return m + ':' + (r < 10 ? '0' : '') + r;
        }

        /* ---- no letterbox bars: media box takes the video's own shape ---- */
        function imp(el, prop, val) { el.style.setProperty(prop, val, 'important'); }
        function fitBox(v) {
            var mc = v.closest('.story-media-container');
            if (mc && mc.getAttribute('data-count') && mc.getAttribute('data-count') !== '1') return;  /* leave swipe carousels alone */
            var el = v.parentElement;
            while (el && el !== mc) {
                imp(el, 'background', 'transparent'); imp(el, 'height', 'auto'); imp(el, 'min-height', '0');
                imp(el, 'max-height', 'none'); imp(el, 'aspect-ratio', 'auto'); imp(el, 'padding-top', '0'); imp(el, 'padding-bottom', '0');
                el = el.parentElement;
            }
            if (mc) { imp(mc, 'background', 'transparent'); imp(mc, 'height', 'auto'); imp(mc, 'min-height', '0'); imp(mc, 'max-height', 'none'); imp(mc, 'aspect-ratio', 'auto'); }
            imp(v, 'width', '100%'); imp(v, 'height', 'auto'); imp(v, 'min-height', '0'); imp(v, 'max-height', 'none');
            imp(v, 'object-fit', 'cover'); imp(v, 'background', 'transparent'); imp(v, 'display', 'block');
            if (v.videoWidth && v.videoHeight) imp(v, 'aspect-ratio', v.videoWidth + ' / ' + v.videoHeight);
        }

        /* ---- control bar ---- */
        function refresh(v) {
            var bar = v._empVC; if (!bar) return;
            /* only touch the DOM when something changed (the page-wide observer watches this subtree) */
            if (bar._p !== v.paused) {
                bar._p = v.paused;
                bar.querySelector('.emp-vc-play').innerHTML = v.paused ? I_PLAY : I_PAUSE;
                bar.querySelector('.emp-vc-play').setAttribute('aria-label', v.paused ? 'Play' : 'Pause');
            }
            if (bar._m !== v.muted) {
                bar._m = v.muted;
                bar.querySelector('.emp-vc-mute').innerHTML = v.muted ? I_MUTED : I_SOUND;
                bar.querySelector('.emp-vc-mute').setAttribute('aria-label', v.muted ? 'Unmute' : 'Mute');
            }
            var d = v.duration || 0;
            bar.querySelector('.emp-vc-fill').style.width = (d ? Math.min(100, (v.currentTime / d) * 100) : 0) + '%';
            bar.querySelector('.emp-vc-time').firstChild.nodeValue = fmt(v.currentTime) + ' / ' + fmt(d);
        }
        function enhance(v) {
            if (v.controls) { v.controls = false; v.removeAttribute('controls'); }
            if (v._empVC) return;
            var host = v.closest('.story-media-item') || v.parentElement;
            if (!host) return;
            host.classList.add('emp-vc-host');
            var bar = document.createElement('div');
            bar.className = 'emp-vc';
            bar.innerHTML =
                '<button type="button" class="emp-vc-play"></button>'
                + '<div class="emp-vc-seek"><div class="emp-vc-fill"></div></div>'
                + '<span class="emp-vc-time">0:00 / 0:00</span>'
                + '<button type="button" class="emp-vc-mute"></button>';
            bar._empVideo = v;
            host.appendChild(bar);
            v._empVC = bar;
            ['play', 'pause', 'volumechange', 'timeupdate', 'durationchange', 'ended'].forEach(function (evt) {
                v.addEventListener(evt, function () { refresh(v); });
            });
            v.addEventListener('loadedmetadata', function () { fitBox(v); refresh(v); });
            fitBox(v);
            refresh(v);
        }

        /* ---- events ----
           index.html installs a tiny shield in <head> (window.__empCtrlShield) BEFORE any other script,
           so taps on these controls are swallowed first and handed to onCtrl() below. If that shield is
           missing, the same thing is registered here as a fallback. */
        var dragging = null;
        function seekFrom(bar, e) {
            var v = bar._empVideo, track = bar.querySelector('.emp-vc-seek');
            if (!v || !track || !v.duration) return;
            var r = track.getBoundingClientRect();
            var pt = (e.touches && e.touches[0]) || e;
            var f = Math.max(0, Math.min(1, (pt.clientX - r.left) / r.width));
            try { v.currentTime = f * v.duration; } catch (err) {}
            refresh(v);
        }
        function togglePlay(v) {
            if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else { v.pause(); }
        }
        function toggleMute(v, scopeSel) {
            if (v.muted) {
                Array.prototype.forEach.call(document.querySelectorAll(scopeSel), function (o) { if (o !== v) o.muted = true; });
                v.muted = false; v.volume = 1;
            } else { v.muted = true; }
        }
        function onCtrl(evt, e, el) {
            /* Videos-tab tile buttons */
            if (el.classList.contains('emp-vt-ctrl')) {
                if (evt !== 'click') return;
                e.preventDefault();
                var card = el.closest('.emp-profile-video-thumb');
                var tv = card && card.querySelector('video'); if (!tv) return;
                if (e.target.closest('.emp-vt-pp')) { togglePlay(tv); if (!tv.paused) card.classList.add('is-previewing'); }
                else if (e.target.closest('.emp-vt-mute')) toggleMute(tv, '#profile .emp-profile-video-thumb video');
                return;
            }
            /* feed-post control bar */
            var v = el._empVideo; if (!v) return;
            if (evt === 'pointerdown' && e.target.closest('.emp-vc-seek')) { dragging = el; seekFrom(el, e); }
            if (evt === 'pointerup') dragging = null;
            if (evt !== 'click') return;
            e.preventDefault();
            if (e.target.closest('.emp-vc-play')) togglePlay(v);
            else if (e.target.closest('.emp-vc-mute')) toggleMute(v, SEL);
            else if (e.target.closest('.emp-vc-seek')) seekFrom(el, e);
            refresh(v);
        }
        window.__empCtrlEvent = onCtrl;
        if (!window.__empCtrlShield) {
            ['click', 'dblclick', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown', 'pointerup', 'contextmenu'].forEach(function (evt) {
                window.addEventListener(evt, function (e) {
                    var el = e.target && e.target.closest ? e.target.closest('#profile .emp-vc, #profile .emp-vt-ctrl') : null;
                    if (!el) return;
                    e.stopImmediatePropagation();
                    onCtrl(evt, e, el);
                }, true);
            });
        }
        ['pointermove', 'touchmove'].forEach(function (evt) {
            window.addEventListener(evt, function (e) {
                if (dragging) { e.stopImmediatePropagation(); seekFrom(dragging, e); }
            }, true);
        });
        window.addEventListener('pointercancel', function () { dragging = null; }, true);

        function scan() {
            Array.prototype.forEach.call(document.querySelectorAll(SEL), enhance);
        }
        var t = null; function later() { clearTimeout(t); t = setTimeout(scan, 120); }
        function hook() {
            var root = document.getElementById('profile'); if (!root) return false;
            new MutationObserver(later).observe(root, { childList: true, subtree: true });
            scan(); return true;
        }
        if (!hook()) { var tries = 0, iv = setInterval(function () { if (hook() || ++tries > 60) clearInterval(iv); }, 1000); }
        document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.profile-tab')) setTimeout(scan, 200); });
    })();

    /* Tap-to-open share sheet shown after a profile post is published with social networks selected.
       Plain <a target="_blank"> links, so the person's own tap opens each app (no popup blocking). */
    /* FEATURE (2026-10-27 - "the verification badge should also be displayed in the profile page"): the same
       blue verified seal the feed shows after an author's name (app-feed.js _empPostTickHTML), same rules: a user
       flagged hasBlueBadge, the chiefadmin account, or an admin viewing their own profile. Inline SVG, no text, so
       #profile-display-name's .textContent still reads just the name. */
    function _profTickHTML(user, isMine) {
        try {
            var nm = String((user && (user.fullName || '')) || '').trim().toLowerCase();
            var un = String((user && user.username) || '').trim().toLowerCase();
            var ok = !!((user && user.hasBlueBadge) || nm === 'chiefadmin' || un === 'chiefadmin' || (isMine && _isAdmin()));
            if (!ok) return '';
            return '<svg class="emp-profile-tick" viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="Verified account" style="margin-left:6px;vertical-align:-4px;flex-shrink:0;"><path d="M12 2l2.4 2 3.1-.3.9 3 2.7 1.6-1 3 1 3-2.7 1.6-.9 3-3.1-.3L12 22l-2.4-2-3.1.3-.9-3L3 15.7l1-3-1-3 2.7-1.6.9-3 3.1.3z" fill="#1D9BF0"/><path d="M8 12.3l2.8 2.8 5.4-5.6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        } catch (e) { return ''; }
    }

    function _profShareSheet(postId, text, nets) {
        var old = document.getElementById('emp-prof-share-sheet'); if (old) old.remove();
        var url = window.location.origin + '/?post=' + encodeURIComponent(postId || '');
        var t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        var enc = encodeURIComponent;
        var defs = {
            whatsapp: ['WhatsApp', 'https://wa.me/?text=' + enc((t ? t + ' ' : '') + url)],
            facebook: ['Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + enc(url)],
            x:        ['X', 'https://twitter.com/intent/tweet?text=' + enc(t) + '&url=' + enc(url)],
            telegram: ['Telegram', 'https://t.me/share/url?url=' + enc(url) + '&text=' + enc(t)]
        };
        var box = document.createElement('div');
        box.id = 'emp-prof-share-sheet';
        box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:88px;z-index:10050;background:#fff;border:1px solid #E3E6F3;border-radius:16px;padding:14px;box-shadow:0 12px 34px rgba(10,14,39,0.22);font-family:inherit;';
        var links = nets.filter(function (n) { return defs[n]; }).map(function (n) {
            return '<a href="' + defs[n][1] + '" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border-radius:999px;background:#1B2B8B;color:#fff;font-size:0.84rem;font-weight:700;text-decoration:none;">' + defs[n][0] + '</a>';
        }).join('');
        box.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
            + '<b style="font-size:0.92rem;color:#0A0E39;">Post published. Share it now</b>'
            + '<button type="button" id="emp-prof-share-close" aria-label="Close" style="min-width:44px;min-height:44px;border:0;background:none;color:#5A6385;font-size:1.3rem;cursor:pointer;">&times;</button></div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:8px;">' + links + '</div>';
        document.body.appendChild(box);
        box.addEventListener('click', function (e) {
            if (e.target && e.target.id === 'emp-prof-share-close') { box.remove(); return; }
            if (e.target && e.target.closest && e.target.closest('a')) setTimeout(function () { box.remove(); }, 300);
        });
        setTimeout(function () { if (box.parentNode) box.remove(); }, 20000);
    }

    /* "Suggested for you" — horizontal, snap-scrolling. Same candidate rules
       and dismissal store as app-suggested-contacts.js. Follow reuses the
       app-wide delegated .follow-btn handler (data-user-id). */
    var _SFY_DISMISS_KEY = 'empyrean_dismissed_suggestions';
    function _sfyDismissed() {
        try { return new Set(JSON.parse(localStorage.getItem(_SFY_DISMISS_KEY) || '[]')); }
        catch (e) { return new Set(); }
    }
    function _sfyEligible(list, viewedUserId) {
        var me = _us(), f = me.followedUserIds;
        var followed = (f instanceof Set) ? f : new Set(Array.isArray(f) ? f : []);
        var gone = _sfyDismissed();
        return list.filter(function (u) {
            return u && u.id && u.id !== me.id && u.id !== viewedUserId && !followed.has(u.id) && !gone.has(u.id);
        }).sort(function (a, b) { return (b.followerCount || 0) - (a.followerCount || 0); }).slice(0, 12);
    }
    function _sfyHtml(list) {
        var cards = list.map(function (u) {
            var av = u.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(u.fullName || 'U') + '&background=1B2B8B&color=fff&size=136');
            return '<div class="emp-sfy-card" data-sfy-id="' + _attr(u.id) + '">'
                + '<button type="button" class="emp-sfy-x" aria-label="Dismiss suggestion"><i class="fas fa-times"></i></button>'
                + '<div class="emp-sfy-open" data-sfy-open="' + _attr(u.id) + '">'
                + '<img class="emp-sfy-av" src="' + _attr(av) + '" alt="" loading="lazy">'
                + '<div class="emp-sfy-name">' + _esc(u.fullName || u.username || 'User') + '</div>'
                + '<div class="emp-sfy-sub">' + _esc(u.bio || (u.username ? '@' + u.username : '')) + '</div></div>'
                + '<button type="button" class="follow-btn" data-user-id="' + _attr(u.id) + '">Follow</button></div>';
        }).join('');
        return '<div class="emp-sfy" id="profile-suggested-row"><div class="emp-sfy-head"><b>Suggested for you</b></div>'
            + '<div class="emp-sfy-row">' + cards + '</div></div>';
    }
    function _hydrateSuggestedRow(viewedUserId) {
        var slot = document.getElementById('profile-suggested-row-slot');
        if (!slot || _isGuest()) return;
        function show(list) {
            if (!document.body.contains(slot) || !list.length) return;
            slot.innerHTML = _sfyHtml(list);
        }
        var mu = _mu();
        var local = _sfyEligible(Object.keys(mu).map(function (k) { return mu[k]; }), viewedUserId);
        if (local.length) { show(local); return; }
        /* Nothing in the local user cache yet: ask Firestore for a small batch. */
        if (window.fbDb && window._firebaseLoaded && typeof window.fbDb.collection === 'function') {
            window.fbDb.collection('users').limit(30).get().then(function (snap) {
                var arr = [];
                snap.forEach(function (d) {
                    var x = d.data() || {};
                    arr.push({ id: d.id, fullName: x.fullName, username: x.username, avatar: x.avatar, bio: x.bio, followerCount: x.followerCount });
                });
                show(_sfyEligible(arr, viewedUserId));
            }).catch(function () {});
        }
    }
    document.addEventListener('click', function (e) {
        var t = e.target; if (!t || !t.closest) return;
        var x = t.closest('#profile .emp-sfy-x');
        if (x) {
            var card = x.closest('.emp-sfy-card'); if (!card) return;
            var set = _sfyDismissed(); set.add(card.getAttribute('data-sfy-id'));
            try { localStorage.setItem(_SFY_DISMISS_KEY, JSON.stringify(Array.from(set))); } catch (er) {}
            var row = card.parentNode; card.remove();
            if (row && !row.children.length) { var w = document.getElementById('profile-suggested-row'); if (w) w.remove(); }
            return;
        }
        var op = t.closest('#profile .emp-sfy-open');
        if (op) {
            var uid = op.getAttribute('data-sfy-open'); if (!uid) return;
            window._viewingOtherProfile = (uid !== _us().id);
            if (typeof window.renderUserProfile === 'function') window.renderUserProfile(uid);
            if (typeof window.navigateTo === 'function') window.navigateTo('profile', true);
            setTimeout(function () { window._viewingOtherProfile = false; }, 500);
        }
    });
    console.log('[EmpProfile] premium media v2 active');


    /* =========================================================================
       §1  renderUserProfile
       Builds the entire #profile section HTML for the given user ID.
       ========================================================================= */

    function renderUserProfile(userId) {
        var mu   = _mu();
        var user = mu[userId];
        if (!user) {
            console.error('[Profile] User not found:', userId);
            return;
        }
        var us   = _us();
        var profileSection = document.getElementById('profile');
        if (!profileSection) return;

        var isMyProfile = !_isGuest() && user.id === us.id;

        /* FIX (2026-10-28 — "profile picture missing in one browser until re-uploaded"): the
           user-list copy of MY OWN account (mockUsers[me]) can lag behind the live session object,
           so the profile page drew an older/placeholder avatar even though the real one was already
           loaded. For my own profile the live session object wins; a real picture is never replaced
           by a placeholder. */
        if (isMyProfile) {
            try {
                var _phA = function (u) { return !u || typeof u !== 'string' || /ui-avatars\.com|source\.unsplash\.com/i.test(u); };
                var _merged = Object.assign({}, user, us);
                if (_phA(_merged.avatar) && !_phA(user.avatar)) _merged.avatar = user.avatar;
                if (!_merged.coverPhoto && user.coverPhoto) _merged.coverPhoto = user.coverPhoto;
                user = _merged;
            } catch (_ownErr) { }
        }

        // Birthday check — dobMonthDay ('MM-DD', written once at signup —
        // see app-auth.js's newUser object) compared against today's own
        // local 'MM-DD'. Shown to OTHER visitors only (the person doesn't
        // need to gift themselves); doesn't depend on dobVisibility, since
        // a follower already knows today is this person's birthday from
        // the push notification (app-push-setup.js/server.js) — this button
        // isn't what reveals the date.
        var _now = new Date();
        var _todayMonthDay = String(_now.getMonth() + 1).padStart(2, '0') + '-' + String(_now.getDate()).padStart(2, '0');
        var isBirthdayToday = !isMyProfile && !!user.dobMonthDay && user.dobMonthDay === _todayMonthDay;

        /* FIX (back-arrow tap not responding on another user's profile):
           .mobile-menu-toggle (nav-patch.css) is position:fixed;top:12px;
           left:12px;width:40px;height:40px;z-index:9998 — sitting directly
           on top of the "← My Profile" back button below, which renders as
           the very first element in this section's scrollable content, at
           that same top-left corner, with no elevated z-index of its own.
           Being fixed, the toggle wins every tap in that 40x40 box
           regardless of what's underneath, so the back button never
           actually receives the click. Same overlap class this codebase
           already works around for the reel viewer/thread view/marketplace
           (see app-reel.js's 'reel-open', app-thread.js's 'vf-thread-open',
           style.css's 'mkt-hide-menu-toggle') — same fix here: hide the
           toggle for as long as the back button is the thing occupying
           that corner, and restore it the moment this is the user's own
           profile (no back button, no overlap) or the section is left. */
        document.body.classList.toggle('viewing-other-profile', !isMyProfile);

        /* ── KYC form HTML (rendered only on own profile) ── */
        function _kycField(label, id, type, required) {
            return '<div class="form-group"><label for="' + _attr(id) + '">' + label + '</label>'
                + '<input type="' + (type || 'text') + '" id="' + _attr(id) + '"'
                + (required ? ' required' : '') + '></div>';
        }
        function _kycUpload(label, inputId, iconClass) {
            return '<div class="form-group"><label>' + label + '</label>'
                + '<div class="upload-area kyc-file-upload" data-input-id="' + _attr(inputId) + '">'
                + '<i class="fas ' + iconClass + '"></i><span>Click to upload</span></div>'
                + '<input type="file" id="' + _attr(inputId) + '" accept="image/*,.pdf" style="display:none;" required>'
                + '<span class="file-upload-preview" id="' + _attr(inputId) + '-preview"></span></div>';
        }
        function _kycSelfie(btnId) {
            return '<div class="form-group"><label>Selfie Verification</label>'
                + '<button type="button" class="btn btn-small live-capture-btn" id="' + _attr(btnId) + '" data-captured="false">'
                + '<i class="fas fa-camera"></i> Capture Live Selfie</button>'
                + '<span class="file-upload-preview" id="' + _attr(btnId) + '-preview"></span></div>';
        }

        var kycFormHTML =
            '<div class="card"><div class="card-content">'
            + '<h3><i class="fas fa-shield-alt"></i> Account Verification (KYC)</h3>'
            + '<p>Complete verification to access all platform features, including withdrawals.</p>'
            + '<hr style="border:1px solid #eee;margin:20px 0;">'
            + '<div id="kyc-entity-selector-container"><h4>Step 1: Select Entity Type</h4>'
            + '<div id="kyc-entity-selector" style="margin-top:20px;">'
            + '<div class="kyc-entity-btn" data-form="individual-kyc-form"><i class="fas fa-user"></i><span>Individual</span></div>'
            + '<div class="kyc-entity-btn" data-form="ngo-kyc-form"><i class="fas fa-sitemap"></i><span>NGO</span></div>'
            + '<div class="kyc-entity-btn" data-form="company-kyc-form"><i class="fas fa-building"></i><span>Company</span></div>'
            + '<div class="kyc-entity-btn" data-form="cooperative-kyc-form"><i class="fas fa-users"></i><span>Cooperative</span></div>'
            + '<div class="kyc-entity-btn" data-form="government-kyc-form"><i class="fas fa-landmark"></i><span>Government Agency</span></div>'
            + '<div class="kyc-entity-btn" data-form="international-kyc-form"><i class="fas fa-globe"></i><span>International Organization</span></div>'
            + '</div></div>'
            + '<div id="kyc-forms-container" style="margin-top:30px;">'
            /* Individual */
            + '<form id="individual-kyc-form" class="kyc-form" novalidate>'
            + '<h4>Step 2: Individual Verification</h4>'
            + '<div class="grid-2">'
            + _kycField('First Name', 'kyc-ind-fname', 'text', true)
            + _kycField('Last Name', 'kyc-ind-lname', 'text', true) + '</div>'
            + '<div class="form-group"><label>Date of Birth</label><div class="date-select-group">'
            + '<select required><option value="">Day</option></select>'
            + '<select required><option value="">Month</option></select>'
            + '<select required><option value="">Year</option></select></div></div>'
            + '<div class="form-group"><label for="kyc-ind-gender">Gender</label>'
            + '<select id="kyc-ind-gender" required><option value="">--Select--</option><option>Male</option><option>Female</option></select></div>'
            + _kycField('Phone', 'kyc-ind-phone', 'tel', true)
            + _kycField('Email', 'kyc-ind-email', 'email', true)
            + _kycField('Residential Address', 'kyc-ind-address', 'text', true)
            + '<div class="form-group"><label for="kyc-ind-id-type">ID Type</label>'
            + '<select id="kyc-ind-id-type" required><option value="">--Select--</option>'
            + '<option>Passport</option><option>National ID</option><option>Driver\'s License</option><option>Voter\'s Card</option></select></div>'
            + _kycField('ID Number', 'kyc-ind-id-number', 'text', true)
            + _kycUpload('Upload ID (Front & Back)', 'kyc-ind-id-upload', 'fa-id-card')
            + _kycSelfie('kyc-ind-selfie-btn')
            + '<button type="submit" class="btn btn-accent">Submit Verification</button>'
            + '</form>'
            /* Company */
            + '<form id="company-kyc-form" class="kyc-form" novalidate>'
            + '<h4>Step 2: Company Verification</h4>'
            + _kycField('Organisation Name', 'kyc-com-name', 'text', true)
            + _kycField('CAC Registration Number', 'kyc-com-cac', 'text', true)
            + _kycField('SCUML Certificate Number', 'kyc-com-scuml', 'text', true)
            + _kycField('CEO/Representative Name', 'kyc-com-rep-name', 'text', true)
            + _kycField('Official Phone', 'kyc-com-phone', 'tel', true)
            + _kycField('Official Email', 'kyc-com-email', 'email', true)
            + _kycField('Office Address', 'kyc-com-address', 'text', true)
            + _kycUpload('Upload CAC Certificate', 'kyc-com-cac-upload', 'fa-file-alt')
            + _kycUpload('Upload SCUML Certificate', 'kyc-com-scuml-upload', 'fa-file-alt')
            + _kycUpload("Representative's ID", 'kyc-com-rep-id-upload', 'fa-id-card')
            + _kycSelfie('kyc-com-selfie-btn')
            + '<button type="submit" class="btn btn-accent">Submit Verification</button>'
            + '</form>'
            /* NGO */
            + '<form id="ngo-kyc-form" class="kyc-form" novalidate>'
            + '<h4>Step 2: NGO Verification</h4>'
            + _kycField('Organisation Name', 'kyc-ngo-name', 'text', true)
            + _kycField('CAC Registration Number', 'kyc-ngo-cac', 'text', true)
            + _kycField('SCUML Certificate Number', 'kyc-ngo-scuml', 'text', true)
            + _kycField('President/Representative Name', 'kyc-ngo-rep-name', 'text', true)
            + _kycField('Official Phone', 'kyc-ngo-phone', 'tel', true)
            + _kycField('Official Email', 'kyc-ngo-email', 'email', true)
            + _kycField('Office Address', 'kyc-ngo-address', 'text', true)
            + _kycUpload('Upload CAC Certificate', 'kyc-ngo-cac-upload', 'fa-file-alt')
            + _kycUpload('Upload SCUML Certificate', 'kyc-ngo-scuml-upload', 'fa-file-alt')
            + _kycUpload("Representative's ID", 'kyc-ngo-rep-id-upload', 'fa-id-card')
            + _kycSelfie('kyc-ngo-selfie-btn')
            + '<button type="submit" class="btn btn-accent">Submit Verification</button>'
            + '</form>'
            /* Cooperative */
            + '<form id="cooperative-kyc-form" class="kyc-form" novalidate>'
            + '<h4>Step 2: Cooperative Society Verification</h4>'
            + _kycField('Organisation Name', 'kyc-coop-name', 'text', true)
            + _kycField('Certificate Number', 'kyc-coop-cert', 'text', true)
            + _kycField('TIN Number', 'kyc-coop-tin', 'text', true)
            + _kycField('President/Representative Name', 'kyc-coop-rep-name', 'text', true)
            + _kycField('Official Phone', 'kyc-coop-phone', 'tel', true)
            + _kycField('Official Email', 'kyc-coop-email', 'email', true)
            + _kycField('Office Address', 'kyc-coop-address', 'text', true)
            + _kycUpload('Upload Registration Certificate', 'kyc-coop-cert-upload', 'fa-file-alt')
            + _kycUpload('Upload TIN Document', 'kyc-coop-tin-upload', 'fa-file-alt')
            + _kycUpload("Representative's ID", 'kyc-coop-rep-id-upload', 'fa-id-card')
            + _kycSelfie('kyc-coop-selfie-btn')
            + '<button type="submit" class="btn btn-accent">Submit Verification</button>'
            + '</form>'
            /* Government Agency */
            + '<form id="government-kyc-form" class="kyc-form" novalidate>'
            + '<h4>Step 2: Government Agency Verification</h4>'
            + _kycField('Agency/Ministry Name', 'kyc-gov-name', 'text', true)
            + _kycField('Supervising Ministry / Parent Body', 'kyc-gov-parent', 'text', true)
            + _kycField('Gazette / Establishment Number', 'kyc-gov-gazette', 'text', true)
            + _kycField('Authorised Officer Name', 'kyc-gov-rep-name', 'text', true)
            + _kycField('Authorised Officer Designation/Title', 'kyc-gov-rep-title', 'text', true)
            + _kycField('Official Phone', 'kyc-gov-phone', 'tel', true)
            + _kycField('Official Email', 'kyc-gov-email', 'email', true)
            + _kycField('Office Address', 'kyc-gov-address', 'text', true)
            + _kycUpload('Upload Certificate of Establishment / Gazette Notice', 'kyc-gov-gazette-upload', 'fa-file-alt')
            + _kycUpload('Upload Letter of Authorisation (on official letterhead)', 'kyc-gov-auth-upload', 'fa-file-alt')
            + _kycUpload("Representative's ID", 'kyc-gov-rep-id-upload', 'fa-id-card')
            + _kycSelfie('kyc-gov-selfie-btn')
            + '<button type="submit" class="btn btn-accent">Submit Verification</button>'
            + '</form>'
            /* International Organization / Institution */
            + '<form id="international-kyc-form" class="kyc-form" novalidate>'
            + '<h4>Step 2: International Organization / Institution Verification</h4>'
            + _kycField('Organisation Name', 'kyc-intl-name', 'text', true)
            + _kycField('Country of Headquarters/Origin', 'kyc-intl-hq-country', 'text', true)
            + _kycField('International Registration/Charter Number', 'kyc-intl-reg-number', 'text', true)
            + _kycField('Local Operating Permit Number', 'kyc-intl-permit', 'text', true)
            + _kycField('Country Representative/Director Name', 'kyc-intl-rep-name', 'text', true)
            + _kycField('Official Phone', 'kyc-intl-phone', 'tel', true)
            + _kycField('Official Email', 'kyc-intl-email', 'email', true)
            + _kycField('Local Office Address', 'kyc-intl-address', 'text', true)
            + _kycUpload('Upload International Registration/Charter Certificate', 'kyc-intl-reg-upload', 'fa-file-alt')
            + _kycUpload('Upload Local Operating Permit', 'kyc-intl-permit-upload', 'fa-file-alt')
            + _kycUpload("Representative's ID", 'kyc-intl-rep-id-upload', 'fa-id-card')
            + _kycSelfie('kyc-intl-selfie-btn')
            + '<button type="submit" class="btn btn-accent">Submit Verification</button>'
            + '</form>'
            + '</div></div></div>';

        /* ── Bio chips row ── */
        function _buildBioChips() {
            var rows = [
                { icon: 'fa-align-left',      label: 'Bio',            val: user.bio },
                { icon: 'fa-briefcase',        label: 'Profession',     val: user.profession },
                { icon: 'fa-graduation-cap',   label: 'Education',      val: user.education },
                { icon: 'fa-heart',            label: 'Marital Status', val: user.maritalStatus },
                { icon: 'fa-gamepad',          label: 'Hobbies',        val: user.hobbies },
                { icon: 'fa-map-marker-alt',   label: 'Location',       val: user.location },
                { icon: 'fa-globe',            label: 'Website',        val: user.website },
                { icon: 'fa-envelope',         label: 'Email',          val: isMyProfile ? user.email : null },
                { icon: 'fa-phone',            label: 'Phone',          val: isMyProfile ? user.phone : null }
            ].filter(function (r) { return r.val && String(r.val).trim(); });

            if (!rows.length) return '';

            var chips = rows.map(function (r) {
                var v = String(r.val).trim();
                var lo = '', lc = '';
                if (r.label === 'Website') {
                    lo = '<a href="' + (v.startsWith('http') ? v : 'https://' + v) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;">';
                    lc = '</a>';
                } else if (r.label === 'Email') {
                    lo = '<a href="mailto:' + _attr(v) + '" style="text-decoration:none;color:inherit;">'; lc = '</a>';
                } else if (r.label === 'Phone') {
                    lo = '<a href="tel:' + _attr(v) + '" style="text-decoration:none;color:inherit;">'; lc = '</a>';
                }
                return lo
                    + '<div style="flex-shrink:0;background:#fff;border:1.5px solid rgba(10,14,39,0.09);border-radius:50px;'
                    + 'padding:7px 14px;display:flex;align-items:center;gap:7px;box-shadow:0 1px 4px rgba(10,14,39,0.06);">'
                    + '<div style="width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#0A0E27,#1B2B8B);'
                    + 'display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
                    + '<i class="fas ' + r.icon + '" style="color:#F5C518;font-size:0.5rem;"></i></div>'
                    + '<div style="min-width:0;">'
                    + '<div style="font-size:0.58rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.4px;white-space:nowrap;">' + r.label + '</div>'
                    + '<div style="font-size:0.78rem;color:var(--text-primary);font-weight:600;white-space:nowrap;max-width:130px;overflow:hidden;text-overflow:ellipsis;">' + _esc(v) + '</div>'
                    + '</div></div>' + lc;
            }).join('');

            var editBtn = isMyProfile
                ? '<a href="#" class="nav-link" data-target="settings" style="flex-shrink:0;font-size:0.65rem;color:var(--secondary);font-weight:700;text-decoration:none;display:flex;align-items:center;gap:3px;padding:0 6px;"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg> Edit</a>'
                : '';

            return '<div id="profile-biodata-card" style="margin:12px 0 0;overflow:hidden;">'
                + '<div style="display:flex;align-items:center;justify-content:space-between;padding:0 16px 6px;">'
                + '<span style="font-size:0.65rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.6px;">'
                + '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:4px;color:var(--secondary);"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.6-1.4 1.8-2 3-2s2.4.6 3 2"/><line x1="14.5" y1="10" x2="18.5" y2="10"/><line x1="14.5" y1="14" x2="18.5" y2="14"/></svg>About '
                + (isMyProfile ? 'Me' : _esc(user.fullName.split(' ')[0])) + '</span>' + editBtn + '</div>'
                + '<div style="display:flex;gap:8px;padding:0 16px 14px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;scroll-snap-type:x mandatory;">'
                + chips + '</div></div>';
        }

        /* ── About tab rows ── */
        function _buildAboutRows() {
            var rows = [
                { icon: 'fa-briefcase',       label: 'Profession',     val: user.profession },
                { icon: 'fa-graduation-cap',  label: 'Education',      val: user.education },
                { icon: 'fa-heart',           label: 'Marital Status', val: user.maritalStatus },
                { icon: 'fa-gamepad',         label: 'Hobbies',        val: user.hobbies },
                { icon: 'fa-map-marker-alt',  label: 'Location',       val: user.location },
                { icon: 'fa-envelope',        label: 'Email',          val: isMyProfile ? user.email : null },
                { icon: 'fa-phone',           label: 'Phone',          val: isMyProfile ? user.phone : null },
                { icon: 'fa-globe',           label: 'Website',        val: user.website }
            ].filter(function (r) { return r.val && String(r.val).trim(); });

            return rows.map(function (r, idx) {
                var v   = String(r.val).trim();
                var isLast = idx === rows.length - 1;
                var valHTML = r.label === 'Website'
                    ? '<a href="' + (v.startsWith('http') ? v : 'https://' + v) + '" target="_blank" rel="noopener" style="color:var(--secondary);text-decoration:none;">' + _esc(v) + '</a>'
                    : r.label === 'Email'
                    ? '<a href="mailto:' + _attr(v) + '" style="color:var(--secondary);text-decoration:none;">' + _esc(v) + '</a>'
                    : r.label === 'Phone'
                    ? '<a href="tel:' + _attr(v) + '" style="color:var(--secondary);text-decoration:none;">' + _esc(v) + '</a>'
                    : _esc(v);
                return '<div style="display:flex;align-items:center;gap:14px;padding:13px 16px;background:white;' + (!isLast ? 'border-bottom:1px solid rgba(10,14,39,0.06);' : '') + '">'
                    + '<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#0A0E27,#1B2B8B);display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
                    + '<i class="fas ' + r.icon + '" style="color:white;font-size:0.8rem;"></i></div>'
                    + '<div style="flex:1;min-width:0;">'
                    + '<div style="font-size:0.72rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">' + r.label + '</div>'
                    + '<div style="font-size:0.92rem;color:var(--text-primary);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + valHTML + '</div>'
                    + '</div></div>';
            }).join('');
        }

        var flwCount  = (user.followerCount  || 0).toLocaleString();
        /* FIX (2026-08-24 — "Following count always shows 0"): user.followingCount
           was never a real field — nothing in this codebase ever writes it to
           Firestore (the follow handler in app-fixes.js only ever persists
           followedUserIds itself). Every other place that needs a "following"
           number (app-patch-v23.js, app-patch-v32.js) already derives it from
           followedUserIds.length/size on the fly instead of trusting a phantom
           counter field — matched that same convention here. Handles both
           shapes: a live Set on userState (my own profile, in-session) and a
           plain array on a Firestore-fetched user doc (mockUsers copies, incl.
           of myself, are populated straight from doc.data()). */
        var _followedIds = user.followedUserIds;
        var _followingNum = Array.isArray(_followedIds) ? _followedIds.length
            : (_followedIds && typeof _followedIds.size === 'number') ? _followedIds.size
            : 0;
        var flwing    = _followingNum.toLocaleString();
        var isVerified = user.isVerified;

        /* ── Build profile HTML ── */
        profileSection.innerHTML =
            '<div class="header">'
            + (!isMyProfile
                ? '<button onclick="window._viewingOtherProfile=false;if(typeof window.renderUserProfile===\'function\'){window.renderUserProfile(window.userState.id);}else{if(typeof window.navigateTo===\'function\')window.navigateTo(\'profile\',true);}" '
                + 'style="background:none;border:none;cursor:pointer;color:var(--secondary);font-size:0.88rem;font-weight:600;padding:4px 0;display:flex;align-items:center;gap:5px;margin-bottom:6px;">'
                + '<i class="fas fa-arrow-left"></i> My Profile</button>'
                : '')
            + '<h1>' + (isMyProfile ? 'My Profile' : _esc(user.fullName) + "'s Profile") + '</h1>'
            + '</div>'

            + '<div class="card">'
            + '<div class="profile-header-container">'
            + '<div class="cover-photo-container" id="profile-cover-container" style="background-image:' + (user.coverPhoto ? 'url(\'' + _attr(user.coverPhoto) + '\')' : 'linear-gradient(135deg,#0A0E27 0%,#1B2B8B 55%,#5B0EA6 100%)') + ';">'
            + (isMyProfile
                ? '<label for="cover-photo-input" class="upload-overlay"><i class="fas fa-camera"></i> Change Cover</label>'
                + '<input type="file" id="cover-photo-input" accept="image/*" style="display:none;">'
                : '')
            + '</div>'
            + '<div class="profile-header">'
            /* Celebratory avatar frame (birthday feature — requested
               addition): a gradient ring + cake badge around the profile
               picture, shown only to visitors on the day this is someone
               else's birthday (isBirthdayToday, same flag the existing
               "Send a Gift" button below already gates on). Ring/badge CSS
               is injected once by _ensureBirthdayProfileCSS() below — see
               that function's own comment for why it matches the gradient
               already used on the dashboard's "Birthdays Today" chips
               (app-gifts.js SECTION 12) and the Birthday Wishes modal
               header, so the same visual language reads consistently
               everywhere a birthday is shown across the app. */
            + '<div class="profile-pic-container' + (isBirthdayToday ? ' emp-bday-avatar-frame' : '') + '">'
            + '<label for="profile-pic-input-main" class="avatar-placeholder"'
            + ' style="width:150px;height:150px;border-radius:50%;' + (!isMyProfile ? 'cursor:default;' : '') + '">'
            + (isMyProfile ? '<div class="upload-overlay"><i class="fas fa-camera fa-2x"></i></div>' : '')
            + '<img src="' + _attr(user.avatar || '') + '" id="profile-pic-img" class="profile-pic active" alt="Profile picture"></label>'
            + (isMyProfile ? '<input type="file" id="profile-pic-input-main" class="avatar-input" accept="image/*" style="display:none;">' : '')
            + (isBirthdayToday ? '<span class="emp-bday-avatar-cake" title="' + _esc(user.fullName || 'Their') + ' birthday today">🎂</span>' : '')
            + '</div>'
            + '<div class="profile-header-info" data-user-id="' + _attr(user.id) + '">'
            + '<h2 id="profile-display-name">' + _esc(user.fullName) + _profTickHTML(user, isMyProfile)
            + ' <span class="badge" style="display:' + (isVerified ? 'inline-flex' : 'none') + ';"><i class="fas fa-check"></i> Verified</span></h2>'
            + '<p id="profile-display-username">@' + _esc(user.username) + '</p>'
            + '<div class="profile-stats-row" style="display:flex;gap:20px;margin:6px 0;font-size:0.88rem;">'
            + '<span><strong id="profile-follower-count">' + flwCount + '</strong> <span style="color:var(--text-muted);">Followers</span></span>'
            + '<span><strong id="profile-following-count">' + flwing + '</strong> <span style="color:var(--text-muted);">Following</span></span>'
            + '</div>'
            + '<div class="profile-header-actions">'
            + (isMyProfile
                ? '<button class="btn btn-small nav-link" data-target="settings"><i class="fas fa-edit"></i> Edit Profile</button>'
                : '<button class="btn btn-small" id="profile-message-btn" data-message-user-id="' + _attr(user.id) + '"><i class="fas fa-envelope"></i> Message</button>')
            + '<button class="btn btn-small share-profile-btn"><svg style="vertical-align:-3px;margin-right:2px;" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share</button>'
            + (!isMyProfile ? '<button class="btn btn-small follow-btn" data-user-id="' + _attr(user.id) + '">Follow</button>' : '')
            /* FIX (2026-09-12 — "block or filter posts from selected contacts",
               WhatsApp-style content control): no per-contact Block existed
               anywhere in the app. Placed here, next to Follow/Message —
               same natural spot WhatsApp/Instagram put it. Toggles
               userState.blockedUserIds (plain array, see the field's own
               comment in app-fixes.js's default-user-state object) and
               persists it straight to this user's own Firestore doc — no
               new collection needed. Actual enforcement (hiding their
               posts/statuses once blocked) lives in app-fixes.js's posts
               and statuses onSnapshot listeners, which both already read
               this same field. */
            + (!isMyProfile ? '<button class="btn btn-small profile-block-btn" id="profile-block-btn" data-user-id="' + _attr(user.id) + '" style="color:var(--danger-color,#EF4444);">'
                + (( _us().blockedUserIds || []).indexOf(user.id) > -1 ? '<i class="fas fa-user-check"></i> Unblock' : '<i class="fas fa-user-slash"></i> Block') + '</button>' : '')
            + (isBirthdayToday
                ? '<button class="btn btn-small" id="profile-send-gift-btn" data-gift-user-id="' + _attr(user.id) + '" data-gift-user-name="' + _attr(user.fullName || 'them') + '" style="background:linear-gradient(135deg,#F5C518,#F08C1A);color:#1B2B8B;border:none;"><i class="fas fa-gift"></i> Send a Gift</button>'
                : '')
            + '</div></div></div>'

            /* KYC nudge banner — redesigned 2026-10-27: styled by .emp-kyc-banner in style.css
               (was inline styles). Same click behaviour (opens the KYC tab), same text. */
            + (isMyProfile && !us.isVerified
                ? '<div class="emp-kyc-banner" role="button" tabindex="0" '
                + 'onclick="var el=document.querySelector(\'[data-target=\\"profile-kyc-tab\\"]\');if(el)el.click();" '
                + 'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click();}">'
                + '<span class="emp-kyc-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg></span>'
                + '<span class="emp-kyc-tx"><strong>Complete KYC Verification</strong>'
                + '<span>To complete KYC, switch to desktop mode and click the button.</span></span>'
                + '<span class="emp-kyc-go"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></span></div>'
                : '')

            /* Birthday Messages section (birthday feature — requested
               "profile integration"): embedded directly on the profile,
               only on the day it's this user's birthday (isBirthdayToday —
               same flag the "Send a Gift" button above already gates on),
               so a visitor doesn't have to open the separate Birthday
               Wishes modal (app-gifts.js's openBirthdayWishesFeed) just to
               see what's already been said. Populated live by
               _mountProfileBirthdayFeed() at the bottom of this function —
               reads the SAME `birthday_feed` collection that modal, the
               dashboard chip tap, and every gift/wish/card write already
               share, so nothing here duplicates that data or logic. */
            + (isBirthdayToday
                ? '<div class="card" id="profile-birthday-section" style="margin:14px 16px 0;padding:14px 16px;'
                + 'border-radius:16px;background:linear-gradient(135deg,rgba(245,197,24,0.10),rgba(240,140,26,0.06));'
                + 'border:1px solid rgba(245,197,24,0.3);">'
                + '<h4 style="font-weight:800;color:#7a5a0a;font-size:0.9rem;margin-bottom:8px;">'
                + '<i class="fas fa-birthday-cake" style="margin-right:6px;"></i>Birthday Messages</h4>'
                + '<div id="profile-birthday-messages" style="display:flex;flex-direction:column;gap:8px;">'
                + '<div style="text-align:center;color:#99a;font-size:0.82rem;padding:8px 0;">Loading wishes…</div></div>'
                + '<button type="button" class="btn btn-small" id="profile-birthday-viewall-btn" data-gift-user-id="' + _attr(user.id) + '" '
                + 'data-gift-user-name="' + _attr(user.fullName || 'them') + '" data-gift-user-avatar="' + _attr(user.avatar || '') + '" '
                + 'style="margin-top:10px;width:100%;background:#fff;border:1px solid rgba(245,197,24,0.4);color:#7a5a0a;">'
                + '<i class="fas fa-comment-dots"></i> View All &amp; Send a Wish</button>'
                + '</div>'
                : '')

            /* Bio chips */
            + _buildBioChips()
            + '<div id="profile-suggested-row-slot"></div>'

            /* Profile tabs */
            + '<div class="profile-tabs" style="display:flex;overflow-x:auto;-webkit-overflow-scrolling:touch;'
            + 'scrollbar-width:none;white-space:nowrap;padding-bottom:2px;gap:0;margin-top:14px;">'
            + (isMyProfile ? '<div class="profile-tab active" data-target="profile-dashboard-tab" style="flex-shrink:0;"><i class="fas fa-tachometer-alt" style="margin-right:4px;"></i>Dashboard</div>' : '')
            + '<div class="profile-tab ' + (isMyProfile ? '' : 'active') + '" data-target="profile-posts-tab" style="flex-shrink:0;">Posts</div>'
            + '<div class="profile-tab" data-target="profile-main-content" style="flex-shrink:0;"><i class="fas fa-video" style="margin-right:4px;"></i>Videos</div>'
            + '<div class="profile-tab" data-target="profile-reels-tab" style="flex-shrink:0;"><i class="fas fa-film" style="margin-right:4px;"></i>Reels</div>'
            /* NEW — Pictures tab (report item #2: "create a sub column
               for picture collection ... same frame size expandable on
               clicking"), separate from the mixed Photos/Videos Gallery
               tab above so pictures alone get their own dedicated grid. */
            + '<div class="profile-tab" data-target="profile-pictures-tab" style="flex-shrink:0;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:6px;vertical-align:-3px"><rect x="3" y="4" width="18" height="16" rx="3.5"/><circle cx="9" cy="9.5" r="1.6" fill="#C9A66B" stroke="none"/><path d="M3.5 17l5-5 4 4 3-3 5 5"/></svg>Pictures</div>'
            + '<div class="profile-tab" data-target="profile-about-tab" style="flex-shrink:0;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:6px;vertical-align:-3px"><path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/></svg>About</div>'
            + (isMyProfile ? '<div class="profile-tab" data-target="profile-analytics" style="flex-shrink:0;"><i class="fas fa-chart-line" style="margin-right:4px;"></i>Analytics</div>' : '')
            + (isMyProfile ? '<div class="profile-tab" data-target="profile-monetization" style="flex-shrink:0;">Monetization</div>' : '')
            + (isMyProfile ? '<div class="profile-tab" data-target="profile-kyc-tab" style="flex-shrink:0;color:#5B0EA6;font-weight:700;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:6px;vertical-align:-3px"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>KYC</div>' : '')
            + '</div>'

            /* Tab contents */
            + '<div class="card-content">'

            /* Dashboard tab (own profile only) */
            + (isMyProfile
                ? '<div id="profile-dashboard-tab" class="profile-tab-content active">'
                + '<div style="position:relative;margin-bottom:20px;">'
                + '<button id="profile-create-toggle-btn" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;'
                + 'background:#fff;border:1px solid #D5DAF0;border-radius:16px;color:#0A0E39;font-size:1rem;font-weight:700;cursor:pointer;transition:all 0.2s;">'
                + '<span id="profile-create-icon" style="width:34px;height:34px;border-radius:50%;background:#fff;border:2px solid #1B2B8B;display:flex;align-items:center;justify-content:center;font-size:1.3rem;color:#1B2B8B;transition:transform 0.3s;">+</span>'
                + '<span>Share a Moment</span></button>'
                /* UPGRADE (2026-10-27 - profile post section): white composer card, 2-column tool grid (Add Media here;
                   Quote Card / Support Candidate / Social media are injected into it below - ids and handlers unchanged),
                   a social-share chip panel and a full-width Post button. Same element ids as before. */
                + '<div id="profile-create-panel" style="display:none;background:#fff;border:1px solid #E3E6F3;border-top:0;border-radius:0 0 18px 18px;padding:16px;color:#0A0E39;margin-top:-4px;">'
                + '<p style="font-size:0.8rem;color:#5A6385;margin:0 0 12px;">Photos &amp; videos appear instantly on your profile and dashboard feed</p>'
                + '<input type="text" id="profile-post-title" placeholder="Add a title (optional)" style="width:100%;background:#fff;border:1px solid #D5DAF0;border-radius:12px;padding:10px 12px;color:#0A0E39;font-size:0.92rem;outline:none;font-family:inherit;box-sizing:border-box;margin-bottom:10px;font-weight:600;">'
                + '<div id="profile-post-media-preview" style="margin-bottom:10px;border-radius:12px;overflow:hidden;"></div>'
                + '<textarea id="profile-post-text" rows="3" placeholder="What\'s on your mind?" style="width:100%;background:#fff;border:1px solid #D5DAF0;border-radius:12px;padding:10px 12px;color:#0A0E39;font-size:0.92rem;outline:none;font-family:inherit;box-sizing:border-box;margin-bottom:10px;resize:none;min-height:76px;"></textarea>'
                + '<div id="profile-post-tools" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:10px;">'
                + '<label for="profile-post-media-input" style="background:#F4F6FD;border:1px solid #D5DAF0;color:#1B2B8B;padding:0 12px;min-height:44px;border-radius:12px;cursor:pointer;font-size:0.85rem;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;width:100%;font-family:inherit;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 9"/></svg> Photo</label>'
                + '<label for="profile-post-video-input" style="background:#F4F6FD;border:1px solid #D5DAF0;color:#1B2B8B;padding:0 12px;min-height:44px;border-radius:12px;cursor:pointer;font-size:0.85rem;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;width:100%;font-family:inherit;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/></svg> Video</label>'
                + '<input type="file" id="profile-post-media-input" accept="image/*" multiple style="display:none;">'
                + '<input type="file" id="profile-post-video-input" accept="video/*" multiple style="display:none;">'
                + '</div>'
                /* UPGRADE (2026-10-27): the old "Also share this post to" chips were removed; the panel is now filled by window.EmpSocialBanner (WhatsApp/Telegram/Facebook/X/LinkedIn/YouTube contact banner). */
                + '<div id="profile-social-panel" style="display:none;margin-bottom:10px;"></div>'
                + '<button id="profile-post-submit-btn" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:52px;background:#1B2B8B;color:#fff;border:none;border-radius:14px;font-weight:700;cursor:pointer;font-size:0.95rem;font-family:inherit;">'
                + '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/></svg> <span id="profile-post-submit-label">Post</span></button></div></div>'
                /* REDESIGN (2026-10-26 — profile dashboard mockup): compact 3-up stats (same ids/handlers as before,
                   plus Following) and a Quick actions row that reuses the app's own nav-link routing. Styles: style.css
                   "PROFILE DASHBOARD REDESIGN". */
                + '<div class="emp-pd-label">Overview</div>'
                + '<div class="emp-pd-stats">'
                + '<div class="emp-pd-stat" style="cursor:pointer;" onclick="window.showFollowersModal()"><b id="profile-dash-followers">'
                + (us.followerCount || 0).toLocaleString() + '</b><span>Followers</span></div>'
                + '<div class="emp-pd-stat"><b id="profile-dash-following">' + flwing + '</b><span>Following</span></div>'
                + '<div class="emp-pd-stat is-empy"><b id="profile-dash-empy">'
                + (us.empyBalance || 0).toLocaleString() + '</b><span>EMPY Balance</span></div>'
                + '</div>'
                + '<div class="emp-pd-label">Quick actions</div>'
                + '<div class="emp-pd-quick">'
                + '<button type="button" class="emp-pd-q nav-link" data-target="go-live"><i><svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"6\" width=\"13\" height=\"12\" rx=\"2\"/><path d=\"M16 10l5-3v10l-5-3\"/></svg></i>Go live</button>'
                + '<button type="button" class="emp-pd-q nav-link" data-target="reels"><i><svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"3\"/><path d=\"M10 9l5 3-5 3z\"/></svg></i>Reels</button>'
                + '<button type="button" class="emp-pd-q nav-link" data-target="marketplace"><i><svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M6 8h12l-1 12H7L6 8z\"/><path d=\"M9 8V6a3 3 0 0 1 6 0v2\"/></svg></i>Sell</button>'
                + '<button type="button" class="emp-pd-q nav-link" data-target="my-wallet"><i><svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"7\" width=\"18\" height=\"12\" rx=\"2\"/><path d=\"M3 11h18\"/></svg></i>Wallet</button>'
                + '</div>'
                + '<div style="margin-bottom:20px;">'
                + '<h4 style="font-weight:700;color:var(--primary);margin-bottom:12px;"><i class="fas fa-broadcast-tower" style="color:var(--danger-color);margin-right:6px;"></i>Live Streams</h4>'
                + '<div class="horizontal-slider-container"><div class="horizontal-slider-wrapper" id="profile-dash-live-slider"></div></div></div>'
                + '<h4 style="font-weight:700;color:var(--primary);margin-bottom:12px;"><i class="fas fa-stream" style="color:var(--secondary);margin-right:6px;"></i>Your Feed</h4>'
                + '<div id="profile-dash-feed"></div></div>'
                : '')

            /* Posts tab */
            + '<div id="profile-posts-tab" class="profile-tab-content ' + (isMyProfile ? '' : 'active') + '">'
            + '<div id="profile-posts-feed" style="display:flex;flex-direction:column;gap:12px;"></div>'
            + '<div id="profile-posts-empty" style="text-align:center;padding:40px;color:var(--text-muted);">'
            + '<i class="fas fa-stream" style="font-size:2rem;display:block;margin-bottom:12px;"></i>'
            + '<p>No posts yet' + (isMyProfile ? ' — share a moment above!' : ' from this user.') + '</p></div></div>'

            /* Gallery tab */
            + '<div id="profile-main-content" class="profile-tab-content">'
            + '<h3 style="margin-bottom:16px;"><i class="fas fa-video" style="color:var(--secondary);margin-right:8px;"></i>Videos</h3>'
            + '<div id="profile-gallery"><p>No videos yet.</p></div></div>'

            /* Reels gallery tab — deliberately SEPARATE from the Photos/Videos
               Gallery tab above (see §9 populateProfileReelsGallery): reels are
               stored in their own Firestore "reels" collection, not mixed in
               with .impact-story posts, so they need their own dedicated
               thumbnail section rather than being folded into the media grid. */
            + '<div id="profile-reels-tab" class="profile-tab-content">'
            + '<h3 style="margin-bottom:16px;"><i class="fas fa-film" style="color:#5B0EA6;margin-right:8px;"></i>Reels</h3>'
            + '<div id="profile-reels-gallery"><p style="text-align:center;color:var(--text-muted);padding:32px 0;font-size:0.9rem;">No reels yet.</p></div></div>'

            /* Pictures gallery tab — images only, split out of the mixed
               Photos/Videos Gallery tab above per this session's request
               (report item #2). Same square frame as the Reels tab, same
               click-to-expand lightbox as the mixed Gallery tab. */
            + '<div id="profile-pictures-tab" class="profile-tab-content">'
            + '<h3 style="margin-bottom:16px;"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:10px;vertical-align:-5px;color:var(--secondary)"><rect x="3" y="4" width="18" height="16" rx="3.5"/><circle cx="9" cy="9.5" r="1.6" fill="#C9A66B" stroke="none"/><path d="M3.5 17l5-5 4 4 3-3 5 5"/></svg>Pictures</h3>'
            + '<div id="profile-pictures-gallery"><p style="text-align:center;color:var(--text-muted);padding:32px 0;font-size:0.9rem;">No pictures yet.</p></div></div>'

            /* About tab */
            + '<div id="profile-about-tab" class="profile-tab-content">'
            + '<h3 style="margin-bottom:18px;"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:10px;vertical-align:-5px;color:var(--secondary)"><path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/></svg>About '
            + (isMyProfile ? 'Me' : _esc(user.fullName)) + '</h3>'
            + (user.bio ? '<div style="background:linear-gradient(135deg,rgba(10,14,39,0.04),rgba(27,43,139,0.06));border-radius:14px;padding:14px 16px;margin-bottom:16px;border-left:3px solid var(--secondary);">'
                + '<p style="color:var(--text-muted);font-size:0.82rem;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Bio</p>'
                + '<p style="color:var(--text-primary);line-height:1.6;">' + _esc(user.bio) + '</p></div>' : '')
            + '<div style="display:flex;flex-direction:column;gap:0;border:1.5px solid rgba(10,14,39,0.08);border-radius:16px;overflow:hidden;">'
            + _buildAboutRows() + '</div>'
            + (isMyProfile ? '<div style="margin-top:16px;text-align:center;"><button class="btn btn-small nav-link" data-target="settings" style="font-size:0.82rem;opacity:0.75;"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:6px;vertical-align:-3px"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg> Edit your info in Settings</button></div>' : '')
            + '</div>'

            /* Monetization tab placeholder (filled by renderMonetizationTab) */
            + (isMyProfile ? '<div id="profile-analytics" class="profile-tab-content"></div>' : '')
            + (isMyProfile ? '<div id="profile-monetization" class="profile-tab-content"></div>' : '')
            + '</div></div>'

            /* KYC tab (outside card-content, own profile only) */
            + (isMyProfile ? '<div id="profile-kyc-tab" class="profile-tab-content" style="display:none;">' + kycFormHTML + '</div>' : '');

        /* ── Post-render wiring ── */
        if (isMyProfile) {
            (typeof window.renderMonetizationTab === 'function' ? window.renderMonetizationTab : renderMonetizationTab)();
            if (typeof window.populateDobSelectors === 'function') window.populateDobSelectors();

            setTimeout(function () {
                /* Create-panel toggle */
                var toggleBtn = document.getElementById('profile-create-toggle-btn');
                var panel     = document.getElementById('profile-create-panel');
                var iconEl    = document.getElementById('profile-create-icon');
                if (toggleBtn && panel && iconEl) {
                    toggleBtn.addEventListener('click', function () {
                        var open = panel.style.display !== 'none';
                        panel.style.display    = open ? 'none' : 'block';
                        iconEl.style.transform = open ? 'rotate(0deg)' : 'rotate(45deg)';
                        iconEl.textContent     = open ? '+' : '×';
                    });
                }

                /* FIX (2026-10-07 — profile composer posted TWICE, first copy distorted
                   with a "+3" tile and no engagement buttons): app-live.js's older
                   PART 4 "profile page post upload" also listens, at document level, on
                   this same #profile-post-media-input / #profile-post-submit-btn, so
                   every tap ran two uploads and published two posts. This composer is
                   the real one; flag it so app-live.js's legacy handlers stand down. */
                window._empProfileComposerOwnsPost = true;

                /* Profile post media preview */
                var profileMediaFiles = [];
                var pMediaInput  = document.getElementById('profile-post-media-input');
                var pPreview     = document.getElementById('profile-post-media-preview');

                // FEATURE (Quote/Meme Card): pulled the preview-render loop out of the
                // input's own 'change' handler into a named function so a card image
                // generated by the Quote Card composer (below) can be pushed straight
                // into profileMediaFiles and rendered the same way an uploaded photo
                // would be, without needing to fake a 'change' event on the input.
                function renderProfileMediaPreview() {
                    if (!pPreview) return;
                    pPreview.innerHTML = '';
                    profileMediaFiles.forEach(function (f, idx) {
                        var url   = URL.createObjectURL(f);
                        var isVid = f.type.startsWith('video/');
                        var wrap  = document.createElement('div');
                        wrap.style.cssText = 'position:relative;display:inline-block;margin:4px;';
                        wrap.innerHTML = isVid
                            ? '<video src="' + url + '" muted playsinline style="width:80px;height:80px;object-fit:cover;border-radius:8px;"></video>'
                            : '<img src="' + url + '" style="width:80px;height:80px;object-fit:cover;border-radius:8px;">';
                        var rmBtn = document.createElement('button');
                        rmBtn.type = 'button'; rmBtn.textContent = '×';
                        rmBtn.style.cssText = 'position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.6);color:white;border:none;border-radius:50%;width:18px;height:18px;font-size:0.8rem;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;';
                        rmBtn.onclick = function () {
                            profileMediaFiles.splice(idx, 1);
                            renderProfileMediaPreview();
                        };
                        wrap.appendChild(rmBtn);
                        pPreview.appendChild(wrap);
                    });
                }

                /* Quick Post parity: separate Photo and Video pickers, both feeding the same list. */
                [pMediaInput, document.getElementById('profile-post-video-input')].forEach(function (inp) {
                    if (!inp) return;
                    inp.addEventListener('change', function () {
                        profileMediaFiles = profileMediaFiles.concat(Array.from(this.files)).slice(0, 10);
                        this.value = '';
                        renderProfileMediaPreview();
                    });
                });

                /* FEATURE — Quote/Meme Card: reuses the exact same drawing/composer
                   engine window.EmpQuoteCard (defined in app-fixes.js, next to the
                   Quick Post modal's own wiring) instead of a second copy of it here.
                   app-profile.js loads BEFORE app-fixes.js in index.html, but this
                   only runs at click-time — by then app-fixes.js has long since
                   defined window.EmpQuoteCard, so the guard below just protects
                   against the rare case this panel gets re-rendered before that. */
                (function () {
                    if (!pMediaInput || !pMediaInput.parentElement) return;
                    var qcBtn = document.createElement('button');
                    qcBtn.type = 'button';
                    qcBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 7H6a2 2 0 0 0-2 2v4h5v4H4M20 7h-4a2 2 0 0 0-2 2v4h5v4h-5"/></svg> Quote Card';
                    qcBtn.style.cssText = 'background:#F4F6FD;border:1px solid #D5DAF0;color:#1B2B8B;padding:0 12px;min-height:44px;border-radius:12px;cursor:pointer;font-size:0.85rem;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;width:100%;font-family:inherit;';
                    qcBtn.addEventListener('click', function () {
                        if (!window.EmpQuoteCard) {
                            if (typeof showNotification === 'function') showNotification('Quote Card composer isn\u2019t ready yet — try again in a moment.', 'warning');
                            return;
                        }
                        window.EmpQuoteCard.open(function (file, quoteText) {
                            profileMediaFiles = profileMediaFiles.concat([file]).slice(0, 10);
                            renderProfileMediaPreview();
                            var textEl = document.getElementById('profile-post-text');
                            if (textEl && !textEl.value.trim()) textEl.value = quoteText;
                        });
                    });
                    pMediaInput.parentElement.insertBefore(qcBtn, pMediaInput.nextSibling);
                    /* Meme: same EmpQuoteCard tool as Quote Card, exactly like Quick Post's Meme button. */
                    var memeBtn = qcBtn.cloneNode(false);
                    memeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M7 15c1.5 2 3.5 2 5 2s3.5 0 5-2"/></svg> Meme';
                    memeBtn.addEventListener('click', function () { qcBtn.click(); });
                    qcBtn.parentElement.insertBefore(memeBtn, qcBtn.nextSibling);

                    /* FEATURE (2026-09-22 — "In the profile page dashboard upload
                       column also add the support your Presidential candidate
                       icon"): mirrors app-fixes.js's Quick Post "Support Candidate"
                       button one-for-one — same public hook
                       (window._empOpenElectionModal, exposed by app-patch-v49-v50.js),
                       same "next to Quote Card" placement, just this composer's own
                       (white/translucent) button styling instead of Quick Post's.
                       Inserted right after the Quote Card button above so the row
                       reads Add Media -> Quote Card -> Support Candidate -> Post. */
                    var elBtn = document.createElement('button');
                    elBtn.type = 'button';
                    elBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/></svg> Support Candidate';
                    elBtn.title = 'Upload a photo and support your Presidential candidate';
                    elBtn.style.cssText = 'background:#F4F6FD;border:1px solid #D5DAF0;color:#1B2B8B;padding:0 12px;min-height:44px;border-radius:12px;cursor:pointer;font-size:0.85rem;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;width:100%;font-family:inherit;';
                    elBtn.addEventListener('click', function () {
                        /* FIX (2026-09-22 — same bug report as app-fixes.js's Quick
                           Post "Support Candidate" button, now sharing that file's
                           window._empEnsureElectionModal helper instead of its own copy
                           of the plain-poll logic: a bare typeof check / short poll
                           alone can't tell "still parsing" apart from "stuck on a stale
                           cached app-patch-v49-v50.js that predates this hook" — see
                           app-fixes.js's helper for the fuller write-up. Falls back to
                           the old local poll only in the unlikely case app-fixes.js
                           hasn't defined the shared helper yet by click-time. */
                        if (typeof window._empEnsureElectionModal === 'function') {
                            window._empEnsureElectionModal(function () {
                                window._empOpenElectionModal();
                            }, function () {
                                if (typeof window.showNotification === 'function') {
                                    window.showNotification('Election hub isn\u2019t available right now.', 'warning');
                                }
                            });
                            return;
                        }
                        if (typeof window._empOpenElectionModal === 'function') {
                            window._empOpenElectionModal();
                            return;
                        }
                        var elWaited = 0;
                        var elPoll = setInterval(function () {
                            elWaited += 150;
                            if (typeof window._empOpenElectionModal === 'function') {
                                clearInterval(elPoll);
                                window._empOpenElectionModal();
                            } else if (elWaited >= 3000) {
                                clearInterval(elPoll);
                                if (typeof window.showNotification === 'function') {
                                    window.showNotification('Election hub isn\u2019t available right now.', 'warning');
                                }
                            }
                        }, 150);
                    });
                    memeBtn.parentElement.insertBefore(elBtn, memeBtn.nextSibling);

                    /* FEATURE (2026-10-27 - "add the social media button"): toggles a chip panel; chips picked here are
                       shared AFTER the post is published (see the submit handler) via a tap-to-open share sheet, because
                       browsers block links opened after an async upload unless the person taps them. */
                    var socBtn = document.createElement('button');
                    socBtn.type = 'button';
                    socBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/></svg> Social media';
                    socBtn.style.cssText = 'background:#F4F6FD;border:1px solid #D5DAF0;color:#1B2B8B;padding:0 12px;min-height:44px;border-radius:12px;cursor:pointer;font-size:0.85rem;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;width:100%;font-family:inherit;background:#1B2B8B;border-color:#1B2B8B;color:#fff;';
                    elBtn.parentElement.insertBefore(socBtn, elBtn.nextSibling);
                    var socPanel = document.getElementById('profile-social-panel');
                    window._empProfSocialCtl = (window.EmpSocialBanner && socPanel) ? window.EmpSocialBanner.attach(socPanel) : null;
                    socBtn.addEventListener('click', function () {
                        if (socPanel) socPanel.style.display = (socPanel.style.display === 'none' || !socPanel.style.display) ? 'block' : 'none';
                    });
                })();

                /* Profile post submit — clone-replace to prevent double-binding */
                var submitBtn = document.getElementById('profile-post-submit-btn');
                if (submitBtn) {
                    var fresh = submitBtn.cloneNode(true);
                    submitBtn.parentNode.replaceChild(fresh, submitBtn);
                    fresh.addEventListener('click', async function () {
                        var textEl  = document.getElementById('profile-post-text');
                        var titleEl = document.getElementById('profile-post-title');
                        var text    = textEl  ? textEl.value.trim()  : '';
                        var title   = titleEl ? titleEl.value.trim() : '';
                        var _sbCtl = window._empProfSocialCtl;
                        var _sb = _sbCtl ? _sbCtl.get() : null;   /* social banner: null = none, false = invalid (message shown) */
                        if (_sb === false) return;
                        if (!text && profileMediaFiles.length === 0 && !_sb) {
                            if (typeof window.showNotification === 'function') window.showNotification('Please add text or media before posting.', 'error');
                            return;
                        }
                        fresh.disabled = true;
                        if (profileMediaFiles.length > 0 && typeof window.showNotification === 'function') {
                            window.showNotification('Uploading media to cloud…', 'info');
                        }
                        // ADDED (2026-08-10 — upload progress tracker)
                        var _profPostBar = (typeof window.empUploadProgress === 'object')
                            ? window.empUploadProgress.attach(pPreview || fresh.parentElement, profileMediaFiles.length > 1 ? 'Media' : 'Upload')
                            : { update: function () {}, done: function () {}, fail: function () {} };
                        try {
                            var _profTotal = profileMediaFiles.length;
                            var cloudUrls = await window.uploadMediaFilesToCloudinary(profileMediaFiles, function (idx, pct) {
                                if (!_profTotal) return;
                                var overall = Math.round(((idx + (pct / 100)) / _profTotal) * 100);
                                _profPostBar.update(overall, _profTotal > 1 ? ('File ' + (idx + 1) + '/' + _profTotal) : null);
                            });
                            if (_profTotal) _profPostBar.done();
                            var fullText  = title ? (title + (text ? '\n' + text : '')) : text;
                            if (!fullText && _sb) fullText = _sb.headline;
                            var mediaObjs = cloudUrls.filter(Boolean).map(function (u, i) {
                                var f = profileMediaFiles[i];
                                return { _cloudUrl: u, url: u, type: f ? f.type : 'image/jpeg' };
                            });

                            if (typeof window.createNewPostElement === 'function') {
                                var postEl = window.createNewPostElement(fullText, mediaObjs, { id: us.id, fullName: us.fullName, avatar: us.avatar });

                                /* Persist to Firestore */
                                var postData = {
                                    id:        postEl.dataset.postId,
                                    text:      fullText,
                                    media:     cloudUrls.filter(Boolean),
                                    userId:    us.id,
                                    username:  us.fullName || us.username || 'User',
                                    avatar:    us.avatar   || '',
                                    likes:     0, comments: 0, views: 0,
                                    createdAt: new Date().toISOString(),
                                    // FEATURE (this session — quote/meme thumbnail strip): see
                                    // app-fixes.js's matching Quick Post postDoc field for the
                                    // full explanation. profileMediaFiles carries the same
                                    // isQuoteCard tag when this post's media came from the
                                    // Quote Card button above.
                                    //
                                    // FIX (this session — quote/meme strip permanently empty):
                                    // same root cause as app-fixes.js's matching Quick Post fix
                                    // — this used to tag isQuoteCard:true purely from the
                                    // ORIGINAL profileMediaFiles array, regardless of whether
                                    // the Cloudinary upload a few lines up actually succeeded
                                    // for that file. A failed upload (weak connection —
                                    // uploadMediaFilesToCloudinary resolves '' for it instead of
                                    // throwing) still produced isQuoteCard:true + media:[], which
                                    // is invisible everywhere (skipped in the normal feed,
                                    // filtered out of the strip for having no image) — a
                                    // permanent ghost post. Requiring at least one real uploaded
                                    // URL means a post can only be tagged isQuoteCard:true when
                                    // it actually has an image to show for it.
                                    isQuoteCard: cloudUrls.filter(Boolean).length > 0 && profileMediaFiles.some(function (f) { return !!f.isQuoteCard; })
                                };
                                if (window.fbDb && window._firebaseLoaded) {
                                    if (_sb) { postData.hasSocialBanner = true; postData.socialBanner = _sb; }
                                    window.fbDb.collection('posts').doc(postData.id).set(postData).then(function () { if (_sb && window.EmpSocialBanner) window.EmpSocialBanner.refresh(); }).catch(function () {});
                                }

                                /* Process tags */
                                if (typeof window._processPostTags === 'function') {
                                    window._processPostTags(fullText, us.fullName || 'User');
                                }

                                /* Reward */
                                if (typeof window.rewardUserForAction === 'function') {
                                    window.rewardUserForAction(profileMediaFiles.length > 0 ? 'CREATE_REEL' : 'CREATE_POST');
                                }

                                if (typeof window.showNotification === 'function') {
                                    window.showNotification('Post published.', 'success');
                                }

                                /* Social media banner: clear the panel after a successful post (share-sheet chips were removed). */
                                try { if (_sbCtl) _sbCtl.reset(); } catch (eShare) {}
                            }

                            /* Reset form */
                            if (textEl)  textEl.value  = '';
                            if (titleEl) titleEl.value = '';
                            profileMediaFiles = [];
                            if (pPreview) pPreview.innerHTML = '';
                            if (panel) panel.style.display = 'none';
                            if (iconEl) { iconEl.style.transform = 'rotate(0deg)'; iconEl.textContent = '+'; }
                        } catch (e) {
                            _profPostBar.fail('Failed');
                            if (typeof window.showNotification === 'function') window.showNotification('Post failed. Please try again.', 'error');
                        }
                        fresh.disabled = false;
                    });
                }
            }, 200);
        }

        /* Populate gallery from existing DOM posts */
        setTimeout(function () { populateProfileGallery(userId); }, 300);
        /* Pictures tab (images only, split out of the mixed gallery above
           per this session's request) — same scrape source, same timing. */
        setTimeout(function () { populateProfilePicturesGallery(userId); }, 300);
        setTimeout(function () { _hydrateSuggestedRow(userId); }, 350);

        /* Owner reel gallery (separate "Reels" tab) + reel strip embedded
           mid-feed on the Posts tab — see §9. Scheduled the same way the
           photo/video gallery above already is (a short delay so the rest
           of the profile DOM this depends on — #profile-reels-gallery,
           #profile-posts-feed — has actually been attached first).

           FIX (2026-08-10): this render's own token is captured now and
           checked when the timeout actually fires — see
           _profileReelStripToken's comment above for why. If another
           renderUserProfile() call happens in the meantime, this timeout
           becomes a no-op instead of mounting a duplicate strip into that
           newer render's DOM. */
        var _reelStripMyToken = ++_profileReelStripToken;
        setTimeout(function () { populateProfileReelsGallery(userId); }, 320);
        setTimeout(function () {
            if (_reelStripMyToken !== _profileReelStripToken) return; /* superseded by a later renderUserProfile() call */
            _mountProfileFeedReelStrip(userId);
        }, 500);

        /* FEATURE (this session — "quote and meme avatar thumbnail card...
           horizontally swipeable, middle of... the individual profile page
           dashboard"): same mid-feed swipeable-strip treatment as the reel
           strip just above, own token so an overlapping renderUserProfile()
           call can't mount a stray duplicate of THIS strip either. See §9b
           below for _mountProfileFeedQuoteMemeStrip. */
        var _quoteMemeStripMyToken = ++_profileQuoteMemeStripToken;
        setTimeout(function () {
            if (_quoteMemeStripMyToken !== _profileQuoteMemeStripToken) return;
            _mountProfileFeedQuoteMemeStrip(userId);
        }, 560);

        /* Birthday Messages section (embedded #profile-birthday-messages
           above) — only mounted when the section itself was actually
           rendered (isBirthdayToday). Same short-delay + staleness-token
           pattern as the reel strip above, since this also depends on DOM
           this same innerHTML write just created. */
        if (isBirthdayToday) {
            var _bdayMyToken = ++_profileBirthdayToken;
            setTimeout(function () {
                if (_bdayMyToken !== _profileBirthdayToken) return; /* superseded by a later renderUserProfile() call */
                _mountProfileBirthdayFeed(userId);
            }, 300);
        }

        /* FIX (2026-10-28 — "followers don't stick"): after every profile render, recount who really
           follows this person (window._empRefreshFollowerCount, app-fix-final.js) and refresh the
           header counters, instead of trusting the cached followerCount number. */
        try { if (typeof window._empRefreshFollowerCount === 'function') setTimeout(function () { window._empRefreshFollowerCount(userId); }, 250); } catch (_rfe) { }
    }
    window.renderUserProfile = renderUserProfile;


    /* =========================================================================
       §2  renderMonetizationTab
       ========================================================================= */

    function renderMonetizationTab() {
        var container = document.getElementById('profile-monetization');
        if (!container) return;
        var us         = _us();
        var isEligible = us.isVerified && (us.followerCount || 0) >= 500;
        var empyBal    = (us.empyBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        var empyRate   = (_S().EMPY_RATE_USD) || window.EMPY_RATE_USD || 0.10;

        if (isEligible) {
            container.innerHTML =
                '<h3><i class="fas fa-dollar-sign"></i> Your Monetization</h3>'
                + '<div class="wallet-card">'
                + '<p>Available for Withdrawal</p>'
                + '<h3 class="empy-balance"><i class="fa-solid fa-coins"></i> ' + empyBal + '</h3>'
                + '<p>~ ' + (typeof window.formatUsdPrice === 'function' ? window.formatUsdPrice((us.empyBalance || 0) * empyRate) : '') + '</p>'
                + '<button class="btn btn-accent nav-link" data-target="my-wallet"><i class="fas fa-exchange-alt"></i> Go to Wallet</button>'
                + '</div>';
        } else {
            var nextRank = RANKS.find(function (r) { return r.followers > (us.followerCount || 0); });
            var nextInfo = nextRank
                ? '<p>Next Rank: <strong>' + nextRank.name + '</strong> (' + (us.followerCount || 0).toLocaleString() + ' / ' + nextRank.followers.toLocaleString() + ' followers) for a <strong>' + nextRank.reward + ' EMPY</strong> reward.</p>'
                : '';
            var reasons = '<ul>';
            reasons += !us.isVerified
                ? '<li><i class="fas fa-times-circle" style="color:var(--danger-color)"></i> Complete KYC verification. <a href="#" class="nav-link" data-target="profile">Verify Now</a></li>'
                : '<li><i class="fas fa-check-circle" style="color:var(--success-color)"></i> KYC Verified</li>';
            reasons += (us.followerCount || 0) < 500
                ? '<li><i class="fas fa-times-circle" style="color:var(--danger-color)"></i> Reach 500 followers (Current: ' + (us.followerCount || 0) + ')</li>'
                : '<li><i class="fas fa-check-circle" style="color:var(--success-color)"></i> 500+ Followers</li>';
            reasons += '</ul>';

            container.innerHTML =
                '<h3><i class="fas fa-lock"></i> Monetization Locked</h3>'
                + '<div class="form-feedback info" style="display:block;text-align:left;">'
                + '<p>To unlock monetization features like withdrawals and direct payments, please meet the following criteria:</p>'
                + reasons + nextInfo + '</div>';
        }
    }
    /* =========================================================================
       §2b  CREATOR ANALYTICS (2026-11-06 — Facebook-style standard)
       Adds the Analytics tab from the "Creator analytics" mockup (the Monetization tab itself is
       rendered by app-monetization.js, which overrides window.renderMonetizationTab). Numbers come from the user's own
       docs only (users profile fields + their `posts`); anything the app does not
       record yet (audience location, per-source earnings) shows an honest empty
       state instead of invented figures. The withdrawal gate is UNCHANGED
       (KYC verified + 500 followers); the other bars are informational quality targets.
       ========================================================================= */
    var _cmRange = 7, _cmCache = null, _cmCacheUid = null, _cmCacheAt = 0;

    (function injectCreatorCSS() {
        if (document.getElementById('emp-creator-css')) return;
        var s = document.createElement('style');
        s.id = 'emp-creator-css';
        s.textContent =
            '.cm-wrap{display:flex;flex-direction:column;gap:12px;font-family:inherit;}' +
            '.cm-head{display:flex;justify-content:space-between;align-items:center;gap:8px;}' +
            '.cm-head h3{margin:0;font-size:1.25rem;font-weight:800;color:#0A0E27;}' +
            '.cm-chips{display:flex;gap:4px;flex-wrap:wrap;}' +
            '.cm-chip{border:0;border-radius:999px;padding:7px 14px;min-height:36px;font-weight:700;font-size:.78rem;background:transparent;color:#5B6272;cursor:pointer;}' +
            '.cm-chip.on{background:#1B2B8B;color:#fff;}' +
            '.cm-btn{border:1.5px solid #D5DAEA;background:#fff;color:#1B2B8B;border-radius:10px;padding:8px 12px;min-height:36px;font-weight:700;font-size:.78rem;cursor:pointer;}' +
            '.cm-card{background:#fff;border-radius:16px;padding:14px;box-shadow:0 1px 3px rgba(10,14,39,.08);}' +
            '.cm-card h4{margin:0;font-size:.85rem;font-weight:800;color:#0A0E27;}' +
            '.cm-sub{font-size:.72rem;color:#5B6272;margin-top:2px;}' +
            '.cm-hero{border-radius:20px;padding:18px;color:#fff;background:linear-gradient(135deg,#0A0E27,#1B2B8B);}' +
            '.cm-hero .big{font-size:2.1rem;font-weight:800;margin:4px 0 14px;}' +
            '.cm-hero .row{display:flex;justify-content:space-between;gap:10px;font-size:.78rem;}' +
            '.cm-hero .row b{display:block;font-size:1rem;margin-top:2px;}' +
            '.cm-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}' +
            '.cm-k{font-size:.7rem;font-weight:600;color:#5B6272;}.cm-v{font-size:1.3rem;font-weight:800;color:#0A0E27;margin-top:3px;}' +
            '.cm-d{font-size:.7rem;font-weight:700;}.cm-d.up{color:#0B6B43;}.cm-d.dn{color:#B42318;}.cm-d.fl{color:#5B6272;}' +
            '.cm-bar{padding:7px 0;}.cm-bar .l{display:flex;justify-content:space-between;gap:8px;font-size:.78rem;font-weight:600;}' +
            '.cm-bar .l span:last-child{color:#1B2B8B;font-weight:700;}' +
            '.cm-bar .t{height:6px;border-radius:6px;background:#E8ECF6;margin-top:6px;overflow:hidden;}' +
            '.cm-bar .t i{display:block;height:100%;border-radius:6px;background:#1B2B8B;}' +
            '.cm-bars{display:flex;align-items:flex-end;gap:6px;height:96px;margin-top:10px;}' +
            '.cm-bars div{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0;}' +
            '.cm-bars i{display:block;width:100%;max-width:28px;border-radius:5px 5px 2px 2px;background:#5B67B8;min-height:2px;}' +
            '.cm-bars i.today{background:#1B2B8B;}.cm-bars span{font-size:.58rem;color:#5B6272;margin-top:4px;white-space:nowrap;}' +
            '.cm-row{display:flex;justify-content:space-between;gap:10px;font-size:.78rem;font-weight:600;padding:9px 0;border-top:1px solid #E8ECF6;}' +
            '.cm-empty{font-size:.78rem;color:#5B6272;padding:8px 0;}' +
            '.cm-cta{width:100%;border:0;border-radius:12px;min-height:44px;background:#F5C518;color:#0A0E27;font-weight:800;font-size:.85rem;cursor:pointer;margin-top:8px;}' +
            '.cm-tag{font-size:.62rem;font-weight:800;border-radius:6px;padding:2px 6px;margin-left:6px;background:#E8ECF6;color:#1B2B8B;}' +
            '.cm-ok{color:#0B6B43;font-weight:700;font-size:.78rem;}.cm-bad{color:#B42318;font-weight:700;font-size:.78rem;}';
        document.head.appendChild(s);
    })();

    function _cmN(n) { n = Math.round(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : n.toLocaleString(); }
    function _cmTs(d) {
        var c = d.createdAt || d.timestamp || d.time; if (!c) return 0;
        if (typeof c.toMillis === 'function') return c.toMillis();
        if (c.seconds) return c.seconds * 1000;
        var t = new Date(c).getTime(); return isNaN(t) ? 0 : t;
    }
    function _cmCount(v) { return Array.isArray(v) ? v.length : (typeof v === 'number' ? v : 0); }
    function _cmPost(d, id) {
        return { id: id, ts: _cmTs(d), views: _cmCount(d.views != null ? d.views : d.viewCount),
            inter: _cmCount(d.likes) + _cmCount(d.commentCount != null ? d.commentCount : d.comments) + _cmCount(d.shareCount != null ? d.shareCount : d.shares),
            title: String(d.text || d.caption || d.title || (d.isReel ? 'Reel' : 'Post')).replace(/\s+/g, ' ').slice(0, 48),
            kind: d.isReel ? 'Reel' : (d.isQuoteCard ? 'Card' : 'Post') };
    }
    function _cmLoad(cb) {
        var u = _us(), uid = u.id;
        if (!uid || !window.fbDb || !window._firebaseLoaded) { cb(null, 'offline'); return; }
        if (_cmCache && _cmCacheUid === uid && Date.now() - _cmCacheAt < 60000) { cb(_cmCache); return; }
        var done = false, t = setTimeout(function () { if (!done) { done = true; cb(null, 'timeout'); } }, 12000);
        window.fbDb.collection('posts').where('userId', '==', uid).limit(300).get().then(function (snap) {
            if (done) return; done = true; clearTimeout(t);
            var list = []; snap.forEach(function (doc) { list.push(_cmPost(doc.data() || {}, doc.id)); });
            _cmCache = list; _cmCacheUid = uid; _cmCacheAt = Date.now(); cb(list);
        }).catch(function (e) { if (done) return; done = true; clearTimeout(t); cb(null, (e && e.code) || 'error'); });
    }
    function _cmSum(list, from, to) {
        var o = { posts: 0, views: 0, inter: 0 };
        list.forEach(function (p) { if (p.ts >= from && p.ts < to) { o.posts++; o.views += p.views; o.inter += p.inter; } });
        return o;
    }
    function _cmDelta(cur, prev) {
        if (!prev) return cur ? '<span class="cm-d up">New</span>' : '<span class="cm-d fl">—</span>';
        var p = Math.round((cur - prev) / prev * 100);
        return '<span class="cm-d ' + (p > 0 ? 'up' : p < 0 ? 'dn' : 'fl') + '">' + (p > 0 ? '+' : '') + p + '% vs previous</span>';
    }
    function _cmBar(label, val, pct) {
        return '<div class="cm-bar"><div class="l"><span>' + label + '</span><span>' + val + '</span></div><div class="t"><i style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div></div>';
    }
    function _cmErr(code) {
        return '<div class="cm-empty">' + (code === 'permission-denied' ? 'Your posts could not be read (permission denied).' : 'Could not load your post data (' + _esc(code || 'offline') + '). Check your connection and reopen this tab.') + '</div>';
    }

    function renderCreatorAnalyticsTab() {
        /* 2026-11-07: the Analytics tab is now drawn by app-analytics-charts.js (cache-first post read,
           retry, self-healing mount, mockup layout). This legacy body stays only as a fallback if
           that file failed to load; it is never reached when the new renderer is present. */
        if (typeof window._empRenderCreatorAnalytics === 'function') { window._empRenderCreatorAnalytics(); return; }
        var box = document.getElementById('profile-analytics'); if (!box) return;
        var us = _us();
        box.innerHTML = '<div class="cm-wrap"><div class="cm-empty"><i class="fas fa-spinner fa-spin"></i> Loading analytics…</div></div>';
        _cmLoad(function (list, err) {
            box = document.getElementById('profile-analytics'); if (!box) return;
            if (!list) { box.innerHTML = '<div class="cm-wrap">' + _cmErr(err) + '</div>'; return; }
            var DAY = 86400000, now = Date.now(), n = _cmRange;
            var from = now - n * DAY, cur = _cmSum(list, from, now + 1), prev = _cmSum(list, from - n * DAY, from);
            var maxV = 1, days = [];
            for (var i = n - 1; i >= 0; i--) {
                var d0 = new Date(now - i * DAY); d0.setHours(0, 0, 0, 0);
                var a = d0.getTime(), v = _cmSum(list, a, a + DAY).views;
                days.push({ v: v, l: n <= 7 ? d0.toLocaleDateString(undefined, { weekday: 'short' }) : (i % Math.ceil(n / 7) === 0 ? (d0.getMonth() + 1) + '/' + d0.getDate() : ''), t: i === 0 });
                if (v > maxV) maxV = v;
            }
            var bars = days.map(function (d) { return '<div><i class="' + (d.t ? 'today' : '') + '" style="height:' + Math.max(2, Math.round(d.v / maxV * 76)) + 'px" title="' + d.v + ' views"></i><span>' + d.l + '</span></div>'; }).join('');
            var top = list.slice().sort(function (a, b) { return b.views - a.views; }).filter(function (p) { return p.views > 0; }).slice(0, 5);
            var fol = us.followerCount || 0;
            var chips = [7, 14, 28].map(function (r) { return '<button class="cm-chip ' + (r === n ? 'on' : '') + '" data-cm-range="' + r + '">' + r + ' days</button>'; }).join('');
            box.innerHTML = '<div class="cm-wrap">'
                + '<div class="cm-head"><h3>Analytics</h3><button class="cm-btn" data-cm-csv="1"><i class="fas fa-download"></i> Export CSV</button></div>'
                + '<div class="cm-chips">' + chips + '</div>'
                + '<div class="cm-card"><div class="cm-k">Views</div><div class="cm-v" style="font-size:1.9rem;">' + _cmN(cur.views) + ' ' + _cmDelta(cur.views, prev.views) + '</div><div class="cm-bars">' + bars + '</div><div class="cm-sub">Views counted on the day each post was published.</div></div>'
                + '<div class="cm-grid">'
                + '<div class="cm-card"><div class="cm-k">Interactions</div><div class="cm-v">' + _cmN(cur.inter) + '</div>' + _cmDelta(cur.inter, prev.inter) + '</div>'
                + '<div class="cm-card"><div class="cm-k">Posts published</div><div class="cm-v">' + cur.posts + '</div>' + _cmDelta(cur.posts, prev.posts) + '</div>'
                + '<div class="cm-card"><div class="cm-k">Followers</div><div class="cm-v">' + _cmN(fol) + '</div><span class="cm-d fl">Total today</span></div>'
                + '<div class="cm-card"><div class="cm-k">Avg views / post</div><div class="cm-v">' + _cmN(cur.posts ? cur.views / cur.posts : 0) + '</div><span class="cm-d fl">This period</span></div>'
                + '</div>'
                + '<div class="cm-card"><h4>Top content</h4>' + (top.length ? top.map(function (p) { return '<div class="cm-row"><span>' + _esc(p.kind) + ': ' + _esc(p.title) + '</span><span>' + _cmN(p.views) + ' views</span></div>'; }).join('') : '<div class="cm-empty">Publish a post and its views appear here.</div>') + '</div>'
                + '<div class="cm-card"><h4>Audience</h4><div class="cm-empty">Audience location and followers vs non-followers appear once viewer data is recorded for your posts.</div></div>'
                + '</div>';
        });
    }

    document.addEventListener('click', function (e) {
        var t = e.target && e.target.closest ? e.target : null; if (!t) return;
        var chip = t.closest('[data-cm-range]');
        if (chip) { _cmRange = parseInt(chip.getAttribute('data-cm-range'), 10) || 7; renderCreatorAnalyticsTab(); return; }
        if (t.closest('[data-cm-csv]')) {
            _cmLoad(function (list) {
                if (!list) return;
                var rows = ['date,kind,views,interactions,title'].concat(list.sort(function (a, b) { return b.ts - a.ts; }).map(function (p) {
                    return [p.ts ? new Date(p.ts).toISOString().slice(0, 10) : '', p.kind, p.views, p.inter, '"' + p.title.replace(/"/g, '""') + '"'].join(',');
                }));
                var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
                a.download = 'empyrean-analytics.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
            });
            return;
        }
        var tab = t.closest('.profile-tab[data-target="profile-analytics"]');
        if (tab) renderCreatorAnalyticsTab();
    });
    window.renderMonetizationTab = renderMonetizationTab;
    if (typeof window._empRenderCreatorAnalytics !== 'function') window.renderCreatorAnalyticsTab = renderCreatorAnalyticsTab;


    /* =========================================================================
       §3  renderBusinessPage
       ========================================================================= */

    function renderBusinessPage() {
        var container = document.getElementById('business-page');
        if (!container) return;
        var us = _us();

        if (us.businessPage) {
            var page = us.businessPage;
            var coverGradient = page.coverPhoto && page.coverPhoto.startsWith('http')
                ? "url('" + page.coverPhoto + "')"
                : 'linear-gradient(135deg,#0A0E27 0%,#1B2B8B 100%)';

            container.innerHTML =
                '<div class="card business-page-header" style="overflow:hidden;border-radius:24px;margin-bottom:16px;padding:0;">'
                + '<div id="business-page-cover-photo" style="height:220px;background:' + coverGradient + ';background-size:cover;background-position:center;position:relative;">'
                + '<label for="business-cover-photo-input" style="position:absolute;bottom:12px;right:12px;background:rgba(255,255,255,0.2);backdrop-filter:blur(8px);border:1.5px solid rgba(255,255,255,0.4);color:white;padding:8px 16px;border-radius:50px;cursor:pointer;font-size:0.82rem;font-weight:600;display:flex;align-items:center;gap:6px;"><i class="fas fa-camera"></i> Edit Cover</label>'
                + '<input type="file" id="business-cover-photo-input" accept="image/*" style="display:none;"></div>'
                /* Identity row */
                + '<div style="display:flex;align-items:flex-end;gap:18px;padding:0 24px;transform:translateY(-40px);margin-bottom:-30px;">'
                + '<div style="position:relative;flex-shrink:0;">'
                + '<div style="width:90px;height:90px;border-radius:18px;border:4px solid white;background:var(--g-navy);overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.18);display:flex;align-items:center;justify-content:center;">'
                + (page.profilePhoto && page.profilePhoto.startsWith('http')
                    ? '<img src="' + _attr(page.profilePhoto) + '" id="business-page-profile-pic" style="width:100%;height:100%;object-fit:cover;">'
                    : '<i class="fas fa-briefcase" style="font-size:2rem;color:#F5C518;"></i>')
                + '</div>'
                + '<label for="business-profile-photo-input" style="position:absolute;bottom:-4px;right:-4px;width:28px;height:28px;border-radius:50%;background:var(--accent);border:2px solid white;display:flex;align-items:center;justify-content:center;cursor:pointer;"><i class="fas fa-camera" style="font-size:0.6rem;color:#111;"></i></label>'
                + '<input type="file" id="business-profile-photo-input" accept="image/*" style="display:none;"></div>'
                + '<div style="flex:1;padding-bottom:6px;">'
                + '<h2 id="business-page-name" style="font-family:\'Syne\',sans-serif;font-size:1.3rem;font-weight:800;color:var(--primary);margin:0 0 2px;">'
                + _esc(page.name) + ' <i class="fas fa-pen edit-icon" data-field="name" style="font-size:0.75rem;color:var(--text-muted);cursor:pointer;margin-left:8px;"></i></h2>'
                + '<p id="business-page-tagline" style="color:var(--text-muted);font-size:0.88rem;margin:0;">'
                + _esc(page.tagline) + ' <i class="fas fa-pen edit-icon" data-field="tagline" style="font-size:0.7rem;cursor:pointer;margin-left:6px;"></i></p></div>'
                + '<div style="display:flex;gap:8px;padding-bottom:8px;flex-wrap:wrap;">'
                + '<button class="btn btn-small follow-btn" data-user-id="' + _attr(page.id || 'biz-1') + '" style="border-radius:50px;padding:8px 18px;font-size:0.82rem;"><i class="fas fa-plus"></i> Follow</button>'
                + '<button class="btn btn-small btn-accent business-page-promote-btn" style="border-radius:50px;padding:8px 18px;font-size:0.82rem;"><i class="fas fa-rocket"></i> Promote</button>'
                + '<button class="btn btn-small business-page-share-btn" style="border-radius:50px;padding:8px 18px;font-size:0.82rem;background:rgba(10,14,39,0.05);"><svg style="vertical-align:-3px;margin-right:2px;" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share</button>'
                + '</div></div>'
                /* Stats */
                + '<div style="display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid rgba(10,14,39,0.06);margin:0 24px;">'
                + '<div style="padding:14px;text-align:center;border-right:1px solid rgba(10,14,39,0.06);"><strong style="font-size:1.2rem;font-family:\'Syne\',sans-serif;color:var(--primary);" id="business-page-follower-count">' + (page.followerCount || 0).toLocaleString() + '</strong><p style="font-size:0.72rem;color:var(--text-muted);margin:0;">Followers</p></div>'
                + '<div style="padding:14px;text-align:center;border-right:1px solid rgba(10,14,39,0.06);"><strong style="font-size:1.2rem;font-family:\'Syne\',sans-serif;color:var(--primary);" id="biz-post-count">0</strong><p style="font-size:0.72rem;color:var(--text-muted);margin:0;">Posts</p></div>'
                + '<div style="padding:14px;text-align:center;border-right:1px solid rgba(10,14,39,0.06);"><strong style="font-size:1.2rem;font-family:\'Syne\',sans-serif;color:var(--secondary);">8.2%</strong><p style="font-size:0.72rem;color:var(--text-muted);margin:0;">Engagement</p></div>'
                + '<div style="padding:14px;text-align:center;"><strong style="font-size:1.2rem;font-family:\'Syne\',sans-serif;color:var(--accent2);">56.4K</strong><p style="font-size:0.72rem;color:var(--text-muted);margin:0;">Reach (30d)</p></div>'
                + '</div>'
                /* Tabs */
                + '<div class="profile-tabs" id="business-page-tabs" style="padding:0 24px;margin-top:0;">'
                + '<div class="profile-tab active" data-target="business-page-feed-tab">Feed</div>'
                + '<div class="profile-tab" data-target="business-page-about-tab">About</div>'
                + '<div class="profile-tab" data-target="business-page-media-tab">Media</div>'
                + '<div class="profile-tab" data-target="business-page-promotion-tab">Campaigns</div>'
                + '<div class="profile-tab" data-target="business-page-analytics-tab">Analytics</div>'
                + '</div></div>'
                /* Feed tab */
                + '<div id="business-page-feed-tab" class="profile-tab-content active">'
                + '<div class="card" style="margin-bottom:16px;"><div class="card-content">'
                + '<h3 style="margin-bottom:16px;"><i class="fas fa-pen" style="color:var(--secondary);margin-right:8px;"></i>Create Business Post</h3>'
                + '<form id="create-business-post-form">'
                + '<div class="form-group"><textarea id="business-post-text" rows="3" placeholder="Share updates, products, services, or announcements..." style="resize:vertical;min-height:80px;"></textarea></div>'
                + '<div id="business-post-media-preview" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;margin-bottom:12px;"></div>'
                + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">'
                + '<label for="business-post-media-input" class="btn btn-media-upload" style="cursor:pointer;padding:8px 16px;font-size:0.82rem;"><i class="fas fa-photo-video"></i> Media</label>'
                + '<input type="file" id="business-post-media-input" accept="image/*,video/*" multiple style="display:none;">'
                + '<button type="submit" class="btn btn-accent" style="padding:10px 24px;font-size:0.88rem;border-radius:50px;"><i class="fas fa-paper-plane"></i> Post</button>'
                + '</div></form></div></div>'
                + '<div id="business-page-feed-container"><div style="text-align:center;padding:40px;color:var(--text-muted);"><i class="fas fa-stream" style="font-size:2rem;display:block;margin-bottom:12px;"></i><p>No business posts yet. Start sharing!</p></div></div></div>';

        } else {
            /* Create page prompt */
            container.innerHTML =
                '<div class="card"><div class="card-content" id="create-page-prompt" style="text-align:center;padding:60px 30px;">'
                + '<i class="fas fa-building" style="font-size:3rem;color:var(--secondary);display:block;margin-bottom:20px;"></i>'
                + '<h2>Create Your Business Page</h2>'
                + '<p style="color:var(--text-muted);margin:12px 0 28px;">Reach more customers, build your brand, and connect with your community on Empyrean.</p>'
                + '<button id="create-business-page-btn" class="btn btn-accent" style="font-size:1rem;padding:14px 32px;border-radius:50px;">'
                + '<i class="fas fa-plus"></i> Create Business Page</button>'
                + '</div></div>';
        }
    }
    window.renderBusinessPage = renderBusinessPage;


    /* =========================================================================
       §4  populateProfileGallery
       ========================================================================= */

    /**
     * Populate #profile-gallery from .impact-story posts belonging to userId.
     * FIX (report — "this place should contain just profile page videos
     * catalog alone since the picture tab and grid has been created
     * already"): now that Pictures has its own tab (see
     * populateProfilePicturesGallery above), this tab keeps only posts
     * that actually contain a video — photo-only posts, and non-media
     * embeds like the Quote/Meme card (which was rendering here too,
     * misshapen, since it sits inside a .story-media-container without
     * being a plain img/video — that's the stray overflowing card text
     * seen in the report screenshot), no longer qualify at all.
     * @param {string} userId
     */
    function populateProfileGallery(userId) {
        var gallery = document.getElementById('profile-gallery');
        if (!gallery) return;

        var allPosts   = Array.from(document.querySelectorAll('.impact-story[data-user-id="' + userId + '"]'));
        var videoPosts = allPosts.filter(function (p) {
            var mc = p.querySelector('.story-media-container');
            return mc && mc.querySelector('video');
        });

        if (videoPosts.length === 0) {
            gallery.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px 0;font-size:0.9rem;">No videos yet.</p>';
            return;
        }

        gallery.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;';
        gallery.innerHTML = '';

        videoPosts.forEach(function (post) {
            var mc = post.querySelector('.story-media-container');
            if (!mc) return;
            var firstVid = mc.querySelector('video');
            if (!firstVid) return;
            var src = firstVid.src || (firstVid.querySelector('source') ? firstVid.querySelector('source').src : '');
            if (!src || src.startsWith('blob:')) return;

            var totalMedia = mc.querySelectorAll('img, video').length;

            /* FIX (report — "videos should show video live viewers count,
               did you implement that"): each post already tracks and
               live-updates its own view count in its normal feed card
               (.story-actions .view-count — see app-feed.js's
               _viewCountObserver, which keeps that span's text current).
               Read it straight off THIS SAME post element rather than
               re-fetching/re-deriving a count, so the gallery badge is
               always in sync with the number already shown on the post
               itself, no separate tracking needed. */
            var _vcEl   = post.querySelector('.story-actions .view-count');
            var _vcText = (_vcEl && _vcEl.textContent.trim()) || '0';

            var card = document.createElement('div');
            card.className = 'emp-profile-video-thumb';
            card.innerHTML = '<video src="' + _attr(src) + (src.indexOf('#') === -1 ? '#t=0.1' : '') + '"' + ((typeof window._empReelPosterUrl === 'function' && window._empReelPosterUrl(src)) ? ' poster="' + _attr(window._empReelPosterUrl(src)) + '"' : '') + ' muted loop playsinline preload="metadata"></video>'
                + '<div class="emp-profile-video-play"><span><i class="fas fa-play"></i></span></div>'
                + '<div class="emp-profile-reel-viewcount"><i class="fas fa-play"></i>' + _esc(_vcText) + '</div>';

            _videoTileControls(card);

            /* Multi-count badge — same "this post has N media items" hint
               the old mixed grid gave, unchanged. */
            if (totalMedia > 1) {
                var badge = document.createElement('div');
                badge.className = 'emp-profile-video-count';
                badge.innerHTML = '<i class="fas fa-images" style="font-size:0.65rem;margin-right:2px;"></i>' + totalMedia;
                card.appendChild(badge);
            }

            card.addEventListener('click', function (e) {
                if (e && e.target && e.target.closest && e.target.closest('.emp-vt-ctrl')) return;
                var allUrls = Array.from(mc.querySelectorAll('img, video')).map(function (el) {
                    return { url: el.src || '', type: el.tagName === 'VIDEO' ? 'video/mp4' : 'image/jpeg' };
                }).filter(function (m) { return m.url && !m.url.startsWith('blob:'); });

                if (typeof window.showMarketplaceGallery === 'function') {
                    window.showMarketplaceGallery(allUrls, 0);
                } else {
                    window.open(src, '_blank');
                }
            });

            gallery.appendChild(card);
        });
        _attachVideoPreviews(gallery);
    }
    window.populateProfileGallery = populateProfileGallery;

    /**
     * Populate #profile-pictures-gallery from .impact-story posts belonging
     * to userId — IMAGES ONLY, split out of populateProfileGallery above
     * per this session's request (report item #2: "create a sub column for
     * picture collection ... same frame size expandable on clicking").
     * Mirrors that function's own DOM-scrape + click-to-expand approach
     * (same source posts, same lightbox), just filtered to image media and
     * rendered into its own square-tile grid instead of the mixed one.
     * @param {string} userId
     */
    function populateProfilePicturesGallery(userId) {
        var gallery = document.getElementById('profile-pictures-gallery');
        if (!gallery) return;

        var allPosts  = Array.from(document.querySelectorAll('.impact-story[data-user-id="' + userId + '"]'));
        var picPosts  = allPosts.filter(function (p) {
            var mc = p.querySelector('.story-media-container');
            return mc && mc.querySelector('img');
        });

        if (picPosts.length === 0) {
            gallery.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px 0;font-size:0.9rem;">No pictures yet.</p>';
            return;
        }

        gallery.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;';
        gallery.innerHTML = '';

        picPosts.forEach(function (post) {
            var mc = post.querySelector('.story-media-container');
            if (!mc) return;
            var imgs = Array.from(mc.querySelectorAll('img'));

            imgs.forEach(function (imgEl) {
                var src = imgEl.src || '';
                if (!src || src.startsWith('blob:')) return;

                var card = document.createElement('div');
                card.className = 'emp-profile-pic-thumb';
                card.innerHTML = '<img src="' + _attr(src) + '" alt="Photo" loading="lazy" onerror="this.parentElement.style.display=\'none\'">';

                /* Click-to-expand — same lightbox every other gallery in
                   this file already opens, starting on THIS specific
                   photo among all of this post's images (matches the
                   "expandable on clicking" ask). */
                card.addEventListener('click', function () {
                    var allImgs = imgs.map(function (el) {
                        return { url: el.src || '', type: 'image/jpeg' };
                    }).filter(function (m) { return m.url && !m.url.startsWith('blob:'); });
                    var startIdx = allImgs.findIndex(function (m) { return m.url === src; });
                    if (typeof window.showMarketplaceGallery === 'function') {
                        window.showMarketplaceGallery(allImgs, startIdx >= 0 ? startIdx : 0);
                    } else {
                        window.open(src, '_blank');
                    }
                });

                gallery.appendChild(card);
            });
        });
    }
    window.populateProfilePicturesGallery = populateProfilePicturesGallery;

    /* Videos and Pictures are separate catalogs. Live-upload paths used to push every URL
       (photos included) into #profile-gallery, which is the Videos tab. They now call
       _empSplitProfileMedia(urls): photos are sent to the Pictures tab here, and only the
       video URLs are handed back for the Videos tab. */
    window._empAddPictureToProfile = function (url) {
        try {
            var gal = document.getElementById('profile-pictures-gallery');
            if (!gal || !url || url.indexOf('blob:') === 0 || url.indexOf('data:') === 0) return;
            var dup = Array.prototype.some.call(gal.querySelectorAll('img'), function (i) { return i.src === url || i.getAttribute('src') === url; });
            if (dup) return;
            var ph = gal.querySelector(':scope > p'); if (ph) ph.remove();
            gal.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;';
            var card = document.createElement('div');
            card.className = 'emp-profile-pic-thumb';
            card.innerHTML = '<img src="' + _attr(url) + '" alt="Photo" loading="lazy" onerror="this.parentElement.style.display=\'none\'">';
            card.addEventListener('click', function () {
                if (typeof window.showMarketplaceGallery === 'function') window.showMarketplaceGallery([{ url: url, type: 'image/jpeg' }], 0);
                else window.open(url, '_blank');
            });
            gal.insertBefore(card, gal.firstChild);
        } catch (e) {}
    };
    window._empSplitProfileMedia = function (urls) {
        var vids = [];
        (urls || []).forEach(function (u) {
            if (!u) return;
            var isV = /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(u) || /\/video\/upload\//i.test(u);
            if (isV) vids.push(u); else window._empAddPictureToProfile(u);
        });
        return vids;
    };


    /* =========================================================================
       §5  _populateHomeBioCard
       ========================================================================= */

    function _populateHomeBioCard() {
        var card = document.getElementById('home-user-bio-card');
        if (!card || _isGuest()) { if (card) card.style.display = 'none'; return; }
        if (typeof window.renderSuggestedUsers === 'function') {
            setTimeout(window.renderSuggestedUsers, 150);
        }
    }
    window._populateHomeBioCard = _populateHomeBioCard;


    /* =========================================================================
       §6  showFollowersModal / showFollowingModal
       ========================================================================= */

    window.showFollowersModal = function (tab) {
        var us      = _us();
        var mu      = _mu();
        var followed = Array.from(us.followedUserIds || []);

        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:var(--z-critical,99999);display:flex;align-items:center;justify-content:center;';

        var box = document.createElement('div');
        box.style.cssText = 'background:white;border-radius:20px;width:min(400px,92vw);max-height:80vh;overflow:hidden;display:flex;flex-direction:column;';

        /* Tab bar */
        var tabs    = document.createElement('div');
        tabs.style.cssText = 'display:flex;border-bottom:1px solid rgba(10,14,39,0.08);';
        var tabFlw  = document.createElement('button');
        tabFlw.style.cssText  = 'flex:1;padding:14px;border:none;background:none;font-weight:700;cursor:pointer;color:var(--primary);';
        tabFlw.textContent    = 'Followers (' + (us.followerCount || 0) + ')';
        var tabFlwing = document.createElement('button');
        tabFlwing.style.cssText = 'flex:1;padding:14px;border:none;background:none;font-weight:600;cursor:pointer;color:var(--text-muted);';
        tabFlwing.textContent = 'Following (' + followed.length + ')';
        var closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'padding:14px;border:none;background:none;cursor:pointer;font-size:1.2rem;color:var(--text-muted);';
        closeBtn.innerHTML     = '&times;';
        closeBtn.onclick = function () { overlay.remove(); };
        tabs.appendChild(tabFlw);
        tabs.appendChild(tabFlwing);
        tabs.appendChild(closeBtn);

        /* Panels */
        var panFlw = document.createElement('div');
        panFlw.style.cssText = 'overflow-y:auto;flex:1;padding:12px;';
        panFlw.innerHTML = (us.followerCount || 0) > 0
            ? '<p style="text-align:center;padding:20px;color:var(--text-muted);">Follower list synced from backend.</p>'
            : '<p style="text-align:center;padding:20px;color:var(--text-muted);">No followers yet.</p>';

        var panFlwing = document.createElement('div');
        panFlwing.style.cssText = 'overflow-y:auto;flex:1;padding:12px;display:none;';

        if (followed.length > 0) {
            followed.forEach(function (uid) {
                var u   = mu[uid] || {};
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(10,14,39,0.05);cursor:pointer;';
                var img = document.createElement('img');
                img.src           = u.avatar || 'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=40';
                img.style.cssText = 'width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0;';
                var info = document.createElement('div');
                info.innerHTML    = '<strong style="display:block;">' + _esc(u.fullName || 'User') + '</strong><span style="font-size:0.8rem;color:var(--text-muted);">@' + _esc(u.username || 'user') + '</span>';
                row.appendChild(img);
                row.appendChild(info);
                row.onclick = function () {
                    overlay.remove();
                    window._viewingOtherProfile = (uid !== us.id);
                    if (typeof window.renderUserProfile === 'function') window.renderUserProfile(uid);
                    if (typeof window.navigateTo       === 'function') window.navigateTo('profile', true);
                    setTimeout(function () { window._viewingOtherProfile = false; }, 500);
                };
                panFlwing.appendChild(row);
            });
        } else {
            panFlwing.innerHTML = '<p style="text-align:center;padding:20px;color:var(--text-muted);">Not following anyone yet.</p>';
        }

        /* Tab switching */
        tabFlw.onclick = function () {
            panFlw.style.display = 'block'; panFlwing.style.display = 'none';
            tabFlw.style.fontWeight = '700'; tabFlw.style.color = 'var(--primary)';
            tabFlwing.style.fontWeight = '600'; tabFlwing.style.color = 'var(--text-muted)';
        };
        tabFlwing.onclick = function () {
            panFlw.style.display = 'none'; panFlwing.style.display = 'block';
            tabFlwing.style.fontWeight = '700'; tabFlwing.style.color = 'var(--primary)';
            tabFlw.style.fontWeight = '600'; tabFlw.style.color = 'var(--text-muted)';
        };

        box.appendChild(tabs);
        box.appendChild(panFlw);
        box.appendChild(panFlwing);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

        if (tab === 'following') tabFlwing.onclick();
    };

    window.showFollowingModal = function () { window.showFollowersModal('following'); };


    /* =========================================================================
       §7  PROFILE TAB SWITCHING (delegated)
       ========================================================================= */

    document.addEventListener('click', function (e) {
        var tab = e.target.closest('.profile-tab');
        if (!tab) return;
        var target = tab.dataset.target;
        if (!target) return;

        /* Deactivate siblings */
        var tabBar = tab.closest('.profile-tabs');
        if (tabBar) {
            tabBar.querySelectorAll('.profile-tab').forEach(function (t) { t.classList.remove('active'); });
        }
        tab.classList.add('active');

        /* Hide all sibling tab contents */
        var card = tab.closest('.card, .card-content, #profile') || document;
        card.querySelectorAll('.profile-tab-content').forEach(function (c) { c.style.display = 'none'; c.classList.remove('active'); });

        /* Show target */
        var panel = document.getElementById(target);
        if (panel) { panel.style.display = 'block'; panel.classList.add('active'); }

        /* Lazy-populate gallery on first open */
        if (target === 'profile-main-content') {
            var gal = document.getElementById('profile-gallery');
            /* FIX: this used to check for '.gallery-item, [data-media-url]'
               — neither class/attribute is ever created by
               populateProfileGallery (which renders '.emp-profile-video-
               thumb' tiles), so this check always re-ran the population
               unconditionally rather than actually skipping when already
               populated. Harmless (population is cheap/idempotent), but
               fixed to match reality now that this tab has its own real
               thumbnail class, same as the Reels/Pictures tabs' checks. */
            if (gal && !gal.querySelector('.emp-profile-video-thumb')) {
                var uid = (window.EmpState ? window.EmpState.userState : window.userState || {}).id;
                if (uid) populateProfileGallery(uid);
            }
        }

        /* Lazy-populate the Reels gallery on first open — same safety-net
           pattern as the Photos/Videos gallery above. Deliberately reads
           the id off .profile-header-info's own data-user-id (set from the
           PROFILE BEING VIEWED, see renderUserProfile) rather than the
           logged-in window.userState.id the Gallery fallback above uses —
           the Gallery fallback rarely misfires because populateProfileGallery
           already ran unconditionally at render time, but getting a fresh
           fallback right matters more here since it's easy to open this tab
           on someone else's profile before that happens to be true. */
        if (target === 'profile-reels-tab') {
            var relGal = document.getElementById('profile-reels-gallery');
            if (relGal && !relGal.querySelector('.reel-preview-card')) {
                var headerInfo = document.querySelector('.profile-header-info[data-user-id]');
                var viewedUid  = headerInfo ? headerInfo.dataset.userId : null;
                if (viewedUid) populateProfileReelsGallery(viewedUid);
            }
        }

        /* Lazy-populate the Pictures gallery on first open — same
           safety-net pattern as the two galleries above. Reads the
           logged-in user's own id the same way the mixed Gallery tab's
           fallback does above, since populateProfilePicturesGallery
           scrapes the same already-rendered .impact-story DOM (no
           network fetch of its own, so there's no "viewed profile" id
           to get right the way the Reels tab needs). */
        if (target === 'profile-pictures-tab') {
            var picGal = document.getElementById('profile-pictures-gallery');
            if (picGal && !picGal.querySelector('.emp-profile-pic-thumb')) {
                var picUid = (window.EmpState ? window.EmpState.userState : window.userState || {}).id;
                if (picUid) populateProfilePicturesGallery(picUid);
            }
        }

        /* Chevron fix: the 3-line clamp measures a card the moment it is added to the page. Cards
           built while their tab was hidden measured as 0px tall, so they never got a chevron. When
           the Posts / Dashboard tab is shown, re-measure the cards that still have none. */
        if (panel && (target === 'profile-posts-tab' || target === 'profile-dashboard-tab') && typeof window._empInitLineClamp === 'function') {
            setTimeout(function () {
                panel.querySelectorAll('.story-content').forEach(function (c) {
                    if (c.querySelector('.post-expand-toggle') || c.querySelector(':scope > .post-text-wrap')) return;
                    var p = c.querySelector('p');
                    c._lcInit = false;
                    if (p) p._lcClamped = false;
                    window._empInitLineClamp(c);
                });
            }, 120);
        }
    });


    /* =========================================================================
       §8  STORY-HEADER CLICK → USER PROFILE NAVIGATION
       ========================================================================= */

    document.addEventListener('click', function (e) {
        var storyHeader = e.target.closest('.story-header');
        if (!storyHeader) return;
        var clickedAvatar = e.target.closest('.avatar-placeholder') || (e.target.tagName === 'IMG' ? e.target : null);
        var clickedName   = e.target.closest('.story-user-info strong');
        if (!clickedAvatar && !clickedName) return;
        var post   = storyHeader.closest('.impact-story');
        if (!post) return;
        var userId = post.dataset.userId;
        var us     = _us();
        if (!userId || userId === us.id) return;
        e.preventDefault();
        e.stopPropagation();
        var mu = _mu();
        if (!mu[userId]) return;
        window._viewingOtherProfile = true;
        renderUserProfile(userId);
        if (typeof window.navigateTo === 'function') window.navigateTo('profile', true);
        setTimeout(function () { window._viewingOtherProfile = false; }, 500);
    });

    // Birthday feature — "Send a Gift" button (only rendered when the
    // profile owner's dobMonthDay matches today — see isBirthdayToday
    // above). Opens the profile/birthday gift catalog from app-gifts.js.
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('#profile-send-gift-btn');
        if (!btn) return;
        e.preventDefault();
        if (typeof window.openProfileGiftCatalog === 'function') {
            window.openProfileGiftCatalog(btn.dataset.giftUserId, btn.dataset.giftUserName);
        }
    });

    // "View All & Send a Wish" — opens the full Birthday Wishes modal
    // (app-gifts.js) from the embedded #profile-birthday-section preview,
    // so a visitor who wants to actually type a wish or send a gift/card
    // gets the full modal experience rather than a cramped inline form.
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('#profile-birthday-viewall-btn');
        if (!btn) return;
        e.preventDefault();
        if (typeof window.openBirthdayWishesFeed === 'function') {
            window.openBirthdayWishesFeed(btn.dataset.giftUserId, btn.dataset.giftUserName, btn.dataset.giftUserAvatar);
        }
    });

    /* Celebratory avatar frame CSS — injected once, per this codebase's
       runtime-style-injection convention (see _profileReelStripToken's own
       comment block above for the same convention in this file). Ring
       gradient matches app-gifts.js's dashboard "Birthdays Today" chips
       and Birthday Wishes modal header, so the same visual language is
       used everywhere a birthday shows up across the app. */
    (function _ensureBirthdayProfileCSS() {
        if (document.getElementById('_profile_bday_frame_css')) return;
        var css = document.createElement('style');
        css.id = '_profile_bday_frame_css';
        css.textContent = [
            '.profile-pic-container.emp-bday-avatar-frame{position:relative;border-radius:50%;padding:4px;',
            'background:linear-gradient(135deg,#F5C518,#F08C1A,#EF4444);}',
            '.profile-pic-container.emp-bday-avatar-frame .avatar-placeholder{width:142px!important;height:142px!important;}',
            '.emp-bday-avatar-cake{position:absolute;bottom:2px;right:2px;font-size:1.5rem;background:#fff;border-radius:50%;',
            'width:36px;height:36px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.22);}'
        ].join('\n');
        document.head.appendChild(css);
    })();

    /* Birthday Messages section — live feed embedded on the profile
       itself (see #profile-birthday-section markup above). Reads the same
       `birthday_feed` collection as app-gifts.js's Birthday Wishes modal
       (SECTION 12 there) — this is intentionally a SEPARATE, independent
       listener rather than reaching into that file's private module state,
       matching this codebase's established "additive, don't reach into
       another file's closure" convention. Shows at most the 4 most recent
       entries (wishes, gifts, and custom cards alike) as a quick preview;
       "View All & Send a Wish" opens the full modal for everything else. */
    var _bdProfileFeed = { userId: null, unsub: null };

    function _bdProfEsc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _renderProfileBirthdayMessages(items) {
        var list = document.getElementById('profile-birthday-messages');
        if (!list) return;
        if (!items.length) {
            list.innerHTML = '<div style="text-align:center;color:#99a;font-size:0.82rem;padding:8px 0;">No wishes yet — be the first to say Happy Birthday! 🎉</div>';
            return;
        }
        var recent = items.slice(-4).reverse(); // newest first, preview only
        list.innerHTML = recent.map(function (it) {
            var name = _bdProfEsc(it.senderName || 'Someone');
            var body = it.type === 'gift'
                ? '<span style="color:#8a6d1a;font-weight:700;">' + _bdProfEsc(it.giftSymbol || '🎁') + ' sent ' + _bdProfEsc((window.empGiftLabel ? window.empGiftLabel(it.giftName) : it.giftName) || 'a gift') + '</span>'
                : it.type === 'card'
                ? '<span style="display:inline-block;border-radius:8px;padding:4px 8px;color:#fff;font-weight:700;background:' + _bdProfEsc(it.cardBg || 'linear-gradient(135deg,#1B2B8B,#5B0EA6)') + ';">🎉 ' + _bdProfEsc(it.message || '') + '</span>'
                : _bdProfEsc(it.message || '');
            return '<div style="background:#fff;border-radius:10px;padding:8px 10px;font-size:0.82rem;">' +
                '<strong style="color:#1B2B8B;">' + name + '</strong><br>' + body + '</div>';
        }).join('');
    }

    function _mountProfileBirthdayFeed(userId) {
        if (!document.getElementById('profile-birthday-messages')) return;
        if (_bdProfileFeed.unsub) { try { _bdProfileFeed.unsub(); } catch (e) {} _bdProfileFeed.unsub = null; }
        _bdProfileFeed.userId = userId;
        if (!window.fbDb || !window._firebaseLoaded) return;
        try {
            _bdProfileFeed.unsub = window.fbDb.collection('birthday_feed')
                .where('birthdayUserId', '==', userId)
                .onSnapshot(function (snap) {
                    if (_bdProfileFeed.userId !== userId) return; /* a newer profile render took over */
                    var items = [];
                    snap.forEach(function (doc) { items.push(doc.data() || {}); });
                    items.sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
                    _renderProfileBirthdayMessages(items);
                }, function (err) {
                    console.warn('[Profile] birthday messages listener error:', err && err.message);
                });
        } catch (e) {
            console.warn('[Profile] could not attach birthday messages listener:', e && e.message);
        }
    }


    /* =========================================================================
       §9  OWNER REEL GALLERY & PROFILE FEED INTEGRATION

       Reels live in their own Firestore "reels" collection (see app-feed.js's
       reels onSnapshot listener / app-fixes.js's reel-submit handler) — they
       are NOT .impact-story posts, so populateProfileGallery() (§4, which
       only ever scans .impact-story[data-user-id] elements) never sees them
       and they never showed up anywhere on a profile. This section adds:

         (a) populateProfileReelsGallery(userId) — fills the dedicated
             "Reels" tab (#profile-reels-gallery) added above, a 3-col
             thumbnail grid distinct from the Photos/Videos Gallery tab.
         (b) _mountProfileFeedReelStrip(userId) — a horizontally
             swipeable + auto-sliding reel strip inserted into the middle
             of BOTH feed containers that show this profile's posts —
             #profile-posts-feed (Posts tab) and #profile-dash-feed
             (Dashboard tab's "Your Feed", own profile only) — reusing the
             same .horizontal-slider-* scroll-snap machinery already used
             for the Dashboard tab's "Live Streams" row, so swipe/
             drag-to-scroll comes for free; only the auto-slide timer is
             new.

       Both read from the SAME small Firestore-backed cache (_fetchOwnerReels)
       so opening this profile only ever issues one "reels for this user"
       query, not two (or three, now that there are two feed containers).
       ========================================================================= */

    var _reelsCache        = {};   // userId -> { ts, reels: [...] }
    var REELS_CACHE_TTL_MS = 60000;
    var _reelStrips         = {};  // feedId -> { interval, observer } — one entry per mounted strip

    function _sortReelsDesc(list) {
        return list.slice().sort(function (a, b) {
            return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        });
    }

    /* DOM fallback for when Firestore isn't reachable yet — mirrors
       populateProfileGallery's own "read what's already rendered" approach.
       Only the global reels grid (app-feed.js's #reels-grid-container)
       reliably stamps data-user-id on its cards; the dashboard slider
       cards don't, so they're not usable as a fallback source here. */
    function _domFallbackReels(userId) {
        var cards = Array.from(document.querySelectorAll('#reels-grid-container .reel-card[data-user-id="' + userId + '"]'));
        return cards.map(function (c) {
            return {
                id:        c.dataset.postId || c.dataset.reelId || '',
                videoUrl:  c.dataset.videoUrl || '',
                username:  c.dataset.username || '',
                avatar:    c.dataset.avatar   || '',
                caption:   c.dataset.caption  || '',
                userId:    userId
            };
        }).filter(function (r) { return r.id && r.videoUrl; });
    }

    /**
     * Fetch (and briefly cache) every reel belonging to userId.
     * @param {string} userId
     * @param {function(Array)} cb
     */
    function _fetchOwnerReels(userId, cb) {
        var cached = _reelsCache[userId];
        if (cached && (Date.now() - cached.ts) < REELS_CACHE_TTL_MS) { cb(cached.reels); return; }

        if (window.fbDb && window._firebaseLoaded) {
            window.fbDb.collection('reels').where('userId', '==', userId).limit(30).get()
                .then(function (snap) {
                    var list = [];
                    snap.forEach(function (doc) {
                        var d = doc.data() || {};
                        if (!d.videoUrl || String(d.videoUrl).indexOf('blob:') === 0) return;
                        list.push(d);
                    });
                    list = _sortReelsDesc(list);
                    _reelsCache[userId] = { ts: Date.now(), reels: list };
                    cb(list);
                })
                .catch(function (err) {
                    console.warn('[EmpProfile] owner reel fetch failed, falling back to what\'s already on screen:', err && err.message);
                    cb(_domFallbackReels(userId));
                });
        } else {
            cb(_domFallbackReels(userId));
        }
    }

    /* ── (a) Reels gallery tab ── */

    function populateProfileReelsGallery(userId) {
        var gallery = document.getElementById('profile-reels-gallery');
        if (!gallery) return;
        gallery.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px 0;font-size:0.9rem;"><i class="fas fa-circle-notch fa-spin"></i> Loading reels…</p>';

        _fetchOwnerReels(userId, function (reels) {
            /* The profile may have been re-rendered (or navigated away from)
               by the time this async callback lands — re-grab fresh, don't
               trust the closed-over reference. */
            gallery = document.getElementById('profile-reels-gallery');
            if (!gallery) return;

            if (!reels.length) {
                gallery.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px 0;font-size:0.9rem;">No reels yet.</p>';
                return;
            }

            gallery.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;';
            gallery.innerHTML = '';

            reels.forEach(function (reel) {
                var card = document.createElement('div');
                /* .reel-preview-card is what app-reel.js's document-level
                   click delegate + openReelViewer() already look for — this
                   is what makes tapping a thumbnail open the real fullscreen
                   reel viewer without any new click-wiring here. */
                card.className        = 'emp-profile-reel-thumb reel-preview-card';
                card.dataset.postId   = reel.id       || '';
                card.dataset.reelId   = reel.id       || '';
                card.dataset.videoUrl = reel.videoUrl || '';
                card.dataset.username = reel.username || '';
                card.dataset.avatar   = reel.avatar   || '';
                card.dataset.caption  = reel.caption  || '';
                card.dataset.userId   = reel.userId   || userId;

                /* FIX (2026-08-22 — reel thumbnails rendering inconsistently /
                   solid black): see _empReelPosterUrl's header comment in
                   app-reel.js. Guarded — if app-reel.js hasn't loaded yet or
                   can't derive a poster for this URL, this is unchanged. */
                var _galleryPoster = (typeof window._empReelPosterUrl === 'function') ? window._empReelPosterUrl(reel.videoUrl) : '';
                /* FIX (report — "with the live viewers count as shown
                   above"): reel.viewCount is the raw Firestore field name
                   for this collection (see app-reel.js, which reads the
                   same field into its own on-screen "data.views" — that
                   file's own reel-view-count element, not this one). */
                var _galleryViews = reel.viewCount || 0;
                card.innerHTML =
                    '<video src="' + _attr(reel.videoUrl || '') + '"' + (_galleryPoster ? ' poster="' + _attr(_galleryPoster) + '"' : '') + ' muted loop playsinline preload="metadata"></video>'
                    + '<div class="emp-profile-reel-play"><span><i class="fas fa-play"></i></span></div>'
                    + '<div class="emp-profile-reel-viewcount"><i class="fas fa-play"></i>' + _galleryViews.toLocaleString() + '</div>';

                gallery.appendChild(card);
            });
        });
    }
    window.populateProfileReelsGallery = populateProfileReelsGallery;

    /* ── (b) Mid-feed reel strip: swipeable + auto-sliding ── */

    function _reelStripCardHTML(reel, userId) {
        var avatarFallback = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(reel.username || 'U') + '&background=1B2B8B&color=fff&size=80';
        return '<div class="emp-profile-feed-reel-card reel-preview-card" '
            + 'data-post-id="'   + _attr(reel.id       || '') + '" '
            + 'data-reel-id="'   + _attr(reel.id       || '') + '" '
            + 'data-video-url="' + _attr(reel.videoUrl || '') + '" '
            + 'data-username="'  + _attr(reel.username || '') + '" '
            + 'data-avatar="'    + _attr(reel.avatar   || '') + '" '
            + 'data-caption="'   + _attr(reel.caption  || '') + '" '
            + 'data-user-id="'   + _attr(reel.userId   || userId) + '">'
            /* FIX (2026-08-22 — reel thumbnails rendering inconsistently /
               solid black): see _empReelPosterUrl's header comment in
               app-reel.js. */
            + '<video src="' + _attr(reel.videoUrl || '') + '"' + ((typeof window._empReelPosterUrl === 'function' && window._empReelPosterUrl(reel.videoUrl)) ? ' poster="' + _attr(window._empReelPosterUrl(reel.videoUrl)) + '"' : '') + ' loop muted playsinline preload="metadata"></video>'
            + '<div class="emp-pfrc-avatar"><img src="' + _attr(reel.avatar || avatarFallback) + '" '
            + 'onerror="this.onerror=null;this.src=\'' + avatarFallback + '\';"></div>'
            + '</div>';
    }

    /* Keeps a strip sitting at (roughly) the middle of its feed container's
       current children, re-run whenever a post is added/removed elsewhere
       (app-feed.js/app-fixes.js/app-live.js all clone posts into
       #profile-posts-feed and/or #profile-dash-feed asynchronously and
       independently of this file — see the grep in this section's own
       header).
       @param {string} feedId  id of the feed container ('profile-posts-feed' or 'profile-dash-feed')
       @param {string} stripId id of THAT feed's own strip element */
    function _repositionReelStrip(feedId, stripId) {
        var feed  = document.getElementById(feedId);
        var strip = document.getElementById(stripId);
        if (!feed || !strip) return;

        var siblings = Array.prototype.filter.call(feed.children, function (c) { return c !== strip; });
        if (!siblings.length) {
            if (strip.parentNode !== feed) feed.appendChild(strip);
            return; /* no posts yet to sit "in the middle" of — keep as-is, will reposition once posts land */
        }
        var anchor = siblings[Math.floor(siblings.length / 2)];
        if (strip.nextSibling !== anchor) feed.insertBefore(strip, anchor);
    }

    function _startReelStripAutoSlide(feedId, wrapper) {
        var entry = _reelStrips[feedId] || (_reelStrips[feedId] = {});
        if (entry.interval) clearInterval(entry.interval);
        entry.interval = setInterval(function () {
            /* Strip was torn down by a re-render/navigation — stop ourselves
               rather than relying on the caller to remember to clear us. */
            if (!document.body.contains(wrapper)) { clearInterval(entry.interval); entry.interval = null; return; }
            if (wrapper._empUserInteracting) return;             /* paused — person is mid-swipe */
            if (wrapper.offsetParent === null) return;            /* that tab isn't currently visible — no point animating */
            if (!wrapper.children.length) return;

            var cardW = wrapper.firstElementChild.getBoundingClientRect().width + 12; /* +gap */
            var atEnd = wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - 4;
            wrapper.scrollTo({ left: atEnd ? 0 : (wrapper.scrollLeft + cardW), behavior: 'smooth' });
        }, 3500);
    }

    /* Mounts one swipeable + auto-sliding reel strip into a single feed
       container. Shared by both the Posts tab and the Dashboard tab below —
       identical behavior in each place, just a different container/element
       id so the two strips (and their own timers/observers) never collide. */
    function _mountReelStripInto(feedId, stripId, wrapperId, userId, reels) {
        var feed = document.getElementById(feedId);
        if (!feed) return;

        var strip = document.createElement('div');
        strip.id        = stripId;
        strip.className = 'card emp-profile-reel-strip-card';
        strip.style.cssText = 'margin:4px 0 14px;border-radius:16px;overflow:hidden;';
        strip.innerHTML =
            '<div class="emp-pfrs-header">'
            + '<i class="fas fa-film" style="color:#5B0EA6;"></i>'
            + '<strong style="font-size:0.9rem;">Reels</strong>'
            + '</div>'
            + '<div class="horizontal-slider-container">'
            + '<div class="horizontal-slider-wrapper" id="' + wrapperId + '">'
            + reels.map(function (r) { return _reelStripCardHTML(r, userId); }).join('')
            + '</div></div>';

        feed.appendChild(strip); /* placed once here; _repositionReelStrip() below moves it to the middle */
        _repositionReelStrip(feedId, stripId);

        var wrapper = document.getElementById(wrapperId);
        if (wrapper) {
            /* Pause auto-slide while the person is actually swiping it
               themselves, resume shortly after they let go. */
            ['touchstart', 'pointerdown', 'mousedown'].forEach(function (evt) {
                wrapper.addEventListener(evt, function () { wrapper._empUserInteracting = true; }, { passive: true });
            });
            ['touchend', 'pointerup', 'mouseup'].forEach(function (evt) {
                wrapper.addEventListener(evt, function () {
                    setTimeout(function () { wrapper._empUserInteracting = false; }, 2500);
                }, { passive: true });
            });
            _startReelStripAutoSlide(feedId, wrapper);
        }

        /* Keep the strip mid-feed as other modules asynchronously clone
           more posts into this container over time. */
        var entry = _reelStrips[feedId] || (_reelStrips[feedId] = {});
        entry.observer = new MutationObserver(function () {
            clearTimeout(feed._pfrsRepositionTimer);
            feed._pfrsRepositionTimer = setTimeout(function () { _repositionReelStrip(feedId, stripId); }, 200);
        });
        entry.observer.observe(feed, { childList: true });
    }

    /* Mounts the reel strip into every feed container present on the
       currently-rendered profile: #profile-posts-feed (Posts tab, every
       profile) and #profile-dash-feed (Dashboard tab's "Your Feed", own
       profile only — the element simply doesn't exist on someone else's
       profile, so that half of this is a no-op there). */
    var _reelStripMountToken = 0;
    function _mountProfileFeedReelStrip(userId) {
        /* FIX (2026-08-20 — reel strip still occasionally showing 3 copies,
           "1 up top, 2 stuck at the bottom"): the 2026-08-10 fix below
           (renderUserProfile's own _profileReelStripToken, see that
           function) only guards against renderUserProfile() SCHEDULING
           this function more than once inside the same 500ms window — it
           says nothing about two legitimately-spaced calls to THIS
           function (500ms+ apart, e.g. leaving and reopening the profile)
           both landing while their own _fetchOwnerReels() calls are still
           in flight, which a slow/flaky mobile connection (this app's
           documented weak-4G/bouncing-signal cases) makes easy to hit.
           Neither call's async fetch callback had any way to know a NEWER
           call had since started, so whichever fetch resolved LAST would
           mount its own fresh strip without knowing an earlier call's
           strip already existed — the DOM cleanup a few lines down only
           runs synchronously at the START of a call, before either fetch
           has resolved, so it can never retroactively catch a duplicate
           mounted by an overlapping call's late-arriving response. Once
           that duplicate exists, _repositionReelStrip()'s own
           document.getElementById(stripId) — which, given a duplicate id,
           always resolves to the FIRST one in DOM order — only ever
           repositions THAT one into the middle of the feed; every later
           one it doesn't know about is left exactly where appendChild
           first put it, at the end of the feed. One correctly-positioned
           strip plus however many stragglers left at the end is exactly
           the reported "1 top, 2 bottom" symptom.

           FIX: give every call to this function its own generation token,
           checked right before the async mount actually happens — a call
           superseded by a newer one becomes a no-op instead of mounting a
           stale duplicate. Closes the gap the caller-side token doesn't
           cover, without touching that existing fix or anything else
           here. */
        var _myMountToken = ++_reelStripMountToken;

        /* Tear down whatever the PREVIOUS profile render (or a previous
           call for this same one) left running before starting fresh — any
           interval/observer would otherwise keep referencing detached DOM
           after renderUserProfile() rebuilds #profile section's innerHTML. */
        Object.keys(_reelStrips).forEach(function (feedId) {
            var entry = _reelStrips[feedId];
            if (entry.interval) clearInterval(entry.interval);
            if (entry.observer) entry.observer.disconnect();
        });
        _reelStrips = {};

        var targets = [
            { feedId: 'profile-posts-feed', stripId: 'profile-feed-reel-strip',      wrapperId: 'profile-feed-reel-strip-wrapper' },
            { feedId: 'profile-dash-feed',  stripId: 'profile-dash-feed-reel-strip', wrapperId: 'profile-dash-feed-reel-strip-wrapper' }
        ].filter(function (t) { return !!document.getElementById(t.feedId); });
        if (!targets.length) return;

        /* FIX (2026-08-10): the teardown above only ever cleared the JS-side
           interval/observer bookkeeping — it never removed the actual strip
           <div> from the DOM. Belt-and-suspenders here on top of the token
           fix at the call site (renderUserProfile): remove EVERY element
           matching each target's stripId (querySelectorAll, not
           getElementById — duplicate ids from before this fix would make
           getElementById silently see only the first one and miss the
           rest) before mounting a fresh one. This both prevents any new
           duplication and cleans up strips a still-open session may already
           have accumulated pre-fix. */
        targets.forEach(function (t) {
            document.querySelectorAll('#' + t.stripId).forEach(function (el) { el.remove(); });
        });

        _fetchOwnerReels(userId, function (reels) {
            if (_myMountToken !== _reelStripMountToken) return; /* a newer call to this function has since started — mounting now would create exactly the stray duplicate this fix exists to prevent */
            if (!reels.length) return; /* nothing to show — leave both feeds exactly as they were */
            targets.forEach(function (t) {
                if (!document.getElementById(t.feedId)) return; /* profile may have re-rendered by now */
                _mountReelStripInto(t.feedId, t.stripId, t.wrapperId, userId, reels);
            });
        });
    }
    window._mountProfileFeedReelStrip = _mountProfileFeedReelStrip;


    /* =========================================================================
       §9b  MID-FEED QUOTE/MEME CARD STRIP (Posts tab + Dashboard tab)
       ─────────────────────────────────────────────────────────────────────
       FEATURE (this session — "the quote and meme avatar card from the
       quick post and profile page post... currently appears vertically in
       the general dashboard... make it slide horizontally at the middle").
       NOT the Status/Story bar's own Quote/Meme statuses (app-status.js,
       #status-bar-container) — those are a separate, unrelated feature
       this session explicitly left untouched. This is specifically for
       ordinary POSTS created via the Quote/Meme Card composer (the
       "Quote Card" button in Quick Post and in this profile page's own
       post composer above — both call window.EmpQuoteCard.open(), and the
       resulting file is now tagged isQuoteCard:true — see app-fixes.js's
       _insertCard() and this file's own profile-post submit handler
       above).

       Same horizontally-swipeable, auto-sliding, mid-feed-positioned strip
       as the Reels one directly above (reuses the exact same
       .horizontal-slider-container/.horizontal-slider-wrapper scroll-snap
       CSS) — separate cache/state objects so the two strips never collide,
       but otherwise a deliberate mirror of that working, already-hardened
       implementation (same staleness-token + duplicate-DOM-cleanup fixes
       apply here for the same reasons).
       ========================================================================= */

    var _quoteMemeCache        = {};   // userId -> { ts, cards: [...] }
    var QUOTE_MEME_CACHE_TTL_MS = 60000;
    var _quoteMemeStrips        = {};  // feedId -> { interval, observer }
    /* FIX (this session — strip never appears; console showed
       `document.getElementById(stripId)` is `false`, i.e. the mount never
       ran): tracks whichever userId was last passed to
       _mountProfileFeedQuoteMemeStrip() so the `empyrean:firebase-ready`
       retry below (added for the same reason as app-feed.js's matching
       dashboard-strip fix) knows who to re-fetch for, without needing its
       own closure over renderUserProfile()'s local `userId`. */
    var _quoteMemeStripLastUserId = null;

    /* DOM fallback for when Firestore isn't reachable yet — same idea as
       _domFallbackReels above, scraping whatever quote/meme post cards are
       already rendered in this profile's own feed containers. Regular
       post cards don't carry a data-is-quote-card attribute (there's no
       existing convention for it), so this fallback intentionally returns
       nothing rather than guessing — the strip just doesn't appear until
       the Firestore query succeeds, same as "no reels yet" above. */
    function _fetchOwnerQuoteMemeCards(userId, cb) {
        var cached = _quoteMemeCache[userId];
        if (cached && (Date.now() - cached.ts) < QUOTE_MEME_CACHE_TTL_MS) { cb(cached.cards); return; }

        if (window.fbDb && window._firebaseLoaded) {
            window.fbDb.collection('posts')
                .where('userId', '==', userId)
                .where('isQuoteCard', '==', true)
                .limit(30).get()
                .then(function (snap) {
                    var list = [];
                    var _skippedNoMedia = 0;
                    snap.forEach(function (doc) {
                        var d = doc.data() || {};
                        if (!d.media || !d.media.length) { _skippedNoMedia++; return; }
                        list.push(d);
                    });
                    list = _sortReelsDesc(list); /* same createdAt-desc sort, reused as-is */
                    _quoteMemeCache[userId] = { ts: Date.now(), cards: list };
                    /* DIAGNOSTIC — see app-feed.js's matching dashboard-strip fetch
                       for the full explanation. Safe to leave in permanently. */
                    console.log('[EmpProfile] owner quote/meme fetch: ' + snap.size + ' isQuoteCard doc(s) total, ' + _skippedNoMedia + ' skipped (no media), ' + list.length + ' usable.');
                    cb(list);
                })
                .catch(function (err) {
                    console.warn('[EmpProfile] owner quote/meme card fetch failed:', err && err.message);
                    cb([]);
                });
        } else {
            cb([]);
        }
    }

    /* REVERTED (this session — "you don't understand English... make the
       quote and meme card thumbnail scrollable horizontally at the middle
       ... it continues to disappear"): went back to a lean, self-
       contained thumbnail (avatar+image only) instead of the full
       createNewPostElement()-built post card from the previous pass — see
       app-feed.js's matching dashboard-strip fix for the full reasoning.
       Tapping a card opens the real post — see the wrapper click handler
       in _mountQuoteMemeStripInto below (this thumbnail has no action
       buttons of its own, unlike the full-card version it replaces). */
    function _buildThumbCardEl(post, userId) {
        var avatarFallback = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(post.username || 'U') + '&background=1B2B8B&color=fff&size=80';
        var img = (post.media && post.media[0]) || '';
        var el = document.createElement('div');
        el.className = 'emp-profile-feed-quotecard-card';
        el.dataset.postId = post.id || '';
        el.dataset.userId = post.userId || userId || '';
        el.innerHTML =
            '<img src="' + _attr(img) + '" loading="lazy" alt="" onerror="this.style.display=\'none\';">'
            + '<div class="emp-pfrc-avatar"><img src="' + _attr(post.avatar || avatarFallback) + '" '
            + 'onerror="this.onerror=null;this.src=\'' + avatarFallback + '\';"></div>';
        return el;
    }

    /* Re-run whenever a post is added/removed elsewhere, same "keep the
       strip roughly mid-feed" technique as _repositionReelStrip above,
       parameterised the same way. */
    function _repositionQuoteMemeStrip(feedId, stripId) {
        var feed  = document.getElementById(feedId);
        var strip = document.getElementById(stripId);
        if (!feed || !strip) return;
        var entry = _quoteMemeStrips[feedId] || (_quoteMemeStrips[feedId] = {});
        /* FIX (this session — "cards vanish and reappear... enlargement/
           shrink cycles"): relocating a scrollable strip's DOM node while a
           touch-scroll gesture is active on a descendant of it is enough
           for a mobile browser to cancel that gesture outright (the touch
           stays down, but the hit-tested element got moved out from under
           it) — and this ran on EVERY childList mutation of the feed,
           forever, with no awareness of an in-progress swipe. Skip the move
           while the wrapper reports itself mid-interaction (same
           _empUserInteracting flag the auto-slide below already respects),
           and stop moving the strip at all once things have settled (8s or
           6 calls after mount) — same two-part fix already proven out on
           app-feed.js's dashboard strip. */
        var wrapper = strip.querySelector('.horizontal-slider-wrapper');
        if (wrapper && wrapper._empUserInteracting) return;
        var settleElapsed = Date.now() - (entry.mountedAt || 0);
        var settled = settleElapsed > 8000 || (entry.repositionCount || 0) >= 6;
        if (settled && strip.parentNode === feed) return;
        entry.repositionCount = (entry.repositionCount || 0) + 1;
        var siblings = Array.prototype.filter.call(feed.children, function (c) { return c !== strip; });
        if (!siblings.length) {
            if (strip.parentNode !== feed) feed.appendChild(strip);
            return;
        }
        var anchor = siblings[Math.floor(siblings.length / 2)];
        if (strip.nextSibling !== anchor) feed.insertBefore(strip, anchor);
    }

    function _startQuoteMemeStripAutoSlide(feedId, wrapper) {
        var entry = _quoteMemeStrips[feedId] || (_quoteMemeStrips[feedId] = {});
        if (entry.interval) clearInterval(entry.interval);
        entry.interval = setInterval(function () {
            if (!document.body.contains(wrapper)) { clearInterval(entry.interval); entry.interval = null; return; }
            if (wrapper._empUserInteracting) return;
            if (wrapper.offsetParent === null) return;
            if (!wrapper.children.length) return;
            var cardW = wrapper.firstElementChild.getBoundingClientRect().width + 12;
            var atEnd = wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - 4;
            wrapper.scrollTo({ left: atEnd ? 0 : (wrapper.scrollLeft + cardW), behavior: 'smooth' });
        }, 4000); /* slightly offset from the reel strip's 3500ms so the two don't visually tick in lockstep when both are on screen */
    }

    function _mountQuoteMemeStripInto(feedId, stripId, wrapperId, userId, cards) {
        var feed = document.getElementById(feedId);
        if (!feed) return;

        var entry = _quoteMemeStrips[feedId] || (_quoteMemeStrips[feedId] = {});
        entry.mountedAt        = Date.now();
        entry.repositionCount = 0;

        var strip = document.createElement('div');
        strip.id        = stripId;
        strip.className = 'card emp-profile-reel-strip-card emp-profile-quotecard-strip-card';
        strip.style.cssText = 'margin:4px 0 14px;border-radius:16px;overflow:hidden;';
        /* FIX (2026-09-15 — "reverse the quote and meme card to the
           original vertical positioning instead of the horizontal
           scrollable position that failed to work"): same revert as
           app-feed.js's dashboard strip (see that file's matching
           comment) — inline !important overrides scoped to just this
           strip's own wrapper, since .horizontal-slider-container/
           .horizontal-slider-wrapper are shared with other strips
           elsewhere and style.css itself is never edited directly in
           this app. Each .emp-profile-feed-quotecard-card thumbnail
           below gets the matching per-card override once appended. */
        strip.innerHTML =
            '<div class="emp-pfrs-header">'
            + '<i class="fas fa-quote-right" style="color:#5B0EA6;"></i>'
            + '<strong style="font-size:0.9rem;">Quotes &amp; Memes</strong>'
            + '</div>'
            + '<div class="horizontal-slider-container" style="overflow:visible !important;padding-bottom:0 !important;">'
            + '<div class="horizontal-slider-wrapper" id="' + wrapperId + '" style="display:block !important;overflow-x:visible !important;overflow-y:visible !important;scroll-snap-type:none !important;cursor:default !important;gap:0 !important;padding:8px 16px 4px !important;"></div>'
            + '</div>';

        feed.appendChild(strip);

        /* Each slide is a self-contained .emp-profile-feed-quotecard-card
           thumbnail (see _buildThumbCardEl above) built straight from the
           Firestore post doc. Its own CSS (.emp-profile-feed-quotecard-card
           in style.css) is a fixed 128x172px horizontal-strip tile —
           flex:0 0 auto, width:128px. Widened to full-width/auto-height
           here so it reads as a normal stacked card instead of a cropped
           square once the strip itself is vertical; the avatar-overlay
           and image styling inside it are untouched. */
        var wrapper = document.getElementById(wrapperId);
        if (wrapper) {
            cards.forEach(function (post) {
                try {
                    var _qmThumbEl = _buildThumbCardEl(post, userId);
                    _qmThumbEl.style.cssText += ';flex:none !important;width:100% !important;height:auto !important;min-height:172px !important;margin:0 0 12px !important;';
                    wrapper.appendChild(_qmThumbEl);
                }
                catch (e) { console.warn('[EmpProfile] quote/meme thumbnail build failed for post ' + (post && post.id) + ':', e && e.message); }
            });
        }

        _repositionQuoteMemeStrip(feedId, stripId);

        if (wrapper) {
            /* FIX (this session — same root cause as app-feed.js's dashboard
               quote/meme strip, see that file's matching fix/comment):
               app-fixes.js's generic initSliderDragScroll() catch-all was
               also attaching to this wrapper and fighting its own dedicated
               swipe/auto-slide handling below. Marking it here tells that
               generic handler (see its own updated attachDragScroll/
               startAutoSwipe) to leave it alone. */
            wrapper._empOwnSwipeHandling = true;
            ['touchstart', 'pointerdown', 'mousedown'].forEach(function (evt) {
                wrapper.addEventListener(evt, function () { wrapper._empUserInteracting = true; }, { passive: true });
            });
            ['touchend', 'pointerup', 'mouseup'].forEach(function (evt) {
                wrapper.addEventListener(evt, function () {
                    setTimeout(function () { wrapper._empUserInteracting = false; }, 2500);
                }, { passive: true });
            });
            /* Tapping a thumbnail opens the real post. */
            wrapper.addEventListener('click', function (e) {
                var card = e.target.closest('.emp-profile-feed-quotecard-card');
                if (!card) return;
                var postId = card.dataset.postId;
                if (postId && typeof window.openPostById === 'function') window.openPostById(postId);
            });
            /* FIX (2026-09-15 — vertical revert, see the strip-build
               comment above): _startQuoteMemeStripAutoSlide() calls
               wrapper.scrollTo({left: ...}) on a timer — meaningless now
               that the wrapper no longer scrolls horizontally, so it's
               skipped rather than left running a pointless interval. */
        }

        entry.observer = new MutationObserver(function () {
            clearTimeout(feed._pfqmsRepositionTimer);
            feed._pfqmsRepositionTimer = setTimeout(function () { _repositionQuoteMemeStrip(feedId, stripId); }, 200);
        });
        entry.observer.observe(feed, { childList: true });
    }

    var _quoteMemeStripMountToken     = 0;
    var _quoteMemeStripLastSignature = null;
    function _mountProfileFeedQuoteMemeStrip(userId) {
        /* REVERTED (this session — "revert it back to the vertical
           positioning that was working perfectly before"): the horizontal
           quote/meme strip never rendered reliably and duplicated content
           now that app-feed.js's main posts listener no longer skips
           isQuoteCard posts — those posts render as ordinary vertical
           cards (mirrored into profile-dash-feed/profile-posts-feed the
           same way every other own post is) instead. Disarmed here rather
           than deleted; flip this return off to bring the strip back. */
        return;

        var _myMountToken = ++_quoteMemeStripMountToken;
        _quoteMemeStripLastUserId = userId; // see the empyrean:firebase-ready retry below

        var targets = [
            { feedId: 'profile-posts-feed', stripId: 'profile-feed-quotecard-strip',      wrapperId: 'profile-feed-quotecard-strip-wrapper' },
            { feedId: 'profile-dash-feed',  stripId: 'profile-dash-feed-quotecard-strip', wrapperId: 'profile-dash-feed-quotecard-strip-wrapper' }
        ].filter(function (t) { return !!document.getElementById(t.feedId); });
        if (!targets.length) return;

        _fetchOwnerQuoteMemeCards(userId, function (cards) {
            if (_myMountToken !== _quoteMemeStripMountToken) return;
            if (!cards.length) return;
            /* FIX (this session — "cards vanish and reappear"): the strip
               used to be torn out of the DOM the instant this function was
               called, THEN rebuilt once this fetch resolved — so any
               re-trigger of an already-successful strip (e.g. the
               empyrean:firebase-ready retry below landing after the strip
               is already up) produced a visible remove-then-re-add flash
               even though nothing had actually changed. Skip the
               teardown/rebuild entirely when every target strip is already
               mounted showing this exact same set of cards. */
            var sig = userId + '|' + cards.map(function (p) { return p.id; }).join(',');
            var allMounted = targets.every(function (t) { return !!document.getElementById(t.stripId); });
            if (allMounted && _quoteMemeStripLastSignature === sig) return;
            _quoteMemeStripLastSignature = sig;

            Object.keys(_quoteMemeStrips).forEach(function (feedId) {
                var entry = _quoteMemeStrips[feedId];
                if (entry.interval) clearInterval(entry.interval);
                if (entry.observer) entry.observer.disconnect();
            });
            _quoteMemeStrips = {};

            targets.forEach(function (t) {
                document.querySelectorAll('#' + t.stripId).forEach(function (el) { el.remove(); });
                if (!document.getElementById(t.feedId)) return;
                _mountQuoteMemeStripInto(t.feedId, t.stripId, t.wrapperId, userId, cards);
            });
        });
    }
    window._mountProfileFeedQuoteMemeStrip = _mountProfileFeedQuoteMemeStrip;

    /* FIX (this session — strip never appears on the profile page,
       console-confirmed `document.getElementById(stripId)` is `false`):
       renderUserProfile() calls _mountProfileFeedQuoteMemeStrip() exactly
       once, 560ms after building the profile DOM — see that call site's
       own comment. _fetchOwnerQuoteMemeCards() bails with `cb([])` the
       instant `window.fbDb && window._firebaseLoaded` isn't true yet (no
       DOM fallback exists for this strip, unlike the reel strip's
       _domFallbackReels just above), and on a slow connection (this
       session's own screenshots: 4G bouncing 3.5-3.9 M/s) 560ms after
       first render can easily still land before Firebase has finished its
       own async /api/config fetch + initializeApp(). Since nothing else
       ever re-calls the mount function afterwards, that single miss was
       permanent for the rest of that profile visit. Retrying on
       `empyrean:firebase-ready` (dispatched by firebase-init.js's
       `_initFirebase()` the instant it actually succeeds — same event
       app-fixes.js's syncLiveStreamsFromFirestore already retries on for
       the identical reason) closes that gap without touching the working
       CSS/swipe-handling fixes already in place for this strip. Guarded
       on _quoteMemeStripLastUserId so this is a no-op until a profile has
       actually been rendered at least once. */
    window.addEventListener('empyrean:firebase-ready', function () {
        if (!_quoteMemeStripLastUserId) return;
        setTimeout(function () { _mountProfileFeedQuoteMemeStrip(_quoteMemeStripLastUserId); }, 500);
    });

    document.addEventListener('empyrean-section-change', function (ev) {
        if (ev && ev.detail && ev.detail.section !== 'profile') {
            document.body.classList.remove('viewing-other-profile');
        }
    });

    console.log('[EmpProfile] ✅ Profile system ready.');

})();

/* =============================================================================
   FEATURE (2026-10-27 — "quick post social media banner"): window.EmpSocialBanner
   One shared module used by BOTH composers (the profile-page "Share a Moment" composer and the dashboard
   Quick Post modal, which are the same composer). A person picks WhatsApp / Telegram / Facebook / X /
   LinkedIn / YouTube, types a number or link and an optional headline; the post is saved with
   hasSocialBanner:true + socialBanner:{net,url,value,headline} on the SAME `posts` document (no new
   Firestore collection, so no new security rule is needed). mountRail() then shows those banners as
   white cards above the public dashboard feed. Styles are injected here (style.css is not edited).
   Every link is re-validated against an allow-list of hosts both when saved and when rendered. */
(function () {
    'use strict';
    if (window.EmpSocialBanner) return;

    function ic(d) { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; }
    var NETS = {
        whatsapp: { label: 'WhatsApp', cta: 'Chat', ph: 'WhatsApp number (+234 801 234 5678) or link', hosts: ['wa.me', 'whatsapp.com'],
            icon: ic('<path d="M4 20l1.2-4A8 8 0 1 1 8 19z"/><path d="M9.5 9c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-.8.7c-.8-.3-1.5-1-1.8-1.8l.7-.9-1-2z"/>') },
        telegram: { label: 'Telegram', cta: 'Open', ph: 'Telegram @username or t.me link', hosts: ['t.me', 'telegram.me'],
            icon: ic('<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>') },
        facebook: { label: 'Facebook', cta: 'Visit', ph: 'Facebook page or profile link', hosts: ['facebook.com', 'fb.com', 'fb.me'],
            icon: ic('<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z"/>') },
        x: { label: 'X (Twitter)', cta: 'Follow', ph: 'X (Twitter) @handle or profile link', hosts: ['x.com', 'twitter.com'],
            icon: ic('<path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/>') },
        linkedin: { label: 'LinkedIn', cta: 'Connect', ph: 'LinkedIn profile or company link', hosts: ['linkedin.com', 'lnkd.in'],
            icon: ic('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-7M12 13a3 3 0 0 1 6 0v4"/>') },
        youtube: { label: 'YouTube', cta: 'Watch', ph: 'YouTube channel or video link', hosts: ['youtube.com', 'youtu.be'],
            icon: ic('<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.5l5 2.5-5 2.5z"/>') },
        tiktok: { label: 'TikTok', cta: 'Follow', ph: 'TikTok @username or profile link', hosts: ['tiktok.com'],
            icon: ic('<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.5 3 2.5 4.5 5 4.5"/>') },
        instagram: { label: 'Instagram', cta: 'Follow', ph: 'Instagram @username or profile link', hosts: ['instagram.com', 'instagr.am'],
            icon: ic('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5v.01"/>') }
    };
    var ORDER = ['whatsapp', 'telegram', 'facebook', 'x', 'linkedin', 'youtube', 'tiktok', 'instagram'];

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    /* Returns a safe https URL for the network, or null when the value isn't acceptable. */
    function norm(net, raw) {
        var n = NETS[net], v = String(raw || '').trim();
        if (!n || !v) return null;
        if (net === 'whatsapp') {
            var d = v.replace(/[\s().-]/g, '');
            if (/^\+?\d{7,15}$/.test(d)) {
                d = d.replace('+', '');
                if (/^0\d{10}$/.test(d)) d = '234' + d.slice(1); /* local Nigerian format */
                return 'https://wa.me/' + d;
            }
        }
        if (net === 'telegram' && /^@?[A-Za-z0-9_]{4,32}$/.test(v)) return 'https://t.me/' + v.replace('@', '');
        if (net === 'x' && /^@?[A-Za-z0-9_]{1,15}$/.test(v)) return 'https://x.com/' + v.replace('@', '');
        if (net === 'tiktok' && /^@?[A-Za-z0-9_.]{2,24}$/.test(v)) return 'https://www.tiktok.com/@' + v.replace('@', '');
        if (net === 'instagram' && /^@?[A-Za-z0-9_.]{1,30}$/.test(v)) return 'https://instagram.com/' + v.replace('@', '');
        var u = /^https?:\/\//i.test(v) ? v : 'https://' + v, a;
        try { a = new URL(u); } catch (e) { return null; }
        var h = a.hostname.toLowerCase().replace(/^www\./, '');
        var ok = n.hosts.some(function (x) { return h === x || h.slice(-(x.length + 1)) === '.' + x; });
        if (!ok) return null;
        a.protocol = 'https:';
        return a.href;
    }

    function css() {
        if (document.getElementById('esb-css')) return;
        var s = document.createElement('style');
        s.id = 'esb-css';
        s.textContent = [
            '.esb-box{background:#fff;border:1px solid #D5DAF0;border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px;box-sizing:border-box;color:#0A0E39;font-family:inherit}',
            '.esb-lbl{font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5A6385}',
            '.esb-chips{display:flex;flex-wrap:wrap;gap:8px}',
            '.esb-chip{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 13px;border-radius:999px;border:1px solid #D5DAF0;background:#fff;color:#0A0E39;font:600 .8rem inherit;font-family:inherit;cursor:pointer}',
            '.esb-chip svg{width:16px;height:16px}',
            '.esb-chip[aria-pressed="true"]{background:#1B2B8B;border-color:#1B2B8B;color:#fff}',
            '.esb-in{width:100%;box-sizing:border-box;min-height:44px;border:1px solid #D5DAF0;border-radius:12px;padding:10px 12px;background:#fff;color:#0A0E39;font:500 .9rem inherit;font-family:inherit;outline:none}',
            '.esb-in:focus{border-color:#1B2B8B}',
            '.esb-err{font-size:.78rem;color:#B42318;min-height:0}',
            '.esb-card{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #D5DAF0;border-radius:16px;padding:12px 14px;box-sizing:border-box}',
            '.esb-ico{width:44px;height:44px;border-radius:12px;background:#1B2B8B;color:#fff;display:flex;align-items:center;justify-content:center;flex:none}',
            '.esb-txt{flex:1;min-width:0}',
            '.esb-h{font-weight:700;font-size:.92rem;color:#0A0E39;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '.esb-s{font-size:.74rem;color:#5A6385;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '.esb-go{flex:none;display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 14px;border-radius:999px;border:1px solid #1B2B8B;color:#1B2B8B;background:#fff;font-weight:700;font-size:.8rem;text-decoration:none}',
            '#esb-rail{margin:0 0 16px;display:flex;flex-direction:column;gap:10px}',
            '#esb-rail .esb-more{align-self:center;background:none;border:1px solid #D5DAF0;border-radius:999px;min-height:40px;padding:0 16px;color:#1B2B8B;font-weight:600;font-size:.8rem;cursor:pointer}'
        ].join('');
        document.head.appendChild(s);
    }

    function card(b, who, live) {
        var n = NETS[b.net] || NETS.whatsapp;
        var sub = n.label + (who ? ' \u00B7 ' + esc(who) : '');
        var go = live ? '<a class="esb-go" href="' + esc(b.url) + '" target="_blank" rel="noopener noreferrer nofollow">' + n.cta + '</a>'
                      : '<span class="esb-go">' + n.cta + '</span>';
        return '<div class="esb-card"><div class="esb-ico">' + n.icon + '</div><div class="esb-txt"><div class="esb-h">' + esc(b.headline) + '</div><div class="esb-s">' + sub + '</div></div>' + go + '</div>';
    }

    /* Builds the panel inside `host` and returns { get, reset }.
       get(): null = nothing entered, false = entered but invalid (message shown), object = banner to save. */
    function attach(host) {
        if (!host) return null;
        css();
        var net = 'whatsapp';
        host.innerHTML = '<div class="esb-box"><div class="esb-lbl">Share your contact banner</div>'
            + '<div class="esb-chips">' + ORDER.map(function (k) { return '<button type="button" class="esb-chip" data-net="' + k + '" aria-pressed="false">' + NETS[k].icon + NETS[k].label + '</button>'; }).join('') + '</div>'
            + '<input type="text" class="esb-in esb-val" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Number or link">'
            + '<input type="text" class="esb-in esb-head" maxlength="60" placeholder="Banner headline (e.g. Join our community)" aria-label="Banner headline">'
            + '<div class="esb-lbl">Live preview</div><div class="esb-prev"></div><div class="esb-err" role="alert"></div></div>';
        var val = host.querySelector('.esb-val'), head = host.querySelector('.esb-head'), prev = host.querySelector('.esb-prev'), err = host.querySelector('.esb-err');
        var chips = Array.prototype.slice.call(host.querySelectorAll('.esb-chip'));
        function me() { var u = (window.userState || {}); return u.fullName || u.username || ''; }
        function headline() { return head.value.trim() || ('Connect on ' + NETS[net].label); }
        function paint() {
            chips.forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-net') === net ? 'true' : 'false'); });
            val.placeholder = NETS[net].ph;
            val.setAttribute('inputmode', net === 'whatsapp' ? 'tel' : 'url');
            var raw = val.value.trim(), url = raw ? norm(net, raw) : null;
            prev.innerHTML = card({ net: net, url: url || '#', headline: headline() }, me(), false);
            err.textContent = '';
        }
        chips.forEach(function (c) { c.addEventListener('click', function () { net = c.getAttribute('data-net'); paint(); }); });
        val.addEventListener('input', paint); head.addEventListener('input', paint);
        paint();
        return {
            get: function () {
                var raw = val.value.trim();
                if (!raw) return null;
                var url = norm(net, raw);
                if (!url) { err.textContent = 'Enter a valid ' + NETS[net].label + (net === 'whatsapp' ? ' number or link.' : ' link.'); val.focus(); return false; }
                return { net: net, url: url, value: raw.slice(0, 120), headline: headline() };
            },
            reset: function () { val.value = ''; head.value = ''; net = 'whatsapp'; paint(); }
        };
    }

    var railBusy = false;
    function mountRail() {
        var feed = document.getElementById('feed-container');
        if (!feed || railBusy || !(window.fbDb && window._firebaseLoaded)) return;
        railBusy = true;
        css();
        window.fbDb.collection('posts').where('hasSocialBanner', '==', true).limit(40).get().then(function (snap) {
            var seen = {}, list = [];
            snap.forEach(function (d) { var p = d.data(); if (p && p.socialBanner) list.push(p); });
            list.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
            var items = [];
            list.forEach(function (p) {
                var b = p.socialBanner, url = norm(b.net, b.url);
                var key = (p.userId || '') + '|' + b.net;
                if (!url || seen[key] || items.length >= 12) return;
                seen[key] = 1;
                items.push({ b: { net: b.net, url: url, headline: String(b.headline || '').slice(0, 60) || ('Connect on ' + NETS[b.net].label) }, who: p.username || '' });
            });
            var rail = document.getElementById('esb-rail');
            if (!items.length) { if (rail) rail.remove(); return; }
            if (!rail) {
                rail = document.createElement('div');
                rail.id = 'esb-rail';
                var anchor = feed.closest('.card') || feed;
                anchor.parentNode.insertBefore(rail, anchor);
            }
            function draw(all) {
                var shown = all ? items : items.slice(0, 3);
                rail.innerHTML = '<div class="esb-lbl">Connect with the public</div>' + shown.map(function (it) { return card(it.b, it.who, true); }).join('')
                    + (!all && items.length > 3 ? '<button type="button" class="esb-more">Show ' + (items.length - 3) + ' more</button>' : '');
                var m = rail.querySelector('.esb-more'); if (m) m.addEventListener('click', function () { draw(true); });
            }
            draw(false);
        }).catch(function () {}).then(function () { railBusy = false; });
    }

    window.EmpSocialBanner = { attach: attach, refresh: function () { setTimeout(mountRail, 800); }, mountRail: mountRail, norm: norm };
    window.addEventListener('empyrean:firebase-ready', function () { setTimeout(mountRail, 600); });
    document.addEventListener('empyrean-section-change', function (ev) { if (ev && ev.detail && ev.detail.section === 'dashboard') setTimeout(mountRail, 300); });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(mountRail, 1800); });
    else setTimeout(mountRail, 1800);
})();
