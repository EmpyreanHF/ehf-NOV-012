/* =============================================================================
   EMPYREAN — VIDEO FULLSCREEN + VERTICAL SWIPE VIEWER  v3.1
   app-video-fullscreen.js  |  Load after app-feed.js

   v3.1 FIX: Thread page interaction fully restored.
   ─────────────────────────────────────────────────
   ROOT BUG: When the X/Twitter-style thread slide-in page opens while the
   fullscreen viewer is active, #vfs-tapzone (z-index 11050) and #vfs-overlay
   (z-index 11000) remained active and intercepted ALL pointer events inside
   the thread page — making nav, buttons, quote, share, submit dead.

   FIX APPLIED:
   • window._vfsPauseForThread() — called by app-thread.js when thread opens.
     Sets overlay pointer-events:none + pauses current video.
   • window._vfsResumeFromThread() — called by app-thread.js when thread closes.
     Restores pointer-events + resumes video.
   • Caption (#vfs-caption) click now calls _vfsPauseForThread() before triggering
     window.openPostThread() so the hand-off is atomic.
   • Esc key + close button check thread-is-open before acting.
   • Wheel / touch handlers disabled while thread is open.
   ============================================================================= */

(function EmpVideoFullscreen() {
    'use strict';

    if (window._empVFSv3) return;
    window._empVFSv3 = true;

    /* =========================================================================
       CSS
       ========================================================================= */
    var css = document.createElement('style');
    css.textContent = [
        /* Feed: media item must be relative so overlay can sit inside it.
           FIX: previously scoped to #feed-container only. .vfs-tap is
           position:absolute;inset:0 (see below) — without position:relative
           on ITS OWN parent, it escapes to the nearest positioned ancestor
           instead of staying contained to the thumbnail (the exact bleed-out
           mechanism app-patch-v6.js already had to fix for the thread page).
           Now that _collect()/_decorateAll() also scan profile-dash-feed and
           profile-posts-feed (see below), this containment rule has to cover
           those same containers or the same bleed-out happens there instead. */
        '#feed-container .story-media-item,',
        '#profile-dash-feed .story-media-item,',
        '#profile-posts-feed .story-media-item {',
        '    position: relative !important;',
        '    overflow: hidden;',
        '}',

        /* Transparent click-catcher */
        '.vfs-tap {',
        '    position: absolute;',
        '    inset: 0;',
        '    z-index: 20;',
        '    cursor: pointer;',
        '    background: transparent;',
        '}',

        /* Expand icon badge */
        '.vfs-expand {',
        '    position: absolute;',
        '    top: 9px; right: 9px;',
        '    z-index: 21;',
        '    width: 34px; height: 34px;',
        '    border-radius: 8px;',
        '    background: rgba(0,0,0,0.60);',
        '    backdrop-filter: blur(6px);',
        '    -webkit-backdrop-filter: blur(6px);',
        '    color: #fff;',
        '    font-size: 0.78rem;',
        '    display: flex; align-items: center; justify-content: center;',
        '    pointer-events: none;',
        '    transition: background 0.18s;',
        '    border: 1px solid rgba(255,255,255,0.18);',
        '}',
        '.vfs-tap:hover ~ .vfs-expand {',
        '    background: rgba(245,197,24,0.80);',
        '    color: #000;',
        '}',

        /* Inline feed preview: leave the bottom strip free so the browser's own
           controls (volume, progress, fullscreen) receive their taps; the rest
           of the video still opens the fullscreen viewer. */
        '#feed-container .vfs-tap { bottom: 64px; }',

        /* FIX (2026-10-27 — mute/unmute on profile feed videos opened the
           fullscreen viewer): profile feeds (#profile-posts-feed /
           #profile-dash-feed) use their own control bar (.emp-vc, app-profile.js,
           z-index 7) which sits BELOW this click-catcher (z-index 20). Only
           #feed-container left the bottom strip free, so a tap on the bar's
           mute/pause/seek landed on .vfs-tap and opened the viewer. Same
           64px strip exclusion applied here; the rest of the video still
           opens the viewer. */
        '#profile-posts-feed .vfs-tap, #profile-dash-feed .vfs-tap { bottom: 64px; }',

        /* Home-feed videos already show their own fullscreen button in the
           control bar, so this corner badge made two fullscreen icons
           (and turned yellow after a tap via the sticky :hover rule above).
           Hidden here only — the click-catcher above is untouched, so
           tapping the video still opens the viewer — and the badge stays
           everywhere else it is the only fullscreen affordance. */
        '#feed-container .vfs-expand { display: none !important; }',

        /* Fullscreen overlay */
        '#vfs-overlay {',
        '    position: fixed; inset: 0;',
        '    z-index: 11000;',
        '    background: #000;',
        '    display: none;',
        '    overflow: hidden;',
        '    touch-action: none;',
        '    user-select: none;',
        '}',
        '#vfs-overlay.vfs-open { display: block; }',

        /* Thread-open: z-index on #vf-thread handles overlay stacking, no pointer-events hacks needed */

        /* Slide track */
        '#vfs-track {',
        '    position: absolute; inset: 0;',
        '    will-change: transform;',
        '    backface-visibility: hidden;',
        '    transition: transform 0.26s cubic-bezier(0.22,0.8,0.28,1);',
        '}',
        '.vfs-slide {',
        '    position: absolute; left: 0;',
        '    width: 100%; height: 100%;',
        '    background: #000;',
        '    display: flex; align-items: center; justify-content: center;',
        '}',
        '.vfs-slide video {',
        '    width: 100%; height: 100%;',
        '    object-fit: contain;',
        '    background: #000;',
        '    display: block;',
        '}',

        /* Top bar */
        '#vfs-topbar {',
        '    position: fixed; top: 0; left: 0; right: 0;',
        '    z-index: 11100;',
        '    padding: 14px 16px 10px;',
        '    display: flex; align-items: center; justify-content: space-between;',
        '    background: linear-gradient(to bottom,rgba(0,0,0,0.75) 0%,transparent 100%);',
        '    pointer-events: none;',
        '}',
        '#vfs-topbar > * { pointer-events: auto; }',

        '#vfs-close {',
        '    width: 46px; height: 46px;',
        '    border-radius: 50%;',
        '    border: 1.5px solid rgba(255,255,255,0.25);',
        '    background: rgba(10,14,30,0.72);',
        '    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);',
        '    color: #fff; font-size: 1.4rem;',
        '    cursor: pointer;',
        '    display: flex; align-items: center; justify-content: center;',
        '    transition: background 0.2s, transform 0.15s;',
        '}',
        '#vfs-close:hover { background: rgba(220,53,69,0.80); transform: scale(1.08); }',

        '#vfs-counter {',
        '    font-family: "Syne","Inter",sans-serif;',
        '    font-size: 0.80rem; font-weight: 700;',
        '    color: rgba(255,255,255,0.72);',
        '    letter-spacing: 0.4px;',
        '}',

        /* Bottom info bar */
        '#vfs-infobar {',
        '    position: fixed; bottom: 0; left: 0; right: 0;',
        '    z-index: 11100;',
        '    padding: 56px 16px 20px;',
        '    background: linear-gradient(to top,rgba(0,0,0,0.82) 0%,transparent 100%);',
        '    pointer-events: none;',
        '}',
        '#vfs-infobar > * { pointer-events: auto; }',

        '#vfs-author-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }',

        '#vfs-avatar {',
        '    width: 38px; height: 38px;',
        '    border-radius: 50%;',
        '    border: 2px solid rgba(255,255,255,0.32);',
        '    object-fit: cover; flex-shrink: 0;',
        '}',
        '#vfs-author-name {',
        '    font-family: "Syne","Inter",sans-serif;',
        '    font-size: 0.90rem; font-weight: 700;',
        '    color: #fff;',
        '    text-shadow: 0 1px 4px rgba(0,0,0,0.7);',
        '    display: block;',
        '}',
        '#vfs-author-time { font-size: 0.70rem; color: rgba(255,255,255,0.58); display: block; }',

        /* Caption — plain text, no longer clickable */
        '#vfs-caption {',
        '    font-size: 0.86rem; color: rgba(255,255,255,0.88);',
        '    line-height: 1.45;',
        '    display: -webkit-box;',
        '    -webkit-line-clamp: 2; -webkit-box-orient: vertical;',
        '    overflow: hidden;',
        '    text-shadow: 0 1px 4px rgba(0,0,0,0.7);',
        '    margin-bottom: 10px;',
        '}',

        '#vfs-progress-wrap { height: 3px; background: rgba(255,255,255,0.20); border-radius: 2px; overflow: hidden; }',
        '#vfs-progress-bar { height: 100%; width: 0; background: #F5C518; border-radius: 2px; transition: width 0.2s linear; }',

        /* Right buttons */
        '#vfs-actions {',
        '    position: fixed; right: 14px; bottom: 130px;',
        '    z-index: 11100;',
        '    display: flex; flex-direction: column; gap: 14px; align-items: center;',
        '}',
        '.vfs-btn {',
        '    width: 48px; height: 48px;',
        '    border-radius: 50%;',
        '    border: 1.5px solid rgba(255,255,255,0.20);',
        '    background: rgba(10,14,30,0.68);',
        '    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);',
        '    color: #fff; font-size: 1.05rem; cursor: pointer;',
        '    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;',
        '    transition: background 0.18s, transform 0.12s;',
        '}',
        '.vfs-btn:hover { background: rgba(245,197,24,0.28); transform: scale(1.07); }',
        '.vfs-btn-lbl { font-size: 0.58rem; font-weight: 700; color: rgba(255,255,255,0.75); line-height: 1; }',

        /* Swipe hints */
        '.vfs-hint {',
        '    position: fixed; left: 50%; transform: translateX(-50%);',
        '    z-index: 11100;',
        '    color: rgba(255,255,255,0.30); font-size: 1.4rem;',
        '    pointer-events: none; transition: opacity 0.3s;',
        '}',
        '#vfs-hint-up { top: 68px; }',
        '#vfs-hint-down { bottom: 190px; }',

        /* Play/pause ripple */
        '#vfs-ripple {',
        '    position: fixed; top: 50%; left: 50%;',
        '    transform: translate(-50%,-50%) scale(0);',
        '    width: 76px; height: 76px;',
        '    border-radius: 50%;',
        '    background: rgba(255,255,255,0.16);',
        '    backdrop-filter: blur(6px);',
        '    display: flex; align-items: center; justify-content: center;',
        '    font-size: 1.9rem; color: #fff;',
        '    pointer-events: none;',
        '    z-index: 11200;',
        '    opacity: 0;',
        '    transition: transform 0.16s cubic-bezier(0.34,1.56,0.64,1), opacity 0.28s;',
        '}',
        '#vfs-ripple.show { transform: translate(-50%,-50%) scale(1); opacity: 1; }',

        /* Central tap zone */
        '#vfs-tapzone { position: fixed; inset: 0; z-index: 11050; cursor: pointer; }'
    ].join('\n');
    document.head.appendChild(css);


    /* =========================================================================
       BUILD OVERLAY DOM
       ========================================================================= */
    var ov = document.createElement('div');
    ov.id = 'vfs-overlay';
    ov.innerHTML =
        '<div id="vfs-tapzone"></div>' +
        '<div id="vfs-track"></div>' +
        '<div id="vfs-topbar">' +
            '<button id="vfs-close" title="Close (Esc)">&#x2715;</button>' +
            '<span id="vfs-counter"></span>' +
        '</div>' +
        '<div class="vfs-hint" id="vfs-hint-up">&#8679;</div>' +
        '<div class="vfs-hint" id="vfs-hint-down">&#8681;</div>' +
        '<div id="vfs-infobar">' +
            '<div id="vfs-author-row">' +
                '<img id="vfs-avatar" src="" alt="">' +
                '<div>' +
                    '<span id="vfs-author-name"></span>' +
                    '<span id="vfs-author-time"></span>' +
                '</div>' +
            '</div>' +
            '<div id="vfs-caption"></div>' +
            '<div id="vfs-progress-wrap"><div id="vfs-progress-bar"></div></div>' +
        '</div>' +
        '<div id="vfs-actions">' +
            '<button class="vfs-btn" id="vfs-mute" title="Sound (M)">' +
                '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>' +
                '<span class="vfs-btn-lbl">Sound</span>' +
            '</button>' +
            /* FEATURE (2026-08-31 — "add the Empyrean watermark to video
               downloads ... across all other videos on the site"): the
               fullscreen swipe viewer had no download affordance at all —
               closing it to find the same video's card and its own
               .download-media-btn was the only way to save one of these.
               See _downloadCurrent() below for the actual download +
               watermark logic (reuses app-fixes.js's shared engine, same
               reuse pattern app-reel.js's reel-download button already
               uses — no second watermarking implementation). */
            '<button class="vfs-btn" id="vfs-download" title="Download">' +
                '<i class="fas fa-download"></i>' +
                '<span class="vfs-btn-lbl">Save</span>' +
            '</button>' +
            '<button class="vfs-btn" id="vfs-prev" title="Previous">' +
                '<i class="fas fa-chevron-up"></i>' +
                '<span class="vfs-btn-lbl">Prev</span>' +
            '</button>' +
            '<button class="vfs-btn" id="vfs-next" title="Next">' +
                '<i class="fas fa-chevron-down"></i>' +
                '<span class="vfs-btn-lbl">Next</span>' +
            '</button>' +
        '</div>' +
        '<div id="vfs-ripple"><i id="vfs-ripple-icon" class="fas fa-play"></i></div>';
    document.body.appendChild(ov);


    /* =========================================================================
       STATE + DOM REFS
       ========================================================================= */
    var _list      = [];
    var _idx       = 0;
    var _muted     = false;
    var _slides    = [];
    var _raf       = 0;
    var _isOpen    = false;
    var _threadOpen = false; /* TRUE while X-thread slide-in page is visible */

    var track     = document.getElementById('vfs-track');
    var counter   = document.getElementById('vfs-counter');
    var progBar   = document.getElementById('vfs-progress-bar');
    var hintUp    = document.getElementById('vfs-hint-up');
    var hintDown  = document.getElementById('vfs-hint-down');
    var ripple    = document.getElementById('vfs-ripple');
    var rippleIco = document.getElementById('vfs-ripple-icon');
    var muteBtn   = document.getElementById('vfs-mute');
    var downloadBtn = document.getElementById('vfs-download');
    var prevBtn   = document.getElementById('vfs-prev');
    var nextBtn   = document.getElementById('vfs-next');
    var closeBtn  = document.getElementById('vfs-close');
    var tapZone   = document.getElementById('vfs-tapzone');
    var captionEl = document.getElementById('vfs-caption');
    var commentBtn = document.getElementById('vfs-comment-btn');


    /* =========================================================================
       THREAD PAUSE / RESUME  — called by app-thread.js
       ========================================================================= */

    /**
     * Call this BEFORE showing the thread page.
     * Disables ALL pointer interception on the VFS overlay so the thread page
     * receives every click, tap, and keyboard event normally.
     */
    function _pauseForThread() {
        if (!_isOpen) return;
        _threadOpen = true;
        /* Just pause the video — #vf-thread's z-index beats the overlay, no pointer-events needed */
        var cur = _slides[_idx] && _slides[_idx].querySelector('video');
        if (cur) cur.pause();
        _stopProg();
    }

    /**
     * Call this when the thread page is closed.
     * Resumes the video — no pointer-events restoration needed.
     */
    function _resumeFromThread() {
        _threadOpen = false;
        if (!_isOpen) return;
        var cur = _slides[_idx] && _slides[_idx].querySelector('video');
        if (cur) {
            cur.muted = _muted;
            cur.play().catch(function(){});
            _startProg(cur);
        }
    }

    /* Expose globally so app-thread.js / app-fix-final.js can call them */
    window._vfsPauseForThread  = _pauseForThread;
    window._vfsResumeFromThread = _resumeFromThread;


    /* =========================================================================
       OPEN THREAD from caption / comment button
       ========================================================================= */
    function _openThread() {
        var d = _list[_idx];
        if (!d) return;

        /* Resolve the feed card DOM element — app-thread.js openThread() needs it */
        var postEl = null;
        if (d.el) {
            postEl = d.el.closest('.impact-story, .sos-request, .crisis-report, [data-post-id]');
        }

        /* If we can't find the card element there is nothing to open */
        if (!postEl) {
            console.warn('[EmpVFS] _openThread: could not resolve feed card element');
            return;
        }

        /* app-thread.js exposes window._vfOpenThread(postEl) */
        var openFn = window._vfOpenThread
                  || window.openPostThread
                  || window.openThreadPage
                  || window.empThreadOpen;

        if (typeof openFn !== 'function') {
            console.warn('[EmpVFS] _openThread: no thread open function available');
            return;
        }

        /* Pause VFS video — must happen BEFORE opening thread */
        _pauseForThread();

        openFn(postEl);
    }


    /* =========================================================================
       COLLECT ALL FEED VIDEOS
       FIX (bug: "profile page vertical slide doesn't work effectively" — it
       didn't work AT ALL, not just glitchy): this used to scan ONLY
       '#feed-container .story-media-item', so a video tapped on a profile
       page (rendered into #profile-posts-feed / #profile-dash-feed — see
       app-feed.js's own FEED_IDS group, the established convention every
       other feed-wide feature in this codebase already follows for exactly
       this reason) never got the .vfs-tap overlay wired on at all, and so
       never opened this fullscreen vertical-swipe viewer — tapping it just
       hit the browser's own default <video> element instead, no swipe, no
       viewer, nothing. Scanning all three FEED_IDS containers (same ones
       app-feed.js's advert injector and post-render pipeline already treat
       as one logical feed) means a video opened from the main dashboard
       feed, a profile's Posts tab, or a freshly quick-posted video that
       just landed in either of those containers all resolve to the exact
       same swipeable list, consistently.
       ========================================================================= */
    var FEED_CONTAINER_IDS = ['feed-container', 'profile-dash-feed', 'profile-posts-feed'];

    function _feedSelector() {
        return FEED_CONTAINER_IDS.map(function (id) {
            return '#' + id + ' .story-media-item';
        }).join(', ');
    }

    function _collect() {
        var out = [];
        document.querySelectorAll(_feedSelector()).forEach(function(item) {
            var vid = item.querySelector('video');
            if (!vid) return;
            var src = vid.getAttribute('src') || vid.currentSrc || vid.src || '';
            if (!src) return;

            var post    = item.closest('.impact-story, .sos-request, .crisis-report, [data-post-id]');
            var name    = '', avatar = '', time = '', caption = '', postId = '';
            // FEATURE (2026-08-31 — watermarked download from the fullscreen
            // swipe viewer): captured the same way app-fixes.js's own
            // _resolvePosterUsername() reads it off a card — data-username
            // first, falling back to data-userId — so the watermark burned
            // in here always matches the ORIGINAL poster, not whoever is
            // currently swiping through the viewer.
            var username = '', userId = '';
            if (post) {
                var ne = post.querySelector('.story-user-info strong');
                var ae = post.querySelector('.avatar-placeholder img');
                var te = post.querySelector('.story-user-info span');
                var ce = post.querySelector('.story-content p');
                if (ne) name    = ne.textContent.trim();
                if (ae) avatar  = ae.src || ae.getAttribute('src') || '';
                if (te) time    = te.textContent.trim();
                if (ce) caption = ce.textContent.trim().slice(0, 140);
                postId   = post.dataset.postId || post.getAttribute('data-id') || post.id || '';
                username = post.dataset.username || '';
                userId   = post.dataset.userId || '';
            }
            out.push({ src: src, poster: vid.poster || '',
                       name: name, avatar: avatar, time: time,
                       caption: caption, postId: postId,
                       username: username, userId: userId, el: vid });
        });
        return out;
    }


    /* FIX (2026-10-17 — "video playback pauses intermittently"):
       The browser/WebView can pause a <video> on its own mid-playback
       (buffer underrun on a slow connection, audio-focus blips, a stray
       programmatic pause from another module's bulk-pause sweep). The
       viewer never noticed, so the video just sat paused until tapped.
       Now, if the CURRENT slide pauses (or stalls) while the viewer is
       open and the person did NOT pause it themselves, it is resumed.
       Deliberately NOT resumed: user taps (_userPaused), the thread page
       being open, the viewer being closed, the tab being hidden, and a
       video that simply ended. */
    function _bindPlaybackRecovery(v, slide) {
        function resume() {
            if (!_isOpen || _threadOpen || _userPaused || document.hidden) return;
            if (_slides[_idx] !== slide || v.ended || !v.paused) return;
            v.play().catch(function(){});
        }
        v.addEventListener('pause', function() { setTimeout(resume, 120); });
        v.addEventListener('stalled', function() { setTimeout(resume, 800); });
        v.addEventListener('waiting', function() {
            /* a nudge only if it is still stuck a moment later */
            setTimeout(function() {
                if (_isOpen && _slides[_idx] === slide && !_userPaused && v.paused && !v.ended) resume();
            }, 1500);
        });
    }
    document.addEventListener('visibilitychange', function() {
        if (document.hidden || !_isOpen || _threadOpen || _userPaused) return;
        var cur = _slides[_idx] && _slides[_idx].querySelector('video');
        if (cur && cur.paused && !cur.ended) cur.play().catch(function(){});
    });


    /* =========================================================================
       BUILD SLIDES
       ========================================================================= */
    function _buildSlides(list) {
        track.innerHTML = '';
        _slides = [];
        list.forEach(function(d, i) {
            var slide = document.createElement('div');
            slide.className = 'vfs-slide';
            slide.style.top = (i * 100) + '%';

            var v = document.createElement('video');
            v.src         = d.src;
            v.poster      = d.poster;
            v.muted       = _muted;
            v.loop        = true;
            v.playsInline = true;
            v.preload     = 'metadata';
            v.setAttribute('playsinline', '');
            _bindPlaybackRecovery(v, slide);

            slide.appendChild(v);
            track.appendChild(slide);
            _slides.push(slide);
        });
    }


    /* =========================================================================
       INFO BAR UPDATE
       ========================================================================= */
    function _setInfo(i) {
        var d = _list[i];
        counter.textContent = (i + 1) + ' / ' + _list.length;
        document.getElementById('vfs-avatar').src              = d.avatar  || '';
        document.getElementById('vfs-author-name').textContent = d.name    || 'Member';
        document.getElementById('vfs-author-time').textContent = d.time    || '';
        captionEl.textContent = d.caption || '';
        hintUp.style.opacity   = i > 0                ? '1' : '0';
        hintDown.style.opacity = i < _list.length - 1 ? '1' : '0';
    }


    /* =========================================================================
       PROGRESS BAR
       ========================================================================= */
    function _startProg(vid) {
        cancelAnimationFrame(_raf);
        (function tick() {
            if (vid && vid.duration)
                progBar.style.width = ((vid.currentTime / vid.duration) * 100) + '%';
            _raf = requestAnimationFrame(tick);
        })();
    }
    function _stopProg() { cancelAnimationFrame(_raf); progBar.style.width = '0'; }


    /* =========================================================================
       NAVIGATE TO SLIDE
       ========================================================================= */
    /* FIX (2026-10-17 — "swipe should complete swiftly in a single motion,
       no hanging before it completes"):
       [a] The outgoing video used to be paused AND rewound to 0 the instant
           a swipe was committed, i.e. at the START of the slide animation —
           so for the whole slide-out the old slide flashed to its first
           frame / black while still visibly on screen. It now keeps playing
           (muted) until the slide animation has finished, and is only then
           paused and rewound (and only if the person hasn't swiped back to
           it in the meantime).
       [b] Slide duration cut 0.38s -> 0.26s with a fast-out easing, and a
           flick now finishes in time proportional to its own speed (see the
           touchend handler) so the motion continues the finger's momentum
           instead of restarting a fixed-length animation from standstill.
       [c] Neighbouring slides are warmed (preload='auto') so the next video
           already has data buffered when it slides in — preload='metadata'
           everywhere meant every swipe landed on an unbuffered video that
           then sat on its poster/black frame while it fetched, which is the
           "hang" people see right after the slide itself finishes. */
    var SWIPE_MS = 260;
    var _userPaused = false;

    function _warmNeighbors(i) {
        for (var j = i - 1; j <= i + 1; j++) {
            var v = _slides[j] && _slides[j].querySelector('video');
            if (v && v.preload !== 'auto') v.preload = 'auto';
        }
    }

    function _go(i, animated, ms) {
        if (_threadOpen) return; /* block navigation while thread is open */
        if (i < 0 || i >= _list.length) return;

        var oldIdx = _idx;
        var oldSlide = _slides[oldIdx];
        var old = oldSlide && oldSlide.querySelector('video');
        _stopProg();

        _idx = i;
        _userPaused = false;
        var dur = (animated === false) ? 0 : (ms || SWIPE_MS);
        track.style.transition = (dur === 0) ? 'none' : 'transform ' + dur + 'ms cubic-bezier(0.22,0.8,0.28,1)';
        track.style.transform = 'translate3d(0,' + (-i * 100) + '%,0)';
        _setInfo(i);

        var cur = _slides[i] && _slides[i].querySelector('video');
        if (old && old !== cur) {
            old.muted = true; /* no audio overlap while it slides out */
            if (dur === 0) {
                old.pause(); old.currentTime = 0;
            } else {
                setTimeout(function() {
                    /* only tidy up if it's still not the current slide */
                    if (_slides[_idx] === oldSlide) return;
                    try { old.pause(); old.currentTime = 0; } catch (e) {}
                }, dur + 40);
            }
        }
        if (cur) {
            cur.muted = _muted;
            cur.play().catch(function(){});
            _startProg(cur);
        }
        _warmNeighbors(i);
        _syncMute();
    }


    /* =========================================================================
       OPEN VIEWER
       ========================================================================= */
    function _open(startIdx) {
        _list = _collect();
        if (!_list.length) {
            console.warn('[EmpVFS] No videos found in #feed-container .story-media-item');
            return;
        }
        _buildSlides(_list);
        _threadOpen = false;
        ov.classList.remove('vfs-thread-open');
        ov.style.pointerEvents = '';
        if (tapZone) tapZone.style.pointerEvents = '';
        ov.classList.add('vfs-open');
        document.body.style.overflow = 'hidden';
        _isOpen = true;
        _pausePreviews();
        _go(Math.max(0, Math.min(startIdx || 0, _list.length - 1)), false);
    }
    window.empVFSOpen = _open;


    /* =========================================================================
       CLOSE VIEWER
       ========================================================================= */
    function _close() {
        if (!_isOpen) return;
        if (_threadOpen) {
            /* Close the thread first using the actual exported name */
            var closeFn = window._vfCloseThread
                       || window.closePostThread
                       || window.closeThreadPage
                       || window.empThreadClose;
            if (typeof closeFn === 'function') closeFn();
            _resumeFromThread();
            /* Only close VFS itself if thread is now gone */
            var threadEl = document.getElementById('vf-thread');
            if (threadEl && threadEl.classList.contains('vf-open')) return;
        }
        var cur = _slides[_idx] && _slides[_idx].querySelector('video');
        if (cur) cur.pause();
        _stopProg();
        ov.classList.remove('vfs-open');
        ov.classList.remove('vfs-thread-open');
        ov.style.pointerEvents = '';
        document.body.style.overflow = '';
        _isOpen    = false;
        _threadOpen = false;
        setTimeout(function() { track.innerHTML = ''; _slides = []; }, 500);
        setTimeout(_previewSchedule, 350);
    }


    /* =========================================================================
       MUTE TOGGLE
       ========================================================================= */
    function _syncMute() {
        muteBtn.innerHTML = _muted
            ? '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg><span class="vfs-btn-lbl">Muted</span>'
            : '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg><span class="vfs-btn-lbl">Sound</span>';
    }
    function _toggleMute() {
        _muted = !_muted;
        _slides.forEach(function(s) {
            var v = s.querySelector('video');
            if (v) v.muted = _muted;
        });
        _syncMute();
    }


    /* =========================================================================
       PLAY / PAUSE TAP
       ========================================================================= */
    function _tapPlay() {
        if (_threadOpen) return;
        var cur = _slides[_idx] && _slides[_idx].querySelector('video');
        if (!cur) return;
        if (cur.paused) {
            _userPaused = false;
            cur.play().catch(function(){});
            rippleIco.className = 'fas fa-play';
        } else {
            _userPaused = true; /* intentional — auto-recovery below must leave it alone */
            cur.pause();
            rippleIco.className = 'fas fa-pause';
        }
        ripple.classList.add('show');
        setTimeout(function() { ripple.classList.remove('show'); }, 650);
    }


    /* =========================================================================
       DOWNLOAD CURRENT SLIDE — watermarked (reuses app-fixes.js's shared
       engine; see the FEATURE comment on the #vfs-download button markup
       above for why this exists and app-reel.js's own reel-download button
       for the identical reuse pattern). Falls back to a plain, un-
       watermarked download on any unsupported browser or failed re-encode
       — a download must never be lost over a watermarking hiccup.
       ========================================================================= */
    function _notifyVfs(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    }

    function _downloadCurrent() {
        var d = _list[_idx];
        if (!d || !d.src) { _notifyVfs('Video not available to download.', 'error'); return; }

        var filename = 'empyrean-video-' + (d.postId || Date.now());

        /* FIX (2026-09-01 — "clicking download opens the video instead of
           downloading it"): the old plain fallback here was a raw
           `<a href="https://res.cloudinary.com/...mp4" target="_blank"
           download>`. The `download` attribute is ignored by browsers on a
           cross-origin href (which a Cloudinary URL always is), leaving
           only `target="_blank"` — so the new tab just navigated to (i.e.
           opened/played) the raw video instead of saving it. Same root
           cause and same fix as app-reel.js's download button: route the
           fallback through app-fixes.js's _triggerDownloadClick(), which
           uses Cloudinary's `fl_attachment` flag to force the CDN's own
           response to carry Content-Disposition: attachment — a real save,
           independent of CORS/target — with a same-tab, no-target anchor
           as the last-resort fallback instead of one that opens a tab. */
        var _dlTrackerVfs = (typeof window._createDownloadTracker === 'function')
            ? window._createDownloadTracker(downloadBtn, 1)
            : { update: function () {}, finish: function () {} };

        function _plainDownload() {
            if (typeof window._triggerDownloadClick === 'function') {
                window._triggerDownloadClick(d.src, filename + '.mp4');
            } else {
                var a = document.createElement('a');
                a.href = d.src;
                a.download = filename + '.mp4';
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
            _dlTrackerVfs.update(0, 100);
            _dlTrackerVfs.finish();
            _notifyVfs('Download started!', 'success');
        }

        var username = (typeof window._resolvePosterUsername === 'function')
            ? window._resolvePosterUsername({ dataset: { username: d.username, userId: d.userId } })
            : (d.username || '');

        /* FEATURE (server-side .mp4 watermark — same reuse pattern as
           _clientWatermarkDownloadVfs below): the client canvas re-encode
           can only ever produce .webm (MediaRecorder, no bundled
           transcoder). window._watermarkVideoServer (app-fixes.js) calls
           the new /api/watermark/video route (watermark-routes.js) for a
           real .mp4 produced by ffmpeg instead — tried FIRST, ahead of
           the existing client/plain fallback chain, exactly the same
           three-tier order app-reel.js's reel-download button already
           uses. window._empWatermarkServerAvailable is a cached health
           check (also set up in app-fixes.js) so a deployment without the
           server feature, or a signed-out session (the route requires
           auth), skips straight to the existing client path below rather
           than attempting a POST that can't succeed. On ANY failure here
           (network error, 413 too-long, 429 server-busy, 503 unavailable)
           this falls straight through to _clientWatermarkDownloadVfs()
           below, unchanged — nothing about the existing two-tier fallback
           (client watermark, then plain download) is altered; this only
           adds one more tier ahead of it. */
        function _clientWatermarkDownloadVfs() {
            if (typeof window._canWatermarkVideo === 'function' && window._canWatermarkVideo()
                && typeof window._fetchWithProgress === 'function' && typeof window._watermarkVideoBlob === 'function') {
                _notifyVfs('⬇ Preparing your download with the Empyrean watermark…', 'info');
                window._fetchWithProgress(d.src, function (pct) { _dlTrackerVfs.update(0, Math.round(pct * 0.4)); }).then(function (blob) {
                    return window._watermarkVideoBlob(blob, function (pct) { _dlTrackerVfs.update(0, 40 + Math.round(pct * 0.6)); }, username).then(function (wmBlob) {
                        // FIX (2026-09-03 — "download completes but the file
                        // never reaches device storage", the same blob:-URL-
                        // via-anchor limitation documented in app-fixes.js's
                        // _empSaveBlobToDevice, which applies identically to
                        // this same pattern): route through that shared
                        // helper instead of a raw blob: anchor click, so this
                        // saves correctly from a standalone/installed PWA on
                        // Android too. Falls back to the exact previous
                        // anchor-click behavior if app-fixes.js hasn't loaded.
                        return (typeof window._empSaveBlobToDevice === 'function'
                            ? window._empSaveBlobToDevice(wmBlob, filename + '.webm')
                            : new Promise(function (resolve) {
                                var objUrl = URL.createObjectURL(wmBlob);
                                var a = document.createElement('a');
                                a.href = objUrl;
                                a.download = filename + '.webm';
                                document.body.appendChild(a); a.click(); a.remove();
                                setTimeout(function () { URL.revokeObjectURL(objUrl); }, 30000);
                                resolve();
                            })
                        ).then(function () {
                            _dlTrackerVfs.update(0, 100);
                            _dlTrackerVfs.finish();
                            _notifyVfs('Download started!', 'success');
                        });
                    }).catch(function (wmErr) {
                        // Re-encode failed partway — we already HAVE the plain
                        // blob fetched above, so save that directly instead of
                        // re-fetching or falling through to a raw cross-origin
                        // anchor.
                        console.warn('[EmpVFS] watermark re-encode failed, saving the plain fetched file instead:', wmErr && wmErr.message);
                        return (typeof window._empSaveBlobToDevice === 'function'
                            ? window._empSaveBlobToDevice(blob, filename + '.mp4')
                            : new Promise(function (resolve) {
                                var objUrl2 = URL.createObjectURL(blob);
                                var a2 = document.createElement('a');
                                a2.href = objUrl2;
                                a2.download = filename + '.mp4';
                                document.body.appendChild(a2); a2.click(); a2.remove();
                                setTimeout(function () { URL.revokeObjectURL(objUrl2); }, 30000);
                                resolve();
                            })
                        ).then(function () {
                            _dlTrackerVfs.update(0, 100);
                            _dlTrackerVfs.finish();
                            _notifyVfs('Download started!', 'success');
                        });
                    });
                }).catch(function (err) {
                    console.warn('[EmpVFS] download fetch failed, falling back to direct download:', err && err.message);
                    _plainDownload();
                });
            } else {
                _plainDownload();
            }
        }

        if (typeof window._watermarkVideoServer === 'function' && window._empWatermarkServerAvailable !== false) {
            _notifyVfs('⬇ Preparing your download with the Empyrean watermark…', 'info');
            _dlTrackerVfs.update(0, 15);
            window._watermarkVideoServer(d.src, username).then(function (mp4Blob) {
                // FIX (2026-09-03): same shared-helper swap as the client-
                // watermark tier above — see its comment for why.
                return (typeof window._empSaveBlobToDevice === 'function'
                    ? window._empSaveBlobToDevice(mp4Blob, filename + '.mp4')
                    : new Promise(function (resolve) {
                        var objUrl = URL.createObjectURL(mp4Blob);
                        var a = document.createElement('a');
                        a.href = objUrl;
                        a.download = filename + '.mp4';
                        document.body.appendChild(a); a.click(); a.remove();
                        setTimeout(function () { URL.revokeObjectURL(objUrl); }, 30000);
                        resolve();
                    })
                ).then(function () {
                    _dlTrackerVfs.update(0, 100);
                    _dlTrackerVfs.finish();
                    _notifyVfs('Download started!', 'success');
                });
            }).catch(function (serverErr) {
                console.warn('[EmpVFS] server watermark failed, falling back to client watermark:', serverErr && serverErr.message);
                _clientWatermarkDownloadVfs();
            });
        } else {
            _clientWatermarkDownloadVfs();
        }
    }


    /* =========================================================================
       BUTTON EVENTS
       ========================================================================= */
    closeBtn.addEventListener('click', function() {
        /* Always allow close button to work — force-clear _threadOpen first
           so _close() does not hit the thread-is-open early-return path when
           the thread failed to open (stuck state). */
        var threadEl = document.getElementById('vf-thread');
        if (_threadOpen && !(threadEl && threadEl.classList.contains('vf-open'))) {
            _threadOpen = false;
        }
        _close();
    });
    muteBtn.addEventListener('click',  _toggleMute);
    if (downloadBtn) downloadBtn.addEventListener('click', function(e) {
        e.stopPropagation(); // don't let this bubble into the tap-to-pause/play zone underneath
        _downloadCurrent();
    });
    prevBtn.addEventListener('click',  function() { _go(_idx - 1); });
    nextBtn.addEventListener('click',  function() { _go(_idx + 1); });
    /* FIX (bug: "swiping intermittently hooks/freezes" — the video would
       occasionally pause itself right after a swipe): tapZone's 'click'
       listener used to call _tapPlay() unconditionally. On a genuine swipe
       gesture, touchmove already calls e.preventDefault() throughout the
       drag, which is SUPPOSED to stop the browser from also synthesizing a
       trailing 'click' on tapZone afterward — but that suppression isn't
       reliable across every Android WebView/browser this app runs in (this
       codebase has already documented several other WebView-specific
       inconsistencies on this exact device — see app-patch-v26/v31/v35).
       When the synthetic click slipped through anyway, it fired _tapPlay()
       a moment after a real swipe had just navigated to (and started
       auto-playing) the next video — which immediately paused it again,
       reading exactly like the swipe "hooked". _suppressTapUntil (set by
       the touchend handler below whenever the just-finished gesture moved
       more than a small deadzone, i.e. was a real swipe, not a tap) makes
       this deterministic instead of depending on browser-specific click
       suppression: any click landing within that short window after a
       real swipe is ignored, on every device, every time. */
    tapZone.addEventListener('click', function() {
        if (Date.now() < _suppressTapUntil) return;
        _tapPlay();
    });

    /* Caption click — thread/reply panel removed (app-reel.js's comments
       drawer is the single comments entry point now), so caption is just
       static text and no longer opens a separate panel. */


    /* =========================================================================
       KEYBOARD
       ========================================================================= */
    document.addEventListener('keydown', function(e) {
        if (!_isOpen) return;
        /* Always allow Escape, but if thread is open let thread handle it first */
        if (e.key === 'Escape') {
            if (_threadOpen) {
                /* Let thread close naturally; app-thread.js should call _vfsResumeFromThread */
                return;
            }
            _close();
            return;
        }
        if (_threadOpen) return; /* all other keys go to thread page */
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); _go(_idx + 1); }
        if (e.key === 'ArrowUp'   || e.key === 'ArrowLeft')  { e.preventDefault(); _go(_idx - 1); }
        if (e.key === ' ')                                    { e.preventDefault(); _tapPlay(); }
        if (e.key === 'm' || e.key === 'M')                   { _toggleMute(); }
    });


    /* =========================================================================
       MOUSE WHEEL — disabled while thread is open
       ========================================================================= */
    var _wLock = false;
    ov.addEventListener('wheel', function(e) {
        if (!_isOpen || _wLock || _threadOpen) return;
        e.preventDefault();
        _wLock = true;
        setTimeout(function() { _wLock = false; }, 550);
        if (e.deltaY > 0) _go(_idx + 1);
        else              _go(_idx - 1);
    }, { passive: false });


    /* =========================================================================
       TOUCH SWIPE — disabled while thread is open

       FIX (bug: "swiping intermittently hooks — swiping should be
       effortless"), three changes together:

       [1] Distance threshold was a flat 20% of screen height with no
           velocity component — a fast, short flick (the natural way
           someone swipes a vertical feed) that didn't happen to travel
           that far snapped straight back to the current video instead of
           advancing, which reads as the swipe "not registering" / feeling
           sticky. Now either a smaller 12% distance OR a fast flick
           (tracked via touch velocity, independent of total distance)
           advances the slide — matching how native short-form-video swipe
           gestures actually behave.

       [2] touchmove wrote a new inline transform on every single event,
           synchronously, with no throttling — on a slower/low-end device
           (this app is regularly tested on weak/older Android hardware —
           see app-patch-v26/v31/v35's own notes) that can produce visible
           jank during the drag itself. Now the drag's transform write is
           batched into requestAnimationFrame, so at most one style write
           happens per rendered frame no matter how many touchmove events
           fire in between.

       [3] _suppressTapUntil (declared here, read by the tapZone click
           handler above) — set whenever the just-finished gesture moved
           past a small deadzone, so a real swipe can never also trigger a
           spurious tap-to-pause afterward. See the click handler's own
           comment for the full explanation of why that happened.
       ========================================================================= */
    var _ty0 = 0, _tdy = 0, _tActive = false, _tMoved = false;
    var _tLastY = 0, _tLastT = 0, _tVelocity = 0; // px/ms, negative = moving up (toward "next")
    var _suppressTapUntil = 0;
    var _dragRafPending = false;

    var TAP_DEADZONE_PX   = 10;   // below this total movement, touchend is treated as a tap, not a swipe
    var SWIPE_DISTANCE_PCT = 0.12; // was 0.20 — lower bar for a deliberate, non-flick drag to count
    var SWIPE_VELOCITY_PX_MS = 0.55; // a flick this fast advances even if it didn't travel far

    ov.addEventListener('touchstart', function(e) {
        if (!_isOpen || _threadOpen) return;
        _ty0 = _tLastY = e.touches[0].clientY;
        _tdy = 0; _tActive = true; _tMoved = false; _tVelocity = 0;
        _tLastT = Date.now();
    }, { passive: true });

    ov.addEventListener('touchmove', function(e) {
        if (!_isOpen || !_tActive || _threadOpen) return;
        var y  = e.touches[0].clientY;
        var now = Date.now();
        _tdy = y - _ty0;
        if (Math.abs(_tdy) > TAP_DEADZONE_PX) _tMoved = true;

        var dt = now - _tLastT;
        if (dt > 0) _tVelocity = (y - _tLastY) / dt;
        _tLastY = y; _tLastT = now;

        if (!_dragRafPending) {
            _dragRafPending = true;
            requestAnimationFrame(function () {
                _dragRafPending = false;
                if (!_tActive) return; // gesture ended before this frame ran
                track.style.transition = 'none';
                /* resist (rubber-band) when dragging past the first/last video
                   so there is nothing to "hang" on at either end */
                var dy = _tdy;
                if ((_idx === 0 && dy > 0) || (_idx === _list.length - 1 && dy < 0)) dy = dy * 0.35;
                track.style.transform  = 'translate3d(0,calc(' + (-_idx * 100) + '% + ' + dy + 'px),0)';
            });
        }
        e.preventDefault();
    }, { passive: false });

    ov.addEventListener('touchend', function() {
        if (!_isOpen || !_tActive || _threadOpen) return;
        _tActive = false;

        if (_tMoved) {
            // Real swipe — see the tapZone click handler above for why this
            // suppression window needs to exist at all.
            _suppressTapUntil = Date.now() + 500;
        }

        var thresh = window.innerHeight * SWIPE_DISTANCE_PCT;
        var advancesNext = (_tdy < -thresh) || (_tVelocity < -SWIPE_VELOCITY_PX_MS && _tdy < -TAP_DEADZONE_PX);
        var advancesPrev = (_tdy >  thresh) || (_tVelocity >  SWIPE_VELOCITY_PX_MS && _tdy >  TAP_DEADZONE_PX);

        /* FIX (2026-10-17 — swipe "hanging"): at the first/last video a
           committed swipe called _go() with an out-of-range index, which
           returns early WITHOUT touching the track — leaving it frozen at
           whatever offset the finger released it. Clamp, and always settle. */
        var target = _idx;
        if (advancesNext && _idx + 1 < _list.length) target = _idx + 1;
        else if (advancesPrev && _idx - 1 >= 0)      target = _idx - 1;

        /* Finish at the finger's own speed: remaining distance / release
           velocity, clamped, so a flick completes in one fluid motion. */
        var ms = SWIPE_MS;
        if (target !== _idx) {
            var remaining = Math.max(0, window.innerHeight - Math.abs(_tdy));
            var v = Math.max(Math.abs(_tVelocity), 0.9);
            ms = Math.max(140, Math.min(SWIPE_MS, Math.round(remaining / v)));
        }
        _go(target, true, ms);
    });

    /* An interrupted touch (system gesture, notification shade, incoming
       call) never fires touchend — which used to leave the track stuck
       mid-drag with _tActive still true. Settle back to the current slide. */
    ov.addEventListener('touchcancel', function() {
        if (!_tActive) return;
        _tActive = false;
        _go(_idx, true, SWIPE_MS);
    });



    /* =========================================================================
       LISTEN FOR THREAD CLOSE EVENT
       — app-thread.js can fire this instead of calling window._vfsResumeFromThread
       ========================================================================= */
    document.addEventListener('vfs:threadClosed', function() {
        _resumeFromThread();
    });



    /* =========================================================================
       INLINE PREVIEW — quick-post videos in the dashboard feed
       =========================================================================
       FEATURE (2026-10-22 — "in the quick post video in the general public
       dashboard, allow/enable it to play preview"): feed videos were
       <video controls preload="metadata"> covered by the .vfs-tap overlay, so
       on mobile they sat on a black/blank first frame until someone opened the
       fullscreen viewer. They now play a muted, looping preview in place as
       they scroll into view — the same behaviour as the Reels strip and the
       dashboard marketplace slider — and pause when scrolled away. Tapping
       still opens the fullscreen viewer (with sound) exactly as before.

       Scope: #feed-container only (the public dashboard feed). Profile feeds
       are left alone. Rules:
         • one preview at a time — the most visible video (>= 60% in view);
         • always muted + playsinline (required for browser autoplay);
         • paused while the fullscreen viewer, a post thread, or a hidden tab
           is in front; resumed when they close;
         • skipped when the browser reports Data Saver or a 2G connection, so
           people on very weak networks aren't charged data for a preview they
           didn't ask for (they can still tap to open the video).
       Works alongside app-feed.js's scroll-pause observer: that one pauses on
       scroll-away and resumes only what was playing; this one is what STARTS
       the muted preview in the first place.
       ========================================================================= */
    var _PV_ROOT = '#feed-container';
    var _PV_MIN_RATIO = 0.6;
    var _pvVideos = [];
    var _pvObs = null;
    var _pvRaf = 0;

    function _pvNetworkOk() {
        try {
            var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (!c) return true;
            if (c.saveData) return false;
            var t = String(c.effectiveType || '');
            if (t === 'slow-2g' || t === '2g') return false;
        } catch (e) {}
        return true;
    }
    function _pvBlocked() {
        if (_isOpen || document.hidden) return true;
        var th = document.getElementById('vf-thread');
        if (th && th.classList.contains('vf-open')) return true;
        return false;
    }
    /* Sound — the preview starts muted (browser autoplay rule). If the viewer
       turns sound on with the browser's own volume button, _pvWantSound is set
       (see _decorateItem) so _pvPlay doesn't force it muted again on resume. */
    function _pvPlay(v) {
        v._pvPlaying = true;
        try {
            if (v._pvWantSound) {
                v.muted = false; v.defaultMuted = false; v.removeAttribute('muted');
            } else {
                v.muted = true; v.defaultMuted = true; v.setAttribute('muted', '');
            }
            v.setAttribute('playsinline', '');
            v.playsInline = true; v.loop = true;
            var p = v.play();
            if (p && p.catch) p.catch(function () {
                if (v._pvWantSound) {
                    /* Browser refused unmuted autoplay — fall back to the muted preview. */
                    v._pvWantSound = false;
                    try {
                        v.muted = true; v.defaultMuted = true; v.setAttribute('muted', '');
                        var p2 = v.play();
                        if (p2 && p2.catch) p2.catch(function () { v._pvPlaying = false; });
                    } catch (e2) { v._pvPlaying = false; }
                } else {
                    v._pvPlaying = false;
                }
            });
        } catch (e) { v._pvPlaying = false; }
    }
    function _pvPause(v) {
        v._pvPlaying = false;
        try { v.pause(); } catch (e) {}
    }
    function _previewEval() {
        _pvRaf = 0;
        _pvVideos = _pvVideos.filter(function (v) {
            if (v.isConnected) return true;
            if (_pvObs) { try { _pvObs.unobserve(v); } catch (e) {} }
            return false;
        });
        var best = null, bestRatio = 0;
        if (!_pvBlocked() && _pvNetworkOk()) {
            _pvVideos.forEach(function (v) {
                var r = v._pvRatio || 0;
                if (r >= _PV_MIN_RATIO && r > bestRatio) { best = v; bestRatio = r; }
            });
        }
        _pvVideos.forEach(function (v) {
            if (v !== best && v._pvPlaying) _pvPause(v);
        });
        if (best && (best.paused || !best._pvPlaying) && !best.ended) _pvPlay(best);
    }
    function _previewSchedule() {
        if (_pvRaf) return;
        _pvRaf = requestAnimationFrame(_previewEval);
    }
    function _pausePreviews() {
        _pvVideos.forEach(function (v) { if (v._pvPlaying) _pvPause(v); });
    }
    function _previewWatch(vid) {
        if (!vid || vid._pvWatched || !('IntersectionObserver' in window)) return;
        if (!vid.closest || !vid.closest(_PV_ROOT + ' .story-media-item')) return;
        vid._pvWatched = true;
        if (!_pvObs) {
            _pvObs = new IntersectionObserver(function (entries) {
                entries.forEach(function (e) { e.target._pvRatio = e.isIntersecting ? e.intersectionRatio : 0; });
                _previewSchedule();
            }, { threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] });
        }
        _pvVideos.push(vid);
        _pvObs.observe(vid);
    }
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) _pausePreviews(); else _previewSchedule();
    });
    document.addEventListener('vfs:threadClosed', function () { setTimeout(_previewSchedule, 300); });
    /* app-nav.js's _stopAllVideos() pauses every non-viewer video on each
       navigateTo(); re-evaluate once the destination section has settled so
       coming back to the dashboard restarts the visible preview. */
    document.addEventListener('empyrean-section-change', function () { setTimeout(_previewSchedule, 400); });
    window._vfsPreviewRefresh = _previewSchedule;

    /* =========================================================================
       DECORATE FEED VIDEOS
       ========================================================================= */
    function _decorateItem(item) {
        if (item.dataset.vfsOk) return;
        var vid = item.querySelector('video');
        if (!vid) return;
        item.dataset.vfsOk = '1';

        var tap = document.createElement('div');
        tap.className = 'vfs-tap';

        var icon = document.createElement('div');
        icon.className = 'vfs-expand';
        icon.innerHTML = '<i class="fas fa-expand-alt"></i>';

        item.appendChild(tap);
        item.appendChild(icon);
        _previewWatch(vid);

        /* Profile feed videos (see CSS note above): keep the click-catcher off
           the control bar. Inline + !important so no later stylesheet can
           stretch it back over the bar. */
        var _inProfileFeed = !!(item.closest && item.closest('#profile-posts-feed, #profile-dash-feed'));
        if (_inProfileFeed) {
            tap.style.setProperty('bottom', '64px', 'important');
            tap.style.setProperty('height', 'calc(100% - 64px)', 'important');
        }

        if (vid._pvWatched) {
            vid.addEventListener('volumechange', function () { vid._pvWantSound = !vid.muted; });
            /* Keep the click-catcher off the browser's control bar. Set inline
               with !important so no stylesheet (including later patch files
               that restyle .vfs-tap) can stretch it back over the controls. */
            tap.style.setProperty('bottom', '64px', 'important');
            tap.style.setProperty('height', 'calc(100% - 64px)', 'important');
        }

        tap.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            /* Backstop: a tap inside the control-bar strip of a preview video
               is for the browser's controls (volume etc.), never the viewer. */
            if (vid._pvWatched) {
                var r = item.getBoundingClientRect();
                if (e.clientY > r.bottom - 64) return;
            }
            /* Same backstop for profile feeds: a tap on/below the top edge of
               our own control bar (.emp-vc) is for the bar, never the viewer. */
            if (_inProfileFeed) {
                var _bar = item.querySelector('.emp-vc');
                var _top = _bar ? _bar.getBoundingClientRect().top : (item.getBoundingClientRect().bottom - 64);
                if (e.clientY >= _top) return;
            }
            var all = _collect();
            var idx = 0;
            all.forEach(function(d, i) { if (d.el === vid) idx = i; });
            _open(idx);
        });
    }

    function _decorateAll() {
        document.querySelectorAll(_feedSelector()).forEach(function(item) {
            if (item.querySelector('video')) _decorateItem(item);
        });
    }


    /* =========================================================================
       MUTATION OBSERVER
       ========================================================================= */
    new MutationObserver(function(muts) {
        var changed = false;
        muts.forEach(function(m) { if (m.addedNodes.length) changed = true; });
        if (changed) _decorateAll();
    }).observe(document.body, { childList: true, subtree: true });


    /* =========================================================================
       BOOT
       ========================================================================= */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _decorateAll);
    } else {
        setTimeout(_decorateAll, 300);
    }
    setTimeout(_decorateAll, 1000);
    setTimeout(_decorateAll, 2500);
    setTimeout(_decorateAll, 5000);

    document.addEventListener('empyrean-init-done', function() {
        setTimeout(_decorateAll, 400);
        setTimeout(_decorateAll, 1200);
    });

    window._vfsDecorateAll = _decorateAll;

    console.log('[EmpVFS] v3.1 — thread-open pointer-events fix active. _vfsPauseForThread / _vfsResumeFromThread exposed.');

})();