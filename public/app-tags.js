/* =============================================================================
   EMPYREAN INTERNATIONAL — TAG ENGINE
   app-tags.js  |  Step 0.6  |  Refactor Roadmap v1.0
   =============================================================================

   PURPOSE
   ───────
   Complete @mention and #hashtag system, extracted from two IIFEs inside
   app-fixes.js (_initMentionSystem and _initTagEngine).  Covers:

     • @mention autocomplete dropdown on all <textarea> elements
     • Keyboard navigation (↑↓ arrows, Enter, Tab, Escape)
     • @mention click → mini profile popup with "View Profile" action
     • #hashtag click → filter popup (count + "Filter feed" button)
     • Read-more / Show-less for long posts and news items (MutationObserver)
     • In-memory trending tag store + Firestore sync
     • Real-time Firestore trending listener
     • Trending widget injected into the dashboard right column
     • Mention notification dispatch → Firestore notifications collection
     • window._processPostTags() — called by post submit handlers
     • handleYoutubeEmbed() — YouTube URL → iframe embed

   LOAD ORDER
   ──────────
   <script src="firebase-init.js">
   <script src="app-state.js">
   <script src="app-helpers.js">          ← showNotification, formatWhatsAppText
   <script src="app-contracts.js">
   <script src="app-notifications.js">   ← pushNotification
   <script src="app-tags.js">            ← THIS FILE
   ... remaining modules ...

   DEPENDS ON
   ──────────
   • window.fbDb              (firebase-init.js) — Firestore queries
   • window.showNotification  (app-helpers.js)
   • window.formatWhatsAppText(app-helpers.js)
   • window.pushNotification  (app-notifications.js)
   • window.userState / window.EmpState — poster identity for mentions
   • window.mockUsers                    — username→id resolution for popup

   PUBLIC API
   ──────────
   window._mentionUserList         — Array<{username, fullName, avatar}>
   window._trendingTags            — { [tag: string]: number }
   window._trendingTagPosts        — { [tag: string]: Array<{id,thumbUrl,text,posterName,ts}> }
   window._mentionIndexPosts       — { [username: string]: Array<{id,thumbUrl,text,posterName,ts}> }
   window._searchTagOrMention(query) — Promise<{type,key,posts}> — "#tag" or "@user" search
   window._incrementTag(tag, postRef?) — boost a hashtag's trending score,
                                      optionally recording which post used it
   window._notifyMentionedUser(username, postText, posterName)
   window._processPostTags(text, posterName, postId?, thumbUrl?) — call after every post submit
   window._renderTrendingWidget()  — force-refresh the trending tag list UI
   window._renderTrendingFeed(tag?) — force-refresh the combined trending-posts feed, optionally filtered to one tag
   window.handleYoutubeEmbed(text) — returns { html, found }

   SECTION MAP
   ───────────
   §1  Mention user list          — Firestore fetch + in-memory cache
   §2  Autocomplete dropdown      — DOM element, show, hide, position
   §3  Textarea input listener    — @mention detection on keyup/input
   §4  Keyboard navigation        — arrows, Enter, Tab, Escape
   §5  @mention click → popup     — mini profile card
   §6  #hashtag click → popup     — filter panel
   §7  Read-more / Show-less      — long post truncation + MutationObserver
   §8  Tag engine bootstrap       — trending store + Firestore load
   §9  _incrementTag              — score bump + Firestore persist
   §10 Mention notification       — _notifyMentionedUser + mention index + search + _processPostTags
   §11 Trending widget            — render, inject, real-time listener, combined posts feed
   §12 YouTube embed helper
   §13 Document-level event wiring

   ============================================================================= */

(function empyreanTagsModule() {
    'use strict';

    if (window._empyreanTagsLoaded) {
        console.warn('[EmpTags] Already loaded — skipping duplicate.');
        return;
    }
    window._empyreanTagsLoaded = true;


    /* =========================================================================
       §1  MENTION USER LIST
       Fetched once from Firestore on load; refreshed on empyrean-user-ready.
       ========================================================================= */

    window._mentionUserList = window._mentionUserList || [];

    function _loadMentionUserList() {
        if (typeof window.fbDb === 'undefined' || !window.fbDb) return;
        window.fbDb.collection('users')
            .orderBy('username')
            .limit(200)
            .get()
            .then(function(snap) {
                window._mentionUserList = snap.docs
                    .map(function(d) {
                        return {
                            username: d.data().username  || '',
                            fullName: d.data().fullName  || '',
                            avatar:   d.data().avatar    || ''
                        };
                    })
                    .filter(function(u) { return !!u.username; });
            })
            .catch(function() {});
    }
    // Defer to let Firebase initialise
    setTimeout(_loadMentionUserList, 1500);
    document.addEventListener('empyrean-user-ready', function() {
        setTimeout(_loadMentionUserList, 600);
    });

    /* Runtime state for the active autocomplete session */
    window._mentionActiveInput  = null;
    window._mentionTriggerChar  = null;
    window._mentionQuery        = null;


    /* =========================================================================
       §2  AUTOCOMPLETE DROPDOWN
       ========================================================================= */

    /**
     * Lazily create (or retrieve) the singleton dropdown element.
     * @returns {HTMLElement}
     */
    function _getDropdown() {
        var el = document.getElementById('_mention_dropdown');
        if (!el) {
            el = document.createElement('div');
            el.id = '_mention_dropdown';
            el.setAttribute('role', 'listbox');
            el.style.cssText = [
                'position:fixed',
                'z-index:var(--z-critical, 99999)',
                'background:white',
                'border:1.5px solid rgba(27,43,139,0.18)',
                'border-radius:12px',
                'box-shadow:0 8px 32px rgba(10,14,39,0.18)',
                'max-height:220px',
                'overflow-y:auto',
                'display:none',
                'min-width:200px',
                'padding:6px 0'
            ].join(';');
            document.body.appendChild(el);
        }
        return el;
    }

    /**
     * Hide the dropdown and clear active-mention state.
     */
    function _hideDropdown() {
        var d = document.getElementById('_mention_dropdown');
        if (d) d.style.display = 'none';
        window._mentionActiveInput = null;
        window._mentionTriggerChar = null;
        window._mentionQuery       = null;
    }

    /**
     * Render and position the suggestion list.
     *
     * @param {HTMLTextAreaElement} input
     * @param {string} query        — Characters typed after the trigger
     * @param {string} triggerChar  — '@' (hashtag suggestions not yet implemented)
     * @param {{ left: number, bottom: number }} rect
     */
    function _showSuggestions(input, query, triggerChar, rect) {
        var dropdown = _getDropdown();
        var filtered = [];

        if (triggerChar === '@') {
            filtered = window._mentionUserList.filter(function(u) {
                var q = query.toLowerCase();
                return u.username.toLowerCase().startsWith(q)
                    || u.fullName.toLowerCase().includes(q);
            }).slice(0, 8);
        }

        if (!filtered.length) { _hideDropdown(); return; }

        dropdown.innerHTML = filtered.map(function(u) {
            var av = u.avatar
                || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(u.username)
                + '&background=1B2B8B&color=fff&size=40';
            return '<div class="_mention_item" role="option" data-username="' + _attr(u.username) + '"'
                + ' style="display:flex;align-items:center;gap:10px;padding:8px 14px;'
                + 'cursor:pointer;border-radius:8px;transition:background 0.15s;">'
                + '<img src="' + _attr(av) + '" loading="lazy"'
                + ' style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;"'
                + ' onerror="this.src=\'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=40\'">'
                + '<div>'
                + '<div style="font-weight:700;font-size:0.88rem;color:var(--primary);">@' + _esc(u.username) + '</div>'
                + '<div style="font-size:0.76rem;color:var(--text-muted);">' + _esc(u.fullName) + '</div>'
                + '</div></div>';
        }).join('');

        /* Position */
        dropdown.style.left    = rect.left   + 'px';
        dropdown.style.top     = rect.bottom + 'px';
        dropdown.style.display = 'block';

        window._mentionActiveInput = input;
        window._mentionTriggerChar = triggerChar;
        window._mentionQuery       = query;

        /* Item click — insert chosen value into textarea */
        dropdown.querySelectorAll('._mention_item').forEach(function(item) {
            item.addEventListener('mousedown', function(e) {
                e.preventDefault();
                _insertMention(input, triggerChar, item.dataset.username);
            });
        });
    }

    /**
     * Insert the chosen mention or hashtag into the textarea at the caret.
     * @param {HTMLTextAreaElement} input
     * @param {string} trigger — '@' or '#'
     * @param {string} value   — chosen username or tag (without trigger)
     */
    function _insertMention(input, trigger, value) {
        var val      = input.value;
        var pos      = input.selectionStart;
        var before   = val.substring(0, pos);
        var trigIdx  = before.lastIndexOf(trigger);
        var newVal   = val.substring(0, trigIdx) + trigger + value + ' ' + val.substring(pos);
        input.value  = newVal;
        input.selectionStart = input.selectionEnd = trigIdx + value.length + 2;
        input.focus();
        _hideDropdown();
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }


    /* =========================================================================
       §3  TEXTAREA INPUT LISTENER
       ========================================================================= */

    /**
     * Detect @mentions being typed and show the dropdown.
     * Fires on every keystroke inside any <textarea> in the page (capture phase).
     */
    function _onInput(e) {
        var input = e.target;
        if (!input || input.tagName !== 'TEXTAREA') return;

        var val    = input.value;
        var pos    = input.selectionStart;
        var before = val.substring(0, pos);

        /* Match @word at start or after whitespace/newline */
        var atMatch = before.match(/(?:^|[\s\n])@([a-zA-Z0-9_\.]*)$/);
        if (atMatch) {
            var query = atMatch[1];
            var coords  = input.getBoundingClientRect();
            var dropL   = Math.min(coords.left + 16, window.innerWidth - 220);
            var dropB   = coords.bottom + 4;
            /* If not enough room below, flip above */
            if (dropB + 220 > window.innerHeight) dropB = Math.max(coords.top - 224, 4);
            _showSuggestions(input, query, '@', { left: dropL, bottom: dropB });
        } else {
            _hideDropdown();
        }
    }


    /* =========================================================================
       §4  KEYBOARD NAVIGATION
       ========================================================================= */

    /**
     * Arrow-key navigation, Enter/Tab to select, Escape to dismiss.
     * Only active while the dropdown is visible.
     */
    function _onKeyDown(e) {
        var dropdown = document.getElementById('_mention_dropdown');
        if (!dropdown || dropdown.style.display === 'none') return;

        if (e.key === 'Escape') { _hideDropdown(); return; }

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            var items = Array.from(dropdown.querySelectorAll('._mention_item'));
            var cur   = items.findIndex(function(i) { return i.classList.contains('_active'); });
            items.forEach(function(i) { i.classList.remove('_active'); i.style.background = ''; });
            var next = e.key === 'ArrowDown' ? cur + 1 : cur - 1;
            next = Math.max(0, Math.min(next, items.length - 1));
            if (items[next]) {
                items[next].classList.add('_active');
                items[next].style.background = 'rgba(27,43,139,0.07)';
                items[next].scrollIntoView({ block: 'nearest' });
            }
        }

        if (e.key === 'Enter' || e.key === 'Tab') {
            var active = dropdown.querySelector('._mention_item._active')
                      || dropdown.querySelector('._mention_item');
            if (active && window._mentionActiveInput) {
                e.preventDefault();
                _insertMention(
                    window._mentionActiveInput,
                    window._mentionTriggerChar || '@',
                    active.dataset.username
                );
            }
        }
    }


    /* =========================================================================
       §5  @MENTION CLICK → MINI PROFILE POPUP
       ========================================================================= */

    /**
     * Handle clicks on .mention-tag anchors rendered by formatWhatsAppText().
     * Shows a mini profile card positioned near the link with a "View Profile"
     * button that navigates to the user's full profile.
     *
     * @param {MouseEvent} e
     */
    function _handleMentionClick(e) {
        var mentionLink = e.target.closest('.mention-tag');
        if (!mentionLink) return;
        e.preventDefault();

        var uname = mentionLink.dataset.username;
        if (!uname) return;

        /* Remove stale popup */
        var old = document.getElementById('_mention_profile_popup');
        if (old) old.remove();

        /* Resolve user data */
        var _u = null;
        if (window._mentionUserList) {
            _u = window._mentionUserList.find(function(u) { return u.username === uname; });
        }
        if (!_u && window.mockUsers) {
            _u = Object.values(window.mockUsers).find(function(u) { return u.username === uname; });
        }

        var _av  = (_u && (_u.avatar || _u.profilePhoto))
            || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(uname) + '&background=1B2B8B&color=fff&size=60';
        var _fn  = (_u && (_u.fullName || _u.name)) || uname;
        var _bio = (_u && _u.bio) || '';
        var _flw = (_u && _u.followersCount) || 0;

        var popup = document.createElement('div');
        popup.id = '_mention_profile_popup';
        popup.style.cssText =
            'position:fixed;z-index:var(--z-critical, 99999);background:white;'
            + 'border-radius:16px;box-shadow:0 8px 32px rgba(10,14,39,0.2);'
            + 'padding:16px;min-width:240px;max-width:280px;'
            + 'border:1.5px solid rgba(10,14,39,0.08);';
        popup.innerHTML =
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
            + '<img src="' + _attr(_av) + '" loading="lazy"'
            + '  style="width:48px;height:48px;border-radius:50%;object-fit:cover;'
            + '         flex-shrink:0;border:2px solid var(--secondary);"'
            + '  onerror="this.src=\'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=60\'">'
            + '<div>'
            + '<div style="font-weight:700;font-size:0.92rem;color:var(--primary);">' + _esc(_fn) + '</div>'
            + '<div style="font-size:0.78rem;color:var(--text-muted);">@' + _esc(uname) + '</div>'
            + '</div></div>'
            + (_bio ? '<div style="font-size:0.82rem;color:var(--color-neutral-600,#555);margin-bottom:8px;">' + _esc(_bio) + '</div>' : '')
            + '<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px;">' + _flw + ' followers</div>'
            + '<div style="display:flex;gap:8px;">'
            + '<button class="_mention_view_profile" data-uname="' + _attr(uname) + '"'
            + '  style="flex:1;padding:8px;background:var(--primary);color:white;'
            + '         border:none;border-radius:8px;font-size:0.82rem;font-weight:700;cursor:pointer;">'
            + 'View Profile</button>'
            + '<button class="_mention_popup_close"'
            + '  style="padding:8px 12px;background:rgba(10,14,39,0.07);color:var(--primary);'
            + '         border:none;border-radius:8px;font-size:0.82rem;font-weight:700;cursor:pointer;">✕</button>'
            + '</div>';

        /* Position near the link */
        var rect = mentionLink.getBoundingClientRect();
        var top  = rect.bottom + 8;
        var left = Math.min(rect.left, window.innerWidth - 300);
        if (top + 180 > window.innerHeight) top = rect.top - 190;
        popup.style.top  = top  + 'px';
        popup.style.left = left + 'px';
        document.body.appendChild(popup);

        popup.querySelector('._mention_popup_close').addEventListener('click', function() {
            popup.remove();
        });

        popup.querySelector('._mention_view_profile').addEventListener('click', function() {
            popup.remove();
            /* Resolve uid from mockUsers */
            var _uid = null;
            if (window.mockUsers) {
                var found = Object.entries(window.mockUsers)
                    .find(function(kv) { return kv[1].username === uname; });
                if (found) _uid = found[0];
            }
            if (_uid && typeof window.renderUserProfile === 'function') {
                window.renderUserProfile(_uid);
                if (typeof window.navigateTo === 'function') window.navigateTo('profile');
            } else {
                if (typeof window.navigateTo === 'function') window.navigateTo('profile');
                if (typeof window.showNotification === 'function') {
                    window.showNotification('@' + uname, 'info');
                }
            }
        });

        /* Close on outside click */
        setTimeout(function() {
            document.addEventListener('click', function _closePop(ev) {
                if (!popup.contains(ev.target)) {
                    popup.remove();
                    document.removeEventListener('click', _closePop);
                }
            });
        }, 100);
    }


    /* =========================================================================
       §6  #HASHTAG CLICK → FILTER POPUP
       ========================================================================= */

    /**
     * Handle clicks on .hashtag-tag anchors rendered by formatWhatsAppText().
     * Boosts the tag's trending score and shows a popup with a "Filter feed"
     * button that scrolls to and highlights matching posts.
     *
     * @param {MouseEvent} e
     */
    function _handleHashtagClick(e) {
        var hashLink = e.target.closest('.hashtag-tag');
        if (!hashLink) return;
        e.preventDefault();

        var tag = hashLink.dataset.tag;
        if (!tag) return;

        /* Boost trending score */
        if (typeof window._incrementTag === 'function') window._incrementTag(tag);

        /* Remove stale popup */
        var oldHp = document.getElementById('_hashtag_popup');
        if (oldHp) oldHp.remove();

        /* Count matching posts in the current DOM */
        var _matchPosts = Array.from(
            document.querySelectorAll('.impact-story, .news-list-item')
        ).filter(function(el) {
            var txt = (el.querySelector('.story-content, .news-item-content') || {}).textContent || '';
            return txt.toLowerCase().includes('#' + tag.toLowerCase());
        });

        var hp = document.createElement('div');
        hp.id  = '_hashtag_popup';
        hp.style.cssText =
            'position:fixed;z-index:var(--z-critical, 99999);background:white;'
            + 'border-radius:16px;box-shadow:0 8px 32px rgba(10,14,39,0.2);'
            + 'padding:16px;min-width:240px;max-width:300px;'
            + 'border:1.5px solid rgba(10,14,39,0.08);max-height:320px;overflow-y:auto;';

        var rect2 = hashLink.getBoundingClientRect();
        var top2  = rect2.bottom + 8;
        var left2 = Math.min(rect2.left, window.innerWidth - 320);
        if (top2 + 200 > window.innerHeight) top2 = rect2.top - 210;
        hp.style.top  = top2  + 'px';
        hp.style.left = left2 + 'px';

        hp.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
            + '<strong style="font-size:0.95rem;color:var(--primary);">#' + _esc(tag) + '</strong>'
            + '<button id="_ht_close" style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--text-muted);">✕</button>'
            + '</div>'
            + '<div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:10px;">'
            + _matchPosts.length + ' post' + (_matchPosts.length !== 1 ? 's' : '') + ' with this tag'
            + '</div>'
            + '<button id="_ht_filter"'
            + '  style="width:100%;padding:9px;background:var(--accent-color,#F5C518);'
            + '         color:var(--primary);border:none;border-radius:8px;'
            + '         font-size:0.84rem;font-weight:700;cursor:pointer;margin-bottom:4px;">'
            + '<i class="fas fa-filter"></i> Filter feed by #' + _esc(tag) + '</button>';

        document.body.appendChild(hp);

        document.getElementById('_ht_close').addEventListener('click', function() { hp.remove(); });

        document.getElementById('_ht_filter').addEventListener('click', function() {
            hp.remove();
            if (_matchPosts.length > 0) {
                _matchPosts.forEach(function(p, i) {
                    p.style.outline     = i === 0 ? '2px solid var(--accent-color,#F5C518)' : '';
                    p.style.borderRadius = '12px';
                });
                _matchPosts[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(function() {
                    _matchPosts.forEach(function(p) { p.style.outline = ''; });
                }, 3000);
                if (typeof window.showNotification === 'function') {
                    window.showNotification(
                        'Showing ' + _matchPosts.length + ' post(s) tagged #' + tag, 'info'
                    );
                }
            } else {
                if (typeof window.showNotification === 'function') {
                    window.showNotification('No posts found with #' + tag, 'info');
                }
            }
        });

        setTimeout(function() {
            document.addEventListener('click', function _closeHp(ev) {
                if (!hp.contains(ev.target)) {
                    hp.remove();
                    document.removeEventListener('click', _closeHp);
                }
            });
        }, 100);
    }


    /* =========================================================================
       §7  READ-MORE / SHOW-LESS
       ========================================================================= */

    /**
     * Toggle "Read more ▼" / "Show less ▲" on long posts.
     * Works on both feed posts (.story-content) and news items (.news-item-content).
     */
    function _handleReadMore(e) {
        var rmLink = e.target.closest('.post-read-more');
        if (rmLink) {
            e.preventDefault();
            e.stopPropagation();
            var sc = rmLink.closest('.story-content, .news-item-content');
            if (!sc) return;
            var overflow = sc.querySelector('.post-text-overflow');
            var rest     = sc.querySelector('.post-text-rest');
            if (overflow) overflow.style.display = 'none';
            if (rest)     rest.style.display     = 'inline';
            rmLink.style.display = 'none';
            var rl = sc.querySelector('.post-read-less');
            if (rl) rl.style.display = 'inline-block';
            return;
        }

        var rlLink = e.target.closest('.post-read-less');
        if (rlLink) {
            e.preventDefault();
            e.stopPropagation();
            var sc2 = rlLink.closest('.story-content, .news-item-content');
            if (!sc2) return;
            var ov2   = sc2.querySelector('.post-text-overflow');
            var rest2 = sc2.querySelector('.post-text-rest');
            if (ov2)   ov2.style.display   = 'inline';
            if (rest2) rest2.style.display  = 'none';
            rlLink.style.display = 'none';
            var rm2 = sc2.querySelector('.post-read-more');
            if (rm2) rm2.style.display = 'inline-block';
        }
    }

    /**
     * MutationObserver: whenever a .news-list-item is added to the DOM,
     * truncate its body text at 280 visible characters and wrap in
     * read-more / read-less controls.
     */
    var _newsReadMoreObserver = new MutationObserver(function(mutations) {
        mutations.forEach(function(m) {
            m.addedNodes.forEach(function(node) {
                if (!node || node.nodeType !== 1) return;
                var targets = [];
                if (node.classList && node.classList.contains('news-list-item')) targets.push(node);
                if (node.querySelectorAll) {
                    node.querySelectorAll('.news-list-item').forEach(function(n) { targets.push(n); });
                }
                targets.forEach(function(ni) {
                    var p = ni.querySelector('.news-item-content p');
                    if (!p || p.dataset.rmDone) return;
                    p.dataset.rmDone = '1';

                    var full  = p.innerHTML;
                    var plain = p.textContent || '';
                    if (plain.length <= 280) return;

                    /* Walk the HTML, counting visible chars up to 280 */
                    var cutIdx = 0, cnt = 0, inTag = false;
                    for (var ci = 0; ci < full.length && cnt < 280; ci++) {
                        if (full[ci] === '<')  inTag = true;
                        if (!inTag)            cnt++;
                        if (full[ci] === '>')  inTag = false;
                        cutIdx = ci;
                    }

                    var preview = full.substring(0, cutIdx + 1);
                    var rest    = full.substring(cutIdx + 1);
                    p.innerHTML = preview
                        + '<span class="post-text-overflow">…</span>'
                        + '<span class="post-text-rest" style="display:none;">' + rest + '</span>'
                        + '<br>'
                        + '<a href="#" class="post-read-more"'
                        + '  style="font-size:0.82rem;font-weight:700;color:var(--secondary);'
                        + '         text-decoration:none;display:inline-block;margin-top:4px;">Read more ▼</a>'
                        + '<a href="#" class="post-read-less"'
                        + '  style="font-size:0.82rem;font-weight:700;color:var(--secondary);'
                        + '         text-decoration:none;display:none;margin-top:4px;">Show less ▲</a>';
                });
            });
        });
    });
    _newsReadMoreObserver.observe(document.body, { childList: true, subtree: true });


    /* =========================================================================
       §8  TAG ENGINE BOOTSTRAP — TRENDING STORE
       ========================================================================= */

    /** In-memory trending store. key = normalised hashtag, value = score */
    window._trendingTags = window._trendingTags || {};

    /* FEATURE (2026-08-30 — "trending should feature a list of posts
       trending, in the section or a log"): the score store above only
       ever tracked a count, never WHICH posts used a tag, so the
       Trending section could show "#tag — 8 posts" but never the posts
       themselves. This is a parallel cache, keyed the same way, holding
       up to MAX_POSTS_PER_TAG lightweight post references (id/thumbUrl/
       text snippet/poster/timestamp) per tag — populated alongside the
       score everywhere the score itself is populated (_incrementTag,
       _loadTrending, _startTrendingListener), so nothing that already
       reads window._trendingTags[tag] as a plain number needs to
       change. */
    window._trendingTagPosts = window._trendingTagPosts || {};
    var MAX_POSTS_PER_TAG = 6;

    /**
     * Fetch the top-20 trending tags from Firestore once on load.
     * Deferred 1.2 s to allow Firebase to initialise first.
     */
    function _loadTrending() {
        if (!window.fbDb) return;
        window.fbDb.collection('trending_tags')
            .orderBy('score', 'desc')
            .limit(20)
            .get()
            .then(function(snap) {
                snap.forEach(function(doc) {
                    var d = doc.data() || {};
                    window._trendingTags[doc.id] = d.score || 0;
                    window._trendingTagPosts[doc.id] = d.posts || [];
                });
                _renderTrendingWidget();
            })
            .catch(function() {});
    }
    setTimeout(_loadTrending, 1200);


    /* =========================================================================
       §9  _INCREMENT TAG
       ========================================================================= */

    /**
     * Increment a hashtag's trending score by 1 and persist to Firestore.
     * @param {string} tag — Raw tag (without #, may contain uppercase/punctuation)
     * @param {{id:string, thumbUrl:string, text:string, posterName:string, ts:number}} [postRef]
     *        — lightweight reference to the post that used this tag, so the
     *        Trending section can show actual posts, not just a count. Optional
     *        — omitting it (e.g. the old "click a trending row" re-boost path)
     *        just bumps the score exactly as before.
     */
    function _incrementTag(tag, postRef) {
        if (!tag) return;
        var t = tag.toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!t) return;
        window._trendingTags[t] = (window._trendingTags[t] || 0) + 1;

        var postsForTag = window._trendingTagPosts[t] || [];
        if (postRef && postRef.id) {
            /* De-dupe (the same post re-processed shouldn't create a second
               entry), newest first, capped at MAX_POSTS_PER_TAG so neither
               the local cache nor the Firestore doc grows unbounded. */
            postsForTag = postsForTag.filter(function(p) { return p.id !== postRef.id; });
            postsForTag.unshift(postRef);
            postsForTag = postsForTag.slice(0, MAX_POSTS_PER_TAG);
            window._trendingTagPosts[t] = postsForTag;
        }

        try {
            if (window.fbDb) {
                var docData = { tag: t, score: window._trendingTags[t], lastUsed: new Date().toISOString() };
                if (postRef && postRef.id) docData.posts = postsForTag;
                window.fbDb.collection('trending_tags').doc(t).set(docData, { merge: true }).catch(function() {});
            }
        } catch (e) {}

        _renderTrendingWidget();
        _renderTagsWidget();
    }
    window._incrementTag = _incrementTag;


    /* =========================================================================
       §10  MENTION NOTIFICATION + _processPostTags
       ========================================================================= */

    /**
     * Write a mention notification to Firestore for the mentioned user.
     * If the mentioned user is the current user, also shows an immediate
     * in-app push notification.
     *
     * @param {string} mentionedUsername
     * @param {string} postText
     * @param {string} posterName
     * @param {string} [postId] — id of the post the mention appeared in,
     *        stored on the notification so "You've Been Tagged" can link
     *        straight to it (see window.openPostById in app-thread.js).
     * @param {string} [thumbUrl] — first media URL on the post, if any, so
     *        "You've Been Tagged" can render a real thumbnail card instead
     *        of a plain text line.
     */
    function _notifyMentionedUser(mentionedUsername, postText, posterName, postId, thumbUrl) {
        if (!window.fbDb) return;
        var us = (window.EmpState ? window.EmpState.userState : null) || window.userState || {};

        window.fbDb.collection('users')
            .where('username', '==', mentionedUsername)
            .limit(1)
            .get()
            .then(function(snap) {
                if (snap.empty) return;
                var targetDoc = snap.docs[0];
                var notifRef  = window.fbDb.collection('notifications').doc();
                notifRef.set({
                    id:         notifRef.id,
                    type:       'mention',
                    toUserId:   targetDoc.id,
                    fromUserId: us.id      || 'unknown',
                    fromName:   posterName || 'Someone',
                    message:    (posterName || 'Someone') + ' mentioned you in a post',
                    preview:    (postText || '').substring(0, 80),
                    thumb:      thumbUrl || '',
                    postId:     postId || '',
                    read:       false,
                    createdAt:  new Date().toISOString()
                }).catch(function() {});

                /* Immediate push if the target is the current user */
                if (us.id && targetDoc.id === us.id) {
                    if (typeof window.pushNotification === 'function') {
                        window.pushNotification(
                            '📣 You were mentioned by @' + (posterName || 'someone'),
                            'mention'
                        );
                    }
                }
            })
            .catch(function() {});
    }
    window._notifyMentionedUser = _notifyMentionedUser;

    /**
     * FEATURE (2026-08-30 — "Tag and Trending Search"): index which posts
     * mentioned a given username, mirroring _incrementTag's own
     * window._trendingTagPosts cache/Firestore doc for hashtags — same
     * capped-array, newest-first shape, just keyed by lowercased username
     * instead of tag. This is what makes "@Allen" searchable by ANYONE,
     * not just visible to Allen's own notifications (which
     * _notifyMentionedUser above already handles separately).
     */
    window._mentionIndexPosts = window._mentionIndexPosts || {};
    function _indexMentionPost(username, postRef) {
        if (!username || !postRef || !postRef.id) return;
        var key = username.toLowerCase();
        var list = (window._mentionIndexPosts[key] || []).filter(function(p) { return p.id !== postRef.id; });
        list.unshift(postRef);
        list = list.slice(0, MAX_POSTS_PER_TAG);
        window._mentionIndexPosts[key] = list;
        try {
            if (window.fbDb) {
                window.fbDb.collection('mention_index').doc(key).set(
                    { username: key, posts: list, lastUsed: new Date().toISOString() },
                    { merge: true }
                ).catch(function() {});
            }
        } catch (e) {}
    }

    /**
     * FEATURE (2026-08-30 — "Tag and Trending Search"): resolve a typed
     * search query ("#election" or "@Allen", the # /@ prefix optional —
     * defaults to a tag search) to the posts that reference it.
     *
     * Always starts from whatever's already cached locally (instant, no
     * network wait) and — when Firestore is available — follows up with a
     * fresh read of the shared index doc, since another user's post using
     * this tag/mention may not have reached this browser's local cache
     * yet. Returns a Promise so the caller can show the instant local
     * result first and swap in the fresher one when it lands, or just
     * await the final merged list.
     *
     * @param {string} rawQuery — e.g. "#election", "election", "@Allen"
     * @returns {Promise<{type: 'tag'|'mention', key: string, posts: Array}>}
     */
    window._searchTagOrMention = function _searchTagOrMention(rawQuery) {
        var q = String(rawQuery || '').trim();
        var isMention = q.charAt(0) === '@';
        var key = q.replace(/^[#@]/, '').toLowerCase().replace(/[^a-z0-9_.]/g, '');
        if (!key) return Promise.resolve({ type: isMention ? 'mention' : 'tag', key: '', posts: [] });

        var localCache = isMention ? window._mentionIndexPosts : window._trendingTagPosts;
        var localPosts = (localCache[key] || []).slice();

        if (!window.fbDb) return Promise.resolve({ type: isMention ? 'mention' : 'tag', key: key, posts: localPosts });

        var coll = isMention ? 'mention_index' : 'trending_tags';
        return window.fbDb.collection(coll).doc(key).get()
            .then(function(doc) {
                var remotePosts = (doc.exists && doc.data().posts) || [];
                /* Merge local + remote, de-duped by id, newest first — the
                   local cache may be a few ms fresher than what Firestore
                   just returned (this device's own just-submitted post). */
                var seen = {}, merged = [];
                localPosts.concat(remotePosts).forEach(function(p) {
                    if (p.id && !seen[p.id]) { seen[p.id] = true; merged.push(p); }
                });
                merged.sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
                return { type: isMention ? 'mention' : 'tag', key: key, posts: merged };
            })
            .catch(function() {
                return { type: isMention ? 'mention' : 'tag', key: key, posts: localPosts };
            });
    };

    /**
     * Extract all @mentions and #hashtags from a post's text, dispatch
     * mention notifications, and boost trending scores.
     * Call this in every post-submit handler after the text is finalised.
     *
     * @param {string} text       — Raw post text
     * @param {string} posterName — Display name of the posting user
     * @param {string} [postId]   — id of the post being submitted, so
     *        mention notifications can link back to it.
     * @param {string} [thumbUrl] — first media URL on the post, if any, so
     *        mention notifications can carry a real thumbnail.
     */
    window._processPostTags = function _processPostTags(text, posterName, postId, thumbUrl) {
        if (!text) return;

        /* @mentions */
        var mentions = text.match(/(?:^|[\s\n])@([a-zA-Z0-9_\.]+)/g) || [];
        if (mentions.length) {
            var mentionPostRef = postId ? {
                id: postId,
                thumbUrl: thumbUrl || '',
                text: text.length > 90 ? (text.slice(0, 90) + '…') : text,
                posterName: posterName || 'user',
                ts: Date.now()
            } : null;
            mentions.forEach(function(m) {
                var uname = m.trim().replace('@', '');
                if (!uname) return;
                _notifyMentionedUser(uname, text, posterName, postId, thumbUrl);
                if (mentionPostRef) _indexMentionPost(uname, mentionPostRef);
            });
        }

        /* #hashtags */
        var tags = text.match(/(?:^|[\s\n])#([a-zA-Z0-9_]+)/g) || [];
        if (tags.length) {
            /* FEATURE (2026-08-30): built once per post, reused for every
               tag it contains — this is what lets the Trending section
               show the actual posts under each tag instead of just a
               count. Omitted entirely (falls back to the old score-only
               behavior) when this call site doesn't have a postId, so a
               caller that hasn't been updated to pass one never breaks. */
            var postRef = postId ? {
                id: postId,
                thumbUrl: thumbUrl || '',
                text: text.length > 90 ? (text.slice(0, 90) + '…') : text,
                posterName: posterName || 'user',
                ts: Date.now()
            } : null;
            tags.forEach(function(t) {
                var tag = t.trim().replace('#', '');
                if (tag) _incrementTag(tag, postRef);
            });
        }
    };


    /* =========================================================================
       §11  TRENDING WIDGET
       ========================================================================= */

    /**
     * Re-render the content of the trending widget list (#_trending_widget_list).
     * Shows the top-8 hashtags sorted by score, with click-to-filter behaviour.
     *
     * FEATURE (2026-08-30 — "trending should feature a list of posts
     * trending, in the section or a log"): each row now also shows a small
     * strip of up to 3 thumbnails from window._trendingTagPosts[tag] (the
     * tag's most recent posts) — tapping one jumps straight to that post.
     * Tapping the row itself keeps its old "scroll to a matching post
     * already on screen" behavior AND now also filters the combined
     * Trending Posts feed below (_renderTrendingFeed) to just this tag.
     */
    function _renderTrendingWidget() {
        var container = document.getElementById('_trending_widget_list');
        if (!container) return;

        var sorted = Object.entries(window._trendingTags)
            .sort(function(a, b) { return b[1] - a[1]; })
            .slice(0, 8);

        if (!sorted.length) {
            container.innerHTML =
                '<p style="font-size:0.8rem;color:var(--text-muted);padding:8px 0;">No trending tags yet.</p>';
            return;
        }

        container.innerHTML = sorted.map(function(entry, i) {
            var tag = entry[0], score = entry[1];
            var previewPosts = (window._trendingTagPosts[tag] || []).slice(0, 3);
            var strip = previewPosts.length ? (
                '<div class="_trend_item_strip" style="display:flex;gap:6px;margin-top:6px;">'
                + previewPosts.map(function(p) {
                    return '<span class="_trend_feed_thumb _trend_preview_thumb" data-post-id="' + _attr(p.id) + '"'
                        + ' style="width:26px;height:26px;border-radius:8px;overflow:hidden;flex-shrink:0;'
                        + '        background:rgba(27,43,139,0.08);display:flex;align-items:center;justify-content:center;color:var(--primary);">'
                        + (p.thumbUrl
                            ? '<img src="' + _attr(p.thumbUrl) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">'
                            : '<i class="fas fa-list" style="font-size:0.65rem;"></i>')
                        + '</span>';
                }).join('')
                + '</div>'
            ) : '';
            return '<div class="_trend_item" data-tag="' + _attr(tag) + '"'
                + ' style="padding:8px 0;border-bottom:1px solid rgba(10,14,39,0.06);cursor:pointer;">'
                + '<div style="display:flex;align-items:center;justify-content:space-between;">'
                + '<div>'
                + '<span style="font-size:0.72rem;color:var(--text-light,#aaa);">' + (i + 1) + ' · Trending</span><br>'
                + '<strong style="font-size:0.9rem;color:var(--primary);">#' + _esc(tag) + '</strong>'
                + '</div>'
                + '<span style="font-size:0.75rem;color:var(--text-muted);'
                + '             background:rgba(27,43,139,0.08);padding:2px 8px;border-radius:20px;">'
                + score + ' post' + (score !== 1 ? 's' : '') + '</span>'
                + '</div>'
                + strip
                + '</div>';
        }).join('');

        /* Preview-strip thumbnails jump straight to that post — must be
           wired BEFORE the row's own click handler below and must stop
           propagation, or a thumbnail tap would also trigger the row's
           "filter by tag" behavior underneath it. */
        container.querySelectorAll('._trend_preview_thumb').forEach(function(el) {
            el.addEventListener('click', function(ev) {
                ev.stopPropagation();
                if (typeof window.openPostById === 'function') window.openPostById(el.dataset.postId);
            });
        });

        /* Click a trending tag → find and scroll to matching posts, and
           now also filter the combined Trending Posts feed to this tag. */
        container.querySelectorAll('._trend_item').forEach(function(el) {
            el.addEventListener('click', function() {
                var t = el.dataset.tag;
                _incrementTag(t);
                _renderTrendingFeed(t);

                /* Simulate .hashtag-tag click if one exists in the DOM */
                var found = false;
                document.querySelectorAll('.hashtag-tag').forEach(function(ht) {
                    if (!found && ht.dataset.tag && ht.dataset.tag.toLowerCase() === t) {
                        ht.click();
                        found = true;
                    }
                });

                /* Scroll to first matching post */
                var matched = Array.from(
                    document.querySelectorAll('.story-content, .news-item-content')
                ).filter(function(c) {
                    return c.textContent.toLowerCase().includes('#' + t);
                });

                if (matched.length > 0) {
                    var anchor = matched[0].closest('.impact-story, .news-list-item, article')
                        || matched[0];
                    anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    if (typeof window.showNotification === 'function') {
                        window.showNotification('#' + t + ' — ' + matched.length + ' matching post(s)', 'info');
                    }
                } else {
                    if (typeof window.showNotification === 'function') {
                        window.showNotification('#' + t + ' — No posts found yet', 'info');
                    }
                }
            });
        });
    }
    window._renderTrendingWidget = _renderTrendingWidget;

    /**
     * Render the combined "Trending Posts" feed (#trending-feed-list) —
     * the actual post previews behind the tag list above, not just counts.
     *
     * FEATURE (2026-08-30 — "trending should feature a list of posts
     * trending, in the section or a log"): with no filterTag, merges the
     * top posts across every currently-trending tag (deduped by post id,
     * newest first) into one combined log. Passing a filterTag (a tag row
     * above was tapped) narrows it to just that tag's posts and shows a
     * "clear filter" pill to get back to the combined view.
     *
     * @param {string} [filterTag] — normalised tag (no '#'), or falsy for
     *        the combined/unfiltered feed.
     */
    var _trendingFeedFilter = null;
    function _renderTrendingFeed(filterTag) {
        var container = document.getElementById('trending-feed-list');
        if (!container) return;
        _trendingFeedFilter = filterTag || null;

        var posts;
        if (filterTag) {
            posts = (window._trendingTagPosts[filterTag] || []).slice();
        } else {
            /* Merge across the top trending tags, dedupe by post id, newest
               first — this is the "one combined feed" view. */
            var topTags = Object.entries(window._trendingTags)
                .sort(function(a, b) { return b[1] - a[1]; })
                .slice(0, 8)
                .map(function(e) { return e[0]; });
            var seen = {};
            posts = [];
            topTags.forEach(function(tg) {
                (window._trendingTagPosts[tg] || []).forEach(function(p) {
                    if (p.id && !seen[p.id]) { seen[p.id] = true; posts.push(p); }
                });
            });
            posts.sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
        }

        var headHtml = filterTag
            ? ('<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
                + '<strong style="font-size:0.85rem;color:var(--primary);">Trending Posts — #' + _esc(filterTag) + '</strong>'
                + '<button type="button" id="_trend_feed_clear" style="background:none;border:none;color:var(--text-muted);font-size:0.78rem;cursor:pointer;padding:4px 8px;">Show all ✕</button>'
                + '</div>')
            : '<strong style="font-size:0.85rem;color:var(--primary);display:block;margin-bottom:8px;">Trending Posts</strong>';

        if (!posts.length) {
            container.innerHTML = headHtml
                + '<p style="font-size:0.8rem;color:var(--text-muted);padding:8px 0;">No trending posts yet.</p>';
        } else {
            container.innerHTML = headHtml + posts.slice(0, 20).map(function(p) {
                return '<div class="_trend_feed_item" data-post-id="' + _attr(p.id) + '"'
                    + ' style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;'
                    + '        border-bottom:1px solid rgba(10,14,39,0.06);cursor:pointer;">'
                    + '<span class="_trend_feed_thumb" style="width:44px;height:44px;border-radius:10px;flex-shrink:0;overflow:hidden;'
                    + '      background:rgba(27,43,139,0.08);display:flex;align-items:center;justify-content:center;color:var(--primary);">'
                    + (p.thumbUrl
                        ? '<img src="' + _attr(p.thumbUrl) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">'
                        : '<i class="fas fa-list"></i>')
                    + '</span>'
                    + '<div style="min-width:0;flex:1;">'
                    + '<div style="font-size:0.82rem;font-weight:700;color:var(--primary);">' + _esc(p.posterName || 'user') + '</div>'
                    + '<div style="font-size:0.82rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">' + _esc(p.text || '') + '</div>'
                    + '</div>'
                    + '</div>';
            }).join('');
        }

        container.querySelectorAll('._trend_feed_item').forEach(function(el) {
            el.addEventListener('click', function() {
                if (typeof window.openPostById === 'function') window.openPostById(el.dataset.postId);
            });
        });
        var clearBtn = document.getElementById('_trend_feed_clear');
        if (clearBtn) clearBtn.addEventListener('click', function() { _renderTrendingFeed(null); });
    }
    window._renderTrendingFeed = _renderTrendingFeed;

    /**
     * Create and inject the trending widget into its own dedicated
     * #trending section (index.html), reached via the sidebar/mobile
     * bottom nav's 'trending' entry (app-nav.js).
     * Idempotent — skips if already present.
     *
     * CHANGE (2026-08-30 — "Move Tags and Trending Activities from the
     * general public home page into the horizontal scrollable navigation
     * bar"): this used to insert its own floating widget card into the
     * right sidebar, or — since this app has no #right-sidebar/.sidebar-right
     * element at all — fell all the way through to appending onto #dashboard
     * itself, which is exactly the "general public home page" placement
     * this was asked to move OFF of. Now targets #trending-widget-page-list,
     * a plain container that already sits inside its own .card in the new
     * #trending content-section, so nothing here needs to build its own
     * card chrome (background/shadow/border) any more — index.html's
     * section markup already provides it.
     */
    function _injectTrendingWidget() {
        var host = document.getElementById('trending-widget-page-list');
        if (!host || document.getElementById('_trending_widget_list')) return;
        host.innerHTML = '<div id="_trending_widget_list"></div>';
        _renderTrendingWidget();
        /* FEATURE (2026-08-30): combined trending-posts feed, unfiltered
           by default — lives in its own #trending-feed-list container
           (index.html), a separate card below the tag list so the two
           don't visually collide. */
        _renderTrendingFeed(_trendingFeedFilter);
    }
    setTimeout(_injectTrendingWidget, 800);

    /**
     * Create and inject the full tags list into its own dedicated #tags
     * section (index.html), reached via the sidebar/mobile bottom nav's
     * 'tags' entry (app-nav.js). Same data source as Trending
     * (window._trendingTags) but lists every known tag, not just the
     * top 8 — Trending is "what's hot right now"; Tags is "browse
     * everything". Idempotent — skips if already present.
     */
    function _renderTagsWidget() {
        var container = document.getElementById('_tags_widget_list');
        if (!container) return;

        var sorted = Object.entries(window._trendingTags)
            .sort(function(a, b) { return b[1] - a[1]; });

        if (!sorted.length) {
            container.innerHTML =
                '<p style="font-size:0.8rem;color:var(--text-muted);padding:8px 0;">No tags yet.</p>';
            return;
        }

        container.innerHTML = sorted.map(function(entry) {
            var tag = entry[0], score = entry[1];
            return '<div class="_trend_item" data-tag="' + _attr(tag) + '"'
                + ' style="display:flex;align-items:center;justify-content:space-between;'
                + '        padding:8px 0;border-bottom:1px solid rgba(10,14,39,0.06);cursor:pointer;">'
                + '<strong style="font-size:0.9rem;color:var(--primary);">#' + _esc(tag) + '</strong>'
                + '<span style="font-size:0.75rem;color:var(--text-muted);'
                + '             background:rgba(27,43,139,0.08);padding:2px 8px;border-radius:20px;">'
                + score + ' post' + (score !== 1 ? 's' : '') + '</span>'
                + '</div>';
        }).join('');

        /* Same "jump to matching posts" behaviour as the Trending widget. */
        container.querySelectorAll('._trend_item').forEach(function(el) {
            el.addEventListener('click', function() {
                var t = el.dataset.tag;
                var found = false;
                document.querySelectorAll('.hashtag-tag').forEach(function(ht) {
                    if (!found && ht.dataset.tag && ht.dataset.tag.toLowerCase() === t) {
                        ht.click();
                        found = true;
                    }
                });
                var matched = Array.from(
                    document.querySelectorAll('.story-content, .news-item-content')
                ).filter(function(c) {
                    return c.textContent.toLowerCase().includes('#' + t);
                });
                if (matched.length > 0) {
                    var anchor = matched[0].closest('.impact-story, .news-list-item, article') || matched[0];
                    if (typeof window.navigateTo === 'function') window.navigateTo('dashboard');
                    setTimeout(function() {
                        anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 250);
                    if (typeof window.showNotification === 'function') {
                        window.showNotification('#' + t + ' — ' + matched.length + ' matching post(s)', 'info');
                    }
                } else if (typeof window.showNotification === 'function') {
                    window.showNotification('#' + t + ' — No posts found yet', 'info');
                }
            });
        });
    }
    window._renderTagsWidget = _renderTagsWidget;

    function _injectTagsWidget() {
        var host = document.getElementById('tags-widget-page-list');
        if (!host || document.getElementById('_tags_widget_list')) return;
        host.innerHTML = '<div id="_tags_widget_list"></div>';
        _renderTagsWidget();
    }
    setTimeout(_injectTagsWidget, 800);

    /* Re-inject/re-render on section navigation.
       FIX (2026-08-30): this used to listen for 'empyrean:sectionchange'
       (colon), which no file in this codebase ever actually dispatches —
       app-nav.js's navigateTo() fires 'empyrean-section-change' (hyphen).
       That mismatch meant this listener has never once fired; harmless
       when the widget just floated on the dashboard (already-rendered
       and never removed), but now that Trending/Tags live in their own
       sections built once and rendered on demand, arriving at either
       section needs to actually trigger the render. Corrected to the
       real event name and now also directly (re)renders whichever of
       the two sections was just navigated to. */
    document.addEventListener('empyrean-section-change', function(e) {
        var section = e && e.detail && e.detail.section;
        if (section === 'trending') { _injectTrendingWidget(); _renderTrendingWidget(); _renderTrendingFeed(_trendingFeedFilter); }
        if (section === 'tags')     { _injectTagsWidget();     _renderTagsWidget(); }
    });

    /**
     * Attach a real-time Firestore onSnapshot listener for the trending tags
     * collection.  Only started once (guarded by window._trendingListener).
     */
    function _startTrendingListener() {
        if (!window.fbDb || window._trendingListener) return;
        window._trendingListener = window.fbDb
            .collection('trending_tags')
            .orderBy('score', 'desc')
            .limit(20)
            .onSnapshot(
                function(snap) {
                    snap.forEach(function(doc) {
                        var d = doc.data() || {};
                        window._trendingTags[doc.id] = d.score || 0;
                        window._trendingTagPosts[doc.id] = d.posts || [];
                    });
                    _renderTrendingWidget();
                    _renderTagsWidget();
                },
                function(err) { console.warn('[Trending] listener error:', err); }
            );
    }
    setTimeout(_startTrendingListener, 2000);


    /* =========================================================================
       §12  YOUTUBE EMBED HELPER
       ========================================================================= */

    /**
     * Detect a YouTube URL in post text and return an iframe embed HTML string.
     * If no YouTube URL is found, falls back to formatWhatsAppText().
     *
     * @param {string} text — Raw post text
     * @returns {{ html: string, found: boolean }}
     */
    function handleYoutubeEmbed(text) {
        var ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        var match   = text.match(ytRegex);
        if (match && match[1]) {
            var videoId  = match[1];
            var embedHtml =
                '<div class="story-youtube-embed">'
                + '<iframe src="https://www.youtube.com/embed/' + videoId + '"'
                + ' frameborder="0"'
                + ' allow="accelerometer; autoplay; clipboard-write; encrypted-media;'
                + '        gyroscope; picture-in-picture"'
                + ' allowfullscreen loading="lazy"></iframe>'
                + '</div>';
            return { html: text.replace(ytRegex, embedHtml), found: true };
        }
        return {
            html: '<p>' + (typeof window.formatWhatsAppText === 'function'
                ? window.formatWhatsAppText(text)
                : text) + '</p>',
            found: false
        };
    }
    window.handleYoutubeEmbed = handleYoutubeEmbed;


    /* =========================================================================
       §13  DOCUMENT-LEVEL EVENT WIRING
       All capture-phase to ensure we fire before bubble-phase handlers.
       ========================================================================= */

    /* @mention autocomplete input detection */
    document.addEventListener('input', _onInput, true);

    /* Keyboard navigation for dropdown */
    document.addEventListener('keydown', _onKeyDown, true);

    /* Close dropdown on outside click */
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#_mention_dropdown') && !e.target.matches('textarea')) {
            _hideDropdown();
        }
    }, true);

    /* @mention tag click → mini profile popup */
    document.addEventListener('click', _handleMentionClick);

    /* #hashtag tag click → filter popup */
    document.addEventListener('click', _handleHashtagClick);

    /* Read-more / Show-less toggle */
    document.addEventListener('click', _handleReadMore);


    /* =========================================================================
       PRIVATE UTILITIES
       ========================================================================= */

    /** Safe HTML attribute value encoder */
    function _attr(str) { return String(str || '').replace(/"/g, '&quot;'); }

    /** Safe HTML text content encoder */
    function _esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }


    console.log('[EmpTags] ✅ @mention, #hashtag, trending & read-more systems ready.');

})();