/* =============================================================================
   EMPYREAN INTERNATIONAL — SOCIAL FEED
   app-feed.js  |  Step 0.8  |  Refactor Roadmap v1.0
   =============================================================================

   PURPOSE
   ───────
   Complete social feed system extracted from app-fixes.js.  Covers:

     • Post card builder — createNewPostElement()
     • SOS feed card — createSosPostOnFeed()
     • Crisis feed card — createCrisisPostOnFeed()
     • All 8 real-time Firestore onSnapshot listeners — _startRealtimeListeners()
         posts | news | marketplace | reels | sos_queue | crisis_reports
         announcements | users
     • Dashboard news slider — renderDashboardNews()
     • Suggested users widget — renderSuggestedUsers()
     • Profile gallery URL accumulator — _addUrlsToProfileGallery()
     • Reel viewer — setupReelViewerObserver() + openReelViewer()
     • View-count IntersectionObserver setup

   LOAD ORDER
   ──────────
   ... all prior modules (state, helpers, contracts, notifications, tags,
       dom, auth) must be loaded before this file.
   <script src="app-feed.js">

   DEPENDS ON
   ──────────
   • window.fbDb / window._firebaseLoaded (firebase-init.js)
   • window.EmpState / window.userState / window.isGuest / window.isAdmin
   • window.formatWhatsAppText   (app-helpers.js)
   • window.handleYoutubeEmbed   (app-tags.js)
   • window.showNotification     (app-helpers.js)
   • window.pushNotification     (app-notifications.js)
   • window._processPostTags     (app-tags.js)
   • window.renderUserProfile    (app-profile.js)
   • window.navigateTo           (app-dom.js)
   • window.createSosPostOnFeed  — defined here, used by sos listener
   • window.createCrisisPostOnFeed — defined here, used by crisis listener
   • window._scheduleListenerRetry (app-auth.js)

   PUBLIC API
   ──────────
   window.createNewPostElement(text, mediaFiles, authorData, isBusinessPost, retweetData)
   window.createSosPostOnFeed(sosData)
   window.createCrisisPostOnFeed(crisisData)
   window._startRealtimeListeners()
   window.renderDashboardNews()
   window.renderSuggestedUsers()
   window._addUrlsToProfileGallery(urls)
   window.setupReelViewerObserver()
   window.openReelViewer(clickedCard)

   SECTION MAP
   ───────────
   §1  Post card builder — createNewPostElement
   §2  SOS post card — createSosPostOnFeed
   §3  Crisis report card — createCrisisPostOnFeed
   §4  Realtime listeners — _startRealtimeListeners (8 collections)
   §5  Dashboard news slider — renderDashboardNews
   §6  Suggested users widget — renderSuggestedUsers
   §7  Profile gallery helper — _addUrlsToProfileGallery
   §8  Reel viewer — setupReelViewerObserver + openReelViewer
   §9  View-count observer

   ============================================================================= */

(function empyreanFeedModule() {
    'use strict';

    if (window._empyreanFeedLoaded) {
        console.warn('[EmpFeed] Already loaded — skipping duplicate.');
        return;
    }
    window._empyreanFeedLoaded = true;

    /* Shorthand state accessors */
    function _S()       { return window.EmpState || {}; }
    function _us()      { return _S().userState  || window.userState  || {}; }
    function _isGuest() { var s=_S(); return s.isGuest != null ? s.isGuest : window.isGuest; }
    function _isAdmin() { var s=_S(); return s.isAdmin != null ? s.isAdmin : window.isAdmin; }

    /* ── CSS — comment-section bottom sheet (was unstyled inline block) ── */
    (function _commentSheetCss() {
        if (document.getElementById('_feed_comment_sheet_style')) return;
        var s = document.createElement('style');
        s.id = '_feed_comment_sheet_style';
        s.textContent = [
            /* Backdrop, click-to-dismiss */
            '.comment-sheet-backdrop { position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9499;display:none; }',
            '.comment-sheet-backdrop.open { display:block; }',
            /* Bottom sheet itself — fixed to viewport, grows up to 50vh and stops */
            '.comment-section { position:fixed;left:0;right:0;bottom:0;top:auto;background:#fff;border-radius:18px 18px 0 0;max-height:50vh;min-height:0;display:flex !important;flex-direction:column;transform:translateY(100%);transition:transform 0.28s ease;z-index:9500;box-shadow:0 -4px 28px rgba(10,14,39,0.18); }',
            '.comment-section.open { transform:translateY(0); }',
            /* Header: title + close (X) button */
            '.comment-sheet-header { display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(10,14,39,0.08);flex-shrink:0; }',
            '.comment-sheet-header .comment-sheet-title { font-weight:700;font-size:0.98rem;color:var(--primary);font-family:inherit; }',
            '.comment-sheet-close-btn { background:rgba(10,14,39,0.06);border:none;cursor:pointer;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--primary);font-size:0.95rem;flex-shrink:0; }',
            '.comment-sheet-close-btn:active { background:rgba(10,14,39,0.12); }',
            /* Scrollable list, grows then scrolls once content exceeds the 50vh cap */
            '.comment-list { flex:1;overflow-y:auto;padding:12px 16px;scrollbar-width:thin; }',
            '.comment-list p { color:var(--text-muted); }',
            /* Input row pinned to the bottom of the sheet.
               Scoped to .comment-section > .comment-form (the top-level form)
               so nested ._inline_reply_form replies — which share the
               .comment-form class but live inside a comment thread, not the
               sheet shell — are not forced into this fixed bottom-row layout. */
            '.comment-section > .comment-form { display:flex !important;gap:10px;align-items:center;padding:10px 16px;border-top:1px solid rgba(10,14,39,0.08);flex-shrink:0;background:#fff;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px)); }',
            '.comment-section > .comment-form input[name="comment-text"] { flex:1;border:1px solid rgba(10,14,39,0.15);border-radius:50px;padding:9px 14px;font-size:0.88rem;outline:none;color:var(--primary); }',
            '.comment-section > .comment-form button[type="submit"] { background:var(--secondary);border:none;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0; }',
            '.comment-section > .comment-form button[type="submit"] svg { stroke:#fff; }',
        ].join('\n');
        document.head.appendChild(s);
        /* Single shared backdrop element, reused by every post card's sheet */
        if (!document.querySelector('.comment-sheet-backdrop')) {
            var bd = document.createElement('div');
            bd.className = 'comment-sheet-backdrop';
            document.body.appendChild(bd);
        }
    })();

    /* ── CSS — Content Control: restrict-media tap-to-reveal overlay ──
       FEATURE (2026-09-12): same self-contained <style>-injection pattern
       as _commentSheetCss right above (no index.html/style.css edits
       needed — one guarded <style id> tag, safe to load in any order). */
    (function _ccMediaRestrictCss() {
        if (document.getElementById('_cc_media_restrict_style')) return;
        var s = document.createElement('style');
        s.id = '_cc_media_restrict_style';
        s.textContent = [
            '.cc-media-restricted { position:relative; }',
            '.cc-media-restricted .cc-media-restricted-inner { filter:blur(28px) brightness(0.6); pointer-events:none; user-select:none; }',
            '.cc-media-restricted.cc-revealed .cc-media-restricted-inner { filter:none; pointer-events:auto; }',
            '.cc-media-restricted.cc-revealed .cc-media-restricted-overlay { display:none; }',
            '.cc-media-restricted-overlay { position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:#fff;cursor:pointer;background:rgba(10,14,39,0.25);z-index:3; }',
            '.cc-media-restricted-overlay i { font-size:1.4rem; }',
            '.cc-media-restricted-overlay span { font-weight:700;font-size:0.88rem; }',
            '.cc-media-restricted-overlay small { font-size:0.72rem;opacity:0.85; }',
        ].join('\n');
        document.head.appendChild(s);
    })();

    /* ── Content Control: live removal when a user is blocked mid-session ──
       FEATURE (2026-09-12): app-dom.js's blockUser() dispatches this event
       after writing to Firestore. The posts onSnapshot listener's own
       block check (see _startRealtimeListeners below) only stops FUTURE
       doc-change events for a newly-blocked author — anything already
       rendered before the block happened stays in the DOM until reload
       without this, which is confusing right after tapping Block from a
       post you're currently looking at. */
    document.addEventListener('empyrean-content-control-changed', function (e) {
        var d = e && e.detail;
        if (!d || d.type !== 'block' || !d.active || !d.targetId) return;
        document.querySelectorAll('.impact-story[data-user-id="' + d.targetId + '"]').forEach(function (el) { el.remove(); });
    });


    /* =========================================================================
       §1  POST CARD BUILDER
       ========================================================================= */

    /**
     * Build and return a fully-rendered .impact-story <div> element.
     * Does NOT insert it into the DOM — caller is responsible for placement.
     *
     * @param {string}      text            — Raw post text (markdown + @mention + #tag)
     * @param {Array}       mediaFiles      — File objects or { _cloudUrl, url, type } objects
     * @param {Object|null} authorData      — { id, fullName, avatar, businessPage? }
     *                                        Defaults to current userState
     * @param {boolean}     isBusinessPost  — If true, uses business page avatar/name
     * @param {Object|null} retweetData     — { retweeterName } if this is a retweet
     * @returns {HTMLElement}
     */
    function createNewPostElement(text, mediaFiles, authorData, isBusinessPost, retweetData, createdAt) {
        isBusinessPost = isBusinessPost || false;
        retweetData    = retweetData    || null;

        const us     = _us();
        const author = authorData || us;

        const avatar = isBusinessPost
            ? (author.businessPage ? author.businessPage.profilePhoto
                : 'https://ui-avatars.com/api/?name=Business&background=5B0EA6&color=fff&size=150')
            : (author.avatar || author.logo
                || ('https://ui-avatars.com/api/?name='
                    + encodeURIComponent(author.fullName || 'U')
                    + '&background=5B0EA6&color=fff&size=150'));

        const name   = isBusinessPost
            ? (author.businessPage ? author.businessPage.name : 'Business Page')
            : (author.fullName || author.name || 'User');

        /* ── Text processing ── */
        const preprocessed = (text || '')
            .replace(/==(.*?)==/g,
                '<mark style="background:rgba(245,197,24,0.3);padding:1px 4px;border-radius:3px;">$1</mark>')
            .replace(/__(.*?)__/g, '<u>$1</u>');

        const ytResult = (typeof window.handleYoutubeEmbed === 'function')
            ? window.handleYoutubeEmbed(preprocessed)
            : { html: '<p>' + (typeof window.formatWhatsAppText === 'function'
                ? window.formatWhatsAppText(preprocessed) : preprocessed) + '</p>', found: false };

        const formattedText = ytResult.html;
        const youtubeFound  = ytResult.found;

        /* ── Read-more truncation ──
           REWORKED: this used to hand-cut the HTML at ~280 characters, which
           is a poor proxy for "how many lines does this actually take up"
           (depends on font size, container width, wrapping, emoji, etc.) and
           only worked for posts built through this exact function -- so
           other post types silently got no truncation at all.
           Truncation is now handled globally in app-fixes.js: a single
           MutationObserver watches for ANY ".story-content"/".news-item-content"
           landing in the DOM (regardless of which renderer built it),
           measures the ACTUAL rendered line count of the text, and only
           then adds the chevron toggle -- so every post gets consistent,
           accurate "after 10 lines" behaviour with one shared implementation.
           This function is kept as a passthrough so the call site below
           doesn't need to change. */
        function _withReadMore(html) {
            return html;
        }


        /* ── Media HTML ── */
        let mediaHTML = '';
        if (mediaFiles && mediaFiles.length > 0) {
            const mc = mediaFiles.length;
            const ml = mc === 1 ? 'solo' : mc === 2 ? 'duo' : mc === 3 ? 'trio' : 'grid';
            mediaHTML = '<div class="story-media-container" data-count="' + mc + '" data-layout="' + ml + '">';
            mediaFiles.forEach(function (file, mi) {
                let url, mimeType, isFreshLocalPreview = false;
                if (typeof file === 'string') {
                    url = file;
                    mimeType = (/\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(file) || /\/video\/upload\//i.test(file))
                        ? 'video/' : 'image/';
                } else if (file && file._cloudUrl) {
                    url = file._cloudUrl; mimeType = file.type || '';
                } else if (file && file.url) {
                    url = file.url; mimeType = file.type || '';
                } else if (file instanceof File) {
                    url = URL.createObjectURL(file); mimeType = file.type || '';
                    isFreshLocalPreview = true;
                } else { return; }
                // BUGFIX: a blob: URL freshly minted above from a real File
                // object (isFreshLocalPreview) is exactly the instant local
                // preview this function is supposed to show -- it used to be
                // discarded by this same guard, so "immediate preview while
                // uploading" never actually rendered anything. We still
                // reject blob: strings that arrive as already-stored data
                // (e.g. loaded back from Firestore/localStorage), since those
                // reference a browser session that's gone and would 404.
                if (!url || (url.startsWith('blob:') && !isFreshLocalPreview)) return;

                const isVid = mimeType.startsWith('video/')
                    || /\/video\/upload\//i.test(url)
                    || /\.(mp4|webm|ogg|mov|avi|mkv)(\?|$)/i.test(url);

                mediaHTML += '<div class="story-media-item" data-index="' + mi + '">';
                if (isVid) {
                    mediaHTML += '<video src="' + url + '" class="story-video" controls preload="metadata"'
                        + ' loading="lazy" playsinline onerror="this.closest(\'.story-media-item\').style.display=\'none\'"></video>';
                } else {
                    mediaHTML += '<img src="' + url + '" class="story-main-image" alt="Post media"'
                        + ' loading="lazy" onerror="this.closest(\'.story-media-item\').style.display=\'none\'">';
                }
                mediaHTML += '</div>';
            });
            mediaHTML += '</div>';
        }

        /* FEATURE (2026-09-12 — Content Control: restrict media, WhatsApp-
           style): if I've restricted this author's media, the post itself
           (text/likes/comments) still shows normally — only the media is
           hidden behind a tap-to-reveal overlay. Never applied to my own
           posts (author.id === us.id). Self-contained inline onclick
           (matching this codebase's existing inline onerror= convention
           just above) rather than a new delegated-click entry, since
           reveal is a pure same-element DOM toggle with no state to
           persist. */
        if (mediaHTML && author.id && author.id !== us.id
            && typeof window.isUserMediaRestricted === 'function' && window.isUserMediaRestricted(author.id)) {
            mediaHTML = '<div class="cc-media-restricted">'
                + '<div class="cc-media-restricted-inner">' + mediaHTML + '</div>'
                + '<div class="cc-media-restricted-overlay" onclick="this.closest(\'.cc-media-restricted\').classList.add(\'cc-revealed\')">'
                + '<i class="fas fa-lock"></i><span>Media hidden</span><small>Tap to view</small>'
                + '</div></div>';
        }

        /* ── Retweet / Quote embed header & card ── */
        const isQuotePost = retweetData && retweetData.isQuote;
        const isRetweetPost = retweetData && !retweetData.isQuote;

        /* FEATURE (report — "clicking the original tweeted axis should take
           users to the original post"): the "X Retweeted" banner previously
           carried no reference at all to which post it was retweeting — a
           tap on it just fell through to the generic "open this card's own
           thread" handler (app-thread.js). data-orig-post-id here is what
           lets a dedicated click handler (app-thread.js) send the tap to
           the ORIGINAL post's thread instead. cursor:pointer is a visual
           affordance only; the actual navigation is wired in app-thread.js
           so it can stay in one place alongside the identical quote-embed
           handler below. */
        /* UPDATED (2026-10-18 — "a quoted, retweeted or reposted post should show at the top to indicate"):
           the top banner used to exist only for plain retweets, so a quote post looked like an ordinary post.
           Now BOTH kinds show a small label row above the card header: a repost shows "<name> reposted" with the
           repost icon, a quote shows "<name> quoted a post" with a quote icon. Same row, same style, same
           tap-to-open-original behaviour (data-orig-post-id is handled by app-thread.js). */
        const _rtOrigId = isRetweetPost
            ? (retweetData.origPostId || '')
            : (isQuotePost && retweetData.originalPost ? (retweetData.originalPost.id || retweetData.originalPost.postId || '') : '');
        const retweetHeaderHTML = (isRetweetPost || isQuotePost)
            ? '<div class="retweet-header ' + (isQuotePost ? 'rt-quote' : 'rt-repost') + '"'
                + (_rtOrigId ? ' data-orig-post-id="' + _attr(_rtOrigId) + '"' : '')
                + ' style="display:flex;align-items:center;gap:7px;'
                + 'padding:10px 16px 0;font-size:0.76rem;font-weight:600;letter-spacing:0.01em;color:#5B6478;'
                + 'border-bottom:none;' + (_rtOrigId ? 'cursor:pointer;' : '') + '">'
                + (isQuotePost
                    ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#1B2B8B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.76 2 2 2h3"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.76 2 2 2h3"/></svg>'
                    : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#1B2B8B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>')
                + '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
                /* UPDATED (2026-10-20): a quote's card header already names the person who quoted, so repeating
                   their name right above it ("Abisola quoted a post" over "Abisola Abigail") made it read like
                   someone quoting their own post. The label is now role-based: a quote reads "Reposted with a
                   comment" (no repeated name); a plain repost still names who reposted, since the card below
                   belongs to someone else. */
                + (isQuotePost ? 'Reposted with a comment' : '<b style="color:#0A0E27;font-weight:800;">' + _esc(retweetData.retweeterName || name) + '</b> reposted this') + '</span></div>'
            : '';

        /* ── CSS — quote-embed card (reference-mockup upgrade) ──
           FIX (2026-09-16 — "integrate exactly the code and maintain the
           quality... implementation has already started please complete
           it"): the video/play-button markup below (vf-quote-video-wrap /
           vf-quote-embed-img / vf-quote-play-btn / vf-quote-original-pill)
           was already wired up to CALL this function, but the function
           itself was never actually written — every quote-post render was
           throwing "_injectQuoteEmbedStyles is not defined" (uncaught,
           inside createNewPostElement, which is what silently broke
           rendering for any post after a quote post in the same feed
           batch). This defines it, using the exact same self-contained
           <style>-injection pattern already established by
           _commentSheetCss / _ccMediaRestrictCss / _injectSosAmountBadgeStyles
           above (id-guarded, appended to <head> once, no style.css/
           index.html edit needed) — and gives the four classes referenced
           below the reference design's actual look: a bordered, rounded
           card that darkens the "Original" pill to a filled royal-blue
           badge on hover (the group-hover treatment from the reference),
           a full-bleed 16:9 video box with a centered frosted-glass play/
           pause button that fades with playback state, exactly matching
           the reference's togglePlay() + quote-overlay visual quality. */
        function _injectQuoteEmbedStyles() {
            if (document.getElementById('vf-quote-embed-styles')) return;
            var s = document.createElement('style');
            s.id = 'vf-quote-embed-styles';
            s.textContent = [
                /* Card shell — subtle border by default, deepens on hover
                   (only when it's actually a tappable link to the original
                   post) so the affordance matches the pointer cursor. */
                '.vf-quote-card-embed { border:1px solid rgba(27,43,139,0.12); transition:border-color .18s ease, background-color .18s ease, box-shadow .18s ease; }',
                '.vf-quote-card-embed[data-orig-post-id]:hover { border-color:rgba(27,43,139,0.38); background:rgba(27,43,139,0.055); box-shadow:0 4px 14px rgba(27,43,139,0.08); }',
                /* "Original" pill — royal-blue outline by default, fills
                   solid on card hover (group-hover equivalent). */
                '.vf-quote-original-pill { display:inline-flex; align-items:center; gap:4px; margin-left:auto; flex-shrink:0; font-size:0.62rem; font-weight:800; letter-spacing:0.01em; color:#1B2B8B; background:rgba(27,43,139,0.08); border:1px solid rgba(27,43,139,0.20); padding:3px 9px; border-radius:999px; white-space:nowrap; transition:background-color .18s ease, color .18s ease, border-color .18s ease; }',
                '.vf-quote-original-pill svg { flex-shrink:0; transition:fill .18s ease; }',
                '.vf-quote-card-embed[data-orig-post-id]:hover .vf-quote-original-pill { background:#1B2B8B; color:#fff; border-color:#1B2B8B; }',
                '.vf-quote-card-embed[data-orig-post-id]:hover .vf-quote-original-pill svg { fill:#fff; }',
                /* Video preview — full-bleed 16:9 box (was a cropped
                   max-height strip), matching the image embed's rounded
                   top corners since it sits flush at the top of the card. */
                '.vf-quote-video-wrap { position:relative; width:100%; aspect-ratio:16/9; background:#000; overflow:hidden; }',
                '.vf-quote-video-wrap .vf-quote-embed-img { width:100%; height:100%; object-fit:cover; display:block; }',
                /* Centered frosted-glass play/pause button — hidden while
                   the muted preview is actively playing, fades in on
                   pause (see the onplay/onpause wiring at the call site). */
                '.vf-quote-play-btn { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:46px; height:46px; border-radius:50%; background:rgba(10,14,39,0.55); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); border:1px solid rgba(255,255,255,0.25); color:#fff; display:flex; align-items:center; justify-content:center; font-size:1.05rem; cursor:pointer; z-index:2; transition:opacity .18s ease, transform .18s ease; }',
                '.vf-quote-play-btn:hover { transform:translate(-50%,-50%) scale(1.08); }',
                '.vf-quote-play-btn--hidden { opacity:0; pointer-events:none; }',
                /* PREMIUM POST EMBED (2026-10-08) — image / text-only originals only.
                   Everything is scoped under .vf-qp, which is never added to the video
                   embed, so the video card keeps its existing look exactly. */
                '.vf-quote-card-embed.vf-qp { position:relative; margin:8px 14px 12px; border-radius:16px; overflow:hidden; background:linear-gradient(180deg,#ffffff 0%,#fafbfd 100%); border:1px solid rgba(10,14,39,0.09); box-shadow:0 1px 2px rgba(10,14,39,0.04), 0 8px 24px rgba(10,14,39,0.06); }',
                '.vf-quote-card-embed.vf-qp::before { content:""; position:absolute; left:0; right:0; top:0; height:2px; z-index:2; background:linear-gradient(90deg,#1B2B8B 0%,#5B0EA6 55%,#C9A66B 100%); }',
                '.vf-quote-card-embed.vf-qp[data-orig-post-id]:hover { border-color:rgba(27,43,139,0.28); background:linear-gradient(180deg,#ffffff 0%,#f6f8fd 100%); box-shadow:0 2px 4px rgba(10,14,39,0.05), 0 12px 30px rgba(27,43,139,0.12); }',
                '.vf-qp-media { position:relative; width:100%; aspect-ratio:16/10; max-height:260px; overflow:hidden; background:#eef0f6; }',
                '.vf-qp-media img { width:100%; height:100%; max-height:none; margin:0; border-radius:0; object-fit:cover; display:block; }',
                '.vf-qp-media::after { content:""; position:absolute; left:0; right:0; bottom:0; height:38%; pointer-events:none; background:linear-gradient(180deg,rgba(10,14,39,0) 0%,rgba(10,14,39,0.26) 100%); }',
                '.vf-qp-body { padding:14px 16px 16px; }',
                '.vf-qp-head { display:flex; align-items:center; gap:10px; }',
                '.vf-qp-avatar { width:36px; height:36px; border-radius:50%; flex-shrink:0; object-fit:cover; border:2px solid #fff; box-shadow:0 0 0 1.5px rgba(201,166,107,0.85), 0 2px 6px rgba(10,14,39,0.12); }',
                '.vf-qp-avatar--ph { display:flex; align-items:center; justify-content:center; background:rgba(27,43,139,0.10); }',
                '.vf-qp-id { display:flex; flex-direction:column; min-width:0; flex:1; line-height:1.2; }',
                '.vf-qp-name { font-size:0.9rem; font-weight:800; color:#0A0E27; letter-spacing:-0.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
                '.vf-qp-sub { margin-top:2px; font-size:0.62rem; font-weight:700; letter-spacing:0.09em; text-transform:uppercase; color:#8A7248; }',
                '.vf-quote-card-embed.vf-qp .vf-quote-original-pill { margin-left:0; font-size:0.6rem; letter-spacing:0.08em; text-transform:uppercase; padding:4px 10px; background:#fff; border:1px solid rgba(27,43,139,0.22); box-shadow:0 1px 2px rgba(10,14,39,0.05); }',
                '.vf-qp-rule { height:1px; margin:12px 0 11px; border:0; background:linear-gradient(90deg,rgba(201,166,107,0.65),rgba(10,14,39,0.06) 70%,rgba(10,14,39,0)); }',
                '.vf-qp-text { font-size:0.9rem; line-height:1.65; color:#1f2937; display:-webkit-box; -webkit-line-clamp:5; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word; }',
                '.vf-qp-text--only::before { content:"\\201C"; display:block; font-family:Georgia,"Times New Roman",serif; font-size:2.4rem; line-height:0.6; margin-bottom:6px; color:rgba(201,166,107,0.85); }',
                /* UPGRADE (2026-10-18 — "improve the retweet and quote card"): rounded
                   branded card in the home feed (style.css no longer flattens .vf-qp),
                   left accent bar, whole-line 4-line clamp (fixes the half-visible 5th
                   line), Show more/less, and a "View original post" footer. */
                '#feed-container .vf-quote-card-embed.vf-qp { margin:10px 14px 14px; border-radius:18px; border:1px solid rgba(10,14,39,0.09); background:#fff; box-shadow:0 1px 2px rgba(10,14,39,0.05), 0 10px 26px rgba(10,14,39,0.08); -webkit-tap-highlight-color:transparent; transition:transform .15s ease, box-shadow .18s ease; }',
                '#feed-container .vf-quote-card-embed.vf-qp[data-orig-post-id]:active { transform:scale(.985); }',
                '.vf-quote-card-embed.vf-qp::before { top:0; bottom:0; left:0; right:auto; width:4px; height:auto; background:linear-gradient(180deg,#1B2B8B,#5B0EA6 60%,#C9A66B); }',
                '.vf-qp-media { max-height:none; aspect-ratio:16/9; }',
                '.vf-quote-card-embed.vf-qp .vf-qp-body { padding:14px 16px 12px 20px; }',
                '.vf-quote-card-embed.vf-qp .vf-qp-avatar { width:40px; height:40px; }',
                '.vf-quote-card-embed.vf-qp .vf-qp-name { font-size:0.95rem; }',
                '.vf-quote-card-embed.vf-qp .vf-qp-text { font-size:0.95rem; line-height:1.55; max-height:calc(1.55em * 4); -webkit-line-clamp:4; }',
                '.vf-quote-card-embed.vf-qp .vf-qp-text.emp-qc-open { display:block; max-height:none; -webkit-line-clamp:unset; }',
                '.emp-qc-more { display:inline-block; margin-top:6px; padding:0; border:0; background:none; color:#1B2B8B; font-size:0.8rem; font-weight:800; cursor:pointer; }',
                /* touch screens keep :hover stuck after a tap — don't leave the pill filled */
                '@media (hover:none) { .vf-quote-card-embed[data-orig-post-id]:hover { background:inherit; box-shadow:none; } .vf-quote-card-embed[data-orig-post-id]:hover .vf-quote-original-pill { background:#fff; color:#1B2B8B; border-color:rgba(27,43,139,0.22); } .vf-quote-card-embed[data-orig-post-id]:hover .vf-quote-original-pill svg { fill:#1B2B8B; } }',
                '.vf-quote-card-embed.vf-qp .vf-quote-video-wrap { border-radius:0; }',
                '.emp-qc-foot { display:flex; align-items:center; justify-content:space-between; margin:12px -16px -12px -20px; padding:10px 16px 10px 20px; background:rgba(27,43,139,0.045); border-top:1px solid rgba(10,14,39,0.06); font-size:0.74rem; font-weight:800; letter-spacing:0.04em; text-transform:uppercase; color:#1B2B8B; }'
            ].join('\n');
            document.head.appendChild(s);
        }
        window._injectQuoteEmbedStyles = _injectQuoteEmbedStyles;

        /* Build the quoted-post embed block for quote posts */
        let quoteEmbedHTML = '';
        if (isQuotePost && retweetData.originalPost) {
            const op = retweetData.originalPost;
            const opName   = _esc(op.authorName   || op.name   || 'Original Author');
            const opAvatar = op.authorAvatar || op.avatar || '';
            const opText   = _esc((op.text || op.content || '').substring(0, 200));
            const opMedia  = op.media || op.mediaUrls || op.mediaFiles || [];
            const firstMedia = Array.isArray(opMedia) ? opMedia[0] : (typeof opMedia === 'string' ? opMedia : '');
            const firstMediaUrl = (typeof firstMedia === 'object' && firstMedia)
                ? (firstMedia._cloudUrl || firstMedia.url || '') : (firstMedia || '');
            const isVidEmbed = firstMediaUrl && (
                /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(firstMediaUrl) ||
                /\/video\/upload\//i.test(firstMediaUrl)
            );

            let embedMediaHTML = '';
            if (firstMediaUrl && !firstMediaUrl.startsWith('blob:')) {
                if (isVidEmbed) {
                    /* FEATURE (2026-09-16 — "I love the UI quality of the
                       retweet post and media in this code, integrate it"):
                       ported the reference composer's exact video treatment
                       — a full-width 16:9 box (was a cropped max-height:120px
                       strip) with object-cover, and a centered circular
                       backdrop-blur play/pause button (was bare native
                       `controls`) that fades out once the video is actually
                       playing and fades back in on pause, exactly like the
                       reference's togglePlay(). The muted+autoplay+loop live
                       preview this codebase deliberately chose ("video should
                       play live with a preview" — see the FEATURE note this
                       one replaces) is kept as the DEFAULT state; the new
                       button is purely an upgraded, higher-quality way to
                       pause/resume that same preview in place of relying on
                       native browser controls chrome. `this.nextElementSibling`
                       / `this.previousElementSibling` below need no per-post
                       id — they're always exactly this video/button pair,
                       however many quote cards are on screen at once.
                       app-thread.js's data-orig-post-id navigation handler
                       is extended alongside this to also ignore taps on
                       `.vf-quote-play-btn`, the same way it already ignores
                       taps on the video itself. */
                    embedMediaHTML = '<div class="vf-quote-video-wrap">'
                        + '<video src="' + firstMediaUrl + '" class="vf-quote-embed-img"'
                        + ' muted loop autoplay playsinline preload="auto"'
                        + ' onerror="this.parentElement.style.display=\'none\'"'
                        + ' onplay="this.nextElementSibling.classList.add(\'vf-quote-play-btn--hidden\')"'
                        + ' onpause="this.nextElementSibling.classList.remove(\'vf-quote-play-btn--hidden\')"></video>'
                        + '<button type="button" class="vf-quote-play-btn vf-quote-play-btn--hidden"'
                        + ' aria-label="Play or pause preview"'
                        + ' onclick="event.stopPropagation();var v=this.previousElementSibling;if(v.paused){v.play();}else{v.pause();}">'
                        + '<i class="fas fa-play"></i>'
                        + '</button>'
                        + '</div>';
                } else {
                    embedMediaHTML = '<div class="vf-qp-media"><img src="' + firstMediaUrl + '" class="vf-quote-embed-img"'
                        + ' loading="lazy" onerror="this.parentElement.style.display=\'none\'"></div>';
                }
            }

            /* FEATURE (report — "clicking the original quote box should
               redirect users directly to the original post"): op.id is the
               original post's id when the caller supplied one (see
               app-thread.js's _doSubmitQuote and the posts-listener
               reconstruction in app-feed.js/app-fixes.js, all updated to
               pass it through). data-orig-post-id here is read by the same
               dedicated click handler in app-thread.js that handles the
               retweet-header banner above. */
            const opId = op.id || op.postId || '';
            _injectQuoteEmbedStyles();
            /* UPGRADE (2026-10-18): video originals now use the same premium card as
               image/text originals (previously only !isVidEmbed did, so a quoted video
               kept the old flat strip). The old markup below is left as a dead fallback. */
            if (true) {
                /* UPGRADE: full text (capped at 1000 chars) goes in; CSS clamps to 4
                   whole lines and Show more reveals the rest — no pre-cut at 200. */
                const _opFull = String(op.text || op.content || '');
                const _opTextQ = _esc(_opFull.substring(0, 1000)) + (_opFull.length > 1000 ? '\u2026' : '');
                const _qpMore = _opFull.length > 150
                    ? '<button type="button" class="emp-qc-more" onclick="event.stopPropagation();event.preventDefault();var t=this.previousElementSibling;var o=t.classList.toggle(\'emp-qc-open\');this.textContent=o?\'Show less\':\'Show more\';">Show more</button>'
                    : '';
                const _qpFoot = opId
                    ? '<div class="emp-qc-foot"><span>View original post</span><i class="fas fa-arrow-right"></i></div>'
                    : '';
                const _qpAvatar = opAvatar
                    ? '<img class="vf-qp-avatar" src="' + _attr(opAvatar) + '" alt="" onerror="this.style.display=\'none\'">'
                    : '<div class="vf-qp-avatar vf-qp-avatar--ph"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#1B2B8B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>';
                quoteEmbedHTML =
                    '<div class="vf-quote-card-embed vf-qp"'
                    + (opId ? ' data-orig-post-id="' + _attr(opId) + '" style="cursor:pointer;"' : '') + '>'
                    + (embedMediaHTML || '')
                    + '<div class="vf-qp-body">'
                    + '<div class="vf-qp-head">' + _qpAvatar
                    + '<div class="vf-qp-id"><span class="vf-qp-name">' + opName + '</span><span class="vf-qp-sub">Original post</span></div>'
                    + '<span class="vf-quote-original-pill">'
                    + '<svg viewBox="0 0 24 24" width="10" height="10" fill="#1B2B8B"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>Original</span>'
                    + '</div>'
                    + (_opTextQ ? '<div class="vf-qp-rule"></div><div class="vf-qp-text' + (embedMediaHTML ? '' : ' vf-qp-text--only') + '">' + _opTextQ + '</div>' + _qpMore : '')
                    + _qpFoot
                    + '</div></div>';
            } else
            quoteEmbedHTML =
                '<div class="vf-quote-card-embed"'
                + (opId ? ' data-orig-post-id="' + _attr(opId) + '"' : '')
                + ' style="margin:6px 14px 10px;border-radius:14px;overflow:hidden;'
                + 'background:rgba(27,43,139,0.03);'
                + (opId ? 'cursor:pointer;' : '') + '">'
                /* Embed media — video gets the full-width aspect-video
                   treatment above (own wrapper handles sizing/overflow);
                   image keeps the original max-height:120px strip. */
                + (embedMediaHTML
                    ? (isVidEmbed ? embedMediaHTML : '<div style="overflow:hidden;max-height:120px;">' + embedMediaHTML + '</div>')
                    : '')
                /* Embed header */
                + '<div style="display:flex;align-items:center;gap:7px;padding:9px 12px 6px;">'
                + (opAvatar
                    ? '<img src="' + _attr(opAvatar) + '" style="width:24px;height:24px;border-radius:50%;'
                      + 'object-fit:cover;flex-shrink:0;border:1.5px solid rgba(27,43,139,0.15);"'
                      + ' onerror="this.style.display=\'none\'">'
                    : '<div style="width:24px;height:24px;border-radius:50%;background:rgba(27,43,139,0.15);flex-shrink:0;'
                      + 'display:flex;align-items:center;justify-content:center;">'
                      + '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#1B2B8B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>')
                + '<span style="font-size:0.75rem;font-weight:800;color:#0A0E27;white-space:nowrap;'
                + 'overflow:hidden;text-overflow:ellipsis;">' + opName + '</span>'
                + '<span class="vf-quote-original-pill">'
                + '<svg viewBox="0 0 24 24" width="10" height="10" fill="#1B2B8B"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>Original</span>'
                + '</div>'
                /* Embed text */
                + (opText
                    ? '<div style="padding:0 12px 10px;font-size:0.78rem;color:#374151;line-height:1.45;'
                      + 'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">'
                      + opText + '</div>'
                    : '')
                + '</div>';
        }

        const postId = 'post-' + Date.now();
        // FIX (report — "announcement post keeps updating to the current
        // time and date on every login/reload"): this used to hard-code
        // `new Date()` here with no way for a caller to say otherwise, which
        // is correct for a brand-new post being created live but wrong for
        // any post being REPLAYED from Firestore (announcements, and
        // anything else routed through this shared builder) -- every fresh
        // page load renders those for the first time in that load's DOM,
        // takes the "brand new post" branch, and re-stamps them with
        // whatever moment the page happened to load, discarding the post's
        // real original createdAt. Callers that have a real timestamp (see
        // _annRenderFeedPost) now pass it through; anything that doesn't
        // (an actual new post being published right now) keeps the exact
        // same "now" behaviour as before.
        const ts = new Date(createdAt || Date.now()).toLocaleString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const isOwnPost = (author.id === us.id || _isAdmin());
        const showOpts = isOwnPost ? 'block' : 'none';

        /* FEATURE (2026-09-12 — Content Control): posts by OTHER users
           previously had NO options menu at all (showOpts above stays
           'none' for them — left untouched, so the existing Edit/Delete/
           Promote behavior for own posts/admin is unaffected). This adds
           a second, separate options menu just for other users' posts —
           Restrict Media + Block — which is the actual UI entry point the
           "block or filter posts from selected contacts" / "WhatsApp-
           style media restrictions" project spec needs. Hidden for guests
           (nothing to persist the choice against) and for posts with no
           real author id (some crisis-report/legacy post shapes). Click
           handling for .cc-block-user-btn/.cc-restrict-media-btn is wired
           once, delegated on #feed-container, in app-fixes.js's existing
           big delegated click handler (added alongside .edit-post-btn/
           .delete-post-btn there) so it also works for posts rendered
           into other containers (profile dashboard clones, etc.). */
        const otherUserOptionsHTML = (!isOwnPost && author.id && !_isGuest())
            ? '<div class="post-options cc-post-options" style="display:block;">'
                + '<button class="options-btn"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>'
                + '<div class="options-menu">'
                /* FIX (icon polish): the fa-eye-slash / fa-ban <i> icons this
                   menu used to render depended on the Font Awesome webfont
                   loading — on a flaky mobile connection the font can fail
                   after the stylesheet's already in, and index.html's own
                   emoji-fallback rule (.fa-eye-slash:before{content:"🙈"})
                   made "Restrict Media" show a monkey emoji instead of an
                   icon, while fa-ban has no fallback at all and rendered as
                   a tofu/broken-glyph box (see screenshot report). Swapped
                   both for self-contained inline SVGs (classic Feather-style
                   eye-off / slash glyphs, currentColor stroke) so they
                   render identically everywhere with zero font dependency —
                   matches the premium-SVG approach already used for the
                   sidebar nav icons (app-fix-final.js §25). */
                + '<a href="#" class="cc-restrict-media-btn" data-uid="' + _attr(author.id) + '" data-uname="' + _attr(name) + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.77 21.77 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Restrict Media</a>'
                + '<a href="#" class="cc-block-user-btn" data-uid="' + _attr(author.id) + '" data-uname="' + _attr(name) + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Block ' + _esc(name) + '</a>'
                + '</div></div>'
            : '';

        /* FEATURE (2026-10-27 - "add the badge tick to chiefadmin"): blue verified seal after the author's
           name in the post header. Shown for a user flagged hasBlueBadge (app-blue-badge.js's own field,
           read off the post's author object or the cached user list), for the chiefadmin account, and for
           an admin viewing their own post. It is an inline SVG with no <title> text, so every existing
           `.story-user-info strong` .textContent lookup in app-fixes.js still reads just the name. */
        function _empPostTickHTML(au, nm, isBiz, me) {
            try {
                if (isBiz) return '';
                var cache = (window.mockUsers && au && au.id && window.mockUsers[au.id]) || {};
                var chief = String(nm || '').trim().toLowerCase() === 'chiefadmin' || String((au && au.username) || '').trim().toLowerCase() === 'chiefadmin';
                var ok = !!((au && au.hasBlueBadge) || cache.hasBlueBadge || chief || (au && me && au.id && au.id === me.id && _isAdmin()));
                if (!ok) return '';
                return '<svg class="emp-post-tick" viewBox="0 0 24 24" width="17" height="17" role="img" aria-label="Verified account" style="margin-left:4px;vertical-align:-3px;flex-shrink:0;"><path d="M12 2l2.4 2 3.1-.3.9 3 2.7 1.6-1 3 1 3-2.7 1.6-.9 3-3.1-.3L12 22l-2.4-2-3.1.3-.9-3L3 15.7l1-3-1-3 2.7-1.6.9-3 3.1.3z" fill="#1D9BF0"/><path d="M8 12.3l2.8 2.8 5.4-5.6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            } catch (e) { return ''; }
        }

        const el = document.createElement('div');
        el.className     = 'impact-story';
        el.dataset.postId = postId;
        el.dataset.userId = author.id;
        if (isRetweetPost) el.dataset.isRetweet = '1';
        if (isQuotePost)   el.dataset.isQuote   = '1';
        /* RESTORED 2026-10-29 (avatar regression): app-fix-final.js §49 (_empSweepPostAvatars) only refreshes post-header avatars on
           cards carrying data-emp-av="1", and this marker had been dropped from the card builder - so every post whose stored avatar
           was an initials placeholder stayed that way. Set for plain/quote posts by a real user only (a retweet card shows the ORIGINAL
           author and a business post shows the page logo, so neither may be rewritten with the poster's picture). */
        if (!isRetweetPost && !isBusinessPost) el.dataset.empAv = '1';
        el.innerHTML =
            retweetHeaderHTML
            + '<div class="story-header">'
            + '<div class="avatar-placeholder square" style="' + (isBusinessPost ? 'border-radius:8px;' : '') + '">'
            + '<img src="' + _attr(avatar) + '" alt="' + _attr(name) + '" loading="lazy"'
            + ' onerror="this.onerror=null;this.src=\'https://ui-avatars.com/api/?name=' + encodeURIComponent(name || 'U') + '&background=5B0EA6&color=fff&size=150\';"></div>'
            + '<div class="story-user-info"><strong>' + _esc(name) + _empPostTickHTML(author, name, isBusinessPost, us) + '</strong><span>' + ts + '</span></div>'
            + otherUserOptionsHTML
            + '<div class="post-options" style="display:' + showOpts + ';">'
            + '<button class="options-btn"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>'
            + '<div class="options-menu">'
            + '<a href="#" class="edit-post-btn"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit</a>'
            + '<a href="#" class="delete-post-btn"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Delete</a>'
            + '<a href="#" class="promote-post-btn"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg> Promote</a>'
            + '</div></div></div>'
            + '<div class="story-content">' + _withReadMore(formattedText) + '</div>'
            /* Quote embed (shown below the quoter's own text) */
            + quoteEmbedHTML
            /* BUGFIX: media moved from above .story-content to below it (and
               below the quote embed) so every post reads header -> text ->
               media -> actions, instead of media appearing before the
               caption/announcement copy. */
            + (!youtubeFound ? mediaHTML : '')
            + '<div class="story-actions">'
            + '<a class="action-btn comment-btn" data-action="comment" title="Reply"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/></svg><span class="comment-count x-count"></span></span></a>'
            + '<a class="action-btn retweet-btn" data-action="retweet" title="Repost"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.932 9.48.568 8.02 5 3.88zM19.5 20.12l-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2H11V4h5.5c2.209 0 4 1.79 4 4v8.45l1.568-1.93 1.364 1.46-4.432 4.14z"/></svg><span class="retweet-count x-count"></span></span></a>'
            + '<a class="action-btn like-btn" data-action="like" title="Like"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z"/></svg><span class="like-count x-count"></span></span></a>'
            + '<a class="action-btn quote-btn" data-action="quote" title="Quote"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/><path d="M9 10.5c0-.28-.22-.5-.5-.5s-.5.22-.5.5.22.5.5.5.5-.22.5-.5zm3.5 0c0-.28-.22-.5-.5-.5s-.5.22-.5.5.22.5.5.5.5-.22.5-.5zm3.5 0c0-.28-.22-.5-.5-.5s-.5.22-.5.5.22.5.5.5.5-.22.5-.5z" fill="currentColor" stroke="none"/></svg><span class="quote-count x-count"></span></span></a>'
            + '<span class="action-btn view-count-display" title="Views"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><span class="view-count x-count"></span></span>'
            + '<a class="action-btn bookmark-btn" data-action="bookmark" title="Bookmark" style="margin-left:auto;"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l.5 1v16.5l-6-3.5-6 3.5V4l.5-1z"/></svg></span></a>'
            + '<a class="action-btn share-btn" data-action="share" title="Share"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg><span class="share-count x-count"></span></span></a>'
            + '<a class="action-btn download-media-btn" data-action="download" title="Download"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><rect x="4" y="18.4" width="16" height="2.2" rx="1.1" fill="currentColor" stroke="none"/></svg><span class="download-count x-count"></span></span></a>'
            + '</div>'
            + '<div class="comment-section">'
            + '<div class="comment-sheet-header"><span class="comment-sheet-title">Comments</span><button type="button" class="comment-sheet-close-btn" aria-label="Close comments"><i class="fas fa-times"></i></button></div>'
            + '<div class="comment-list"></div>'
            + '<form class="comment-form" novalidate>'
            + '<input type="text" name="comment-text" placeholder="Add a comment..." required>'
            + '<button type="submit"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>'
            + '</form></div>';

        return el;
    }
    window.createNewPostElement = createNewPostElement;

    /* =========================================================================
       ELECTION SUPPORT CARD — logo badge + "I SUPPORT" banner overlay +
       rotating support-text banner on the regular feed's own /posts card.

       FIX (this session — "implement the rotating text and the mock I
       support card in the like/share/comments card"): the user settled
       (previous session) on keeping ONLY the normal feed /posts card
       (real like/comment/retweet/share/download action bar) for "Post to
       Dashboard" support-cards, dropping the old compact dashboard strip
       that used to carry a logo badge + "I SUPPORT" overlay and a
       rotating banner. Neither of those two things ever got carried over
       onto this feed card — it rendered as a plain image post no
       different from any other post, because isElectionSupportPost was
       written onto the Firestore doc but never actually read by any
       renderer. This is that renderer, called from the main posts
       listener below once each post's election fields (candidateName/
       party/logoUrl — added to the /posts write in
       app-patch-v49-v50.js's postCardToDashboard()) are available on
       `post`.

       Deliberately NOT edited into createNewPostElement() itself — that
       function is shared by every other post type (retweets, quotes,
       business posts, admin announcements, SOS, etc.) across many call
       sites in this file and app-fixes.js; branching inside it for one
       narrow post type risks all of those. Instead this runs as a
       one-time DOM enhancement on the already-built element, the same
       pattern this file already uses for content-restriction overlays. */
    /* UPGRADE (dev task list — "Implement the rotating text exactly as
       shown in the upload mock code"): replaced the old plain fading-text
       line + top-left logo chip with the mock's actual circular gold
       "★ I AM PROUD TO SUPPORT <NAME> ★" textPath badge (spinning via CSS,
       not cycling through messages — the mock never cycled text either,
       it physically rotates ONE string around a circle). _injectElectionCardCss()
       carries the @keyframes + badge sizing (reduced from the mock's raw
       135%-of-136px circle to fit a normal feed card rather than the
       mock's fixed 320x416 banner), injected once, the same pattern
       app-feed.js already uses elsewhere in this file for scoped strip
       CSS (see the Quotes/Memes strip's own _injectCss()). The party logo
       chip is kept (top-left) but enlarged/backgrounded for the "party
       logo displayed clearly" ask. */
    var _emCardCssInjected = false;
    function _injectElectionCardCss() {
        if (_emCardCssInjected) return;
        _emCardCssInjected = true;
        var s = document.createElement('style');
        s.id = 'em-election-card-css';
        s.textContent =
            '@keyframes emCardSpin{to{transform:rotate(360deg);}}' +
            '.em-rotate-badge-wrap{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(62%,300px);aspect-ratio:1/1;line-height:0;pointer-events:none;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.6));}' +
            /* FIX (2026-09-25 - "still same bug"): this rule's own '+' had been
               swapped for a ';' just below, which silently ended the whole
               textContent assignment early. Everything after that point
               (the download-icon padding fix AND, before this fix, this
               comment's neighbouring rules) became a dangling expression
               statement that is never assigned to s.textContent -- and,
               because a string literal directly followed by "(document.head
               ...)" on the next line parses as one statement (the string
               "called" as a function), it actually THROWS a TypeError at
               runtime. That exception aborted _injectElectionCardCss()
               before reaching appendChild(s), so NONE of this stylesheet
               (ring position/animation, has-portrait mask, download-icon
               padding) was ever actually added to the page. Restoring the
               '+' here fixes that root cause for all three symptoms. */
            /* FIX (2026-11-05 - "avatar circle and spinning text not balanced"): the text-ring <svg> was an INLINE element,
               so the browser reserved a line-box descender gap under it (~9px+). That made .em-rotate-badge-wrap taller than
               its square aspect-ratio box, and because the wrap is centred with translate(-50%,-50%) the text ring was pushed
               ~9px UP relative to the baked photo circle (measured from the screenshots: photo ring r=263-265px, round and
               centred; text ring centre 9px high, so the text hugged the photo at the bottom and floated off it at the top),
               while the absolutely-positioned dotted ring (svg2) stayed centred on the taller box, so the two rings were not
               even concentric with each other. display:block (+ line-height:0 on the wrap) removes the gap: the wrap is now
               exactly square and every ring shares the photo's centre. */
            '.em-rotate-badge-svg{display:block;width:100%;height:100%;animation:emCardSpin 20s linear infinite;}' +
            '@media (prefers-reduced-motion:reduce){.em-rotate-badge-svg{animation:none;}}' +
            /* UPGRADE (2026-10-31 - "improve the spinning card"): a fine dotted gold ring (same #d4af37) turning the
               OPPOSITE way inside the text ring, so the card has depth. Child of .em-rotate-badge-wrap only, so it
               inherits that wrap's portrait mask and touches no other card. */
            '.em-rotate-badge-svg2{position:absolute;inset:0;width:100%;height:100%;animation:emCardSpinRev 44s linear infinite;}' +
            '@keyframes emCardSpinRev{to{transform:rotate(-360deg);}}' +
            '@media (prefers-reduced-motion:reduce){.em-rotate-badge-svg2{animation:none;}}' +
            /* FIX (2026-09-25 - "let the text rotate under the presidential
               candidate avatar"): punches a hole in the ring's own SVG box
               (mask-image, not a cloned/clipped <img>) exactly where the
               small candidate photo sits, so that circle's part of the
               composite image -- already baked into the base <img> beneath
               this overlay -- shows through instead of the gold ring text
               crossing over it. Mirrors .em-arc-preview.has-portrait's mask
               in app-patch-v49-v50.js (same underlying geometry), and avoids
               the duplicated/ghost-photo and spill-over regressions that an
               earlier cloned-<img> + clip-path attempt caused. */
            '.em-rotate-badge-wrap.has-portrait{-webkit-mask-image:radial-gradient(ellipse 16.1% 16.1% at 74.6% 74.6%,transparent 96%,#000 100%);mask-image:radial-gradient(ellipse 16.1% 16.1% at 74.6% 74.6%,transparent 96%,#000 100%);}' +
            /* 2026-09-25 - the download icon (last of 8 in .story-actions) was
               getting clipped at the row's right edge: 8 non-shrinking icons
               (comment/repost/like/comment/chart+count/bookmark/share/download)
               left no room inside the row's 4px right padding. Scoped to
               .em-election-post only, so ordinary posts' action rows (which fit
               fine today) are untouched. */
            '.em-election-post .story-actions{padding-right:14px !important;flex-wrap:nowrap;overflow:visible;}' +
            '.em-election-post .story-actions .action-btn{flex-shrink:1 !important;}' +
            '.em-election-post .story-actions .action-btn .x-pill{padding-left:6px !important;padding-right:6px !important;gap:2px !important;}';
        (document.head || document.documentElement).appendChild(s);
    }

    /* ANIMATED RING for cards posted from the Election Hub's "Post to
       Dashboard" (2026-09-23 — "give the I am proud to support text a
       rotating animation ... reduce the height of the card"). Those posts are a
       4:5 composite (1080x1350) drawn WITHOUT the ring text (a PNG can't
       spin); this lays the slowly rotating SVG ring over the photo. Geometry
       mirrors app-patch-v49-v50.js's drawCard() — photo centre at 600/1350 of
       the height (44.44%), ring radius 370/1080 of the width -> ring box 93%
       of the card width; keep them in sync. Also lifts the 420/480px media caps
       so the shorter card shows whole instead of being cropped. Composite
       posts from before the overlay existed (no cardArcOverlay flag) have the
       ring baked in and are left alone. */
    function _enhanceCompositeElectionCard(el, post) {
        if (!post.cardArcOverlay) return;
        if (el.classList) el.classList.add('em-election-post'); // scopes the action-row spacing fix above to just this card type
        var mediaItem = el.querySelector('.story-media-container .story-media-item');
        if (!mediaItem || mediaItem.querySelector('.em-rotate-badge-wrap')) return;
        _injectElectionCardCss();
        mediaItem.style.position = 'relative';
        /* REVERTED (2026-09-25): the whole "force the image a bit taller" chain
           (padding-bottom hack -> measured px height -> forced cqw height with
           object-fit:cover/objectPosition) is pulled out. Each fix in that chain
           solved the symptom in front of it but broke something else further
           down the same card (collapsed image, egg-shaped circles, a duplicated
           candidate photo, and finally the whole image spilling out past the
           card into the rest of the feed) -- all from forcing this raster,
           1080x1350 composite into a box taller than its own 4:5 ratio. The box
           is back to that 4:5 ratio below via aspect-ratio (see ROOT FIX),
           which is what rendered correctly before any of that started, with no
           cropping or stretching. Only the max-height cap removal is kept -- that lifts
           the ORIGINAL 420/480px feed cap so the whole card shows uncropped;
           it never caused any of the above and isn't part of the height chain. */
        mediaItem.style.setProperty('max-height', 'none', 'important');
        mediaItem.style.overflow = 'hidden';
        /* ROOT FIX (2026-09-25): mediaItem's height was 'auto', which is what
           made every percentage-positioned overlay inside it (the cap earlier,
           now the ring) unreliable -- some engines resolve that math against a
           distant ancestor instead of mediaItem itself once the height isn't a
           definite number. Giving mediaItem the composite artwork's own known
           ratio (1080x1350 = 4:5) makes its height DEFINITE instead of
           content-derived auto, which is the standard fix for this whole class
           of bug: any percentage or "top:%" positioning inside it now has a
           real number to resolve against. The image is set to fill that exact
           box at inset:0; since the box ratio matches the artwork exactly,
           nothing crops or stretches. */
        mediaItem.style.setProperty('aspect-ratio', '4 / 5', 'important');
        var img = mediaItem.querySelector('img');
        if (img) {
            img.style.setProperty('max-height', 'none', 'important');
            img.style.setProperty('position', 'absolute', 'important');
            img.style.setProperty('inset', '0', 'important');
            img.style.setProperty('width', '100%', 'important');
            img.style.setProperty('height', '100%', 'important');
            img.style.objectFit = 'contain';
        }
        var shortName = (post.candidateShortName || post.candidateName || '').toUpperCase();
        if (!shortName) return;
        var pid = 'emRing-' + (post.id || Date.now());
        var t = '\u2605 I AM PROUD TO SUPPORT ' + _esc(shortName) + ' \u2605';
        var txt = function (off) {
            return '<text font-size="4.5" font-weight="800" letter-spacing="0.12" fill="#ffffff" paint-order="stroke" stroke="#000" stroke-opacity="0.6" stroke-width="0.85" stroke-linejoin="round" text-anchor="middle" font-family="Arial,Helvetica,sans-serif">'
                + '<textPath href="#' + pid + '" startOffset="' + off + '">' + t + '</textPath></text>';
        };
        mediaItem.insertAdjacentHTML('beforeend',
            /* FIX (2026-09-25 - ring still overflowing after the cap layer was
               removed): the ring wrap's own "top:44.44%" is a percentage of the
               PARENT's height, and mediaItem's height is 'auto' by design (see
               the revert above). Percentage positioning against an auto-height
               parent is exactly the ambiguous case that caused the earlier
               spill-over, and it's hitting the ring here too, not just the
               removed cap. Wrapping it in a plain inset:0 shim first gives it a
               parent whose box is pinned to mediaItem's actual rendered edges
               (an unambiguous zero offset, not a height percentage), so the
               ring's own top:44.44% now resolves against THAT instead. */
            '<div style="position:absolute;inset:0;pointer-events:none;">'
            + '<div class="em-rotate-badge-wrap has-portrait" style="top:44.44%;width:93%;">'
            + '<svg viewBox="0 0 100 100" class="em-rotate-badge-svg" xmlns="http://www.w3.org/2000/svg">'
            + '<defs><path id="' + pid + '" fill="none" d="M 13.2,50 a 36.8,36.8 0 1,1 73.6,0 a 36.8,36.8 0 1,1 -73.6,0"/></defs>'
            + txt('25%') + txt('75%') + '</svg>'
            + '<svg viewBox="0 0 100 100" class="em-rotate-badge-svg2" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
            + '<circle cx="50" cy="50" r="34.6" fill="none" stroke="#ffffff" stroke-opacity="0.8" stroke-width="0.35" stroke-dasharray="0.4 1.9" stroke-linecap="round"/></svg>'
            + '</div></div>');
        /* REMOVED (2026-09-25 - "why are all the previous fixed files corrupted?
           None are working"): the layer that made the ring text pass under the
           candidate's photo has broken three separate ways in a row (a
           duplicated/ghost photo, then the whole photo spilling outside the
           card twice, even after a real, correctly-targeted CSS fix each time).
           Rather than attempt a fourth patch that can't be verified without a
           live device, it is removed outright. The ring text is back to
           running over the candidate's photo (how it looked before
           2026-09-24's "pass under the photo" request) -- a minor cosmetic
           step back, in exchange for removing the one piece that has caused
           every regression today. If this is wanted again later, it should be
           re-approached as a change to the card's own drawCard() geometry in
           app-patch-v49-v50.js (the source of the composite image) rather than
           a DOM layer bolted on after the fact in this file. */
    }

    /* FIX (2026-10-09 — "clicking the Support Your Preferred Presidential Candidate
       Challenge banner should take users to where they support their candidate"):
       the banner's click handler only called window._empOpenElectionModal when it
       was ALREADY defined, and silently did nothing otherwise — on a slow connection
       (app-patch-v49-v50.js, which defines it, still downloading) a tap just died.
       It now uses the same fallback chain as the status-bar "Support your Presidential
       candidate" tile (index.html): open the hub if ready, else wait for it via
       window._empEnsureElectionModal (app-fixes.js) with a visible "Loading…" toast,
       so a tap always either opens the hub or says why not.

       The click is also caught at window CAPTURE phase (below) because the banner sits
       inside a post card, and card-level / document-level capture handlers elsewhere
       in the stack can otherwise swallow the tap before this node's own listener runs. */
    function _emOpenElectionHub() {
        var note = function (m, t) { if (typeof window.showNotification === 'function') window.showNotification(m, t || 'info'); };
        if (typeof window._empOpenElectionModal === 'function') { window._empOpenElectionModal(); return; }
        if (typeof window._empEnsureElectionModal === 'function') {
            window._empEnsureElectionModal(function () { window._empOpenElectionModal(); },
                function () { note('Election hub isn\u2019t available right now \u2014 please try again shortly.', 'warning'); });
            return;
        }
        note('Loading election hub\u2026', 'info');
    }
    /* Candidate chips under the challenge header: open the Hub with that candidate pre-selected (same hook the Edit flow uses). */
    function _emOpenElectionHubFor(id) {
        var note = function (m, t) { if (typeof window.showNotification === 'function') window.showNotification(m, t || 'info'); };
        if (typeof window._empOpenElectionModalFor === 'function') { window._empOpenElectionModalFor(id); return; }
        if (typeof window._empEnsureElectionModal === 'function') {
            window._empEnsureElectionModal(function () { window._empOpenElectionModalFor(id); },
                function () { note('Election hub isn\u2019t available right now \u2014 please try again shortly.', 'warning'); });
            return;
        }
        note('Loading election hub\u2026', 'info');
    }
    if (!window._emChallengeCtaWired) {
        window._emChallengeCtaWired = true;
        window.addEventListener('click', function (e) {
            var p = e.target && e.target.closest ? e.target.closest('.em-er-pick') : null;
            if (!p) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            _emOpenElectionHubFor(p.getAttribute('data-cand'));
        }, true);
        window.addEventListener('click', function (e) {
            var t = e.target && e.target.closest ? e.target.closest('.em-challenge-cta') : null;
            if (!t) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            _emOpenElectionHub();
        }, true);
    }

    /* NEW (2026-09-24 — \"at the bottom of the card add: join the support your
       preferred presidential candidate challenge\"): a slim call-to-action bar
       under the like/comment/share row of every I-support card; tapping it opens
       the same Election Hub the composer uses. Added as DOM (not baked into the
       PNG) so it also appears on cards that were already posted. */
    function _emAddChallengeCta(el) {
        if (!el || el.querySelector('.em-challenge-cta')) return;
        var cta = document.createElement('div');
        cta.className = 'em-challenge-cta';
        cta.setAttribute('role', 'button');
        cta.setAttribute('tabindex', '0');
        /* 2026-09-25 rebuild: previous version let the text run edge-to-edge and
           collide with the chevron circle. Text now sits in its own flexible,
           truncating column with real breathing room (16px) from both the
           medallion and the chevron, and an elegant serif replaces the plain
           sans so the line reads as a headline rather than UI copy. */
        cta.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;margin:8px 5px 12px;padding:9px 12px;'
            + 'border-radius:14px;color:#0a1a4a;cursor:pointer;-webkit-tap-highlight-color:transparent;'
            + 'background:#fefdf9;border:1px solid #d4af37;'
            + 'box-shadow:0 3px 10px rgba(10,26,74,0.10),inset 0 0 0 1px rgba(10,26,74,0.04);';
        cta.innerHTML =
            '<span aria-hidden="true" style="flex:0 0 auto;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;'
            + 'background:radial-gradient(circle at 30% 25%,#12307f,#0a1a4a 70%);color:#f3d774;font-size:0.95rem;box-shadow:0 1px 4px rgba(10,26,74,0.35);">\u2605</span>'
            + '<span style="flex:0 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;text-align:left;'
            +   'font-family:Georgia,\'Times New Roman\',serif;">'
            +   '<span style="font-weight:700;font-style:italic;font-size:clamp(0.56rem,2.6vw,0.72rem);letter-spacing:0.1px;line-height:1.25;'
            +     'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#0a1a4a;">Join the Support Your Preferred</span>'
            +   '<span style="font-weight:700;font-style:italic;font-size:clamp(0.56rem,2.6vw,0.72rem);letter-spacing:0.1px;line-height:1.25;'
            +     'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#a67c00;">Presidential Candidate Challenge</span>'
            + '</span>'
            + '<span aria-hidden="true" style="flex:0 0 auto;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;'
            + 'background:rgba(10,26,74,0.06);border:1px solid rgba(212,175,55,0.7);color:#a67c00;font-size:0.85rem;font-weight:900;line-height:1;">\u203A</span>';
        var open = function (ev) {
            if (ev) { ev.stopPropagation(); ev.preventDefault(); }
            _emOpenElectionHub();
        };
        cta.addEventListener('click', open);
        cta.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') open(ev); });
        var actions = el.querySelector('.story-actions');
        if (actions && actions.parentNode) actions.parentNode.insertBefore(cta, actions.nextSibling);
        else el.appendChild(cta);
    }

    /* FIX (dev task list — "I support card ... it should be I'm proud to support
       that particular candidate"): some support posts reach the feed with the
       election fields missing (candidateName/candidateShortName/party never
       written), which left the overlay reading a bare "I SUPPORT" and — because
       the rotating ring is only built when a name exists — no ring at all.
       Recover the candidate for THAT card, in order: the stored fields, the
       candidateId against the shared candidate list, then the post's own
       caption ("I support X #Vote2027" / "Proudly supporting X (PARTY) ...").
       Only ever fills gaps — a post that already carries the fields is untouched. */
    function _emDeriveCandidate(post) {
        var name = String(post.candidateName || '').trim();
        var party = String(post.party || '').trim();
        var fromFields = !!name;
        if (!name && post.candidateId && Array.isArray(window.EMP_ELECTION_CANDIDATES)) {
            for (var i = 0; i < window.EMP_ELECTION_CANDIDATES.length; i++) {
                var c = window.EMP_ELECTION_CANDIDATES[i];
                if (c && c.id === post.candidateId) { name = c.name || ''; if (!party) party = c.party || ''; break; }
            }
        }
        if (!name && post.text) {
            var m = String(post.text).match(/support(?:ing)?\s+([A-Za-z.'\- ]+?)\s*(?:\(([^)]{1,12})\))?\s*(?:for\s+\d{4})?\s*(?:[!.,#]|$)/i);
            if (m) { name = m[1].trim(); if (!party && m[2]) party = m[2].trim(); }
        }
        return { name: name, party: party, fromFields: fromFields };
    }

    function _enhanceElectionSupportCard(el, post) {
        if (!el || el._emSupportEnhanced) return;
        el._emSupportEnhanced = true;
        /* UPGRADE (dev task list — "Edit and Delete Functionality...
           Clicking either button should completely remove the card from
           Firebase and from the site"): dataset markers (not just the JS
           property above) so app-fixes.js's generic .edit-post-btn
           handler — which only ever sees the DOM node, never this
           function's own `post` object — can tell an election-support
           card apart from an ordinary post and re-route Edit into the
           delete-then-recompose flow (see that handler's own comment),
           instead of the generic caption-only text editor. */
        el.dataset.isElectionSupport = '1';
        el.dataset.candidateId = post.candidateId || '';
        /* FIX (2026-09-23): cards posted from the Election Hub's "Post to
           Dashboard" (app-patch-v49-v50.js) upload the FINISHED composite —
           logo badge, rotating "I AM PROUD TO SUPPORT" text and the "I SUPPORT"
           banner are already drawn into the image. Overlaying the badge/banner
           again on top would show every element twice, so composite cards keep
           only the dataset markers above (Edit/Delete still key off them). */
        _emAddChallengeCta(el); // 2026-09-24: bottom-of-card challenge bar (all I-support cards)
        if (post.cardComposite) { _enhanceCompositeElectionCard(el, post); return; }
        _injectElectionCardCss();

        var mediaItem = el.querySelector('.story-media-container .story-media-item');
        if (mediaItem) {
            mediaItem.style.position = 'relative';
            // "Reduce the card size slightly" — caps the media a bit
            // shorter than a normal post's own image would otherwise
            // render, matching the mock's more compact banner.
            /* FIX (dev task list — "increase the height of the I support
               Presidential candidate card thumbnail"): the old 420px cap sliced
               the bottom off the card (the "I SUPPORT <NAME>" banner was cut in
               half). The cap is lifted so the whole card shows at its own
               proportions; style.css's generic 480px img cap is overridden too. */
            mediaItem.style.setProperty('max-height', 'none', 'important');
            mediaItem.style.overflow = 'hidden';
            var _emImg = mediaItem.querySelector('img');
            if (_emImg) {
                _emImg.style.setProperty('max-height', 'none', 'important');
                _emImg.style.setProperty('height', 'auto', 'important');
            }

            var logoBadge = post.logoUrl
                // "Ensure the party logo is displayed clearly" — larger
                // (38px -> 52px) with a solid white plate behind it so a
                // logo with a transparent or dark background still reads
                // clearly against any photo.
                ? '<div style="position:absolute;top:8px;left:8px;width:52px;height:52px;border-radius:50%;background:#fff;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.45);overflow:hidden;">'
                  + '<img src="' + _attr(post.logoUrl) + '" alt="" style="width:100%;height:100%;object-fit:contain;pointer-events:none;">'
                  + '</div>'
                : '';

            var _emCand = _emDeriveCandidate(post);
            var _emName = _emCand.name;
            var _emParty = _emCand.party;
            // Stored short name / full name exactly as before; a name recovered
            // from the caption or candidate list uses its last word so the ring
            // text still fits the circle.
            var pickedShort = post.candidateShortName || (_emCand.fromFields ? _emName : _emName.split(/\s+/).pop()) || '';
            // Mirrors the mock's <svg viewBox="0 0 100 100"><path id="curve"
            // d="M 12,50 a 38,38 0 1,1 76,0 a 38,38 0 1,1 -76,0"/><textPath>
            // exactly — same curve path, same gold (#d4af37), same
            // "★ I AM PROUD TO SUPPORT X ★" copy — just a fresh unique id
            // per card (curve ids must be unique in one document) and a
            // smaller viewBox-relative badge size to fit inline in a feed
            // card instead of the mock's large fixed banner.
            var curveId = 'emCurve-' + (post.id || Date.now());
            var rotateBadge = pickedShort
                ? '<div class="em-rotate-badge-wrap">'
                  + '<svg viewBox="0 0 100 100" class="em-rotate-badge-svg" xmlns="http://www.w3.org/2000/svg">'
                  + '<path id="' + curveId + '" fill="transparent" d="M 12, 50 a 38,38 0 1,1 76,0 a 38,38 0 1,1 -76,0" />'
                  + '<text style="font-size:9px;font-weight:900;letter-spacing:0.03em;" fill="#ffffff" stroke="#000" stroke-opacity="0.6" stroke-width="0.9" paint-order="stroke">'
                  + '<textPath href="#' + curveId + '" startOffset="5%">\u2605 I AM PROUD TO SUPPORT ' + _esc(pickedShort.toUpperCase()) + ' \u2605</textPath>'
                  + '</text></svg></div>'
                : '';

            mediaItem.insertAdjacentHTML('beforeend',
                logoBadge + rotateBadge +
                '<div style="position:absolute;left:0;right:0;bottom:0;padding:10px 14px 12px;background:linear-gradient(0deg,rgba(0,0,0,0.8),rgba(0,0,0,0.05) 90%,rgba(0,0,0,0));pointer-events:none;">'
                // "I'm proud to support <that card's candidate>" (was a bare "I SUPPORT").
                + '<div style="font-weight:800;font-size:0.95rem;color:#fff;letter-spacing:0.3px;line-height:1.25;">\u2705 I\u2019M PROUD TO SUPPORT ' + _esc((_emName || 'MY PRESIDENTIAL CANDIDATE').toUpperCase()) + '</div>'
                + '<div style="font-size:0.78rem;color:rgba(255,255,255,0.85);font-weight:600;margin-top:2px;">#Vote2027' + (_emParty ? ' \u00B7 ' + _esc(_emParty) : '') + '</div>'
                + '</div>'
            );
        }
    }

    /* =========================================================================
       ELECTION SUPPORT STRIP — horizontal, swipeable row for the election-
       support card on the general public dashboard feed ("make it
       horizontally scrollable like the quote and meme card", dev task
       list, this session).

       Deliberately its OWN small strip rather than reaching into
       empyreanDashboardQuoteMemeStrip() further down this file — that
       IIFE is disarmed (see its own top-of-function `return;` and header
       comment: it caused a late-appearing layout-shift/zoom bug and was
       reverted back to plain vertical posts), so none of that history or
       risk is reintroduced here.

       Reuses the plain, already-working .horizontal-slider-container/
       .horizontal-slider-wrapper markup (same convention index.html
       already uses for #dashboard-live-slider, #dashboard-market-slider,
       etc.) plus the sizing rule style.css already ships at
       ".emp-dash-qm-strip .horizontal-slider-wrapper > .impact-story"
       — that rule is generic (pages any real, full-size post card one at
       a time instead of stacking it vertically); giving this strip the
       same "emp-dash-qm-strip" class is what makes it "horizontally
       scrollable like the quote and meme card" without any style.css
       edit. Swipe + auto-advance come for free from app-fixes.js's
       generic initSliderDragScroll(), which auto-attaches to any
       .horizontal-slider-wrapper via its own MutationObserver — no
       custom drag code duplicated here. */
    var ELECTION_STRIP_ID         = 'dashboard-election-support-strip';
    var ELECTION_STRIP_WRAPPER_ID = 'dashboard-election-support-wrapper';

    /* FIX (2026-11-06 - "the Challenge Portal Master Switch still doesn't remove the Support Your Presidential Candidate card from the public
       home page"): hiding the card used to depend entirely on app-patch-v49-v50.js flipping a body class, which never happened for the
       switch value the admin panel saves (election_config/active.portalActive, or its public copy app_config/branding.electionPortalActive).
       This small watcher lives here, next to the strip it controls: it listens to BOTH docs (the most recently written wins, same rule the
       admin panel uses), and toggles body.emp-portal-switch-off, which style.css uses to hide #dashboard-election-support-container and
       #dashboard-election-support-strip for EVERYONE (admins included). OFF = card hidden, ON = card back. The last state is cached so a
       reload doesn't flash the card before Firestore answers. */
    (function _empPortalSwitchWatcher() {
        if (window.__empPortalSwitchWatcher) return;
        window.__empPortalSwitchWatcher = true;
        var LS_KEY = 'emp_challenge_portal_on';
        var cfg = null, alt = null, boundDb = null, unsubs = [];
        function apply(on) {
            function go() { if (document.body) document.body.classList.toggle('emp-portal-switch-off', !on); }
            if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
            window._empChallengePortalOn = on;
            try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch (e) {}
        }
        function recompute() {
            var on = true;
            if (alt && typeof alt.active === 'boolean' && (!cfg || typeof cfg.portalActive !== 'boolean' || String(alt.at || '') >= String(cfg.updatedAt || ''))) on = alt.active;
            else if (cfg && typeof cfg.portalActive === 'boolean') on = cfg.portalActive;
            apply(on);
        }
        function bind() {
            var db = window.fbDb;
            if (!db || typeof db.collection !== 'function' || db === boundDb) return;
            unsubs.forEach(function (u) { try { u(); } catch (e) {} }); unsubs = []; boundDb = db;
            try {
                unsubs.push(db.collection('election_config').doc('active').onSnapshot(function (d) {
                    cfg = d.exists ? (d.data() || {}) : null; recompute();
                }, function (err) { console.warn('[ChallengePortal] election_config not readable:', err && err.code); }));
                unsubs.push(db.collection('app_config').doc('branding').onSnapshot(function (d) {
                    var v = d.exists ? (d.data() || {}) : {};
                    alt = (typeof v.electionPortalActive === 'boolean') ? { active: v.electionPortalActive, at: v.electionPortalAt || '' } : null; recompute();
                }, function (err) { console.warn('[ChallengePortal] app_config/branding not readable:', err && err.code); }));
            } catch (e) { console.warn('[ChallengePortal] listener failed:', e); }
        }
        try { if (localStorage.getItem(LS_KEY) === '0') apply(false); } catch (e) {}
        bind();
        setInterval(bind, 4000); /* window.fbDb can be swapped wholesale during startup/login: re-attach to the new instance */
    })();

    /* UPGRADE (dev task list — "reduce the card size slightly for better
       layout balance" + "Edit/Delete should completely remove the card"):
       scoped, one-time CSS for this strip only.
       - Shrinks each card from the shared .emp-dash-qm-strip rule's
         flex:0 0 100% down to 92%, matching "reduce the card size
         slightly" without touching that shared rule (style.css itself is
         never edited directly in this codebase — see the Quotes/Memes
         strip's own header comment above for why — and a shared-rule
         edit would also shrink that unrelated strip).
       - FIX: .horizontal-slider-wrapper needs overflow-x:auto to scroll
         horizontally, but per the CSS spec that forces overflow-y into a
         clipping value too (it can't be overflow-x:auto + overflow-y:
         visible) — so a card's own .options-menu dropdown (Edit/Delete),
         which pops open BELOW the options button, was being silently
         clipped/invisible the instant it extended past the wrapper's own
         height. That's what made Edit/Delete look "disabled" on this
         card even though the exact same menu markup/handlers as every
         other post (app-fixes.js's delegated .edit-post-btn/
         .delete-post-btn listener, already collection-agnostic and
         already removing the doc from every DOM location it appears in)
         were already wired and already worked. Re-parenting the open
         menu to <body> with fixed positioning (in the click handler
         below) escapes that clipping without touching the shared
         .options-menu/.post-options rules every other post type also
         uses. */
    function _injectElectionStripCss() {
        if (document.getElementById('em-election-strip-css')) return;
        var s = document.createElement('style');
        s.id = 'em-election-strip-css';
        s.textContent =
            '#' + ELECTION_STRIP_ID + ' .horizontal-slider-wrapper > .impact-story{flex:0 0 92% !important;width:92% !important;max-width:92% !important;}';
        (document.head || document.documentElement).appendChild(s);
    }

    /* Escapes the wrapper's forced overflow clipping (see comment above)
       WITHOUT moving the .options-menu out of the card's own DOM subtree
       — app-fixes.js's existing delegated click handler (both the
       .options-btn toggle itself and the later .edit-post-btn/
       .delete-post-btn handlers) locate the post via
       closest('.impact-story,...') from the clicked element, so
       relocating the menu into <body> would sever that ancestry and
       silently break Delete/Edit instead of fixing them. Setting
       position:fixed in place is enough: a fixed-position element's
       containing block is the viewport (nothing in this card sets
       transform/filter/will-change to change that), so it paints outside
       any ancestor's overflow:auto/hidden clip while staying exactly
       where it already was in the DOM — the app's own toggle
       (menu.classList.toggle('show'), app-fixes.js) and the later
       edit/delete handlers keep working completely unmodified. */
    function _wireElectionStripMenuFix(strip) {
        if (strip._emMenuFixWired) return;
        strip._emMenuFixWired = true;
        strip.addEventListener('click', function (e) {
            var btn = e.target.closest('.options-btn');
            if (!btn || !strip.contains(btn)) return;
            var menu = btn.nextElementSibling; // same lookup app-fixes.js's toggle itself uses
            if (!menu || !menu.classList.contains('options-menu')) return;
            // Let app-fixes.js's own delegated handler toggle the 'show'
            // class first, then reposition once that's settled.
            setTimeout(function () {
                if (!menu.classList.contains('show')) {
                    menu.style.position = menu.style.top = menu.style.left = menu.style.right = menu.style.zIndex = '';
                    return;
                }
                var r = btn.getBoundingClientRect();
                menu.style.position = 'fixed';
                menu.style.top = (r.bottom + 4) + 'px';
                menu.style.right = (window.innerWidth - r.right) + 'px';
                menu.style.left = 'auto';
                menu.style.zIndex = '3000';
            }, 0);
        });
    }

    /* FIX (2026-09-27 — "the I support candidates card... has this
       tendency of moving to the bottom as other card loads"): the old
       "defensive re-assert" further down only ever ran when THIS function
       was called again, which only happens when an election-support post
       is being placed. Every OTHER live insertion into #feed-container —
       an ordinary new post, a new SOS/crisis appeal, a repost/quote, an
       admin announcement — goes in via its own plain fc.prepend(el)
       elsewhere in this file (and app-fixes.js's mirrored copy of the
       posts listener), none of which knew this strip needed to stay
       pinned. Each such prepend silently pushed the strip one slot
       further down the feed; over a session with enough ordinary posts
       streaming in live, it drifts all the way toward the bottom. A
       MutationObserver on fc's own childList catches EVERY such
       insertion, regardless of which code path caused it, and snaps the
       strip straight back to fc.firstChild — a strict superset of the
       old re-assert, kept below as a same-tick belt-and-braces on top of
       it. Re-running fc.insertBefore(strip, fc.firstChild) when the strip
       is ALREADY fc.firstChild is a no-op DOM-wise, so this can never
       loop on itself. */
    var _electionStripObserver = null;
    function _watchElectionStripPosition(fc) {
        if (_electionStripObserver) return;
        _electionStripObserver = new MutationObserver(function () {
            var strip = document.getElementById(ELECTION_STRIP_ID);
            if (strip && fc.contains(strip) && fc.firstChild !== strip) {
                fc.insertBefore(strip, fc.firstChild);
            }
        });
        _electionStripObserver.observe(fc, { childList: true });
    }

    function _ensureElectionSupportStrip(fc) {
        var strip = document.getElementById(ELECTION_STRIP_ID);
        _watchElectionStripPosition(fc);
        if (strip) {
            // Defensive re-assert: if anything else has since prepended a
            // sibling ahead of it (see this function's own header comment
            // on the strip/marketplace-card ordering ask), put it back as
            // feed-container's first child rather than silently drifting
            // down the feed over time.
            if (fc.firstChild !== strip) fc.insertBefore(strip, fc.firstChild);
            return strip.querySelector('#' + ELECTION_STRIP_WRAPPER_ID);
        }

        _injectElectionStripCss();

        strip = document.createElement('div');
        strip.id = ELECTION_STRIP_ID;
        strip.className = 'card emp-dash-qm-strip';
        strip.innerHTML =
            /* FIX (2026-10-29 — the 🗳 emoji came back on this heading): replaced by the same thin-line SVG style used for the other
               election icons (classic ballot box with a checked ballot). Inline SVG, so no emoji font / Font Awesome fallback can swap it back. */
            '<div class="em-challenge-cta" role="button" tabindex="0" aria-label="Support your Presidential candidate challenge — tap to join" style="cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 14px 12px;background:#ffffff;color:#0a1a4a;border-radius:var(--radius-lg,14px) var(--radius-lg,14px) 0 0;border-bottom:2px solid #d4af37;">'
            + '<div aria-hidden="true" style="flex-shrink:0;width:42px;height:42px;border-radius:50%;background:#ffffff;border:1.5px solid #0a1a4a;box-sizing:border-box;display:flex;align-items:center;justify-content:center;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0a1a4a" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:22px;height:22px;display:block;"><path d="m9 12 2 2 4-4"/><path d="M5 7c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v12H5V7Z"/><path d="M22 19H2"/></svg></div>'
            + '<div style="flex:1;min-width:0;"><div style="font-family:Georgia,\'Times New Roman\',serif;font-size:1.05rem;font-weight:700;line-height:1.15;" class="em-ch-title">Support Your Presidential Candidate</div>'
            + '<div style="font-size:0.66rem;font-weight:800;letter-spacing:1.6px;color:#0a1a4a;text-transform:uppercase;margin-top:3px;" class="em-ch-tag">#Vote2027 &middot; Challenge</div></div>'
            + '<div style="flex-shrink:0;display:flex;align-items:center;min-height:44px;padding:0 18px;border-radius:999px;background:#ffffff;color:#0a1a4a;border:1.5px solid #0a1a4a;box-sizing:border-box;font-weight:800;font-size:0.82rem;">Join</div></div>'
            + '<div style="padding:12px 14px 6px;font-size:0.66rem;font-weight:800;letter-spacing:1.2px;color:#0a1a4a;">PICK YOUR CANDIDATE</div>'
            + '<div class="em-ch-grid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:0 14px 12px;">'
            + '<button type="button" class="em-er-pick" data-cand="tinubu" aria-label="Support Tinubu (APC)" style="flex:1;min-width:0;min-height:44px;border:1px solid #d4af37;background:#ffffff;border-radius:12px;color:#0a1a4a;font-size:0.68rem;font-weight:700;line-height:1.25;cursor:pointer;font-family:inherit;">Tinubu<br><span style="font-weight:500;color:#0a1a4a;">APC</span></button>'
            + '<button type="button" class="em-er-pick" data-cand="atiku" aria-label="Support Atiku (ADC)" style="flex:1;min-width:0;min-height:44px;border:1px solid #d4af37;background:#ffffff;border-radius:12px;color:#0a1a4a;font-size:0.68rem;font-weight:700;line-height:1.25;cursor:pointer;font-family:inherit;">Atiku<br><span style="font-weight:500;color:#0a1a4a;">ADC</span></button>'
            + '<button type="button" class="em-er-pick" data-cand="obi" aria-label="Support Obi (NDC)" style="flex:1;min-width:0;min-height:44px;border:1px solid #d4af37;background:#ffffff;border-radius:12px;color:#0a1a4a;font-size:0.68rem;font-weight:700;line-height:1.25;cursor:pointer;font-family:inherit;">Obi<br><span style="font-weight:500;color:#0a1a4a;">NDC</span></button>'
            + '<button type="button" class="em-er-pick" data-cand="sowore" aria-label="Support Sowore (AAC)" style="flex:1;min-width:0;min-height:44px;border:1px solid #d4af37;background:#ffffff;border-radius:12px;color:#0a1a4a;font-size:0.68rem;font-weight:700;line-height:1.25;cursor:pointer;font-family:inherit;">Sowore<br><span style="font-weight:500;color:#0a1a4a;">AAC</span></button>'
            + '<button type="button" class="em-er-pick" data-cand="makinde" aria-label="Support Makinde (APM)" style="flex:1;min-width:0;min-height:44px;border:1px solid #d4af37;background:#ffffff;border-radius:12px;color:#0a1a4a;font-size:0.68rem;font-weight:700;line-height:1.25;cursor:pointer;font-family:inherit;">Makinde<br><span style="font-weight:500;color:#0a1a4a;">APM</span></button>'
            + '<button type="button" class="em-er-pick" data-cand="duke" aria-label="Support Duke (PRP)" style="flex:1;min-width:0;min-height:44px;border:1px solid #d4af37;background:#ffffff;border-radius:12px;color:#0a1a4a;font-size:0.68rem;font-weight:700;line-height:1.25;cursor:pointer;font-family:inherit;">Duke<br><span style="font-weight:500;color:#0a1a4a;">PRP</span></button>'
            + '</div>'
            + '<div class="horizontal-slider-container">'
            + '<div class="horizontal-slider-wrapper" id="' + ELECTION_STRIP_WRAPPER_ID + '"></div>'
            + '</div>';

        _wireElectionStripMenuFix(strip);
        /* admin-managed candidates / election title: re-skin this freshly built strip from the live election registry (app-patch-v49-v50.js) */
        setTimeout(function () { if (typeof window._empRefreshElectionEntryCards === 'function') window._empRefreshElectionEntryCards(); }, 0);

        /* FIX (dev task list — "support and quote and meme card thumbnail
           ... not permanently in their horizontal scrollable state ...
           most often time return and become vertically positioned"): this
           wrapper was never opted out of app-fixes.js's generic
           initSliderDragScroll(), which auto-attaches (via its own
           MutationObserver watching the whole document) to EVERY
           .horizontal-slider-wrapper it finds. That handler's 4s
           auto-advance timer scrolls 85% of the wrapper's width per tick —
           fine for a row of many small peeking thumbnails, but with only
           1-2 full-width (flex:0 0 92%) cards in this strip, each tick is
           a full card swap that reads as the card growing, shrinking and
           disappearing rather than swiping; its touchmove handler also
           force-writes scrollLeft from a simple start-point delta,
           fighting this wrapper's own native scroll-snap on a manual
           swipe. This is the exact bug already diagnosed and fixed for
           the sibling Quotes/Memes strip below (see
           empyreanDashboardQuoteMemeHStrip's own wrapper._empOwnSwipeHandling)
           — that fix was never mirrored here when this election-support
           strip was built afterward. Must be set BEFORE the strip enters
           the DOM, same as that sibling fix: both attachDragScroll and
           startAutoSwipe (app-fixes.js) check this flag and skip
           entirely when it's true; native CSS scroll-snap-type on the
           wrapper still makes it touch-scrollable. */
        var wrapper = strip.querySelector('#' + ELECTION_STRIP_WRAPPER_ID);
        if (wrapper) wrapper._empOwnSwipeHandling = true;

        // Anchored as the very first thing in the feed. The feed itself
        // (the "Community Feed" card) sits in the page immediately after
        // the horizontally-scrollable "New in Marketplace" card
        // (#dashboard-market-container in index.html), so being first
        // inside the feed also satisfies "immediately after the
        // marketplace card" at the page level.
        fc.insertBefore(strip, fc.firstChild);
        return wrapper;
    }

    /* Called from the main posts listener below for posts with
       isElectionSupportPost:true. Returns true if it placed the card
       (caller then skips its own vertical insert), false to let the
       caller fall back to the ordinary vertical placement. */
    function _placeInElectionSupportStrip(el, initialBatch) {
        var fc = document.getElementById('feed-container');
        if (!fc || !el) return false;
        var wrapper = _ensureElectionSupportStrip(fc);
        if (!wrapper) return false;
        if (initialBatch) wrapper.appendChild(el);         // Firestore DESC order -> newest first, left to right
        else wrapper.insertBefore(el, wrapper.firstChild); // live new post -> newest at the left
        return true;
    }

    /* FIX (dev task list — "make the I support card thumbnail
       horizontally scrollable ... fix inside the original separate
       existing files"): exposed on window, same convention as this
       file's own window._empQmStripPlace/window._empIsQuoteCardPost for
       the quote/meme strip. Both were previously ONLY reachable from
       THIS file's own copy of the posts listener — but app-fixes.js
       ships its own separate copy of that same listener (see that
       file's own big `db.collection('posts')...onSnapshot` block), and
       whichever copy's `!window._postsListener` check wins the race is
       the one that actually renders every post, including election-
       support ones. Today this file loads first and does win, but that
       race has flipped before elsewhere in this codebase (see the
       quote/meme strip's own header comment above), and if it ever does
       here too, app-fixes.js's listener has no election-support
       handling at all — no overlay, no rotating text, no strip, just a
       plain generic post. Exposing these lets app-fixes.js's listener
       call the exact same enhancement + strip placement this one uses,
       so the feature keeps working either way instead of silently
       depending on load order. */
    window._empEnhanceElectionSupportCard = _enhanceElectionSupportCard;
    window._empPlaceInElectionSupportStrip = _placeInElectionSupportStrip;


    /* =========================================================================
       §2  SOS POST CARD
       ========================================================================= */

    /* ── Amount-needed badge — single shared source ───────────────────────────
       Canonical, premium badge for the SOS "amount needed" panel. This is the
       ONLY place this component is defined — app-sos.js used to keep its own
       copy (_buildSosGoalBadgeHTML / .sos-goal-badge, red theme) which has
       been removed in favour of calling window.buildSosAmountBadgeHTML() here,
       so both files render an identical badge and there is only one place to
       update going forward. Self-contained <style> injection (no index.html /
       style.css edit needed) so it can't collide with any other stylesheet
       section — same pattern app-sos.js originally used.
       Theme: Royal Blue & Gold, matching the app's own brand tokens
       (--color-royal / --color-navy / --color-gold in tokens.css) rather than
       an unrelated palette. */
    function _injectSosAmountBadgeStyles() {
        if (document.getElementById('sos-amount-badge-styles')) return;
        const s = document.createElement('style');
        s.id = 'sos-amount-badge-styles';
        s.textContent =
            '.sos-goal-badge{display:flex;align-items:center;gap:14px;margin-top:10px;' +
            'padding:14px 18px;border-radius:20px;position:relative;overflow:hidden;' +
            'background:linear-gradient(135deg,rgba(27,43,139,0.07),rgba(139,92,246,0.07));' +
            'border:1px solid rgba(139,92,246,0.22);box-shadow:0 6px 20px rgba(10,14,39,0.10);' +
            'transition:box-shadow 0.25s ease,transform 0.25s ease;}' +
            '.sos-goal-badge:hover{box-shadow:0 10px 28px rgba(10,14,39,0.14);transform:translateY(-1px);}' +
            '.sos-goal-badge::before{content:"";position:absolute;top:0;left:0;width:4px;height:100%;' +
            'background:linear-gradient(180deg,#1B2B8B,#8B5CF6);}' +
            '.sos-goal-badge-watermark{position:absolute;top:-16px;right:-12px;width:86px;height:86px;' +
            'color:rgba(139,92,246,0.10);pointer-events:none;}' +
            '.sos-goal-badge-watermark svg{width:100%;height:100%;}' +
            '.sos-goal-badge-shimmer{position:absolute;top:0;left:-60%;width:45%;height:100%;' +
            'background:linear-gradient(120deg,transparent,rgba(139,92,246,0.24),transparent);' +
            'animation:sosGoalShimmer 3.4s ease-in-out infinite;pointer-events:none;}' +
            '@keyframes sosGoalShimmer{0%{left:-60%;}55%{left:120%;}100%{left:120%;}}' +
            '.sos-goal-badge-icon-wrap{position:relative;flex-shrink:0;width:44px;height:44px;' +
            'display:flex;align-items:center;justify-content:center;}' +
            '.sos-goal-badge-icon-ring{position:absolute;inset:-3px;border-radius:50%;' +
            'background:conic-gradient(from 0deg,#8B5CF6,#C4B5FD,#5B21B6,#8B5CF6);opacity:0.45;' +
            'animation:sosRingSpin 5s linear infinite;}' +
            '@keyframes sosRingSpin{to{transform:rotate(360deg);}}' +
            '.sos-goal-badge-icon{position:relative;z-index:1;flex-shrink:0;width:40px;height:40px;' +
            'border-radius:50%;background:linear-gradient(135deg,#1B2B8B,#0A0E27);display:flex;' +
            'align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(27,43,139,0.35);}' +
            '.sos-goal-badge-icon svg{width:18px;height:18px;stroke:#C4B5FD;transform-origin:center;' +
            'animation:sosHeartbeat 2.6s ease-in-out infinite;}' +
            '@keyframes sosHeartbeat{0%,100%{transform:scale(1);}15%{transform:scale(1.15);}' +
            '30%{transform:scale(1);}45%{transform:scale(1.1);}60%{transform:scale(1);}}' +
            '.sos-goal-badge-text{display:flex;flex-direction:column;line-height:1.28;min-width:0;position:relative;z-index:1;}' +
            '.sos-goal-badge-label{display:flex;align-items:center;gap:5px;font-size:0.66rem;font-weight:700;' +
            'letter-spacing:0.08em;text-transform:uppercase;color:#1B2B8B;opacity:0.85;' +
            'font-family:var(--font-sans,Inter,sans-serif);}' +
            '.sos-goal-badge-label-dot{width:5px;height:5px;border-radius:50%;background:#8B5CF6;' +
            'flex-shrink:0;box-shadow:0 0 6px rgba(139,92,246,0.8);}' +
            '.sos-goal-badge-amount{font-size:1.22rem;font-weight:800;color:#0A0E27;' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
            'font-family:var(--font-sans,Inter,sans-serif);}' +
            '.sos-goal-badge-amount .sos-goal-badge-currency{display:inline-flex;align-items:center;' +
            'justify-content:center;background:rgba(139,92,246,0.14);color:#6D28D9;padding:1px 6px;' +
            'border-radius:6px;font-size:0.68em;font-weight:700;margin-right:5px;vertical-align:middle;}';
        document.head.appendChild(s);
    }

    /**
     * Builds the premium "Amount Needed" badge markup for a given formatted
     * amount string. Shared by app-feed.js's own SOS card and app-sos.js's
     * SOS card + donate-button repair sweep, so there is exactly one badge
     * design in the whole app.
     * @param {string} fmtAmount — already-formatted amount (e.g. "$5,000")
     */
    function buildSosAmountBadgeHTML(fmtAmount) {
        _injectSosAmountBadgeStyles();
        const m = /^([^\d]{1,4})?\s*([\d.,]+.*)$/.exec(fmtAmount || '');
        const currencyPart = (m && m[1]) ? m[1].trim() : '';
        const numberPart   = (m && m[2]) ? m[2].trim() : (fmtAmount || '');
        return (
            '<div class="sos-goal-badge">'
            + '<span class="sos-goal-badge-watermark">'
            + '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21s-7.5-4.6-10-9.5C.3 7.9 2 4 6 4c2.1 0 3.6 1.2 6 4 2.4-2.8 3.9-4 6-4 4 0 5.7 3.9 4 7.5-2.5 4.9-10 9.5-10 9.5z"/></svg>'
            + '</span>'
            + '<span class="sos-goal-badge-shimmer"></span>'
            + '<span class="sos-goal-badge-icon-wrap">'
            + '<span class="sos-goal-badge-icon-ring"></span>'
            + '<span class="sos-goal-badge-icon">'
            + '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-10-9.5C.3 7.9 2 4 6 4c2.1 0 3.6 1.2 6 4 2.4-2.8 3.9-4 6-4 4 0 5.7 3.9 4 7.5-2.5 4.9-10 9.5-10 9.5z"/></svg>'
            + '</span>'
            + '</span>'
            + '<span class="sos-goal-badge-text">'
            + '<span class="sos-goal-badge-label"><span class="sos-goal-badge-label-dot"></span>Amount Needed</span>'
            + '<span class="sos-goal-badge-amount">'
            + (currencyPart ? '<span class="sos-goal-badge-currency">' + currencyPart + '</span>' : '')
            + numberPart
            + '</span>'
            + '</span>'
            + '</div>'
        );
    }
    window.buildSosAmountBadgeHTML = buildSosAmountBadgeHTML;

    /**
     * Build and prepend an approved SOS post into #feed-container.
     * @param {Object} sosData — Firestore sos_queue document
     */
    function _sosWhen(d) {
        /* Real post date: approval/publish date first, then submission date. Handles ISO
           strings, millis and Firestore Timestamps; falls back to "now" only when no date is stored. */
        var raw = d && (d.approvedAt || d.publishedAt || d.createdAt);
        var dt = null;
        if (raw && typeof raw.toDate === 'function') dt = raw.toDate();
        else if (raw && typeof raw.seconds === 'number') dt = new Date(raw.seconds * 1000);
        else if (raw) dt = new Date(raw);
        if (!dt || isNaN(dt.getTime())) dt = new Date();
        var opts = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
        if (dt.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
        return dt.toLocaleString('en-GB', opts);
    }

    function buildSosPostElement(sosData) {
        const el = document.createElement('div');
        el.className      = 'impact-story sos-request';
        el.dataset.postId  = sosData.id;
        el.dataset.userId  = sosData.userId;
        el.dataset.amount  = sosData.amount;
        el.dataset.currency= sosData.currency;
        el.dataset.username= sosData.username;

        let mediaHTML = '';
        if (sosData.media && sosData.media.length > 0) {
            const mc = sosData.media.length;
            const ml = mc === 1 ? 'solo' : mc === 2 ? 'duo' : mc === 3 ? 'trio' : 'grid';
            mediaHTML = '<div class="story-media-container" data-count="' + mc + '" data-layout="' + ml + '">';
            sosData.media.forEach(function (mi, idx) {
                /* Normalise: media items may be {url, type} objects or bare URL strings */
                if (typeof mi === 'string') mi = { url: mi, type: /\.(mp4|webm|ogg|mov)(\?|$)/i.test(mi) ? 'video/mp4' : 'image/jpeg' };
                if (!mi || !mi.url || mi.url.startsWith('blob:')) return;
                const isVid = (mi.type && mi.type.startsWith('video/'))
                    || /\.(mp4|webm|ogg|mov)(\?|$)/i.test(mi.url);
                mediaHTML += '<div class="story-media-item" data-index="' + idx + '">';
                if (isVid) {
                    mediaHTML += '<video src="' + mi.url + '" class="story-video" controls preload="metadata" playsinline></video>';
                } else {
                    mediaHTML += '<img src="' + mi.url + '" class="story-main-image" alt="SOS Evidence" loading="lazy">';
                }
                mediaHTML += '</div>';
            });
            mediaHTML += '</div>';
        }

        let amountStr = sosData.amount;
        try {
            const fmt = new Intl.NumberFormat('en-US', {
                style: 'currency', currency: sosData.currency || 'USD',
                minimumFractionDigits: (sosData.currency === 'EMPY' || sosData.currency === 'USDT') ? 2 : 0
            });
            amountStr = fmt.format(parseFloat(sosData.amount));
        } catch (e) {}

        /* FIX (2026-10-18 — SOS text rendered as a big blank gap with only a sliver of
           the first line, then "Show more"): pasted/typed stories often start with blank
           lines, or use Windows/Android CRLF line endings. formatWhatsAppText turns each
           \n into <br> but leaves the \r behind, and .story-content p is white-space:pre-wrap,
           so every CRLF rendered TWICE and leading blank lines stacked up — which pushed the
           first real line below the 3-line "Show more" clamp. Normalise before formatting. */
        const _cleanStory = function (s) {
            return String(s || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        };
        window._empCleanStoryText = _cleanStory;
        const storyText = (typeof window.formatWhatsAppText === 'function')
            ? window.formatWhatsAppText(_cleanStory(sosData.story)) : _cleanStory(sosData.story);
        // FIX (Saved Posts parity): use the post's own createdAt when present
        // (so a bookmarked SOS post shows its REAL post date, not "now") —
        // falls back to the current time only for a brand-new post that
        // hasn't been given a timestamp yet, same as before.
        const ts = _sosWhen(sosData); // FIX 2026-10-18: handles Timestamps/approvedAt; old posts keep their real date

        el.innerHTML =
            '<div class="story-header">'
            + '<div class="avatar-placeholder square"><img src="' + _attr(sosData.avatar) + '" alt="' + _attr(sosData.username) + '" loading="lazy"'
            + ' onerror="this.onerror=null;this.src=\'https://ui-avatars.com/api/?name=' + encodeURIComponent(sosData.username || 'U') + '&background=5B0EA6&color=fff&size=150\';">'
            + '<span class="avatar-urgency-badge"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8.5v4"/><path d="M12 15.8h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0z"/></svg></span>'
            + '</div>'
            + '<div class="story-user-info"><span class="sos-eyebrow">SOS Appeal</span><strong>' + _esc(sosData.title) + '</strong>'
            + '<span>Request by ' + _esc(sosData.username) + ' · ' + ts + '</span></div>'
            + '<span class="sos-badge"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 16.5h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0z"/></svg> SOS</span>'
            + '</div>'
            + '<div class="story-content">'
            + '<p>' + storyText + '</p>'
            + '</div>'
            + mediaHTML
            + '<div class="story-actions">'
            + '<a class="action-btn comment-btn" data-action="comment" title="Reply"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/></svg><span class="comment-count x-count"></span></span></a>'
            + '<a class="action-btn retweet-btn" data-action="retweet" title="Repost"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.932 9.48.568 8.02 5 3.88zM19.5 20.12l-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2H11V4h5.5c2.209 0 4 1.79 4 4v8.45l1.568-1.93 1.364 1.46-4.432 4.14z"/></svg><span class="retweet-count x-count"></span></span></a>'
            + '<a class="action-btn like-btn" data-action="like" title="Like"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z"/></svg><span class="like-count x-count"></span></span></a>'
            + '<a class="action-btn quote-btn" data-action="quote" title="Quote"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/><path d="M9 10.5c0-.28-.22-.5-.5-.5s-.5.22-.5.5.22.5.5.5.5-.22.5-.5zm3.5 0c0-.28-.22-.5-.5-.5s-.5.22-.5.5.22.5.5.5.5-.22.5-.5zm3.5 0c0-.28-.22-.5-.5-.5s-.5.22-.5.5.22.5.5.5.5-.22.5-.5z" fill="currentColor" stroke="none"/></svg><span class="quote-count x-count"></span></span></a>'
            + '<span class="action-btn view-count-display" title="Views"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><span class="view-count x-count"></span></span>'
            + '<a class="action-btn bookmark-btn" data-action="bookmark" title="Bookmark" style="margin-left:auto;"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l.5 1v16.5l-6-3.5-6 3.5V4l.5-1z"/></svg></span></a>'
            + '<a class="action-btn share-btn" data-action="share" title="Share"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg><span class="share-count x-count"></span></span></a>'
            + '<a class="action-btn download-media-btn" data-action="download" title="Download"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><rect x="4" y="18.4" width="16" height="2.2" rx="1.1" fill="currentColor" stroke="none"/></svg><span class="download-count x-count"></span></span></a>'
            + '</div>'
            /* REDESIGN 2026-10-18: premium 'appeal' panel — amount first, then the donate button.
               Same .help-now-btn class so every existing click handler keeps working. */
            + '<div class="sos-appeal">'
            + '<span class="sos-appeal-verified"><svg viewBox="0 0 24 24"><path d="M12 2l2.4 2 3.1-.3.9 3 2.7 1.6-1 3 1 3-2.7 1.6-.9 3-3.1-.3L12 22l-2.4-2-3.1.3-.9-3L3 15.7l1-3-1-3 2.7-1.6.9-3 3.1.3z"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>Verified appeal</span>'
            + buildSosAmountBadgeHTML(amountStr)
            + '<button class="gift-button sos-button help-now-btn">'
            + '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><span>Donate Now \u2014 Help <em>' + _esc(sosData.username) + '</em></span>'
            + '</button>'
            + '<div class="sos-appeal-trust">Secure payment \u00b7 Goes straight to the beneficiary</div>'
            + '</div>'
            + '<div class="comment-section">'
            + '<div class="comment-sheet-header"><span class="comment-sheet-title">Comments</span><button type="button" class="comment-sheet-close-btn" aria-label="Close comments"><i class="fas fa-times"></i></button></div>'
            + '<div class="comment-list"></div>'
            + '<form class="comment-form" novalidate>'
            + '<input type="text" name="comment-text" placeholder="Add a comment..." required>'
            + '<button type="submit"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>'
            + '</form></div>';

        return el;
    }
    window.buildSosPostElement = buildSosPostElement;

    function createSosPostOnFeed(sosData) {
        const fc = document.getElementById('feed-container');
        if (!fc) return;
        const el = buildSosPostElement(sosData);
        fc.prepend(el);
    }
    window.createSosPostOnFeed = createSosPostOnFeed;


    /* =========================================================================
       §3  CRISIS REPORT CARD
       ========================================================================= */

    /**
     * Build and prepend a crisis report into #feed-container.
     * @param {Object} crisisData — Firestore crisis_reports document
     */
    function buildCrisisPostElement(crisisData) {
        const us = _us();
        let mediaHTML = '';
        if (crisisData.media && crisisData.media.length > 0) {
            mediaHTML = '<div class="story-media-container" data-count="' + crisisData.media.length + '">';
            crisisData.media.forEach(function (mi) {
                // FIX (Saved Posts parity): normalise bare-string media items
                // the same way buildSosPostElement already does — the
                // original inline version here assumed every item was
                // already an {url,type} object, which is only guaranteed
                // for THIS file's own listener-fed data, not for data
                // re-fetched fresh from Firestore elsewhere (e.g. Saved
                // Posts, which stores/returns plain URL strings).
                if (typeof mi === 'string') mi = { url: mi, type: /\.(mp4|webm|mov)(\?|$)/i.test(mi) ? 'video/mp4' : 'image/jpeg' };
                if (!mi || !mi.url || mi.url.startsWith('blob:')) return;
                const isVid = (mi.type || '').startsWith('video/')
                    || /\/video\/upload\//i.test(mi.url)
                    || /\.(mp4|webm|mov)(\?|$)/i.test(mi.url);
                mediaHTML += '<div class="story-media-item">';
                if (isVid) {
                    mediaHTML += '<video src="' + mi.url + '" class="story-video" controls preload="metadata" playsinline></video>';
                } else {
                    mediaHTML += '<img src="' + mi.url + '" class="story-main-image" alt="Crisis Evidence" loading="lazy">';
                }
                mediaHTML += '</div>';
            });
            mediaHTML += '</div>';
        }

        const _cleanDesc = String(crisisData.description || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        const descHtml = (typeof window.formatWhatsAppText === 'function')
            ? window.formatWhatsAppText(_cleanDesc) : _cleanDesc;
        const locationHtml = '<p style="font-size:0.9rem;color:#666;margin-top:10px;">'
            + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> <strong>Location:</strong> '
            + _esc(crisisData.location || 'Unknown') + '</p>';

        const canDelete = (crisisData.userId === us.id || _isAdmin());
        const ts = crisisData.createdAt
            ? new Date(crisisData.createdAt).toLocaleString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
              })
            : 'Recently';

        const el = document.createElement('div');
        el.className       = 'impact-story crisis-report';
        el.dataset.postId   = crisisData.id || ('crisis-' + Date.now());
        el.dataset.userId   = crisisData.userId;

        el.innerHTML =
            '<div class="story-header">'
            + '<div class="avatar-placeholder square"><img src="' + _attr(crisisData.avatar) + '" alt="' + _attr(crisisData.username) + '" loading="lazy"'
            + ' onerror="this.onerror=null;this.src=\'https://ui-avatars.com/api/?name=' + encodeURIComponent(crisisData.username || 'U') + '&background=5B0EA6&color=fff&size=150\';">'
            + '<span class="avatar-urgency-badge"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8.5v4"/><path d="M12 15.8h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0z"/></svg></span>'
            + '</div>'
            + '<div class="story-user-info">'
            + '<span class="crisis-eyebrow">Crisis Report</span><strong>' + _esc(crisisData.type) + '</strong>'
            + '<span>Reported by ' + _esc(crisisData.username) + ' · ' + ts + '</span></div>'
            + '<span class="crisis-badge"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 16.5h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0z"/></svg> Crisis</span>'
            + '<div class="post-options"><button class="options-btn"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>'
            + '<div class="options-menu">'
            + '<a href="#" class="promote-post-btn"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z"/></svg> Promote</a>'
            + (canDelete ? '<a href="#" class="delete-post-btn" style="color:#e53935;"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Delete</a>' : '')
            + '</div></div></div>'
            + '<div class="story-content"><p>' + descHtml + '</p>' + locationHtml + '</div>'
            + mediaHTML
            + '<div class="story-actions">'
            + '<a class="action-btn comment-btn" data-action="comment" title="Reply"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/></svg><span class="comment-count x-count"></span></span></a>'
            + '<a class="action-btn retweet-btn" data-action="retweet" title="Repost"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.932 9.48.568 8.02 5 3.88zM19.5 20.12l-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2H11V4h5.5c2.209 0 4 1.79 4 4v8.45l1.568-1.93 1.364 1.46-4.432 4.14z"/></svg><span class="retweet-count x-count"></span></span></a>'
            + '<a class="action-btn like-btn" data-action="like" title="Like"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z"/></svg><span class="like-count x-count"></span></span></a>'
            + '<a class="action-btn quote-btn" data-action="quote" title="Quote"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/><path d="M9 10.5c0-.28-.22-.5-.5-.5s-.5.22-.5.5.22.5.5.5.5-.22.5-.5zm3.5 0c0-.28-.22-.5-.5-.5s-.5.22-.5.5.22.5.5.5.5-.22.5-.5zm3.5 0c0-.28-.22-.5-.5-.5s-.5.22-.5.5.22.5.5.5.5-.22.5-.5z" fill="currentColor" stroke="none"/></svg><span class="quote-count x-count"></span></span></a>'
            + '<span class="action-btn view-count-display" title="Views"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><span class="view-count x-count"></span></span>'
            + '<a class="action-btn bookmark-btn" data-action="bookmark" title="Bookmark" style="margin-left:auto;"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l.5 1v16.5l-6-3.5-6 3.5V4l.5-1z"/></svg></span></a>'
            + '<a class="action-btn share-btn" data-action="share" title="Share"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg><span class="share-count x-count"></span></span></a>'
            + '<a class="action-btn download-media-btn" data-action="download" title="Download"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><rect x="4" y="18.4" width="16" height="2.2" rx="1.1" fill="currentColor" stroke="none"/></svg><span class="download-count x-count"></span></span></a>'
            + '</div>'
            + '<div class="comment-section">'
            + '<div class="comment-sheet-header"><span class="comment-sheet-title">Comments</span><button type="button" class="comment-sheet-close-btn" aria-label="Close comments"><i class="fas fa-times"></i></button></div>'
            + '<div class="comment-list"></div>'
            + '<form class="comment-form" novalidate>'
            + '<input type="text" name="comment-text" placeholder="Add a comment..." required>'
            + '<button type="submit"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>'
            + '</form></div>';

        return el;
    }
    window.buildCrisisPostElement = buildCrisisPostElement;

    function createCrisisPostOnFeed(crisisData) {
        const fc = document.getElementById('feed-container');
        if (!fc) return;
        const el = buildCrisisPostElement(crisisData);
        fc.prepend(el);
    }
    window.createCrisisPostOnFeed = createCrisisPostOnFeed;


    /* =========================================================================
       §4  REAL-TIME FIRESTORE LISTENERS
       ========================================================================= */

    /**
     * Start all 8 real-time Firestore onSnapshot listeners.
     * Requires Firebase to be loaded and a valid session to exist.
     * Guards against duplicate registrations using window._*Listener handles.
     * Called by: app-auth.js onAuthStateChanged, login handler, online-resume handler.
     */
    window._startRealtimeListeners = function () {
        var db = window.fbDb;

        /* ── Session validation ── */
        var _uid    = (window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid) || null;
        var _lsUser = window.userState && window.userState.id
            && window.userState.id !== 'user-main' && !window.isGuest;
        var hasValidSession = !!_uid || !!_lsUser;

        if (!window._firebaseLoaded || !db) {
            console.warn('[Listeners] Firebase not ready — will retry.');
            if (typeof window._scheduleListenerRetry === 'function') window._scheduleListenerRetry();
            return;
        }
        if (!hasValidSession) {
            try {
                var _se = localStorage.getItem('empyrean_session_email');
                if (_se && window.userState && !window.isGuest) hasValidSession = true;
            } catch (e) {}
        }
        if (!hasValidSession) {
            console.warn('[Listeners] No authenticated user — will retry.');
            if (typeof window._scheduleListenerRetry === 'function') window._scheduleListenerRetry();
            return;
        }

        var uid = _uid || (window.userState && window.userState.id) || 'local';
        console.log('[Listeners] Starting real-time listeners for uid:', uid);

        function _unsub(handle) { try { if (typeof handle === 'function') handle(); } catch (e) {} }

        /* Clear Firebase pre-stubs on first real init */
        if (window._firstRealFirebaseInit) {
            window._firstRealFirebaseInit = false;
            ['_postsListener','_newsListener','_mktListener','_reelsListener',
             '_sosListener','_crisisListener','_announcementsListener','_usersListener']
                .forEach(function (k) {
                    var h = window[k];
                    if (h && typeof h === 'function') {
                        try { h(); } catch (e) {}
                        window[k] = null;
                    }
                });
            /* Also reset the app-news.js active flag so it can restart cleanly */
            window._newsListenerActive = false;
        }

        var us    = _us();
        var mu    = (_S().mockUsers)    || window.mockUsers    || {};
        var ru    = (_S().registeredUsers) || window.registeredUsers || {};

        /* ── 1. POSTS ─────────────────────────────────────────────────────── */
        if (!window._postsListener) {
            var _postsInitialBatch = true;
            window._postsListener = db.collection('posts')
                .orderBy('createdAt', 'desc').limit(40)
                .onSnapshot(function (snap) {
                    if (!snap) return;
                    var fc = document.getElementById('feed-container');
                    var es = document.getElementById('feed-empty-state');
                    snap.docChanges().forEach(function (change) {
                        var post = change.doc.data();
                        if (!post || !post.id) return;

                        /* FEATURE (2026-09-12 — Content Control: block filter):
                           a blocked contact's posts should never even reach the
                           feed DOM (not just be visually hidden — this is the
                           actual "filter posts from selected contacts" from
                           the project spec). Checked here, before ANY branch
                           below (including the SOS branch), since this is the
                           single choke point every post document — of every
                           type — passes through. window.isUserBlocked is
                           defined in app-dom.js; guarded with typeof so this
                           listener still works unchanged if app-dom.js hasn't
                           loaded yet for some reason. */
                        if (typeof window.isUserBlocked === 'function' && window.isUserBlocked(post.userId)) return;

                        /* REVERT (this session — "revert quote/meme card
                           back to vertical positioning, recent posts at
                           top"): the horizontal mid-feed strip experiment
                           (empyreanDashboardQuoteMemeStrip() below, and its
                           per-profile counterpart in app-profile.js) is
                           disabled at the source now — see those functions'
                           own comments. Quote/Meme Card posts (isQuoteCard:
                           true) flow through this listener like any other
                           post again, so they render in the normal vertical
                           timeline, in the same newest-first order
                           (orderBy('createdAt','desc') above +
                           appendChild/prepend below) as everything else. */

                        if (change.type === 'added') {
                            /* SOS posts are rendered by the sos_queue listener with
                               their own card structure — skip them here to prevent a
                               plain generic card from blocking createSosPostOnFeed()
                               on refresh (duplicate-id guard would swallow the real card).
                               Guard: check isSOS flag first; fall back to id prefix for
                               older records that were saved before the isSOS flag existed. */
                            var _isSosPost = post.isSOS || /^sos-/i.test(post.id || '');
                            if (_isSosPost) {
                                /* If the sos_queue listener hasn't rendered it yet
                                   (e.g. sos_queue listener lost race), render it now
                                   so the card is never absent. createSosPostOnFeed has
                                   its own duplicate guard. */
                                if (fc && !fc.querySelector('[data-post-id="' + post.id + '"]')) {
                                    var _sosForFeed = {
                                        id:       post.id,
                                        userId:   post.userId,
                                        username: post.displayUsername || post.username,
                                        avatar:   post.avatar,
                                        title:    post.title  || 'SOS Request',
                                        story:    post.story  || post.text || '',
                                        amount:   post.sosAmount  || post.amount  || '',
                                        currency: post.sosCurrency || post.currency || 'NGN',
                                        media:    post.media  || [],
                                        createdAt:   post.createdAt,
                                        approvedAt:  post.approvedAt,
                                        publishedAt: post.publishedAt,
                                        status:   'approved'
                                    };
                                    if (typeof window.createSosPostOnFeed === 'function') {
                                        window.createSosPostOnFeed(_sosForFeed);
                                    }
                                }
                                return;
                            }
                            var alreadyInFeed = !!(fc && fc.querySelector('[data-post-id="' + post.id + '"]'));
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

                            /* FIX (report — "quote and retweet is still not
                               working very well or optimally... quoted posts
                               do not consistently display the attached
                               media/text, retweeted posts are not properly
                               shown as retweeted messages", screenshot
                               showing a quote posted with none of its
                               original text/media/banner surviving):
                               app-thread.js's _doRepost/_doSubmitQuote
                               already write everything needed
                               (type/origAuthor/origText/origImg/origVideo/
                               origAvatar/retweeterName) onto the post
                               document — but THIS listener, which is the
                               one actual authoritative render every user
                               (including the poster, on their next reload)
                               sees, never read any of it back into the
                               retweetData object createNewPostElement
                               needs to draw the "X Retweeted" banner or the
                               embedded quoted-post block. Every post was
                               silently rendered as if it were a plain post,
                               regardless of type. A same-session, one-time
                               DOM injection right after posting (in
                               app-thread.js) could still look right for the
                               poster in that instant — reloading, or any
                               other viewer, never did. Reconstructing it
                               here, from the same fields already being
                               written, is what makes this listener match
                               what the poster actually saw. */
                            var retweetData = null;
                            var authorForCard = {
                                id: post.userId,
                                fullName: post.username || post.authorName || post.retweeterName || 'User',
                                avatar: av
                            };
                            if (post.type === 'retweet') {
                                /* Twitter-style: the ORIGINAL author is the
                                   main post identity; the retweeter only
                                   gets the small banner above it. Falls back
                                   to a generated avatar for older retweet
                                   docs saved before origAvatar was recorded. */
                                authorForCard = {
                                    id: '',
                                    fullName: post.origAuthor || 'User',
                                    avatar: post.origAvatar
                                        || ('https://ui-avatars.com/api/?name='
                                            + encodeURIComponent(post.origAuthor || 'U')
                                            + '&background=1B2B8B&color=fff&size=150')
                                };
                                /* FEATURE (click the retweet-header banner ->
                                   original post): post.origPostId is already
                                   written by _doRepost/the main feed's own
                                   retweet handler — it just was never read
                                   back into retweetData here. */
                                retweetData = { retweeterName: post.retweeterName || post.username || 'User', isQuote: false, origPostId: post.origPostId || '' };
                            } else if (post.type === 'quote') {
                                var _qOrigMedia = post.origVideo ? [post.origVideo] : (post.origImg ? [post.origImg] : []);
                                retweetData = {
                                    isQuote: true,
                                    originalPost: {
                                        /* FEATURE (click the quote embed ->
                                           original post): quotedPostId is
                                           written by _doSubmitQuote — read
                                           back here so the embed can link to
                                           it, same as origPostId above. */
                                        id:           post.quotedPostId || '',
                                        authorName:   post.origAuthor || 'User',
                                        authorAvatar: post.origAva || post.origAvatar || '',
                                        text:         post.origText || '',
                                        media:        _qOrigMedia
                                    }
                                };
                            }

                            var el = createNewPostElement(
                                post.text || '', media,
                                authorForCard, false, retweetData
                            );
                            el.dataset.postId = post.id;
                            el.dataset.userId = post.userId;
                            /* 2026-11-07: remember when the post was published so the feed can keep the newest posts at the top (see _settleTop in the advert module) */
                            try { var _bornD = (post.createdAt && typeof post.createdAt.toDate === 'function') ? post.createdAt.toDate() : new Date(post.createdAt || Date.now()); var _bornMs = _bornD.getTime(); if (!isNaN(_bornMs)) el.dataset.empBorn = String(_bornMs); } catch (_bornErr) {}
                            if (typeof window._empAttachFbBanner === 'function') { window._empAttachFbBanner(el, post); }   // 2026-10-04 Facebook banner

                            /* FIX (this session — "implement the rotating
                               text and the mock I support card in the
                               like share comments card"): this is the
                               one authoritative render every viewer sees
                               (see the comment block just above this
                               loop), so it's the right place to apply
                               the election-support overlay + rotating
                               banner rather than duplicating this check
                               at every other createNewPostElement() call
                               site in this file/app-fixes.js — those
                               other call sites (retweets, quotes,
                               business posts, admin posts) never carry
                               isElectionSupportPost, so they're
                               unaffected. */
                            if (post.isElectionSupportPost) _enhanceElectionSupportCard(el, post);

                            /* Restore server timestamp */
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
                                // If still unparseable, leave the optimistic-render
                                // timestamp already on the element rather than
                                // overwriting it with the literal text "Invalid Date".
                            }
                            /* Restore persisted like count */
                            var lkN  = post.likes || 0;
                            var rtN  = post.retweetCount || post.retweets || 0;
                            var qtN  = post.quoteCount   || 0;
                            var shN  = post.shareCount   || 0;
                            var dlN  = post.downloadCount|| 0;
                            var vcN  = post.views        || 0;
                            var cmN  = post.commentCount || 0;
                            var fmt  = function(n) { return n > 0 ? new Intl.NumberFormat().format(n) : ''; };
                            var lc = el.querySelector('.like-count');     if (lc) lc.textContent = fmt(lkN);
                            var rc = el.querySelector('.retweet-count');  if (rc) rc.textContent = fmt(rtN);
                            var qc = el.querySelector('.quote-count');    if (qc) qc.textContent = fmt(qtN);
                            var sc = el.querySelector('.share-count');    if (sc) sc.textContent = fmt(shN);
                            var dc = el.querySelector('.download-count'); if (dc) dc.textContent = fmt(dlN);
                            var vc = el.querySelector('.view-count');     if (vc) vc.textContent = fmt(vcN);
                            var cc = el.querySelector('.comment-count');  if (cc) cc.textContent = fmt(cmN);

                            if (fc && !alreadyInFeed) {
                                /* FIX (2026-09-20 — "quote/meme cards still all vertical"): this file's
                                   OWN copy of the posts listener can be the one that claims
                                   window._postsListener (both copies guard on `!window._postsListener`
                                   and this file loads first — see the marketplace race documented
                                   further down), in which case app-fixes.js's copy never runs and its
                                   quote/meme hook is never reached. Same hook here, so it works
                                   whichever copy wins. Falls back to the vertical placement below if
                                   the strip helper is missing or throws. */
                                var _qmPlaced = false;
                                if (typeof window._empQmStripPlace === 'function' && typeof window._empIsQuoteCardPost === 'function' && window._empIsQuoteCardPost(post)) {
                                    try { _qmPlaced = !!window._empQmStripPlace(el, _postsInitialBatch); }
                                    catch (_qmErr) { console.warn('[QuoteMemeStrip] placement failed, using vertical fallback:', _qmErr && _qmErr.message); }
                                }
                                /* FIX (this session — "make it horizontally
                                   scrollable like the quote and meme card"):
                                   election-support posts get the same
                                   horizontal-strip treatment, via their own
                                   small strip (see _placeInElectionSupportStrip
                                   above) rather than the disarmed quote/meme
                                   one. Only tried when the quote/meme strip
                                   didn't already claim this post (it never
                                   will for an election post, but this keeps
                                   the two checks mutually exclusive on
                                   principle, same as _qmPlaced's own pattern). */
                                if (!_qmPlaced && post.isElectionSupportPost) {
                                    try { _qmPlaced = _placeInElectionSupportStrip(el, _postsInitialBatch); }
                                    catch (_esErr) { console.warn('[ElectionSupportStrip] placement failed, using vertical fallback:', _esErr && _esErr.message); }
                                }
                                if (!_qmPlaced) {
                                    if (_postsInitialBatch) { fc.appendChild(el); } else {
                                        fc.prepend(el);
                                        /* Show "↑ New post" pill if user is scrolled down — pass the
                                           actual element just prepended so the pill can later scroll
                                           to this ONE precise post instead of a generic container top. */
                                        if (typeof window._notifyNewPost === 'function') window._notifyNewPost(el);
                                    }
                                }
                                if (es) es.style.display = 'none';
                            }

                            /* Mirror own posts to profile feeds */
                            if (post.userId === us.id && !post.isRetweet) {
                                ['profile-dash-feed', 'profile-posts-feed'].forEach(function (fid) {
                                    var pf = document.getElementById(fid);
                                    if (pf && !pf.querySelector('[data-post-id="' + post.id + '"]')) {
                                        var clone = el.cloneNode(true);
                                        if (_postsInitialBatch) { pf.appendChild(clone); } else { pf.prepend(clone); }
                                    }
                                });
                                if (post.media && post.media.length) {
                                    _addUrlsToProfileGallery(
                                        post.media.filter(function (u) { return u && !u.startsWith('blob:'); })
                                    );
                                }
                            }

                        } else if (change.type === 'removed') {
                            /* FIX (2026-10-18): same guard as app-fixes.js's posts listener -- a cache-only snapshot
                               or a doc falling out of the limit(40) window must not remove a post that still exists. */
                            if (snap.metadata && snap.metadata.fromCache) return;
                            (function (pid, ref) {
                                function _drop() {
                                    ['feed-container', 'profile-dash-feed', 'profile-posts-feed'].forEach(function (fid) {
                                        var f2 = document.getElementById(fid);
                                        if (f2) { var e2 = f2.querySelector('[data-post-id="' + pid + '"]'); if (e2) e2.remove(); }
                                    });
                                }
                                if (!ref || typeof ref.get !== 'function') { _drop(); return; }
                                ref.get({ source: 'server' }).then(function (d) { if (!d.exists) _drop(); }, function () {});
                            })(post.id, change.doc.ref);
                        } else if (change.type === 'modified') {
                            /* Sync all interaction counts on the feed card when Firestore updates */
                            ['feed-container', 'profile-dash-feed', 'profile-posts-feed'].forEach(function (fid) {
                                var f3 = document.getElementById(fid);
                                if (!f3) return;
                                var card = f3.querySelector('[data-post-id="' + post.id + '"]');
                                if (!card) return;
                                var fmt = function(n) { return n > 0 ? new Intl.NumberFormat().format(n) : ''; };
                                var lkEl = card.querySelector('.like-count');
                                var rtEl = card.querySelector('.retweet-count');
                                var qtEl = card.querySelector('.quote-count');
                                var shEl = card.querySelector('.share-count');
                                var dlEl = card.querySelector('.download-count');
                                var vcEl = card.querySelector('.view-count');
                                var cmEl = card.querySelector('.comment-count');
                                if (lkEl) lkEl.textContent = fmt(post.likes);
                                if (rtEl) rtEl.textContent = fmt(post.retweetCount || post.retweets);
                                if (qtEl) qtEl.textContent = fmt(post.quoteCount);
                                if (shEl) shEl.textContent = fmt(post.shareCount);
                                if (dlEl) dlEl.textContent = fmt(post.downloadCount);
                                if (vcEl) vcEl.textContent = fmt(post.views);
                                if (cmEl) cmEl.textContent = fmt(post.commentCount);
                            });
                        }
                    });
                    _postsInitialBatch = false;
                }, function (err) {
                    console.error('[Listener:posts]', err.code, err.message);
                    window._postsListener = null;
                });
            console.log('[Firestore] ✅ posts listener active');
        }

        /* ── 2. NEWS — owned by app-news.js ──────────────────────────────── */
        /* app-news.js starts window._newsListener via its own _startNewsListener().
           It uses window._newsCache as source-of-truth so renderDashboardNews()
           never needs to scrape a hidden DOM section. Do not start a second
           listener here — the _newsListenerActive flag prevents double-starts. */
        if (typeof window._startNewsListener === 'function' && !window._newsListenerActive) {
            window._startNewsListener();
        }

        /* ── 3. MARKETPLACE ───────────────────────────────────────────────── */
        // FIX (2026-08-05 — root cause of "position/design fixes not
        // showing" across several reports): app-fixes.js's own copy of
        // _startRealtimeListeners (loaded later, at index.html's app-
        // fixes.js tag) is supposed to be the one and only version that
        // ever runs — it's reassigned onto window._startRealtimeListeners
        // and carries the current marketplace card design (avatar cards,
        // middle positioning, category-aware contact wording). But this
        // file's OWN copy, defined here, is still the version that exists
        // on window._startRealtimeListeners for the entire stretch between
        // this script executing and app-fixes.js's script executing later
        // in index.html. If Firebase's onAuthStateChanged microtask
        // resolves and calls window._startRealtimeListeners() anywhere in
        // that window (session-restore on a repeat visit can resolve fast
        // enough for this), THIS older implementation builds the
        // marketplace grid instead — with no dataset.category, no avatar
        // card, no middle positioning, and the generic "Contact Seller" /
        // "Please conduct due diligence" text app-patch-v2.js's category-
        // aware wording never gets a chance to run against. Once this
        // stale copy claims window._mktListener, app-fixes.js's own
        // "if (!window._mktListener)" guard skips entirely and the newer
        // design never takes over for that page load.
        // FIX: skip this file's own marketplace section whenever the newer
        // marketplace module (app-marketplace.js, loaded immediately after
        // this file in index.html) is already available — a reliable
        // signal that the real implementation is ready to take over.
        // window._mktListener is deliberately left unset in that case, so
        // whichever call reaches app-fixes.js's copy next (this same
        // startup pass, the online-reconnect handler, or the retry
        // backoff — all of which already exist) sets up the one true
        // marketplace listener instead. This file's other 7 listeners
        // (posts, news, reels, etc.) are unaffected — only marketplace is
        // skipped here, since that's the one app-fixes.js's copy actually
        // diverges from.
        if (false && !window._mktListener && typeof window._mktIsAvatarCategory !== 'function') {
            // DISABLED (request — "two or more marketplace cards should not
            // appear on the same site"): the guard above
            // (`typeof window._mktIsAvatarCategory !== 'function'`) was
            // meant to skip this stale copy once app-marketplace.js's
            // newer implementation was ready, but it's a load-order race,
            // not a guarantee — this file's own comment right above
            // already documents exactly that risk. If onAuthStateChanged
            // resolves before app-marketplace.js has executed (fast
            // session-restore on a repeat visit), this older listener
            // claims window._mktListener permanently for that page load,
            // and app-fixes.js's newer, category-aware, document-aware
            // card design never gets a chance to render. Hard-disabling
            // this block removes the race entirely: window._mktListener
            // is now never set here, so app-fixes.js's own "MARKETPLACE"
            // listener (its "if (!window._mktListener)" block) is
            // guaranteed to be the one that ever attaches, regardless of
            // timing. This file's other 7 listeners are untouched.
            window._mktListener = db.collection('marketplace_listings')
                .orderBy('createdAt', 'desc').limit(40)
                .onSnapshot(function (snap) {
                    if (!snap) return;
                    var grid      = document.getElementById('property-grid-container');
                    var mktSlider = document.getElementById('dashboard-market-slider');
                    snap.docChanges().forEach(function (change) {
                        var item = change.doc.data();
                        if (!item || !item.id) return;
                        if (change.type === 'added') {
                            var firstUrl = item.media && item.media[0] ? item.media[0] : '';
                            var isVid = (item.mediaTypes && (item.mediaTypes[0] || '').startsWith('video/'))
                                || /\/video\/upload\//i.test(firstUrl)
                                || /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(firstUrl);
                            var syms = { NGN: '₦', USD: '$', EUR: '€', GBP: '£', GHS: '₵', EMPY: 'EMPY ', USDT: 'USDT ' };
                            var sym      = syms[item.currency] || '$';
                            var priceStr = sym + parseFloat(item.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
                            var isNew    = item.createdAt && (Date.now() - new Date(item.createdAt).getTime() < 30000);

                            if (grid && !grid.querySelector('[data-id="' + item.id + '"]')) {
                                var allUrls = item.media || [];
                                var mktMediaHTML = '';
                                if (allUrls.length === 0) {
                                    mktMediaHTML = '<div style="width:100%;height:200px;background:linear-gradient(135deg,#1B2B8B,#0A0E27);'
                                        + 'display:flex;align-items:center;justify-content:center;">'
                                        + '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>';
                                } else if (allUrls.length === 1) {
                                    mktMediaHTML = isVid
                                        ? '<video src="' + firstUrl + '" autoplay loop muted playsinline controls style="width:100%;height:200px;object-fit:cover;display:block;"></video>'
                                        : '<img src="' + firstUrl + '" alt="' + _esc(item.name || '') + '" loading="lazy" style="width:100%;height:200px;object-fit:cover;display:block;">';
                                } else {
                                    var cols = allUrls.length === 2 ? '1fr 1fr' : allUrls.length === 3 ? '2fr 1fr' : '1fr 1fr';
                                    mktMediaHTML = '<div style="display:grid;grid-template-columns:' + cols + ';gap:3px;height:200px;overflow:hidden;">';
                                    allUrls.slice(0, 4).forEach(function (mu, mi) {
                                        var isV = /\.(mp4|webm|mov)(\?|$)/i.test(mu) || /\/video\/upload\//i.test(mu);
                                        var extra = allUrls.length === 3 && mi === 0 ? 'grid-row:1/3;' : '';
                                        mktMediaHTML += isV
                                            ? '<video src="' + mu + '" controls muted playsinline style="width:100%;height:100%;object-fit:cover;' + extra + '"></video>'
                                            : '<img src="' + mu + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;' + extra + '">';
                                    });
                                    if (allUrls.length > 4) {
                                        mktMediaHTML += '<div style="display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);color:white;font-size:1.2rem;font-weight:800;">+'
                                            + (allUrls.length - 4) + '</div>';
                                    }
                                    mktMediaHTML += '</div>';
                                }

                                var card = document.createElement('div');
                                card.className = 'property-card';
                                card.dataset.id      = item.id;
                                card.dataset.price   = item.price;
                                card.dataset.name    = item.name || '';
                                card.dataset.displayCurrency = item.currency;
                                card.dataset.salesType = item.salesType || '';
                                card.dataset.media   = JSON.stringify(item.media || []);
                                card.dataset.sellerId = item.sellerId || '';
                                card.innerHTML = mktMediaHTML
                                    + '<div class="property-info"><h4>' + _esc(item.name || '') + '</h4>'
                                    + '<p><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ' + _esc(item.location || '') + '</p>'
                                    + '<div style="font-weight:700;color:var(--accent-color);font-size:1rem;">' + priceStr + '</div></div>'
                                    + '<div class="property-seller-info"><strong>@' + _esc(item.sellerName || item.username || 'Seller') + '</strong>'
                                    + (item.salesType === 'escrow'
                                        ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>'
                                        : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>')
                                    + '<span style="font-size:0.72rem;color:var(--text-muted);">'
                                    + (item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Recently')
                                    + '</span></div>'
                                    /* FIX (request — "the option Conduct Due Diligence should be
                                       removed"): dropped outright, matching the same fix in
                                       app-fixes.js's own (primary) card builder. */
                                    + '<div class="direct-contact-info" style="display:none;"></div>'
                                    + '<div class="property-actions">'
                                    + (item.salesType === 'escrow'
                                        ? '<button class="btn btn-accent add-to-cart-btn"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> Add to Cart</button>'
                                        : '<button class="btn btn-danger contact-seller-btn"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.38 2 2 0 0 1 3.59 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.27a16 16 0 0 0 5.82 5.82l.92-.92a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Contact Seller</button>')
                                    + '<button class="btn promote-post-btn"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg> Promote</button>'
                                    + ((item.sellerId === us.id || _isAdmin())
                                        ? '<button class="btn edit-post-btn" style="background:rgba(27,43,139,0.08);color:var(--secondary);border:1px solid rgba(27,43,139,0.2);"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit</button>'
                                        + '<button class="btn delete-post-btn" style="background:rgba(229,57,53,0.08);color:#e53935;border:1px solid rgba(229,57,53,0.2);"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Delete</button>'
                                        : '')
                                    + '</div>';

                                if (isNew) { grid.prepend(card); } else { grid.appendChild(card); }

                                /* Dashboard slider card */
                                if (mktSlider && !mktSlider.querySelector('[data-id="' + item.id + '"]')) {
                                    var dc = document.createElement('div');
                                    dc.className = 'dashboard-market-card';
                                    dc.dataset.id = item.id;
                                    dc.dataset.navTarget = 'marketplace';
                                    /* FIX (2026-10-20): carry seller + phone so the dashboard WhatsApp/Call/Message icons work for everyone */
                                    dc.dataset.sellerId = item.sellerId || ''; dc.dataset.sellerName = item.sellerName || ''; dc.dataset.contactPhone = item.contactPhone || item.phone || ''; dc.dataset.category = item.category || '';
                                    dc.innerHTML = (firstUrl
                                        ? (isVid
                                            ? '<video src="' + firstUrl + '" autoplay loop muted playsinline style="width:100%;height:100%;object-fit:cover;display:block;"></video>'
                                            : '<img src="' + firstUrl + '" alt="' + _esc(item.name || '') + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;">')
                                        : '')
                                        + '<div class="dashboard-market-card-info"><h5>' + _esc(item.name || '') + '</h5><p>' + priceStr + '</p></div>';
                                    if (isNew) { mktSlider.prepend(dc); } else { mktSlider.appendChild(dc); }
                                }
                                if (isNew && window.pushNotification) {
                                    window.pushNotification(
                                        '🛒 New listing: ' + (item.name || 'item') + ' by @' + (item.sellerName || 'seller'),
                                        'new_listing'
                                    );
                                }
                            }
                        } else if (change.type === 'removed') {
                            var e2 = grid && grid.querySelector('[data-id="' + item.id + '"]');
                            if (e2) e2.remove();
                        }
                    });
                }, function (err) {
                    console.error('[Listener:mkt]', err.code, err.message);
                    window._mktListener = null;
                });
            console.log('[Firestore] ✅ marketplace_listings listener active');
        }

        /* ── 4. REELS ─────────────────────────────────────────────────────── */
        if (!window._reelsListener) {
            window._reelsListener = db.collection('reels')
                .orderBy('createdAt', 'desc').limit(30)
                .onSnapshot(function (snap) {
                    if (!snap) return;
                    snap.docChanges().forEach(function (change) {
                        var reel = change.doc.data();
                        if (!reel || !reel.id || !reel.videoUrl || reel.videoUrl.startsWith('blob:')) return;
                        /* FIX ("chat icon in the reel section should show a
                           live comment count"): this listener used to bail
                           out for every change type except 'added' — so a
                           reel's grid card was built ONCE, from whatever
                           reel.comments.length was at that instant (almost
                           always 0, a brand-new reel), and never touched
                           again. Firestore fires 'modified', not 'added',
                           when the SAME doc is later updated — which is
                           exactly what the comment-send handler in
                           app-reel.js does (.update({ comments: [...] })
                           on the existing reels/{id} doc, see its own
                           comment) — so every comment posted after the
                           initial render, by this viewer or anyone else,
                           silently never reached the badge. Handling
                           'modified' here — read-only, updates the existing
                           card in place, no new card, no re-fetch — is what
                           makes the count live for every viewer watching
                           the grid, not just whoever opens the comments
                           drawer. */
                        if (change.type === 'modified') {
                            var _rgExisting = document.getElementById('reels-grid-container');
                            var _rgCard = _rgExisting && _rgExisting.querySelector('[data-post-id="' + reel.id + '"]');
                            if (_rgCard) {
                                var _rgCount = (reel.comments || []).length;
                                var _rgIndicator = _rgCard.querySelector('.reel-grid-comment-indicator');
                                var _rgCountEl = _rgCard.querySelector('.reel-comment-count');
                                if (_rgCountEl) _rgCountEl.textContent = _rgCount;
                                if (_rgIndicator) {
                                    _rgIndicator.setAttribute('aria-label', _rgCount + ' comments — view');
                                    _rgIndicator.setAttribute('title', _rgCount + ' comments');
                                }
                            }
                            return;
                        }
                        if (change.type !== 'added') return;

                        var isNew = reel.createdAt && (Date.now() - new Date(reel.createdAt).getTime() < 30000);

                        /* Dashboard slider */
                        var slider  = document.getElementById('dashboard-reels-slider');
                        var reelCnt = document.getElementById('dashboard-reels-container');
                        if (slider) {
                            if (reelCnt) reelCnt.style.display = 'block';
                            var existing = slider.querySelector('[data-reel-id="' + reel.id + '"]');
                            if (existing) {
                                var ev = existing.querySelector('video');
                                if (ev) ev.src = reel.videoUrl;
                                existing.dataset.reelId = reel.id;
                            } else {
                                var dc2 = document.createElement('div');
                                dc2.className = 'dashboard-reel-card';
                                dc2.dataset.navTarget = 'reels';
                                dc2.dataset.reelId    = reel.id;
                                var _reelAvFallback = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(reel.username || 'U') + '&background=1B2B8B&color=fff&size=80';
                                /* FIX (2026-08-22 — dashboard "New Reels" thumbnails rendering
                                   inconsistently): see _empReelPosterUrl in app-reel.js. Autoplay
                                   usually hides the black-box gap here, but autoplay can still be
                                   blocked (data-saver mode, some mobile browsers) — a poster keeps
                                   every card showing real content immediately either way. */
                                var _dashReelPoster = (typeof window._empReelPosterUrl === 'function') ? window._empReelPosterUrl(reel.videoUrl) : '';
                                dc2.innerHTML =
                                    '<video src="' + reel.videoUrl + '"' + (_dashReelPoster ? ' poster="' + _attr(_dashReelPoster) + '"' : '') + ' loop muted autoplay playsinline'
                                    + ' style="width:100%;height:100%;object-fit:cover;display:block;">'
                                    + '<source src="' + reel.videoUrl + '" type="video/mp4"></video>'
                                    + '<div class="reel-content">'
                                    + '<div class="dashboard-reel-avatar" title="@' + _attr(reel.username || 'user') + '">'
                                    + '<img src="' + _attr(reel.avatar || _reelAvFallback) + '" alt="@' + _attr(reel.username || '') + '" '
                                    + 'onerror="this.onerror=null;this.src=\'' + _reelAvFallback + '\';"></div>'
                                    + '</div>';
                                if (isNew) { slider.prepend(dc2); } else { slider.appendChild(dc2); }
                            }
                        }

                        /* Main reels grid */
                        var rg = document.getElementById('reels-grid-container');
                        if (rg) {
                            var existCard = rg.querySelector('[data-post-id="' + reel.id + '"]');
                            if (existCard) {
                                var ev2 = existCard.querySelector('video');
                                if (ev2 && reel.videoUrl) ev2.src = reel.videoUrl;
                                existCard.dataset.videoUrl = reel.videoUrl;
                                if (typeof window._empReelPinSync === 'function') window._empReelPinSync(existCard, reel); /* pins edited live (2026-10-04) */
                            } else {
                                var rc = document.createElement('div');
                                rc.className        = 'reel-card';
                                rc.dataset.postId   = reel.id;
                                rc.dataset.videoUrl = reel.videoUrl;
                                rc.dataset.userId   = reel.userId || '';
                                rc.dataset.createdAt = reel.createdAt || '';
                                /* FIX (2026-08-10 — reel viewer showing literal "@user" instead
                                   of the author's name): _buildReelViewerItem() in app-reel.js
                                   (fires when this card is tapped to open the fullscreen reel
                                   viewer) reads the author's name from THIS card's data-username
                                   attribute first, falling back to a DOM lookup for an element
                                   with "username" in its class name, and only as a last resort
                                   the literal string 'user'. This card never set data-username at
                                   all, and the <span> below showing the name has no class
                                   attribute for that fallback lookup to match — so every reel
                                   opened from this grid fell straight through to the hardcoded
                                   'user' placeholder, no matter what name was actually stored on
                                   the reel doc.
                                   NOTE: this exact same gap was first (mistakenly) fixed only in
                                   app-fixes.js's own near-duplicate reels listener — but THIS
                                   listener, in app-feed.js, loads first in index.html and wins
                                   the window._reelsListener race, so it — not the one in
                                   app-fixes.js — is the one that actually runs. Fixing it here is
                                   what actually reaches the live site. app-fixes.js's copy of
                                   this listener never executes as long as this one wins that
                                   race, but its own fix is left in place as a harmless safety net
                                   in case load order ever changes. */
                                rc.dataset.username  = reel.username || 'user';
                                rc.dataset.avatar    = reel.avatar   || '';
                                rc.dataset.caption   = reel.caption  || '';

                                /* REEL SECTION REDESIGN (2026-08-10): below-thumbnail
                                   two-column meta row (creator + time on the left, a direct
                                   comment button on the right) plus a three-dot "more options"
                                   menu (Download / Share / Like / Report, and Edit/Delete for
                                   the owner or an admin). The old on-video gradient overlay
                                   (avatar/username/caption painted over the thumbnail) is gone
                                   — the same info now lives in real DOM below the thumbnail
                                   instead, per this session's spec. Auto-play-at-top / sticky
                                   "now playing" behavior, opening the kebab menu, and the
                                   Report flow are all wired generically off these same
                                   classes/data-attributes in app-reel.js (the reels engagement
                                   module) — this file only needs to emit the markup. */
                                var _reelAvFallback2 = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(reel.username || 'U') + '&background=1B2B8B&color=fff&size=80';
                                var _reelShareUrl    = window.location.origin + '/?post=' + encodeURIComponent(reel.id);
                                var _canModerate     = (reel.userId === us.id || _isAdmin());

                                /* REDESIGN (2026-08-10, follow-up): the video "player" area is
                                   now wrapped in .reel-video-wrap (kept deliberately compact —
                                   see .reel-video-wrap > video's max-height in app-reel.js) and
                                   carries its own play/pause + mute/unmute control pair
                                   (.reel-audio-controls), shown only while this card is the
                                   active/playing one. The three-dot "more options" menu has
                                   moved off the video entirely — it now sits in
                                   .reel-meta-actions, directly after the Comment button, instead
                                   of floating over the top-right corner of the thumbnail. */
                                /* FIX (2026-08-22 — thumbnails rendering
                                   inconsistently / solid black before
                                   playback): see _empReelPosterUrl's own
                                   header comment in app-reel.js — this
                                   generates a real poster frame so the
                                   card shows actual content immediately
                                   instead of racing video-decode timing.
                                   Guarded: if app-reel.js hasn't attached
                                   the helper yet, or it can't derive a
                                   poster for this URL, posterAttr is just
                                   '' and rendering is unchanged from
                                   before this fix. */
                                var _reelPosterUrl = (typeof window._empReelPosterUrl === 'function') ? window._empReelPosterUrl(reel.videoUrl) : '';
                                rc.innerHTML =
                                    '<div class="reel-video-wrap">'
                                        + '<video src="' + reel.videoUrl + '"' + (_reelPosterUrl ? ' poster="' + _attr(_reelPosterUrl) + '"' : '') + ' loop muted playsinline preload="metadata"></video>'
                                        /* DURATION BADGE (this session, point 1): small dark
                                           pill in the bottom-right corner of the thumbnail
                                           showing the clip's length (e.g. "0:16"), matching the
                                           reference screenshot. Starts empty (CSS hides an empty
                                           badge) and is filled in by app-reel.js's
                                           _wireReelDurations() once the video's metadata loads —
                                           preload="metadata" above means that duration becomes
                                           available WITHOUT the video ever actually playing. */
                                        + '<span class="reel-duration-badge" data-reel-id="' + _attr(reel.id) + '"></span>'
                                        /* VIEWS BADGE (2026-10-19): compact eye + count pill on the
                                           thumbnail's bottom-left, read from the reel's Firestore
                                           `viewCount` (the same field app-reel.js increments when a
                                           reel is opened). Inline SVG so it never depends on the
                                           icon font. Shows 0 rather than hiding, so every card
                                           looks identical. */
                                        + '<span class="reel-views-badge" data-reel-id="' + _attr(reel.id) + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg><span>' + (function (n) { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n); })(reel.viewCount || reel.views) + '</span></span>'
                                        /* INLINE UPLOAD ICON (2026-08-10): small trigger for the
                                           reel composer, anchored directly on the video itself so
                                           it's always right next to the pinned "now playing" card
                                           (point 4 of this session's request). Only ever shown while
                                           THIS card is the active/pinned one — see the matching
                                           ".reel-card.reel-card-active .reel-inline-upload-btn"
                                           display rule in app-reel.js — every other (non-active)
                                           card in the grid keeps this hidden, same pattern already
                                           used for .reel-audio-controls above. Reuses the shared
                                           .section-create-toggle-btn click handler (app-fixes.js)
                                           via data-panel, so no new JS wiring is needed here. */
                                        + '<button type="button" class="section-create-toggle-btn reel-inline-upload-btn" data-panel="reels-create-panel" aria-label="Record or upload a reel" title="Post a Short Reel"><i class="fas fa-plus"></i></button>'
                                        + '<div class="reel-audio-controls">'
                                            /* ICON FIX (2026-08-10): this button starts out playing
                                               (reels autoplay muted as soon as they become the pinned
                                               card), so its icon must start matching the toggle logic
                                               in app-reel.js, which only ever adds/removes
                                               fa-play/fa-pause.
                                               PREMIUM ICON PASS (this session): was fa-circle-pause —
                                               that glyph draws its own ring, which doubled up with
                                               this button's own circular glass background. Switched to
                                               the plain fa-pause glyph (paired with fa-play on toggle)
                                               so only one ring shows. Keep this in sync with BOTH
                                               fa-play/fa-pause toggle sites in app-reel.js if either
                                               ever changes again. */
                                            + '<button class="reel-playpause-btn" data-reel-id="' + _attr(reel.id) + '" aria-label="Play or pause" title="Play/Pause"><i class="fas fa-pause"></i></button>'
                                            /* AUDIO FIX (2026-08-11): a prior session removed the
                                               manual mute/unmute toggle entirely, but reels autoplay
                                               muted by hard browser requirement — with the toggle
                                               gone there was no way left for a person to ever hear
                                               the pinned/"now playing" reel's audio at all (it just
                                               stayed silently muted forever). Restored here, wired
                                               in app-reel.js's delegated click listener + reset
                                               alongside the play/pause icon in _applyActiveReelOrdering()
                                               so a freshly-pinned reel always starts back at muted
                                               (matching the actual autoplay state) rather than
                                               showing a stale "unmuted" icon from a previous card. */
                                            + '<button class="reel-mute-btn" data-reel-id="' + _attr(reel.id) + '" aria-label="Mute or unmute" title="Tap for sound"><i class="fas fa-volume-mute"></i></button>'
                                        + '</div>'
                                    + '</div>'
                                    + (reel.caption ? (typeof window._empReelCapRowHtml === 'function' ? window._empReelCapRowHtml(reel.caption) : '<div class="reel-caption-line">' + _esc(reel.caption) + '</div>') : '') /* one-line caption + chevron (2026-10-04) */
                                    + '<div class="reel-meta-row">'
                                        /* PROFILE TAP SPLIT (this session, point 3): the whole
                                           .reel-meta-left block used to carry ONE
                                           data-view-profile attribute, so tapping either the
                                           avatar OR the username jumped straight to the full
                                           profile page. Now split: the avatar alone opens a
                                           quick preview sheet (data-preview-profile — see
                                           app-reel.js's delegated handler, which reuses the
                                           app's existing generic profile-preview sheet,
                                           window.openHostPreviewModal(), already used the same
                                           way for live-stream host/guest avatars), and only the
                                           username text itself (data-view-profile, unchanged
                                           attribute/behavior) still jumps straight to the full
                                           profile page. data-view-profile is removed from this
                                           wrapping div so it no longer fires from anywhere else
                                           inside it (e.g. the timestamp). */
                                        + '<div class="reel-meta-left">'
                                            + '<img class="reel-meta-avatar" data-preview-profile="' + _attr(reel.userId || '') + '" src="' + _attr(reel.avatar || _reelAvFallback2) + '" onerror="this.onerror=null;this.src=\'' + _reelAvFallback2 + '\';">'
                                            + '<div class="reel-meta-text">'
                                                + '<span class="reel-meta-username" data-view-profile="' + _attr(reel.userId || '') + '">@' + _esc(reel.username || 'user') + '</span>'
                                                + '<span class="reel-meta-time" data-created-at="' + _attr(reel.createdAt || '') + '">' + (typeof window._timeAgo === 'function' && reel.createdAt ? window._timeAgo(reel.createdAt) : 'Recently') + '</span>'
                                            + '</div>'
                                        + '</div>'
                                        + '<div class="reel-meta-actions">'
                                            /* COMMENT RELOCATION (earlier session, point 2): the
                                               standalone "Comment" pill that used to sit here,
                                               next to the kebab, was removed and moved inside the
                                               three-dot menu as just one item among several — but
                                               that meant there was no way to tell a reel HAD
                                               comments without opening the menu first. Reported
                                               back (2026-08-11): "let there be an indication...
                                               for users to know that message is hidden behind the
                                               3 dots". This small indicator restores just the
                                               count + icon (not the full pill button), sitting
                                               right before the kebab per that request, and reuses
                                               the same .reel-comment-btn class + data-reel-id the
                                               kebab-menu Comment item and viewer engagement bar
                                               already use — so tapping it opens the exact same
                                               shared comments drawer (_openReelCommentsDrawer(),
                                               app-reel.js) with zero new click-handling code.
                                               reel.comments is the reel doc's own persisted
                                               Firestore field (see the comment-send handler in
                                               app-reel.js, which writes the whole array back with
                                               .update({ comments: ... })) — read directly off the
                                               snapshot here, at render time, rather than off
                                               app-reel.js's _reelData session cache, which starts
                                               empty every load and is never seeded from Firestore;
                                               reading it here is what gets the TRUE total instead
                                               of always showing 0 until someone opens the drawer
                                               once this session. */
                                            + '<button class="reel-grid-comment-indicator reel-comment-btn" data-reel-id="' + _attr(reel.id) + '" aria-label="' + (reel.comments || []).length + ' comments — view" title="' + (reel.comments || []).length + ' comments">'
                                                + '<i class="fas fa-comment-dots"></i><span class="reel-comment-count">' + (reel.comments || []).length + '</span>'
                                            + '</button>'
                                            + '<div class="reel-kebab-wrap">'
                                                + '<button class="reel-kebab-btn" data-reel-id="' + _attr(reel.id) + '" aria-label="More options" title="More options"><i class="fas fa-ellipsis-v"></i></button>'
                                                + '<div class="reel-kebab-menu" data-reel-id="' + _attr(reel.id) + '">'
                                                    + '<button class="reel-kebab-item reel-comment-btn" data-reel-id="' + _attr(reel.id) + '"><i class="fas fa-comment-dots"></i> Comment</button>'
                                                    + '<button class="reel-kebab-item reel-download-btn" data-url="' + _attr(reel.videoUrl) + '" data-reel-id="' + _attr(reel.id) + '" data-username="' + _attr(reel.username || 'user') + '"><i class="fas fa-download"></i> Download</button>'
                                                    /* Icon match (2026-08-22): this used to be a plain
                                                       <i class="fas fa-share-alt">, the only Share button
                                                       in the app still using that Font Awesome glyph
                                                       instead of the inline SVG (3 nodes + 2 lines) every
                                                       other section already uses for Share — the reel's
                                                       own fullscreen viewer engagement bar included (see
                                                       this same file's reel-eng-btn.reel-share-btn a few
                                                       hundred lines up). Swapped to the identical SVG
                                                       markup, sized/aligned to sit inline with this menu's
                                                       other icons (Comment/Download/Like/Report, still
                                                       <i> tags at 14px via ".reel-kebab-item i" in
                                                       app-reel.js's CSS) — flex-shrink:0 replicates that
                                                       rule's effect for this one non-<i> icon. */
                                                    + '<button class="reel-kebab-item reel-share-btn" data-url="' + _attr(_reelShareUrl) + '" data-reel-id="' + _attr(reel.id) + '"><svg viewBox="0 0 24 24" width="14" height="14" style="flex-shrink:0;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share</button>'
                                                    + '<button class="reel-kebab-item reel-like-btn" data-reel-id="' + _attr(reel.id) + '" data-user-id="' + _attr(reel.userId || '') + '"><i class="fas fa-heart"></i> Like <span class="reel-like-count">0</span></button>'
                                                    + '<button class="reel-kebab-item reel-report-btn" data-reel-id="' + _attr(reel.id) + '"><i class="fas fa-flag"></i> Report</button>'
                                                    /* PIN A PRODUCT (2026-10-04): owner-only, see app-reel.js §0a */
                                                    + ((reel.userId === us.id && typeof window._empReelPinMenuItemHtml === 'function') ? window._empReelPinMenuItemHtml(reel.id) : '')
                                                    + (_canModerate
                                                        ? '<a href="#" class="reel-kebab-item edit-post-btn"><i class="fas fa-pencil-alt"></i> Edit</a>'
                                                            + '<a href="#" class="reel-kebab-item delete-post-btn danger"><i class="fas fa-trash"></i> Delete</a>'
                                                        : '')
                                                + '</div>'
                                            + '</div>'
                                        + '</div>'
                                    + '</div>';

                                if (typeof window._empReelPinSync === 'function') window._empReelPinSync(rc, reel); /* pinned Marketplace listings (2026-10-04) */
                                var reEmpty = document.getElementById('reels-empty-state');
                                if (reEmpty) reEmpty.style.display = 'none';
                                if (isNew) { rg.prepend(rc); } else { rg.appendChild(rc); }
                                /* Auto-play-at-top ordering (latest, or whichever reel the
                                   person last tapped, stays pinned + playing while the rest of
                                   the feed scrolls underneath it) is owned by app-reel.js —
                                   nudge it to re-evaluate now that a new card exists. */
                                if (typeof window._empReelsApplyActiveOrdering === 'function') window._empReelsApplyActiveOrdering();
                            }
                        }

                        if (isNew && window.pushNotification) {
                            window.pushNotification('🎬 New reel from @' + (reel.username || 'someone') + '!', 'new_reel');
                        }
                    });
                }, function (err) {
                    console.error('[Listener:reels]', err.code, err.message);
                    window._reelsListener = null;
                    if (err.code !== 'permission-denied') {
                        setTimeout(function () {
                            if (!window._reelsListener && typeof window._startRealtimeListeners === 'function') {
                                window._startRealtimeListeners();
                            }
                        }, 5000);
                    }
                });
            console.log('[Firestore] ✅ reels listener active');
        }

        /* -- 5. SOS QUEUE --------------------------------------------------
           BUG FIX ("Approved SOS log empty in admin panel"): this block
           used to independently attach ITS OWN sos_queue listener (an
           unfiltered .limit(30) query, no status filter, no admin-log
           hookup) and claim window._sosListener for itself. Because
           app-sos.js's startSosListeners(db) -- called later in this same
           function, see step 10 below -- only attaches its own (correct,
           status==='approved'-filtered) sos_queue listener when
           `!window._sosListener`, this block winning the race meant
           app-sos.js's listener NEVER ran. That listener is the ONLY code
           that calls _appendApprovedSosLogEntry() to populate
           #admin-sos-log, so the Approved SOS Log stayed permanently empty
           on every session, even after real approvals. Feed cards still
           rendered here (this old block did that much), which is why the
           bug was invisible on the public dashboard and only showed up as a
           silently-empty admin log. Removed in favour of the single
           delegated call to window.startSosListeners(db) at step 10, which
           already does everything this block did (feed card rendering) plus
           the admin-log population this block never had. */

        /* ── 6. CRISIS REPORTS ────────────────────────────────────────────── */
        if (!window._crisisListener) {
            window._crisisListener = db.collection('crisis_reports')
                .orderBy('createdAt', 'desc').limit(20)
                .onSnapshot(function (snap) {
                    if (!snap) return;
                    snap.docChanges().forEach(function (change) {
                        var cr = change.doc.data();
                        if (!cr) return;
                        cr.id = cr.id || change.doc.id;
                        if (change.type === 'removed') {
                            var fc = document.getElementById('feed-container');
                            if (fc) { var r = fc.querySelector('[data-post-id="' + cr.id + '"]'); if (r) r.remove(); }
                            return;
                        }
                        if (change.type === 'added') {
                            var fc2 = document.getElementById('feed-container');
                            if (!fc2) return;
                            if (fc2.querySelector('[data-post-id="' + cr.id + '"]')) return;
                            createCrisisPostOnFeed(cr);
                        }
                    });
                }, function (err) {
                    console.error('[Listener:crisis]', err.code, err.message);
                    window._crisisListener = null;
                });
            console.log('[Firestore] ✅ crisis_reports listener active');
        }

        /* ── 7. ANNOUNCEMENTS ─────────────────────────────────────────────── */
        // BUGFIX: this used to only push a bell notification and never
        // actually rendered anything -- announcements only ever appeared in
        // the feed/admin list because the publish handler injected them into
        // the DOM directly. On refresh (new session, new tab, another
        // device) that DOM state is gone and nothing re-loads it from
        // Firestore, so published announcements "disappeared". This listener
        // now also renders (and keeps in sync) the feed post + admin list
        // card for every announcement doc, using the shared builders exposed
        // by app-fixes.js when available, with a plain-text fallback if not.
        if (!window._announcementsListener) {
            var _annFirstLoad = true;
            var _annIconsText = { announcement: '[Announcement]', appreciation: '[Appreciation]', update: '[Update]', 'sos-thanks': '[SOS Thanks]' };
            var _annIconsEmoji = { announcement: '📢', appreciation: '🏆', update: '🔔', 'sos-thanks': '❤️' };

            function _annRenderFeedPost(id, ann) {
                var fc = document.getElementById('feed-container');
                if (!fc || typeof createNewPostElement !== 'function') return;
                var existing = fc.querySelector('[data-ann-id="' + id + '"]');
                var hasMedia = ann.media && ann.media.length > 0;
                if (existing) {
                    // Post already rendered (optimistically or from an earlier
                    // snapshot) -- only rebuild it if media has since arrived.
                    if (hasMedia && !existing.querySelector('.story-media-container')) {
                        var refreshed = createNewPostElement(
                            (_annIconsText[ann.type] || '[Notice]') + ' ' + (ann.title || ''),
                            ann.media,
                            { id: 'admin-user', fullName: 'Empyrean Admin', avatar: 'icon-192.png' },
                            false, null,
                            ann.createdAt || null
                        );
                        refreshed.setAttribute('data-ann-id', id);
                        // FIX (2026-09-02 -- "engagement system doesn't work on
                        // announcement posts: live view count, likes, comments,
                        // shares, downloads never increase"): createNewPostElement()
                        // always stamps its own throwaway postId ('post-' +
                        // Date.now()) on every element it builds, and this rebuild
                        // path only ever copied data-ann-id across, never
                        // data-post-id/data-collection. Every like/comment/retweet/
                        // share/download handler in app-fix-final.js resolves its
                        // target purely from card.dataset.postId, then writes to
                        // Firestore collection card.dataset.collection (defaulting
                        // to 'posts') -- so this card pointed at a fake id in a
                        // collection ('posts') the announcement doc doesn't even
                        // live in, and a FRESH fake id every time this listener
                        // re-ran (a different one per session/device), so no two
                        // viewers were ever even looking at the same target. Now
                        // wired to the announcement's own real, stable Firestore
                        // doc id and its real collection -- exactly the same two
                        // attributes the admin's own optimistic publish-time post
                        // already gets (see app-fixes.js's announce-publish
                        // handler) -- so every viewer's engagement lands on the
                        // same shared, existing doc instead of a different
                        // nonexistent one each time.
                        refreshed.dataset.postId     = id;
                        refreshed.dataset.collection = 'announcements';
                        // FIX (report — "announcement/media chevron keeps
                        // falling, works at times and fails other times"):
                        // this used to call applyAnnouncementStyling (which
                        // kicks off _wireAnnouncementBodyToggle's height
                        // measurement) BEFORE replaceWith() had put
                        // `refreshed` into the live DOM -- so the very first
                        // measurement always started on a detached node
                        // (clientHeight/scrollHeight both 0), leaning
                        // entirely on that function's rAF retry loop to
                        // catch up once attached. Attaching first removes
                        // that race at the source instead of only papering
                        // over it downstream.
                        existing.replaceWith(refreshed);
                        if (typeof window.applyAnnouncementStyling === 'function') window.applyAnnouncementStyling(refreshed, ann.type, ann.title, ann.body);
                    }
                    return;
                }
                var post = createNewPostElement(
                    (_annIconsText[ann.type] || '[Notice]') + ' ' + (ann.title || ''),
                    ann.media || [],
                    { id: 'admin-user', fullName: 'Empyrean Admin', avatar: 'icon-192.png' },
                    false, null,
                    ann.createdAt || null
                );
                post.setAttribute('data-ann-id', id);
                // FIX (2026-09-02): same wiring as the rebuild branch above -- a
                // stable postId (the announcement's own Firestore doc id) and the
                // real collection it lives in, so like/comment/retweet/share/
                // download/view-count all resolve to the same, real, already-
                // existing announcements/{id} doc for every viewer instead of a
                // fresh, unshared, nonexistent 'posts' doc per render.
                post.dataset.postId     = id;
                post.dataset.collection = 'announcements';
                // FIX (report — "announcement/media chevron keeps falling,
                // works at times and fails other times"): same detached-node
                // race as the rebuild branch above -- applyAnnouncementStyling
                // (and the height measurement it kicks off) used to run
                // before fc.prepend(post) had attached this card to the live
                // DOM. Prepending first means the chevron's very first
                // measurement always sees a real, attached node.
                fc.prepend(post);
                var emptyState = document.getElementById('feed-empty-state');
                if (emptyState) emptyState.style.display = 'none';
                if (typeof window.applyAnnouncementStyling === 'function') {
                    window.applyAnnouncementStyling(post, ann.type, ann.title, ann.body);
                }
            }

            function _annRenderAdminCard(id, ann) {
                var list = document.getElementById('admin-announcements-list');
                if (!list || list.querySelector('[data-ann-id="' + id + '"]')) return;
                if (typeof window.renderAnnouncementCard !== 'function') return;
                var ep = list.querySelector('p');
                if (ep) ep.remove();
                var createdAt = ann.createdAt ? new Date(ann.createdAt).getTime() : Date.now();
                list.prepend(window.renderAnnouncementCard(id, ann.type, ann.title, ann.body, createdAt));
            }

            window._announcementsListener = db.collection('announcements')
                .orderBy('createdAt', 'asc').limitToLast(10)
                .onSnapshot(function (snap) {
                    if (!snap) return;
                    var isInitialLoad = _annFirstLoad;
                    snap.docChanges().forEach(function (change) {
                        var ann = change.doc.data();
                        if (!ann) return;
                        var id = change.doc.id;

                        if (change.type === 'removed') {
                            var fc = document.getElementById('feed-container');
                            if (fc) { var rp = fc.querySelector('[data-ann-id="' + id + '"]'); if (rp) rp.remove(); }
                            var list = document.getElementById('admin-announcements-list');
                            if (list) {
                                var rc = list.querySelector('[data-ann-id="' + id + '"]');
                                if (rc) rc.remove();
                                if (!list.querySelector('[data-ann-id]')) {
                                    list.innerHTML = '<p style="text-align:center;padding:20px;color:var(--text-muted);">No announcements yet.</p>';
                                }
                            }
                            return;
                        }

                        // 'added' (including everything loaded on first page-load)
                        // and 'modified' (e.g. media attached after publish) both
                        // need the post/card present and up to date.
                        _annRenderFeedPost(id, ann);
                        _annRenderAdminCard(id, ann);

                        // Only ring the bell for genuinely new announcements that
                        // arrive after the initial load -- otherwise every past
                        // announcement would re-notify on every page refresh.
                        if (!isInitialLoad && change.type === 'added' && window.pushNotification) {
                            var icon = _annIconsEmoji[ann.type] || '📢';
                            window.pushNotification(icon + ' ' + (ann.title || 'Admin Announcement'), 'announcement');
                        }
                    });
                    _annFirstLoad = false;
                }, function (err) {
                    console.error('[Listener:announcements]', err.code, err.message);
                    window._announcementsListener = null;
                });
            console.log('[Firestore] ✅ announcements listener active');
        }

        /* ── 8. USERS (suggested / follow) ───────────────────────────────── */
        if (!window._usersListener) {
            window._usersListener = db.collection('users').limit(50)
                .onSnapshot(function (snap) {
                    if (!snap) return;
                    snap.docChanges().forEach(function (change) {
                        var u = change.doc.data();
                        if (!u || !u.id || u.id === us.id) return;
                        ['likedPostIds','followedUserIds','retweetedPostIds',
                         'awardedRanks','completedTasks','viewedStatusUserIds'].forEach(function (k) {
                            u[k] = new Set(Array.isArray(u[k]) ? u[k] : []);
                        });
                        if (change.type === 'added' || change.type === 'modified') {
                            mu[u.id] = u;
                            if (u.email) ru[u.email] = u;
                        } else if (change.type === 'removed') {
                            delete mu[u.id];
                        }
                    });
                    if (typeof window.renderSuggestedUsers === 'function') window.renderSuggestedUsers();
                }, function (err) {
                    console.error('[Listener:users]', err.code, err.message);
                    window._usersListener = null;
                });
            console.log('[Firestore] ✅ users listener active');
        }

        /* ── 9. STATUSES — load all non-expired statuses from Firestore ──── */
        /* BUG FIX: statuses were never fetched on app start, so they disappeared
           after every page refresh. This listener keeps userStatuses in sync. */
        if (!window._statusesListener) {
            var STATUS_EXPIRY_MS_FEED = 24 * 60 * 60 * 1000;
            window._statusesListener = db.collection('statuses')
                .orderBy('createdAt', 'desc').limit(60)
                .onSnapshot(function (snap) {
                    if (!snap) return;
                    if (!window.userStatuses) window.userStatuses = [];
                    snap.docChanges().forEach(function (change) {
                        var s = change.doc.data();
                        if (!s || !s.userId) return;
                        s.docId = s.docId || change.doc.id;
                        /* Filter expired items */
                        if (s.items) {
                            s.items = s.items.filter(function (item) {
                                return !item.createdAt ||
                                    (Date.now() - new Date(item.createdAt).getTime()) < STATUS_EXPIRY_MS_FEED;
                            });
                        }
                        if (!s.items || s.items.length === 0) {
                            /* Remove from local array — all items expired */
                            window.userStatuses = window.userStatuses.filter(function (x) { return x.userId !== s.userId; });
                            return;
                        }
                        if (change.type === 'removed') {
                            window.userStatuses = window.userStatuses.filter(function (x) { return x.userId !== s.userId; });
                        } else {
                            var idx = window.userStatuses.findIndex(function (x) { return x.userId === s.userId; });
                            /* Preserve viewed flag from current local state if newer */
                            if (idx > -1) {
                                s.viewed = s.viewed || window.userStatuses[idx].viewed;
                                window.userStatuses[idx] = s;
                            } else {
                                window.userStatuses.push(s);
                            }
                        }
                    });
                    /* Sort: own status first, then unviewed, then by createdAt */
                    var myId = (window.userState && window.userState.id) || '';
                    window.userStatuses.sort(function(a, b) {
                        if (a.userId === myId) return -1;
                        if (b.userId === myId) return 1;
                        if (!a.viewed && b.viewed) return -1;
                        if (a.viewed && !b.viewed) return 1;
                        return 0;
                    });
                    if (typeof window.renderStatusBar === 'function') window.renderStatusBar();
                }, function (err) {
                    console.warn('[Listener:statuses]', err.code, err.message);
                    window._statusesListener = null;
                });
            console.log('[Firestore] ✅ statuses listener active');
        }

        /* ── 10. SOS QUEUE + CRISIS REPORTS — delegated to app-sos.js ─────── */
        /* BUG FIX: app-sos.js defines startSosListeners(db) which attaches the
           'sos_queue' and 'crisis_reports' onSnapshot listeners responsible for
           publishing an admin-approved SOS request onto the public dashboard
           feed (createSosPostOnFeed). That function was never invoked anywhere
           in the app, so window._sosListener/_crisisListener were always null —
           meaning an approval only ever rendered locally in the admin's own
           browser tab and never reached any other user's dashboard, even after
           a refresh. Starting it here, alongside the other 8 listeners, fixes
           that without touching the donation-button code path. */
        if (typeof window.startSosListeners === 'function') {
            window.startSosListeners(db);
        } else {
            console.warn('[Listeners] startSosListeners() not found — SOS posts will not sync to dashboard.');
        }

        console.log('[Firestore] ✅ ALL real-time listeners active — full cross-device sync enabled');

        setTimeout(function () {
            if (typeof window._populateHomeBioCard === 'function') window._populateHomeBioCard();
            if (typeof window.renderSuggestedUsers  === 'function') window.renderSuggestedUsers();
        }, 500);
    };


    /* =========================================================================
       §5  DASHBOARD NEWS SLIDER — delegated to app-news.js
       =========================================================================
       app-news.js defines window.renderDashboardNews() using window._newsCache
       as source-of-truth, avoiding the hidden-section DOM-scraping bug.
       This stub ensures any legacy call to renderDashboardNews() before
       app-news.js loads is safely silenced.
       ========================================================================= */
    if (typeof window.renderDashboardNews !== 'function') {
        window.renderDashboardNews = function () {
            /* no-op until app-news.js loads and overwrites this */
        };
    }


    /* =========================================================================
       §6  SUGGESTED USERS WIDGET
       ========================================================================= */

    /**
     * Populate the suggested users slider in #suggested-users-container.
     * Fetches users from Firestore once per session; subsequent calls use cache.
     */
    function renderSuggestedUsers() {
        var container = document.getElementById('suggested-users-container');
        var slider    = document.getElementById('suggested-users-slider');
        var bioCard   = document.getElementById('home-user-bio-card');
        var us        = _us();
        if (_isGuest() || !container || !slider) return;

        /* Kick off Firestore fetch once */
        if (window.fbDb && window._firebaseLoaded && !window._suggestedFetchDone) {
            window._suggestedFetchDone = true;
            // FIX (suggested-card cover photo missing/stale): { source: 'server' }
            // forces this past Firestore's local/offline cache (this app enables
            // persistence with synchronizeTabs — see app-patch-v31.js's own
            // header) straight to the backend, so a coverPhoto/avatar another
            // user set more recently than whatever this device happened to have
            // cached locally for them shows up correctly here too, matching
            // what their own full profile page already reads live.
            window.fbDb.collection('users').limit(40).get({ source: 'server' })
                .then(function (snap) {
                    window._firestoreSuggestedUsers = snap.docs.map(function (d) {
                        var u = d.data(); u.id = d.id; return u;
                    }).filter(function (u) { return u.id && u.username; });
                    renderSuggestedUsers();
                }).catch(function (e) {
                    console.warn('[SuggestedUsers] server fetch failed (' + (e && e.message) + ') — falling back to cache/default read.');
                    // Offline or the server read genuinely failed for some other
                    // reason — better a possibly-stale card than none at all.
                    window.fbDb.collection('users').limit(40).get()
                        .then(function (snap) {
                            window._firestoreSuggestedUsers = snap.docs.map(function (d) {
                                var u = d.data(); u.id = d.id; return u;
                            }).filter(function (u) { return u.id && u.username; });
                            renderSuggestedUsers();
                        }).catch(function (e2) { console.warn('[SuggestedUsers] fallback fetch also failed:', e2 && e2.message); });
                });
        }

        /* Merge Firestore + mockUsers */
        var allUsers = Object.assign({}, window.mockUsers || {});
        (window._firestoreSuggestedUsers || []).forEach(function (u) { allUsers[u.id] = u; });

        var followedSet = us.followedUserIds instanceof Set
            ? us.followedUserIds
            : new Set(Array.isArray(us.followedUserIds) ? us.followedUserIds : []);

        // FIX (2026-08-24 — "card disappears then reappears" after Follow):
        // window._usersListener (app-fixes.js, watches the 'users' collection)
        // also calls renderSuggestedUsers() on ANY change to any of the ~50
        // watched user docs — including the followerCount increment write the
        // follow action itself makes to the followed user's doc a moment
        // later. That independent re-render can land before/racing our own
        // scheduled rebuild after the follow, so relying solely on
        // followedSet (derived from userState.followedUserIds) meant WHICH
        // render happened to run last could still show the just-followed
        // user again for one tick. window._empSuggDashboardDismissed is a
        // small, session-only, purely-additive set — the follow-btn handler
        // adds a user's id to it the instant a suggested-card follow
        // succeeds — so that user is excluded from every render of this
        // slider from then on, independent of listener timing.
        var _dismissed = window._empSuggDashboardDismissed || (window._empSuggDashboardDismissed = new Set());
        var toSuggest = Object.values(allUsers).filter(function (u) {
            return u.id !== us.id && !followedSet.has(u.id) && !_dismissed.has(u.id);
        });

        slider.innerHTML = '';

        if (toSuggest.length > 0) {
            /* 2026-10-26: was slice(0, 5) — show up to 15 of the 40 fetched users so the swipe row has real depth */
            toSuggest.slice(0, 15).forEach(function (user) {
                // FIX (suggested-card cover photo not showing): this used to accept
                // ONLY values starting with 'http', but the profile page itself
                // (app-profile.js, `user.coverPhoto || ''`) shows ANY stored value
                // — including the persistent data:image/... URL that app-fixes.js
                // deliberately saves as the fallback when the cover upload to
                // Cloudinary fails. Those covers rendered fine on the profile but
                // were silently dropped here, leaving the placeholder gradient.
                // Now accepts http(s), protocol-relative, root-relative and
                // data:image values, and the URL is wrapped in quotes with its
                // quote/backslash/newline characters escaped — an unquoted
                // url(...) inside this double-quoted style attribute broke on any
                // URL containing a space, parenthesis or quote.
                var cvrRaw = (typeof user.coverPhoto === 'string') ? user.coverPhoto.trim() : '';
                var cvr = /^(https?:)?\/\/|^\/(?!\/)|^data:image\//i.test(cvrRaw)
                    ? cvrRaw.replace(/\\/g, '%5C').replace(/'/g, '%27').replace(/"/g, '%22').replace(/[\r\n]/g, '')
                    : '';
                var av   = user.avatar
                    || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(user.fullName || 'U') + '&background=1B2B8B&color=fff&size=150');
                var flwrs = (user.followerCount || 0).toLocaleString();
                var flwing = (user.followedUserIds
                    ? (typeof user.followedUserIds.size === 'number' ? user.followedUserIds.size
                        : (Array.isArray(user.followedUserIds) ? user.followedUserIds.length : 0)) : 0).toLocaleString();
                var empy  = typeof user.empyBalance === 'number' ? user.empyBalance.toFixed(2) : '0.00';
                var bio   = user.bio ? (user.bio.length > 60 ? user.bio.substring(0, 58) + '…' : user.bio) : '';

                var card = document.createElement('div');
                card.className     = 'suggested-user-card';
                card.dataset.userId = user.id;
                card.title          = 'View ' + (user.fullName || user.username || 'profile');
                card.innerHTML =
                    '<div class="sfy-card-thumb" title="See more suggestions for you" style="height:110px;background:'
                    + (cvr ? 'url(\'' + cvr + '\') center/cover no-repeat' : 'linear-gradient(135deg,#e8eaf6 0%,#c5cae9 100%)')
                    + ';border-radius:14px 14px 0 0;flex-shrink:0;position:relative;cursor:pointer;">'
                    + '<button type="button" class="sfy-see-more-btn" title="See more suggestions for you"'
                    + ' style="position:absolute;top:8px;right:8px;display:flex;align-items:center;gap:5px;'
                    + 'padding:6px 12px 6px 10px;border-radius:20px;border:none;cursor:pointer;'
                    + 'background:rgba(10,14,39,0.55);color:#fff;font-size:0.72rem;font-weight:700;'
                    + 'backdrop-filter:blur(4px);white-space:nowrap;">'
                    + 'See More <i class="fas fa-chevron-right" style="font-size:0.62rem;"></i></button>'
                    + '</div>'
                    + '<div style="padding:0 16px 16px;position:relative;">'
                    + '<img src="' + _attr(av) + '" alt="' + _attr(user.fullName || '') + '" loading="lazy"'
                    + ' style="width:72px;height:72px;border-radius:50%;object-fit:cover;'
                    + 'border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,0.15);margin-top:-36px;display:block;background:#e8eaf6;"'
                    + ' onerror="this.src=\'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.fullName || 'U') + '&background=1B2B8B&color=fff&size=150\'">'
                    + '<button class="btn follow-btn" data-user-id="' + user.id + '"'
                    + ' style="position:absolute;top:10px;right:16px;padding:8px 22px;border-radius:50px;'
                    + 'font-size:0.85rem;font-weight:700;background:transparent;'
                    + 'border:2px solid var(--primary,#1B2B8B);color:var(--primary,#1B2B8B);cursor:pointer;white-space:nowrap;">Follow</button>'
                    + '<div style="margin-top:8px;">'
                    + '<strong style="display:block;font-size:1.05rem;font-weight:800;color:var(--primary,#0A0E27);'
                    + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
                    + _esc(user.fullName || user.username || 'User') + '</strong>'
                    + '<span style="font-size:0.82rem;color:#888;display:block;margin-top:1px;">@' + _esc(user.username || '') + '</span>'
                    + (bio ? '<p style="font-size:0.85rem;color:#444;margin:8px 0 0;line-height:1.4;">' + _esc(bio) + '</p>' : '')
                    + '<div style="border-top:1px solid rgba(10,14,39,0.1);margin:12px 0;"></div>'
                    + '<div style="display:flex;gap:24px;font-size:0.85rem;color:#555;margin-bottom:8px;">'
                    + '<span><b style="font-size:1rem;font-weight:800;color:var(--primary,#0A0E27);">' + flwrs + '</b> Followers</span>'
                    + '<span><b style="font-size:1rem;font-weight:800;color:var(--primary,#0A0E27);">' + flwing + '</b> Following</span>'
                    + '</div>'
                    + '<div style="display:flex;align-items:center;gap:7px;font-size:0.9rem;color:#444;">'
                    + '<span style="font-size:1.1rem;">🏛️</span>'
                    + '<b style="font-size:1rem;font-weight:800;color:var(--primary,#0A0E27);">' + _esc(empy) + '</b>'
                    + '<span style="font-weight:600;color:#888;">EMPY</span></div>'
                    + '</div></div>';

                card.addEventListener('click', function (e) {
                    if (e.target.classList.contains('follow-btn') || e.target.closest('.follow-btn')) return;
                    window._viewingOtherProfile = (user.id !== us.id);
                    if (typeof window.renderUserProfile === 'function') window.renderUserProfile(user.id);
                    if (typeof window.navigateTo       === 'function') window.navigateTo('profile', true);
                });

                // FEATURE (request — tapping the card's thumbnail/cover photo
                // should open a full "Discover people" list of more
                // suggestions to follow, not just this one user's profile).
                // Wired on the thumbnail specifically (not the whole card),
                // with its own capture-phase-free stopPropagation() so this
                // doesn't also fire the card-level profile-view listener
                // right above. Reuses the existing Suggested Accounts panel
                // (app-suggested-contacts.js) rather than building a second,
                // parallel "more suggestions" list — same data, same Follow
                // button, no new file.
                var thumb = card.querySelector('.sfy-card-thumb');
                if (thumb) {
                    thumb.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (typeof window.openSuggestedContacts === 'function') {
                            window.openSuggestedContacts('suggested');
                        } else if (typeof window.navigateTo === 'function') {
                            window.navigateTo('suggested-for-you', true);
                        }
                    });
                }

                slider.appendChild(card);
            });

            container.style.display = 'block';
            if (bioCard) bioCard.style.display = 'block';
        } else {
            container.style.display = 'none';
            if (bioCard) bioCard.style.display = 'none';
        }
    }
    window.renderSuggestedUsers = renderSuggestedUsers;


    /* =========================================================================
       §7  PROFILE GALLERY HELPER
       ========================================================================= */

    /**
     * Accumulate Cloudinary URLs into the profile gallery grid.
     * Skips duplicates and blob:// URLs.
     * @param {string[]} urls
     */
    function _addUrlsToProfileGallery(urls) {
        var gallery = document.getElementById('profile-gallery');
        if (!gallery || !urls || !urls.length) return;
        /* Videos tab = videos only; photos go to the Pictures tab. */
        urls = (typeof window._empSplitProfileMedia === 'function') ? window._empSplitProfileMedia(urls) : urls;
        if (!urls.length) return;
        urls.forEach(function (url) {
            if (!url || url.startsWith('blob:')) return;
            if (gallery.querySelector('[data-url="' + url + '"]')) return;

            var isVid = /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url) || /\/video\/upload\//i.test(url);
            var item  = document.createElement('div');
            item.className      = 'gallery-item';
            item.dataset.url     = url;
            item.style.cssText   = 'position:relative;overflow:hidden;border-radius:12px;cursor:pointer;background:#f0f0f0;';
            item.innerHTML = isVid
                ? '<video src="' + url + '" style="width:100%;height:100%;object-fit:cover;" muted preload="metadata" playsinline></video>'
                : '<img src="' + url + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;"'
                    + ' onerror="this.closest(\'.gallery-item\').style.display=\'none\'">';
            gallery.appendChild(item);
        });
    }
    window._addUrlsToProfileGallery = _addUrlsToProfileGallery;


    /* =========================================================================
       §8  REEL VIEWER
       ========================================================================= */

    /**
     * Attach click handlers to reel cards and preview cards so they open
     * the full-screen reel viewer.
     * Uses MutationObserver to catch cards added dynamically.
     */
    function setupReelViewerObserver() {
        function _bindCard(card) {
            if (card._reelViewerBound) return;
            card._reelViewerBound = true;
            card.addEventListener('click', function (e) {
                /* FIX (2026-08-10): clicking the reel's own play/pause,
                   mute/unmute, or three-dot "more options" menu (button OR
                   its open dropdown) was incorrectly bubbling up to THIS
                   listener and opening the fullscreen viewer underneath the
                   person's tap — that's why pause/kebab taps looked like
                   they "expanded the screen". app-reel.js's own delegated
                   click handler already excludes these (it returns before
                   reaching its own openReelViewer() call for exactly these
                   targets), but this listener is bound directly on the card
                   itself, so it fires during the SAME bubble pass, before
                   that other handler's exclusion logic even runs. Excluding
                   the same targets here is what actually stops it. */
                /* FOLLOW-UP FIX (2026-08-10): tapping the caption/username/
                   timestamp text under the pinned card was also incorrectly
                   bubbling up to this listener and expanding the fullscreen
                   viewer, same root cause as the play/pause bug above —
                   .reel-caption-line and .reel-meta-text (the caption and
                   the username+time block) are now excluded the same way. */
                /* FOLLOW-UP FIX 2 (this session): tapping the Comment
                   button, or the profile picture / avatar+username block
                   next to it, had the exact same bug — .reel-meta-text
                   above only covers the username+timestamp text, not the
                   avatar image itself (a sibling inside .reel-meta-left,
                   not a descendant of .reel-meta-text), and the Comment
                   button (.reel-comment-btn / .reel-meta-comment-btn) was
                   never excluded at all. */
                /* FOLLOW-UP FIX 3 (this session): even with the individual
                   buttons/text excluded above, a tap landing on the plain
                   background/padding of the white info strip itself (e.g.
                   the gap between the avatar block and the Comment button)
                   still matched none of those specific selectors and fell
                   through to openReelViewer() below. Excluding the whole
                   .reel-meta-row container (a single ancestor of the
                   avatar, comment button, AND kebab wrap — a superset of
                   the individual exclusions above) closes every gap in one
                   go, so nothing in that entire white "comment card" strip
                   opens the fullscreen viewer any more. Tapping the avatar
                   still navigates to the owner's profile and tapping the
                   kebab still opens its own dropdown — both are handled by
                   their own dedicated listeners elsewhere, which this
                   exclusion doesn't touch, it only stops THIS listener's
                   fullscreen-open from also firing underneath them. */
                if (e.target.closest('.options-btn, .options-menu, .edit-post-btn, .delete-post-btn, .reel-kebab-wrap, .reel-audio-controls, .reel-caption-line, .reel-meta-row')) return;
                /* TWO-TAP FIX (this session): cards inside the main reels
                   grid (#reels-grid-container) are already handled by
                   app-reel.js's own delegated click listener, which
                   implements "first tap pins the card into the fixed
                   auto-playing spot, second tap (on the already-pinned
                   card) opens the fullscreen viewer". This listener is
                   bound directly on each card, so it fires FIRST in the
                   bubble phase — before app-reel.js's document-level
                   listener even runs — and was calling openReelViewer()
                   unconditionally on every tap, which meant the very
                   first tap on any grid thumbnail jumped straight to
                   fullscreen instead of pinning/auto-playing first.
                   Deferring entirely to app-reel.js for grid cards (this
                   listener still handles reel cards elsewhere — profile
                   galleries, dashboard previews, etc. — exactly as
                   before) fixes that without touching anything else. */
                if (card.closest('#reels-grid-container')) return;
                openReelViewer(card);
            });
        }

        document.querySelectorAll('.reel-card, .reel-preview-card, .dashboard-reel-card')
            .forEach(_bindCard);

        var obs = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                    if (!node || node.nodeType !== 1) return;
                    if (node.classList && (
                        node.classList.contains('reel-card') ||
                        node.classList.contains('reel-preview-card') ||
                        node.classList.contains('dashboard-reel-card')
                    )) { _bindCard(node); }
                    node.querySelectorAll && node.querySelectorAll(
                        '.reel-card,.reel-preview-card,.dashboard-reel-card'
                    ).forEach(_bindCard);
                });
            });
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }
    window.setupReelViewerObserver = setupReelViewerObserver;

    /**
     * Open the full-screen reel viewer for a given reel card.
     * Defers to app-reel.js (empyreanReelsModule) if it has loaded,
     * since that module has the full engagement bar (like/comment/retweet/share/download).
     * This stub only runs if app-reel.js has NOT loaded yet.
     * @param {HTMLElement} clickedCard — .reel-card or .reel-preview-card
     */
    function openReelViewer(clickedCard) {
        /* If app-reel.js already registered a full openReelViewer, use it */
        if (window._empyreanReelsLoaded && window._reelViewerFull) {
            window._reelViewerFull(clickedCard);
            return;
        }

        var videoUrl = clickedCard.dataset.videoUrl
            || (clickedCard.querySelector('video') && clickedCard.querySelector('video').src)
            || '';
        if (!videoUrl || videoUrl.startsWith('blob:')) return;

        var overlay = document.getElementById('reel-viewer-modal-overlay');
        var ct      = document.getElementById('reel-viewer-container');
        if (!overlay || !ct) return;

        /* Pause every feed/page video before opening the viewer so audio does not overlap */
        document.querySelectorAll('video').forEach(function(v) {
            if (v.closest('#reel-viewer-modal-overlay, #reel-viewer-container, #go-live-modal-overlay, #live-stream-container')) return;
            try { if (!v.paused) v.pause(); } catch(e) {}
        });

        ct.innerHTML = '';
        var vi = document.createElement('div');
        vi.className      = 'reel-viewer-item';
        vi.style.cssText  = 'position:relative;width:100%;height:100%;background:#000;'
            + 'flex-shrink:0;display:flex;align-items:center;justify-content:center;';
        vi.innerHTML =
            '<video src="' + videoUrl + '" style="width:100%;height:100%;object-fit:contain;"'
            + ' controls autoplay playsinline></video>';
        ct.appendChild(vi);
        overlay.style.display = 'block';
        document.body.style.overflow = 'hidden';

        /* Wire the close button every time the viewer opens */
        var closeBtn = overlay.querySelector('.reel-viewer-close');
        if (closeBtn) {
            closeBtn.onclick = function() {
                overlay.style.display = 'none';
                document.body.style.overflow = '';
                ct.querySelectorAll('video').forEach(function(v) {
                    try { v.pause(); v.removeAttribute('src'); v.load(); } catch(e) {}
                });
                ct.innerHTML = '';
            };
        }
    }
    window.openReelViewer = openReelViewer;

    /* Also wire on DOM ready so the button works even before first reel tap */
    (function() {
        function _w() {
            var ov = document.getElementById('reel-viewer-modal-overlay');
            var cb = ov && ov.querySelector('.reel-viewer-close');
            if (!cb || cb._wired) return;
            cb._wired = true;
            cb.addEventListener('click', function() {
                ov.style.display = 'none';
                document.body.style.overflow = '';
                var ct2 = document.getElementById('reel-viewer-container');
                if (ct2) {
                    ct2.querySelectorAll('video').forEach(function(v) {
                        try { v.pause(); v.removeAttribute('src'); v.load(); } catch(e) {}
                    });
                    ct2.innerHTML = '';
                }
            });
        }
        if (document.readyState !== 'loading') _w();
        else document.addEventListener('DOMContentLoaded', _w);
        document.addEventListener('empyrean-init-done', function() { setTimeout(_w, 300); });
    })();


    /* =========================================================================
       §9  VIEW-COUNT OBSERVER
       ========================================================================= */

    /**
     * IntersectionObserver that increments view counts on post cards
     * when they scroll into view.  Only counts once per post per session.
     */
    /* NOTE: view-count Firestore writes are handled by app-fixes.js
       (_viewCountObserver). This observer only mirrors DOM counts for
       cards that app-fixes.js hasn't yet stamped with [data-obs]. */
    /* FIX (report — "the viewers count refused to increase dynamically
       and only stationed on 1"): this whole IIFE runs the moment
       app-feed.js's <script> executes — which index.html loads BEFORE
       app-fixes.js. At that point window._viewCountObserver is always
       still undefined (app-fixes.js hasn't run yet), so the "bail out,
       the real observer already owns this" guard right below never
       actually triggers — this fallback set up its OWN competing
       IntersectionObserver on every single page load, not just as an
       emergency fallback. Once a card scrolled into view, THIS
       observer's DOM-only "+1, no Firestore write" bump could win the
       race against app-fixes.js's real one (both watch the same
       .impact-story elements; which one's callback actually runs first
       for a given card depends on exact script/paint timing). When it
       won, the view was never persisted: every reload re-reads the
       same un-incremented Firestore value and this fallback bumps it
       by exactly 1 again in the DOM, so the count looks permanently
       stuck at 1 no matter how many people actually view the post.
       Deferring this setup by a few seconds gives app-fixes.js — which
       always loads and runs on every page — time to claim
       window._viewCountObserver first, so the guard below finally does
       what it was written to do, and this block only ever activates as
       the genuine last-resort fallback it was meant to be. */
    setTimeout(function _setupViewCountObserver() {
        /* Bail out if app-fixes.js observer is already running — it owns
           the Firestore write AND the DOM update. No duplication needed. */
        if (window._viewCountObserver) return;

        var viewed = new Set();
        var obs    = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var el     = entry.target;
                var postId = el.dataset.postId;
                /* Skip cards that app-fixes.js observer is already watching */
                if (!postId || viewed.has(postId) || el.dataset.obs) return;
                viewed.add(postId);
                obs.unobserve(el);
                /* DOM-only optimistic update — Firestore write is app-fixes.js's job */
                var vc = el.querySelector('.view-count');
                if (vc) vc.textContent = parseInt(vc.textContent || '0') + 1;
            });
        }, { threshold: 0.5 });

        var cardObs = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                    if (!node || node.nodeType !== 1) return;
                    /* Only observe cards app-fixes.js hasn't claimed yet */
                    if (node.classList && node.classList.contains('impact-story') && !node.dataset.obs) obs.observe(node);
                    node.querySelectorAll && node.querySelectorAll('.impact-story:not([data-obs])').forEach(function (s) { obs.observe(s); });
                });
            });
        });
        cardObs.observe(document.body, { childList: true, subtree: true });

        /* Observe already-present cards not yet claimed by app-fixes.js */
        document.querySelectorAll('.impact-story:not([data-obs])').forEach(function (s) { obs.observe(s); });
    }, 5000);


    /* =========================================================================
       PRIVATE UTILITIES
       ========================================================================= */

    function _attr(str) { return String(str || '').replace(/"/g, '&quot;'); }
    function _esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }


    /* =========================================================================
       §10  SCROLL-PAUSE OBSERVER
       =========================================================================
       Mirrors standard social-media behaviour: a feed video pauses automatically
       when it scrolls out of view and resumes only if the user had previously
       started playing it (i.e. it was not paused by the user themselves).

       Excluded: reel-viewer overlay, go-live / live-stream containers — those
       have their own lifecycle management and must never be interrupted here.
       ========================================================================= */

    (function _setupScrollPauseObserver() {

        /* FIX (2026-10-17 — "video playback pauses intermittently"):
           #vfs-overlay (app-video-fullscreen.js's swipe viewer) was missing
           here. Its slides live in a translated track, so as soon as they
           were added to the DOM this observer picked them up and paused any
           slide that was momentarily off-screen mid-swipe — fighting the
           viewer's own play/pause management. It manages its own lifecycle
           like the other containers listed here. */
        var EXCLUDED = '#reel-viewer-modal-overlay, #reel-viewer-container, '
                     + '#go-live-modal-overlay, #live-stream-container, #vfs-overlay';

        /**
         * Bind scroll-pause behaviour to a single <video> element.
         * Safe to call multiple times — guarded by _scrollPauseBound flag.
         */
        function _bindVideo(vid) {
            if (vid._scrollPauseBound) return;
            if (vid.closest && vid.closest(EXCLUDED)) return;
            vid._scrollPauseBound = true;

            /* Track whether the user intentionally started the video */
            vid._userPlaying = false;
            vid.addEventListener('play',  function() { vid._userPlaying = true;  });
            vid.addEventListener('pause', function() {
                /* Only clear the flag when the user pauses manually,
                   not when we pause programmatically via the observer.
                   FIX (2026-10-17): 'pause' is dispatched ASYNCHRONOUSLY, but
                   _scrollPauseInProgress used to be reset synchronously right
                   after vid.pause() — so by the time this ran the flag was
                   always already false, every observer-initiated pause was
                   mistaken for a manual one, _userPlaying was wiped, and the
                   video then never resumed on scroll-back (it just sat
                   paused). The flag is now cleared HERE, by the event it was
                   guarding, with a timeout as a safety net. */
                if (vid._scrollPauseInProgress) {
                    vid._scrollPauseInProgress = false;
                    return;
                }
                vid._userPlaying = false;
            });
        }

        /* One shared observer for all feed videos */
        var scrollObs = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                var vid = entry.target;
                if (vid.closest && vid.closest(EXCLUDED)) return;

                if (!entry.isIntersecting) {
                    /* Scrolled away — pause if playing */
                    if (!vid.paused) {
                        vid._scrollPauseInProgress = true;
                        try { vid.pause(); } catch(e) {}
                        setTimeout(function() { vid._scrollPauseInProgress = false; }, 600);
                        /* Remember we paused it so we can resume on scroll-back */
                        vid._pausedByScroll = true;
                    }
                } else {
                    /* Scrolled back into view — resume only if we paused it */
                    if (vid._pausedByScroll && vid._userPlaying) {
                        vid._pausedByScroll = false;
                        try { vid.play().catch(function(){}); } catch(e) {}
                    } else {
                        vid._pausedByScroll = false;
                    }
                }
            });
        }, {
            /* Pause as soon as less than 30 % of the video is visible —
               matches Instagram / TikTok feel */
            threshold: 0.3
        });

        /** Observe a video element (bind + start watching) */
        function _watchVideo(vid) {
            if (vid._scrollPauseBound) return;
            if (vid.closest && vid.closest(EXCLUDED)) return;
            _bindVideo(vid);
            scrollObs.observe(vid);
        }

        /** Sweep a DOM subtree for any video elements */
        function _sweepVideos(root) {
            (root || document).querySelectorAll('video').forEach(_watchVideo);
        }

        /* Watch for new video elements added dynamically (new posts loaded) */
        var vidMutObs = new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
                m.addedNodes.forEach(function(node) {
                    if (!node || node.nodeType !== 1) return;
                    if (node.tagName === 'VIDEO') { _watchVideo(node); return; }
                    if (node.querySelectorAll) _sweepVideos(node);
                });
            });
        });
        vidMutObs.observe(document.body, { childList: true, subtree: true });

        /* Observe videos already in the DOM */
        _sweepVideos();

        /* Also sweep after feed listeners have loaded their first batch */
        document.addEventListener('empyrean-init-done', function() {
            setTimeout(_sweepVideos, 600);
        });

        /* Expose so other modules can call _sweepVideos() after injecting content */
        window._sweepFeedVideos = _sweepVideos;

    })();


    /* ── Download count ──────────────────────────────────────────────────
       REMOVED (was double-incrementing): this used to write downloadCount
       on every .download-media-btn click, but app-fixes.js's master click
       handler (setupMasterEventListeners) ALSO writes downloadCount on the
       same click — with correct collection routing (posts / crisis_reports
       / business_posts), where this listener always hardcoded 'posts'
       regardless of the post's actual collection. Net effect: every
       download incremented the counter twice, and for non-'posts' content
       wrote to the wrong (or a nonexistent) document. app-fixes.js's write
       is now the single source of truth for this counter. */


    /* ── GLOBAL SHARE HANDLER ──────────────────────────────────────────────
       FEATURE (2026-08-01, superseded prior "always opens the OS share
       drawer" behavior) — tapping Share now opens app-patch-v50.js's
       Universal Share sheet first (Empyrean status/any chat/any group,
       WhatsApp, or "More"), instead of jumping straight to navigator.share.
       "More" inside that sheet still routes through _empShare exactly as
       before (payload.onMore below) — count + mining tracking bundled with
       the native call stays exactly as it was, this only adds the picker
       in front of it. If app-patch-v50.js hasn't loaded for some reason,
       this falls straight back through to the original direct-native-share
       behavior so Share is never a dead tap. */
    document.addEventListener('click', function (e) {
        var shareBtn = e.target && e.target.closest && e.target.closest('.share-btn, [data-action="share"], .action-btn.share-btn, #biz-share-btn, .biz-share-trigger');
        if (!shareBtn) return;

        /* Don't intercept reel share — reel module manages its own */
        if (shareBtn.closest('.reel-overlay, .reel-card, [data-reel-action]')) return;

        e.preventDefault();
        /* NOTE: do NOT call e.stopPropagation() here — it can break the
           user-gesture trust token that navigator.share() requires on Android,
           in case the "More" path below ends up calling it synchronously
           from this same click. */

        /* FIX (2026-08-22 — admin announcement posts shared a generic
           "Join the Empyrean community to view this post" card with no
           thumbnail instead of the actual announcement content/image):
           announcement cards (built by the _annRenderFeedPost listener)
           only ever get a `data-ann-id` attribute — they never carry
           data-post-id/data-biz-id/data-page-id and don't match any of
           the class names below, so `card` came back null and `postId`
           came back '', which stripped the `?post=` param off the share
           URL entirely. The OGP crawler route in server.js already knows
           how to build a proper announcement preview card (see its own
           'announcements' fallback lookup) — it just never received an
           id to look up. Adding [data-ann-id] to the selector and
           card.dataset.annId to the id fallback chain is enough; nothing
           else in this handler needs to change. */
        var card   = shareBtn.closest('[data-post-id], [data-biz-id], [data-page-id], [data-ann-id], .impact-story, .story-card, .crisis-card, .news-card, .business-card');
        var postId = card && (card.dataset.postId || card.dataset.bizId || card.dataset.pageId || card.dataset.annId || '');
        var shareUrl = window.location.origin + (postId ? '/?post=' + encodeURIComponent(postId) : window.location.pathname);

        function _goNative() {
            /* Route through _empShare (app-thread.js) — handles count + mining + native share */
            if (typeof window._empShare === 'function') { window._empShare(null, postId || null); return; }
            /* Direct fallback if thread module hasn't loaded yet */
            if (typeof navigator.share === 'function') {
                navigator.share({ title: 'Empyrean International', url: shareUrl }).catch(function (err) {
                    if (err && err.name !== 'AbortError' && navigator.clipboard) {
                        navigator.clipboard.writeText(shareUrl).then(function () {
                            if (typeof window.showNotification === 'function') window.showNotification('Link copied!', 'success');
                        }).catch(function(){});
                    }
                });
            } else if (navigator.clipboard) {
                navigator.clipboard.writeText(shareUrl).then(function () {
                    if (typeof window.showNotification === 'function') window.showNotification('Link copied!', 'success');
                }).catch(function(){});
            }
        }

        if (window.EmpShare && typeof window.EmpShare.open === 'function') {
            var media = card && card.querySelector('.story-media-container img, .story-media-container video');
            var textEl = card && card.querySelector('.story-content');
            window.EmpShare.open({
                text: textEl ? textEl.textContent.trim() : '',
                mediaUrl: media ? (media.currentSrc || media.src || '') : '',
                mediaType: media ? (media.tagName === 'VIDEO' ? 'video' : 'image') : '',
                pageUrl: shareUrl,
                onMore: _goNative
            });
            return;
        }

        _goNative();
    }, false);


    /* ═══════════════════════════════════════════════════════════════════
       NEW POSTS PILL NOTIFICATION
       Shows "↑ New post" when a new post arrives while the user is
       scrolled below 200px. Tapping scrolls to that exact post and
       dismisses it.

       FIX (precise single-post tracking): this used to accumulate a
       count ("N new posts") and, on tap, scroll whichever ancestor
       matched a loose `.closest('.dashboard-section, [data-section],
       main, .content-area')` guess to its top — landing at the very top
       of the whole Dashboard section (above the sponsor banner/donor
       wall/birthdays/live/reels/news/market sliders), not at the new
       post itself, plus a second, redundant scrollTo on
       `.page-content, .main-content, #app-root` firing at the same time
       (a duplicate call to the SAME element in this app, since neither
       `.page-content` nor `#app-root` exist anywhere in this codebase —
       harmless individually, but two competing smooth-scroll calls is
       exactly the kind of thing that can visibly overshoot). Now the
       indicator tracks exactly ONE reference — the actual DOM node of
       the latest prepended post, passed in directly by the caller in
       this same file that just inserted it — and a tap scrolls straight
       to THAT element via scrollIntoView(), which finds its own correct
       scrollable ancestor natively instead of guessing one. A newer post
       arriving simply replaces the tracked reference (posts prepend, so
       the latest is always the one at the top of the feed) rather than
       incrementing a count. */
    (function initNewPostsPill() {
        var _trackedPostEl = null; // the ONE precise post this pill currently points to
        var _pill = null;

        function _getPill() {
            if (_pill) return _pill;
            _pill = document.createElement('div');
            _pill.id = 'empyrean-new-posts-pill';
            _pill.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg><span id="emp-pill-label">New post</span>';
            document.body.appendChild(_pill);
            _pill.addEventListener('click', function () {
                /* Prefer the exact tracked post; fall back to the feed's
                   top only if that node is no longer in the document
                   (e.g. it scrolled out of the DOM window / was removed). */
                var target = (_trackedPostEl && _trackedPostEl.isConnected)
                    ? _trackedPostEl
                    : document.getElementById('feed-container');
                _trackedPostEl = null;
                _hide();
                if (target && typeof target.scrollIntoView === 'function') {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
            return _pill;
        }

        function _show() {
            _getPill().classList.add('visible');
        }

        function _hide() {
            if (_pill) _pill.classList.remove('visible');
        }

        function _isScrolledDown() {
            var fc = document.getElementById('feed-container');
            if (fc) {
                var wrap = fc.closest('.dashboard-section, [data-section], main, .content-area');
                if (wrap && wrap.scrollTop > 200) return true;
            }
            return window.scrollY > 200 || document.documentElement.scrollTop > 200;
        }

        /* Hide pill when user scrolls back to top */
        var _scrollHandler = function () {
            if (!_isScrolledDown()) { _trackedPostEl = null; _hide(); }
        };
        window.addEventListener('scroll', _scrollHandler, { passive: true });
        document.addEventListener('scroll', _scrollHandler, { passive: true, capture: true });

        /* Expose so the posts listener can call it when a new post arrives.
           postEl: the exact node just prepended into #feed-container —
           this is what makes the indicator precise (it always points at
           this one post, never an accumulated count). */
        window._notifyNewPost = function (postEl) {
            if (!_isScrolledDown()) return; /* already at top — no need for pill */
            _trackedPostEl = postEl || document.getElementById('feed-container');
            _show();
        };

        /* Hide when navigating away from dashboard */
        document.addEventListener('empyrean-section-change', function (ev) {
            if (!ev || !ev.detail || ev.detail.section !== 'dashboard') {
                _trackedPostEl = null;
                _hide();
            }
        });
    })();


    /* Bootstrap reel viewer on load */
    document.addEventListener('empyrean-init-done', function () {
        setTimeout(setupReelViewerObserver, 400);
    });
    setTimeout(setupReelViewerObserver, 1000);


    /* =========================================================================
       ADVERT FEED INJECTOR — sponsored image/video cards, pushed from the
       admin "Advert Control Room" (app-admin.js), rotating into every
       feed a user can see.
       ─────────────────────────────────────────────────────────────────────
       WHY A MutationObserver, NOT A CHANGE TO THE POST-BUILDER ITSELF:
       This file's own #feed-container prepend logic above (SOS posts,
       crisis reports, business posts, the 8 onSnapshot listeners) is
       already spread across several code paths, and the actual initial-
       batch post cards are built by a renderer outside this file's own
       closure. Reaching into that to splice ads in at build time would
       mean either editing a function this session was never asked to
       touch, or duplicating its logic here — the same "second parallel
       layer" trap this codebase's other additive patches (v4's business-
       page injector, v33/v37's live-stream features) have already
       documented and deliberately avoided. Observing the SAME three
       containers this file already prepends into (see the existing
       ['feed-container','profile-dash-feed','profile-posts-feed'] group
       above) and inserting a sponsored card is fully additive: it never
       edits, reorders, or removes an existing post node, so nothing that
       already renders those three containers needs to know this exists.

       PLACEMENT (2026-08-08 redesign — was rotating a fresh ad card into
       the dashboard feed every EVERY_N_POSTS posts forever, i.e. an ad
       after nearly every handful of posts as the feed grew, reported as
       "adverts displaying everywhere after every post"):
         - Dashboard (#feed-container): AT MOST ONE ad card, ever, for the
           whole session — no more repeating rotation. Still triggers
           after the same EVERY_N_POSTS-th real post so it doesn't land
           awkwardly at the very top of a fresh feed.
         - Profile pages (#profile-dash-feed / #profile-posts-feed): a
           single ad card on EVERY profile (2026-08-08b: the earlier
           large-following-only gate was removed — see PLACEMENT UPDATE
           note on LARGE_FOLLOWING_THRESHOLD's old declaration below —
           since the platform doesn't yet have large-audience accounts to
           reserve this for). Triggers after the first real post rather
           than waiting for the 5th, since this placement is deliberately
           rare/prominent rather than a recurring feed rhythm, and gates
           independently PER profile visited (own gate key below) so
           browsing from one profile to another still shows one on each,
           while revisiting the same one in the same session does not
           show a second.
         - Thread comment section (#vf-th-comment-list): see the
           "COMMENT-SECTION ADVERT" block further down. One compact,
           comment-styled sponsored item per opened thread, gated by
           postId (read off #vf-th-post-area's data-postId — see the
           companion stamp added in app-thread.js's _openThread), so
           reopening the same thread never shows a second copy.

       ROTATION: adverts are weighted by their own `priority` field
       (1-10, set in the admin panel) by literally repeating each ad in
       the round-robin list `priority` times — simple, predictable, and
       needs no separate random-weighted-draw logic. Still used to pick
       WHICH ad fills each of the (now much rarer) single slots above.

       TRACKING: one impression per ad CARD INSTANCE (not per ad — the
       same ad can appear more than once as the feed grows), the first
       time it's >=50% visible, via IntersectionObserver; one click per
       tap anywhere on the card, via a single delegated listener. Both
       are best-effort increments (silently no-op if offline) — losing an
       occasional count is fine, blocking the UI on it is not.
       ========================================================================= */
    (function empyreanAdvertsFeedInjector() {
        if (window._empAdvertsInjectorLoaded) {
            console.warn('[EmpAdverts] Already loaded — skipping duplicate.');
            return;
        }
        window._empAdvertsInjectorLoaded = true;

        var ADVERTS_COL   = 'adverts';
        var EVERY_N_POSTS = 5;
        var FEED_IDS      = ['feed-container', 'profile-dash-feed', 'profile-posts-feed'];
        // PLACEMENT UPDATE (2026-08-08b): profile-page ads are no longer
        // gated behind a follower-count threshold. The platform doesn't
        // have large-following accounts yet, so a large-only gate meant
        // this placement never fired for anyone — every profile is now
        // eligible for its one ad, small and large accounts alike. The
        // per-profile gate key below still ensures each profile only ever
        // gets ONE ad card, same as before; only the eligibility check
        // changed. (_profileFollowerCountFromDOM() is left in place below
        // since nothing else needs removing — it's simply no longer
        // consulted by _containerGateKey().)

        var _ads     = [];  // round-robin list (priority-weighted, expanded)
        var _rrIndex = 0;
        var _seenImpressions = {}; // per-card-instance key -> true
        var _instanceCounter = 0;

        // containerId -> the gate key that already got its one ad card.
        // Dashboard uses a single fixed key ('dashboard') so it only ever
        // fires once total; profile containers use 'profile:<userId>' so
        // each large-following profile visited gets its own single ad
        // without one profile's ad permanently blocking every other.
        var _containerAdShownKey = {};
        // postId -> true, once the comment-section ad has been shown for
        // that thread, so re-opening/re-rendering the same thread's
        // comment list doesn't add a second copy. (Was previously
        // declared as a bare `null` — dead leftover from before this
        // block existed — instead of the keyed map its own comment
        // always described; fixed here since the block below now
        // actually uses it.)
        var _threadAdShownForPostId = {};

        function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

        /* Premium line icons (inline SVG, no icon-font or emoji dependency). Sized by CSS. */
        var _FI = {
            horn:  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',
            arrow: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
            link:  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
            verified: '<svg class="emp-ad-vf" aria-label="Verified" viewBox="0 0 24 24"><path fill="currentColor" d="M12 1.8l2.4 1.7 2.9-.2 1.2 2.7 2.6 1.3-.2 2.9L22.6 12l-1.7 2.4.2 2.9-2.7 1.2-1.3 2.6-2.9-.2L12 22.2l-2.4-1.7-2.9.2-1.2-2.7-2.6-1.3.2-2.9L1.4 12l1.7-2.4-.2-2.9 2.7-1.2 1.3-2.6 2.9.2z"/><path d="M8.2 12.2l2.5 2.5 5-5.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            chev:  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
            ext:   '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
            lock:  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
            heart: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"/></svg>',
            chat:  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
            share: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="6" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6"/></svg>',
            mark:  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12v17l-6-4-6 4z"/></svg>',
            play:  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
            close: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
        };
        var _adIndex = {}; // adId -> ad object, read by the tap-to-open popup
        function _fmtCount(n) { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; return String(n); }
        function _firstSentence(t, max) { t = String(t || '').replace(/\s+/g, ' ').trim(); if (!t) return ''; var m = t.match(/^.{20,}?[.!?](\s|$)/); var out = m ? m[0].trim() : t; return out.length > max ? out.slice(0, max - 1).replace(/\s+\S*$/, '') + '\u2026' : out; }
        function _adHost(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

        function _nextAd() {
            if (!_ads.length) return null;
            var ad = _ads[_rrIndex % _ads.length];
            _rrIndex++;
            return ad;
        }
        /* IN-HOUSE ADVERTS (pushed from Admin > Advert Control Room) are only shown on content of creators who
           meet the monetization requirements (KYC-verified + at least the first creator tier's follower count),
           because that is where the platform's ad revenue is shared. Paid Ads Manager campaigns are not
           restricted this way. `ownerUid` = the author of the post the ad would sit beside / the profile owner. */
        var _monOk = {};
        function _isMonetized(uid) {
            if (!uid) return false;
            if (_monOk[uid] !== undefined) return _monOk[uid] === true;
            _monOk[uid] = 'pending';
            try {
                window.fbDb.collection('users').doc(uid).get().then(function (d) {
                    var x = d.exists ? d.data() : {}, min = (window.CREATOR_TIERS && window.CREATOR_TIERS[0] && window.CREATOR_TIERS[0].minFollowers) || 1000;
                    _monOk[uid] = !!(x.isVerified && (x.followerCount || 0) >= min);
                    if (_monOk[uid]) FEED_IDS.forEach(function (id) { var c = document.getElementById(id); if (c) _sweepExisting(c); }); if (_monOk[uid]) { try { _ensureReelAd(); } catch (e) {} }
                }).catch(function () { _monOk[uid] = false; });
            } catch (e) { _monOk[uid] = false; }
            return false;
        }
        /* 2026-11-07: admin "Where to show" — placement is 'all' (default / campaigns), 'card', 'popup' or 'slide' */
        function _adAllows(ad, kind) { var p = ad.placement || 'all'; return p === 'all' || p === (kind || 'card'); }
        function _nextAdFor(ownerUid, kind) {
            for (var i = 0; i < _ads.length; i++) {
                var ad = _nextAd();
                if (ad && _adAllows(ad, kind) && (!ad._inhouse || ad.showToAll !== false || _isMonetized(ownerUid))) return ad;
            }
            return null;
        }

        function _injectCSS() {
            if (document.getElementById('emp-advert-css')) return;
            var css = document.createElement('style');
            css.id = 'emp-advert-css';
            css.textContent = [
                /* Members' feed card — elegant navy/gold sponsored card (2026-11-07 redesign) */
                '.emp-ad-v2{position:relative;margin-bottom:16px;overflow:hidden;background:#fff;border:1px solid #E6E8F1;border-radius:26px;box-shadow:0 14px 36px rgba(11,20,69,0.10);font-family:Manrope,Inter,system-ui,sans-serif;}',
                '.emp-ad-head{display:flex;align-items:center;gap:11px;padding:14px 14px 12px;}',
                '.emp-ad-avatar{position:relative;width:44px;height:44px;flex-shrink:0;overflow:hidden;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#0B1445;color:#fff;font-family:Playfair Display,Georgia,serif;font-weight:700;font-size:1.15rem;box-shadow:0 0 0 2px #fff,0 0 0 3.5px #C9A96A;}',
                '.emp-ad-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#fff;}',
                '.emp-ad-meta{flex:1;min-width:0;}',
                '.emp-ad-advertiser{display:flex;align-items:center;gap:5px;font-weight:800;font-size:0.95rem;letter-spacing:-0.01em;color:#0A0E27;}',
                '.emp-ad-nm{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                '.emp-ad-vf{width:17px;height:17px;flex-shrink:0;color:#D9A400;}',
                '.emp-ad-sub{margin-top:1px;font-family:Cormorant Garamond,Georgia,serif;font-style:italic;font-weight:500;font-size:1rem;line-height:1.2;color:#6B7194;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                '.emp-ad-v2 .emp-ad-badge{height:28px;padding:0 11px;border:1px solid #DDE2F7;font-size:0.72rem;}',
                '.emp-ad-mediawrap{position:relative;overflow:hidden;background:#0B1445;border-bottom:3px solid #C9A96A;}',
                '.emp-ad-media{width:100%;aspect-ratio:16/9;max-height:360px;object-fit:contain;display:block;background:linear-gradient(135deg,#223AA8 0%,#0D1650 100%);}',
                '.emp-ad-snd{position:absolute;right:12px;bottom:12px;z-index:2;width:38px;height:38px;padding:0;border:0;border-radius:50%;background:#0C1E4A;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;}',
                '.emp-ad-snd svg{width:18px;height:18px;}',
                '.emp-ad-snd .s-on{display:none;}',
                '.emp-ad-snd.is-on .s-on{display:block;}',
                '.emp-ad-snd.is-on .s-off{display:none;}',
                '.emp-vp{position:absolute;left:10px;right:10px;bottom:56px;z-index:6;display:flex;align-items:center;gap:10px;padding:8px 8px 8px 10px;border-radius:16px;background:rgba(10,14,39,0.92);border:1px solid rgba(201,169,106,0.45);color:#fff;font-family:Manrope,Inter,system-ui,sans-serif;text-align:left;transform:translateY(16px);opacity:0;transition:transform .25s ease,opacity .25s ease;box-sizing:border-box;}',
                '.emp-vp *{box-sizing:border-box;}',
                '.emp-vp.is-in{transform:none;opacity:1;}',
                '.emp-vp-reel{bottom:132px;right:78px;}',
                '.emp-vp-grid{left:8px;right:8px;bottom:8px;}',
                '.emp-vp-sm .emp-vp-av,.emp-vp-sm .emp-vp-go{display:none;}',
                '.emp-vp-av{position:relative;width:34px;height:34px;flex-shrink:0;border-radius:50%;overflow:hidden;background:#1B2B8B;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;}',
                '.emp-vp-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}',
                '.emp-vp-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}',
                '.emp-vp-sp{font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#C9A96A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                '.emp-vp-h{font-size:12.5px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
                '.emp-vp-go{flex-shrink:0;height:32px;padding:0 13px;border:0;border-radius:16px;background:#1B2B8B;color:#fff;font:inherit;font-size:12px;font-weight:800;cursor:pointer;}',
                '.emp-vp-x{flex-shrink:0;width:28px;height:28px;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,0.14);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;}',
                '.emp-vp-x svg{width:13px;height:13px;}',
                '.emp-ad-slide{background:#000 !important;overflow:hidden;font-family:Manrope,Inter,system-ui,sans-serif;flex-direction:column;align-items:stretch !important;justify-content:flex-end !important;box-sizing:border-box;}',
                '.emp-ad-slide .emp-sl-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 22%;display:block;}',
                '.emp-sl-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0.25) 0%,rgba(0,0,0,0.15) 40%,rgba(0,0,0,0.94) 100%);pointer-events:none;}',
                '.emp-sl-body{position:absolute;left:0;right:0;bottom:0;padding:20px 20px calc(34px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;align-items:flex-start;gap:10px;color:#fff;text-align:left;}',
                '.emp-sl-name{font-weight:800;font-size:14px;}',
                '.emp-sl-h{margin:0;font-family:Playfair Display,Georgia,serif;font-weight:700;font-size:21px;line-height:1.25;color:#fff;}',
                '.emp-sl-c{margin:0;font-size:13.5px;line-height:1.5;color:rgba(255,255,255,0.84);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}',
                '.emp-sl-cta{align-self:stretch;min-height:48px;border:0;border-radius:14px;background:#fff;color:#0A0E27;font:inherit;font-weight:800;font-size:14.5px;cursor:pointer;}',
                '.emp-sl-hint{align-self:center;font-size:11.5px;color:rgba(255,255,255,0.65);}',
                /* 2026-11-07 — Interstitial ad design (reel slide, feed card, profile card): full-bleed media, vignettes,
                   creator row (Sponsored / Follow / Watch gallery), frosted glass banner, bottom drawer. */
                '.emp-z-media{position:absolute;inset:0;z-index:1;overflow:hidden;background:#000;}',
                '.emp-z-media.is-land .emp-sl-media,.emp-z-media.is-land .emp-ad-media{object-fit:contain;object-position:center 38%;background:#000;}',
                '.emp-z-vt{position:absolute;top:0;left:0;right:0;height:140px;background:linear-gradient(180deg,rgba(0,0,0,0.75) 0%,rgba(0,0,0,0) 100%);pointer-events:none;z-index:1;}',
                '.emp-z-vb{position:absolute;bottom:0;left:0;right:0;height:380px;background:linear-gradient(0deg,rgba(0,0,0,0.96) 0%,rgba(0,0,0,0.62) 55%,rgba(0,0,0,0) 100%);pointer-events:none;z-index:1;}',
                '.emp-z-zone{position:relative;z-index:10;padding:0 16px 18px;display:flex;flex-direction:column;gap:12px;text-align:left;box-sizing:border-box;}',
                '.emp-ad-slide .emp-z-zone{padding-bottom:calc(18px + env(safe-area-inset-bottom,0px));}',
                '.emp-z-bar{display:flex;flex-direction:column;gap:10px;}',
                '.emp-z-who{display:flex;align-items:center;gap:12px;}',
                '.emp-z-av{position:relative;width:44px;height:44px;flex-shrink:0;border-radius:50%;overflow:hidden;background:#0C1E4A;border:2px solid #C9A66B;color:#fff;font-weight:900;font-size:1.15rem;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.3);}',
                '.emp-z-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}',
                '.emp-z-nm{display:flex;align-items:center;gap:6px;min-width:0;font-size:0.95rem;font-weight:800;color:#fff;letter-spacing:-0.2px;}',
                '.emp-z-nm span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                '.emp-z-nm .emp-ad-vf{width:15px;height:15px;color:#EAB308;}',
                '.emp-z-acts{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
                '.emp-z-pill{display:inline-flex;align-items:center;gap:5px;min-height:28px;padding:4px 10px;border-radius:20px;background:#0C1E4A;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.16);color:#E2E8F0;font-size:0.72rem;font-weight:800;}',
                '.emp-z-pill svg{width:12px;height:12px;color:#C9A66B;}',
                '.emp-z-follow{display:inline-flex;align-items:center;gap:5px;min-height:34px;padding:5px 14px;border:0;border-radius:20px;background:#fff;color:#071330;font:inherit;font-size:0.76rem;font-weight:800;cursor:pointer;}',
                '.emp-z-follow svg{width:12px;height:12px;}',
                '.emp-z-follow.followed{background:rgba(255,255,255,0.2);color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.3);}',
                '.emp-z-gal{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:5px 14px;border-radius:20px;background:rgba(255,255,255,0.15);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.2);color:#fff;font:inherit;font-size:0.76rem;font-weight:700;cursor:pointer;}',
                '.emp-z-gal svg{width:12px;height:12px;}',
                '.emp-z-glass{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border-radius:18px;background:rgba(12,30,74,0.92);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);border:1px solid rgba(201,166,107,0.3);box-shadow:0 8px 30px rgba(0,0,0,0.45);}',
                '.emp-z-info{flex:1;min-width:0;}',
                '.emp-z-title{margin:0 0 2px;font-family:inherit;font-size:0.86rem;font-weight:800;line-height:1.3;color:#C9A66B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-0.2px;}',
                '.emp-z-desc{font-size:0.74rem;line-height:1.4;color:#E2E8F0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
                '.emp-z-read{display:inline;margin-left:3px;padding:0;border:0;background:none;color:#C9A66B;font:inherit;font-weight:800;text-decoration:underline;cursor:pointer;}',
                '.emp-z-cta{flex:0 0 auto;max-width:40%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;justify-content:center;display:inline-flex;align-items:center;gap:5px;min-height:40px;padding:9px 14px;border:0;border-radius:12px;background:linear-gradient(135deg,#C9A66B 0%,#E0C28D 100%);color:#071330;font:inherit;font-size:0.78rem;font-weight:900;cursor:pointer;box-shadow:0 4px 14px rgba(201,166,107,0.35);}',
                '.emp-z-cta svg{width:13px;height:13px;}',
                '.emp-z-swipe{display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:2px;color:#94A3B8;font-size:0.68rem;font-weight:700;}',
                '.emp-z-swipe svg{width:14px;height:14px;animation:empZBounce 1.5s infinite;}',
                '@keyframes empZBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}',
                '.emp-z-backdrop{position:absolute;inset:0;z-index:100;background:rgba(0,0,0,0.55);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);opacity:0;pointer-events:none;transition:opacity .25s ease;}',
                '.emp-z-backdrop.is-open{opacity:1;pointer-events:auto;}',
                '.emp-z-drawer{position:absolute;left:0;right:0;bottom:0;box-sizing:border-box;padding:12px 20px calc(22px + env(safe-area-inset-bottom,0px));border-radius:24px 24px 0 0;background:#fff;color:#0B1528;box-shadow:0 -10px 30px rgba(0,0,0,0.4);transform:translateY(100%);transition:transform .28s cubic-bezier(0.16,1,0.3,1);text-align:left;}',
                '.emp-z-backdrop.is-open .emp-z-drawer{transform:none;}',
                '.emp-z-notch{width:36px;height:4px;margin:0 auto 12px;border-radius:10px;background:#CBD5E1;}',
                '.emp-z-dh{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}',
                '.emp-z-dh b{font-size:0.95rem;font-weight:900;color:#071330;min-width:0;}',
                '.emp-z-dx{flex-shrink:0;width:36px;height:36px;border:0;border-radius:50%;background:#F1F5F9;color:#64748B;cursor:pointer;display:flex;align-items:center;justify-content:center;}',
                '.emp-z-dx svg{width:14px;height:14px;}',
                '.emp-z-db{max-height:220px;overflow-y:auto;margin-bottom:16px;font-size:0.82rem;line-height:1.55;color:#475569;}',
                '.emp-z-db p{margin:0 0 8px;}',
                '.emp-z-da{display:block;text-align:center;padding:13px;border-radius:12px;background:linear-gradient(135deg,#071330 0%,#0C1E4A 100%);color:#fff;font-size:0.86rem;font-weight:800;text-decoration:none;box-shadow:0 4px 14px rgba(12,30,74,0.25);}',
                '.emp-z-card{background:#fff;border-color:#E3E7F2;}.emp-z-head{display:flex;align-items:center;gap:12px;padding:14px 16px;background:#fff;text-align:left;}.emp-z-head .emp-z-av{width:46px;height:46px;box-shadow:none;}.emp-z-head-t{min-width:0;flex:1;}.emp-z-card .emp-z-nm{color:#0C1E4A;}.emp-z-card .emp-z-nm .emp-ad-vf{flex-shrink:0;}.emp-z-sub{margin-top:2px;font-size:0.78rem;font-weight:700;line-height:1.3;color:#8A6A2E;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                '.emp-z-card .emp-z-media{position:relative;inset:auto;aspect-ratio:4/5;max-height:480px;}',
                '.emp-z-card .emp-z-media.is-land{aspect-ratio:16/9;}',
                '.emp-z-card .emp-ad-media{position:absolute;inset:0;width:100%;height:100%;max-height:none;aspect-ratio:auto;object-fit:cover;object-position:center 22%;background:transparent;}',
                '.emp-z-card .emp-z-vb{height:90px;}',
                '.emp-z-card .emp-z-zone{padding:14px 16px;background:#fff;}.emp-z-card .emp-z-pill{background:#0C1E4A;color:#E2E8F0;}.emp-z-card .emp-z-follow{background:#0C1E4A;color:#fff;}.emp-z-card .emp-z-follow.followed{background:#fff;color:#0C1E4A;box-shadow:inset 0 0 0 1.5px #0C1E4A;}.emp-z-card .emp-z-gal{background:transparent;border:1.5px solid #0C1E4A;color:#0C1E4A;-webkit-backdrop-filter:none;backdrop-filter:none;}.emp-z-card .emp-z-glass{background:#0C1E4A;-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:0 6px 18px rgba(12,30,74,0.22);}',
                '.emp-z-card .emp-ad-eng{background:#fff;border-top:1px solid #E6E9F2;color:#0C1E4A;}',
                '.emp-z-card .emp-ad-bm{color:#0C1E4A;}',

                '.emp-ad-slide .emp-ad-snd{top:76px;right:14px;bottom:auto;}',
                '.emp-ad-tag{position:absolute;left:12px;top:12px;max-width:calc(100% - 24px);display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border-radius:10px;background:rgba(10,14,39,0.92);border:1px solid #2A3566;color:#fff;font-size:0.74rem;font-weight:700;letter-spacing:0.01em;}',
                '.emp-ad-tag i{width:7px;height:7px;border-radius:50%;background:#22C55E;flex-shrink:0;}',
                '.emp-ad-tag span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                '.emp-ad-body{padding:16px 16px 4px;}',
                '.emp-ad-title{margin:0 0 8px;font-family:Playfair Display,Georgia,serif;font-weight:700;font-size:1.28rem;line-height:1.22;letter-spacing:-0.005em;color:#0A0E27;}',
                '.emp-ad-text{margin:0;font-size:0.9rem;line-height:1.68;color:#565E82;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}',
                '.emp-ad-text.is-open{display:block;-webkit-line-clamp:unset;}',
                '.emp-ad-rm{display:inline-flex;align-items:center;flex-shrink:0;gap:4px;min-height:40px;padding:8px 10px;border:0;background:none;color:#1B2B8B;font:inherit;font-weight:800;font-size:0.86rem;cursor:pointer;}',
                '.emp-ad-rm svg{width:15px;height:15px;transition:transform .2s;}',
                '.emp-ad-rm.is-open svg{transform:rotate(180deg);}',
                '.emp-ad-cbar{display:flex;align-items:center;gap:12px;width:calc(100% - 32px);margin:6px 16px 14px;padding:13px 13px 13px 18px;border:1px solid #1B2B8B;border-radius:18px;background:#0A0E27;text-align:left;cursor:pointer;font:inherit;box-shadow:0 10px 24px rgba(10,14,39,0.22);}',
                '.emp-ad-cbar-t{flex:1;min-width:0;}',
                '.emp-ad-eyebrow{display:block;font-size:0.68rem;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#C9A96A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                '.emp-ad-ctitle{display:block;margin-top:2px;font-family:Playfair Display,Georgia,serif;font-weight:600;font-size:1.02rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                '.emp-ad-go{width:38px;height:38px;flex-shrink:0;border-radius:50%;background:rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;color:#fff;}',
                '.emp-ad-go svg{width:17px;height:17px;}',
                '.emp-ad-eng{display:flex;align-items:center;gap:20px;padding:11px 18px 13px;border-top:1px solid #EEF0F6;color:#1B2B8B;font-size:0.85rem;font-weight:800;}',
                '.emp-ad-eng span,.emp-ad-bm{display:inline-flex;align-items:center;gap:7px;}',
                '.emp-ad-eng svg{width:20px;height:20px;}',
                '.emp-ad-bm{margin-left:auto;border:0;background:none;color:#1B2B8B;padding:4px;cursor:pointer;}',
                '.emp-ad-bm.is-on svg{fill:currentColor;}',
                '#emp-ad-sheet{position:fixed;inset:0;z-index:2147483000;display:none;align-items:flex-end;justify-content:center;background:rgba(10,14,39,0.55);font-family:Manrope,Inter,system-ui,sans-serif;}',
                '#emp-ad-sheet.is-open{display:flex;}',
                '.emp-ad-panel{width:100%;max-width:480px;max-height:88vh;overflow-y:auto;box-sizing:border-box;background:#fff;border-radius:22px 22px 0 0;padding:8px 18px calc(16px + env(safe-area-inset-bottom,0px));animation:empAdUp .26s ease-out;-webkit-text-size-adjust:100%;}',
                '.emp-ad-panel *{box-sizing:border-box;}',
                '@keyframes empAdUp{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}',
                '.emp-ad-grab{width:38px;height:4px;border-radius:2px;background:#D9DCE8;margin:0 auto 10px;}',
                '.emp-ad-ptop{display:flex;align-items:center;justify-content:space-between;gap:10px;}',
                '.emp-ad-pill{min-width:0;max-width:calc(100% - 44px);padding:5px 10px;border:1px solid #C9A96A;border-radius:12px;color:#8A6A2E;font-size:10.5px;font-weight:800;letter-spacing:0.08em;line-height:1.2;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                '.emp-ad-x{width:36px;height:36px;flex-shrink:0;border:0;border-radius:50%;background:#F2F4FA;color:#4A5178;cursor:pointer;display:flex;align-items:center;justify-content:center;}',
                '.emp-ad-x svg{width:16px;height:16px;}',
                '.emp-ad-ptitle{display:-webkit-box;margin:12px 0 8px;font-family:Playfair Display,Georgia,serif;font-weight:700;font-size:17px;line-height:1.3;color:#0A0E27;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}',
                '.emp-ad-prule{width:32px;height:2px;background:#C9A96A;margin-bottom:12px;}',
                '.emp-ad-dest{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:#F7F8FC;border:1px solid #ECEEF5;margin-bottom:12px;}',
                '.emp-ad-dest>svg{width:16px;height:16px;color:#1B2B8B;flex-shrink:0;}',
                '.emp-ad-dest>div{flex:1;min-width:0;}',
                '.emp-ad-dest small{display:block;font-size:10px;font-weight:800;letter-spacing:0.1em;line-height:1.2;color:#7A80A0;text-transform:uppercase;}',
                '.emp-ad-dest b{display:block;margin-top:2px;font-size:14px;font-weight:700;line-height:1.3;color:#0A0E27;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                '.emp-ad-dest-ext{display:flex;align-items:center;justify-content:center;width:28px;height:28px;flex-shrink:0;border-radius:50%;background:#EEF0FB;color:#1B2B8B;}',
                '.emp-ad-dest-ext svg{width:13px;height:13px;}',
                '.emp-ad-open{display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px;border-radius:14px;background:#1B2B8B;color:#fff;font-weight:800;font-size:14.5px;text-decoration:none;box-shadow:0 8px 18px rgba(27,43,139,0.26);}',
                '.emp-ad-open svg{width:15px;height:15px;}',
                '.emp-ad-later{display:block;width:100%;margin-top:4px;padding:12px;border:0;background:none;color:#6B7194;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;}',
                '#profile-dash-feed > .emp-ad-v2,#profile-posts-feed > .emp-ad-v2{margin:6px 24px 16px;}',
                '@media (max-width:768px){#profile-dash-feed > .emp-ad-v2,#profile-posts-feed > .emp-ad-v2{margin:6px 16px 16px;}}',
                '#reels-grid-container > .emp-ad-v2{margin-bottom:0;}',
                '#reels-grid-container.reels-view-grid > .emp-ad-v2{grid-column:1 / -1;margin:4px 0;}',
                '#reels-grid-container.reels-view-feed > .emp-ad-v2{margin:0 10px;width:auto;}',
                '.emp-ad-badge{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;flex-shrink:0;border-radius:13px;background:#EEF0FB;color:#1B2B8B;font-size:0.7rem;font-weight:800;letter-spacing:0.03em;}',
                '.emp-ad-badge svg{width:13px;height:13px;}',
                /* 2026-11-07 - feed sponsor card: Sponsored / Follow / Watch gallery row under the media (feed, dashboard, profile, reels grid only) */
                '.emp-ad-acts{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 16px 0;}',
                '.emp-ad-v2 .emp-ad-follow{display:inline-flex;align-items:center;gap:5px;min-height:32px;padding:0 13px;border:0;border-radius:16px;background:#0C1E4A;color:#fff;font:inherit;font-size:0.76rem;font-weight:800;cursor:pointer;}',
                '.emp-ad-v2 .emp-ad-follow svg{width:12px;height:12px;}',
                '.emp-ad-v2 .emp-ad-follow.followed{background:#fff;color:#0C1E4A;box-shadow:inset 0 0 0 1.5px #0C1E4A;}',
                '.emp-ad-gal{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 13px;border-radius:16px;background:transparent;border:1.5px solid #0C1E4A;color:#0C1E4A;font:inherit;font-size:0.76rem;font-weight:700;cursor:pointer;}',
                '.emp-ad-gal svg{width:12px;height:12px;}',
                '.emp-ad-cta{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 20px;border-radius:22px;background:linear-gradient(135deg,#1B2B8B,#2F6BFF);color:#fff;font-weight:700;font-size:0.84rem;text-decoration:none;white-space:nowrap;box-shadow:0 8px 20px rgba(27,43,139,0.28);}',
                '.emp-ad-cta svg{width:15px;height:15px;}',
                /* Comment-section variant — sits inline among real replies */
                '.emp-ad-comment.emp-ad-card{margin:0;border:none;box-shadow:none;background:transparent;border-radius:0;}',
                '.emp-ad-comment .emp-ad-badge-inline{height:20px;padding:0 8px;margin-left:6px;font-size:0.66rem;}',
                '.emp-ad-comment .vf-th-comment-media{margin:6px 0;border-radius:14px;overflow:hidden;}',
                '.emp-ad-comment .vf-th-comment-media img,.emp-ad-comment .vf-th-comment-media video{width:100%;max-height:220px;object-fit:cover;display:block;}',
                '.emp-ad-comment .emp-ad-cta{margin-top:8px;padding:0 18px;font-size:0.8rem;background:#EEF0FB;color:#1B2B8B;box-shadow:none;}'
            ].join('');
            document.head.appendChild(css);
        }

        /* shared building blocks for the redesigned interstitial (reel slide + feed/profile card) */
        function _adOwnerUid(ad) {
            var u = ad.advertiserUid || ad.ownerId || ad.createdBy;
            if (!u || typeof u !== 'string' || u === 'admin' || u.indexOf('guest') === 0) return '';
            return u;
        }
        function _myLiveState() { return window.userState || (window.EmpState && window.EmpState.userState) || {}; }
        function _amFollowing(uid) {
            var f = _myLiveState().followedUserIds;
            return !!(f && typeof f.has === 'function' && f.has(uid));
        }
        var _PLUS = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
        var _PLAY = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        var _UP = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';
        var _RIGHT = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
        function _zoneHTML(ad, withSwipe, skipWho) {
            var name = String(ad.advertiserName || 'Advertiser');
            var uid = _adOwnerUid(ad), mine = !!uid && uid === _myLiveState().id, fol = !!uid && _amFollowing(uid);
            var logo = ad.advertiserLogoUrl ? '<img src="' + _esc(ad.advertiserLogoUrl) + '" alt="" onerror="this.style.display=\'none\'">' : '';
            var caption = String(ad.caption || ''), headline = String(ad.headline || '');
            var title = headline || name;
            var blurb = _firstSentence(caption, 90) || (headline ? '' : '');
            return '<div class="emp-z-zone"><div class="emp-z-bar">'
                + (skipWho ? '' : '<div class="emp-z-who"><span class="emp-z-av">' + _initialOf(name) + logo + '</span><div class="emp-z-nm"><span>' + _esc(name) + '</span>' + (ad.verified ? _FI.verified : '') + '</div></div>')
                + '<div class="emp-z-acts"><span class="emp-z-pill">' + _FI.horn + 'Sponsored</span>'
                + (uid && !mine ? '<button type="button" class="follow-btn emp-ad-follow emp-z-follow' + (fol ? ' followed' : '') + '" data-user-id="' + _esc(uid) + '" data-ad-id="' + _esc(ad.id) + '">' + (fol ? 'Following' : _PLUS + 'Follow') + '</button>' : '')
                + (uid && ad.mediaType === 'video' ? '<button type="button" class="emp-z-gal">' + _PLAY + 'Watch gallery</button>' : '')
                + '</div></div>'
                + (headline || caption || ad.linkUrl
                    ? '<div class="emp-z-glass"><div class="emp-z-info"><div class="emp-z-title">' + _esc(title) + '</div>'
                      + (blurb || caption ? '<div class="emp-z-desc">' + _esc(blurb) + (caption ? ' <button type="button" class="emp-z-read">Read more</button>' : '') + '</div>' : '')
                      + '</div>'
                      + (ad.linkUrl ? '<button type="button" class="emp-z-cta">' + _esc((ad.ctaLabel && String(ad.ctaLabel).length <= 18) ? ad.ctaLabel : 'Learn More') + _RIGHT + '</button>' : '')
                      + '</div>'
                    : '')
                + (withSwipe ? '<div class="emp-z-swipe">' + _UP + '<span>Swipe up to continue</span></div>' : '')
                + '</div>';
        }
        function _drawerHTML(ad) {
            var name = String(ad.advertiserName || 'Advertiser'), caption = String(ad.caption || ''), headline = String(ad.headline || '');
            if (!caption && !headline) return '';
            var paras = (caption || headline).split(/\n+/).map(function (t) { return t.trim(); }).filter(Boolean).map(function (t) { return '<p>' + _esc(t) + '</p>'; }).join('');
            return '<div class="emp-z-backdrop"><div class="emp-z-drawer" role="dialog" aria-label="About ' + _esc(name) + '"><div class="emp-z-notch"></div>'
                + '<div class="emp-z-dh"><b>' + _esc(name) + '</b><button type="button" class="emp-z-dx" aria-label="Close">' + _FI.close + '</button></div>'
                + '<div class="emp-z-db">' + paras + '</div>'
                + (ad.linkUrl ? '<a class="emp-z-da" href="' + _esc(ad.linkUrl) + '" target="_blank" rel="noopener noreferrer sponsored">' + _esc(ad.ctaLabel || 'Explore') + ' \u2022 ' + _esc(_adHost(ad.linkUrl)) + '</a>' : '')
                + '</div></div>';
        }
        /* wire the zone + drawer inside `root` (a reel slide or a feed card): direct listeners, so they work wherever the node is mounted */
        function _wireZone(root, ad) {
            var uid = _adOwnerUid(ad);
            var bd = root.querySelector('.emp-z-backdrop');
            function _drawer(open) { if (bd) bd.classList.toggle('is-open', open); }
            root._empCloseDrawer = function () { _drawer(false); };
            if (bd) {
                ['touchstart', 'touchend', 'pointerdown'].forEach(function (ev) { bd.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); });
                bd.addEventListener('click', function (e) { e.stopPropagation(); if (e.target === bd || (e.target.closest && e.target.closest('.emp-z-dx'))) _drawer(false); else if (e.target.closest && e.target.closest('.emp-z-da')) _bump(ad.id, 'clicks'); });
            }
            var rd = root.querySelector('.emp-z-read');
            if (rd) rd.addEventListener('click', function (e) { e.stopPropagation(); _drawer(true); });
            var cta = root.querySelector('.emp-z-cta');
            if (cta) cta.addEventListener('click', function (e) { e.stopPropagation(); _openSheet(ad); });
            var gal = root.querySelector('.emp-z-gal');
            if (gal) gal.addEventListener('click', function (e) { e.stopPropagation(); _openAdGallery(uid); });
            var m = root.querySelector('.emp-z-media'), mEl = root.querySelector('.emp-sl-media, .emp-ad-media');
            function _fit() { var w = mEl.videoWidth || mEl.naturalWidth, h = mEl.videoHeight || mEl.naturalHeight; if (w && h && m) m.classList.toggle('is-land', w / h > 1.05); }
            if (mEl) { mEl.addEventListener(mEl.tagName === 'VIDEO' ? 'loadedmetadata' : 'load', _fit); if (mEl.tagName === 'IMG' && mEl.complete) _fit(); }
        }

        /* 2026-11-07 - feed/profile card header: logo + name + verified tick + advert title, pure white, ABOVE the media */
        function _cardHeadHTML(ad) {
            var name = String(ad.advertiserName || 'Advertiser');
            var logo = ad.advertiserLogoUrl ? '<img src="' + _esc(ad.advertiserLogoUrl) + '" alt="" onerror="this.style.display=\'none\'">' : '';
            var sub = String(ad.headline || '') || _firstSentence(String(ad.caption || ''), 70);
            return '<div class="emp-z-head"><span class="emp-z-av">' + _initialOf(name) + logo + '</span>'
                + '<div class="emp-z-head-t"><div class="emp-z-nm"><span>' + _esc(name) + '</span>' + _FI.verified + '</div>'
                + (sub ? '<div class="emp-z-sub">' + _esc(sub) + '</div>' : '') + '</div></div>';
        }
        function _renderAdCardHTML(ad) {
            var name = String(ad.advertiserName || 'Advertiser');
            var uid = _adOwnerUid(ad), mine = !!uid && uid === _myLiveState().id, fol = !!uid && _amFollowing(uid);
            var logo = ad.advertiserLogoUrl ? '<img src="' + _esc(ad.advertiserLogoUrl) + '" alt="" onerror="this.style.display=\'none\'">' : '';
            var sub = 'Promoted' + (ad.subLabel ? ' \u2022 ' + String(ad.subLabel) : '');
            var caption = String(ad.caption || '').trim(), headline = String(ad.headline || '').trim();
            var ctitle = (ad.ctaLabel && ad.ctaLabel !== 'Learn More') ? String(ad.ctaLabel) : 'Discover how ' + name;
            var media = ad.mediaType === 'video'
                ? '<video class="emp-ad-media" src="' + _esc(ad.mediaUrl) + '" muted playsinline loop autoplay preload="metadata"></video>'
                : '<img class="emp-ad-media" src="' + _esc(ad.mediaUrl) + '" alt="' + _esc(name) + '" loading="lazy">';
            var likes = Number(ad.likes) || 0, cmts = Number(ad.comments) || 0, shr = Number(ad.shares) || 0;
            return '<div class="emp-ad-card emp-ad-v2" data-ad-id="' + _esc(ad.id) + '" data-emp-ad="1">'
                + '<div class="emp-ad-head"><span class="emp-ad-avatar">' + _initialOf(name) + logo + '</span>'
                +   '<div class="emp-ad-meta"><div class="emp-ad-advertiser"><span class="emp-ad-nm">' + _esc(name) + '</span>' + _FI.verified + '</div>'
                +   '<div class="emp-ad-sub">' + _esc(sub) + '</div></div>'
                +   '<span class="emp-ad-badge">' + _FI.horn + 'Sponsored</span></div>'
                + (ad.mediaUrl
                    ? '<div class="emp-ad-mediawrap">' + media + (ad.mediaType === 'video' ? _SND_BTN : '') + (ad.tagLabel ? '<span class="emp-ad-tag"><i></i><span>' + _esc(ad.tagLabel) + '</span></span>' : '') + '</div>'
                    : '')
                + (uid ? '<div class="emp-ad-acts">' : '')
                + (uid && !mine ? '<button type="button" class="follow-btn emp-ad-follow' + (fol ? ' followed' : '') + '" data-user-id="' + _esc(uid) + '" data-ad-id="' + _esc(ad.id) + '">' + (fol ? 'Following' : _PLUS + 'Follow') + '</button>' : '')
                + (uid ? '<button type="button" class="emp-ad-gal" data-owner="' + _esc(uid) + '">' + _PLAY + 'Watch gallery</button>' : '')
                + (uid ? '</div>' : '')
                + (headline || caption
                    ? '<div class="emp-ad-body">'
                      + (headline ? '<h3 class="emp-ad-title">' + _esc(headline) + '</h3>' : '')
                      + (caption ? '<p class="emp-ad-text">' + _esc(caption) + '</p><button type="button" class="emp-ad-rm" aria-expanded="false">Read more' + _FI.chev + '</button>' : '')
                      + '</div>'
                    : '')
                + (ad.linkUrl
                    ? '<button type="button" class="emp-ad-cbar"><span class="emp-ad-cbar-t">'
                      + (ad.ctaEyebrow ? '<span class="emp-ad-eyebrow">' + _esc(ad.ctaEyebrow) + '</span>' : '')
                      + '<span class="emp-ad-ctitle">' + _esc(ctitle) + '</span></span><span class="emp-ad-go">' + _FI.ext + '</span></button>'
                    : '')
                + ((likes || cmts || shr)
                    ? '<div class="emp-ad-eng"><span>' + _FI.heart + _fmtCount(likes) + '</span><span>' + _FI.chat + _fmtCount(cmts) + '</span><span>' + _FI.share + _fmtCount(shr) + '</span><button type="button" class="emp-ad-bm" aria-label="Save">' + _FI.mark + '</button></div>'
                    : '')
                + '</div>';
        }
        /* hide "Read more" when the description already fits in its 3 lines (measured once the card is on screen) */
        function _trimToggle(node) {
            var tx = node.querySelector('.emp-ad-text'), rm = node.querySelector('.emp-ad-rm'), tries = 0;
            if (!tx || !rm) return;
            (function _chk() {
                if (!(node.isConnected && tx.clientWidth > 0)) { if (++tries < 10) setTimeout(_chk, 400); return; }
                if (!tx.classList.contains('is-open') && tx.scrollHeight <= tx.clientHeight + 1) rm.style.display = 'none';
            })();
        }

        /* Tap-to-open popup (bottom sheet) — shown when the CTA bar is tapped so a member
           always sees where the link goes before leaving the feed. */
        function _closeSheet() { var sh = document.getElementById('emp-ad-sheet'); if (sh) sh.classList.remove('is-open'); }
        function _openSheet(ad) {
            if (!ad || !ad.linkUrl) return;
            _injectCSS();
            var sh = document.getElementById('emp-ad-sheet');
            if (!sh) {
                sh = document.createElement('div');
                sh.id = 'emp-ad-sheet';
                sh.addEventListener('click', function (e) {
                    var t = e.target;
                    if (t === sh || (t.closest && t.closest('[data-emp-close]'))) { _closeSheet(); return; }
                    if (t.closest && t.closest('.emp-ad-open')) { _bump(sh.dataset.adId, 'clicks'); setTimeout(_closeSheet, 60); }
                });
                document.addEventListener('keydown', function (e) { if (e.key === 'Escape') _closeSheet(); });
                document.body.appendChild(sh);
            }
            var name = String(ad.advertiserName || 'Advertiser');
            var title = _firstSentence(ad.caption, 120) || ad.headline || name;
            sh.dataset.adId = ad.id;
            sh.innerHTML = '<div class="emp-ad-panel" role="dialog" aria-modal="true" aria-label="Sponsored link">'
                + '<div class="emp-ad-grab"></div>'
                + '<div class="emp-ad-ptop"><span class="emp-ad-pill">Sponsored \u00B7 ' + _esc(name) + '</span><button type="button" class="emp-ad-x" data-emp-close="1" aria-label="Close">' + _FI.close + '</button></div>'
                + '<h3 class="emp-ad-ptitle">' + _esc(title) + '</h3><div class="emp-ad-prule"></div>'
                + '<div class="emp-ad-dest">' + _FI.lock + '<div><small>Destination</small><b>' + _esc(_adHost(ad.linkUrl) || ad.linkUrl) + '</b></div><span class="emp-ad-dest-ext">' + _FI.ext + '</span></div>'
                + '<a class="emp-ad-open" href="' + _esc(ad.linkUrl) + '" target="_blank" rel="noopener noreferrer sponsored">Open link ' + _FI.ext + '</a>'
                + '<button type="button" class="emp-ad-later" data-emp-close="1">Not now</button>'
                + '</div>';
            sh.classList.add('is-open');
        }

        function _fieldIncrement(n) {
            try {
                if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) {
                    return firebase.firestore.FieldValue.increment(n);
                }
            } catch (e) { /* fall through */ }
            return null;
        }
        // Ads Manager campaigns (ids start with "cmp_") are metered by server.js (/api/ads/event) — the browser
        // never writes their counters, so spend/impressions can't be inflated from devtools.
        function _campaignEvent(id, field) {
            try {
                if (!window.fbAuth || !window.fbAuth.currentUser) return;
                window.fbAuth.currentUser.getIdToken().then(function (t) {
                    var base = (typeof window._empApiBase === 'function' ? window._empApiBase() : '') + '/api';
                    return fetch(base + '/ads/event', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t }, body: JSON.stringify({ campaignId: id, type: field === 'clicks' ? 'click' : 'impression' }) });
                }).catch(function () { /* best-effort */ });
            } catch (e) {}
        }
        function _bump(adId, field) {
            if (adId && String(adId).indexOf('cmp_') === 0) { _campaignEvent(adId, field); return; }
            if (!window._firebaseLoaded || !window.fbDb || !adId) return;
            var inc = _fieldIncrement(1);
            if (!inc) return; // best-effort only — skip if FieldValue isn't available yet
            var upd = {};
            upd[field] = inc;
            window.fbDb.collection(ADVERTS_COL).doc(adId).update(upd).catch(function () { /* best-effort */ });
        }

        /* one delegated click handler covers every ad card in every
           container, present or future */
        /* open an advertiser's profile on the Reels (video gallery) tab */
        function _openAdGallery(uid) {
            if (!uid) return;
            if (typeof window.renderUserProfile === 'function') window.renderUserProfile(uid);
            if (typeof window.navigateTo === 'function') window.navigateTo('profile');
            if (typeof window._closeReelViewer === 'function') { try { window._closeReelViewer(); } catch (_c) {} }
            setTimeout(function () { var t = document.querySelector('.profile-tab[data-target="profile-reels-tab"]'); if (t) t.click(); }, 450);
        }
        /* make sure the global .follow-btn handler (app-fixes.js) can find the advertiser before it runs */
        document.addEventListener('click', function (e) {
            var fb = e.target.closest ? e.target.closest('.emp-ad-follow') : null;
            if (!fb) return;
            var uid = fb.dataset.userId, ad = _adIndex[fb.dataset.adId] || {}, nm = String(ad.advertiserName || 'Advertiser');
            var mu = (window.EmpState && window.EmpState.mockUsers) || window.mockUsers;
            if (mu && uid && !mu[uid]) mu[uid] = { id: uid, username: nm.replace(/\s+/g, '').toLowerCase(), fullName: nm, followerCount: 0, avatar: ad.advertiserLogoUrl || '' };
        }, true);
        document.addEventListener('click', function (e) {
            var card = e.target.closest ? e.target.closest('.emp-ad-card') : null;
            if (!card) return;
            if (card.classList.contains('emp-ad-v2')) {
                /* redesigned card: Read more / bookmark / CTA are handled here; a click is counted only
                   when the member confirms in the popup ("Open link"), not on every tap on the card */
                var _t = e.target;
                var _gl = _t.closest('.emp-ad-gal');
                if (_gl) { _openAdGallery(_gl.dataset.owner); return; }
                var _bd = _t.closest('.emp-ad-body');
                var _rm = _t.closest('.emp-ad-rm') || (_bd ? _bd.querySelector('.emp-ad-rm') : null);
                if (_rm) {
                    var _tx = _rm.parentNode.querySelector('.emp-ad-text');
                    if (_tx) { var _o = _tx.classList.toggle('is-open'); _rm.parentNode.classList.toggle('is-open', _o); _rm.classList.toggle('is-open', _o); _rm.setAttribute('aria-expanded', _o ? 'true' : 'false'); _rm.firstChild.textContent = _o ? 'Show less' : 'Read more'; }
                    return;
                }
                if (_t.closest('.emp-ad-follow')) return;
                var _sn = _t.closest('.emp-ad-snd');
                if (_sn) { _setAdSound(!_adSoundOn, true); return; }
                var _bm = _t.closest('.emp-ad-bm');
                if (_bm) { _bm.classList.toggle('is-on'); return; }
                if (_t.closest('.emp-ad-cbar')) _openSheet(_adIndex[card.dataset.adId]);
                return;
            }
            if (String(card.dataset.adId || '').indexOf('cmp_') === 0 && !e.target.closest('.emp-ad-cta')) return;
            _bump(card.dataset.adId, 'clicks');
        });

        var _impressionObserver = null;
        function _armImpressionObserver() {
            if (_impressionObserver || typeof IntersectionObserver === 'undefined') return;
            _impressionObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) return;
                    var node = entry.target;
                    var key = node._empAdInstanceKey;
                    if (!key || _seenImpressions[key]) return;
                    _seenImpressions[key] = true;
                    _bump(node.dataset.adId, 'impressions');
                    _impressionObserver.unobserve(node);
                });
            }, { threshold: 0.5 });
        }

        /* 2026-11-07 — AD SOUND. Video adverts play WITH sound. Browsers only allow unmuted playback after the person has
           touched the page, so a video starts muted, and is un-muted by the first tap/scroll/key (or the speaker button).
           One global on/off choice drives every ad video; a video plays only while on screen, so sound never leaks. */
        var _adSoundOn = true, _adGesture = false, _vidObserver = null;
        var _SND_BTN = '<button type="button" class="emp-ad-snd" aria-label="Toggle sound">'
            + '<svg class="s-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6"/><path d="M16 9l6 6"/></svg>'
            + '<svg class="s-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg></button>';
        function _syncSndBtns() {
            var vids = document.querySelectorAll('.emp-ad-mediawrap video, .emp-ad-slide video');
            for (var i = 0; i < vids.length; i++) {
                var _rt = vids[i].closest ? vids[i].closest('.emp-ad-slide, .emp-ad-card') : null;
                var b = (_rt || vids[i].parentNode).querySelector('.emp-ad-snd');
                if (b) b.classList.toggle('is-on', !vids[i].muted);
            }
        }

        /* 2026-11-07 — AD AUDIO ECHO FIX. A feed-card ad video that was scrolled into view stayed "visible" to its
           IntersectionObserver while the full-screen reel viewer / swipe viewer / thread opened ON TOP of it (an overlay
           does not change viewport intersection), so toggling the speaker un-muted and re-played that hidden copy as well
           as the slide's own copy of the same advert: the same audio twice, a few ms apart, and scrolling in the viewer
           never silenced it. Two rules now: (1) an ad video is never played/un-muted while a full-screen overlay it is not
           part of is covering it; (2) whenever an ad video starts, every OTHER ad video is paused and muted. */
        var _AD_OVERLAYS = '#reel-viewer-modal-overlay, #vfs-overlay, #vf-thread.vf-open';
        function _adCovered(v) {
            try {
                var ovs = document.querySelectorAll(_AD_OVERLAYS);
                for (var i = 0; i < ovs.length; i++) {
                    var o = ovs[i];
                    if (o.contains(v)) continue;
                    var cs = window.getComputedStyle(o);
                    if (cs.display !== 'none' && cs.visibility !== 'hidden') return true;
                }
            } catch (e) {}
            return false;
        }
        function _silenceOtherAdVideos(except) {
            var all = document.querySelectorAll('.emp-ad-mediawrap video, .emp-ad-slide video');
            for (var i = 0; i < all.length; i++) {
                var o = all[i];
                if (o === except) continue;
                try { o.muted = true; if (!o.paused) o.pause(); } catch (e) {}
            }
        }
        document.addEventListener('play', function (e) {
            var v = e.target;
            if (!v || v.tagName !== 'VIDEO' || !v.closest) return;
            if (v.closest('.emp-ad-mediawrap, .emp-ad-slide')) {
                if (_adCovered(v)) { try { v.muted = true; v.pause(); } catch (e1) {} return; }
                _silenceOtherAdVideos(v);
            } else if (v.closest(_AD_OVERLAYS)) {
                /* a reel / viewer video started on top: nothing from the feed's adverts may keep sounding underneath */
                _silenceOtherAdVideos(null);
            }
        }, true);
        function _playAdVideo(v) {
            if (_adCovered(v)) { try { v.muted = true; v.pause(); } catch (e0) {} return; }
            v.muted = !(_adSoundOn && _adGesture);
            var pr = v.play();
            if (pr && pr.catch) pr.catch(function () { v.muted = true; try { v.play(); } catch (e) {} _syncSndBtns(); });
            _syncSndBtns();
        }
        function _setAdSound(on, fromTap) {
            _adSoundOn = !!on;
            if (fromTap) _adGesture = true;
            var vids = document.querySelectorAll('.emp-ad-mediawrap video, .emp-ad-slide video');
            for (var i = 0; i < vids.length; i++) {
                var v = vids[i];
                v.muted = !(_adSoundOn && _adGesture);
                if (_adCovered(v)) { v.muted = true; if (!v.paused) { try { v.pause(); } catch (e) {} } continue; }
                if (!v.muted && v.paused && v._empAdVisible) { try { v.play(); } catch (e) {} }
            }
            _syncSndBtns();
        }
        ['pointerdown', 'touchstart', 'keydown', 'scroll'].forEach(function (evt) {
            window.addEventListener(evt, function unlock() {
                if (_adGesture) return;
                _adGesture = true;
                window.removeEventListener(evt, unlock, true);
                if (_adSoundOn) _setAdSound(true, false);
            }, { capture: true, passive: true });
        });
        function _armVideo(node) {
            var v = node && node.querySelector ? node.querySelector('.emp-ad-mediawrap video') : null;
            if (!v || typeof IntersectionObserver === 'undefined') return;
            if (!_vidObserver) {
                _vidObserver = new IntersectionObserver(function (entries) {
                    entries.forEach(function (en) {
                        var vv = en.target;
                        vv._empAdVisible = en.isIntersecting && en.intersectionRatio >= 0.5;
                        if (vv._empAdVisible) _playAdVideo(vv);
                        else { try { vv.pause(); } catch (e) {} }
                    });
                }, { threshold: [0, 0.5] });
            }
            v.muted = true;
            _vidObserver.observe(v);
        }

        /* =====================================================================
           2026-11-07 — IN-VIDEO ADVERTS (window.EmpAds)
           Same ad pool as the feed cards (admin adverts + Ad Manager campaigns, with the same targeting, budget
           checks and click/impression counting). Two forms:
             • pop-up: slides up over a video after VP_DELAY ms of watching (feed + profile post videos, reel viewer)
             • slide : a full-screen sponsored slide between reels, every REEL_SLIDE_EVERY reels
           Frequency caps keep it from being annoying: a gap between pop-ups, one per VP_EVERY videos watched,
           a session maximum, and an ad the viewer closed is not shown again this session.
           ===================================================================== */
        var VP_DELAY = 5000, VP_GAP = 60000, VP_EVERY = 3, VP_MAX = 12, VP_LIFE = 8000, REEL_SLIDE_EVERY = 4;
        var VP_INLINE = true; // 2026-11-08: pop-up ads over feed / profile / reels-grid videos ON (plus the full-screen reel viewer). Set false to turn the in-feed pop-up off.
        var _vp = { last: 0, shown: 0, since: VP_EVERY, dismissed: {} };
        function _pickAd(kind, ownerUid) {
            for (var i = 0; i < _ads.length; i++) {
                var ad = _nextAdFor(ownerUid, kind);
                if (!ad) return null;
                if (!_vp.dismissed[ad.id]) return ad;
            }
            return null;
        }
        function _initialOf(name) { return _esc(String(name || 'A').trim().charAt(0).toUpperCase() || 'A'); }
        function _vpHide(host) {
            var el = host && host._empVp;
            if (!el) return;
            host._empVp = null;
            clearTimeout(el._t);
            el.classList.remove('is-in');
            setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
        }
        function _vpShow(host, ad) {
            _injectCSS();
            try { if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) {}
            _adIndex[ad.id] = ad;
            var name = String(ad.advertiserName || 'Advertiser');
            var headline = ad.headline || _firstSentence(ad.caption, 70) || name;
            var el = document.createElement('div');
            var _small = host.clientWidth && host.clientWidth < 260;
            el.className = 'emp-vp' + (host.classList.contains('reel-viewer-item') ? ' emp-vp-reel' : '') + (host.classList.contains('reel-video-wrap') ? ' emp-vp-grid' : '') + (_small ? ' emp-vp-sm' : '');
            el.setAttribute('data-emp-vp', '1');
            el.innerHTML = '<span class="emp-vp-av">' + _initialOf(name)
                + (ad.advertiserLogoUrl ? '<img src="' + _esc(ad.advertiserLogoUrl) + '" alt="" onerror="this.style.display=\'none\'">' : '') + '</span>'
                + '<div class="emp-vp-t"><span class="emp-vp-sp">Sponsored \u00B7 ' + _esc(name) + '</span><span class="emp-vp-h">' + _esc(headline) + '</span></div>'
                + (ad.linkUrl ? '<button type="button" class="emp-vp-go">' + _esc(ad.ctaLabel || 'Learn more') + '</button>' : '')
                + '<button type="button" class="emp-vp-x" aria-label="Close">' + _FI.close + '</button>';
            ['click', 'touchstart', 'touchend', 'pointerdown'].forEach(function (ev) { el.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); });
            el.querySelector('.emp-vp-x').addEventListener('click', function () { _vp.dismissed[ad.id] = true; _vpHide(host); });
            var go = el.querySelector('.emp-vp-go');
            if (go) go.addEventListener('click', function () { _openSheet(ad); });
            if (_small && ad.linkUrl) el.addEventListener('click', function (e) { if (!e.target.closest('.emp-vp-x')) _openSheet(ad); });
            host.appendChild(el);
            host._empVp = el;
            _vp.last = Date.now(); _vp.shown++; _vp.since = 0;
            requestAnimationFrame(function () { el.classList.add('is-in'); });
            el._t = setTimeout(function () { _vpHide(host); }, VP_LIFE);
            setTimeout(function () { if (host._empVp === el) _bump(ad.id, 'impressions'); }, 1000);
        }
        function _vpPlaying(host, ownerUid) {
            if (!host || !_ads.length || host._empVpTimer || host._empVp) return;
            if (!host._empVpCounted) { host._empVpCounted = true; _vp.since++; }
            host._empVpTimer = setTimeout(function () {
                host._empVpTimer = null;
                if (!host.isConnected || host._empVp) return;
                if (_vp.shown >= VP_MAX || Date.now() - _vp.last < VP_GAP || _vp.since < VP_EVERY) return;
                var ad = _pickAd('popup', ownerUid);
                if (ad) _vpShow(host, ad);
            }, VP_DELAY);
        }
        function _vpLeft(host) {
            if (!host) return;
            clearTimeout(host._empVpTimer); host._empVpTimer = null;
            _vpHide(host);
        }
        /* feed + profile post videos (same card builder everywhere) */
        function _postVideoEvt(e, playing) {
            var v = e.target;
            if (!v || v.tagName !== 'VIDEO' || !v.classList) return;
            var isPost = v.classList.contains('story-video');
            /* Reels tab grid (before opening the viewer): the playing card's own video area */
            var isGrid = !isPost && !!(v.closest && v.closest('#reels-grid-container .reel-card'));
            if (!isPost && !isGrid) return;
            /* 2026-11-08 FIX ("ad pops up over feed videos although the user has not opened the full-screen video"): the 'play' event also
               fires for muted autoplay-in-view and for videos still buffering at 0:00, so this inline pop-up appeared on videos nobody had
               opened. It is now off for inline feed/profile post videos and the reels grid; the full-screen reel viewer still triggers it
               through window.EmpAds.videoPlaying (unchanged). Set VP_INLINE to true to bring the inline pop-up back. */
            if (!VP_INLINE) return;
            var host = isGrid ? (v.closest('.reel-video-wrap') || v.parentNode) : (v.closest('.story-media-item') || v.parentNode);
            if (playing) { var card = v.closest('[data-user-id]'); _vpPlaying(host, card && card.dataset ? card.dataset.userId : ''); }
            else _vpLeft(host);
        }
        document.addEventListener('play', function (e) { _postVideoEvt(e, true); }, true);
        document.addEventListener('pause', function (e) { _postVideoEvt(e, false); }, true);
        document.addEventListener('ended', function (e) { _postVideoEvt(e, false); }, true);

        /* full-screen sponsored slide for the reel viewer */
        function _makeSlide() {
            var ad = _pickAd('slide', '');
            if (!ad) return null;
            _injectCSS();
            _adIndex[ad.id] = ad;
            var name = String(ad.advertiserName || 'Advertiser');
            var isVid = ad.mediaType === 'video';
            var media = !ad.mediaUrl ? '' : (isVid
                ? '<video class="emp-sl-media" src="' + _esc(ad.mediaUrl) + '" muted playsinline loop preload="metadata"></video>'
                : '<img class="emp-sl-media" src="' + _esc(ad.mediaUrl) + '" alt="' + _esc(name) + '">');
            var el = document.createElement('div');
            el.className = 'reel-viewer-item emp-ad-slide';
            el.setAttribute('data-emp-slide', '1');
            el.innerHTML = '<div class="emp-z-media"><span class="emp-z-vt"></span>' + media + '<span class="emp-z-vb"></span></div>'
                + (isVid ? _SND_BTN : '')
                + _zoneHTML(ad, true)
                + _drawerHTML(ad);
            _wireZone(el, ad);
            var sn = el.querySelector('.emp-ad-snd');
            if (sn) sn.addEventListener('click', function () { _setAdSound(!_adSoundOn, true); });
            if (typeof IntersectionObserver !== 'undefined') {
                new IntersectionObserver(function (entries) {
                    entries.forEach(function (x) {
                        var v = el.querySelector('video');
                        if (x.isIntersecting) {
                            if (v) {
                                _silenceOtherAdVideos(v);
                                v.muted = !(_adSoundOn && _adGesture);
                                var pr = v.play();
                                if (pr && pr.catch) pr.catch(function () { v.muted = true; try { v.play(); } catch (_e) {} _syncSndBtns(); });
                                _syncSndBtns();
                            }
                            if (!el._imp) { clearTimeout(el._it); el._it = setTimeout(function () { if (!el._imp) { el._imp = true; _bump(ad.id, 'impressions'); } }, 1000); }
                        } else { clearTimeout(el._it); if (el._empCloseDrawer) el._empCloseDrawer(); if (v) { try { v.pause(); } catch (_e2) {} } }
                    });
                }, { threshold: 0.6 }).observe(el);
            }
            return el;
        }
        function _decorateReelViewer(container) {
            if (!container || !_ads.length) return;
            var items = Array.prototype.slice.call(container.querySelectorAll('.reel-viewer-item:not(.emp-ad-slide)'));
            for (var i = REEL_SLIDE_EVERY - 1; i < items.length - 1; i += REEL_SLIDE_EVERY) {
                var slide = _makeSlide();
                if (!slide) break;
                container.insertBefore(slide, items[i].nextSibling);
            }
        }
        window.EmpAds = { videoPlaying: _vpPlaying, videoLeft: _vpLeft, decorateReelViewer: _decorateReelViewer };

        function _makeAdNode(ad) {
            var wrap = document.createElement('div');
            wrap.innerHTML = _renderAdCardHTML(ad);
            var node = wrap.firstChild;
            _adIndex[ad.id] = ad;
            node._empAdInstanceKey = 'ad-' + ad.id + '-' + (_instanceCounter++);
            _wireZone(node, ad);
            _trimToggle(node);
            _armImpressionObserver();
            if (_impressionObserver) _impressionObserver.observe(node);
            _armVideo(node);
            return node;
        }

        function _countRealPosts(container) {
            var kids = container.children, n = 0;
            for (var i = 0; i < kids.length; i++) {
                if (!kids[i].hasAttribute || !kids[i].hasAttribute('data-emp-ad')) n++;
            }
            return n;
        }

        // Reads the follower count straight off the already-rendered
        // profile header (#profile-follower-count — see app-profile.js's
        // own renderer) rather than a separate lookup, so this can never
        // disagree with what the person is already looking at, and never
        // needs to touch app-profile.js itself.
        function _profileFollowerCountFromDOM() {
            var el = document.getElementById('profile-follower-count');
            if (!el) return 0;
            var n = parseInt(String(el.textContent || '0').replace(/[^0-9]/g, ''), 10);
            return isNaN(n) ? 0 : n;
        }
        // app-profile.js stamps the viewed user's id onto
        // .profile-header-info (see its own renderUserProfile()) whether
        // it's "my profile" or someone else's — reused here as-is.
        function _currentProfileUserId() {
            var el = document.querySelector('.profile-header-info[data-user-id]');
            return el ? el.dataset.userId : null;
        }

        // Returns the gate key this container is CURRENTLY eligible for,
        // or null if it isn't eligible right now at all (e.g. a
        // small-following profile, or the profile header hasn't rendered
        // yet). null means "don't inject" — not "already shown".
        function _containerGateKey(containerId) {
            if (containerId === 'feed-container') return 'dashboard'; // one fixed key -> exactly one ad, ever, for the dashboard
            // profile-dash-feed / profile-posts-feed — every profile is
            // eligible now (see PLACEMENT UPDATE note above), regardless
            // of follower count.
            var uid = _currentProfileUserId();
            if (!uid) return null;
            return 'profile:' + uid;
        }

        // Dashboard keeps the original "after the Nth post" pacing (so it
        // never lands awkwardly at the very top of a fresh feed); a
        // qualifying profile shows its one ad after the first real post —
        // this placement is already rare (gated on follower count), so it
        // doesn't need to wait for a feed-sized rhythm, and a profile with
        // only a couple of posts should still get the chance to show one.
        function _triggerCount(containerId) {
            return 1; /* 2026-11-07: the ad is pinned to the top of every feed, so it no longer waits for the Nth post */
        }

        /* Called for every node newly added to an observed feed container.
           Counts only REAL posts (skips any node we ourselves inserted),
           and injects the container's ONE allowed ad once the trigger
           count is reached — a no-op forever after via the gate key. */
        function _maybeInjectAfter(container, node) {
            if (!_ads.length) return;
            if (node.hasAttribute && node.hasAttribute('data-emp-ad')) return;
            var key = _containerGateKey(container.id);
            if (!key || _containerAdShownKey[container.id] === key) return;
            var realCount = _countRealPosts(container);
            if (realCount >= _triggerCount(container.id)) {
                var ad = _nextAdFor(container.id === 'feed-container' ? (node.dataset && node.dataset.userId) : _currentProfileUserId());
                if (!ad) return;
                _containerAdShownKey[container.id] = key; // gate closes — no more ads in this container until the key changes (a different profile)
                var adNode = _makeAdNode(ad);
                if (node.nextSibling) container.insertBefore(adNode, node.nextSibling);
                else container.appendChild(adNode);
            }
        }

        /* One-time sweep for posts already sitting in a container at the
           moment this module attaches (e.g. a feed that finished its
           initial batch render before the observer was armed). Same gate
           as _maybeInjectAfter — at most one ad card results from this
           sweep, not one per EVERY_N_POSTS boundary crossed. */
        function _sweepExisting(container) {
            if (!container || !_ads.length) return;
            var key = _containerGateKey(container.id);
            if (!key || _containerAdShownKey[container.id] === key) return;
            var kids = Array.prototype.slice.call(container.children);
            var realSeen = 0;
            for (var i = 0; i < kids.length; i++) {
                var kid = kids[i];
                if (kid.hasAttribute && kid.hasAttribute('data-emp-ad')) continue;
                realSeen++;
                if (realSeen < _triggerCount(container.id)) continue;
                var next = kid.nextSibling;
                if (next && next.hasAttribute && next.hasAttribute('data-emp-ad')) return; // already has one
                var ad = _nextAdFor(container.id === 'feed-container' ? (kid.dataset && kid.dataset.userId) : _currentProfileUserId());
                if (!ad) { if (container.id === 'feed-container') continue; return; }
                _containerAdShownKey[container.id] = key;
                container.insertBefore(_makeAdNode(ad), next || null);
                return; // one ad only — stop scanning
            }
        }

        /* =====================================================================
           COMMENT-SECTION ADVERT — #vf-th-comment-list
           ─────────────────────────────────────────────────────────────────
           A single compact, comment-styled sponsored item per opened
           thread, styled to sit naturally among real replies rather than
           as a big media card. Gated by postId — read off the
           data-postId app-thread.js's _openThread stamps onto
           #vf-th-post-area (see the companion edit added there) — so
           reopening/re-rendering the same thread's comment list never
           adds a second copy, matching the postId -> shown map declared
           above. Uses the SAME ad pool/rotation (_nextAd), and the SAME
           delegated click handler + IntersectionObserver impression
           tracking already wired for .emp-ad-card above (both are
           attribute/class based, so they pick this node up for free —
           nothing to duplicate here).
           ===================================================================== */
        function _renderAdCommentHTML(ad) {
            var fallback = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(ad.advertiserName || 'Ad') + '&background=1B2B8B&color=fff&size=80';
            return '<div class="vf-th-comment-item emp-ad-card emp-ad-comment" data-ad-id="' + _esc(ad.id) + '" data-emp-ad="1">'
                + '<img class="vf-th-comment-avatar" src="' + _esc(ad.advertiserLogoUrl || ad.advertiserAvatar || fallback) + '" alt="' + _esc(ad.advertiserName) + '" onerror="this.src=\'' + fallback + '\'">'
                + '<div class="vf-th-comment-right">'
                +   '<div class="vf-th-comment-header">'
                +     '<span class="vf-th-comment-name">' + _esc(ad.advertiserName) + '</span>'
                +     '<span class="emp-ad-badge emp-ad-badge-inline">' + _FI.horn + 'Sponsored</span>'
                +   '</div>'
                + (ad.caption ? '<p class="vf-th-comment-text">' + _esc(ad.caption) + '</p>' : '')
                + (ad.mediaUrl
                    ? '<div class="vf-th-comment-media">' + (ad.mediaType === 'video'
                        ? '<video src="' + _esc(ad.mediaUrl) + '" muted playsinline loop autoplay preload="metadata"></video>'
                        : '<img src="' + _esc(ad.mediaUrl) + '" alt="' + _esc(ad.advertiserName) + '" loading="lazy">') + '</div>'
                    : '')
                + (ad.linkUrl ? '<a class="emp-ad-cta" href="' + _esc(ad.linkUrl) + '" target="_blank" rel="noopener noreferrer sponsored">' + _esc(ad.ctaLabel || 'Learn More') + ' ' + _FI.arrow + '</a>' : '')
                + '</div></div>';
        }

        function _makeAdCommentNode(ad) {
            var wrap = document.createElement('div');
            wrap.innerHTML = _renderAdCommentHTML(ad);
            var node = wrap.firstChild;
            node._empAdInstanceKey = 'ad-cmt-' + ad.id + '-' + (_instanceCounter++);
            _armImpressionObserver();
            if (_impressionObserver) _impressionObserver.observe(node);
            return node;
        }

        function _activeThreadPostId() {
            var area = document.getElementById('vf-th-post-area');
            return area ? (area.dataset.postId || '') : '';
        }

        // Insert one ad after the first REAL comment currently in the
        // list, if this thread hasn't had one yet and there's at least
        // one real comment to sit alongside (an ad as the very first,
        // only "reply" in an empty thread wouldn't read as natural).
        function _maybeInjectCommentAd(list) {
            if (!_ads.length) return;
            var postId = _activeThreadPostId();
            if (!postId || _threadAdShownForPostId[postId]) return;
            var kids = Array.prototype.slice.call(list.children);
            var realSeen = 0;
            for (var i = 0; i < kids.length; i++) {
                var kid = kids[i];
                if (kid.hasAttribute && kid.hasAttribute('data-emp-ad')) continue;
                realSeen++;
                if (realSeen < 1) continue;
                var next = kid.nextSibling;
                if (next && next.hasAttribute && next.hasAttribute('data-emp-ad')) return; // already has one
                var _thArea = document.getElementById('vf-th-post-area');
                var ad = _nextAdFor(_thArea && _thArea.dataset ? _thArea.dataset.userId : '');
                if (!ad) return;
                _threadAdShownForPostId[postId] = true;
                list.insertBefore(_makeAdCommentNode(ad), next || null);
                return; // one ad only
            }
        }

        function _observeCommentList() {
            var list = document.getElementById('vf-th-comment-list');
            if (!list || list._empAdObserved) return;
            list._empAdObserved = true;
            _injectCSS();
            _maybeInjectCommentAd(list); // covers a thread already carrying comments when this attaches
            var mo = new MutationObserver(function (mutations) {
                mutations.forEach(function (m) {
                    if (!m.addedNodes || !m.addedNodes.length) return;
                    _maybeInjectCommentAd(list);
                });
            });
            mo.observe(list, { childList: true });
        }

        /* PROFILE FIX (2026-11-07): the profile page rebuilds #profile-dash-feed / #profile-posts-feed with a NEW
           element on every visit, but this cache used to be keyed by id alone, so after the first profile render the
           fresh container was never observed again and no ad appeared. It now remembers the element itself: a
           different element means a fresh feed, so the old observer is dropped, the one-ad gate is reset and the new
           container is observed (and swept for posts already in it). */
        var _observers = {}; // id -> { el, mo, t }
        /* 2026-11-07 — PIN ORDER: [election strip] -> [advert] -> newest posts (newest first) -> everything else.
           Runs after every change to a feed container. It only moves a node that is out of place, so it can never loop on its own.
           FREEZE FIX (2026-11-07): it CAN loop against the Quotes & Memes strip's own repositioner (_repositionQmStrip, which keeps that strip
           directly after the election strip, or after the first post) — each side's insertBefore re-fired the other's MutationObserver forever.
           So this function now treats #dash-feed-quotecard-strip as an accepted occupant of the slot it is placing into and steps past it. */
        var RECENT_MS = 10 * 60 * 1000;
        function _settleTop(c) {
            if (!c || !c.isConnected) return;
            var anchor = null, first = c.firstElementChild;
            if (first && first.classList && first.classList.contains('emp-dash-qm-strip')) anchor = first;
            var ad = null, recent = [], kids = c.children, i, now = Date.now();
            for (i = 0; i < kids.length; i++) {
                var k = kids[i];
                if (k.hasAttribute && k.hasAttribute('data-emp-ad')) { if (!ad) ad = k; continue; }
                var b = k.dataset ? parseInt(k.dataset.empBorn, 10) : NaN;
                if (!isNaN(b) && now - b < RECENT_MS) recent.push({ el: k, b: b });
            }
            var cursor = anchor ? anchor.nextSibling : c.firstChild;
            function _skipQmStrip() { if (cursor && cursor.id === 'dash-feed-quotecard-strip') cursor = cursor.nextSibling; }
            _skipQmStrip();
            if (ad) {
                if (ad === cursor) cursor = cursor.nextSibling;
                else c.insertBefore(ad, cursor);
            }
            recent.sort(function (x, y) { return y.b - x.b; });
            for (i = 0; i < recent.length; i++) {
                var n = recent[i].el;
                _skipQmStrip();
                if (n === cursor) cursor = cursor.nextSibling;
                else c.insertBefore(n, cursor);
            }
        }

        function _observeContainer(id) {
            var el = document.getElementById(id);
            if (!el) return;
            var cur = _observers[id];
            if (cur && cur.el === el) return;
            if (cur) { try { cur.mo.disconnect(); } catch (e) {} delete _containerAdShownKey[id]; }
            _injectCSS();
            _sweepExisting(el);
            _settleTop(el);
            var mo = new MutationObserver(function (mutations) {
                mutations.forEach(function (m) {
                    if (!m.addedNodes) return;
                    for (var i = 0; i < m.addedNodes.length; i++) {
                        var n = m.addedNodes[i];
                        if (n.nodeType === 1) _maybeInjectAfter(el, n);
                    }
                });
                _settleTop(el);
            });
            mo.observe(el, { childList: true });
            _observers[id] = { el: el, mo: mo, t: Date.now() };
        }

        /* Re-attach to a freshly rendered profile feed, and — for the profile Dashboard tab ("Your Feed") — show the
           ad even when the member has no posts yet (otherwise the "after the first post" trigger never fires). */
        function _tickProfileAds() {
            _observeAllFeedContainers();
            FEED_IDS.forEach(function (fid) { var ob = _observers[fid]; if (ob && ob.el && ob.el.isConnected) _settleTop(ob.el); });
            var o = _observers['profile-dash-feed'];
            if (!o || !_ads.length || Date.now() - o.t < 2500 || !o.el.isConnected) return;
            var key = _containerGateKey('profile-dash-feed');
            if (!key || _containerAdShownKey['profile-dash-feed'] === key || _countRealPosts(o.el) > 0) return;
            var ad = _nextAdFor(_currentProfileUserId());
            if (!ad) return;
            _containerAdShownKey['profile-dash-feed'] = key;
            o.el.appendChild(_makeAdNode(ad));
        }
        setInterval(_tickProfileAds, 1500);

        /* ── REEL SECTION (#reels-grid-container, grid and feed views) ──────────────────────────
           One sponsored card sits after the REEL_AFTER-th real reel. The reel module rebuilds / reorders this
           container freely, so instead of a one-shot gate the card is simply re-inserted whenever it is missing.
           The SAME node is reused, so a re-render never counts a second impression. The card is not a .reel-card,
           so the reel module's own ordering, pinning and viewer code never sees it. */
        var REEL_AFTER = 4;
        var _reelAdNode = null, _reelObs = null;
        function _ensureReelAd(grid) {
            grid = grid || document.getElementById('reels-grid-container');
            if (!grid || !_ads.length) return;
            var cards = [], i;
            for (i = 0; i < grid.children.length; i++) {
                var el = grid.children[i];
                if (el.hasAttribute && el.hasAttribute('data-emp-ad')) return; // already present
                if (el.classList && el.classList.contains('reel-card') && !el.classList.contains('reels-live-tv-card')) cards.push(el);
            }
            if (cards.length < REEL_AFTER) return;
            var ref = cards[REEL_AFTER - 1];
            if (!_reelAdNode) {
                var ad = _nextAdFor(ref.dataset && ref.dataset.userId);
                if (!ad) return;
                _reelAdNode = _makeAdNode(ad);
            }
            grid.insertBefore(_reelAdNode, ref.nextSibling);
        }
        function _observeReelGrid() {
            var g = document.getElementById('reels-grid-container');
            if (!g || _reelObs) return;
            _injectCSS();
            _ensureReelAd(g);
            _reelObs = new MutationObserver(function () { _ensureReelAd(g); });
            _reelObs.observe(g, { childList: true });
        }
        function _observeAllFeedContainers() { FEED_IDS.forEach(_observeContainer); _observeReelGrid(); }

        function _loadActiveAdverts() {
            if (!window._firebaseLoaded || !window.fbDb) return;
            window.fbDb.collection(ADVERTS_COL).where('active', '==', true)
                .onSnapshot(function (snap) {
                    var fresh = [];
                    snap.forEach(function (doc) { var d = doc.data(); d.id = doc.id; d._inhouse = true; fresh.push(d); });
                    /* Higher-priority ads appear more often — expand each ad
                       into the rotation list `priority` times (min 1) rather
                       than a separate weighted-random draw, so the rotation
                       stays predictable and easy to reason about. */
                    var expanded = [];
                    fresh.forEach(function (ad) {
                        var weight = Math.max(1, Math.min(10, parseInt(ad.priority, 10) || 1));
                        for (var i = 0; i < weight; i++) expanded.push(ad);
                    });
                    _baseAds = expanded;
                    _mergeAds();
                }, function (err) {
                    console.warn('[EmpAdverts] listener error:', err.message);
                });
            _loadCampaigns();
        }

        /* ── Ads Manager campaigns (collection ad_campaigns, status 'active') ─────────────────────────
           Eligibility is re-checked on every rebuild: inside its schedule, daily + total budget left, and the
           viewer matches the audience (profile location contains a chosen place; bio / profession / hobbies
           contain a chosen keyword). A campaign with an audience is never shown to guests (no profile to match). */
        var _baseAds = [], _campAds = [];
        function _viewerText() {
            var u = (window.EmpState && window.EmpState.userState) || window.userState || {};
            return { id: u.id || '', loc: String(u.location || '').toLowerCase(), about: [u.bio, u.profession, u.hobbies, u.education].join(' ').toLowerCase(), member: !!u.id && String(u.id).indexOf('guest') !== 0 };
        }
        function _campEligible(c, v) {
            var now = Date.now(); if (c.status !== 'active' || now < (c.startAt || 0) || now >= (c.endAt || 0)) return false;
            if (c.ownerId && c.ownerId === v.id) return false;
            var dk = new Date(now + 3600000).toISOString().slice(0, 10).replace(/-/g, '_'), ds = (c.daily && c.daily[dk]) || {};
            if ((ds.spend || 0) >= (c.dailyBudget || 0) || (c.spent || 0) >= (c.totalBudget || 0)) return false;
            var tg = c.targeting || {}, L = tg.locations || [], K = tg.keywords || [];
            if (!L.length && !K.length) return true;
            if (!v.member) return false;
            if (L.length && !L.some(function (x) { return v.loc.indexOf(x) > -1; })) return false;
            if (K.length && !K.some(function (x) { return v.about.indexOf(x) > -1; })) return false;
            return true;
        }
        function _mergeAds() {
            var v = _viewerText(), extra = [];
            _campAds.forEach(function (c) { if (_campEligible(c, v)) extra.push(c); });
            _ads = _baseAds.concat(extra); _rrIndex = 0;
            try { _ensureReelAd(); } catch (e) {}
        }
        function _loadCampaigns() {
            if (!window._firebaseLoaded || !window.fbDb) return;
            window.fbDb.collection('ad_campaigns').where('status', '==', 'active').onSnapshot(function (snap) {
                var list = []; snap.forEach(function (d) { var c = d.data() || {}; c.id = d.id; list.push(c); });
                _campAds = list; _mergeAds();
            }, function (err) { console.warn('[EmpAdverts] campaign listener error:', err.message); });
        }
        setInterval(function () { if (_campAds.length) _mergeAds(); }, 120000);

        function _boot() {
            _loadActiveAdverts();
            _observeAllFeedContainers();
            _observeCommentList();
        }
        document.addEventListener('empyrean-init-done', function () { setTimeout(_boot, 600); });
        document.addEventListener('empyrean-section-change', function () { setTimeout(_observeAllFeedContainers, 400); });
        // The thread panel's #vf-th-comment-list div exists once in the DOM
        // from initial page load (app-thread.js builds it as part of the
        // fixed overlay markup, not per-open) and is just cleared/refilled
        // each time a thread opens — one attach here is enough; the
        // MutationObserver above then reacts to whatever's opened, with the
        // postId gate above distinguishing between different threads.
        document.addEventListener('empyrean-init-done', function () { setTimeout(_observeCommentList, 800); });
        if (document.readyState !== 'loading') setTimeout(_boot, 1500);
        else document.addEventListener('DOMContentLoaded', function () { setTimeout(_boot, 1500); });

        console.log('[EmpAdverts] \u2705 Advert feed injector armed — sponsored cards from Firestore "adverts" (active==true) rotate into feed-container/profile-dash-feed/profile-posts-feed/vf-th-comment-list, weighted by priority.');
    })();


    /* =========================================================================
       DASHBOARD QUOTE/MEME CARD STRIP (#feed-container)
       ─────────────────────────────────────────────────────────────────────
       FEATURE (originally — "the quote and meme avatar card from the
       quick post and profile page post... currently appears vertically in
       the general dashboard home page... slide horizontally at the
       middle"). NOT the Status/Story bar (app-status.js) — that's a
       separate, unrelated feature left untouched. This is specifically for
       ordinary POSTS created via the Quote/Meme Card composer
       (window.EmpQuoteCard — the "Quote Card" button in Quick Post and in
       the profile page's own post composer, app-fixes.js/app-profile.js),
       tagged `isQuoteCard:true` at write time (see app-fixes.js's
       _insertCard()).

       CURRENT STATE (this session — "still not seeing the horizontal
       strip at all, cards render as normal vertical posts instead"):
       everything in the previous rewrite (full real post card via
       createNewPostElement(), one-time placement, no custom repositioning,
       handing swipe/auto-slide off to app-fixes.js's shared slider
       mechanism) was confirmed still deployed and still correct in
       principle — the actual gap was that _mountDashboardQuoteMemeStrip()
       only ever got ONE shot per trigger event, each firing once on a
       fixed short timer (500/900/600ms) early in page load. On a slow
       connection (this session's own screenshot: 8.5 K/s) Firebase's own
       async init can easily still be mid-flight past all three of those
       timers, `_fetchPublicQuoteMemeCards()` bails with an empty list the
       instant `window.fbDb && window._firebaseLoaded` isn't true yet, and
       nothing was left to try again afterward — a silent, connection-
       speed-dependent miss with no error, which is exactly the "why does
       this keep not happening, seemingly at random" pattern this feature
       kept showing. Fixed by turning the fixed one-shot timers into a
       short self-scheduling retry loop that keeps trying (capped, so it
       can't run forever) until the strip actually mounts or Firebase
       genuinely never becomes ready — same three event triggers still
       kept as the fast path for a normal-speed connection, the retry loop
       is purely a safety net underneath them, and doesn't touch anything
       about how the strip itself is built or sized. Whether these two
       particular posts are missing `isQuoteCard:true` and are therefore
       rendering as ordinary vertical posts is a separate, write-time
       question in app-fixes.js's Quick Post composer (`_insertCard()`) —
       out of scope here per "don't touch other sections". */
    (function empyreanDashboardQuoteMemeStrip() {
        'use strict';

        /* REVERTED (this session — "revert it back to the vertical
           positioning that was working perfectly before"): the horizontal
           mid-feed strip never rendered reliably (see the long fix history
           in the comment block above this IIFE) and duplicated content
           once the main posts listener above stopped skipping
           isQuoteCard posts. Quote/Meme Card posts now render as ordinary
           vertical posts via that listener instead, so this strip is
           disarmed at the top rather than deleted — flip this return off
           if the horizontal strip is ever wanted again. */
        return;

        var FEED_ID      = 'feed-container';
        var STRIP_ID     = 'dash-feed-quotecard-strip';
        var WRAPPER_ID   = 'dash-feed-quotecard-strip-wrapper';
        var CACHE_TTL_MS = 60000;

        var _cache    = null; // { ts, cards: [...] }
        var _reserved = false; // the empty strip+skeleton slot has been inserted
        var _resolved = false; // real cards (or "none exist") have been decided — terminal, like the old _mounted

        function _sortDesc(list) {
            return list.slice().sort(function (a, b) {
                return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
            });
        }

        function _fetchPublicQuoteMemeCards(cb) {
            if (_cache && (Date.now() - _cache.ts) < CACHE_TTL_MS) { cb(_cache.cards); return; }
            if (!(window.fbDb && window._firebaseLoaded)) { cb([]); return; }
            window.fbDb.collection('posts').where('isQuoteCard', '==', true).limit(40).get()
                .then(function (snap) {
                    var list = [];
                    var _skippedNoMedia = 0, _skippedBlocked = 0;
                    snap.forEach(function (doc) {
                        var d = doc.data() || {};
                        if (!d.media || !d.media.length) { _skippedNoMedia++; return; }
                        if (typeof window.isUserBlocked === 'function' && window.isUserBlocked(d.userId)) { _skippedBlocked++; return; }
                        d.id = doc.id;
                        list.push(d);
                    });
                    list = _sortDesc(list).slice(0, 20);
                    _cache = { ts: Date.now(), cards: list };
                    console.log('[EmpFeed] dashboard quote/meme fetch: ' + snap.size + ' isQuoteCard doc(s) total, ' + _skippedNoMedia + ' skipped (no media), ' + _skippedBlocked + ' skipped (blocked user), ' + list.length + ' usable.');
                    cb(list);
                })
                .catch(function (err) {
                    console.warn('[EmpFeed] dashboard quote/meme card fetch failed:', err && err.message);
                    cb([]);
                });
        }

        /* Builds the real, fully-interactive post card — the same
           .impact-story element every other post on the app renders via
           createNewPostElement() (header, avatar, date, quote/meme image,
           like/comment/retweet/bookmark/share/download). createNewPostElement()
           always stamps a synthetic postId and zeroed counts (correct for
           a brand-new optimistic post, wrong for rebuilding an existing
           Firestore doc), so this restores the real id/counts the same
           way the main posts listener already does a few hundred lines
           up in this file — that correction is what makes the action
           buttons actually work instead of silently no-op'ing. */
        function _buildFullCardEl(post) {
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
            var authorForCard = {
                id: post.userId,
                fullName: post.username || post.authorName || 'User',
                avatar: av
            };

            var el = createNewPostElement(post.text || '', media, authorForCard, false, null);
            el.dataset.postId = post.id || '';
            el.dataset.userId = post.userId || '';
            if (typeof window._empAttachFbBanner === 'function') { window._empAttachFbBanner(el, post); }   // 2026-10-04 Facebook banner

            var tsEl = el.querySelector('.story-user-info span');
            if (tsEl && post.createdAt) {
                var _createdDate = (post.createdAt && typeof post.createdAt.toDate === 'function')
                    ? post.createdAt.toDate()
                    : new Date(post.createdAt);
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

            return el;
        }

        /* FIX (this session — "appears late, distorts the whole feed with
           a magnified card, then shrinks/disappears; whole screen zooms,
           browser chrome included"): the previous version built AND
           inserted the entire strip — header, wrapper, full-size cards,
           images — in one shot, whenever its async Firestore fetch
           happened to resolve. Per the retry loop that used to sit below,
           that could be anywhere from under a second up to ~30s AFTER the
           rest of the feed had already loaded and settled (confirmed
           against this session's own console log: multiple posts loading,
           THEN, well after, "Dashboard quote/meme strip mounted once").
           Dropping a full-height, image-heavy subtree into the middle of
           an already-rendered, already-being-read feed at that arbitrary
           later moment is a genuine, large, late layout shift — exactly
           the kind of reflow that can make a mobile browser misregister
           the moment as a zoom gesture if a finger happens to be on the
           screen when it lands, which is consistent with "whole screen
           zooms" being reported specifically at the instant the strip
           appears, not at any other point in the session.

           FIX: split "claim the space" from "fill it with real content".
           _reserveSlot() runs as early as the very first trigger fires —
           it inserts the strip + header + wrapper immediately, with a
           fixed min-height skeleton placeholder, right after the FIRST
           loaded post (a stable anchor that doesn't drift as more posts
           stream in, unlike the old "whatever the middle child happens to
           be right now"). _resolveSlot() then fills that SAME, ALREADY-
           SIZED node in place once the Firestore fetch actually returns —
           swapping skeleton for real cards inside a box that was already
           reserved at that height causes no further shift to anything
           around it. If no quote/meme posts exist at all, the reserved
           slot is removed — but that decision now happens as soon as the
           fetch resolves (typically well under a second on a normal
           connection), not up to 30s later, so there's no late removal
           shift either. */
        function _reserveSlot() {
            if (_reserved) return;
            var feed = document.getElementById(FEED_ID);
            if (!feed || !feed.children.length) return; // need a real post already in place to anchor next to
            _reserved = true;

            var strip = document.createElement('div');
            strip.id = STRIP_ID;
            strip.className = 'emp-dash-qm-strip';
            /* FIX (2026-09-15 — "reverse the quote and meme card to the
               original vertical positioning instead of the horizontal
               scrollable position that failed to work"): after several
               earlier sessions of trying to make this strip swipe
               correctly (see the long history of scoped .emp-dash-qm-*
               rules in style.css), it's being reverted to a plain
               vertical stack instead. Rather than touch style.css (never
               edited directly, per this app's own convention, and
               .horizontal-slider-container/.horizontal-slider-wrapper are
               SHARED with the Reels/News/Marketplace strips elsewhere on
               this same dashboard — changing those classes' own rules
               would have reverted those three too, which nobody asked
               for), the override is inline here, scoped to just this
               strip's own two elements, using !important so it wins over
               the shared rules' own !importants (inline-style
               !important beats external-stylesheet !important in the
               cascade). overflow-x/scroll-snap-type/cursor are the
               specific properties that make it a horizontal swipe strip
               in the first place — neutralising exactly those, and
               nothing else about this card's own visual design, is what
               turns it back into an ordinary vertical block. */
            strip.innerHTML =
                '<div class="emp-pfrs-header">'
                + '<i class="fas fa-quote-right" style="color:#5B0EA6;"></i>'
                + '<strong style="font-size:0.9rem;">Quotes &amp; Memes</strong>'
                + '</div>'
                + '<div class="horizontal-slider-container" style="overflow:visible !important;padding-bottom:0 !important;">'
                + '<div class="horizontal-slider-wrapper" id="' + WRAPPER_ID + '" style="display:block !important;overflow-x:visible !important;overflow-y:visible !important;scroll-snap-type:none !important;cursor:default !important;gap:0 !important;padding:8px 16px 4px !important;">'
                + '<div class="emp-dash-qm-skeleton"></div>'
                + '</div></div>';
            // Reserved BEFORE any real content exists — close enough to a
            // real card's height that swapping skeleton for real cards in
            // _resolveSlot() doesn't itself trigger a second, smaller shift.
            strip.style.minHeight = '560px';

            // Anchored right after the first already-loaded post — fixed
            // and stable the moment this runs, unlike the old "middle of
            // however many children exist right now" (which kept moving
            // as more posts streamed in and only made the late-insertion
            // problem worse).
            feed.insertBefore(strip, feed.children[1] || null);
        }

        function _resolveSlot(cards) {
            if (_resolved) return;
            _resolved = true;
            var strip = document.getElementById(STRIP_ID);
            if (!cards.length) {
                // No quote/meme posts exist — remove the reserved slot
                // outright rather than leaving empty space. This runs as
                // soon as the fetch resolves, not up to 30s later, so
                // there's nothing left on-screen long enough to shift.
                if (strip) strip.remove();
                console.log('[EmpFeed] dashboard quote/meme strip: no usable cards — reserved slot removed.');
                return;
            }
            if (!strip) return; // slot was never reserved (feed had no posts at all yet) — nothing to fill

            var wrapper = strip.querySelector('#' + WRAPPER_ID);
            wrapper.innerHTML = ''; // drop the skeleton placeholder

            /* Opts this wrapper OUT of app-fixes.js's shared auto-swipe —
               with only 1-2 full-width (flex:0 0 100%) cards, that 4s
               auto-advance was a full card swap each tick (grow from a
               sliver to fill, then shrink away), which is its own
               separate flicker bug already fixed here previously. Native
               CSS scroll-snap still makes it finger-swipeable. */
            wrapper._empOwnSwipeHandling = true;

            cards.forEach(function (post) {
                try {
                    var _qmCardEl = _buildFullCardEl(post);
                    /* Cancels the CSS class's own "one full-width slide per
                       page" sizing (.emp-dash-qm-strip .horizontal-slider-
                       wrapper > .impact-story { flex:0 0 100%; ... } in
                       style.css) so each card instead just stacks as a
                       normal block-level element under the one above it —
                       the vertical-list behavior asked for here. */
                    _qmCardEl.style.cssText += ';flex:none !important;width:100% !important;max-width:none !important;margin:0 0 14px !important;';
                    wrapper.appendChild(_qmCardEl);
                }
                catch (e) { console.warn('[EmpFeed] dashboard quote/meme card build failed for post ' + (post && post.id) + ':', e && e.message); }
            });

            strip.style.minHeight = ''; // let real content size the box normally from here on

            console.log('[EmpFeed] \u2705 Dashboard quote/meme strip filled (' + cards.length + ' card(s)) — slot was reserved at first paint, so filling it in causes no layout shift to the rest of the feed.');
        }

        function _run() {
            if (_resolved) return;
            _reserveSlot();
            _fetchPublicQuoteMemeCards(function (cards) {
                _resolveSlot(cards);
            });
        }

        document.addEventListener('empyrean-section-change', function (e) {
            if (e && e.detail && e.detail.section === 'dashboard') setTimeout(_run, 500);
        });
        document.addEventListener('empyrean-init-done', function () { setTimeout(_run, 900); });
        window.addEventListener('empyrean:firebase-ready', function () { setTimeout(_run, 600); });

        /* SAFETY NET: the three triggers above are each a single
           fixed-delay shot, so a slow/flaky connection where Firebase
           finishes initialising later than all three of those timers
           results in a silent, permanent miss for that page visit. This
           is a short, self-capping retry loop underneath them — it just
           calls _run() again every couple of seconds, stopping the moment
           `_resolved` flips true or after 8 tries (~30s). Note this now
           only affects how soon the slot gets RESERVED and FILLED, not
           how big a shift that causes — the reservation itself is a
           single small, early DOM insertion (empty skeleton), so even a
           late retry under this loop is a small change, not the
           full-content late-drop this fix removed. */
        (function _retryUntilReady(attempt) {
            if (_resolved) return;
            _run();
            if (attempt >= 8) return;
            setTimeout(function () { _retryUntilReady(attempt + 1); }, 2000 + attempt * 1500);
        })(0);

        console.log('[EmpFeed] \u2705 Dashboard quote/meme card strip armed [build 2026-09-15-reserved-slot] — space reserved at first paint, real cards fill in without shifting the rest of the feed.');
    })();

    /* =========================================================================
       DASHBOARD QUOTE/MEME HORIZONTAL STRIP — v2 (2026-09-20)
       "Quote and meme card thumbnails should scroll/swipe horizontally
       without magnifying or distorting the rest of the feed."

       WHY THIS IS A SEPARATE, SMALLER MODULE (and the block above is still
       disarmed rather than deleted): the retired strip above fetched its own
       copy of every quote/meme post from Firestore AND relied on the main
       posts listener skipping those same posts — two independent renderers
       that had to agree on which posts belonged to whom, which is exactly
       what produced the duplicate/disappearing-card history documented in
       its own comments. This version has no fetch of its own. The ACTIVE
       posts listener (app-fixes.js) already builds every card through
       createNewPostElement() with real id/likes/blocked-user filtering; when
       that card is a quote/meme card (post.isQuoteCard) it now hands the
       finished element to window._empQmStripPlace() below instead of
       fc.append()/prepend()ing it into the vertical list. One renderer, one
       source of truth, and card design/logic are exactly what they already
       were — only the PARENT the card is placed in changes.

       LAYOUT-SAFETY RULES (each one closes a way a horizontal scroller can
       inflate an ordinary vertical feed — the "magnified / distorted" bug):
         1. Every box between #feed-container and the cards is width:100% /
            max-width:100% / min-width:0, and only the wrapper is a scroll
            container, so the row's total (N slides wide) scroll width can
            never become the feed's intrinsic width.
         2. Slides get a DEFINITE pixel width (--emp-qm-w), measured from
            #feed-container and clamped to the viewport, instead of a
            percentage or content-based basis. A `flex: 0 0 100%` slide
            whose container width is momentarily indefinite falls back to
            its max-content width (natural image pixels / one unwrapped
            text line) — a fixed px width has no such fallback.
         3. No `contain`, `transform`, `filter` or `will-change` on any
            ancestor of the cards: those turn the strip into the containing
            block for position:fixed descendants (comment sheet, menus),
            which would silently trap them inside it.
         4. The wrapper opts out of app-fixes.js's generic slider handler
            (`_empOwnSwipeHandling`): its 4s auto-advance and its
            touchmove-writes-scrollLeft drag were built for 200px thumbnails,
            not tall interactive post cards. Native touch scrolling +
            scroll-snap does the swiping; mouse drag is handled below.
       ========================================================================= */
    (function empyreanDashboardQuoteMemeHStrip() {
        'use strict';

        if (window._empQmHStripLoaded) return;
        window._empQmHStripLoaded = true;

        var FEED_ID    = 'feed-container';
        var STRIP_ID   = 'dash-feed-quotecard-strip';
        var WRAPPER_ID = 'dash-feed-quotecard-strip-wrapper';
        var STYLE_ID   = 'emp-qm-hstrip-css';
        var SLIDE_RATIO = 0.88;   // slide = 88% of feed width, so the next card peeks in and signals "swipe"
        var GAP_PX      = 12;     // matches .horizontal-slider-wrapper's own !important gap in style.css

        function _injectCss() {
            if (document.getElementById(STYLE_ID)) return;
            var s = document.createElement('style');
            s.id = STYLE_ID;
            s.textContent =
                '#' + STRIP_ID + '{display:block;box-sizing:border-box;width:100%;max-width:100%;min-width:0;overflow:hidden;}' +
                '#' + STRIP_ID + ' .horizontal-slider-container{display:block;box-sizing:border-box;width:100%;max-width:100%;min-width:0;overflow:hidden;padding-bottom:0;}' +
                '#' + WRAPPER_ID + '{display:flex !important;flex-wrap:nowrap;align-items:flex-start;box-sizing:border-box;width:100%;max-width:100%;min-width:0;' +
                    'overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;overflow-anchor:none;' +
                    'scroll-padding-left:16px;touch-action:pan-x pan-y;}' +
                '#' + WRAPPER_ID + ' > .impact-story{flex:0 0 var(--emp-qm-w,88%) !important;width:var(--emp-qm-w,88%) !important;' +
                    'min-width:0 !important;max-width:var(--emp-qm-w,88%) !important;margin:0 !important;box-sizing:border-box;}' +
                /* FIX (2026-09-28 — "quote and meme card thumbnails should be equal
                   in size across cards irrespective of the length of the text; the
                   chevron expand/collapse button should control the height"):
                   every card in the strip now has the SAME resting height, whatever
                   its caption says, and the existing "Show more" chevron is what
                   changes it.
                   RESTING SIZE: header is one line (long usernames ellipsize instead
                   of wrapping); the media is a true square (image letterboxed with
                   `contain`, so a quote card's own text is never cropped); the caption
                   is a box exactly 3 lines tall (--emp-qm-cap-h, measured from the
                   real line-height by _sizeCaption() below) with the chevron pinned
                   inside its bottom edge; actions sit at the bottom of the card.
                   EXPANDED: tapping "Show more" (shared engine in app-fixes.js, which
                   toggles .expanded on .story-content) lets that caption grow to its
                   full text, so the card gets taller; the row stretches its other
                   cards to the same height (align-items:stretch, actions pinned to
                   the bottom) so every card in the strip is still equal to the
                   others. "Show less" returns all of them to the resting size.
                   ALSO FIXED: the media box was width:100% plus the base rule's
                   14px side margins, so it overflowed the card by 14px on the right
                   (right corners cut off, box 28px too tall) — now calc(100% - 28px). */
                '#' + WRAPPER_ID + '{align-items:stretch !important;}' +
                '#' + WRAPPER_ID + ' > .impact-story{display:flex !important;flex-direction:column;overflow:hidden !important;}' +
                '#' + WRAPPER_ID + ' > .impact-story > *{flex:none;}' +
                '#' + WRAPPER_ID + ' > .impact-story .story-user-info{min-width:0;}' +
                '#' + WRAPPER_ID + ' > .impact-story .story-user-info strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
                '#' + WRAPPER_ID + ' > .impact-story .story-media-container{display:block !important;box-sizing:border-box;width:calc(100% - 28px) !important;aspect-ratio:1 / 1;height:auto !important;max-height:none !important;overflow:hidden !important;background:#f3f4f8;}' +
                '#' + WRAPPER_ID + ' > .impact-story .story-media-container[data-count]:not([data-count="1"]){display:flex !important;overflow-x:auto !important;overflow-y:hidden !important;}' +
                '#' + WRAPPER_ID + ' > .impact-story .story-media-item{width:100% !important;height:100% !important;max-height:none !important;}' +
                '#' + WRAPPER_ID + ' > .impact-story .story-media-container[data-count]:not([data-count="1"]) .story-media-item{flex:0 0 100%;}' +
                '#' + WRAPPER_ID + ' > .impact-story .story-main-image,#' + WRAPPER_ID + ' > .impact-story .story-video{width:100% !important;height:100% !important;max-height:none !important;min-height:0 !important;object-fit:contain !important;display:block;}' +
                /* ADDED (2026-10-05 — "uploaded images should fit properly into the meme square thumbnail without
                   extra or empty space"): `contain` above exists so a GENERATED quote card's own text is never cropped.
                   An uploaded picture card (ready-made meme / graphic) is not named quote-card-<timestamp>.png, so it
                   now FILLS the square edge to edge (centred, no side bars) instead of sitting letterboxed. Images only —
                   videos keep `contain`. Generated quote cards are untouched. */
                '#' + WRAPPER_ID + ' > .impact-story img.story-main-image:not([src*="quote-card-"]){object-fit:cover !important;object-position:center center !important;background:transparent !important;}' +
                '#' + WRAPPER_ID + ' > .impact-story .story-content{position:relative;box-sizing:border-box;height:var(--emp-qm-cap-h,120px);overflow:hidden;overflow-wrap:anywhere;padding:8px 16px 34px !important;}' +
                '#' + WRAPPER_ID + ' > .impact-story .story-content p{margin:0;}' +
                '#' + WRAPPER_ID + ' > .impact-story .story-content .post-expand-toggle{position:absolute !important;left:10px;bottom:3px;margin:0 !important;padding:6px !important;}' +
                '#' + WRAPPER_ID + ' > .impact-story .story-content.expanded{height:auto !important;min-height:var(--emp-qm-cap-h,120px);overflow:visible;}' +
                '#' + WRAPPER_ID + ' > .impact-story .story-actions{margin-top:auto;}' +
                /* Belt-and-braces: nothing inside a slide may be wider than the slide. */
                '#' + WRAPPER_ID + ' > .impact-story img,#' + WRAPPER_ID + ' > .impact-story video{max-width:100%;}';
            (document.head || document.documentElement).appendChild(s);
        }

        /* Definite slide width, measured from the feed itself and clamped to
           the real viewport so a momentarily over-wide feed can never feed
           an inflated number back into the strip. Skipped while the
           dashboard is hidden (clientWidth 0) — the ResizeObserver/section-
           change hooks below re-run it the moment it becomes visible. */
        /* Height of the resting (collapsed) caption box = top padding + exactly
           3 lines + the strip of padding that holds the chevron. The 3 lines
           use the same rule the shared line-clamp engine (app-fixes.js) uses
           to clamp the paragraph — round(3 x the paragraph's real line-height)
           — so a caption that gets a chevron fits its box exactly, and a short
           caption simply leaves the same amount of room empty. Measured from a
           real card rather than hard-coded, because line-height comes from the
           app's typography tokens. Needs at least one card in the strip;
           until then the CSS fallback (120px) stands. */
        function _sizeCaption(strip) {
            var sc = strip.querySelector('#' + WRAPPER_ID + ' .story-content');
            if (!sc) return;
            var cs = window.getComputedStyle(sc);
            var fs = parseFloat(cs.fontSize) || 15;
            var lh = parseFloat(cs.lineHeight);
            if (!lh || isNaN(lh)) lh = fs * 1.4;      // "normal" — same fallback the engine uses
            else if (lh < 4) lh = lh * fs;            // bare multiplier, defensively
            strip.style.setProperty('--emp-qm-cap-h', (8 + Math.round(lh * 3) + 34 + 2) + 'px');
        }

        function _sizeStrip() {
            var fc = document.getElementById(FEED_ID);
            var strip = document.getElementById(STRIP_ID);
            if (!fc || !strip) return;
            _sizeCaption(strip);
            var w = fc.clientWidth || 0;
            var vw = document.documentElement.clientWidth || 0;
            if (vw && w > vw) w = vw;
            if (!w) return;
            strip.style.setProperty('--emp-qm-w', Math.round(w * SLIDE_RATIO) + 'px');
        }

        function _wireMouseDrag(w) {
            var down = false, moved = false, startX = 0, startLeft = 0;
            w.addEventListener('pointerdown', function (e) {
                if (e.pointerType !== 'mouse' || e.button !== 0) return; // touch/pen use native scrolling
                down = true; moved = false; startX = e.clientX; startLeft = w.scrollLeft;
            });
            w.addEventListener('pointermove', function (e) {
                if (!down) return;
                var dx = e.clientX - startX;
                if (!moved && Math.abs(dx) > 5) {
                    moved = true;
                    w.style.setProperty('scroll-snap-type', 'none', 'important'); // style.css sets it !important, so inline must be too
                    w.style.setProperty('user-select', 'none', 'important');
                    try { w.setPointerCapture(e.pointerId); } catch (_e) {}
                }
                if (moved) w.scrollLeft = startLeft - dx;
            });
            function end() {
                if (!down) return;
                down = false;
                if (moved) {
                    w.style.removeProperty('scroll-snap-type'); // lets the browser snap to the nearest card
                    w.style.removeProperty('user-select');
                }
            }
            w.addEventListener('pointerup', end);
            w.addEventListener('pointercancel', end);
            // A drag must not also count as a click on whatever card button the drag ended over.
            w.addEventListener('click', function (e) {
                if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
            }, true);
        }

        function _syncVisibility(strip, wrapper) {
            strip.style.display = wrapper.children.length ? '' : 'none';
        }

        /* FIX (2026-09-27 — "quote and meme card thumbnail has been pushed
           to the bottom, it's supposed to be in the middle or close to the
           I support Presidential candidate card"): the block this replaces
           only ever anchored this strip ONCE, at the moment it was first
           created — right after the election-support strip if that
           happened to exist yet, otherwise after the first real post.
           That's fine for a static page, but the sibling election strip
           has its own MutationObserver (_watchElectionStripPosition above)
           that snaps ITSELF back to fc.firstChild on every single feed
           mutation — every ordinary new post, SOS appeal, repost, admin
           announcement. That observer only ever moves the election-support
           node; it has no idea this strip exists and never carries it
           along. So each live prepend elsewhere in the feed left this
           strip exactly where it was while the election strip hopped back
           to the top past it — over a session with enough live posts
           streaming in, the gap between them fills with ordinary posts and
           this strip drifts toward the bottom, which is exactly what was
           reported. Mirrors the same fix already applied to the election
           strip: a MutationObserver on fc's own childList re-runs the same
           anchor logic on EVERY mutation, not just at creation, so this
           strip is carried along immediately after the election strip (or
           after the first post, if no election-support post exists yet)
           no matter what else is being prepended around it. Re-running
           insertBefore when the strip is already correctly positioned is a
           DOM no-op, so this can't loop on itself, same reasoning as the
           election strip's own observer. */
        function _repositionQmStrip(fc, strip) {
            var electionStrip = document.getElementById(ELECTION_STRIP_ID);
            if (electionStrip && fc.contains(electionStrip)) {
                if (strip.previousElementSibling !== electionStrip) fc.insertBefore(strip, electionStrip.nextSibling);
                return;
            }
            var firstPost = null;
            for (var i = 0; i < fc.children.length; i++) {
                var child = fc.children[i];
                if (child !== strip && child.classList && child.classList.contains('impact-story')) { firstPost = child; break; }
            }
            if (firstPost) {
                if (strip.previousElementSibling !== firstPost) fc.insertBefore(strip, firstPost.nextSibling);
            } else if (!fc.contains(strip)) {
                fc.appendChild(strip); // truly empty feed (no posts, no election strip yet) — nothing to anchor to
            }
        }

        var _qmStripObserver = null;
        function _watchQmStripPosition(fc) {
            if (_qmStripObserver) return;
            _qmStripObserver = new MutationObserver(function () {
                var strip = document.getElementById(STRIP_ID);
                if (strip && fc.contains(strip)) _repositionQmStrip(fc, strip);
            });
            _qmStripObserver.observe(fc, { childList: true });
        }

        function _ensureStrip(fc) {
            _watchQmStripPosition(fc);

            var strip = document.getElementById(STRIP_ID);
            if (strip && fc.contains(strip)) {
                _repositionQmStrip(fc, strip); // defensive re-assert, same convention as the election strip
                return strip;
            }

            _injectCss();
            strip = document.createElement('div');
            strip.id = STRIP_ID;
            strip.innerHTML =
                '<div class="emp-pfrs-header">'
                + '<i class="fas fa-quote-right" style="color:#5B0EA6;"></i>'
                + '<strong style="font-size:0.9rem;">Quotes &amp; Memes</strong>'
                + '</div>'
                + '<div class="horizontal-slider-container">'
                + '<div class="horizontal-slider-wrapper" id="' + WRAPPER_ID + '"></div>'
                + '</div>';

            var wrapper = strip.querySelector('#' + WRAPPER_ID);
            // Must be set BEFORE the strip enters the DOM: app-fixes.js's generic
            // slider handler attaches from a MutationObserver and checks this flag.
            wrapper._empOwnSwipeHandling = true;
            _wireMouseDrag(wrapper);
            new MutationObserver(function () { _syncVisibility(strip, wrapper); })
                .observe(wrapper, { childList: true });

            // Provisionally append, then let _repositionQmStrip put it in its
            // real spot (right after the election strip if present, else
            // right after the first real post) — see that function's own
            // comment for why this now runs continuously, not just here.
            fc.appendChild(strip);
            _repositionQmStrip(fc, strip);

            if (typeof ResizeObserver === 'function') {
                try { new ResizeObserver(_sizeStrip).observe(fc); } catch (_e) {}
            }
            window.addEventListener('resize', _sizeStrip);
            document.addEventListener('empyrean-section-change', function (e) {
                if (e && e.detail && e.detail.section === 'dashboard') setTimeout(_sizeStrip, 50);
            });
            _sizeStrip();
            return strip;
        }

        /* Called by the ACTIVE posts listener (app-fixes.js) for posts with
           isQuoteCard:true. Returns true if it placed the card (caller then
           skips its own vertical insert), false to let the caller fall back
           to the ordinary vertical placement. */
        /* ADDED 2026-10-04 (Facebook Page sync): a small tappable banner on any post that
           exists on the Facebook Page — imported Page posts (source:'facebook', fbPermalink)
           and Empyrean admin posts that were sent there (fbPostId). Tapping it opens the
           Facebook post in a new tab. Idempotent; called from each post-card renderer. */
        /* ADDED 2026-10-06: a blue Follow button on every post in the public home feed (style.css shows it only inside
           #feed-container). It reuses the app's EXISTING follow engine — the document click handler in app-fixes.js
           that acts on any `.follow-btn[data-user-id]` (follower counts, notifications, persistence, rank rewards).
           This only adds the button, shows the right state (Follow / Following), hides it on your own posts, and keeps
           every button for the same author in step. Idempotent; called from _empAttachFbBanner for each post card. */
        window._empAttachFollowBtn = function (el) {
            if (!el || !el.querySelector) return;
            var uid = el.dataset && el.dataset.userId;
            if (!uid || uid === 'undefined' || uid === 'null' || uid.indexOf('biz-') === 0) return;
            var me = (typeof _us === 'function' ? _us() : window.userState) || {};
            if (me.id && me.id === uid) return;
            var info = el.querySelector('.story-header .story-user-info');
            if (!info || !info.parentNode) return;
            var following = false;
            try { var set = me.followedUserIds; following = !!(set && (typeof set.has === 'function' ? set.has(uid) : (Array.isArray(set) && set.indexOf(uid) > -1))); } catch (_e) { }
            var b = el.querySelector('.emp-post-follow');
            if (!b) {
                b = document.createElement('button');
                b.type = 'button'; b.className = 'follow-btn emp-post-follow'; b.setAttribute('data-user-id', uid);
                info.parentNode.insertBefore(b, info.nextSibling);
            }
            b.classList.toggle('followed', following);
            b.innerHTML = following ? 'Following' : 'Follow';
            try {   // the follow engine looks the author up in mockUsers; make sure an entry exists
                window.mockUsers = window.mockUsers || {};
                if (!window.mockUsers[uid]) {
                    var nm = ((info.querySelector('strong') || {}).textContent || '').trim();
                    var av = el.querySelector('.story-header .avatar-placeholder img');
                    window.mockUsers[uid] = { id: uid, username: nm || 'user', fullName: nm || 'User', avatar: av ? av.src : '', followerCount: 0 };
                }
            } catch (_e) { }
            if (!window._empPostFollowSync) {
                window._empPostFollowSync = true;
                document.addEventListener('click', function (ev) {
                    var btn = ev.target && ev.target.closest && ev.target.closest('.emp-post-follow'); if (!btn) return;
                    setTimeout(function () {   // after the follow engine has toggled this button
                        var id = btn.getAttribute('data-user-id'), f = btn.classList.contains('followed');
                        Array.prototype.forEach.call(document.querySelectorAll('.emp-post-follow[data-user-id="' + id + '"]'), function (o) {
                            o.classList.toggle('followed', f);
                            o.innerHTML = f ? 'Following' : 'Follow';
                        });
                    }, 80);
                });
            }
        };

        /* ADDED 2026-10-29 ("some users' posts don't show their picture avatar"): a post document stores the author's avatar
           AS IT WAS WHEN THEY POSTED. A post made before the author had a profile photo (or whose saved avatar link is empty /
           broken) therefore renders a generated initials placeholder (ui-avatars.com) forever, even after the author set a real
           photo. This looks the author's CURRENT photo up once per author (memory first, then users/{id} in Firestore, cached)
           and swaps it in — only when the card is still showing a placeholder, so cards that already have a real picture are never
           touched. Skipped for retweets (the card shows the ORIGINAL author, not the reposter) and business-page posts.
           Idempotent; called from _empAttachFbBanner for each post card, same as the Follow button above. */
        window._empHealPostAvatar = (function () {
            var _cache = {};      // uid -> real avatar url ('' = author has none / lookup failed)
            var _pending = {};    // uid -> [callbacks] while a Firestore read is in flight
            function _isPlaceholder(src) { return !src || /ui-avatars\.com/i.test(src); }
            function _fromObj(o) { var u = o && (o.avatar || o.profilePhoto || o.photoURL); return (u && typeof u === 'string' && !_isPlaceholder(u)) ? u : ''; }
            function _lookup(uid, cb) {
                if (Object.prototype.hasOwnProperty.call(_cache, uid)) { cb(_cache[uid]); return; }
                var known = '';
                try { known = _fromObj((window.mockUsers || {})[uid]) || _fromObj((window.registeredUsers || {})[uid]); } catch (_e) { }
                if (known) { _cache[uid] = known; cb(known); return; }
                if (_pending[uid]) { _pending[uid].push(cb); return; }
                if (!window.fbDb || typeof window.fbDb.collection !== 'function') { cb(''); return; }   // offline / not ready: try again on a later card
                _pending[uid] = [cb];
                var done = function (url) { _cache[uid] = url || ''; var q = _pending[uid] || []; delete _pending[uid]; q.forEach(function (f) { try { f(_cache[uid]); } catch (_e) { } }); };
                try {
                    window.fbDb.collection('users').doc(uid).get().then(function (d) { done(d && d.exists ? _fromObj(d.data()) : ''); }, function () { done(''); });
                } catch (_e) { done(''); }
            }
            function _apply(img, url) {
                if (!img || !url || !_isPlaceholder(img.getAttribute('src'))) return;
                var prev = img.getAttribute('src');
                img.onerror = function () { this.onerror = null; this.src = prev; };   // real photo failed to load -> back to the placeholder
                img.src = url;
            }
            return function (el) {
                if (!el || !el.querySelector) return;
                var uid = el.dataset && el.dataset.userId;
                if (!uid || uid === 'undefined' || uid === 'null' || uid.indexOf('biz-') === 0) return;
                if (el.dataset.isRetweet === '1') return;
                var ph = el.querySelector('.story-header .avatar-placeholder');
                var img = ph && ph.querySelector('img');
                if (!img || (ph.style && ph.style.borderRadius === '8px')) return;   // no avatar slot / business-page post
                if (!_isPlaceholder(img.getAttribute('src'))) return;                 // already shows a real picture
                _lookup(uid, function (url) {
                    if (!url) return;
                    _apply(img, url);
                    try {   // keep every other card by the same author in step
                        Array.prototype.forEach.call(document.querySelectorAll('.impact-story[data-user-id="' + uid + '"]:not([data-is-retweet="1"]) .story-header .avatar-placeholder img'), function (o) { _apply(o, url); });
                    } catch (_e) { }
                });
            };
        })();

        window._empAttachFbBanner = function (el, post) {
            /* ADDED 2026-10-06 (Facebook-style feed): on a post with MORE than 4 pictures only the first 4 show as a 2x2
               grid; the 4th tile carries a "+N" overlay (style.css reads data-more). Idempotent; runs before the banner. */
            try {
                var _mc = el && el.querySelector && el.querySelector('.story-media-container');
                if (_mc) {
                    var _its = _mc.querySelectorAll('.story-media-item');
                    Array.prototype.forEach.call(_its, function (it) { it.removeAttribute('data-more'); });
                    if (_its.length > 4) _its[3].setAttribute('data-more', String(_its.length - 4));
                }
            } catch (_moreErr) { /* cosmetic */ }
            try { window._empAttachFollowBtn(el); } catch (_flwErr) { /* cosmetic */ }
            try { window._empHealPostAvatar(el); } catch (_avErr) { /* cosmetic */ }
            try {
                if (!el || !post || el.querySelector('.emp-fb-banner')) return;
                var imported = post.source === 'facebook';
                var url = imported
                    ? (post.fbPermalink || (post.fbPostId ? 'https://www.facebook.com/' + post.fbPostId : ''))
                    : (post.fbPostId ? 'https://www.facebook.com/' + post.fbPostId : '');
                if (!/^https:\/\/([\w-]+\.)?facebook\.com\//i.test(url)) return;
                var a = document.createElement('a');
                a.className = 'emp-fb-banner';
                a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
                // a.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin:6px 16px 2px;padding:4px 11px;border-radius:14px;background:rgba(24,119,242,0.10);color:#1877F2;font-size:0.72rem;font-weight:600;text-decoration:none;line-height:1.35;max-width:calc(100% - 32px);';   // superseded 2026-10-06 (c): pill look moved into style.css (.emp-fb-banner) for the redesign
                /* REDESIGNED 2026-10-06: a slim source card — small caps line ("Originally published on Facebook" / "Also published on
                   Facebook"), the Page name beneath, and a "View post" button on the right. No logo, no wrapping, one tap target. */
                a.setAttribute('aria-label', (imported ? 'Originally published on the Empyrean Facebook Page' : 'Also published on the Empyrean Facebook Page') + ' \u2014 view post on Facebook');
                a.innerHTML = '<span class="efb-txt"><span class="efb-eyebrow">' + (imported ? 'Originally published on Facebook' : 'Also published on Facebook') + '</span>'
                    + '<span class="efb-name">Empyrean Facebook Page</span></span>'
                    + '<span class="efb-cta">View post<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg></span>';
                a.addEventListener('click', function (ev) { ev.stopPropagation(); });
                var anchor = el.querySelector('.story-content, .post-content');
                if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(a, anchor); else el.appendChild(a);
            } catch (_fbBannerErr) { /* banner is cosmetic — never block a post from rendering */ }
        };

        window._empQmStripPlace = function (el, initialBatch) {
            var fc = document.getElementById(FEED_ID);
            if (!fc || !el) return false;
            var strip = _ensureStrip(fc);
            var wrapper = strip && strip.querySelector('#' + WRAPPER_ID);
            if (!wrapper) return false;

            if (initialBatch) {
                wrapper.appendChild(el);                 // Firestore DESC order -> newest first, left to right
            } else {
                /* Live new post -> newest at the left. If the person has already
                   swiped along the row, keep the card they were looking at exactly
                   where it was. Corrected by MEASURING the anchor card's position
                   before/after rather than adding a fixed offset, because browsers
                   differ on whether they re-snap/anchor on their own after a
                   prepend (Chrome does) — a fixed offset would double-apply there. */
                var wRect = wrapper.getBoundingClientRect();
                var target = wRect.left + 16;            // where a snapped card sits (matches scroll-padding-left)
                var anchor = null, best = Infinity;
                if (wrapper.scrollLeft > 0) {
                    for (var i = 0; i < wrapper.children.length; i++) {
                        var d = Math.abs(wrapper.children[i].getBoundingClientRect().left - target);
                        if (d < best) { best = d; anchor = wrapper.children[i]; }
                    }
                }
                wrapper.insertBefore(el, wrapper.firstChild);
                var realign = function () {
                    if (anchor) {
                        var dx = anchor.getBoundingClientRect().left - (wrapper.getBoundingClientRect().left + 16);
                        if (Math.abs(dx) > 1) wrapper.scrollLeft += dx;
                    } else if (wrapper.scrollLeft !== 0) {
                        wrapper.scrollLeft = 0;          // at the start -> stay at the start so the newest card is the one showing
                    }
                };
                realign();
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(realign);
            }
            _syncVisibility(strip, wrapper);
            _sizeStrip();
            if (wrapper.children.length <= 3) console.log('[QuoteMemeStrip] placed card #' + wrapper.children.length + ' (post ' + (el.dataset && el.dataset.postId) + ') in the horizontal strip.');
            return true;
        };

        /* Is this Firestore post doc a Quote/Meme card? Primary signal is the
           `isQuoteCard` flag written by the composers. Fallback: the composer
           always names its generated image `quote-card-<timestamp>.png`, and
           uploadMediaFilesToCloudinary() (app-dom.js) keeps the file name —
           hyphens included — in the storage URL. Posts published before the
           flag existed (or whose flag was lost) would otherwise never reach
           the strip and stay in the vertical list. */
        window._empIsQuoteCardPost = function (post) {
            if (!post) return false;
            if (post.isQuoteCard === true) return true;
            var m = post.media;
            if (!m || !m.length) return false;
            for (var i = 0; i < m.length; i++) {
                var u = (typeof m[i] === 'string') ? m[i] : ((m[i] && (m[i]._cloudUrl || m[i].url)) || '');
                if (u) {
                    try { u = decodeURIComponent(u); } catch (_e) {}
                    if (/quote-card-\d{6,}/i.test(u)) return true;
                }
            }
            return false;
        };

        /* Console helper: window._empQmStripDiag() */
        window._empQmStripDiag = function () {
            var w = document.getElementById(WRAPPER_ID);
            var info = {
                moduleLoaded: true,
                stripInDom: !!document.getElementById(STRIP_ID),
                cardsInStrip: w ? w.children.length : 0,
                slideWidthVar: (document.getElementById(STRIP_ID) && document.getElementById(STRIP_ID).style.getPropertyValue('--emp-qm-w')) || '(unset)',
                captionHeightVar: (document.getElementById(STRIP_ID) && document.getElementById(STRIP_ID).style.getPropertyValue('--emp-qm-cap-h')) || '(unset)',
                quoteLookingCardsOutsideStrip: 0
            };
            var fc = document.getElementById(FEED_ID);
            if (fc) {
                Array.prototype.forEach.call(fc.querySelectorAll('.impact-story img.story-main-image'), function (img) {
                    var _src = img.getAttribute('src') || '';
                    try { _src = decodeURIComponent(_src); } catch (_e) {}
                    if (/quote-card-\d{6,}/i.test(_src) && !img.closest('#' + WRAPPER_ID)) info.quoteLookingCardsOutsideStrip++;
                });
            }
            console.log('[QuoteMemeStrip] diag', info);
            return info;
        };

        console.log('[EmpFeed] \u2705 Dashboard quote/meme horizontal strip v2 ready [build 2026-09-28b-equal-cards] — cards adopted from the posts listener, definite slide widths, contained scroll.');
    })();


    console.log('[EmpFeed] ✅ Feed module ready — post builder, 8 listeners, dashboard widgets loaded.');

})();

/* =============================================================================
   LIVE POLLS — participant voting widget
   ─────────────────────────────────────────────────────────────────────────
   Renders every currently OPEN poll (created from the admin panel's new
   "Live Polls" card in app-admin.js) as a click-to-vote card with a live
   progress bar per option, mounted as a sibling directly above
   #feed-container — deliberately NOT threaded through this file's own
   posts onSnapshot/diffing logic above (that listener's job is posts;
   polls are a different collection with different lifecycle rules —
   closed/reopened, not created/deleted — so keeping this as its own small,
   separately-mounted, separately-listened widget is safer than teaching
   the existing post-diffing code a second doc shape).

   VOTE / RESPONSE INTEGRITY
     • Signed-in users vote (or, for 'collect' polls, submit answers) through
       a client-side Firestore TRANSACTION against polls/{id}/voters/{uid}
       (or polls/{id}/responses/{uid}) — it reads the poll doc AND that
       voter/response doc together and aborts the whole write if the doc
       already exists, so a double-click or a second tab can never double
       count. Same read-modify-write shape already used elsewhere in this
       app for an equivalent "client write, guarded by a doc that must not
       already exist" case (see app-patch-v33.js's _empToggleModerator
       against the same kind of open Firestore rule).
     • Guests are NOT trusted to self-report "I haven't voted/responded yet"
       — the client can't prove that about itself. Their vote goes to
       server.js's POST /api/polls/:id/vote-guest, and a guest's
       data-collection response (2026-09-26) goes to its respond-guest
       counterpart; both read the request's real IP server-side and enforce
       one-per-IP-per-poll there — the one part of this feature that
       genuinely needs a server.
   ============================================================================= */
(function empyreanLivePollsWidget() {
    'use strict';

    if (window._empLivePollsWidgetLoaded) {
        console.warn('[LivePolls] Already loaded — skipping duplicate.');
        return;
    }
    window._empLivePollsWidgetLoaded = true;

    var TOPIC_COLORS = {
        politics: '#3B82F6', music: '#C9A66B', medicine: '#22c55e',
        science: '#8B5CF6', epidemic: '#ef4444', disaster: '#f97316',
        general: '#64748b'
    };
    var BAR_COLORS = ['#00D4AA', '#3B82F6', '#C9A66B', '#8B5CF6', '#ef4444', '#f97316', '#22c55e', '#eab308'];

    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function _pct(n, total) { return total > 0 ? Math.round((n / total) * 1000) / 10 : 0; }
    function _fbOk() { return !!(window._firebaseLoaded && window.fbDb); }
    function _myId() { return (!window.isGuest && window.userState) ? window.userState.id : null; }

    /* Edit/Delete now live inside a per-card "⋮" menu (2026-09-25) instead of
       sitting as two standalone buttons in the actions row. One delegated,
       module-level outside-click listener closes whichever menu is open —
       bound once here rather than re-bound on every _paintPoll repaint
       (repaints happen on every vote), which would otherwise pile up a new
       document listener each time a poll card updates. */
    if (!window._empPollKebabOutsideBound) {
        window._empPollKebabOutsideBound = true;
        document.addEventListener('click', function () {
            Array.prototype.forEach.call(document.querySelectorAll('.emp-poll-kebab-menu--open'), function (m) {
                m.classList.remove('emp-poll-kebab-menu--open');
            });
        });
    }

    /* ── icon set (2026-09-25) — every glyph in this widget used to be a
       Font Awesome <i> class (fa-share-nodes, fa-ellipsis-vertical,
       fa-heart, ...). Font Awesome's glyph coverage isn't guaranteed
       across every build/version actually loaded on a given device —
       confirmed by screenshot here the same way app-news.js's _actionIcon
       already documents for fa-share-nodes elsewhere in the app: those
       names render as a plain missing-glyph "tofu" box on some devices even
       though they're valid on Font Awesome's own site. Inline SVG has no
       such dependency, so this widget now draws its own icons — same
       minimal stroke language (24×24, currentColor, rounded caps) app-news
       already established for its own action icons, so the two features
       still read as one consistent design system. */
    function _icon(kind) {
        var s = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" '
            + 'stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex-shrink:0;"';
        switch (kind) {
            case 'share':
                // Identical node-and-lines glyph to app-news.js's _actionIcon('share') —
                // reused verbatim rather than inventing a fourth share design for the app.
                return '<svg ' + s + '><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle>'
                    + '<circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>'
                    + '<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>';
            case 'chart':
                return '<svg ' + s + '><line x1="4" y1="20" x2="20" y2="20"></line><rect x="6" y="12" width="3" height="6"></rect>'
                    + '<rect x="11" y="8" width="3" height="10"></rect><rect x="16" y="4" width="3" height="14"></rect></svg>';
            case 'comment':
                return '<svg ' + s + '><path d="M21 11.5a8.38 8.38 0 0 1-6.6 8.2 8.38 8.38 0 0 1-4.7-.4L4 21l1.7-5.3a8.38 8.38 0 0 1-.7-3.9 8.5 8.5 0 0 1 8.5-8.3h.4a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';
            case 'kebab':
                return '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-3px;flex-shrink:0;">'
                    + '<circle cx="12" cy="5" r="1.9"></circle><circle cx="12" cy="12" r="1.9"></circle><circle cx="12" cy="19" r="1.9"></circle></svg>';
            case 'edit':
                return '<svg ' + s + '><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>';
            case 'trash':
                return '<svg ' + s + '><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>'
                    + '<path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
            case 'send':
                return '<svg ' + s + '><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
            case 'chevron':
                return '<svg ' + s + '><polyline points="6 9 12 15 18 9"></polyline></svg>';
            case 'plus':
                return '<svg ' + s + '><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
            case 'fire':
                // Small filled glyph (not stroke) so it reads clearly at
                // badge size against the trending badge's gradient fill.
                return '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px;flex-shrink:0;">'
                    + '<path d="M12 2c1 3-3 4-3 8a3 3 0 0 0 6 0c1 1 2 2.5 2 4.5A5.5 5.5 0 0 1 11.5 20 6 6 0 0 1 6 14c0-4 3-5 3-8 1 1 2 2 2 3 .5-2 .5-4 1-7z"></path></svg>';
            case 'export':
                return '<svg ' + s + '><path d="M12 3v12"></path><polyline points="7 9 12 14 17 9"></polyline><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path></svg>';
            case 'check-circle':
                return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
                    + 'stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex-shrink:0;">'
                    + '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"></path><polyline points="22 4 12 14 9 11"></polyline></svg>';
            case 'heart':
                return '<svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
                    + 'stroke-linejoin="round" style="vertical-align:-2px;flex-shrink:0;">'
                    + '<path class="emp-poll-heart-path" fill="none" d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"></path></svg>';
            case 'link':
                return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
                    + '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>'
                    + '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
            case 'dismiss':
                return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
                    + '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            case 'whatsapp':
                return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
                    + '<path d="M20.5 3.5a10.5 10.5 0 0 0-17 12L2 21l5.7-1.5a10.5 10.5 0 0 0 15-9 10.4 10.4 0 0 0-2.2-7z"></path>'
                    + '<path d="M8.5 8.7c.3-.6.6-.6.9-.6h.6c.2 0 .5 0 .7.5s.8 1.9.9 2 .1.3 0 .5-.2.3-.4.5-.4.4-.5.6-.3.4 0 .8 1 1.7 2.1 2.4 1.4.9 2 1 .5.1.7-.1.7-.8.9-1 .3-.3.5-.2s1.9.9 2.2 1 .5.2.6.4-.1 1.1-.5 1.5-1.4 1.1-2.7.9-3.6-1.1-5-2.4S8 12.5 7.6 11 8.1 9.4 8.5 8.7z"></path></svg>';
            case 'telegram':
                return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
                    + '<line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
            case 'mail':
                return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
                    + '<rect x="2" y="4" width="20" height="16" rx="2"></rect><polyline points="2 7 12 13 22 7"></polyline></svg>';
            case 'form':
                return '<svg ' + s + '><rect x="5" y="3" width="14" height="18" rx="2"></rect>'
                    + '<line x1="9" y1="8" x2="15" y2="8"></line><line x1="9" y1="12" x2="15" y2="12"></line>'
                    + '<line x1="9" y1="16" x2="13" y2="16"></line></svg>';
            case 'eye':
                // FEATURE (2026-09-27 — live viewer count): small stroke eye,
                // same 24x24/currentColor language as every other glyph here.
                return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
                    + 'stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;flex-shrink:0;">'
                    + '<path d="M1 12s4-7.5 11-7.5S23 12 23 12s-4 7.5-11 7.5S1 12 1 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
            default: return '';
        }
    }

    function _letterGlyph(letters) {
        return '<span style="font:800 13px/1 Arial,Helvetica,sans-serif;color:#fff;letter-spacing:-0.5px;">' + _esc(letters) + '</span>';
    }

    /* ── poll avatar badge (2026-09-26, updated) — user supplied the real
       Empyrean Poll logo (circular "E" + ballot-slip-with-checkmark seal,
       navy background) as an uploaded image and asked to use it directly
       instead of a hand-drawn SVG stand-in. Cropped to just the circular
       mark (no wordmark, which is illegible at this size), rendered
       transparent, and embedded here as a 64px PNG data URI so it needs no
       network request and can't fail/lag. Pure decoration — aria-hidden. */
    var _POLL_AVATAR_SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABBmlDQ1BJQ0MgUHJvZmlsZQAAeJxjYGCSYAACJgEGhty8kqIgdyeFiMgoBQYkkJhcXMCAGzAyMHy7BiIZGC7r4lGHC3CmpBYnA+kPQFxSBLQcaGQKkC2SDmFXgNhJEHYPiF0UEuQMZC8AsjXSkdhJSOzykoISIPsESH1yQRGIfQfItsnNKU1GuJuBJzUvNBhIRwCxDEMxQxCDO4MTGX7ACxDhmb+IgcHiKwMD8wSEWNJMBobtrQwMErcQYipAP/C3MDBsO1+QWJQIFmIBYqa0NAaGT8sZGHgjGRiELzAwcEVj2oGICxx+VQD71Z0hHwjTGXIYUoEingx5DMkMekCWEYMBgyGDGQBMpUCRBqmilgAAHV9JREFUeJy9e3ecVdXV9rPWPufeuXcKzFBsEWPDFjsKFhywxBJLRGY0YsPXFk3kJ8ZOHMc3aorl09gbRKLijEZjS0wsFEVUFBs6KBYQBIHp5ZZz9l7fH3vvcy/Eku8z73t+P2aGe+45Z6+1n/WsZ629D+E/dIgIjRt3lZozpzn2n2UzIe6Z+Y/tF729atSa9oE9u7uLOw4U9YhiIRqutakyoBQRQYwuKqX6AkVrUmGwPJPiDyoz6s0Rw9MLb7zhjLZCUSfPqa9vCmbPvkoTkfwnxk3f9wYiQo2Nrdza2qjd/9WV1z6x74dLvzq6uyd/YH9/vEMxDjJaAmgtiOMYIgbGGBAB4swgYjArEDEUE4hiMAq5VAofVlaoF0dsWvnk9Dt+Pp+IrDcaWhRaGwzw/RzxvRzQ0NCivOGvvfb+xtNb3jn5sy96Tu7ujXbO5QlxpAEYCMQoJhERIvLPJPIOcE4QIkAbEYgIQGQETKSgVIAwiFGZ4ffqaoKZ+++emXnxxZNXbziG/zUHNDU1cXNzswCQVauWDp927bwpnyzvPbM/nxqWzxchEguBNDGYxJA21lqCAH7Wia2d1nSIGDsaAQgCASBCQkQiIgbECqRIKYUU9a+tG4R7frwr3XxR80VrAFBTUxM1Nzeb/3EH1Nc3BXPmNMeZTIjzL5l13qL3V1+xrhOb5AtFMJtYETGI2ULcWisCEBPETS4RQQRgImuoMTBigBI8kuGJAMwEbb1ojBEjQBAEITKpwqphdcE1zz9+4W1RLMnY/qccQEADA6269a/zdmp9fMlty1bH9X19ORBJzIqUGENEAMCAAIC4uSQb73Czn8S9nXmC/S1lQyICxLiriWG0Tpxo78IaxEEQhKiuyM/ZcWt13r23T11suaHRlJ7yH3CAjV0iJphp1zw2+eXXV96ypkOqIDpWCkqE3H18+JY5wM0+fGh7nIOSvy1QJAkJIgYAGOPv5wYqSBxqkSFiNDQ4DNJBoW/TIXL+3x6/dDrQxMBV8u8Q5Hc6wBmPdErJ6ec/cOO7H/Zc0NE5gCAQrZRSIgJjLEz9oC0MxJGbi2/Afe45wM6w/Yi8+5zj/PfsdR4JSjHEWFolOzbnFaMFSqXTKdTVFG6a98zFU7WBw9y3O+FbHeCNF5HgtHOn/3nxJ4XGgYF8HAZGuVPQ2oCVchckPyy7owRzJnaMbx1kvFNQdikAcqgwRuARRY4w/XeYbUhYZLAjVxEjSodhJsgEXS2v/W7ISTTq7Pi7nPCNDvCwFxF1yjn3P/b+0vxRUZSPmCkkEEAErTUgdkCJFVQKAyKLCIiAWfn7WqPc1wUlFIiRUiZwzgUJCGyR5VBW+h4BYkDMICYYYyBARBSG2aDnqbtP3Oi4UWd/qb8tHIJvMJ9o3DiVSqn41HNnzFq8tHBUFBUipTj07O6NIGYHXUmMILZixk6XZ3ZOTPYxDggIBCayBiqXI4lgRMDMYCYYA4AMGARtPHKojDRtGAIAiQm1KUQDqD3q7IfXPsjc3GjGIsAcaHwNMX4tAurrm4J5c5vj038x/ca32/IX5Au5KFAUWoRLMvSEzAR2wGQhH2uDXC6PhPrdoyyc3d8u3ku86O8lJS7wQglAtiKNIFDQscsGxmsKASuG0aakMUQgRFHA6bAy1XHTwtnNU78pRf6LAxpaWlRrY6O+9KpHTp37eseM7t4Ba3xJs4KJoI1AjFjyE4tGIoKODaqrFC45f39kKgIXy1/n+7IQKGMCKfseOcem0gH+z10L0PZRB9KpIDE8IVWUP8OziIY2iAKlwsHZrtMWvHDNn75ONa4XAk1NTdzc2KhbWl7f7q6HF97W01s0gaLAMr1AKS4RUpmgofK4NQbpdBqHH7gT0ukUAC/OPGI29AZtcF6+5rspTH/oLcRaI8MpW0eALJkaATEAERghEIkjWALDBFqT6clV3nZ0w9ULWlsblzgVmyjG9RzwwQcfkIjwsafcdf/aTlOp2GgRMMBgtn422ljYudh3sgUiBtoYK1oM0NU9gJpqA63FOsFlCMsZwHpT/bUgMQBs5kilNCzps/2cnLAqk8/GyQ+YMveRIoI2sclWLlvVc7+IjKXGxvVQ79nIFRWt+qJps87+cg321XEhNiLKwszOtFOrYHa5XdaHLBMn1Y1SCoFiKAYUE1TAUIGyaPkaxS7Jz3JiKPsMTlCVVVBE7AjUp1lJwsFmFwFAyuhcnI+z++4+9tKz0dqqGxpa1HoIcFWa6V6xYkjDlMev7usXEzAxyMaghXcy1/YzsM3v7KWrhaQ2pswpzpBEANkMUlWd3sDAf51/+KeJgCh02UCDKASxHRc5siQQxBiXQeytGQSRBAsca2NyOnX1QT+9tKW1taHDsZYEANDY2MpAoz7/N/dduLZLDWXKxyAK7IAZYPsQk0hVJNOYfAdwpMjuvCMFKklcJkK+UMRrb34KEXJIcvOVCCdvus0UYgSpVICenhyUSgCbOMcyvsvy5FKslQflCGKIiSWoG7puXdeFAF1uEQ9NnhTa2lYOPfuilo/WdpjBSgmIOCnYfb71uRkw1uNJac8QY6AUo1jUGFqXwl9mnIKa6jTiOHaOAtKpECu+bMdhjXcjXwzBbBsjDoUuw3DiFO9gAKioyFgpnNQaJceW1xjM7FBrz5mSbhCBAlO+a+TWeuTTDzevA5o4mD3bMssNd750Wl+hopapPwYo8JA3fjYc5EohQEmhAjHJzJXCtxS7fnACAStCdVU1uKDAiF2sskMWOwqwTG7J1s+2Q4oBiC35GvGcxImhPgOU1xVunCSiY3C29rPPO08DcH19PZjnzGnWIhIsX9n1X4V8LEox+/QiIk5ASvJQbUxyYyIfcr4QMmXap9x493/nEyMCY2IY0dZYY9xnAu16A2IMxGgrb8Xfh1yPgZDICyl7bhki2JG3DUl7HTFYAIk1/1dTU30wZ85VmgHIldc+NrqrR7Y3JhIBsYiFu49Lq+dhe1ZSMqqENBurYuyskYHlmDIHeETZvw0CpRAohTAIXMZQYLIZg5nsZ+4cHMnZ5xmLJS/Fyd/b6RJjWwF20u0A/fghwiKxgCu3f+KFvUYnJPjBkq+OzRcZTDCAMJw+56QBQa4kLakvy3HKPRgQy0LWcd5wsRrAagMBSBBrjY7OfuSLKQTKBlWp8jMJUoisXgiUQmVlmBCrgSW8fyFL2SAb6SR4rR0ekUaMoRQXiqljAbwSiAgfPOGWg+KYwCTswxrE8IVPqXsrCSmS+NofAJcpwvXSGpX4g2xRk82kMflneyDWCspnFziy8+hyxqXTCu0deTz9j4+tgBIvm6VUaSa+9rxgnUmeN/z4jQaRgrEZAcaog6SpiYMHZs3bZiCH7cXENnnCa2udeNQTG4nr4bl8Th52PvH7tGRMyQ1lWllrg0E1Wfz6op/g64/1SRMI0fbRcjzx7GKEYTpJ8+KMJ8dDxpfX4pFZGleSIXwTVoTExDAm2H7sy7ltgjfeXLV3pIMKYm1AxFJ2s6TU8IpPyoZXloZMghp3nkr52gWQQ4hl8Z6egQTqPlLK9anlHYNsNo3OroEk5SWTIZJ83xtvUaTBpIAyqirZkziMRMSA0xW9hWjvYE17z6goFjBIrNKyMeSizWUDhwSUnONn1g8AjnUhDD+CEmesXwZbLWGJ015qnJD3iHPFjK80y6BvjECx5xpj2V58JuLEob5OYNd9ShDi/yKGjmlU0JeLd4hjDSZD7AYRG21b1qVwdPCBe7Akmp48FXvyI5/xfVigbHrtdRVpVT6YDb+UzGwYhkilAzedJRXq22nMBBg7LWJ7AI5LLOTJZQzyY0smDkQQaMEOQbEQbWGMATPI5i9AsUq8DacJ2Mna8jS4YYpnABADLiNDge3kGAfhOBZ8vmyNvaeTtgKB0S52HQkaATLpACtWdiWVZ0lxeKeXWAMCK5qkxPiJdPdXlYiaBAJtsEUQaxkmRkOYnJ4GjGj4VpXnsFIvz6tAB22PDnfGhkW5dzxxAmGosGZNByadNRO5YoBA+YWzsoZnqdiDX2NgFZSItsxg8WqRGDYjG4sCAkRrEDEIBG30es4TEMSifFggQlUutslXeYTyGiCZTJuyvDIkWGh59nO/qbwNVq4ZnCuMCAwUBAHcaqoLAgHDzrTPbp5HbJFTwpQPdM89tjSwWqC8JPYoIF+ms+cBmyMFUsUCSZWzLAEQXbpFkprJiwz32+dZd1dKiM4xgJ92ALYitLC2jU4Ld3Y+IhennhIYAoIGyHgdCSNlgxE/Fk50hjfc9ykUq2QiyqVysvgCAoRSnMyuV2umFG2OXkq9t0SjG8eyJZcaY1nZt8HLeM+dkwQ53kSTiB9YoWOsASYJaFeKs0NQmbq2/nXtr/LwIJuFfPbyMsATpXWELoUciIoiSEgKZJ8tXv8LYGLzL4RiPei7QmVCyI/QWe/5wadX7yzbWgOMYWhDMNoB3N3PGKscxRB0rJNn+CJH4Js1rlVnxGYlIefgUth5vvD3B3yFyMWAIH1EXFeiwFIN7dtM62UoKkHQuKrLd41E/NSULZRAEjL1t0oHBsXAIFQKvomXIIvgFlG8IzQCskJHG4dLKeME1z/w05IoT/FapkwN+mzF5HKm6QsUYy0z10EkWXNLYOYkbaIMXfJPurEoQ856LOuZAKXwgUDHBrW1VXj4vsmItSBQFhXFKE74B45fLM8Z6FhQXZXGSy9/hmnX/RMVFSGAUtuNmZIs4n/6k14+sas59IbEJnptUJEKlzFjO0gkcDWdb0L4zRp2+4pPT5Q8ysOPCdah8KnRV2JwadWnSYuGzTerATMjly8iUAqZbBWiYj+0dusMKBVg2hhkMhlsNHwNjNYQUfBNlKQ5IyaJ9fVEFXk0l1ayfIIjAikly7iqKvzQtZGSxVZjxDUixK10ixuMAGwZuSRjqQR992Djy9pER5QWsgBBLldEEIa44/652PWAazHjoXmIYkFFJo1CMUb/QAH5fIRCIUahoGFMjEI+hpHYKWZ2CHOh5biLnD5xwE+eKSIQdv0scRnQrl1+yBsPr1kYBAamfIHGUS652bCqUANOU1PyHZRJUD8Tdna0NojiGFpb6MfaVoPFKEYqHeKLFR148NFF+Mmhe+CO+1/G+GNuxp8eXoBAhaitrbK7QoyGMRqiJVkTZLLZgvxwRUBiU6Jx8Z8YXjIlIWyvLEAG6XS4MNhnt01eX7Doi/yASIUiiICSlFymIB0a2LaxvLJxxQcSsrHXKMWora1EpiKdnCstQWgAKfz+j0/iB5vW4qZrJqKnpwczW97A9be+gD/ePRfnnz0eE4/ZFYOrsjAmBnMFqqsrAAQWbQ7qJaSxbaOhpFfEt/R8LDlCBkGIAmZE+aFD8TqJCB8y4ZY3l6+KdlNsbOPX3sWRS2kdnwDosja4FyHwrSiy4VOVDXFK4y5Ipxha+weTXSBRQP9AjFvufBEP3Hkq9tl7S+TzRVRVZdHZ2Y8HHnkD985cgMpsiAlH7oxsJkAqFeCjT7vw6FMfIQwJkLhUTNnODBLJREj0iQ9TER8SAEAGnOJ0kHu77TXZkwBg0ll3X/9OW+HCOMrHzAgSpZH0/mHX37VO/k5SCkptMA83bQx6e/NJPNl9QHammAld3QM46bgdceeNJ6CvLw+/oBKGAbLZNNo7+jFz1mu4/b65WLU2QjZbiSBkZDMhjNZ2kUR818eUCTXYNAok+wk8n/kFHBHEzBVBVar7hvcWXPMrBoDRu2/xeFUGMEY4aW46pjfOe/4zYlfvJ+FhyUa5BRHv6brBlRhSW4PawVUYUleDoUMGYWhdFWqqs9h8syr84swDUIx0AmMCIYpiiDaoHZTGlHMOwKK5l+P0k0YhlUqhpqrCtbVsjnf7QmxvIelKOaf4frlYgHiucFmMCXkMqjaPuyAG/fKcH782ZLBqE1FEIJNITFOGApDttnhFI5SoQMsR1kG+G6y1RhRFSars6Suir7+Azq5uHHHQtth5py2RTqegWCGKNCrSCoMG1eCZ5xfjlHPuwqJ3l0MpwpKlq2CMho6jMlldLnFLUPfaAbAaprylLkIQYwyRopQqts27/MevASCur39JEVG83ZbD7stm0qTLEoIk5GW96vO57RGYUnGRNCIsWTIrqCAEK4W+/gLWtXdj262qccj4LZBJR/j55LFY3PYZrr/1WYAItXU1+OjTtfjJCTfimpuewhmnHoQ9dtsWd814CfNfX4Ga6hS0DzOflq0mcz0LW8tYopeEdhPuS6icDbOimqrwPho/Pq6vb1I8btxsAwA3XDdxxtBadBoR5Qvj0oUCwMaxV16eFZNS08VEEChoLejo7EcuN4C9dx+O2357JJ5rORtdvetw5GE7YNttNsO7i5fjoitaMP+NT/Dwowuwz2HXoboyjedapmLc/jti7dpO3DNzHpgM2tt7IMIIw9DNtt9opd3wKNkz4JFJCf69XmERsEqpXOfhB2w8AwDGjYMhoLTfduplrdf+85UvLyvkczEr8ivHiR/IzTxgwBwk3vcEk8/HyOWKGD60AocfuA2OP3YP7LLTZhjIFXD3zJdw451P4o3nrsOQukoQESaceive+7Ad3b0DuOjcAzHtV0eip7sP1TXVuPoPj2POKx/j2mmNeOChVzH71S+wpr2AigpGNpOCEasvbEaS5J8XXtpoO0fMLnQoVqoi2GKz+LrZT192ubfZ8YP4dFn3k+Nvb/twaW9dRQVDRDjZniaeCUqagNmmuf6BIoyJMHLLQZh45M447uhdsckmtVj66Wq8+trH+Gx5F26451FccOZhuOqSSejo6EJdbRUeeuxVnHLudNxz02mYPOkAdHV1IwwV1q7rxT5HXIVTGw/CL88Yj002HowvV3XjkSfeRutf38FHn7YjDFOoqsqCuVRZimgHS4aYOAlhETEiAepqpOOqC3fafsKEYzuco+zKEBFJQ0OLImpsv+n2f165rmvp7R2dPbFS4pt2MK5RapyeL0YafX39GFyTwqH1W+CkhlHYd/QPERUjLFz0OR5+7HX09hVQVZnB+0tXYKNhNTh38uHI5fqRDkMUCkXU7zMSTzxwDo48bA/09HSDiVBZWYNp181CdVUWgyurcfeMuRgyJIvdfjQCZ54yGmeduh+en92GWY8vwquvr0B3XwE1NRmEAZdyoPiVa8tNJjYmXZEKthmRuXLChAntzlaNJHAdhTY0PKJaWhrknKmPzHtx/sp9CUUNgSptV7XCI45jDBmcwgk/3QOHHTwSW/1wKFau7MTrb32GJUvXIFeIkApDtH32Bbr7c1j47lJcOeUYnH/GEWhv70YQ2A0arAipVIje3gEQCNlMCp8sW4NDjv8NNho2FEMHZ1FTU4XtthiBSMeorkpjh5EbYcyorTBsaDXefX8VnnmuDU889z66e/MIgtDpEV9+CwCj44jVlpsH81/+++VjiRoJaE02SpXtERLsuGODEJFZu7b79NOntL759vurM5kMJeUMMWMgX8QeOw/HPTcej7aPP0dNTRqpIER7Rx/WrOtFFMV2HR/Awnc+wMo1Hchks5je8hL+1PICtI5dCNnGhdGWU4wxCBSjpz9Cvqix/MvV+OjzPAZXZ7HVD34AxQr5gQJWftmJ9o5+bLH5cGy95RBsuZWCUgMwpmzPANm2OxNJISLaeGjQP/mkMacTkbH7IUpWr7dJqrmZTEtLixo2bNCSPz0y/7z2zvyML1Z2RtlsGIpTVloDg2syGDa0GvUT7kJnVz9OPPYATP7ZwZjy8yOwZk0H5rzyAd5bvAo/3m80inGETCaFYqQRx4JYm4TF2RGoAIgi204LlUI2mwIzoRhFYDAqUgo7jByO+n13wIgRw9D2yQpceu1DeKB1DlZ/uhJDN9sW2fQQu0nLq0NmFIomrh2UDg8Zu+l5Z5x80JKGhhbV3Lz+NrnyXk9yNDW9FPz31ePj5j/87ca/PPvpBV09PVGoKGQm9PQWcMCYTTHjjydi/MQrseiDLyAgVFZWYNyY7XDKhP1x4P67AkJ46+1leP/DFfhqbQ+YFYIg5eLSSWoSt6PUdnSNELQWFApFgDU2HlaNPXb9IXbdeQQCJXjx5Xdx70Mv4NkXFyHqK2Ln3bfFlDOOwLJlA7j57vmoG5SFdgu2WiNKpbNh/ei6m2beddbU/cf+mxslAZ8VrlKZimvjKZc91vLM85839Od6o3Sows7uftSP2Rwz7zgFY4+9EouXrkZ1dQZRZNDb1wPEEbbbemNMmlCPSceNx2Yb16Ht41WY+0obPl66FrEBKioCBMzQbhM1MxBrjUI+BgjYasQQ7L/PSOy04w+wrr0brU/Px70P/hPvLmwDZUIcfuCemPyzQ3DQ2F1QWzsYt9z1AqZd+zyG1GWh4wjaIFIqDPfaZVDrs49e2Jgv7BcAs3UiCsqOr90r7F5T0UTNfN2VR02Ko79U/H3OiqMGBnojRRS6YtEtWQMm1iDRqK3KAiB8vqILV/z+Udw64wUcdfBuOOm4sZh84li0d/bhlQUfYfGSL9HbV4BSAbTWKEYxamtTGLPn1th7z20xdEgl3nznY/zysjvR8vSr6PiiHZtusxl+NfUENB41Brv+aCsEAaOzuxdxPICie6uMiZHXiMIgDPfeueapR/98/iR6cAqLzP7Gt8y+YbN04gQQUSwix2HaX//8/MvLG5d3fRUHQaBEhMq3pIgYxGK3ImUyGVRWVqE/F+Heh1/CAy0vYvQe2+C04w/E0YeOxlGH74l33luGufPbEMcG+43ZGXvtsRViHePvL72FOx/4O55/4Q0g0hg15kf4zcWTcMyho7DppkMQRzF6egfgV6wV+wYJpFA0OpupCvfaZVDLrOlnn+TGjm97xe4bHVDmBCKiOFMRHt90zZMrH35SX1AoahBBE0ERNAjKdmJsSxcAQ2sNpQh1g6thjMb8Nz/B3NfaMHLrp9Bw5BhMOu4A/OLMgwESrFzdievv+AtmPjoXS977FJmhg3DCxANx0nH1qN/nR6iqzmBgII+Ozh4wyG3ZJcSxrQ611nogX1QjNq8Nxu49/KYZd541lWacQ99l/Hc6YAMn8BUXHz71tzf8471CXLglCCuqilEhBmkFSKnlB4sGWx0axK5Sq6muBDHji1Vd+O+bn8Ct0/+GIw/eHUEQ4MFHX0JuXRe22HFL/HraKfjZMftih5GbQ0TQ2zeAjo4eKMUI3H4hv/xp7BYVbcDB5ptW9J340+3O//UlP52uDdgN+luNB76BBL/uEBGixlZGa6MWKezU1ZW/bcIZN9S/snAJBldnYxCrUidNkprBeRHkFisYtqESxzG6+wag4wj1o7fDyRPH48hD9sLwYbUoForoz+UBkWS2paTHYdu3pINABZWVVXj62dfnLH5v+XmXXtqwGGhQIq2Gyqbk247vREDiKetNXd/UFBClFzPRuObfPXhePpe/4vPV/ZvkcgUELDGzYSOGxfXtyJfTrl9vQLAvEgqGDMrg7t9NwVGHjgYxo78/h47OLihWdleo62u4KYDzqAmCMKisrAxyudyq7u7uayZO2O+2QiFOXpujf3ta/x8QUH6ICDuHiIgMP+eSu6e89f6yM7/8qmtYX38fGFqYWRMTEymCe4FJ/AoLDIw2SKcZrz71W2w8vBb9/XkEgUp2lNjnQNwGHCMiKpvNUhimkMvl1orIPT09PTdvsskm/7svTiYXEjBxYukFBBHZ+Oxf/fHk9z5cdvLqdX079+WM21RpwHY5SQBN9h8ghimVDvDCrGnYcouNUChE4jea2A6XUBiEnEqnEAQh4riIKIrfA2imMb0zq6o2Wu2eq5L3if8/jn87BDY8RIDW1kZtuaGRiWg1gD+IyI1X/37Wvgve/vjote19B3Z09+6QL5hMFMfuvR4bEto1U0G2ugyCgAKlEIQBMTPiOEahkM/l8/kPmaMXiejJp59+Zn5jY+klbQDm+xj/vRzgD88N4l6fJ6IYwDwA8yqzaTT/9sHtX1308agVq7/as7d3YMdiZEYYQ8MjY6pYF1MwBCNSLBYLfVqpNcU4Xg6hD4jkzTBML6yoqGgrf56IBAD09zXcH/8XNTw68+gVwaQAAAAASUVORK5CYII=';
    function _pollAvatarHtml(size) {
        var n = size || 40;
        return '<img src="' + _POLL_AVATAR_SRC + '" alt="" aria-hidden="true" '
            + 'style="width:' + n + 'px;height:' + n + 'px;border-radius:50%;flex-shrink:0;display:block;object-fit:cover;">';
    }

    /* ── social share sheet (2026-09-25) — "the share icon is broken" /
       "should open all social media for optional share": navigator.share()
       depends on the browser/WebView exposing a native share sheet at all,
       which the field screenshots show isn't reliable here. This widget now
       always offers an explicit picker instead of only trying (and silently
       failing on) the native one. Native share is still offered as the top
       option when the browser does support it. */
    var SOCIAL_DEFS = [
        { kind: 'whatsapp', label: 'WhatsApp', bg: '#25D366' },
        { kind: 'facebook', label: 'Facebook', bg: '#1877F2' },
        { kind: 'x', label: 'X', bg: '#000000' },
        { kind: 'telegram', label: 'Telegram', bg: '#229ED9' },
        { kind: 'linkedin', label: 'LinkedIn', bg: '#0A66C2' },
        { kind: 'email', label: 'Email', bg: '#64748b' }
    ];
    function _socialGlyph(kind) {
        if (kind === 'whatsapp') return _icon('whatsapp');
        if (kind === 'telegram') return _icon('telegram');
        if (kind === 'email') return _icon('mail');
        if (kind === 'facebook') return _letterGlyph('f');
        if (kind === 'x') return _letterGlyph('X');
        if (kind === 'linkedin') return _letterGlyph('in');
        return '';
    }
    function _shareTargets(url, text) {
        var enc = encodeURIComponent;
        return {
            whatsapp: 'https://wa.me/?text=' + enc(text + ' ' + url),
            facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + enc(url),
            x: 'https://twitter.com/intent/tweet?text=' + enc(text) + '&url=' + enc(url),
            telegram: 'https://t.me/share/url?url=' + enc(url) + '&text=' + enc(text),
            linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + enc(url),
            email: 'mailto:?subject=' + enc('Empyrean poll') + '&body=' + enc(text + '\n\n' + url)
        };
    }
    function _closeShareModal() {
        var ov = document.getElementById('emp-poll-share-ov');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    }
    function _openShareModal(pollId, data) {
        _closeShareModal();
        var base = (window.location && window.location.origin) ? window.location.origin : 'https://joinempyrean.com';
        var url = base + '/?poll=' + encodeURIComponent(pollId);
        var topicLabel = (data.topic || 'general').charAt(0).toUpperCase() + (data.topic || 'general').slice(1);
        var text = (data.type === 'collect' ? 'Empyrean Data Collection Form: ' : 'Empyrean poll: ') + topicLabel + '\n' + data.question;
        var targets = _shareTargets(url, text);
        var ov = document.createElement('div');
        ov.id = 'emp-poll-share-ov';
        ov.className = 'emp-poll-modal-ov';
        ov.innerHTML =
            '<div class="emp-poll-modal-sheet">'
            + '<div class="emp-poll-modal-grabber"></div>'
            + '<div class="emp-poll-modal-head"><div class="emp-poll-modal-title">Share this poll</div>'
            + '<button type="button" class="emp-poll-modal-x" aria-label="Close">' + _icon('dismiss') + '</button></div>'
            + (navigator.share ? '<button type="button" class="emp-poll-share-native-btn">' + _icon('share') + ' Share via device\u2026</button>' : '')
            + '<div class="emp-poll-social-grid">'
            + SOCIAL_DEFS.map(function (soc) {
                return '<div class="emp-poll-social-item"><button type="button" class="emp-poll-social-btn" data-social="' + soc.kind + '" '
                    + 'style="background:' + soc.bg + ';" aria-label="Share on ' + _esc(soc.label) + '">' + _socialGlyph(soc.kind) + '</button>'
                    + '<span class="emp-poll-social-label">' + _esc(soc.label) + '</span></div>';
            }).join('')
            + '<div class="emp-poll-social-item"><button type="button" class="emp-poll-social-btn emp-poll-social-copy" style="background:#1B2B8B;" aria-label="Copy link">'
            + _icon('link') + '</button><span class="emp-poll-social-label">Copy link</span></div>'
            + '</div></div>';
        document.body.appendChild(ov);
        ov.addEventListener('click', function (e) { if (e.target === ov) _closeShareModal(); });
        ov.querySelector('.emp-poll-modal-x').addEventListener('click', _closeShareModal);
        var nativeBtn = ov.querySelector('.emp-poll-share-native-btn');
        if (nativeBtn) {
            nativeBtn.addEventListener('click', function () {
                navigator.share({ title: 'Empyrean poll', text: text, url: url }).then(_closeShareModal).catch(function (err) {
                    if (err && err.name !== 'AbortError') _notify('Could not open the device share sheet.', 'error');
                });
            });
        }
        Array.prototype.forEach.call(ov.querySelectorAll('.emp-poll-social-btn[data-social]'), function (btn) {
            btn.addEventListener('click', function () {
                var target = targets[btn.getAttribute('data-social')];
                if (!target) return;
                if (target.indexOf('mailto:') === 0) { window.location.href = target; }
                else { window.open(target, '_blank', 'noopener,noreferrer,width=640,height=560'); }
                _closeShareModal();
            });
        });
        var copyBtn = ov.querySelector('.emp-poll-social-copy');
        if (copyBtn) copyBtn.addEventListener('click', function () { _copyShareUrl(url); _closeShareModal(); });
    }

    /* ── vote casting ─────────────────────────────────────────────────── */

    function _voteAuthenticated(pollId, optionId) {
        /* FIX (2026-09-27 — "when a user clicks vote it doesn't respond at
           all"): this keyed voters/{uid} by window.userState.id (this app's
           own persistent id) instead of the live Firebase Auth uid on
           request.auth. Those are two different id spaces — the exact same
           mismatch app-live.js's own _startViewerPresence() header already
           documents having to fix, one at a time, "throughout firebase-
           rules.js for messages/chats/groups/broadcastLists/etc." Any
           firebase-rules.js check of the shape `request.auth.uid == uid` on
           this subcollection would permission-deny every authenticated
           vote's tx.set() below — the transaction rejects, _castVote's
           .catch fires, and (before the companion fix in _paintPoll's click
           handler) the tapped option was left permanently greyed-out with
           no snapshot ever arriving to repaint it back to clickable. Keying
           by the Firebase Auth uid instead is what every other collection
           in this app already had to do for the same reason. */
        var uid = _myUid();
        if (!uid) return Promise.reject(new Error('not-signed-in'));
        var pollRef = window.fbDb.collection('polls').doc(pollId);
        var voterRef = pollRef.collection('voters').doc(uid);
        return window.fbDb.runTransaction(function (tx) {
            return tx.get(voterRef).then(function (voterSnap) {
                if (voterSnap.exists) { var e = new Error('already-voted'); throw e; }
                return tx.get(pollRef).then(function (pollSnap) {
                    if (!pollSnap.exists) throw new Error('poll-not-found');
                    var data = pollSnap.data();
                    if (data.status !== 'open') throw new Error('poll-closed');
                    var options = (data.options || []).map(function (o) {
                        return o.id === optionId ? Object.assign({}, o, { votes: (o.votes || 0) + 1 }) : o;
                    });
                    if (!options.some(function (o) { return o.id === optionId; })) throw new Error('bad-option');
                    tx.update(pollRef, { options: options, totalVotes: (data.totalVotes || 0) + 1 });
                    tx.set(voterRef, {
                        optionId: optionId,
                        votedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        method: 'auth'
                    });
                });
            });
        });
    }

    function _voteGuest(pollId, optionId) {
        return fetch(window._empApiBase() + '/api/polls/' + pollId + '/vote-guest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ optionId: optionId })
        }).then(function (r) {
            return r.json().then(function (data) {
                if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
                return data;
            });
        });
    }

    function _castVote(pollId, optionId, onDone) {
        var uid = _myId();
        var p = uid ? _voteAuthenticated(pollId, optionId) : _voteGuest(pollId, optionId);
        p.then(function () {
            _notify('Vote counted — thanks!', 'success');
            if (onDone) onDone(null);
        }).catch(function (err) {
            var msg = (err && err.message) || 'Unknown error';
            if (/already.?voted/i.test(msg)) _notify('You\u2019ve already voted on this poll.', 'info');
            else if (/closed/i.test(msg)) _notify('This poll is closed.', 'info');
            else _notify('Could not record your vote: ' + msg, 'error');
            if (onDone) onDone(err);
        });
    }

    /* ── data collection responses (2026-09-26) — mirrors _voteAuthenticated/
       _voteGuest/_castVote's transaction shape exactly: a responses/{uid}
       doc (one per member, same as voters/{uid}) guards against a double
       submit, and totalResponses on the poll doc is incremented in the same
       transaction so it can never drift from the responses subcollection's
       real count. Guests (2026-09-26 — wired up to match voting) go through
       server.js's POST /api/polls/:id/respond-guest the same way a guest
       vote goes through vote-guest: the client can't be trusted to prove
       "I haven't responded yet" for itself, so the server enforces
       one-response-per-IP-per-poll there instead. */
    /* FEATURE (2026-09-27 — server-side enforcement): these three used to
       write straight to Firestore from the browser (a client transaction
       for submit, .update()/.delete() for edit/withdraw). The matching
       Firestore rules for polls/{id}/responses/{uid} now deny ALL direct
       client create/update/delete (see firebase-rules.js) — every write
       goes through server.js's /api/polls/:id/respond routes instead,
       which run the same per-question-type answer validation
       (_validateCollectAnswers) the guest path already needed, now for
       signed-in respondents too. _pollAuthedRequest mirrors
       _submitAnswersGuest's fetch-and-parse shape exactly, just with a
       Bearer ID token instead of relying on IP identification, and reuses
       its "already responded"/"closed" error-message substrings so
       _submitResponse's existing regex-based notifications below don't
       need to change. */
    function _pollAuthedRequest(method, pollId, body) {
        var user = window.fbAuth && window.fbAuth.currentUser;
        if (!user) return Promise.reject(new Error('not-signed-in'));
        return user.getIdToken().then(function (idToken) {
            return fetch(window._empApiBase() + '/api/polls/' + pollId + '/respond', {
                method: method,
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                body: body ? JSON.stringify(body) : undefined
            });
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (data) {
                if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
                return data;
            });
        });
    }

    function _submitAnswersAuthenticated(pollId, answers) {
        return _pollAuthedRequest('POST', pollId, { answers: answers });
    }

    function _submitAnswersGuest(pollId, answers) {
        return fetch(window._empApiBase() + '/api/polls/' + pollId + '/respond-guest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers: answers })
        }).then(function (r) {
            return r.json().then(function (data) {
                if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
                return data;
            });
        });
    }

    function _submitResponse(pollId, answers, onDone) {
        var uid = _myId();
        var p = uid ? _submitAnswersAuthenticated(pollId, answers) : _submitAnswersGuest(pollId, answers);
        p.then(function () {
            _notify('Response submitted — thanks!', 'success');
            if (onDone) onDone(null);
        }).catch(function (err) {
            var msg = (err && err.message) || 'Unknown error';
            if (/already.?responded/i.test(msg)) _notify('You\u2019ve already responded to this poll.', 'info');
            else if (/closed/i.test(msg)) _notify('This poll is closed.', 'info');
            else _notify('Could not submit your response: ' + msg, 'error');
            if (onDone) onDone(err);
        });
    }

    /* FEATURE (2026-09-27 — response edit/withdraw window, restricted to
       signed-in non-guest participants): both now go through the same
       server-authoritative /api/polls/:id/respond route as submit above
       (PATCH to edit, DELETE to withdraw) rather than a direct client
       .update()/.delete() — see _pollAuthedRequest's comment. Both are
       authenticated-only — a guest response is identified only by IP
       server-side, so there's no safe uid to key an edit/withdraw off of
       for them. */
    function _updateAnswersAuthenticated(pollId, answers) {
        return _pollAuthedRequest('PATCH', pollId, { answers: answers });
    }

    function _withdrawAnswersAuthenticated(pollId) {
        return _pollAuthedRequest('DELETE', pollId, null);
    }

    function _updateResponse(pollId, answers, onDone) {
        _updateAnswersAuthenticated(pollId, answers).then(function () {
            _notify('Response updated.', 'success');
            if (onDone) onDone(null);
        }).catch(function (err) {
            _notify('Could not update your response: ' + ((err && err.message) || ''), 'error');
            if (onDone) onDone(err);
        });
    }

    function _withdrawResponse(pollId, onDone) {
        _withdrawAnswersAuthenticated(pollId).then(function () {
            _notify('Response withdrawn.', 'success');
            if (onDone) onDone(null);
        }).catch(function (err) {
            _notify('Could not withdraw your response: ' + ((err && err.message) || ''), 'error');
            if (onDone) onDone(err);
        });
    }

    /* ── single poll card ─────────────────────────────────────────────── */

    var _pollWidgets = {}; // pollId -> { unsub, votedOptionId, viewerPresenceRef, viewerHeartbeatTimer, viewerCountUnsub, ... }

    /* ── live viewer count (2026-09-27) ──────────────────────────────────
       Mirrors app-live.js's own active_streams/{id}/viewers/{uid} presence
       pattern (see that file's _startViewerPresence/_startViewerCountListener):
       every open card writes a small heartbeat-backed presence doc to
       polls/{id}/viewers/{authUid}, and the same subcollection is watched
       by everyone with that poll open, so the count is one shared fact
       instead of a per-device guess. A doc only counts as "live" if its
       heartbeat is under POLL_VIEWER_LIVE_WINDOW_MS old, so a tab closed
       without a clean exit can't inflate the count forever. Guests can
       still SEE the count (read is public, same as the vote tallies) —
       they just don't add themselves to it, since writing requires an
       authenticated uid, same trade-off _voteGuest already accepts by
       routing guest votes through the server instead of a direct write. */
    var POLL_VIEWER_HEARTBEAT_MS = 20000;
    var POLL_VIEWER_LIVE_WINDOW_MS = 45000;

    function _startPollViewerPresence(pollId, state) {
        var db = window.fbDb;
        if (!_fbOk() || !pollId) return;
        var authUid = _myUid();
        if (!authUid) return; // no live Firebase Auth session yet — nothing to write under
        var us = window.userState || {};
        var ref = db.collection('polls').doc(pollId).collection('viewers').doc(authUid);
        state.viewerPresenceRef = ref;
        function writePresence() {
            ref.set({
                userId: (us && us.id) || authUid,
                fullName: (us && (us.fullName || us.username)) || 'Viewer',
                lastSeen: new Date().toISOString()
            }, { merge: true }).catch(function () {});
        }
        writePresence();
        state.viewerHeartbeatTimer = setInterval(writePresence, POLL_VIEWER_HEARTBEAT_MS);
    }

    function _stopPollViewerPresence(state) {
        if (!state) return;
        if (state.viewerHeartbeatTimer) { clearInterval(state.viewerHeartbeatTimer); state.viewerHeartbeatTimer = null; }
        if (state.viewerPresenceRef) { var r = state.viewerPresenceRef; state.viewerPresenceRef = null; r.delete().catch(function () {}); }
    }

    function _startPollViewerCountListener(pollId, state) {
        if (!_fbOk() || !pollId) return;
        state.viewerCountUnsub = window.fbDb.collection('polls').doc(pollId).collection('viewers')
            .onSnapshot(function (snap) {
                var now = Date.now();
                var live = 0;
                snap.forEach(function (doc) {
                    var d = doc.data() || {};
                    var seen = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
                    if (now - seen < POLL_VIEWER_LIVE_WINDOW_MS) live++;
                });
                var count = Math.max(1, live);
                var el = document.getElementById('emp-poll-viewers-' + pollId);
                if (el) el.textContent = count.toLocaleString() + ' watching';
            }, function () { /* offline/permission — leave last-known count on screen */ });
    }

    function _stopPollViewerCountListener(state) {
        if (state && typeof state.viewerCountUnsub === 'function') { try { state.viewerCountUnsub(); } catch (e) {} state.viewerCountUnsub = null; }
    }

    /* ── mini statistical-graphic bar (2026-09-25) ────────────────────────
       A single segmented bar giving an at-a-glance read of the whole
       result set, on top of the existing per-option progress bars. Purely
       a rendering helper — reads the same options/colors _paintPoll
       already computes, no extra Firestore reads. */
    function _statBarHtml(options, total) {
        if (!total) {
            return '<div class="emp-poll-statbar"><div class="emp-poll-statbar-seg" style="width:100%;background:rgba(10,14,39,0.12);"></div></div>';
        }
        var segs = options.map(function (opt, i) {
            var pct = _pct(opt.votes || 0, total);
            var color = BAR_COLORS[i % BAR_COLORS.length];
            return '<div class="emp-poll-statbar-seg" style="width:' + pct + '%;background:' + color + ';" title="' + _esc(opt.text) + ': ' + pct + '%"></div>';
        }).join('');
        return '<div class="emp-poll-statbar">' + segs + '</div>';
    }

    function _isTrending(data, total) {
        return data.status === 'open' && total >= 10;
    }

    /* ── voting-statistics bar+pie chart (2026-09-25) — Chart.js is already
       loaded site-wide for the Grant Transparency Portal, so this reuses the
       same window.Chart instead of pulling in a second charting lib. Built
       lazily (only when the "Chart" button is opened) and torn down on
       close/repaint/unmount so canvases and Chart instances never leak
       across a poll's frequent vote-triggered repaints. Colors match the
       per-option progress bars above (BAR_COLORS) so the two views read as
       one consistent color key. */
    function _destroyCharts(state) {
        if (state.barChart) { try { state.barChart.destroy(); } catch (e) {} state.barChart = null; }
        if (state.pieChart) { try { state.pieChart.destroy(); } catch (e) {} state.pieChart = null; }
    }

    function _renderCharts(el, data, state) {
        if (typeof window.Chart !== 'function') { _notify('Charts are unavailable right now.', 'warning'); return; }
        _destroyCharts(state);
        var options = data.options || [];
        var labels = options.map(function (o) { return o.text; });
        var votes = options.map(function (o) { return o.votes || 0; });
        var colors = options.map(function (o, i) { return BAR_COLORS[i % BAR_COLORS.length]; });
        var barCanvas = el.querySelector('.emp-poll-chart-bar-canvas');
        var pieCanvas = el.querySelector('.emp-poll-chart-pie-canvas');
        if (!barCanvas || !pieCanvas) return;
        state.barChart = new window.Chart(barCanvas, {
            type: 'bar',
            data: { labels: labels, datasets: [{ label: 'Votes', data: votes, backgroundColor: colors, borderRadius: 6, maxBarThickness: 46 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Votes by option', font: { size: 11 } }
                },
                scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
            }
        });
        state.pieChart = new window.Chart(pieCanvas, {
            type: 'pie',
            data: { labels: labels, datasets: [{ data: votes, backgroundColor: colors }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
                    title: { display: true, text: 'Vote share', font: { size: 11 } }
                }
            }
        });
    }

    function _setChartOpen(el, pollId, data, state, open) {
        state.chartOpen = open;
        var wrap = el.querySelector('.emp-poll-chart-wrap');
        if (!wrap) return;
        if (!open) { wrap.style.display = 'none'; _destroyCharts(state); return; }
        wrap.style.display = 'grid';
        _renderCharts(el, data, state);
    }

    /* ── CSV export (2026-09-25) — "users should be able to export data for
       research usage": open to every viewer (not just the poll's
       owner/admin), since the point is letting anyone doing research pull
       the vote breakdown, not gating it. Generated client-side as a Blob so
       there's no server round trip. */
    function _slugify(str) {
        return String(str || 'poll').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '').slice(0, 60) || 'poll';
    }
    function _csvCell(v) {
        var s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    /* Shared with the create/edit modals' <select> and the on-card details
       panel (see _collectMetaHtml usage in _paintPoll) so "Other" always
       resolves to whatever the creator actually typed, everywhere. */
    function _purposeLabel(data) {
        if (!data.purpose) return '';
        var LABELS = { research: 'Research', survey: 'Survey', documentation: 'Documentation', project: 'Project', other: data.purposeOther || 'Other' };
        return LABELS[data.purpose] || data.purpose;
    }

    function _downloadBlob(blob, filename) {
        var blobUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1000);
    }

    /* ── Data-collection export (2026-09-27 — "more robust and advanced for
       professional, institutions, organizations"): a choice poll's export
       above just re-serializes the vote tallies already on `data`, but a
       data-collection poll's actual payload — every respondent's answers —
       lives in the polls/{id}/responses subcollection, which the CSV/PDF
       buttons never read before this. Exporting a "collect" poll used to
       silently produce a file with only the poll's own metadata and no
       responses at all. This fetches the real answers and, when the
       creator marked the poll anonymous, deliberately leaves the
       respondent-name column out rather than exporting it. */
    /* Turns a raw stored answer back into readable text for export: a
       short/paragraph answer is already text; a single_choice answer is a
       choice id needing its label looked up; a multi_choice answer is an
       array of choice ids, joined as "A; B". Falls back to the raw value
       for anything unrecognized so old collect polls (all short/paragraph)
       export exactly as before. signature/file_upload answers are a
       permanent URL — that's exactly what a CSV cell should hold (a
       reviewer can click straight through in Excel/Sheets), but the PDF
       export renders those two types itself (embedded image / clickable
       link — see _exportCollectPdf) rather than calling this, since a raw
       URL as a line of PDF body text isn't something a bank or university
       reviewer can act on the way a spreadsheet cell is. */
    function _answerDisplay(q, raw) {
        if (q.answerType === 'single_choice') {
            var m = (q.choices || []).filter(function (c) { return c.id === raw; })[0];
            return m ? m.text : (raw || '');
        }
        if (q.answerType === 'multi_choice') {
            var ids = Array.isArray(raw) ? raw : [];
            return ids.map(function (id) {
                var m = (q.choices || []).filter(function (c) { return c.id === id; })[0];
                return m ? m.text : id;
            }).join('; ');
        }
        return raw || '';
    }

    /* Fetches a stored signature/file URL and resolves it to a base64 data
       URI so jsPDF can embed it with doc.addImage — a PDF page can't pull
       a remote image in the way an <img> tag does, the bytes have to
       actually be inside the document. Resolves null (never rejects) on
       any failure — offline, the asset having been removed, a CORS
       hiccup — so one bad signature can't abort the whole export; the
       caller falls back to a clickable link instead. */
    function _dataUriFromUrl(url) {
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error('fetch failed: ' + r.status);
            return r.blob();
        }).then(function (blob) {
            return new Promise(function (resolve, reject) {
                var reader = new FileReader();
                reader.onload = function () { resolve(reader.result); };
                reader.onerror = function () { reject(new Error('could not read image')); };
                reader.readAsDataURL(blob);
            });
        }).catch(function () { return null; });
    }

    function _exportCollectCsv(pollId, data) {
        var questions = data.questions || [];
        window.fbDb.collection('polls').doc(pollId).collection('responses').orderBy('submittedAt', 'asc').get()
            .then(function (snap) {
                var metaRows = [
                    ['Question', data.question],
                    ['Topic', data.topic || 'general'],
                    ['Status', data.status || ''],
                    ['Collected by', data.collectorName || ''],
                    ['Purpose', _purposeLabel(data)],
                    ['Collection closes', data.deadline || ''],
                    ['Target responses', data.targetResponses || ''],
                    ['Contact', data.contactEmail || ''],
                    ['Anonymous responses', data.anonymous ? 'Yes' : 'No'],
                    ['Total responses', snap.size],
                    ['Asked by', data.createdByName || ''],
                    []
                ];
                var header = (data.anonymous ? [] : ['Respondent']).concat(['Submitted']).concat(questions.map(function (q) { return q.text; }));
                var rows = [header];
                snap.forEach(function (doc) {
                    var d = doc.data();
                    var submitted = (d.submittedAt && typeof d.submittedAt.toDate === 'function') ? d.submittedAt.toDate().toLocaleString() : '';
                    var row = data.anonymous ? [] : [d.respondentName || 'Member'];
                    row.push(submitted);
                    questions.forEach(function (q) { row.push(_answerDisplay(q, d.answers && d.answers[q.id])); });
                    rows.push(row);
                });
                var csv = metaRows.concat(rows).map(function (r) { return r.map(_csvCell).join(','); }).join('\r\n');
                _downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), _slugify(data.question) + '-responses.csv');
                _notify('Responses exported.', 'success');
            })
            .catch(function (err) { _notify('Could not export responses: ' + ((err && err.message) || 'try again.'), 'error'); });
    }

    /* FEATURE (2026-09-27 — signature capture + file/ID upload, finishing
       the PDF side): a signature/file_upload answer is stored as a
       permanent URL (see the submit handler in _paintPoll), and until now
       the PDF export just ran it through the same text path as every
       other answer type, so an exported form showed a raw, often-wrapped
       Cloudinary/Storage link where an institutional reviewer needs to
       actually SEE the signature. Every signature URL across every
       response is fetched once up front (deduped, so ten respondents who
       reused the same browser tab don't trigger ten fetches for the same
       asset) and embedded as a real image at the canvas's own 400:140
       aspect ratio. A file_upload answer could be an ID scan, a
       transcript PDF, anything a respondent picked — there's no safe way
       to thumbnail an arbitrary file type inline, so it renders as a
       clickable "View uploaded file" link instead. Either one degrades to
       a plain link line if the fetch fails, so a removed asset or a CORS
       hiccup can't break the export. */
    function _exportCollectPdf(pollId, data) {
        var JsPDFCtor = window.jspdf && window.jspdf.jsPDF;
        if (typeof JsPDFCtor !== 'function') { _notify('PDF export isn\u2019t available right now — try again in a moment.', 'warning'); return; }
        var questions = data.questions || [];
        var hasSignatureQ = questions.some(function (q) { return q.answerType === 'signature'; });
        if (hasSignatureQ) _notify('Preparing export — fetching signatures\u2026', 'info');
        window.fbDb.collection('polls').doc(pollId).collection('responses').orderBy('submittedAt', 'asc').get()
            .then(function (snap) {
                var sigUrls = [];
                snap.forEach(function (respDoc) {
                    var d = respDoc.data();
                    questions.forEach(function (q) {
                        if (q.answerType !== 'signature') return;
                        var v = d.answers && d.answers[q.id];
                        if (v && sigUrls.indexOf(v) === -1) sigUrls.push(v);
                    });
                });
                var sigDataUris = {};
                return Promise.all(sigUrls.map(function (u) {
                    return _dataUriFromUrl(u).then(function (uri) { sigDataUris[u] = uri; });
                })).then(function () { return { snap: snap, sigDataUris: sigDataUris }; });
            })
            .then(function (ready) {
                var snap = ready.snap, sigDataUris = ready.sigDataUris;
                var doc = new JsPDFCtor({ unit: 'pt', format: 'a4' });
                var pageWidth = doc.internal.pageSize.getWidth();
                var pageHeight = doc.internal.pageSize.getHeight();
                var margin = 48;
                var y = margin;
                function ensureRoom(need) { if (y + need > pageHeight - margin) { doc.addPage(); y = margin; } }

                doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(10, 14, 39);
                var qLines = doc.splitTextToSize(data.question || 'Data collection', pageWidth - margin * 2);
                doc.text(qLines, margin, y);
                y += qLines.length * 20 + 4;

                doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120);
                var metaLines = [
                    (data.topic || 'general') + ' \u2022 ' + (data.status || '') + ' \u2022 ' + snap.size + ' response' + (snap.size === 1 ? '' : 's'),
                    data.collectorName ? 'Collected by: ' + data.collectorName : '',
                    _purposeLabel(data) ? 'Purpose: ' + _purposeLabel(data) : '',
                    data.deadline ? 'Collection closes: ' + data.deadline : '',
                    data.contactEmail ? 'Contact: ' + data.contactEmail : '',
                    data.anonymous ? 'Responses collected anonymously' : ''
                ].filter(Boolean);
                metaLines.forEach(function (line) { doc.text(line, margin, y); y += 13; });
                y += 10;

                if (!snap.size) {
                    doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(120);
                    doc.text('No responses collected yet.', margin, y);
                }
                snap.forEach(function (respDoc, i) {
                    var d = respDoc.data();
                    var submitted = (d.submittedAt && typeof d.submittedAt.toDate === 'function') ? d.submittedAt.toDate().toLocaleString() : '';
                    ensureRoom(30);
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(27, 43, 139);
                    var label = (data.anonymous ? ('Respondent ' + (i + 1)) : (d.respondentName || 'Member')) + (submitted ? '  \u2022  ' + submitted : '');
                    doc.text(label, margin, y);
                    y += 16;
                    questions.forEach(function (q) {
                        var raw = d.answers && d.answers[q.id];

                        if (q.answerType === 'signature') {
                            ensureRoom(16);
                            doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(40);
                            doc.text(q.text + ':', margin + 10, y);
                            y += 12;
                            if (!raw) {
                                doc.setTextColor(140);
                                doc.text('— no signature provided', margin + 10, y);
                                doc.setTextColor(40);
                                y += 16;
                            } else if (sigDataUris[raw]) {
                                var boxW = 140, boxH = boxW * (140 / 400); // matches the drawing canvas's own 400x140 aspect
                                ensureRoom(boxH + 8);
                                try {
                                    doc.addImage(sigDataUris[raw], 'PNG', margin + 10, y, boxW, boxH);
                                } catch (e) {
                                    doc.setTextColor(140);
                                    doc.text('(signature image could not be embedded)', margin + 10, y + 10);
                                    doc.setTextColor(40);
                                }
                                y += boxH + 10;
                            } else {
                                ensureRoom(16);
                                doc.setTextColor(27, 43, 139);
                                doc.textWithLink('View signature online', margin + 10, y, { url: raw });
                                doc.setTextColor(40);
                                y += 16;
                            }
                            return;
                        }

                        if (q.answerType === 'file_upload') {
                            ensureRoom(28);
                            doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(40);
                            doc.text(q.text + ':', margin + 10, y);
                            y += 12;
                            if (!raw) {
                                doc.setTextColor(140);
                                doc.text('— no file provided', margin + 10, y);
                                doc.setTextColor(40);
                            } else {
                                doc.setTextColor(27, 43, 139);
                                doc.textWithLink('\ud83d\udcce View uploaded file', margin + 10, y, { url: raw });
                                doc.setTextColor(40);
                            }
                            y += 16;
                            return;
                        }

                        var ans = _answerDisplay(q, raw) || '—';
                        var lines = doc.splitTextToSize(q.text + ': ' + ans, pageWidth - margin * 2 - 10);
                        ensureRoom(lines.length * 13 + 4);
                        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(40);
                        doc.text(lines, margin + 10, y);
                        y += lines.length * 13 + 4;
                    });
                    y += 8;
                });

                doc.setFontSize(8); doc.setTextColor(160);
                doc.text('Exported from Empyrean \u2022 ' + new Date().toLocaleString(), margin, pageHeight - 24);
                doc.save(_slugify(data.question) + '-responses.pdf');
                _notify('Responses exported.', 'success');
            })
            .catch(function (err) { _notify('Could not export responses: ' + ((err && err.message) || 'try again.'), 'error'); });
    }

    function _exportPollCsv(pollId, data) {
        if (data.type === 'collect') { _exportCollectCsv(pollId, data); return; }
        var options = data.options || [];
        var total = data.totalVotes || 0;
        var rows = [
            ['Question', data.question],
            ['Topic', data.topic || 'general'],
            ['Status', data.status || ''],
            ['Total votes', total],
            ['Asked by', data.createdByName || ''],
            [],
            ['Option', 'Votes', 'Percentage']
        ];
        options.forEach(function (o) { rows.push([o.text, o.votes || 0, _pct(o.votes || 0, total) + '%']); });
        var csv = rows.map(function (r) { return r.map(_csvCell).join(','); }).join('\r\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var blobUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = blobUrl;
        a.download = _slugify(data.question) + '-results.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1000);
        _notify('Poll results exported.', 'success');
    }

    /* ── PDF export (2026-09-25) — PRD: "structured format (e.g., CSV,
       PDF)". Uses jsPDF (loaded via CDN in index.html, same offline-safe
       pattern as Chart.js elsewhere in the app) so this is a direct file
       download like the CSV export next to it, not window.print() and a
       system dialog. Draws from the exact same fields/order as
       _exportPollCsv so the two exports can't drift apart, plus a simple
       per-option bar matching the on-screen progress bars (same
       BAR_COLORS, same _pct). */
    function _hexToRgb(hex) {
        var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
        return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [51, 57, 90];
    }
    function _exportPollPdf(pollId, data) {
        if (data.type === 'collect') { _exportCollectPdf(pollId, data); return; }
        var JsPDFCtor = window.jspdf && window.jspdf.jsPDF;
        if (typeof JsPDFCtor !== 'function') { _notify('PDF export isn\u2019t available right now — try again in a moment.', 'warning'); return; }

        var options = data.options || [];
        var total = data.totalVotes || 0;
        var doc = new JsPDFCtor({ unit: 'pt', format: 'a4' });
        var pageWidth = doc.internal.pageSize.getWidth();
        var margin = 48;
        var y = margin;

        doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(10, 14, 39);
        var qLines = doc.splitTextToSize(data.question || 'Poll', pageWidth - margin * 2);
        doc.text(qLines, margin, y);
        y += qLines.length * 20 + 4;

        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120);
        var metaLine = (data.topic || 'general') + ' \u2022 ' + (data.status || '') + ' \u2022 ' + total + ' vote' + (total === 1 ? '' : 's')
            + (data.createdByName ? ' \u2022 asked by ' + data.createdByName : '');
        doc.text(metaLine, margin, y);
        y += 28;

        var barWidth = pageWidth - margin * 2;
        options.forEach(function (opt, i) {
            var pct = _pct(opt.votes || 0, total);
            var rgb = _hexToRgb(BAR_COLORS[i % BAR_COLORS.length]);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20);
            doc.text(String(opt.text || ''), margin, y);
            doc.setFont('helvetica', 'normal');
            doc.text(pct + '% (' + (opt.votes || 0) + ')', pageWidth - margin, y, { align: 'right' });
            y += 8;
            doc.setFillColor(230, 230, 230);
            doc.rect(margin, y, barWidth, 8, 'F');
            doc.setFillColor(rgb[0], rgb[1], rgb[2]);
            doc.rect(margin, y, barWidth * (pct / 100), 8, 'F');
            y += 26;
        });

        doc.setFontSize(8); doc.setTextColor(160);
        doc.text('Exported from Empyrean \u2022 ' + new Date().toLocaleString(), margin, doc.internal.pageSize.getHeight() - 24);

        doc.save(_slugify(data.question) + '-results.pdf');
        _notify('Poll results exported.', 'success');
    }

    /* ── owner/admin gate (2026-09-25) — "allow only owner or admin to close
       and delete poll": the buttons were already hidden from anyone else,
       but hidden isn't the same as guarded — a stale render or an in-flight
       state.votedOptionId=... optimistic bug elsewhere could theoretically
       leave a handler wired against outdated data. Every close/edit/delete
       handler now re-checks this at the moment of the click, against the
       live snapshot data closed over by _paintPoll, not just at render
       time. (True enforcement still has to live in Firestore security
       rules — this is defense-in-depth on the client, not a replacement
       for the polls/{id} update/delete rule.) */
    function _canManagePoll(data) {
        return !!((data.createdByUid && data.createdByUid === _myUid()) || _isAdminUser());
    }

    /* ── edit / delete / share (2026-09-25) — creator or admin only for
       edit/delete; matching Firestore rules for polls update/delete need
       to allow this the same way they already allow the existing
       status:'closed' update from the Close-poll button above. */
    /* FEATURE (2026-09-27 — question types, required toggle, choice-based
       questions): each data-collection question row now supports four
       answer types (short answer, paragraph, single choice, checkboxes),
       an optional "required" toggle, and — for the two choice types — its
       own small expandable list of choice rows (add/remove, same pattern
       as the poll option-row builder). Shared between the create and edit
       modals so both build/read identical rows instead of two copies. */
    function _buildQuestionRow(qWrap, q, inputCss) {
        var row = document.createElement('div');
        row.className = 'emp-poll-question-row';
        row.style.cssText = 'border:1px solid rgba(10,14,39,0.12);border-radius:10px;padding:8px;margin-bottom:2px;';

        var topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;gap:6px;align-items:center;';
        var qi = document.createElement('input');
        qi.type = 'text'; qi.maxLength = 200; qi.className = 'emp-poll-question-input';
        qi.placeholder = 'Question text';
        qi.style.cssText = inputCss + 'flex:2;';
        qi.value = q ? q.text : '';
        if (q && q.id) qi.setAttribute('data-question-id', q.id);
        var sel = document.createElement('select');
        sel.className = 'emp-poll-question-answertype';
        sel.style.cssText = inputCss + 'flex:1;';
        sel.innerHTML = '<option value="short">Short answer</option><option value="paragraph">Paragraph</option>'
            + '<option value="single_choice">Single choice</option><option value="multi_choice">Checkboxes</option>'
            + '<option value="signature">Signature</option><option value="file_upload">File upload (ID, transcript, etc.)</option>';
        sel.value = (q && q.answerType) ? q.answerType : 'short';
        var rm = document.createElement('button');
        rm.type = 'button'; rm.textContent = '\u2715';
        rm.style.cssText = 'border:none;background:rgba(229,57,53,0.1);color:#c62828;width:34px;height:34px;border-radius:8px;flex-shrink:0;cursor:pointer;';
        rm.addEventListener('click', function () { row.remove(); });
        topRow.appendChild(qi); topRow.appendChild(sel); topRow.appendChild(rm);
        row.appendChild(topRow);

        var reqLabel = document.createElement('label');
        reqLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:0.75rem;color:#33395a;margin-top:6px;cursor:pointer;';
        var reqCb = document.createElement('input');
        reqCb.type = 'checkbox'; reqCb.className = 'emp-poll-question-required';
        reqCb.checked = !q || q.required !== false;
        reqLabel.appendChild(reqCb);
        reqLabel.appendChild(document.createTextNode('Required'));
        row.appendChild(reqLabel);

        var choicesWrap = document.createElement('div');
        choicesWrap.className = 'emp-poll-question-choices';
        choicesWrap.style.cssText = 'margin-top:6px;display:flex;flex-direction:column;gap:5px;';
        row.appendChild(choicesWrap);
        var addChoiceBtn = document.createElement('button');
        addChoiceBtn.type = 'button';
        addChoiceBtn.textContent = '+ Add choice';
        addChoiceBtn.style.cssText = 'border:none;background:rgba(10,14,39,0.06);color:#0a0e27;padding:6px 12px;border-radius:8px;font-weight:700;font-size:0.74rem;cursor:pointer;margin-top:2px;align-self:flex-start;';
        row.appendChild(addChoiceBtn);

        function addChoiceRow(choice) {
            var crow = document.createElement('div');
            crow.style.cssText = 'display:flex;gap:5px;align-items:center;';
            var ci = document.createElement('input');
            ci.type = 'text'; ci.maxLength = 100; ci.className = 'emp-poll-question-choice-input';
            ci.placeholder = 'Choice';
            ci.style.cssText = inputCss + 'padding:8px 10px;font-size:0.82rem;';
            ci.value = choice ? choice.text : '';
            if (choice && choice.id) ci.setAttribute('data-choice-id', choice.id);
            var crm = document.createElement('button');
            crm.type = 'button'; crm.textContent = '\u2715';
            crm.style.cssText = 'border:none;background:rgba(229,57,53,0.1);color:#c62828;width:28px;height:28px;border-radius:7px;flex-shrink:0;cursor:pointer;font-size:0.75rem;';
            crm.addEventListener('click', function () { crow.remove(); });
            crow.appendChild(ci); crow.appendChild(crm);
            choicesWrap.appendChild(crow);
        }
        addChoiceBtn.addEventListener('click', function () {
            // FIX (2026-09-27 — "increase the multi choice ... to
            // unlimited"): was capped at 12; see addOpt's comment in the
            // create-modal further down for why 50 (not a literal
            // unlimited) is the actual new ceiling.
            if (choicesWrap.children.length >= 50) return;
            addChoiceRow(null);
        });
        if (q && q.choices && q.choices.length) { q.choices.forEach(addChoiceRow); }
        else { addChoiceRow(null); addChoiceRow(null); }

        function syncChoiceVisibility() {
            var isChoice = sel.value === 'single_choice' || sel.value === 'multi_choice';
            choicesWrap.style.display = isChoice ? 'flex' : 'none';
            addChoiceBtn.style.display = isChoice ? 'inline-block' : 'none';
        }
        sel.addEventListener('change', syncChoiceVisibility);
        syncChoiceVisibility();

        qWrap.appendChild(row);
        return row;
    }

    /* Reads one _buildQuestionRow row back into {id, text, answerType,
       required, choices?}. Returns null for a row whose question text was
       left blank (dropped silently, same as before). `index`/`stamp` only
       mint a fresh id for a brand-new question that has none yet. */
    function _readQuestionRow(row, index, stamp) {
        var qi = row.querySelector('.emp-poll-question-input');
        var text = (qi.value || '').trim();
        if (!text) return null;
        var answerType = row.querySelector('.emp-poll-question-answertype').value;
        if (['short', 'paragraph', 'single_choice', 'multi_choice', 'signature', 'file_upload'].indexOf(answerType) === -1) answerType = 'short';
        var required = row.querySelector('.emp-poll-question-required').checked;
        var existingId = qi.getAttribute('data-question-id');
        var q = { id: existingId || ('q_' + index + '_' + stamp), text: text, answerType: answerType, required: required };
        if (answerType === 'single_choice' || answerType === 'multi_choice') {
            var choices = [];
            Array.prototype.forEach.call(row.querySelectorAll('.emp-poll-question-choice-input'), function (ci, ci_i) {
                var ct = (ci.value || '').trim();
                if (!ct) return;
                var existingCid = ci.getAttribute('data-choice-id');
                choices.push({ id: existingCid || ('c_' + ci_i + '_' + stamp + '_' + index), text: ct });
            });
            q.choices = choices;
        }
        return q;
    }

    function _openEditModal(pollId, data) {
        _closeCreateModal();
        var isCollectEdit = data.type === 'collect';
        var ov = document.createElement('div');
        ov.id = 'emp-poll-create-ov';
        ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(10,14,39,0.55);display:flex;align-items:flex-end;justify-content:center;';
        var inputCss = 'width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid rgba(10,14,39,0.18);font-size:0.9rem;background:#fff;color:#0a0e27;';
        ov.innerHTML =
            '<div style="background:#fff;color:#0a0e27;width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:20px 18px 24px;max-height:92vh;overflow:auto;box-sizing:border-box;">'
            + '<div class="emp-poll-modal-grabber"></div>'
            + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
            + '<div style="font-weight:800;font-size:1.05rem;">Edit poll</div>'
            + '<button type="button" id="emp-poll-cancel-x" style="border:none;background:transparent;font-size:1.3rem;cursor:pointer;color:#0a0e27;" aria-label="Close">\u2715</button></div>'
            + '<input type="text" id="emp-poll-q" maxlength="200" value="' + _esc(data.question) + '" style="' + inputCss + 'margin-bottom:10px;">'
            + '<select id="emp-poll-topic" style="' + inputCss + 'margin-bottom:10px;">'
            + TOPIC_LIST.map(function (t) { return '<option value="' + t + '"' + (t === data.topic ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>'; }).join('')
            + '</select>'
            /* BUGFIX (2026-09-27 — "Edit on a Data collection poll was
               unusable"): this modal used to render the choice-poll options
               editor unconditionally, so editing a data-collection poll
               always failed its own "keep at least two options" check —
               there was nowhere to enter any. It now branches on the
               poll's actual type, same split as the create modal. */
            + (isCollectEdit
                ? ('<div id="emp-poll-questions" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;"></div>'
                    + '<button type="button" id="emp-poll-add-question" style="border:none;background:rgba(10,14,39,0.06);color:#0a0e27;padding:8px 14px;border-radius:10px;font-weight:700;font-size:0.8rem;cursor:pointer;margin-bottom:6px;">+ Add question</button>'
                    + '<div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:8px;">Removing a question keeps any answers already collected for it — they just won\u2019t show against a question here anymore.</div>'
                    + _collectDetailsFieldsHtml(inputCss, data))
                : ('<div id="emp-poll-opts" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;"></div>'
                    + '<button type="button" id="emp-poll-add-opt" style="border:none;background:rgba(10,14,39,0.06);color:#0a0e27;padding:8px 14px;border-radius:10px;font-weight:700;font-size:0.8rem;cursor:pointer;margin-bottom:6px;">+ Add option</button>'
                    + '<div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:8px;">Options that already have votes can\u2019t be removed — edit the wording instead.</div>'))
            + '<div id="emp-poll-err" style="color:#e53935;font-size:0.8rem;min-height:1.1em;margin-bottom:8px;"></div>'
            + '<div style="display:flex;gap:10px;">'
            + '<button type="button" id="emp-poll-cancel" style="flex:1;border:none;background:rgba(10,14,39,0.08);color:#0a0e27;padding:12px;border-radius:12px;font-weight:700;cursor:pointer;">Cancel</button>'
            + '<button type="button" id="emp-poll-submit" style="flex:2;border:none;background:#1B2B8B;color:#fff;padding:12px;border-radius:12px;font-weight:800;cursor:pointer;">Save changes</button>'
            + '</div></div>';
        document.body.appendChild(ov);

        var readCollectDetails = isCollectEdit ? _wireCollectDetailsFields(ov) : null;

        var optsWrap = ov.querySelector('#emp-poll-opts');
        function addOptRow(opt) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:6px;align-items:center;';
            var i = document.createElement('input');
            i.type = 'text'; i.maxLength = 80; i.className = 'emp-poll-opt-input';
            i.style.cssText = inputCss;
            i.value = opt ? opt.text : '';
            i.setAttribute('data-option-id', opt ? opt.id : '');
            i.setAttribute('data-votes', opt ? (opt.votes || 0) : 0);
            row.appendChild(i);
            if (!opt || !opt.votes) {
                var rm = document.createElement('button');
                rm.type = 'button'; rm.textContent = '\u2715';
                rm.style.cssText = 'border:none;background:rgba(229,57,53,0.1);color:#c62828;width:34px;height:34px;border-radius:8px;flex-shrink:0;cursor:pointer;';
                rm.addEventListener('click', function () { row.remove(); });
                row.appendChild(rm);
            }
            optsWrap.appendChild(row);
        }

        var qWrap = ov.querySelector('#emp-poll-questions');
        function addQuestionRow(q) { _buildQuestionRow(qWrap, q, inputCss); }

        if (isCollectEdit) {
            (data.questions || []).forEach(addQuestionRow);
            ov.querySelector('#emp-poll-add-question').addEventListener('click', function () {
                if (qWrap.children.length >= 100) return;
                addQuestionRow(null);
            });
        } else {
            (data.options || []).forEach(addOptRow);
            ov.querySelector('#emp-poll-add-opt').addEventListener('click', function () {
                if (optsWrap.children.length >= 50) return;
                addOptRow(null);
            });
        }
        ov.querySelector('#emp-poll-cancel').addEventListener('click', _closeCreateModal);
        ov.querySelector('#emp-poll-cancel-x').addEventListener('click', _closeCreateModal);
        ov.addEventListener('click', function (e) { if (e.target === ov) _closeCreateModal(); });

        ov.querySelector('#emp-poll-submit').addEventListener('click', function () {
            var btn = this;
            var errEl = ov.querySelector('#emp-poll-err');
            var question = (ov.querySelector('#emp-poll-q').value || '').trim();
            var topic = ov.querySelector('#emp-poll-topic').value;
            var stamp = Date.now().toString(36);
            if (question.length < 5) { errEl.textContent = 'Write your question first (at least 5 characters).'; return; }

            var updatePayload = {
                question: question,
                topic: TOPIC_LIST.indexOf(topic) !== -1 ? topic : 'general'
            };

            if (isCollectEdit) {
                var qTexts = []; var badChoices = false;
                Array.prototype.forEach.call(qWrap.querySelectorAll('.emp-poll-question-row'), function (row, i) {
                    var q = _readQuestionRow(row, i, stamp);
                    if (!q) return;
                    if ((q.answerType === 'single_choice' || q.answerType === 'multi_choice') && q.choices.length < 2) badChoices = true;
                    qTexts.push(q);
                });
                if (qTexts.length < 1) { errEl.textContent = 'Add at least one question.'; return; }
                if (badChoices) { errEl.textContent = 'Choice questions need at least two choices.'; return; }
                Object.assign(updatePayload, { questions: qTexts }, readCollectDetails());
            } else {
                var seen = {}; var options = []; var bad = false;
                Array.prototype.forEach.call(ov.querySelectorAll('.emp-poll-opt-input'), function (inp, i) {
                    var t = (inp.value || '').trim(); var k = t.toLowerCase();
                    if (!t || seen[k]) { if (t) bad = true; return; }
                    seen[k] = 1;
                    var existingId = inp.getAttribute('data-option-id');
                    var votes = parseInt(inp.getAttribute('data-votes'), 10) || 0;
                    options.push({ id: existingId || ('opt_' + i + '_' + stamp), text: t, votes: votes });
                });
                if (options.length < 2) { errEl.textContent = 'Keep at least two different options.'; return; }
                if (bad) { errEl.textContent = 'Remove duplicate option text first.'; return; }
                updatePayload.options = options;
            }

            errEl.textContent = '';
            btn.disabled = true; btn.textContent = 'Saving\u2026';
            window.fbDb.collection('polls').doc(pollId).update(updatePayload).then(function () {
                _closeCreateModal();
                _notify('Poll updated.', 'success');
            }).catch(function (err) {
                btn.disabled = false; btn.textContent = 'Save changes';
                errEl.textContent = 'Could not save changes: ' + ((err && err.message) || 'try again.');
            });
        });
    }

    /* FIX (2026-09-29 — "clicking delete does nothing on the poll and data collection card"):
       Delete used a hidden two-tap confirm INSIDE the ⋮ menu: the first tap only changed the
       button's label to "Tap again to delete" — but that same tap bubbles to the document-level
       outside-click handler which closes the menu, so the label change was never seen and the tap
       looked dead (the arm also expired after 4s). It now opens a real confirmation dialog, then
       deletes through the server (Admin SDK: not blocked by Firestore rules, and it also removes the
       poll's votes/responses/comments), falling back to a direct client delete if the server route
       isn't reachable. The card disappears at once — from the dashboard, and from the full-view
       overlay if it was open — instead of waiting on a live-listener round trip. */
    function _pollConfirmDialog(title, message, okLabel, onConfirm) {
        var old = document.getElementById('emp-poll-confirm-ov'); if (old) old.remove();
        var ov = document.createElement('div');
        ov.id = 'emp-poll-confirm-ov';
        ov.style.cssText = 'position:fixed;inset:0;z-index:100100;background:rgba(10,14,39,0.6);display:flex;align-items:center;justify-content:center;padding:20px;';
        ov.innerHTML = '<div role="alertdialog" aria-modal="true" style="background:var(--card-bg,#fff);color:var(--text-main,#0a0e27);width:100%;max-width:340px;border-radius:16px;padding:20px 18px 16px;box-shadow:0 20px 50px rgba(0,0,0,0.35);">'
            + '<div style="font-weight:800;font-size:1.02rem;margin-bottom:8px;">' + _esc(title) + '</div>'
            + '<div style="font-size:0.86rem;line-height:1.45;color:var(--text-muted,#5b6070);margin-bottom:16px;">' + _esc(message) + '</div>'
            + '<div style="display:flex;gap:10px;">'
            + '<button type="button" data-act="cancel" style="flex:1;border:1px solid rgba(10,14,39,0.18);background:transparent;color:inherit;padding:11px;border-radius:10px;font-weight:700;cursor:pointer;">Cancel</button>'
            + '<button type="button" data-act="ok" style="flex:1;border:none;background:#e53935;color:#fff;padding:11px;border-radius:10px;font-weight:800;cursor:pointer;">' + _esc(okLabel) + '</button>'
            + '</div></div>';
        function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
        ov.addEventListener('click', function (e) {
            e.stopPropagation();
            var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
            if (e.target === ov || act === 'cancel') { close(); return; }
            if (act === 'ok') {
                var okBtn = e.target; okBtn.disabled = true; okBtn.textContent = 'Deleting\u2026';
                onConfirm(close, function (msg) { okBtn.disabled = false; okBtn.textContent = okLabel; if (msg) _notify(msg, 'error'); });
            }
        });
        document.body.appendChild(ov);
    }

    // Removes a deleted poll from every place it can be on screen and tidies the section header.
    function _removePollEverywhere(pollId) {
        try {
            var ov = document.getElementById('emp-poll-detail-ov');
            if (ov && ov.getAttribute('data-poll-id') === pollId) _closePollVotingPage();
            [pollId, pollId + '#detail'].forEach(function (k) {
                var st = _pollWidgets[k]; if (!st) return;
                try { if (typeof st.unsub === 'function') st.unsub(); } catch (e) {}
                try { if (typeof st.commentsUnsub === 'function') st.commentsUnsub(); } catch (e) {}
                try { if (st.replyUnsubs) Object.keys(st.replyUnsubs).forEach(function (rid) { try { st.replyUnsubs[rid](); } catch (e) {} }); } catch (e) {}
                try { _destroyCharts(st); _stopPollViewerCountListener(st); _stopPollViewerPresence(st); } catch (e) {}
                if (st.el && st.el.parentNode) st.el.parentNode.removeChild(st.el);
                delete _pollWidgets[k];
            });
        } catch (e) {}
        var list = document.getElementById('emp-polls-list');
        if (list) {
            var left = list.children.length;
            // keep the "same set of polls" cache key honest so the next refresh repaints correctly
            _pollsPaintedKey = '';
            if (!left) { _pollsHasCards = false; _setSub('No open polls yet \u2014 start the first one.'); }
            else _setSub(left + ' open poll' + (left === 1 ? '' : 's') + ' \u2022 tap a card to open');
        }
    }

    function _serverDeletePoll(pollId) {
        var user = window.fbAuth && window.fbAuth.currentUser;
        if (!user) return Promise.reject(new Error('Please sign in again.'));
        return user.getIdToken().then(function (idToken) {
            return fetch(window._empApiBase() + '/api/polls/' + encodeURIComponent(pollId), {
                method: 'DELETE', headers: { 'Authorization': 'Bearer ' + idToken }
            });
        }).then(function (r) {
            if (r.ok) return 'ok';
            if (r.status === 404 || r.status === 405) return 'unavailable';   // route not deployed / poll already gone handled below
            return r.json().catch(function () { return {}; }).then(function (d) { throw new Error(d.error || ('HTTP ' + r.status)); });
        });
    }

    function _deletePoll(pollId, btn, state) {
        var data = state && state.lastData;
        var isCollect = !!(data && data.type === 'collect');
        _pollConfirmDialog(
            isCollect ? 'Delete this data collection form?' : 'Delete this poll?',
            'It will be removed for everyone, together with its votes, responses and comments. This can\u2019t be undone.',
            'Delete',
            function (close, fail) {
                _serverDeletePoll(pollId).then(function (res) {
                    if (res === 'ok') return;
                    // server route not available — direct client delete (needs the Firestore rule to allow it)
                    return window.fbDb.collection('polls').doc(pollId).delete();
                }).then(function () {
                    close(); _removePollEverywhere(pollId);
                    _notify(isCollect ? 'Data collection form deleted.' : 'Poll deleted.', 'success');
                }).catch(function (err) {
                    fail('Could not delete: ' + ((err && err.message) || 'please try again.'));
                });
            }
        );
    }

    /* Share was silently doing nothing on many devices: navigator.share()'s
       rejection was swallowed with an empty .catch, so a failed/unsupported
       native share sheet left the user with no fallback and no feedback.
       Now every failure path falls through to clipboard, and clipboard
       itself falls through to a legacy execCommand copy for WebViews/older
       browsers that don't expose navigator.clipboard (insecure context, old
       Android WebView, etc). (2026-09-25) */
    function _legacyCopy(text) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch (e) { return false; }
    }
    function _copyShareUrl(url) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url)
                .then(function () { _notify('Poll link copied to clipboard.', 'success'); })
                .catch(function () {
                    if (_legacyCopy(url)) _notify('Poll link copied to clipboard.', 'success');
                    else _notify(url, 'info');
                });
        } else if (_legacyCopy(url)) {
            _notify('Poll link copied to clipboard.', 'success');
        } else {
            _notify(url, 'info');
        }
    }
    function _sharePoll(pollId, data) {
        // Superseded 2026-09-25 by _openShareModal (explicit social picker +
        // optional native device share) — kept as a thin alias in case any
        // other module still calls window-level _sharePoll-style behavior.
        _openShareModal(pollId, data);
    }

    /* ── comments (2026-09-25) — polls/{id}/comments/{commentId}:
       { text, uid, name, createdAt, likes: [uid,...], replyCount }.
       Loaded/listened-to only once the thread is expanded, so a poll card
       sitting unopened in the rail never pays for a comments listener.

       Likes / subcomments / collapse-expand (2026-09-25) — each comment can
       be liked (likes is a plain uid array, toggled with arrayUnion/
       arrayRemove — same "read isn't a transaction" trade-off already
       accepted elsewhere in this widget for vote-adjacent writes) and
       replied to once, via polls/{id}/comments/{commentId}/replies/{replyId}
       (same shape, no further nesting). replyCount is a denormalized
       counter bumped alongside each reply add so the chevron can show a
       count without paying for a subcollection read until it's expanded. */
    function _toggleLike(ref, uid) {
        if (!uid) { _notify('Please sign in to like.', 'warning'); return; }
        ref.get().then(function (snap) {
            var likes = (snap.exists && snap.data().likes) || [];
            var liked = likes.indexOf(uid) !== -1;
            return ref.update({
                likes: liked ? firebase.firestore.FieldValue.arrayRemove(uid) : firebase.firestore.FieldValue.arrayUnion(uid)
            });
        }).catch(function (err) { _notify('Could not update like: ' + ((err && err.message) || ''), 'error'); });
    }

    function _commentFooterHtml(c) {
        var likes = c.likes || [];
        var likedByMe = !!(_myUid() && likes.indexOf(_myUid()) !== -1);
        return '<button type="button" class="emp-poll-comment-like-btn' + (likedByMe ? ' emp-poll-liked' : '') + '">'
            + _icon('heart') + ' <span class="emp-poll-like-count">' + (likes.length ? likes.length : '') + '</span></button>';
    }

    /* FEATURE (2026-09-27 — "improve comments section, let it carry avatar
       picture of the commenter"): falls back to the same ui-avatars.com
       generated initials avatar app-fixes.js already uses elsewhere in this
       app (avatarUrl = userState.avatar || ui-avatars.com/...) whenever a
       comment/reply has no stored avatar (e.g. every comment posted before
       this change) — never a blank box. */
    function _commentAvatarHtml(c) {
        var src = c.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(c.name || 'Member') + '&background=1B2B8B&color=fff&size=56');
        return '<img class="emp-poll-comment-avatar" src="' + _esc(src) + '" alt="" loading="lazy" onerror="this.src=\'https://ui-avatars.com/api/?name=' + encodeURIComponent(c.name || 'Member') + '&background=1B2B8B&color=fff&size=56\';">';
    }

    function _replyRowHtml(c, id) {
        return '<div class="emp-poll-comment-item emp-poll-reply-item" data-comment-id="' + _esc(id) + '">'
            + _commentAvatarHtml(c)
            + '<div class="emp-poll-comment-body">'
            + '<div class="emp-poll-comment-main">'
            + '<span class="emp-poll-comment-name">' + _esc(c.name || 'Member') + '</span>'
            + '<span class="emp-poll-comment-text">' + _esc(c.text) + '</span>'
            + '</div>'
            + '<div class="emp-poll-comment-footer">' + _commentFooterHtml(c) + '</div>'
            + '</div></div>';
    }

    function _commentRowHtml(c, id) {
        var replyCount = c.replyCount || 0;
        return '<div class="emp-poll-comment-item" data-comment-id="' + _esc(id) + '">'
            + _commentAvatarHtml(c)
            + '<div class="emp-poll-comment-body">'
            + '<div class="emp-poll-comment-main">'
            + '<span class="emp-poll-comment-name">' + _esc(c.name || 'Member') + '</span>'
            + '<span class="emp-poll-comment-text">' + _esc(c.text) + '</span>'
            + '</div>'
            + '<div class="emp-poll-comment-footer">'
            + _commentFooterHtml(c)
            + '<button type="button" class="emp-poll-comment-reply-btn">Reply</button>'
            + (replyCount > 0
                ? '<button type="button" class="emp-poll-comment-chevron-btn">' + _icon('chevron') + ' ' + replyCount + ' repl' + (replyCount === 1 ? 'y' : 'ies') + '</button>'
                : '')
            + '</div>'
            + '<div class="emp-poll-reply-compose" style="display:none;"><input type="text" maxlength="300" placeholder="Write a reply\u2026">'
            + '<button type="button" class="emp-poll-reply-send" aria-label="Send">' + _icon('send') + '</button></div>'
            + '<div class="emp-poll-replies-list" style="display:none;"></div>'
            + '</div></div>';
    }

    function _closeReplyThread(state, commentId, repliesList, chevronBtn) {
        if (repliesList) repliesList.style.display = 'none';
        if (chevronBtn) chevronBtn.classList.remove('emp-poll-chevron-open');
        var unsub = state.replyUnsubs && state.replyUnsubs[commentId];
        if (typeof unsub === 'function') { try { unsub(); } catch (e) {} delete state.replyUnsubs[commentId]; }
    }

    function _renderCommentsList(listEl, docs, pollId, state) {
        // Repainting the list (new snapshot) tears down whatever reply
        // threads were open against the old DOM — same coarse trade-off the
        // widget already makes for votes triggering a full _paintPoll.
        if (state.replyUnsubs) {
            Object.keys(state.replyUnsubs).forEach(function (id) { try { state.replyUnsubs[id](); } catch (e) {} });
        }
        state.replyUnsubs = {};

        if (!docs.length) { listEl.innerHTML = '<div class="emp-poll-comment-empty">No comments yet — be the first to weigh in.</div>'; return; }
        listEl.innerHTML = docs.map(function (d) { return _commentRowHtml(d.data(), d.id); }).join('');

        Array.prototype.forEach.call(listEl.querySelectorAll('.emp-poll-comment-item'), function (row) {
            var commentId = row.getAttribute('data-comment-id');
            var commentRef = window.fbDb.collection('polls').doc(pollId).collection('comments').doc(commentId);

            var likeBtn = row.querySelector('.emp-poll-comment-like-btn');
            if (likeBtn) likeBtn.addEventListener('click', function () { _toggleLike(commentRef, _myUid()); });

            var replyBtn = row.querySelector('.emp-poll-comment-reply-btn');
            var composeWrap = row.querySelector('.emp-poll-reply-compose');
            if (replyBtn && composeWrap) {
                replyBtn.addEventListener('click', function () {
                    var opening = composeWrap.style.display === 'none';
                    composeWrap.style.display = opening ? 'flex' : 'none';
                    if (opening) composeWrap.querySelector('input').focus();
                });
                var replyInput = composeWrap.querySelector('input');
                var replySend = composeWrap.querySelector('.emp-poll-reply-send');
                function postReply() {
                    var text = (replyInput.value || '').trim();
                    if (!text) return;
                    if (window.isGuest || !_myUid()) { _notify('Please sign in to reply.', 'warning'); return; }
                    var us = window.userState || {};
                    replyInput.value = '';
                    commentRef.collection('replies').add({
                        text: text.slice(0, 300),
                        uid: us.id || null,
                        name: us.fullName || us.username || 'Member',
                        avatar: us.avatar || '', // FEATURE (2026-09-27 — comment avatars)
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        likes: []
                    }).then(function () {
                        return commentRef.update({ replyCount: firebase.firestore.FieldValue.increment(1) });
                    }).catch(function (err) { _notify('Could not post reply: ' + ((err && err.message) || ''), 'error'); });
                }
                replySend.addEventListener('click', postReply);
                replyInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') postReply(); });
            }

            var chevronBtn = row.querySelector('.emp-poll-comment-chevron-btn');
            var repliesList = row.querySelector('.emp-poll-replies-list');
            if (chevronBtn && repliesList) {
                chevronBtn.addEventListener('click', function () {
                    var isOpen = repliesList.style.display !== 'none';
                    if (isOpen) { _closeReplyThread(state, commentId, repliesList, chevronBtn); return; }
                    repliesList.style.display = 'block';
                    chevronBtn.classList.add('emp-poll-chevron-open');
                    repliesList.innerHTML = '<div class="emp-poll-comment-empty">Loading\u2026</div>';
                    state.replyUnsubs[commentId] = commentRef.collection('replies').orderBy('createdAt', 'asc').limit(50)
                        .onSnapshot(function (snap) {
                            if (!snap.size) { repliesList.innerHTML = '<div class="emp-poll-comment-empty">No replies yet.</div>'; return; }
                            repliesList.innerHTML = snap.docs.map(function (rd) { return _replyRowHtml(rd.data(), rd.id); }).join('');
                            Array.prototype.forEach.call(repliesList.querySelectorAll('.emp-poll-comment-like-btn'), function (btn, i) {
                                var replyRef = commentRef.collection('replies').doc(snap.docs[i].id);
                                btn.addEventListener('click', function () { _toggleLike(replyRef, _myUid()); });
                            });
                        }, function () { repliesList.innerHTML = '<div class="emp-poll-comment-empty">Couldn\u2019t load replies.</div>'; });
                });
            }
        });
    }

    function _setCommentsOpen(el, pollId, data, state, open) {
        state.commentsOpen = open;
        var wrap = el.querySelector('.emp-poll-comments-wrap');
        if (!wrap) return;
        if (!open) {
            wrap.style.display = 'none';
            if (typeof state.commentsUnsub === 'function') { try { state.commentsUnsub(); } catch (e) {} state.commentsUnsub = null; }
            if (state.replyUnsubs) {
                Object.keys(state.replyUnsubs).forEach(function (id) { try { state.replyUnsubs[id](); } catch (e) {} });
                state.replyUnsubs = {};
            }
            return;
        }
        wrap.style.display = 'block';
        if (state.commentsUnsub) return; // already listening
        var listEl = wrap.querySelector('.emp-poll-comment-list');
        listEl.innerHTML = '<div class="emp-poll-comment-empty">Loading\u2026</div>';
        state.commentsUnsub = window.fbDb.collection('polls').doc(pollId).collection('comments')
            .orderBy('createdAt', 'asc').limit(50)
            .onSnapshot(function (snap) { _renderCommentsList(listEl, snap.docs, pollId, state); },
                function () { listEl.innerHTML = '<div class="emp-poll-comment-empty">Couldn\u2019t load comments.</div>'; });

        var input = wrap.querySelector('.emp-poll-comment-input-row input');
        var sendBtn = wrap.querySelector('.emp-poll-comment-send');
        function post() {
            var text = (input.value || '').trim();
            if (!text) return;
            if (window.isGuest || !_myUid()) { _notify('Please sign in to comment.', 'warning'); return; }
            var us = window.userState || {};
            input.value = '';
            window.fbDb.collection('polls').doc(pollId).collection('comments').add({
                text: text.slice(0, 300),
                uid: us.id || null,
                name: us.fullName || us.username || 'Member',
                avatar: us.avatar || '', // FEATURE (2026-09-27 — comment avatars)
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                likes: [],
                replyCount: 0
            }).catch(function (err) { _notify('Could not post comment: ' + ((err && err.message) || ''), 'error'); });
        }
        sendBtn.addEventListener('click', post);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') post(); });
    }

    /* ── generic popover toggle (2026-09-25) — shared by the manage (⋮)
       kebab and the export (CSV/PDF) popover; both use the same
       .emp-poll-kebab-wrap > .emp-poll-icon-btn + .emp-poll-kebab-menu
       markup, so one toggle-and-position routine covers both instead of
       duplicating it. Finds the menu via the button's own wrap so two such
       popovers can coexist on one card without colliding. */
    function _wireKebabToggle(btn) {
        if (!btn) return;
        var wrap = btn.closest('.emp-poll-kebab-wrap');
        var menu = wrap ? wrap.querySelector('.emp-poll-kebab-menu') : null;
        if (!menu) return;
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var willOpen = !menu.classList.contains('emp-poll-kebab-menu--open');
            Array.prototype.forEach.call(document.querySelectorAll('.emp-poll-kebab-menu--open'), function (m) {
                m.classList.remove('emp-poll-kebab-menu--open');
            });
            if (willOpen) {
                // Position against the viewport, from the button's own
                // screen coords — .emp-poll-kebab-menu is position:fixed
                // (see style.css) specifically so it isn't clipped by
                // .card's overflow:hidden or the actions row's
                // overflow-x:auto; that only works if we place it with
                // real viewport coordinates instead of parent-relative
                // offsets.
                var rect = btn.getBoundingClientRect();
                menu.style.right = (window.innerWidth - rect.right) + 'px';
                menu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
                menu.classList.add('emp-poll-kebab-menu--open');
            }
            btn.setAttribute('aria-expanded', String(willOpen));
        });
    }

    /* FEATURE (2026-09-27 — signature capture): wires mouse/touch drawing
       on one signature question's canvas plus its Clear button.
       canvas._hasInk tracks whether anything's actually been drawn (read
       at submit time — see the response-submit handler below — to decide
       required-question validation and whether to upload a new blob at
       all vs. leave an existing signature/edit untouched). Bound per-
       canvas (not window) so repeated card repaints don't pile up global
       listeners. */
    function _wireSignaturePad(wrap) {
        var canvas = wrap.querySelector('.emp-poll-signature-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0a0e27';
        canvas._hasInk = false;
        var drawing = false;
        function pos(e) {
            var rect = canvas.getBoundingClientRect();
            var t = e.touches && e.touches[0];
            var cx = t ? t.clientX : e.clientX, cy = t ? t.clientY : e.clientY;
            return { x: (cx - rect.left) * (canvas.width / rect.width), y: (cy - rect.top) * (canvas.height / rect.height) };
        }
        function start(e) { drawing = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); }
        function move(e) { if (!drawing) return; var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); canvas._hasInk = true; e.preventDefault(); }
        function end() { drawing = false; }
        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        canvas.addEventListener('mouseup', end);
        canvas.addEventListener('mouseleave', end);
        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', end);
        var clearBtn = wrap.querySelector('.emp-poll-signature-clear');
        if (clearBtn) clearBtn.addEventListener('click', function () {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvas._hasInk = false;
        });
    }

    function _paintPoll(el, pollId, data, state) {
        var total = data.totalVotes || 0;
        var closed = data.status !== 'open';
        var voted = !!state.votedOptionId;
        /* FEATURE (2026-09-27 — deadline auto-close, client-side): a
           data-collection poll with a deadline in the past reads as closed
           even before anyone explicitly closes it. Only the poll's own
           creator/admin client writes status:'closed' back (matching the
           Firestore rule already restricting poll updates to creator/
           admin — see _canManagePoll), and only once per card
           (state._autoCloseSent), so a page with many simultaneous
           viewers doesn't all race to write the same update. */
        if (!closed && data.deadline) {
            var _dl = new Date(data.deadline + 'T23:59:59');
            if (!isNaN(_dl.getTime()) && Date.now() > _dl.getTime()) {
                closed = true;
                if (_canManagePoll(data) && !state._autoCloseSent) {
                    state._autoCloseSent = true;
                    window.fbDb.collection('polls').doc(pollId).update({
                        status: 'closed', closedAt: firebase.firestore.FieldValue.serverTimestamp()
                    }).catch(function () { state._autoCloseSent = false; });
                }
            }
        }
        var topicColor = TOPIC_COLORS[data.topic] || TOPIC_COLORS.general;
        var canManage = _canManagePoll(data);
        state._paintedCanManage = canManage;
        /* FEATURE (2026-09-26 — "enable in a way whereby they can use it to
           collect data like Google form"): polls now come in two types.
           Existing polls have no `type` field at all, so `!== 'collect'`
           (not `=== 'choice'`) is deliberate — every poll created before
           this feature keeps rendering through the exact original
           choice-type path below, untouched. */
        var isCollect = data.type === 'collect';

        /* FIX (2026-09-27 — "the card should be same size irrespective of
           the questions [options]. It can display the first 4 entry"):
           mirrors the data-collection compact-preview fix just applied —
           a choice poll's card used to render EVERY option's full bar
           inline, so raising the option cap to 50 (this session) made a
           large poll's feed card just as unbounded as the data-collection
           one was. Only the first 4 options render in the feed-rail card
           now; the rest are reachable by opening the same full detail
           overlay data-collection polls already use (state.detailMode —
           see _paintPoll's top-level note on that flag). The full list
           still renders in full there, unchanged. If the viewer's own
           vote happens to be outside those first 4, it's swapped into the
           last visible slot instead of just disappearing from view — the
           footer already says "you voted" and a compact card showing
           none of its 4 visible options as "mine" would look like a bug,
           not a feature. */
        var VISIBLE_OPTIONS_COMPACT = 4;
        var allOptions = data.options || [];
        var visibleOptions = allOptions;
        if (!isCollect && !state.detailMode) {
            visibleOptions = allOptions.slice(0, VISIBLE_OPTIONS_COMPACT);
            if (state.votedOptionId && !visibleOptions.some(function (o) { return o.id === state.votedOptionId; })) {
                var votedOpt = allOptions.filter(function (o) { return o.id === state.votedOptionId; })[0];
                if (votedOpt) visibleOptions = visibleOptions.slice(0, VISIBLE_OPTIONS_COMPACT - 1).concat([votedOpt]);
            }
        }
        var hiddenOptionCount = allOptions.length - visibleOptions.length;

        var optionsHtml = isCollect ? '' : visibleOptions.map(function (opt, i) {
            var pct = _pct(opt.votes || 0, total);
            var color = BAR_COLORS[i % BAR_COLORS.length];
            var isMine = state.votedOptionId === opt.id;
            // 2026-09-28: in the compact rail card a tap anywhere opens the
            // full view (wired on .emp-poll-card-body below) — voting itself
            // happens there, so options are not individually clickable here.
            var clickable = !closed && !voted && !!state.detailMode;
            return (
                '<div class="emp-poll-option' + (clickable ? ' emp-poll-option--clickable' : '') + '" data-option-id="' + _esc(opt.id) + '" '
                + 'style="position:relative;border-radius:10px;overflow:hidden;margin-bottom:8px;' + (clickable ? 'cursor:pointer;' : '') + ''
                + 'border:1px solid ' + (isMine ? color : 'rgba(10,14,39,0.12)') + ';background:rgba(10,14,39,0.03);">'
                + '<div style="position:absolute;inset:0;width:' + pct + '%;background:' + color + ';opacity:0.18;transition:width .5s ease;"></div>'
                + '<div style="position:relative;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;font-size:0.88rem;">'
                + '<span class="emp-poll-opt-label" style="display:flex;align-items:center;gap:8px;min-width:0;font-weight:' + (isMine ? '800' : '600') + ';">'
                + (isMine ? '<span style="color:' + color + ';flex-shrink:0;">' + _icon('check-circle') + '</span>' : '')
                + '<span class="emp-poll-opt-text">' + _esc(opt.text) + '</span></span>'
                + '<span style="font-weight:800;color:' + color + ';white-space:nowrap;">' + pct + '% <span style="color:var(--text-muted);font-weight:600;">(' + (opt.votes || 0) + ')</span></span>'
                + '</div></div>'
            );
        }).join('');

        /* Data-collection response form (2026-09-26): each question renders
           as a label plus a plain text input. A respondent who already
           submitted (state.hasResponded, set in _mountPollCard from the
           responses/{uid} doc — same pattern as votedOptionId/voters above)
           sees their own answers read-only instead of a blank form, mirroring
           how a voted choice-poll shows its result instead of clickable
           options. */
        /* FEATURE (2026-09-27 — question types, required toggle, choice-
           based questions): a question now renders one of four ways
           depending on its answerType — short text, a paragraph textarea,
           radio buttons for single_choice, or checkboxes for multi_choice
           — and shows a red "*" when it's required. `disabled` covers
           both "already responded and not currently editing" and "poll
           closed" the same way the plain-text case always did. */
        /* FEATURE (2026-09-27 — signature capture + file/ID upload):
           `signature` renders a small drawable canvas (wired up below,
           after el.innerHTML is set, same as every other post-render
           listener in this function) with a Clear button; `file_upload`
           renders a plain file input for a photo/PDF (ID scan, transcript,
           etc.). Both store a permanent URL as the answer, uploaded
           through the same window.uploadToCloudinary the rest of the app
           already uses for media — no new upload infrastructure needed.
           View-only (disabled) renders the previously-uploaded signature
           as an image / file as a "View file" link instead of a live
           input, since there's nothing further to capture. */
        /* FIX (2026-09-27 — "all card should be same size irrespective of
           the number of questions added; clicking the poll card thumbnail
           should open the full panel"): this used to build the full input
           for EVERY question unconditionally, on every repaint of the
           feed-rail card — the very thing that made a data-collection
           card's height balloon with the question count (now raised as
           high as 100 per poll, see the caps above/below). It's only
           actually rendered when this mount is the full detail overlay
           (state.detailMode, set by _openPollVotingPage's call to
           _mountPollCard) — the compact feed-rail preview built further
           down never uses it, so building the full markup for it on every
           snapshot would be pure waste at the new higher question counts. */
        var questionsHtml = (!isCollect || !state.detailMode) ? '' : (data.questions || []).map(function (q, i) {
            var mine = state.myAnswers ? state.myAnswers[q.id] : undefined;
            var disabled = (state.hasResponded && !state.editingResponse) || closed;
            var reqMark = q.required !== false ? '<span style="color:#e53935;">&nbsp;*</span>' : '';
            var body;
            if (q.answerType === 'single_choice' || q.answerType === 'multi_choice') {
                var isMulti = q.answerType === 'multi_choice';
                var mineArr = isMulti ? (Array.isArray(mine) ? mine : []) : null;
                body = '<div class="emp-poll-answer-choices" style="display:flex;flex-direction:column;gap:6px;">'
                    + (q.choices || []).map(function (c) {
                        var checked = isMulti ? (mineArr.indexOf(c.id) !== -1) : (mine === c.id);
                        return '<label style="display:flex;align-items:center;gap:8px;font-size:0.86rem;' + (disabled ? '' : 'cursor:pointer;') + '">'
                            + '<input type="' + (isMulti ? 'checkbox' : 'radio') + '" name="emp-poll-q-' + _esc(state.instanceId) + '-' + _esc(q.id) + '" value="' + _esc(c.id) + '" '
                            + 'class="emp-poll-choice-input" data-question-id="' + _esc(q.id) + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '>'
                            + _esc(c.text) + '</label>';
                    }).join('')
                    + '</div>';
            } else if (q.answerType === 'signature') {
                if (disabled) {
                    body = mine
                        ? '<img src="' + _esc(mine) + '" alt="Signature" style="max-width:240px;max-height:100px;border:1px solid rgba(10,14,39,0.15);border-radius:8px;background:#fff;display:block;">'
                        : '<div style="font-size:0.82rem;color:var(--text-muted);">No signature provided</div>';
                } else if (window.isGuest) {
                    // Signature/file uploads go through Firebase Storage,
                    // which needs a signed-in uid — a guest has none, so
                    // there's nothing safe for this to upload to.
                    body = '<div style="font-size:0.82rem;color:var(--text-muted);border:1px dashed rgba(10,14,39,0.25);border-radius:8px;padding:10px;">Sign in to provide a signature.</div>';
                } else {
                    body = '<div class="emp-poll-signature-wrap" data-question-id="' + _esc(q.id) + '">'
                        + '<canvas class="emp-poll-signature-canvas" width="400" height="140" style="width:100%;max-width:400px;height:140px;border:1px solid rgba(10,14,39,0.25);border-radius:8px;background:#fff;touch-action:none;cursor:crosshair;display:block;"></canvas>'
                        + '<button type="button" class="emp-poll-signature-clear" style="margin-top:6px;border:none;background:rgba(10,14,39,0.06);color:#0a0e27;padding:6px 12px;border-radius:8px;font-weight:700;font-size:0.74rem;cursor:pointer;">Clear</button>'
                        + (state.editingResponse && mine ? '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">Sign again above to replace your previous signature, or leave blank to keep it.</div>' : '')
                        + '</div>';
                }
            } else if (q.answerType === 'file_upload') {
                if (disabled) {
                    body = mine
                        ? '<a href="' + _esc(mine) + '" target="_blank" rel="noopener" style="color:#1B2B8B;font-weight:700;font-size:0.86rem;">' + _icon('export') + ' View uploaded file</a>'
                        : '<div style="font-size:0.82rem;color:var(--text-muted);">No file provided</div>';
                } else if (window.isGuest) {
                    body = '<div style="font-size:0.82rem;color:var(--text-muted);border:1px dashed rgba(10,14,39,0.25);border-radius:8px;padding:10px;">Sign in to upload a file.</div>';
                } else {
                    body = '<input type="file" data-question-id="' + _esc(q.id) + '" class="emp-poll-file-input" accept="image/*,application/pdf" style="width:100%;box-sizing:border-box;font-size:0.82rem;">'
                        + (mine ? '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">' + (state.editingResponse ? 'A file is already on file — choose a new one to replace it, or leave blank to keep it.' : '') + '</div>' : '');
                }
            } else if (q.answerType === 'paragraph') {
                body = '<textarea data-question-id="' + _esc(q.id) + '" class="emp-poll-answer-input" rows="3" maxlength="1000" placeholder="Your answer" '
                    + (disabled ? 'disabled' : '') + ' style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid rgba(10,14,39,0.15);font-size:0.86rem;resize:vertical;">' + _esc(mine || '') + '</textarea>';
            } else {
                body = '<input type="text" data-question-id="' + _esc(q.id) + '" class="emp-poll-answer-input" maxlength="300" placeholder="Your answer" '
                    + (disabled ? 'disabled' : '') + ' value="' + _esc(mine || '') + '" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid rgba(10,14,39,0.15);font-size:0.86rem;">';
            }
            return (
                '<div class="emp-poll-question" style="margin-bottom:10px;">'
                + '<label style="display:block;font-size:0.82rem;font-weight:700;margin-bottom:6px;">' + (i + 1) + '. ' + _esc(q.text) + reqMark + '</label>'
                + body
                + '</div>'
            );
        }).join('');

        /* Edit/Delete live inside a "⋮" kebab menu (2026-09-25) — Close poll
           stays visible since it's the one time-sensitive owner/admin
           action. Every button below is icon-only (title= for the tooltip,
           aria-label for screen readers) so the whole row — Close, Share,
           Chart, Comments, Export, ⋮ — fits on one line on any phone width
           instead of wrapping across two, with a horizontal-scroll fallback
           if a future addition ever pushes it past that. */
        var kebabHtml = canManage
            ? ('<div class="emp-poll-kebab-wrap">'
                + '<button type="button" class="emp-poll-kebab-btn emp-poll-icon-btn" aria-haspopup="true" aria-expanded="false" aria-label="More options" title="More">' + _icon('kebab') + '</button>'
                + '<div class="emp-poll-kebab-menu">'
                + (!closed ? '<button type="button" class="emp-poll-edit-btn emp-poll-kebab-item">' + _icon('edit') + ' Edit</button>' : '')
                + '<button type="button" class="emp-poll-delete-btn emp-poll-kebab-item emp-poll-danger">' + _icon('trash') + ' Delete</button>'
                + '</div></div>')
            : '';

        /* Export now offers CSV or PDF (2026-09-25 — PRD: "structured
           format (e.g., CSV, PDF)") behind the same icon-button-opens-a-
           popover pattern as the ⋮ menu above, reusing its .emp-poll-kebab-menu/
           .emp-poll-kebab-item styling and its fixed-position anchoring
           (see _wireKebabToggle) rather than inventing a second popover
           design. */
        var exportHtml =
            '<div class="emp-poll-kebab-wrap">'
            + '<button type="button" class="emp-poll-export-btn emp-poll-icon-btn" aria-haspopup="true" aria-expanded="false" aria-label="Export results" title="Export results">' + _icon('export') + '</button>'
            + '<div class="emp-poll-kebab-menu">'
            + '<button type="button" class="emp-poll-export-csv-btn emp-poll-kebab-item">' + _icon('export') + ' Export as CSV</button>'
            + '<button type="button" class="emp-poll-export-pdf-btn emp-poll-kebab-item">' + _icon('export') + ' Export as PDF</button>'
            + '</div></div>';

        var actionsHtml = '<div class="emp-poll-actions-row">'
            + (!closed && canManage ? '<button type="button" class="emp-poll-close-btn emp-poll-pill-btn" title="Close poll">' + _icon('check-circle') + '<span>Close</span></button>' : '')
            + '<button type="button" class="emp-poll-share-btn emp-poll-icon-btn" aria-label="Share" title="Share">' + _icon('share') + '</button>'
            + (isCollect ? '' : '<button type="button" class="emp-poll-chart-btn emp-poll-icon-btn" aria-label="Voting chart" title="Voting chart">' + _icon('chart') + '</button>')
            + '<button type="button" class="emp-poll-comments-btn emp-poll-icon-btn" aria-label="Comments" title="Comments">' + _icon('comment') + '</button>'
            + exportHtml
            + kebabHtml
            + '</div>';

        var chartHtml = '<div class="emp-poll-chart-wrap" style="display:none;">'
            + '<div class="emp-poll-chart-box"><canvas class="emp-poll-chart-bar-canvas"></canvas></div>'
            + '<div class="emp-poll-chart-box"><canvas class="emp-poll-chart-pie-canvas"></canvas></div>'
            + '</div>';

        var commentsHtml = '<div class="emp-poll-comments-wrap" style="display:none;">'
            + '<div class="emp-poll-comment-list"></div>'
            + '<div class="emp-poll-comment-input-row"><input type="text" maxlength="300" placeholder="Add a comment\u2026">'
            + '<button type="button" class="emp-poll-comment-send" aria-label="Send">' + _icon('send') + '</button></div>'
            + '</div>';

        /* Avatar badge + heading (2026-09-26 — "insert an avatar placeholder
           frame thumbnail... with the heading empyrean poll... stating what
           the poll is meant for"): purely additive above the existing
           topic-pill/LIVE-POLL row, which is untouched below. Topic label
           reuses the exact same capitalization the create modal already
           applies to TOPIC_LIST, so "politics" reads "Politics" here too. */
        var topicLabel = (data.topic || 'general').charAt(0).toUpperCase() + (data.topic || 'general').slice(1);
        var headerHtml = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
            + '<span class="emp-poll-avatar-thumb" style="display:block;border-radius:50%;">' + _pollAvatarHtml(40) + '</span>'
            + '<div style="min-width:0;">'
            + '<div style="font-size:0.9rem;font-weight:800;line-height:1.25;">' + (isCollect ? 'Empyrean Data Collection Form' : 'Empyrean poll:') + '</div>'
            + '<div style="font-size:0.86rem;font-weight:700;color:#185FA5;line-height:1.25;">' + _esc(topicLabel) + '</div>'
            + '</div></div>';

        /* FEATURE (2026-09-27 — "more robust and advanced for professional,
           institutions, organizations"): the extra data-collection metadata
           (who's collecting it, why, a deadline/target, a way to reach the
           collector, and a consent/data-use note) renders as a small
           details panel above the question list, right where a respondent
           needs to see it before they start answering — not buried in the
           footer where it'd be easy to miss. Every field is optional, so a
           poll created before this feature (or one where the creator left
           these blank) renders with none of this and looks exactly as it
           did before. */
        var collectMetaHtml = '';
        if (isCollect && (data.collectorName || data.purpose || data.deadline || data.targetResponses || data.contactEmail || data.consentNote || data.anonymous)) {
            var purposeLabel = _purposeLabel(data);
            var deadlineLabel = '';
            if (data.deadline) {
                var _dd = new Date(data.deadline + 'T00:00:00');
                deadlineLabel = isNaN(_dd.getTime()) ? '' : _dd.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            }
            var metaRowHtml = [
                data.collectorName ? '<div><strong>Collected by:</strong> ' + _esc(data.collectorName) + '</div>' : '',
                purposeLabel ? '<div><strong>Purpose:</strong> ' + _esc(purposeLabel) + '</div>' : '',
                deadlineLabel ? '<div><strong>Closes:</strong> ' + _esc(deadlineLabel) + '</div>' : ''
            ].filter(Boolean).join('');
            var targetHtml = '';
            if (data.targetResponses) {
                var _tPct = Math.max(0, Math.min(100, Math.round(((data.totalResponses || 0) / data.targetResponses) * 100)));
                targetHtml = '<div style="margin-top:6px;">'
                    + '<div style="height:6px;border-radius:999px;background:rgba(10,14,39,0.08);overflow:hidden;">'
                    + '<div style="height:100%;width:' + _tPct + '%;background:#1B2B8B;border-radius:999px;"></div></div>'
                    + '<div style="margin-top:3px;color:var(--text-muted);">' + (data.totalResponses || 0) + ' of ' + _esc(String(data.targetResponses)) + ' target responses (' + _tPct + '%)</div>'
                    + '</div>';
            }
            collectMetaHtml =
                '<div class="emp-poll-collect-meta" style="background:rgba(10,14,39,0.035);border:1px solid rgba(10,14,39,0.08);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:0.78rem;color:#33395a;">'
                + (metaRowHtml || data.anonymous ? '<div style="display:flex;flex-wrap:wrap;gap:5px 14px;">' + metaRowHtml
                    + (data.anonymous ? '<span style="font-weight:800;color:#1B2B8B;">\u2022 Anonymous responses</span>' : '') + '</div>' : '')
                + targetHtml
                + (data.contactEmail ? '<div style="margin-top:6px;">Questions? <a href="mailto:' + _esc(data.contactEmail) + '" style="color:#1B2B8B;font-weight:700;">' + _esc(data.contactEmail) + '</a></div>' : '')
                + (data.consentNote ? '<div style="margin-top:6px;padding-top:6px;border-top:1px dashed rgba(10,14,39,0.12);font-style:italic;">' + _esc(data.consentNote) + '</div>' : '')
                + '</div>';
        }

        /* FEATURE (2026-09-27 — response edit/withdraw window, restricted
           to signed-in non-guest participants): once a signed-in member
           has responded, they get an Edit/Withdraw pair instead of just a
           static "you responded" footer. A guest respondent (identified
           only by IP server-side, no safe uid to key an edit off) never
           sees this. */
        var respondentControlsHtml = '';
        if (isCollect && !closed && state.hasResponded && !window.isGuest) {
            respondentControlsHtml = '<div style="display:flex;gap:8px;margin-top:8px;">'
                + '<button type="button" class="emp-poll-edit-response-btn" style="flex:1;border:1px solid rgba(10,14,39,0.18);background:#fff;color:#0a0e27;padding:9px;border-radius:10px;font-weight:700;font-size:0.82rem;cursor:pointer;">' + (state.editingResponse ? 'Cancel edit' : 'Edit response') + '</button>'
                + '<button type="button" class="emp-poll-withdraw-response-btn" style="flex:1;border:1px solid rgba(229,57,53,0.3);background:rgba(229,57,53,0.06);color:#c62828;padding:9px;border-radius:10px;font-weight:700;font-size:0.82rem;cursor:pointer;">Withdraw response</button>'
                + '</div>';
        }

        /* FEATURE (2026-09-27 — signature/file upload, guest-blocked): a
           required signature or file-upload question has no way for a
           guest to satisfy it (see the sign-in notices rendered in its
           place above), so the Submit button itself is swapped for a
           plain sign-in notice rather than a button that can never
           succeed for them. */
        var guestBlockedByUpload = isCollect && window.isGuest
            && (data.questions || []).some(function (q) { return (q.answerType === 'signature' || q.answerType === 'file_upload') && q.required !== false; });

        /* FIX (2026-09-27 — "all card should be same size irrespective of
           the number of questions added, clicking the poll card thumbnail
           should open the full panel or tab for users to fill"): a
           data-collection card in the feed rail now shows this fixed-size
           preview — question count + one status line + one CTA button —
           instead of the full question-by-question form, so its height no
           longer depends on how many questions the poll has (1 or the new
           100-question cap look identical here). The full form (exactly
           the markup this replaces, unchanged) still renders in full when
           this mount IS the detail overlay (state.detailMode) — opened by
           tapping anywhere on this preview, same as the avatar thumbnail
           below. Choice-type (non-collect) polls are untouched: their
           inline tap-an-option-to-vote card wasn't what was reported here,
           and changing that voting interaction wasn't asked for. */
        var collectQuestionCount = (data.questions || []).length;
        var COLLECT_TYPE_TAGS = { short: 'Short', paragraph: 'Paragraph', single_choice: 'Choose one', multi_choice: 'Checkboxes', signature: 'Signature', file_upload: 'Upload' };
        var collectRowsHtml = (data.questions || []).slice(0, VISIBLE_OPTIONS_COMPACT).map(function (q, qi) {
            return '<div class="emp-poll-option emp-poll-collect-row" style="position:relative;border-radius:10px;overflow:hidden;margin-bottom:8px;border:1px solid rgba(10,14,39,0.12);background:rgba(10,14,39,0.03);">'
                + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;font-size:0.88rem;">'
                + '<span class="emp-poll-opt-label" style="display:flex;align-items:center;gap:8px;min-width:0;font-weight:600;">'
                + '<span style="color:#1B2B8B;font-weight:800;flex-shrink:0;">' + (qi + 1) + '.</span><span class="emp-poll-opt-text">' + _esc(q.text || '') + '</span></span>'
                + '<span style="font-size:0.7rem;font-weight:700;color:var(--text-muted);white-space:nowrap;">' + _esc(COLLECT_TYPE_TAGS[q.answerType] || 'Short') + '</span>'
                + '</div></div>';
        }).join('');
        var collectHiddenCount = collectQuestionCount - Math.min(collectQuestionCount, VISIBLE_OPTIONS_COMPACT);
        var collectCtaLabel = closed ? 'View responses' : (state.hasResponded ? 'View / edit your response' : 'Fill out this form');
        var collectCompactHtml = '<div class="emp-poll-collect-compact">' + collectRowsHtml
            + (collectHiddenCount > 0
                ? '<div class="emp-poll-more-options" style="text-align:center;padding:9px;font-size:0.82rem;font-weight:700;color:#1B2B8B;border:1px dashed rgba(27,43,139,0.3);border-radius:10px;margin-bottom:4px;">+' + collectHiddenCount + ' more question' + (collectHiddenCount === 1 ? '' : 's') + ' — tap to see all and fill</div>'
                : '')
            + '</div>';

        /* Shown only when options were actually truncated above (0 in
           detail mode, or in compact mode with 4 or fewer options total).
           Clickable the same way the data-collection compact preview is —
           wired alongside it below. */
        var moreOptionsHtml = hiddenOptionCount > 0
            ? '<div class="emp-poll-more-options" style="text-align:center;padding:9px;font-size:0.82rem;font-weight:700;color:#1B2B8B;border:1px dashed rgba(27,43,139,0.3);border-radius:10px;margin-bottom:4px;">+' + hiddenOptionCount + ' more option' + (hiddenOptionCount === 1 ? '' : 's') + ' — tap to see all and vote</div>'
            : '';

        var bodyHtml = isCollect
            ? (state.detailMode
                ? (collectMetaHtml + '<div>' + questionsHtml + '</div>'
                    + ((!closed && (!state.hasResponded || state.editingResponse))
                        ? (guestBlockedByUpload
                            ? '<div style="font-size:0.82rem;color:#991b1b;background:rgba(229,57,53,0.06);border:1px solid rgba(229,57,53,0.2);border-radius:10px;padding:10px 12px;margin-top:2px;">This form requires a signature or file upload, so please sign in to respond.</div>'
                            : '<button type="button" class="emp-poll-submit-response-btn" style="width:100%;border:none;background:#1B2B8B;color:#fff;padding:11px;border-radius:10px;font-weight:800;cursor:pointer;margin-top:2px;">' + (state.editingResponse ? 'Save changes' : 'Submit') + '</button>')
                        : '')
                    + respondentControlsHtml
                    + '<div class="emp-poll-response-err" style="color:#e53935;font-size:0.8rem;min-height:1.1em;margin-top:6px;"></div>')
                : collectCompactHtml)
            : (_statBarHtml(data.options || [], total) + '<div>' + optionsHtml + '</div>' + moreOptionsHtml);

        var footerHtml = isCollect
            ? ((data.totalResponses || 0) + ' response' + ((data.totalResponses || 0) === 1 ? '' : 's')
                + (closed ? ' \u2022 poll closed' : (state.hasResponded ? ' \u2022 you responded' : (state.detailMode ? ' \u2022 fill in your answers' : ' \u2022 tap to fill in'))))
            : (total + ' vote' + (total === 1 ? '' : 's') + (closed ? ' \u2022 poll closed' : (voted ? ' \u2022 you voted' : (state.detailMode ? ' \u2022 tap an option to vote' : ' \u2022 tap to vote'))));

        /* FEATURE (2026-09-27 — "enable viewers live count"): placeholder
           badge, filled in live by _startPollViewerCountListener via its
           id — never re-created on repaint (it's outside anything that
           depends on `total`/vote state), so the count doesn't flicker
           back to blank on every vote-triggered repaint. */
        var viewerBadgeHtml = '<span id="emp-poll-viewers-' + _esc(pollId) + '" class="emp-poll-viewer-badge">' + _icon('eye') + ' \u2026</span>';

        /* FEATURE (2026-09-27, removed 2026-09-27 — "remove the Chevron
           expand and collapse button it's not necessary here"): the
           question/options/questions block used to be wrapped in a
           height-capped, fade-clipped body with a "Show more/less" toggle.
           Per request, the dashboard card now always renders every
           option/question in full — no cap, no toggle. Tapping the poll's
           avatar thumbnail (wired below) opens the full voting page
           instead. */
        el.innerHTML =
            '<div class="card emp-poll-card" style="margin-bottom:14px;">'
            + '<div class="card-content" style="padding:16px;">'
            + '<div class="emp-poll-card-body"' + (state.detailMode ? '' : ' role="button" tabindex="0" aria-label="Open poll"') + '>'
            + headerHtml
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">'
            + '<span style="font-size:0.68rem;font-weight:800;letter-spacing:0.05em;padding:3px 9px;border-radius:999px;background:' + topicColor + '22;color:' + topicColor + ';text-transform:uppercase;">' + _esc(data.topic || 'general') + '</span>'
            + (closed ? '<span style="font-size:0.68rem;font-weight:800;color:#991b1b;">CLOSED</span>' : '<span style="font-size:0.68rem;font-weight:800;color:#22c55e;">\u25CF LIVE POLL</span>')
            + viewerBadgeHtml
            + (isCollect ? '<span style="font-size:0.68rem;font-weight:800;letter-spacing:0.05em;padding:3px 9px;border-radius:999px;background:rgba(10,14,39,0.08);color:#0a0e27;">DATA COLLECTION</span>' : '')
            + (_isTrending(data, total) ? '<span class="emp-poll-trending-badge">' + _icon('fire') + ' Trending</span>' : '')
            + '</div>'
            + '<div style="font-size:1rem;font-weight:800;margin-bottom:10px;">' + _esc(data.question) + '</div>'
            + bodyHtml
            + '<div style="font-size:0.76rem;color:var(--text-muted);margin-top:8px;">' + footerHtml
            + (data.createdByName ? ' \u2022 asked by ' + _esc(data.createdByName) : '') + '</div>'
            + '</div>'
            + actionsHtml
            + chartHtml
            + commentsHtml
            + '</div></div>';

        /* 2026-09-28 ("clicking or touching the card will then expand into
           full view", same for multi-choice and data-collection): in the
           rail, ONE handler on the card body opens the full view — the
           header, the 4 visible entries and the "+N more" row are all part
           of it, so there's no separate avatar/CTA/option handler to
           double-fire. The actions row (share, close, kebab...) sits
           outside .emp-poll-card-body so those buttons keep working. */
        if (!state.detailMode) {
            var bodyEl = el.querySelector('.emp-poll-card-body');
            if (bodyEl) {
                bodyEl.addEventListener('click', function () { _openPollVotingPage(pollId); });
                bodyEl.addEventListener('keydown', function (e) {
                    if (e.target === bodyEl && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); _openPollVotingPage(pollId); }
                });
            }
        }

        Array.prototype.forEach.call(el.querySelectorAll('.emp-poll-signature-wrap'), _wireSignaturePad);

        var submitResponseBtn = el.querySelector('.emp-poll-submit-response-btn');
        if (submitResponseBtn) {
            submitResponseBtn.addEventListener('click', function () {
                var errEl = el.querySelector('.emp-poll-response-err');
                var answers = {};
                var missingRequired = false;
                var uploads = []; // [{questionId, promise}] for signature/file_upload questions with a new capture

                (data.questions || []).forEach(function (q) {
                    var prevAnswer = state.myAnswers ? state.myAnswers[q.id] : undefined;
                    if (q.answerType === 'single_choice') {
                        var checked = el.querySelector('.emp-poll-choice-input[data-question-id="' + q.id + '"]:checked');
                        var v = checked ? checked.value : '';
                        if (q.required !== false && !v) missingRequired = true;
                        answers[q.id] = v;
                    } else if (q.answerType === 'multi_choice') {
                        var arr = [];
                        Array.prototype.forEach.call(el.querySelectorAll('.emp-poll-choice-input[data-question-id="' + q.id + '"]:checked'), function (cb) { arr.push(cb.value); });
                        if (q.required !== false && arr.length === 0) missingRequired = true;
                        answers[q.id] = arr;
                    } else if (q.answerType === 'signature') {
                        // FEATURE (2026-09-27 — signature capture): a blank
                        // canvas while editing means "keep the existing
                        // signature", not "no signature" — only ink drawn
                        // just now gets uploaded as a replacement.
                        var wrap = el.querySelector('.emp-poll-signature-wrap[data-question-id="' + q.id + '"]');
                        var canvas = wrap ? wrap.querySelector('.emp-poll-signature-canvas') : null;
                        if (canvas && canvas._hasInk) {
                            answers[q.id] = prevAnswer || ''; // placeholder until the upload below resolves
                            uploads.push({ questionId: q.id, promise: new Promise(function (resolve, reject) {
                                canvas.toBlob(function (blob) {
                                    if (!blob) { reject(new Error('Could not read signature.')); return; }
                                    window.uploadToCloudinary(blob).then(resolve).catch(reject);
                                }, 'image/png');
                            }) });
                        } else {
                            answers[q.id] = prevAnswer || '';
                            if (q.required !== false && !answers[q.id]) missingRequired = true;
                        }
                    } else if (q.answerType === 'file_upload') {
                        var finput = el.querySelector('.emp-poll-file-input[data-question-id="' + q.id + '"]');
                        var f = finput && finput.files && finput.files[0];
                        if (f) {
                            answers[q.id] = prevAnswer || '';
                            uploads.push({ questionId: q.id, promise: window.uploadToCloudinary(f) });
                        } else {
                            answers[q.id] = prevAnswer || '';
                            if (q.required !== false && !answers[q.id]) missingRequired = true;
                        }
                    } else {
                        var inp = el.querySelector('.emp-poll-answer-input[data-question-id="' + q.id + '"]');
                        var t = inp ? (inp.value || '').trim() : '';
                        if (q.required !== false && !t) missingRequired = true;
                        answers[q.id] = t;
                    }
                });

                if (missingRequired) { if (errEl) errEl.textContent = 'Please answer every required question.'; return; }
                if (errEl) errEl.textContent = '';
                var wasEditing = state.editingResponse;
                submitResponseBtn.disabled = true;
                submitResponseBtn.textContent = uploads.length ? 'Uploading\u2026' : (wasEditing ? 'Saving\u2026' : 'Submitting\u2026');

                var afterSave = function (err) {
                    if (err) {
                        submitResponseBtn.disabled = false; submitResponseBtn.textContent = wasEditing ? 'Save changes' : 'Submit';
                        if (errEl) errEl.textContent = 'Could not save: ' + ((err && err.message) || 'try again.');
                    } else {
                        state.hasResponded = true;
                        state.myAnswers = answers;
                        state.editingResponse = false;
                        _paintPoll(el, pollId, data, state);
                    }
                };

                Promise.all(uploads.map(function (u) { return u.promise; })).then(function (urls) {
                    uploads.forEach(function (u, i) { answers[u.questionId] = urls[i]; });
                    submitResponseBtn.textContent = wasEditing ? 'Saving\u2026' : 'Submitting\u2026';
                    if (wasEditing) { _updateResponse(pollId, answers, afterSave); }
                    else { _submitResponse(pollId, answers, afterSave); }
                }).catch(function (err) {
                    submitResponseBtn.disabled = false; submitResponseBtn.textContent = wasEditing ? 'Save changes' : 'Submit';
                    if (errEl) errEl.textContent = 'Could not upload: ' + ((err && err.message) || 'try again.');
                });
            });
        }

        var editResponseBtn = el.querySelector('.emp-poll-edit-response-btn');
        if (editResponseBtn) {
            editResponseBtn.addEventListener('click', function () {
                state.editingResponse = !state.editingResponse;
                _paintPoll(el, pollId, data, state);
            });
        }

        var withdrawResponseBtn = el.querySelector('.emp-poll-withdraw-response-btn');
        if (withdrawResponseBtn) {
            withdrawResponseBtn.addEventListener('click', function () {
                if (!confirm('Withdraw your response? This removes your submitted answers.')) return;
                withdrawResponseBtn.disabled = true;
                _withdrawResponse(pollId, function (err) {
                    if (err) {
                        withdrawResponseBtn.disabled = false;
                    } else {
                        state.hasResponded = false;
                        state.myAnswers = null;
                        state.editingResponse = false;
                        _paintPoll(el, pollId, data, state);
                    }
                });
            });
        }

        var closeBtn = el.querySelector('.emp-poll-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                if (!_canManagePoll(data)) { _notify('Only the poll creator or an admin can close this poll.', 'warning'); return; }
                closeBtn.disabled = true;
                window.fbDb.collection('polls').doc(pollId).update({
                    status: 'closed',
                    closedAt: firebase.firestore.FieldValue.serverTimestamp()
                }).then(function () { _notify('Poll closed.', 'success'); })
                  .catch(function (err) { closeBtn.disabled = false; _notify('Could not close the poll: ' + ((err && err.message) || ''), 'error'); });
            });
        }
        _wireKebabToggle(el.querySelector('.emp-poll-kebab-btn'));
        _wireKebabToggle(el.querySelector('.emp-poll-export-btn'));

        var editBtn = el.querySelector('.emp-poll-edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', function () {
                if (!_canManagePoll(data)) { _notify('Only the poll creator or an admin can edit this poll.', 'warning'); return; }
                _openEditModal(pollId, data);
            });
        }

        var deleteBtn = el.querySelector('.emp-poll-delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function () {
                if (!_canManagePoll(data)) { _notify('Only the poll creator or an admin can delete this poll.', 'warning'); return; }
                _deletePoll(pollId, deleteBtn, state);
            });
        }

        var shareBtn = el.querySelector('.emp-poll-share-btn');
        if (shareBtn) shareBtn.addEventListener('click', function () { _openShareModal(pollId, data); });

        var exportCsvBtn = el.querySelector('.emp-poll-export-csv-btn');
        if (exportCsvBtn) exportCsvBtn.addEventListener('click', function () { _exportPollCsv(pollId, data); });

        var exportPdfBtn = el.querySelector('.emp-poll-export-pdf-btn');
        if (exportPdfBtn) exportPdfBtn.addEventListener('click', function () { _exportPollPdf(pollId, data); });

        var chartBtn = el.querySelector('.emp-poll-chart-btn');
        if (chartBtn) {
            chartBtn.addEventListener('click', function () {
                if (!state.detailMode) { _openPollVotingPage(pollId); return; }
                var willOpen = !state.chartOpen;
                _setChartOpen(el, pollId, data, state, willOpen);
                /* FIX (2026-09-28 — "statistics data doesn't display fully"):
                   once the bar + pie panel is open in the full view, re-fit
                   both canvases to their final laid-out size and scroll the
                   panel into view so the whole bar AND pie chart can be
                   reviewed (done here on click only, never in _setChartOpen,
                   which also re-runs on every live-vote repaint and would
                   otherwise yank the scroll position around). */
                if (willOpen) {
                    requestAnimationFrame(function () {
                        try { if (state.barChart) state.barChart.resize(); if (state.pieChart) state.pieChart.resize(); } catch (e) {}
                        var w = el.querySelector('.emp-poll-chart-wrap');
                        if (w && w.scrollIntoView) { try { w.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { w.scrollIntoView(); } }
                    });
                }
            });
            // Same repaint story as comments below: a vote snapshot rebuilds
            // this card's DOM (and its canvases) from scratch, so a chart
            // left open needs to be redrawn against the fresh nodes.
            if (state.chartOpen) { _setChartOpen(el, pollId, data, state, true); }
        }

        var commentsBtn = el.querySelector('.emp-poll-comments-btn');
        if (commentsBtn) {
            commentsBtn.addEventListener('click', function () { if (!state.detailMode) { _openPollVotingPage(pollId); return; } _setCommentsOpen(el, pollId, data, state, !state.commentsOpen); });
            // A repaint (new vote snapshot) rebuilds the DOM from scratch, so
            // if the thread was left open, reopen it — the old listener
            // pointed at a now-detached node and was already dropped by
            // _loadOpenPolls/_mountPollCard's teardown, so just re-attach.
            // Any open reply threads under it get torn down too (their
            // unsubs are stale against the detached DOM) — _renderCommentsList
            // clears state.replyUnsubs itself on every render.
            if (state.commentsOpen) { state.commentsUnsub = null; _setCommentsOpen(el, pollId, data, state, true); }
        }

        if (!closed && !voted) {
            Array.prototype.forEach.call(el.querySelectorAll('.emp-poll-option--clickable'), function (optEl) {
                optEl.addEventListener('click', function () {
                    Array.prototype.forEach.call(el.querySelectorAll('.emp-poll-option--clickable'), function (e2) {
                        e2.style.opacity = '0.55'; e2.style.pointerEvents = 'none';
                    });
                    var optionId = optEl.getAttribute('data-option-id');
                    state.votedOptionId = optionId; // optimistic — corrected either way below
                    _castVote(pollId, optionId, function (err) {
                        if (err) {
                            /* FIX (2026-09-27 — "when a user clicks vote it
                               doesn't respond at all"): a failed vote used to
                               just null out state.votedOptionId and wait for
                               the NEXT Firestore snapshot to repaint the card
                               back to clickable. A write that fails outright
                               (the auth-uid mismatch fixed in
                               _voteAuthenticated above, or a genuine offline
                               blip) never produces a new snapshot — nothing
                               in Firestore changed — so every option stayed
                               permanently greyed-out and unclickable, with
                               only a toast (easy to miss) explaining why.
                               Repainting THIS card immediately from the
                               last-known `data` restores every option to
                               clickable right away, so a person can just tap
                               again instead of the card looking frozen. */
                            state.votedOptionId = null;
                            _paintPoll(el, pollId, data, state);
                        }
                        // success: Firestore's own onSnapshot listener
                        // (_mountPollCard) repaints with the real, server-
                        // confirmed tallies — no need to guess them here.
                    });
                });
            });
        }
    }

    function _mountPollCard(container, pollId, opts) {
        var wrap = document.createElement('div');
        wrap.className = 'emp-poll-card-wrap';
        var el = document.createElement('div');
        el.id = 'emp-poll-card-' + pollId;
        wrap.appendChild(el);
        container.appendChild(wrap);

        var state = {
            /* BUGFIX (2026-09-27 — "close/edit/delete kebab missing"): the
               card's own DOM el and the last-painted Firestore data are now
               kept on state so _empRefreshPollPermissions (below) can force
               a repaint the moment auth/admin status resolves, instead of
               waiting for the poll doc itself to change. */
            el: el, lastData: null, pollId: pollId,
            /* FIX (2026-09-27 — radio-group name collision): a poll can be
               mounted twice at once (the dashboard rail card and the
               full-page voting overlay opened from it). Single-choice
               question radios group by their HTML `name`, so two mounts of
               the exact same poll/question would otherwise fight over one
               shared native radio group across both DOM copies. instanceId
               is unique per _mountPollCard call and gets folded into each
               radio's name (see _paintPoll) so the two copies never share
               one. */
            instanceId: 'pi_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
            votedOptionId: null, hasResponded: false, myAnswers: null, commentsOpen: false, commentsUnsub: null, deleteArmed: false,
            replyUnsubs: {}, chartOpen: false, barChart: null, pieChart: null, expanded: false,
            viewerPresenceRef: null, viewerHeartbeatTimer: null, viewerCountUnsub: null,
            // FEATURE (2026-09-27 — response edit/withdraw window + deadline
            // auto-close): editingResponse toggles a data-collection
            // respondent's own answers back into an editable form;
            // _autoCloseSent guards the opportunistic Firestore close below
            // so it only ever fires once per card even though the deadline
            // check re-runs on every repaint.
            editingResponse: false, _autoCloseSent: false,
            // FIX (2026-09-27 — "all card should be same size ... clicking
            // the poll card thumbnail should open the full panel"): the
            // ONLY thing that distinguishes this mount from the compact
            // feed-rail card is this flag, set true exclusively by
            // _openPollVotingPage's own call below. _paintPoll reads it to
            // decide whether a data-collection poll renders its full
            // question-by-question form or the fixed-size preview.
            detailMode: !!(opts && opts.detailMode)
        };

        // 2026-09-28: the full-view overlay registers under its own key. It
        // used to overwrite the rail card's entry for the same poll, which
        // orphaned the rail card (permission refreshes and teardown could no
        // longer reach it) and leaked the overlay's own listeners on close.
        var widgetKey = state.detailMode ? (pollId + '#detail') : pollId;
        state.widgetKey = widgetKey;
        _pollWidgets[widgetKey] = state;

        // FIX (2026-09-27): read back using the same Firebase Auth uid the
        // vote/response writes now use (see _voteAuthenticated/
        // _submitAnswersAuthenticated above) — reading under the old
        // window.userState.id would silently never find a member's own
        // vote, permanently showing the poll as "not yet voted" for them
        // even after a successful vote.
        /* FIX (2026-09-28 — "the poll takes time to load"): a rail card used
           to stay blank until THREE sequential round trips finished (its
           voters/{uid} read, its responses/{uid} read, then the first
           onSnapshot) even though _loadOpenPolls had already fetched the
           poll doc itself. Now the caller hands that data in as
           opts.initialData and the card paints from it immediately; the
           "have I voted/responded" lookup runs in parallel and simply
           repaints when it lands, and only the ONE lookup relevant to the
           poll's type is made (a choice poll never needs its responses/
           doc, a data-collection poll never needs voters/). The detail
           overlay has no initialData, so it still waits for both checks
           before its first paint, exactly as before. */
        var initialData = opts && opts.initialData;
        // 2026-09-28 ("tapping showed an empty Poll panel"): the full view
        // used to have no data of its own and sat blank until three
        // sequential network reads finished — on a slow connection that
        // was many seconds of an empty sheet. It is now seeded with what
        // the rail card already knows (poll data + my vote/response), so
        // it paints at once, then the parallel lookups just refine it.
        if (opts && opts.seed) {
            state.votedOptionId = opts.seed.votedOptionId || null;
            state.hasResponded = !!opts.seed.hasResponded;
            state.myAnswers = opts.seed.myAnswers || null;
        }
        var authUid = !window.isGuest ? _myUid() : null;
        var knownType = initialData ? (initialData.type === 'collect' ? 'collect' : 'choice') : null;
        var voterCheck = (authUid && knownType !== 'collect')
            ? window.fbDb.collection('polls').doc(pollId).collection('voters').doc(authUid).get()
                .then(function (snap) { state.votedOptionId = snap.exists ? snap.data().optionId : null; })
                .catch(function () {})
            : Promise.resolve();
        var responseCheck = (authUid && knownType !== 'choice')
            ? window.fbDb.collection('polls').doc(pollId).collection('responses').doc(authUid).get()
                .then(function (snap) { state.hasResponded = snap.exists; state.myAnswers = snap.exists ? (snap.data().answers || {}) : null; })
                .catch(function () {})
            : Promise.resolve();

        // FEATURE (2026-09-27 — "enable viewers live count"): mirrors
        // app-live.js's own active_streams/{id}/viewers/{uid} presence
        // pattern exactly (heartbeat-backed doc + a live-window count
        // listener), applied to polls/{id}/viewers/{uid} — see
        // _startPollViewerPresence/_startPollViewerCountListener below.
        _startPollViewerPresence(pollId, state);
        _startPollViewerCountListener(pollId, state);

        var checks = Promise.all([voterCheck, responseCheck]);
        if (initialData) {
            state.lastData = initialData;
            _paintPoll(el, pollId, initialData, state);
            checks.then(function () {
                if (state.lastData && document.body.contains(el)) _paintPoll(el, pollId, state.lastData, state);
            });
        }
        (initialData ? Promise.resolve() : checks).then(function () {
            state.unsub = window.fbDb.collection('polls').doc(pollId).onSnapshot(function (snap) {
                if (!snap.exists) { _removePollEverywhere(pollId); return; }
                var data = snap.data();
                /* 2026-09-28: a repaint rebuilds the whole form, wiping
                   whatever the person has typed so far. Now that filling
                   happens in the full view, someone else responding (which
                   bumps totalResponses and fires this) must not erase a
                   half-finished form: while an editable form is on screen
                   and nothing that affects it changed, just remember the
                   fresh data. */
                var prev = state.lastData;
                if (state.detailMode && data.type === 'collect' && prev && el.querySelector('.emp-poll-submit-response-btn')
                    && prev.status === data.status && prev.deadline === data.deadline
                    && JSON.stringify(prev.questions) === JSON.stringify(data.questions)) {
                    state.lastData = data;
                    return;
                }
                state.lastData = data; // see _empRefreshPollPermissions below
                // A poll closing while this card is on screen should still
                // show its final bars, not disappear — only actual removal
                // (deleted doc) or a fresh page load excludes a closed poll.
                _paintPoll(el, pollId, data, state);
            }, function () { /* silent — a transient listener error just leaves the last-painted state on screen */ });
        });

        /* SELF-HEAL (2026-09-27 — "closed icon and edit/delete kebab still
           missing sometimes"): _empRefreshPollPermissions already repaints
           every mounted card the moment auth-ready fires or the chief-login
           admin check resolves, but a card that mounts on a warm session —
           no auth-state change, no admin check ever firing because the
           session was restored some other way — can still get stuck
           showing no Close/⋮ for its own creator, since nothing ever tells
           it to look again. These are cheap, bounded re-checks (a handful
           of ticks over the first ~10s of a card's life) that only ever
           repaint when canManage actually flips from false to true, so a
           normal viewer who isn't the poll's owner/admin never sees
           anything flicker. */
        (function () {
            var lastManage = false;
            [1200, 3000, 6000, 10000].forEach(function (delay) {
                setTimeout(function () {
                    if (!state.lastData || !document.body.contains(el)) return;
                    var nowManage = _canManagePoll(state.lastData);
                    if (nowManage && nowManage !== lastManage) {
                        lastManage = nowManage;
                        _paintPoll(el, pollId, state.lastData, state);
                    }
                }, delay);
            });
        })();
    }

    /* Full "voting page" overlay (2026-09-27 — "touching the poll card
       thumbnail should expand or open a new tab that display all the
       voting page"): reuses the exact same share-modal bottom-sheet
       styling (.emp-poll-modal-ov/-sheet/-grabber/-head/-x) and, rather
       than re-implementing a second poll renderer, just calls
       _mountPollCard again against a mount point inside the sheet — every
       vote/comment/chart/kebab interaction on the dashboard rail card
       already works unmodified there. */
    function _teardownPollState(st) {
        if (!st) return;
        if (typeof st.unsub === 'function') { try { st.unsub(); } catch (e) {} }
        if (typeof st.commentsUnsub === 'function') { try { st.commentsUnsub(); } catch (e) {} }
        if (st.replyUnsubs) Object.keys(st.replyUnsubs).forEach(function (rid) { try { st.replyUnsubs[rid](); } catch (e) {} });
        _destroyCharts(st);
        _stopPollViewerCountListener(st);
        _stopPollViewerPresence(st);
    }
    function _closePollVotingPage() {
        var ov = document.getElementById('emp-poll-detail-ov');
        var pid = ov && ov.getAttribute('data-poll-id');
        if (pid) {
            var dst = _pollWidgets[pid + '#detail'];
            var rail = _pollWidgets[pid];
            // carry a vote/response made in the full view back to the rail card
            if (dst && rail) {
                rail.votedOptionId = dst.votedOptionId;
                rail.hasResponded = dst.hasResponded;
                rail.myAnswers = dst.myAnswers;
                if (rail.el && rail.lastData && document.body.contains(rail.el)) _paintPoll(rail.el, pid, rail.lastData, rail);
            }
            _teardownPollState(dst);
            delete _pollWidgets[pid + '#detail'];
        }
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    }
    function _openPollVotingPage(pollId) {
        _closePollVotingPage();
        var rail = _pollWidgets[pollId];
        var ov = document.createElement('div');
        ov.id = 'emp-poll-detail-ov';
        ov.className = 'emp-poll-modal-ov';
        ov.setAttribute('data-poll-id', pollId);
        ov.innerHTML =
            '<div class="emp-poll-modal-sheet emp-poll-detail-sheet">'
            + '<div class="emp-poll-modal-grabber"></div>'
            + '<div class="emp-poll-modal-head"><div class="emp-poll-modal-title">' + ((rail && rail.lastData && rail.lastData.type === 'collect') ? 'Data Collection Form' : 'Poll') + '</div>'
            + '<button type="button" class="emp-poll-modal-x" aria-label="Close">' + _icon('dismiss') + '</button></div>'
            + '<div class="emp-poll-detail-mount"></div>'
            + '</div>';
        document.body.appendChild(ov);
        ov.addEventListener('click', function (e) { if (e.target === ov) _closePollVotingPage(); });
        ov.querySelector('.emp-poll-modal-x').addEventListener('click', _closePollVotingPage);
        var mountEl = ov.querySelector('.emp-poll-detail-mount');
        if (rail && rail.lastData) {
            _mountPollCard(mountEl, pollId, {
                detailMode: true,
                initialData: rail.lastData,
                seed: { votedOptionId: rail.votedOptionId, hasResponded: rail.hasResponded, myAnswers: rail.myAnswers }
            });
        } else {
            // Opened from somewhere with no rail card to copy from (e.g. a
            // shared link): show a visible loading state right away and
            // paint from a single direct read instead of waiting on the
            // vote/response lookups first.
            mountEl.innerHTML = '<div style="padding:28px 8px;text-align:center;color:var(--text-muted);font-size:0.9rem;">Loading poll\u2026</div>';
            window.fbDb.collection('polls').doc(pollId).get().then(function (snap) {
                if (!document.body.contains(ov)) return;
                if (!snap.exists) { mountEl.innerHTML = '<div style="padding:28px 8px;text-align:center;color:var(--text-muted);">This poll is no longer available.</div>'; return; }
                mountEl.innerHTML = '';
                if (snap.data().type === 'collect') { var ttl = ov.querySelector('.emp-poll-modal-title'); if (ttl) ttl.textContent = 'Data Collection Form'; }
                _mountPollCard(mountEl, pollId, { detailMode: true, initialData: snap.data() });
            }).catch(function () {
                mountEl.innerHTML = '<div style="padding:28px 8px;text-align:center;color:var(--text-muted);">Couldn\u2019t load this poll. Please close and try again.</div>';
            });
        }
    }

    /* ── mount point: a sibling directly above #feed-container ─────────── */

    function _ensureMount() {
        var existing = document.getElementById('emp-live-polls-mount');
        if (existing) return existing;
        var fc = document.getElementById('feed-container');
        if (!fc || !fc.parentNode) return null;
        var mount = document.createElement('div');
        mount.id = 'emp-live-polls-mount';
        fc.parentNode.insertBefore(mount, fc);
        return mount;
    }

    /* ── start-a-poll (added 2026-09-24) ─────────────────────────────────
       "I am not seeing the polling voting system or the icon, please enable
       admin or user to initiate poll": the widget used to render nothing at
       all unless an ADMIN had already raised a poll from the admin panel, and
       there was no way for a member to start one. Now there is an always-
       visible header (with the polls icon) and a "Start a poll" button for any
       signed-in member. The creator's Firebase Auth uid is stored on the poll
       (createdByUid) so they — and admins — can close it later; the matching
       rules are in firebase-rules.js (/polls). */

    function _myUid() {
        return (window.fbAuth && window.fbAuth.currentUser) ? window.fbAuth.currentUser.uid : null;
    }
    function _isAdminUser() { return window.isAdmin === true || !!(window.EmpState && window.EmpState.isAdmin === true); }
    function _canStartPoll() { return !window.isGuest && !!_myUid() && _fbOk(); }

    var TOPIC_LIST = ['general', 'politics', 'music', 'medicine', 'science', 'epidemic', 'disaster'];

    function _closeCreateModal() {
        var ov = document.getElementById('emp-poll-create-ov');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    }

    /* FEATURE (2026-09-27 — "make Data collection more robust and advanced
       for professional, institutions, organizations"): shared markup for
       the extra metadata a serious survey/research form needs beyond the
       question list itself — who's collecting it, why, a deadline/target
       so progress is trackable, a way for a respondent to reach the
       collector, an anonymity toggle, and a short consent/data-use note
       shown to respondents before they answer. Used by both the create
       modal and the edit modal so the two stay in lock-step; the caller
       is responsible for reading these back out by id on submit (see
       _readCollectDetails below). */
    function _collectDetailsFieldsHtml(inputCss, data) {
        data = data || {};
        var purpose = data.purpose || '';
        var PURPOSES = [
            ['research', 'Research'], ['survey', 'Survey'],
            ['documentation', 'Documentation'], ['project', 'Project'], ['other', 'Other']
        ];
        return (
            '<div style="border-top:1px dashed rgba(10,14,39,0.14);margin:2px 0 12px;padding-top:12px;">'
            + '<div style="font-weight:800;font-size:0.82rem;margin-bottom:2px;color:#1B2B8B;">Data collection details</div>'
            + '<div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:8px;">Optional, but recommended for institutional or research use — shown to respondents on the form.</div>'
            + '<input type="text" id="emp-poll-collector-name" maxlength="120" placeholder="Organization or individual collecting this data" value="' + _esc(data.collectorName || '') + '" style="' + inputCss + 'margin-bottom:8px;">'
            + '<select id="emp-poll-purpose" style="' + inputCss + 'margin-bottom:8px;">'
            + '<option value="">Purpose of data collection\u2026</option>'
            + PURPOSES.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === purpose ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('')
            + '</select>'
            + '<input type="text" id="emp-poll-purpose-other" maxlength="120" placeholder="Describe the purpose" value="' + _esc(data.purposeOther || '') + '" style="' + inputCss + 'margin-bottom:8px;' + (purpose === 'other' ? '' : 'display:none;') + '">'
            + '<div style="display:flex;gap:8px;margin-bottom:8px;">'
            + '<div style="flex:1;"><label style="display:block;font-size:0.7rem;color:var(--text-muted);margin-bottom:3px;">Collection closes by (optional)</label>'
            + '<input type="date" id="emp-poll-deadline" value="' + _esc(data.deadline || '') + '" style="' + inputCss + '"></div>'
            + '<div style="flex:1;"><label style="display:block;font-size:0.7rem;color:var(--text-muted);margin-bottom:3px;">Target no. of responses (optional)</label>'
            + '<input type="number" id="emp-poll-target" min="1" max="1000000" value="' + (data.targetResponses ? _esc(String(data.targetResponses)) : '') + '" style="' + inputCss + '"></div>'
            + '</div>'
            + '<input type="email" id="emp-poll-contact-email" maxlength="150" placeholder="Contact email for inquiries (optional)" value="' + _esc(data.contactEmail || '') + '" style="' + inputCss + 'margin-bottom:8px;">'
            + '<textarea id="emp-poll-consent-note" rows="2" maxlength="500" placeholder="Consent / data-use note shown to respondents before they answer (optional)" style="' + inputCss + 'resize:vertical;margin-bottom:8px;">' + _esc(data.consentNote || '') + '</textarea>'
            + '<label style="display:flex;align-items:center;gap:8px;font-size:0.82rem;font-weight:600;cursor:pointer;">'
            + '<input type="checkbox" id="emp-poll-anonymous" style="width:16px;height:16px;"' + (data.anonymous ? ' checked' : '') + '>'
            + 'Collect responses anonymously (hide respondent identity in results)'
            + '</label>'
            + '</div>'
        );
    }

    /* Wires the purpose <select>'s "Other" reveal and returns a reader
       function that pulls the final values back out of `ov` on submit. */
    function _wireCollectDetailsFields(ov) {
        var purposeSel = ov.querySelector('#emp-poll-purpose');
        var otherInput = ov.querySelector('#emp-poll-purpose-other');
        if (purposeSel && otherInput) {
            purposeSel.addEventListener('change', function () {
                otherInput.style.display = (purposeSel.value === 'other') ? 'block' : 'none';
            });
        }
        return function readCollectDetails() {
            var purposeVal = purposeSel ? purposeSel.value : '';
            var targetRaw = ov.querySelector('#emp-poll-target') ? ov.querySelector('#emp-poll-target').value : '';
            var targetNum = parseInt(targetRaw, 10);
            return {
                collectorName: (ov.querySelector('#emp-poll-collector-name').value || '').trim() || null,
                purpose: purposeVal || null,
                purposeOther: (purposeVal === 'other' ? (otherInput.value || '').trim() : '') || null,
                deadline: (ov.querySelector('#emp-poll-deadline').value || '') || null,
                targetResponses: (targetNum > 0 ? targetNum : null),
                contactEmail: (ov.querySelector('#emp-poll-contact-email').value || '').trim() || null,
                consentNote: (ov.querySelector('#emp-poll-consent-note').value || '').trim() || null,
                anonymous: !!(ov.querySelector('#emp-poll-anonymous') && ov.querySelector('#emp-poll-anonymous').checked)
            };
        };
    }

    function _openCreateModal() {
        if (!_canStartPoll()) { _notify('Please sign in to start a poll.', 'warning'); return; }
        _closeCreateModal();
        var ov = document.createElement('div');
        ov.id = 'emp-poll-create-ov';
        ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(10,14,39,0.55);display:flex;align-items:flex-end;justify-content:center;';
        var inputCss = 'width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid rgba(10,14,39,0.18);font-size:0.9rem;background:#fff;color:#0a0e27;';
        var typeBtnCss = 'flex:1;text-align:left;padding:10px 12px;border-radius:10px;background:#fff;color:#0a0e27;cursor:pointer;';
        ov.innerHTML =
            '<div style="background:#fff;color:#0a0e27;width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:20px 18px 24px;max-height:92vh;overflow:auto;box-sizing:border-box;">'
            + '<div class="emp-poll-modal-grabber"></div>'
            + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
            + '<div style="font-weight:800;font-size:1.05rem;">Start a poll</div>'
            + '<button type="button" id="emp-poll-cancel-x" style="border:none;background:transparent;font-size:1.3rem;cursor:pointer;color:#0a0e27;" aria-label="Close">\u2715</button></div>'
            /* FEATURE (2026-09-26 — "collect data like Google form... create
               a section as an option for that"): a poll-type toggle above
               everything else. Defaults to Multiple choice so a poll created
               before this change and one created right after it, with no
               type touched at all, behave identically. */
            + '<div style="display:flex;gap:8px;margin-bottom:10px;">'
            + '<button type="button" id="emp-poll-type-choice" style="' + typeBtnCss + 'border:2px solid #1B2B8B;">' + _icon('chart') + '<div style="font-weight:700;font-size:0.85rem;margin-top:4px;">Multiple choice</div>'
            + '<div style="font-size:0.72rem;color:#6b7280;">Pick from options</div></button>'
            + '<button type="button" id="emp-poll-type-collect" style="' + typeBtnCss + 'border:1px solid rgba(10,14,39,0.15);">' + _icon('form') + '<div style="font-weight:700;font-size:0.85rem;margin-top:4px;">Data collection</div>'
            + '<div style="font-size:0.72rem;color:#6b7280;">Free-text answers</div></button>'
            + '</div>'
            + '<input type="text" id="emp-poll-q" maxlength="200" placeholder="Your question, e.g. Which issue matters most to you?" style="' + inputCss + 'margin-bottom:10px;">'
            + '<select id="emp-poll-topic" style="' + inputCss + 'margin-bottom:10px;">'
            + TOPIC_LIST.map(function (t) { return '<option value="' + t + '">' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>'; }).join('')
            + '</select>'
            + '<div id="emp-poll-choice-fields">'
            + '<div id="emp-poll-opts" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;"></div>'
            + '<button type="button" id="emp-poll-add-opt" style="border:none;background:rgba(10,14,39,0.06);color:#0a0e27;padding:8px 14px;border-radius:10px;font-weight:700;font-size:0.8rem;cursor:pointer;margin-bottom:14px;">+ Add option</button>'
            + '</div>'
            /* Data-collection builder — each row is a question text input
               paired with an answer-type select (short answer/paragraph),
               same "type it in, tap + Add" shape as the options builder
               above so the two feel like one consistent pattern rather than
               a bolted-on second form. Hidden until "Data collection" is
               picked. */
            + '<div id="emp-poll-collect-fields" style="display:none;">'
            + '<div id="emp-poll-questions" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;"></div>'
            + '<button type="button" id="emp-poll-add-question" style="border:none;background:rgba(10,14,39,0.06);color:#0a0e27;padding:8px 14px;border-radius:10px;font-weight:700;font-size:0.8rem;cursor:pointer;margin-bottom:14px;">+ Add question</button>'
            + _collectDetailsFieldsHtml(inputCss)
            + '</div>'
            + '<div id="emp-poll-err" style="color:#e53935;font-size:0.8rem;min-height:1.1em;margin-bottom:8px;"></div>'
            + '<div style="display:flex;gap:10px;">'
            + '<button type="button" id="emp-poll-cancel" style="flex:1;border:none;background:rgba(10,14,39,0.08);color:#0a0e27;padding:12px;border-radius:12px;font-weight:700;cursor:pointer;">Cancel</button>'
            + '<button type="button" id="emp-poll-submit" style="flex:2;border:none;background:#1B2B8B;color:#fff;padding:12px;border-radius:12px;font-weight:800;cursor:pointer;">Post poll</button>'
            + '</div></div>';
        document.body.appendChild(ov);

        var optsWrap = ov.querySelector('#emp-poll-opts');
        function addOpt() {
            /* FIX (2026-09-27 — "increase the multi choice ... to unlimited
               in case of those who want to collect more information"): was
               capped at 6. Not raised to a literal Infinity — Firestore
               caps a single document at 1MiB, and this poll doc holds every
               option inline — so 50 (matching the per-question choice cap
               just below and the raised Firestore rule in
               firebase-rules.js) is the effectively-unlimited ceiling that
               still leaves comfortable headroom under that hard limit even
               with every option at its own 80-char max. */
            if (optsWrap.children.length >= 50) return;
            var i = document.createElement('input');
            i.type = 'text'; i.maxLength = 80; i.className = 'emp-poll-opt-input';
            i.placeholder = 'Option ' + (optsWrap.children.length + 1);
            i.style.cssText = inputCss;
            optsWrap.appendChild(i);
        }
        addOpt(); addOpt();
        ov.querySelector('#emp-poll-add-opt').addEventListener('click', addOpt);

        var qWrap = ov.querySelector('#emp-poll-questions');
        function addQuestion() {
            // FIX (2026-09-27 — same ask, "and data questions"): was capped
            // at 10; same Firestore-1MiB-document reasoning as addOpt above
            // sets the new ceiling at 100 (matches the raised Firestore
            // rule) rather than a literal unlimited.
            if (qWrap.children.length >= 100) return;
            var row = _buildQuestionRow(qWrap, null, inputCss);
            row.querySelector('.emp-poll-question-input').placeholder = 'Question ' + qWrap.children.length + ', e.g. What\u2019s your name?';
        }
        addQuestion();
        ov.querySelector('#emp-poll-add-question').addEventListener('click', addQuestion);
        var readCollectDetails = _wireCollectDetailsFields(ov);

        var selectedType = 'choice';
        var choiceBtn = ov.querySelector('#emp-poll-type-choice');
        var collectBtn = ov.querySelector('#emp-poll-type-collect');
        function setType(t) {
            selectedType = t;
            choiceBtn.style.border = (t === 'choice') ? '2px solid #1B2B8B' : '1px solid rgba(10,14,39,0.15)';
            collectBtn.style.border = (t === 'collect') ? '2px solid #1B2B8B' : '1px solid rgba(10,14,39,0.15)';
            ov.querySelector('#emp-poll-choice-fields').style.display = (t === 'collect') ? 'none' : 'block';
            ov.querySelector('#emp-poll-collect-fields').style.display = (t === 'collect') ? 'block' : 'none';
        }
        choiceBtn.addEventListener('click', function () { setType('choice'); });
        collectBtn.addEventListener('click', function () { setType('collect'); });

        ov.querySelector('#emp-poll-cancel').addEventListener('click', _closeCreateModal);
        ov.querySelector('#emp-poll-cancel-x').addEventListener('click', _closeCreateModal);
        ov.addEventListener('click', function (e) { if (e.target === ov) _closeCreateModal(); });

        ov.querySelector('#emp-poll-submit').addEventListener('click', function () {
            var btn = this;
            var errEl = ov.querySelector('#emp-poll-err');
            var question = (ov.querySelector('#emp-poll-q').value || '').trim();
            var topic = ov.querySelector('#emp-poll-topic').value;
            if (question.length < 5) { errEl.textContent = 'Write your question first (at least 5 characters).'; return; }
            if (!_canStartPoll()) { errEl.textContent = 'Please sign in to start a poll.'; return; }

            var stamp = Date.now().toString(36);
            var us = window.userState || {};
            var basePayload = {
                question: question,
                topic: TOPIC_LIST.indexOf(topic) !== -1 ? topic : 'general',
                status: 'open',
                createdBy: us.id || null,
                createdByName: us.fullName || us.username || 'Member',
                createdByUid: _myUid(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                closedAt: null
            };
            var payload;

            if (selectedType === 'collect') {
                var qTexts = []; var badChoices = false;
                Array.prototype.forEach.call(qWrap.querySelectorAll('.emp-poll-question-row'), function (row, i) {
                    var q = _readQuestionRow(row, i, stamp);
                    if (!q) return;
                    if ((q.answerType === 'single_choice' || q.answerType === 'multi_choice') && q.choices.length < 2) badChoices = true;
                    qTexts.push(q);
                });
                if (qTexts.length < 1) { errEl.textContent = 'Add at least one question.'; return; }
                if (badChoices) { errEl.textContent = 'Choice questions need at least two choices.'; return; }
                payload = Object.assign({}, basePayload, { type: 'collect', questions: qTexts, totalResponses: 0 }, readCollectDetails());
            } else {
                var seen = {}; var texts = [];
                Array.prototype.forEach.call(ov.querySelectorAll('.emp-poll-opt-input'), function (inp) {
                    var t = (inp.value || '').trim(); var k = t.toLowerCase();
                    if (t && !seen[k]) { seen[k] = 1; texts.push(t); }
                });
                if (texts.length < 2) { errEl.textContent = 'Add at least two different options.'; return; }
                payload = Object.assign({}, basePayload, {
                    type: 'choice',
                    options: texts.map(function (t, i) { return { id: 'opt_' + i + '_' + stamp, text: t, votes: 0 }; }),
                    totalVotes: 0
                });
            }

            errEl.textContent = '';
            btn.disabled = true; btn.textContent = 'Posting\u2026';
            window.fbDb.collection('polls').add(payload).then(function () {
                _closeCreateModal();
                _notify('Your poll is live.', 'success');
                _loadOpenPolls(true);
            }).catch(function (err) {
                btn.disabled = false; btn.textContent = 'Post poll';
                errEl.textContent = 'Could not post the poll: ' + ((err && err.message) || 'try again.');
            });
        });
    }

    function _headerHtml() {
        return '<div class="card" style="margin-bottom:14px;"><div class="card-content" style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;">'
            + '<div style="display:flex;align-items:center;gap:10px;min-width:0;">'
            + '<span style="width:34px;height:34px;border-radius:10px;background:var(--nav-accent,#00D4AA);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;">' + _icon('chart') + '</span>'
            + '<div style="min-width:0;"><div style="font-weight:800;font-size:0.92rem;">Community Polls</div>'
            + '<div id="emp-polls-sub" style="font-size:0.74rem;color:var(--text-muted);">Loading\u2026</div></div></div>'
            + '<button type="button" id="emp-poll-start-btn" class="btn btn-small btn-accent" style="white-space:nowrap;">' + _icon('plus') + ' Start a poll</button>'
            + '</div></div>'
            + '<div id="emp-polls-list" class="emp-polls-scroll"></div>';
    }

    function _setSub(text) {
        var el = document.getElementById('emp-polls-sub');
        if (el) el.textContent = text;
    }

    /* FIX (2026-09-28 — "the poll takes time to load ... even after others
       have loaded it still shows 'couldn't load at this time'"). Three
       separate problems in the old single-shot loader:
         1. STALE RESULT RACE. Four different events (section-change,
            init-done, firebase-ready, the sidebar) each kick off a load, so
            several overlapped. A first request that failed slowly (typical
            on a weak mobile connection — Firestore's "client is offline"/
            unavailable error can take many seconds to surface) could
            settle AFTER a later request had already rendered the polls, and
            its .catch overwrote the good "N open polls" line with
            "Couldn't load polls right now". Every load now carries a
            sequence number and only the newest one is allowed to touch the
            UI, success or failure.
         2. NO RETRY. One transient failure was final until some unrelated
            event happened to re-trigger a load. Failures now retry with
            backoff, and again the moment the browser reports it's back
            online / the tab becomes visible; only after the retries are
            exhausted does the header show an error — and then as a
            tappable "Tap to retry", never a dead end. If polls are already
            on screen, a failed background refresh leaves them alone.
         3. SLOW FIRST PAINT. Nothing appeared until the fetch finished, and
            the fixed 500–900ms start delays plus a silent bail-out when
            Firebase wasn't ready yet added to it. The rail now shows
            same-size skeleton cards immediately, waits for Firebase by
            polling briefly rather than returning, and (see _mountPollCard)
            each card paints from the list data it was handed instead of
            re-fetching it. */
    var _pollsLoadSeq = 0;
    var _pollsLoadedAt = 0;
    var _pollsHasCards = false;
    var _pollsRetryTimer = null;
    var _POLL_RETRY_DELAYS = [1200, 2500, 5000, 9000];
    var _pollsPaintedKey = '';
    var _pollsRenderedSeq = 0;

    /* FIX (2026-09-29 — "Community Polls takes too much time to load"; the
       header sat on "Loading…" with skeleton cards). Three more causes:
         1. MISSING COMPOSITE INDEX. where(status==open)+orderBy(createdAt)
            needs a Firestore composite index. When it isn't deployed the
            query fails with `failed-precondition` — and every retry then
            failed the same way, burning ~18s of backoff before the error
            showed. It now falls straight back to an un-ordered query
            (no index needed) and sorts newest-first on the device.
         2. NOTHING FROM CACHE. Persistence is on (index.html), yet every
            visit waited for the network before showing a single poll. The
            list is now read from the local cache first and painted at
            once; the server result then only repaints if the set of open
            polls actually changed (the cards keep updating live through
            their own listeners), so there is no flicker.
         3. HUNG REQUESTS. On a weak connection a get() can hang for a very
            long time before erroring. The server read is capped at 8s so
            the retry/backoff path starts promptly instead. Also polls for
            Firebase readiness every 250ms (was 500ms). */
    function _tsMs(v) {
        try { if (v && typeof v.toMillis === 'function') return v.toMillis(); if (v) return new Date(v).getTime() || 0; } catch (e) {}
        return 0;
    }
    function _fetchOpenPolls(getOpts) {
        var col = window.fbDb.collection('polls').where('status', '==', 'open');
        return col.orderBy('createdAt', 'desc').limit(10).get(getOpts).catch(function (err) {
            if (err && err.code === 'failed-precondition') {
                return col.limit(30).get(getOpts).then(function (snap) {
                    var docs = snap.docs.slice().sort(function (a, b) { return _tsMs(b.get('createdAt')) - _tsMs(a.get('createdAt')); }).slice(0, 10);
                    return { empty: !docs.length, size: docs.length, forEach: function (fn) { docs.forEach(fn); } };
                });
            }
            throw err;
        });
    }
    function _withTimeout(p, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject({ code: 'timeout', message: 'Request timed out' }); }, ms);
            p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }

    function _pollSkeletonHtml() {
        var one = '<div class="emp-poll-card-wrap emp-poll-skeleton"><div class="card emp-poll-card"><div class="card-content" style="padding:16px;">'
            + '<div class="emp-sk-line" style="width:45%;height:14px;"></div>'
            + '<div class="emp-sk-line" style="width:90%;height:18px;margin-top:14px;"></div>'
            + '<div class="emp-sk-line" style="height:38px;margin-top:14px;"></div>'
            + '<div class="emp-sk-line" style="height:38px;margin-top:8px;"></div>'
            + '<div class="emp-sk-line" style="height:38px;margin-top:8px;"></div>'
            + '</div></div></div>';
        return one + one;
    }

    function _loadOpenPolls(force, attempt) {
        attempt = attempt || 0;
        // Several events fire this within a second of each other on a normal
        // page load; a fresh successful render makes the extra ones pointless.
        // (Checked BEFORE bumping the sequence so a skipped call can't
        // invalidate a request that's genuinely in flight.)
        if (force !== true && attempt === 0 && _pollsHasCards && Date.now() - _pollsLoadedAt < 4000) return;
        var seq = ++_pollsLoadSeq;
        if (_pollsRetryTimer) { clearTimeout(_pollsRetryTimer); _pollsRetryTimer = null; }

        // Firebase not up yet: wait for it (bounded) instead of silently giving up.
        if (!_fbOk()) {
            if (attempt < 80) { _pollsRetryTimer = setTimeout(function () { if (seq === _pollsLoadSeq) _loadOpenPolls(true, attempt + 1); }, 250); return; }
            // ~20s and Firebase still isn't up: say so (tappable) instead of sitting on "Loading…" forever.
            var _m = document.getElementById('emp-polls-sub');
            if (_m && !_pollsHasCards) { _m.textContent = 'Couldn\u2019t connect — tap to retry.'; _m.setAttribute('data-retry', '1'); _m.style.cursor = 'pointer'; }
            return;
        }
        var mount = _ensureMount();
        if (!mount) {
            if (attempt < 80) _pollsRetryTimer = setTimeout(function () { if (seq === _pollsLoadSeq) _loadOpenPolls(true, attempt + 1); }, 250);
            return;
        }

        if (!mount.getAttribute('data-built')) {
            mount.innerHTML = _headerHtml();
            mount.setAttribute('data-built', '1');
            var startBtn = document.getElementById('emp-poll-start-btn');
            if (startBtn) startBtn.addEventListener('click', _openCreateModal);
            var subEl = document.getElementById('emp-polls-sub');
            if (subEl) subEl.addEventListener('click', function () { if (subEl.getAttribute('data-retry')) _loadOpenPolls(true, 0); });
        }
        var list = document.getElementById('emp-polls-list');
        if (!list) return;

        if (!_pollsHasCards) {
            list.innerHTML = _pollSkeletonHtml();
            _setSub('Loading\u2026');
        }

        var _renderPolls = function (snap) {
                /* 2026-09-29 (regression fix — "reversed back to the bad state"): a slow-but-successful
                   read used to be thrown away because a retry had already bumped the sequence number, so on
                   a slow connection the poll list could be re-requested over and over and never shown.
                   A result is now dropped only if a NEWER request has already painted the list. */
                if (seq < _pollsRenderedSeq) return;
                _pollsRenderedSeq = seq;
                // Same open polls already on screen (e.g. painted from cache a moment ago): leave the
                // cards alone — their own listeners keep them live — and just refresh the header line.
                var _keyParts = []; snap.forEach(function (d) { _keyParts.push(d.id); });
                var _key = _keyParts.join('|');
                if (_pollsHasCards && _key && _key === _pollsPaintedKey) {
                    _pollsLoadedAt = Date.now();
                    var _se = document.getElementById('emp-polls-sub'); if (_se) _se.removeAttribute('data-retry');
                    _setSub(snap.size + ' open poll' + (snap.size === 1 ? '' : 's') + ' \u2022 tap a card to open');
                    return;
                }
                _pollsPaintedKey = _key;
                // Drop the previous cards' realtime listeners before repainting.
                Object.keys(_pollWidgets).forEach(function (id) {
                    var st = _pollWidgets[id];
                    if (st && st.detailMode) return; // never tear down an open full-view overlay
                    if (st && typeof st.unsub === 'function') { try { st.unsub(); } catch (e) {} }
                    if (st && typeof st.commentsUnsub === 'function') { try { st.commentsUnsub(); } catch (e) {} }
                    if (st && st.replyUnsubs) {
                        Object.keys(st.replyUnsubs).forEach(function (rid) { try { st.replyUnsubs[rid](); } catch (e) {} });
                    }
                    if (st) _destroyCharts(st);
                    if (st) { _stopPollViewerCountListener(st); _stopPollViewerPresence(st); }
                    delete _pollWidgets[id];
                });
                list.innerHTML = '';
                var subEl = document.getElementById('emp-polls-sub');
                if (subEl) subEl.removeAttribute('data-retry');
                _pollsLoadedAt = Date.now();
                if (snap.empty) { _pollsHasCards = false; _setSub('No open polls yet — start the first one.'); return; }
                _pollsHasCards = true;
                _setSub(snap.size + ' open poll' + (snap.size === 1 ? '' : 's') + ' \u2022 tap a card to open');
                snap.forEach(function (doc) { _mountPollCard(list, doc.id, { initialData: doc.data() }); });
        };
        // Instant paint from the local cache (first load of this view only), while the server read runs.
        if (!_pollsHasCards) {
            _fetchOpenPolls({ source: 'cache' }).then(function (cs) {
                if (seq !== _pollsLoadSeq || _pollsHasCards || !cs || cs.empty) return;
                _renderPolls(cs);
            }).catch(function () { /* nothing cached yet — the server read below handles it */ });
        }
        // Soft timeout: after 8s with nothing on screen, start another attempt IN PARALLEL — the first
        // request is not cancelled, so whichever one answers first paints the polls.
        var _slowTimer = setTimeout(function () {
            if (seq === _pollsLoadSeq && !_pollsHasCards && attempt < _POLL_RETRY_DELAYS.length) _loadOpenPolls(true, attempt + 1);
        }, 8000);
        _fetchOpenPolls()
            .then(function (snap) { clearTimeout(_slowTimer); _renderPolls(snap); })
            .catch(function (err) {
                clearTimeout(_slowTimer);
                if (seq !== _pollsLoadSeq) return; // stale failure — must not overwrite a newer result
                console.warn('[LivePolls] could not load open polls (attempt ' + (attempt + 1) + '):', err && err.code, err && err.message);
                if (attempt < _POLL_RETRY_DELAYS.length) {
                    _pollsRetryTimer = setTimeout(function () { if (seq === _pollsLoadSeq) _loadOpenPolls(true, attempt + 1); }, _POLL_RETRY_DELAYS[attempt]);
                    return;
                }
                if (_pollsHasCards) return; // background refresh failed; the polls already on screen are still good
                list.innerHTML = '';
                var subEl = document.getElementById('emp-polls-sub');
                if (subEl) { subEl.textContent = 'Couldn\u2019t load polls — tap to retry.'; subEl.setAttribute('data-retry', '1'); subEl.style.cursor = 'pointer'; }
            });
    }

    // A dropped connection is the usual cause of the failure above — retry the
    // moment it comes back, and when the tab is foregrounded with nothing shown.
    window.addEventListener('online', function () { _loadOpenPolls(true, 0); });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && !_pollsHasCards) _loadOpenPolls(true, 0);
    });

    /* BUGFIX (2026-09-27 — "closed icon and edit/delete kebab missing"):
       _paintPoll recomputes canManage (= poll creator or admin) fresh on
       every call, but a mounted card only repaints when its OWN Firestore
       doc changes (a vote, a close) — never when the viewer's OWN identity
       resolves. window.fbAuth.currentUser (auth restore) and window.isAdmin
       (an extra async Firestore role lookup — see app-fix-final.js) can
       both settle well after this widget's first paint on a slow
       connection, so the poll's own creator can briefly — or, if no one
       votes again, indefinitely — see their own poll rendered as if they
       had no rights over it at all: no Close pill, no ⋮ menu. Forcing a
       repaint of every already-mounted card the moment permissions become
       known fixes that without waiting on poll data to change. */
    /* 2026-09-28 ("closed and edit/delete kebab missing"): the timed
       self-heal in _mountPollCard only re-checks for ~10s after a card
       mounts, and now that rail cards paint immediately from the list
       query (before sign-in / the admin lookup have resolved) a slow
       connection can easily outlast it — leaving the poll's owner or an
       admin without Close / ⋮. This cheap, permanent check compares what
       each on-screen rail card was last painted with against what the
       viewer is allowed to do RIGHT NOW and repaints only on a difference,
       in either direction, so the controls appear as soon as permissions
       resolve however long that takes. Rail cards only — a full-view form
       being filled in is never repainted from here. */
    setInterval(function () {
        Object.keys(_pollWidgets).forEach(function (id) {
            var st = _pollWidgets[id];
            if (!st || st.detailMode || !st.el || !st.lastData || !document.body.contains(st.el)) return;
            if (_canManagePoll(st.lastData) !== st._paintedCanManage) _paintPoll(st.el, st.pollId || id, st.lastData, st);
        });
    }, 1500);

    window._empRefreshPollPermissions = function () {
        Object.keys(_pollWidgets).forEach(function (id) {
            var st = _pollWidgets[id];
            // full-view entries are skipped: repainting would wipe a form being filled in
            if (st && !st.detailMode && st.el && st.lastData) _paintPoll(st.el, st.pollId || id, st.lastData, st);
        });
    };
    // Real (non-anonymous) sign-in — dispatched by app-fixes.js's own
    // fbAuth.onAuthStateChanged observer once the real Firebase SDK is up.
    window.addEventListener('empyrean:auth-ready', function () {
        setTimeout(window._empRefreshPollPermissions, 50);
    });
    // Belt-and-braces: also listen directly, in case a real fbAuth is
    // already attached before app-fixes.js's observer registers.
    if (window.fbAuth && typeof window.fbAuth.onAuthStateChanged === 'function') {
        window.fbAuth.onAuthStateChanged(function () { window._empRefreshPollPermissions(); });
    }
    // Extra safety net (2026-09-27): a warm/restored session can finish
    // initializeApp() — and, a beat later, the chief-login admin lookup in
    // app-fix-final.js — without ever touching fbAuth.onAuthStateChanged or
    // dispatching empyrean:auth-ready. empyrean-init-done fires at the end
    // of every initializeApp() call regardless of path, so re-checking
    // permissions there too (and once more a couple seconds later, once the
    // admin Firestore lookup has had time to resolve) closes that gap.
    document.addEventListener('empyrean-init-done', function () {
        setTimeout(window._empRefreshPollPermissions, 300);
        setTimeout(window._empRefreshPollPermissions, 2500);
    });

    /* Sidebar "Polls" entry (app-nav.js) lands here: refresh, then scroll the
       polls area into view. */
    window._empOpenPolls = function () {
        _loadOpenPolls(true);
        var mount = _ensureMount();
        if (mount) setTimeout(function () { try { mount.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }, 250);
    };

    function _run() { setTimeout(_loadOpenPolls, 100); }

    document.addEventListener('empyrean-section-change', function (e) {
        if (e && e.detail && e.detail.section === 'dashboard') _run();
    });
    document.addEventListener('empyrean-init-done', function () { setTimeout(_loadOpenPolls, 200); });
    window.addEventListener('empyrean:firebase-ready', function () { setTimeout(_loadOpenPolls, 100); });

    console.log('[EmpFeed] ✅ Live Polls widget ready — open polls render above the community feed, click-to-vote with real-time progress bars.');

})();


/* ═══════════════════════════════════════════════════════════════
   SCHOLARSHIP PARTNER PORTAL — dashboard rail, details/apply modal, share
   (2026-09-28). Cards are pushed from Admin Panel → Scholarships
   (app-admin.js → initScholarshipManager) into the `scholarship_adverts`
   collection; this reads the live ones in real time and paints them into
   the static #dashboard-scholarship-container in index.html as a
   horizontally scrolling rail of premium thumbnails. Applications are
   stored one-per-account at scholarship_applications/{advertId}_{authUid}
   (see firebase-rules.js) and bump the advert's applicantCount inside a
   transaction so the slot counter and "slots full" state stay honest.
   ═══════════════════════════════════════════════════════════════ */
(function empyreanScholarshipRail() {
    'use strict';

    var COL_ADV = 'scholarship_adverts';
    var COL_APP = 'scholarship_applications';
    var _ads = [];
    var _unsub = null;
    var _deepLinkHandled = false;
    var _SVG = {
        share: 's|<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/>',
        link: 's|<path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7"/>',
        bank: 's|<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18"/>',
        check: 's|<circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/>',
        grad: 's|<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12.2V17c3 2.4 9 2.4 12 0v-4.8"/><path d="M22 10v6"/>',
        telegram: 'f|<path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>',
        whatsapp: 'f|<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>',
        facebook: 'f|<path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>',
        x: 'f|<path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/>',
        linkedin: 'f|<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>'
    };
    // Inline SVG (no Font Awesome dependency): the FA webfont/offline fallback has no glyph for
    // share-nodes, building-columns or circle-check, and draws a plane for Telegram / a speech
    // bubble for WhatsApp instead of the real logos.
    function _ico(n, size, extra) {
        var v = _SVG[n]; if (!v) return '';
        var fill = v.charAt(0) === 'f', inner = v.slice(2);
        return '<svg viewBox="0 0 24 24" width="' + (size || '1em') + '" height="' + (size || '1em') + '" ' + (fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"') + ' aria-hidden="true" focusable="false" style="display:inline-block;vertical-align:-0.15em;flex-shrink:0;' + (extra || '') + '">' + inner + '</svg>';
    }

    function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function _notify(m, t) { if (typeof window.showNotification === 'function') window.showNotification(m, t || 'info'); }
    function _pays(ad) { return Number(ad.studentPays) > 0 ? _money(ad.studentPays) : 'Free'; }

    /* FUNDING TIERS (2026-09-29 — "it's both fully funded and partial scholarships"): an advert whose
       funding type mentions both (Admin → Scholarships → "Full & Partial Funding") no longer shows the
       single Total / Sponsor pays / You pay split — that only describes ONE tier. It shows the two
       funding types instead, without amounts: fully funded and partially funded. Single-type adverts
       render exactly as before. */
    function _both(ad) { var t = String((ad && ad.fundingType) || ''); return /full/i.test(t) && /partial/i.test(t); }
    function _tiersHtml(ad, big) {
        // (2026-09-29) no amounts — just the two funding types (per the owner's request)
        var fs = big ? '0.88rem' : '0.82rem';
        function row(label, bg, fg, line) {
            return '<div style="display:flex;align-items:center;gap:10px;padding:9px 11px;background:#fff;border:1px solid #e5e9f2;border-radius:12px;">'
                + '<span style="flex:0 0 auto;background:' + bg + ';color:' + fg + ';font-weight:800;font-size:0.7rem;letter-spacing:.04em;text-transform:uppercase;padding:5px 10px;border-radius:999px;white-space:nowrap;">' + label + '</span>'
                + '<span style="font-size:' + fs + ';line-height:1.35;color:#1f2937;">' + line + '</span></div>';
        }
        return '<div style="margin:12px 0;padding:10px;background:#F4F6FB;border-radius:14px;display:flex;flex-direction:column;gap:8px;">'
            + row('Fully funded', '#dcfce7', '#15803d', 'Sponsor covers the whole fee')
            + row('Partially funded', '#fef3c7', '#b45309', 'Sponsor covers part of the fee')
            + '</div>';
    }

    function _money(n) { return '\u20A6' + Number(n || 0).toLocaleString('en-NG'); }
    function _pad(n) { return (n < 10 ? '0' : '') + n; }
    function _todayStr() { var d = new Date(); return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate()); }
    function _fmtDate(s) {
        if (!s) return 'Not set';
        var p = String(s).split('-');
        if (p.length !== 3) return String(s);
        var d = new Date(+p[0], +p[1] - 1, +p[2]);
        return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    function _daysBetween(a, b) {
        var pa = a.split('-'), pb = b.split('-');
        return Math.round((new Date(+pb[0], +pb[1] - 1, +pb[2]) - new Date(+pa[0], +pa[1] - 1, +pa[2])) / 86400000);
    }
    function _ms(v) {
        try { if (v && typeof v.toMillis === 'function') return v.toMillis(); if (v) return new Date(v).getTime() || 0; } catch (e) {}
        return 0;
    }
    function _find(id) { for (var i = 0; i < _ads.length; i++) if (_ads[i].id === id) return _ads[i]; return null; }
    function _signedIn() {
        var u = window.fbAuth && window.fbAuth.currentUser;
        return !!(u && !u.isAnonymous && !window.isGuest);
    }

    function _status(ad) {
        var t = _todayStr(), slots = Number(ad.slots) || 0, cnt = Number(ad.applicantCount) || 0;
        if (ad.startDate && t < ad.startDate) return { key: 'soon', label: 'Opens ' + _fmtDate(ad.startDate), canApply: false, btn: 'Not open yet' };
        if (ad.endDate && t > ad.endDate) return { key: 'closed', label: 'Closed', canApply: false, btn: 'Closed' };
        if (slots > 0 && cnt >= slots) return { key: 'full', label: 'Slots full', canApply: false, btn: 'Slots full' };
        var left = ad.endDate ? _daysBetween(t, ad.endDate) : 99;
        if (left <= 7) return { key: 'soonclose', label: left <= 0 ? 'Closes today' : left + (left === 1 ? ' day left' : ' days left'), canApply: true, btn: 'Apply now' };
        return { key: 'open', label: 'Applications open', canApply: true, btn: 'Apply now' };
    }


    /* ───────── rail ───────── */
    function _cardHtml(ad) {
        var st = _status(ad), slots = Number(ad.slots) || 0, cnt = Number(ad.applicantCount) || 0;
        var pct = slots > 0 ? Math.min(100, Math.round(cnt / slots * 100)) : 0;
        var left = slots > 0 ? Math.max(0, slots - cnt) : 0;
        return '<article class="emp-sch-card" style="flex:0 0 342px;max-width:94%;" data-id="' + _esc(ad.id) + '" tabindex="0" role="button" aria-label="Scholarship: ' + _esc(ad.title) + '">'
            + (ad.imageUrl ? '<img src="' + _esc(ad.imageUrl) + '" alt="" loading="lazy" style="display:block;width:100%;aspect-ratio:1004/866;object-fit:cover;">' : '')
            + '<div class="emp-sch-top">'
            +   '<div class="emp-sch-top-row"><span class="emp-sch-badge">' + _esc(ad.fundingType || 'Scholarship') + '</span>'
            +   '<span class="emp-sch-status emp-sch-st-' + st.key + '">' + _esc(st.label) + '</span></div>'
            +   '<div class="emp-sch-title">' + _esc(ad.title) + '</div>'
            +   '<div class="emp-sch-by">Sponsored by <b>' + _esc(ad.sponsor) + '</b></div>'
            + '</div>'
            + '<div class="emp-sch-body">'
            +   '<div class="emp-sch-inst">' + _ico('bank', '1em', 'color:#1B2B8B;') + ' ' + _esc(ad.institution) + '</div>'
            +   (_both(ad) ? _tiersHtml(ad, false) : ('<div class="emp-sch-fin">'
            +     '<div><small>Total fee</small><b>' + _money(ad.totalFee) + '</b></div>'
            +     '<div class="g"><small>Sponsor pays</small><b>' + _money(ad.sponsorPays) + '</b></div>'
            +     '<div class="r"><small>You pay</small><b>' + _pays(ad) + '</b></div>'
            +   '</div>'))
            +   (slots > 0 ? '<div><div class="emp-sch-slots-t"><span>' + cnt + ' applied</span><span>' + left + ' of ' + slots + ' slots left</span></div><div class="emp-sch-bar"><i style="width:' + pct + '%"></i></div></div>' : '')
            +   '<div class="emp-sch-dl"><i class="far fa-calendar-check"></i> Deadline: <b>' + _esc(_fmtDate(ad.endDate)) + '</b></div>'
            + '</div>'
            + '<div class="emp-sch-foot">'
            +   '<button type="button" class="emp-sch-btn emp-sch-btn-ghost" data-act="details">View details</button>'
            +   '<button type="button" class="emp-sch-btn emp-sch-btn-primary" data-act="apply"' + (st.canApply ? '' : ' disabled') + '>' + _esc(st.btn) + '</button>'
            + '</div></article>';
    }

    function _renderRail() {
        var box = document.getElementById('dashboard-scholarship-container');
        var track = document.getElementById('dashboard-scholarship-track');
        if (!box || !track) return;
        // (2026-09-28) A scholarship whose slots are all taken, or whose closing date has passed,
        // drops off the rail by itself — no admin action needed. It stays in _ads on purpose so a
        // shared ?scholarship= link still opens its details (showing Closed / Slots full).
        var vis = _ads.filter(function (ad) { var k = _status(ad).key; return k !== 'closed' && k !== 'full'; });
        if (!vis.length) { box.style.display = 'none'; track.innerHTML = ''; return; }
        box.style.display = '';
        var cnt = document.getElementById('dashboard-scholarship-count');
        if (cnt) cnt.textContent = vis.length + (vis.length === 1 ? ' open call' : ' calls');
        track.innerHTML = vis.map(_cardHtml).join('');
        if (!track._empWired) {
            track._empWired = true;
            track.addEventListener('click', function (e) {
                var card = e.target.closest ? e.target.closest('.emp-sch-card') : null;
                if (!card) return;
                var btn = e.target.closest('[data-act]');
                if (btn && btn.disabled) return;
                var act = btn ? btn.getAttribute('data-act') : 'details';
                _openModal(card.getAttribute('data-id'), act === 'apply' ? 'form' : 'details');
            });
            track.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                var card = e.target.classList && e.target.classList.contains('emp-sch-card') ? e.target : null;
                if (card) { e.preventDefault(); _openModal(card.getAttribute('data-id'), 'details'); }
            });
        }
    }

    function _start() {
        if (_unsub) return;
        if (!(window.fbDb && window._firebaseLoaded)) return;
        try {
            _unsub = window.fbDb.collection(COL_ADV).where('active', '==', true).onSnapshot(function (snap) {
                var list = [];
                snap.forEach(function (doc) { var d = doc.data() || {}; d.id = doc.id; list.push(d); });
                list.sort(function (a, b) { return _ms(b.pushedAt || b.createdAt) - _ms(a.pushedAt || a.createdAt); });
                _ads = list;
                _renderRail();
                if (!_deepLinkHandled) {
                    _deepLinkHandled = true;
                    var m = /[?&]scholarship=([^&#]+)/.exec(window.location.search || '');
                    if (m) { var ad = _find(decodeURIComponent(m[1])); if (ad) setTimeout(function () { _openModal(ad.id, 'details'); }, 400); }
                }
            }, function (err) {
                console.warn('[EmpScholarship] live listener failed:', err && err.message);
                _unsub = null;
            });
        } catch (e) { console.warn('[EmpScholarship] start failed:', e && e.message); _unsub = null; }
    }

    /* ───────── modal ───────── */
    function _closeModal() {
        var ov = document.getElementById('emp-sch-modal');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    }

    /* ADMISSION SUMMARY (2026-09-29 — "incorporate the RECTEM admission summary + bio-data capture into
       the scholarship system"). Shown in the details modal and used to drive the application form's
       ND/HND, study-mode and course fields whenever the scholarship's institution is RECTEM. Any other
       institution keeps the plain course text box. Edit the lists here if RECTEM changes them. */
    var _ND_COURSES = ['Electrical/Electronics Engineering', 'Accountancy', 'Computer Engineering', 'Business Administration & Management', 'Estate Management & Valuation', 'Science Laboratory Technology', 'Computer Science', 'Quantity Surveying', 'Civil Engineering', 'Architectural Technology'];
    var _HND_COURSES = ['Business Administration & Management', 'Accountancy', 'Estate Management & Valuation', 'Networking & Cloud Computing', 'Software & Web Development', 'Quantity Surveying', 'Architectural Technology', 'Microbiology', 'Biochemistry', 'Chemistry', 'Environmental Biology'];
    function _isRectem(ad) { return /rectem/i.test(String((ad && ad.institution) || '')); }

    function _admissionHtml(ad) {
        if (!_isRectem(ad)) return '';
        var sec = 'margin:8px 0;background:#F4F6FB;border-radius:10px;padding:10px 12px;';
        var sm = 'cursor:pointer;font-weight:800;color:#1B2B8B;';
        var ul = 'margin:8px 0 2px;padding-left:18px;';
        function li(a) { return a.map(function (x) { return '<li>' + _esc(x) + '</li>'; }).join(''); }
        return '<div class="emp-sch-adm" style="margin:12px 0 4px;">'
            + '<div style="font-weight:800;font-size:0.95rem;margin-bottom:2px;">\uD83C\uDF93 Admission summary \u2013 RECTEM</div>'
            + '<details open style="' + sec + '"><summary style="' + sm + '">National Diploma (ND) requirements</summary><ul style="' + ul + '">'
            +   '<li>5 credit passes (English, Mathematics + 3 relevant subjects) in O\u2019Level exams (WAEC, NECO, GCE, NABTEB) in not more than 2 sittings.</li>'
            +   '<li>JAMB required.</li></ul></details>'
            + '<details style="' + sec + '"><summary style="' + sm + '">Higher National Diploma (HND) requirements</summary><ul style="' + ul + '">'
            +   '<li>A relevant ND (minimum lower credit).</li><li>One year industrial experience.</li></ul></details>'
            + '<details style="' + sec + '"><summary style="' + sm + '">ND programmes (Full-Time &amp; Part-Time)</summary><ul style="' + ul + '">' + li(_ND_COURSES) + '</ul></details>'
            + '<details style="' + sec + '"><summary style="' + sm + '">HND programmes (Full-Time only)</summary><ul style="' + ul + '">' + li(_HND_COURSES) + '</ul></details>'
            + '<div style="font-size:0.8rem;color:#475569;margin-top:6px;">Scholarships are offered as <b>fully funded</b> or <b>partially funded</b> \u2014 the funding type and fee split for this call are shown above.</div>'
            + '</div>';
    }

    function _head(ad) {
        var st = _status(ad);
        return (ad.imageUrl ? '<img src="' + _esc(ad.imageUrl) + '" alt="' + _esc(ad.title) + '" style="display:block;width:100%;height:auto;">' : '')
            + '<div class="emp-sch-mhead"><span class="emp-sch-badge">' + _esc(ad.fundingType || 'Scholarship') + '</span>'
            + '<div class="emp-sch-title">' + _esc(ad.title) + '</div>'
            + '<div class="emp-sch-by">Sponsored by <b>' + _esc(ad.sponsor) + '</b><br>In affiliation with <b>' + _esc(ad.affiliate) + '</b></div>'
            + '<div style="margin-top:10px;"><span class="emp-sch-status emp-sch-st-' + st.key + '">' + _esc(st.label) + '</span></div></div>';
    }

    function _detailsHtml(ad, applied) {
        var st = _status(ad), slots = Number(ad.slots) || 0, cnt = Number(ad.applicantCount) || 0;
        var btnLabel = applied ? 'Application submitted \u2713' : st.btn;
        var canApply = st.canApply && !applied;
        return _head(ad)
            + '<div class="emp-sch-mbody">'
            + '<p style="margin:0;">We are facilitating this opportunity for qualified community members to pursue their academic dreams at <b>' + _esc(ad.institution) + '</b>.</p>'
            + (_both(ad) ? _tiersHtml(ad, true) : ('<div class="emp-sch-fbox">'
            +   '<div><small>Total fee</small><b>' + _money(ad.totalFee) + '</b></div>'
            +   '<div class="g"><small>Sponsor covers</small><b>' + _money(ad.sponsorPays) + '</b></div>'
            +   '<div class="r"><small>Student pays</small><b>' + _pays(ad) + '</b></div>'
            + '</div>'))
            + '<ul class="emp-sch-list">'
            +   (ad.req1 ? '<li>' + _esc(ad.req1) + '</li>' : '')
            +   (ad.req2 ? '<li>' + _esc(ad.req2) + '</li>' : '')
            +   '<li>Qualified students will be invited for a mandatory physical interview.</li>'
            +   '<li><b>Course selection:</b> ' + (_isRectem(ad) ? 'state your intended course in the application; it is confirmed on the official website later.' : 'your specific course must be chosen on the official website later.') + '</li>'
            +   (slots > 0 ? '<li><b>Capacity:</b> strictly limited to <span class="emp-sch-hl">' + slots + '</span> slots (' + Math.max(0, slots - cnt) + ' remaining).</li>' : '')
            +   '<li><b>Opens:</b> ' + _esc(_fmtDate(ad.startDate)) + ' &middot; <b>Deadline:</b> <span class="emp-sch-hl">' + _esc(_fmtDate(ad.endDate)) + '</span></li>'
            + '</ul>'
            + _admissionHtml(ad)
            + '<div class="emp-sch-actions">'
            +   '<button type="button" class="emp-sch-btn emp-sch-btn-primary" data-act="apply"' + (canApply ? '' : ' disabled') + '>' + _esc(btnLabel) + '</button>'
            +   '<button type="button" class="emp-sch-btn emp-sch-btn-ghost" data-act="share">' + _ico('share', '1.05em', 'margin-right:6px;') + 'Share</button>'
            + '</div>'
            + '<div id="emp-sch-tray" class="emp-sch-tray" style="display:none;">'
            +   '<button type="button" class="emp-sch-sh" data-share="whatsapp"><span style="background:#25D366">' + _ico('whatsapp', '1.35rem') + '</span>WhatsApp</button>'
            +   '<button type="button" class="emp-sch-sh" data-share="facebook"><span style="background:#1877F2">' + _ico('facebook', '1.35rem') + '</span>Facebook</button>'
            +   '<button type="button" class="emp-sch-sh" data-share="twitter"><span style="background:#000">' + _ico('x', '1.35rem') + '</span>X</button>'
            +   '<button type="button" class="emp-sch-sh" data-share="telegram"><span style="background:#0088cc">' + _ico('telegram', '1.35rem') + '</span>Telegram</button>'
            +   '<button type="button" class="emp-sch-sh" data-share="linkedin"><span style="background:#0077b5">' + _ico('linkedin', '1.35rem') + '</span>LinkedIn</button>'
            +   '<button type="button" class="emp-sch-sh" data-share="copy"><span style="background:#718096">' + _ico('link', '1.35rem') + '</span>Copy link</button>'
            + '</div></div>';
    }

    /* BIO-DATA APPLICATION FORM (2026-09-29): mirrors the RECTEM Google Form — Email*, Surname,
       First Name and Other Names, Residential State, Phone Number (WhatsApp), Sex, Date of Birth*,
       Youth Province, Intended course of Study, ND or HND — plus study mode (ND: Full/Part-Time, HND:
       Full-Time only). Course list, mode, registration label and the eligibility tick-box all follow the
       ND/HND choice (see _wireForm). */
    function _formHtml(ad) {
        var us = window.userState || {}, au = (window.fbAuth && window.fbAuth.currentUser) || {};
        var em = us.email || au.email || '';
        var ph = us.phone || us.phoneNumber || '';
        var rect = _isRectem(ad);
        var IN = 'width:100%;box-sizing:border-box;margin-top:5px;padding:11px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:0.9rem;font-family:inherit;background:#fff;color:inherit;';
        var RQ = ' <span style="color:#dc2626;">*</span>';
        function radios(name, opts) {
            return '<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">' + opts.map(function (o) {
                return '<label style="display:flex;align-items:center;gap:10px;margin:0;font-weight:600;font-size:0.9rem;color:#1f2937;"><input type="radio" name="' + name + '" value="' + _esc(o[0]) + '" style="margin:0;width:18px;height:18px;"> ' + _esc(o[1]) + '</label>';
            }).join('') + '</div>';
        }
        var today = new Date().toISOString().slice(0, 10);
        return _head(ad)
            + '<div class="emp-sch-mbody"><form id="emp-sch-form" class="emp-sch-form" novalidate>'
            + '<div style="font-weight:800;font-size:1rem;">Submit your application</div>'
            + '<div style="font-size:0.78rem;color:#64748b;margin-top:2px;">Fields marked <span style="color:#dc2626;">*</span> are required.</div>'
            + '<label>Email' + RQ + '<input type="email" id="emp-sch-f-email" maxlength="160" value="' + _esc(em) + '" placeholder="Your email"></label>'
            + '<label>Surname' + RQ + '<input type="text" id="emp-sch-f-surname" maxlength="60" placeholder="Your answer"></label>'
            + '<label>First Name and Other Names' + RQ + '<input type="text" id="emp-sch-f-first" maxlength="80" placeholder="Your answer"></label>'
            + '<div style="margin-top:12px;"><div style="font-size:0.78rem;font-weight:700;color:#475569;">Sex</div>' + radios('emp-sch-sex', [['Male', 'Male'], ['Female', 'Female']]) + '</div>'
            + '<label>Date of Birth' + RQ + '<input type="date" id="emp-sch-f-dob" max="' + today + '" style="' + IN + '"></label>'
            + '<label>Residential State<input type="text" id="emp-sch-f-state" maxlength="60" placeholder="Your answer"></label>'
            + '<label>Phone Number (WhatsApp)' + RQ + '<input type="tel" id="emp-sch-f-phone" maxlength="30" value="' + _esc(ph) + '" placeholder="+234..."></label>'
            + '<label>Youth Province <span style="font-weight:500;color:#94a3b8;">(optional)</span><input type="text" id="emp-sch-f-province" maxlength="60" placeholder="Your answer"></label>'
            + (rect
                ? '<div style="margin-top:12px;"><div style="font-size:0.78rem;font-weight:700;color:#475569;">ND or HND' + RQ + '</div>'
                    + radios('emp-sch-level', [['ND', 'ND'], ['HND', 'HND (ND CERTIFICATE NEEDED)']]) + '</div>'
                    + '<label>Study mode' + RQ + '<select id="emp-sch-f-mode" style="' + IN + '"></select></label>'
                    + '<label>Intended course of Study' + RQ + '<select id="emp-sch-f-course" style="' + IN + '"></select></label>'
                : '<label>Intended course of Study<input type="text" id="emp-sch-f-course" maxlength="120" placeholder="Your answer"></label>')
            + '<label><span id="emp-sch-f-regl">' + _esc(ad.regLabel || 'Registration number') + '</span>' + RQ + '<input type="text" id="emp-sch-f-reg" maxlength="60" placeholder="Enter registration number"></label>'
            + '<label class="emp-sch-check"><input type="checkbox" id="emp-sch-f-c1"> <span id="emp-sch-f-c1t">I confirm that I meet the academic criteria and registration requirements stated for this scholarship.</span></label>'
            + '<label class="emp-sch-check"><input type="checkbox" id="emp-sch-f-c2"> I acknowledge that my course selection will be done on the institution\u2019s official website, and I must attend an interview if qualified.</label>'
            + '<div class="emp-sch-actions" style="margin-top:16px;">'
            +   '<button type="button" class="emp-sch-btn emp-sch-btn-ghost" data-act="back">Back</button>'
            +   '<button type="submit" id="emp-sch-submit" class="emp-sch-btn emp-sch-btn-primary"><i class="fas fa-paper-plane"></i> Submit application</button>'
            + '</div></form></div>';
    }

    // Keeps the ND/HND-dependent parts of the form in step with the level radios.
    function _wireForm(ad) {
        var form = document.getElementById('emp-sch-form');
        if (!form || !_isRectem(ad)) return;
        var courseSel = document.getElementById('emp-sch-f-course'), modeSel = document.getElementById('emp-sch-f-mode');
        var regl = document.getElementById('emp-sch-f-regl'), c1t = document.getElementById('emp-sch-f-c1t');
        var regIn = document.getElementById('emp-sch-f-reg');
        if (!courseSel || !modeSel) return;
        function level() { var r = form.querySelector('input[name="emp-sch-level"]:checked'); return r ? r.value : ''; }
        function opts(list, ph, keep) {
            return '<option value="">' + _esc(ph) + '</option>' + list.map(function (c) { return '<option value="' + _esc(c) + '"' + (c === keep ? ' selected' : '') + '>' + _esc(c) + '</option>'; }).join('');
        }
        function sync() {
            var L = level(), keepC = courseSel.value, keepM = modeSel.value;
            var list = L === 'HND' ? _HND_COURSES : (L === 'ND' ? _ND_COURSES : []);
            courseSel.innerHTML = opts(list, L ? 'Select your intended course' : 'Select ND or HND first', keepC);
            if (L === 'HND') modeSel.innerHTML = '<option value="Full-Time" selected>Full-Time (HND is Full-Time only)</option>';
            else modeSel.innerHTML = opts(['Full-Time', 'Part-Time'], L ? 'Select study mode' : 'Select ND or HND first', keepM);
            if (regl) regl.textContent = L === 'HND' ? 'ND matriculation / certificate number' : (ad.regLabel || 'Registration number');
            if (regIn) regIn.placeholder = L === 'HND' ? 'Enter your ND matric / certificate number' : 'Enter registration number';
            if (c1t) c1t.textContent = L === 'HND'
                ? 'I confirm that I hold a relevant ND (minimum lower credit) and have one year of industrial experience.'
                : (L === 'ND'
                    ? 'I confirm that I have 5 O\u2019Level credit passes (English, Mathematics + 3 relevant subjects) in not more than 2 sittings, and that I have JAMB.'
                    : 'I confirm that I meet the academic criteria and registration requirements stated for this scholarship.');
        }
        form.addEventListener('change', function (e) { if (e.target && e.target.name === 'emp-sch-level') sync(); });
        sync();
    }

    function _doneHtml(ad) {
        return _head(ad) + '<div class="emp-sch-mbody"><div class="emp-sch-done">' + _ico('check', '2.9rem', 'color:#16a34a;') + ''
            + '<div style="font-weight:800;font-size:1.05rem;margin-top:12px;">Application submitted</div>'
            + '<p style="color:#64748b;margin:8px 0 18px;">Your details have been captured. Qualified applicants will be contacted for the next steps.</p>'
            + '<button type="button" class="emp-sch-btn emp-sch-btn-primary" data-act="close" style="max-width:220px;">Done</button></div></div>';
    }

    function _paint(ad, mode, applied) {
        var body = document.getElementById('emp-sch-body');
        if (!body) return;
        body.innerHTML = mode === 'form' ? _formHtml(ad) : mode === 'done' ? _doneHtml(ad) : _detailsHtml(ad, applied);
        if (mode === 'form') _wireForm(ad);
        var sheet = document.getElementById('emp-sch-sheet');
        if (sheet) sheet.scrollTop = 0;
    }

    function _shareLink(ad) {
        return window.location.origin + window.location.pathname + '?scholarship=' + encodeURIComponent(ad.id);
    }

    function _share(ad, where) {
        var link = _shareLink(ad);
        var msg = 'Apply for the ' + ad.title + '! Open to our community. Check requirements and apply here: ';
        var u = encodeURIComponent(link), m = encodeURIComponent(msg), url = '';
        if (where === 'whatsapp') url = 'https://api.whatsapp.com/send?text=' + m + u;
        else if (where === 'facebook') url = 'https://www.facebook.com/sharer/sharer.php?u=' + u;
        else if (where === 'twitter') url = 'https://twitter.com/intent/tweet?text=' + m + '&url=' + u;
        else if (where === 'telegram') url = 'https://t.me/share/url?url=' + u + '&text=' + m;
        else if (where === 'linkedin') url = 'https://www.linkedin.com/sharing/share-offsite/?url=' + u;
        if (url) { window.open(url, '_blank', 'noopener'); return; }
        var done = function () { _notify('Link copied!', 'success'); };
        // (2026-09-29) Copy link: navigator.clipboard is unavailable/denied in many in-app webviews
        // and non-secure contexts, which used to drop straight to a raw prompt() box. Fall back to a
        // hidden-textarea execCommand('copy') first; the prompt is now only the last resort.
        var legacyCopy = function () {
            try {
                var ta = document.createElement('textarea');
                ta.value = link; ta.setAttribute('readonly', '');
                ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
                document.body.appendChild(ta); ta.focus(); ta.select();
                try { ta.setSelectionRange(0, link.length); } catch (e) {}
                var ok = document.execCommand('copy');
                document.body.removeChild(ta);
                return !!ok;
            } catch (e) { return false; }
        };
        var fallback = function () { if (legacyCopy()) done(); else window.prompt('Copy this link:', link); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(done, fallback);
        } else { fallback(); }
    }

    function _checkApplied(ad) {
        if (!_signedIn() || !window.fbDb) return;
        var uid = window.fbAuth.currentUser.uid;
        window.fbDb.collection(COL_APP).doc(ad.id + '_' + uid).get().then(function (doc) {
            var ov = document.getElementById('emp-sch-modal');
            if (!doc.exists || !ov || ov.getAttribute('data-id') !== ad.id) return;
            ov._applied = true;
            if (ov.getAttribute('data-mode') === 'details') _paint(ad, 'details', true);
        }).catch(function () { /* not being able to pre-check is fine — submit re-checks in its transaction */ });
    }

    function _openModal(id, mode) {
        var ad = _find(id);
        if (!ad) return;
        _closeModal();
        var ov = document.createElement('div');
        ov.id = 'emp-sch-modal';
        ov.className = 'emp-sch-overlay';
        ov.setAttribute('data-id', ad.id);
        ov.innerHTML = '<div class="emp-sch-sheet" id="emp-sch-sheet" role="dialog" aria-modal="true"><button type="button" class="emp-sch-close" data-act="close" aria-label="Close">&times;</button><div id="emp-sch-body"></div></div>';
        document.body.appendChild(ov);

        function setMode(m) { ov.setAttribute('data-mode', m); _paint(ad, m, !!ov._applied); }
        ov.addEventListener('click', function (e) {
            if (e.target === ov) { _closeModal(); return; }
            var sh = e.target.closest ? e.target.closest('[data-share]') : null;
            if (sh) { _share(ad, sh.getAttribute('data-share')); return; }
            var b = e.target.closest ? e.target.closest('[data-act]') : null;
            if (!b || b.disabled) return;
            var act = b.getAttribute('data-act');
            if (act === 'close') _closeModal();
            else if (act === 'back') setMode('details');
            else if (act === 'share') { var t = document.getElementById('emp-sch-tray'); if (t) t.style.display = t.style.display === 'none' ? 'flex' : 'none'; }
            else if (act === 'apply') {
                if (!_signedIn()) { _notify('Please sign in to your Empyrean account to apply.', 'warning'); return; }
                setMode('form');
            }
        });
        ov.addEventListener('submit', function (e) {
            if (e.target && e.target.id === 'emp-sch-form') { e.preventDefault(); _submit(ad, ov, setMode); }
        });

        if (mode === 'form' && !_signedIn()) { _notify('Please sign in to your Empyrean account to apply.', 'warning'); mode = 'details'; }
        setMode(mode === 'form' ? 'form' : 'details');
        _checkApplied(ad);
    }

    /* ───────── apply ───────── */
    // (2026-09-28) Applications now go through server.js's
    // POST /api/scholarships/apply first: the server verifies the ID token,
    // judges the deadline / slots / duplicate on its own clock and writes
    // the application + counter with admin rights, so Firestore rules no
    // longer have to let members touch scholarship_adverts at all. Only when
    // that route can't be reached (offline server, route not deployed yet,
    // Firebase Admin not configured) does the ORIGINAL direct browser
    // transaction below run as a fallback — same doc ids, same fields, so
    // the admin applicants list and PDF export read both identically.
    function _applyViaServer(payload) {
        var user = window.fbAuth && window.fbAuth.currentUser;
        if (!user || typeof user.getIdToken !== 'function') { var e0 = new Error('no auth'); e0.empFallback = true; return Promise.reject(e0); }
        var base = (typeof window._empApiBase === 'function') ? window._empApiBase() : '';
        return user.getIdToken().then(function (token) {
            return fetch(base + '/api/scholarships/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify(payload)
            });
        }, function () { var e1 = new Error('token'); e1.empFallback = true; throw e1; })
        .then(function (res) {
            return res.json().then(function (j) { return j || {}; }, function () { return {}; }).then(function (j) {
                if (res.ok && j.ok) return j;
                var e = new Error(j.error || 'Could not submit your application.');
                e.empCode = j.code;
                if (res.status === 404 || res.status === 503 || j.code === 'unavailable') e.empFallback = true;
                throw e;
            });
        }, function () { var e2 = new Error('network'); e2.empFallback = true; throw e2; });
    }

    function _submit(ad, ov, setMode) {
        if (!_signedIn() || !window.fbDb) { _notify('Please sign in to your Empyrean account to apply.', 'warning'); return; }
        function v(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
        var surname = v('emp-sch-f-surname'), first = v('emp-sch-f-first');
        var name = (surname + ' ' + first).replace(/\s+/g, ' ').trim();
        var email = v('emp-sch-f-email'), phone = v('emp-sch-f-phone'), reg = v('emp-sch-f-reg');
        var dob = v('emp-sch-f-dob'), rState = v('emp-sch-f-state'), province = v('emp-sch-f-province');
        function checked(n) { var r = document.querySelector('#emp-sch-form input[name="' + n + '"]:checked'); return r ? r.value : ''; }
        var sex = checked('emp-sch-sex'), rect = _isRectem(ad);
        var level = rect ? checked('emp-sch-level') : '', studyMode = rect ? v('emp-sch-f-mode') : '', course = v('emp-sch-f-course');
        var c1 = document.getElementById('emp-sch-f-c1'), c2 = document.getElementById('emp-sch-f-c2');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _notify('Please enter a valid email address.', 'warning'); return; }
        if (surname.length < 2) { _notify('Please enter your surname.', 'warning'); return; }
        if (first.length < 2) { _notify('Please enter your first name and other names.', 'warning'); return; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || isNaN(new Date(dob).getTime()) || dob > new Date().toISOString().slice(0, 10) || dob < '1920-01-01') { _notify('Please enter your date of birth.', 'warning'); return; }
        if (phone.replace(/\D/g, '').length < 7) { _notify('Please enter a valid WhatsApp phone number.', 'warning'); return; }
        if (rect && !level) { _notify('Please choose ND or HND.', 'warning'); return; }
        if (rect && !studyMode) { _notify('Please choose your study mode.', 'warning'); return; }
        if (rect && !course) { _notify('Please choose your intended course of study.', 'warning'); return; }
        if (!reg) { _notify('Please enter your ' + ((level === 'HND') ? 'ND matriculation / certificate number' : (ad.regLabel || 'registration number')) + '.', 'warning'); return; }
        if (!(c1 && c1.checked && c2 && c2.checked)) { _notify('Please tick both confirmation boxes.', 'warning'); return; }

        var btn = document.getElementById('emp-sch-submit');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Submitting\u2026'; }

        var db = window.fbDb, uid = window.fbAuth.currentUser.uid;
        var adRef = db.collection(COL_ADV).doc(ad.id);
        var appRef = db.collection(COL_APP).doc(ad.id + '_' + uid);
        var ts = (window.firebase && firebase.firestore && firebase.firestore.FieldValue) ? firebase.firestore.FieldValue.serverTimestamp() : new Date();

        // extra bio-data captured by the new form (server.js stores + validates the same fields)
        var extra = { formVersion: 2, surname: surname, firstName: first, sex: sex, dob: dob, state: rState, province: province, level: level, studyMode: studyMode, course: course };
        var payload = Object.assign({ advertId: ad.id, name: name, email: email, phone: phone, regNo: reg, consent: true }, extra);
        var _direct = function () { return db.runTransaction(function (tx) {
            return tx.get(adRef).then(function (adSnap) {
                return tx.get(appRef).then(function (appSnap) {
                    if (!adSnap.exists) { var e0 = new Error('gone'); e0.empCode = 'gone'; throw e0; }
                    if (appSnap.exists) { var e1 = new Error('dup'); e1.empCode = 'dup'; throw e1; }
                    var cur = adSnap.data() || {};
                    var st = _status(cur);
                    if (!st.canApply) { var e2 = new Error(st.key); e2.empCode = st.key; throw e2; }
                    tx.set(appRef, Object.assign({ advertId: ad.id, advertTitle: cur.title || '', userId: uid, name: name, email: email, phone: phone, regNo: reg, createdAt: ts }, extra));
                    tx.update(adRef, { applicantCount: (Number(cur.applicantCount) || 0) + 1 });
                });
            });
        }); };

        _applyViaServer(payload).catch(function (err) {
            if (err && err.empFallback) return _direct();
            throw err;
        }).then(function () {
            ov._applied = true;
            setMode('done');
            _notify('Application submitted successfully!', 'success');
        }).catch(function (err) {
            var code = err && err.empCode;
            if (code === 'dup') { ov._applied = true; _notify('You have already applied for this scholarship.', 'info'); setMode('details'); return; }
            if (code === 'closed') _notify('Applications for this scholarship have closed.', 'warning');
            else if (code === 'full') _notify('We apologise — all scholarship slots have been filled.', 'warning');
            else if (code === 'soon') _notify('Applications have not opened yet.', 'warning');
            else if (code === 'gone') _notify('This scholarship is no longer available.', 'warning');
            else _notify('Could not submit your application: ' + (err && err.message ? err.message : 'please try again'), 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit application'; }
        });
    }

    /* ───────── triggers ───────── */
    // Re-evaluate every minute so a card also disappears when its deadline passes (or the day
    // rolls over) while the dashboard is sitting open; slot-full removal arrives live via the
    // Firestore listener above.
    setInterval(function () { if (_ads.length) _renderRail(); }, 60000);
    document.addEventListener('empyrean-section-change', function (e) { if (e && e.detail && e.detail.section === 'dashboard') _start(); });
    document.addEventListener('empyrean-init-done', function () { setTimeout(_start, 300); setTimeout(_start, 2500); });
    window.addEventListener('empyrean:firebase-ready', function () { setTimeout(_start, 150); });
    if (document.readyState !== 'loading') setTimeout(_start, 500);
    else document.addEventListener('DOMContentLoaded', function () { setTimeout(_start, 500); });

    console.log('[EmpFeed] \u2705 Scholarship rail ready — live scholarship_adverts render as a horizontal card rail on the dashboard; apply + share from the details modal.');
})();


/* =============================================================================
   GRADUATE CELEBRATIONS RAIL (2026-10-09) — convocation / matriculation cards.
   Admin Panel → Celebrations (app-admin.js initCelebrationManager) writes to
   the `celebrations` collection; this listens to active==true docs live and
   fills the static #dashboard-celebration-container in index.html: one
   horizontally scrollable row per institution, premium photo cards, and a
   swipeable full-screen gallery when a card is tapped.
   ============================================================================= */
(function empyreanCelebrationRail() {
    'use strict';

    var COL = 'celebrations';
    var CEL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // celebrations stay on the dashboard for one week
    /* RESTORED (2026-10-20 — "graduation convocation/matriculation card is missing from the public
       dashboard"): the one-week auto-hide above silently removed every card older than 7 days, so
       the whole rail vanished. Auto-expiry is now OFF — cards stay until an admin pauses/deletes
       them in Admin Panel → Celebrations. Set to true to bring the one-week expiry back. */
    var CEL_AUTO_EXPIRE = false;
    var _items = [];
    var _unsub = null;
    var _lb = { imgs: [], i: 0, slides: [], id: null, item: null, unsub: null, likes: 0, liked: false, deepDone: false };

    function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function _ms(v) { try { if (v && typeof v.toMillis === 'function') return v.toMillis(); if (v) return new Date(v).getTime() || 0; } catch (e) {} return 0; }
    // The celebrant's own graduation / matriculation year (it.classYear); older posts without one fall back to the post's year.
    function _classYear(it) { var y = parseInt(it && it.classYear, 10); if (y >= 1950 && y <= 2100) return y; var t = _ms(it && (it.pushedAt || it.createdAt)); return (t ? new Date(t) : new Date()).getFullYear(); }
    function _imgs(it) { return (Array.isArray(it.images) ? it.images : []).filter(Boolean); }
    function _find(id) { for (var i = 0; i < _items.length; i++) if (_items[i].id === id) return _items[i]; return null; }
    // (2026-10-23) A card may carry one video: videoUrl + videoPoster. When a card has ONLY a video, images
    // holds just the poster frame so the rail, share preview and admin list all still have a thumbnail.
    function _photos(it) { var a = _imgs(it); if (it.videoUrl && it.videoPoster && a.length && a[0] === it.videoPoster) a = a.slice(1); return a; }
    function _slides(it) {
        var s = _photos(it).map(function (u) { return { src: u }; });
        if (it.videoUrl) s.push({ v: 1, src: String(it.videoUrl), poster: it.videoPoster || '' });
        return s;
    }

    var _ICON_PHOTOS = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16l4.6-4.6a2 2 0 0 1 2.8 0L16 16m-2-2l1.6-1.6a2 2 0 0 1 2.8 0L20 14m-6-6h.01M6 20h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z"/></svg>';

    function _cardHtml(it) {
        var imgs = _imgs(it); if (!imgs.length) return '';
        var mat = it.type === 'matriculation', hasVid = !!it.videoUrl, total = _slides(it).length;
        return '<article class="emp-cel-card" data-id="' + _esc(it.id) + '" tabindex="0" role="button" aria-label="Celebrating ' + _esc(it.studentName) + '">'
            + '<div class="emp-cel-photo">'
            +   '<img src="' + _esc(imgs[0]) + '" alt="' + _esc(it.studentName) + '" loading="lazy">'
            +   '<div class="emp-cel-shade"></div>'
            +   '<span class="emp-cel-badge' + (mat ? ' mat' : '') + '">' + (mat ? '\uD83C\uDF89 Matriculation' : '\uD83C\uDF93 Convocation') + '</span>'
            +   '<span class="emp-cel-seal"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c3 2.5 9 2.5 12 0v-4.5"/></svg>' + (mat ? 'Matric ' : 'Class of ') + _classYear(it) + '</span>'
            +   (hasVid ? '<span class="emp-cel-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg></span>' : '')
            +   (total > 1 ? '<span class="emp-cel-more">' + _ICON_PHOTOS + '+' + (total - 1) + '</span>' : '')
            + '</div>'
            + '<div class="emp-cel-info">'
            +   '<h4>' + _esc(it.studentName) + '</h4>'
            +   (it.institution ? '<div class="emp-cel-ir inst"><i>' + _IC_INST + '</i><span>' + _esc(it.institution) + '</span></div>' : '')
            +   (it.course ? '<div class="emp-cel-ir course"><i>' + _IC_COURSE + '</i><span>' + _esc(it.course) + '</span></div>' : '')
            +   (it.department ? '<div class="emp-cel-ir dept"><i>' + _IC_DEPT + '</i><span>' + _esc(it.department) + '</span></div>' : '')
            +   '<div class="emp-cel-cta">' + (hasVid ? 'Watch &amp; celebrate' : 'View celebration') + ' <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></div>'
            + '</div></article>';
    }

    function _render() {
        var box = document.getElementById('dashboard-celebration-container');
        var body = document.getElementById('dashboard-celebration-body');
        if (!box || !body) return;
        /* NEW (2026-10-09 — "make the convocation picture post disappear after one week"):
           a celebration shows on the public dashboard for 7 days from when it was published
           (pushedAt, falling back to createdAt). Hidden, not deleted — the Firestore doc stays,
           and an admin's "Push"/re-announce (which refreshes pushedAt) puts it back for another
           week. A doc whose server timestamp hasn't resolved yet reads as 0 and is treated as
           brand new. */
        var _now = Date.now();
        var live = _items.filter(function (it) {
            if (!_imgs(it).length) return false;
            var t = _ms(it.pushedAt || it.createdAt);
            return !CEL_AUTO_EXPIRE || !t || (_now - t) < CEL_TTL_MS;
        });
        var addBtn = document.getElementById('dashboard-celebration-add');
        if (addBtn) {
            addBtn.style.display = '';   // everyone sees the door; guests are asked to sign in when they tap it
            if (!addBtn._empWired) { addBtn._empWired = true; addBtn.addEventListener('click', _openForm); }
        }
        if (!live.length) {
            // Everyone (members and guests) sees the card so there is always a door to add the first celebration.
            box.style.display = '';
            var c0 = document.getElementById('dashboard-celebration-count'); if (c0) c0.textContent = '';
            body.innerHTML = '<div class="emp-cel-empty"><div class="emp-cel-empty-ic">\uD83C\uDF93</div>'
                + '<p><b>Graduating or just starting school?</b><br>' + (_canSubmit() ? 'Share your moment with the community \u2014 tap \u201CShare yours\u201D above.' : 'Sign in, then tap \u201CShare yours\u201D above to post your convocation or matriculation photos and video.') + '</p></div>';
            return;
        }

        // Group by institution (case/space-insensitive); groups ordered by their newest card.
        var groups = {}, order = [];
        live.forEach(function (it) {
            var key = String(it.institutionKey || it.institution || '').toLowerCase().replace(/\s+/g, ' ').trim() || 'other';
            if (!groups[key]) { groups[key] = { name: it.institution || 'Other', items: [], newest: 0 }; order.push(key); }
            groups[key].items.push(it);
            groups[key].newest = Math.max(groups[key].newest, _ms(it.pushedAt || it.createdAt));
        });
        order.sort(function (a, b) { return groups[b].newest - groups[a].newest; });

        box.style.display = '';
        var cnt = document.getElementById('dashboard-celebration-count');
        if (cnt) cnt.textContent = live.length + (live.length === 1 ? ' celebration' : ' celebrations');
        body.innerHTML = order.map(function (k) {
            var g = groups[k];
            return '<section class="emp-cel-group">'
                + '<div class="emp-cel-ghead"><h3>\uD83C\uDFDB\uFE0F ' + _esc(g.name) + '</h3><span>' + g.items.length + '</span></div>'
                + '<div class="emp-cel-track">' + g.items.map(_cardHtml).join('') + '</div></section>';
        }).join('');

        if (!body._empWired) {
            body._empWired = true;
            body.addEventListener('click', function (e) {
                var card = e.target.closest ? e.target.closest('.emp-cel-card') : null;
                if (card) _open(card.getAttribute('data-id'));
            });
            body.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                var card = e.target.classList && e.target.classList.contains('emp-cel-card') ? e.target : null;
                if (card) { e.preventDefault(); _open(card.getAttribute('data-id')); }
            });
        }
    }

    /* ───────── lightbox: premium details card + engagement/share (2026-10-23) ─────────
       Card under the photo shows type badge, student name, institution, course and department.
       A chevron on the card's top edge reveals the engagement (Congratulate) + share-link actions.
       Shared links are ?celebration=<id>; server.js serves the first uploaded photo as the link
       thumbnail, and _start() below re-opens the same card when that link is opened. */
    function _svg(p) { return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
    var _IC_CHEV   = _svg('<path d="M6 15l6-6 6 6"/>');
    var _IC_INST   = _svg('<path d="M3 10l9-5 9 5M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>');
    var _IC_COURSE = _svg('<path d="M12 4 2.5 9 12 14l9.5-5L12 4zM6 11.5v4.2c0 1.2 2.7 2.8 6 2.8s6-1.6 6-2.8v-4.2"/>');
    var _IC_DEPT   = _svg('<path d="M4 20V5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5V20M2.5 20h19M8 8h4M8 11.5h4M8 15h4M16 10h2.5a1.5 1.5 0 0 1 1.5 1.5V20"/>');
    function _svgF(p) { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
    var _IC_CONG = _svgF('<circle cx="12" cy="9" r="5.6"/><circle cx="12" cy="9" r="2.3"/><path d="M8.5 13.6L6.8 21l5.2-2.7 5.2 2.7-1.7-7.4"/>');
    var _IC_MSGP = _svgF('<path d="M20 4H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4v3.5l5-3.5h7a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z"/><path d="M7.5 9h9M7.5 12.5h5.5"/>');
    var _IC_GIFTP = _svgF('<rect x="3.5" y="9" width="17" height="4" rx=".8"/><path d="M5 13v7.5h14V13M12 9v11.5"/><path d="M12 9C11 6 8.8 4.4 7.2 5.4 5.8 6.3 6.6 9 12 9zM12 9c1-3 3.2-4.6 4.8-3.6C18.2 6.3 17.4 9 12 9z"/>');
    var _IC_HEART  = _svg('<path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.5 2.6C20.5 15 12 20.5 12 20.5z"/>');
    var _IC_CHAT   = _svg('<path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4 9 9 0 0 1-3.6-.8L3 20l1.1-4.6A8.4 8.4 0 1 1 21 11.5z"/>');
    var _IC_GIFT   = _svg('<path d="M20 12v8H4v-8M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/>');
    var _IC_SHARE  = _svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>');
    var _IC_SEND   = _svg('<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>');
    var _IC_LINK   = _svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>');

    // 3D-style celebration icons for the congratulations strip (inline SVG, gradient-shaded, no image files)
    var _IC3D_GRAD = '<svg viewBox="0 0 64 64" width="50" height="50" aria-hidden="true"><defs><linearGradient id="g3a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a63f0"/><stop offset="1" stop-color="#17206e"/></linearGradient><linearGradient id="g3b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3aa8"/><stop offset="1" stop-color="#0e1546"/></linearGradient><linearGradient id="g3c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE98A"/><stop offset="1" stop-color="#E3A915"/></linearGradient></defs><ellipse cx="32" cy="58" rx="19" ry="3.2" fill="#0A0E27" opacity=".16"/><path d="M17 31v11c0 4.4 6.7 8 15 8s15-3.6 15-8V31L32 38z" fill="url(#g3b)"/><path d="M32 11 3 24.5 32 38l29-13.5z" fill="url(#g3a)"/><path d="M32 11 3 24.5 32 38z" fill="#fff" opacity=".13"/><path d="M3 24.5V28l29 13.5V38z" fill="#0e1546"/><path d="M61 24.5V28L32 41.5V38z" fill="#1b2780"/><circle cx="32" cy="24.5" r="2.6" fill="url(#g3c)"/><path d="M32 24.5 53 34v12" fill="none" stroke="url(#g3c)" stroke-width="2.2" stroke-linecap="round"/><path d="M50.5 46h5l1 7h-7z" fill="url(#g3c)"/><circle cx="9" cy="10" r="2" fill="#ff5d8f"/><rect x="50" y="6" width="4" height="4" rx="1" fill="#00D4AA" transform="rotate(25 52 8)"/><circle cx="58" cy="16" r="1.8" fill="#F5C518"/><rect x="14" y="4" width="3.5" height="3.5" rx="1" fill="#6c8cff" transform="rotate(-20 16 6)"/></svg>';
    var _IC3D_MAT  = '<svg viewBox="0 0 64 64" width="50" height="50" aria-hidden="true"><defs><linearGradient id="m3a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD84D"/><stop offset="1" stop-color="#F08A12"/></linearGradient><linearGradient id="m3b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff7aa8"/><stop offset="1" stop-color="#d6246e"/></linearGradient></defs><ellipse cx="22" cy="59" rx="16" ry="3" fill="#0A0E27" opacity=".16"/><path d="M6 57 18 24l22 22z" fill="url(#m3a)"/><path d="M6 57 18 24l6 6z" fill="#fff" opacity=".24"/><path d="M10 47l8 8M13.5 38 25 49.5" stroke="url(#m3b)" stroke-width="3" stroke-linecap="round"/><ellipse cx="29" cy="35" rx="13.5" ry="4.6" transform="rotate(45 29 35)" fill="#c46a0c"/><path d="M33 27c4-6 3-12 9-16" stroke="#00D4AA" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M38 33c6-2 10 0 16-5" stroke="#6c8cff" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M36 38c6 1 9 5 14 4" stroke="#ff5d8f" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="44" cy="9" r="2.6" fill="#ff5d8f"/><circle cx="57" cy="22" r="2.2" fill="#F5C518"/><rect x="50" y="11" width="5" height="5" rx="1.2" fill="#00D4AA" transform="rotate(20 52 13)"/><path d="M58 42l1.8 3.6 3.6 1.8-3.6 1.8L58 52.8l-1.8-3.6-3.6-1.8 3.6-1.8z" fill="#F5C518"/></svg>';

    function _lbLink() { return window.location.origin + window.location.pathname + '?celebration=' + encodeURIComponent(_lb.id || ''); }

    function _lbShare(where) {
        var it = _lb.item; if (!it || !_lb.id) return;
        var link = _lbLink();
        var mat = it.type === 'matriculation';
        var msg = (mat ? '\uD83C\uDF89 Celebrate ' + (it.studentName || 'our student') + ' \u2014 newly matriculated at ' : '\uD83C\uDF93 Celebrate ' + (it.studentName || 'our graduate') + ' \u2014 convocation at ')
            + (it.institution || 'their institution') + ' on Empyrean: ';
        var u = encodeURIComponent(link), m = encodeURIComponent(msg), url = '';
        if (where === 'native') {
            if (navigator.share) { navigator.share({ title: (it.studentName || 'Celebration') + ' on Empyrean', text: msg, url: link }).catch(function () {}); return; }
            where = 'copy'; // no share sheet on this browser: fall through to copy-link
        }
        if (where === 'whatsapp') url = 'https://api.whatsapp.com/send?text=' + m + u;
        else if (where === 'facebook') url = 'https://www.facebook.com/sharer/sharer.php?u=' + u;
        else if (where === 'twitter') url = 'https://twitter.com/intent/tweet?text=' + m + '&url=' + u;
        else if (where === 'telegram') url = 'https://t.me/share/url?url=' + u + '&text=' + m;
        else if (where === 'linkedin') url = 'https://www.linkedin.com/sharing/share-offsite/?url=' + u;
        if (url) { window.open(url, '_blank', 'noopener'); return; }
        var done = function () { _notify('Link copied!', 'success'); };
        var legacyCopy = function () {
            try {
                var ta = document.createElement('textarea');
                ta.value = link; ta.setAttribute('readonly', '');
                ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
                document.body.appendChild(ta); ta.focus(); ta.select();
                try { ta.setSelectionRange(0, link.length); } catch (e) {}
                var ok = document.execCommand('copy');
                document.body.removeChild(ta);
                return !!ok;
            } catch (e) { return false; }
        };
        var fallback = function () { if (legacyCopy()) done(); else window.prompt('Copy this link:', link); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, fallback);
        else fallback();
    }

    function _lbToggleActions(force) {
        var ch = document.getElementById('emp-cel-lb-chev'), ac = document.getElementById('emp-cel-lb-actions');
        if (!ch || !ac) return;
        var open = typeof force === 'boolean' ? force : !ac.classList.contains('open');
        ac.classList.toggle('open', open);
        ch.classList.toggle('open', open);
        ch.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function _lbPaintLike() {
        var b = document.getElementById('emp-cel-lb-like'); if (!b) return;
        b.classList.toggle('on', !!_lb.liked);
        var b2 = document.getElementById('emp-cel-eng-like'); if (b2) b2.classList.toggle('on', !!_lb.liked);
        var sl = document.getElementById('emp-cel-lb-stat-l'); if (sl) sl.textContent = String(_lb.likes || 0);
        var c = document.getElementById('emp-cel-lb-like-n');
        if (c) c.textContent = _lb.likes > 0 ? String(_lb.likes) : '';
    }

    // Live count + "did I already congratulate" for the OPEN celebration only. Stored one doc per
    // person at celebrations/{id}/reactions/{uid} so a person can only ever count once and no
    // shared counter field has to be written by non-owners.
    function _lbReactionsStop() { if (_lb.unsub) { try { _lb.unsub(); } catch (e) {} _lb.unsub = null; } }
    function _lbReactionsStart(id) {
        _lbReactionsStop();
        _lb.likes = 0; _lb.liked = false; _lb.likePending = false; _lbPaintLike();
        if (!(window.fbDb && window._firebaseLoaded)) { // not ready yet: retry shortly rather than never listening
            var _rt = (_lbReactionsStart._t || 0) + 1; if (_rt < 40) { _lbReactionsStart._t = _rt; setTimeout(function () { if (_lb.id === id && !_lb.unsub) _lbReactionsStart(id); }, 400); }
            return;
        }
        _lbReactionsStart._t = 0;
        try {
            _lb.unsub = window.fbDb.collection(COL).doc(id).collection('reactions').onSnapshot(function (snap) {
                if (_lb.id !== id) return;
                if (_lb.likePending) return; // my own toggle is still in flight — keep the instant (optimistic) state, the ack re-syncs it
                var u = window.fbAuth && window.fbAuth.currentUser, mine = false;
                snap.forEach(function (d) { if (u && d.id === u.uid) mine = true; });
                _lb.likes = snap.size; _lb.liked = mine;
                _lbPaintLike();
            }, function (err) {
                console.warn('[EmpCelebration] reactions listener failed:', err && err.message);
                _lb.unsub = null;
            });
        } catch (e) { console.warn('[EmpCelebration] reactions start failed:', e && e.message); }
    }
    function _lbToggleLike() {
        if (!_lb.id) return;
        if (!_canSubmit() || !window.fbDb) { _notify('Please sign in to congratulate.', 'warning'); return; }
        if (_lb.likePending) return; // one write at a time; the button already reflects the new state
        var u = window.fbAuth.currentUser;
        var ref = window.fbDb.collection(COL).doc(_lb.id).collection('reactions').doc(u.uid);
        // FIX (2026-10-23 — "engagement takes time to respond"): the button used to change ONLY after the
        // reactions onSnapshot echoed the write back, which on slow mobile data can take many seconds.
        // Flip the UI instantly, send the write in the background, and roll back only if it fails.
        var wasLiked = !!_lb.liked, wasLikes = _lb.likes || 0, id = _lb.id;
        _lb.liked = !wasLiked; _lb.likes = Math.max(0, wasLikes + (wasLiked ? -1 : 1));
        _lb.likePending = true; _lbPaintLike();
        var p = wasLiked ? ref.delete() : ref.set({ uid: u.uid, createdAt: window.firebase.firestore.FieldValue.serverTimestamp() });
        p.then(function () { _lb.likePending = false; }).catch(function (err) {
            _lb.likePending = false;
            if (_lb.id === id) { _lb.liked = wasLiked; _lb.likes = wasLikes; _lbPaintLike(); }
            _notify('Could not save your reaction' + (err && err.code === 'permission-denied' ? ' (permission denied).' : '.'), 'error');
        });
    }

    /* ───────── comments / messages (celebrations/{id}/comments) ─────────
       Live list for the OPEN celebration only. One doc per message; the author's uid is stored so
       a person can remove their own message. Needs a Firestore rule allowing signed-in users to
       create under celebrations/{id}/comments (same shape as the existing reactions rule). */
    var _CM = { list: [], unsub: null, busy: false, retry: null };
    // FIX (2026-10-26 — "messages/congratulations disappear after leaving the card and coming back"):
    // the list lived only in memory and was wiped on close; it came back only if the live listener ran.
    // That listener (a) silently never started when Firebase wasn't ready at the instant the card opened,
    // and (b) only console.warn'd on failure, leaving a never-reconciled local row that vanished on close.
    // Now my own not-yet-confirmed messages are mirrored in localStorage per celebration (dropped as soon as
    // the server returns the same message), the listener waits/retries for Firebase, and a failure is shown.
    var _CM_LS = 'emp_cel_cm_';
    function _cmLocalAll(id) { try { var a = JSON.parse(localStorage.getItem(_CM_LS + id) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function _cmLocalSave(id, a) { try { if (a && a.length) localStorage.setItem(_CM_LS + id, JSON.stringify(a.slice(0, 20))); else localStorage.removeItem(_CM_LS + id); } catch (e) {} }
    function _cmIsMine(c) { var u = window.fbAuth && window.fbAuth.currentUser; return !!(u && c && c.uid === u.uid); }
    function _cmLocalDrop(id, cid) { _cmLocalSave(id, _cmLocalAll(id).filter(function (c) { return c.id !== cid; })); }
    function _cmStop() {
        if (_CM.retry) { clearTimeout(_CM.retry); _CM.retry = null; }
        if (_CM.unsub) { try { _CM.unsub(); } catch (e) {} _CM.unsub = null; }
        _CM.list = [];
    }
    function _cmPaint() {
        var n = document.getElementById('emp-cel-lb-cm-n'); if (n) n.textContent = _CM.list.length ? String(_CM.list.length) : '';
        var sc = document.getElementById('emp-cel-lb-stat-c'); if (sc) sc.textContent = String(_CM.list.length);
        var l = document.getElementById('emp-cel-eng-list'); if (!l) return;
        if (!_CM.list.length) { l.innerHTML = '<div class="emp-cel-cm adm"><div class="emp-cel-cm-b"><div class="emp-cel-cm-h"><b>Empyrean Admin</b></div><p>Welcome to your big day! Leave a message below.</p></div></div>'; return; }
        var me = window.fbAuth && window.fbAuth.currentUser;
        l.innerHTML = _CM.list.map(function (c) {
            var nm = c.name || 'Member', ts = _ms(c.createdAt);
            var av = c.avatar ? '<img src="' + _esc(c.avatar) + '" alt="">' : '<span>' + _esc(nm.charAt(0).toUpperCase()) + '</span>';
            var own = me && c.uid && c.uid === me.uid;
            return '<div class="emp-cel-cm"><div class="emp-cel-cm-av">' + av + '</div><div class="emp-cel-cm-b"><div class="emp-cel-cm-h"><b>' + _esc(nm) + '</b><small>'
                + (ts && window._timeAgo ? window._timeAgo(ts) : 'now') + '</small>'
                + (own ? '<button type="button" data-cel-act="cm-del" data-cid="' + _esc(c.id) + '" aria-label="Delete message">&times;</button>' : '')
                + '</div><p>' + _esc(c.text) + '</p></div></div>';
        }).join('');
    }
    function _cmStart(id) {
        _cmStop();
        // show my unconfirmed messages for this card straight away, before the server list arrives
        _CM.list = _cmLocalAll(id).filter(_cmIsMine).map(function (c) { c._pending = true; return c; });
        _cmPaint();
        var tries = 0;
        (function attach() {
            if (_lb.id !== id || _CM.unsub) return;
            if (!(window.fbDb && window._firebaseLoaded)) { // Firebase not ready yet: retry instead of silently never listening
                if (++tries < 40) _CM.retry = setTimeout(attach, 400);
                return;
            }
            _CM.retry = null;
            try {
                _CM.unsub = window.fbDb.collection(COL).doc(id).collection('comments').orderBy('createdAt', 'desc').limit(100).onSnapshot(function (snap) {
                    if (_lb.id !== id) return;
                    var a = []; snap.forEach(function (d) { var x = d.data() || {}; x.id = d.id; a.push(x); });
                    // my local rows stay until the server list contains the same message from me (each server doc matches one local row)
                    var all = _cmLocalAll(id), used = {}, keep = [], others = [];
                    all.forEach(function (c) {
                        if (!_cmIsMine(c)) { others.push(c); return; }
                        for (var i = 0; i < a.length; i++) {
                            if (!used[i] && a[i].uid === c.uid && a[i].text === c.text) { used[i] = 1; return; }
                        }
                        keep.push(c);
                    });
                    _cmLocalSave(id, others.concat(keep));
                    _CM.list = keep.map(function (c) { c._pending = true; return c; }).concat(a);
                    _cmPaint();
                }, function (err) {
                    console.warn('[EmpCelebration] comments listener failed:', err && err.message);
                    _CM.unsub = null;
                    if (_lb.id === id) _notify('Messages could not be loaded' + (err && err.code === 'permission-denied' ? ' (permission denied \u2014 Firestore rules need read access on celebrations/{id}/comments).' : '.'), 'error');
                });
            } catch (e) { console.warn('[EmpCelebration] comments start failed:', e && e.message); }
        })();
    }
    function _cmSend(quick) {
        if (!_lb.id) return;
        var inp = document.getElementById('emp-cel-eng-in');
        var text = String(quick != null ? quick : (inp ? inp.value : '')).trim().slice(0, 300);
        if (!text) return;
        if (!_canSubmit() || !window.fbDb) { _notify('Please sign in to send a message.', 'warning'); return; }
        var u = window.fbAuth.currentUser, us = window.userState || {}, id = _lb.id;
        // FIX (2026-10-23 — "engagement takes time to respond"): the message only appeared (and the box only
        // cleared) after the server acknowledged the write, and a busy flag swallowed every tap meanwhile.
        // Now: clear the box and show the message at once as a local "pending" row, send in the background,
        // and drop the pending row (restoring the text) only if the send fails. The live listener replaces it
        // with the real doc as soon as one arrives.
        var tmpId = 'pending-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        var local = { id: tmpId, uid: u.uid, name: us.fullName || us.name || 'Member', avatar: us.avatar || '', text: text, createdAt: null, _pending: true };
        if (quick == null && inp) inp.value = '';
        _CM.list = [local].concat(_CM.list); _cmPaint();
        _cmLocalSave(id, [local].concat(_cmLocalAll(id)));
        var l = document.getElementById('emp-cel-eng-list'); if (l) l.scrollTop = 0;
        window.fbDb.collection(COL).doc(id).collection('comments').add({
            uid: u.uid, userId: String(us.id || ''), name: local.name, avatar: local.avatar,
            text: text, createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
        }).catch(function (err) {
            _cmLocalDrop(id, tmpId);
            if (_lb.id === id) { _CM.list = _CM.list.filter(function (c) { return c.id !== tmpId; }); _cmPaint(); }
            if (quick == null && inp && !inp.value) inp.value = text;
            _notify('Could not send your message' + (err && err.code === 'permission-denied' ? ' (permission denied).' : '.'), 'error');
        });
    }
    function _cmDelete(cid) {
        if (!_lb.id || !cid || !window.fbDb) return;
        if (String(cid).indexOf('pending-') === 0) { _cmLocalDrop(_lb.id, cid); _CM.list = _CM.list.filter(function (c) { return c.id !== cid; }); _cmPaint(); return; }
        window.fbDb.collection(COL).doc(_lb.id).collection('comments').doc(cid).delete().catch(function () { _notify('Could not delete that message.', 'error'); });
    }

    // Engagement tab: slides up when the photo (or the comment icon) is tapped — congratulate, messages, gift.
    function _engOpen(open) {
        var el = document.getElementById('emp-cel-eng'); if (!el) return;
        if (open) {
            var it = _lb.item || {};
            var w = document.getElementById('emp-cel-eng-who'); if (w) w.textContent = it.studentName || '';
            var s = document.getElementById('emp-cel-eng-sub'); if (s) s.textContent = [it.course, it.institution].filter(Boolean).join(' · ');
            var l = document.getElementById('emp-cel-eng-list'); if (l) l.scrollTop = 0;
        }
        el.classList.toggle('show', !!open);
    }

    // Gift: reuses the app's existing profile/birthday gift catalog (app-gifts.js) so the EMPY debit and
    // the recipient's gift-earnings credit go through the same path as every other gift. Needs a card
    // submitted by a member (submitterId); admin-published cards have no recipient account.
    function _lbGift() {
        var it = _lb.item; if (!it) return;
        if (!_canSubmit()) { _notify('Please sign in to send a gift.', 'warning'); return; }
        var rid = String(it.submitterId || '');
        if (!rid) { _notify('Gifts are not available for this celebration.', 'info'); return; }
        if (rid === String((window.userState && window.userState.id) || '')) { _notify('You cannot send a gift to yourself.', 'info'); return; }
        if (typeof window.openProfileGiftCatalog !== 'function') { _notify('Gifts are not ready yet — try again in a moment.', 'warning'); return; }
        var ov = document.getElementById('emp-cel-lb');
        if (ov) ov.style.zIndex = '50'; // slide the viewer under the gift catalog; the next tap on the viewer restores it
        window.openProfileGiftCatalog(rid, it.studentName || 'them');
    }

    // The person who posted a celebration can remove it themselves (admins still manage everything from the admin panel).
    function _lbIsOwner() { var u = window.fbAuth && window.fbAuth.currentUser; return !!(u && _lb.item && _lb.item.submitterUid && _lb.item.submitterUid === u.uid); }
    function _lbDeleteOwn() {
        if (!_lbIsOwner() || !window.fbDb || !_lb.id) return;
        var id = _lb.id;
        // In-app confirm (the Android WebView answers native confirm() with "false", so it can't be relied on).
        var old = document.getElementById('emp-cel-del-confirm'); if (old) old.remove();
        var bn = document.createElement('div'); bn.id = 'emp-cel-del-confirm';
        bn.style.cssText = 'position:fixed;left:12px;right:12px;bottom:24px;z-index:2147483000;background:#0A0E27;color:#fff;border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:12px;box-shadow:0 12px 32px rgba(0,0,0,0.4);';
        bn.innerHTML = '<div style="font-size:0.9rem;font-weight:600;">Delete your celebration? This cannot be undone.</div>'
            + '<div style="display:flex;gap:10px;justify-content:flex-end;"><button type="button" data-no style="min-height:44px;padding:0 18px;border-radius:10px;border:none;background:rgba(255,255,255,0.14);color:#fff;font-weight:700;">Cancel</button>'
            + '<button type="button" data-yes style="min-height:44px;padding:0 20px;border-radius:10px;border:none;background:#e53935;color:#fff;font-weight:700;">Delete</button></div>';
        document.body.appendChild(bn);
        bn.querySelector('[data-no]').addEventListener('click', function () { bn.remove(); });
        bn.querySelector('[data-yes]').addEventListener('click', function () {
            bn.remove();
            window.fbDb.collection(COL).doc(id).delete().then(function () { _close(); _notify('Your celebration was deleted.', 'success'); })
                .catch(function () { _notify('Could not delete your celebration. Please try again.', 'error'); });
        });
    }
    function _lbAct(act, el) {
        if (act === 'toggle') _lbToggleActions();
        else if (act === 'like') _lbToggleLike();
        else if (act === 'comments') {
            var _i = document.getElementById('emp-cel-eng-in');
            if (_i) { try { _i.scrollIntoView({ behavior: 'smooth', block: 'center' }); _i.focus({ preventScroll: true }); } catch (e) {} }
        }
        else if (act === 'eng-close') _engOpen(false);
        else if (act === 'send') _cmSend();
        else if (act === 'chip') _cmSend(el && el.getAttribute('data-emoji'));
        else if (act === 'cm-del') _cmDelete(el && el.getAttribute('data-cid'));
        else if (act === 'gift') _lbGift();
        else if (act === 'del-own') _lbDeleteOwn();
        else _lbShare(act); // whatsapp | facebook | twitter | telegram | linkedin | native | copy
    }

    /* ───────── gallery lightbox ───────── */
    function _lbEl() {
        var ov = document.getElementById('emp-cel-lb');
        if (ov) return ov;
        ov = document.createElement('div');
        ov.id = 'emp-cel-lb';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.innerHTML =
            '<div class="emp-cel-lb-top"><button type="button" id="emp-cel-lb-close" aria-label="Back"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Back</span></button><span class="ttl">Celebration</span><span class="emp-cel-lb-tbadge" id="emp-cel-lb-tbadge"></span></div>'
            + '<div class="emp-cel-lb-ph">'
            +   '<span class="emp-cel-lb-av" id="emp-cel-lb-av"><img id="emp-cel-lb-av-img" alt=""><em id="emp-cel-lb-av-ic"></em></span>'
            +   '<div class="emp-cel-lb-who"><b class="emp-cel-lb-name" id="emp-cel-lb-name"></b>'
            +     '<div class="emp-cel-lb-sub"><span class="emp-cel-lb-badge" id="emp-cel-lb-badge"></span><span id="emp-cel-lb-time"></span></div></div>'
            + '</div>'
            + '<div class="emp-cel-lb-stage">'
            +   '<span class="emp-cel-lb-seal"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c3 2.5 9 2.5 12 0v-4.5"/></svg><span id="emp-cel-lb-seal-t"></span></span>'
            +   '<span id="emp-cel-lb-count"></span>'
            +   '<img id="emp-cel-lb-img" alt="">'
            +   '<video id="emp-cel-lb-video" controls playsinline preload="metadata"></video>'
            +   '<div class="emp-cel-lb-over"><div class="emp-cel-lb-dots" id="emp-cel-lb-dots"></div><b id="emp-cel-lb-name3"></b><span id="emp-cel-lb-cong-t2"></span></div>'
            + '</div>'
            + '<div class="emp-cel-lb-cap">'
            +   '<div class="emp-cel-lb-card">'
            +     '<div class="emp-cel-lb-bar">'
            +       '<button type="button" class="emp-cel-lb-like" id="emp-cel-lb-like" data-cel-act="like" aria-label="Congratulate" title="Congratulate">' + _IC_CONG + '<em id="emp-cel-lb-like-n"></em></button>'
            +       '<button type="button" class="emp-cel-lb-cmb" data-cel-act="comments" aria-label="Write a message" title="Message">' + _IC_MSGP + '<em id="emp-cel-lb-cm-n"></em></button>'
            +       '<button type="button" class="emp-cel-lb-giftb" data-cel-act="gift" aria-label="Send a gift" title="Send a gift">' + _IC_GIFTP + '</button>'
            +       '<button type="button" class="emp-cel-lb-shbtn" id="emp-cel-lb-chev" data-cel-act="toggle" aria-expanded="false" aria-controls="emp-cel-lb-actions" aria-label="Share" title="Share">' + _IC_SHARE + '</button>'
            +     '</div>'
            +     '<div class="emp-cel-lb-actions" id="emp-cel-lb-actions"><div class="emp-cel-lb-actions-in"><div class="emp-cel-lb-chans">'
            +       '<button type="button" data-cel-act="copy" class="cp" aria-label="Copy link">' + _IC_LINK + '</button>'
            +       '<button type="button" data-cel-act="whatsapp" class="wa" aria-label="Share on WhatsApp"><i class="fab fa-whatsapp"></i></button>'
            +       '<button type="button" data-cel-act="facebook" class="fb" aria-label="Share on Facebook"><i class="fab fa-facebook-f"></i></button>'
            +       '<button type="button" data-cel-act="twitter" class="tw" aria-label="Share on X"><i class="fab fa-x-twitter"></i></button>'
            +       '<button type="button" data-cel-act="telegram" class="tg" aria-label="Share on Telegram"><i class="fab fa-telegram"></i></button>'
            +       '<button type="button" data-cel-act="linkedin" class="li" aria-label="Share on LinkedIn"><i class="fab fa-linkedin-in"></i></button>'
            +       '<button type="button" data-cel-act="native" class="more" aria-label="More share options">' + _IC_SHARE + '</button>'
            +     '</div></div></div>'
            +     '<div class="emp-cel-lb-stats"><b id="emp-cel-lb-stat-l">0</b> congratulations &middot; <b id="emp-cel-lb-stat-c">0</b> messages</div>'
            +     '<div class="emp-cel-lb-capt">'
            +       '<div class="emp-cel-lb-line"><b id="emp-cel-lb-name2"></b> <span id="emp-cel-lb-cong-t"></span></div>'
            +       '<div class="emp-cel-lb-rows">'
            +         '<div class="emp-cel-lb-row course"><i>' + _IC_COURSE + '</i><span id="emp-cel-lb-course"></span></div>'
            +         '<div class="emp-cel-lb-row dept" id="emp-cel-lb-dept-row"><i>' + _IC_DEPT + '</i><span id="emp-cel-lb-dept"></span></div>'
            +         '<div class="emp-cel-lb-row inst"><i>' + _IC_INST + '</i><span id="emp-cel-lb-inst"></span></div>'
            +       '</div>'
            +       '<p class="emp-cel-lb-by">Empyrean is proud of you \u2764\uFE0F</p>'
            +       '<button type="button" id="emp-cel-lb-del" class="emp-cel-lb-del" data-cel-act="del-own" style="display:none;">Delete my celebration</button>'
            +     '</div>'
            +     '<h3 class="emp-cel-lb-sech">Send Congratulations</h3>'
            +     '<div class="emp-cel-eng-quick">'
            +       '<button type="button" id="emp-cel-chip-1" data-cel-act="chip" data-emoji="Huge congratulations! 🎉">Huge congrats! 🎉</button>'
            +       '<button type="button" data-cel-act="chip" data-emoji="Wishing you the best! 🌟">Wishing you the best! 🌟</button>'
            +       '<button type="button" data-cel-act="chip" data-emoji="Empyrean is proud of you! ❤️">Empyrean is proud of you! ❤️</button>'
            +     '</div>'
            +     '<div class="emp-cel-eng-form"><input type="text" id="emp-cel-eng-in" maxlength="300" placeholder="Write a message…" autocomplete="off">'
            +       '<button type="button" data-cel-act="send" aria-label="Send message">' + _IC_SEND + '</button></div>'
            +     '<div class="emp-cel-eng-list" id="emp-cel-eng-list"></div>'
            +   '</div>'
            + '</div>';
        document.body.appendChild(ov);
        ov.addEventListener('click', function (e) {
            if (ov.style.zIndex) { ov.style.zIndex = ''; return; } // back from the gift catalog: this tap just brings the viewer forward
            var ca = e.target.closest ? e.target.closest('[data-cel-act]') : null;
            if (ca) { _lbAct(ca.getAttribute('data-cel-act'), ca); return; }
            var id = e.target.id;
            if (e.target === ov || (e.target.closest && e.target.closest('#emp-cel-lb-close')) || (e.target.classList && e.target.classList.contains('emp-cel-lb-stage'))) _close();
        });
        var x0 = null;
        ov.addEventListener('touchstart', function (e) { x0 = (e.target && (e.target.tagName === 'VIDEO' || (e.target.closest && e.target.closest('.emp-cel-lb-cap')))) ? null : (e.touches && e.touches[0] ? e.touches[0].clientX : null); }, { passive: true });
        ov.addEventListener('touchend', function (e) {
            if (x0 == null) return;
            var x1 = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : x0;
            if (Math.abs(x1 - x0) > 50) _step(x1 < x0 ? 1 : -1);
            x0 = null;
        }, { passive: true });
        document.addEventListener('keydown', function (e) {
            if (!ov.classList.contains('show')) return;
            var _eg = document.getElementById('emp-cel-eng'), _egOn = _eg && _eg.classList.contains('show');
            if (e.key === 'Enter' && e.target && e.target.id === 'emp-cel-eng-in') { e.preventDefault(); _cmSend(); return; }
            if (_egOn) { if (e.key === 'Escape') _engOpen(false); return; }
            if (e.key === 'Escape') _close();
            else if (e.key === 'ArrowRight') _step(1);
            else if (e.key === 'ArrowLeft') _step(-1);
        });
        return ov;
    }
    function _paint() {
        var img = document.getElementById('emp-cel-lb-img'), vid = document.getElementById('emp-cel-lb-video');
        var n = _lb.slides.length, s = _lb.slides[_lb.i] || {};
        if (vid) { try { vid.pause(); } catch (e) {} }
        if (s.v) {
            if (img) img.style.display = 'none';
            if (vid) { vid.style.display = 'block'; vid.poster = s.poster || ''; if (vid.getAttribute('src') !== s.src) vid.src = s.src; }
        } else {
            if (vid) { vid.style.display = 'none'; vid.removeAttribute('src'); try { vid.load(); } catch (e) {} }
            if (img) { img.style.display = ''; img.style.opacity = '0'; img.onload = function () { img.style.opacity = '1'; }; img.src = s.src || ''; }
        }
        var _stg = document.querySelector('#emp-cel-lb .emp-cel-lb-stage'); if (_stg) _stg.classList.toggle('is-video', !!s.v);
        var c = document.getElementById('emp-cel-lb-count'); if (c) c.textContent = (_lb.i + 1) + ' / ' + n;
        var multi = n > 1;
        var dots = document.getElementById('emp-cel-lb-dots');
        if (dots) { var dh = ''; if (multi) for (var di = 0; di < Math.min(n, 8); di++) dh += '<i' + (di === _lb.i ? ' class="on"' : '') + '></i>'; dots.innerHTML = dh; }
    }
    function _step(d) {
        var n = _lb.slides.length; if (n < 2) return;
        _lb.i = (_lb.i + d + n) % n;
        _paint();
    }
    function _open(id) {
        var it = _find(id); if (!it) return;
        var imgs = _imgs(it); if (!imgs.length) return;
        _lb.imgs = imgs; _lb.slides = _slides(it); _lb.i = 0;
        var ov = _lbEl();
        _lb.id = id; _lb.item = it;
        var _delB = document.getElementById('emp-cel-lb-del'); if (_delB) _delB.style.display = _lbIsOwner() ? '' : 'none';
        var mat = it.type === 'matriculation';
        var bd = document.getElementById('emp-cel-lb-badge');
        if (bd) { bd.textContent = mat ? '\uD83C\uDF89 Matriculation' : '\uD83C\uDF93 Convocation'; bd.className = 'emp-cel-lb-badge' + (mat ? ' mat' : ''); }
        var nm = document.getElementById('emp-cel-lb-name'); if (nm) nm.textContent = it.studentName || '';
        var _set = function (elId, v) { var el = document.getElementById(elId); if (el) el.textContent = v || ''; };
        _set('emp-cel-lb-name2', it.studentName);
        var _avi = document.getElementById('emp-cel-lb-av-img'); if (_avi) _avi.src = imgs[0] || '';
        var _avc = document.getElementById('emp-cel-lb-av-ic'); if (_avc) _avc.textContent = mat ? '\uD83C\uDF89' : '\uD83C\uDF93';
        var _tm = _ms(it.pushedAt || it.createdAt);
        _set('emp-cel-lb-time', _tm && typeof window._timeAgo === 'function' ? '\u00B7 ' + window._timeAgo(_tm) : '');
        _set('emp-cel-lb-inst', it.institution); _set('emp-cel-lb-course', it.course); _set('emp-cel-lb-dept', it.department);
        var _first = String(it.studentName || '').trim().split(/\s+/)[0] || '';
        var _i3 = document.getElementById('emp-cel-lb-3d'); if (_i3) _i3.innerHTML = mat ? _IC3D_MAT : _IC3D_GRAD;
        _set('emp-cel-lb-cong-t', mat ? 'Congratulations on your Matriculation!' : 'Congratulations on your Convocation!');
        _set('emp-cel-lb-cong-t2', mat ? 'Congratulations on your Matriculation!' : 'Congratulations on your Convocation!');
        _set('emp-cel-lb-name3', it.studentName);
        var _cy = _classYear(it);
        _set('emp-cel-lb-seal-t', mat ? 'Matriculation ' + _cy : 'Class of ' + _cy);
        _set('emp-cel-lb-tbadge', mat ? 'Matriculation' : 'Convocation');
        var _c1 = document.getElementById('emp-cel-chip-1');
        if (_c1) { var _t1 = mat ? 'Welcome aboard! \uD83C\uDF89' : 'Huge congrats! \uD83C\uDF89'; _c1.textContent = _t1; _c1.setAttribute('data-emoji', mat ? 'Welcome aboard, and congratulations on your matriculation! \uD83C\uDF89' : 'Huge congratulations on your convocation! \uD83C\uDF89'); }
        var dr = document.getElementById('emp-cel-lb-dept-row'); if (dr) dr.style.display = it.department ? '' : 'none';
        var cr = document.getElementById('emp-cel-lb-course'); if (cr && cr.parentNode) cr.parentNode.style.display = it.course ? '' : 'none';
        _lbToggleActions(false);
        _lbReactionsStart(id);
        _engOpen(false); _cmStart(id);
        _paint();
        ov.classList.add('show');
        ov.scrollTop = 0;
        document.body.style.overflow = 'hidden';
    }
    function _close() {
        var ov = document.getElementById('emp-cel-lb');
        if (ov) ov.classList.remove('show');
        _lbReactionsStop(); _cmStop(); _engOpen(false); _lbToggleActions(false); _lb.id = null; _lb.item = null;
        if (ov) ov.style.zIndex = '';
        var _v = document.getElementById('emp-cel-lb-video'); if (_v) { try { _v.pause(); _v.removeAttribute('src'); _v.load(); } catch (e) {} }
        document.body.style.overflow = '';
    }

    /* ───────── member submission form ───────── */
    var MAX_USER_IMGS = 5;
    var _fresh = [];        // chosen photos: { file, url(objectURL) }
    var _freshVid = null;   // chosen video: { file, url(poster objectURL), poster(Blob) }
    var MAX_VIDEO_BYTES = 60 * 1024 * 1024, MAX_VIDEO_SEC = 90;
    function _videoPoster(file) {
        // Grabs a JPEG frame from the chosen video (Storage URLs have no server-made thumbnail).
        // Always resolves: if the browser can't decode the clip, a branded play-button card is used.
        return new Promise(function (resolve) {
            var url = null, done = false, v = document.createElement('video');
            function finish(blob, dur) {
                if (done) return; done = true;
                v.onerror = v.onseeked = v.onloadedmetadata = null;
                try { URL.revokeObjectURL(url); } catch (e) {}
                try { v.removeAttribute('src'); } catch (e) {}
                resolve({ blob: blob, duration: dur || 0 });
            }
            function placeholder(dur) {
                try {
                    var c = document.createElement('canvas'); c.width = 720; c.height = 900;
                    var x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 720, 900);
                    g.addColorStop(0, '#283aaa'); g.addColorStop(1, '#0e1438');
                    x.fillStyle = g; x.fillRect(0, 0, 720, 900);
                    x.fillStyle = 'rgba(255,255,255,0.92)'; x.beginPath(); x.arc(360, 450, 90, 0, Math.PI * 2); x.fill();
                    x.fillStyle = '#0e1438'; x.beginPath(); x.moveTo(335, 405); x.lineTo(335, 495); x.lineTo(415, 450); x.closePath(); x.fill();
                    c.toBlob(function (b) { finish(b, dur); }, 'image/jpeg', 0.85);
                } catch (e) { finish(null, dur); }
            }
            try {
                url = URL.createObjectURL(file);
                v.muted = true; v.playsInline = true; v.preload = 'metadata';
                v.onloadedmetadata = function () { var d = v.duration; try { v.currentTime = Math.min(0.6, (d || 1) / 3); } catch (e) { placeholder(d); } };
                v.onseeked = function () {
                    try {
                        var w = v.videoWidth, h = v.videoHeight, dur = v.duration;
                        if (!w || !h) return placeholder(dur);
                        var r = Math.min(1, 1280 / Math.max(w, h)), c = document.createElement('canvas');
                        c.width = Math.round(w * r); c.height = Math.round(h * r);
                        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
                        c.toBlob(function (b) { if (b) finish(b, dur); else placeholder(dur); }, 'image/jpeg', 0.86);
                    } catch (e) { placeholder(v.duration); }
                };
                v.onerror = function () { placeholder(0); };
                setTimeout(function () { if (!done) placeholder(0); }, 8000);
                v.src = url;
            } catch (e) { placeholder(0); }
        });
    }
    function _clearVid() { if (_freshVid && _freshVid.url) { try { URL.revokeObjectURL(_freshVid.url); } catch (e) {} } _freshVid = null; _paintVPrev(); }
    function _paintVPrev() {
        var p = document.getElementById('emp-cel-f-vprev'); if (!p) return;
        p.innerHTML = _freshVid ? '<div class="emp-cel-prev vid"><img src="' + _esc(_freshVid.url) + '" alt=""><button type="button" data-rmv="1" aria-label="Remove video">&times;</button></div>' : '';
    }
    var _submitting = false;

    function _canSubmit() {
        var u = window.fbAuth && window.fbAuth.currentUser;
        return !!(u && !u.isAnonymous && !window.isGuest);
    }
    function _notify(m, t) { if (typeof window.showNotification === 'function') window.showNotification(m, t || 'info'); }
    function _shrink(file) {
        return new Promise(function (resolve) {
            try {
                var url = URL.createObjectURL(file), im = new Image();
                im.onload = function () {
                    try {
                        var max = 1600, r = Math.min(1, max / Math.max(im.width, im.height));
                        var c = document.createElement('canvas');
                        c.width = Math.round(im.width * r); c.height = Math.round(im.height * r);
                        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
                        URL.revokeObjectURL(url);
                        c.toBlob(function (b) { resolve(b ? new File([b], 'celebration.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.86);
                    } catch (e) { resolve(file); }
                };
                im.onerror = function () { resolve(file); };
                im.src = url;
            } catch (e) { resolve(file); }
        });
    }
    function _fv(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }

    function _formEl() {
        var ov = document.getElementById('emp-cel-form');
        if (ov) return ov;
        ov = document.createElement('div');
        ov.id = 'emp-cel-form';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.innerHTML =
            '<div class="emp-cel-sheet">'
            + '<div class="emp-cel-sheet-h"><div><div class="t">\uD83C\uDF93 Share your celebration</div><div class="s">Convocating or newly matriculated? Tell the community.</div></div>'
            + '<button type="button" id="emp-cel-f-close" aria-label="Close">&times;</button></div>'
            + '<div class="emp-cel-sheet-b">'
            +   '<label class="emp-sch-lbl">I am celebrating my</label>'
            +   '<select class="emp-sch-in" id="emp-cel-f-type"><option value="convocation">\uD83C\uDF93 Convocation (graduating)</option><option value="matriculation">\uD83C\uDF89 Matriculation (new student)</option></select>'
            +   '<label class="emp-sch-lbl" style="margin-top:12px;">Name of institution</label>'
            +   '<input class="emp-sch-in" type="text" id="emp-cel-f-inst" list="emp-cel-f-inst-list" maxlength="120" placeholder="e.g. Covenant University"><datalist id="emp-cel-f-inst-list"></datalist>'
            +   '<label class="emp-sch-lbl" style="margin-top:12px;">Student name</label>'
            +   '<input class="emp-sch-in" type="text" id="emp-cel-f-name" maxlength="120" placeholder="Your full name">'
            +   '<label class="emp-sch-lbl" style="margin-top:12px;">Course of study</label>'
            +   '<input class="emp-sch-in" type="text" id="emp-cel-f-course" maxlength="160" placeholder="e.g. B.Sc. Mechanical Engineering">'
            +   '<label class="emp-sch-lbl" style="margin-top:12px;">Department <span style="font-weight:500;opacity:.7;">(optional)</span></label>'
            +   '<input class="emp-sch-in" type="text" id="emp-cel-f-dept" maxlength="120" placeholder="e.g. Engineering">'
            +   '<label class="emp-sch-lbl" style="margin-top:12px;" id="emp-cel-f-year-lbl">Graduation year (Class of)</label>'
            +   '<input class="emp-sch-in" type="text" inputmode="numeric" pattern="[0-9]*" id="emp-cel-f-year" maxlength="4" value="' + new Date().getFullYear() + '" placeholder="' + new Date().getFullYear() + '">'
            +   '<label class="emp-sch-lbl" style="margin-top:12px;">Photos <span style="font-weight:500;opacity:.7;">(1\u2013' + MAX_USER_IMGS + ' \u2014 the first is your card photo)</span></label>'
            +   '<input class="emp-sch-in" type="file" accept="image/*" multiple id="emp-cel-f-files">'
            +   '<div id="emp-cel-f-prev" class="emp-cel-prevgrid"></div>'
            +   '<label class="emp-sch-lbl" style="margin-top:12px;">Video <span style="font-weight:500;opacity:.7;">(optional \u2014 one clip, up to 90 seconds / 60 MB)</span></label>'
            +   '<input class="emp-sch-in" type="file" accept="video/*" id="emp-cel-f-video">'
            +   '<div id="emp-cel-f-vprev" class="emp-cel-prevgrid"></div>'
            +   '<div class="emp-cel-note">Your celebration goes live on the Dashboard immediately. Please post only your own genuine photos.</div>'
            +   '<button type="button" id="emp-cel-f-submit" class="emp-cel-submit">Publish my celebration</button>'
            + '</div></div>';
        document.body.appendChild(ov);
        ov.addEventListener('change', function (e) {
            if (e.target && e.target.id === 'emp-cel-f-type') { var yl = document.getElementById('emp-cel-f-year-lbl'); if (yl) yl.textContent = e.target.value === 'matriculation' ? 'Matriculation year' : 'Graduation year (Class of)'; }
        });
        ov.addEventListener('click', function (e) {
            if (e.target === ov || e.target.id === 'emp-cel-f-close') _closeForm();
            if (e.target.closest && e.target.closest('[data-rmv]')) { _clearVid(); return; }
            var rm = e.target.closest ? e.target.closest('[data-rm]') : null;
            if (rm) {
                var x = _fresh.splice(parseInt(rm.getAttribute('data-i'), 10), 1)[0];
                if (x) { try { URL.revokeObjectURL(x.url); } catch (er) {} }
                _paintPrev();
            }
        });
        document.getElementById('emp-cel-f-files').addEventListener('change', function () {
            var inp = this, files = Array.prototype.slice.call(inp.files || []);
            var room = MAX_USER_IMGS - _fresh.length;
            if (files.length > room) _notify('You can add up to ' + MAX_USER_IMGS + ' photos \u2014 extra photos were skipped.', 'warning');
            files.slice(0, Math.max(0, room)).forEach(function (fl) { if (/^image\//.test(fl.type)) _fresh.push({ file: fl, url: URL.createObjectURL(fl) }); });
            inp.value = '';
            _paintPrev();
        });
        document.getElementById('emp-cel-f-video').addEventListener('change', function () {
            var inp = this, fl = inp.files && inp.files[0]; inp.value = '';
            if (!fl) return;
            if (!/^video\//.test(fl.type)) { _notify('Please choose a video file.', 'warning'); return; }
            if (fl.size > MAX_VIDEO_BYTES) { _notify('That video is larger than 60 MB \u2014 please trim or compress it first.', 'warning'); return; }
            _videoPoster(fl).then(function (r) {
                if (r.duration && r.duration > MAX_VIDEO_SEC) { _notify('That video is longer than 90 seconds \u2014 please trim it.', 'warning'); return; }
                _clearVid();
                _freshVid = { file: fl, poster: r.blob, url: r.blob ? URL.createObjectURL(r.blob) : '' };
                _paintVPrev();
            });
        });
        document.getElementById('emp-cel-f-submit').addEventListener('click', _submitForm);
        return ov;
    }
    function _paintPrev() {
        var p = document.getElementById('emp-cel-f-prev'); if (!p) return;
        p.innerHTML = _fresh.map(function (x, i) {
            return '<div class="emp-cel-prev"><img src="' + _esc(x.url) + '" alt=""><button type="button" data-rm="1" data-i="' + i + '" aria-label="Remove photo">&times;</button></div>';
        }).join('');
    }
    function _openForm() {
        if (!_canSubmit()) { _notify('Please sign in to share your celebration.', 'warning'); return; }
        var ov = _formEl();
        var seen = {}, opts = '';
        _items.forEach(function (it) { var k = String(it.institution || '').trim(); if (k && !seen[k.toLowerCase()]) { seen[k.toLowerCase()] = 1; opts += '<option value="' + _esc(k) + '"></option>'; } });
        var dl = document.getElementById('emp-cel-f-inst-list'); if (dl) dl.innerHTML = opts;
        var nm = document.getElementById('emp-cel-f-name');
        if (nm && !nm.value) nm.value = (window.userState && (window.userState.fullName || window.userState.name)) || '';
        ov.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
    function _closeForm() {
        var ov = document.getElementById('emp-cel-form');
        if (ov) ov.classList.remove('show');
        document.body.style.overflow = '';
    }
    function _resetForm() {
        ['emp-cel-f-inst', 'emp-cel-f-course', 'emp-cel-f-dept'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
        var _yr0 = document.getElementById('emp-cel-f-year'); if (_yr0) _yr0.value = String(new Date().getFullYear());
        _fresh.forEach(function (x) { try { URL.revokeObjectURL(x.url); } catch (e) {} });
        _fresh = []; _paintPrev(); _clearVid();
    }
    function _submitForm() {
        if (_submitting) return;
        var btn = document.getElementById('emp-cel-f-submit');
        var u = window.fbAuth && window.fbAuth.currentUser;
        if (!_canSubmit() || !window.fbDb) { _notify('Please sign in to share your celebration.', 'warning'); return; }
        var inst = _fv('emp-cel-f-inst'), name = _fv('emp-cel-f-name'), course = _fv('emp-cel-f-course');
        if (!inst || !name || !course) { _notify('Institution, student name and course of study are required.', 'warning'); return; }
        var _yrRaw = _fv('emp-cel-f-year'), classYear = parseInt(_yrRaw, 10);
        if (!_yrRaw || !(classYear >= 1950 && classYear <= new Date().getFullYear() + 8)) { _notify('Enter a valid 4-digit year (for example ' + new Date().getFullYear() + ').', 'warning'); return; }
        if (!_fresh.length && !_freshVid) { _notify('Add at least one photo or a video.', 'warning'); return; }
        if (typeof window.uploadToCloudinary !== 'function') { _notify('Photo upload is not ready yet \u2014 try again in a moment.', 'error'); return; }

        _submitting = true;
        if (btn) btn.disabled = true;
        var urls = [], chain = Promise.resolve(), snapshot = _fresh.slice(), vOut = null, vSnap = _freshVid;
        if (vSnap) {
            chain = chain.then(function () {
                if (btn) btn.textContent = 'Uploading video\u2026';
                if (!vSnap.poster) throw new Error('could not prepare the video thumbnail');
                return window.uploadToCloudinary(new File([vSnap.poster], 'celebration-poster.jpg', { type: 'image/jpeg' })).then(function (pu) {
                    return window.uploadToCloudinary(vSnap.file).then(function (vu) {
                        if (!pu || !vu) throw new Error('video upload returned no URL');
                        vOut = { url: String(vu), poster: String(pu) };
                    });
                });
            });
        }
        snapshot.forEach(function (item, idx) {
            chain = chain.then(function () {
                if (btn) btn.textContent = 'Uploading photo ' + (idx + 1) + ' of ' + snapshot.length + '\u2026';
                return _shrink(item.file).then(function (fl) { return window.uploadToCloudinary(fl); }).then(function (url) {
                    if (!url) throw new Error('upload returned no URL');
                    urls.push(String(url));
                });
            });
        });
        chain.then(function () {
            if (btn) btn.textContent = 'Publishing\u2026';
            var ts = window.firebase.firestore.FieldValue.serverTimestamp();
            var _doc = {
                type: _fv('emp-cel-f-type') === 'matriculation' ? 'matriculation' : 'convocation', classYear: classYear,
                institution: inst, institutionKey: inst.toLowerCase().replace(/\s+/g, ' '),
                studentName: name, course: course, department: _fv('emp-cel-f-dept'),
                images: urls.length ? urls : (vOut ? [vOut.poster] : []), videoUrl: vOut ? vOut.url : '', videoPoster: vOut ? vOut.poster : '', active: true, status: 'approved',
                submitterUid: u.uid, submitterId: String((window.userState && window.userState.id) || ''),
                createdAt: ts, pushedAt: ts
            };
            // If the live Firestore rule predates the classYear field, publish without it (the card then shows the post year).
            return window.fbDb.collection(COL).add(_doc).catch(function (err) {
                if (err && (err.code === 'permission-denied' || /permission/i.test(err.message || ''))) { delete _doc.classYear; return window.fbDb.collection(COL).add(_doc); }
                throw err;
            });
        }).then(function () {
            _resetForm(); _closeForm();
            _notify('\uD83C\uDF89 Published! Your celebration is now live on the Dashboard.', 'success');
        }).catch(function (err) {
            _notify('Could not submit: ' + (err && err.message ? err.message : 'please try again.'), 'error');
        }).then(function () {
            _submitting = false;
            if (btn) { btn.disabled = false; btn.textContent = 'Publish my celebration'; }
        });
    }
    document.addEventListener('empyrean-user-ready', function () { setTimeout(_render, 200); });
    document.addEventListener('empyrean-init-done', function () { setTimeout(_render, 600); });

    /* ───────── live data ───────── */
    function _start() {
        if (_unsub) return;
        if (!(window.fbDb && window._firebaseLoaded)) return;
        try {
            _unsub = window.fbDb.collection(COL).where('active', '==', true).onSnapshot(function (snap) {
                var list = [];
                snap.forEach(function (doc) { var d = doc.data() || {}; d.id = doc.id; list.push(d); });
                list.sort(function (a, b) { return _ms(b.pushedAt || b.createdAt) - _ms(a.pushedAt || a.createdAt); });
                _items = list;
                _render();
                // ?celebration=<id> share link: re-open that card once its doc has arrived
                if (!_lb.deepDone) {
                    var dm = /[?&]celebration=([^&#]+)/.exec(window.location.search || '');
                    if (!dm) _lb.deepDone = true;
                    else {
                        var did = decodeURIComponent(dm[1]);
                        if (_find(did)) { _lb.deepDone = true; setTimeout(function () { _open(did); }, 500); }
                        else if (!(snap.metadata && snap.metadata.fromCache)) _lb.deepDone = true; // server says it isn't live
                    }
                }
            }, function (err) {
                console.warn('[EmpCelebration] live listener failed:', err && err.message);
                _unsub = null;
            });
        } catch (e) { console.warn('[EmpCelebration] start failed:', e && e.message); _unsub = null; }
    }

    setInterval(function () { if (_items.length) _render(); }, 60 * 60 * 1000); // drop expired cards in a long-open tab
    document.addEventListener('empyrean-init-done', function () { setTimeout(_start, 300); setTimeout(_start, 2500); });
    window.addEventListener('empyrean:firebase-ready', function () { setTimeout(_start, 150); });
    if (document.readyState !== 'loading') setTimeout(_start, 500);
    else document.addEventListener('DOMContentLoaded', function () { setTimeout(_start, 500); });

    console.log('[EmpFeed] \u2705 Celebration rail ready \u2014 live `celebrations` render as per-institution horizontal card rows on the dashboard, with a swipeable photo gallery.');
})();


/* =============================================================================
   2026-10-18 — PREMIUM ENGAGEMENT BAR MODULE (approved design)
   1. Builds the stats line above each card's action bar ("1.2K likes · 48 comments ·
      12 reposts … 91 views", or "supporters" on SOS cards) from the counts the buttons
      already carry, and keeps it in sync when those counts change.
   2. Swaps the like / comment / repost / bookmark / download glyphs for the approved
      thin-line set. The SHARE icon is deliberately left as the original three-node icon.
   Works for every card type built into #feed-container (regular, SOS, crisis, election).
   The in-button count spans are hidden by style.css — the stats line replaces them.
   ============================================================================= */
(function empyreanEngagementBar() {
    'use strict';
    if (window._empEngBarLoaded) return;
    window._empEngBarLoaded = true;

    var ICONS = {
        like:     '<path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.5 2.6C20.5 15 12 20.5 12 20.5z"/>',
        comment:  '<path d="M4 5.5h16v10.5H9.5L5 19.5V16H4z"/>',
        retweet:  '<path d="M4 11V9a3 3 0 0 1 3-3h11l-2.5-2.5M20 13v2a3 3 0 0 1-3 3H6l2.5 2.5"/>',
        bookmark: '<path d="M6.5 3.5h11v17L12 16.5l-5.5 4z"/>',
        download: '<path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19.5h14"/>'
    };

    function num(card, sel) {
        var el = card.querySelector(sel);
        var t = el ? (el.textContent || '').trim() : '';
        return (t && t !== '0') ? t : '';
    }
    function lbl(n, one, many) { return n === '1' ? one : many; }

    function enhance(card) {
        var bar = null;
        for (var i = 0; i < card.children.length; i++) {
            if (card.children[i].classList && card.children[i].classList.contains('story-actions')) { bar = card.children[i]; break; }
        }
        if (!bar) return;

        if (!bar._empIcons) {
            bar._empIcons = true;
            Object.keys(ICONS).forEach(function (k) {
                var svg = bar.querySelector('[data-action="' + k + '"] svg');
                if (svg) { svg.setAttribute('viewBox', '0 0 24 24'); svg.innerHTML = ICONS[k]; }
            });
        }

        var stats = bar.previousElementSibling;
        if (!stats || !stats.classList || !stats.classList.contains('emp-stats')) {
            stats = document.createElement('div');
            stats.className = 'emp-stats empty';
            bar.parentNode.insertBefore(stats, bar);
        }
        var sos = card.classList.contains('sos-request');
        var likes = num(card, '.like-count'), comments = num(card, '.comment-count'),
            reposts = num(card, '.retweet-count'), views = num(card, '.view-count');
        var html = '';
        if (likes)    html += '<span><b>' + likes + '</b> ' + (sos ? lbl(likes, 'supporter', 'supporters') : lbl(likes, 'like', 'likes')) + '</span>';
        if (comments) html += '<span><b>' + comments + '</b> ' + lbl(comments, 'comment', 'comments') + '</span>';
        if (reposts)  html += '<span><b>' + reposts + '</b> ' + lbl(reposts, 'repost', 'reposts') + '</span>';
        if (views)    html += '<span class="g"></span><span class="emp-views"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>' + views + ' ' + lbl(views, 'view', 'views') + '</span>';
        if (stats._empHtml !== html) {
            stats._empHtml = html;
            stats.innerHTML = html;
            stats.classList.toggle('empty', !html);
        }
    }

    var mo = null, timer = null;
    function scan() {
        var fc = document.getElementById('feed-container');
        if (!fc) return;
        if (mo) mo.disconnect();                       // our own writes must not re-trigger us
        /* 2026-10-18: also visit cards inside the Quotes & Memes and Presidential-candidate horizontal strips
           (they are nested in .horizontal-slider-wrapper, not direct children of the feed) so they get the
           same stats line + approved icons as every other card. */
        var cards = fc.querySelectorAll(':scope > .impact-story, :scope > #dash-feed-quotecard-strip .horizontal-slider-wrapper > .impact-story, :scope > #dashboard-election-support-strip .horizontal-slider-wrapper > .impact-story');
        for (var i = 0; i < cards.length; i++) { try { enhance(cards[i]); } catch (e) {} }
        if (mo) mo.observe(fc, { childList: true, subtree: true, characterData: true });
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(scan, 120); }

    function start() {
        var fc = document.getElementById('feed-container');
        if (!fc) { setTimeout(start, 500); return; }
        if (mo) return;
        mo = new MutationObserver(schedule);
        scan();
    }
    if (document.readyState !== 'loading') start();
    else document.addEventListener('DOMContentLoaded', start);
    document.addEventListener('empyrean-init-done', function () { setTimeout(start, 300); setTimeout(scan, 800); });

    console.log('[EmpFeed] \u2705 Premium engagement bar (stats line + approved icons) ready.');
})();
