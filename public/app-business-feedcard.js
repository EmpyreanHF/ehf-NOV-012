/* =============================================================================
   EMPYREAN INTERNATIONAL — BUSINESS PAGE FEED CARD
   app-business-feedcard.js  |  v1.5  |  New standalone module

   PURPOSE
   ───────
   Renders interactive "Business Page" cards directly inside the Community
   Feed (#feed-container), per spec:

     • Collapsed state: business header (logo, name) + a horizontally
       scrollable row of product thumbnails (image, name, price) + a
       "Visit Business Page" button + Like/Comment/Share action bar.
     • Expanded state: clicking any product opens a full-screen modal with
       a header (logo, name, cover) and a 2-column product grid (image,
       name, price), the same "Visit Business Page" CTA, and the same
       action bar.
     • Clicking "Visit Business Page" navigates to that business's full
       page via the existing window.navigateTo / window.renderBusinessPage
       pipeline already used elsewhere in the app.
     • A Follow button sits in the header of both the collapsed card and
       the expanded modal (next to the page name), letting any signed-in
       user follow/unfollow that business. Backed by a `followers` array
       on business_pages/{pageId} in Firestore; see the FOLLOW section
       below for details, including a reusable renderBizFollowButton()
       helper exposed on window for other modules to drop into their own
       business-page header markup.
     • Card SET: every business page with at least one product gets its
       own card; all of them sit side-by-side inside one horizontally
       swipeable wrapper (.biz-feedcard-set) so users can swipe between
       different businesses' product arrays, rather than only ever seeing
       a single "most recently active" business.

   WHY A STANDALONE MODULE
   ────────────────────────
   The main feed's regular post-card template (".impact-story") is built by
   a module not present in this patch set, so this card is intentionally
   self-contained: its own builder, its own positioning logic, its own
   modal. It only needs to find #feed-container and insert itself as a
   sibling — it never reads or depends on the unknown template.

   PLACEMENT
   ─────────
   Spec: "Posts → Business Page card(s) → More posts" — the card set must
   sit in the MIDDLE of the feed, never first, never last. A
   MutationObserver watches #feed-container and re-positions the set after
   the 3rd real post (".impact-story") any time the feed's post count
   changes, so it stays mid-feed as new posts stream in (matches the
   existing live-feed pattern already used by app-feed.js / app-fixes.js
   for SOS and crisis cards).

   DATA SOURCE
   ───────────
   business_posts documents (written by app-business.js submitBusinessPost).
   Each post now carries a `products` array — { url, isVideo, name, price }
   — one entry per uploaded media item, in addition to the existing `media`
   array (kept for backward compatibility with older renderers). This module
   groups posts by pageId and builds ONE card per business page that has at
   least one usable product, sorted by most recently active first, with
   every product from that business's recent posts feeding its thumbnail
   row / expanded grid.

   LIKE / COMMENT / SHARE
   ───────────────────────
   Reuses the exact markup contract already wired up globally by
   app-fix-final.js §45 (universal like/share) — class="biz-post-card",
   data-collection="business_posts", data-post-id, and the same
   .action-btn.like-btn / .comment-btn / .action-btn.share-btn structure
   used by app-business.js's _buildBizPostCard(). Like/share are wired up
   automatically by §45's delegated handlers; comment-btn is wired by this
   module's own delegated handler further down, which opens the full-screen
   comment thread panel built earlier in this file.
   ============================================================================= */

(function empyreanBusinessFeedCard() {
    'use strict';

    if (window._empyreanBizFeedCardLoaded) {
        console.warn('[EmpBizFeedCard] Already loaded — skipping duplicate.');
        return;
    }
    window._empyreanBizFeedCardLoaded = true;

    function _S()       { return window.EmpState || {}; }
    function _us()      { return _S().userState || window.userState || {}; }
    function _isGuest() { var s = _S(); return s.isGuest != null ? !!s.isGuest : !!window.isGuest; }
    function _fbOk()    { return !!(window._firebaseLoaded && window.fbDb); }

    function ready(fn) {
        if (document.readyState !== 'loading') { fn(); }
        else { document.addEventListener('DOMContentLoaded', fn); }
    }

    function _esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    function _attr(s) { return String(s || '').replace(/"/g, '&quot;'); }

    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    }

    /* Format a free-text price field for display. Stored as raw text so the
       composer doesn't force a currency symbol on the poster; if it already
       looks like a number, prefix with $, otherwise show as typed. */
    function _fmtPrice(p, cur) {
        if (!p) return '';
        p = String(p).trim();
        if (!p) return '';
        /* UPDATED (2026-09-28): uses the currency the seller picked in Listing Details
           (\u20A6 $ \u00A3 \u20AC) + thousands separators; posts without a currency keep "$". */
        if (/^[\u20A6$\u00A3\u20AC]/.test(p) || /^(NGN|USD|GBP|EUR)\b/i.test(p)) return p;
        var sym = ({ NGN: '\u20A6', USD: '$', GBP: '\u00A3', EUR: '\u20AC' })[cur] || '$';
        var clean = p.replace(/[,\s]/g, '');
        if (/^\d+(\.\d+)?$/.test(clean)) return sym + Number(clean).toLocaleString('en-US', { maximumFractionDigits: 2 });
        return /^\d/.test(p) ? sym + p : p;
    }

    /* Condition / availability / negotiable pills for a product tile (2026-09-28).
       `dark` = light-on-dark variant used in the full-screen viewer caption. */
    function _itemChipsHTML(item, dark) {
        if (!item) return '';
        var chip = function (txt, bg, fg) {
            return '<span style="display:inline-block;font-size:0.58rem;font-weight:800;padding:2px 7px;border-radius:20px;'
                + 'background:' + bg + ';color:' + fg + ';white-space:nowrap;">' + _esc(txt) + '</span>';
        };
        var out = '';
        if (item.condition) out += dark ? chip(item.condition, 'rgba(255,255,255,0.18)', '#fff') : chip(item.condition, 'rgba(27,43,139,0.09)', '#1B2B8B');
        if (item.availability) {
            var a = item.availability;
            out += dark ? chip(a, 'rgba(255,255,255,0.18)', '#fff')
                 : a === 'Sold out' ? chip(a, 'rgba(229,57,53,0.1)', '#C62828')
                 : a === 'Limited stock' ? chip(a, 'rgba(245,158,11,0.15)', '#B45309')
                 : a === 'Pre-order' ? chip(a, 'rgba(37,99,235,0.1)', '#1D4ED8')
                 : chip(a, 'rgba(16,185,129,0.13)', '#047857');
        }
        if (item.negotiable) out += dark ? chip('Negotiable', 'rgba(255,255,255,0.18)', '#fff') : chip('Negotiable', 'rgba(91,14,166,0.1)', '#5B0EA6');
        return out ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;' + (dark ? 'justify-content:center;' : '') + '">' + out + '</div>' : '';
    }

    /* =========================================================================
       PRICE-VISIBILITY RULE — NGOs / service-rendering organisations don't
       show listing prices; product-selling businesses (retail, real estate,
       automotive, etc.) do.

       This codebase doesn't have a field literally called `organizationType`
       — the equivalent that already exists is the 7-way category system in
       app-business.js §3.5 (BIZ_CATEGORY_ORDER: ngo/bank/government/
       international/oilgas/service/product, resolved from a business_pages
       doc via window._bizResolveCategory()). This reuses that resolver
       rather than adding a second, parallel category concept.

       `business_posts` docs (what this feed card actually renders from)
       don't carry `category`/`industry` themselves — only the
       `business_pages` doc does — so the full page doc is looked up from
       window._firestoreBusinessPages (the same page-data cache
       _visitBusinessPage() below already reads) by pageId. If that page
       isn't in cache yet and no usable fallback object is passed either,
       this resolves to '' → _hidePriceForCategory('') is false, i.e. the
       price still shows. That's a deliberate fail-open: silently hiding a
       real price because the category couldn't be resolved would be a
       worse surprise than occasionally showing one it shouldn't. */
    function _resolveBizCategoryId(pageId, fallbackData) {
        var doc = null;
        if (pageId) {
            var pages = window._firestoreBusinessPages || [];
            doc = pages.find(function (p) { return p.id === pageId; });
        }
        if (!doc && fallbackData) doc = fallbackData;
        if (!doc || typeof window._bizResolveCategory !== 'function') return '';
        return window._bizResolveCategory(doc) || '';
    }
    function _hidePriceForCategory(categoryId) {
        return categoryId === 'ngo' || categoryId === 'service';
    }


    /* =========================================================================
       DATA — load recent business posts, grouped by business page
       ========================================================================= */

    var _cardData = null; /* { pageId, pageName, pageAvatar, pageCover, industry, products: [...], postIds: [...] } */

    /* FIX (card never appears on real data): every business_posts document
       created BEFORE this module's composer change only has a media[] array,
       never products[]. The original version of this function required
       products.length to be non-zero, so on a live site with only
       pre-existing posts it always returned null and the card never
       rendered — no error, just silent nothing. We now fall back to
       media[] when a post has no products[], treating each media URL as a
       nameless/priceless product (image/video shown, no name or price
       line) so the card still appears with real existing content instead
       of requiring everyone to re-post first. */
    function _productsFromPost(p) {
        /* 2026-09-28: each product now also carries the post's currency / condition /
           availability / negotiable flag so the tiles + full-screen viewer can show them. */
        var extras = {
            currency: p.listingCurrency || '',
            condition: p.listingCondition || '',
            availability: p.listingAvailability || '',
            negotiable: !!p.listingNegotiable
        };
        var withExtras = function (item) {
            var o = {}; for (var k in item) { if (Object.prototype.hasOwnProperty.call(item, k)) o[k] = item[k]; }
            for (var e in extras) o[e] = extras[e];
            return o;
        };
        if (Array.isArray(p.products) && p.products.length) return p.products.map(withExtras);
        var media = Array.isArray(p.media) ? p.media : [];
        return media.filter(function (url) { return url && !url.startsWith('blob:'); })
            .map(function (url) {
                return withExtras({
                    url: url,
                    isVideo: /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url) || /\/video\/upload\//i.test(url),
                    name: '',
                    price: ''
                });
            });
    }

    /* FIX (only one business ever shows): the previous version picked a
       single "most recently active" page and discarded every other page's
       products entirely — so on a platform with several businesses posting,
       only one of them could ever appear in the feed, no matter how many
       qualifying pages existed. Now returns an array, one entry per
       business page that has at least one usable product, sorted by most
       recently active first — the card-set renderer below turns this into
       a horizontally swipeable row of cards, one per business. */
    function _collectAllPagesFromCache() {
        var posts = window._firestoreBizFeedPosts || [];
        if (!posts.length) return [];

        var byPage = {};
        posts.forEach(function (p) {
            if (!p.pageId) return;
            if (!byPage[p.pageId]) byPage[p.pageId] = [];
            byPage[p.pageId].push(p);
        });

        var results = [];
        Object.keys(byPage).forEach(function (pid) {
            var pagePosts = byPage[pid].slice().sort(function (a, b) {
                var ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : (a.createdAt || 0);
                var tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : (b.createdAt || 0);
                return tb - ta;
            });

            var products = [];
            var postIds  = [];
            pagePosts.forEach(function (p) {
                postIds.push(p.id);
                _productsFromPost(p).forEach(function (item) {
                    if (item && item.url) products.push(item);
                });
            });
            if (!products.length) return;

            var latest = pagePosts[0];
            var t = latest.createdAt && latest.createdAt.toMillis ? latest.createdAt.toMillis() : (latest.createdAt || 0);
            results.push({
                pageId: pid,
                pageName: latest.pageName || 'Business',
                pageAvatar: latest.pageAvatar || '',
                pageCover: latest.pageCover || '',
                industry: latest.industry || latest.pageIndustry || '',
                /* Owner's own write-up for the most recent post — this is
                   what makes the card read as a real, current advert
                   instead of a generic banner; falls back to '' when the
                   owner posted media only with no caption, handled by the
                   card builder below. */
                caption: (latest.text || '').trim(),
                phone: latest.pagePhone || latest.phone || latest.contactPhone || '',
                address: latest.pageAddress || latest.address || '',
                postIds: postIds,
                products: products,
                _latestTime: t
            });
        });

        results.sort(function (a, b) { return b._latestTime - a._latestTime; });
        return results;
    }

    /* FIX (card never appears if Firebase isn't ready yet): the original
       version called the callback with null and never tried again if
       window.fbDb wasn't ready the first time _watchFeed() fired — there
       was no retry path, so on any session where Firebase auth/init was
       still resolving at empyrean-init-done+700ms, this module gave up
       permanently. We now retry on a short backoff instead of caching a
       one-time failure, up to a small cap so it doesn't poll forever if
       there's genuinely no Firebase connection. */
    var _fbRetryCount = 0;
    var FB_RETRY_MAX  = 8;
    var FB_RETRY_MS   = 1000;

    /* FIX (newly-created business page/product never appears in the feed
       card): this used to fetch business_posts ONCE with a one-shot .get()
       and cache the result forever in window._firestoreBizFeedPosts. Every
       later call — from the feed's MutationObserver, section-change
       events, and the periodic safety interval in _watchFeed() — hit the
       "already cached" short-circuit below and just re-served that stale
       snapshot instead of asking Firestore again. That first fetch runs
       ~1-2s after app init, i.e. before a user could plausibly have
       created a business page and published a product in the same
       session — so anything posted afterward silently never showed up,
       with no error and no reload fixing it either (a reload just repeats
       the same one-shot-then-freeze pattern with fresh timing).

       Fixed by switching to a live onSnapshot listener (mirrors the
       pattern already used elsewhere in this app, e.g. the old dashboard
       business-posts slider): the cache now updates itself the moment a
       new business_posts document is written, and every update re-runs
       _placeCard() so a freshly published product appears within moments
       — no reload required. The listener is started once (guarded by
       _bizFeedListenerActive) and kept alive for the rest of the session. */
    var _bizFeedListenerActive = false;

    function _startBizFeedListener() {
        if (_bizFeedListenerActive) return;
        if (!_fbOk()) return;
        _bizFeedListenerActive = true;
        window.fbDb.collection('business_posts')
            .orderBy('createdAt', 'desc')
            .limit(20)
            .onSnapshot(function (snap) {
                var posts = [];
                snap.forEach(function (doc) {
                    var d = doc.data(); d.id = doc.id;
                    posts.push(d);
                });
                window._firestoreBizFeedPosts = posts;
                _placeCard();
            }, function (err) {
                console.warn('[EmpBizFeedCard] listener error:', err && err.message);
                _bizFeedListenerActive = false; /* allow a later retry */
            });
    }

    function _loadBusinessFeedData(cb) {
        if (!_fbOk()) {
            if (_fbRetryCount < FB_RETRY_MAX) {
                _fbRetryCount++;
                setTimeout(function () { _loadBusinessFeedData(cb); }, FB_RETRY_MS);
            } else {
                cb([]);
            }
            return;
        }
        _startBizFeedListener();
        cb(_collectAllPagesFromCache());
    }


    /* =========================================================================
       COMMENT THREAD — full-screen panel, dedicated to business posts.

       DATA MODEL
       ───────────
       business_posts/{postId}/comments/{commentId}:
         { text, userId, userName, userAvatar, likes, likedBy: [],
           replyTo: null | parentCommentId, createdAt }
       A flat subcollection (not a nested array on the post doc) so replies
       and likes update cheaply and the post document never grows unbounded.
       replyTo is null for a top-level comment, or the parent comment's id
       for a reply — giving exactly one level of nesting per spec.
       ========================================================================= */

    function _commentsCol(postId) {
        return window.fbDb.collection('business_posts').doc(postId).collection('comments');
    }

    function _timeAgo(ts) {
        var ms = ts && ts.toMillis ? ts.toMillis() : (ts || Date.now());
        var diff = Math.max(0, Date.now() - ms);
        var m = Math.floor(diff / 60000);
        if (m < 1) return 'now';
        if (m < 60) return m + 'm';
        var h = Math.floor(m / 60);
        if (h < 24) return h + 'h';
        var d = Math.floor(h / 24);
        if (d < 7) return d + 'd';
        return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }

    function _avatarFor(name, url) {
        return url || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(name || 'U') + '&background=5B0EA6&color=fff&size=80');
    }


    /* =========================================================================
       FOLLOW — lets any signed-in user follow/unfollow a business page.

       DATA MODEL
       ───────────
       business_pages/{pageId}.followers : string[] of follower userIds.
       Stored on the page document itself (not a separate join collection)
       so a follower count/list can be read straight off the page doc with
       no extra query — mirrors how likes/likedBy already work on comments
       elsewhere in this file. set({...}, {merge:true}) is used instead of
       update() so the very first follow on a page that has no Firestore
       document yet (e.g. one only ever referenced via cached
       business_posts) still succeeds instead of throwing "no document to
       update".

       REUSABILITY
       ───────────
       renderBizFollowButton(pageId, container) is exposed on window so any
       other module (e.g. the full business-page header rendered elsewhere
       by app-business.js) can drop a fully-wired Follow button into a
       container without re-implementing the Firestore read/write logic —
       mirrors how renderBizPageFeaturedProducts() is exposed further down
       this file for the same reason.
       ========================================================================= */

    var _followCache = window._empBizFollowCache || (window._empBizFollowCache = {}); /* pageId -> bool */

    function _currentUid() { var us = _us(); return us && us.id; }

    /* Defensive only — these field names aren't guaranteed to exist on
       every user-state shape in this app, so this simply no-ops (shows the
       button) when neither is present rather than guessing wrong. */
    function _isOwnBizPage(pageId) {
        var us = _us();
        return !!(us && (us.businessPageId === pageId || us.bizPageId === pageId));
    }

    function _paintFollowBtn(btn, isFollowing) {
        if (!btn) return;
        btn.classList.toggle('following', !!isFollowing);
        btn.innerHTML = isFollowing
            ? 'Following'
            : '<i class="fas fa-plus" style="font-size:10px;"></i>Follow';
        btn.style.background = isFollowing ? 'rgba(10,14,39,0.06)' : 'linear-gradient(135deg,#1B2B8B,#5B0EA6)';
        btn.style.color      = isFollowing ? '#374151' : '#fff';
        btn.style.boxShadow  = isFollowing ? 'none' : '0 2px 8px rgba(91,14,166,0.25)';
        btn.style.border     = isFollowing ? '1px solid rgba(10,14,39,0.12)' : 'none';
    }

    /* Re-paints every Follow button on screen for this page at once — there
       can be more than one instance live simultaneously (the collapsed feed
       card and the expanded modal can both show the same business), and all
       of them must reflect a toggle immediately. */
    function _syncFollowButtons(pageId, isFollowing) {
        document.querySelectorAll('.biz-feedcard-follow-btn[data-page-id="' + pageId + '"]').forEach(function (btn) {
            _paintFollowBtn(btn, isFollowing);
        });
    }

    function _fetchFollowStatus(pageId, cb) {
        var uid = _currentUid();
        if (!uid || !_fbOk()) { cb(false); return; }
        if (_followCache.hasOwnProperty(pageId)) { cb(_followCache[pageId]); return; }
        window.fbDb.collection('business_pages').doc(pageId).get()
            .then(function (snap) {
                var followers = (snap.exists && snap.data() && snap.data().followers) || [];
                var following = followers.indexOf(uid) > -1;
                _followCache[pageId] = following;
                cb(following);
            })
            .catch(function (err) {
                console.warn('[EmpBizFeedCard] follow-status load error:', err && err.message);
                cb(false);
            });
    }

    function _toggleFollow(pageId, btn) {
        if (_isGuest()) {
            if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
            else _notify('Log in to follow this business.', 'info');
            return;
        }
        var uid = _currentUid();
        if (!uid) return;

        var wasFollowing = !!_followCache[pageId];
        var nowFollowing = !wasFollowing;

        /* Optimistic UI — flip every visible instance immediately, then
           confirm/roll back once Firestore responds. */
        _followCache[pageId] = nowFollowing;
        _syncFollowButtons(pageId, nowFollowing);
        if (btn) btn.disabled = true;

        if (!_fbOk()) { if (btn) btn.disabled = false; return; }
        var fv = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
        window.fbDb.collection('business_pages').doc(pageId).set({
            followers: nowFollowing
                ? (fv ? fv.arrayUnion(uid) : [uid])
                : (fv ? fv.arrayRemove(uid) : [])
        }, { merge: true })
            .then(function () {
                _notify(nowFollowing ? 'Following business' : 'Unfollowed', 'success');
            })
            .catch(function (err) {
                _followCache[pageId] = wasFollowing;
                _syncFollowButtons(pageId, wasFollowing);
                _notify('Could not update follow status: ' + (err.message || 'error'), 'error');
            });

        if (btn) setTimeout(function () { btn.disabled = false; }, 600);
    }

    function _followBtnHTML(pageId) {
        return '<button class="biz-feedcard-follow-btn" data-page-id="' + _attr(pageId) + '" '
            + 'style="flex-shrink:0;display:flex;align-items:center;gap:5px;padding:6px 14px;border-radius:20px;'
            + 'border:none;font-weight:700;font-size:0.74rem;cursor:pointer;background:linear-gradient(135deg,#1B2B8B,#5B0EA6);'
            + 'color:#fff;box-shadow:0 2px 8px rgba(91,14,166,0.25);white-space:nowrap;">'
            + '<i class="fas fa-plus" style="font-size:10px;"></i>Follow</button>';
    }

    /* Renders a fully-wired Follow button into any container. Exposed on
       window so other modules (e.g. the standalone business-page header)
       can reuse the same Firestore-backed logic instead of duplicating it. */
    function renderBizFollowButton(pageId, container) {
        if (!container || !pageId) return;
        if (_isOwnBizPage(pageId)) { container.innerHTML = ''; return; }
        container.innerHTML = _followBtnHTML(pageId);
        var btn = container.querySelector('.biz-feedcard-follow-btn');
        if (!btn) return;
        _fetchFollowStatus(pageId, function (isFollowing) { _paintFollowBtn(btn, isFollowing); });
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            _toggleFollow(pageId, btn);
        });
    }
    window.renderBizFollowButton = renderBizFollowButton;


    function _postComment(postId, text, replyTo, onDone) {
        if (_isGuest()) {
            if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
            else _notify('Log in to comment.', 'info');
            return;
        }
        text = (text || '').trim();
        if (!text) return;
        if (!_fbOk()) { _notify('Not connected — please try again.', 'error'); return; }
        var us = _us();
        var doc = {
            text: text,
            userId: us.id || '',
            userName: us.fullName || us.username || 'User',
            userAvatar: us.profilePhoto || us.avatar || '',
            likes: 0,
            likedBy: [],
            replyTo: replyTo || null,
            createdAt: Date.now()
        };
        _commentsCol(postId).add(doc)
            .then(function (ref) {
                doc.id = ref.id;
                if (typeof onDone === 'function') onDone(doc);
            })
            .catch(function (err) {
                _notify('Could not post comment: ' + (err.message || 'error'), 'error');
            });
    }

    function _toggleCommentLike(postId, comment, btn) {
        if (_isGuest()) {
            if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
            else _notify('Log in to like comments.', 'info');
            return;
        }
        var us = _us();
        var uid = us.id;
        if (!uid) return;
        var likedBy = comment.likedBy || [];
        var isLiked = likedBy.indexOf(uid) > -1;

        /* Optimistic UI */
        var icon = btn.querySelector('i');
        var countEl = btn.querySelector('.vf-bizcmt-like-count');
        var newCount = Math.max(0, (comment.likes || 0) + (isLiked ? -1 : 1));
        comment.likes = newCount;
        if (isLiked) { comment.likedBy = likedBy.filter(function (id) { return id !== uid; }); btn.classList.remove('liked'); if (icon) icon.className = 'far fa-heart'; }
        else { comment.likedBy = likedBy.concat([uid]); btn.classList.add('liked'); if (icon) icon.className = 'fas fa-heart'; }
        if (countEl) countEl.textContent = newCount > 0 ? newCount : '';

        if (!_fbOk() || !comment.id) return;
        var fv = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
        var update = {
            likes: _inc(newCount - (comment.likes - (isLiked ? -1 : 1)) === 0 ? newCount : newCount) /* placeholder, corrected below */
        };
        /* Simpler, explicit write: set the exact resulting values rather than
           relying on increment() math above (kept failure-proof if FieldValue
           isn't available in this Firebase SDK version). */
        _commentsCol(postId).doc(comment.id).update({
            likes: newCount,
            likedBy: isLiked
                ? (fv ? fv.arrayRemove(uid) : comment.likedBy)
                : (fv ? fv.arrayUnion(uid) : comment.likedBy)
        }).catch(function (err) { console.warn('[EmpBizFeedCard] comment like error:', err && err.message); });
    }
    function _inc(n) { return n; } /* tiny helper kept for clarity at the call site above */

    function _buildCommentRow(postId, comment, isReply) {
        var us = _us();
        var likedBy = comment.likedBy || [];
        var isLiked = us.id && likedBy.indexOf(us.id) > -1;

        var row = document.createElement('div');
        row.className = 'vf-bizcmt-row';
        row.dataset.commentId = comment.id || '';
        row.style.cssText = 'display:flex;gap:10px;padding:' + (isReply ? '10px 0 10px 42px' : '14px 18px') + ';align-items:flex-start;';

        row.innerHTML =
            '<img src="' + _attr(_avatarFor(comment.userName, comment.userAvatar)) + '" '
            + 'style="width:' + (isReply ? '30' : '36') + 'px;height:' + (isReply ? '30' : '36') + 'px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
            + '<div style="flex:1;min-width:0;">'
            + '<div style="background:#f3f4f6;border-radius:14px;padding:8px 12px;display:inline-block;max-width:100%;">'
            + '<strong style="font-size:0.8rem;color:#0A0E27;display:block;">' + _esc(comment.userName) + '</strong>'
            + '<span style="font-size:0.85rem;color:#374151;word-break:break-word;">' + _esc(comment.text) + '</span>'
            + '</div>'
            + '<div style="display:flex;align-items:center;gap:14px;margin-top:4px;padding-left:4px;">'
            + '<span style="font-size:0.7rem;color:#9CA3AF;">' + _timeAgo(comment.createdAt) + '</span>'
            + '<button class="vf-bizcmt-like-btn' + (isLiked ? ' liked' : '') + '" style="display:flex;align-items:center;gap:4px;'
            + 'background:none;border:none;cursor:pointer;color:' + (isLiked ? '#e0245e' : '#6B7280') + ';padding:0;">'
            + '<i class="' + (isLiked ? 'fas' : 'far') + ' fa-heart" style="font-size:0.72rem;"></i>'
            + '<span class="vf-bizcmt-like-count" style="font-size:0.7rem;">' + ((comment.likes && comment.likes > 0) ? comment.likes : '') + '</span>'
            + '</button>'
            + (!isReply ? '<button class="vf-bizcmt-reply-btn" style="background:none;border:none;cursor:pointer;'
                + 'color:#6B7280;font-size:0.7rem;font-weight:700;padding:0;">Reply</button>' : '')
            + '</div>'
            + '<div class="vf-bizcmt-replies"></div>'
            + '</div>';

        row.querySelector('.vf-bizcmt-like-btn').addEventListener('click', function () {
            _toggleCommentLike(postId, comment, row.querySelector('.vf-bizcmt-like-btn'));
        });

        var replyBtn = row.querySelector('.vf-bizcmt-reply-btn');
        if (replyBtn) {
            replyBtn.addEventListener('click', function () {
                var panel = row.closest('.vf-bizcmt-panel');
                if (!panel) return;
                var input = panel.querySelector('.vf-bizcmt-input');
                if (input) {
                    input.dataset.replyTo = comment.id || '';
                    input.placeholder = 'Reply to ' + (comment.userName || 'this comment') + '…';
                    input.focus();
                    var cancelTag = panel.querySelector('.vf-bizcmt-replying-tag');
                    if (cancelTag) {
                        cancelTag.style.display = 'flex';
                        cancelTag.querySelector('span').textContent = 'Replying to ' + (comment.userName || 'comment');
                    }
                }
            });
        }

        return row;
    }

    function _openCommentThread(postId) {
        var existing = document.getElementById('biz-comment-thread');
        if (existing) existing.remove();

        var overlay = document.createElement('div');

        /* ── LAYOUT STRATEGY (v3 — absolute positioning, no flex height math)
           Every previous attempt used a flex column whose total height was
           set to some computed viewport value. Flex layout on mobile WebViews
           has proven unreliable: the composer always ends up pushed off the
           bottom of the screen regardless of how the height is computed.

           This version abandons flex entirely for the overlay itself.
           The overlay is position:fixed, inset 0 (fills the screen).
           Inside it, three children are each position:absolute with
           explicit top/bottom pixel coordinates:
             • header  — top:0,   height:HEADER_H px
             • list    — top:HEADER_H, bottom:COMPOSER_H px, overflow-y:scroll
             • composer — bottom:0, height:COMPOSER_H px
           No flexbox height calculation, no vh/dvh units, no JS pixel
           measurement needed. The browser's own layout engine handles the
           rest and the composer is ALWAYS at the bottom of the screen. */

        var HEADER_H   = 54;
        var COMPOSER_H = 66;

        overlay.id = 'biz-comment-thread';
        overlay.className = 'vf-bizcmt-panel';

        /* ROOT FIX: We set the overlay's geometry entirely in JS using
           visualViewport values. visualViewport.height is the *actual*
           visible area — it excludes the browser address bar AND the
           browser nav bar at the bottom. Combined with visualViewport.offsetTop
           we can pin the overlay exactly to the visible screen region.
           This is the only reliable way on Android Chrome to avoid the
           overlay (and its bottom:0 composer) being covered by browser UI. */
        function _vvTop()  { return (window.visualViewport && window.visualViewport.offsetTop)  || 0; }
        function _vvLeft() { return (window.visualViewport && window.visualViewport.offsetLeft) || 0; }
        function _vvH()    { return (window.visualViewport && window.visualViewport.height) || window.innerHeight; }
        function _vvW()    { return (window.visualViewport && window.visualViewport.width)  || window.innerWidth;  }

        function _applyGeometry() {
            overlay.style.top    = _vvTop()  + 'px';
            overlay.style.left   = _vvLeft() + 'px';
            overlay.style.width  = _vvW()    + 'px';
            overlay.style.height = _vvH()    + 'px';
        }
        overlay.style.cssText = 'position:fixed;z-index:99999;background:#fff;overflow:hidden;';
        _applyGeometry();

        overlay.innerHTML =
            '<div id="vf-bizcmt-header" style="position:absolute;top:0;left:0;right:0;height:' + HEADER_H + 'px;'
            + 'display:flex;align-items:center;gap:12px;padding:0 16px;box-sizing:border-box;'
            + 'border-bottom:1px solid rgba(10,14,39,0.08);background:#fff;z-index:2;">'
            + '<button id="vf-bizcmt-close" style="background:none;border:none;cursor:pointer;padding:8px 8px 8px 0;min-width:36px;">'
            + '<i class="fas fa-arrow-left" style="font-size:1.05rem;color:#0A0E27;"></i></button>'
            + '<strong style="font-size:1rem;color:#0A0E27;">Comments</strong>'
            + '</div>'
            + '<div class="vf-bizcmt-list" style="position:absolute;left:0;right:0;'
            + 'top:' + HEADER_H + 'px;bottom:' + COMPOSER_H + 'px;'
            + 'overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px;"></div>'
            + '<div class="vf-bizcmt-replying-tag" style="display:none;position:absolute;left:0;right:0;'
            + 'bottom:' + COMPOSER_H + 'px;'
            + 'align-items:center;justify-content:space-between;'
            + 'padding:6px 16px;background:#f0ebfa;font-size:0.78rem;color:#5B0EA6;font-weight:600;z-index:2;'
            + 'border-top:1px solid rgba(91,14,166,0.12);">'
            + '<span></span>'
            + '<button class="vf-bizcmt-cancel-reply" style="background:none;border:none;cursor:pointer;'
            + 'color:#6B7280;font-size:1rem;padding:0 4px;">&times;</button>'
            + '</div>'
            + '<div class="vf-bizcmt-composer" style="position:absolute;left:0;right:0;bottom:0;'
            + 'height:' + COMPOSER_H + 'px;'
            + 'display:flex;gap:10px;align-items:center;padding:0 14px;box-sizing:border-box;'
            + 'border-top:1px solid rgba(10,14,39,0.10);background:#fff;'
            + 'box-shadow:0 -2px 12px rgba(10,14,39,0.07);z-index:2;">'
            + '<input type="text" class="vf-bizcmt-input" placeholder="Add a comment…" '
            + 'style="flex:1;border:1.5px solid rgba(10,14,39,0.15);border-radius:22px;padding:10px 16px;'
            + 'font-size:0.88rem;outline:none;background:#fafafa;min-width:0;">'
            + '<button class="vf-bizcmt-send" '
            + 'style="background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:#fff;'
            + 'border:none;border-radius:50%;width:40px;height:40px;min-width:40px;flex-shrink:0;cursor:pointer;'
            + 'display:flex;align-items:center;justify-content:center;'
            + 'box-shadow:0 3px 10px rgba(91,14,166,0.35);">'
            + '<i class="fas fa-paper-plane" style="font-size:0.85rem;"></i></button>'
            + '</div>';

        function _onVVChange() { _applyGeometry(); }
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', _onVVChange);
            window.visualViewport.addEventListener('scroll', _onVVChange);
        }
        window.addEventListener('resize', _onVVChange);

        document.body.appendChild(overlay);
        document.body.classList.add('modal-open');

        function _close() {
            overlay.remove();
            document.body.classList.remove('modal-open');
            window.removeEventListener('resize', _onVVChange);
            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', _onVVChange);
                window.visualViewport.removeEventListener('scroll', _onVVChange);
            }
        }
        overlay.querySelector('#vf-bizcmt-close').addEventListener('click', _close);

        var list  = overlay.querySelector('.vf-bizcmt-list');
        var input = overlay.querySelector('.vf-bizcmt-input');
        var replyTag = overlay.querySelector('.vf-bizcmt-replying-tag');

        replyTag.querySelector('.vf-bizcmt-cancel-reply').addEventListener('click', function () {
            input.dataset.replyTo = '';
            input.placeholder = 'Add a comment…';
            replyTag.style.display = 'none';
        });

        function _renderEmpty() {
            list.innerHTML = '<div style="text-align:center;padding:50px 24px;color:#9CA3AF;">'
                + '<i class="far fa-comment-dots" style="font-size:2.2rem;color:rgba(91,14,166,0.2);margin-bottom:10px;display:block;"></i>'
                + '<p style="margin:0;font-size:0.85rem;">No comments yet — be the first to say something.</p></div>';
        }

        function _renderComments(allComments) {
            list.innerHTML = '';
            var topLevel = allComments.filter(function (c) { return !c.replyTo; });
            if (!topLevel.length) { _renderEmpty(); return; }

            var byParent = {};
            allComments.forEach(function (c) {
                if (c.replyTo) {
                    if (!byParent[c.replyTo]) byParent[c.replyTo] = [];
                    byParent[c.replyTo].push(c);
                }
            });

            topLevel.forEach(function (c) {
                var row = _buildCommentRow(postId, c, false);
                list.appendChild(row);
                var repliesWrap = row.querySelector('.vf-bizcmt-replies');
                (byParent[c.id] || []).forEach(function (r) {
                    repliesWrap.appendChild(_buildCommentRow(postId, r, true));
                });
            });
        }

        function _loadAndRender() {
            if (!_fbOk()) { _renderEmpty(); return; }
            /* FIX: drop orderBy('createdAt') — the subcollection may lack
               the required index (or Firestore rules block it) causing a
               failed-precondition error that silently kills the query and
               leaves the list empty with no visible error to the user.
               Sort client-side instead; it's cheap for comment volumes. */
            _commentsCol(postId).get()
                .then(function (snap) {
                    var comments = [];
                    snap.forEach(function (doc) {
                        var d = doc.data(); d.id = doc.id;
                        comments.push(d);
                    });
                    comments.sort(function (a, b) {
                        var ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : (a.createdAt || 0);
                        var tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : (b.createdAt || 0);
                        return ta - tb;
                    });
                    _renderComments(comments);
                })
                .catch(function (err) {
                    console.warn('[EmpBizFeedCard] load comments error:', err && err.message);
                    _renderEmpty();
                });
        }

        function _send() {
            var text = input.value;
            var replyTo = input.dataset.replyTo || null;
            if (!text.trim()) return;
            input.value = '';
            input.dataset.replyTo = '';
            input.placeholder = 'Add a comment…';
            replyTag.style.display = 'none';
            _postComment(postId, text, replyTo, function () { _loadAndRender(); });
        }

        overlay.querySelector('.vf-bizcmt-send').addEventListener('click', _send);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') _send(); });

        list.innerHTML = '<div style="text-align:center;padding:40px;color:#9CA3AF;font-size:0.85rem;">Loading comments…</div>';
        _loadAndRender();
    }


    /* =========================================================================
       NAVIGATION — to the full business page
       ========================================================================= */

    function _visitBusinessPage(pageId) {
        window._activeBizPageId = pageId;
        var pages = window._firestoreBusinessPages || [];
        var biz   = pages.find(function (p) { return p.id === pageId; });
        if (biz) window._activeBizData = biz;
        if (typeof window.navigateTo === 'function') window.navigateTo('business-page');
        setTimeout(function () {
            var renderer = window._appBizRenderer || window.renderBusinessPage;
            if (typeof renderer === 'function') renderer(pageId);
        }, 150);
    }


    /* =========================================================================
       COMMENT BUTTON WIRING — global delegated handler
       ─────────────────────────────────────────────────
       app-fix-final.js §45 only wires up .like-btn and .share-btn globally;
       .comment-btn was left for each card-builder to handle itself, but
       neither this module's _buildCollapsedCard() nor app-business.js's
       _buildBizPostCard() ever attached a listener — so tapping "Comment"
       on any business post (feed card or business-page post) did nothing.
       One delegated handler here covers both surfaces: it walks up to the
       nearest .biz-post-card, reads its data-post-id, and opens the same
       full-screen comment thread panel used everywhere else for business
       posts (build earlier in this file — list, replies, likes, posting). */
    document.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest && e.target.closest('.comment-btn');
        if (!btn) return;
        var card = btn.closest('.biz-post-card');
        if (!card) return; /* not a business post — let other handlers deal with it */
        var postId = card.dataset.postId;
        if (!postId) return;
        e.preventDefault();
        e.stopPropagation();
        _openCommentThread(postId);
    }, true);


    /* =========================================================================
       ACTION BAR — shared markup, matches app-business.js _buildBizPostCard()
       so the existing global like/comment/share handlers (app-fix-final.js
       §45) pick it up with no extra wiring.
       ========================================================================= */

    function _actionBarHTML() {
        return '<div style="display:flex;align-items:center;gap:18px;padding:12px 18px;'
            + 'border-top:1px solid rgba(10,14,39,0.07);">'
            + '<a class="action-btn like-btn" style="display:flex;align-items:center;gap:6px;'
            + 'font-size:0.85rem;color:#6B7280;text-decoration:none;cursor:pointer;font-weight:600;">'
            + '<i class="far fa-heart" style="font-size:16px;"></i>'
            + '<span style="font-size:0.82rem;">Like</span>'
            + '<span class="like-count" style="font-size:11px;"></span></a>'
            + '<a class="action-btn comment-btn" style="display:flex;align-items:center;gap:6px;'
            + 'font-size:0.85rem;color:#6B7280;text-decoration:none;cursor:pointer;font-weight:600;">'
            + '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
            + '<span style="font-size:0.82rem;">Comment</span>'
            + '<span class="comment-count" style="font-size:11px;"></span></a>'
            + '<a class="action-btn share-btn" data-action="share" style="display:flex;align-items:center;gap:6px;'
            + 'font-size:0.85rem;color:#6B7280;text-decoration:none;cursor:pointer;font-weight:600;">'
            + '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>'
            + '<span style="font-size:0.82rem;">Share</span>'
            + '<span class="share-count" style="font-size:11px;"></span></a>'
            + '</div>';
    }


    /* =========================================================================
       CAPTION — the owner's own short write-up for their current product,
       instead of a fixed "Check Out Our Featured Products!" banner. Falls
       back to a generic line only when the owner genuinely posted with no
       caption at all (media-only post), so the card never renders blank.
       ========================================================================= */
    function _buildCaptionHTML(data, big, capId) {
        var text = (data.caption || '').trim();
        var size = big ? '0.92rem' : '0.85rem';
        var body = text ? _esc(text) : 'Check Out Our <strong>Featured Products!</strong>';

        /* The expanded modal (big===true) already scrolls in its own
           container, so its caption keeps rendering in full — untouched.
           Only the collapsed feed card (big===false, called with a capId)
           gets the 6-line clamp + chevron below. */
        if (big || !capId) {
            return '<div style="padding:0 18px 10px;font-size:' + size + ';color:#374151;'
                + 'white-space:pre-wrap;line-height:1.45;">' + body + '</div>';
        }

        /* FEATURE (chevron expand/collapse — community dashboard home
           feed card): collapsed to its first 6 lines via max-height,
           measured against the caption's own computed line-height in
           _wireCaptionToggles() below (not a guessed px value, so this
           stays accurate regardless of font metrics). The toggle button
           itself starts hidden and is only revealed once that same
           function confirms the content actually overflows 6 lines —
           short captions never get a chevron. max-height (not
           -webkit-line-clamp) is used specifically so the expand/collapse
           can transition smoothly instead of cutting instantly. */
        return '<div style="padding:0 18px 4px;">'
            + '<div id="biz-feedcard-caption-' + capId + '" style="font-size:' + size + ';color:#374151;'
            + 'white-space:pre-wrap;line-height:1.45;overflow:hidden;transition:max-height 0.32s ease;">'
            + body + '</div>'
            + '<button type="button" class="biz-feedcard-caption-toggle" data-caption-toggle="' + capId + '" aria-expanded="false"'
            + ' style="display:none;align-items:center;gap:4px;background:none;border:none;padding:5px 0 6px;margin:0;'
            + 'cursor:pointer;color:#1B2B8B;font-weight:700;font-size:0.76rem;font-family:inherit;">'
            + '<span class="biz-caption-toggle-label">Show more</span>'
            + '<i class="fas fa-chevron-down" style="font-size:0.6rem;transition:transform 0.18s;"></i></button>'
            + '</div>';
    }

    /* Wires every caption chevron built above, under `root`. Deferred
       (see _buildCardSet's setTimeout call below) until after the card is
       actually attached to the document — scrollHeight/computed
       line-height both read as 0 on a detached node, so this can't run
       synchronously inside _buildCollapsedCard() itself. Idempotent (each
       toggle wires itself at most once) and a safe no-op when `root`
       contains no caption toggles at all. */
    function _wireCaptionToggles(root) {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll('.biz-feedcard-caption-toggle').forEach(function (toggle) {
            if (toggle._wired) return;
            var capId = toggle.getAttribute('data-caption-toggle');
            var body  = document.getElementById('biz-feedcard-caption-' + capId);
            if (!body) return;
            toggle._wired = true;

            var lineHeight = parseFloat(getComputedStyle(body).lineHeight);
            if (!lineHeight || isNaN(lineHeight)) {
                lineHeight = (parseFloat(getComputedStyle(body).fontSize) || 14) * 1.45;
            }
            var collapsedHeight = Math.round(lineHeight * 6);
            body.style.maxHeight = collapsedHeight + 'px';

            /* Fits within 6 lines already — nothing to expand, leave the
               chevron hidden (mirrors app-business.js's own key-features
               chevron, which is likewise a no-op when there's nothing to
               hide). */
            if (body.scrollHeight <= collapsedHeight + 2) return;

            toggle.style.display = 'flex';
            toggle.addEventListener('click', function (e) {
                e.stopPropagation(); /* don't trigger the card's own click-through to the business page */
                var expanded = toggle.getAttribute('aria-expanded') === 'true';
                expanded = !expanded;
                toggle.setAttribute('aria-expanded', String(expanded));
                body.style.maxHeight = expanded ? body.scrollHeight + 'px' : collapsedHeight + 'px';
                var label = toggle.querySelector('.biz-caption-toggle-label');
                if (label) label.textContent = expanded ? 'Show less' : 'Show more';
                var chevron = toggle.querySelector('i');
                if (chevron) chevron.style.transform = expanded ? 'rotate(180deg)' : 'rotate(0deg)';
            });
        });
    }

    /* =========================================================================
       CONTACT — phone + address for the business behind this advert, so a
       viewer can reach out directly from the feed without visiting the full
       page first. Only renders the lines that actually have data.
       ========================================================================= */
    function _buildContactHTML(data) {
        if (!data.phone && !data.address) return '';
        var html = '<div style="padding:0 18px 12px;display:flex;flex-direction:column;gap:4px;">';
        if (data.phone) {
            html += '<a href="tel:' + _attr(data.phone) + '" style="font-size:0.78rem;color:#1B2B8B;'
                + 'text-decoration:none;font-weight:600;display:flex;align-items:center;gap:6px;">'
                + '<i class="fas fa-phone" style="width:14px;font-size:0.72rem;"></i>' + _esc(data.phone) + '</a>';
        }
        if (data.address) {
            html += '<span style="font-size:0.78rem;color:#6B7280;display:flex;align-items:center;gap:6px;">'
                + '<i class="fas fa-map-marker-alt" style="width:14px;font-size:0.72rem;"></i>' + _esc(data.address) + '</span>';
        }
        html += '</div>';
        return html;
    }


    /* =========================================================================
       EXPANDED MODAL — full-screen product grid
       ========================================================================= */

    /* =========================================================================
       FULL-SCREEN PRODUCT VIEWER (2026-09-28 — "enable clicking of picture to
       expand to full view"). Opens above the expanded modal (which stays open
       underneath). Swipe or use arrows to move between products, pinch or
       double-tap to zoom (drag to pan while zoomed), tap the dark backdrop or
       X to close. Shows the product's name, price and pills as a caption.
       ========================================================================= */
    function _openProductViewer(items, startIdx, hidePrice) {
        var old = document.getElementById('biz-product-viewer');
        if (old) old.remove();
        if (!items || !items.length) return;
        var idx = Math.max(0, Math.min(startIdx || 0, items.length - 1));
        var zoom = 1, tx = 0, ty = 0;

        var ov = document.createElement('div');
        ov.id = 'biz-product-viewer';
        ov.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,0.95);display:flex;flex-direction:column;touch-action:none;';
        ov.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;flex:0 0 auto;color:#fff;'
            + 'padding:calc(12px + env(safe-area-inset-top,0px)) 14px 8px;">'
            + '<span class="bpv-count" style="font-size:0.85rem;font-weight:700;opacity:0.85;"></span>'
            + '<button type="button" class="bpv-close" aria-label="Close" style="width:40px;height:40px;border-radius:50%;'
            + 'background:rgba(255,255,255,0.16);color:#fff;border:none;font-size:1.05rem;cursor:pointer;"><i class="fas fa-times"></i></button></div>'
            + '<div class="bpv-stage" style="position:relative;flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;"></div>'
            + '<div class="bpv-cap" style="flex:0 0 auto;color:#fff;text-align:center;padding:10px 18px calc(16px + env(safe-area-inset-bottom,0px));"></div>';
        document.body.appendChild(ov);

        var stage = ov.querySelector('.bpv-stage');
        var cap = ov.querySelector('.bpv-cap');
        var counter = ov.querySelector('.bpv-count');

        function _apply() {
            var im = stage.querySelector('.bpv-img');
            if (im) im.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + zoom + ')';
        }
        function _navBtn(dir) {
            return '<button type="button" class="bpv-nav" data-dir="' + dir + '" aria-label="' + (dir < 0 ? 'Previous' : 'Next') + '" '
                + 'style="position:absolute;' + (dir < 0 ? 'left' : 'right') + ':8px;top:50%;transform:translateY(-50%);width:42px;height:42px;'
                + 'border-radius:50%;background:rgba(255,255,255,0.16);color:#fff;border:none;font-size:1rem;cursor:pointer;z-index:2;">'
                + '<i class="fas fa-chevron-' + (dir < 0 ? 'left' : 'right') + '"></i></button>';
        }
        function _render() {
            var it = items[idx];
            zoom = 1; tx = 0; ty = 0;
            stage.innerHTML = (it.isVideo
                ? '<video src="' + _attr(it.url) + '" controls autoplay playsinline style="max-width:100%;max-height:100%;"></video>'
                : '<img class="bpv-img" src="' + _attr(it.url) + '" alt="' + _attr(it.name || 'Product') + '" draggable="false" '
                  + 'style="max-width:100%;max-height:100%;object-fit:contain;user-select:none;-webkit-user-drag:none;transition:transform 0.18s ease;">')
                + (items.length > 1 ? _navBtn(-1) + _navBtn(1) : '');
            counter.textContent = items.length > 1 ? (idx + 1) + ' / ' + items.length : '';
            var price = hidePrice ? '' : _fmtPrice(it.price, it.currency);
            cap.innerHTML = (it.name ? '<div style="font-size:1rem;font-weight:800;">' + _esc(it.name) + '</div>' : '')
                + (price ? '<div style="font-size:1.1rem;font-weight:900;color:#C4B5FD;margin-top:2px;">' + _esc(price) + '</div>' : '')
                + (hidePrice ? '' : _itemChipsHTML(it, true));
        }
        function _go(d) {
            if (items.length < 2) return;
            idx = (idx + d + items.length) % items.length;
            _render();
        }
        function _close() {
            document.removeEventListener('keydown', _onKey, true);
            ov.remove();
        }
        function _onKey(e) {
            if (e.key === 'Escape') { e.stopPropagation(); _close(); }
            else if (e.key === 'ArrowRight') _go(1);
            else if (e.key === 'ArrowLeft') _go(-1);
        }
        document.addEventListener('keydown', _onKey, true);

        ov.addEventListener('click', function (e) {
            if (e.target.closest('.bpv-close')) { _close(); return; }
            var nb = e.target.closest('.bpv-nav');
            if (nb) { _go(parseInt(nb.getAttribute('data-dir'), 10) || 1); return; }
            if (e.target === ov || e.target === stage || e.target.classList.contains('bpv-cap')) _close();
        });
        stage.addEventListener('dblclick', function (e) {
            if (!e.target.classList.contains('bpv-img')) return;
            zoom = zoom > 1 ? 1 : 2.5; tx = 0; ty = 0; _apply();
        });

        /* touch: swipe to change, pinch / double-tap to zoom, drag to pan while zoomed */
        var t0 = null, pinch0 = 0, zoom0 = 1, base = { x: 0, y: 0 }, lastTap = 0, moved = false;
        function _dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
        stage.addEventListener('touchstart', function (e) {
            moved = false;
            if (e.touches.length === 2) { pinch0 = _dist(e.touches); zoom0 = zoom; t0 = null; }
            else if (e.touches.length === 1) { t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY }; base = { x: tx, y: ty }; }
        }, { passive: true });
        stage.addEventListener('touchmove', function (e) {
            moved = true;
            if (e.touches.length === 2 && pinch0) {
                zoom = Math.max(1, Math.min(4, zoom0 * (_dist(e.touches) / pinch0)));
                if (zoom === 1) { tx = 0; ty = 0; }
                var im = stage.querySelector('.bpv-img'); if (im) im.style.transition = 'none';
                _apply();
            } else if (e.touches.length === 1 && t0 && zoom > 1) {
                tx = base.x + (e.touches[0].clientX - t0.x);
                ty = base.y + (e.touches[0].clientY - t0.y);
                var im2 = stage.querySelector('.bpv-img'); if (im2) im2.style.transition = 'none';
                _apply();
            }
        }, { passive: true });
        stage.addEventListener('touchend', function (e) {
            var im = stage.querySelector('.bpv-img'); if (im) im.style.transition = 'transform 0.18s ease';
            if (e.touches.length) return;
            pinch0 = 0;
            if (t0 && e.changedTouches.length) {
                var dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
                if (zoom === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) { _go(dx < 0 ? 1 : -1); t0 = null; return; }
                if (!moved || (Math.abs(dx) < 8 && Math.abs(dy) < 8)) {
                    var now = Date.now();
                    if (now - lastTap < 300 && e.target.classList.contains('bpv-img')) {
                        zoom = zoom > 1 ? 1 : 2.5; tx = 0; ty = 0; _apply(); lastTap = 0;
                    } else { lastTap = now; }
                }
            }
            t0 = null;
        }, { passive: true });

        _render();
    }

    function _openExpandedModal(data) {
        var existing = document.getElementById('biz-feedcard-modal');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'biz-feedcard-modal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,14,39,0.6);'
            + 'display:flex;align-items:center;justify-content:center;padding:16px;';

        /* FIX (2026-09-28): raw double quotes inside url("...") closed the double-quoted
           style="..." attribute early (see app-business.js) — single-quote the url(). */
        var coverBg = data.pageCover
            ? "url('" + String(data.pageCover).replace(/'/g, '%27').replace(/"/g, '%22') + "') center/cover no-repeat"
            : 'linear-gradient(135deg,#0A0E27,#1B2B8B)';
        var avatarSrc = data.pageAvatar || (
            'https://ui-avatars.com/api/?name=' + encodeURIComponent(data.pageName) + '&background=1B2B8B&color=fff&size=100'
        );

        var modalHidePrice = _hidePriceForCategory(_resolveBizCategoryId(data.pageId, data));
        var gridHTML = '';
        data.products.slice(0, 12).forEach(function (item) {
            var price = modalHidePrice ? '' : _fmtPrice(item.price, item.currency);
            gridHTML += '<div class="biz-feedcard-product" data-url="' + _attr(item.url) + '" '
                + 'style="border-radius:14px;overflow:hidden;border:1px solid rgba(10,14,39,0.08);background:#fff;cursor:pointer;">'
                + '<div style="height:120px;background:#f3f4f6;overflow:hidden;position:relative;">'
                + '<span style="position:absolute;right:6px;bottom:6px;width:24px;height:24px;border-radius:50%;background:rgba(10,14,39,0.55);'
                + 'color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.65rem;pointer-events:none;"><i class="fas fa-expand"></i></span>'
                + (item.isVideo
                    ? '<video src="' + _attr(item.url) + '" muted preload="auto" style="width:100%;height:100%;object-fit:cover;display:block;"'
                      + ' onerror="this.closest(\'.biz-feedcard-product\').remove()"></video>'
                    : '<img src="' + _attr(item.url) + '" style="width:100%;height:100%;object-fit:cover;display:block;"'
                      + ' onerror="this.closest(\'.biz-feedcard-product\').remove()">')
                + '</div>'
                + '<div style="padding:8px 10px 10px;">'
                + '<div style="font-size:0.8rem;font-weight:700;color:#0A0E27;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
                + (_esc(item.name) || '&nbsp;') + '</div>'
                + (price ? '<div style="font-size:0.78rem;font-weight:800;color:#5B0EA6;margin-top:2px;">' + _esc(price) + '</div>' : '')
                + (modalHidePrice ? '' : _itemChipsHTML(item))
                + '</div></div>';
        });

        overlay.innerHTML =
            '<div style="background:#fff;border-radius:20px;max-width:640px;width:100%;max-height:88vh;'
            + 'overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,0.35);">'
            + '<div style="height:96px;background:' + coverBg + ';position:relative;">'
            + '<button id="biz-feedcard-modal-close" style="position:absolute;top:10px;right:10px;width:32px;height:32px;'
            + 'border-radius:50%;background:rgba(10,14,39,0.5);color:white;border:none;cursor:pointer;'
            + 'display:flex;align-items:center;justify-content:center;font-size:0.95rem;">'
            + '<i class="fas fa-times"></i></button>'
            + '</div>'
            + '<div style="display:flex;align-items:center;gap:12px;padding:14px 18px 10px;margin-top:-26px;">'
            + '<img src="' + _attr(avatarSrc) + '" style="width:52px;height:52px;border-radius:50%;border:3px solid white;'
            + 'object-fit:cover;box-shadow:0 3px 10px rgba(0,0,0,0.2);"'
            + ' onerror="this.src=\'https://ui-avatars.com/api/?name=B&background=1B2B8B&color=fff&size=100\'">'
            + '<div style="margin-top:24px;flex:1;min-width:0;"><strong style="font-size:1.05rem;color:#0A0E27;display:block;">' + _esc(data.pageName) + '</strong>'
            + (data.industry ? '<span style="font-size:0.68rem;font-weight:700;color:#5B0EA6;background:rgba(91,14,166,0.09);padding:2px 8px;border-radius:20px;display:inline-block;margin-top:2px;">' + _esc(data.industry) + '</span>' : '')
            + '<div style="font-size:0.78rem;color:#6B7280;margin-top:2px;">Featured Products</div></div>'
            + '<div class="biz-feedcard-follow-slot" style="margin-top:24px;"></div>'
            + '</div>'
            + _buildCaptionHTML(data, true)
            + '<div style="padding:4px 18px 14px;display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">'
            + gridHTML
            + '</div>'
            + _buildContactHTML(data)
            + '<div style="padding:0 18px 18px;">'
            + '<button id="biz-feedcard-visit-btn-modal" style="width:100%;padding:13px;border-radius:12px;'
            + 'background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:white;border:none;font-weight:700;'
            + 'font-size:0.92rem;cursor:pointer;box-shadow:0 4px 16px rgba(91,14,166,0.3);">Visit Business Page</button>'
            + '</div>'
            + _actionBarHTML()
            + '</div>';

        document.body.appendChild(overlay);
        document.body.classList.add('modal-open');

        renderBizFollowButton(data.pageId, overlay.querySelector('.biz-feedcard-follow-slot'));

        function _close() { overlay.remove(); document.body.classList.remove('modal-open'); }
        overlay.addEventListener('click', function (e) { if (e.target === overlay) _close(); });
        overlay.querySelector('#biz-feedcard-modal-close').addEventListener('click', _close);
        overlay.querySelector('#biz-feedcard-visit-btn-modal').addEventListener('click', function () {
            _close();
            _visitBusinessPage(data.pageId);
        });

        /* UPDATED (2026-09-28): tapping a product now opens it full-screen in the
           viewer above (swipe / arrows / pinch-zoom) instead of only flashing an outline. */
        var _viewItems = data.products.slice(0, 12);
        overlay.querySelectorAll('.biz-feedcard-product').forEach(function (el) {
            el.addEventListener('click', function () {
                var live = [];
                overlay.querySelectorAll('.biz-feedcard-product').forEach(function (t) {
                    var u = t.getAttribute('data-url');
                    for (var i = 0; i < _viewItems.length; i++) { if (_viewItems[i].url === u) { live.push(_viewItems[i]); break; } }
                });
                var at = 0, cur = el.getAttribute('data-url');
                for (var j = 0; j < live.length; j++) { if (live[j].url === cur) { at = j; break; } }
                _openProductViewer(live, at, modalHidePrice);
            });
        });
    }


    /* =========================================================================
       COLLAPSED CARD — lives inside #feed-container
       ========================================================================= */

    /* =========================================================================
       SHARED ROW BUILDER — used by the Business Page's "Featured Products"
       strip (horizontal thumbnail row — unaffected by this section's
       redesign) AND, separately, the collapsed feed card below now uses a
       fixed 2-up grid instead of a scroll strip (see _buildTwoUpGridHTML).
       Kept for the Business Page strip and the expanded-modal grid map.
       ========================================================================= */
    function _buildProductRowHTML(products, limit, hidePrice) {
        var html = '';
        products.slice(0, limit || 10).forEach(function (item) {
            var price = hidePrice ? '' : _fmtPrice(item.price, item.currency);
            html += '<div class="biz-feedcard-product" data-url="' + _attr(item.url) + '" '
                + 'style="flex:0 0 124px;width:124px;scroll-snap-align:start;cursor:pointer;'
                + 'border:1px solid rgba(10,14,39,0.08);border-radius:12px;background:#fff;overflow:hidden;">'
                + '<div style="height:96px;background:#f3f4f6;">'
                + (item.isVideo
                    ? '<video src="' + _attr(item.url) + '" muted preload="auto" style="width:100%;height:100%;object-fit:cover;display:block;"'
                      + ' onerror="this.closest(\'.biz-feedcard-product\').remove()"></video>'
                    : '<img src="' + _attr(item.url) + '" style="width:100%;height:100%;object-fit:cover;display:block;"'
                      + ' onerror="this.closest(\'.biz-feedcard-product\').remove()">')
                + '</div>'
                + '<div style="padding:6px 8px 8px;">'
                + '<div style="font-size:0.74rem;font-weight:700;color:#0A0E27;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
                + (_esc(item.name) || '&nbsp;') + '</div>'
                + (price ? '<div style="font-size:0.74rem;font-weight:800;color:#5B0EA6;margin-top:1px;">' + _esc(price) + '</div>' : '')
                + (hidePrice ? '' : _itemChipsHTML(item))
                + '</div></div>';
        });
        return html;
    }

    /* FIX (single product left a blank grid cell): a fixed 2-column grid
       had nothing to put in the second track whenever a business only had
       one usable product image, leaving an empty gap beside the lone
       photo. Two columns now only kick in once there are actually two
       images to show — a single product spans the full card width
       instead. The "+N more" badge is also now built inline per-tile
       instead of via post-hoc regex string surgery on the assembled HTML,
       which was fragile and easy to silently break with any markup tweak. */
    function _buildTwoUpGridHTML(products, hidePrice) {
        var shown = products.slice(0, 2);
        var remaining = products.length - shown.length;
        var cols = shown.length >= 2 ? '1fr 1fr' : '1fr';
        var html = '<div style="display:grid;grid-template-columns:' + cols + ';gap:10px;padding:0 18px 14px;">';
        shown.forEach(function (item, idx) {
            var price = hidePrice ? '' : _fmtPrice(item.price, item.currency);
            var isLastShown = idx === shown.length - 1;
            /* If this business has more products beyond what's shown, the
               last visible tile carries a "+N more" badge so it's clear
               there's a fuller catalog one tap away, instead of silently
               truncating with no indication. */
            var badge = (isLastShown && remaining > 0)
                ? '<div style="position:absolute;inset:0;background:rgba(10,14,39,0.55);'
                  + 'display:flex;align-items:center;justify-content:center;color:#fff;'
                  + 'font-weight:800;font-size:0.95rem;">+' + remaining + ' more</div>'
                : '';
            html += '<div class="biz-feedcard-product" data-url="' + _attr(item.url) + '" '
                + 'style="position:relative;cursor:pointer;border:1px solid rgba(10,14,39,0.08);border-radius:12px;'
                + 'background:#fff;overflow:hidden;">'
                + '<div style="height:140px;background:#f3f4f6;">'
                + (item.isVideo
                    ? '<video src="' + _attr(item.url) + '" muted preload="auto" style="width:100%;height:100%;object-fit:cover;display:block;"'
                      + ' onerror="this.closest(\'.biz-feedcard-product\').remove()"></video>'
                    : '<img src="' + _attr(item.url) + '" style="width:100%;height:100%;object-fit:cover;display:block;"'
                      + ' onerror="this.closest(\'.biz-feedcard-product\').remove()">')
                + badge
                + '</div>'
                + '<div style="padding:7px 9px 9px;">'
                + '<div style="font-size:0.78rem;font-weight:700;color:#0A0E27;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
                + (_esc(item.name) || '&nbsp;') + '</div>'
                + (price ? '<div style="font-size:0.78rem;font-weight:800;color:#5B0EA6;margin-top:1px;">' + _esc(price) + '</div>' : '')
                + (hidePrice ? '' : _itemChipsHTML(item))
                + '</div></div>';
        });
        html += '</div>';
        return html;
    }

    function _buildCollapsedCard(data) {
        var card   = document.createElement('div');
        var cardId = data.postIds[0] || ('bizfeed-' + data.pageId);
        card.className = 'biz-post-card biz-feedcard'; /* biz-post-card → §45 like/share routing */
        card.dataset.postId     = cardId;
        card.dataset.collection = 'business_posts';
        card.dataset.bizFeedCard = '1';
        card.style.cssText = 'background:#fff;border-radius:16px;overflow:hidden;margin:14px 0;'
            + 'box-shadow:0 2px 14px rgba(10,14,39,0.08);border:1px solid rgba(10,14,39,0.07);';

        var avatarSrc = data.pageAvatar || (
            'https://ui-avatars.com/api/?name=' + encodeURIComponent(data.pageName) + '&background=1B2B8B&color=fff&size=100'
        );

        var hidePrice = _hidePriceForCategory(_resolveBizCategoryId(data.pageId, data));
        var gridHTML  = _buildTwoUpGridHTML(data.products, hidePrice);

        /* Industry / service tag — shown when the page stored one */
        var industryTag = data.industry
            ? '<span style="font-size:0.62rem;font-weight:700;color:#5B0EA6;background:rgba(91,14,166,0.09);'
              + 'padding:2px 8px;border-radius:20px;display:inline-block;margin-left:6px;white-space:nowrap;'
              + 'overflow:hidden;text-overflow:ellipsis;max-width:110px;vertical-align:middle;">'
              + _esc(data.industry) + '</span>'
            : '';

        card.innerHTML =
            '<div style="display:flex;align-items:center;gap:10px;padding:14px 18px 10px;">'
            + '<img src="' + _attr(avatarSrc) + '" style="width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0;"'
            + ' onerror="this.src=\'https://ui-avatars.com/api/?name=B&background=1B2B8B&color=fff&size=100\'">'
            + '<div style="flex:1;min-width:0;">'
            + '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">'
            + '<strong style="font-size:0.92rem;color:#0A0E27;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
            + _esc(data.pageName) + '</strong>'
            + industryTag
            + '</div>'
            + '<div style="font-size:0.7rem;color:#9CA3AF;margin-top:1px;">Business Page</div>'
            + '</div>'
            + '<div class="biz-feedcard-follow-slot" style="flex-shrink:0;"></div>'
            + '<i class="fas fa-ellipsis-h" style="color:#9CA3AF;font-size:0.85rem;flex-shrink:0;"></i>'
            + '</div>'
            + _buildCaptionHTML(data, false, cardId)
            + gridHTML
            + _buildContactHTML(data)
            + '<div style="padding:0 18px 16px;">'
            + '<button class="biz-feedcard-visit-btn" style="width:100%;padding:12px;border-radius:12px;'
            + 'background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:white;border:none;font-weight:700;'
            + 'font-size:0.9rem;cursor:pointer;box-shadow:0 4px 14px rgba(91,14,166,0.28);">Visit Business Page</button>'
            + '</div>'
            + _actionBarHTML();

        renderBizFollowButton(data.pageId, card.querySelector('.biz-feedcard-follow-slot'));

        card.querySelectorAll('.biz-feedcard-product').forEach(function (el) {
            el.addEventListener('click', function () { _openExpandedModal(data); });
        });
        card.querySelector('.biz-feedcard-visit-btn').addEventListener('click', function () {
            _visitBusinessPage(data.pageId);
        });

        return card;
    }


    /* =========================================================================
       BUSINESS PAGE — "Featured Products" strip
       ─────────────────────────────────────────────────────────────────────
       Same horizontally-scrollable thumbnail row as the feed card (via the
       shared _buildProductRowHTML), but scoped to ONE specific business page
       (every product across all of that page's posts) rather than the feed
       card's "most recently active page on the platform" selection. Inserted
       by app-business.js's _renderBizPageFull() right after the page-info
       block and before the post composer / posts list, so the spec's
       "feature in the card should also be inserted in the business page
       field" requirement is satisfied on the page itself, not just the feed.
       ========================================================================= */
    /* NOTE: deliberately does NOT chain .orderBy('createdAt') after
       .where('pageId', '==', bizId) — that exact combination is what's
       throwing the failed-precondition / missing-composite-index error
       already seen on this page's own _loadBizPosts() (Firestore requires
       a composite index for where()+orderBy() on different fields, and one
       hasn't been created for business_posts yet). Sorting client-side
       avoids needing that index for this strip specifically. */
    function _productsForBizId(bizId, cb) {
        if (window._firestoreBizFeedPosts && window._firestoreBizFeedPosts.length) {
            var cached = window._firestoreBizFeedPosts.filter(function (p) { return p.pageId === bizId; });
            if (cached.length) { cb(_flattenProducts(_sortByCreatedDesc(cached))); return; }
        }
        if (!_fbOk()) { cb([]); return; }
        window.fbDb.collection('business_posts')
            .where('pageId', '==', bizId)
            .limit(30)
            .get()
            .then(function (snap) {
                var posts = [];
                snap.forEach(function (doc) { var d = doc.data(); d.id = doc.id; posts.push(d); });
                cb(_flattenProducts(_sortByCreatedDesc(posts)));
            })
            .catch(function (err) {
                console.warn('[EmpBizFeedCard] featured-products load error:', err && err.message);
                cb([]);
            });
    }

    function _sortByCreatedDesc(posts) {
        return posts.slice().sort(function (a, b) {
            var ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : (a.createdAt || 0);
            var tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : (b.createdAt || 0);
            return tb - ta;
        });
    }

    function _flattenProducts(posts) {
        var products = [];
        posts.forEach(function (p) {
            _productsFromPost(p).forEach(function (item) {
                if (item && item.url) products.push(item);
            });
        });
        return products;
    }

    function renderBizPageFeaturedProducts(bizId, container) {
        if (!container) return;
        container.innerHTML = '<div style="padding:14px 18px;color:#9CA3AF;font-size:0.82rem;">'
            + '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Loading products…</div>';
        container.style.display = 'block';

        _productsForBizId(bizId, function (products) {
            if (!products.length) { container.style.display = 'none'; container.innerHTML = ''; return; }

            var stripHidePrice = _hidePriceForCategory(_resolveBizCategoryId(bizId, window._activeBizData));
            var rowHTML = _buildProductRowHTML(products, 20, stripHidePrice);
            container.innerHTML =
                '<div style="display:flex;align-items:center;gap:8px;padding:4px 18px 8px;">'
                + '<i class="fas fa-bag-shopping" style="color:#1B2B8B;font-size:0.85rem;"></i>'
                + '<h3 style="margin:0;font-size:0.95rem;font-weight:800;color:#0A0E27;">Featured Products</h3>'
                + '</div>'
                + '<div style="display:flex;gap:10px;overflow-x:auto;padding:0 18px 16px;scroll-snap-type:x mandatory;'
                + '-webkit-overflow-scrolling:touch;scrollbar-width:none;">'
                + rowHTML
                + '</div>';

            container.querySelectorAll('.biz-feedcard-product').forEach(function (el) {
                el.addEventListener('click', function () {
                    _openExpandedModal({
                        pageId: bizId,
                        pageName: (window._activeBizData && window._activeBizData.name) || 'Business',
                        pageAvatar: (window._activeBizData && (window._activeBizData.profilePhoto || window._activeBizData.logo)) || '',
                        pageCover: (window._activeBizData && (window._activeBizData.coverPhoto || window._activeBizData.coverImage)) || '',
                        products: products
                    });
                });
            });
        });
    }
    window.renderBizPageFeaturedProducts = renderBizPageFeaturedProducts;


    /* =========================================================================
       CARD SET WRAPPER — one swipeable row holding one card per business
       ─────────────────────────────────────────────────────────────────────
       FIX (only one business ever shows): each business card is full-width
       (matches the surrounding feed posts), so stacking several of them
       side-by-side needs the same horizontal scroll-snap pattern used for
       the product thumbnail row inside each card — just one level up, at
       the row-of-cards level. Mirrors the reference mock's intent ("swipe
       to view other business arrays of products") without changing how an
       individual card looks.
       ========================================================================= */
    function _buildCardSet(pages) {
        var wrap = document.createElement('div');
        wrap.className = 'biz-feedcard-set';
        wrap.dataset.bizFeedCardSet = '1';
        wrap.style.cssText = 'display:flex;gap:14px;overflow-x:auto;margin:14px 0;'
            + 'scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;'
            + 'padding-bottom:2px;';

        pages.forEach(function (data) {
            var card = _buildCollapsedCard(data);
            /* Each card already carries margin:14px 0 from _buildCollapsedCard
               for when it's used standalone elsewhere (e.g. nowhere currently,
               but kept for safety) — zero that out here since the wrapper
               supplies the spacing/gap instead, and pin each card to a fixed
               width so multiple cards sit side-by-side with snap points. */
            card.style.margin  = '0';
            card.style.flex    = '0 0 88%';
            card.style.maxWidth = '360px';
            card.style.scrollSnapAlign = 'start';
            wrap.appendChild(card);
        });

        /* Wiring needs the caption elements actually attached to the
           document (scrollHeight/computed line-height both read 0 on a
           detached node) — _placeCard() inserts `wrap` into
           #feed-container synchronously, in the same call stack as this
           function returning, so a 0ms timer scheduled here still fires
           after that insertion has happened. */
        setTimeout(function () { _wireCaptionToggles(wrap); }, 0);

        return wrap;
    }


    /* =========================================================================
       PLACEMENT — keep the card-set mid-feed: Posts → Business cards → More posts
       ========================================================================= */

    /* FIX (card disappears on refresh / small feed): threshold of 3 caused
       the card to be removed whenever the feed momentarily had fewer than 3
       .impact-story posts during an async re-render — it would flash in then
       vanish as the MutationObserver fired and _placeCard ran against a
       half-built DOM. Lowered to 1 so the card stays whenever even a single
       real post is present, which matches actual use on this platform. */
    var MID_FEED_POST_THRESHOLD = 1; /* show the card set once this many real posts exist */

    /* FIX (business card disappearing — confirmed live, console diagnostic
       caught the exact sequence: _placeCard -> _loadBusinessFeedData ->
       current.remove() -> feed2.insertBefore(set, anchor.nextSibling)):
       feed.querySelectorAll('.impact-story') is a DEEP query — it also
       matches .impact-story cards nested inside the "I Support" election
       strip and the quote/meme horizontal strip (both live inside
       #feed-container, each wrapping their own set of .impact-story cards).
       When one of those nested cards got picked as the anchor, its
       .nextSibling is a sibling WITHIN THAT STRIP's wrapper, not a child of
       #feed-container — so feed2.insertBefore(set, anchor.nextSibling)
       throws (DOM requires the reference node to be a direct child of the
       node insertBefore is called on). That throw happens AFTER the
       existing card was already removed (current.remove(), a few lines
       down), so the card vanishes and nothing replaces it. This fires
       whenever anything else mutates #feed-container's children — window.
       rankFeed() in app-live.js reorders the whole feed on load, every 5
       minutes, and after a promotion, which is exactly the kind of
       mutation that retriggers this module's own MutationObserver and
       walks straight into the bug. Restricting the anchor search to
       #feed-container's own DIRECT children — real top-level posts only —
       guarantees anchor (and anchor.nextSibling) always belongs to feed2,
       so insertBefore can never throw here again. */
    function _topLevelPosts(feed) {
        var out = [];
        for (var i = 0; i < feed.children.length; i++) {
            if (feed.children[i].classList && feed.children[i].classList.contains('impact-story')) out.push(feed.children[i]);
        }
        return out;
    }

    /* FIX (business card causes the Quotes & Memes strip to disappear —
       diagnosed by tracing both modules' actual insertion code, not
       guessed): app-feed.js's Quotes & Memes horizontal strip
       (#dash-feed-quotecard-strip, empyreanDashboardQuoteMemeHStrip's
       _ensureStrip()) inserts itself as a direct child of #feed-container
       at EXACTLY the same slot this module targets — "immediately after
       the first top-level .impact-story post" — with neither module aware
       the other exists. Both modules also re-run and self-correct their
       own position on every #feed-container childList mutation, and each
       one's insert/remove IS such a mutation for the other. Whichever one
       currently occupies that slot, the other's next correction cycle
       (`current.previousElementSibling === anchor` failing because the
       first module is now sitting between anchor and `current`) removes
       and rebuilds itself back into that identical slot — shoving
       whichever module was already there to a different position. Because
       the strip is only ever built ONCE (_ensureStrip() no-ops once
       `fc.contains(strip)` is true) while this module's card is torn down
       and rebuilt from scratch on every correction, the churn is one-
       sided: the business card keeps winning the exact slot and the strip
       keeps getting bumped, cycle after cycle, until it lands somewhere
       the person reading the feed doesn't associate with "right after the
       first post" any more — reported as the strip having "disappeared".

       FIX: treat any known mid-feed widget sitting between the anchor post
       and this module's own card as something to place itself AFTER,
       never something to treat as "I'm misplaced, tear down and reclaim
       this slot" over. This makes the two modules stack in whichever
       order they each mounted, instead of perpetually evicting each
       other. */
    function _isKnownMidFeedWidget(el) {
        return !!(el && el.id === 'dash-feed-quotecard-strip');
    }
    /* True if `current` sits somewhere in the run of elements starting
       right after `anchor`, allowing any number of known mid-feed widgets
       (see above) in between — i.e. "correctly placed" no longer means
       "the literal next sibling", just "not displaced past a real post". */
    function _isInAnchorSlot(current, anchor) {
        var node = anchor.nextSibling;
        while (node) {
            if (node === current) return true;
            if (!_isKnownMidFeedWidget(node)) return false;
            node = node.nextSibling;
        }
        return false;
    }

    function _placeCard() {
        var feed = document.getElementById('feed-container');
        if (!feed) return;
        /* FIX (business card missing from the general-public dashboard —
           diagnosed, not guessed: traced the exact early-return that was
           preventing _placeCard() from ever loading data or building the
           card set for a logged-out session):
           this used to bail out completely for any guest session —
           `if (_isGuest()) { ...; return; }` — before ever attempting to
           load business_posts data or build the card. That meant nobody
           browsing the dashboard without an account ever saw a business
           card, regardless of whether real business data existed.

           This was inconsistent with the rest of the module:
             - _loadBusinessFeedData()/_startBizFeedListener() never
               checked guest status before reading business_posts —
               confirming that data is meant to be publicly readable
               (same as every other public feed post).
             - app-business.js's own renderDashboardBusinesses() (the
               dashboard business-pages slider) has no guest gate either.
             - Every genuine login requirement in THIS file is already
               enforced at the ACTION level, independently: _toggleFollow(),
               _postComment(), and _toggleCommentLike() each open the login
               modal for a guest on their own. That already matches this
               file's own header spec ("Follow button... letting any
               signed-in user follow/unfollow") — viewing the card was
               never meant to require an account, only Follow/Comment/Like
               were. The render-level block above duplicated that intent
               at the wrong layer and, unlike the three action-level gates,
               blocked viewing entirely instead of just prompting login.

           Removed so the card set renders for every visitor, guest or
           signed-in; the three action-level gates are untouched and still
           correctly require login for Follow/Comment/Like. */

        var posts = _topLevelPosts(feed);
        if (posts.length < MID_FEED_POST_THRESHOLD) {
            console.log('[EmpBizFeedCard] waiting — only ' + posts.length + ' of ' + MID_FEED_POST_THRESHOLD + ' posts in feed so far');
            return;
        }

        var existingSet = feed.querySelector('.biz-feedcard-set');

        _loadBusinessFeedData(function (pages) {
            if (!pages || !pages.length) {
                console.log('[EmpBizFeedCard] no business data available yet (Firebase not ready, or no business_posts with media/products found)');
                /* FIX: only remove the card if we KNOW there is no data (not
                   during a transient low-post-count moment). If a card already
                   sits in the feed, leave it alone — a reload may produce pages
                   on the next retry cycle. */
                if (existingSet && !window._firestoreBizFeedPosts) existingSet.remove();
                return;
            }

            /* Re-find in case load was async and DOM changed meanwhile */
            var feed2 = document.getElementById('feed-container');
            if (!feed2) return;
            var posts2 = _topLevelPosts(feed2);
            if (posts2.length < MID_FEED_POST_THRESHOLD) return;

            /* FIX (card drifting to top of feed): every placement check
               re-validates the set's actual position — if it isn't sitting
               right after the Nth-from-top real post, it's removed and
               reinserted at the correct spot, instead of trusting a
               one-time insert to hold. This runs on every mutation/
               safety-tick, so the set self-corrects within moments of any
               feed re-render. */
            var anchor = posts2[MID_FEED_POST_THRESHOLD - 1];
            if (!anchor) return;

            var current = feed2.querySelector('.biz-feedcard-set');

            /* If the feed was wiped and partially rebuilt around the set
               (rather than removing it), it can end up as the very first
               element — always wrong regardless of post count, since the
               spec requires real posts before it. Catch this explicitly. */
            var strandedAtTop = current && feed2.firstElementChild === current;

            var pageIds = pages.map(function (p) { return p.pageId; }).join(',');
            var correctlyPlaced = current && !strandedAtTop
                && current.dataset.bizPageIds === pageIds
                && _isInAnchorSlot(current, anchor);

            if (correctlyPlaced) return;

            if (current) current.remove();

            var set = _buildCardSet(pages);
            set.dataset.bizPageIds = pageIds;

            /* Insert after anchor, but AFTER any known mid-feed widget
               (e.g. the Quotes & Memes strip) already sitting there too —
               stacking alongside it instead of displacing it. */
            var insertBeforeNode = anchor.nextSibling;
            while (insertBeforeNode && _isKnownMidFeedWidget(insertBeforeNode)) {
                insertBeforeNode = insertBeforeNode.nextSibling;
            }
            if (insertBeforeNode) {
                feed2.insertBefore(set, insertBeforeNode);
            } else {
                feed2.appendChild(set);
            }
            console.log('[EmpBizFeedCard] placed ' + pages.length + ' business card(s) after post #' + MID_FEED_POST_THRESHOLD + ': ' + pages.map(function (p) { return p.pageName; }).join(', '));
        });
    }

    function _watchFeed() {
        var feed = document.getElementById('feed-container');
        if (!feed || feed._bizFeedCardWatched) return;
        feed._bizFeedCardWatched = true;

        _placeCard();

        var debounced = null;
        new MutationObserver(function (mutations) {
            /* Ignore mutations caused by this module's own card insert/remove */
            var onlyOurs = mutations.every(function (m) {
                return Array.prototype.every.call(m.addedNodes, function (n) {
                    return n.classList && n.classList.contains('biz-feedcard');
                }) && Array.prototype.every.call(m.removedNodes, function (n) {
                    return n.classList && n.classList.contains('biz-feedcard-set');
                });
            });
            if (onlyOurs) return;
            clearTimeout(debounced);
            debounced = setTimeout(_placeCard, 400);
        }).observe(feed, { childList: true });

        /* FIX (card never appears on a static feed): if the feed loads its
           posts once and never mutates again afterward (e.g. a small feed
           that doesn't grow during the session), nothing else would ever
           call _placeCard() again after the very first attempt — so if
           Firebase business data wasn't ready yet at that single attempt,
           the card would never get a second chance even though the
           internal retry loop in _loadBusinessFeedData would eventually
           have the data. This periodic safety net re-checks a few times
           independent of feed mutations, then stops. */
        var safetyTries = 0;
        var safetyInterval = setInterval(function () {
            safetyTries++;
            if (!feed.querySelector('.biz-feedcard-set')) _placeCard();
            if (safetyTries >= 6 || feed.querySelector('.biz-feedcard-set')) clearInterval(safetyInterval);
        }, 2000);
    }

    document.addEventListener('empyrean-init-done', function () { setTimeout(_watchFeed, 700); });
    document.addEventListener('empyrean-section-change', function (ev) {
        if (ev && ev.detail && (ev.detail.section === 'dashboard' || ev.detail.section === 'profile')) {
            setTimeout(_watchFeed, 700);
        }
    });
    ready(function () { setTimeout(_watchFeed, 1400); });

    console.log('[EmpBizFeedCard] ✅ Business Page feed card v1.5 ready — absolute-positioned comment panel (composer always visible), keyboard-aware list scroll, industry tag, client-side sort, Follow button (collapsed card + expanded modal).');

})();