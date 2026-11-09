// ============================================================
// app-sos.js  —  Empyrean SOS & Crisis Module
// Step 0.12c
//
// Responsibilities:
//   1. createSosPostOnFeed()      — render approved SOS card in feed
//   2. createCrisisPostOnFeed()   — render crisis report card in feed
//   3. renderAdminQueues()        — admin SOS + withdrawal queue UI
//   4. SOS form submission        (help-form / sos-form)
//   5. Crisis form submission     (crisis-form)
//   6. Donation modal             (donation-form / sos-donation-modal)
//   7. Admin actions              approve | hold | reject | delete
//   8. Firestore real-time        _sosListener + _crisisListener
//   9. Media input binding        sos-media-input + crisis-media-input
//  10. Donate-button repair       _repairDonateButtons / _injectDonateOnMissingCards
//  11. Approved-SOS admin log     _appendApprovedSosLogEntry — rebuilt from
//      the sos_queue listener (not just the approving device) so it shows
//      the same history on every admin session/device, exactly like the
//      public feed card already did.
//
// Dependencies (must be loaded before this file):
//   firebase-init.js, app-state.js, app-helpers.js, app-notifications.js
//
// Exposes on window:
//   window.createSosPostOnFeed, window.createCrisisPostOnFeed,
//   window.renderAdminQueues,   window._repairDonateButtons,
//   window.mockAdminSosQueue,   window.sosMediaFiles,
//   window.crisisMediaFiles,    window._sosDonationContext
// ============================================================

(function empyreanSosModule() {
    'use strict';

    // ── Wait for DOM ─────────────────────────────────────────────────────────
    function _ready(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    // ── Goal badge ─────────────────────────────────────────────────────────
    // The premium "Amount Needed" badge is now defined ONCE, in app-feed.js,
    // as window.buildSosAmountBadgeHTML(fmtAmount) (Royal Blue & Gold theme,
    // matching the app's own brand tokens). This used to be a second, separate
    // copy of the same component (red theme) — removed so there's exactly one
    // badge design and one place to update it. app-feed.js loads before this
    // file, so the shared function is available; the tiny inline fallback
    // below only fires if load order is ever changed, so a card never renders
    // with a missing badge.
    function _buildSosGoalBadgeHTML(fmtAmount) {
        if (typeof window.buildSosAmountBadgeHTML === 'function') {
            return window.buildSosAmountBadgeHTML(fmtAmount);
        }
        console.warn('[app-sos] buildSosAmountBadgeHTML not found (app-feed.js should load first) — showing plain amount.');
        return '<div class="sos-goal-badge-fallback" style="margin-top:10px;font-weight:700;">Amount Needed: ' + (fmtAmount || '') + '</div>';
    }

    // ── Shared state refs (written by app-state.js / app-fixes.js) ───────────
    // We read from window.* so this module can coexist with the legacy bundle
    // during the migration period.
    function _state() {
        return {
            userState:          window.userState          || {},
            isGuest:            window.isGuest            !== false,
            isAdmin:            window.isAdmin            || false,
            feedContainer:      document.getElementById('feed-container'),
            fbDb:               window.fbDb,
            firebaseLoaded:     window._firebaseLoaded    || false,
            mockAdminSosQueue:  window.mockAdminSosQueue  || [],
            mockAdminWithdrawalQueue: window.mockAdminWithdrawalQueue || [],
            sosMediaFiles:      window.sosMediaFiles      || [],
            crisisMediaFiles:   window.crisisMediaFiles   || [],
            USD_TO_NGN_RATE:    window.USD_TO_NGN_RATE    || 1500,
            EMPY_RATE_USD:      window.EMPY_RATE_USD      || 0.10,
        };
    }

    // ── Helper shortcuts ─────────────────────────────────────────────────────
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    }
    function _push(msg, type) {
        if (typeof window.pushNotification === 'function') window.pushNotification(msg, type || 'info');
    }
    function _fmt(text) {
        return typeof window.formatWhatsAppText === 'function' ? window.formatWhatsAppText(text) : (text || '');
    }
    function _reward(action, userId) {
        if (typeof window.rewardUserForAction === 'function') window.rewardUserForAction(action, userId || null);
    }
    function _navigateTo(view) {
        if (typeof window.navigateTo === 'function') window.navigateTo(view);
    }
    function _notifyUser(userId, msg, type) {
        if (typeof window.notifyUser === 'function') window.notifyUser(userId, msg, type);
    }

    // ── Progress bar helper ──────────────────────────────────────────────────
    function _showProgressBar(containerId) {
        var bar = document.getElementById(containerId);
        if (!bar) {
            bar = document.createElement('div');
            bar.id = containerId;
            // ADDED (2026-08-10 — upload progress tracker): percentage label
            // alongside the existing bar, so the person sees an actual number
            // moving instead of just a thin bar (easy to miss on mobile,
            // especially indistinguishable from "stuck" during a slow upload).
            bar.innerHTML = '<div class="upload-progress-container" style="position:relative;"><div class="upload-progress-bar" style="width:0%"></div></div><div class="upload-progress-pct" style="font-size:0.72rem;font-weight:700;color:var(--text-muted,#64748b);text-align:right;margin-top:3px;">0%</div>';
        }
        bar.style.display = 'block';
        return bar;
    }
    function _setProgress(containerId, pct) {
        pct = Math.max(0, Math.min(100, Math.round(pct)));
        var bar = document.querySelector('#' + containerId + ' .upload-progress-bar');
        if (bar) bar.style.width = pct + '%';
        var pctEl = document.querySelector('#' + containerId + ' .upload-progress-pct');
        if (pctEl) pctEl.textContent = pct + '%';
    }
    function _hideProgressBar(containerId) {
        var bar = document.getElementById(containerId);
        if (bar) bar.style.display = 'none';
    }

    // ── Wait for uploadToCloudinary ──────────────────────────────────────────
    async function _waitForCloudinary(ms) {
        ms = ms || 5000;
        var waited = 0;
        while (typeof window.uploadToCloudinary !== 'function' && waited < ms) {
            await new Promise(function(r) { setTimeout(r, 200); });
            waited += 200;
        }
        return typeof window.uploadToCloudinary === 'function';
    }

    // ============================================================
    // 1. createSosPostOnFeed
    // ============================================================
    function _empSosWhen(d) {
        /* Real post date: approval/publish date first (that is when it went public), then the
           submission date. Handles ISO strings, millis, and Firestore Timestamps. Falls back to
           "now" only for a brand-new card that has no stored date at all. */
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

    function createSosPostOnFeed(sosData) {
        var fc = document.getElementById('feed-container');
        if (!fc) return;

        // Prevent duplicates
        if (fc.querySelector('[data-post-id="' + sosData.id + '"]')) return;

        var postEl = document.createElement('div');
        postEl.className = 'impact-story sos-request';
        postEl.dataset.postId   = sosData.id;
        postEl.dataset.userId   = sosData.userId;
        postEl.dataset.amount   = sosData.amount;
        postEl.dataset.currency = sosData.currency;
        postEl.dataset.username = sosData.username;

        // Media HTML
        var mediaHTML = '';
        if (sosData.media && sosData.media.length > 0) {
            var _smc = sosData.media.length;
            var _sml = _smc === 1 ? 'solo' : _smc === 2 ? 'duo' : _smc === 3 ? 'trio' : 'grid';
            mediaHTML = '<div class="story-media-container" data-count="' + _smc + '" data-layout="' + _sml + '">';
            sosData.media.forEach(function(mi, idx) {
                if (!mi || !mi.url || mi.url.startsWith('blob:')) return;
                var isVid = (mi.type && mi.type.startsWith('video/'))
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

        // Currency formatter (graceful fallback for non-standard codes)
        var fmtAmount = '';
        try {
            var cur = sosData.currency || 'USD';
            var decimals = (cur === 'EMPY' || cur === 'USDT') ? 2 : 0;
            fmtAmount = new Intl.NumberFormat('en-US', {
                style: 'currency', currency: cur, minimumFractionDigits: decimals
            }).format(parseFloat(sosData.amount) || 0);
        } catch (e) {
            fmtAmount = (parseFloat(sosData.amount) || 0) + ' ' + (sosData.currency || '');
        }

        var pText = document.createElement('p');
        pText.innerHTML = _fmt(sosData.story);

        var locHTML = sosData.location
            ? '<p style="font-size:0.9rem;color:#666;margin-top:10px;">'
              + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> <strong>Location:</strong> '
              + sosData.location + '</p>'
            : '';

        var ts = _empSosWhen(sosData); // FIX 2026-10-18: was always "now" — old SOS posts showed today's date

        /* FIX: precompute the fallback avatar URL now, while sosData is still
           in scope. The old code embedded the literal text "sosData.username"
           inside the onerror="" attribute string. That snippet only runs later,
           when the image actually fails to load, in the GLOBAL scope -- where
           sosData does not exist -- throwing "ReferenceError: sosData is not
           defined" every time an SOS avatar 404s. */
        var _sosAvatarFallback = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(sosData.username || 'U') + '&background=EF4444&color=fff&size=90';

        postEl.innerHTML = [
            '<div class="story-header">',
            '  <div class="avatar-placeholder square">',
            '    <img src="' + (sosData.avatar || '') + '" alt="' + (sosData.username || '') + "'s Avatar\" onerror=\"this.onerror=null;this.src='" + _sosAvatarFallback + "'\">",
            '  </div>',
            '  <div class="story-user-info">',
            '    <strong>SOS: ' + (sosData.title || 'Help Request') + '</strong>',
            '    <span>Request by ' + (sosData.username || 'User') + ' · ' + ts + '</span>',
            '  </div>',
            '  <span class="sos-badge">SOS</span>',
            '</div>',
            '<div class="story-content">',
            '  ' + pText.outerHTML,
            '  ' + locHTML,
            '</div>',
            mediaHTML,
            '<div class="story-actions">',
            '  <a class="action-btn comment-btn" data-action="comment" title="Reply"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/></svg><span class="comment-count x-count"></span></span></a>',
            '  <a class="action-btn retweet-btn" data-action="retweet" title="Repost"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.932 9.48.568 8.02 5 3.88zM19.5 20.12l-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2H11V4h5.5c2.209 0 4 1.79 4 4v8.45l1.568-1.93 1.364 1.46-4.432 4.14z"/></svg><span class="retweet-count x-count"></span></span></a>',
            '  <a class="action-btn like-btn" data-action="like" title="Like"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z"/></svg><span class="like-count x-count"></span></span></a>',
            '  <span class="action-btn view-count-display" title="Views"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><span class="view-count x-count"></span></span>',
            '  <a class="action-btn bookmark-btn" data-action="bookmark" title="Bookmark" style="margin-left:auto;"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l.5 1v16.5l-6-3.5-6 3.5V4l.5-1z"/></svg></span></a>',
            '  <a class="action-btn download-media-btn" data-action="download" title="Download"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><rect x="4" y="18.4" width="16" height="2.2" rx="1.1" fill="currentColor" stroke="none"/></svg><span class="download-count x-count"></span></span></a>',
            '  <a class="action-btn share-btn" data-action="share" title="Share"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg><span class="share-count x-count"></span></span></a>',
            '</div>',
            /* REDESIGN 2026-10-18: premium 'appeal' panel (amount first, then donate). Same
               .help-now-btn class + data attrs, so every existing handler keeps working. */
            '<div class="sos-appeal">',
            '  <span class="sos-appeal-verified"><svg viewBox="0 0 24 24"><path d="M12 2l2.4 2 3.1-.3.9 3 2.7 1.6-1 3 1 3-2.7 1.6-.9 3-3.1-.3L12 22l-2.4-2-3.1.3-.9-3L3 15.7l1-3-1-3 2.7-1.6.9-3 3.1.3z"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>Verified appeal</span>',
            '  ' + _buildSosGoalBadgeHTML(fmtAmount),
            '  <button class="gift-button sos-button help-now-btn"',
            '    data-sos-user-id="' + (sosData.userId || '') + '"',
            '    data-sos-username="' + (sosData.username || '') + '">',
            '    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><span>Donate Now \u2014 Help <em>' + (sosData.username || 'this cause') + '</em></span>',
            '  </button>',
            '  <div class="sos-appeal-trust">Secure payment \u00b7 Goes straight to the beneficiary</div>',
            '</div>',
            '<div class="comment-section">',
            '  <div class="comment-list"></div>',
            '  <form class="comment-form" novalidate>',
            '    <input type="text" name="comment-text" placeholder="Add a comment..." required>',
            '    <button type="submit"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>',
            '  </form>',
            '</div>'
        ].join('\n');

        fc.prepend(postEl);
    }
    window.createSosPostOnFeed = createSosPostOnFeed;

    // ============================================================
    // 2. createCrisisPostOnFeed
    // ============================================================
    function createCrisisPostOnFeed(crisisData) {
        var fc = document.getElementById('feed-container');
        if (!fc) return;

        var postId = crisisData.id || ('crisis-' + Date.now());

        // Prevent duplicates
        if (fc.querySelector('[data-post-id="' + postId + '"]')) return;

        var postEl = document.createElement('div');
        postEl.className = 'impact-story crisis-report';
        postEl.dataset.postId = postId;
        postEl.dataset.userId = crisisData.userId;

        // Media HTML — skip blob: URLs (device-local, break on other devices)
        var mediaHTML = '';
        if (crisisData.media && crisisData.media.length > 0) {
            mediaHTML = '<div class="story-media-container" data-count="' + crisisData.media.length + '">';
            crisisData.media.forEach(function(mi) {
                if (!mi || !mi.url || mi.url.startsWith('blob:')) return;
                var isVid = (mi.type && mi.type.startsWith('video/'))
                         || /\/video\/upload\//i.test(mi.url)
                         || /\.(mp4|webm|mov)(\?|$)/i.test(mi.url);
                mediaHTML += '<div class="story-media-item">';
                if (isVid) {
                    mediaHTML += '<video src="' + mi.url + '" class="story-video" controls preload="metadata" playsinline></video>';
                } else {
                    mediaHTML += '<img src="' + mi.url + '" class="story-main-image" alt="Crisis Report Evidence" loading="lazy">';
                }
                mediaHTML += '</div>';
            });
            mediaHTML += '</div>';
        }

        // Truncate long descriptions to 220 visible chars
        var _ft   = _fmt(crisisData.description) || '';
        var _plain = _ft.replace(/<[^>]*>/g, '');
        var _loc  = '<p style="font-size:0.9rem;color:#666;margin-top:10px;">'
                  + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> <strong>Location:</strong> '
                  + (crisisData.location || 'Unknown') + '</p>';

        var descHTML;
        if (_plain.length <= 220) {
            descHTML = '<p>' + _ft + '</p>' + _loc;
        } else {
            var _cut = 0, _cnt = 0, _inT = false;
            for (var _i = 0; _i < _ft.length && _cnt < 220; _i++) {
                if (_ft[_i] === '<') _inT = true;
                if (!_inT) _cnt++;
                if (_ft[_i] === '>') _inT = false;
                _cut = _i;
            }
            var _pre  = _ft.substring(0, _cut + 1);
            var _rest = _ft.substring(_cut + 1);
            descHTML = '<p>' + _pre
                + '<span class="post-text-overflow">…</span>'
                + '<span class="post-text-rest" style="display:none;">' + _rest + '</span>'
                + '</p>' + _loc
                + '<button type="button" class="post-read-more" style="font-size:0.82rem;font-weight:700;color:var(--secondary);background:none;border:none;padding:0;cursor:pointer;margin-top:4px;">Read more ▼</button>'
                + '<button type="button" class="post-read-less" style="font-size:0.82rem;font-weight:700;color:var(--secondary);background:none;border:none;padding:0;cursor:pointer;display:none;margin-top:4px;">Show less ▲</button>';
        }

        var ts = crisisData.createdAt
            ? new Date(crisisData.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : 'Recently';

        var S = _state();
        var canDelete = (crisisData.userId === S.userState.id) || S.isAdmin;
        var deleteBtn = canDelete
            ? '<a href="#" class="delete-post-btn" style="color:#e53935;display:flex;align-items:center;gap:6px;"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Delete</a>'
            : '';

        /* FIX: same scope bug as the SOS card above -- precompute the fallback
           avatar URL now while crisisData is still in scope. */
        var _crisisAvatarFallback = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(crisisData.username || 'U') + '&background=DC2626&color=fff&size=90';

        postEl.innerHTML = [
            '<div class="story-header">',
            '  <div class="avatar-placeholder square">',
            '    <img src="' + (crisisData.avatar || '') + '" alt="' + (crisisData.username || '') + "'s Avatar\" onerror=\"this.onerror=null;this.src='" + _crisisAvatarFallback + "'\">",
            '  </div>',
            '  <div class="story-user-info">',
            '    <strong>Crisis Report: ' + (crisisData.type || 'Emergency') + '</strong>',
            '    <span>Reported by ' + (crisisData.username || 'User') + ' · ' + ts + '</span>',
            '  </div>',
            '  <div class="post-options">',
            '    <button class="options-btn"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>',
            '    <div class="options-menu">',
            '      <a href="#" class="promote-post-btn"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg> Promote</a>',
            '      ' + deleteBtn,
            '    </div>',
            '  </div>',
            '</div>',
            '<div class="story-content">' + descHTML + '</div>',
            mediaHTML,
            '<div class="story-actions">',
            '  <a class="action-btn comment-btn" data-action="comment" title="Reply"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/></svg><span class="comment-count x-count"></span></span></a>',
            '  <a class="action-btn retweet-btn" data-action="retweet" title="Repost"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.932 9.48.568 8.02 5 3.88zM19.5 20.12l-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2H11V4h5.5c2.209 0 4 1.79 4 4v8.45l1.568-1.93 1.364 1.46-4.432 4.14z"/></svg><span class="retweet-count x-count"></span></span></a>',
            '  <a class="action-btn like-btn" data-action="like" title="Like"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z"/></svg><span class="like-count x-count"></span></span></a>',
            '  <span class="action-btn view-count-display" title="Views"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><span class="view-count x-count"></span></span>',
            '  <a class="action-btn bookmark-btn" data-action="bookmark" title="Bookmark" style="margin-left:auto;"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l.5 1v16.5l-6-3.5-6 3.5V4l.5-1z"/></svg></span></a>',
            '  <a class="action-btn download-media-btn" data-action="download" title="Download"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><rect x="4" y="18.4" width="16" height="2.2" rx="1.1" fill="currentColor" stroke="none"/></svg><span class="download-count x-count"></span></span></a>',
            '  <a class="action-btn share-btn" data-action="share" title="Share"><span class="x-pill"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg><span class="share-count x-count"></span></span></a>',
            '  <span class="sponsored-badge" style="display:none;margin-left:auto;">Sponsored</span>',
            '</div>',
            '<div class="comment-section">',
            '  <div class="comment-list"></div>',
            '  <form class="comment-form" novalidate>',
            '    <input type="text" name="comment-text" placeholder="Add a comment..." required>',
            '    <button type="submit"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>',
            '  </form>',
            '</div>'
        ].join('\n');

        fc.prepend(postEl);
    }
    window.createCrisisPostOnFeed = createCrisisPostOnFeed;

    // ============================================================
    // 2b. Chevron-collapsed SOS admin actions — CSS (injected once)
    // ============================================================
    function _injectSosActionsCSS() {
        if (document.getElementById('_sos_actions_toggle_css')) return;
        var s = document.createElement('style');
        s.id = '_sos_actions_toggle_css';
        s.textContent = [
            '.sos-actions-toggle {',
            '  display:flex;align-items:center;justify-content:center;gap:6px;width:100%;',
            '  padding:8px 10px;margin-top:2px;background:rgba(10,14,39,0.04);',
            '  border:1px solid rgba(10,14,39,0.09);border-radius:8px;cursor:pointer;',
            '  font-size:0.8rem;font-weight:700;color:var(--secondary,#1B2B8B);',
            '  -webkit-tap-highlight-color:transparent;',
            '}',
            '.sos-actions-toggle:active { opacity:0.7; }',
            '.sos-actions-toggle .sos-actions-chevron { transition:transform 0.2s ease; }',
            '.sos-actions-toggle[aria-expanded="true"] .sos-actions-chevron { transform:rotate(180deg); }',
            '.sos-action-row {',
            '  display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;padding:10px 2px 4px;',
            '  -webkit-overflow-scrolling:touch;scrollbar-width:none;',
            '}',
            /* Buttons mid-flight (see _sosActionsInFlight in _bindClickDelegation) —
               visibly disabled so a second tap before the first finishes has an
               obvious "already working on it" affordance instead of looking dead. */
            '.sos-action-row.sos-busy button { opacity:0.5;pointer-events:none; }',
            '#admin-sos-log .sos-log-busy { opacity:0.5;pointer-events:none; }'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    }

    // ============================================================
    // 3. renderAdminQueues  (SOS queue + withdrawal queue)
    // ============================================================
    function renderAdminQueues() {
        _injectSosActionsCSS();
        var S = _state();
        var sosQueue        = window.mockAdminSosQueue        || [];
        var withdrawalQueue = window.mockAdminWithdrawalQueue || [];

        // Update admin stat badges
        var sosStat = document.getElementById('admin-stat-sos');
        if (sosStat) sosStat.textContent = sosQueue.filter(function(s) {
            return s.status === 'pending_approval' || s.status === 'on_hold';
        }).length;

        var wdStat = document.getElementById('admin-stat-withdrawals');
        if (wdStat) wdStat.textContent = withdrawalQueue.length;

        var withdrawalEl = document.getElementById('admin-withdrawal-queue');
        var sosQueueEl   = document.getElementById('admin-sos-queue');
        if (!withdrawalEl || !sosQueueEl) return;

        // Withdrawal queue
        withdrawalEl.innerHTML = withdrawalQueue.length
            ? withdrawalQueue.map(function(item) {
                // NGN bank-transfer requests are REAL money (Flutterwave
                // transfer fired on approve — see server.js's
                // /api/admin/withdrawals/:id/payout and app-patch-v48.js's
                // currency-aware _approveWithdrawal). Everything else
                // (EMPY via empyrean-card/usdt/bank) is unchanged from
                // before — approve there just flips Firestore status, no
                // real transfer. Flagging this distinction here is the
                // whole point of this edit: an admin glancing at the queue
                // needs to see "(real bank transfer)" before they approve
                // something that actually moves money.
                var isNgnBank = String(item.currency || '').toUpperCase() === 'NGN' && item.method === 'bank';
                var amountStr = isNgnBank
                    ? '₦' + Number(item.amount || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })
                    : (item.amount || '—') + (item.currency ? ' ' + item.currency : '');
                var acct = item.accountDetails || {};
                var bankLine = isNgnBank
                    ? '<p><strong>Bank:</strong> ' + (acct.bankName || '—') + ' — ' + (acct.accountNumber || '—') + '</p>'
                    : '';
                return '<div class="admin-queue-item" data-id="' + item.id + '">'
                    + '<div class="admin-queue-info">'
                    + '<p><strong>User:</strong> ' + (item.username || '—') + '</p>'
                    + '<p><strong>Amount:</strong> ' + amountStr + (isNgnBank ? ' <span style="color:#B3261E;font-weight:700;">(real bank transfer)</span>' : '') + '</p>'
                    + '<p><strong>Method:</strong> ' + (item.method || '—') + '</p>'
                    + bankLine
                    + '</div>'
                    + '<div class="admin-queue-actions">'
                    + '<button class="btn btn-small btn-success approve-withdrawal-btn">Approve</button>'
                    + '<button class="btn btn-small btn-danger reject-withdrawal-btn">Reject</button>'
                    + '</div>'
                    + '</div>';
            }).join('')
            : '<p style="text-align:center;padding:20px;">No pending withdrawals.</p>';

        // SOS queue — pending + on-hold only
        var pendingSOS = sosQueue.filter(function(i) {
            return i.status === 'pending_approval' || i.status === 'on_hold';
        });

        function _statusBadge(s) {
            var map = {
                pending_approval: { c: '#F59E0B', t: 'Pending Review' },
                on_hold:          { c: '#6366F1', t: 'On Hold'       },
                approved:         { c: '#10B981', t: 'Approved'      },
                rejected:         { c: '#EF4444', t: 'Rejected'      }
            };
            var m = map[s] || { c: '#888', t: s };
            return '<span style="background:' + m.c + '22;color:' + m.c + ';border:1px solid ' + m.c + '44;'
                 + 'padding:2px 10px;border-radius:50px;font-size:0.72rem;font-weight:700;">' + m.t + '</span>';
        }

        if (pendingSOS.length === 0) {
            sosQueueEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">'
                + '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin-bottom:10px;"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>'
                + 'No pending SOS requests.</div>';
            return;
        }

        sosQueueEl.innerHTML = pendingSOS.map(function(item) {
            var mediaThumbs = '';
            if (item.media && item.media.length) {
                mediaThumbs = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">'
                    + item.media.slice(0, 4).map(function(m) {
                        return '<img src="' + (m.url || m) + '" style="width:60px;height:60px;object-fit:cover;'
                             + 'border-radius:8px;border:1px solid #eee;" onerror="this.style.display=\'none\'">';
                    }).join('')
                    + '</div>';
            }
            var preview = (item.story || '').substring(0, 200) + ((item.story || '').length > 200 ? '…' : '');
            var ts      = new Date(item.createdAt || Date.now()).toLocaleString();
            return '<div class="admin-queue-item" data-id="' + item.id + '" '
                + 'style="border-left:4px solid #F59E0B;padding:16px 20px;margin-bottom:12px;'
                + 'background:white;border-radius:0 12px 12px 0;box-shadow:0 2px 8px rgba(0,0,0,0.06);">'
                + '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px;">'
                + '  <div>'
                + '    <strong style="font-size:0.95rem;color:var(--primary);">'
                + '      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ' + (item.title || 'SOS Request')
                + '    </strong> ' + _statusBadge(item.status)
                + '  </div>'
                + '  <span style="font-size:0.75rem;color:var(--text-muted);">' + ts + '</span>'
                + '</div>'
                + '<div style="font-size:0.85rem;color:#555;margin-bottom:4px;">'
                + '  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
                + '  <strong>@' + (item.username || '—') + '</strong>'
                + '</div>'
                + '<div style="font-size:0.83rem;color:#666;margin-bottom:4px;">'
                + '  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#F5C518" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9h1.5a1.5 1.5 0 0 1 0 3H9v3h1.5a1.5 1.5 0 0 1 0 3"/><line x1="12" y1="6" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="18"/></svg>'
                + '  Amount: <strong>' + (item.amount || '—') + ' ' + (item.currency || '') + '</strong>'
                + '</div>'
                + '<div style="font-size:0.83rem;color:#666;margin-bottom:4px;">'
                + '  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'
                + '  Location: <strong>' + (item.location || '—') + '</strong>'
                + '</div>'
                + '<div style="font-size:0.83rem;color:#B45309;margin-bottom:4px;background:rgba(245,158,11,0.08);'
                + 'border-radius:6px;padding:4px 8px;display:inline-block;" title="Admin-only — stripped automatically on publish">'
                + '  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'
                + '  Contact (admin-only): <strong>' + (item.contact || '—') + '</strong>'
                + '</div>'
                + '<p style="font-size:0.85rem;color:#555;margin:8px 0;padding:10px;'
                + 'background:rgba(10,14,39,0.03);border-radius:8px;max-height:80px;overflow:auto;">'
                + preview + '</p>'
                + mediaThumbs
                /* REDESIGN (chevron-collapsed actions — see _injectSosActionsCSS()
                   and the '.sos-actions-toggle' click handler in _bindClickDelegation()):
                   the four action buttons used to always render inline, which on a
                   narrow admin screen meant a horizontally-scrolling row that was easy
                   to miss and easy to mis-tap. They now sit inside a collapsed panel
                   behind one "Actions" toggle with a chevron — tap to expand, same
                   buttons/classes/handlers underneath, nothing about WHAT they do
                   changed, only whether they're visible by default. */
                + '<button type="button" class="sos-actions-toggle" aria-expanded="false" data-target="sos-actions-' + item.id + '">'
                + '  <svg class="sos-actions-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
                + '  <span>Actions</span>'
                + '</button>'
                + '<div id="sos-actions-' + item.id + '" class="sos-action-row" style="display:none;">'
                + '  <button class="btn btn-small btn-success approve-sos-btn" '
                + '    style="border-radius:8px;white-space:nowrap;flex-shrink:0;">'
                + '    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Approve &amp; Publish</button>'
                + '  <button class="btn btn-small sos-hold-btn" '
                + '    style="background:#6366F1;color:white;border:none;border-radius:8px;padding:6px 12px;'
                + '    cursor:pointer;font-size:0.82rem;font-weight:600;white-space:nowrap;flex-shrink:0;">'
                + '    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> On Hold</button>'
                + '  <button class="btn btn-small btn-danger reject-sos-btn" '
                + '    style="border-radius:8px;white-space:nowrap;flex-shrink:0;">'
                + '    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Reject</button>'
                + '  <button class="btn btn-small delete-sos-btn" '
                + '    style="background:#7F1D1D;color:white;border:none;border-radius:8px;padding:6px 12px;'
                + '    cursor:pointer;font-size:0.82rem;font-weight:600;white-space:nowrap;flex-shrink:0;">'
                + '    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Delete</button>'
                + '</div>'
                + '</div>';
        }).join('');
    }
    window.renderAdminQueues = renderAdminQueues;

    // ============================================================
    // 4. SOS form submission  (help-form / sos-form)
    // ============================================================
    async function _submitSosForm(form) {
        var categoryEl      = form.querySelector('#request-category');
        var categoryOtherEl = form.querySelector('#request-category-other');
        var storyEl         = form.querySelector('#request-story');
        var amountEl        = form.querySelector('#request-amount');
        var currencyEl      = form.querySelector('#request-currency');
        var locationEl      = form.querySelector('#request-location');
        var contactEl       = form.querySelector('#request-contact');
        var latEl           = form.querySelector('#request-lat');
        var lngEl           = form.querySelector('#request-lng');
        if (!categoryEl || !storyEl || !amountEl || !currencyEl || !locationEl || !contactEl) return;

        // "Other" category requires the free-text field to be filled in.
        if (categoryEl.value === 'other' && !(categoryOtherEl && categoryOtherEl.value.trim())) {
            _notify('Please specify your category of need.', 'warning');
            if (categoryOtherEl) categoryOtherEl.focus();
            return;
        }
        if (!locationEl.value.trim()) {
            _notify('Please add your location.', 'warning');
            locationEl.focus();
            return;
        }
        if (!contactEl.value.trim()) {
            _notify('Please add contact information so an admin can reach you.', 'warning');
            contactEl.focus();
            return;
        }

        var S = _state();
        var submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }

        // Progress bar
        // FIX (2026-07-24 — step wizard): submitBtn now lives inside the
        // .emp-wizard-nav row rather than being a direct child of the form,
        // so form.insertBefore(pbWrap, submitBtn) would throw (insertBefore
        // requires the reference node to be a direct child of the node
        // you're calling it on). Insert before the nav row itself instead —
        // it IS a direct child — falling back to submitBtn for safety if an
        // older non-wizard markup is ever loaded.
        var pbWrap = _showProgressBar('sos-upload-progress');
        var navWrap = form.querySelector('.emp-wizard-nav');
        if (!form.contains(pbWrap)) form.insertBefore(pbWrap, navWrap || submitBtn);

        try {
            _notify('Uploading evidence files…', 'info');

            var ready = await _waitForCloudinary(8000);
            if (!ready) {
                _notify('Upload service not ready. Please try again.', 'error');
                return;
            }

            // Upload SOS media
            var mediaUrls = [];
            var sosMed = window.sosMediaFiles || [];
            for (var i = 0; i < sosMed.length; i++) {
                try {
                    var url = await window.uploadToCloudinary(sosMed[i], function(pct) {
                        // FIX (2026-08-10): was calling _notify() on every single
                        // progress tick — on a slow connection that's dozens of
                        // stacked toasts flashing over each other. The progress
                        // bar + its live percentage label (_setProgress) already
                        // shows the number updating in real time; one toast at
                        // the start (below, before the loop) is enough.
                        var overallSos = sosMed.length > 1 ? Math.round(((i + (pct / 100)) / sosMed.length) * 100) : pct;
                        _setProgress('sos-upload-progress', overallSos);
                    });
                    if (url && !url.startsWith('blob:')) mediaUrls.push({ url: url, type: sosMed[i].type });
                } catch (e) {
                    console.warn('[SOS] media upload failed (skipped):', e && e.message);
                    _notify('One file failed to upload and was skipped: ' + (e && e.message ? e.message : 'connection issue'), 'warning');
                }
            }
            if (sosMed.length) _setProgress('sos-upload-progress', 100);

            var newSos = {
                id:        'sos-' + Date.now(),
                // Always capture the submitting account's identity.
                // We read these fields directly here rather than via _state() to guard
                // against the rare case where window.userState has been swapped to an
                // admin context between the submit event and this closure executing.
                userId:    (window.userState && window.userState.id)       || S.userState.id,
                username:  (window.userState && window.userState.username)  || S.userState.username,
                avatar:    (window.userState && window.userState.avatar)    || S.userState.avatar,
                title:     categoryEl.value === 'other'
                               ? categoryOtherEl.value.trim()
                               : categoryEl.value,
                category:      categoryEl.value,
                categoryOther: categoryEl.value === 'other' ? categoryOtherEl.value.trim() : '',
                story:     storyEl.value,
                amount:    amountEl.value,
                currency:  currencyEl.value,
                location:  locationEl.value.trim(),
                // Optional — only populated when the requester used the
                // "Auto-detect" location toggle; absent for manual entries.
                coords:    (latEl && lngEl && latEl.value && lngEl.value)
                               ? { lat: parseFloat(latEl.value), lng: parseFloat(lngEl.value) }
                               : null,
                // ADMIN-ONLY: contact is read here and written to the sos_queue
                // (admin control panel) doc below. It must NEVER be copied into
                // the public 'posts' doc created on approval — see _handleApproveSos.
                contact:   contactEl.value.trim(),
                media:     mediaUrls,
                createdAt: new Date().toISOString(),
                status:    'pending_approval'
            };

            // Push to in-memory admin queue and sync to window
            if (!window.mockAdminSosQueue) window.mockAdminSosQueue = [];
            window.mockAdminSosQueue.push(newSos);

            // Persist to Firestore
            // BUGFIX (2026-08-04 — SOS request only visible from the sending
            // device): "if (window.fbDb)" was always true, because
            // window.fbDb is pre-stubbed at page load (index.html) to a
            // no-op mock object -- {collection: ..., set: _noop, ...} --
            // BEFORE the real firebase.firestore() instance replaces it.
            // That stub is truthy just like the real thing, so this check
            // could never tell the two apart. If the SOS form was submitted
            // before _initFirebase() finished (slow connection, cold load,
            // etc.), .set(newSos) resolved successfully against the mock
            // without throwing -- nothing was ever written to Firestore --
            // while newSos still sat in window.mockAdminSosQueue, which is
            // per-tab, in-memory, and never synced anywhere. That's exactly
            // why the request only ever showed up in the admin panel on the
            // same device/session it was submitted from: it never left that
            // device. Fixed by checking window._firebaseLoaded (the actual
            // readiness flag every other write path in this app already
            // relies on) instead of the always-truthy stub, waiting briefly
            // for it the same way _handleRegisterSubmit already does
            // elsewhere in this app, and being honest with the requester if
            // it still isn't ready rather than claiming success either way.
            var _sosFirestoreSaved = false;
            try {
                if (!window._firebaseLoaded) {
                    await new Promise(function (resolve) {
                        var tries = 0;
                        var t = setInterval(function () {
                            tries++;
                            if (window._firebaseLoaded || tries > 20) { clearInterval(t); resolve(); }
                        }, 500);
                    });
                }
                if (window._firebaseLoaded && window.fbDb) {
                    await window.fbDb.collection('sos_queue').doc(newSos.id).set(newSos);
                    _sosFirestoreSaved = true;
                } else {
                    console.warn('[SOS] Firebase still not ready -- request saved locally only, admin will not see it on other devices.');
                }
            } catch (e) { console.warn('[SOS] Firestore save failed:', e.message); }

            // Refresh admin UI
            try { renderAdminQueues(); } catch (e) {}
            var sosStat = document.getElementById('admin-stat-sos');
            if (sosStat) sosStat.textContent = window.mockAdminSosQueue.length;

            // Notify user
            if (_sosFirestoreSaved) {
                _push('Your SOS request "' + newSos.title + '" has been submitted and is pending admin review. You will be notified of the outcome.', 'info');
                _notify('✅ SOS request submitted! Pending admin review.', 'success');
            } else {
                _push('Your SOS request "' + newSos.title + '" was saved on this device, but could not reach the server -- please check your connection and try again so admin can see it.', 'warning');
                _notify('⚠️ Could not confirm the SOS request reached the server. Please try again.', 'error');
            }

            // Reset
            form.reset();
            window.sosMediaFiles = [];
            var sosPreview = document.getElementById('sos-media-preview');
            if (sosPreview) sosPreview.innerHTML = '';
            var catOtherGroup = document.getElementById('request-category-other-group');
            if (catOtherGroup) catOtherGroup.style.display = 'none';
            _setSosLocationStatus('');
            if (form._empWizardReset) form._empWizardReset();
            _navigateTo('dashboard');

        } catch (err) {
            console.error('[SOS] Submission error:', err);
            _notify('Failed to submit SOS request. Please try again.', 'error');
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit SOS Request'; }
            _hideProgressBar('sos-upload-progress');
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
        }
    }

    // ============================================================
    // 5. Crisis form submission  (crisis-form)
    // ============================================================
    async function _submitCrisisForm(form) {
        var typeEl        = form.querySelector('#crisis-type');
        var descEl        = form.querySelector('#crisis-description');
        var locationEl    = form.querySelector('#crisis-location');
        if (!typeEl || !descEl || !locationEl) return;

        var submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        var pbWrap = _showProgressBar('crisis-upload-progress');
        var navWrap = form.querySelector('.emp-wizard-nav');
        if (!form.contains(pbWrap)) form.insertBefore(pbWrap, navWrap || submitBtn);

        var crisisMed = window.crisisMediaFiles || [];
        if (crisisMed.length > 0) _notify('Uploading crisis media…', 'info');

        try {
            var ready = await _waitForCloudinary(5000);
            if (!ready) {
                _notify('Upload service not ready. Please try again.', 'error');
                return;
            }

            var mediaUrls = [];
            var total = crisisMed.length;
            var done  = 0;
            for (var i = 0; i < crisisMed.length; i++) {
                try {
                    var url = await window.uploadToCloudinary(crisisMed[i], function(pct) {
                        // FIX (2026-08-10): one toast per progress tick removed —
                        // see the same fix's note in _submitSosForm above. The
                        // progress bar's own percentage label already shows this
                        // updating live.
                        var overall = Math.floor(((done / total) + (pct / 100 / total)) * 100);
                        _setProgress('crisis-upload-progress', overall);
                    });
                    if (url && !url.startsWith('blob:')) mediaUrls.push({ url: url, type: crisisMed[i].type });
                } catch (e) {
                    console.warn('[Crisis] media upload failed (skipped):', e && e.message);
                    _notify('One file failed to upload and was skipped: ' + (e && e.message ? e.message : 'connection issue'), 'warning');
                }
                done++;
            }
            if (total) _setProgress('crisis-upload-progress', 100);

            var S = _state();
            var crisisId   = 'crisis-' + Date.now();
            var crisisData = {
                id:          crisisId,
                type:        typeEl.value,
                description: descEl.value,
                location:    locationEl.value,
                userId:      S.userState.id,
                username:    S.userState.username,
                avatar:      S.userState.avatar,
                media:       mediaUrls,
                createdAt:   new Date().toISOString(),
                status:      'pending'
            };

            // Persist to Firestore — onSnapshot listener renders it on all devices
            try {
                if (window.fbDb) await window.fbDb.collection('crisis_reports').doc(crisisId).set(crisisData);
                // FIX (bug: "no notification for new posts / doesn't cross-
                // populate across devices"): unlike SOS (which sits in
                // sos_queue awaiting admin approval before it's public), a
                // crisis report is visible on every device as soon as it's
                // written (see comment above) -- so, same as a regular post,
                // followers should hear about it right away too.
                if (typeof window._empNotifyFollowersOfContent === 'function') {
                    window._empNotifyFollowersOfContent(
                        'warning',
                        '⚠️ ' + (crisisData.username || 'Someone') + ' reported a crisis: ' + (crisisData.type || 'Update'),
                        { postId: crisisId, preview: (crisisData.description || '').slice(0, 120) }
                    );
                }
            } catch (e) { console.warn('[Crisis] Firestore save failed:', e.message); }

            // Reset
            form.reset();
            window.crisisMediaFiles = [];
            var crisisPreview = document.getElementById('crisis-media-preview');
            if (crisisPreview) crisisPreview.innerHTML = '';
            var coordsEl = document.getElementById('crisis-location-coords');
            if (coordsEl) coordsEl.textContent = '';
            if (form._empWizardReset) form._empWizardReset();

            _notify('✅ Crisis report submitted and saved to cloud!', 'success');
            _reward('VERIFIED_CRISIS_REPORT');
            _navigateTo('dashboard');

        } catch (err) {
            console.error('[Crisis] Submission error:', err);
            _notify('Failed to submit crisis report.', 'error');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
            _hideProgressBar('crisis-upload-progress');
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
        }
    }

    // ============================================================
    // 6. Audit log helper (used by admin actions below)
    // ============================================================
    function _logAudit(action, targetUser, details) {
        if (!window.empyreanAuditLog) window.empyreanAuditLog = [];
        var S = _state();
        var entry = {
            timestamp:  new Date().toLocaleString(),
            admin:      S.userState.username || 'admin',
            action:     action,
            targetUser: targetUser,
            details:    details,
            id:         'audit-' + Date.now()
        };
        window.empyreanAuditLog.unshift(entry);

        var tbody = document.getElementById('admin-audit-log-body');
        if (tbody) {
            var emptyRow = tbody.querySelector('td[colspan]');
            if (emptyRow) emptyRow.closest('tr').remove();
            var row = document.createElement('tr');
            row.style.borderBottom = '1px solid rgba(10,14,39,0.06)';
            row.innerHTML = '<td style="padding:10px 16px;font-size:0.82rem;color:var(--text-muted);">' + entry.timestamp + '</td>'
                + '<td style="padding:10px 16px;font-weight:600;color:var(--secondary);">@' + entry.admin + '</td>'
                + '<td style="padding:10px 16px;"><span style="background:rgba(27,43,139,0.1);color:var(--secondary);padding:2px 10px;border-radius:50px;font-size:0.78rem;">' + entry.action + '</span></td>'
                + '<td style="padding:10px 16px;font-size:0.82rem;color:var(--text-muted);">@' + entry.targetUser + '</td>'
                + '<td style="padding:10px 16px;font-size:0.82rem;color:var(--text-muted);">' + entry.details + '</td>';
            tbody.prepend(row);
        }
    }

    // ============================================================
    // 7. Admin SOS action handlers
    // ============================================================
    /* BUG FIX (approved log was device-local only): this used to be inline
       code inside _handleApproveSos() that ran exactly once, on exactly the
       device that clicked Approve — a plain document.createElement() / 
       prepend() with no Firestore read behind it. Every other admin
       session (a different device, a different browser tab, or even the
       SAME device after a page refresh) started with an empty
       #admin-sos-log and had no way to ever repopulate it, because nothing
       ever queried Firestore for previously-approved requests.

       Pulled out into its own function so it can be called from BOTH:
         1. _handleApproveSos() — instant feedback for the approving admin.
         2. The sos_queue realtime listener (startSosListeners) — which
            already fires an 'added' event for every approved doc the very
            first time any admin session connects (per its own comment,
            "includes approved docs on reload"), and a 'modified' event the
            moment ANY admin elsewhere approves one live. That's exactly
            what makes the public feed card itself already universal —
            this hooks the admin log up to the same mechanism.
       De-duped via data-sos-log-id, since the approving device will get
       BOTH the direct call above and the listener's own near-instant
       'modified' event for the very same approval. */
    function _appendApprovedSosLogEntry(sosRequest) {
        var sosLogEl = document.getElementById('admin-sos-log');
        if (!sosLogEl) return;
        if (sosLogEl.querySelector('[data-sos-log-id="' + sosRequest.id + '"]')) return;

        var emptyLog = sosLogEl.querySelector('.sos-log-empty');
        if (emptyLog) emptyLog.remove();
        var logEntry = document.createElement('div');
        logEntry.setAttribute('data-sos-log-id', sosRequest.id);
        logEntry.style.cssText = 'display:flex;align-items:center;justify-content:space-between;'
            + 'padding:12px 16px;background:rgba(16,185,129,0.05);border-left:4px solid #10B981;'
            + 'border-radius:0 10px 10px 0;margin-bottom:8px;gap:12px;flex-wrap:wrap;';
        // Use the stored approval timestamp, not "now" — entries loaded on a
        // different device (or after a refresh) were very likely approved
        // in the past, not at the moment this function happens to run.
        var approvedTs = sosRequest.approvedAt || sosRequest.publishedAt || sosRequest.createdAt || Date.now();
        logEntry.innerHTML = '<div style="flex:1;min-width:0;">'
            + '<strong style="font-size:0.88rem;color:var(--primary);">'
            + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ' + sosRequest.title + '</strong>'
            + '<div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">@'
            + sosRequest.username + ' · Approved '
            + new Date(approvedTs).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            + '</div></div>'
            + '<button class="delete-approved-sos-btn btn btn-small" '
            + 'style="background:#7F1D1D;color:white;border:none;border-radius:8px;padding:5px 10px;font-size:0.75rem;cursor:pointer;flex-shrink:0;" '
            + 'data-post-id="' + sosRequest.id + '">'
            + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Delete Post</button>';
        sosLogEl.prepend(logEntry);
    }

    async function _handleApproveSos(sosRequest, itemEl) {
        sosRequest.status      = 'approved';
        sosRequest.approvedAt  = new Date().toISOString();
        sosRequest.publishedAt = sosRequest.approvedAt;

        // FIX (live count race / permission-denied on views|likes|etc.):
        // Firestore write now happens FIRST, and is awaited, BEFORE the card
        // is rendered into the feed DOM. Previously createSosPostOnFeed()
        // ran synchronously and the Firestore .set() happened afterward
        // inside a detached async IIFE — so the card was visible/scrollable/
        // clickable for however long the .set() took to land (network
        // latency). Any view-count IntersectionObserver tick or engagement
        // click (like/retweet/quote/share/download) that fired in that
        // window did posts/{id}.update({...}) against a document that did
        // not exist yet. Firestore rejects update() on a nonexistent doc as
        // permission-denied REGARDLESS of how the security rule is written
        // (resource.data is null, so even a rule that allows the write has
        // nothing to diff against).
        try {
            if (window.fbDb) {
                await window.fbDb.collection('sos_queue').doc(sosRequest.id).update({
                    status: 'approved', approvedAt: sosRequest.approvedAt, publishedAt: sosRequest.publishedAt
                });
                // Write the full SOS object to 'posts' so it survives a page refresh.
                // isSOS:true tells the posts listener to skip it (avoids plain generic card).
                // Media is stored as {url, type} objects to match createSosPostOnFeed() expectations.
                // Engagement counters are seeded to 0/empty at creation time so the
                // very first like/view/share .update() always has an existing doc
                // and matching fields to diff against.
                await window.fbDb.collection('posts').doc(sosRequest.id).set({
                    id:          sosRequest.id,
                    // IMPORTANT: userId / username / avatar are the SUBMITTER's identity,
                    // captured when the user filed the SOS request. The admin's identity
                    // must NOT appear here — admin role is approval only.
                    userId:      sosRequest.userId,
                    username:    sosRequest.username,
                    displayUsername: sosRequest.username,   // alias used by some card renderers
                    avatar:      sosRequest.avatar,
                    title:       sosRequest.title,
                    story:       sosRequest.story,
                    text:        'SOS Request: ' + sosRequest.title + '\n\n' + sosRequest.story,
                    amount:      sosRequest.amount,
                    currency:    sosRequest.currency,
                    location:    sosRequest.location || '',
                    // NOTE: sosRequest.contact is intentionally NOT included here.
                    // Contact info is admin-only (control panel / sos_queue) and
                    // must be stripped before a case goes to the public dashboard.
                    media:       (sosRequest.media || []).map(function(m) {
                                     return (m && typeof m === 'object' && m.url) ? m : { url: m || '', type: 'image/jpeg' };
                                 }),
                    createdAt:   sosRequest.approvedAt,
                    approvedAt:  sosRequest.approvedAt,
                    publishedAt: sosRequest.publishedAt,
                    status:      'approved',
                    isSOS:       true,
                    sosAmount:   sosRequest.amount,
                    sosCurrency: sosRequest.currency,
                    views: 0, likes: 0, likedBy: [], retweetCount: 0,
                    shareCount: 0, downloadCount: 0, quoteCount: 0, commentCount: 0
                });
                // FIX (bug: "no notification for new posts / doesn't cross-
                // populate across devices"): an approved SOS becomes a public
                // 'posts' doc same as any other post, but nothing ever told the
                // SUBMITTER's followers it went live. authorId is passed
                // explicitly here -- window.userState at this point is the
                // ADMIN approving the request, not the submitter, and this
                // notification must reach the submitter's own followers.
                if (typeof window._empNotifyFollowersOfContent === 'function') {
                    window._empNotifyFollowersOfContent(
                        'sos',
                        '🆘 ' + (sosRequest.username || 'Someone') + '\u2019s SOS request is now live: ' + sosRequest.title,
                        { postId: sosRequest.id, preview: (sosRequest.story || '').slice(0, 120) },
                        sosRequest.userId
                    );
                }
            }
        } catch (e) {
            console.warn('[Admin SOS] Firestore update failed:', e.message);
            if (typeof _notify === 'function') _notify('Failed to publish SOS to the cloud — please retry.', 'error');
            return; // Don't render the card or fire notifications if the write failed —
                     // avoids a phantom feed card with no backing Firestore doc, which
                     // would permission-deny on every single engagement click forever.
        }

        // Render to feed — passes the original sosRequest which has the submitter's username/userId.
        // Safe now: the Firestore doc above is guaranteed to exist by this point, so any
        // view/like/share/etc. that fires the instant this card mounts has a real doc to hit.
        createSosPostOnFeed(sosRequest);
        if (sosRequest.source !== 'facebook') _reward('VERIFIED_SOS_REQUEST', sosRequest.userId);   // Facebook-imported SOS is filed under the admin account: no reward
        _logAudit('SOS Approved & Published', sosRequest.username,
            'SOS "' + sosRequest.title + '" published. Amount: ' + sosRequest.amount + ' ' + sosRequest.currency);
        _notifyUser(sosRequest.userId,
            'Your SOS request "' + sosRequest.title + '" has been APPROVED and is now live on the public dashboard! The community can now support you.',
            'success');
        _push('✅ Your SOS "' + sosRequest.title + '" was APPROVED! It is now live on the dashboard.', 'success');

        // Append to Approved SOS log in admin panel — this device gets it
        // instantly; the sos_queue listener below will ALSO fire for this
        // same approval (and for it on every other open admin session /
        // device), but _appendApprovedSosLogEntry() de-dupes via
        // data-sos-log-id so it's never added twice here.
        _appendApprovedSosLogEntry(sosRequest);

        _notify('✅ SOS from @' + sosRequest.username + ' approved and published!', 'success');
        window.mockAdminSosQueue = (window.mockAdminSosQueue || []).filter(function(i) { return i.id !== sosRequest.id; });
        itemEl.style.opacity = '0';
        setTimeout(function() { itemEl.remove(); renderAdminQueues(); }, 300);
    }

    function _handleHoldSos(sosRequest, itemEl) {
        sosRequest.status = 'on_hold';
        _logAudit('SOS Put On Hold', sosRequest.username,
            'SOS "' + sosRequest.title + '" placed on hold pending more information.');
        _notifyUser(sosRequest.userId,
            'Your SOS request "' + sosRequest.title + '" is on hold. Admin may need more information.',
            'warning');
        _push('⏸ Your SOS "' + sosRequest.title + '" is On Hold — awaiting further review.', 'warning');

        try {
            if (window.fbDb) window.fbDb.collection('sos_queue').doc(sosRequest.id).update({ status: 'on_hold' });
        } catch (e) {}

        _notify('SOS from @' + sosRequest.username + ' placed On Hold.', 'info');
        itemEl.style.background       = 'rgba(99,102,241,0.05)';
        itemEl.style.borderLeftColor  = '#6366F1';
        renderAdminQueues();
    }

    function _handleRejectSos(sosRequest, itemEl) {
        sosRequest.status = 'rejected';
        var reason = prompt('Optional: Enter a brief reason for rejection (shown to user):')
                     || 'Did not meet current approval criteria.';
        var msg = 'Your SOS request "' + sosRequest.title + '" was not approved. Reason: ' + reason
                + '. Please contact support if you need assistance.';

        _logAudit('SOS Rejected', sosRequest.username,
            'SOS "' + sosRequest.title + '" rejected. Not published to dashboard.');
        _notifyUser(sosRequest.userId, msg, 'error');

        // Persist rejection notice to Firestore
        try {
            if (window.fbDb && window._firebaseLoaded) {
                window.fbDb.collection('user_notifications').add({
                    userId:    sosRequest.userId,
                    username:  sosRequest.username,
                    message:   msg,
                    type:      'sos_rejected',
                    sosId:     sosRequest.id,
                    sosTitle:  sosRequest.title,
                    reason:    reason,
                    read:      false,
                    createdAt: new Date().toISOString()
                }).catch(function(e) { console.warn('[Admin SOS] Notification save error:', e.message); });

                window.fbDb.collection('sos_queue').doc(sosRequest.id).update({
                    status:       'rejected',
                    rejectReason: reason,
                    rejectedAt:   new Date().toISOString()
                }).catch(function() {});
            }
        } catch (e) {}

        // Update notification badge if current user is the applicant
        var S = _state();
        if (S.userState.id === sosRequest.userId) {
            var badge = document.getElementById('notif-badge') || document.querySelector('.notif-count');
            if (badge) {
                badge.textContent    = (parseInt(badge.textContent) || 0) + 1;
                badge.style.display  = 'inline-flex';
            }
        }

        _notify('SOS from @' + sosRequest.username + ' rejected. User has been notified.', 'info');
        window.mockAdminSosQueue = (window.mockAdminSosQueue || []).filter(function(i) { return i.id !== sosRequest.id; });
        itemEl.style.opacity = '0';
        setTimeout(function() { itemEl.remove(); renderAdminQueues(); }, 300);
    }

    async function _handleDeleteSos(sosRequest, itemEl) {
        _logAudit('SOS Deleted', sosRequest.username,
            'SOS "' + sosRequest.title + '" permanently deleted by admin.');
        window.mockAdminSosQueue = (window.mockAdminSosQueue || []).filter(function(i) { return i.id !== sosRequest.id; });

        // Remove from feed if published
        var feedPost = document.querySelector('[data-post-id="' + sosRequest.id + '"]');
        if (feedPost) feedPost.remove();

        /* FIX: this used to fire both deletes without awaiting them, inside a
           try/catch that swallowed any failure silently (a permission-denied
           on either doc would just vanish with no error and no retry). It's
           now awaited so a real failure propagates to _runSosAdminAction's
           own catch — which is what actually notifies the admin instead of
           the delete just quietly not sticking. */
        if (window.fbDb) {
            await Promise.all([
                window.fbDb.collection('sos_queue').doc(sosRequest.id).delete(),
                window.fbDb.collection('posts').doc(sosRequest.id).delete()
            ]);
        }

        itemEl.style.opacity = '0';
        setTimeout(function() { itemEl.remove(); renderAdminQueues(); }, 300);
        _notify('SOS request permanently deleted.', 'info');
    }

    async function _handleDeleteApprovedSos(btn) {
        var postId = btn.dataset.postId;
        if (!postId || !confirm('Permanently delete this approved SOS post from the dashboard?')) return;

        var feedPost = document.querySelector('[data-post-id="' + postId + '"]');
        if (feedPost) feedPost.remove();
        var logEntry = btn.closest('[data-sos-log-id]') || btn.closest('div[style*="border-left"]');
        if (logEntry) logEntry.remove();

        /* FIX (logging issue — deleted post kept reappearing in the Approved
           SOS log): this used to delete ONLY the public 'posts' doc. The
           'sos_queue' doc itself — the thing the admin log is actually
           rebuilt FROM (see _appendApprovedSosLogEntry / startSosListeners'
           'added' handling, which repopulates the whole log from sos_queue
           on every fresh admin session/page load) — was left behind with
           status still 'approved'. So the very next time this admin (or any
           other) opened the panel, the sos_queue listener's initial 'added'
           snapshot would re-add a log entry for a post that had already been
           deleted, with a "Delete Post" button that then failed to find
           anything in 'posts' to remove. Deleting BOTH documents here is
           what actually makes a deletion permanent instead of just visually
           temporary until the next reload. */
        if (!window.fbDb) {
            _notify('SOS post removed here, but there is no connection to delete it permanently — it may come back on reload.', 'warning');
            return;
        }
        await Promise.all([
            window.fbDb.collection('posts').doc(postId).delete(),
            window.fbDb.collection('sos_queue').doc(postId).delete()
        ]);
        _notify('SOS post permanently deleted from the dashboard and the admin log.', 'info');
    }

    // ============================================================
    // 8. Firestore real-time listeners
    // ============================================================
    function startSosListeners(db) {
        // SOS approved posts
        if (!window._sosListener) {
            /* FIX ("previously-approved SOS requests disappeared from the log
               and the public feed"): this used to be an UNFILTERED
               `sos_queue.limit(30)` — pulling up to 30 docs from the WHOLE
               collection (pending_approval + on_hold + rejected + approved,
               all mixed together, in whatever order Firestore happens to
               return with no orderBy), then filtering for status==='approved'
               only after the fact, in JS. Once enough pending/on_hold/
               rejected requests piled up (duplicates, spam, anything not yet
               actioned), they could fill that entire 30-doc window on their
               own — pushing every already-approved doc outside the snapshot
               entirely, so the code that checks `sos.status === 'approved'`
               never even saw them. That's why 3 real, previously-approved
               requests could vanish from both the Approved SOS Log and the
               public dashboard feed with no error anywhere: they were never
               wrong, they just weren't being fetched at all.

               Querying status==='approved' directly (a single-field equality
               filter — Firestore indexes every field like this automatically,
               no manual composite index needed, so this can't newly break on
               a database that's never had this specific query run against it
               before) means this listener's doc budget is spent ONLY on
               approved requests — completely decoupled from however many
               pending/on_hold/rejected requests happen to exist at the same
               time. Deliberately NOT combined with an orderBy() here: pairing
               a where() on one field with an orderBy() on a different field
               requires a Firestore COMPOSITE index that has to be created
               once via the Firebase console (or firestore.indexes.json) before
               the query works at all — shipping that combination without the
               index already existing would make this listener fail outright
               with a 'failed-precondition' error, which is a worse regression
               than the bug being fixed. Ordering is handled client-side
               instead — _appendApprovedSosLogEntry() always prepend()s, so
               the log still reads newest-first from each snapshot's natural
               delivery order. */
            window._sosListener = db.collection('sos_queue')
                .where('status', '==', 'approved')
                .limit(200)
                .onSnapshot(function(snap) {
                    if (!snap) return;
                    snap.docChanges().forEach(function(change) {
                        var sos = change.doc.data();
                        if (!sos) return;
                        // Firestore does not embed doc.id inside the data payload by default.
                        // Always normalise it so createSosPostOnFeed and the duplicate guard work.
                        if (!sos.id) sos.id = change.doc.id;

                        /* 'added'    — document first seen (includes approved docs on reload,
                                        OR an existing pending doc that just became approved —
                                        Firestore reports a doc newly MATCHING a where() filter
                                        as 'added', not 'modified', even though the doc already
                                        existed before this specific query started tracking it).
                           'modified' — a field changed on a doc that was ALREADY approved
                                        (e.g. re-approving, or any other field update) while
                                        still matching this query's filter. */
                        if (change.type === 'added' || change.type === 'modified') {
                            var fc = document.getElementById('feed-container');
                            if (fc) {
                                /* Remove any plain generic card that the posts listener may have
                                   already rendered for this id (would block createSosPostOnFeed). */
                                var existing = fc.querySelector('[data-post-id="' + sos.id + '"]');
                                if (existing && !existing.classList.contains('sos-request')) {
                                    existing.remove();
                                }
                                if (!fc.querySelector('[data-post-id="' + sos.id + '"]')) {
                                    createSosPostOnFeed(sos);
                                }
                            }

                            /* BUG FIX (admin log not universal across devices): this is the
                               SAME 'added'/'modified' event that already makes the public feed
                               card itself appear on every connected device (see above) — the
                               very first snapshot an admin session gets includes 'added' for
                               every already-approved doc already sitting in sos_queue, and any
                               other admin's live approval fires 'added' here too (a doc newly
                               matching the where('status','==','approved') filter). Hooking the
                               approved-log render into this listener (instead of only the inline
                               DOM append inside _handleApproveSos, which only ever ran on the
                               one device that clicked Approve) is what makes the log itself
                               universal, not just the feed card. */
                            _appendApprovedSosLogEntry(sos);
                        }

                        /* 'removed' — the doc no longer matches status==='approved' (admin put
                           it back on hold/rejected elsewhere) OR it was actually deleted. Either
                           way, unpublish the feed card. The admin log entry is left in place —
                           _handleDeleteApprovedSos is the only thing that should ever remove a
                           log row, so an accidental un-approve elsewhere doesn't also silently
                           erase this admin's audit trail of "this WAS approved once." */
                        if (change.type === 'removed') {
                            var el = document.querySelector('[data-post-id="' + sos.id + '"]');
                            if (el) el.remove();
                        }
                    });
                    // Repair: inject donate button on SOS cards that are missing one
                    setTimeout(_injectDonateOnMissingCards, 400);
                }, function(err) {
                    console.error('[Listener:sos]', err.code, err.message);
                    window._sosListener = null;
                });
            console.log('[Firestore] ✅ sos_queue (approved) listener active');
        }


        // Pending/on-hold SOS requests — admin queue live sync.
        // FIX ("Approve does nothing" root-cause #2): before this, the ONLY
        // thing that ever populated window.mockAdminSosQueue with pending
        // requests was a single one-time `.get()` fetch run once at admin
        // login (app-fixes.js). A request submitted after that fetch ran, or
        // approved/held/rejected by a DIFFERENT admin session/device in the
        // meantime, never reached this session's local cache — so a button
        // tap on a queue item that looked perfectly normal on screen could
        // find nothing to act on. This listener keeps mockAdminSosQueue (and
        // the rendered queue) live-synced with Firestore for as long as an
        // admin session is open, the same way the approved-log listener
        // above already does for approved requests. Gated to admin only —
        // sos_queue's pending/on_hold docs contain the submitter's private
        // contact info, and a non-admin session has no Firestore rule
        // permission to read this collection unfiltered anyway.
        if (!window._sosPendingListener && window.isAdmin) {
            window._sosPendingListener = db.collection('sos_queue')
                .where('status', 'in', ['pending_approval', 'on_hold'])
                .onSnapshot(function(snap) {
                    if (!snap) return;
                    if (!window.mockAdminSosQueue) window.mockAdminSosQueue = [];
                    var changed = false;
                    snap.docChanges().forEach(function(change) {
                        var sos = change.doc.data();
                        if (!sos) return;
                        if (!sos.id) sos.id = change.doc.id;

                        if (change.type === 'removed') {
                            var before = window.mockAdminSosQueue.length;
                            window.mockAdminSosQueue = window.mockAdminSosQueue.filter(function(i) { return i.id !== sos.id; });
                            if (window.mockAdminSosQueue.length !== before) changed = true;
                            return;
                        }
                        // 'added' or 'modified' — upsert into the local cache
                        // so it always reflects Firestore, not just whatever
                        // this session's own actions have touched.
                        var idx = window.mockAdminSosQueue.findIndex(function(i) { return i.id === sos.id; });
                        if (idx === -1) window.mockAdminSosQueue.push(sos);
                        else window.mockAdminSosQueue[idx] = sos;
                        changed = true;
                    });
                    if (changed && typeof window.renderAdminQueues === 'function') window.renderAdminQueues();
                }, function(err) {
                    console.error('[Listener:sosPending]', err.code, err.message);
                    window._sosPendingListener = null;
                });
            console.log('[Firestore] ✅ sos_queue pending/on_hold listener active (admin queue live sync)');
        }

        // Crisis / community reports
        if (!window._crisisListener) {
            window._crisisListener = db.collection('crisis_reports')
                .orderBy('createdAt', 'desc')
                .limit(20)
                .onSnapshot(function(snap) {
                    if (!snap) return;
                    snap.docChanges().forEach(function(change) {
                        var cr = change.doc.data();
                        if (!cr) return;
                        cr.id = cr.id || change.doc.id;

                        if (change.type === 'removed') {
                            var el = document.querySelector('[data-post-id="' + cr.id + '"]');
                            if (el) el.remove();
                            return;
                        }
                        if (change.type === 'added') {
                            createCrisisPostOnFeed(cr);
                        }
                    });
                }, function(err) {
                    console.error('[Listener:crisis]', err.code, err.message);
                    window._crisisListener = null;
                });
            console.log('[Firestore] ✅ crisis_reports listener active');
        }
    }
    window.startSosListeners = startSosListeners;

    // ============================================================
    // 9. Media input binding  (sos-media-input + crisis-media-input)
    // ============================================================
    function _bindMediaInputs() {
        function _previewFiles(files, previewId) {
            var preview = document.getElementById(previewId);
            if (!preview) return;
            preview.innerHTML = '';
            files.forEach(function(f) {
                var url = URL.createObjectURL(f);
                var d   = document.createElement('div');
                d.style.cssText = 'display:inline-block;margin:4px;border-radius:8px;overflow:hidden;';
                d.innerHTML = f.type.startsWith('video/')
                    ? '<video src="' + url + '" style="width:80px;height:80px;object-fit:cover;" muted playsinline></video>'
                    : '<img src="' + url + '" style="width:80px;height:80px;object-fit:cover;">';
                preview.appendChild(d);
            });
        }

        var sosInput = document.getElementById('sos-media-input');
        if (sosInput && !sosInput._sosBound) {
            sosInput._sosBound = true;
            sosInput.addEventListener('change', function() {
                window.sosMediaFiles = Array.from(this.files || []);
                _previewFiles(window.sosMediaFiles, 'sos-media-preview');
            });
        }

        var crisisInput = document.getElementById('crisis-media-input');
        if (crisisInput && !crisisInput._crisisBound) {
            crisisInput._crisisBound = true;
            crisisInput.addEventListener('change', function() {
                window.crisisMediaFiles = Array.from(this.files || []);
                _previewFiles(window.crisisMediaFiles, 'crisis-media-preview');
            });
        }

        // Pin location button (randomised for demo; replace with Geolocation API if needed)
        document.addEventListener('click', function(e) {
            if (!e.target.closest('#pin-location-btn')) return;
            var lat  = (Math.random() * (9.0 - 6.4) + 6.4).toFixed(6);
            var lon  = (Math.random() * (7.4 - 3.4) + 3.4).toFixed(6);
            var el   = document.getElementById('crisis-location-coords');
            if (el) el.textContent = 'Pinned at: ' + lat + ', ' + lon;
        });
    }

    // ============================================================
    // 10. Donate-button repair  (_repairDonateButtons)
    // ============================================================
    function _injectDonateOnMissingCards() {
        // ── Step A: Promote plain cards that are actually SOS posts ──────────
        // The posts listener may render an isSOS card as a plain .impact-story
        // (without the .sos-request class) if it races ahead of the sos_queue
        // listener, or if the isSOS flag was missing on older Firestore records.
        // Detect them by: data-post-id starting with "sos-" OR having a .sos-badge.
        document.querySelectorAll('.impact-story:not(.sos-request):not(.crisis-report)').forEach(function(card) {
            var pid = card.dataset.postId || '';
            var hasSosBadge = !!card.querySelector('.sos-badge');
            var hasSosId    = /^sos-/i.test(pid);
            if (!hasSosBadge && !hasSosId) return;
            // This is an SOS post masquerading as a plain card — add the class
            // so the donate-button injection below picks it up.
            card.classList.add('sos-request');
            console.log('[SOS repair] Upgraded plain card to sos-request:', pid);
        });

        // ── Step B: Inject donate button on any .sos-request card missing one ─
        // crisis-report cards must NOT receive a donate button
        document.querySelectorAll('.impact-story.sos-request').forEach(function(card) {
            if (card.querySelector('.help-now-btn') || card.querySelector('.donate-post-btn')) return;
            var _un  = card.dataset.username || 'this person';
            var _uid = card.dataset.userId   || '';
            var wrap = document.createElement('div');
            wrap.style.cssText = 'padding:10px 16px 14px;';
            wrap.innerHTML = '<button class="help-now-btn donate-post-btn gift-button sos-button"'
                + ' data-sos-user-id="' + _uid + '" data-sos-username="' + _un + '"'
                + ' style="width:100%;padding:12px;background:linear-gradient(135deg,#EF4444,#B91C1C);'
                + 'color:white;border:none;border-radius:12px;font-size:0.9rem;font-weight:700;'
                + 'cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;'
                + 'box-shadow:0 4px 14px rgba(239,68,68,0.4);">'
                + '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>&nbsp; Donate — Help ' + _un + '</button>';
            var commentSection = card.querySelector('.comment-section');
            if (commentSection) card.insertBefore(wrap, commentSection);
            else card.appendChild(wrap);
        });

        // ── Step C: Inject the goal badge on any .sos-request card missing one ─
        // Covers cards rendered before this badge existed (cached HTML, or a
        // render path that bypassed createSosPostOnFeed).
        document.querySelectorAll('.impact-story.sos-request').forEach(function(card) {
            if (card.querySelector('.sos-goal-badge')) return;
            var donateBtn = card.querySelector('.help-now-btn, .donate-post-btn');
            var wrap = donateBtn ? donateBtn.closest('div') : null;
            if (!wrap) return; // no anchor to attach next to — skip rather than guess placement
            var fmt = '';
            try {
                var cur = card.dataset.currency || 'USD';
                var decimals = (cur === 'EMPY' || cur === 'USDT') ? 2 : 0;
                fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: decimals })
                    .format(parseFloat(card.dataset.amount) || 0);
            } catch (e) {
                fmt = (parseFloat(card.dataset.amount) || 0) + ' ' + (card.dataset.currency || '');
            }
            wrap.insertAdjacentHTML('beforeend', _buildSosGoalBadgeHTML(fmt));
        });

        // Remove any donate button that accidentally ended up on crisis cards
        document.querySelectorAll('.impact-story.crisis-report .donate-post-btn, .impact-story.crisis-report .help-now-btn')
            .forEach(function(btn) {
                var wrap = btn.parentElement;
                if (wrap && wrap !== btn.closest('.impact-story')) wrap.remove();
                else btn.remove();
            });
    }
    window._repairDonateButtons = _injectDonateOnMissingCards;

    // ============================================================
    // 11. Donation modal — open from "Donate Now" / "Help Now"
    // ============================================================
    function openDonationModal(applicantUsername, applicantUserId, amount, postId) {
        var S = _state();
        if (S.isGuest) {
            _notify('Please log in to donate.', 'info');
            var amh = document.getElementById('auth-modal-overlay');
            if (amh) { amh.style.display = 'flex'; amh.classList.add('show'); }
            document.body.classList.add('modal-open');
            return;
        }

        window._sosDonationContext = {
            username: applicantUsername,
            userId:   applicantUserId,
            amount:   amount,
            postId:   postId
        };

        var titleEl = document.getElementById('donation-modal-title');
        var descEl  = document.getElementById('donation-modal-description');
        if (titleEl) titleEl.textContent = 'Support ' + applicantUsername + "'s SOS Request";
        if (descEl)  descEl.textContent  = amount
            ? 'They need ' + amount + '. Every contribution counts.'
            : 'Funds held in escrow until verified.';

        var nameEl  = document.getElementById('donate-name-card');
        var emailEl = document.getElementById('donate-email-card');
        if (nameEl  && !nameEl.value)  nameEl.value  = S.userState.fullName || '';
        if (emailEl && !emailEl.value) emailEl.value = S.userState.email    || '';

        var modal = document.getElementById('sos-donation-modal');
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('show');
            document.body.classList.add('modal-open');
            document.body.style.overflow = 'hidden';
        }
    }
    window.openDonationModal = openDonationModal;

    // ============================================================
    // 12. Donation form submission  (donation-form)
    // ============================================================
    function _submitDonationForm(form) {
        var amountEl = form.querySelector('#donate-amount-card');
        var nameEl   = form.querySelector('#donate-name-card');
        var emailEl  = form.querySelector('#donate-email-card');
        var phoneEl  = form.querySelector('#donate-phone-card');

        var amount = parseFloat((amountEl && amountEl.value) || 0);
        if (!amount || amount < 100) { _notify('Minimum donation is ₦100.', 'error'); return; }

        var donorName  = (nameEl  && nameEl.value.trim())  || (window.userState && window.userState.fullName) || 'Anonymous';
        var donorEmail = (emailEl && emailEl.value.trim()) || (window.userState && window.userState.email)    || 'donor@empyrean.com';
        var donorPhone = (phoneEl && phoneEl.value.trim()) || '';

        var txRef = 'EMPY-DON-' + Date.now() + '-' + Math.floor(Math.random() * 10000);

        var donBtn = form.querySelector('button[type="submit"]');
        function _restoreBtn() {
            if (donBtn) {
                donBtn.disabled = false;
                donBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> Donate Now via Flutterwave';
            }
        }
        function _closeModal() {
            var cm = form.closest('.modal-overlay-container');
            if (cm) { cm.classList.remove('show'); cm.style.display = 'none'; }
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
        }

        if (donBtn) {
            donBtn.disabled = true;
            donBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Opening Payment…';
        }

        var titleEl = document.getElementById('donation-modal-title');
        var ctx     = window._sosDonationContext || {};
        var S       = _state();

        function _launch() {
            try {
                window.FlutterwaveCheckout({
                    public_key:      (window._appConfig && window._appConfig.flutterwave && window._appConfig.flutterwave.publicKey) || '',
                    tx_ref:          txRef,
                    amount:          amount,
                    currency:        'NGN',
                    payment_options: 'card,banktransfer,ussd,mobilemoney,barter,nqr',
                    customer:        { email: donorEmail, phone_number: donorPhone, name: donorName },
                    customizations:  {
                        title:       titleEl ? titleEl.textContent : 'SOS Donation',
                        description: 'Donation to Empyrean SOS Escrow Fund',
                        logo:        'https://cdn-icons-png.flaticon.com/512/6001/6001527.png'
                    },
                    meta: {
                        source:     'sos_donation',
                        userId:     S.userState.id      || 'guest',
                        sosUserId:  ctx.userId           || '',
                        sosPostId:  ctx.postId           || ''
                    },
                    callback: function(data) {
                        _restoreBtn();
                        if (data.status === 'successful' || data.status === 'completed') {
                            try {
                                if (window.fbDb) {
                                    window.fbDb.collection('flw_transactions').doc(txRef).set({
                                        txRef: txRef, flwRef: data.flw_ref || '',
                                        amount: amount, currency: 'NGN',
                                        purpose: 'sos_donation', status: 'held',
                                        donorName: donorName, donorEmail: donorEmail,
                                        donorPhone: donorPhone, recipientName: ctx.username || '',   // 2026-10-19: shown to admins in Admin → SOS Donations
                                        donorUserId:     S.userState.id || 'guest',
                                        recipientUserId: ctx.userId     || '',
                                        sosPostId:       ctx.postId     || '',
                                        createdAt: new Date().toISOString()
                                    }).catch(function() {});
                                }
                            } catch (e) {}
                            _notify('✅ Thank you! ₦' + amount.toLocaleString() + ' donated to ' + (ctx.username || 'this cause') + '. Held in escrow.', 'success');
                            window._sosDonationContext = null;
                            form.reset();
                            _closeModal();
                        } else {
                            _notify('Donation not completed. Please try again.', 'error');
                        }
                    },
                    onclose: function() { _restoreBtn(); _notify('Payment window closed.', 'info'); }
                });
            } catch (e) { _restoreBtn(); _notify('Payment gateway error. Please try again.', 'error'); }
        }

        if (typeof window.FlutterwaveCheckout !== 'undefined') {
            _launch();
        } else if (typeof window._ensureFlutterwaveSDK === 'function') {
            _notify('Loading payment gateway…', 'info');
            window._ensureFlutterwaveSDK(_launch);
        } else {
            _notify('Loading payment gateway…', 'info');
            var script   = document.createElement('script');
            script.src   = 'https://checkout.flutterwave.com/v3.js';
            script.onload  = _launch;
            script.onerror = function() { _notify('Payment gateway unavailable. Try again.', 'error'); };
            document.head.appendChild(script);
        }
    }

    // ============================================================
    // 13. Global click delegation for SOS actions
    // ============================================================
    function _bindClickDelegation() {
        document.addEventListener('click', function(e) {
            var closest = function(sel) { return e.target.closest ? e.target.closest(sel) : null; };

            // ── "Help Now / Donate Now" button ──────────────────────────────
            if (closest('.help-now-btn')) {
                var S = _state();
                if (S.isGuest) {
                    _notify('Please log in to donate.', 'info');
                    var amh = document.getElementById('auth-modal-overlay');
                    var lv  = document.getElementById('login-view');
                    if (amh) { amh.style.display = 'flex'; amh.classList.add('show'); }
                    if (lv)  lv.style.display = 'block';
                    document.body.classList.add('modal-open');
                    setTimeout(function() { if (typeof window.generateCaptcha === 'function') window.generateCaptcha(); }, 150);
                    return;
                }
                var sp    = closest('.impact-story');
                var hnBtn = closest('.help-now-btn');
                var _username = (hnBtn && hnBtn.dataset.sosUsername) ? hnBtn.dataset.sosUsername
                             : (sp ? (sp.dataset.username || 'the cause') : 'the cause');
                var _userId   = (hnBtn && hnBtn.dataset.sosUserId) ? hnBtn.dataset.sosUserId
                             : (sp ? (sp.dataset.userId || '') : '');
                openDonationModal(_username, _userId, sp ? sp.dataset.amount : '', sp ? sp.dataset.postId : '');
                return;
            }

            // ── Expand/collapse the chevron-hidden SOS actions row ────────────
            var actionsToggle = closest('.sos-actions-toggle');
            if (actionsToggle) {
                e.preventDefault();
                var targetId = actionsToggle.dataset.target;
                var row = targetId ? document.getElementById(targetId) : null;
                if (row) {
                    var open = row.style.display !== 'none';
                    row.style.display = open ? 'none' : 'flex';
                    actionsToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
                }
                return;
            }

            // ── Admin SOS actions ────────────────────────────────────────────
            var adminBtn = closest('.approve-sos-btn, .reject-sos-btn, .sos-hold-btn, .delete-sos-btn');
            if (adminBtn) {
                e.preventDefault();
                var itemEl = closest('.admin-queue-item');
                if (!itemEl) return;
                var id = itemEl.dataset.id;

                /* FIX (multi-click / "clicking Approve does nothing"): every one of
                   these actions writes to Firestore and can take a moment on a slow
                   connection. Previously there was nothing stopping a second (or
                   fifth) tap on the same or a different button in this row while the
                   first was still in flight — each one re-ran the whole handler
                   independently against the SAME sosRequest object, which is exactly
                   what could leave a request half-approved/half-rejected or double-
                   published. _sosActionsInFlight[id] is a simple per-request latch:
                   the FIRST tap wins, every tap after it (until the first finishes,
                   success or fail) is ignored outright, and the row is visibly
                   greyed out via .sos-busy so it doesn't look like the earlier taps
                   were simply lost. */
                if (_sosActionsInFlight[id]) return;

                var actionName = closest('.approve-sos-btn') ? 'approve'
                                : closest('.sos-hold-btn')    ? 'hold'
                                : closest('.reject-sos-btn')  ? 'reject'
                                : 'delete';

                _runSosAdminAction(actionName, id, itemEl);
                return;
            }

            // ── Delete approved SOS from log ─────────────────────────────────
            var delApproved = closest('.delete-approved-sos-btn');
            if (delApproved) {
                e.preventDefault();
                var delId = delApproved.dataset.postId;
                if (_sosActionsInFlight['log-' + delId]) return; // same debounce, keyed separately from the queue actions above
                _sosActionsInFlight['log-' + delId] = true;
                delApproved.closest('div[data-sos-log-id]') && delApproved.closest('div[data-sos-log-id]').classList.add('sos-log-busy');
                Promise.resolve(_handleDeleteApprovedSos(delApproved)).catch(function(err) {
                    console.warn('[Admin SOS] delete-from-log failed:', err && err.message);
                    _notify('Could not delete this post: ' + (err && err.message ? err.message : 'connection issue, try again.'), 'error');
                }).then(function() {
                    delete _sosActionsInFlight['log-' + delId];
                });
                return;
            }
        });
    }

    // Per-request-id latch used by the admin-actions debounce above. Keys are
    // either a sos_queue doc id (approve/hold/reject/delete) or 'log-'+postId
    // (deleting an already-approved entry from the log) — kept in one shared
    // map since the two action families can never target the same key.
    var _sosActionsInFlight = {};

    /* Dispatches one admin action (approve|hold|reject|delete) for a given
       SOS request id, resolving the request object from window.mockAdminSosQueue
       first and falling back to a direct Firestore read when it isn't there.

       FIX ("Approve does nothing on the deployed link"): the previous code did
       `var sosReq = (window.mockAdminSosQueue || []).find(...); if (!sosReq) return;`
       — a completely silent no-op whenever the id wasn't in the LOCAL array.
       That local array is only ever refreshed by a one-time fetch at admin
       login (app-fixes.js) plus whatever this session has approved/held/
       rejected/deleted itself; it was never kept in sync with OTHER admin
       sessions/devices approving something in the meantime, or with a
       pending request that arrived after this session's own one-time fetch
       already ran. Any of those is enough for a real, visible-in-the-UI
       queue item to have no matching entry in mockAdminSosQueue — and the
       button would then just do nothing, with no error, which is exactly
       the reported symptom. Falling back to a live read means the action
       still succeeds instead of silently failing; if that ALSO fails (e.g.
       the request was already actioned by someone else, or a genuine
       permissions/connectivity problem), the person now gets an actual
       error message instead of a button that appears dead. */
    async function _runSosAdminAction(actionName, id, itemEl) {
        _sosActionsInFlight[id] = true;
        var row = itemEl.querySelector('.sos-action-row');
        if (row) row.classList.add('sos-busy');

        try {
            var sosReq = (window.mockAdminSosQueue || []).find(function(i) { return i.id === id; });

            if (!sosReq) {
                if (!window.fbDb) {
                    _notify('Could not find that SOS request, and there is no connection to look it up. Please refresh and try again.', 'error');
                    return;
                }
                console.warn('[Admin SOS] "' + id + '" was not in the local queue cache — fetching it directly from Firestore instead of ignoring the tap.');
                var snap = await window.fbDb.collection('sos_queue').doc(id).get();
                if (!snap.exists) {
                    _notify('This SOS request no longer exists — it may have already been handled elsewhere. Refreshing the list.', 'warning');
                    itemEl.remove();
                    return;
                }
                sosReq = snap.data() || {};
                if (!sosReq.id) sosReq.id = id;
                // Backfill the local cache so subsequent actions on this same
                // request (e.g. a second admin action right after this one)
                // don't need to hit Firestore again.
                if (!window.mockAdminSosQueue) window.mockAdminSosQueue = [];
                window.mockAdminSosQueue.push(sosReq);
            }

            if (actionName === 'approve') { await _handleApproveSos(sosReq, itemEl); return; }
            if (actionName === 'hold')    { await _handleHoldSos(sosReq, itemEl);    return; }
            if (actionName === 'reject')  { await _handleRejectSos(sosReq, itemEl);  return; }
            if (actionName === 'delete')  { await _handleDeleteSos(sosReq, itemEl);  return; }
        } catch (err) {
            // Any unexpected exception (a bad Firestore rule, a missing global,
            // whatever) used to just stop the handler mid-way with nothing
            // logged for the person to report back — now it always surfaces.
            console.error('[Admin SOS] "' + actionName + '" failed for ' + id + ':', err);
            _notify('Could not ' + actionName + ' this SOS request: ' + (err && err.message ? err.message : 'connection issue, try again.'), 'error');
        } finally {
            delete _sosActionsInFlight[id];
            if (row && row.isConnected) row.classList.remove('sos-busy');
        }
    }

    // ============================================================
    // 13b. Toggle "Other" category free-text field
    // ============================================================
    function _bindCategoryOtherToggle() {
        document.addEventListener('change', function(e) {
            if (!e.target || e.target.id !== 'request-category') return;
            var grp = document.getElementById('request-category-other-group');
            var inp = document.getElementById('request-category-other');
            if (!grp) return;
            var isOther = e.target.value === 'other';
            grp.style.display = isOther ? '' : 'none';
            if (!isOther && inp) inp.value = '';
        });
    }

    // ============================================================
    // 13c. Location auto-detect toggle  (#sos-location-toggle)
    // ============================================================
    function _setSosLocationStatus(msg, kind) {
        var el = document.getElementById('sos-location-status');
        if (!el) return;
        el.textContent = msg || '';
        el.classList.remove('is-detecting', 'is-success', 'is-error');
        if (kind) el.classList.add('is-' + kind);
    }

    async function _reverseGeocode(lat, lng) {
        // Free, key-less, CORS-enabled reverse geocoding endpoint. If the
        // network call fails for any reason (offline, blocked, timeout),
        // caller falls back to plain coordinates so the field is never left
        // silently empty.
        var url = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' +
            encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lng) + '&localityLanguage=en';
        var res = await fetch(url);
        if (!res.ok) throw new Error('reverse geocode failed: ' + res.status);
        var data = await res.json();
        var city = data.city || data.locality || data.principalSubdivision || '';
        var country = data.countryName || '';
        return [city, country].filter(Boolean).join(', ');
    }

    function _requestSosLocation(toggle) {
        var locationEl = document.getElementById('request-location');
        var latEl      = document.getElementById('request-lat');
        var lngEl      = document.getElementById('request-lng');

        _setSosLocationStatus('Detecting your location…', 'detecting');

        navigator.geolocation.getCurrentPosition(async function(pos) {
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            if (latEl) latEl.value = lat;
            if (lngEl) lngEl.value = lng;

            try {
                var place = await _reverseGeocode(lat, lng);
                if (place && locationEl) locationEl.value = place;
                _setSosLocationStatus(place ? ('📍 Location detected: ' + place) : '📍 Location detected.', 'success');
            } catch (err) {
                // Reverse geocoding failed — fall back to raw coordinates
                // so the field still gets a usable value.
                if (locationEl) locationEl.value = lat.toFixed(4) + ', ' + lng.toFixed(4);
                _setSosLocationStatus('📍 Location detected (approximate coordinates).', 'success');
            }
        }, function(err) {
            // FIX (2026-07-24 — "can't toggle location" report): the previous
            // version showed the same generic "access denied" copy for every
            // failure mode, including cases that have nothing to do with the
            // person's permission choice (no HTTPS, GPS off, no signal). This
            // routes each PositionError code (and the pre-flight secure-
            // context check below) to its own accurate message, and — for a
            // real permission denial — points at the fix (device/browser
            // settings) instead of just restating that it failed. Firestore
            // rules are unrelated to this failure: it happens client-side,
            // before any write is attempted.
            var msg = 'Couldn\'t detect your location — please enter it manually.';
            if (err) {
                if (err.code === err.PERMISSION_DENIED) {
                    msg = 'Location access is blocked for this app/browser. Enable location permission in your device settings, then try the toggle again.';
                } else if (err.code === err.POSITION_UNAVAILABLE) {
                    msg = 'Your location couldn\'t be determined — check that GPS/location services are turned on.';
                } else if (err.code === err.TIMEOUT) {
                    msg = 'Location request timed out — please try again or enter it manually.';
                }
            }
            _setSosLocationStatus(msg, 'error');
            if (toggle) toggle.checked = false;
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    }

    function _bindSosLocationToggle() {
        document.addEventListener('change', function(e) {
            if (!e.target || e.target.id !== 'sos-location-toggle') return;
            var toggle = e.target;

            if (!toggle.checked) {
                _setSosLocationStatus('');
                return;
            }
            if (!('geolocation' in navigator)) {
                _setSosLocationStatus('Location services aren\'t available on this device — please enter it manually.', 'error');
                toggle.checked = false;
                return;
            }
            // Geolocation is only available in a secure context (https:// or
            // localhost). Inside a plain file:// preview or a non-HTTPS page
            // it fails IMMEDIATELY with PERMISSION_DENIED, which used to look
            // identical to a real user-denied permission. Catching it here
            // gives the accurate reason instead.
            if (window.isSecureContext === false) {
                _setSosLocationStatus('Location requires a secure (https) connection — it isn\'t available in this preview. Please enter your location manually.', 'error');
                toggle.checked = false;
                return;
            }

            if (navigator.permissions && navigator.permissions.query) {
                navigator.permissions.query({ name: 'geolocation' }).then(function(status) {
                    if (status.state === 'denied') {
                        _setSosLocationStatus('Location access is blocked for this app/browser. Enable location permission in your device settings, then try the toggle again.', 'error');
                        toggle.checked = false;
                        return;
                    }
                    _requestSosLocation(toggle);
                }).catch(function() {
                    _requestSosLocation(toggle); // Permissions API unsupported — fall through to the direct request.
                });
            } else {
                _requestSosLocation(toggle);
            }
        });
    }

    // ============================================================
    // 13d. Guided step wizard  (#help-form / #crisis-form)
    // ============================================================
    function _initWizardForm(formEl) {
        if (!formEl || formEl._empWizardInit) return;

        var steps = Array.prototype.slice.call(formEl.querySelectorAll(':scope > .emp-form-card'));
        if (!steps.length) return;
        formEl._empWizardInit = true;

        var progressFill = formEl.querySelector('.emp-wizard-progress-fill');
        var stepCountEl  = formEl.querySelector('.emp-wizard-step-count');
        var stepTitleEl  = formEl.querySelector('.emp-wizard-step-title');
        var backBtn      = formEl.querySelector('.emp-wizard-back-btn');
        var nextBtn      = formEl.querySelector('.emp-wizard-next-btn');
        var submitBtn    = formEl.querySelector('.emp-form-submit-btn');

        var current = 0;

        function cardTitle(card) {
            var h4 = card.querySelector('.emp-form-card-head h4');
            return h4 ? h4.textContent : '';
        }

        function render() {
            steps.forEach(function(card, i) { card.style.display = (i === current) ? '' : 'none'; });
            if (progressFill) progressFill.style.width = (((current + 1) / steps.length) * 100) + '%';
            if (stepCountEl) stepCountEl.textContent = 'Step ' + (current + 1) + ' of ' + steps.length;
            if (stepTitleEl) stepTitleEl.textContent = cardTitle(steps[current]);
            if (backBtn) backBtn.style.display = (current === 0) ? 'none' : '';
            var isLast = (current === steps.length - 1);
            if (nextBtn) nextBtn.style.display = isLast ? 'none' : '';
            if (submitBtn) submitBtn.style.display = isLast ? '' : 'none';
        }

        function validateCurrentStep() {
            var card = steps[current];
            var fields = card.querySelectorAll('input[required], select[required], textarea[required]');
            for (var i = 0; i < fields.length; i++) {
                var f = fields[i];
                if (f.offsetParent === null) continue; // e.g. a conditionally-hidden field
                if (!f.checkValidity()) { f.reportValidity(); return false; }
            }
            // Mirrors the "Other category needs free text" rule the final
            // submit handler already enforces, so it's caught a step earlier
            // instead of only at the very end.
            var catEl = card.querySelector('#request-category');
            if (catEl) {
                var otherEl = document.getElementById('request-category-other');
                if (catEl.value === 'other' && !(otherEl && otherEl.value.trim())) {
                    _notify('Please specify your category of need.', 'warning');
                    if (otherEl) otherEl.focus();
                    return false;
                }
            }
            return true;
        }

        function goTo(index) {
            current = Math.max(0, Math.min(steps.length - 1, index));
            render();
            formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        if (backBtn) backBtn.addEventListener('click', function() { goTo(current - 1); });
        if (nextBtn) nextBtn.addEventListener('click', function() {
            if (!validateCurrentStep()) return;
            goTo(current + 1);
        });

        // Exposed so the submit-success handlers and the panel-reopen
        // observer below can send the wizard back to step 1.
        formEl._empWizardReset = function() { goTo(0); };

        render();
    }

    function _bindWizardPanelReset(panelId, formId) {
        var panel = document.getElementById(panelId);
        if (!panel || panel._empWizardObserved) return;
        panel._empWizardObserved = true;
        new MutationObserver(function() {
            if (panel.style.display !== 'none') {
                var form = document.getElementById(formId);
                if (form && form._empWizardReset) form._empWizardReset();
            }
        }).observe(panel, { attributes: true, attributeFilter: ['style'] });
    }

    // ============================================================
    // 14. Form submit delegation
    // ============================================================
    function _bindFormSubmit() {
        document.addEventListener('submit', function(e) {
            var form = e.target;
            if (!form) return;

            if (form.id === 'help-form' || form.id === 'sos-form') {
                e.preventDefault();
                _submitSosForm(form);
                return;
            }
            if (form.id === 'crisis-form') {
                e.preventDefault();
                _submitCrisisForm(form);
                return;
            }
            if (form.id === 'donation-form') {
                e.preventDefault();
                _submitDonationForm(form);
                return;
            }
        });
    }

    // ============================================================
    // 15. Admin queue refresh when admin opens their panel
    // ============================================================
    function _bindAdminNavRefresh() {
        // Refresh badge whenever admin section becomes visible
        document.addEventListener('empyrean:sectionchanged', function(e) {
            if (e && e.detail && e.detail.section === 'admin') {
                renderAdminQueues();
            }
        });

        // Re-arm the pending-SOS live listener in case startSosListeners()
        // originally ran before window.isAdmin was resolved for this session
        // (it's a same-tick check there, gating a listener that must not
        // attach for a non-admin). startSosListeners() itself no-ops if
        // window._sosPendingListener is already set, so this is safe to call
        // repeatedly and can never attach a second copy.
        function _rearmPendingListener() {
            if (window.isAdmin && window.fbDb && typeof window.startSosListeners === 'function') {
                window.startSosListeners(window.fbDb);
            }
        }
        document.addEventListener('empyrean-init-done', function() { setTimeout(_rearmPendingListener, 500); });
        setTimeout(_rearmPendingListener, 2000);

        // Also patch help-form submit to refresh admin badge after submission
        var origHelpForm = document.getElementById('help-form');
        if (origHelpForm && !origHelpForm._sosAdminPatch) {
            origHelpForm._sosAdminPatch = true;
            origHelpForm.addEventListener('submit', function() {
                setTimeout(function() {
                    renderAdminQueues();
                    var sosStat = document.getElementById('admin-stat-sos');
                    if (sosStat) sosStat.textContent = (window.mockAdminSosQueue || []).length;
                }, 300);
            }, true); // capture phase — runs after main handler
        }
    }

    // ============================================================
    // 16. Initialise on DOMContentLoaded
    // ============================================================
    _ready(function() {
        _bindMediaInputs();
        _bindClickDelegation();
        _bindFormSubmit();
        _bindAdminNavRefresh();
        _bindCategoryOtherToggle();
        _bindSosLocationToggle();

        _initWizardForm(document.getElementById('help-form'));
        _initWizardForm(document.getElementById('crisis-form'));
        _bindWizardPanelReset('sos-create-panel', 'help-form');
        _bindWizardPanelReset('crisis-create-panel', 'crisis-form');

        // Donate-button repair — run immediately, then periodically
        setTimeout(_injectDonateOnMissingCards, 500);
        setTimeout(_injectDonateOnMissingCards, 2000);
        setInterval(_injectDonateOnMissingCards, 10000);

        // Also repair on every section navigation
        document.addEventListener('empyrean:sectionchanged', _injectDonateOnMissingCards);
        document.addEventListener('click', function(e) {
            if (e.target.closest && e.target.closest('.nav-link, .mobile-nav-item, .sidebar-nav a')) {
                setTimeout(_injectDonateOnMissingCards, 600);
            }
        });

        console.log('[Empyrean] ✅ app-sos.js loaded — SOS & Crisis module active');
    });

})();