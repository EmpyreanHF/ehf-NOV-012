/* =============================================================================
   APP-NEWS.JS  —  Empyrean News Media Module  (v1.0)
   =============================================================================
   A fully self-contained module that owns every aspect of the News feature:

     1. Firestore real-time listener  →  writes to #news-list-container (News section)
     2. Dashboard strip renderer      →  reads from the in-memory cache, NOT from DOM
     3. Publish / Delete helpers      →  called by admin panel
     4. Search / filter               →  live filtering inside #news section
     5. MutationObserver bridge       →  keeps dashboard strip in sync automatically

   WHY THIS REPLACES THE SCATTERED APPROACH
   -----------------------------------------
   The previous code had two separate systems for news:
     • app-feed.js  §2  — Firestore listener that appended to #news-list-container
     • app-feed.js  §5  — renderDashboardNews() that scraped DOM from '#news .news-list-item'

   The selector '#news .news-list-item' only matches when the #news section is
   currently visible (offsetParent ≠ null on some browsers). Because the dashboard
   is the default active section, the news section is hidden when the listener fires
   and the dashboard scrape finds zero items → the strip stays empty.

   This module fixes the root cause:
     • News articles are stored in a JS array (_newsCache) as they arrive from
       Firestore, independently of which section is active.
     • The dashboard strip is built from _newsCache, never from the DOM.
     • Both the section list and the dashboard strip are updated in one atomic call.

   USAGE
   -----
   Add this script AFTER firebase-init.js and BEFORE app-fix-final.js in index.html:

       <script src="app-news.js" defer></script>

   Remove (or comment out) the old §2 news block in app-feed.js to avoid
   double-listening.  The module exposes:

       window.renderDashboardNews()   — re-renders the dashboard strip
       window.addNewsPost(data)       — called by admin after successful Firestore write
       window.deleteNewsPost(id)      — called by admin delete button
       window._newsCache              — live array of all cached news objects

============================================================================= */

(function EmpyreanNews() {
    'use strict';

    /* ── Wait for DOM ──────────────────────────────────────────────────────── */
    function _ready(fn) {
        if (document.readyState !== 'loading') { fn(); }
        else { document.addEventListener('DOMContentLoaded', fn); }
    }

    /* ── Tiny helpers (mirrors of app-feed.js private helpers) ────────────── */
    function _esc(s) {
        if (typeof s !== 'string') return '';
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function _attr(s) { return _esc(s); }

    /* ── Inline SVG action icons ──────────────────────────────────────────
       Font Awesome glyph availability isn't guaranteed across every build/
       version actually loaded on a given device — newer icon names
       (fa-arrows-rotate, fa-share-nodes, fa-cloud-arrow-down) rendered as
       missing-glyph boxes in the field even though they're valid on FA's
       own site. Inline SVG has no such dependency, so these three
       engagement icons render the same everywhere regardless of font
       load state. (Like stays on fa-heart — app-fixes.js's like/unlike
       toggle selects that class specifically.) */
    function _actionIcon(kind) {
        var attrs = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            + 'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" '
            + 'style="vertical-align:-3px;flex-shrink:0;"';
        if (kind === 'repeat') {
            /* Rebroadcast / retweet-to-timeline */
            return '<svg ' + attrs + '><polyline points="17 1 21 5 17 9"></polyline>'
                + '<path d="M3 11V9a4 4 0 0 1 4-4h14"></path>'
                + '<polyline points="7 23 3 19 7 15"></polyline>'
                + '<path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>';
        }
        if (kind === 'share') {
            /* FIX (2026-07-30): standardized on the same node-and-lines
               "universal" share glyph used everywhere else in the app
               (business page posts, reels) instead of this one-off
               arrow-up-into-tray shape, which was yet another distinct
               share icon design nobody else used. */
            return '<svg ' + attrs + '><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle>'
                + '<circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>'
                + '<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>';
        }
        if (kind === 'download') {
            /* Same proven path already used for the download icon in
               app-feed.js — reused verbatim for visual consistency. */
            return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
                + 'stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" '
                + 'style="vertical-align:-3px;flex-shrink:0;">'
                + '<path d="M12 21.29l-3.77-3.77 1.06-1.06 1.97 1.97V3h1.5v15.43l1.97-1.97 1.06 1.06L12 21.29z"></path>'
                + '<path d="M3 18.5h2V19c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5v-.5h2V19c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 21.5 3 20.38 3 19v-.5z"></path>'
                + '</svg>';
        }
        return '';
    }

    function _fbOk() {
        return !!(window._firebaseLoaded && window.fbDb &&
                  typeof window.fbDb.collection === 'function');
    }

    function _us() {
        return (window.EmpState && window.EmpState.userState)
            || window.userState
            || {};
    }

    function _isAdmin() {
        if (typeof window.isAdmin === 'boolean' && window.isAdmin) return true;
        var u = _us();
        return !!(u && (u.role === 'admin' || u.email === 'admin@empyrean.com'));
    }

    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') {
            window.showNotification(msg, type || 'success');
        }
    }

    /* ── In-memory news cache (source-of-truth for dashboard strip) ─────── */
    window._newsCache = window._newsCache || [];

    /* ─────────────────────────────────────────────────────────────────────────
       §1  BUILD ONE NEWS-LIST ITEM  (used in #news-list-container)
    ───────────────────────────────────────────────────────────────────────── */
    function _buildNewsItem(n) {
        var us     = _us();
        var isVid  = n.mediaUrl && (
            (n.mediaType || '').startsWith('video/')
            || /\/video\/upload\//i.test(n.mediaUrl)
            || /\.(mp4|webm|mov)(\?|$)/i.test(n.mediaUrl)
        );

        var mediaHtml = n.mediaUrl
            ? ('<div class="news-item-image">'
                + (isVid
                    ? '<video src="' + _esc(n.mediaUrl) + '" muted playsinline preload="metadata" '
                      + 'style="width:100%;height:100%;object-fit:cover;pointer-events:none;">'
                      + '<source src="' + _esc(n.mediaUrl) + '" type="' + _esc(n.mediaType || 'video/mp4') + '">'
                      + '</video>'
                    : '<img src="' + _esc(n.mediaUrl) + '" loading="lazy">')
                + '</div>')
            : '';

        var ownerOpts = (n.userId === us.id || _isAdmin())
            ? '<div class="post-options" style="position:absolute;top:8px;right:8px;">'
              + '<button class="options-btn"><i class="fas fa-ellipsis-h"></i></button>'
              + '<div class="options-menu">'
              + '<a href="#" class="edit-post-btn"><i class="fas fa-edit"></i> Edit</a>'
              + '<a href="#" class="delete-news-btn" data-news-id="' + _esc(n.id) + '" '
              + 'style="color:#e53935;"><i class="fas fa-trash"></i> Delete</a>'
              + '</div></div>'
            : '';

        var dateStr = n.createdAt
            ? new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
            : 'Recently';

        var el = document.createElement('div');
        el.className        = 'news-list-item';
        el.dataset.postId   = n.id;
        el.dataset.userId   = n.userId || '';
        el.dataset.cat      = n.category || '';
        el.dataset.img      = (!isVid && n.mediaUrl) ? n.mediaUrl : '';
        el.dataset.vid      = (isVid && n.mediaUrl)  ? n.mediaUrl : '';
        el.style.position   = 'relative';
        el.innerHTML = ownerOpts + mediaHtml
            + '<div class="news-item-content-wrapper">'
            + '<div class="news-item-content">'
            + '<div class="news-row-topline"><span class="news-row-source">' + _esc(_catLabel(n.category) || n.username || 'Empyrean News') + '</span>'
            /* FIX (report: "viewers count shown as 0 on the news feed cards"
               — screenshot of the compact list): a real, live-incrementing
               view count already existed (see §14a's _bumpArticleViewCount
               below), but its only on-screen element, '.view-count' inside
               '.story-actions', is force-hidden in THIS compact row by the
               '#news-list-container .story-actions { display:none!important }'
               rule further down (§14 REDESIGN CSS) — so a reader looking at
               the list itself, like the screenshot, never saw it move off
               zero no matter how many people had actually opened the
               article. Adding a second, visible '.view-count' badge here
               (topline, next to the source pill) does not conflict with the
               hidden one in the full detail view — that one is scoped to
               its own '#news-article-detail' container via
               `wrap.querySelector('.view-count')` and is never touched by
               this element. This one stays in sync automatically: every
               real view increments the Firestore doc, which fires this
               same file's news_posts onSnapshot listener with
               change.type 'modified', which already fully rebuilds this
               card via _buildNewsItem() for every client watching the list
               — so the visible count now actually climbs instead of
               sitting frozen at 0. */
            /* FIX (report: "2 viewer live count [in the topline], remove
               one and retain one"): '.news-row-commentcount' used to sit
               right next to '.news-row-viewcount' here with no visible
               separator, and its icon ('far fa-comment') renders far
               smaller/fainter than the eye glyph — at a glance the two
               read as two identical view/eye counters stacked side by
               side rather than "views" and "comments". Dropped so this
               row shows exactly one count (views), which is also the one
               this same fix already made live-incrementing above. */
            + '<span class="news-row-viewcount"><i class="fas fa-eye"></i> <span class="view-count">' + (n.views || 0) + '</span></span></div>'
            + '<h4>' + _esc(n.title || '') + '</h4>'
            + '<span class="news-meta"><i class="fas fa-calendar-alt"></i> ' + dateStr + _authorBit(n) + '</span>'
            + '<p>' + _esc(n.content || '') + '</p>'
            + '</div>'
            + '<div class="story-actions" style="margin-top:8px;">'
            + '<a class="action-btn like-btn"><i class="far fa-heart"></i>'
            + '<span class="like-count">' + (n.likes || 0) + '</span></a>'
            + '<a class="action-btn comment-btn"><i class="far fa-comment"></i>'
            + '<span class="comment-count">' + (n.commentCount || 0) + '</span></a>'
            + '<a class="action-btn retweet-btn">' + _actionIcon('repeat')
            + '<span class="retweet-count">' + (n.retweets || 0) + '</span></a>'
            + '<a class="action-btn share-btn">' + _actionIcon('share') + '</a>'
            + '<a class="action-btn download-media-btn">' + _actionIcon('download') + '</a>'
            + '<span class="action-btn view-count-display" style="margin-left:auto;color:var(--text-muted);'
            + 'font-size:0.72rem;pointer-events:none;">'
            + '<i class="fas fa-eye"></i><span class="view-count">' + (n.views || 0) + '</span></span>'
            + '</div>'
            + '<div class="comment-section"><div class="comment-list"></div>'
            + '<form class="comment-form" novalidate>'
            + '<input type="text" name="comment-text" placeholder="Add a comment..." required>'
            + '<button type="submit"><i class="fas fa-paper-plane"></i></button>'
            + '</form></div>'
            + '</div>';

        /* Open the full article detail view (screenshot-2 style) when the
           thumbnail or headline is tapped, instead of the old inline
           accordion expand. stopPropagation keeps the legacy
           '.news-list-item h4' expand-toggle delegate (app-fixes.js) and
           the document-level image-lightbox handler from also firing on
           the same click. */
        var _openRow = function (e) {
            e.preventDefault();
            e.stopPropagation();
            _openArticleDetail(n.id);
        };
        var _thumbEl = el.querySelector('.news-item-image');
        var _headEl  = el.querySelector('.news-item-content h4');
        if (_thumbEl) _thumbEl.addEventListener('click', _openRow);
        if (_headEl)  _headEl.addEventListener('click', _openRow);

        return el;
    }


    /* ─────────────────────────────────────────────────────────────────────────
       §2  SYNC EMPTY-STATE  (#news-empty-state visibility)
    ───────────────────────────────────────────────────────────────────────── */
    function _syncEmpty() {
        var es = document.getElementById('news-empty-state');
        var nl = document.getElementById('news-list-container');
        if (!es || !nl) return;
        var hasItems = nl.querySelector('.news-list-item') !== null;
        es.style.display = hasItems ? 'none' : 'block';
    }


    /* ─────────────────────────────────────────────────────────────────────────
       §3  ADD ONE ITEM TO #news-list-container
    ───────────────────────────────────────────────────────────────────────── */
    function _addToNewsList(n, prepend) {
        var nl = document.getElementById('news-list-container');
        if (!nl) return;
        if (nl.querySelector('[data-post-id="' + n.id + '"]')) return; // dedup
        var el = _buildNewsItem(n);
        if (prepend) { nl.prepend(el); } else { nl.appendChild(el); }
        _syncEmpty();
    }


    /* ─────────────────────────────────────────────────────────────────────────
       §3b  NEWS REELS STRIP  (horizontal video carousel inside #news)
       Was previously called from renderDashboardNews() but never defined,
       throwing an uncaught ReferenceError on every call and silently
       aborting the rest of renderDashboardNews() before the dashboard
       strip / admin-table sync / empty-state sync below it could run.

       Reels currently come from existing video news posts (no separate
       upload flow yet). window._reelsCache is checked first so a future
       dedicated reels source can be dropped in without touching this
       function again.
    ───────────────────────────────────────────────────────────────────────── */
    function _renderNewsReelsStrip() {
        var newsSection = document.getElementById('news');
        if (!newsSection) return;

        var wrapEl = document.getElementById('news-reels-strip-wrap');
        var strip  = document.getElementById('news-reels-strip');
        if (!wrapEl) {
            wrapEl = document.createElement('div');
            wrapEl.id = 'news-reels-strip-wrap';
            wrapEl.innerHTML = '<h3 class="news-reels-heading"><i class="fas fa-play-circle"></i> Reels</h3>'
                + '<div id="news-reels-strip" class="news-reels-strip"></div>';
            var header = newsSection.querySelector('.header');
            var card   = newsSection.querySelector('.card');
            if (header && header.parentNode) {
                var _chips = document.getElementById('news-cat-chips');
                header.parentNode.insertBefore(wrapEl, (_chips && _chips.parentNode === header.parentNode ? _chips : header).nextSibling);
            } else if (card && card.parentNode) {
                card.parentNode.insertBefore(wrapEl, card);
            } else {
                newsSection.appendChild(wrapEl);
            }
            strip = wrapEl.querySelector('#news-reels-strip');
        }

        var source = (Array.isArray(window._reelsCache) && window._reelsCache.length)
            ? window._reelsCache
            : (window._newsCache || []).filter(function (n) {
                return n.mediaUrl && (
                    (n.mediaType || '').startsWith('video/')
                    || /\/video\/upload\//i.test(n.mediaUrl)
                    || /\.(mp4|webm|mov)(\?|$)/i.test(n.mediaUrl)
                );
            });

        if (!source.length) {
            wrapEl.style.display = 'none';
            return;
        }
        wrapEl.style.display = '';

        strip.innerHTML = '';
        source.slice(0, 12).forEach(function (n) {
            var reelCard = document.createElement('div');
            reelCard.className = 'news-reel-card';
            reelCard.dataset.postId = n.id || '';
            reelCard.innerHTML = '<video src="' + _esc(n.mediaUrl) + '" muted loop autoplay playsinline preload="metadata"></video>'
                + '<div class="news-reel-overlay"><span class="news-reel-title">' + _esc(n.title || '') + '</span></div>';
            reelCard.addEventListener('click', function () {
                if (n.id) _openArticleDetail(n.id);
            });
            strip.appendChild(reelCard);
        });
    }


    /* ─────────────────────────────────────────────────────────────────────────
       §4  DASHBOARD STRIP RENDERER
       Reads from _newsCache — never touches the DOM of #news section.
    ───────────────────────────────────────────────────────────────────────── */
    function renderDashboardNews() {
        /* Refresh the horizontal News Reels strip (video articles) inside
           the News section itself. Placed before any early return below so
           it still runs when the dashboard strip elements aren't present
           (e.g. while the user is inside #news, not #dashboard). */
        _renderNewsReelsStrip();

        var container = document.getElementById('dashboard-news-container')
            || document.getElementById('news-dashboard-container')
            || document.querySelector('.dashboard-news-container, [data-news-strip]');
        var slider    = document.getElementById('dashboard-news-slider')
            || document.getElementById('news-dashboard-slider')
            || document.querySelector('.dashboard-news-slider, [data-news-slider]');
        if (!container || !slider) return;

        var cache = window._newsCache || [];
        if (cache.length === 0) {
            container.style.display = 'none';
            return;
        }

        slider.innerHTML = '';

        cache.slice(0, 8).forEach(function (n) {
            var isVid = !!(n.mediaUrl && (
                (n.mediaType || '').startsWith('video/')
                || /\/video\/upload\//i.test(n.mediaUrl)
                || /\.(mp4|webm|mov)(\?|$)/i.test(n.mediaUrl)
            ));
            var src = (!isVid && n.mediaUrl) ? n.mediaUrl
                : 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=400&q=80';

            var card = document.createElement('div');
            card.className       = 'dashboard-news-card';
            card.dataset.navTarget = 'news';
            card.dataset.postId  = n.id || '';
            card.style.cssText   = [
                'flex:0 0 220px',
                'width:220px',
                'border-radius:14px',
                'overflow:hidden',
                'cursor:pointer',
                'box-shadow:0 4px 16px rgba(91,14,166,0.12)',
                'transition:transform 0.22s,box-shadow 0.22s',
                'background:white',
                'scroll-snap-align:start',
            ].join(';');

            var mediaPart = isVid
                ? '<video src="' + _esc(n.mediaUrl) + '" muted loop autoplay playsinline '
                  + 'style="width:100%;height:140px;object-fit:cover;display:block;"></video>'
                : '<img src="' + _esc(src) + '" alt="' + _attr(n.title || 'News') + '" loading="lazy" '
                  + 'style="width:100%;height:140px;object-fit:cover;display:block;" '
                  + 'onerror="this.src=\'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=400&q=80\'">';

            var dateStr = n.createdAt
                ? new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                : '';
            // FEATURE: show publication time alongside the date on this
            // card, not just the date — same Date object, just a second
            // formatted string appended after a separator.
            var timeStr = n.createdAt
                ? new Date(n.createdAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })
                : '';
            var dateTimeStr = dateStr && timeStr ? (dateStr + ' \u00B7 ' + timeStr) : (dateStr || timeStr);

            card.innerHTML = mediaPart
                + '<div class="dashboard-news-card-info" style="padding:12px;">'
                + '<h5 style="font-size:0.85rem;font-weight:700;color:var(--primary-color,#0A0E27);'
                + 'white-space:normal;line-height:1.3;margin:0 0 4px;">' + _esc(n.title || 'News') + '</h5>'
                + (dateTimeStr ? '<span style="font-size:0.72rem;color:#888;">' + dateTimeStr + '</span>' : '')
                + '</div>';

            card.addEventListener('mouseenter', function () {
                card.style.transform   = 'translateY(-4px)';
                card.style.boxShadow   = '0 10px 28px rgba(91,14,166,0.2)';
            });
            card.addEventListener('mouseleave', function () {
                card.style.transform   = '';
                card.style.boxShadow   = '0 4px 16px rgba(91,14,166,0.12)';
            });
            card.addEventListener('click', function () {
                if (typeof window.navigateTo === 'function') window.navigateTo('news');
                /* Scroll to the specific article after a short delay */
                setTimeout(function () {
                    var nl = document.getElementById('news-list-container');
                    if (!nl) return;
                    var target = nl.querySelector('[data-post-id="' + n.id + '"]');
                    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 350);
            });

            slider.appendChild(card);
        });

        /* Ensure slider has proper scroll styles */
        slider.style.display             = 'flex';
        slider.style.flexWrap            = 'nowrap';
        slider.style.overflowX           = 'auto';
        slider.style.gap                 = '12px';
        slider.style.scrollSnapType      = 'x mandatory';
        slider.style.webkitOverflowScrolling = 'touch';
        slider.style.paddingBottom       = '8px';

        container.style.display = 'block';
    }

    /* Expose publicly */
    window.renderDashboardNews = renderDashboardNews;
    window._startNewsListener  = _startNewsListener; // exposed for auth resets in app-fixes.js / app-feed.js


    /* ─────────────────────────────────────────────────────────────────────────
       §5  ADD NEWS POST  (called externally after admin publishes)
    ───────────────────────────────────────────────────────────────────────── */
    function addNewsPost(n) {
        if (!n || !n.id) return;
        /* Update cache — prevent duplicates */
        var idx = window._newsCache.findIndex(function (x) { return x.id === n.id; });
        if (idx === -1) {
            window._newsCache.unshift(n); /* newest first */
        } else {
            window._newsCache[idx] = n;
        }
        /* Add to news section list */
        _addToNewsList(n, true /* prepend — newest first */);
        /* Refresh dashboard strip from updated cache */
        renderDashboardNews();
        /* Update admin news table if present */
        _syncAdminTable(n, 'add');
    }
    window.addNewsPost = addNewsPost;


    /* ─────────────────────────────────────────────────────────────────────────
       §6  DELETE NEWS POST
    ───────────────────────────────────────────────────────────────────────── */
    /* PERMANENT DELETE (2026-10-23 — "deleted news disappears then comes back"):
       every article lives in TWO Firestore collections — news_posts (the live
       copy this section listens to) and news_articles (the admin archive).
       This used to delete only news_posts, and _loadLegacyNewsArticles()
       (below) re-imports anything found in news_articles that isn't in the
       cache — so on the next load/section open the "deleted" article was
       restored from the archive copy. Now BOTH copies are deleted, and the id
       is also kept in a small local "deleted" list until Firestore confirms,
       so a slow/failed delete can never let the backfill resurrect it.
       Returns a Promise (resolves true when both copies are gone). */
    var _DEL_KEY = 'emp_deleted_news_ids';
    function _delIds() { try { var a = JSON.parse(localStorage.getItem(_DEL_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function _delAdd(id) { try { var a = _delIds(); if (a.indexOf(id) === -1) a.push(id); localStorage.setItem(_DEL_KEY, JSON.stringify(a.slice(-300))); } catch (e) {} }
    function _delRemove(id) { try { localStorage.setItem(_DEL_KEY, JSON.stringify(_delIds().filter(function (x) { return x !== id; }))); } catch (e) {} }
    window._empNewsIsDeleted = function (id) { return _delIds().indexOf(id) !== -1; };

    function deleteNewsPost(id) {
        if (!id) return Promise.resolve(false);
        _delAdd(id); // blocks the archive backfill from re-adding it until both deletes are confirmed
        /* Remove from cache */
        window._newsCache = window._newsCache.filter(function (x) { return x.id !== id; });
        /* Remove from news list */
        var nl = document.getElementById('news-list-container');
        if (nl) {
            var el = nl.querySelector('[data-post-id="' + id + '"]');
            if (el) el.remove();
        }
        /* Remove from dashboard strip */
        var slider = document.getElementById('dashboard-news-slider');
        if (slider) {
            var card = slider.querySelector('[data-post-id="' + id + '"]');
            if (card) card.remove();
        }
        _syncEmpty();
        renderDashboardNews();
        /* Remove from admin table */
        _syncAdminTable({ id: id }, 'remove');
        /* Delete BOTH Firestore copies */
        if (!_fbOk()) return Promise.resolve(false);
        var fs = window.fbDb;
        var pPosts = fs.collection('news_posts').doc(id).delete();
        var pArch  = fs.collection('news_articles').doc(id).delete();
        return Promise.all([pPosts, pArch]).then(function () {
            _delRemove(id);
            _notify('Article deleted permanently.', 'success');
            return true;
        }).catch(function (e) {
            console.warn('[News] delete error:', e && e.message);
            /* FIX (2026-09-20): this used to fail silently AFTER the article
               had already been removed from the screen, so a rejected delete
               looked successful until the next refresh. Say why it failed. */
            if (typeof window._empDeleteFailed === 'function') window._empDeleteFailed('news_posts', id, e, [], 'news post');
            else _notify('Delete could not be saved (' + ((e && e.code) || 'connection/permission error') + '). It may reappear.', 'error');
            return false;
        });
    }
    window.deleteNewsPost = deleteNewsPost;


    /* ─────────────────────────────────────────────────────────────────────────
       §7  ADMIN TABLE SYNC
    ───────────────────────────────────────────────────────────────────────── */
    function _syncAdminTable(n, action) {
        var tbody = document.querySelector('#admin-news-table-body');
        if (!tbody) return;
        if (action === 'remove') {
            var row = tbody.querySelector('tr[data-post-id="' + n.id + '"]');
            if (row) row.remove();
            return;
        }
        if (action === 'add') {
            if (tbody.querySelector('tr[data-post-id="' + n.id + '"]')) return;
            var tr = document.createElement('tr');
            tr.dataset.postId = n.id;
            var dateStr = n.createdAt
                ? new Date(n.createdAt).toLocaleDateString('en-GB')
                : 'Now';
            // FIX (2026-08-14 — bug report: news log missing Edit/Delete,
            // items "hidden" after posting): this optimistic row used to be
            // a plain 3-column (title/date/delete) shape while app-admin.js's
            // own _refreshNewsTable() renders 5 columns (title/writer/
            // category/date/edit+delete) into the SAME #admin-news-table-body
            // — a mismatched column count on the same table. Matching that
            // shape here means the row looks right immediately, not just
            // after the next _refreshNewsTable() pass overwrites it. Edit is
            // wired to window._adminEditNewsArticle (app-admin.js), which
            // reads the full article from news_articles — safe to reference
            // here even for articles that only reached news_posts, since
            // that function already handles a missing archive doc.
            tr.innerHTML = '<td style="padding:10px 16px;font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(n.title || '') + '</td>'
                + '<td style="padding:10px 16px;">' + _esc(n.username || n.writer || '—') + '</td>'
                + '<td style="padding:10px 16px;"><span style="background:rgba(27,43,139,0.08);color:var(--secondary);padding:2px 9px;border-radius:10px;font-size:0.78rem;font-weight:600;">' + _esc(n.category || '—') + '</span></td>'
                + '<td style="padding:10px 16px;white-space:nowrap;">' + dateStr + '</td>'
                + '<td style="padding:10px 16px;white-space:nowrap;">'
                + '<button class="btn btn-small" onclick="window._adminEditNewsArticle && window._adminEditNewsArticle(\'' + _esc(n.id) + '\')" style="background:rgba(27,43,139,0.08);color:var(--secondary,#1B2B8B);border:none;border-radius:8px;padding:5px 10px;font-size:0.78rem;font-weight:700;cursor:pointer;margin-right:6px;"><i class="fas fa-pen"></i> Edit</button>'
                + '<button class="btn btn-small btn-danger" onclick="window.deleteNewsPost(\'' + _esc(n.id) + '\')" style="border-radius:8px;padding:5px 10px;font-size:0.78rem;"><i class="fas fa-trash"></i> Delete</button></td>';
            tbody.prepend(tr);
        }
    }


    /* ─────────────────────────────────────────────────────────────────────────
       §8  FIRESTORE REAL-TIME LISTENER
       Owns window._newsListener so it won't clash with existing listeners.
       Guards against double-start with _newsListenerActive flag.
    ───────────────────────────────────────────────────────────────────────── */
    function _startNewsListener() {
        if (window._newsListenerActive) return;
        if (!_fbOk()) return;

        /* Cancel any stale listener set up by the old system */
        if (window._newsListener && typeof window._newsListener === 'function') {
            try { window._newsListener(); } catch (_) {}
            window._newsListener = null;
        }

        window._newsListenerActive = true;
        var initialBatch = true;

        window._newsListener = window.fbDb
            .collection('news_posts')
            .orderBy('createdAt', 'desc')
            .limit(30)
            .onSnapshot(function (snap) {
                if (!snap) return;

                snap.docChanges().forEach(function (change) {
                    var n = change.doc.data();
                    if (!n) return;
                    if (!n.id) n.id = change.doc.id;
                    if (!n.id) return;

                    if (change.type === 'removed') {
                        /* Remove everywhere */
                        window._newsCache = window._newsCache.filter(function (x) { return x.id !== n.id; });
                        var nl2 = document.getElementById('news-list-container');
                        if (nl2) { var r2 = nl2.querySelector('[data-post-id="' + n.id + '"]'); if (r2) r2.remove(); }
                        var s2 = document.getElementById('dashboard-news-slider');
                        if (s2) { var c2 = s2.querySelector('[data-post-id="' + n.id + '"]'); if (c2) c2.remove(); }
                        _syncAdminTable(n, 'remove');
                        _syncEmpty();
                        renderDashboardNews();
                        return;
                    }

                    if (change.type === 'added' || change.type === 'modified') {
                        /* FIX (2026-09-03 — "new posts don't appear in the
                           dashboard's Latest News strip"): this query is
                           orderBy('createdAt','desc'), so on the VERY FIRST
                           snapshot Firestore delivers every matching doc as
                           an 'added' change already in newest\u2192oldest order.
                           The old code below unconditionally unshift()'d
                           every new doc onto the cache regardless of whether
                           this was that initial batch or a later live
                           update. Unshifting items that are already arriving
                           newest-first REVERSES them: doc1 (newest) lands at
                           index 0, then doc2 unshift pushes doc1 to index 1
                           and takes index 0 itself, and so on \u2014 by the time
                           all 30 initial docs are processed the cache is
                           OLDEST-first, exactly backwards. renderDashboardNews()
                           then takes cache.slice(0,8) \u2014 the 8 OLDEST posts in
                           that batch \u2014 for the dashboard strip, and any post
                           published after that first page load stays buried
                           past index 8 until enough further live posts
                           happen to arrive to push it forward one at a time.
                           This is exactly the DOM-list bug this same block
                           already fixed once (see 'shouldPrepend' below) \u2014
                           it just never got applied to window._newsCache
                           itself. Fix: hoist the identical isNew/shouldPrepend
                           check above the cache write too, so an INITIAL-batch
                           doc is appended (preserving the newest\u2192oldest order
                           Firestore already delivered) and only a genuinely
                           LIVE new doc is unshifted to the front. */
                        var isNew = n.createdAt && (Date.now() - new Date(n.createdAt).getTime() < 30000);
                        var shouldPrepend = !initialBatch || isNew;

                        /* Update cache */
                        var cIdx = window._newsCache.findIndex(function (x) { return x.id === n.id; });
                        if (cIdx === -1) {
                            if (shouldPrepend) { window._newsCache.unshift(n); }
                            else { window._newsCache.push(n); }
                        } else {
                            window._newsCache[cIdx] = n;
                        }
                        /* Update news section */
                        var nl3 = document.getElementById('news-list-container');
                        if (nl3) {
                            var existing = nl3.querySelector('[data-post-id="' + n.id + '"]');
                            if (existing) {
                                /* Replace element in-place for modified */
                                var fresh = _buildNewsItem(n);
                                nl3.replaceChild(fresh, existing);
                            } else {
                                /* New item: prepend if live, append if initial load */
                                _addToNewsList(n, shouldPrepend);
                            }
                        }
                        _syncAdminTable(n, 'add');
                    }
                });

                /* After each Firestore batch, re-render the dashboard strip from cache */
                renderDashboardNews();
                _syncEmpty();

                /* Switch off initial-batch mode */
                initialBatch = false;

            }, function (err) {
                console.error('[News] Firestore listener error:', err && err.code, err && err.message);
                window._newsListener        = null;
                window._newsListenerActive  = false;
                /* Retry with backoff */
                setTimeout(_startNewsListener, 4000);
            });

        console.log('[News] ✅ news_posts listener active (app-news.js)');
    }


    /* ─────────────────────────────────────────────────────────────────────────
       §9  LIVE SEARCH IN #news SECTION
    ───────────────────────────────────────────────────────────────────────── */
    function _wireSearch() {
        var inp = document.getElementById('news-search-input');
        if (!inp || inp._newsSearchWired) return;
        inp._newsSearchWired = true;

        inp.addEventListener('input', function () {
            var q = (inp.value || '').trim().toLowerCase();
            var nl = document.getElementById('news-list-container');
            if (!nl) return;
            _applyNewsFilters();
        });
    }


    /* ─────────────────────────────────────────────────────────────────────────
       §10  DELETE BUTTON DELEGATION  (handles dynamically created delete links)
    ───────────────────────────────────────────────────────────────────────── */
    function _wireDeleteDelegation() {
        if (window._newsDeleteDelegated) return;
        window._newsDeleteDelegated = true;

        document.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest && e.target.closest('.delete-news-btn');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            var id = btn.dataset.newsId || (btn.closest('[data-post-id]') || {}).dataset.postId || '';
            if (!id) return;
            if (!confirm('Delete this news article? This cannot be undone.')) return;
            deleteNewsPost(id);
        });
    }


    /* ─────────────────────────────────────────────────────────────────────────
       §11  MUTATION OBSERVER — keep strip in sync when other code
            (admin panel, old app-fixes.js) directly injects items into
            #news-list-container.
    ───────────────────────────────────────────────────────────────────────── */
    function _observeNewsList() {
        var nl = document.getElementById('news-list-container');
        if (!nl || nl._newsObserved) return;
        nl._newsObserved = true;

        new MutationObserver(function (muts) {
            var changed = false;
            muts.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                    if (node.nodeType !== 1) return;
                    var items = [];
                    if (node.classList && node.classList.contains('news-list-item')) items.push(node);
                    node.querySelectorAll && node.querySelectorAll('.news-list-item').forEach(function (n) { items.push(n); });
                    items.forEach(function (item) {
                        var id = item.dataset.postId;
                        if (!id) return;
                        /* If this item is not yet in cache, synthesise a minimal entry */
                        if (!window._newsCache.find(function (x) { return x.id === id; })) {
                            var titleEl = item.querySelector('h4');
                            var imgEl   = item.querySelector('.news-item-image img');
                            var vidEl   = item.querySelector('.news-item-image video');
                            window._newsCache.unshift({
                                id:       id,
                                userId:   item.dataset.userId || '',
                                title:    titleEl ? titleEl.textContent : '',
                                mediaUrl: (imgEl && imgEl.src) || (vidEl && vidEl.src) || '',
                                mediaType:(vidEl ? 'video/mp4' : 'image/jpeg'),
                                createdAt: Date.now()
                            });
                            changed = true;
                        }
                    });
                });
            });
            if (changed) renderDashboardNews();
        }).observe(nl, { childList: true, subtree: false });
    }


    /* ─────────────────────────────────────────────────────────────────────────
       §12  SECTION-CHANGE HOOK  — re-render strip whenever user navigates
            to dashboard (handles edge-case where strip was hidden before
            Firebase fired).
    ───────────────────────────────────────────────────────────────────────── */
    document.addEventListener('empyrean-section-change', function (ev) {
        if (!ev || !ev.detail) return;
        var sec = ev.detail.section;
        if (sec === 'dashboard') {
            setTimeout(renderDashboardNews, 150);
        }
    });
    document.addEventListener('empyrean-init-done', function () {
        setTimeout(renderDashboardNews, 400);
        setTimeout(_wireSearch, 600);
        _observeNewsList();
    });


    /* ─────────────────────────────────────────────────────────────────────────
       §13  STARTUP SEQUENCE
    ───────────────────────────────────────────────────────────────────────── */

    /* ── Fallback / migration read: news_articles ──────────────────────────
       Some articles were historically saved only to `news_articles` (the
       admin "archive" collection), before `news_posts` existed. The live
       listener only watches `news_posts`, so those older articles never
       appeared in the News section or dashboard strip. This does a single
       one-time read of `news_articles`, normalises field names to match the
       `news_posts` shape (content/mediaUrl), and merges any missing entries
       into _newsCache so they render too. New articles already write to both
       collections, so this is purely a backfill for older data. ──────────── */
    function _loadLegacyNewsArticles() {
        if (!_fbOk()) return;
        window.fbDb.collection('news_articles').orderBy('createdAt', 'desc').limit(30).get()
            .then(function (snap) {
                if (!snap || snap.empty) return;
                var added = false;
                snap.forEach(function (doc) {
                    var a = doc.data();
                    if (!a) return;
                    var id = a.id || doc.id;
                    if (window._newsCache.find(function (x) { return x.id === id; })) return;
                    if (window._empNewsIsDeleted && window._empNewsIsDeleted(id)) return; // deleted by an admin — never resurrect from the archive

                    var mediaUrl = a.mediaUrl || a.image || (Array.isArray(a.media) && a.media[0]) || null;
                    var n = {
                        id:        id,
                        title:     a.title || '',
                        content:   a.content || a.body || a.summary || '',
                        mediaUrl:  mediaUrl,
                        mediaType: a.mediaType || null,
                        userId:    a.userId || a.publishedBy || '',
                        username:  a.username || a.writer || 'admin',
                        createdAt: a.createdAt || null,
                        likes:     a.likes || 0,
                        retweets:  a.retweets || 0,
                        commentCount: a.commentCount || 0,
                        views:     a.views || 0
                    };

                    window._newsCache.push(n); /* push — these are older items, keep newest-first order from news_posts on top */
                    _addToNewsList(n, false /* append — these are the older items */);
                    added = true;
                });
                if (added) {
                    /* Re-sort cache newest-first by createdAt */
                    window._newsCache.sort(function (a, b) {
                        var ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                        var tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                        return tb - ta;
                    });
                    renderDashboardNews();
                    _syncEmpty();
                }
            })
            .catch(function (err) {
                console.warn('[News] legacy news_articles read failed:', err && err.message);
            });
    }

    /* ─────────────────────────────────────────────────────────────────────────
       §14  REDESIGN CSS
       Compact list rows (screenshot-1: headline left, small thumbnail
       right) + a full article detail view (screenshot-2: media on top,
       full article + comments beneath). Injected once, scoped entirely to
       #news-list-container / #news-article-detail so nothing else on the
       page is touched.
    ───────────────────────────────────────────────────────────────────────── */
    function _injectRedesignCss() {
        if (document.getElementById('_news_redesign_style')) return;
        var s = document.createElement('style');
        s.id = '_news_redesign_style';
        s.textContent = [
            /* ── Compact list row ── */
            '#news-list-container .news-list-item { display:flex;flex-direction:row;align-items:flex-start;gap:14px;padding:16px 6px;border-radius:0;box-shadow:none;background:transparent;border-bottom:1px solid rgba(10,14,39,0.08);margin-bottom:0; }',
            '#news-list-container .news-list-item:last-child { border-bottom:none; }',
            '#news-list-container .news-list-item:hover { box-shadow:none !important;transform:none !important;background:rgba(91,14,166,0.03) !important; }',
            '#news-list-container .news-item-content-wrapper { order:1;flex:1;min-width:0; }',
            '#news-list-container .news-item-image { order:2;width:98px;height:98px;flex-shrink:0;margin-bottom:0;border-radius:12px;cursor:pointer; }',
            '#news-list-container .post-options { position:absolute;top:6px;right:108px;margin-left:0;z-index:2; }',
            '#news-list-container .news-row-topline { display:flex;align-items:center;gap:10px;margin-bottom:4px; }',
            '#news-list-container .news-row-source { font-size:0.7rem;font-weight:700;color:#B8860B;text-transform:uppercase;letter-spacing:0.04em;background:rgba(184,134,11,0.1);padding:2px 8px;border-radius:20px; }',
            /* FIX (viewers count stuck at 0 in the compact list — see the
               '.news-row-viewcount' badge added in _buildNewsItem above):
               matches the existing '.news-row-commentcount' look so the two
               sit as one visual family in the topline. */
            '#news-list-container .news-row-viewcount { font-size:0.72rem;color:var(--text-muted);display:flex;align-items:center;gap:4px; }',
            '#news-list-container .news-row-commentcount { font-size:0.72rem;color:var(--text-muted);display:flex;align-items:center;gap:4px; }',
            '#news-list-container .news-item-content h4 { font-size:0.98rem !important;line-height:1.35;margin-bottom:4px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer; }',
            '#news-list-container .news-item-content h4::after { display:none !important; }',
            '#news-list-container .news-meta { margin-bottom:0 !important;font-size:0.72rem !important; }',
            '#news-list-container .news-item-content p,',
            '#news-list-container .story-actions,',
            '#news-list-container .comment-section { display:none !important; }',
            '#news-list-container .news-item-image { box-shadow:0 3px 10px rgba(10,14,39,0.12); transition:transform 0.2s ease; }',
            '#news-list-container .news-list-item:active .news-item-image { transform:scale(0.97); }',
            /* ── Reels strip ── */
            '#news-reels-strip-wrap { padding:4px 6px 14px; }',
            '.news-reels-heading { font-size:0.92rem;font-weight:800;color:var(--primary);margin:0 0 10px;display:flex;align-items:center;gap:6px; }',
            '.news-reels-heading i { color:#B8860B; }',
            '.news-reels-strip { display:flex;flex-wrap:nowrap;overflow-x:auto;gap:10px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding-bottom:6px; }',
            '.news-reel-card { position:relative;flex:0 0 108px;width:108px;height:180px;border-radius:14px;overflow:hidden;cursor:pointer;background:#000;scroll-snap-align:start;box-shadow:0 4px 14px rgba(91,14,166,0.14);transition:transform 0.2s ease; }',
            '.news-reel-card:active { transform:scale(0.96); }',
            '.news-reel-card video { width:100%;height:100%;object-fit:cover;display:block;pointer-events:none; }',
            '.news-reel-overlay { position:absolute;left:0;right:0;bottom:0;padding:8px 8px 10px;background:linear-gradient(to top,rgba(0,0,0,0.8),transparent); }',
            '.news-reel-title { color:#fff;font-size:0.72rem;font-weight:700;line-height:1.25;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden; }',
            /* ── Full article detail view ── */
            '#news-article-detail { display:none; }',
            '#news-article-detail.open { display:block; }',
            '#news-article-detail .nad-topbar { display:flex;align-items:center;gap:10px;padding:2px 0 16px; }',
            '#news-article-detail .nad-back-btn { background:rgba(10,14,39,0.06);border:none;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--primary);flex-shrink:0;font-size:0.95rem; }',
            '#news-article-detail .nad-back-btn:active { background:rgba(10,14,39,0.12); }',
            '#news-article-detail .nad-media { width:100%;border-radius:16px;overflow:hidden;margin-bottom:10px;background:#000;box-shadow:0 6px 20px rgba(10,14,39,0.16);position:relative; }',
            '#news-article-detail .nad-media img, #news-article-detail .nad-media video { width:100%;max-height:360px;object-fit:cover;display:block; }',
            '#news-article-detail .nad-media-counter { position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,0.62);color:#fff;font-size:0.72rem;font-weight:700;padding:3px 10px;border-radius:20px;pointer-events:none; }',
            '#news-article-detail .nad-media-thumbs { display:none;gap:8px;overflow-x:auto;padding:0 2px 16px;-webkit-overflow-scrolling:touch; }',
            '#news-article-detail .nad-media-thumbs.show { display:flex; }',
            '#news-article-detail .nad-media-thumb { flex:0 0 64px;width:64px;height:52px;border-radius:9px;overflow:hidden;cursor:pointer;border:2px solid transparent;opacity:0.6;transition:opacity 0.15s ease,border-color 0.15s ease; }',
            '#news-article-detail .nad-media-thumb img, #news-article-detail .nad-media-thumb video { width:100%;height:100%;object-fit:cover;display:block;pointer-events:none; }',
            '#news-article-detail .nad-media-thumb.active { opacity:1;border-color:var(--color-gold,#B8860B); }',
            '#news-article-detail .nad-title { font-family:var(--font-ui);color:var(--primary);font-weight:800;font-size:1.35rem;line-height:1.32;margin-bottom:10px;letter-spacing:-0.01em; }',
            '#news-article-detail .nad-meta { color:var(--text-muted);font-size:0.82rem;margin-bottom:18px;display:flex;align-items:center;gap:8px; }',
            '#news-article-detail .nad-content { line-height:1.7;color:var(--color-neutral-700,#333);font-size:0.96rem;white-space:pre-wrap;margin-bottom:10px; }',
            '#news-article-detail .nad-inline-media { display:block;width:100%;max-height:320px;object-fit:cover;border-radius:12px;margin:14px 0;box-shadow:0 4px 14px rgba(10,14,39,0.12); }',
            /* ── Suggested Articles ("You may like") ── */
            '#news-article-detail .nad-suggested { margin-top:22px;padding-top:18px;border-top:1px solid rgba(10,14,39,0.08); }',
            '#news-article-detail .nad-suggested-heading { font-weight:800;color:var(--primary);margin:0 0 12px;font-size:1rem;letter-spacing:-0.01em; }',
            '#news-article-detail .nad-suggested-strip { display:flex;flex-wrap:nowrap;overflow-x:auto;gap:12px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding-bottom:6px; }',
            '#news-article-detail .nad-suggested-card { flex:0 0 168px;width:168px;scroll-snap-align:start;cursor:pointer;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 3px 12px rgba(10,14,39,0.1);transition:transform 0.2s ease,box-shadow 0.2s ease; }',
            '#news-article-detail .nad-suggested-card:active { transform:scale(0.97); }',
            '#news-article-detail .nad-suggested-thumb { width:100%;height:100px;background:#eee;overflow:hidden; }',
            '#news-article-detail .nad-suggested-thumb img { width:100%;height:100%;object-fit:cover;display:block; }',
            '#news-article-detail .nad-suggested-info { padding:10px; }',
            '#news-article-detail .nad-suggested-source { font-size:0.62rem;font-weight:700;color:#B8860B;text-transform:uppercase;letter-spacing:0.03em; }',
            '#news-article-detail .nad-suggested-title { font-size:0.82rem;font-weight:700;color:var(--primary);line-height:1.3;margin:4px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }',
            '#news-article-detail .nad-suggested-date { font-size:0.68rem;color:var(--text-muted); }',
            '#news-article-detail .nad-comments { margin-top:20px;padding-top:16px;border-top:1px solid rgba(10,14,39,0.08); }',
            '#news-article-detail .nad-comments-heading { font-weight:700;color:var(--primary);margin:0 0 12px;font-size:1.02rem; }',
            '/* Engagement row (2026-10-23): airy, premium - 46px pill buttons, hairline border, navy icons, gold hover, tinted active states */',
            '#news-article-detail .story-actions { display:flex !important;flex-wrap:wrap;align-items:center;justify-content:flex-start !important;gap:10px;margin:18px 0 8px !important;padding:14px 0 !important;border-top:1px solid rgba(10,14,39,0.08) !important;border-bottom:1px solid rgba(10,14,39,0.08); }',
            '#news-article-detail .story-actions .action-btn { height:46px;min-width:46px;box-sizing:border-box;padding:0 14px !important;gap:8px;border-radius:23px !important;background:#fff !important;border:1px solid #E1E5F2 !important;color:#1B2B8B !important;box-shadow:0 1px 2px rgba(10,14,39,0.05);transition:background .2s,border-color .2s,box-shadow .2s,transform .15s !important; }',
            '#news-article-detail .story-actions .action-btn:active { transform:scale(0.96); }',
            '#news-article-detail .story-actions .action-btn .x-pill { padding:0 !important;gap:8px;background:none !important; }',
            '#news-article-detail .story-actions .action-btn svg, #news-article-detail .story-actions .action-btn i { width:20px !important;height:20px !important;font-size:18px;display:flex;align-items:center;justify-content:center; }',
            '#news-article-detail .story-actions .action-btn svg { stroke-width:1.6; }',
            '#news-article-detail .story-actions .like-count, #news-article-detail .story-actions .retweet-count { font-size:0.86rem;font-weight:700;letter-spacing:.01em;font-variant-numeric:tabular-nums;color:inherit; }',
            '#news-article-detail .story-actions .share-btn, #news-article-detail .story-actions .download-media-btn { padding:0 !important;width:46px; }',
            '#news-article-detail .story-actions .action-btn:hover { border-color:#C9A66B !important;background:#FBF8F1 !important;box-shadow:0 4px 12px rgba(10,14,39,0.08); }',
            '#news-article-detail .story-actions .action-btn:hover svg { transform:none; }',
            '#news-article-detail .story-actions .like-btn.liked { background:rgba(225,29,106,0.08) !important;border-color:rgba(225,29,106,0.35) !important;color:#e11d6a !important; }',
            '#news-article-detail .story-actions .retweet-btn.retweeted { background:rgba(10,143,98,0.08) !important;border-color:rgba(10,143,98,0.35) !important;color:#0a8f62 !important; }',
            '#news-article-detail .story-actions .view-count-display { margin-left:auto;height:46px;gap:6px;padding:0 4px !important;min-width:0;border:none !important;background:none !important;box-shadow:none !important;color:#64748B !important; }',
            '#news-article-detail .story-actions .view-count-display svg { width:18px !important;height:18px !important; }',
            '#news-article-detail .story-actions .view-count-display .view-count { font-size:0.86rem;font-weight:600;color:inherit; }',
            '#news-article-detail .nad-suggested { margin-top:8px;border-top:none;padding-top:14px; }',
            '/* ===== NEWS SECTION REDESIGN (2026-10-23): category chips, top-story card, cleaner rows, status bar hidden, safer reel titles ===== */',
            'body.emp-news-open #status-bar-container { display:none !important; }',
            '#news-cat-chips { display:flex;gap:8px;overflow-x:auto;padding:4px 2px 12px;-webkit-overflow-scrolling:touch;scrollbar-width:none; }',
            '#news-cat-chips::-webkit-scrollbar { display:none; }',
            '#news-cat-chips button { flex:0 0 auto;min-height:44px;padding:0 18px;border-radius:22px;border:1px solid #D9DEF0;background:#fff;color:#1B2B8B;font-family:inherit;font-size:0.82rem;font-weight:600;cursor:pointer; }',
            '#news-cat-chips button.on { background:#1B2B8B;border-color:#1B2B8B;color:#fff; }',
            '#news-list-container .news-row-source { background:none !important;padding:0 !important;color:#7A5A1E !important;font-size:0.7rem !important;font-weight:700;letter-spacing:0.08em;text-transform:uppercase; }',
            '#news-list-container .news-item-content h4 { font-family:Georgia,\'Times New Roman\',serif;font-weight:700;color:#0A0E27; }',
            '#news-list-container .news-list-item.news-featured { flex-direction:column;gap:12px;padding:0 0 16px;border-radius:20px;overflow:hidden;background:#fff;box-shadow:0 10px 28px rgba(10,14,39,0.14);margin-bottom:10px;border-bottom:none; }',
            '#news-list-container .news-featured .news-item-image { order:0;width:100%;height:220px;margin:0;border-radius:0;box-shadow:none;position:relative; }',
            '#news-list-container .news-featured .news-item-image img, #news-list-container .news-featured .news-item-image video { width:100%;height:100%;object-fit:cover;display:block; }',
            '#news-list-container .news-featured .news-item-image::after { content:\'TOP STORY\';position:absolute;top:14px;left:14px;background:#C9A66B;color:#0A0E27;font-size:0.68rem;font-weight:700;letter-spacing:0.08em;line-height:1;padding:7px 12px;border-radius:12px; }',
            '#news-list-container .news-featured .news-item-content-wrapper { order:1;padding:0 16px; }',
            '#news-list-container .news-featured .news-item-content h4 { font-size:1.3rem !important;-webkit-line-clamp:4 !important; }',
            '#news-list-container .news-featured .post-options { right:12px;top:12px; }',
            '.news-reel-overlay { padding:46px 10px 10px !important;background:linear-gradient(to top,rgba(10,14,39,0.94) 0%,rgba(10,14,39,0.7) 55%,rgba(10,14,39,0) 100%) !important; }',
            '.news-reel-title { text-shadow:0 1px 3px rgba(0,0,0,0.6); }',
            '#news-article-detail .nad-topbar { padding:0 0 10px; }',
            '/* Article reader back button (2026-10-23): navy pill, gold hairline, chevron + BACK - same family as the Celebration back button */',
            '#news-article-detail .nad-back-btn { width:auto !important;height:44px !important;padding:0 18px 0 12px !important;border-radius:22px !important;background:#1B2B8B !important;border:1.5px solid #C9A66B !important;color:#F3E3BF !important;gap:6px;font-family:inherit;font-size:0.78rem;font-weight:700;letter-spacing:0.14em;box-shadow:0 4px 12px rgba(10,14,39,0.22); }',
            '#news-article-detail .nad-back-btn:active { background:#0A0E27 !important;transform:scale(0.97); }',
            '#news-article-detail .nad-back-btn svg { flex:0 0 auto; }'
        ].join('\n');
        document.head.appendChild(s);
    }


    /* ─────────────────────────────────────────────────────────────────────────
       §15  ARTICLE DETAIL VIEW  (screenshot-2)
       Built once, then re-populated per article. Kept as class
       "news-list-item" (with data-post-id / data-user-id set per article)
       so the existing like / retweet / share / download-media / comment
       delegated handlers in app-fixes.js — which already resolve the
       'news_posts' Firestore collection for any ".news-list-item" — work
       here with zero changes to that file.
    ───────────────────────────────────────────────────────────────────────── */
    function _buildArticleDetailContainer() {
        var existing = document.getElementById('news-article-detail');
        if (existing) return existing;
        var newsSection = document.getElementById('news');
        if (!newsSection) return null;

        var wrap = document.createElement('div');
        wrap.id = 'news-article-detail';
        wrap.className = 'news-list-item';
        wrap.innerHTML =
            '<div class="nad-topbar">'
                + '<button type="button" class="nad-back-btn" aria-label="Back to News"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg><span>BACK</span></button>'
            + '</div>'
            + '<div class="nad-media news-item-image"></div>'
            + '<div class="nad-media-thumbs"></div>'
            + '<h1 class="nad-title"></h1>'
            + '<span class="nad-meta"><i class="fas fa-calendar-alt"></i> <span class="nad-date"></span></span>'
            + '<div class="nad-content"></div>'
            + '<div class="story-actions" style="margin:4px 0 8px;">'
                + '<a class="action-btn like-btn" role="button" aria-label="Like"><i class="far fa-heart"></i><span class="like-count">0</span></a>'
                + '<a class="action-btn retweet-btn" role="button" aria-label="Repost">' + _actionIcon('repeat') + '<span class="retweet-count">0</span></a>'
                + '<a class="action-btn share-btn" role="button" aria-label="Share">' + _actionIcon('share') + '</a>'
                + '<a class="action-btn download-media-btn" role="button" aria-label="Download media">' + _actionIcon('download') + '</a>'
                + '<span class="action-btn view-count-display" style="margin-left:auto;color:var(--text-muted);font-size:0.72rem;pointer-events:none;">'
                + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"></path><circle cx="12" cy="12" r="3"></circle></svg><span class="view-count">0</span></span>'
            + '</div>'
            + '<div class="nad-suggested">'
                + '<h3 class="nad-suggested-heading">You may like</h3>'
                + '<div class="nad-suggested-strip"></div>'
            + '</div>'
            + '<div class="nad-comments">'
                + '<h3 class="nad-comments-heading">Comments <span class="comment-count">0</span></h3>'
                + '<div class="comment-list"></div>'
                + '<form class="comment-form" novalidate>'
                    + '<input type="text" name="comment-text" placeholder="Add a comment..." required>'
                    + '<button type="submit"><i class="fas fa-paper-plane"></i></button>'
                + '</form>'
            + '</div>';

        var card = newsSection.querySelector('.card');
        if (card && card.parentNode) { card.parentNode.insertBefore(wrap, card.nextSibling); }
        else { newsSection.appendChild(wrap); }

        wrap.querySelector('.nad-back-btn').addEventListener('click', _closeArticleDetail);
        return wrap;
    }

    /* ─────────────────────────────────────────────────────────────────────────
       §14a  VIEW COUNT
       ─────────────────────────────────────────────────────────────────────────
       FIX (report: "news publication from admin control panel doesn't
       indicate the total number of viewer[s] viewing the page/post"): the
       reader UI (_openArticleDetail below) already had a '.view-count' span
       wired up to display `n.views`, and the admin table already read
       `a.views`/`n.views` when backfilling legacy articles — but nothing
       anywhere in this file, or any other, ever WROTE to that field. Every
       article's view count was permanently stuck at whatever it started
       at (0, or whatever _loadLegacyNewsArticles backfilled from an old
       doc), because no increment call existed at all. This adds the one
       missing piece: a Firestore increment fired the moment an article is
       actually opened (both the in-app tap path and the `?post=news-<id>`
       shared-link path funnel through _openArticleDetail below, so one
       call site covers both).

       Deduped per browser tab session (not per-account, the way likes/
       retweets are — a "view" is meant to count traffic, not be a
       one-time-per-account engagement toggle) via an in-memory Set, so
       reopening the same article repeatedly in one sitting (e.g. flipping
       back and forth via the suggested-articles strip) doesn't inflate the
       count — a fresh page load starts a new session and can count again,
       which matches how view counters normally behave elsewhere.
    ───────────────────────────────────────────────────────────────────────── */
    var _viewedThisSession = {};

    function _fieldIncrement(n) {
        try {
            if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) {
                return firebase.firestore.FieldValue.increment(n);
            }
        } catch (e) { /* fall through */ }
        return null;
    }

    function _bumpArticleViewCount(id) {
        if (!id || _viewedThisSession[id]) return;
        _viewedThisSession[id] = true;

        // Optimistic local update — mutates the SAME object _newsCache holds
        // (found by id, same as the caller's own lookup), so by the time
        // _openArticleDetail below reads n.views a few lines later it
        // already reflects this bump, even before the Firestore write
        // round-trips.
        var cached = (window._newsCache || []).find(function (x) { return x.id === id; });
        if (cached) cached.views = (cached.views || 0) + 1;

        if (!_fbOk()) return; // best-effort only — no Firestore, no persisted count
        var inc = _fieldIncrement(1);
        if (!inc) return;
        // Both collections get the increment, independently and in
        // parallel (neither is a fallback for the other) — the public
        // reader (this file) reads from news_posts, but the admin panel's
        // "Published Articles" table (app-admin.js's _refreshNewsTable)
        // queries news_articles specifically, same as every other field on
        // that archive copy (see app-admin.js's own submit handler, which
        // already writes title/writer/category/etc. to both). Without
        // bumping both, the admin table's view count would sit frozen at 0
        // forever even as the real, public-facing count climbed.
        window.fbDb.collection('news_posts').doc(id).update({ views: inc }).catch(function () {});
        window.fbDb.collection('news_articles').doc(id).update({ views: inc }).catch(function () {});
    }

    /* ─────────────────────────────────────────────────────────────────────────
       §14b  ARTICLE MEDIA GALLERY (hero + tap-through thumbnail strip)
       ─────────────────────────────────────────────────────────────────────────
       See the FIX comment at its one call site (_openArticleDetail below)
       for the full "why this exists" — short version: n.media can hold
       more than one uploaded file, but nothing ever displayed past the
       first. This renders all of them; a single-media article (or a
       legacy one saved before n.media existed) renders exactly as before,
       with the thumbnail strip simply staying hidden.
    ───────────────────────────────────────────────────────────────────────── */
    function _articleMediaItems(n) {
        if (Array.isArray(n.media) && n.media.length) {
            return n.media.map(function (m, idx) {
                var url  = (typeof m === 'string') ? m : (m && m.url) || '';
                var type = (typeof m === 'object' && m) ? (m.type || '') : (idx === 0 ? (n.mediaType || '') : '');
                return { url: url, type: type };
            }).filter(function (m) { return !!m.url; });
        }
        if (n.mediaUrl) return [{ url: n.mediaUrl, type: n.mediaType || '' }];
        return [];
    }

    function _isVideoItem(item) {
        return !!item.url && (
            (item.type || '').startsWith('video/')
            || /\/video\/upload\//i.test(item.url)
            || /\.(mp4|webm|mov)(\?|$)/i.test(item.url)
        );
    }

    /* FIX (request — "multiple pictures can be placed... at the middle of
       the article"): admin-news-body was always rendered as plain text
       (`.textContent =`), so there was no way to put an uploaded image
       ANYWHERE inside the article except the top hero gallery
       (_renderArticleMedia above). This lets the admin drop a
       `[img:N]` token at any point in the body text (see
       app-admin.js's media-preview thumbnails — clicking one inserts its
       own token at the cursor) and renders it here as a real inline
       image/video at that exact position, referencing the same
       n.media/n.mediaUrl list _renderArticleMedia already reads, so
       there's exactly one source of truth for "what media does this
       article have" — no separate inline-only upload path to keep in
       sync. Escaping happens BEFORE the token substitution below, and
       the token itself (`[img:N]`, only digits) can't introduce any HTML
       — the article text itself can never become executable markup this
       way, only these specific, app-generated tokens are ever expanded. */
    function _renderArticleBody(contentEl, n) {
        if (!contentEl) return;
        var raw = n.content || '';
        var escaped = _esc(raw); // digits/brackets/colon in [img:N] are untouched by _esc, so the token still matches after this
        var items = _articleMediaItems(n);
        var html = escaped.replace(/\[img:(\d+)\]/g, function (whole, idxStr) {
            var idx = parseInt(idxStr, 10);
            var item = items[idx];
            if (!item) return ''; // media removed/out of range since this was written — drop the token rather than show a broken tag
            var isVid = _isVideoItem(item);
            return isVid
                ? '<video class="nad-inline-media" src="' + _esc(item.url) + '" controls playsinline></video>'
                : '<img class="nad-inline-media" src="' + _esc(item.url) + '" loading="lazy">';
        });
        contentEl.innerHTML = html;
    }

    function _renderArticleMedia(wrap, n) {
        var items = _articleMediaItems(n);
        var mediaEl  = wrap.querySelector('.nad-media');
        var thumbsEl = wrap.querySelector('.nad-media-thumbs');
        if (!mediaEl) return;

        mediaEl.style.display = items.length ? '' : 'none';
        if (!items.length) {
            mediaEl.innerHTML = '';
            if (thumbsEl) { thumbsEl.innerHTML = ''; thumbsEl.classList.remove('show'); }
            mediaEl._newsGallery = null;
            return;
        }

        function paintHero(idx) {
            idx = Math.max(0, Math.min(idx, items.length - 1)); // clamp — no wraparound
            var item = items[idx];
            var isVid = _isVideoItem(item);
            mediaEl.innerHTML = (isVid
                ? '<video src="' + _esc(item.url) + '" controls playsinline style="width:100%;height:100%;object-fit:cover;"></video>'
                : '<img src="' + _esc(item.url) + '" loading="lazy">')
                + (items.length > 1
                    ? '<span class="nad-media-counter">' + (idx + 1) + ' / ' + items.length + '</span>'
                    : '');
            if (thumbsEl) {
                thumbsEl.querySelectorAll('.nad-media-thumb').forEach(function (t, tIdx) {
                    t.classList.toggle('active', tIdx === idx);
                });
            }
            mediaEl._newsGallery.activeIdx = idx;
        }

        // FIX (request — "horizontal swipe to view [multiple pictures] at
        // the top"): the tap-thumbnail switcher already existed; this adds
        // a real finger-swipe on the hero image/video itself. mediaEl (the
        // #news-article-detail container's one .nad-media node) is REUSED
        // across every article opened in a session — only its innerHTML is
        // replaced per paintHero() call above — so the touch listeners are
        // wired once (guarded by _newsSwipeWired) and read gallery state
        // (items/activeIdx/paintHero) from mediaEl._newsGallery, which this
        // function refreshes on every call, instead of closing over a
        // specific render's now-stale variables. Wiring a fresh listener
        // per call without this would stack duplicate handlers the same
        // way this codebase has already had to fix elsewhere (see
        // app-live.js/app-fix-final.js's own re-execution guards).
        mediaEl._newsGallery = { items: items, activeIdx: 0, paintHero: paintHero };

        if (!mediaEl._newsSwipeWired) {
            mediaEl._newsSwipeWired = true;
            var _tx = 0, _ty = 0, _tActive = false;
            var SWIPE_MIN_PX = 40;   // minimum horizontal travel to count as a swipe, not a tap/scroll jitter
            var SWIPE_MAX_VERTICAL = 60; // if the finger moved more than this vertically, treat it as a scroll instead
            mediaEl.addEventListener('touchstart', function (e) {
                if (!e.touches || e.touches.length !== 1) return;
                _tx = e.touches[0].clientX;
                _ty = e.touches[0].clientY;
                _tActive = true;
            }, { passive: true });
            mediaEl.addEventListener('touchend', function (e) {
                if (!_tActive) return;
                _tActive = false;
                var g = mediaEl._newsGallery;
                if (!g || g.items.length <= 1) return;
                var touch = (e.changedTouches && e.changedTouches[0]) || null;
                if (!touch) return;
                var dx = touch.clientX - _tx;
                var dy = touch.clientY - _ty;
                if (Math.abs(dy) > SWIPE_MAX_VERTICAL) return; // vertical scroll, not a gallery swipe
                if (dx <= -SWIPE_MIN_PX) g.paintHero(g.activeIdx + 1);      // swiped left -> next
                else if (dx >= SWIPE_MIN_PX) g.paintHero(g.activeIdx - 1);  // swiped right -> previous
            }, { passive: true });
        }

        paintHero(0);

        if (!thumbsEl) return;
        if (items.length <= 1) {
            thumbsEl.innerHTML = '';
            thumbsEl.classList.remove('show');
            return;
        }
        thumbsEl.innerHTML = items.map(function (item, idx) {
            var isVid = _isVideoItem(item);
            return '<div class="nad-media-thumb' + (idx === 0 ? ' active' : '') + '" data-idx="' + idx + '">'
                + (isVid
                    ? '<video src="' + _esc(item.url) + '" muted playsinline preload="metadata"></video>'
                    : '<img src="' + _esc(item.url) + '" loading="lazy">')
                + '</div>';
        }).join('');
        thumbsEl.classList.add('show');
        thumbsEl.querySelectorAll('.nad-media-thumb').forEach(function (t) {
            t.addEventListener('click', function () {
                var idx = parseInt(t.dataset.idx, 10);
                if (!isNaN(idx)) paintHero(idx);
            });
        });
    }

    function _openArticleDetail(id) {
        var n = (window._newsCache || []).find(function (x) { return x.id === id; });
        if (!n) return;
        _bumpArticleViewCount(id);
        var wrap = _buildArticleDetailContainer();
        if (!wrap) return;

        wrap.dataset.postId = n.id;
        wrap.dataset.userId = n.userId || '';

        // FIX (2026-09-03 — "expand/increase the number of media
        // uploaded"): admin-news-media already lets an admin select and
        // upload MULTIPLE images/videos (input has `multiple`, and
        // app-admin.js's submit handler already uploads every selected
        // file and saves the full list to Firestore as article.media —
        // no cap anywhere in that path). The gap was entirely on THIS
        // side: every reader-facing render — this one and the list-card
        // one in _buildNewsItem above — only ever looked at n.mediaUrl,
        // a single field the admin form derives as media[0]. Every image/
        // video an admin uploaded beyond the first was already being
        // saved, just never shown to anyone. Fixed by rendering the full
        // n.media array here as a hero + tap-through thumbnail strip
        // (mirrors the pattern already used elsewhere in this app for
        // multi-image galleries — see app-marketplace.js's own gallery),
        // falling back to the single mediaUrl for older articles saved
        // before n.media existed.
        _renderArticleMedia(wrap, n);

        wrap.querySelector('.nad-title').textContent = n.title || '';
        var dateStr = n.createdAt
            ? new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
            : 'Recently';
        wrap.querySelector('.nad-date').textContent = dateStr;
        _renderArticleBody(wrap.querySelector('.nad-content'), n);

        wrap.querySelector('.like-count').textContent    = n.likes || 0;
        wrap.querySelector('.retweet-count').textContent = n.retweets || 0;
        wrap.querySelector('.view-count').textContent    = n.views || 0;
        wrap.querySelector('.comment-count').textContent = n.commentCount || 0;

        var listEl    = document.getElementById('news-list-container');
        var card      = listEl ? listEl.closest('.card') : null;
        var searchBar = document.querySelector('#news .section-search-bar');
        var header    = document.querySelector('#news .header');
        if (card)      card.style.display      = 'none';
        if (searchBar) searchBar.style.display = 'none';
        if (header)    header.style.display    = 'none';
        wrap.classList.add('open');

        _loadArticleComments(n.id, wrap.querySelector('.comment-list'));
        _renderSuggestedArticles(n.id, wrap.querySelector('.nad-suggested-strip'));

        var newsSection = document.getElementById('news');
        if (newsSection) newsSection.scrollTop = 0;
        window.scrollTo({ top: 0, behavior: 'auto' });
    }
    window._openArticleDetail = _openArticleDetail;

    /* ─────────────────────────────────────────────────────────────────────────
       §15a  OPEN-BY-ID  (for a shared `?post=news-<id>` link)
       ─────────────────────────────────────────────────────────────────────────
       ADDED (2026-08-07 — "shared links don't go to the specific post"
       follow-up): _openArticleDetail(id) above only ever reads from
       window._newsCache, and _startNewsListener() caps that cache at the
       most recent 30 articles (`.limit(30)`) — the exact same shape of gap
       app-startup.js's own deep-link handler already works around for
       regular posts (poll + "couldn't be found" message) and marketplace
       listings (direct Firestore fetch by id, since a listing may be far
       older than any capped in-memory list). News had NEITHER: nothing in
       this file exposed an "open article <id>, whether or not it's in the
       cache yet" entry point at all, so app-thread.js's openPostById (the
       only opener app-startup.js's boot-time deep-link code had for a
       non-reel/non-listing id) was being called for news- ids too, and it
       only ever searches `.impact-story[data-post-id]` — a selector that
       never matches `.news-list-item` (this file's own card class) — so a
       shared news-article link could never resolve, cache or no cache.

       This mirrors app-marketplace-sellers.js's _openListingDetailPage()
       pattern: try the in-memory cache first (near-instant, no network
       round trip for the common case of a recent article), then fall back
       to a direct-by-id Firestore read for anything older than the cache
       window, so a genuinely old article link still resolves instead of
       silently failing the way it would have via openPostById.
    ───────────────────────────────────────────────────────────────────────── */
    function openNewsArticleById(id) {
        if (!id) { _notify("Couldn't find that article.", 'info'); return; }

        function _tryCache() {
            var n = (window._newsCache || []).find(function (x) { return x.id === id; });
            if (!n) return false;
            if (typeof window.navigateTo === 'function') window.navigateTo('news');
            setTimeout(function () { _openArticleDetail(id); }, 250);
            return true;
        }

        if (_tryCache()) return;

        // Not in the capped 30-article cache yet — the listener may simply
        // not have delivered it to this tab yet (fresh page load), or it
        // may be older than the cache window entirely. Navigate to News
        // (which starts/ensures the listener) and give the live listener a
        // few seconds to deliver it before falling back to a direct read.
        if (typeof window.navigateTo === 'function') window.navigateTo('news');

        var attempts = 0, maxAttempts = 10; // ~5s at 500ms — shorter than the DOM-poll patterns above since this only needs the CACHE to update, not a DOM render
        var poll = setInterval(function () {
            attempts++;
            if (_tryCache()) { clearInterval(poll); return; }
            if (attempts >= maxAttempts) {
                clearInterval(poll);
                _fetchAndOpenDirect(id);
            }
        }, 500);
    }

    function _fetchAndOpenDirect(id) {
        if (!_fbOk()) { _notify("That article couldn't be found — it may have been deleted.", 'info'); return; }
        window.fbDb.collection('news_posts').doc(id).get().then(function (doc) {
            if (!doc.exists) { _notify("That article couldn't be found — it may have been deleted.", 'info'); return; }
            var n = doc.data() || {};
            if (!n.id) n.id = doc.id;
            // Prepend into the cache (same shape _startNewsListener's own
            // 'added' branch uses) so _openArticleDetail's cache lookup —
            // and anything else in this file that reads _newsCache, like
            // the suggested-articles strip — finds it too.
            var idx = (window._newsCache || []).findIndex(function (x) { return x.id === n.id; });
            if (idx === -1) window._newsCache.unshift(n); else window._newsCache[idx] = n;
            _openArticleDetail(n.id);
        }).catch(function (err) {
            console.warn('[News] direct fetch for deep link failed:', err && err.message);
            _notify("Couldn't load that article — please try again.", 'error');
        });
    }
    window.openNewsArticleById = openNewsArticleById;

    /* ─────────────────────────────────────────────────────────────────────────
       §15b  SUGGESTED ARTICLES  ("You may like")
       Picked at random from _newsCache, excluding the article currently
       open. Pure client-side — no new Firestore reads or admin fields.
    ───────────────────────────────────────────────────────────────────────── */
    function _renderSuggestedArticles(currentId, stripEl) {
        if (!stripEl) return;
        var wrap = stripEl.closest('.nad-suggested');

        var pool = (window._newsCache || []).filter(function (n) { return n.id !== currentId; });
        if (!pool.length) {
            if (wrap) wrap.style.display = 'none';
            return;
        }
        if (wrap) wrap.style.display = '';

        /* Shuffle a copy (Fisher-Yates) and take up to 6 */
        var shuffled = pool.slice();
        for (var i = shuffled.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
        }
        var picks = shuffled.slice(0, 6);

        stripEl.innerHTML = '';
        picks.forEach(function (n) {
            var isVid = n.mediaUrl && (
                (n.mediaType || '').startsWith('video/')
                || /\/video\/upload\//i.test(n.mediaUrl)
                || /\.(mp4|webm|mov)(\?|$)/i.test(n.mediaUrl)
            );
            var thumb = (!isVid && n.mediaUrl) ? n.mediaUrl
                : 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=400&q=80';

            var dateStr = n.createdAt
                ? new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                : 'Recently';

            var card = document.createElement('div');
            card.className = 'nad-suggested-card';
            card.dataset.postId = n.id || '';
            card.innerHTML =
                '<div class="nad-suggested-thumb">'
                    + '<img src="' + _esc(thumb) + '" loading="lazy" alt="'+ _attr(n.title || 'News') +'" '
                    + 'onerror="this.src=\'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=400&q=80\'">'
                + '</div>'
                + '<div class="nad-suggested-info">'
                    + '<span class="nad-suggested-source">' + _esc(n.username || 'Empyrean News') + '</span>'
                    + '<h4 class="nad-suggested-title">' + _esc(n.title || '') + '</h4>'
                    + '<span class="nad-suggested-date">' + dateStr + '</span>'
                + '</div>';

            card.addEventListener('click', function () {
                if (!n.id) return;
                _openArticleDetail(n.id);
            });

            stripEl.appendChild(card);
        });
    }
    window._renderSuggestedArticles = _renderSuggestedArticles;

    function _closeArticleDetail() {
        var wrap = document.getElementById('news-article-detail');
        if (wrap) wrap.classList.remove('open');
        var listEl    = document.getElementById('news-list-container');
        var card      = listEl ? listEl.closest('.card') : null;
        var searchBar = document.querySelector('#news .section-search-bar');
        var header    = document.querySelector('#news .header');
        if (card)      card.style.display      = '';
        if (searchBar) searchBar.style.display = '';
        if (header)    header.style.display    = '';
    }
    window._closeArticleDetail = _closeArticleDetail;


    /* ─────────────────────────────────────────────────────────────────────────
       §16  ARTICLE COMMENTS — threaded comments + replies (sub-comments)
       Reads the same 'comments' Firestore collection (postId / parentId /
       depth) already written by the existing comment-form submit handler
       in app-fixes.js, so comments posted here persist and reload, and
       comments/replies posted through this view are picked up by that
       same handler with zero changes to it — this view's comment-form and
       reply-forms use the exact class names/structure it already listens
       for (".comment-form", ".comment-list", "._reply_thread", etc.).
    ───────────────────────────────────────────────────────────────────────── */
    function _buildCommentEl(c) {
        var depth  = c.parentId ? 1 : 0;
        var admin  = _isAdmin();
        var avatar = c.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(c.username || 'U') + '&background=1B2B8B&color=fff&size=36');
        var ts     = c.createdAt ? new Date(c.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
        var textHtml = (typeof window.formatWhatsAppText === 'function') ? window.formatWhatsAppText(c.text || '') : _esc(c.text || '');

        var el = document.createElement('div');
        el.className = 'comment';
        el.dataset.commentId = c.id;
        el.dataset.pinned = c.pinned ? 'true' : 'false';
        el.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;align-items:flex-start;'
            + (depth > 0 ? 'margin-left:32px;' : '')
            + (c.pinned ? 'background:rgba(245,197,24,0.08);border-radius:12px;padding:4px;' : '');
        el.innerHTML =
            '<img src="' + _attr(avatar) + '" style="width:' + (depth > 0 ? '26' : '32') + 'px;height:' + (depth > 0 ? '26' : '32') + 'px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
            + '<div style="flex:1;">'
                + '<div style="background:rgba(10,14,39,0.04);border-radius:12px;padding:8px 12px;">'
                    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
                        + '<strong style="font-size:0.82rem;color:var(--primary);">' + _esc(c.username || 'User') + '</strong>'
                        + '<span style="font-size:0.7rem;color:var(--text-muted);">' + ts + '</span>'
                        + (depth === 0 ? '<span class="_pinned_badge" style="display:' + (c.pinned ? 'inline-flex' : 'none') + ';align-items:center;gap:3px;font-size:0.68rem;font-weight:700;color:#B8860B;"><i class="fas fa-thumbtack" style="font-size:0.62rem;"></i> Pinned</span>' : '')
                    + '</div>'
                    + '<p style="font-size:0.85rem;margin:0;line-height:1.4;">' + textHtml + '</p>'
                + '</div>'
                + '<div style="display:flex;align-items:center;gap:4px;">'
                    + '<button type="button" class="_reply_btn" data-parent-id="' + _attr(c.id) + '" style="background:none;border:none;color:var(--secondary);font-size:0.7rem;font-weight:700;cursor:pointer;padding:3px 6px;margin-top:2px;">↩ Reply</button>'
                    + (depth === 0 ? '<button type="button" class="_admin_pin_btn" data-comment-id="' + _attr(c.id) + '" title="' + (c.pinned ? 'Unpin comment' : 'Pin comment') + '" style="display:' + (admin ? 'inline-flex' : 'none') + ';align-items:center;gap:3px;background:none;border:none;color:' + (c.pinned ? '#B8860B' : 'var(--text-muted)') + ';font-size:0.7rem;font-weight:700;cursor:pointer;padding:3px 6px;margin-top:2px;"><i class="fas fa-thumbtack"></i> ' + (c.pinned ? 'Unpin' : 'Pin') + '</button>' : '')
                + '</div>'
                + '<div class="_reply_thread" style="margin-top:4px;"></div>'
            + '</div>';

        var replyBtn = el.querySelector('._reply_btn');
        if (replyBtn) {
            replyBtn.addEventListener('click', function () {
                var thread = el.querySelector('._reply_thread');
                var existingForm = thread.querySelector('._inline_reply_form');
                if (existingForm) { existingForm.remove(); return; }
                var replyForm = document.createElement('form');
                replyForm.className = 'comment-form _inline_reply_form';
                replyForm.dataset.replyTo = c.id;
                replyForm.style.cssText = 'display:flex;gap:6px;margin-top:6px;margin-left:8px;';
                replyForm.innerHTML =
                    '<input type="text" name="comment-text" placeholder="Write a reply…" required style="flex:1;border:1px solid rgba(10,14,39,0.15);border-radius:50px;padding:6px 12px;font-size:0.8rem;outline:none;">'
                    + '<button type="submit" style="background:var(--secondary);border:none;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;"><i class="fas fa-paper-plane" style="color:#0A0E27;font-size:0.65rem;"></i></button>';
                thread.appendChild(replyForm);
                replyForm.querySelector('input').focus();
            });
        }
        return el;
    }

    function _loadArticleComments(articleId, listEl) {
        if (!listEl) return;
        listEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:16px 0;font-size:0.85rem;">Loading comments…</p>';
        if (!_fbOk()) { listEl.innerHTML = ''; return; }

        /* Equality filter only (no orderBy) — avoids requiring a Firestore
           composite index; comments are sorted client-side instead. */
        window.fbDb.collection('comments').where('postId', '==', articleId).get()
            .then(function (snap) {
                listEl.innerHTML = '';
                if (!snap || snap.empty) {
                    listEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:16px 0;font-size:0.85rem;">No comments yet. Be the first to comment.</p>';
                    return;
                }
                var all = [];
                snap.forEach(function (doc) {
                    var d = doc.data();
                    if (!d) return;
                    if (!d.id) d.id = doc.id;
                    all.push(d);
                });
                all.sort(function (a, b) {
                    var ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    var tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return ta - tb;
                });

                var byParent = {};
                all.forEach(function (c) {
                    var key = c.parentId || '_root';
                    (byParent[key] = byParent[key] || []).push(c);
                });
                if (byParent._root) {
                    byParent._root.sort(function (a, b) {
                        if (!!a.pinned === !!b.pinned) return 0;
                        return a.pinned ? -1 : 1;
                    });
                }

                (function renderLevel(parentKey, container) {
                    (byParent[parentKey] || []).forEach(function (c) {
                        var el = _buildCommentEl(c);
                        container.appendChild(el);
                        var thread = el.querySelector('._reply_thread');
                        if (thread) renderLevel(c.id, thread);
                    });
                })('_root', listEl);

                var wrap = document.getElementById('news-article-detail');
                var countEl = wrap ? wrap.querySelector('.comment-count') : null;
                if (countEl) countEl.textContent = all.length;
            })
            .catch(function (err) {
                console.warn('[News] comments load failed:', err && err.message);
                listEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:16px 0;font-size:0.85rem;">Could not load comments.</p>';
            });
    }


    /* =========================================================================
       FEATURE (2026-09-23 — public Election Results Dashboard): renders the
       admin-published election_results/current doc (see app-admin.js's new
       ADMIN PANEL — ELECTION RESULTS section) into #election-dashboard-
       container on the main Dashboard, for EVERY visitor — logged in or
       not — to see (index.html's own placeholder comment at that div named
       this file/function as the intended renderer; it had never actually
       been written until now). Read-only — this file never writes to
       election_results. Stays hidden (no-op) until an admin has actually
       published a doc, so nobody ever sees placeholder/fake numbers. Uses
       onSnapshot so a newly-published or updated result appears live,
       without a page refresh, on every open dashboard.
       ========================================================================= */
    var _ELECTION_CANDIDATES = [
        { id: 'tinubu', name: 'Bola Ahmed Tinubu', party: 'APC', color: '#00853F' },
        { id: 'atiku',  name: 'Atiku Abubakar',     party: 'ADC', color: '#1E7A3D' },
        { id: 'obi',    name: 'Peter Obi',          party: 'NDC', color: '#1B2260' },
        { id: 'sowore', name: 'Omoyele Sowore',     party: 'AAC', color: '#5C4033' },
        { id: 'makinde', name: 'Seyi Makinde',      party: 'APM', color: '#0F2A5C' },
        { id: 'duke',   name: 'Donald Duke',        party: 'PRP', color: '#B3202A' }
    ];

    function _injectElectionDashboardCss() {
        if (document.getElementById('news-election-dash-css')) return;
        var css = document.createElement('style');
        css.id = 'news-election-dash-css';
        css.textContent =
            '.edash-row{display:flex;align-items:center;gap:10px;margin-bottom:10px;}' +
            '.edash-name{flex:0 0 150px;font-size:0.82rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.edash-track{flex:1;height:16px;border-radius:8px;background:rgba(10,14,39,0.06);overflow:hidden;}' +
            '.edash-fill{height:100%;border-radius:8px;transition:width .6s ease;}' +
            '.edash-pct{flex:0 0 52px;text-align:right;font-size:0.82rem;font-weight:800;}' +
            '.edash-meta{font-size:0.75rem;color:var(--text-muted);margin-bottom:12px;}';
        document.head.appendChild(css);
    }

    function renderElectionDashboard() {
        var host = document.getElementById('election-dashboard-container');
        if (!host || !_fbOk() || window._electionDashUnsub) return; // already listening, or not ready yet
        _injectElectionDashboardCss();

        window._electionDashUnsub = window.fbDb.collection('election_results').doc('current')
            .onSnapshot(function (doc) {
                if (!doc.exists) { host.innerHTML = ''; host.style.display = 'none'; return; }
                var data = doc.data() || {};
                /* REWORKED (2026-09-24): no admin "published" switch any more —
                   election_results/current is now the running total that
                   app-patch-v49-v50.js's submitPuResult() bumps every time
                   someone uploads a polling-unit result (and that an admin's
                   Decline subtracts from). Stay hidden until the first
                   polling unit has reported so nobody sees an empty card. */
                var _unitsReported = Number(data.unitsReported || 0);
                if (_unitsReported <= 0) { host.innerHTML = ''; host.style.display = 'none'; return; }
                var _stateUnits = data.stateUnits || {};
                var _statesReporting = Object.keys(_stateUnits).filter(function (k) { return Number(_stateUnits[k]) > 0; }).length;
                var _statesTotal = Object.keys(window._NIGERIA_STATES_LGAS || {}).length || 37;

                var candVotes = data.candidates || {};
                var candidates = _ELECTION_CANDIDATES.map(function (c) {
                    return { id: c.id, name: c.name, party: c.party, color: c.color, votes: Number(candVotes[c.id] || 0) };
                });
                var total = candidates.reduce(function (s, c) { return s + c.votes; }, 0);

                var rows = candidates
                    .slice()
                    .sort(function (a, b) { return b.votes - a.votes; })
                    .map(function (c) {
                        var pct = total > 0 ? (c.votes / total * 100) : 0;
                        return '<div class="edash-row">' +
                            '<div class="edash-name">' + _esc(c.name) + ' (' + _esc(c.party) + ')</div>' +
                            '<div class="edash-track"><div class="edash-fill" style="width:' + pct.toFixed(1) + '%;background:' + c.color + ';"></div></div>' +
                            '<div class="edash-pct">' + pct.toFixed(1) + '%</div>' +
                            '</div>';
                    }).join('');

                host.innerHTML =
                    '<div class="card">' +
                    '<h3><span><i class="fas fa-square-poll-vertical" style="color:var(--secondary);margin-right:8px;"></i> Polling Unit Results \u2014 2027 Election</span></h3>' +
                    '<div class="edash-meta">' +
                    'Polling units reported: ' + _unitsReported.toLocaleString() +
                    ' \u00B7 States reporting: ' + _statesReporting + '/' + _statesTotal +
                    (total ? (' \u00B7 ' + total.toLocaleString() + ' total votes') : '') +
                    '</div>' +
                    rows +
                    '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:8px;">Compiled automatically from results uploaded by people at their polling units. Not official \u2014 only INEC announces official results.</div>' +
                    '</div>';
                host.style.display = '';
            }, function (err) {
                console.warn('[News] election dashboard listener failed:', err && err.message);
            });
    }


    /* ─────────────────────────────────────────────────────────────────────────
       NEWS SECTION REDESIGN (2026-10-23)
       - category chips (built from the categories actually present) + one shared
         filter that also honours the search box
       - first visible article becomes a "Top story" card (CSS: .news-featured)
       - rows show the article's category instead of the publisher handle ("ADMIN")
       - the global status/story bar is hidden while the News section is open
    ───────────────────────────────────────────────────────────────────────── */
    var _NEWS_CATS = { impact:'Impact Story', partnership:'Partnership', humanitarian:'Humanitarian', politics:'Politics', economy:'Economy',
        medicine:'Medicine & Health', science:'Science', technology:'Technology', sports:'Sports', entertainment:'Entertainment',
        policy:'Policy & Governance', finance:'Finance & EMPY',
        security:'Security', international:'International News', national:'National News', local:'Local News',
        education:'Education', environment:'Environment & Climate', agriculture:'Agriculture', business:'Business',
        crime:'Crime & Justice', lifestyle:'Lifestyle', religion:'Religion & Faith', opinion:'Opinion & Editorial',
        breaking:'Breaking News' };
    var _newsCat = 'all';
    function _catLabel(c) { if (!c) return ''; return _NEWS_CATS[c] || (String(c).charAt(0).toUpperCase() + String(c).slice(1)); }
    function _authorBit(n) {
        var u = n && n.username; if (!u || /^admin$/i.test(u) || u === _catLabel(n.category)) return '';
        return ' \u00B7 ' + _esc(u);
    }
    function _applyNewsFilters() {
        var nl = document.getElementById('news-list-container'); if (!nl) return;
        var inp = document.getElementById('news-search-input');
        var q = (inp && inp.value || '').trim().toLowerCase();
        var first = null;
        nl.querySelectorAll('.news-list-item').forEach(function (el) {
            var show = (!q || (el.textContent || '').toLowerCase().indexOf(q) !== -1) && (_newsCat === 'all' || el.dataset.cat === _newsCat);
            el.style.display = show ? '' : 'none';
            el.classList.remove('news-featured');
            if (show && !first) first = el;
        });
        if (first && first.querySelector('.news-item-image img, .news-item-image video')) first.classList.add('news-featured');
    }
    function _renderNewsChips() {
        var sec = document.getElementById('news'); if (!sec) return;
        var cats = [], seen = {};
        (window._newsCache || []).forEach(function (n) { var c = n && n.category; if (c && !seen[c]) { seen[c] = 1; cats.push(c); } });
        var bar = document.getElementById('news-cat-chips');
        if (cats.length < 2) { if (bar) bar.style.display = 'none'; _newsCat = 'all'; return; }
        if (!bar) {
            bar = document.createElement('div'); bar.id = 'news-cat-chips';
            var header = sec.querySelector('.header');
            if (header && header.parentNode) header.parentNode.insertBefore(bar, header.nextSibling); else sec.insertBefore(bar, sec.firstChild);
            bar.addEventListener('click', function (e) {
                var b = e.target.closest && e.target.closest('button[data-cat]'); if (!b) return;
                _newsCat = b.dataset.cat; _renderNewsChips(); _applyNewsFilters();
            });
        }
        bar.style.display = '';
        if (_newsCat !== 'all' && !seen[_newsCat]) _newsCat = 'all';
        var h = '<button type="button" data-cat="all" class="' + (_newsCat === 'all' ? 'on' : '') + '">All</button>';
        cats.forEach(function (c) { h += '<button type="button" data-cat="' + _attr(c) + '" class="' + (_newsCat === c ? 'on' : '') + '">' + _esc(_catLabel(c)) + '</button>'; });
        bar.innerHTML = h;
    }
    function _wireNewsChrome() {
        var nl = document.getElementById('news-list-container');
        if (nl && !nl._chromeObs) {
            nl._chromeObs = true;
            var t = null;
            new MutationObserver(function () { clearTimeout(t); t = setTimeout(function () { _renderNewsChips(); _applyNewsFilters(); }, 120); }).observe(nl, { childList: true });
            _renderNewsChips(); _applyNewsFilters();
        }
        var sec = document.getElementById('news');
        if (sec && !sec._openWatch) {
            sec._openWatch = true;
            var sync = function () { document.body.classList.toggle('emp-news-open', sec.classList.contains('active')); };
            new MutationObserver(sync).observe(sec, { attributes: true, attributeFilter: ['class'] });
            sync();
        }
    }

    function _init() {
        _injectRedesignCss();
        _buildArticleDetailContainer();
        _wireSearch();
        _wireNewsChrome();
        _wireDeleteDelegation();
        _observeNewsList();

        /* Try to start listener immediately */
        if (_fbOk()) {
            _startNewsListener();
            _loadLegacyNewsArticles();
            renderElectionDashboard();
        } else {
            /* Wait for Firebase to initialise */
            window.addEventListener('empyrean:firebase-ready', function () {
                setTimeout(_startNewsListener, 200);
                setTimeout(_loadLegacyNewsArticles, 600);
                setTimeout(renderDashboardNews, 3000);
                setTimeout(renderElectionDashboard, 700);
            });
            /* Fallback: poll until Firebase is ready */
            var _poll = setInterval(function () {
                if (_fbOk()) {
                    clearInterval(_poll);
                    _startNewsListener();
                    _loadLegacyNewsArticles();
                    renderElectionDashboard();
                }
            }, 500);
            /* Give up polling after 30 s — Firebase may never load (offline mode) */
            setTimeout(function () { clearInterval(_poll); }, 30000);
        }

        /* Render whatever is already in the DOM on first load */
        setTimeout(renderDashboardNews, 800);
        setTimeout(renderDashboardNews, 2500);
        /* Extra retries to catch slow Firestore responses */
        setTimeout(renderDashboardNews, 5000);
        setTimeout(renderDashboardNews, 9000);

        /* Safety: if cache is still empty after 6s and Firebase is ready,
           the listener flag may be stuck from a prior failed attempt —
           reset and retry once. */
        setTimeout(function () {
            if ((window._newsCache || []).length === 0 && _fbOk()) {
                window._newsListenerActive = false;
                _startNewsListener();
                _loadLegacyNewsArticles();
            }
        }, 6000);
    }

    _ready(_init);

    console.log('[News] app-news.js loaded — standalone News Media module v1.0');

})();