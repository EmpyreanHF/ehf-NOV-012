/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v6 + v47 (merged)
   app-patch-v6-v47.js  |  Load LAST (after app-push-setup.js — satisfies
   both original files' load-order requirements: v6 only needed to be after
   app-patch-v5.js, v47 needed to be after app-fixes.js AND
   app-push-setup.js; loading at v47's old position covers both)

   MERGE NOTE (2026-08-25): combined into one file to free up a file slot
   under this repo's GitHub 100-file plan limit (room for the new
   birthday-banner.jpg static asset). Purely mechanical — app-patch-v6.js
   and app-patch-v47.js are concatenated below UNCHANGED, each still in
   its own IIFE with its own idempotency guard (window._empPatchV6Loaded
   didn't exist before — v6 had no re-entry guard at all, see its own
   block below for why one wasn't added here either — and
   window._empPatchV47Loaded), so they remain two independent modules
   that happen to ship in one file. Verified no other file in the
   codebase references either module's internals directly — v6 only
   reaches OUT to the DOM (.story-media-item, #vf-th-post-area,
   window._vfOpenThread) and v47 only reaches OUT to the DOM/Web APIs
   (navigator.share, window.showNotification, the
   'empyrean:download-complete' event) — so combining them changes
   nothing about what either does or when it can run, only that they now
   load from one <script> tag instead of two.

   Original v6 header: video-thread button freeze fix (.vfs-tap contained
   to .story-media-item, stripped from the thread post area).
   Original v47 header: "Save to Gallery" prompt after a download
   completes, via the Web Share API's file-sharing support.
   ============================================================================= */

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v6  (DEFINITIVE — v3)
   app-patch-v6.js  |  Load AFTER app-patch-v5.js

   ROOT CAUSE — CONFIRMED
   ──────────────────────
   When a VIDEO post card is cloned into #vf-th-post-area (the thread page),
   the .vfs-tap div that app-video-fullscreen.js injected into the original
   feed card is included in the clone (cloneNode(true) copies DOM structure).

   The .vfs-tap is styled:
       position: absolute; inset: 0; z-index: 20;
   It needs its PARENT (.story-media-item) to be position:relative to stay
   contained inside the media thumbnail.

   BUT .story-media-item has NO position:relative in any stylesheet.
   So inside #vf-thread, the .vfs-tap's absolute positioning crawls up the
   DOM to find the nearest positioned ancestor — which is #vf-thread itself
   (position:fixed; inset:0).

   Result: .vfs-tap expands to cover the ENTIRE thread panel.
   Combined with the thread CSS rule:
       #vf-thread * { pointer-events: auto !important; }
   ...the .vfs-tap becomes a full-screen invisible glass pane that intercepts
   every tap. Buttons get CSS :active (visual blink) because the click
   physically registers, but the tap target is .vfs-tap, not the button.

   IMAGE posts don't have this problem because _decorateItem() only injects
   .vfs-tap when item.querySelector('video') is truthy. Image posts have no
   .vfs-tap, so nothing bleeds out.

   TWO-LINE FIX:
   (A) Add position:relative to .story-media-item so .vfs-tap stays contained.
   (B) Remove any .vfs-tap that gets cloned into #vf-th-post-area (belt+suspenders).
   ============================================================================= */

(function empyreanPatchV6() {
    'use strict';


    /* =========================================================================
       FIX A — CSS: give .story-media-item position:relative
       =========================================================================
       This is the root fix. .vfs-tap is position:absolute;inset:0 and must
       be contained by its parent .story-media-item. Without position:relative
       on the parent, .vfs-tap escapes to the nearest positioned ancestor
       (which inside #vf-thread is the fixed full-screen overlay itself).
    ========================================================================= */
    (function injectContainmentCSS() {
        if (document.getElementById('_pv6_media_contain')) return;
        var s = document.createElement('style');
        s.id = '_pv6_media_contain';
        s.textContent = [
            /* Contain .vfs-tap inside its media item */
            '.story-media-item {',
            '    position: relative;',
            '    overflow: hidden;',
            '}',
            /* Belt-and-suspenders: ensure .vfs-tap never bleeds out anywhere */
            '.story-media-item .vfs-tap {',
            '    position: absolute !important;',
            '    top: 0 !important;',
            '    left: 0 !important;',
            '    right: 0 !important;',
            '    bottom: 0 !important;',
            '    width: auto !important;',
            '    height: auto !important;',
            '    z-index: 20 !important;',
            '}',
            /* Inside the thread post area, vfs-tap must never intercept anything */
            '#vf-th-post-area .vfs-tap,',
            '#vf-th-post-area .vfs-expand {',
            '    display: none !important;',
            '    pointer-events: none !important;',
            '}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    })();


    /* =========================================================================
       FIX B — DOM: strip .vfs-tap/.vfs-expand from cloned thread post area
       =========================================================================
       Belt-and-suspenders. Whenever openThread() clones a video post into
       #vf-th-post-area, remove any .vfs-tap and .vfs-expand divs immediately.
       We hook this via MutationObserver on #vf-th-post-area.
    ========================================================================= */
    (function stripVfsTapFromThread() {

        function _clean(root) {
            if (!root) return;
            root.querySelectorAll('.vfs-tap, .vfs-expand').forEach(function (el) {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('pointer-events', 'none', 'important');
                /* Remove entirely after a tick so no layout flash */
                setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 0);
            });
        }

        function _watchPostArea() {
            var area = document.getElementById('vf-th-post-area');
            if (!area || area._pv6Watched) return;
            area._pv6Watched = true;

            /* Clean on initial content */
            _clean(area);

            /* Watch for new content injected by openThread() */
            new MutationObserver(function () {
                _clean(area);
            }).observe(area, { childList: true, subtree: true });
        }

        /* Run now and after init */
        if (document.readyState !== 'loading') {
            setTimeout(_watchPostArea, 200);
        } else {
            document.addEventListener('DOMContentLoaded', function () {
                setTimeout(_watchPostArea, 200);
            });
        }
        document.addEventListener('empyrean-init-done', function () {
            setTimeout(_watchPostArea, 300);
        });

        /* Also hook into openThread itself for instant cleanup */
        function _patchOpenThread() {
            var orig = window._vfOpenThread;
            if (!orig || orig._pv6Patched) return;
            window._vfOpenThread = function (postEl) {
                var result = orig.apply(this, arguments);
                /* Clean up immediately after thread opens */
                setTimeout(function () {
                    _clean(document.getElementById('vf-th-post-area'));
                }, 50);
                return result;
            };
            window._vfOpenThread._pv6Patched = true;
            window._vfOpenThread._orig = orig;
        }

        _patchOpenThread();
        document.addEventListener('empyrean-init-done', function () {
            setTimeout(_patchOpenThread, 400);
        });

    })();


    console.log('[EmpyreanPatchV6] ✅ Video thread button freeze fixed — .vfs-tap contained to .story-media-item, stripped from thread post area.');

})();

/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v47
   app-patch-v47.js  |  Load anywhere after app-fixes.js (this build loads it
   last, after app-push-setup.js). Requires the small companion edit already
   made to app-fixes.js's download-completion handler (dispatches
   'empyrean:download-complete' — see that file's own comment at the same
   spot for why this couldn't be added as a fully separate, non-invasive
   patch).

   ISSUE — "Nothing landed in my gallery, no media download in my gallery
   after successful download."

   ROOT CAUSE (confirmed, not guessed — this is a platform limit, not a
   regression in this codebase): the existing download flow in app-fixes.js
   (_triggerDownloadClick / the canvas.toBlob + <a download> click path) is
   the only mechanism a website running in a normal browser tab has for
   saving a file at all. Every one of those paths hands the file to the
   BROWSER's own Download Manager, which always saves into the device's
   Download folder — never directly into the Android Photos/Gallery app's
   MediaStore. Whether the OS's media scanner later indexes that Download
   folder into Photos is a per-device/per-Android-version behavior with no
   JS-accessible control point; a page running in Chrome (confirmed via the
   screenshots — this is a browser tab, not an installed/wrapped native app)
   cannot reach into MediaStore directly. This is exactly why the Chrome
   Downloads history (chrome://downloads) already shows every Empyrean file
   ever downloaded — the save genuinely succeeded — while Photos shows none
   of them.

   FIX — the one thing a web page CAN do to get a file into the actual
   Gallery is hand it to the OS's native share sheet via the Web Share API
   (navigator.share with a `files` array), where the person picks "Save to
   Photos" / Google Photos as the target themselves. This can't happen
   silently or automatically — Web Share requires a direct, in-the-moment
   user gesture, and the original download click's gesture context is long
   gone by the time the async fetch/canvas work finishes. So this adds a
   small tappable "📤 Save to Gallery" notification the instant a download
   finishes; tapping IS the fresh user gesture that makes navigator.share()
   work. Devices/browsers without file-sharing support (most desktop
   browsers, older Android WebViews) don't get the prompt at all — for
   those, the existing "saved to your Downloads folder" behavior is
   unchanged and is the only option available regardless of this patch.
   ============================================================================= */

(function empyreanPatchV47() {
    'use strict';

    if (window._empPatchV47Loaded) {
        console.warn('[V47] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV47Loaded = true;

    function log(msg)  { console.log('[V47-SaveToGallery] ' + msg); }
    function warn(msg) { console.warn('[V47-SaveToGallery] ' + msg); }

    // Feature-detect once. navigator.share existing isn't enough — file
    // sharing specifically needs navigator.canShare({files}) support, which
    // is narrower (desktop Chrome/Edge often have share() but not file
    // support; older Android WebViews may have neither).
    function fileShareSupported() {
        return !!(navigator.share && navigator.canShare);
    }

    // Re-fetches each already-downloaded URL into a File so it can be
    // handed to navigator.share(). A fresh fetch (rather than reusing the
    // original blob) is deliberate: the blobs created inside app-fixes.js's
    // download handler are short-lived, revoked via URL.revokeObjectURL
    // shortly after use, and live inside that file's own closure — not
    // accessible here. Most CDN media (Cloudinary) is cached by the browser
    // from the original download's own fetch, so this second request is
    // typically served from cache, not the network, again.
    function urlToFile(item, index) {
        var ext = item.type === 'video' ? 'mp4' : 'jpg';
        var mime = item.type === 'video' ? 'video/mp4' : 'image/jpeg';
        var name = 'empyrean-' + Date.now() + '-' + (index + 1) + '.' + ext;
        return fetch(item.url)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.blob();
            })
            .then(function (blob) {
                return new File([blob], name, { type: blob.type || mime });
            });
    }

    function offerSaveToGallery(urls, fileWord) {
        if (!fileShareSupported()) {
            log('Web Share (files) not supported on this browser/device — skipping the Save to Gallery prompt; file(s) remain in the Downloads folder as usual.');
            return;
        }
        if (!urls || !urls.length) return;

        var label = '📤 Tap to save ' + urls.length + ' ' + fileWord + ' to your Gallery';
        if (typeof window.showNotification !== 'function') return;

        showNotification(label, 'info', function () {
            Promise.all(urls.map(urlToFile))
                .then(function (files) {
                    if (!navigator.canShare({ files: files })) {
                        showNotification('Your browser can\u2019t share these files directly — they\u2019re already saved in your Downloads folder.', 'info');
                        return;
                    }
                    return navigator.share({
                        files: files,
                        title: 'Empyrean',
                        text: 'Saved from Empyrean'
                    });
                })
                .then(function () {
                    log('share sheet completed (or was dismissed) for ' + urls.length + ' file(s).');
                })
                .catch(function (err) {
                    // AbortError just means the person closed the share sheet
                    // without picking anything — not a real failure, don't
                    // scare them with an error toast for that.
                    if (err && err.name === 'AbortError') return;
                    warn('share failed: ' + (err && err.message));
                    showNotification('Could not open the share sheet — the file is still saved in your Downloads folder.', 'warning');
                });
        });
    }

    document.addEventListener('empyrean:download-complete', function (e) {
        var detail = (e && e.detail) || {};
        offerSaveToGallery(detail.urls, detail.fileWord || 'file');
    });

    console.log('[EmpyreanPatchV47] \u2705 Save to Gallery wired — after a download finishes, devices with Web Share file support get a tappable prompt that opens the native share sheet so the person can save straight into Photos/Gallery; this cannot be automatic (Web Share requires its own fresh user gesture) and is unavailable on browsers without file-share support, where the existing Downloads-folder save is unchanged.');

})();