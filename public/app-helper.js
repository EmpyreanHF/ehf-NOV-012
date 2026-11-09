/* =============================================================================
   EMPYREAN INTERNATIONAL — GLOBAL HELPER UTILITIES
   app-helpers.js  |  Step 0.3  |  Refactor Roadmap v1.0
   =============================================================================

   PURPOSE
   ───────
   Every reusable, stateless-ish utility function used across two or more
   modules.  Extracted verbatim (plus JSDoc + minor de-duplication) from the
   original DOMContentLoaded closure in app-fixes.js.

   LOAD ORDER
   ──────────
   <script src="firebase-init.js">
   <script src="app-state.js">
   <script src="app-helpers.js">   ← THIS FILE
   <script src="app-dom.js">
   ... all other app-*.js modules ...

   DEPENDS ON
   ──────────
   • window.EmpState  (app-state.js) — reads isGuest, userState, impactMiningState,
     userLockedStakedBalance, userLockedStakingEndTime, userClaimedRewardsHistory,
     userState.empyBalance, and calls EmpState.patchUser().
   • window.fbDb      (firebase-init.js stub) — to persist empyBalance updates.

   SECTION MAP
   ───────────
   §1  DOM utilities            — empyreanClosest
   §2  Formatters               — _fmtCount, _timeAgo, formatNgnPrice,
                                  formatUsdPrice
   §3  Notification toast       — showNotification
   §4  Form helpers             — showFormFeedback, generateCaptcha
   §5  Rich text renderer       — formatWhatsAppText
   §6  Upload utilities         — uploadMediaFilesToCloudinary (polyfill),
                                  showUploadProgress
   §7  Image & media preview    — resizeAndCropImage, handleAvatarUpload,
                                  handleMediaPreview, handleMarketplacePreview
   §8  Share                    — shareContent
   §9  Impact mining reward     — REMOVED 2026-08-15, see §9's own comment (was a stale duplicate of app-impactmining.js's rewardUserForAction)
   §10 KYC date selectors       — populateDobSelectors
   §11 Error recovery           — onerror handler, unhandledrejection,
                                  _blankScreenGuard, _injectArticleCollapseCSS

   ============================================================================= */

(function empyreanHelpersModule() {
    'use strict';

    if (window._empyreanHelpersLoaded) {
        console.warn('[EmpHelpers] Already loaded — skipping duplicate.');
        return;
    }
    window._empyreanHelpersLoaded = true;

    /* =========================================================================
       §1  DOM UTILITIES
       ========================================================================= */

    /**
     * Safe wrapper around Element.closest() with a null-check guard.
     * Use instead of calling .closest() directly on potentially-null elements.
     *
     * @param {Element|null} el        — Starting element
     * @param {string}       selector  — CSS selector to match against ancestors
     * @returns {Element|null}
     */
    function empyreanClosest(el, selector) {
        if (!el || !selector) return null;
        return el.closest ? el.closest(selector) : null;
    }
    window.empyreanClosest = empyreanClosest;


    /* =========================================================================
       §2  FORMATTERS
       ========================================================================= */

    /**
     * Compact number formatter — abbreviates large counts.
     * 1234 → "1.2K"  |  1200000 → "1.2M"  |  999 → "999"
     *
     * @param {number|string} n
     * @returns {string}
     */
    function _fmtCount(n) {
        n = parseInt(n) || 0;
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
        return n.toString();
    }
    window._fmtCount = _fmtCount;

    /**
     * Relative time formatter.
     * Returns human-readable string: "5s", "12m", "3h", "2d", or "14 Jan".
     *
     * @param {number|string|Date|null} ts — Timestamp (ms), ISO string, or Date
     * @returns {string}
     */
    function _timeAgo(ts) {
        var d   = ts ? new Date(ts) : new Date();
        var sec = Math.floor((Date.now() - d.getTime()) / 1000);
        if (isNaN(sec) || sec < 0) return 'just now';
        if (sec < 60)      return sec + 's';
        if (sec < 3_600)   return Math.floor(sec / 60) + 'm';
        if (sec < 86_400)  return Math.floor(sec / 3_600) + 'h';
        if (sec < 604_800) return Math.floor(sec / 86_400) + 'd';
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }
    window._timeAgo = _timeAgo;

    /**
     * Format a number as Nigerian Naira (₦).
     * @param {number} price
     * @returns {string}  e.g. "₦1,500,000.00"
     */
    function formatNgnPrice(price) {
        return new Intl.NumberFormat('en-NG', {
            style: 'currency', currency: 'NGN', minimumFractionDigits: 2
        }).format(price);
    }
    window.formatNgnPrice = formatNgnPrice;

    /**
     * Format a number as US Dollars ($).
     * @param {number} price
     * @returns {string}  e.g. "$1,200.00"
     */
    function formatUsdPrice(price) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency', currency: 'USD', minimumFractionDigits: 2
        }).format(price);
    }
    window.formatUsdPrice = formatUsdPrice;


    /* =========================================================================
       §3  NOTIFICATION TOAST
       ========================================================================= */

    /**
     * Show a brief toast notification in the top-right corner.
     * Uses the #reward-notification element defined in index.html.
     *
     * @param {string} message           — Text to display
     * @param {'success'|'error'|'warning'|'info'} [type='success']
     */
    function showNotification(message, type) {
        type = type || 'success';
        var el = document.getElementById('reward-notification');
        if (!el) return;

        var colorMap = {
            success: '#10B981',
            error:   '#EF4444',
            warning: '#F59E0B',
            info:    '#1B2B8B'
        };

        el.textContent = message;
        el.style.backgroundColor = colorMap[type] || colorMap.success;
        el.style.color  = '#ffffff';
        el.style.border = '2px solid rgba(255,255,255,0.3)';
        el.classList.add('show');
        setTimeout(function() { el.classList.remove('show'); }, 3500);
    }
    // Expose immediately — inline onclick handlers use this before DOMContentLoaded
    window.showNotification = showNotification;


    /* =========================================================================
       §4  FORM HELPERS
       ========================================================================= */

    /**
     * Display a styled feedback message below a form.
     * Looks for an element with id "${formId}-feedback".
     *
     * @param {string} formId    — Base ID of the form (e.g. "login")
     * @param {string} message   — Feedback text
     * @param {'error'|'success'|'warning'|'info'} [type='error']
     */
    function showFormFeedback(formId, message, type) {
        type = type || 'error';
        var feedbackEl = document.getElementById(formId + '-feedback');
        if (!feedbackEl) return;
        feedbackEl.textContent = message;
        feedbackEl.className   = 'form-feedback ' + type;
        feedbackEl.style.display = 'block';
    }
    window.showFormFeedback = showFormFeedback;

    /**
     * Generate a new random 6-character alphanumeric CAPTCHA and inject it
     * into #captcha-code.  Also clears the current input field.
     */
    function generateCaptcha() {
        var captchaCodeEl = document.getElementById('captcha-code');
        if (!captchaCodeEl) return;

        var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        var code  = Array.from({ length: 6 }, function() {
            return chars.charAt(Math.floor(Math.random() * chars.length));
        }).join('');

        // Update both the DOM and the EmpState reference
        captchaCodeEl.textContent = code;
        if (window.EmpState) window.EmpState.captchaCode = code;
        else                 window.captchaCode           = code;

        var input = document.getElementById('login-captcha-input');
        if (input) input.value = '';
    }
    window.generateCaptcha = generateCaptcha;


    /* =========================================================================
       §5  RICH TEXT RENDERER
       ========================================================================= */

    /**
     * Convert plain post/comment text into HTML with:
     * • HTML escaping (XSS safe)
     * • Auto-linked URLs (YouTube, WhatsApp, Twitter, Instagram, LinkedIn, Facebook)
     * • WhatsApp-style *bold*, _italic_, ~strikethrough~, `code`
     * • @mention highlighting → navigates to user profile on click
     * • #hashtag highlighting
     * • Newline → <br>
     *
     * @param {string} text — Raw post text
     * @returns {string}    — Safe HTML string
     */
    function formatWhatsAppText(text) {
        if (!text) return '';

        // 1. Escape HTML
        var t = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // 2. Auto-linkify URLs — https/www AND a bare domain with no
        // prefix at all (e.g. "joinempyrean.com" typed plain). See
        // app-fixes.js's copy of this function for the full explanation
        // of the third regex alternative and the trailing-punctuation trim.
        t = t.replace(
            /(https?:\/\/[^\s<>"'&]+|www\.[^\s<>"'&]+\.[a-z]{2,}[^\s<>"'&]*|(?<![a-zA-Z0-9@._-])(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:com|net|org|edu|gov|mil|co|io|ng|app|dev|me|info|biz|xyz|live|tv|ai|shop|store|online|site|uk|ca|us|in|za|gh|ke)(?:\/[^\s<>"'&]*)?\b)/gi,
            function(rawUrl) {
                var trail = '';
                var trailMatch = rawUrl.match(/[.,!?;:)\]]+$/);
                if (trailMatch) { trail = trailMatch[0]; rawUrl = rawUrl.slice(0, -trail.length); }
                if (!rawUrl) return rawUrl + trail;
                var url = rawUrl;
                var href = /^https?:\/\//i.test(url) ? url : 'https://' + url;
                var icon = '🔗';
                if      (/youtube\.com|youtu\.be/i.test(href))                    icon = '▶️';
                else if (/whatsapp\.com|wa\.me/i.test(href))                      icon = '💬';
                else if (/twitter\.com|x\.com/i.test(href))                       icon = '𝕏';
                else if (/instagram\.com/i.test(href))                            icon = '📷';
                else if (/linkedin\.com/i.test(href))                             icon = '💼';
                else if (/facebook\.com|fb\.com/i.test(href))                     icon = '👥';
                var label = url.length > 45 ? url.substring(0, 45) + '…' : url;
                return '<a href="' + href + '" target="_blank" rel="noopener noreferrer"'
                    + ' style="color:var(--secondary);text-decoration:underline;font-weight:500;">'
                    + icon + ' ' + label + '</a>' + trail;
            }
        );

        // 3. WhatsApp markdown
        // FIX (this session — "paragraph formatting quality"): a run of
        // 2+ newlines used to just become stacked <br><br> tags — visible,
        // but cramped and inconsistent (browsers render doubled <br>s with
        // uneven gaps depending on surrounding line-height). Two-or-more
        // newlines now become a real block-level spacer with a
        // deliberate, consistent gap — reads as an actual paragraph break
        // instead of "extra blank lines". A single newline still just
        // becomes a normal line break within the same paragraph.
// UPDATED (2026-10-19 — "the > symbol is not working"): a line that starts with ">" (optionally followed by a space)
// is now a QUOTE, like WhatsApp / Markdown. The ">" is removed and the line is shown as an indented quote block with a
// side bar (styled by .post-quote in style.css). Consecutive ">" lines share one block. This runs on the already
// HTML-escaped text, where ">" has become "&gt;", so it is safe.
        t = (function (src) {
            var res = '', first = true, prevBlock = false, buf = [];
            function flush() {
                if (!buf.length) return;
                res += '<span class="post-quote">' + buf.join('<br>') + '</span>';
                buf = []; prevBlock = true; first = false;
            }
            src.split('\n').forEach(function (line) {
                var m = line.match(/^[ \t]*(?:&gt;[ \t]?)+(.*)$/);
                if (m) { buf.push(m[1]); return; }
                flush();
                if (!first && !prevBlock) res += '\n';
                res += line; prevBlock = false; first = false;
            });
            flush();
            return res;
        })(t);
        t = t
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')   // 2026-10-19: **double-asterisk** bold (ChatGPT / Markdown style) now works too
            .replace(/\*(.*?)\*/g,   '<strong>$1</strong>')
            .replace(/_(.*?)_/g,     '<em>$1</em>')
            .replace(/~(.*?)~/g,     '<s>$1</s>')
            .replace(/`(.*?)`/g,
                '<code style="background:rgba(10,14,39,0.08);padding:1px 5px;'
                + 'border-radius:4px;font-family:monospace;font-size:0.88em;">$1</code>'
            )
            .replace(/\n{2,}/g, '<span style="display:block;height:0.65em;"></span>')
            .replace(/\n/g, '<br>');

        // 4. @mention
        t = t.replace(/@([a-zA-Z0-9_\.]+)/g, function(match, username) {
            return '<a href="#" class="mention-tag" data-username="' + username + '"'
                + ' style="color:var(--secondary);font-weight:700;text-decoration:none;'
                + 'background:rgba(27,43,139,0.09);border-radius:4px;padding:1px 4px;">'
                + '@' + username + '</a>';
        });

        // 5. #hashtag
        t = t.replace(/#([a-zA-Z0-9_]+)/g, function(match, tag) {
            return '<a href="#" class="hashtag-tag" data-tag="' + tag + '"'
                + ' style="color:var(--accent-color);font-weight:700;text-decoration:none;'
                + 'background:rgba(245,197,24,0.12);border-radius:4px;padding:1px 4px;">'
                + '#' + tag + '</a>';
        });

        return t;
    }
    window.formatWhatsAppText = formatWhatsAppText;


    /* =========================================================================
       §6  UPLOAD UTILITIES
       ========================================================================= */

    /**
     * Polyfill for uploadMediaFilesToCloudinary.
     * Only installed if a previous script hasn't already defined it
     * (app-dom.js may define the canonical version; this is the fallback).
     *
     * Accepts a mixed array of File objects, blob URLs, or already-uploaded
     * Cloudinary URLs.  Skips items that are already uploaded.
     * Waits up to 8 s for window.uploadToCloudinary to become available.
     *
     * @param {Array<File|string>} files
     * @returns {Promise<string[]>} Array of Cloudinary URLs (empty string on failure)
     */
    if (typeof window.uploadMediaFilesToCloudinary !== 'function') {
        window.uploadMediaFilesToCloudinary = async function uploadMediaFilesToCloudinary(files) {
            if (!files || files.length === 0) return [];

            // Wait for app-dom.js / Cloudinary SDK to expose uploadToCloudinary
            var _waited = 0;
            while (typeof window.uploadToCloudinary !== 'function' && _waited < 8000) {
                await new Promise(function(r) { setTimeout(r, 200); });
                _waited += 200;
            }
            if (typeof window.uploadToCloudinary !== 'function') {
                console.error('[uploadMediaFilesToCloudinary] uploadToCloudinary not available after 8 s');
                return Array.from(files).map(function(f) {
                    return f._cloudUrl || (f instanceof File ? '' : (typeof f === 'string' ? f : ''));
                });
            }

            var results = await Promise.all(
                Array.from(files).map(function(file) {
                    // Already uploaded — skip
                    if (file._cloudUrl && !file._cloudUrl.startsWith('blob:')) {
                        return Promise.resolve(file._cloudUrl);
                    }
                    // Not a File object — pass string through unchanged
                    if (!(file instanceof File)) {
                        return Promise.resolve(typeof file === 'string' ? file : '');
                    }
                    return window.uploadToCloudinary(file, null)
                        .then(function(url) {
                            if (url && !url.startsWith('blob:')) {
                                file._cloudUrl = url;
                                return url;
                            }
                            return '';
                        })
                        .catch(function(err) {
                            console.warn('[uploadMediaFilesToCloudinary] upload failed:', err && err.message);
                            return '';
                        });
                })
            );
            return results;
        };
        console.log('[EmpHelpers] uploadMediaFilesToCloudinary polyfill installed.');
    }

    /**
     * Show or update a progress bar beneath a given container element.
     * Creates the progress bar DOM on first call; removes it at 100 %.
     *
     * @param {string} containerId — ID of the parent element (NOT the bar itself)
     * @param {number} pct         — 0–100
     */
    function showUploadProgress(containerId, pct) {
        var cont = document.getElementById(containerId + '-progress');
        if (!cont) {
            var parentEl = document.getElementById(containerId);
            if (!parentEl) return;
            cont = document.createElement('div');
            cont.id        = containerId + '-progress';
            cont.className = 'upload-progress-container';
            cont.innerHTML = '<div class="upload-progress-bar" style="width:0%;"></div>';
            parentEl.appendChild(cont);
        }
        var bar = cont.querySelector('.upload-progress-bar');
        if (bar) bar.style.width = pct + '%';
        if (pct >= 100) setTimeout(function() { if (cont) cont.remove(); }, 800);
    }
    window.showUploadProgress = showUploadProgress;


    /* =========================================================================
       §7  IMAGE & MEDIA PREVIEW HELPERS
       ========================================================================= */

    /**
     * Resize and centre-crop an image File to the target dimensions using
     * an offscreen canvas.  Result is a JPEG data URL delivered via callback.
     *
     * Used by handleAvatarUpload() to normalise profile pictures.
     *
     * @param {File}     file     — Source image file
     * @param {number}   width    — Target width in px
     * @param {number}   height   — Target height in px
     * @param {Function} callback — Called with (dataUrl: string)
     */
    function resizeAndCropImage(file, width, height, callback) {
        var reader = new FileReader();
        reader.onload = function(e) {
            var img   = new Image();
            img.onload = function() {
                var canvas = document.createElement('canvas');
                var ctx    = canvas.getContext('2d');
                canvas.width  = width;
                canvas.height = height;

                var srcX, srcY, srcW, srcH;
                var imgRatio    = img.width / img.height;
                var targetRatio = width / height;

                if (imgRatio > targetRatio) {
                    // Image is wider than target — crop sides
                    srcH = img.height;
                    srcW = srcH * targetRatio;
                    srcX = (img.width - srcW) / 2;
                    srcY = 0;
                } else {
                    // Image is taller than target — crop top/bottom
                    srcW = img.width;
                    srcH = srcW / targetRatio;
                    srcY = (img.height - srcH) / 2;
                    srcX = 0;
                }

                ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, width, height);
                callback(canvas.toDataURL('image/jpeg'));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
    window.resizeAndCropImage = resizeAndCropImage;

    /**
     * Load a profile picture or cover photo File into an <img> preview element.
     * When isProfilePic is true the image is resized/cropped to 150 × 150 px
     * and stored in the appropriate EmpState media-buffer slot.
     *
     * @param {File|null} file        — Selected file (null clears the preview)
     * @param {string}    previewId   — ID of the <img> element to update
     * @param {boolean}   [isProfilePic=false]
     */
    function handleAvatarUpload(file, previewId, isProfilePic) {
        isProfilePic = isProfilePic || false;
        var preview = document.getElementById(previewId);
        if (!preview) return;

        // Clear state
        if (!file) {
            preview.src = '';
            preview.classList.remove('active');
            var icon = preview.nextElementSibling;
            if (icon && icon.classList.contains('upload-icon')) icon.style.opacity = 1;
            return;
        }

        function displayImage(dataUrl) {
            preview.src = dataUrl;
            if (!preview.classList.contains('active')) preview.classList.add('active');
            var icon = preview.nextElementSibling;
            if (icon && icon.classList.contains('upload-icon')) icon.style.opacity = 0;
        }

        if (isProfilePic) {
            resizeAndCropImage(file, 150, 150, function(dataUrl) {
                // Store in EmpState (falls back to window.* if EmpState not loaded)
                var S = window.EmpState || window;
                if (previewId === 'avatar-preview')  S.newAvatarFile = dataUrl;
                if (previewId === 'profile-pic-img') S.newAvatarFile = dataUrl;
                displayImage(dataUrl);
            });
        } else {
            var reader = new FileReader();
            reader.onload = function(e) { displayImage(e.target.result); };
            reader.readAsDataURL(file);
        }
    }
    window.handleAvatarUpload = handleAvatarUpload;

    /**
     * Render a responsive media-preview grid inside a container element.
     * Supports 1–4+ image/video Files.  Files beyond 4 are hidden with an
     * overflow badge.  Each item has an × remove button.
     *
     * Grid layout:
     *   1 file  → single column
     *   2 files → two equal columns
     *   3 files → 2:1 ratio (first item spans 2 rows)
     *   4+ files→ 2×2 grid with "+N" badge on the 4th cell
     *
     * @param {FileList|File[]} files            — Files to preview
     * @param {string}          previewContainerId — ID of the container element
     */
    function handleMediaPreview(files, previewContainerId) {
        var previewContainer = document.getElementById(previewContainerId);
        if (!previewContainer) return;
        previewContainer.innerHTML = '';

        var fileArr = Array.from(files);
        var count   = fileArr.length;

        // Grid setup
        previewContainer.style.display             = 'grid';
        previewContainer.style.gap                 = '4px';
        previewContainer.style.borderRadius        = '14px';
        previewContainer.style.overflow            = 'hidden';
        if      (count === 1)  previewContainer.style.gridTemplateColumns = '1fr';
        else if (count === 2)  previewContainer.style.gridTemplateColumns = '1fr 1fr';
        else if (count === 3)  previewContainer.style.gridTemplateColumns = '2fr 1fr';
        else                   previewContainer.style.gridTemplateColumns = '1fr 1fr';

        fileArr.forEach(function(file, idx) {
            var url          = URL.createObjectURL(file);
            var mediaWrapper = document.createElement('div');
            mediaWrapper.style.cssText = 'position:relative;overflow:hidden;background:#f0f0f0;';
            if (count === 3 && idx === 0) mediaWrapper.style.gridRow = '1 / 3';
            mediaWrapper.style.height = count === 1 ? '240px' : '160px';

            var mediaEl;
            if (file.type.startsWith('image/')) {
                mediaEl = document.createElement('img');
                mediaEl.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
            } else if (file.type.startsWith('video/')) {
                mediaEl = document.createElement('video');
                mediaEl.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
                mediaEl.controls  = true;
                mediaEl.muted     = true;
                mediaEl.loop      = true;
                mediaEl.autoplay  = true;
            }

            // "+N more" badge on 4th cell when there are >4 files
            if (count > 4 && idx === 3) {
                var badge = document.createElement('div');
                badge.style.cssText = 'position:absolute;inset:0;background:rgba(10,14,39,0.6);'
                    + 'display:flex;align-items:center;justify-content:center;color:white;'
                    + 'font-size:1.5rem;font-weight:800;font-family:Syne,sans-serif;';
                badge.textContent = '+' + (count - 4);
                mediaWrapper.appendChild(badge);
            }

            if (mediaEl) {
                mediaEl.src = url;
                mediaWrapper.appendChild(mediaEl);
            }

            // Remove button
            var removeBtn     = document.createElement('button');
            removeBtn.type    = 'button';
            removeBtn.style.cssText =
                'position:absolute;top:5px;right:5px;background:rgba(239,68,68,0.85);'
                + 'border:none;color:white;border-radius:50%;width:22px;height:22px;'
                + 'font-size:0.75rem;cursor:pointer;display:flex;align-items:center;'
                + 'justify-content:center;line-height:1;z-index:3;';
            removeBtn.innerHTML = '×';
            removeBtn.addEventListener('click', function() { mediaWrapper.remove(); });
            mediaWrapper.appendChild(removeBtn);

            previewContainer.appendChild(mediaWrapper);
            if (count > 4 && idx >= 4) mediaWrapper.style.display = 'none';
        });
    }
    window.handleMediaPreview = handleMediaPreview;

    /**
     * Render a responsive media preview grid for marketplace listing images/videos.
     * Accepts File objects or already-uploaded URL strings.
     * Mirrors handleMediaPreview layout but also handles string URLs from
     * existing listings (edit flow).
     *
     * @param {Array<File|string>} filesArray
     * @param {HTMLElement}        previewContainer — Direct reference (not ID)
     */
    function handleMarketplacePreview(filesArray, previewContainer) {
        if (!previewContainer) return;
        if (!filesArray || filesArray.length === 0) {
            previewContainer.innerHTML = '';
            return;
        }
        previewContainer.innerHTML = '';

        var count = filesArray.length;
        previewContainer.style.display             = 'grid';
        previewContainer.style.gap                 = '4px';
        previewContainer.style.borderRadius        = '12px';
        previewContainer.style.overflow            = 'hidden';
        previewContainer.style.marginTop           = '8px';

        if      (count === 1) previewContainer.style.gridTemplateColumns = '1fr';
        else if (count === 2) previewContainer.style.gridTemplateColumns = '1fr 1fr';
        else if (count === 3) previewContainer.style.gridTemplateColumns = '2fr 1fr';
        else                  previewContainer.style.gridTemplateColumns = '1fr 1fr';

        Array.from(filesArray).forEach(function(file, idx) {
            if (idx >= 4) return;

            var url    = (typeof file === 'string') ? file : URL.createObjectURL(file);
            var type   = (typeof file === 'string')
                ? (file.match(/\.(mp4|webm|mov)/i) ? 'video' : 'image')
                : (file.type || '');
            var isVid  = type.startsWith('video') || /\.(mp4|webm|mov)/i.test(url);
            var height = count === 1 ? '220px' : '150px';

            var cell = document.createElement('div');
            cell.style.cssText = 'overflow:hidden;height:' + height
                + ';background:#f0f0f0;position:relative;'
                + (count === 3 && idx === 0 ? 'grid-row:1/3;' : '');

            cell.innerHTML = isVid
                ? '<video src="' + url + '" style="width:100%;height:100%;object-fit:cover;" muted playsinline controls></video>'
                : '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy">';

            // "+N more" badge
            if (count > 4 && idx === 3) {
                var badge = document.createElement('div');
                badge.style.cssText =
                    'position:absolute;inset:0;background:rgba(0,0,0,0.6);color:white;'
                    + 'font-size:1.5rem;font-weight:800;display:flex;align-items:center;justify-content:center;';
                badge.textContent = '+' + (count - 3);
                cell.appendChild(badge);
            }
            previewContainer.appendChild(cell);
        });
    }
    window.handleMarketplacePreview = handleMarketplacePreview;


    /* =========================================================================
       §8  SHARE
       ========================================================================= */

    /**
     * Share content using the Web Share API with clipboard fallback.
     * Awards a SHARE_POST impact-mining reward on success.
     *
     * @param {{ title?: string, text?: string, url: string }} shareData
     * @returns {Promise<void>}
     */
    async function shareContent(shareData) {
        var copied = false;

        // Clipboard fallback (always tried first — desktop-friendly)
        if (navigator.clipboard) {
            try {
                await navigator.clipboard.writeText(shareData.url);
                showNotification('Link copied to clipboard!');
                copied = true;
            } catch (err) {
                console.error('[shareContent] Clipboard write failed:', err);
            }
        }

        // Web Share API (mobile / PWA)
        if (navigator.share) {
            try {
                await navigator.share(shareData);
            } catch (err) {
                if (err.name !== 'AbortError') console.error('[shareContent] Web Share API error:', err);
            }
        } else if (!copied) {
            showNotification('Sharing not supported on this browser.', 'error');
        }

        // Reward the sharing action
        if (typeof window.rewardUserForAction === 'function') {
            window.rewardUserForAction('SHARE_POST');
        }
    }
    window.shareContent = shareContent;


    /* =========================================================================
       §9  IMPACT MINING REWARD
       ========================================================================= */

    /* REMOVED (2026-08-15 — engagement-attribution/reward-engine audit):
       this file used to have its own private rewardUserForAction() here,
       with its own copy of the rate table (still the OLD, pre-reduction
       amounts — VERIFIED_CRISIS_REPORT: 50 vs the current 0.025, etc.) and
       its own un-migrated direct Firestore write, running independently of
       app-impactmining.js — the exact same "second, independent reward
       implementation" problem app-impactmining.js's own §1 header comment
       already documented and fixed for app-fix-final.js §43 and for this
       file's sibling copy inside app-fixes.js (see that file's own
       "MOVED (2026-07)" comment at the same spot) — app-helper.js was
       simply missed in that earlier pass.

       This copy also still paid RECEIVE_COMMENT/RECEIVE_LIKE to the post
       OWNER (0.2/0.1 EMPY) — the exact mis-attributed behavior just
       retired from app-impactmining.js and server.js this same session
       (engagement rewards belong to whoever does the liking/commenting,
       not the post owner — see those files' own RETIRED notes). Because
       index.html loads app-helper.js BEFORE app-impactmining.js, this copy
       was harmless today only by load-order accident: app-impactmining.js's
       own window.rewardUserForAction assignment runs right after and wins.
       That's not something to depend on — if load order ever changed, this
       stale, wrong-attribution, wrong-rate, un-migrated implementation
       would silently become the live one again.

       Function removed entirely, not neutered in place — every bare
       `rewardUserForAction(...)` call elsewhere in this file (see
       shareContent() above) already goes through `window.rewardUserForAction`
       via normal JS scope lookup, since there's no local declaration
       shadowing it anymore. It now resolves to app-impactmining.js's
       dispatcher, the single canonical reward engine — no call sites here
       needed to change. */


    /* =========================================================================
       §10  KYC DATE SELECTORS
       ========================================================================= */

    /**
     * Populate the three DOB <select> elements (day / month / year) inside
     * #individual-kyc-form.  Restricts year range to 18–100 years before today.
     */
    function populateDobSelectors() {
        var dayEl   = document.querySelector('#individual-kyc-form .date-select-group select:nth-child(1)');
        var monthEl = document.querySelector('#individual-kyc-form .date-select-group select:nth-child(2)');
        var yearEl  = document.querySelector('#individual-kyc-form .date-select-group select:nth-child(3)');
        if (!dayEl || !monthEl || !yearEl) return;

        dayEl.innerHTML   = '<option value="">Day</option>';
        monthEl.innerHTML = '<option value="">Month</option>';
        yearEl.innerHTML  = '<option value="">Year</option>';

        for (var d = 1; d <= 31; d++) {
            dayEl.innerHTML += '<option value="' + d + '">' + d + '</option>';
        }

        var months = [
            'January','February','March','April','May','June',
            'July','August','September','October','November','December'
        ];
        months.forEach(function(m, i) {
            monthEl.innerHTML += '<option value="' + (i + 1) + '">' + m + '</option>';
        });

        var currentYear = new Date().getFullYear();
        for (var y = currentYear - 18; y >= currentYear - 100; y--) {
            yearEl.innerHTML += '<option value="' + y + '">' + y + '</option>';
        }
    }
    window.populateDobSelectors = populateDobSelectors;


    /* =========================================================================
       §11  ERROR RECOVERY
       ========================================================================= */

    /**
     * Global JS error handler.
     * Logs to console and — on blank-screen detection — reloads once.
     * Uses sessionStorage flag to prevent reload loop.
     */
    window.onerror = function(msg, src, line, col /*, err */) {
        console.error('[Empyrean Error]', msg, 'at', src, line + ':' + col);
        try {
            var mainEl = document.getElementById('main-content') || document.getElementById('app');
            if (mainEl && mainEl.children.length === 0) {
                var key = 'empyrean_blank_recovery';
                if (!sessionStorage.getItem(key)) {
                    sessionStorage.setItem(key, '1');
                    console.warn('[Empyrean] Blank screen detected — reloading once…');
                    location.reload();
                } else {
                    sessionStorage.removeItem(key);
                }
            }
        } catch (_) {}
        return false; // allow default browser error handling
    };

    /**
     * Catch unhandled promise rejections — prevents silent failures swallowing
     * Firebase / Agora errors in production.
     * FIX (2026-08-12): this was a byte-for-byte duplicate of the
     * 'unhandledrejection' listener app-fixes.js also registers on the same
     * window — addEventListener doesn't replace a prior listener the way an
     * onX= assignment would, so BOTH ran on every single rejection, doubling
     * (and, alongside app-patch-v38.js's own diagnostic listener, tripling)
     * every "[Empyrean Promise]" console line — including the real
     * FirebaseError/permission-denied bursts, which made an already-serious
     * error look even noisier than it was. Left as a single source of truth
     * in app-fixes.js (the actively-maintained fix-aggregation file, loaded
     * right alongside its matching window.onerror/blank-screen-guard logic)
     * rather than here.
     */

    /**
     * Blank-screen guard.
     * If a JS error fires and no content section is visible, recover to the
     * dashboard.  Also runs on a 5 s interval for the first 60 s of page load.
     */
    (function _blankScreenGuard() {
        function _checkAndRecover() {
            try {
                var sections   = document.querySelectorAll('.content-section');
                var anyVisible = Array.from(sections).some(function(s) {
                    return s.style.display !== 'none' && s.offsetParent !== null;
                });
                if (!anyVisible) {
                    var dash = document.getElementById('dashboard');
                    if (dash) {
                        dash.style.display = 'block';
                        console.warn('[Empyrean] Blank screen recovered → dashboard');
                    }
                }
            } catch (_) {}
        }

        window.addEventListener('error',            function() { setTimeout(_checkAndRecover, 1200); }, true);
        window.addEventListener('unhandledrejection',function() { setTimeout(_checkAndRecover, 1200); });

        // Periodic safety net: runs every 5 s for the first 60 s
        var _count = 0;
        var _timer = setInterval(function() {
            if (++_count > 12) { clearInterval(_timer); return; }
            if (document.body && document.body.children.length > 2) _checkAndRecover();
        }, 5000);
    })();

    /**
     * Inject the "Read more / Read less" and suggested-user CSS into <head>.
     * Idempotent — checks for existing style tag before inserting.
     */
    (function _injectArticleCollapseCSS() {
        if (document.getElementById('_article_collapse_css')) return;
        var s    = document.createElement('style');
        s.id     = '_article_collapse_css';
        s.textContent = [
            '.story-content { position: relative; }',
            '.news-item-content { position: relative; }',
            '.post-text-rest { display: none; }',
            '.post-read-more, .post-read-less {',
            '  display: inline-block; margin-top: 6px;',
            '  font-size: 0.83rem; font-weight: 700;',
            '  color: var(--secondary, #1B2B8B);',
            '  cursor: pointer; text-decoration: none;',
            '  border: none; background: none; padding: 0;',
            '  transition: opacity 0.15s;',
            '}',
            '.post-read-more:hover, .post-read-less:hover { opacity: 0.7; }',
            '.post-text-overflow { color: inherit; display: inline; }',
            '.suggested-user-card {',
            '  background: white; border-radius: 14px;',
            '  overflow: hidden; border: 1.5px solid rgba(10,14,39,0.08);',
            '  box-shadow: 0 2px 12px rgba(10,14,39,0.07);',
            '  display: flex; flex-direction: column;',
            '  cursor: pointer; transition: box-shadow 0.18s, transform 0.18s;',
            '  min-width: 240px; max-width: 280px; flex-shrink: 0;',
            '}',
            '.suggested-user-card:hover {',
            '  box-shadow: 0 6px 24px rgba(27,43,139,0.14);',
            '  transform: translateY(-2px);',
            '}'
        ].join('\n');
        document.head.appendChild(s);
    })();


    /* =========================================================================
       DONE
       ========================================================================= */
    console.log('[EmpHelpers] ✅ Helper utilities ready.');


    /* =========================================================================
       §10  MARKETPLACE LISTING CURRENCY — legacy USD/blank listings are NGN
       =========================================================================
       FIX (2026-10-22 — "all the current listings are supposed to be NGN"):
       the Sell form's currency <select> had USD pre-selected (index.html), so
       every listing posted without touching it was saved with currency 'USD'
       (and older listings may have no currency at all, which every card
       builder in this codebase falls back to '$' for). A ₦40,100,000 Lexus
       therefore rendered as "$40,100,000.00" — and worse, checkout
       (app-marketplace.js, USD_TO_NGN) would have multiplied that figure by
       the exchange rate when charging the buyer.

       Rule: a listing whose currency is blank or USD and that was created
       BEFORE LISTING_NGN_CUTOFF_MS is NGN. Anything explicitly priced in
       another currency (EUR, GBP, GHS, KES, ...) is left alone, and so is a
       USD listing created on/after the cutoff (the form now defaults to NGN,
       so a later USD listing is a deliberate choice).

       Applied at the single choke point every listing read goes through —
       DocumentSnapshot.data() for the marketplace_listings collection — so
       the dashboard slider, the marketplace grid, seller profiles, the
       listing detail page, the cart and the checkout payload all see NGN
       without each card builder needing its own patch.
       ========================================================================= */
    var LISTING_NGN_CUTOFF_MS = Date.UTC(2026, 9, 23); // 23 Oct 2026 00:00 UTC

    function _listingCreatedMs(d) {
        var c = d && d.createdAt;
        if (!c) return 0;
        if (typeof c === 'number') return c;
        if (typeof c.toMillis === 'function') { try { return c.toMillis(); } catch (e) {} }
        if (typeof c.seconds === 'number') return c.seconds * 1000;
        var t = new Date(c).getTime();
        return isNaN(t) ? 0 : t;
    }

    function empListingCurrency(item, rawCurrency) {
        var raw = rawCurrency != null ? rawCurrency : (item && item.currency);
        var cur = raw ? String(raw).toUpperCase() : '';
        if (cur && cur !== 'USD') return cur;
        var ms = _listingCreatedMs(item);
        if (!ms || ms < LISTING_NGN_CUTOFF_MS) return 'NGN';
        return cur || 'NGN';
    }
    window._empListingCurrency = empListingCurrency;

    function _installListingCurrencyNormalizer() {
        if (window._empListingCurrencyPatched) return true;
        if (!window.firebase || !firebase.firestore) return false;
        var patched = false;
        ['DocumentSnapshot', 'QueryDocumentSnapshot'].forEach(function (name) {
            var C = firebase.firestore[name];
            var proto = C && C.prototype;
            if (!proto || typeof proto.data !== 'function' || proto.data._empListingCur) return;
            var orig = proto.data;
            var wrapped = function () {
                var d = orig.apply(this, arguments);
                try {
                    if (d && typeof d === 'object' && this.ref && this.ref.parent &&
                        this.ref.parent.id === 'marketplace_listings') {
                        d.currency = empListingCurrency(d);
                        if (d.displayCurrency) d.displayCurrency = empListingCurrency(d, d.displayCurrency);
                    }
                } catch (e) { /* never let a display normalizer break a Firestore read */ }
                return d;
            };
            wrapped._empListingCur = true;
            proto.data = wrapped;
            patched = true;
        });
        if (patched) window._empListingCurrencyPatched = true;
        return patched;
    }
    if (!_installListingCurrencyNormalizer()) {
        window.addEventListener('empyrean:firebase-ready', _installListingCurrencyNormalizer);
        setTimeout(_installListingCurrencyNormalizer, 1500);
    }

})();


/* =============================================================================
   §12  PROFILE QR SHARE CARD
   =============================================================================
   FEATURE (request — "add a QR code where the profile share link is, so users
   can share the link and as well scan to follow", laid out exactly like the
   TikTok-style QR card in the reference screenshot): the profile page's
   Share button (.share-profile-btn, handled in app-fixes.js) used to fire the
   OS share sheet / clipboard straight away. It now calls
   window.empOpenProfileQr(), which opens a full-screen card — rounded white
   panel, avatar overlapping its top edge, NAME, @username, a dotted-module QR
   code that encodes the very same '?post=profile-<uid>' share link, then
   "Copy link" / "Share link" buttons and "Tap background to change style".
   Scanning the code opens that profile (app-startup.js's boot-time deep-link
   handler already resolves '?post=profile-<uid>'), where the Follow button is.
   The top-right scan icon opens an in-app scanner (BarcodeDetector) so users
   can follow someone by scanning their code without leaving Empyrean.

   Self-contained on purpose (this file only — no new file): the encoder below
   is qrcode-generator by Kazuhiko Arase (MIT licence, minified), used purely
   to compute which modules are dark. The dotted rendering, finder-pattern
   rings and accent dots are drawn by renderQrSvg() so the look matches the
   reference. Accent dots use darker cyan/red tones (and ECC level M) so the
   code still scans on a phone camera.
   ========================================================================= */
(function empyreanProfileQrModule() {
    'use strict';
    if (window.empOpenProfileQr) return;

    /* ── QR encoder (qrcode-generator, MIT) ─────────────────────────────── */
    var qrcode = (function () {
var qrcode=function(){var t=function(t,r){var e=t,n=g[r],o=null,i=0,a=null,u=[],f={},c=function(t,r){o=function(t){for(var r=new Array(t),e=0;e<t;e+=1){r[e]=new Array(t);for(var n=0;n<t;n+=1)r[e][n]=null}return r}(i=4*e+17),l(0,0),l(i-7,0),l(0,i-7),s(),h(),d(t,r),e>=7&&v(t),null==a&&(a=p(e,n,u)),w(a,r)},l=function(t,r){for(var e=-1;e<=7;e+=1)if(!(t+e<=-1||i<=t+e))for(var n=-1;n<=7;n+=1)r+n<=-1||i<=r+n||(o[t+e][r+n]=0<=e&&e<=6&&(0==n||6==n)||0<=n&&n<=6&&(0==e||6==e)||2<=e&&e<=4&&2<=n&&n<=4)},h=function(){for(var t=8;t<i-8;t+=1)null==o[t][6]&&(o[t][6]=t%2==0);for(var r=8;r<i-8;r+=1)null==o[6][r]&&(o[6][r]=r%2==0)},s=function(){for(var t=B.getPatternPosition(e),r=0;r<t.length;r+=1)for(var n=0;n<t.length;n+=1){var i=t[r],a=t[n];if(null==o[i][a])for(var u=-2;u<=2;u+=1)for(var f=-2;f<=2;f+=1)o[i+u][a+f]=-2==u||2==u||-2==f||2==f||0==u&&0==f}},v=function(t){for(var r=B.getBCHTypeNumber(e),n=0;n<18;n+=1){var a=!t&&1==(r>>n&1);o[Math.floor(n/3)][n%3+i-8-3]=a}for(n=0;n<18;n+=1){a=!t&&1==(r>>n&1);o[n%3+i-8-3][Math.floor(n/3)]=a}},d=function(t,r){for(var e=n<<3|r,a=B.getBCHTypeInfo(e),u=0;u<15;u+=1){var f=!t&&1==(a>>u&1);u<6?o[u][8]=f:u<8?o[u+1][8]=f:o[i-15+u][8]=f}for(u=0;u<15;u+=1){f=!t&&1==(a>>u&1);u<8?o[8][i-u-1]=f:u<9?o[8][15-u-1+1]=f:o[8][15-u-1]=f}o[i-8][8]=!t},w=function(t,r){for(var e=-1,n=i-1,a=7,u=0,f=B.getMaskFunction(r),c=i-1;c>0;c-=2)for(6==c&&(c-=1);;){for(var g=0;g<2;g+=1)if(null==o[n][c-g]){var l=!1;u<t.length&&(l=1==(t[u]>>>a&1)),f(n,c-g)&&(l=!l),o[n][c-g]=l,-1==(a-=1)&&(u+=1,a=7)}if((n+=e)<0||i<=n){n-=e,e=-e;break}}},p=function(t,r,e){for(var n=A.getRSBlocks(t,r),o=b(),i=0;i<e.length;i+=1){var a=e[i];o.put(a.getMode(),4),o.put(a.getLength(),B.getLengthInBits(a.getMode(),t)),a.write(o)}var u=0;for(i=0;i<n.length;i+=1)u+=n[i].dataCount;if(o.getLengthInBits()>8*u)throw"code length overflow. ("+o.getLengthInBits()+">"+8*u+")";for(o.getLengthInBits()+4<=8*u&&o.put(0,4);o.getLengthInBits()%8!=0;)o.putBit(!1);for(;!(o.getLengthInBits()>=8*u||(o.put(236,8),o.getLengthInBits()>=8*u));)o.put(17,8);return function(t,r){for(var e=0,n=0,o=0,i=new Array(r.length),a=new Array(r.length),u=0;u<r.length;u+=1){var f=r[u].dataCount,c=r[u].totalCount-f;n=Math.max(n,f),o=Math.max(o,c),i[u]=new Array(f);for(var g=0;g<i[u].length;g+=1)i[u][g]=255&t.getBuffer()[g+e];e+=f;var l=B.getErrorCorrectPolynomial(c),h=k(i[u],l.getLength()-1).mod(l);for(a[u]=new Array(l.getLength()-1),g=0;g<a[u].length;g+=1){var s=g+h.getLength()-a[u].length;a[u][g]=s>=0?h.getAt(s):0}}var v=0;for(g=0;g<r.length;g+=1)v+=r[g].totalCount;var d=new Array(v),w=0;for(g=0;g<n;g+=1)for(u=0;u<r.length;u+=1)g<i[u].length&&(d[w]=i[u][g],w+=1);for(g=0;g<o;g+=1)for(u=0;u<r.length;u+=1)g<a[u].length&&(d[w]=a[u][g],w+=1);return d}(o,n)};f.addData=function(t,r){var e=null;switch(r=r||"Byte"){case"Numeric":e=M(t);break;case"Alphanumeric":e=x(t);break;case"Byte":e=m(t);break;case"Kanji":e=L(t);break;default:throw"mode:"+r}u.push(e),a=null},f.isDark=function(t,r){if(t<0||i<=t||r<0||i<=r)throw t+","+r;return o[t][r]},f.getModuleCount=function(){return i},f.make=function(){if(e<1){for(var t=1;t<40;t++){for(var r=A.getRSBlocks(t,n),o=b(),i=0;i<u.length;i++){var a=u[i];o.put(a.getMode(),4),o.put(a.getLength(),B.getLengthInBits(a.getMode(),t)),a.write(o)}var g=0;for(i=0;i<r.length;i++)g+=r[i].dataCount;if(o.getLengthInBits()<=8*g)break}e=t}c(!1,function(){for(var t=0,r=0,e=0;e<8;e+=1){c(!0,e);var n=B.getLostPoint(f);(0==e||t>n)&&(t=n,r=e)}return r}())},f.createTableTag=function(t,r){t=t||2;var e="";e+='<table style="',e+=" border-width: 0px; border-style: none;",e+=" border-collapse: collapse;",e+=" padding: 0px; margin: "+(r=void 0===r?4*t:r)+"px;",e+='">',e+="<tbody>";for(var n=0;n<f.getModuleCount();n+=1){e+="<tr>";for(var o=0;o<f.getModuleCount();o+=1)e+='<td style="',e+=" border-width: 0px; border-style: none;",e+=" border-collapse: collapse;",e+=" padding: 0px; margin: 0px;",e+=" width: "+t+"px;",e+=" height: "+t+"px;",e+=" background-color: ",e+=f.isDark(n,o)?"#000000":"#ffffff",e+=";",e+='"/>';e+="</tr>"}return e+="</tbody>",e+="</table>"},f.createSvgTag=function(t,r,e,n){var o={};"object"==typeof arguments[0]&&(t=(o=arguments[0]).cellSize,r=o.margin,e=o.alt,n=o.title),t=t||2,r=void 0===r?4*t:r,(e="string"==typeof e?{text:e}:e||{}).text=e.text||null,e.id=e.text?e.id||"qrcode-description":null,(n="string"==typeof n?{text:n}:n||{}).text=n.text||null,n.id=n.text?n.id||"qrcode-title":null;var i,a,u,c,g=f.getModuleCount()*t+2*r,l="";for(c="l"+t+",0 0,"+t+" -"+t+",0 0,-"+t+"z ",l+='<svg version="1.1" xmlns="http://www.w3.org/2000/svg"',l+=o.scalable?"":' width="'+g+'px" height="'+g+'px"',l+=' viewBox="0 0 '+g+" "+g+'" ',l+=' preserveAspectRatio="xMinYMin meet"',l+=n.text||e.text?' role="img" aria-labelledby="'+y([n.id,e.id].join(" ").trim())+'"':"",l+=">",l+=n.text?'<title id="'+y(n.id)+'">'+y(n.text)+"</title>":"",l+=e.text?'<description id="'+y(e.id)+'">'+y(e.text)+"</description>":"",l+='<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>',l+='<path d="',a=0;a<f.getModuleCount();a+=1)for(u=a*t+r,i=0;i<f.getModuleCount();i+=1)f.isDark(a,i)&&(l+="M"+(i*t+r)+","+u+c);return l+='" stroke="transparent" fill="black"/>',l+="</svg>"},f.createDataURL=function(t,r){t=t||2,r=void 0===r?4*t:r;var e=f.getModuleCount()*t+2*r,n=r,o=e-r;return I(e,e,function(r,e){if(n<=r&&r<o&&n<=e&&e<o){var i=Math.floor((r-n)/t),a=Math.floor((e-n)/t);return f.isDark(a,i)?0:1}return 1})},f.createImgTag=function(t,r,e){t=t||2,r=void 0===r?4*t:r;var n=f.getModuleCount()*t+2*r,o="";return o+="<img",o+=' src="',o+=f.createDataURL(t,r),o+='"',o+=' width="',o+=n,o+='"',o+=' height="',o+=n,o+='"',e&&(o+=' alt="',o+=y(e),o+='"'),o+="/>"};var y=function(t){for(var r="",e=0;e<t.length;e+=1){var n=t.charAt(e);switch(n){case"<":r+="&lt;";break;case">":r+="&gt;";break;case"&":r+="&amp;";break;case'"':r+="&quot;";break;default:r+=n}}return r};return f.createASCII=function(t,r){if((t=t||1)<2)return function(t){t=void 0===t?2:t;var r,e,n,o,i,a=1*f.getModuleCount()+2*t,u=t,c=a-t,g={"██":"█","█ ":"▀"," █":"▄","  ":" "},l={"██":"▀","█ ":"▀"," █":" ","  ":" "},h="";for(r=0;r<a;r+=2){for(n=Math.floor((r-u)/1),o=Math.floor((r+1-u)/1),e=0;e<a;e+=1)i="█",u<=e&&e<c&&u<=r&&r<c&&f.isDark(n,Math.floor((e-u)/1))&&(i=" "),u<=e&&e<c&&u<=r+1&&r+1<c&&f.isDark(o,Math.floor((e-u)/1))?i+=" ":i+="█",h+=t<1&&r+1>=c?l[i]:g[i];h+="\n"}return a%2&&t>0?h.substring(0,h.length-a-1)+Array(a+1).join("▀"):h.substring(0,h.length-1)}(r);t-=1,r=void 0===r?2*t:r;var e,n,o,i,a=f.getModuleCount()*t+2*r,u=r,c=a-r,g=Array(t+1).join("██"),l=Array(t+1).join("  "),h="",s="";for(e=0;e<a;e+=1){for(o=Math.floor((e-u)/t),s="",n=0;n<a;n+=1)i=1,u<=n&&n<c&&u<=e&&e<c&&f.isDark(o,Math.floor((n-u)/t))&&(i=0),s+=i?g:l;for(o=0;o<t;o+=1)h+=s+"\n"}return h.substring(0,h.length-1)},f.renderTo2dContext=function(t,r){r=r||2;for(var e=f.getModuleCount(),n=0;n<e;n++)for(var o=0;o<e;o++)t.fillStyle=f.isDark(n,o)?"black":"white",t.fillRect(o*r,n*r,r,r)},f};t.stringToBytes=(t.stringToBytesFuncs={default:function(t){for(var r=[],e=0;e<t.length;e+=1){var n=t.charCodeAt(e);r.push(255&n)}return r}}).default,t.createStringToBytes=function(t,r){var e=function(){for(var e=S(t),n=function(){var t=e.read();if(-1==t)throw"eof";return t},o=0,i={};;){var a=e.read();if(-1==a)break;var u=n(),f=n()<<8|n();i[String.fromCharCode(a<<8|u)]=f,o+=1}if(o!=r)throw o+" != "+r;return i}(),n="?".charCodeAt(0);return function(t){for(var r=[],o=0;o<t.length;o+=1){var i=t.charCodeAt(o);if(i<128)r.push(i);else{var a=e[t.charAt(o)];"number"==typeof a?(255&a)==a?r.push(a):(r.push(a>>>8),r.push(255&a)):r.push(n)}}return r}};var r,e,n,o,i,a=1,u=2,f=4,c=8,g={L:1,M:0,Q:3,H:2},l=0,h=1,s=2,v=3,d=4,w=5,p=6,y=7,B=(r=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]],e=1335,n=7973,i=function(t){for(var r=0;0!=t;)r+=1,t>>>=1;return r},(o={}).getBCHTypeInfo=function(t){for(var r=t<<10;i(r)-i(e)>=0;)r^=e<<i(r)-i(e);return 21522^(t<<10|r)},o.getBCHTypeNumber=function(t){for(var r=t<<12;i(r)-i(n)>=0;)r^=n<<i(r)-i(n);return t<<12|r},o.getPatternPosition=function(t){return r[t-1]},o.getMaskFunction=function(t){switch(t){case l:return function(t,r){return(t+r)%2==0};case h:return function(t,r){return t%2==0};case s:return function(t,r){return r%3==0};case v:return function(t,r){return(t+r)%3==0};case d:return function(t,r){return(Math.floor(t/2)+Math.floor(r/3))%2==0};case w:return function(t,r){return t*r%2+t*r%3==0};case p:return function(t,r){return(t*r%2+t*r%3)%2==0};case y:return function(t,r){return(t*r%3+(t+r)%2)%2==0};default:throw"bad maskPattern:"+t}},o.getErrorCorrectPolynomial=function(t){for(var r=k([1],0),e=0;e<t;e+=1)r=r.multiply(k([1,C.gexp(e)],0));return r},o.getLengthInBits=function(t,r){if(1<=r&&r<10)switch(t){case a:return 10;case u:return 9;case f:case c:return 8;default:throw"mode:"+t}else if(r<27)switch(t){case a:return 12;case u:return 11;case f:return 16;case c:return 10;default:throw"mode:"+t}else{if(!(r<41))throw"type:"+r;switch(t){case a:return 14;case u:return 13;case f:return 16;case c:return 12;default:throw"mode:"+t}}},o.getLostPoint=function(t){for(var r=t.getModuleCount(),e=0,n=0;n<r;n+=1)for(var o=0;o<r;o+=1){for(var i=0,a=t.isDark(n,o),u=-1;u<=1;u+=1)if(!(n+u<0||r<=n+u))for(var f=-1;f<=1;f+=1)o+f<0||r<=o+f||0==u&&0==f||a==t.isDark(n+u,o+f)&&(i+=1);i>5&&(e+=3+i-5)}for(n=0;n<r-1;n+=1)for(o=0;o<r-1;o+=1){var c=0;t.isDark(n,o)&&(c+=1),t.isDark(n+1,o)&&(c+=1),t.isDark(n,o+1)&&(c+=1),t.isDark(n+1,o+1)&&(c+=1),0!=c&&4!=c||(e+=3)}for(n=0;n<r;n+=1)for(o=0;o<r-6;o+=1)t.isDark(n,o)&&!t.isDark(n,o+1)&&t.isDark(n,o+2)&&t.isDark(n,o+3)&&t.isDark(n,o+4)&&!t.isDark(n,o+5)&&t.isDark(n,o+6)&&(e+=40);for(o=0;o<r;o+=1)for(n=0;n<r-6;n+=1)t.isDark(n,o)&&!t.isDark(n+1,o)&&t.isDark(n+2,o)&&t.isDark(n+3,o)&&t.isDark(n+4,o)&&!t.isDark(n+5,o)&&t.isDark(n+6,o)&&(e+=40);var g=0;for(o=0;o<r;o+=1)for(n=0;n<r;n+=1)t.isDark(n,o)&&(g+=1);return e+=Math.abs(100*g/r/r-50)/5*10},o),C=function(){for(var t=new Array(256),r=new Array(256),e=0;e<8;e+=1)t[e]=1<<e;for(e=8;e<256;e+=1)t[e]=t[e-4]^t[e-5]^t[e-6]^t[e-8];for(e=0;e<255;e+=1)r[t[e]]=e;var n={glog:function(t){if(t<1)throw"glog("+t+")";return r[t]},gexp:function(r){for(;r<0;)r+=255;for(;r>=256;)r-=255;return t[r]}};return n}();function k(t,r){if(void 0===t.length)throw t.length+"/"+r;var e=function(){for(var e=0;e<t.length&&0==t[e];)e+=1;for(var n=new Array(t.length-e+r),o=0;o<t.length-e;o+=1)n[o]=t[o+e];return n}(),n={getAt:function(t){return e[t]},getLength:function(){return e.length},multiply:function(t){for(var r=new Array(n.getLength()+t.getLength()-1),e=0;e<n.getLength();e+=1)for(var o=0;o<t.getLength();o+=1)r[e+o]^=C.gexp(C.glog(n.getAt(e))+C.glog(t.getAt(o)));return k(r,0)},mod:function(t){if(n.getLength()-t.getLength()<0)return n;for(var r=C.glog(n.getAt(0))-C.glog(t.getAt(0)),e=new Array(n.getLength()),o=0;o<n.getLength();o+=1)e[o]=n.getAt(o);for(o=0;o<t.getLength();o+=1)e[o]^=C.gexp(C.glog(t.getAt(o))+r);return k(e,0).mod(t)}};return n}var A=function(){var t=[[1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],[1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]],r=function(t,r){var e={};return e.totalCount=t,e.dataCount=r,e},e={};return e.getRSBlocks=function(e,n){var o=function(r,e){switch(e){case g.L:return t[4*(r-1)+0];case g.M:return t[4*(r-1)+1];case g.Q:return t[4*(r-1)+2];case g.H:return t[4*(r-1)+3];default:return}}(e,n);if(void 0===o)throw"bad rs block @ typeNumber:"+e+"/errorCorrectionLevel:"+n;for(var i=o.length/3,a=[],u=0;u<i;u+=1)for(var f=o[3*u+0],c=o[3*u+1],l=o[3*u+2],h=0;h<f;h+=1)a.push(r(c,l));return a},e}(),b=function(){var t=[],r=0,e={getBuffer:function(){return t},getAt:function(r){var e=Math.floor(r/8);return 1==(t[e]>>>7-r%8&1)},put:function(t,r){for(var n=0;n<r;n+=1)e.putBit(1==(t>>>r-n-1&1))},getLengthInBits:function(){return r},putBit:function(e){var n=Math.floor(r/8);t.length<=n&&t.push(0),e&&(t[n]|=128>>>r%8),r+=1}};return e},M=function(t){var r=a,e=t,n={getMode:function(){return r},getLength:function(t){return e.length},write:function(t){for(var r=e,n=0;n+2<r.length;)t.put(o(r.substring(n,n+3)),10),n+=3;n<r.length&&(r.length-n==1?t.put(o(r.substring(n,n+1)),4):r.length-n==2&&t.put(o(r.substring(n,n+2)),7))}},o=function(t){for(var r=0,e=0;e<t.length;e+=1)r=10*r+i(t.charAt(e));return r},i=function(t){if("0"<=t&&t<="9")return t.charCodeAt(0)-"0".charCodeAt(0);throw"illegal char :"+t};return n},x=function(t){var r=u,e=t,n={getMode:function(){return r},getLength:function(t){return e.length},write:function(t){for(var r=e,n=0;n+1<r.length;)t.put(45*o(r.charAt(n))+o(r.charAt(n+1)),11),n+=2;n<r.length&&t.put(o(r.charAt(n)),6)}},o=function(t){if("0"<=t&&t<="9")return t.charCodeAt(0)-"0".charCodeAt(0);if("A"<=t&&t<="Z")return t.charCodeAt(0)-"A".charCodeAt(0)+10;switch(t){case" ":return 36;case"$":return 37;case"%":return 38;case"*":return 39;case"+":return 40;case"-":return 41;case".":return 42;case"/":return 43;case":":return 44;default:throw"illegal char :"+t}};return n},m=function(r){var e=f,n=t.stringToBytes(r),o={getMode:function(){return e},getLength:function(t){return n.length},write:function(t){for(var r=0;r<n.length;r+=1)t.put(n[r],8)}};return o},L=function(r){var e=c,n=t.stringToBytesFuncs.SJIS;if(!n)throw"sjis not supported.";!function(){var t=n("友");if(2!=t.length||38726!=(t[0]<<8|t[1]))throw"sjis not supported."}();var o=n(r),i={getMode:function(){return e},getLength:function(t){return~~(o.length/2)},write:function(t){for(var r=o,e=0;e+1<r.length;){var n=(255&r[e])<<8|255&r[e+1];if(33088<=n&&n<=40956)n-=33088;else{if(!(57408<=n&&n<=60351))throw"illegal char at "+(e+1)+"/"+n;n-=49472}n=192*(n>>>8&255)+(255&n),t.put(n,13),e+=2}if(e<r.length)throw"illegal char at "+(e+1)}};return i},D=function(){var t=[],r={writeByte:function(r){t.push(255&r)},writeShort:function(t){r.writeByte(t),r.writeByte(t>>>8)},writeBytes:function(t,e,n){e=e||0,n=n||t.length;for(var o=0;o<n;o+=1)r.writeByte(t[o+e])},writeString:function(t){for(var e=0;e<t.length;e+=1)r.writeByte(t.charCodeAt(e))},toByteArray:function(){return t},toString:function(){var r="";r+="[";for(var e=0;e<t.length;e+=1)e>0&&(r+=","),r+=t[e];return r+="]"}};return r},S=function(t){var r=t,e=0,n=0,o=0,i={read:function(){for(;o<8;){if(e>=r.length){if(0==o)return-1;throw"unexpected end of file./"+o}var t=r.charAt(e);if(e+=1,"="==t)return o=0,-1;t.match(/^\s$/)||(n=n<<6|a(t.charCodeAt(0)),o+=6)}var i=n>>>o-8&255;return o-=8,i}},a=function(t){if(65<=t&&t<=90)return t-65;if(97<=t&&t<=122)return t-97+26;if(48<=t&&t<=57)return t-48+52;if(43==t)return 62;if(47==t)return 63;throw"c:"+t};return i},I=function(t,r,e){for(var n=function(t,r){var e=t,n=r,o=new Array(t*r),i={setPixel:function(t,r,n){o[r*e+t]=n},write:function(t){t.writeString("GIF87a"),t.writeShort(e),t.writeShort(n),t.writeByte(128),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(255),t.writeByte(255),t.writeByte(255),t.writeString(","),t.writeShort(0),t.writeShort(0),t.writeShort(e),t.writeShort(n),t.writeByte(0);var r=a(2);t.writeByte(2);for(var o=0;r.length-o>255;)t.writeByte(255),t.writeBytes(r,o,255),o+=255;t.writeByte(r.length-o),t.writeBytes(r,o,r.length-o),t.writeByte(0),t.writeString(";")}},a=function(t){for(var r=1<<t,e=1+(1<<t),n=t+1,i=u(),a=0;a<r;a+=1)i.add(String.fromCharCode(a));i.add(String.fromCharCode(r)),i.add(String.fromCharCode(e));var f,c,g,l=D(),h=(f=l,c=0,g=0,{write:function(t,r){if(t>>>r!=0)throw"length over";for(;c+r>=8;)f.writeByte(255&(t<<c|g)),r-=8-c,t>>>=8-c,g=0,c=0;g|=t<<c,c+=r},flush:function(){c>0&&f.writeByte(g)}});h.write(r,n);var s=0,v=String.fromCharCode(o[s]);for(s+=1;s<o.length;){var d=String.fromCharCode(o[s]);s+=1,i.contains(v+d)?v+=d:(h.write(i.indexOf(v),n),i.size()<4095&&(i.size()==1<<n&&(n+=1),i.add(v+d)),v=d)}return h.write(i.indexOf(v),n),h.write(e,n),h.flush(),l.toByteArray()},u=function(){var t={},r=0,e={add:function(n){if(e.contains(n))throw"dup key:"+n;t[n]=r,r+=1},size:function(){return r},indexOf:function(r){return t[r]},contains:function(r){return void 0!==t[r]}};return e};return i}(t,r),o=0;o<r;o+=1)for(var i=0;i<t;i+=1)n.setPixel(i,o,e(i,o));var a=D();n.write(a);for(var u=function(){var t=0,r=0,e=0,n="",o={},i=function(t){n+=String.fromCharCode(a(63&t))},a=function(t){if(t<0);else{if(t<26)return 65+t;if(t<52)return t-26+97;if(t<62)return t-52+48;if(62==t)return 43;if(63==t)return 47}throw"n:"+t};return o.writeByte=function(n){for(t=t<<8|255&n,r+=8,e+=1;r>=6;)i(t>>>r-6),r-=6},o.flush=function(){if(r>0&&(i(t<<6-r),t=0,r=0),e%3!=0)for(var o=3-e%3,a=0;a<o;a+=1)n+="="},o.toString=function(){return n},o}(),f=a.toByteArray(),c=0;c<f.length;c+=1)u.writeByte(f[c]);return u.flush(),"data:image/gif;base64,"+u};return t}();qrcode.stringToBytesFuncs["UTF-8"]=function(t){return function(t){for(var r=[],e=0;e<t.length;e++){var n=t.charCodeAt(e);n<128?r.push(n):n<2048?r.push(192|n>>6,128|63&n):n<55296||n>=57344?r.push(224|n>>12,128|n>>6&63,128|63&n):(e++,n=65536+((1023&n)<<10|1023&t.charCodeAt(e)),r.push(240|n>>18,128|n>>12&63,128|n>>6&63,128|63&n))}return r}(t)};
        return qrcode;
    })();

    /* ── helpers ────────────────────────────────────────────────────────── */
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Render `text` as a TikTok-style dotted QR (SVG string).
     * Round data dots, ring-and-dot finder patterns, a few red/cyan accent dots.
     */
    function renderQrSvg(text) {
        var q = qrcode(0, 'M');
        q.addData(String(text), 'Byte');
        q.make();
        var n = q.getModuleCount();
        var R = 0.43;                        // data-dot radius (modules)
        var black = '', red = '', cyan = '';
        function inFinder(r, c) {
            return (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
        }
        for (var r = 0; r < n; r++) {
            for (var c = 0; c < n; c++) {
                if (!q.isDark(r, c) || inFinder(r, c)) continue;
                var h = (((r + 1) * 73856093) ^ ((c + 1) * 19349663)) >>> 0;
                h = h % 100;
                var d = 'M' + (c + 0.5 - R) + ' ' + (r + 0.5)
                    + 'a' + R + ' ' + R + ' 0 1 0 ' + (2 * R) + ' 0'
                    + 'a' + R + ' ' + R + ' 0 1 0 ' + (-2 * R) + ' 0';
                if (h < 3) red += d; else if (h < 6) cyan += d; else black += d;
            }
        }
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.5 -0.5 ' + (n + 1) + ' ' + (n + 1)
            + '" shape-rendering="geometricPrecision" role="img" aria-label="Profile QR code">'
            + '<rect x="-0.5" y="-0.5" width="' + (n + 1) + '" height="' + (n + 1) + '" fill="#fff"/>'
            + '<path d="' + black + '" fill="#0A0E27"/>'
            + '<path d="' + red + '" fill="#1B2B8B"/>'
            + '<path d="' + cyan + '" fill="#1B2B8B"/>';
        [[0, 0], [n - 7, 0], [0, n - 7]].forEach(function (p) {
            var cx = p[0] + 3.5, cy = p[1] + 3.5;
            svg += '<circle cx="' + cx + '" cy="' + cy + '" r="3.05" fill="#fff" stroke="#0A0E27" stroke-width="0.9"/>'
                + '<circle cx="' + (cx - 0.13) + '" cy="' + cy + '" r="1.7" fill="#1B2B8B"/>'
                + '<circle cx="' + (cx + 0.13) + '" cy="' + cy + '" r="1.7" fill="#1B2B8B"/>'
                + '<circle cx="' + cx + '" cy="' + cy + '" r="1.66" fill="#0A0E27"/>';
        });
        return svg + '</svg>';
    }
    window.empRenderQrSvg = renderQrSvg;

    function copyText(t) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(t);
        }
        return new Promise(function (resolve, reject) {
            var ta = document.createElement('textarea');
            ta.value = t;
            ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); }
            catch (e) { reject(e); }
            ta.remove();
        });
    }

    /* "Tap background to change style" — swirl backgrounds */
    var BACKGROUNDS = ['#1B2B8B', '#1E5BFF', '#0A1F8F', '#0A0E27'];   // plain solid blues (tap the background to cycle)
    function readBg() {
        try { var v = parseInt(localStorage.getItem('empQrBg'), 10); if (v >= 0 && v < BACKGROUNDS.length) return v; } catch (e) {}
        return 0;
    }
    function saveBg(i) { try { localStorage.setItem('empQrBg', String(i)); } catch (e) {} }

    var ICONS = {
        back: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M11 5l-7 7 7 7"/></svg>',
        scan: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M3 12h18"/></svg>',
        link: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 12 21.07l1.5-1.5"/></svg>',
        share: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/></svg>'
    };

    function injectCss() {
        if (document.getElementById('emp-qr-css')) return;
        var s = document.createElement('style');
        s.id = 'emp-qr-css';
        s.textContent = [
            '.empqr{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;overflow-y:auto;-webkit-overflow-scrolling:touch;color:#fff;font-family:var(--font-sans,Manrope,system-ui,sans-serif);background-color:#02060f;background-size:cover;background-position:center;padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0);animation:empqrIn .2s ease-out;}',
            '@keyframes empqrIn{from{opacity:0}to{opacity:1}}',
            '.empqr-top{width:100%;display:flex;justify-content:space-between;align-items:center;padding:12px 14px;flex-shrink:0;}',
            '.empqr-icon{width:48px;height:48px;border:0;background:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
            '.empqr-main{flex:1 0 auto;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:58px 0 4px;}',
            '.empqr-card{position:relative;width:min(86vw,360px);box-sizing:border-box;background:#fff;color:#0A0E27;border-radius:28px;padding:62px 18px 34px;text-align:center;}',
            '.empqr-av{position:absolute;top:-52px;left:50%;transform:translateX(-50%);width:104px;height:104px;border-radius:50%;background:#fff;padding:4px;box-sizing:border-box;overflow:hidden;}',
            '.empqr-av img,.empqr-av span{width:100%;height:100%;border-radius:50%;object-fit:cover;display:flex;align-items:center;justify-content:center;background:#1B2B8B;color:#fff;font-weight:800;font-size:2rem;}',
            '.empqr-name{margin:4px 6px 2px;font-weight:800;font-size:1.3rem;line-height:1.2;letter-spacing:.2px;text-transform:uppercase;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;}',
            '.empqr-user{color:#1B2B8B;font-weight:700;font-size:1.05rem;margin-bottom:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.empqr-code{width:80%;margin:0 auto;}',
            '.empqr-code svg{display:block;width:100%;height:auto;}',
            '.empqr-actions{display:flex;gap:10px;width:min(86vw,360px);margin-top:10px;}',
            '.empqr-act{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 8px 13px;border:0;border-radius:24px;background:#fff;color:#1B2B8B;font-family:inherit;font-weight:700;font-size:1rem;line-height:1.2;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
            '.empqr-act:active{transform:scale(.98);}',
            '.empqr-hint{flex-shrink:0;padding:18px 16px 24px;text-align:center;font-size:1rem;opacity:.88;}',
            '.empqs{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;background:rgba(5,8,25,.6);animation:empqrIn .18s ease-out;font-family:var(--font-sans,Manrope,system-ui,sans-serif);}',
            '.empqs-sheet{position:relative;width:min(100%,420px);box-sizing:border-box;background:#fff;color:#0A0E27;border-top:4px solid #1B2B8B;border-radius:24px 24px 0 0;padding:14px 18px calc(env(safe-area-inset-bottom,0px) + 18px);text-align:center;animation:empqsUp .22s ease-out;}',
            '@keyframes empqsUp{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}',
            '.empqs-x{position:absolute;top:8px;right:8px;width:38px;height:38px;border:0;background:none;color:#1B2B8B;font-size:1.5rem;line-height:1;cursor:pointer;}',
            '.empqs-name{font-weight:800;font-size:1.02rem;margin:2px 36px 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.empqs-sub{color:#1B2B8B;font-size:.8rem;font-weight:600;margin-bottom:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.empqs-qr{width:148px;margin:0 auto 12px;background:#fff;border-radius:16px;padding:7px;box-sizing:border-box;border:3px solid #1B2B8B;}',
            '.empqs-qr svg{display:block;width:100%;height:auto;}',
            '.empqs-row{display:flex;justify-content:space-between;gap:2px;}',
            '.empqs-b{flex:1;min-width:0;letter-spacing:-.2px;display:flex;flex-direction:column;align-items:center;gap:5px;border:0;background:none;color:#0A0E27;font-family:inherit;font-weight:600;font-size:.66rem;line-height:1.15;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
            '.empqs-b i{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.3rem;color:#fff;font-style:normal;}',
            '.empqs-b:active{transform:scale(.95);}',
            '.empqr-scan{position:fixed;inset:0;z-index:2147483001;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;}',
            '.empqr-scan video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}',
            '.empqr-scan .empqr-icon{position:absolute;top:calc(env(safe-area-inset-top,0px) + 12px);left:14px;z-index:2;}',
            '.empqr-frame{position:relative;z-index:1;width:min(68vw,280px);aspect-ratio:1;border:3px solid #fff;border-radius:24px;box-shadow:0 0 0 100vmax rgba(0,0,0,.55);}',
            '.empqr-msg{position:absolute;z-index:2;left:16px;right:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 40px);text-align:center;font-weight:600;text-shadow:0 1px 6px rgba(0,0,0,.7);}'
        ].join('\n');
        document.head.appendChild(s);
    }

    /* ── in-app scanner (scan someone's code → open their profile) ──────── */
    function openScanner(host) {
        var msgEl;
        function say(t) {
            if (!msgEl) return;
            msgEl.textContent = t;
        }
        var supported = ('BarcodeDetector' in window) && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
        var wrap = document.createElement('div');
        wrap.className = 'empqr-scan';
        wrap.innerHTML = '<button type="button" class="empqr-icon" aria-label="Close scanner">' + ICONS.back + '</button>'
            + '<video playsinline muted></video><div class="empqr-frame"></div>'
            + '<div class="empqr-msg"></div>';
        msgEl = wrap.querySelector('.empqr-msg');
        host.appendChild(wrap);

        var stream = null, timer = null, done = false;
        function stop() {
            done = true;
            if (timer) clearInterval(timer);
            if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
            wrap.remove();
        }
        wrap.querySelector('.empqr-icon').addEventListener('click', function (e) { e.stopPropagation(); stop(); });
        wrap.addEventListener('click', function (e) { e.stopPropagation(); });

        if (!supported) {
            say('Scanning isn\'t supported in this browser. Open your phone camera and point it at the QR code.');
            return;
        }
        var detector;
        try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); }
        catch (e) { say('Scanning isn\'t supported in this browser. Open your phone camera and point it at the QR code.'); return; }

        say('Point the camera at an Empyrean QR code');
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
            .then(function (s) {
                if (done) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
                stream = s;
                var video = wrap.querySelector('video');
                video.srcObject = s;
                var p = video.play(); if (p && p.catch) p.catch(function () {});
                timer = setInterval(function () {
                    if (done || video.readyState < 2) return;
                    detector.detect(video).then(function (codes) {
                        if (done || !codes || !codes.length) return;
                        var v = codes[0].rawValue || '';
                        var u = null;
                        try { u = new URL(v); } catch (e) {}
                        if (u && u.origin === window.location.origin) {
                            stop();
                            window.location.href = u.href;   // boot-time deep link opens the profile
                        } else {
                            say('That QR code isn\'t an Empyrean profile.');
                        }
                    }).catch(function () {});
                }, 300);
            })
            .catch(function () { say('Camera access is needed to scan. Allow it in your browser settings.'); });
    }

    /* ── the real share sheet, captured before we wrap it ───────────────── */
    var origShare = null;
    try { if (typeof navigator.share === 'function') origShare = navigator.share.bind(navigator); } catch (e) {}

    /* ── compact share sheet for posts/reels/listings (small, not full screen) ──
       Small QR + the usual social targets, so one tap shares like before. */
    /* FIX (2026-10-27): Facebook, X, Copy link and More used Font Awesome glyphs. Font Awesome loads lazily and
       its brand font often fails on weak connections (the circle showed with no logo). All four are now inline
       SVG like WhatsApp and Telegram already were, so they always render. */
    function openCompactShare(o) {
        injectCss();
        var old = document.getElementById('emp-qs-share');
        if (old) old.remove();
        var url = o.url;
        var msg = (o.text && String(o.text).trim()) || (o.title || 'Check this out on Empyrean');
        var qrHtml; try { qrHtml = renderQrSvg(url); } catch (e) { qrHtml = ''; }
        var eu = encodeURIComponent(url), em = encodeURIComponent(msg);
        var targets = [
            { k: 'wa', l: 'WhatsApp', svg: '<svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true"><circle cx="22" cy="22" r="22" fill="#25D366"/><svg x="9" y="9" width="26" height="26" viewBox="0 0 24 24"><path fill="#fff" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg></svg>', href: 'https://wa.me/?text=' + encodeURIComponent(msg + ' ' + url) },
            { k: 'fb', l: 'Facebook', svg: '<svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true"><circle cx="22" cy="22" r="22" fill="#1877F2"/><svg x="11" y="8" width="22" height="28" viewBox="0 0 320 512"><path fill="#fff" d="M279.14 288l14.22-92.66h-88.91v-60.13c0-25.35 12.42-50.06 52.24-50.06h40.42V6.26S260.43 0 225.36 0c-73.22 0-121.08 44.38-121.08 124.72v70.62H22.89V288h81.39v224h100.17V288z"/></svg></svg>', href: 'https://www.facebook.com/sharer/sharer.php?u=' + eu },
            { k: 'x',  l: 'X',        svg: '<svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true"><circle cx="22" cy="22" r="22" fill="#000000"/><svg x="11" y="11" width="22" height="22" viewBox="0 0 24 24"><path fill="#fff" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg></svg>', href: 'https://twitter.com/intent/tweet?url=' + eu + '&text=' + em },
            { k: 'tg', l: 'Telegram', svg: '<svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true"><path fill="#229ED9" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>', href: 'https://t.me/share/url?url=' + eu + '&text=' + em },
            { k: 'cp', l: 'Copy link', svg: '<svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true"><circle cx="22" cy="22" r="22" fill="#1B2B8B"/><svg x="11" y="11" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg></svg>' },
            { k: 'mr', l: 'More', svg: '<svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true"><circle cx="22" cy="22" r="22" fill="#3a4bb8"/><circle cx="13" cy="22" r="2.6" fill="#fff"/><circle cx="22" cy="22" r="2.6" fill="#fff"/><circle cx="31" cy="22" r="2.6" fill="#fff"/></svg>' }
        ];
        var el = document.createElement('div');
        el.id = 'emp-qs-share';
        el.className = 'empqs';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Share');
        el.innerHTML = '<div class="empqs-sheet">'
            + '<button type="button" class="empqs-x" data-k="x-close" aria-label="Close">&times;</button>'
            + '<div class="empqs-name">' + esc(o.name || 'Share') + '</div>'
            + '<div class="empqs-sub">' + esc(o.subtitle || 'Scan to open on Empyrean') + '</div>'
            + '<div class="empqs-qr">' + qrHtml + '</div>'
            + '<div class="empqs-row">' + targets.map(function (t) {
                return '<button type="button" class="empqs-b" data-k="' + t.k + '">' + (t.svg ? '<i>' + t.svg + '</i>' : '<i class="' + t.ic + '" style="background:' + t.c + ';"></i>') + '<span>' + esc(t.l) + '</span></button>';
            }).join('') + '</div></div>';

        var settled = false;
        function settle(ok) {
            if (settled) return; settled = true;
            if (ok && typeof o.resolve === 'function') o.resolve();
            else if (!ok && typeof o.reject === 'function') {
                o.reject((typeof DOMException === 'function') ? new DOMException('Share cancelled', 'AbortError') : new Error('AbortError'));
            }
        }
        function close() { settle(false); document.removeEventListener('keydown', onKey); el.remove(); }
        function onKey(e) { if (e.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey);

        el.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('[data-k]') : null;
            if (!b) { if (e.target === el) close(); return; }
            var k = b.getAttribute('data-k');
            if (k === 'x-close') { close(); return; }
            var t = targets.filter(function (x) { return x.k === k; })[0];
            if (k === 'cp') {
                var lbl = b.querySelector('span');
                copyText(url).then(function () {
                    settle(true);
                    if (lbl) { lbl.textContent = 'Copied!'; setTimeout(function () { lbl.textContent = 'Copy link'; }, 1600); }
                }).catch(function () {});
            } else if (k === 'mr') {
                var data = o.raw || { title: o.title, text: o.text, url: url };
                if (origShare) origShare(data).then(function () { settle(true); el.remove(); document.removeEventListener('keydown', onKey); }).catch(function () {});
                else copyText(url).then(function () { settle(true); }).catch(function () {});
            } else if (t && t.href) {
                try { window.open(t.href, '_blank', 'noopener'); } catch (err) {}
                settle(true);
                el.remove(); document.removeEventListener('keydown', onKey);
            }
        });
        document.body.appendChild(el);
    }

    /* ── the card ───────────────────────────────────────────────────────── */
    /**
     * @param {{url:string, name?:string, username?:string, avatar?:string,
     *          title?:string, text?:string}} o
     */
    function openProfileQr(o) {
        o = o || {};
        if (!o.url) return;
        if (o.compact) { openCompactShare(o); return; }
        var existing = document.getElementById('emp-qr-share');
        if (existing) existing.remove();
        injectCss();

        var name = o.name || o.username || 'Empyrean member';
        var initials = String(name).trim().charAt(0).toUpperCase() || 'E';
        var qrHtml;
        try { qrHtml = renderQrSvg(o.url); }
        catch (e) { console.error('[EmpQR] could not build QR:', e); qrHtml = ''; }

        var bg = readBg();
        var el = document.createElement('div');
        el.id = 'emp-qr-share';
        el.className = 'empqr';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Profile QR code');
        el.style.background = BACKGROUNDS[bg];
        el.innerHTML =
            '<div class="empqr-top">'
            + '<button type="button" class="empqr-icon" data-act="close" aria-label="Back">' + ICONS.back + '</button>'
            + '<button type="button" class="empqr-icon" data-act="scan" aria-label="Scan a QR code">' + ICONS.scan + '</button>'
            + '</div>'
            + '<div class="empqr-main">'
            + '<div class="empqr-card">'
            + '<div class="empqr-av">' + (o.avatar ? '<img src="' + esc(o.avatar) + '" alt="">' : '<span>' + esc(initials) + '</span>') + '</div>'
            + '<div class="empqr-name">' + esc(name) + '</div>'
            + (o.username ? '<div class="empqr-user">@' + esc(o.username) + '</div>'
                : (o.subtitle ? '<div class="empqr-user">' + esc(o.subtitle) + '</div>' : ''))
            + '<div class="empqr-code">' + qrHtml + '</div>'
            + '</div>'
            + '<div class="empqr-actions">'
            + '<button type="button" class="empqr-act" data-act="copy">' + ICONS.link + '<span>Copy link</span></button>'
            + '<button type="button" class="empqr-act" data-act="share">' + ICONS.share + '<span>Share link</span></button>'
            + '</div>'
            + '</div>'
            + '<div class="empqr-hint">Tap background to change style</div>';

        var prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        var settled = false;
        function settle(ok, err) {
            if (settled) return;
            settled = true;
            if (ok && typeof o.resolve === 'function') o.resolve();
            else if (!ok && typeof o.reject === 'function') o.reject(err);
        }
        function close() {
            // closing without sharing = the person dismissed it (callers treat AbortError as "cancelled")
            settle(false, (typeof DOMException === 'function') ? new DOMException('Share cancelled', 'AbortError') : new Error('AbortError'));
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
            el.remove();
        }
        function onKey(e) { if (e.key === 'Escape' && !el.querySelector('.empqr-scan')) close(); }
        document.addEventListener('keydown', onKey);

        el.addEventListener('click', function (e) {
            var btn = e.target.closest ? e.target.closest('[data-act]') : null;
            if (btn) {
                var act = btn.getAttribute('data-act');
                if (act === 'close') { close(); }
                else if (act === 'scan') { openScanner(el); }
                else if (act === 'copy') {
                    var lbl = btn.querySelector('span');
                    copyText(o.url).then(function () {
                        if (lbl) { lbl.textContent = 'Link copied!'; setTimeout(function () { lbl.textContent = 'Copy link'; }, 1800); }
                    }).catch(function () {
                        if (lbl) { lbl.textContent = 'Copy failed'; setTimeout(function () { lbl.textContent = 'Copy link'; }, 1800); }
                    });
                }
                else if (act === 'share') {
                    var data = o.raw || { title: o.title || (name + ' on Empyrean'), text: o.text || ('Follow ' + name + ' on Empyrean.'), url: o.url };
                    // Share link -> the same social sheet used for posts (WhatsApp, Facebook, X,
                    // Telegram, Copy, More), shown on top of this card. "More" there opens the
                    // device's own share sheet where available.
                    openCompactShare({
                        url: o.url, name: name, subtitle: o.username ? '@' + o.username : o.subtitle,
                        title: data.title, text: data.text, raw: data,
                        resolve: function () { settle(true); },
                        reject: function () { /* sheet dismissed: card stays open */ }
                    });
                }
                return;
            }
            // taps on the card itself do nothing; a tap on the background changes the style
            if (e.target.closest && e.target.closest('.empqr-card')) return;
            bg = (bg + 1) % BACKGROUNDS.length;
            el.style.background = BACKGROUNDS[bg];
            saveBg(bg);
        });

        document.body.appendChild(el);
    }
    window.empOpenProfileQr = openProfileQr;

    /* ── Every Share button → QR card ───────────────────────────────────────
       FEATURE (request — "implement every share post button to generate a QR
       code like the profile one"): posts, reels, marketplace listings, news,
       statuses, polls, threads and profiles all hand their link to
       navigator.share() (directly, or via shareContent()). Wrapping that one
       call opens the QR card for all of them at once — no per-button edits,
       and buttons in files not touched here are covered too.
       • The returned promise settles like the real one: it resolves when the
         person taps "Share link" and the OS sheet completes (so existing
         share rewards still fire once), and rejects with AbortError if they
         close the card (callers already ignore AbortError).
       • Shares that carry files, or have no url, go straight to the real
         share sheet untouched.
       • "Share link" inside the card calls the real sheet (origShare above),
         so there is no loop. Where the browser has no share sheet at all
         (desktop), "Share link" copies the link instead. */
    function lookupUser(uid) {
        var pools = [window.mockUsers, window.registeredUsers];
        for (var i = 0; i < pools.length; i++) { if (pools[i] && pools[i][uid]) return pools[i][uid]; }
        var me = window.userState;
        return (me && me.id === uid) ? me : null;
    }
    var KINDS = { reel: 'Reel', mkt: 'Marketplace listing', news: 'News article', status: 'Status', poll: 'Poll', profile: 'Profile' };
    function cardOptsFromShare(data, resolve, reject) {
        var o = { url: data.url, title: data.title, text: data.text, raw: data, resolve: resolve, reject: reject };
        var pid = '';
        try { pid = new URL(data.url, window.location.href).searchParams.get('post') || ''; } catch (e) {}
        var m = /^profile-(.+)$/i.exec(pid);
        var u = m ? lookupUser(m[1]) : null;
        if (u) {
            o.name = u.fullName || u.username; o.username = u.username; o.avatar = u.avatar;
        } else {
            var kind = KINDS[(pid.split('-')[0] || '').toLowerCase()] || 'Post';
            var t = String(data.title || '').trim();
            o.name = (!t || /^empyrean international$/i.test(t)) ? ('Empyrean ' + kind) : t;
            var tx = String(data.text || '').replace(/\s+/g, ' ').trim();
            o.subtitle = tx ? (tx.length > 60 ? tx.slice(0, 57) + '…' : tx) : 'Scan to open on Empyrean';
            o.avatar = 'icon-192.png';
            o.compact = true;   // posts/reels/listings: small sheet with social targets, not the full-screen card
        }
        return o;
    }
    function wrappedShare(data) {
        data = data || {};
        var hasFiles = data.files && data.files.length;
        if (hasFiles || !data.url) {
            return origShare ? origShare(data)
                : Promise.reject((typeof DOMException === 'function') ? new DOMException('Share not supported', 'NotSupportedError') : new Error('NotSupportedError'));
        }
        return new Promise(function (resolve, reject) { openProfileQr(cardOptsFromShare(data, resolve, reject)); });
    }
    wrappedShare._empQr = true;
    try {
        if (!(navigator.share && navigator.share._empQr)) {
            Object.defineProperty(navigator, 'share', { value: wrappedShare, configurable: true, writable: true });
        }
    } catch (e) { try { navigator.share = wrappedShare; } catch (e2) {} }

    console.log('[EmpHelpers] ✅ Profile QR share card ready.');
})();