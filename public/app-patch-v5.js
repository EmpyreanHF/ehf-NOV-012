/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v5
   app-patch-v5.js  |  Load AFTER app-patch-v4.js

   FIXES
   ─────
   [1] VIDEO SECTION — all buttons dead after entering video section
       Root cause A: _shieldThread() and _unshieldThread() are defined in
       app-thread.js but NEVER called from openThread() / _close(). This
       means #vfs-overlay (z-index 11000) and #vfs-tapzone sit above #vf-thread
       (z-index 2147483640 inline but the CSS isolation:isolate limits it)
       and intercept all taps on Like / Repost / Quote / Share / Reply.

       Root cause B: When coming from the VFS overlay, _pauseForThread() sets
       ov.style.pointerEvents = 'none' but _resumeFromThread() is never called
       on thread close because _unshieldThread() (which fires the vfs:threadClosed
       event) is never called.

       Fix: Patch openThread to call _shieldThread and _pauseForThread on open,
       and patch _close to call _unshieldThread and _vfsResumeFromThread on close.
       Done via post-load monkey-patch so zero risk to other modules.

   [2] TWEETS DON'T REFLECT IN GENERAL FEED after posting from thread
       Root cause: _prependToFeed only inserts into #feed-container or
       #posts-feed. If the user is in the VFS/video section when they post,
       those containers exist but are hidden. The issue is a timing/visibility
       problem — the card IS inserted but the user doesn't see it because the
       VFS overlay is still on top and the feed hasn't re-rendered. Also, the
       new reply/tweet (sent via the _sendReply path inside the thread) never
       creates a top-level post at all — it only adds a comment sub-document.
       We fix this by:
         (a) Ensuring _prependToFeed always inserts into the visible dashboard
             feed even when VFS is open.
         (b) Forcing a feed refresh signal after every new post/repost/quote.

   [3] QUOTE PREVIEW IMAGE TOO LARGE
       Reduce max-height of the quote preview image inside the quote modal and
       the embed image inside feed quote cards.

   ADD TO index.html (after app-patch-v4.js):
       <script src="app-patch-v5.js"></script>
   ============================================================================= */

(function empyreanPatchV5() {
    'use strict';

    /* FIX (2026-07-21 — echo/frozen-tap follow-up audit): this file had no
       guard against running twice on the same page load (the same re-
       execution behavior documented in app-patch-v35.js's header, and the
       same mechanism fixed at the source in app-live.js/app-fix-final.js
       this session). A second execution would re-register this file's
       document-level click listener(s) on top of the first copy. Guarding
       here matches the convention already used by app-patch-v30.js onward. */
    if (window._empPatchV5Loaded) {
        console.warn('[V5] Already loaded — skipping duplicate execution (prevents duplicate click listeners).');
        return;
    }
    window._empPatchV5Loaded = true;

    /* ── helpers ── */
    function _ready(fn) {
        if (document.readyState !== 'loading') fn();
        else document.addEventListener('DOMContentLoaded', fn);
    }
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    }


    /* =========================================================================
       FIX 3 — QUOTE IMAGE SIZE (inject CSS overrides immediately)
       ========================================================================= */
    (function fixQuoteImageSize() {
        var s = document.createElement('style');
        s.id = '_pv5_quote_img_fix';
        s.textContent = [
            /* Quote modal preview image — reduce from 160px to 80px */
            '#vf-th-quote-preview .vf-qt-prev-img {',
            '    max-height: 80px !important;',
            '    width: auto !important;',
            '    max-width: 100% !important;',
            '    border-radius: 8px !important;',
            '    object-fit: cover !important;',
            '}',
            /* Embed image inside feed quote cards — reduce from 200px to 100px */
            '.vf-quote-embed-img {',
            '    max-height: 100px !important;',
            '    width: auto !important;',
            '    max-width: 100% !important;',
            '    border-radius: 8px !important;',
            '    object-fit: cover !important;',
            '}',
            /* Preview container — limit overall height so it stays compact */
            '#vf-th-quote-preview {',
            '    max-height: 220px !important;',
            '    overflow: hidden !important;',
            '}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    })();


    /* =========================================================================
       FIX 1 — SUPERSEDED: _shieldThread/_unshieldThread are now called directly
       inside openThread() and _close() in app-thread.js. The shield approach
       (pointer-events:none) has been removed entirely — #vf-thread wins via
       z-index:2147483647 alone. This block is kept as a no-op for safety.
       ========================================================================= */
    (function fixThreadShield() {
        // No-op — fixed at source in app-thread.js
        return;

        /* Wait until app-thread.js has registered its exports */
        function _install() {
            var origOpen  = window._vfOpenThread;
            var origClose = window._vfCloseThread;

            /* If neither is available yet, retry */
            if (typeof origOpen !== 'function' && typeof origClose !== 'function') return false;

            /* ── Patch open ── */
            if (origOpen && !origOpen._pv5Shielded) {
                window._vfOpenThread = function (postEl) {
                    /* 1. Pause VFS overlay (removes pointer interception) */
                    if (typeof window._vfsPauseForThread === 'function') {
                        window._vfsPauseForThread();
                    } else {
                        /* Manual fallback: kill vfs-overlay pointer-events */
                        var vfsOv = document.getElementById('vfs-overlay');
                        if (vfsOv) {
                            vfsOv.style.setProperty('pointer-events', 'none', 'important');
                            vfsOv.classList.add('vfs-thread-open');
                        }
                        var tapzone = document.getElementById('vfs-tapzone');
                        if (tapzone) tapzone.style.setProperty('pointer-events', 'none', 'important');
                    }

                    /* 2. Shield any other high-z overlays */
                    _shieldHighZOverlays();

                    /* 3. Call original open */
                    origOpen.call(this, postEl);
                };
                window._vfOpenThread._pv5Shielded = true;
                window._vfOpenThread._origOpen = origOpen;
            }

            /* ── Patch close ── */
            if (origClose && !origClose._pv5Shielded) {
                window._vfCloseThread = function () {
                    /* Call original close first */
                    origClose.call(this);

                    /* Resume VFS overlay */
                    if (typeof window._vfsResumeFromThread === 'function') {
                        window._vfsResumeFromThread();
                    } else {
                        var vfsOv = document.getElementById('vfs-overlay');
                        if (vfsOv) {
                            vfsOv.style.removeProperty('pointer-events');
                            vfsOv.classList.remove('vfs-thread-open');
                        }
                        var tapzone = document.getElementById('vfs-tapzone');
                        if (tapzone) tapzone.style.removeProperty('pointer-events');
                    }

                    /* Unshield other overlays */
                    _unshieldHighZOverlays();

                    /* Fire the event so VFS listens */
                    try { document.dispatchEvent(new CustomEvent('vfs:threadClosed')); } catch(ex) {}
                };
                window._vfCloseThread._pv5Shielded = true;
                window._vfCloseThread._origClose = origClose;
            }

            return true;
        }

        /* Shielded elements store */
        var _shielded = [];

        function _shieldHighZOverlays() {
            _shielded = [];
            var thread = document.getElementById('vf-thread');

            /* Target only elements that could sit above #vf-thread */
            var selectors = [
                '#vfs-overlay', '#vfs-tapzone', '#vfs-topbar', '#vfs-infobar',
                '#vfs-actions', '#content-overlay', '.modal-overlay',
                '#post-thread-page', '#thread-page', '#emp-thread-page', '#thread-overlay'
            ];

            selectors.forEach(function (sel) {
                var el = document.querySelector(sel);
                if (!el || el === thread || (thread && thread.contains(el))) return;
                var st = window.getComputedStyle(el);
                if (st.display === 'none') return;
                _shielded.push({ el: el, pe: el.style.pointerEvents });
                el.style.setProperty('pointer-events', 'none', 'important');
            });

            /* Raise #vf-thread above everything — belt + suspenders */
            if (thread) {
                thread.style.setProperty('z-index', '2147483647', 'important');
            }
        }

        function _unshieldHighZOverlays() {
            _shielded.forEach(function (entry) {
                if (!entry || !entry.el) return;
                if (entry.pe) {
                    entry.el.style.pointerEvents = entry.pe;
                } else {
                    entry.el.style.removeProperty('pointer-events');
                }
            });
            _shielded = [];

            /* Restore thread z-index to original */
            var thread = document.getElementById('vf-thread');
            if (thread) thread.style.removeProperty('z-index');
        }

        /* Expose so back-button patches in other files can call them */
        window._pv5ShieldThread   = _shieldHighZOverlays;
        window._pv5UnshieldThread = _unshieldHighZOverlays;

        /* Try to install now; retry a few times if app-thread.js hasn't registered yet */
        if (!_install()) {
            var attempts = 0;
            var iv = setInterval(function () {
                attempts++;
                if (_install() || attempts > 20) clearInterval(iv);
            }, 200);
        }

        _ready(function () {
            setTimeout(_install, 500);
            setTimeout(_install, 1500);
        });

        document.addEventListener('empyrean-init-done', function () {
            setTimeout(_install, 400);
        });

    })(); /* end fixThreadShield */


    /* =========================================================================
       FIX 1B — z-index and pointer-events now handled in app-thread.js CSS.
       The pointer-events:none on body.vf-thread-open #vfs-overlay was the
       root cause of all buttons becoming unclickable. Removed.
       ========================================================================= */
    (function fixThreadZIndex() {
        /* Only inject the safe parts: z-index guarantee + modal stacking */
        var s = document.createElement('style');
        s.id = '_pv5_thread_z';
        s.textContent = [
            '#vf-thread { z-index: 2147483647 !important; }',
            '#vf-th-quote-modal, #vf-share-sheet, #vf-rt-popup, #vf-quote-full-modal {',
            '    z-index: 2147483647 !important;',
            '}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    })();


    /* =========================================================================
       FIX 2 — TWEETS/POSTS REFLECT IN FEED
       =========================================================================
       Problem: After a repost/quote from within the thread, the card is
       prepended to #feed-container but the user doesn't see it because:
         (a) The VFS overlay is still visually covering the feed.
         (b) No notification/scroll is triggered.
         (c) The feed may be in a section that's hidden.

       Fix:
         1. Intercept _prependToFeed via a global hook so we can also dispatch
            a custom event that the main app can listen to.
         2. After any repost/quote submission, close VFS and navigate to
            dashboard so the user actually sees the new post.
         3. Show a persistent success notification with "View Post" action.
       ========================================================================= */
    (function fixFeedReflection() {

        /* We patch window.createNewPostElement if it exists, to always add
           the new card to the dashboard feed and fire an event */
        function _patchCreateNewPostElement() {
            var orig = window.createNewPostElement;
            if (!orig || orig._pv5FeedPatched) return;

            window.createNewPostElement = function () {
                var el = orig.apply(this, arguments);
                if (el && el.nodeType === 1) {
                    /* Dispatch an event so main app knows a new post was created */
                    try {
                        document.dispatchEvent(new CustomEvent('empyrean:new-post-created', {
                            detail: { el: el }
                        }));
                    } catch (_e) {}
                }
                return el;
            };
            window.createNewPostElement._pv5FeedPatched = true;
            window.createNewPostElement._origFn = orig;
        }

        /* After a successful repost or quote from inside the thread,
           navigate back to dashboard so the user sees the new card */
        function _goToDashboardAfterPost() {
            /* Close VFS if open */
            var vfsOv = document.getElementById('vfs-overlay');
            if (vfsOv && vfsOv.classList.contains('vfs-open')) {
                /* Try official close */
                if (typeof window._vfsClose === 'function') window._vfsClose();
                else {
                    vfsOv.classList.remove('vfs-open');
                    vfsOv.style.removeProperty('pointer-events');
                }
            }

            /* Close thread */
            if (typeof window._vfCloseThread === 'function') window._vfCloseThread();

            /* Navigate to dashboard */
            setTimeout(function () {
                if (typeof window.navigateTo === 'function') window.navigateTo('dashboard');
                else if (typeof window.showSection === 'function') window.showSection('dashboard');

                /* Scroll feed to top so new post is visible */
                setTimeout(function () {
                    var feed = document.getElementById('feed-container') || document.getElementById('posts-feed');
                    if (feed) feed.scrollTop = 0;
                    var dash = document.getElementById('dashboard');
                    if (dash) dash.scrollTop = 0;
                    window.scrollTo(0, 0);
                }, 200);
            }, 150);
        }

        /* Hook into the empyrean:new-post-created event */
        document.addEventListener('empyrean:new-post-created', function () {
            /* Brief delay to let the card render */
            setTimeout(function () {
                var vfsOv = document.getElementById('vfs-overlay');
                var threadOv = document.getElementById('vf-thread');
                /* Only navigate if we're in video/thread context */
                var inVideoSection = vfsOv && vfsOv.classList.contains('vfs-open');
                var inThread = threadOv && threadOv.classList.contains('vf-open');
                if (inVideoSection || inThread) {
                    _goToDashboardAfterPost();
                }
            }, 300);
        });

        /* Also patch _doRepost and _doSubmitQuote result by watching for
           'Your post was sent!' and 'Reposted!' notifications.
           We do this by intercepting showNotification. */
        var _origNotify = window.showNotification;
        function _interceptNotify() {
            if (!window.showNotification || window.showNotification._pv5Hooked) return;
            var orig = window.showNotification;
            window.showNotification = function (msg, type) {
                orig.apply(this, arguments);
                /* When a post/repost/quote succeeds, navigate to feed */
                if (type === 'success' && msg) {
                    var lower = msg.toLowerCase();
                    if (lower.indexOf('repost') >= 0 || lower.indexOf('your post was sent') >= 0 || lower.indexOf('quote posted') >= 0) {
                        /* Only go to dashboard if currently in video section */
                        var vfsOv = document.getElementById('vfs-overlay');
                        if (vfsOv && vfsOv.classList.contains('vfs-open')) {
                            setTimeout(_goToDashboardAfterPost, 400);
                        }
                    }
                }
            };
            window.showNotification._pv5Hooked = true;
            window.showNotification._origFn    = orig;
        }

        function _boot() {
            _patchCreateNewPostElement();
            _interceptNotify();
        }

        _ready(_boot);
        setTimeout(_boot, 800);
        setTimeout(_boot, 2000);
        document.addEventListener('empyrean-init-done', function () { setTimeout(_boot, 400); });

    })(); /* end fixFeedReflection */


    /* =========================================================================
       FIX 2B — FORCE FEED REFRESH after repost/quote card is injected
       =========================================================================
       When _prependToFeed injects a card, some apps need a trigger to
       re-render or re-wire event listeners on new cards.
       Dispatch 'empyrean:feed-updated' after any prepend.
       ========================================================================= */
    (function fixFeedRefresh() {

        function _watchFeed() {
            var feed = document.getElementById('feed-container') || document.getElementById('posts-feed');
            if (!feed || feed._pv5WatchOk) return;
            feed._pv5WatchOk = true;

            var mo = new MutationObserver(function (muts) {
                var added = false;
                muts.forEach(function (m) {
                    if (m.addedNodes.length) added = true;
                });
                if (!added) return;
                try {
                    document.dispatchEvent(new CustomEvent('empyrean:feed-updated'));
                } catch (_e) {}
                /* Re-wire action buttons on new cards */
                setTimeout(function () {
                    if (typeof window._rewireFeedButtons === 'function') window._rewireFeedButtons();
                    if (typeof window._vfsDecorateAll    === 'function') window._vfsDecorateAll();
                }, 100);
            });
            mo.observe(feed, { childList: true });
        }

        _ready(function () {
            _watchFeed();
            setTimeout(_watchFeed, 1000);
        });

        document.addEventListener('empyrean-init-done', function () { setTimeout(_watchFeed, 400); });

    })(); /* end fixFeedRefresh */


    /* =========================================================================
       FIX 1C — Back button: VFS resume only (no shield/unshield needed).
       ========================================================================= */
    document.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest && e.target.closest('#vf-th-back');
        if (!btn) return;
        /* Resume VFS video when back is tapped */
        if (typeof window._vfsResumeFromThread === 'function') {
            setTimeout(window._vfsResumeFromThread, 50);
        }
        try { document.dispatchEvent(new CustomEvent('vfs:threadClosed')); } catch(ex) {}
    }, true /* capture */);


    /* =========================================================================
       FIX 2C — ENSURE NEW REPLY POSTS ARE VISIBLE
       =========================================================================
       Replies are stored as sub-documents in Firestore and shown inside the
       thread. But a newly created thread reply should also be visible in the
       live count badge on the source feed card. This is already handled by
       app-thread.js for the comment count. However, for top-level new posts
       created via the quick-post FAB, we ensure the feed section is visible
       after submission.
       ========================================================================= */
    (function fixNewPostVisibility() {

        function _wirePostForms() {
            /* Wire the main create-post-form submit */
            var form = document.getElementById('create-post-form');
            if (form && !form._pv5Wired) {
                form._pv5Wired = true;
                form.addEventListener('submit', function () {
                    /* After submit, scroll feed to top to show new post */
                    setTimeout(function () {
                        var feed = document.getElementById('feed-container') || document.getElementById('posts-feed');
                        if (feed) feed.scrollTop = 0;
                    }, 600);
                });
            }

            /* Wire any post-submit buttons */
            var submitBtns = document.querySelectorAll('#post-submit-btn, .post-submit-btn, [data-action="create-post"]');
            submitBtns.forEach(function (btn) {
                if (btn._pv5Wired) return;
                btn._pv5Wired = true;
                btn.addEventListener('click', function () {
                    setTimeout(function () {
                        var feed = document.getElementById('feed-container') || document.getElementById('posts-feed');
                        if (feed) feed.scrollTop = 0;
                    }, 600);
                });
            });
        }

        _ready(function () {
            setTimeout(_wirePostForms, 500);
            setTimeout(_wirePostForms, 1500);
        });
        document.addEventListener('empyrean-init-done', function () { setTimeout(_wirePostForms, 400); });

    })(); /* end fixNewPostVisibility */


    console.log('[EmpyreanPatchV5] ✅ Video-section button fix (shield + z-index CSS) + Feed reflection + Quote image size loaded.');

})();