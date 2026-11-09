/* safeFileClick: prevents Android gallery-reopening on file inputs */
function safeFileClick(el) {
    if (!el) return;
    var now = Date.now();
    if (el._lastClick && (now - el._lastClick) < 1000) return;
    el._lastClick = now;
    el.click();
}

/* =============================================================================
   EMPYREAN INTERNATIONAL — STATUS MODULE  v4.0  (FULL FIX)
   app-status.js

   FIXES vs v3
   ───────────
   1. Listener accumulation — ALL modal events now wired ONCE via document
      delegation at boot; never re-wired on each open. No stacking, no dead
      second-click.
   2. Bubble hearts — appended to #sv-content (position:relative / overflow:hidden)
      not the modal root, so they stay visible and contained.
   3. Viewers panel — floating eye+count pill visible for the status owner;
      swipe-up gesture also opens it. Panel slide-up with per-viewer chat button.
   4. Peek preview — SHORT tap (< 300ms) shows Facebook-style bottom-sheet
      peek card. Only a tap on "View Status" inside it opens the full viewer.
      Long content visible: segments dots, user info, caption, open/reply btns.
   5. Media upload — FIX (2026-08-04): this used to be a private, direct
      fetch straight to Cloudinary's API (window._appConfig.cloudinary),
      deliberately with no dependency on the shared uploadToCloudinary()
      function. That was fine while Cloudinary was the live storage
      backend, but app-dom.js's window.uploadToCloudinary() was migrated
      to Firebase Storage on 2026-08-03 — every OTHER upload path in the
      app (posts, reels, chat, KYC, etc.) already called that shared
      function and moved over automatically, while this file's own
      private Cloudinary call kept hitting Cloudinary directly and kept
      failing once Cloudinary broke. Now delegates to
      window.uploadToCloudinary() (see _uploadFile below) so status
      uploads go to Firebase Storage like everything else, and won't
      silently drift out of sync again if the storage backend ever
      changes a second time.
   6. Close: dedicated X button + tap on the dark backdrop area works correctly.
   ============================================================================= */

(function empyreanStatusV4() {
    'use strict';

    if (window._empStatusV4) return;
    window._empStatusV4 = true;

    /* ── helpers ── */
    function _S()  { return window.EmpState || {}; }
    function _us() { return _S().userState || window.userState || {}; }
    /* Prefer the real Firebase Auth uid over the app-local userState.id —
       the same auth/UID-mismatch pattern documented elsewhere in this app
       (userState.id can be stale or unset before/while Firebase Auth
       finishes resolving). _recordView previously relied on _us().id alone;
       when that was falsy, the `if(uid&&...)` guard silently skipped ever
       pushing a viewer, so the panel always looked empty regardless of who
       actually viewed the status. */
    function _viewUid() {
        if (typeof window._authUid === 'function') { var a = window._authUid(); if (a) return a; }
        if (window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid) return window.fbAuth.currentUser.uid;
        return _us().id || null;
    }
    function _isGuest() {
        var s = _S();
        return s.isGuest != null ? !!s.isGuest : (window.isGuest !== undefined ? !!window.isGuest : true);
    }
    /* FEATURE (2026-10-17 — "include primary colors: red, blue, yellow,
       green…"): a couple of the new solid backgrounds (yellow, orange) are
       too light for the app's fixed white status text, so those use dark
       text instead. One shared helper so the composer, the status card
       preview and both viewers all agree. Everything else stays white. */
    var _ST_LIGHT_BGS = { '#FDD835': 1, '#FB8C00': 1 };
    function _stTextColor(bg) {
        return _ST_LIGHT_BGS[String(bg || '').toUpperCase()] ? '#111827' : '#fff';
    }

    function _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function _notify(m, t) {
        if (typeof window.showNotification === 'function') window.showNotification(m, t || 'info');
    }

    /* ADDED (2026-10-31 — "the status should indicate it's been reposted, so the person knows the repost succeeded"): the app-wide toast
       (_notify -> showNotification) renders underneath the full-screen status viewer (z-index 10050), so the old "Reposted" message was
       never seen. This confirmation is appended to <body> ABOVE the viewer and outlives the viewer being re-rendered (after a repost the
       viewer jumps to your own status). Used ONLY by the repost flow; every other message still uses _notify unchanged. */
    function _svToast(msg, kind) {
        try {
            var old = document.getElementById('sv-action-toast'); if (old) old.remove();
            var ok = kind !== 'error' && kind !== 'info';
            var bg = kind === 'error' ? 'rgba(220,38,38,0.96)' : (ok ? 'rgba(0,168,135,0.97)' : 'rgba(30,35,60,0.96)');
            var icon = kind === 'error'
                ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5v.01"/></svg>'
                : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16 9.5"/></svg>';
            var t = document.createElement('div');
            t.id = 'sv-action-toast';
            t.setAttribute('role', 'status');
            t.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 88px);transform:translate(-50%,-10px);opacity:0;z-index:2147483000;display:flex;align-items:center;gap:8px;max-width:88vw;padding:11px 18px;border-radius:50px;background:' + bg + ';color:#fff;font-weight:700;font-size:0.9rem;box-shadow:0 8px 28px rgba(0,0,0,0.35);pointer-events:none;transition:opacity .22s ease,transform .22s ease;';
            t.innerHTML = icon + '<span></span>';
            t.lastChild.textContent = msg;
            document.body.appendChild(t);
            requestAnimationFrame(function(){ t.style.opacity = '1'; t.style.transform = 'translate(-50%,0)'; });
            setTimeout(function(){
                t.style.opacity = '0'; t.style.transform = 'translate(-50%,-10px)';
                setTimeout(function(){ if (t.parentNode) t.remove(); }, 260);
            }, 2600);
        } catch (e) { _notify(msg, kind === 'error' ? 'error' : 'success'); }
    }

    /* =========================================================================
       FIX (2026-08-30 — bug: "sharing a reel to status doesn't work" —
       confirmed live via console: FirebaseError: Missing or insufficient
       permissions, immediately after opening this composer and posting).
       This composer's own submit handler (#post-status-btn, below) wrote to
       statuses/{docId} with a single, un-retried attempt — the exact same
       "permission-denied on the very first write after a screen just
       opened" symptom already root-caused and fixed for the group-chat
       composer (app-patch-v13.js): Firebase Auth's anonymous session can
       still be finishing its handshake (request.auth briefly null) the
       instant this composer's Post button is tapped moments after
       navigating here, which the security rules reject identically to a
       real permission problem. Same proven fix, same shape, duplicated
       into this file's own closure since it has no access to
       app-patch-v13.js's private helpers. */
    function _hasAnyAuthSession() {
        return !!(window.fbAuth && window.fbAuth.currentUser);
    }
    function _writeDocWithRetry(doWrite) {
        return new Promise(function (resolve, reject) {
            var MAX_ATTEMPTS = 4;
            var BACKOFF_MS = [1500, 3000, 6000];
            var attempt = 0;
            var timer = null;
            var onlineHandler = null;
            function _cleanupOnlineListener() {
                if (onlineHandler) { window.removeEventListener('online', onlineHandler); onlineHandler = null; }
            }
            function _attempt() {
                attempt++;
                doWrite().then(function (res) {
                    _cleanupOnlineListener();
                    if (timer) clearTimeout(timer);
                    resolve(res);
                }).catch(function (err) {
                    var permDenied = err && err.code === 'permission-denied';
                    var noSessionYet = permDenied && !_hasAnyAuthSession();
                    if (noSessionYet && typeof window._empTrySignInAnonymously === 'function') {
                        window._empTrySignInAnonymously();
                    }
                    if (attempt >= MAX_ATTEMPTS || (permDenied && !noSessionYet)) {
                        _cleanupOnlineListener();
                        reject(err);
                        return;
                    }
                    var delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
                    timer = setTimeout(_attempt, delay);
                    if (!onlineHandler) {
                        onlineHandler = function () { if (timer) clearTimeout(timer); _attempt(); };
                        window.addEventListener('online', onlineHandler);
                    }
                });
            }
            _attempt();
        });
    }

    var EXPIRY_MS  = 24 * 60 * 60 * 1000;
    var IMG_DUR_MS = 5000;
    var MAX_VID_S  = 180;

    /* =========================================================================
       STYLES — injected once
       ========================================================================= */
    function _injectStyles() {
        if (document.getElementById('_emp_status_v4_css')) return;
        var s = document.createElement('style');
        s.id  = '_emp_status_v4_css';
        s.textContent = `
/* ── Status bar ── */
#status-bar-container{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:8px 0 4px;}
#status-bar-container::-webkit-scrollbar{display:none;}
#status-bar-inner{display:flex;gap:12px;padding:0 12px;align-items:flex-start;min-width:max-content;}
.status-item{display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;-webkit-tap-highlight-color:transparent;min-width:60px;user-select:none;}
.status-avatar-ring{width:58px;height:58px;border-radius:50%;padding:2.5px;position:relative;flex-shrink:0;}
.status-avatar-ring:not(.add-own):not(.viewed){background:linear-gradient(135deg,#00D4AA,#1B2B8B);}
.status-avatar-ring.add-own{background:rgba(0,0,0,0.12);}
.status-avatar-ring.viewed{background:rgba(180,180,180,0.4);}
.status-avatar-inner{width:100%;height:100%;border-radius:50%;overflow:hidden;background:#eee;border:2.5px solid #fff;}
.status-avatar-inner img{width:100%;height:100%;object-fit:cover;display:block;}
.status-add-icon{position:absolute;bottom:0;right:0;width:20px;height:20px;background:var(--accent-color,#00D4AA);border:2px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;line-height:1;}
.status-username{font-size:0.7rem;color:var(--text-muted,#555);text-align:center;max-width:62px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}

/* ── Status preview CARDS (point #5) — other users' tiles, rebuilt as tall
   rectangular media-preview cards instead of a bare small circle, matching
   the Facebook/WhatsApp reference: the latest status item renders as the
   card's background image/video (or a gradient + text snippet for
   text-only statuses), the small avatar ring sits in the top-left corner,
   and the name is overlaid at the bottom on a dark gradient for legibility.
   The original .status-avatar-ring/.status-username classes above are left
   completely untouched since index.html's static "My Status" tile still
   uses them directly. ── */
.status-item .status-card{position:relative;width:84px;height:130px;border-radius:14px;overflow:hidden;background:#1a1a2e;flex-shrink:0;}
.status-card-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}
.status-card-text-bg{display:flex;align-items:center;justify-content:center;padding:8px;}
.status-card-text-preview{color:#fff;font-size:0.68rem;font-weight:700;text-align:center;line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;}
.status-card-grad{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,0.15) 0%,transparent 35%,transparent 60%,rgba(0,0,0,0.75) 100%);pointer-events:none;}
.status-card-avatar-ring{position:absolute;top:7px;left:7px;width:32px;height:32px;border-radius:50%;padding:2px;background:linear-gradient(135deg,#00D4AA,#1B2B8B);z-index:2;}
.status-card-avatar-ring.viewed{background:rgba(220,220,220,0.65);}
.status-card-avatar-ring img{width:100%;height:100%;border-radius:50%;object-fit:cover;border:1.5px solid #fff;display:block;}
/* FEATURE (2026-09-13 — live unread-count badge, see renderStatusBar()'s
   unseenCount above): small pill in the card's top-right corner, mirroring
   the reference screenshot's per-row unread badge. */
.status-card-badge{position:absolute;top:6px;right:6px;background:var(--accent-color,#00D4AA);color:#0A0E27;font-size:0.65rem;font-weight:800;line-height:1.4;border-radius:10px;padding:1px 6px;min-width:16px;text-align:center;z-index:3;box-shadow:0 2px 6px rgba(0,0,0,0.3);}
.status-card-name{position:absolute;bottom:7px;left:7px;right:7px;color:#fff;font-size:0.7rem;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,0.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:2;}
/* "My Status" tile keeps its original small-circle layout (it's a fixed
   element in index.html, not one of these dynamically rendered cards). */
#add-my-status-btn{min-width:60px;position:relative;}
/* FIX (point #2: missing preview square box on own status): when the user
   has an active status, a .my-status-card (built the same way as other
   users' .status-card tiles) is injected inside #add-my-status-btn. The
   original small ring markup is left in the DOM untouched so its existing
   click handlers keep firing — it's simply hidden visually once the card
   is present, since the card now carries its own avatar ring + add-icon. */
#add-my-status-btn.has-status-card > .status-avatar-ring{display:none;}
/* 2026-11-09: the "My Status" label now stays visible UNDER the card (it used to be hidden and re-drawn on top of the media). */
.status-card.my-status-card{position:relative;width:84px;height:130px;border-radius:14px;overflow:hidden;background:#1a1a2e;flex-shrink:0;}
.status-card.my-status-card .status-add-icon{position:absolute;bottom:-2px;right:-2px;width:18px;height:18px;font-size:12px;z-index:3;}

/* ── Viewer modal shell ── */
#status-viewer-modal{position:fixed;inset:0;background:rgba(0,0,0,0.94);z-index:9999;display:none;align-items:center;justify-content:center;}
#status-viewer-modal.sv-open{display:flex;}
/* FIX (2026-10-23 — "tapping the message icon in a status should open a reply box with a send button"):
   the reply composer (#sv-reply-bar) was always in the viewer, but the app's bottom nav bar
   (#mobile-bottom-nav, z-index 9990) is layered ABOVE the viewer (z-index: var(--z-live) from style.css),
   so it sat on top of the composer and hid it — tapping Message only brought up the keyboard.
   The viewer now sits above the nav + quick-post button, and they are hidden while a status is open. */
#status-viewer-modal.sv-open{z-index:10050 !important;}
body:has(#status-viewer-modal.sv-open) #mobile-bottom-nav,
body:has(#status-viewer-modal.sv-open) #quick-post-fab{display:none !important;}
/* Backdrop tap-to-close: only the modal bg behind .sv-content closes */

/* ── Viewer content card ── */
/* FIX (2026-10-21 - "status should be full screen with no space, like WhatsApp"):
   the card used to be capped at max-width:420px / max-height:820px, so on any
   phone taller than 820 CSS px (most of them) a band of the dark backdrop showed
   above and below the status. On phones it is now the full viewport; the
   420px card look is kept only for wide (desktop) screens. */
#sv-content{position:relative;width:100%;max-width:none;height:100vh;height:100dvh;max-height:none;background:#111;overflow:hidden;display:flex;flex-direction:column;flex-shrink:0;}
@media(min-width:600px){#sv-content{max-width:420px;max-height:90vh;border-radius:16px;}}

/* progress */
#sv-prog-wrap{position:absolute;top:0;left:0;right:0;z-index:10;display:flex;gap:3px;padding:10px 12px 0;}
.sv-prog-seg{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,0.28);overflow:hidden;}
.sv-prog-fill{height:100%;width:0%;background:#fff;border-radius:2px;}

/* top bar — FIX: simplified to just avatar/name/mute/close. The
   viewer-count, retweet, profile, chat buttons used to live up here as
   floating pills (overlapping the close X in cramped layouts) — they are
   now in the bottom action bar instead, matching the reference screenshot
   (X/WhatsApp-style: viewer count + reactions anchored at the bottom). */
#sv-top{position:absolute;top:18px;left:0;right:60px;z-index:8;display:flex;align-items:center;gap:9px;padding:6px 12px;background:linear-gradient(to bottom,rgba(0,0,0,0.6),transparent);}
#sv-av{width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.8);flex-shrink:0;cursor:pointer;}
.sv-meta{flex:1;min-width:0;}
#sv-name{color:#fff;font-size:0.88rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;}
#sv-time{color:rgba(255,255,255,0.5);font-size:0.7rem;}

/* mute */
#sv-mute-btn{background:rgba(0,0,0,0.45);border:none;color:#fff;border-radius:50%;width:32px;height:32px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.88rem;flex-shrink:0;}

/* delete — own status only, so people can pull down something posted by
   mistake (wrong info, wrong photo, etc). Hidden for anyone else's status. */
#sv-delete-btn{display:none;background:rgba(0,0,0,0.45);border:none;color:#fff;border-radius:50%;width:32px;height:32px;cursor:pointer;align-items:center;justify-content:center;font-size:0.86rem;flex-shrink:0;}
#sv-delete-btn.show{display:flex;}
#sv-delete-btn:active{transform:scale(0.9);}

/* 3-dot menu — volume + delete live behind this instead of sitting in the header */
#sv-more-wrap{position:relative;flex-shrink:0;}
#sv-more-btn{background:rgba(0,0,0,0.45);border:none;color:#fff;border-radius:50%;width:32px;height:32px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.88rem;}
#sv-more-btn:active{transform:scale(0.9);}
#sv-menu{display:none;position:absolute;top:38px;right:0;min-width:150px;background:rgba(24,24,34,0.97);border-radius:12px;padding:6px;box-shadow:0 10px 30px rgba(0,0,0,0.5);z-index:30;flex-direction:column;gap:2px;}
#sv-menu.open{display:flex;}
#sv-menu #sv-mute-btn,#sv-menu #sv-delete-btn{width:100%;height:auto;border-radius:8px;padding:10px 12px;justify-content:flex-start;gap:10px;background:transparent;font-size:0.86rem;text-align:left;}
#sv-menu #sv-mute-btn:active,#sv-menu #sv-delete-btn:active{background:rgba(255,255,255,0.1);transform:none;}
#sv-menu #sv-delete-btn{color:#ef4444;}
#sv-menu .sv-ic{flex-shrink:0;}
#sv-more-btn .sv-ic{width:16px;height:16px;}
#sv-mute-btn .sv-ic-off{display:none;}
#sv-mute-btn.is-muted .sv-ic-off{display:inline;}
#sv-mute-btn.is-muted .sv-ic-on{display:none;}
.sv-menu-lbl{font-weight:600;}

/* ── delete confirmation sheet — one deliberate extra tap before anything
   is actually removed, since this can't be undone. ── */
#sv-delete-modal{position:absolute;inset:0;z-index:42;background:rgba(0,0,0,0.62);display:none;align-items:center;justify-content:center;padding:0 28px;}
#sv-delete-modal.show{display:flex;}
#sv-delete-modal-inner{width:100%;max-width:300px;background:#181822;border-radius:18px;padding:24px 20px 20px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5);}
#sv-delete-modal-icon{width:46px;height:46px;border-radius:50%;background:rgba(239,68,68,0.16);color:#ef4444;display:flex;align-items:center;justify-content:center;font-size:1.15rem;margin:0 auto 14px;}
#sv-delete-modal-title{color:#fff;font-size:1rem;font-weight:800;margin-bottom:6px;}
#sv-delete-modal-sub{color:rgba(255,255,255,0.55);font-size:0.8rem;line-height:1.45;margin-bottom:18px;}
#sv-delete-modal-btns{display:flex;gap:10px;}
#sv-delete-cancel-btn{flex:1;background:rgba(255,255,255,0.1);border:none;color:#fff;font-weight:700;border-radius:50px;padding:11px;font-size:0.86rem;cursor:pointer;}
#sv-delete-confirm-btn{flex:1;background:#ef4444;border:none;color:#fff;font-weight:800;border-radius:50px;padding:11px;font-size:0.86rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;}

/* close */
#sv-close{position:absolute;top:14px;right:12px;z-index:15;background:rgba(0,0,0,0.5);border:none;color:#fff;border-radius:50%;width:34px;height:34px;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);}

/* media
   FIX (status photo "too large / magnified / blurry"): the old rule used
   object-fit:cover, which force-crops+zooms every image/video to fill the
   100dvh frame — tall portraits especially got blown up past their native
   resolution (blurry) and lost their edges (magnified look). Standard
   status/story UX (WhatsApp/Instagram) shows the FULL image un-cropped
   (object-fit:contain) centered on a softly blurred, darkened copy of the
   same image filling the letterboxed space — #sv-bg-blur below does that. */
#sv-bg-blur{position:absolute;inset:0;background-size:cover;background-position:center;background-repeat:no-repeat;filter:blur(35px) brightness(0.55) saturate(1.1);transform:scale(1.2);z-index:1;display:none;}
#sv-img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none;z-index:2;}
#sv-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none;background:transparent;z-index:2;}
/* ── text-status "premium card" ──
   FIX (long text statuses bleeding under the top bar / bottom action bar,
   fully unreadable past a couple of lines): the old rule centered raw text
   with flex + fixed padding and no scroll container, so anything longer
   than ~5-6 lines simply overflowed behind the top/bottom chrome. Now the
   text lives inside a bounded, scrollable glass card that always keeps
   the FULL article reachable, with chevron buttons to page through it. */
#sv-txt{position:absolute;left:0;right:0;top:0;bottom:0;display:none;align-items:center;justify-content:center;padding:78px 22px 158px;z-index:3;box-sizing:border-box;}
#sv-txt-card{position:relative;width:100%;max-width:340px;max-height:100%;display:flex;flex-direction:column;background:rgba(255,255,255,0.09);border:1px solid rgba(255,255,255,0.18);border-radius:22px;box-shadow:0 20px 50px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.14);overflow:hidden;}
#sv-txt-quote{color:rgba(255,255,255,0.32);font-family:Georgia,'Times New Roman',serif;font-size:2.6rem;line-height:1;padding:16px 24px 0;font-weight:700;}
#sv-txt-scroll{flex:1;min-height:0;overflow-y:auto;padding:4px 26px 24px;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
#sv-txt-scroll::-webkit-scrollbar{display:none;}
#sv-txt-inner{color:#fff;font-size:1.28rem;font-weight:700;line-height:1.5;text-align:center;white-space:pre-wrap;text-shadow:0 1px 6px rgba(0,0,0,0.25);}
#sv-txt-inner.sv-txt-size-md{font-size:1.1rem;}
#sv-txt-inner.sv-txt-size-sm{font-size:0.96rem;line-height:1.55;}
.sv-txt-nav{position:absolute;left:50%;transform:translateX(-50%);width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,0.4);border:none;color:#fff;display:none;align-items:center;justify-content:center;font-size:0.8rem;cursor:pointer;z-index:5;backdrop-filter:blur(5px);transition:opacity 0.15s;}
.sv-txt-nav.show{display:flex;}
#sv-txt-nav-up{top:8px;}
#sv-txt-nav-down{bottom:8px;}
/* FEATURE (2026-10-17 — "after posting, a chevron to expand/collapse a long
   post beyond its first 3 lines"): a long TEXT status now opens clamped to
   3 lines with a chevron under it; tapping expands to the full text (with
   the existing up/down paging inside), tapping again collapses. Short posts
   (<=3 lines) show no chevron. Media captions already had this (see
   #sv-caption-chevron). */
.sv-txt-chevron{display:none;pointer-events:auto;background:rgba(0,0,0,0.45);border:none;color:#fff;border-radius:50%;width:28px;height:28px;margin:0 auto 10px;flex-shrink:0;cursor:pointer;align-items:center;justify-content:center;font-size:0.76rem;transition:transform 0.2s;z-index:6;}
.sv-txt-chevron.show{display:flex;}
#sv-txt-card.sv-txt-expanded .sv-txt-chevron{transform:rotate(180deg);}
#sv-txt-card.sv-txt-clamped #sv-txt-scroll{overflow:hidden;padding-bottom:10px;}
#sv-txt-card.sv-txt-clamped #sv-txt-inner{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
#sv-txt-card.sv-txt-expanded #sv-txt-nav-down{bottom:46px;}
/* 2-line clamp + "more/less" pill; expanding opens a full-screen faint overlay with the status behind it */
.sv-txt-chevron{width:auto;height:auto;padding:7px 14px;border-radius:999px;gap:6px;font-size:0.8rem;font-weight:700;}
.sv-txt-chevron::before{content:"more";}
.sv-txt-chevron i{transition:transform 0.2s;}
#sv-txt-card.sv-txt-expanded{position:absolute;top:0;right:0;bottom:0;left:0;max-width:none;max-height:none;border-radius:0;border:none;box-shadow:none;background:rgba(0,0,0,0.55);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}
#sv-txt-card.sv-txt-expanded #sv-txt-quote{display:none;}
#sv-txt-card.sv-txt-expanded #sv-txt-scroll{padding:84px 24px 10px;}
#sv-txt-card.sv-txt-expanded .sv-txt-chevron{transform:none;align-self:flex-end;margin:12px 24px 150px 0;}
#sv-txt-card.sv-txt-expanded .sv-txt-chevron::before{content:"less";}
#sv-txt-card.sv-txt-expanded .sv-txt-chevron i{transform:rotate(180deg);}
#sv-txt-card.sv-txt-expanded #sv-txt-nav-up{top:76px;}
#sv-txt-card.sv-txt-expanded #sv-txt-nav-down{bottom:200px;}

/* repost tag — small pill shown on statuses that were shared via the
   retweet/share flow (§7), naming who the content was reposted from. */
#sv-repost-tag{position:absolute;top:66px;left:0;right:0;z-index:6;display:none;justify-content:center;pointer-events:none;}
#sv-repost-tag.show{display:flex;}
#sv-repost-tag span{background:rgba(0,0,0,0.5);color:rgba(255,255,255,0.9);font-size:0.7rem;font-weight:700;padding:4px 11px;border-radius:50px;backdrop-filter:blur(4px);display:inline-flex;align-items:center;gap:5px;}

/* caption — FIX (long attached-post handling): collapsed by default to 3
   lines with a chevron to expand/collapse (only shown when the text
   actually overflows 3 lines — no dead chevron on short captions).
   Expanded state re-centers the panel so the now-scrollable text reads
   comfortably away from the media edges, per product spec. */
#sv-caption{position:absolute;bottom:128px;left:0;right:0;text-align:left;color:#fff;font-size:0.88rem;padding:0 20px;text-shadow:0 1px 4px rgba(0,0,0,0.8);z-index:6;pointer-events:none;transition:bottom 0.25s ease,transform 0.25s ease;}
#sv-caption-text{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:pre-wrap;}
.sv-caption-chevron{display:none;pointer-events:auto;background:rgba(0,0,0,0.45);border:none;color:#fff;border-radius:50%;width:26px;height:26px;margin:6px auto 0;cursor:pointer;align-items:center;justify-content:center;font-size:0.72rem;transition:transform 0.2s;}
.sv-caption-chevron.show{display:flex;}
/* FEATURE (2026-10-18 — "implement the expand/collapse style of the reference screenshot"): long captions now end with an inline bold "… Read more" on the third line (and "Show less" once expanded) instead of a chevron circle. The old chevron button stays in the markup but is never shown. */
.sv-readmore,.sv-showless{font-weight:800;color:#fff;cursor:pointer;pointer-events:auto;white-space:nowrap;}
.sv-readmore svg{vertical-align:-2px;margin-left:3px;}
#sv-caption.sv-caption-expanded{top:0;bottom:0;left:0;right:0;transform:none;margin:0;max-width:none;border-radius:0;padding:84px 22px 150px;background:rgba(0,0,0,0.55);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);display:flex;flex-direction:column;pointer-events:auto;box-sizing:border-box;font-size:1rem;line-height:1.55;}
#sv-caption.sv-caption-expanded #sv-caption-text{-webkit-line-clamp:unset;display:block;flex:1;min-height:0;max-height:none;overflow-y:auto;pointer-events:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}
#sv-caption.sv-caption-expanded #sv-caption-text::-webkit-scrollbar{display:none;}
#sv-caption.sv-caption-expanded .sv-caption-chevron{display:inline-flex;align-self:flex-end;width:auto;height:auto;margin:12px 0 0;padding:8px 16px;border-radius:999px;gap:6px;transform:none;font-size:0.85rem;font-weight:700;background:rgba(255,255,255,0.18);}
#sv-caption.sv-caption-expanded .sv-caption-chevron::before{content:"less";}
#sv-caption.sv-caption-expanded .sv-caption-chevron i{transform:rotate(180deg);}
/* UPGRADE (2026-10-25 — "expand from the bottom up, not top to bottom"): the expanded caption is now anchored to the bottom (above the action bar) and grows UPWARD, revealed bottom->top over a bottom-weighted scrim. Overrides the top-anchored rules above (left in place). Chevrons follow the motion: "more" points UP, "less" points DOWN. */
#sv-caption.sv-caption-expanded{justify-content:flex-end;background:linear-gradient(to top,rgba(0,0,0,0.80) 0%,rgba(0,0,0,0.45) 38%,rgba(0,0,0,0) 72%);-webkit-backdrop-filter:none;backdrop-filter:none;animation:svCapFade .22s ease-out both;}
/* FIX (2026-10-25 — "video should not be blurred when expanded"): the older expanded rule above applied blur(8px) over the whole frame; it is now cancelled (backdrop-filter:none) and the dark wash fades out toward the top so the video stays sharp and only the caption area is shaded for legibility. */
#sv-caption.sv-caption-expanded #sv-caption-text{flex:0 1 auto;max-height:64vh;transform-origin:bottom center;animation:svCapRise .34s cubic-bezier(.2,.8,.2,1) both;}
#sv-caption.sv-caption-expanded .sv-caption-chevron{animation:svCapFade .3s ease-out .12s both;}
#sv-caption.sv-caption-expanded .sv-caption-chevron i{transform:none;}
.sv-readmore svg{transform:rotate(180deg);}
@keyframes svCapFade{from{opacity:0}to{opacity:1}}
@keyframes svCapRise{from{clip-path:inset(100% 0 0 0);transform:translateY(22px);opacity:.35}to{clip-path:inset(0 0 0 0);transform:none;opacity:1}}

/* ── retweet / share sheet — editable "quote" composer shown before a
   status is reposted to the viewer's own friends (§7) ── */
#sv-rt-modal{position:absolute;inset:0;z-index:40;background:rgba(0,0,0,0.62);display:none;align-items:flex-end;justify-content:center;}
#sv-rt-modal.show{display:flex;}
#sv-rt-modal-inner{width:100%;background:#181822;border-radius:20px 20px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom,0));}
#sv-rt-modal-header{display:flex;align-items:center;justify-content:space-between;color:#fff;font-weight:700;font-size:0.95rem;margin-bottom:12px;}
#sv-rt-modal-close{background:none;border:none;color:rgba(255,255,255,0.6);font-size:1rem;cursor:pointer;}
#sv-rt-preview{display:flex;gap:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:10px;margin-bottom:12px;}
#sv-rt-preview-av{width:34px;height:34px;border-radius:50%;object-fit:cover;flex-shrink:0;}
#sv-rt-preview-name{color:#fff;font-size:0.8rem;font-weight:700;}
#sv-rt-preview-text{color:rgba(255,255,255,0.75);font-size:0.78rem;margin-top:2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
#sv-rt-comment{width:100%;min-height:64px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.14);border-radius:12px;padding:10px 12px;color:#fff;font-size:0.86rem;resize:none;margin-bottom:12px;outline:none;font-family:inherit;box-sizing:border-box;}
#sv-rt-comment::placeholder{color:rgba(255,255,255,0.4);}
#sv-rt-confirm-btn{width:100%;background:#00D4AA;border:none;color:#0A0F1E;font-weight:800;border-radius:50px;padding:12px;font-size:0.9rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;}
/* FIX 2026-10-15 — repost sheet: the "Repost to friends" button vanished once the on-screen keyboard opened for the
   narrative box (the sheet's bottom edge ended up under the keyboard). The sheet now (a) can scroll inside itself if the
   visible area is tiny, (b) keeps its button from shrinking, and (c) hides the small preview card while the keyboard is up
   (.rt-kb, toggled by _rtSyncKeyboard in §7) so the text box + button always fit above the keyboard. */
#sv-rt-modal-inner{max-height:100%;overflow-y:auto;box-sizing:border-box;-webkit-overflow-scrolling:touch;}
#sv-rt-confirm-btn{flex-shrink:0;min-height:44px;}
#sv-rt-modal.rt-kb #sv-rt-preview{display:none;}
#sv-rt-modal.rt-kb #sv-rt-modal-inner{padding-top:12px;}

/* nav arrows */
/* CHANGE (2026-10-21 - "remove the manual next/back buttons, tap the left and
   right corners instead"): #sv-prev / #sv-next are no longer visible round
   buttons. They are invisible tap zones on the left and right edges (same ids,
   so the existing click handlers keep working). Left corner = back, right
   corner = next. They sit below the top bar and above the bottom action bar,
   so the avatar, close, mute, reactions and reply box are untouched. */
.sv-nav{position:absolute;top:96px;bottom:150px;width:30%;background:transparent;border:0;padding:0;margin:0;color:transparent;font-size:0;cursor:pointer;z-index:4;-webkit-tap-highlight-color:transparent;outline:none;}
#sv-prev{left:0;}
#sv-next{right:0;}

/* ── BOTTOM ACTION BAR (NEW) ──
   Two stacked rows anchored to the bottom of the viewer, mirroring the
   reference screenshot: a row of quick actions (viewer-count / emoji
   reactions / retweet / like) directly above a reply/comment input row.
   Both share one gradient backdrop so they read as a single unit. */
#sv-bottom-bar{position:absolute;bottom:0;left:0;right:0;z-index:8;background:linear-gradient(to top,rgba(0,0,0,0.78) 0%,rgba(0,0,0,0.55) 60%,transparent 100%);padding:10px 12px calc(10px + env(safe-area-inset-bottom,0));display:flex;flex-direction:column;gap:9px;}

/* FIX (2026-10-24 — "the status bar cut into half when users click on the message icon"): the viewer card (#sv-content) is now
   NEVER resized when the keyboard opens. It used to be shrunk to the keyboard-adjusted height while #status-viewer-modal kept it
   vertically centred in the full screen, so the status photo/video was squeezed and shifted (looked cut in half). Now the card stays
   full-screen and fixed; only the reply bar is lifted above the keyboard through --sv-kb (set by _onVVResize in §3). */
#status-viewer-modal{overscroll-behavior:none;}
#sv-content{height:100vh;height:100dvh;}
#sv-bottom-bar{bottom:var(--sv-kb,0px);transition:bottom .12s ease-out;}
/* quick-action row */
#sv-quick-row{display:flex;align-items:center;gap:7px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
#sv-quick-row::-webkit-scrollbar{display:none;}

/* eye badge — viewers count pill (owner only), now expands the panel from the bottom */
#sv-eye-badge{display:none;cursor:pointer;align-items:center;gap:5px;background:rgba(255,255,255,0.14);border:none;border-radius:50px;padding:6px 12px;color:#fff;font-size:0.78rem;font-weight:700;backdrop-filter:blur(6px);flex-shrink:0;}
#sv-eye-badge.show{display:flex;}

/* quick emoji-reaction buttons */
.sv-emoji-quick{background:rgba(255,255,255,0.14);border:none;border-radius:50%;width:36px;height:36px;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform 0.12s;}
.sv-emoji-quick:active{transform:scale(1.25);}

/* repost button — WhatsApp-style loop-arrow SVG glyph (NOT FontAwesome's
   fa-retweet, which renders as a bold filled icon that doesn't match the
   thin two-tone arrows WhatsApp actually uses). The SVG is drawn with
   stroke=currentColor so it inherits this button's color (white normally,
   accent green when reposted) automatically. */
#sv-rt-btn{background:rgba(255,255,255,0.14);border:none;color:#fff;border-radius:50px;padding:6px 12px;font-size:0.78rem;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:background 0.15s,color 0.15s;flex-shrink:0;}
#sv-rt-btn svg{display:block;}
#sv-rt-btn.retweeted{color:#00D4AA;background:rgba(0,212,170,0.22);}

/* bubble heart / like button */
#sv-heart-btn{background:rgba(255,255,255,0.14);border:none;color:#fff;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;gap:4px;padding:6px 12px;border-radius:50px;flex-shrink:0;transition:transform 0.15s;}
#sv-heart-btn.liked i{color:#f87171;}
#sv-heart-btn:active{transform:scale(1.28);}
.sv-like-count{font-size:0.8rem;font-weight:700;}

/* profile / chat — icon-only by default; the Message button additionally
   carries a text label so it's unmistakably a "send a message" action and
   not a generic, ambiguous circle (previous icon-only version was unclear
   about what it did). */
.sv-pill-btn{border:none;color:#fff;border-radius:50%;width:36px;height:36px;font-size:0.92rem;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:rgba(255,255,255,0.14);}
.sv-pill-btn--labeled{width:auto;border-radius:50px;padding:0 13px;gap:6px;font-size:0.78rem;font-weight:700;white-space:nowrap;}
.sv-pill-btn--labeled span{font-size:0.76rem;}

/* ── reply composer — mirrors the WhatsApp reference screenshot: light
   pill-shaped bar, emoji-toggle on the far left, text input, then attach /
   camera / send icons. Replies sent here are PRIVATE direct messages only
   — see _postComment — there is no public comment thread under a status. ── */
#sv-reply-bar{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.95);border-radius:26px;padding:6px 8px 6px 12px;position:relative;transition:box-shadow 0.2s,transform 0.2s;}
#sv-reply-bar input{flex:1;background:transparent;border:none;padding:8px 6px;color:#111;font-size:0.88rem;outline:none;min-width:0;}
#sv-reply-bar input::placeholder{color:#8a8a8a;}
#sv-reply-bar.sv-reply-bar-active{background:#fff;transform:translateY(-2px);}
/* FIX (2026-10-31 — "hide the composer behind the message icon; clicking the message icon should open it"): the reply composer is
   collapsed until the Message pill (#sv-chat-btn) adds .sv-composer-open. The viewer markup is rebuilt on every open, so each
   status viewing starts collapsed. The owner's composer stays hidden separately (inline display:none in _syncCounts). */
#sv-reply-bar:not(.sv-composer-open){display:none !important;}
#sv-emoji-toggle,#sv-attach-btn,#sv-camera-btn{background:none;border:none;color:#6B7280;font-size:1.05rem;width:34px;height:34px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
#sv-emoji-toggle svg,#sv-attach-btn svg,#sv-camera-btn svg,#sv-reply-send svg{display:block;flex-shrink:0;}
#sv-emoji-toggle,#sv-attach-btn,#sv-camera-btn{color:#4B5563;transition:color .15s,background .15s;}
#sv-emoji-toggle:active,#sv-attach-btn:active,#sv-camera-btn:active{background:rgba(27,43,139,0.08);color:#1B2B8B;}
#sv-reply-send svg{margin:1px 2px 0 0;}
#sv-reply-send{background:var(--accent-color,#00D4AA);border:none;border-radius:50%;width:38px;height:38px;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}

/* floating bubble hearts — inside #sv-content */
.sv-bubble{position:absolute;pointer-events:none;z-index:50;font-size:1.4rem;opacity:1;}

/* ── viewers slide-up panel ── */
#sv-viewers-panel{position:absolute;bottom:0;left:0;right:0;z-index:20;background:rgba(12,12,20,0.97);backdrop-filter:blur(16px);border-radius:20px 20px 0 0;max-height:50%;overflow-y:auto;transform:translateY(100%);transition:transform 0.3s cubic-bezier(.4,0,.2,1);scrollbar-width:none;padding-bottom:env(safe-area-inset-bottom,0);}
#sv-viewers-panel::-webkit-scrollbar{display:none;}
#sv-viewers-panel.open{transform:translateY(0);}
.svp-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;border-bottom:1px solid rgba(255,255,255,0.08);position:sticky;top:0;background:rgba(12,12,20,0.97);}
.svp-title{color:#fff;font-size:0.88rem;font-weight:700;display:flex;align-items:center;gap:7px;}
#svp-close{background:none;border:none;color:rgba(255,255,255,0.6);cursor:pointer;font-size:1.1rem;padding:2px 8px;}
.svp-list{padding:6px 0;}
.svp-row{display:flex;align-items:center;gap:11px;padding:9px 16px;cursor:pointer;transition:background 0.15s;}
.svp-row:hover{background:rgba(255,255,255,0.06);}
.svp-avatar{width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid rgba(255,255,255,0.12);}
.svp-info{flex:1;overflow:hidden;}
.svp-name{color:rgba(255,255,255,0.9);font-size:0.84rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.svp-time{color:rgba(255,255,255,0.4);font-size:0.71rem;margin-top:1px;}
/* FIX (2026-10-17 — "make the viewers list's message button a message icon like the reference screenshot"): was a blue "Message" pill; now an icon-only chat button (inline SVG, no webfont dependency) with a 40px tap target. */
.svp-msg-btn{background:transparent;border:none;color:rgba(255,255,255,0.92);border-radius:50%;width:40px;height:40px;padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.15s,transform 0.12s;-webkit-tap-highlight-color:transparent;}
.svp-msg-btn:active{background:rgba(255,255,255,0.14);transform:scale(0.9);}
.svp-msg-btn svg{display:block;}
.svp-empty{color:rgba(255,255,255,0.38);font-size:0.84rem;text-align:center;padding:22px 16px;}

/* ── Facebook-style peek preview card ── */
#sv-peek-overlay{position:fixed;inset:0;z-index:8800;background:transparent;pointer-events:none;transition:background 0.22s;}
#sv-peek-overlay.active{background:rgba(0,0,0,0.55);pointer-events:all;}
#sv-peek-card{position:fixed;bottom:-110%;left:50%;transform:translateX(-50%);width:calc(100% - 24px);max-width:420px;background:#1a1a2e;border-radius:22px 22px 16px 16px;overflow:hidden;z-index:8801;transition:bottom 0.32s cubic-bezier(0.34,1.4,0.64,1);box-shadow:0 -4px 40px rgba(0,0,0,0.6);}
#sv-peek-card.show{bottom:20px;}
.spk-media{position:relative;width:100%;height:300px;background:#000;overflow:hidden;}
.spk-media img,.spk-media video{width:100%;height:100%;object-fit:cover;display:block;}
.spk-grad{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.85) 0%,rgba(0,0,0,0.1) 55%,transparent 100%);}
.spk-segs{position:absolute;top:10px;left:10px;right:10px;display:flex;gap:4px;}
.spk-seg{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,0.32);}
.spk-seg.active{background:#fff;}
.spk-count-pill{position:absolute;top:10px;left:10px;background:rgba(0,0,0,0.55);color:#fff;font-size:0.7rem;font-weight:700;padding:3px 8px;border-radius:10px;display:flex;align-items:center;gap:4px;backdrop-filter:blur(4px);}
.spk-dismiss{position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.5);border:none;color:#fff;border-radius:50%;width:30px;height:30px;font-size:0.82rem;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:5;}
.spk-bottom{padding:14px 16px 16px;}
.spk-user-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
.spk-avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.75);flex-shrink:0;}
.spk-uname{color:#fff;font-size:0.92rem;font-weight:700;line-height:1.2;}
.spk-utime{color:rgba(255,255,255,0.5);font-size:0.7rem;margin-top:1px;}
.spk-caption{color:rgba(255,255,255,0.8);font-size:0.82rem;margin-bottom:10px;line-height:1.4;max-height:2.8em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
.spk-btns{display:flex;gap:8px;}
.spk-open-btn{flex:1;background:var(--accent-color,#00D4AA);border:none;color:#fff;border-radius:50px;padding:12px 16px;font-size:0.88rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;}
.spk-reply-btn{background:rgba(27,43,139,0.88);border:none;color:#fff;border-radius:50px;padding:12px 16px;font-size:0.88rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;}

/* ── Create status modal ── */
/* REDESIGN (2026-09-12 — "make the status uploader look professional,
   premium, modern, dark"): the composer card used to be a plain white
   form. New look reuses the app's OWN --g-hero navy/royal gradient (the
   same premium dark treatment already used for hero sections elsewhere
   in this app, not a foreign palette) plus glass-morphism controls and a
   teal CTA, drawing its layout language (header audience-pill, rounded
   glass buttons, gradient canvas) from a reference composer supplied this
   session. Everything below is ADDITIVE — every id app-status.js's own
   _wireCreateModal()/_scrollStatusModalToBottom()/_attachRemoteStatusMedia()
   already query for, and every legacy .cs-* class those functions create
   dynamically on the media preview (.cs-rm-btn, .cs-dur, .cs-split,
   .cs-more-chip, .cs-upload-*, the .cs-loading/.cs-media-failed/
   .cs-media-in states, #cs-file-preview/#status-file-preview itself), is
   left completely untouched right below this block — only new .csm-*
   rules were added, and index.html's markup order/nesting is unchanged,
   so none of that JS needed to change for this. .cs-card itself is dead
   CSS (no element in index.html has ever used that class — verified) and
   is left in place rather than deleted, per this codebase's convention of
   not removing code other files might still reference. */
/* FIX (2026-09-12): raised from 8900 — several page FABs elsewhere in
   this app force their own z-index up to 99999/10000 !important
   (#quick-post-fab, #submit-complaint-fab), which could render on top
   of this modal's backdrop despite being visually behind it. Belt-and-
   suspenders alongside the body.status-composer-open hide-list above. */
#create-status-modal{position:fixed;inset:0;background:rgba(5,7,20,0.72);display:none;align-items:center;justify-content:center;z-index:999999;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);}
#create-status-modal.show{display:flex;}
/* FIX (2026-09-13 — "notification indicates in the background, not inside
   the status composer"): style.css's #reward-notification (the shared
   toast _notify()/showNotification() write into) sets z-index:var(--z-toast)
   — but --z-toast is never actually defined anywhere in this codebase, so
   per spec that whole z-index declaration is invalid and falls back to
   z-index:auto. This modal's own explicit z-index:999999 above then always
   paints over that auto-stacked toast, so every _notify() call made while
   this composer is open (font/colour cycle confirmations, "Log in to post",
   etc.) was firing correctly but rendering hidden behind the modal instead
   of on top of it — the exact same root cause already diagnosed for the
   Quote/Meme card overlay elsewhere in this codebase (see app-fixes.js's
   emp-quote-card-overlay comment), fixed the same way: rather than edit
   style.css/token.css directly (per this codebase's own don't-touch rule
   for those files, noted a few lines below), raise the toast's z-index
   here instead. 1000002 clears both this modal (999999) AND the Quote/
   Meme card overlay it can open on top of itself (1000001), so a toast
   fired from anywhere in this composer stays visible no matter which of
   its own layers happens to be open above it. */
#reward-notification{z-index:1000002 !important;}
/* FIX (2026-09-12 — "hide the quick post plus sign"): real-device
   screenshot showed the purple #quick-post-fab "+" button (and other
   page FABs) rendering ON TOP of this composer even though it's
   visually covered — those buttons are styled elsewhere with
   z-index:9999/var(--z-modal) !important, higher than this modal's own
   z-index:8900, so an opaque backdrop alone doesn't hide them. Every
   create-status-modal open/close call site now also toggles
   body.status-composer-open (see _wireCreateModal and the tap-handlers
   above it); as long as that class is present, force these known
   floating buttons off regardless of their own z-index. #emp-help-fab
   belongs to self-help-assistance-center.js (not part of this file) —
   still safe/correct to target by id here, same pattern style.css
   already uses for hiding it during other app states (see
   body.emp-live-active #emp-help-fab). */
body.status-composer-open #quick-post-fab,
body.status-composer-open #submit-complaint-fab,
body.status-composer-open #emp-help-fab{display:none !important;}
/* FIX (2026-09-12 — full-screen mode): env(safe-area-inset-*) only resolves
   to a real value when index.html's viewport meta has viewport-fit=cover
   (fixed alongside this) — without it these all evaluate to 0 and this
   rule is a no-op, which is fine/harmless on devices without a notch. On
   notched/gesture-bar devices this keeps the composer's close button and
   Post button from sitting under the status bar or the bottom gesture
   pill when the modal is opened full-bleed. */
/* FIX (2026-09-12 — real-device screenshot showed the card collapsing to
   its content height instead of filling the sheet, with Gallery/Send
   left stranded mid-screen and stray page FABs bleeding through the
   empty space below): relying only on 100dvh/position:sticky wasn't
   enough on this WebView. .csm-card is now a column flexbox — header
   and tabs size naturally, .csm-canvas-wrap (added below) is told to
   flex-grow and eat all remaining height, and the footer simply sits
   last in normal flow. That way Gallery/Meme/Send are pinned hard to
   the bottom of whatever height the card ends up with, with no
   dependency on dvh support, sticky-inside-auto-overflow quirks, or a
   JS-measured --app-vh — it degrades gracefully everywhere. */
/* FIX (2026-09-15 — "make the background a plain primary color instead
   of gradient"): the --g-hero navy→royal-blue gradient above (added in
   the 2026-09-12 redesign noted just above) is replaced with a flat
   var(--primary-color) fill — same brand color family, just solid
   instead of a gradient sweep across the sheet. Falls back to the same
   #1B2B8B the gradient's own endpoint used, so this degrades to a
   near-identical color if --primary-color is ever unset. */
.csm-card{background:#000;border:1px solid rgba(255,255,255,0.09);border-radius:var(--radius-3xl,24px);box-shadow:var(--shadow-xl,0 20px 60px rgba(0,0,0,0.5)),0 0 0 1px rgba(255,255,255,0.04) inset;padding:22px 20px 24px;position:relative;color:#fff;display:flex;flex-direction:column;}
/* FIX (2026-09-12 — full-screen mode, follow-up): the composer used to be
   a centered floating card (max-height:92vh set inline in index.html, 16px
   backdrop padding on every side) — on phones this leaves letterboxed
   gaps above/below the card where the modal's own dimmed backdrop was
   supposed to show, but screenshots show those gaps instead exposing
   whatever native screen/activity sits behind the WebView (e.g. the OS
   share/photo-picker "Preview" screen) rather than this app's own dimmed
   overlay. Below 600px width the card now fills the ENTIRE viewport
   edge-to-edge (no backdrop gap possible at all, matching Instagram/
   WhatsApp-style status composers) using safe-area-aware padding instead
   of margins so content still clears notches/gesture bars — this rule
   comes AFTER the base .csm-card rule above (same selector, later wins)
   for border-radius/padding, but width/max-width/max-height need
   !important since index.html's own inline style="max-width:420px;
   width:95vw;max-height:92vh;overflow-y:auto;" on .create-status-card
   would otherwise always win over any external stylesheet rule
   regardless of selector specificity — inline styles are left in place
   in index.html (untouched, per the no-deletion convention) and simply
   overridden here the one way CSS allows that. Above 600px (tablets/
   desktop) it reverts to the original centered floating-card treatment
   via the media query below, since a full-bleed 100vw card looks wrong
   once there's room to spare. */
/* FIX (2026-09-12 — "don't make it full screen, leave some space at the
   top, exactly like the reference screenshot"): the composer used to
   stretch edge-to-edge from y:0 (height:100dvh, border-radius:0, modal
   container centered). The reference screenshot shows a bottom-sheet: a
   visible gap above the card revealing whatever sits behind it, and a
   rounded top edge on the card itself. Below 600px the card now sits at
   the BOTTOM of the modal (align-items:flex-end on the modal, set right
   below) at 88% of viewport height instead of 100%, restoring the
   top-rounded corners — the bottom stays flush/square against the
   screen edge, matching the screenshot. */
.csm-card.csm-card{width:100% !important;height:88dvh;height:calc(var(--app-vh,1vh)*88);max-width:100% !important;max-height:88dvh !important;max-height:calc(var(--app-vh,1vh)*88) !important;border-radius:28px 28px 0 0;overflow-y:auto;box-sizing:border-box;padding:calc(22px + env(safe-area-inset-top,0px)) calc(20px + env(safe-area-inset-right,0px)) calc(24px + env(safe-area-inset-bottom,0px)) calc(20px + env(safe-area-inset-left,0px));}
#create-status-modal{align-items:flex-end;}
@media (min-width:600px){
    .csm-card.csm-card{width:95vw !important;max-width:420px !important;height:auto;max-height:92vh !important;border-radius:var(--radius-3xl,24px);padding:22px 20px 24px;}
    #create-status-modal{align-items:center;}
}
.csm-card::-webkit-scrollbar{width:6px;}
.csm-card::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.18);border-radius:10px;}
.csm-card::-webkit-scrollbar-track{background:transparent;}
.csm-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:20px;flex-shrink:0;}
.csm-title{margin:0;font-family:var(--font-display,'Fraunces',serif);font-size:var(--text-2xl,1.2rem);font-weight:700;color:#fff;display:flex;align-items:center;gap:9px;}
.csm-title i{color:var(--color-teal,#00D4AA);font-size:0.85em;}
.csm-header-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;}
.csm-close-btn{width:34px;height:34px;flex-shrink:0;border-radius:50%;background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.14);color:#fff;font-size:0.82rem;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);transition:background 0.2s,transform 0.15s;}
.csm-close-btn:hover{background:rgba(255,255,255,0.18);}
.csm-close-btn:active{transform:scale(0.9);}
.csm-audience-wrap{position:relative;display:inline-flex;align-items:center;}
.csm-audience-icon{position:absolute;left:12px;color:rgba(255,255,255,0.6);font-size:0.72rem;pointer-events:none;}
.csm-audience-select{appearance:none;-webkit-appearance:none;-moz-appearance:none;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);color:#fff;font-size:var(--text-xs,0.72rem);font-weight:700;font-family:inherit;padding:8px 26px 8px 30px;border-radius:var(--radius-pill,50px);backdrop-filter:blur(6px);cursor:pointer;max-width:132px;text-overflow:ellipsis;}
.csm-audience-select:focus{outline:none;border-color:rgba(0,212,170,0.55);}
.csm-audience-select option{background:#0A0E27;color:#fff;}
.csm-audience-caret{position:absolute;right:11px;color:rgba(255,255,255,0.55);font-size:0.62rem;pointer-events:none;}
.csm-section{margin-bottom:16px;}
.csm-section:last-of-type{margin-bottom:0;}
.csm-section-label{font-size:var(--text-2xs,0.625rem);font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:rgba(255,255,255,0.5);display:flex;align-items:center;gap:6px;margin-bottom:9px;}
.csm-section-label i{color:var(--color-teal,#00D4AA);font-size:0.85em;}
.csm-hidden-input{display:none;}
.csm-media-tile{display:flex;align-items:center;gap:12px;cursor:pointer;padding:14px 16px;border-radius:16px;border:1.5px dashed rgba(255,255,255,0.22);background:rgba(255,255,255,0.05);transition:background 0.2s,border-color 0.2s;}
.csm-media-tile:hover,.csm-media-tile:active{background:rgba(255,255,255,0.09);border-color:rgba(255,255,255,0.36);}
.csm-media-icon{width:44px;height:44px;border-radius:50%;background:var(--g-teal,linear-gradient(135deg,#00D4AA,#10B981));display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:var(--shadow-teal-sm,0 4px 16px rgba(0,212,170,0.2));}
.csm-media-label-main{display:block;font-weight:700;color:#fff;font-size:var(--text-md,0.9rem);}
.csm-media-label-sub{display:block;font-size:var(--text-xs,0.72rem);color:rgba(255,255,255,0.5);margin-top:2px;}
.csm-quote-btn{margin-top:10px;width:100%;cursor:pointer;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.14);color:#fff;display:flex;align-items:center;justify-content:center;gap:8px;font-size:var(--text-sm,0.8rem);font-weight:700;font-family:inherit;backdrop-filter:blur(6px);transition:background 0.2s,transform 0.15s;}
.csm-quote-btn i{color:var(--color-gold,#FFD500);}
.csm-quote-btn:hover{background:rgba(255,255,255,0.12);}
.csm-quote-btn:active{transform:scale(0.98);}
/* FIX (2026-09-12 — "remove the small underlay 'what's on your mind'
   card"): this box used to size to the textarea's own rows="5" height
   only, leaving a visible gap of plain card background beneath it down
   to the footer. flex:1 makes it fill 100% of its (now flex-grown)
   .csm-mode-panel, i.e. the entire remaining sheet height — one
   continuous gradient surface all the way to the footer, matching the
   screenshot. */
.csm-text-wrap{position:relative;border-radius:16px;overflow:hidden;box-shadow:0 10px 26px rgba(0,0,0,0.32),0 0 0 1px rgba(255,255,255,0.06) inset;transition:background 0.25s;flex:1 1 auto;display:flex;min-height:180px;}
.csm-text-input{display:block;width:100%;height:100%;flex:1;background:transparent;border:none;padding:18px 56px 18px 16px;color:#fff;font-size:var(--text-lg,1rem);font-weight:600;line-height:1.45;resize:none;outline:none;font-family:var(--font-sans,'Manrope',sans-serif);}
.csm-text-input::placeholder{color:rgba(255,255,255,0.55);}
.csm-text-wrap.csm-light-bg .csm-text-input{color:#111827;}
.csm-text-wrap.csm-light-bg .csm-text-input::placeholder{color:rgba(17,24,39,0.5);}
.csm-color-btn{position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:50%;border:1.5px solid rgba(255,255,255,0.6);background:rgba(255,255,255,0.16);cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);transition:transform 0.15s,background 0.2s;}
.csm-color-btn:hover{background:rgba(255,255,255,0.26);}
.csm-color-btn:active{transform:scale(0.88);}
.csm-post-btn{width:100%;padding:14px;border:none;border-radius:var(--radius-pill,50px);background:var(--g-teal,linear-gradient(135deg,#00D4AA,#10B981));color:var(--color-navy,#0A0E27);font-weight:800;font-size:var(--text-md,0.9rem);font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;box-shadow:var(--shadow-teal,0 8px 32px rgba(0,212,170,0.25));transition:transform 0.15s,box-shadow 0.2s,opacity 0.2s;}
.csm-post-btn:hover{transform:translateY(-2px);box-shadow:0 14px 40px rgba(0,212,170,0.4);}
.csm-post-btn:active{transform:translateY(0) scale(0.98);}
.csm-post-btn:disabled{opacity:0.7;cursor:default;transform:none;}
.cs-card{background:#fff;border-radius:20px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,0.28);width:100%;max-width:480px;max-height:90vh;overflow-y:auto;}
#cs-file-preview,#status-file-preview{display:none;width:100%;position:relative;margin-top:10px;min-height:160px;}
/* #cs-file-preview keeps the original boxed "card" look (unused elsewhere
   in this codebase, left in place per the no-deletion convention — see
   the header comment above this section). #status-file-preview
   (Status composer only) is now PLAIN per the reference screenshot
   ("don't demarcate using a thumbnail card, the entire card should be
   plain"): no rounded corners, no drop shadow, no boxed gradient behind
   it — the photo/video just sits flush as part of the one continuous
   composer surface, same as the reference. It also now renders ABOVE
   the caption/Text panel in the DOM (see index.html) rather than below
   it, so this plain block is the first thing shown once media is
   attached. */
#cs-file-preview{border-radius:18px;overflow:hidden;background:linear-gradient(135deg,#0A0E27,#1B2B8B);box-shadow:0 10px 28px rgba(10,14,39,0.18),0 0 0 1px rgba(255,255,255,0.07) inset;}
#status-file-preview{border-radius:0;overflow:visible;background:transparent;box-shadow:none;margin-top:0;margin-bottom:14px;}
#cs-file-preview.cs-loading{background-image:linear-gradient(135deg,#0A0E27,#1B2B8B),linear-gradient(100deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.10) 50%,rgba(255,255,255,0) 100%);background-size:100% 100%,220% 100%;animation:cs-shimmer 1.7s ease-in-out infinite;}
/* Plain equivalent of the shimmer above for #status-file-preview — a flat
   translucent fill (no gradient "card" identity) just so the loading
   state isn't invisible against the modal's own dark backdrop; it never
   gets a border-radius/shadow to keep it from reading as a boxed card. */
#status-file-preview.cs-loading{background:rgba(255,255,255,0.06);background-image:linear-gradient(100deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.10) 50%,rgba(255,255,255,0) 100%);background-size:220% 100%;animation:cs-shimmer 1.7s ease-in-out infinite;border-radius:14px;min-height:160px;}
#cs-file-preview.cs-media-failed{background:linear-gradient(135deg,#7F1D1D,#450A0A);animation:none;}
#status-file-preview.cs-media-failed{background:rgba(127,29,29,0.35);animation:none;border-radius:14px;min-height:160px;}
.cs-media-error{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;color:#fff;font-size:0.85rem;font-weight:600;}
@keyframes cs-shimmer{0%{background-position:0 0,-220% 0;}100%{background-position:0 0,220% 0;}}
#cs-file-preview video,#cs-file-preview img,
#status-file-preview video,#status-file-preview img{width:100%;max-height:340px;object-fit:cover;display:block;opacity:0;transform:scale(1.015);transition:opacity 0.4s ease,transform 0.4s ease;}
/* #status-file-preview's own media additionally gets a modest, uniform
   rounding — just enough that the photo/video reads as a photo rather
   than a hard-edged rectangle — without the surrounding boxed-card
   background/shadow that made it look like a nested thumbnail tile. */
#status-file-preview video,#status-file-preview img{border-radius:14px;}
#cs-file-preview video.cs-media-in,#cs-file-preview img.cs-media-in,
#status-file-preview video.cs-media-in,#status-file-preview img.cs-media-in{opacity:1;transform:scale(1);}
.cs-rm-btn{position:absolute;top:10px;right:10px;background:rgba(10,14,39,0.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:#fff;border:1px solid rgba(255,255,255,0.18);border-radius:50%;width:30px;height:30px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.74rem;z-index:5;box-shadow:0 2px 10px rgba(0,0,0,0.25);transition:background 0.2s,transform 0.15s;}
.cs-rm-btn:hover{background:rgba(10,14,39,0.75);transform:scale(1.06);}
.cs-rm-btn:active{transform:scale(0.94);}
.cs-dur{position:absolute;bottom:10px;left:10px;background:rgba(10,14,39,0.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:#fff;font-size:0.72rem;font-weight:700;padding:4px 10px;border-radius:20px;border:1px solid rgba(255,255,255,0.14);letter-spacing:0.02em;}
.cs-split{position:absolute;top:10px;left:10px;background:linear-gradient(135deg,#00D4AA,#0FB294);color:#fff;font-size:0.7rem;font-weight:700;padding:4px 10px;border-radius:20px;display:flex;align-items:center;gap:5px;box-shadow:0 3px 10px rgba(0,212,170,0.35);}
.cs-more-chip{position:absolute;bottom:10px;right:10px;background:rgba(10,14,39,0.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:#fff;font-size:0.74rem;font-weight:700;padding:4px 10px;border-radius:20px;border:1px solid rgba(255,255,255,0.14);}
.cs-upload-progress{position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(255,255,255,0.15);border-radius:0 0 18px 18px;overflow:hidden;}
.cs-upload-bar{height:100%;width:0%;background:linear-gradient(90deg,#00D4AA,#38BDF8);transition:width 0.3s;}
.cs-upload-pct{position:absolute;bottom:6px;right:8px;font-size:0.7rem;font-weight:700;color:#fff;background:rgba(10,14,39,0.55);padding:2px 7px;border-radius:10px;display:none;}
.cs-upload-pct.cs-show{display:block;}

/* ── Create-status composer v5 — Text/Quote/Meme tabs + tool rail ──
   FEATURE (2026-09-12 — "modern status uploader tab", reference composer
   supplied this session: Text/Quote/Meme mode tabs, a floating right-hand
   tool rail — music/background/font/sticker — and a Gallery+Send footer).
   Purely additive: every pre-existing id (#status-text-input,
   #status-text-wrap, #status-color-cycle-btn, #status-file-input,
   #status-file-preview, #status-quote-card-btn, #post-status-btn) is kept
   byte-for-byte so none of _wireCreateModal()'s existing wiring changes —
   this only adds the tab/tool chrome AROUND those same controls.

   REDESIGN (2026-09-12, superseded same day — "every button should be on
   top in the same row with the text button, horizontally scrollable"):
   this briefly folded the tool rail INTO the #status-mode-tabs row
   alongside Text/Quote/Meme, one shared horizontal scroll strip. Reverted
   per the reference screenshot supplied afterward, which shows exactly
   two separate groups: Text/Quote/Meme alone in a plain horizontal row,
   and music/palette/T/sticker stacked in their OWN vertical column
   floating over the top-right corner of the canvas — not sharing a row
   with the tabs at all. #status-mode-tabs (index.html) now holds only
   the three tab buttons; .csm-tools-col has moved to be a direct child
   of .csm-canvas-wrap instead (still the same single instance covering
   Text/Quote/Meme/captioned-media alike). _wireCsmToolRail() below still
   finds it via modal.querySelector('.csm-tools-col') regardless of which
   element is its parent, so no JS wiring changed for this move — only
   the CSS below (row → column, inline → absolute) and index.html's
   markup location. */
.csm-mode-tabs{display:flex;align-items:center;justify-content:flex-start;gap:8px;margin-bottom:16px;flex-shrink:0;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:2px 2px 6px;touch-action:pan-x;overscroll-behavior-x:contain;}
/* FIX (2026-10-17 — "Text button not accessible / enable horizontal swipe"):
   this row was justify-content:center with overflow-x:auto. A centred flex
   row that overflows clips equally on BOTH sides and the clipped start can
   never be scrolled to — so on a narrow phone (five tabs now: Text, Quote,
   Meme, Election, Voice) the first tab, Text, sat partly/fully off the left
   edge and could not be reached by swiping or tapping. flex-start + auto
   margins on the first/last tab keeps the row centred when it fits, and
   makes it start at Text and swipe horizontally when it doesn't.
   touch-action:pan-x lets the horizontal swipe through to this strip. */
.csm-mode-tabs>.csm-mode-tab:first-child{margin-left:auto;}
.csm-mode-tabs>.csm-mode-tab:last-child{margin-right:auto;}
.csm-mode-tabs::-webkit-scrollbar{display:none;}
.csm-mode-tab{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.14);color:rgba(255,255,255,0.72);padding:8px 20px;border-radius:20px;font-size:var(--text-sm,0.82rem);font-weight:700;font-family:inherit;cursor:pointer;transition:all 0.2s;flex-shrink:0;white-space:nowrap;}
.csm-mode-tab.active{background:#fff;color:#0A0E27;border-color:#fff;box-shadow:0 4px 14px rgba(0,0,0,0.28);}
/* FIX (2026-09-12): flex-grow so this eats all the leftover height inside
   the now-column-flex .csm-card instead of hugging its own content —
   this is what makes the Text/Quote/Meme panel stretch to fill the
   sheet (matching the screenshot) and pushes the footer down to the
   true bottom without needing position:sticky. min-height:0 lets it
   shrink below its content's natural size so overflow-y:auto on the
   card, not this wrapper, is what scrolls if content is ever taller
   than the sheet. position:relative is what lets .csm-tools-col below
   anchor to THIS box (top-right of the canvas) rather than the whole
   card. */
.csm-canvas-wrap{position:relative;margin-bottom:14px;flex:1 1 auto;min-height:120px;display:flex;flex-direction:column;}
/* REVERTED back to a floating vertical column (see REDESIGN/reversion
   note above .csm-mode-tabs) — position:absolute, top-right corner of
   .csm-canvas-wrap, stacked top-to-bottom. z-index:4 keeps it above the
   Text/Quote/Meme panels beneath it (and above an attached photo/video —
   #status-file-preview sits ABOVE .csm-canvas-wrap in the DOM now, see
   index.html, so this rail only ever overlays the panels, never the
   media itself). .csm-text-input's existing padding-right:56px (added
   when this rail first floated) already reserves clearance for it, so
   caption text was never going to run underneath these icons. */
.csm-tools-col{position:absolute;top:10px;right:10px;z-index:4;display:flex;flex-direction:column;align-items:center;gap:10px;flex-shrink:0;}
.csm-tool-btn{width:38px;height:38px;flex-shrink:0;border-radius:50%;background:rgba(0,0,0,0.38);border:1px solid rgba(255,255,255,0.22);color:#fff;font-size:0.92rem;font-weight:800;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);transition:transform 0.15s;}
.csm-tool-btn:active{transform:scale(0.88);}
.csm-tool-btn[hidden]{display:none;}
/* FEATURE (2026-09-12 — "when a photo/video is selected, open a text
   composer to caption it"): once real media is attached, the Quote/Meme
   tabs and the background-color cycler stop making sense (there's a
   real photo/video now, not a colour card), so #create-status-modal
   picks up this class (see the fileInp 'change'/remove handlers in
   _wireCreateModal below) to fold them out of the row — leaving Text
   (now acting purely as the caption field), plus Music/Font/Sticker,
   which still apply to a captioned photo/video. */
#create-status-modal.csm-media-active .csm-mode-tab[data-mode="quote"],
#create-status-modal.csm-media-active .csm-mode-tab[data-mode="meme"],
#create-status-modal.csm-media-active #status-color-cycle-btn{display:none;}
/* FIX (2026-09-12 — "media at the top, plain text composer at the
   bottom"): once a photo/video is attached (#status-file-preview, now
   rendered ABOVE this wrap per index.html), the Text panel's own
   full-height gradient "hero" background stopped making sense underneath
   real media — it read as a second, redundant colour card stacked below
   the photo instead of a plain caption strip. In media-active mode this
   collapses .csm-canvas-wrap/.csm-text-wrap down to just the height the
   caption textarea itself needs and drops the gradient in favour of a
   flat, transparent field — a plain text composer sitting under the
   media, not a card of its own. Text/Quote/Meme mode with NO media
   attached is completely untouched (these rules are scoped to
   .csm-media-active only), so the full-height colour-cycling canvas
   still works exactly as before for a text-only or Quote/Meme status. */
#create-status-modal.csm-media-active .csm-canvas-wrap{flex:0 0 auto;min-height:0;margin-bottom:0;}
#create-status-modal.csm-media-active .csm-text-wrap{background:transparent !important;box-shadow:none;flex:0 0 auto;min-height:0;}
#create-status-modal.csm-media-active .csm-text-input{padding:12px 56px 12px 16px;font-size:var(--text-md,0.92rem);}

/* FEATURE (2026-10-17 — "when the user picks Media, design the text
   composer like the reference screenshot" + "composer grows as the text
   grows"): once real media is attached (csm-media-active), the composer
   becomes a full-screen, WhatsApp-style editor instead of the blue
   bottom-sheet card —
     [ X ]                         [ music ][ Aa ][ sticker ]
     ┌──────────── media, fills the middle ────────────┐
     [ gallery  Add a caption…  (grows as you type)     ]
     [ audience chip ]                          ( send )
   Done purely with CSS grid on the SAME elements (header / canvas-wrap /
   footer-bar are display:contents so their children become grid items),
   so no ids, markup or handlers changed. Text/Quote/Meme/Voice/Election
   with NO media attached are untouched — everything is scoped to
   .csm-media-active. */
#create-status-modal.csm-media-active{background:#000;backdrop-filter:none;-webkit-backdrop-filter:none;align-items:stretch;}
#create-status-modal.csm-media-active .csm-card.csm-card{
  width:100% !important;max-width:100% !important;
  height:100dvh;height:calc(var(--app-vh,1vh)*100);
  max-height:100dvh !important;max-height:calc(var(--app-vh,1vh)*100) !important;
  border-radius:0;border:none;box-shadow:none;background:#000 !important;overflow:hidden;
  padding:calc(12px + env(safe-area-inset-top,0px)) 12px calc(12px + env(safe-area-inset-bottom,0px));
  display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto minmax(0,1fr) auto auto;
  grid-template-areas:"close tools" "media media" "cap cap" "aud send";
  column-gap:10px;row-gap:10px;align-items:center;}
@media (min-width:600px){#create-status-modal.csm-media-active .csm-card.csm-card{max-width:480px !important;margin:0 auto;}}
#create-status-modal.csm-media-active .csm-header,
#create-status-modal.csm-media-active .csm-canvas-wrap,
#create-status-modal.csm-media-active .csm-footer-bar{display:contents;}
#create-status-modal.csm-media-active .csm-mode-tabs{display:none;}
#create-status-modal.csm-media-active #status-color-cycle-btn,
#create-status-modal.csm-media-active .csm-adv-quote-btn{display:none;}
/* top row */
#create-status-modal.csm-media-active .csm-close-btn{grid-area:close;justify-self:start;width:46px;height:46px;background:rgba(32,34,38,0.92);border:none;font-size:1rem;backdrop-filter:none;}
#create-status-modal.csm-media-active .csm-tools-col{grid-area:tools;justify-self:end;position:static;flex-direction:row;gap:10px;}
#create-status-modal.csm-media-active .csm-tool-btn{width:46px;height:46px;background:rgba(32,34,38,0.92);border:none;backdrop-filter:none;font-size:1.05rem;}
#create-status-modal.csm-media-active #status-font-cycle-btn{font-size:0;}
#create-status-modal.csm-media-active #status-font-cycle-btn::after{content:"Aa";font-size:1.05rem;font-weight:800;}
/* media fills the middle */
#create-status-modal.csm-media-active #status-file-preview{grid-area:media;align-self:stretch;position:relative;min-height:0;margin:0;overflow:hidden;border-radius:0;}
#create-status-modal.csm-media-active #status-file-preview video,
#create-status-modal.csm-media-active #status-file-preview img{position:absolute;inset:0;width:100%;height:100%;max-height:none;object-fit:contain;border-radius:0;}
/* caption pill — grows with its content */
#create-status-modal.csm-media-active .csm-mode-panel.active{grid-area:cap;align-self:end;flex:0 0 auto;min-height:0;}
#create-status-modal.csm-media-active .csm-text-wrap{background:#14181d !important;border-radius:28px;box-shadow:none;flex:0 0 auto;min-height:0;}
#create-status-modal.csm-media-active .csm-text-input{padding:14px 16px 14px 56px;font-size:1rem;font-weight:500;line-height:1.4;height:auto;min-height:24px;max-height:38vh;overflow-y:auto;color:#fff;}
#create-status-modal.csm-media-active .csm-text-wrap.csm-light-bg .csm-text-input{color:#fff;}
#create-status-modal.csm-media-active .csm-text-input::placeholder,
#create-status-modal.csm-media-active .csm-text-wrap.csm-light-bg .csm-text-input::placeholder{color:rgba(255,255,255,0.6);}
/* the Gallery label becomes the add-media icon inside the pill */
#create-status-modal.csm-media-active .csm-gallery-btn{grid-area:cap;justify-self:start;align-self:end;margin:0 0 12px 14px;z-index:3;font-size:0;gap:0;padding:0;width:30px;height:30px;background:transparent;border:none;color:#fff;}
#create-status-modal.csm-media-active .csm-gallery-btn i{font-size:1.3rem;}
#create-status-modal.csm-media-active .csm-gallery-btn svg{width:26px;height:26px;}
#create-status-modal.csm-media-active .csm-gallery-btn span{display:none;}
/* bottom row: audience chip + round send */
#create-status-modal.csm-media-active .csm-audience-wrap{grid-area:aud;justify-self:start;align-self:center;}
#create-status-modal.csm-media-active .csm-audience-select{background:#14181d;border:none;max-width:210px;font-size:0.9rem;padding:12px 30px 12px 34px;}
#create-status-modal.csm-media-active #status-except-btn{grid-area:aud;justify-self:start;margin-left:190px;}
#create-status-modal.csm-media-active .csm-send-btn{grid-area:send;justify-self:end;width:56px;height:56px;background:#fff;color:#111;box-shadow:none;}
/* FIX (2026-10-17): while posting, the button shows "[spinner] Posting…" —
   in a 56px circle the text spilled off-screen (visible in the reference
   screenshots). Show only the spinner. Applies in every composer mode. */
.csm-send-btn:disabled{font-size:0;}
.csm-send-btn:disabled i{font-size:1.2rem;}
.csm-mode-panel{display:none;}
/* FIX (2026-09-12): was display:block (content-height only) — now a
   column flex so its child (.csm-text-wrap / .csm-quote-card /
   .csm-meme-wrap) can be told to flex:1 and actually fill the tall
   panel area instead of leaving dead gradient space beneath a small
   fixed-height box. */
.csm-mode-panel.active{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;}
.csm-music-sticker{display:none;align-items:center;gap:8px;background:rgba(0,0,0,0.45);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.22);color:#fff;padding:7px 12px;border-radius:20px;font-size:var(--text-xs,0.75rem);font-weight:700;margin-bottom:10px;width:max-content;max-width:100%;}
.csm-music-sticker.active{display:flex;}
.csm-music-sticker-label{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.csm-music-sticker-x{cursor:pointer;background:rgba(255,255,255,0.22);border-radius:50%;width:16px;height:16px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;font-size:0.68rem;line-height:1;}
.csm-quote-card{background:rgba(255,255,255,0.12);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.18);padding:24px 22px;border-radius:18px;color:#fff;min-height:160px;display:flex;flex-direction:column;justify-content:center;box-shadow:0 10px 26px rgba(0,0,0,0.28);}
.csm-quote-text{font-size:var(--text-lg,1.15rem);font-style:italic;line-height:1.42;margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;}
.csm-quote-author{font-size:var(--text-sm,0.85rem);font-weight:700;opacity:0.85;text-align:right;margin:0;}
.csm-shuffle-btn{margin-top:12px;width:100%;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.18);color:#fff;padding:10px 14px;border-radius:20px;font-size:var(--text-sm,0.82rem);font-weight:700;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:background 0.2s,transform 0.15s;}
.csm-shuffle-btn:hover{background:rgba(255,255,255,0.18);}
.csm-shuffle-btn:active{transform:scale(0.97);}
.csm-meme-wrap{width:100%;max-height:260px;min-height:170px;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35);position:relative;}
.csm-meme-img{width:100%;max-height:260px;object-fit:contain;display:block;}
.csm-meme-loading{position:absolute;inset:0;display:none;align-items:center;justify-content:center;color:#fff;font-size:1.3rem;background:rgba(0,0,0,0.3);}
.csm-meme-loading.active{display:flex;}
/* FEATURE (2026-09-13 — "add voice note as a feature"). Three sub-states
   of #status-voice-wrap (idle/recording/ready) toggled via its own
   [data-state] attribute in app-status.js's _csmVoice* functions below —
   only the matching one is ever visible, same single-source-of-truth
   pattern the Text/Quote/Meme tabs already use via .csm-mode-panel.active. */
.csm-voice-wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;min-height:220px;}
.csm-voice-idle,.csm-voice-active,.csm-voice-ready{display:none;flex-direction:column;align-items:center;gap:18px;width:100%;}
.csm-voice-wrap[data-state="idle"] .csm-voice-idle{display:flex;}
.csm-voice-wrap[data-state="recording"] .csm-voice-active{display:flex;}
.csm-voice-wrap[data-state="ready"] .csm-voice-ready{display:flex;}
.csm-voice-record-btn{width:78px;height:78px;border-radius:50%;background:#fff;color:#0A0E27;border:none;font-size:28px;cursor:pointer;box-shadow:0 8px 26px rgba(0,0,0,0.35);transition:transform 0.15s;}
.csm-voice-record-btn:active{transform:scale(0.92);}
.csm-voice-record-btn{display:flex;align-items:center;justify-content:center;color:#1B2B8B;border:1.5px solid rgba(27,43,139,0.14);background:linear-gradient(160deg,#fff 0%,#EEF0FA 100%);box-shadow:0 8px 26px rgba(0,0,0,0.35),0 0 0 7px rgba(255,255,255,0.14),inset 0 1px 0 #fff;}
.csm-voice-record-btn svg{width:34px;height:34px;display:block;}
.csm-voice-mic-badge svg{width:10px;height:10px;display:block;}
.csm-voice-hint{color:rgba(255,255,255,0.72);font-size:var(--text-sm,0.85rem);font-weight:600;margin:0;}
.csm-voice-card{width:100%;max-width:320px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.18);border-radius:20px;padding:14px 18px;display:flex;align-items:center;gap:14px;box-shadow:0 10px 26px rgba(0,0,0,0.24);}
.csm-voice-avatar-wrap{position:relative;width:46px;height:46px;flex-shrink:0;}
.csm-voice-avatar{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;}
.csm-voice-mic-badge{position:absolute;bottom:-2px;right:-2px;background:#E53935;border:2px solid #0A0E27;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;}
.csm-voice-wave{flex:1;display:flex;align-items:center;gap:3px;height:24px;overflow:hidden;}
.csm-voice-wave .cvw-bar{width:3px;border-radius:2px;background:rgba(255,255,255,0.85);flex-shrink:0;height:6px;}
.csm-voice-timer{font-size:0.8rem;color:rgba(255,255,255,0.85);min-width:34px;flex-shrink:0;text-align:right;font-variant-numeric:tabular-nums;}
.csm-voice-stop-btn{width:58px;height:58px;border-radius:50%;background:#E53935;color:#fff;border:none;font-size:19px;cursor:pointer;animation:csmVoicePulse 1s infinite alternate;box-shadow:0 6px 18px rgba(229,57,53,0.4);}
@keyframes csmVoicePulse{from{transform:scale(1);}to{transform:scale(1.08);}}
.csm-voice-play-btn{width:34px;height:34px;border-radius:50%;background:#fff;color:#0A0E27;border:none;flex-shrink:0;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;}
.csm-voice-retake-btn{background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.22);color:#fff;padding:9px 20px;border-radius:20px;font-weight:700;font-size:0.82rem;cursor:pointer;display:inline-flex;align-items:center;gap:8px;}
/* ── ELECTION mode (candidate support card) — mirrors the Voice card's
   look (rgba white card on the dark canvas background) so it reads as
   the same family of tab, not a bolted-on style. ── */
.csm-election-wrap{padding:10px 4px;overflow-y:auto;}
.csm-election-hint{color:rgba(255,255,255,0.75);font-size:0.82rem;text-align:center;margin-bottom:14px;}
.csm-election-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}
.csm-election-cand{background:rgba(255,255,255,0.06);border:2px solid rgba(255,255,255,0.14);border-radius:16px;padding:10px 8px;text-align:center;cursor:pointer;position:relative;}
.csm-election-cand.selected{border-color:var(--picked,#00D4AA);background:rgba(255,255,255,0.12);}
.csm-election-cand img{width:44px;height:44px;border-radius:50%;object-fit:cover;background:#fff;margin:0 auto 6px;display:block;}
.csm-election-cand .cec-name{color:#fff;font-size:0.76rem;font-weight:700;}
.csm-election-cand .cec-party{color:rgba(255,255,255,0.6);font-size:0.64rem;margin-top:2px;}
.csm-election-cand .cec-check{position:absolute;top:6px;right:6px;width:16px;height:16px;border-radius:50%;background:var(--picked,#00D4AA);color:#04231d;display:none;align-items:center;justify-content:center;font-size:0.6rem;}
.csm-election-cand.selected .cec-check{display:flex;}
.csm-election-photo-btn{margin:16px auto 0;display:flex;align-items:center;justify-content:center;gap:8px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.22);color:#fff;padding:11px 20px;border-radius:22px;font-weight:700;font-size:0.82rem;cursor:pointer;width:max-content;}
.csm-election-preview-wrap{display:flex;justify-content:center;margin-top:16px;}
.csm-election-preview-wrap canvas{width:200px;height:200px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.4);}
.csm-election-note{color:rgba(255,255,255,0.55);font-size:0.68rem;text-align:center;margin:12px 10px 0;line-height:1.4;}
/* status VIEWER playback (§ voice) — mirrors the composer card above so a
   posted voice note visually matches what was recorded. */
#sv-voice{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:78px 22px 158px;z-index:2;box-sizing:border-box;}
.sv-voice-card{width:100%;max-width:340px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:22px;padding:18px 20px;display:flex;align-items:center;gap:16px;box-shadow:0 20px 50px rgba(0,0,0,0.4);backdrop-filter:blur(10px);}
.sv-voice-avatar-wrap{position:relative;width:52px;height:52px;flex-shrink:0;}
.sv-voice-avatar-wrap img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;}
.sv-voice-mic-badge{position:absolute;bottom:-2px;right:-2px;background:#E53935;border:2px solid #111;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;}
.sv-voice-wave{flex:1;display:flex;align-items:center;gap:3px;height:26px;overflow:hidden;}
.sv-voice-wave .svvw-bar{width:3px;border-radius:2px;background:rgba(255,255,255,0.35);flex-shrink:0;height:6px;transition:background 0.1s;}
.sv-voice-wave .svvw-bar.played{background:#fff;}
.sv-voice-timer{font-size:0.85rem;color:rgba(255,255,255,0.85);min-width:36px;flex-shrink:0;text-align:right;font-variant-numeric:tabular-nums;}
/* FIX (2026-09-12 — "bring the media uploader to the footer, gallery at
   the extreme left, send button at the extreme right bottom, exactly
   like the screenshot"): the Gallery pill used to be flex:1 (stretched
   across almost the whole footer width) and the footer row itself sat
   in normal document flow, so on a short "Text" post it landed wherever
   the content ended rather than pinned to the bottom of the screen.
   Now: (1) the footer is position:sticky + bottom:0 inside the
   scrollable .csm-card so it's always pinned to the bottom edge no
   matter how tall the panel content is, exactly like the screenshot's
   bottom-anchored row; (2) .csm-gallery-btn is no longer flex:1 — it
   sizes to its own content and gets margin-right:auto, which pushes it
   hard to the extreme left while shoving the advanced-quote button and
   Send button (unchanged ids/wiring) to the extreme right, grouped
   together on that side. */
/* FIX (2026-09-12 — "remove the border/thumbnail card where the send
   and gallery button is, I don't want it, plain"): this row's own
   background:rgba(...)+backdrop-filter:blur(...) painted a visibly
   lighter, frosted rectangle behind Gallery/quote-card/Send — reading as
   a separate bordered "card" stacked at the bottom of the composer,
   exactly the demarcation being asked to remove here (same complaint as
   the earlier #status-file-preview boxed-card fix above, now applied to
   this row too). Background/blur removed — background:transparent — so
   this bar is fully plain and blends into the one continuous composer
   surface; position:sticky/bottom:0/the -20px bleed margins are left
   untouched since those only pin the row to the bottom edge and don't
   draw any visible box of their own. */
.csm-footer-bar{display:flex;align-items:center;gap:10px;margin-top:14px;flex-shrink:0;position:sticky;bottom:0;left:0;right:0;margin-left:-20px;margin-right:-20px;padding:14px 20px calc(14px + env(safe-area-inset-bottom,0px));background:transparent;z-index:5;}
.csm-gallery-btn{flex:0 0 auto;margin-right:auto;display:inline-flex;align-items:center;justify-content:center;gap:8px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.16);color:#fff;padding:12px 22px;border-radius:50px;font-weight:700;font-size:var(--text-sm,0.85rem);cursor:pointer;min-width:0;}
/* FIX (2026-10-17 — "change the media gallery icon to a premium sleek professional icon"): the Gallery button used the Font Awesome fa-image glyph, which index.html's emoji fallback rule turns into a 🖼 emoji (and a tofu box when the webfont fails). Now a self-contained inline SVG (rounded frame, sun, mountains; currentColor stroke) like the other premium SVG icons in the app. */
.csm-gallery-btn svg{flex-shrink:0;display:block;}
.csm-gallery-btn span{line-height:1;}
.csm-adv-quote-btn{width:44px;height:44px;flex-shrink:0;border-radius:50%;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.16);color:var(--color-gold,#FFD500);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.95rem;}
/* FIX (2026-09-13 — "instead of using color gradient implement primary
   color scheme" for the composer's Send button, shown in the reference
   screenshot's green circular arrow button): was a two-stop teal gradient
   (var(--g-teal)); replaced with a flat fill from the app's own
   --primary-color token. Note: --primary-color is referenced all over
   index.html/style.css already but is never actually defined anywhere in
   this codebase (the same class of bug already found and fixed for
   --z-toast this session) — every other var(--primary-color) usage has
   been silently falling back to nothing this whole time. Rather than
   define it globally here (a much bigger, unrequested change touching
   every one of those other usages app-wide), this gives it a literal
   fallback scoped to just this button — #1B2B8B is the royal-blue already
   used as this app's de-facto brand color everywhere else (ui-avatars.com
   fallback backgrounds, etc.). Icon color switched from the old dark-navy
   #0A0E27 to white, since it had no contrast against this darker flat
   blue the way it did against the old lighter teal gradient; shadow
   re-tinted to match. */
.csm-send-btn{width:56px;height:56px;flex-shrink:0;border-radius:50%;background:var(--primary-color,#1B2B8B);border:none;color:#fff;font-size:1.2rem;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(27,43,139,0.45);transition:transform 0.15s;}
.csm-send-btn:hover{transform:translateY(-2px);}
.csm-send-btn:active{transform:scale(0.9);}
/* Premium send button: pearl-white disc, navy paper-plane, soft ring (replaces the blue disc + text arrow that vanished on the blue composer). */
.csm-send-btn{background:linear-gradient(160deg,#fff 0%,#E9ECF8 100%);color:#1B2B8B;border:1.5px solid rgba(255,255,255,0.65);box-shadow:0 6px 20px rgba(0,0,0,0.30),0 0 0 5px rgba(255,255,255,0.12),inset 0 1px 0 #fff;}
.csm-send-btn svg{width:24px;height:24px;display:block;margin:2px 3px 0 0;}
.csm-send-btn:disabled{opacity:0.7;cursor:default;transform:none;}

/* Music library sheet — Status composer. Same "synthesize a short tone,
   no audio asset files" approach app-reel.js's own sound-library sheet
   already uses (this codebase has no /public/sounds/ assets checked in),
   kept as an entirely separate preset list/DOM tree from that file's own
   #reel-music-library-* so neither module can clobber the other. */
/* FIX (2026-09-12 — "music library opens at the back of the uploader
   tab"): this modal's own #create-status-modal rule just above sits at
   z-index:999999, which is HIGHER than this scrim's old 9200 — so the
   scrim was rendering underneath the composer that opened it. Bumped
   above 999999 so it always shows in front, same as the quote/meme
   card overlay fix in app-fixes.js. */
#status-music-lib-scrim{position:fixed;inset:0;background:rgba(0,0,0,0);z-index:1000000;display:none;transition:background 0.25s;align-items:flex-end;justify-content:center;}
#status-music-lib-scrim.active{display:flex;background:rgba(0,0,0,0.6);}
#status-music-lib-sheet{background:#12121a;color:#fff;width:100%;max-width:460px;border-radius:20px 20px 0 0;padding:18px 18px calc(20px + env(safe-area-inset-bottom,0px));max-height:70vh;overflow-y:auto;}
#status-music-lib-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
#status-music-lib-head h4{margin:0;font-size:1.02rem;font-weight:800;}
#status-music-lib-close{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;color:#fff;cursor:pointer;}
.ssm-track{display:flex;align-items:center;gap:12px;width:100%;padding:11px 8px;background:none;border:none;border-radius:14px;color:#fff;text-align:left;cursor:pointer;font-family:inherit;}
.ssm-track:active,.ssm-track.selected{background:rgba(0,212,170,0.14);}
.ssm-track-preview{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.85rem;}
.ssm-track-preview.playing{background:#00D4AA;color:#052018;}
.ssm-track-label{flex:1;font-size:0.9rem;font-weight:600;}
.ssm-track .fa-check-circle{color:#00D4AA;display:none;}
.ssm-track.selected .fa-check-circle{display:block;}

/* ── PREMIUM PERSON-TO-PERSON STATUS TRANSITION ──
   FEATURE (report — "transition animation effects from one person status
   to another, not in-house status"): openStatusViewer() rebuilds
   #sv-content's innerHTML from scratch on every call, including when
   advancing past the last segment of one person into the next person's
   status stack — previously an instant hard cut, no animation at all.
   These two pairs (exit-fwd/enter-fwd for advancing to the NEXT person,
   exit-back/enter-back for going to the PREVIOUS one) are applied only
   around that specific person-to-person handoff — see _transitionToUser
   near openStatusViewer below. Same-person segment changes (_showItem)
   are untouched, per the request. */
@keyframes svExitFwd{from{opacity:1;transform:translateX(0) scale(1);}to{opacity:0;transform:translateX(-6%) scale(0.96);}}
@keyframes svEnterFwd{from{opacity:0;transform:translateX(5%) scale(1.03);}to{opacity:1;transform:translateX(0) scale(1);}}
@keyframes svExitBack{from{opacity:1;transform:translateX(0) scale(1);}to{opacity:0;transform:translateX(6%) scale(0.96);}}
@keyframes svEnterBack{from{opacity:0;transform:translateX(-5%) scale(1.03);}to{opacity:1;transform:translateX(0) scale(1);}}
#sv-content.sv-exit-fwd{animation:svExitFwd 190ms cubic-bezier(0.4,0,1,1) forwards;}
#sv-content.sv-enter-fwd{animation:svEnterFwd 260ms cubic-bezier(0.16,1,0.3,1) forwards;}
#sv-content.sv-exit-back{animation:svExitBack 190ms cubic-bezier(0.4,0,1,1) forwards;}
#sv-content.sv-enter-back{animation:svEnterBack 260ms cubic-bezier(0.16,1,0.3,1) forwards;}
/* A subtle avatar-ring pulse on the new person's header avatar, timed to
   land right as the enter animation settles — the "premium" touch that
   sells the handoff as intentional rather than just a generic fade. */
@keyframes svAvatarPulse{0%{box-shadow:0 0 0 0 rgba(0,212,170,0.55);}100%{box-shadow:0 0 0 10px rgba(0,212,170,0);}}
#sv-content.sv-enter-fwd #sv-av,#sv-content.sv-enter-back #sv-av{border-radius:50%;animation:svAvatarPulse 520ms ease-out 60ms;}
`;
        document.head.appendChild(s);
    }


    /* =========================================================================
       §1  STATUS BAR
       ========================================================================= */
    function _buildCardPreviewHTML(latest) {
        var bg = '';
        if (latest.type==='image' && latest.url) {
            bg = '<img class="status-card-media" src="'+_esc(latest.url)+'" alt="">';
        } else if (latest.type==='video' && latest.url) {
            bg = '<video class="status-card-media" src="'+_esc(latest.url)+'" muted playsinline preload="metadata"></video>';
        } else {
            bg = '<div class="status-card-media status-card-text-bg" style="background:'+_esc(latest.bg||'linear-gradient(135deg,#0A0F1E,#1C2845)')+';">'
               + '<span class="status-card-text-preview" style="color:'+_stTextColor(latest.bg)+';">'+_esc((latest.content||'').slice(0,40))+'</span></div>';
        }
        return bg;
    }

    function renderStatusBar() {
        var container = document.getElementById('status-bar-inner');
        if (!container) return;

        Array.from(container.children).forEach(function(c){
            if (c.id !== 'add-my-status-btn') c.remove();
        });

        var statuses = window.userStatuses || [];
        var myId     = _us().id;
        var viewed   = {};
        try { viewed = JSON.parse(localStorage.getItem('emp_viewed_statuses') || '{}'); } catch(e){}

        var myStatus  = statuses.find(function(s){ return myId && s.userId === myId; });
        var myLive    = myStatus ? _liveItems(myStatus) : [];
        var myBtn     = document.getElementById('add-my-status-btn');
        var myRing    = container.querySelector('#add-my-status-btn .status-avatar-ring');
        var hasMine   = !!myLive.length;
        if (myRing) {
            myRing.classList.toggle('add-own',    !hasMine);
            myRing.classList.toggle('has-status', hasMine);
        }
        var myImg = document.getElementById('my-status-avatar-img');
        if (myImg && !_isGuest() && _us().avatar) myImg.src = _us().avatar;

        /* FIX (point #2: "My Status tile is missing the preview square box"):
           the static "My Status" tile in index.html only ever rendered the
           small circular avatar ring — it never gained the tall rectangular
           media-preview card that every OTHER user's status tile already
           has (see _buildCardPreviewHTML above). When the logged-in user
           has an active, non-expired status, inject that same preview card
           — built from their own latest status item — inside #add-my-status-
           btn, directly beside the original ring markup. The original ring/
           +-badge elements are left completely untouched underneath (just
           visually hidden via CSS) so their existing click handlers (the
           dedicated ".status-add-icon" → always-compose target, and the
           rest-of-tile → view-or-compose target) keep working exactly as
           before — this is purely an additive visual layer, no structural
           change, no listener rewiring needed. */
        if (myBtn) {
            var existingCard = myBtn.querySelector('.status-card.my-status-card');
            if (hasMine) {
                var myLatest = myLive[myLive.length - 1];
                var myBg     = _buildCardPreviewHTML(myLatest);
                if (!existingCard) {
                    existingCard = document.createElement('div');
                    existingCard.className = 'status-card my-status-card';
                    myBtn.appendChild(existingCard);
                }
                existingCard.innerHTML =
                    myBg
                    + '<div class="status-card-grad"></div>'
                    + '<div class="status-card-avatar-ring">'
                    + '<img src="' + _esc(_us().avatar||'') + '" alt="Me" '
                    + 'onerror="this.src=\'https://ui-avatars.com/api/?name=Me&background=1B2B8B&color=fff&size=52\'">'
                    + '</div>';
                /* 2026-11-09 premium story tile: the "+" badge sits on the card's bottom edge as a direct child of the
                   tile (the card clips overflow). It keeps the .status-add-icon class so the existing "+ always opens
                   compose" click handler (closest('.status-add-icon') inside #add-my-status-btn) still fires. */
                var _plusEl = Array.prototype.filter.call(myBtn.children, function(c){ return c.classList && c.classList.contains('status-add-icon'); })[0];
                if (!_plusEl) {
                    _plusEl = document.createElement('span');
                    _plusEl.className = 'status-add-icon';
                    _plusEl.textContent = '+';
                    myBtn.appendChild(_plusEl);
                }
                myBtn.classList.add('has-status-card');
            } else if (existingCard) {
                existingCard.remove();
                myBtn.classList.remove('has-status-card');
                Array.prototype.filter.call(myBtn.children, function(c){ return c.classList && c.classList.contains('status-add-icon'); }).forEach(function(c){ c.remove(); });
            }
        }

        statuses.forEach(function(su, idx){
            if (!su || !su.items || !su.items.length) return;
            if (myId && su.userId === myId) return;
            /* FEATURE (2026-09-12 — Content Control: block filter). Same
               single-choke-point approach as app-feed.js's posts listener —
               a blocked contact's status never even reaches the status bar.
               window.isUserBlocked is defined in app-dom.js. */
            if (typeof window.isUserBlocked === 'function' && window.isUserBlocked(su.userId)) return;
            var live = _liveItems(su);
            if (!live.length) return;

            var isViewed = !!(viewed[su.userId] || su.viewed);
            /* FIX (point #5: "bigger square box should show the last media
               preview, like Facebook/WhatsApp, before the small avatar"):
               tiles used to be a small circular avatar ring ONLY — no
               preview of the actual status content at all. Rebuilt as a
               tall rectangular preview card: the most recent item's image/
               video is shown as the card background (or a gradient for
               text-only statuses), with the small avatar ring overlaid in
               the top-left corner and the name overlaid at the bottom,
               matching the reference screenshot layout. */
            var latest = live[live.length-1];
            var bg = _buildCardPreviewHTML(latest);

            var el = document.createElement('div');
            el.className         = 'status-item' + (isViewed ? ' viewed' : '');
            el.dataset.statusIdx = idx;
            el.dataset.statusUid = su.userId || '';
            /* FEATURE (2026-09-13 — "implement the receive live viewers
               messages count", per the reference screenshot showing a
               numeric unread-count badge on each row of a chat/updates
               list): this bar already re-renders live on every Firestore
               'statuses' onSnapshot tick (see app-fixes.js's
               window._statusesListener → window.renderStatusBar()) — so a
               badge computed fresh right here, from real data, on every
               call is ALREADY live with zero extra plumbing; it doesn't
               need its own listener or a simulated increment the way the
               reference mockup's demo did. The count itself is every live
               (non-expired) item this person has posted that the viewer
               hasn't opened yet — `viewed` is a boolean per-userId flag
               (see localStorage read above), so an unviewed user's full
               live.length is "unseen", and it drops to 0/hidden the
               instant they're marked viewed (existing _markViewed-style
               logic elsewhere in this file already sets that flag when a
               tile is opened — unchanged by this feature). */
            var unseenCount = isViewed ? 0 : live.length;
            el.innerHTML =
                '<div class="status-card">'
                + bg
                + '<div class="status-card-grad"></div>'
                + '<div class="status-card-avatar-ring' + (isViewed ? ' viewed' : '') + '">'
                + '<img src="' + _esc(su.avatar||'') + '" alt="' + _esc(su.name||'User') + '" '
                + 'onerror="this.src=\'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=52\'">'
                + '</div>'
                + (unseenCount>0 ? '<span class="status-card-badge">'+(unseenCount>99?'99+':unseenCount)+'</span>' : '')
                + '</div>'
                + '<span class="status-card-name">' + _esc((su.name||'User').split(' ')[0]) + '</span>';

            container.appendChild(el);
        });

        /* FIX (2026-08-10 — bug report: "status strip shows up on every
           page, including Profile, Reels, etc." — screenshot showed the
           status/story strip bleeding in above "My Profile"): this used
           to unconditionally force the bar to `display:block` every time
           this function ran (every Firestore statuses snapshot tick), no
           matter which section was actually on screen. index.html's own
           static markup also hardcodes class="visible" on
           #status-bar-container, so with nothing else gating it the bar
           was effectively always on, on top of whatever section the
           person navigated to. app-patch-v20.js already has a narrow,
           working version of this exact fix scoped ONLY to the Messages
           tab (its own _syncStatusBar/dataset.v20Hidden) — this is the
           general form: the status bar is a Home/Dashboard-feed feature
           (it renders directly above the dashboard's post feed) and
           should stay hidden by default everywhere else, the same way it
           already stays hidden while Messages is open. Delegates to
           _applyStatusBarSectionVisibility() below instead of a bare
           forced 'block' so this respects whatever section is actually
           active right now. */
        _applyStatusBarSectionVisibility();
    }
    window.renderStatusBar = renderStatusBar;


    /* =========================================================================
       §1b  STATUS BAR — HIDDEN BY DEFAULT OUTSIDE THE HOME/DASHBOARD FEED
       ─────────────────────────────────────────────────────────────────────
       The WhatsApp-style status/story strip (#status-bar-container) is a
       Home-feed feature — it's meant to sit directly above the dashboard's
       post feed, not float on top of every other section. index.html's
       static markup hardcodes class="visible" on it, and (until the
       renderStatusBar() fix just above) this file's own render function
       forced it back to display:block on every snapshot tick regardless of
       section — so it bled through on Profile, Reels, Marketplace, and
       everywhere else. app-patch-v20.js already hides it narrowly, ONLY
       while the Messages tab is open (its own dataset.v20Hidden flag) —
       this generalizes the same idea to every section, using its own
       distinct flag (dataset.statusHiddenBySection) so the two mechanisms
       never fight over which one gets to restore the bar afterward: each
       only ever re-shows it if IT was the one that hid it.
       HOME_SECTION_ID matches index.html's <section id="dashboard">
       (the app's actual Home/Feed section). */
    var HOME_SECTION_ID = 'dashboard';

    function _currentSectionId() {
        var active = document.querySelector('.content-section.active');
        return active ? active.id : null;
    }

    function _applyStatusBarSectionVisibility() {
        var sbc = document.getElementById('status-bar-container');
        if (!sbc) return;
        // Don't fight app-patch-v20.js's own Messages-specific hide — if
        // it already hid the bar for that reason, leave it alone; it will
        // restore the bar itself once Messages closes.
        if (sbc.dataset.v20Hidden === '1') return;

        var onHome = _currentSectionId() === HOME_SECTION_ID;
        if (onHome) {
            if (sbc.dataset.statusHiddenBySection === '1') {
                sbc.dataset.statusHiddenBySection = '';
                sbc.style.removeProperty('display');
            }
            sbc.classList.add('visible');
        } else if (sbc.style.display !== 'none') {
            sbc.dataset.statusHiddenBySection = '1';
            sbc.style.setProperty('display', 'none', 'important');
        }
    }
    window._empSyncStatusBarSection = _applyStatusBarSectionVisibility;

    document.addEventListener('empyrean-section-change', function (e) {
        var section = e && e.detail && e.detail.section;
        // Give the section switch a tick to finish (matches the timing
        // every other file reacting to this same event already uses)
        // before re-checking .content-section.active.
        setTimeout(_applyStatusBarSectionVisibility, 30);
    });
    /* FEATURE (2026-09-12 — Content Control: live status-bar removal).
       Same reasoning as app-feed.js's matching listener on this event —
       renderStatusBar()'s own block check (added above) only stops a
       newly-blocked contact's status from appearing on the NEXT render;
       without this it would still sit visible in the bar the same moment
       Block was just tapped, until something else happens to trigger a
       re-render. */
    document.addEventListener('empyrean-content-control-changed', function (e) {
        var d = e && e.detail;
        if (d && d.type === 'block' && d.active) renderStatusBar();
    });
    document.addEventListener('empyrean-init-done', function () {
        setTimeout(_applyStatusBarSectionVisibility, 300);
    });
    // Cover the very first paint, before any section-change event has
    // ever fired (index.html's static markup defaults the bar to
    // visible) — hide it immediately unless Home is already the active
    // section on load.
    if (document.readyState !== 'loading') {
        _applyStatusBarSectionVisibility();
    } else {
        document.addEventListener('DOMContentLoaded', _applyStatusBarSectionVisibility);
    }


    /* =========================================================================
       §2  PEEK PREVIEW — short tap shows Facebook-style bottom card
       ========================================================================= */
    function _ensurePeek() {
        if (document.getElementById('sv-peek-overlay')) return;
        var ov = document.createElement('div');
        ov.id = 'sv-peek-overlay';
        ov.innerHTML =
            '<div id="sv-peek-card">'
            + '<div class="spk-media" id="spk-media"></div>'
            + '<button class="spk-dismiss" id="spk-dismiss"><i class="fas fa-times"></i></button>'
            + '<div class="spk-bottom">'
            + '  <div class="spk-user-row">'
            + '    <img class="spk-avatar" id="spk-avatar" src="" alt="">'
            + '    <div><div class="spk-uname" id="spk-uname"></div>'
            + '         <div class="spk-utime" id="spk-utime"></div></div>'
            + '  </div>'
            + '  <div class="spk-caption" id="spk-caption"></div>'
            + '  <div class="spk-btns">'
            + '    <button class="spk-open-btn" id="spk-open-btn"><i class="fas fa-play"></i> View Status</button>'
            + '    <button class="spk-reply-btn" id="spk-reply-btn"><i class="fas fa-comment"></i> Reply</button>'
            + '  </div>'
            + '</div>'
            + '</div>';
        document.body.appendChild(ov);
    }

    function _openPeek(su, idx) {
        _ensurePeek();
        var card = document.getElementById('sv-peek-card');
        var ov   = document.getElementById('sv-peek-overlay');
        if (!card || !ov) return;
        card.dataset.idx = idx;
        card.dataset.uid = su.userId || '';

        var items = _liveItems(su);
        if (!items.length) return;
        var item = items[0];

        var wrap = document.getElementById('spk-media');
        wrap.innerHTML = '';

        /* segment indicators */
        if (items.length > 1) {
            var dotsEl = document.createElement('div');
            dotsEl.className = 'spk-segs';
            items.forEach(function(_, i){
                var d = document.createElement('div');
                d.className = 'spk-seg' + (i === 0 ? ' active' : '');
                dotsEl.appendChild(d);
            });
            wrap.appendChild(dotsEl);
        } else {
            var pill = document.createElement('div');
            pill.className = 'spk-count-pill';
            pill.innerHTML = '<i class="fas fa-images"></i> ' + items.length + ' update';
            wrap.appendChild(pill);
        }

        /* dismiss */
        var dismissEl = document.createElement('button');
        dismissEl.className = 'spk-dismiss';
        dismissEl.innerHTML = '<i class="fas fa-times"></i>';
        dismissEl.onclick = _closePeek;
        wrap.appendChild(dismissEl);

        /* media */
        if (item.type === 'video' && item.url) {
            var vid = document.createElement('video');
            vid.src = item.url; vid.muted = true; vid.autoplay = true;
            vid.loop = true; vid.playsInline = true;
            wrap.appendChild(vid);
        } else if (item.type === 'text' || (!item.url && item.content)) {
            var td = document.createElement('div');
            td.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:24px;font-size:1.4rem;font-weight:800;color:' + _stTextColor(item.bg) + ';text-align:center;background:' + (item.bg || 'linear-gradient(135deg,#0A0F1E,#1C2845)') + ';';
            td.textContent = item.content || '';
            wrap.appendChild(td);
        } else if (item.url) {
            var img = document.createElement('img');
            img.src = item.url;
            wrap.appendChild(img);
        } else {
            var fb = document.createElement('div');
            fb.style.cssText = 'width:100%;height:100%;background:linear-gradient(135deg,#0A0F1E,#1B2B8B);display:flex;align-items:center;justify-content:center;';
            fb.innerHTML = '<i class="fas fa-circle-notch" style="color:rgba(255,255,255,0.3);font-size:2rem;"></i>';
            wrap.appendChild(fb);
        }
        wrap.insertAdjacentHTML('beforeend', '<div class="spk-grad"></div>');

        /* meta */
        document.getElementById('spk-avatar').src = su.avatar || '';
        document.getElementById('spk-avatar').onerror = function(){ this.src = 'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=40'; };
        document.getElementById('spk-uname').textContent = su.name || 'User';
        document.getElementById('spk-utime').textContent = item.createdAt ? _timeAgo(item.createdAt) : 'Just now';
        var capEl = document.getElementById('spk-caption');
        capEl.textContent   = (item.content && item.type !== 'text') ? item.content : '';
        capEl.style.display = capEl.textContent ? 'block' : 'none';

        var myId = _us().id;
        var repBtn = document.getElementById('spk-reply-btn');
        if (repBtn) repBtn.style.display = (su.userId === myId) ? 'none' : 'flex';

        ov.classList.add('active');
        card.style.bottom = '-110%';
        requestAnimationFrame(function(){ requestAnimationFrame(function(){ card.classList.add('show'); }); });
    }

    function _closePeek() {
        var card = document.getElementById('sv-peek-card');
        var ov   = document.getElementById('sv-peek-overlay');
        if (card) {
            card.classList.remove('show');
            var v = card.querySelector('video');
            if (v) { try { v.pause(); v.src = ''; } catch(e){} }
        }
        if (ov) ov.classList.remove('active');
    }


    /* =========================================================================
       §3  STATUS VIEWER
       ========================================================================= */
    var _advTimer = null;
    var _progRaf  = null;
    var _progStart= 0;
    var _progDurMs= 0;
    var _curFill  = null;
    var _viewerOpen = false;

    function openStatusViewer(userIdx, _enterDirection) {
        var statuses = window.userStatuses || [];
        if (!statuses[userIdx]) return;

        _closePeek();

        window._currentStatusUser = userIdx;
        window._currentStatusIdx  = 0;

        var modal = document.getElementById('status-viewer-modal');
        if (!modal) return;

        /* Replace inner HTML each open — clean slate, no stale state */
        modal.innerHTML = [
            '<div id="sv-content">',
            '  <div id="sv-prog-wrap"></div>',
            '  <div id="sv-top">',
            '    <img id="sv-av" src="" alt="">',
            '    <div class="sv-meta">',
            '      <div id="sv-name"></div>',
            '      <div id="sv-time"></div>',
            '    </div>',
            '    <div id="sv-more-wrap">',
            '      <button id="sv-more-btn" title="More"><svg class="sv-ic" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg></button>',
            '      <div id="sv-menu">',
            '        <button id="sv-mute-btn"><i class="fas fa-volume-up" style="display:none"></i><svg class="sv-ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19V5z"/><g class="sv-ic-on"><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18.4 6.2a8.2 8.2 0 0 1 0 11.6"/></g><g class="sv-ic-off"><path d="m16 9.5 5 5M21 9.5l-5 5"/></g></svg><span class="sv-menu-lbl">Sound</span></button>',
            '        <button id="sv-delete-btn" title="Delete status"><svg class="sv-ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.9 12a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8l.9-12"/><path d="M10 11v6M14 11v6"/></svg><span class="sv-menu-lbl">Delete</span></button>',
            '      </div>',
            '    </div>',
            '  </div>',
            '  <button id="sv-close"><i class="fas fa-times"></i></button>',
            '  <div id="sv-repost-tag"><span><i class="fas fa-retweet"></i><span id="sv-repost-tag-name"></span></span></div>',
            '  <div id="sv-bg-blur"></div>',
            '  <img id="sv-img" alt="status">',
            '  <video id="sv-vid" playsinline></video>',
            /* FEATURE (2026-09-13 — "add voice note as a feature"): playback
               UI for item.type==='voice', same tier as sv-img/sv-vid above.
               #sv-audio is the actual <audio> element (hidden — the visible
               "player" is the card, matching the composer's own recording-
               preview card so a posted voice note looks like what was
               recorded); #sv-voice-wave's bars are generated once per item
               in _showItem() below, sized off decoded playback progress. */
            '  <div id="sv-voice">',
            '    <div class="sv-voice-card">',
            '      <div class="sv-voice-avatar-wrap"><img id="sv-voice-avatar" src="" alt="" onerror="this.src=\'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=52\'"><span class="sv-voice-mic-badge">&#127908;</span></div>',
            '      <div class="sv-voice-wave" id="sv-voice-wave"></div>',
            '      <span class="sv-voice-timer" id="sv-voice-timer">0:00</span>',
            '    </div>',
            '  </div>',
            '  <audio id="sv-audio" playsinline></audio>',
            '  <div id="sv-txt">',
            '    <div id="sv-txt-card">',
            '      <button class="sv-txt-nav" id="sv-txt-nav-up" title="Scroll up"><i class="fas fa-chevron-up"></i></button>',
            '      <div id="sv-txt-quote">&#8220;</div>',
            '      <div id="sv-txt-scroll"><div id="sv-txt-inner"></div></div>',
            '      <button class="sv-txt-chevron" id="sv-txt-chevron" title="Show more"><i class="fas fa-chevron-down"></i></button>',
            '      <button class="sv-txt-nav" id="sv-txt-nav-down" title="Scroll down"><i class="fas fa-chevron-down"></i></button>',
            '    </div>',
            '  </div>',
            '  <div id="sv-caption">',
            '    <div id="sv-caption-text"></div>',
            '    <button class="sv-caption-chevron" id="sv-caption-chevron"><i class="fas fa-chevron-down"></i></button>',
            '  </div>',
            '  <div id="sv-viewers-panel">',
            '    <div class="svp-header">',
            '      <span class="svp-title"><i class="fas fa-eye"></i> Viewed by <span id="svp-count"></span></span>',
            '      <button id="svp-close"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>',
            '    </div>',
            '    <div class="svp-list" id="svp-list"></div>',
            '  </div>',
            /* ── BOTTOM ACTION BAR (v2) — rebuilt to match the WhatsApp
               reference screenshots precisely:
               Row 1: viewer-count + quick emoji reactions + repost (WhatsApp
                      loop-arrow glyph, not FontAwesome's retweet icon) + like
                      + profile + chat icons.
               Row 2: inline comment thread (sent replies appear here).
               Row 3: full WhatsApp-style composer — emoji toggle, text
                      input, attach, camera, mic — exactly mirroring the
                      reference's bottom composer bar layout/icon order. ── */
            '  <div id="sv-bottom-bar">',
            '    <div id="sv-quick-row">',
            '      <button id="sv-eye-badge" title="Viewers">',
            '        <i class="fas fa-eye"></i><span id="sv-eye-count">0</span>',
            '      </button>',
            /* FIX (2026-10-30 — "emojis should be hidden inside the emojis catalog"): the five always-visible quick-reaction buttons
               (😍 😂 😮 😢 🙏) were removed from this row; all five live in the composer's emoji catalog (EMOJI_PANEL_SET) instead.
               Handlers/gating for .sv-emoji-quick are left in place and simply find nothing. */
            '      <button id="sv-rt-btn" title="Repost">',
            '        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
            '        <span id="sv-rt-count">0</span>',
            '      </button>',
            '      <button id="sv-heart-btn" title="Like"><i class="far fa-heart"></i><span class="sv-like-count" id="sv-like-count"></span></button>',
            '      <button class="sv-pill-btn" id="sv-prof-btn" title="View profile">',
            '        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
            '      </button>',
            '      <button class="sv-pill-btn" id="sv-chat-btn" title="Message" aria-label="Message">',
            '        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4 3.5V16h-.5A1.5 1.5 0 0 1 4 14.5z"/><path d="M8 8.5h8M8 11.5h5"/></svg>',
            '      </button>',
            '      <button class="sv-pill-btn" id="sv-share-btn" title="Share this status">',
            '        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
            '      </button>',
            '    </div>',
            '    <div id="sv-reply-bar">',
            '      <button id="sv-emoji-toggle" title="Emoji" aria-label="Emoji"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M8.2 14.3c.9 1.2 2.2 1.9 3.8 1.9s2.9-.7 3.8-1.9"/><circle cx="9" cy="9.8" r="0.95" fill="currentColor" stroke="none"/><circle cx="15" cy="9.8" r="0.95" fill="currentColor" stroke="none"/></svg></button>',
            '      <input id="sv-reply-inp" placeholder="Reply privately…" type="text">',
            '      <button id="sv-attach-btn" title="Attach" aria-label="Attach"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>',
            '      <button id="sv-camera-btn" title="Camera" aria-label="Camera"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7.5 7H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.6"/></svg></button>',
            '      <button id="sv-reply-send" title="Send" aria-label="Send"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2.5 10.5 13.5"/><path d="M21.5 2.5 14.5 21.5l-4-8-8-4z"/></svg></button>',
            '    </div>',
            '  </div>',
            '  <button class="sv-nav" id="sv-prev" aria-label="Previous"></button>',
            '  <button class="sv-nav" id="sv-next" aria-label="Next"></button>',
            '  <div id="sv-rt-modal">',
            '    <div id="sv-rt-modal-inner">',
            '      <div id="sv-rt-modal-header"><span>Share to your status</span><button id="sv-rt-modal-close" title="Cancel"><i class="fas fa-times"></i></button></div>',
            '      <div id="sv-rt-preview">',
            '        <img id="sv-rt-preview-av" src="" alt="">',
            '        <div>',
            '          <div id="sv-rt-preview-name"></div>',
            '          <div id="sv-rt-preview-text"></div>',
            '        </div>',
            '      </div>',
            '      <textarea id="sv-rt-comment" maxlength="280" placeholder="Add your own narrative (optional)…"></textarea>',
            '      <button id="sv-rt-confirm-btn"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg><span id="sv-rt-confirm-label">Repost to friends</span></button>',
            '    </div>',
            '  </div>',
            '  <div id="sv-delete-modal">',
            '    <div id="sv-delete-modal-inner">',
            '      <div id="sv-delete-modal-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></div>',
            '      <div id="sv-delete-modal-title">Delete this status?</div>',
            '      <div id="sv-delete-modal-sub">Your friends won\'t be able to see it anymore. This can\'t be undone.</div>',
            '      <div id="sv-delete-modal-btns">',
            '        <button id="sv-delete-cancel-btn">Cancel</button>',
            '        <button id="sv-delete-confirm-btn"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg><span>Delete</span></button>',
            '      </div>',
            '    </div>',
            '  </div>',
            '</div>'
        ].join('');

        /* Wire all events on the FRESH inner elements — no accumulation */
        _wireViewerOnce(modal);

        modal.className = 'sv-open';
        _viewerOpen = true;
        document.body.classList.add('modal-open');

        /* Person-to-person transition entrance — see _advanceToUser below,
           which is what passes _enterDirection. A plain openStatusViewer()
           call from anywhere else (first open, deep link, etc.) passes
           nothing here and renders instantly, unchanged. */
        if (_enterDirection) {
            var freshContent = document.getElementById('sv-content');
            if (freshContent) {
                var _enterCls = _enterDirection === 'back' ? 'sv-enter-back' : 'sv-enter-fwd';
                freshContent.classList.add(_enterCls);
                freshContent.addEventListener('animationend', function _cleanupEnter(e) {
                    if (e.target !== freshContent) return;
                    freshContent.classList.remove(_enterCls);
                    freshContent.removeEventListener('animationend', _cleanupEnter);
                });
            }
        }

        _showItem(userIdx, 0);
        _recordView(userIdx, 0);
    }
    window.openStatusViewer  = openStatusViewer;

    /* Person-to-person status transition — plays a quick directional
       exit on the CURRENT person's content, then opens the next/previous
       person with the matching entrance animation (see the "sv-exit-"/
       "sv-enter-" keyframes injected above). Same-person segment changes
       (_showItem) are untouched — this only wraps the handoff between two
       different people's status stacks, per this feature's own scope. */
    function _advanceToUser(newUserIdx, direction) {
        var oldContent = document.getElementById('sv-content');
        if (!_viewerOpen || !oldContent) { openStatusViewer(newUserIdx); return; }
        _stopProg();
        oldContent.classList.add(direction === 'back' ? 'sv-exit-back' : 'sv-exit-fwd');
        setTimeout(function () {
            openStatusViewer(newUserIdx, direction);
        }, 190); /* matches the sv-exit-* animation-duration above */
    }
    window._openStatusViewer = openStatusViewer;

    /* ─────────────────────────────────────────────────────────────────────────
       OPEN-BY-ID  (for a shared `?post=status-<userId>` link)
       ─────────────────────────────────────────────────────────────────────────
       ADDED (2026-08-07 — "fix the status link"). window.userStatuses is
       populated by app-feed.js's `_startRealtimeListeners()` §9 statuses
       listener, which runs globally at app boot (not gated to any one
       section) but is capped at the 60 most recently-created status docs
       and — like every 24h-expiring status elsewhere in this file — drops
       a user's entry entirely once every one of their items has expired.
       Mirrors the same "check memory first, then poll briefly for the
       listener to catch up, then fall back to a direct Firestore read"
       shape already used by app-news.js's openNewsArticleById() and
       app-marketplace-sellers.js's _openListingDetailPage() for the same
       class of problem. A status that has fully expired has nothing left
       to open — that's reported to the person directly rather than
       treated as a loading failure. */
    function openStatusById(postId) {
        if (!postId) { _notify("Couldn't find that status.", 'info'); return; }

        function _tryFind() {
            var list = window.userStatuses || [];
            var idx = list.findIndex(function (su) {
                return su && (su.docId === postId || ('status-' + su.userId) === postId);
            });
            if (idx === -1) return false;
            openStatusViewer(idx);
            return true;
        }

        if (_tryFind()) return;

        var attempts = 0, maxAttempts = 10; // ~5s at 500ms — only waiting on the listener, not a DOM render
        var poll = setInterval(function () {
            attempts++;
            if (_tryFind()) { clearInterval(poll); return; }
            if (attempts >= maxAttempts) {
                clearInterval(poll);
                _fetchAndOpenStatusDirect(postId);
            }
        }, 500);
    }

    function _fetchAndOpenStatusDirect(postId) {
        if (!window._firebaseLoaded || !window.fbDb) {
            _notify("This status is no longer available.", 'info');
            return;
        }
        window.fbDb.collection('statuses').doc(postId).get().then(function (doc) {
            if (!doc.exists) { _notify("This status is no longer available — it may have expired.", 'info'); return; }
            var s = doc.data() || {};
            s.docId = s.docId || doc.id;
            // Same 24h expiry filter app-feed.js's own statuses listener
            // applies (STATUS_EXPIRY_MS_FEED) — a directly-fetched doc
            // skips that listener entirely, so it has to be re-applied
            // here or an expired item could get rendered.
            var STATUS_EXPIRY_MS = 24 * 60 * 60 * 1000;
            if (s.items) {
                s.items = s.items.filter(function (item) {
                    return !item.createdAt || (Date.now() - new Date(item.createdAt).getTime()) < STATUS_EXPIRY_MS;
                });
            }
            if (!s.items || !s.items.length) { _notify("This status is no longer available — it may have expired.", 'info'); return; }

            if (!window.userStatuses) window.userStatuses = [];
            var idx = window.userStatuses.findIndex(function (x) { return x.userId === s.userId; });
            if (idx === -1) { window.userStatuses.push(s); idx = window.userStatuses.length - 1; }
            else { window.userStatuses[idx] = s; }
            openStatusViewer(idx);
        }).catch(function (err) {
            console.warn('[Status] direct fetch for deep link failed:', err && err.message);
            _notify("Couldn't load that status — please try again.", 'error');
        });
    }
    window.openStatusById = openStatusById;


    /* Wire events directly on fresh elements — called once after innerHTML reset */
    function _wireViewerOnce(modal) {
        /* backdrop close — click on the modal bg (outside #sv-content) */
        modal.addEventListener('click', function(e){
            if (e.target === modal) _closeViewer();
        });

        _qclick('#sv-close', _closeViewer);

        /* FIX (2026-10-21 - full-screen status): portrait / phone-screenshot-shaped
           photos and videos fill the screen edge to edge (object-fit:cover).
           Media whose shape is far from the screen's (e.g. wide landscape) keeps
           object-fit:contain on the blurred backdrop so nothing important is
           cropped away. */
        (function(){
            function fit(el, w, h){
                var box = document.getElementById('sv-content');
                if (!el || !box || !w || !h || !box.clientHeight) return;
                var vr = box.clientWidth / box.clientHeight, r = w / h;
                el.style.objectFit = (r >= vr * 0.7 && r <= vr * 1.5) ? 'cover' : 'contain';
            }
            var im = document.getElementById('sv-img'), vd = document.getElementById('sv-vid');
            if (im) im.addEventListener('load', function(){ fit(im, im.naturalWidth, im.naturalHeight); });
            if (vd) vd.addEventListener('loadedmetadata', function(){ fit(vd, vd.videoWidth, vd.videoHeight); });
        })();

        _qclick('#sv-prev', function(){
            /* a long press (hold-to-pause) is not a tap - don't navigate */
            if (_svPressAt && Date.now() - _svPressAt > 350) return;
            _stopProg();
            var c = window._currentStatusIdx || 0;
            if (c > 0) _showItem(window._currentStatusUser, c - 1);
            else if ((window._currentStatusUser||0) > 0) _advanceToUser((window._currentStatusUser||0) - 1, 'back');
        });

        _qclick('#sv-next', function(){
            if (_svPressAt && Date.now() - _svPressAt > 350) return;
            _stopProg();
            var su = _curSU(), its = su ? _liveItems(su) : [];
            var nxt = (window._currentStatusIdx||0) + 1;
            if (nxt < its.length) _showItem(window._currentStatusUser, nxt);
            else { var nu = (window._currentStatusUser||0)+1; if(nu<(window.userStatuses||[]).length) _advanceToUser(nu, 'fwd'); else _closeViewer(); }
        });

        _qclick('#sv-heart-btn', function(e){
            e.stopPropagation();
            if (_isGuest()){ _notify('Log in to like', 'info'); return; }
            _doLike();
        });

        _qclick('#sv-rt-btn', function(e){
            e.stopPropagation();
            if (_isGuest()){ _notify('Log in to retweet', 'info'); return; }
            /* FIX ("tweeting posts does not work"): the button used to
               always call _doRetweet() immediately, which only ever
               flipped a local counter — it never actually shared
               anything. Now: if this status hasn't been reposted by me
               yet, open the editable share sheet first (§7) so the
               content can be reviewed/annotated before it's actually
               posted to my own status for friends to see. If I've
               already reposted it, there's nothing left to edit — tapping
               again just undoes the repost, same as before. */
            var su0=_curSU(), items0=su0?_liveItems(su0):[], item0=items0[window._currentStatusIdx||0];
            var myId0=_us().id;
            var already0=!!(item0 && item0.retweetedBy && myId0 && item0.retweetedBy.includes(myId0));
            if (already0) _doRetweet();
            else _openRetweetModal();
        });

        /* ── 3-dot menu (volume + delete) ── */
        function _svMenuClose(){
            var m=document.getElementById('sv-menu');
            if(m && m.classList.contains('open')){ m.classList.remove('open'); _resumeProg(); }
        }
        _qclick('#sv-more-btn', function(e){
            e.stopPropagation();
            var m=document.getElementById('sv-menu'); if(!m) return;
            if(m.classList.contains('open')) _svMenuClose();
            else { _stopProg(); m.classList.add('open'); }
        });
        var _svContentEl=document.getElementById('sv-content');
        if(_svContentEl){
            var _svOutside=function(e){
                var m=document.getElementById('sv-menu');
                if(m && m.classList.contains('open') && !(e.target.closest && e.target.closest('#sv-menu,#sv-more-btn'))) _svMenuClose();
            };
            _svContentEl.addEventListener('touchstart', _svOutside, {capture:true, passive:true});
            _svContentEl.addEventListener('click', _svOutside, true);
        }

        /* ── delete (own status only) ── */
        _qclick('#sv-delete-btn', function(e){
            e.stopPropagation();
            _svMenuClose();
            var su=_curSU(); if(!su) return;
            var myId=_us().id;
            var isOwn=!!(myId && su.userId===myId);
            if(!isOwn) return; // button is hidden for non-owners anyway; belt & suspenders
            _openDeleteModal();
        });
        _qclick('#sv-delete-cancel-btn', function(e){ e.stopPropagation(); _closeDeleteModal(true); });
        var _delModalEl = document.getElementById('sv-delete-modal');
        if (_delModalEl) _delModalEl.addEventListener('click', function(e){
            if (e.target === _delModalEl) _closeDeleteModal(true);
        });
        _qclick('#sv-delete-confirm-btn', function(e){ e.stopPropagation(); _deleteCurrentItem(); });

        /* ── retweet / share sheet controls ── */
        _qclick('#sv-rt-modal-close', function(e){ e.stopPropagation(); _closeRetweetModal(true); });
        var _rtModalEl = document.getElementById('sv-rt-modal');
        if (_rtModalEl) _rtModalEl.addEventListener('click', function(e){
            if (e.target === _rtModalEl) _closeRetweetModal(true);
        });
        _qclick('#sv-rt-confirm-btn', function(e){
            e.stopPropagation();
            /* FIX (2026-10-31): saving the repost takes a moment and the sheet stayed up meanwhile, so a second tap on "Repost to friends"
               re-ran _doRetweet, which TOGGLES — undoing the repost it had just made. The button now locks and shows "Reposting…" until done. */
            var cb=document.getElementById('sv-rt-confirm-btn');
            if (cb && cb.dataset.busy==='1') return;
            if (cb){ cb.dataset.busy='1'; cb.style.opacity='0.7'; cb.style.pointerEvents='none'; var lb=document.getElementById('sv-rt-confirm-label'); if(lb) lb.textContent='Reposting…'; }
            var ta=document.getElementById('sv-rt-comment');
            Promise.resolve(_doRetweet(ta ? ta.value : '')).then(function(){}, function(){}).then(function(){
                var cb2=document.getElementById('sv-rt-confirm-btn');
                if (cb2){ cb2.dataset.busy=''; cb2.style.opacity=''; cb2.style.pointerEvents=''; var lb2=document.getElementById('sv-rt-confirm-label'); if(lb2) lb2.textContent='Repost to friends'; }
            });
        });

        /* ── long-post expand/collapse chevron ── */
        _qclick('#sv-caption-chevron', function(e){
            e.stopPropagation();
            _toggleCaptionExpand();
        });
        _qclick('#sv-caption-text', function(e){
            if(e.target.closest&&e.target.closest('.sv-readmore,.sv-showless')){
                e.stopPropagation();
                _toggleCaptionExpand();
            }
        });
        _qclick('#sv-caption', function(e){
            var box=document.getElementById('sv-caption');
            if(!box||!box.classList.contains('sv-caption-expanded')) return;
            if(e.target.closest&&e.target.closest('.sv-caption-chevron')) return;
            e.stopPropagation();
            if(e.target===box) _toggleCaptionExpand();
        });

        /* ── text-status card: paged up/down navigation for long articles ── */
        _qclick('#sv-txt-chevron', function(e){ e.stopPropagation(); _toggleTxtExpand(); });
        _qclick('#sv-txt-nav-up', function(e){ e.stopPropagation(); _scrollTxt(-1); });
        _qclick('#sv-txt-nav-down', function(e){ e.stopPropagation(); _scrollTxt(1); });
        var _txtScrollEl = document.getElementById('sv-txt-scroll');
        if (_txtScrollEl) _txtScrollEl.addEventListener('scroll', _updateTxtNav);

        _qclick('#sv-mute-btn', function(e){
            e.stopPropagation();
            _svMenuClose();
            var v = document.getElementById('sv-vid'); if (!v) return;
            v.muted = !v.muted;
            var ic = document.querySelector('#sv-mute-btn i');
            if (ic) ic.className = v.muted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
            var _mb = document.getElementById('sv-mute-btn'); if (_mb) _mb.classList.toggle('is-muted', !!v.muted);
        });

        _qclick('#sv-eye-badge', function(e){
            e.stopPropagation();
            var panel = document.getElementById('sv-viewers-panel');
            if (!panel) return;
            if (panel.classList.contains('open')) { panel.classList.remove('open'); _resumeProg(); }
            else { _stopProg(); _populateViewers(); panel.classList.add('open'); }
        });

        _qclick('#svp-close', function(e){
            e.stopPropagation();
            var p = document.getElementById('sv-viewers-panel');
            if (p) { p.classList.remove('open'); _resumeProg(); }
        });

        _qclick('#sv-prof-btn', function(e){
            e.stopPropagation();
            var uid = modal.dataset.uid;
            if (uid){ _closeViewer(); _goProfile(uid); }
        });

        /* FIX (bug: "chat icon navigates away"): #sv-chat-btn and the reply
           send button used to call _openChat(), which navigates to the
           Messages section and closes the status viewer entirely. WhatsApp
           keeps you inside the status when you reply — replies are sent
           straight to the recipient's real inbox as private DMs (see
           _postComment), and there is no public comment thread shown on
           the status itself (see point #3 in the latest fix round).
           FIX (bug: "clicking the Message button doesn't visibly do
           anything"): it now focuses AND visibly highlights the reply
           input with a brief glow, so tapping it has an obvious, confirmed
           effect instead of a silent focus() call that's easy to miss. */
        _qclick('#sv-chat-btn', function(e){
            e.stopPropagation();
            if (_isGuest()){ _notify('Log in to message', 'info'); return; }
            var uid = modal.dataset.uid;
            if (!uid || uid === (_us().id||'')) return;
            var inp = document.getElementById('sv-reply-inp');
            var bar = document.getElementById('sv-reply-bar');
            /* 2026-10-31: second tap on the Message icon collapses the composer again (keeps any text typed). */
            if (bar && bar.classList.contains('sv-composer-open')) {
                bar.classList.remove('sv-composer-open', 'sv-reply-bar-active');
                bar.style.boxShadow = '';
                var _ep = document.getElementById('sv-emoji-panel'); if (_ep) _ep.remove();
                if (inp) inp.blur();
                _resumeProg();
                return;
            }
            _stopProg();
            if (bar) {
                bar.classList.add('sv-composer-open');
                bar.classList.add('sv-reply-bar-active');
                bar.style.boxShadow = '0 0 0 2px #00D4AA';
                /* scrollIntoView removed (2026-10-24): it could scroll the page/viewer and shift the status; the bar is lifted via --sv-kb instead. */
            }
            if (inp) {
                setTimeout(function(){ inp.focus(); }, 80);
            }
        });

        /* ADDED (2026-08-07 — "fix the status link"): shares a permalink to
           THIS status the same way every other content type in this app
           already does — '?post=' + <id>, resolved by server.js's OGP
           crawler route and app-startup.js's boot-time deep-link handler.
           The id used is the status DOC's own id, e.g. 'status-<userId>' —
           this matches _collectionForId('statuses') in server.js AND every
           existing write call site in this file (_mkItem's caller always
           does `.doc('status-' + <userId>)`), so no new id scheme is being
           introduced; this just finally exposes a way to GENERATE that
           link, which didn't exist anywhere in the app before now. Shares
           the whole status (opens to this user's most recent item, same
           as WhatsApp/Instagram profile-story links), not one specific
           item within it — items expire in 24h and don't have a stable
           identity worth linking to individually. */
        _qclick('#sv-share-btn', function(e){
            e.stopPropagation();
            var su = _curSU();
            if (!su) return;
            var postId   = su.docId || ('status-' + su.userId);
            var shareUrl = window.location.origin + '/?post=' + encodeURIComponent(postId);
            _stopProg();
            if (typeof navigator.share === 'function') {
                navigator.share({ title: (su.name || 'Status') + ' on Empyrean', url: shareUrl })
                    .then(_resumeProg)
                    .catch(function (err) {
                        if (err && err.name !== 'AbortError') {
                            try { navigator.clipboard.writeText(shareUrl); _notify('Link copied!', 'success'); } catch (e2) {}
                        }
                        _resumeProg();
                    });
            } else {
                try {
                    navigator.clipboard.writeText(shareUrl);
                    _notify('Link copied!', 'success');
                } catch (e3) {}
                _resumeProg();
            }
        });

        _qclick('#sv-reply-send', function(e){
            e.stopPropagation();
            if (_isGuest()){ _notify('Log in to reply', 'info'); return; }
            var inp = document.getElementById('sv-reply-inp');
            var msg = inp ? inp.value.trim() : '';
            if (!msg) return;
            _postComment(msg);
            if (inp) { inp.value = ''; inp.focus(); }
            var bar = document.getElementById('sv-reply-bar');
            if (bar) { bar.style.boxShadow = ''; bar.classList.remove('sv-reply-bar-active'); }
        });

        var replyInpEl = document.getElementById('sv-reply-inp');
        if (replyInpEl) {
            replyInpEl.addEventListener('focus', function(){
                _stopProg();
                var barEl = document.getElementById('sv-reply-bar');
                if (barEl) barEl.classList.add('sv-reply-bar-active');
                _forceKeyboardResync(modal);
            });
            replyInpEl.addEventListener('blur', function(){
                var barEl = document.getElementById('sv-reply-bar');
                if (barEl) { barEl.style.boxShadow = ''; barEl.classList.remove('sv-reply-bar-active'); }
                setTimeout(function(){ if (typeof modal._svVVResync === 'function') modal._svVVResync(); }, 300);
                setTimeout(function(){
                    if (window.visualViewport) return; // visualViewport branch self-corrects on its own resize event
                    var svContentEl = document.getElementById('sv-content');
                    if (svContentEl && document.body.contains(svContentEl)) svContentEl.style.height = '';
                }, 400);
            });
            replyInpEl.addEventListener('keydown', function(e){
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var msg = replyInpEl.value.trim();
                    if (!msg) return;
                    if (_isGuest()){ _notify('Log in to reply', 'info'); return; }
                    _postComment(msg);
                    replyInpEl.value = '';
                }
            });
        }

        /* quick emoji-reaction row */
        document.querySelectorAll('.sv-emoji-quick').forEach(function(btn){
            btn.addEventListener('click', function(e){
                e.stopPropagation();
                if (_isGuest()){ _notify('Log in to react', 'info'); return; }
                _postComment(btn.dataset.quickEmoji, /* isEmojiOnly */ true);
                _spawnBubbles(btn.dataset.quickEmoji);
            });
        });

        /* ── composer icons (emoji toggle / attach / camera) ──
           Mirrors the WhatsApp reference: tapping the emoji-face icon opens
           a small inline emoji panel (built from the same quick-reaction
           set) that INSERTS into the reply text instead of posting
           immediately — exactly like a system emoji keyboard would. Attach
           and camera are wired to sensible, non-breaking defaults: they
           reuse a real upload/camera entry point if the host app exposes
           one, otherwise they let the person know the option isn't wired
           yet rather than silently doing nothing. */
        _qclick('#sv-emoji-toggle', function(e){
            e.stopPropagation();
            _toggleInlineEmojiPanel();
        });

        _qclick('#sv-attach-btn', function(e){
            e.stopPropagation();
            if (_isGuest()){ _notify('Log in to send media', 'info'); return; }
            if (typeof window.openMediaPicker === 'function') { window.openMediaPicker(); return; }
            if (typeof window.openAttachMenu === 'function') { window.openAttachMenu(); return; }
            _notify('Attach option coming soon', 'info');
        });

        _qclick('#sv-camera-btn', function(e){
            e.stopPropagation();
            if (_isGuest()){ _notify('Log in to use camera', 'info'); return; }
            if (typeof window.openCameraCapture === 'function') { window.openCameraCapture(); return; }
            _notify('Camera option coming soon', 'info');
        });

        /* avatar + name → profile */
        _qclick('#sv-av', function(e){ e.stopPropagation(); var uid=modal.dataset.uid; if(uid){_closeViewer();_goProfile(uid);} });
        _qclick('#sv-name', function(e){ e.stopPropagation(); var uid=modal.dataset.uid; if(uid){_closeViewer();_goProfile(uid);} });

        /* swipe gestures */
        var tx=0, ty=0;
        var content = document.getElementById('sv-content');
        if (content) {
            /* FIX: excluded zone widened from just #sv-reply-bar to the
               whole #sv-bottom-bar, since the quick-emoji row, viewer
               eye-badge, retweet, and like buttons now also live in that
               container (previously they were floating elsewhere). Without
               this, a touch on those buttons that drifted even slightly
               could get misread as a status-navigation swipe. */
            /* FIX (hold-to-pause spec): pressing and holding anywhere on the
               status (outside the interactive chrome) pauses playback —
               video AND the progress bar — until released, mirroring
               Instagram/WhatsApp story behavior. Folded into the existing
               touchstart/touchend pair (rather than a second listener) so
               the hold state and the swipe-detection state can't race each
               other on the same gesture. A parallel mousedown/mouseup pair
               below gives desktop/mouse users the same behavior.

               FIX (2026-08-03 — text-status article couldn't be paused):
               '#sv-txt' (the standalone text-status card — a status made
               of just words, no photo/video) used to be in this exclude
               list, on top of already getting the same fixed 5s
               auto-advance as an image. That meant a long text post had
               no way to pause AT ALL — not hold, not an expand chevron
               (there's nothing to "expand" on a text card; unlike a
               media caption it's never collapsed to begin with, it's
               already the whole screen). Removed from the exclude list so
               holding a text status now pauses it exactly the same way
               holding a photo/video already does — the touch/mouse
               listeners below are `{passive:true}` and never call
               preventDefault(), so #sv-txt-scroll's native scroll inside
               the card is completely unaffected by this. */
            var _EXCLUDE_SEL = '#sv-viewers-panel,#sv-bottom-bar,#sv-rt-modal,#sv-delete-modal,#sv-delete-btn,#sv-more-btn,#sv-menu,.sv-caption-chevron,.sv-readmore,.sv-showless,#sv-txt-chevron,#sv-txt-card.sv-txt-expanded,#sv-caption.sv-caption-expanded,#sv-close';

            content.addEventListener('touchstart', function(e){
                if (e.target.closest(_EXCLUDE_SEL)) return;
                tx=e.touches[0].clientX; ty=e.touches[0].clientY;
                _holdStart();
            },{ passive:true });
            content.addEventListener('touchend', function(e){
                if (e.target.closest(_EXCLUDE_SEL)) { _holdEnd(false); return; }
                var dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
                /* swipe up → viewers panel */
                if (dy < -60 && Math.abs(dy)>Math.abs(dx)){
                    _holdEnd(false);
                    var badge=document.getElementById('sv-eye-badge');
                    if (badge && badge.classList.contains('show')){
                        var panel=document.getElementById('sv-viewers-panel');
                        if(panel && !panel.classList.contains('open')){ _stopProg(); _populateViewers(); panel.classList.add('open'); }
                    }
                    return;
                }
                if (Math.abs(dx)<40 || Math.abs(dx)<Math.abs(dy)) { _holdEnd(true); return; }
                /* a real swipe navigates and starts its own fresh progress
                   run inside _showItem/openStatusViewer/_closeViewer — resuming
                   the OLD run here would fight that, so skip resume (false). */
                _holdEnd(false);
                _stopProg();
                if (dx<0){
                    var su2=_curSU(),its2=su2?_liveItems(su2):[],nxt2=(window._currentStatusIdx||0)+1;
                    if(nxt2<its2.length) _showItem(window._currentStatusUser,nxt2);
                    else{var nu2=(window._currentStatusUser||0)+1;if(nu2<(window.userStatuses||[]).length)_advanceToUser(nu2,'fwd');else _closeViewer();}
                } else {
                    var c2=window._currentStatusIdx||0;
                    if(c2>0) _showItem(window._currentStatusUser,c2-1);
                    else if((window._currentStatusUser||0)>0) _advanceToUser((window._currentStatusUser||0)-1,'back');
                }
            },{ passive:true });
            content.addEventListener('touchcancel', function(){ _holdEnd(true); },{ passive:true });

            content.addEventListener('mousedown', function(e){
                if (e.target.closest(_EXCLUDE_SEL)) return;
                _holdStart();
            });
            document.addEventListener('mouseup', function(){ _holdEnd(true); });
        }

        /* reply focus: pause / resume */
        var inp = document.getElementById('sv-reply-inp');
        if (inp) {
            inp.addEventListener('focus', function(){ _stopProg(); });
            inp.addEventListener('blur', function(){
                var su=_curSU(); if(!su) return;
                var its=_liveItems(su);
                var vid=document.getElementById('sv-vid'), remain=IMG_DUR_MS;
                if(vid&&!vid.paused&&isFinite(vid.duration)&&isFinite(vid.currentTime)){
                    var ci=its[window._currentStatusIdx||0];
                    var se=(ci&&ci.endOffset!=null)?ci.endOffset:vid.duration;
                    remain=Math.max(500,(se-vid.currentTime)*1000);
                }
                _startProg(its,window._currentStatusIdx||0,window._currentStatusUser||0,remain);
            });
        }

        /* FIX (bug: "tapping Message shows no text input column"): the
           composer row lives inside #sv-bottom-bar, which is
           position:absolute;bottom:0 against #sv-content's 100dvh box.
           When the on-screen keyboard opens, Android Chrome/WebView mostly
           does NOT shrink a 100dvh element to the keyboard-adjusted visible
           area in real time — the box keeps its original full-screen
           height, so the absolutely-positioned bottom bar (and the reply
           input inside it) ends up positioned UNDERNEATH the keyboard,
           completely out of view. That's why the input "disappears" the
           moment the keyboard opens, even though it's technically still
           in the DOM and still focused.
           FIX: track window.visualViewport (the API that DOES report the
           real keyboard-adjusted visible height) and actively resize
           #sv-content to match it while the viewer is open. This pulls
           #sv-bottom-bar back into view above the keyboard. Falls back to
           no-op on browsers without visualViewport support (rare; iOS
           Safari and modern Chrome both have it), in which case behavior
           is unchanged from before — never worse than the original. */
        if (window.visualViewport) {
            var svContentEl = document.getElementById('sv-content');
            var _onVVResize = function(){
                if (!svContentEl || !document.body.contains(svContentEl)) return;
                var vv = window.visualViewport;
                /* Only override height while the keyboard is actually open
                   (visible viewport meaningfully shorter than layout
                   viewport) — otherwise leave the normal 100dvh/CSS rules
                   in control so desktop/no-keyboard layout is untouched. */
                var kb = Math.round(window.innerHeight - vv.height);
                var shrunk = kb > 80;
                /* Card keeps its full height (no more squeezing). Only the reply bar is lifted by the keyboard height; if the browser
                   panned the layout viewport (iOS), the whole viewer is nudged by the same offset so the top bar stays on screen. */
                svContentEl.style.height = '';
                svContentEl.style.setProperty('--sv-kb', shrunk ? (kb + 'px') : '0px');
                modal.style.transform = (shrunk && vv.offsetTop > 0) ? ('translateY(' + Math.round(vv.offsetTop) + 'px)') : '';
            };
            window.visualViewport.addEventListener('resize', _onVVResize);
            window.visualViewport.addEventListener('scroll', _onVVResize);
            /* store cleanup on the modal so _closeViewer can remove it and
               we never leak a listener across multiple opens */
            modal._ocVVCleanup = function(){
                window.visualViewport.removeEventListener('resize', _onVVResize);
                window.visualViewport.removeEventListener('scroll', _onVVResize);
                modal.style.transform = '';
                if (svContentEl) svContentEl.style.setProperty('--sv-kb', '0px');
            };
            /* Exposed so the Message-button handler can force an immediate
               check right after focus(), without waiting for the resize
               event — see _forceKeyboardResync below. */
            modal._svVVResync = _onVVResize;
        }
    }

    /* FIX (bug: "Message tap opens the OS keyboard but no text field is
       visible — typed text lands in the keyboard's own suggestion strip
       instead"): window.visualViewport's 'resize' event is the correct
       signal, but on a number of Android WebViews (notably older system
       WebView builds many devices still ship) it fires LATE — sometimes
       300ms+ after the keyboard has already finished animating in — or in
       rare cases not at all for a programmatic focus() call. During that
       gap #sv-content is still its full 100dvh height, so #sv-bottom-bar
       (position:absolute;bottom:0) sits below the fold, hidden under the
       keyboard, exactly as seen in the report. This actively re-checks the
       viewport a few times over ~1.5s right after focus — independent of
       whether the resize event ever fires — so the bar is guaranteed to
       snap into view as soon as the keyboard finishes opening, on every
       device, not just ones with prompt visualViewport events. */
    function _forceKeyboardResync(modal){
        var svContentEl = document.getElementById('sv-content');
        if (!svContentEl) return;
        var baselineH = window.innerHeight;
        var tries = 0;
        var iv = setInterval(function(){
            tries++;
            if (!document.body.contains(svContentEl)) { clearInterval(iv); return; }
            if (window.visualViewport && typeof modal._svVVResync === 'function') {
                modal._svVVResync();
            } else {
                /* FIX: visualViewport-independent fallback for WebViews that
                   lack it entirely (the .scrollIntoView approach is a no-op
                   here since #sv-content has overflow:hidden — there's no
                   scrollable ancestor to scroll to). window.innerHeight DOES
                   reliably shrink on keyboard-open across virtually all
                   mobile browsers, including older Android WebViews, so use
                   that directly to pull #sv-content (and therefore the
                   absolutely-positioned #sv-bottom-bar inside it) up above
                   the keyboard. */
                var nowH  = window.innerHeight;
                var shrunk = (baselineH - nowH) > 80;
                svContentEl.style.height = shrunk ? (nowH + 'px') : '';
            }
            if (tries >= 8) clearInterval(iv); // ~1.6s of polling, then stop — never lingers
        }, 200);
    }

    /* Helper: querySelector + addEventListener with null guard */
    function _qclick(sel, fn) {
        var el = document.querySelector(sel);
        if (el) el.addEventListener('click', fn);
    }


    /* =========================================================================
       §4  SHOW ITEM
       ========================================================================= */
    function _showItem(userIdx, itemIdx) {
        _stopProg();
        var su = (window.userStatuses||[])[userIdx];
        if (!su) return;
        var items = _liveItems(su);
        if (!items[itemIdx]) return;

        var item = items[itemIdx];
        window._currentStatusUser = userIdx;
        window._currentStatusIdx  = itemIdx;

        var modal = document.getElementById('status-viewer-modal');
        if (!modal) return;
        modal.dataset.uid = su.userId || '';

        /* avatar / name / time */
        var avEl = document.getElementById('sv-av');
        var nmEl = document.getElementById('sv-name');
        var tmEl = document.getElementById('sv-time');
        if (avEl){ avEl.src=su.avatar||''; avEl.onerror=function(){this.src='https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=52';}; }
        if (nmEl) nmEl.textContent = su.name || 'User';
        if (tmEl) tmEl.textContent = item.createdAt ? _timeAgo(item.createdAt) : (item.time||'Just now');

        /* progress bars */
        var pw = document.getElementById('sv-prog-wrap');
        if (pw) {
            pw.innerHTML = '';
            items.forEach(function(_, i){
                var seg=document.createElement('div'); seg.className='sv-prog-seg';
                var fill=document.createElement('div'); fill.className='sv-prog-fill';
                if (i < itemIdx) fill.style.width='100%';
                seg.appendChild(fill); pw.appendChild(seg);
            });
        }

        /* hide media */
        var imgEl=document.getElementById('sv-img');
        var vidEl=document.getElementById('sv-vid');
        var txtEl=document.getElementById('sv-txt');
        var bgBlurEl=document.getElementById('sv-bg-blur');
        if (imgEl) imgEl.style.display='none';
        if (txtEl){
            txtEl.style.display='none';
            var _txtInnerReset=document.getElementById('sv-txt-inner');
            if (_txtInnerReset){ _txtInnerReset.textContent=''; _txtInnerReset.className=''; }
            var _txtCardReset=document.getElementById('sv-txt-card'), _txtChevReset=document.getElementById('sv-txt-chevron');
            if (_txtCardReset) _txtCardReset.classList.remove('sv-txt-clamped','sv-txt-expanded');
            if (_txtChevReset) _txtChevReset.classList.remove('show');
        }
        if (bgBlurEl){ bgBlurEl.style.display='none'; bgBlurEl.style.backgroundImage=''; }
        if (vidEl){
            if(vidEl._segH){vidEl.removeEventListener('timeupdate',vidEl._segH);vidEl._segH=null;}
            try{vidEl.pause();vidEl.src='';vidEl.load();}catch(e){}
            vidEl.style.display='none';
        }
        /* FEATURE (2026-09-13 — voice note playback): same reset pattern as
           vidEl above — stop, unhook the previous item's own timeupdate
           listener (drives the played/unplayed wave-bar fill), release the
           src, and hide, so switching items never leaves a prior voice
           note's audio playing underneath the next one. */
        var svVoiceEl=document.getElementById('sv-voice');
        var svAudioEl=document.getElementById('sv-audio');
        if (svAudioEl){
            if(svAudioEl._wvH){svAudioEl.removeEventListener('timeupdate',svAudioEl._wvH);svAudioEl._wvH=null;}
            try{svAudioEl.pause();svAudioEl.src='';svAudioEl.load();}catch(e){}
        }
        if (svVoiceEl) svVoiceEl.style.display='none';

        var dispMs = IMG_DUR_MS;

        if (item.type==='video' && item.url && vidEl) {
            vidEl.style.display='block'; vidEl.autoplay=true; vidEl.playsInline=true; vidEl.controls=false;
            var muteIc=document.querySelector('#sv-mute-btn i');
            vidEl.muted = muteIc ? muteIc.className.includes('mute') : false;

            var metaFired=false;
            var fb2=setTimeout(function(){
                if(metaFired)return; metaFired=true;
                vidEl.play&&vidEl.play().catch(function(){});
                _startProg(items,itemIdx,userIdx,MAX_VID_S*1000);
            },5000);

            vidEl.onloadedmetadata=function(){
                if(metaFired)return; metaFired=true; clearTimeout(fb2);
                var raw=isFinite(vidEl.duration)?vidEl.duration:MAX_VID_S;
                var st=item.startOffset!=null?item.startOffset:0;
                var en=item.endOffset!=null?item.endOffset:raw;
                var dur=Math.min(en-st,MAX_VID_S);
                if(dur<=0||!isFinite(dur))dur=MAX_VID_S;
                dispMs=dur*1000;
                vidEl.currentTime=st;
                vidEl.play&&vidEl.play().catch(function(){});
                vidEl._segH=function(){
                    if(vidEl.currentTime>=st+dur-0.25){
                        vidEl.removeEventListener('timeupdate',vidEl._segH); vidEl._segH=null; vidEl.pause();
                    }
                };
                vidEl.addEventListener('timeupdate',vidEl._segH);
                _startProg(items,itemIdx,userIdx,dispMs);
            };
            vidEl.onerror=function(){
                clearTimeout(fb2);
                if(!metaFired){metaFired=true;_startProg(items,itemIdx,userIdx,IMG_DUR_MS);}
            };
            vidEl.src=item.url; vidEl.load();

        } else if (item.type==='voice' && item.url && svVoiceEl && svAudioEl) {
            /* FEATURE (2026-09-13 — "add voice note as a feature"): plays
               back through the real <audio> element (autoplay + real
               decoded duration driving _startProg, same approach as the
               video branch above) while the visible UI is the static card
               — a waveform whose bars fill in step with playback progress
               plus a live mm:ss timer, mirroring the composer's own
               recording-preview card so what viewers see matches what was
               recorded. */
            svVoiceEl.style.display='flex';
            var svAvEl=document.getElementById('sv-voice-avatar');
            if(svAvEl) svAvEl.src=su.avatar||'';
            _csmVoiceBars('sv-voice-wave',28,'svvw-bar');
            var svBars=document.querySelectorAll('#sv-voice-wave .svvw-bar');
            svBars.forEach(function(bar){ bar.style.height=(6+Math.random()*18|0)+'px'; });
            var svTimerEl=document.getElementById('sv-voice-timer');

            var vMetaFired=false;
            var vFb=setTimeout(function(){
                if(vMetaFired)return; vMetaFired=true;
                svAudioEl.play&&svAudioEl.play().catch(function(){});
                _startProg(items,itemIdx,userIdx,IMG_DUR_MS);
            },5000);
            svAudioEl.onloadedmetadata=function(){
                if(vMetaFired)return; vMetaFired=true; clearTimeout(vFb);
                var vDur=isFinite(svAudioEl.duration)&&svAudioEl.duration>0?svAudioEl.duration:(item.duration||IMG_DUR_MS/1000);
                if(svTimerEl) svTimerEl.textContent=_fmtSvTime(vDur);
                svAudioEl.play&&svAudioEl.play().catch(function(){});
                svAudioEl._wvH=function(){
                    var pct=vDur>0?Math.min(svAudioEl.currentTime/vDur,1):0;
                    var filled=Math.round(pct*svBars.length);
                    svBars.forEach(function(bar,bi){ bar.classList.toggle('played',bi<filled); });
                    if(svTimerEl) svTimerEl.textContent=_fmtSvTime(Math.max(vDur-svAudioEl.currentTime,0));
                };
                svAudioEl.addEventListener('timeupdate',svAudioEl._wvH);
                _startProg(items,itemIdx,userIdx,vDur*1000);
            };
            svAudioEl.onerror=function(){
                clearTimeout(vFb);
                if(!vMetaFired){vMetaFired=true;_startProg(items,itemIdx,userIdx,IMG_DUR_MS);}
            };
            svAudioEl.src=item.url; svAudioEl.load();

        } else if (item.type==='text'||(!item.url&&item.content)) {
            if(txtEl){
                txtEl.style.display='flex';
                txtEl.style.background=item.bg||'linear-gradient(135deg,#0A0F1E,#1C2845)';
                var body=item.content||'';
                var innerEl=document.getElementById('sv-txt-inner');
                if(innerEl){
                    innerEl.textContent=body;
                    innerEl.style.color=_stTextColor(item.bg);
                    /* premium touch: longer articles get a slightly smaller,
                       tighter-leaded size so more of the piece is visible
                       before scrolling is even needed — never truncated
                       either way, just comfortably sized. */
                    innerEl.className = body.length>420 ? 'sv-txt-size-sm' : body.length>200 ? 'sv-txt-size-md' : '';
                }
                /* start clamped to 3 lines; keep the clamp + chevron only if
                   the text really overflows (measured after paint) */
                var _tcard=document.getElementById('sv-txt-card'), _tchev=document.getElementById('sv-txt-chevron');
                /* CHANGE (2026-10-25 — "expand/collapse only for video & picture status, not normal/text posts"): the 2-line clamp + more/less chevron is disabled for TEXT statuses. They now show in full, scrollable via the existing up/down nav. Original block kept behind the false && guard. */
                if(false && _tcard&&innerEl){
                    _tcard.classList.remove('sv-txt-expanded');
                    _tcard.classList.add('sv-txt-clamped');
                    if(_tchev) _tchev.classList.remove('show');
                    var _tbox=document.getElementById('sv-txt-scroll'); if(_tbox) _tbox.scrollTop=0;
                    requestAnimationFrame(function(){
                        if(!document.body.contains(innerEl)) return;
                        if(innerEl.scrollHeight>innerEl.clientHeight+1){ if(_tchev) _tchev.classList.add('show'); }
                        else _tcard.classList.remove('sv-txt-clamped');
                        _updateTxtNav();
                    });
                }
                _updateTxtNav();
            }
        } else if (item.url) {
            if(imgEl){imgEl.src=item.url;imgEl.style.display='block';}
            if(bgBlurEl){bgBlurEl.style.backgroundImage="url('"+item.url+"')";bgBlurEl.style.display='block';}
        }

        /* repost tag — only shown on items created via the share/retweet
           flow (§7); item.repostOf is set there and nowhere else. */
        var rtTagEl=document.getElementById('sv-repost-tag'), rtTagNameEl=document.getElementById('sv-repost-tag-name');
        if (rtTagEl) rtTagEl.classList.toggle('show', !!item.repostOf);
        if (rtTagNameEl) rtTagNameEl.textContent = item.repostOf ? ('Reposted from ' + (item.repostOf.name || 'User')) : '';

        /* caption — FIX (long attached-post handling): reset to collapsed
           on every item change so a previously-expanded caption doesn't
           carry over onto the next status. When this item is a repost
           with an added narrative, the narrative leads and the ORIGINAL
           caption follows quoted underneath it, untouched. */
        var capEl=document.getElementById('sv-caption');
        var capTextEl=document.getElementById('sv-caption-text');
        var capChevEl=document.getElementById('sv-caption-chevron');
        var origCaption=(item.type!=='text'&&item.content)?item.content:'';
        var fullCaption = item.quoteText
            ? (item.quoteText + (origCaption ? ('\n\n"' + origCaption + '"') : ''))
            : origCaption;
        if (capEl) capEl.classList.remove('sv-caption-expanded');
        if (capEl) capEl._fullCaption = fullCaption;
        /* CHANGE (2026-10-25): expand/collapse is for video & picture statuses only — text statuses never get the "more" link. */
        if (capEl) capEl._noExpand = (item.type==='text' || (!item.url && !!item.content));
        if (capTextEl) capTextEl.textContent = fullCaption;
        if (capChevEl) capChevEl.classList.remove('show');
        if (capTextEl && fullCaption) {
            /* measure AFTER the clamp has actually painted, so overflow is
               real (not guessed from character count). */
            requestAnimationFrame(function(){
                if (!document.body.contains(capTextEl)) return;
                _capRender();
            });
        }

        _syncCounts(item, su);
        if (item.type!=='video') _startProg(items,itemIdx,userIdx,dispMs);
    }

    function _syncCounts(item, su) {
        var myId = _us().id;

        /* FIX (owner's own status was showing viewer-facing engagement
           chrome — emoji quick-reactions, retweet, like — none of which
           make sense to react to on your OWN status): compute isOwn FIRST
           so every viewer-only control below can be gated on it. The
           owner's row should show nothing but the live-viewer count. */
        var isOwn=!!(myId&&su.userId===myId)||(su.userId===_viewUid());

        /* heart — viewer-only action, hidden for the owner */
        var hBtn=document.getElementById('sv-heart-btn'), hCnt=document.getElementById('sv-like-count');
        if(hBtn){
            hBtn.style.display = isOwn ? 'none' : 'flex';
            var liked=!!(item.likedBy&&myId&&item.likedBy.includes(myId));
            hBtn.classList.toggle('liked',liked);
            var hi=hBtn.querySelector('i'); if(hi){hi.className=liked?'fas fa-heart':'far fa-heart';hi.style.color=liked?'#f87171':'';}
        }
        if(hCnt) hCnt.textContent=(item.likes||0)>0?item.likes:'';

        /* retweet — viewer-only action, hidden for the owner */
        var rtBtn=document.getElementById('sv-rt-btn'), rtCnt=document.getElementById('sv-rt-count');
        if(rtBtn){
            rtBtn.style.display = isOwn ? 'none' : 'inline-flex';
            var rt=!!(item.retweetedBy&&myId&&item.retweetedBy.includes(myId));
            rtBtn.classList.toggle('retweeted',rt);
        }
        if(rtCnt) rtCnt.textContent=item.retweets||0;

        /* emoji quick-reactions — viewer-only, hidden for the owner */
        var emojiBtns=document.querySelectorAll('.sv-emoji-quick');
        for(var qi=0; qi<emojiBtns.length; qi++){ emojiBtns[qi].style.display = isOwn ? 'none' : 'flex'; }

        /* eye badge — the ONE thing the owner's row should show */
        var eyeBadge=document.getElementById('sv-eye-badge'), eyeCnt=document.getElementById('sv-eye-count');
        if(eyeBadge) eyeBadge.classList.toggle('show', isOwn);
        if(eyeCnt)   eyeCnt.textContent=(item.viewers||[]).length;

        /* FIX (2026-10-30 — "hide chat composer from owner"): the reply composer (#sv-reply-bar) messages the poster privately, so it
           makes no sense on your OWN status. Hidden for the owner (and any open emoji catalog is closed); restored for everyone else. */
        var _rBar=document.getElementById('sv-reply-bar');
        if(_rBar){
            _rBar.style.display = isOwn ? 'none' : '';
            if(isOwn){ var _eP=document.getElementById('sv-emoji-panel'); if(_eP) _eP.remove(); }
        }

        /* profile + chat visible for non-owner only */
        var profBtn=document.getElementById('sv-prof-btn'), chatBtn=document.getElementById('sv-chat-btn');
        if(profBtn) profBtn.style.display=isOwn?'none':'flex';
        if(chatBtn) chatBtn.style.display=isOwn?'none':'flex';

        /* delete — own status only */
        var delBtn=document.getElementById('sv-delete-btn');
        if(delBtn) delBtn.classList.toggle('show', isOwn);
    }

    /* =========================================================================
       §4b  LONG-POST EXPAND/COLLAPSE
       ------------------------------------------------------------------------
       Default display is 3 clamped lines (CSS). Expanding re-centers the
       caption into a scrollable panel per spec ("clicking expand makes
       the text scrollable to the middle") and pauses whatever media is
       playing so a long caption can be read without it racing ahead;
       collapsing resumes exactly where it left off.
       ========================================================================= */
    var _capExpandPaused = false;
    /* Inline "… Read more" / "Show less" (reference-screenshot style).
       Collapsed: if the 3-line clamp overflows, binary-search the longest
       prefix that still fits on 3 lines together with "… Read more".
       Expanded: full text followed by "Show less". */
    function _capRender(){
        var capEl=document.getElementById('sv-caption'), t=document.getElementById('sv-caption-text');
        if(!capEl||!t) return;
        var full=capEl._fullCaption||'';
        var expanded=capEl.classList.contains('sv-caption-expanded');
        function link(cls,label){var a=document.createElement('span');a.className=cls;a.appendChild(document.createTextNode(label));a.insertAdjacentHTML('beforeend','<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>');return a;}
        t.textContent=full;
        if(!full) return;
        if(expanded){ return; }
        if(capEl._noExpand){ t.style.webkitLineClamp='unset'; t.style.display='block'; return; } /* text status: show in full, no expander */
        t.style.webkitLineClamp=''; t.style.display='';
        if(t.scrollHeight<=t.clientHeight+1) return; /* fits in 3 lines — nothing to expand */
        function fits(n){
            t.textContent=full.slice(0,n).replace(/\s+$/,'')+'\u2026 ';
            t.appendChild(link('sv-readmore','more'));
            return t.scrollHeight<=t.clientHeight+1;
        }
        var lo=0,hi=full.length;
        while(lo<hi){var mid=Math.ceil((lo+hi)/2); if(fits(mid)) lo=mid; else hi=mid-1;}
        fits(lo);
    }
    function _toggleCaptionExpand(){
        var capEl=document.getElementById('sv-caption');
        if (!capEl) return;
        var expanding = !capEl.classList.contains('sv-caption-expanded');
        capEl.classList.toggle('sv-caption-expanded', expanding);
        _capRender();
        var vid=document.getElementById('sv-vid');
        if (expanding){
            _stopProg();
            if (vid && vid.style.display!=='none' && !vid.paused){ vid.pause(); _capExpandPaused=true; }
            else _capExpandPaused=false;
        } else {
            if (_capExpandPaused && vid){ vid.play&&vid.play().catch(function(){}); }
            _capExpandPaused=false;
            _resumeProg();
        }
    }

    /* =========================================================================
       §4b2  TEXT-STATUS CARD NAVIGATION
       ------------------------------------------------------------------------
       Up/down chevrons page through a long text status a screenful at a
       time; each button only appears while there's genuinely more content
       in that direction, so a short post shows no chevrons at all.
       ========================================================================= */
    /* expand/collapse a long text status (see .sv-txt-chevron CSS). While
       expanded the progress timer is paused so there's time to read, same
       as the caption chevron; collapsing resumes it. */
    function _toggleTxtExpand(){
        var card=document.getElementById('sv-txt-card'); if(!card) return;
        var box=document.getElementById('sv-txt-scroll');
        var expanding=!card.classList.contains('sv-txt-expanded');
        card.classList.toggle('sv-txt-expanded',expanding);
        card.classList.toggle('sv-txt-clamped',!expanding);
        if(expanding){ _stopProg(); }
        else { if(box) box.scrollTop=0; _resumeProg(); }
        _updateTxtNav();
    }
    function _scrollTxt(dir){
        var box=document.getElementById('sv-txt-scroll'); if(!box) return;
        box.scrollBy({ top: dir*box.clientHeight*0.8, behavior:'smooth' });
    }
    function _updateTxtNav(){
        var box=document.getElementById('sv-txt-scroll');
        var upBtn=document.getElementById('sv-txt-nav-up'), dnBtn=document.getElementById('sv-txt-nav-down');
        if(!box||!upBtn||!dnBtn) return;
        requestAnimationFrame(function(){
            if (!document.body.contains(box)) return;
            upBtn.classList.toggle('show', box.scrollTop>4);
            dnBtn.classList.toggle('show', (box.scrollHeight-box.scrollTop-box.clientHeight)>4);
        });
    }

    /* =========================================================================
       §4c  HOLD-TO-PAUSE
       ------------------------------------------------------------------------
       Pressing and holding anywhere on the status (outside interactive
       chrome — see _EXCLUDE_SEL in _wireViewerOnce) pauses playback until
       released. Tracks whether the video was actually mid-playback so we
       only resume it if we're the ones who paused it (never force-plays a
       video the user muted/stopped by other means).
       ========================================================================= */
    var _holdActive=false, _holdWasPlaying=false;
    var _svPressAt = 0;
    function _holdStart(){
        _svPressAt = Date.now();
        if (_holdActive) return;
        /* an expanded caption already has its own pause state (§4b) —
           don't let hold-to-pause double-fire against it. */
        var capEl=document.getElementById('sv-caption');
        if (capEl && capEl.classList.contains('sv-caption-expanded')) return;
        _holdActive=true;
        var vid=document.getElementById('sv-vid');
        _holdWasPlaying = !!(vid && vid.style.display!=='none' && !vid.paused);
        if (_holdWasPlaying) vid.pause();
        _stopProg();
    }
    function _holdEnd(shouldResume){
        if (!_holdActive) return;
        _holdActive=false;
        if (!shouldResume) return; // caller already handled progress (e.g. navigated)
        var vid=document.getElementById('sv-vid');
        if (_holdWasPlaying && vid) vid.play&&vid.play().catch(function(){});
        _holdWasPlaying=false;
        _resumeProg();
    }

    function _closeViewer() {
        _stopProg();
        _viewerOpen = false;
        var modal=document.getElementById('status-viewer-modal');
        if(modal){
            /* FIX: clean up the visualViewport listener registered in
               _wireViewerOnce so it doesn't keep firing (and doesn't leak
               a duplicate) the next time a status is opened. */
            if (typeof modal._ocVVCleanup === 'function') {
                try { modal._ocVVCleanup(); } catch(e) {}
                modal._ocVVCleanup = null;
            }
            modal.className=''; modal.innerHTML='';
        }
        document.body.classList.remove('modal-open');
    }


    /* =========================================================================
       §5  PROGRESS
       ========================================================================= */
    function _stopProg(){
        clearTimeout(_advTimer); _advTimer=null;
        if(_progRaf){cancelAnimationFrame(_progRaf);_progRaf=null;}
        _curFill=null;
    }
    /* Shared resume logic — same "time remaining" computation already used
       by the reply-input focus/blur pause, factored out so the viewers
       panel can pause/resume the same way. */
    function _resumeProg(){
        var su=_curSU(); if(!su) return;
        var its=_liveItems(su);
        var vid=document.getElementById('sv-vid'), remain=IMG_DUR_MS;
        if(vid&&!vid.paused&&isFinite(vid.duration)&&isFinite(vid.currentTime)){
            var ci=its[window._currentStatusIdx||0];
            var se=(ci&&ci.endOffset!=null)?ci.endOffset:vid.duration;
            remain=Math.max(500,(se-vid.currentTime)*1000);
        }
        _startProg(its,window._currentStatusIdx||0,window._currentStatusUser||0,remain);
    }
    function _startProg(items,itemIdx,userIdx,durMs){
        _stopProg();
        if(!durMs||durMs<=0) durMs=IMG_DUR_MS;
        var pw=document.getElementById('sv-prog-wrap');
        var segs=pw?pw.querySelectorAll('.sv-prog-seg'):[];
        var fill=segs[itemIdx]?segs[itemIdx].querySelector('.sv-prog-fill'):null;
        _curFill=fill; _progStart=performance.now(); _progDurMs=durMs;

        (function tick(now){
            if(!_curFill)return;
            var pct=Math.min(100,((now-_progStart)/_progDurMs)*100);
            _curFill.style.width=pct+'%';
            if(pct<100)_progRaf=requestAnimationFrame(tick);
        })(performance.now());

        _advTimer=setTimeout(function(){
            _stopProg();
            var nxt=itemIdx+1;
            if(nxt<items.length){_showItem(userIdx,nxt);_recordView(userIdx,nxt);}
            else{var nu=userIdx+1;if(nu<(window.userStatuses||[]).length)_advanceToUser(nu,'fwd');else _closeViewer();}
        },durMs);
    }


    /* =========================================================================
       §6  LIKE — bubble hearts float up inside sv-content
       ========================================================================= */
    function _doLike(){
        var su=_curSU();if(!su)return;
        var items=_liveItems(su),item=items[window._currentStatusIdx||0];if(!item)return;
        if(!item.likedBy)item.likedBy=[];
        var uid=_us().id,idx=item.likedBy.indexOf(uid);
        if(idx>-1){item.likedBy.splice(idx,1);item.likes=Math.max(0,(item.likes||0)-1);}
        else{item.likedBy.push(uid);item.likes=(item.likes||0)+1;}
        var nowLiked=idx===-1;
        var hBtn=document.getElementById('sv-heart-btn'),hCnt=document.getElementById('sv-like-count');
        if(hBtn){
            hBtn.classList.toggle('liked',nowLiked);
            var hi=hBtn.querySelector('i');
            if(hi){hi.className=nowLiked?'fas fa-heart':'far fa-heart';hi.style.color=nowLiked?'#f87171':'';}
            if(nowLiked){hi.style.transform='scale(1.5)';setTimeout(function(){hi.style.transform='scale(1)';},200);_spawnBubbles();}
        }
        if(hCnt) hCnt.textContent=item.likes>0?item.likes:'';
        if(typeof window.rewardUserForAction==='function') window.rewardUserForAction('RECEIVE_LIKE',su.userId);
        _persistItem(su,item);
    }

    /* FIX (bug: "bubble like is broken"): bubbles used to spawn at a fixed
       bottom:70px, tuned for the old single-row reply bar. The new bottom
       action bar (quick-reactions row + comments list + reply row) is
       taller, so bubbles were spawning UNDERNEATH it — rendered, but
       completely hidden behind an opaque background, which looks exactly
       like "tapping like does nothing". FIX: measure the actual current
       height of #sv-bottom-bar at spawn time and start bubbles just above
       it, so they're always visible regardless of how tall that bar is
       (e.g. grows when comments are present). Also accepts an optional
       emoji override so the quick-reaction row can spawn its own emoji
       instead of always hearts. */
    function _spawnBubbles(emoji){
        /* Append to sv-content (position:relative, overflow:hidden) — not modal root */
        var box=document.getElementById('sv-content');
        if(!box)return;
        var bar=document.getElementById('sv-bottom-bar');
        var clearance=(bar?bar.getBoundingClientRect().height:70)+14;
        var emojis=emoji?[emoji]:['❤️','💕','💖','💗','❤️'];
        for(var b=0;b<8;b++){
            (function(i){
                var bbl=document.createElement('div');
                bbl.className='sv-bubble';
                bbl.textContent=emojis[i%emojis.length];
                var x=15+Math.random()*70, dur=0.9+i*0.13;
                bbl.style.cssText='position:absolute;bottom:'+clearance+'px;left:'+x+'%;font-size:'+(1.1+Math.random()*0.8)+'rem;pointer-events:none;z-index:50;opacity:1;transition:transform '+dur+'s ease-out,opacity '+dur+'s ease-out;';
                box.appendChild(bbl);
                requestAnimationFrame(function(){requestAnimationFrame(function(){
                    bbl.style.transform='translateY(-'+(110+Math.random()*120)+'px) rotate('+(Math.random()*30-15)+'deg) scale(0.3)';
                    bbl.style.opacity='0';
                });});
                setTimeout(function(){if(bbl.parentNode)bbl.parentNode.removeChild(bbl);},(dur*1000)+300);
            })(b);
        }
    }


    /* =========================================================================
       §7  RETWEET
       ========================================================================= */
    /* ── share sheet open/close — populates the preview from the status
       currently on screen, pausing playback while the sheet is up. ── */
    /* FIX 2026-10-15 — repost sheet vs. on-screen keyboard.
       #sv-rt-modal is absolute inset:0 inside #sv-content, and the viewer's own visualViewport handler shrinks #sv-content to
       the keyboard-adjusted height while #status-viewer-modal keeps it vertically CENTRED in the full-height screen — so the
       bottom of #sv-content (where this sheet and its "Repost to friends" button sit) lands underneath the keyboard.
       Here we measure #sv-content against the real visible area (visualViewport) and pin the overlay to exactly that area,
       so the sheet's bottom edge is always just above the keyboard. No-op when no keyboard is open (desktop untouched). */
    var _rtVVHandler=null;
    function _rtSyncKeyboard(){
        var modal=document.getElementById('sv-rt-modal');
        if(!modal || !modal.classList.contains('show')){ _rtUnbindKeyboard(); return; }
        var vv=window.visualViewport, content=document.getElementById('sv-content');
        if(!vv || !content) return;
        var shrunk=(window.innerHeight - vv.height) > 80;
        if(!shrunk){ modal.style.top=''; modal.style.bottom=''; modal.classList.remove('rt-kb'); return; }
        var r=content.getBoundingClientRect();
        var top=Math.max(0, vv.offsetTop - r.top);
        var bottom=Math.max(0, r.bottom - (vv.offsetTop + vv.height));
        modal.style.top=top+'px';
        modal.style.bottom=bottom+'px';
        modal.classList.add('rt-kb');
    }
    function _rtBindKeyboard(){
        if(!window.visualViewport || _rtVVHandler) return;
        _rtVVHandler=function(){ _rtSyncKeyboard(); setTimeout(_rtSyncKeyboard,40); };
        window.visualViewport.addEventListener('resize',_rtVVHandler);
        window.visualViewport.addEventListener('scroll',_rtVVHandler);
    }
    function _rtUnbindKeyboard(){
        if(window.visualViewport && _rtVVHandler){
            window.visualViewport.removeEventListener('resize',_rtVVHandler);
            window.visualViewport.removeEventListener('scroll',_rtVVHandler);
        }
        _rtVVHandler=null;
        var modal=document.getElementById('sv-rt-modal');
        if(modal){ modal.style.top=''; modal.style.bottom=''; modal.classList.remove('rt-kb'); }
    }
    function _openRetweetModal(){
        var su=_curSU(); if(!su) return;
        var items=_liveItems(su), item=items[window._currentStatusIdx||0]; if(!item) return;
        var modal=document.getElementById('sv-rt-modal'); if(!modal) return;
        _stopProg();
        var vid=document.getElementById('sv-vid');
        if (vid && vid.style.display!=='none' && !vid.paused){ vid.pause(); _capExpandPaused=true; } else _capExpandPaused=false;
        var avEl=document.getElementById('sv-rt-preview-av'), nmEl=document.getElementById('sv-rt-preview-name'), txEl=document.getElementById('sv-rt-preview-text');
        if (avEl){ avEl.src=su.avatar||''; avEl.onerror=function(){this.src='https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=52';}; }
        if (nmEl) nmEl.textContent = su.name||'User';
        if (txEl){
            /* 2026-10-31: the fallback labels were emoji (video camera / camera); now line icons. Real captions stay plain textContent. */
            if (item.content) txEl.textContent = item.content;
            else if (item.type==='video') txEl.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>Video status';
            else if (item.type==='image') txEl.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/></svg>Photo status';
            else txEl.textContent = '';
        }
        var ta=document.getElementById('sv-rt-comment'); if (ta) ta.value='';
        modal.classList.add('show');
        /* FIX 2026-10-15 — keep the sheet (and its Repost button) above the on-screen keyboard */
        _rtBindKeyboard();
        if (ta){
            ta.onfocus=function(){ setTimeout(_rtSyncKeyboard,60); setTimeout(_rtSyncKeyboard,350); setTimeout(_rtSyncKeyboard,700); };
            ta.onblur =function(){ setTimeout(_rtSyncKeyboard,120); setTimeout(_rtSyncKeyboard,500); };
        }
    }
    function _closeRetweetModal(resume){
        var modal=document.getElementById('sv-rt-modal'); if (modal) modal.classList.remove('show');
        _rtUnbindKeyboard();   /* FIX 2026-10-15 */
        if (resume){
            var vid=document.getElementById('sv-vid');
            if (_capExpandPaused && vid){ vid.play&&vid.play().catch(function(){}); }
            _capExpandPaused=false;
            _resumeProg();
        }
    }

    /* =========================================================================
       §6b  DELETE STATUS
       ------------------------------------------------------------------------
       Own-status-only. A confirmation sheet sits between the tap and the
       actual removal since this can't be undone. On confirm: the item is
       spliced out of the real (unfiltered) items array, the doc is either
       re-persisted with the trimmed array or deleted outright if that was
       the last item, and the viewer moves on to whatever's left — the next
       remaining item for this user, or straight to closing if none.
       ========================================================================= */
    function _openDeleteModal(){
        var modal=document.getElementById('sv-delete-modal'); if(!modal) return;
        _stopProg();
        var vid=document.getElementById('sv-vid');
        if (vid && vid.style.display!=='none' && !vid.paused){ vid.pause(); _capExpandPaused=true; } else _capExpandPaused=false;
        modal.classList.add('show');
    }
    function _closeDeleteModal(resume){
        var modal=document.getElementById('sv-delete-modal'); if (modal) modal.classList.remove('show');
        if (resume){
            var vid=document.getElementById('sv-vid');
            if (_capExpandPaused && vid){ vid.play&&vid.play().catch(function(){}); }
            _capExpandPaused=false;
            _resumeProg();
        }
    }
    function _deleteCurrentItem(){
        var su=_curSU(); if(!su) return;
        var liveIts=_liveItems(su);
        var idx=window._currentStatusIdx||0;
        var item=liveIts[idx]; if(!item) return;

        /* splice out of the REAL (unfiltered) items array, not the
           filtered _liveItems() copy — su.items is what actually gets
           persisted. */
        var realIdx=(su.items||[]).findIndex(function(it){ return it.id===item.id; });
        if(realIdx>-1) su.items.splice(realIdx,1);

        if(window.fbDb && su.docId){
            try{
                if(su.items.length){
                    window.fbDb.collection('statuses').doc(su.docId).set({items:su.items},{merge:true}).catch(function(){});
                } else {
                    window.fbDb.collection('statuses').doc(su.docId).delete().catch(function(){});
                }
            }catch(e){}
        }

        _notify('Status deleted','success');
        _closeDeleteModal(false);

        var remaining=_liveItems(su);
        if(remaining.length){
            var nextIdx=Math.min(idx, remaining.length-1);
            _showItem(window._currentStatusUser, nextIdx);
            _recordView(window._currentStatusUser, nextIdx);
        } else {
            var arrIdx=(window.userStatuses||[]).findIndex(function(s){ return s.docId===su.docId; });
            if(arrIdx>-1) window.userStatuses.splice(arrIdx,1);
            if(typeof window.renderStatusBar==='function') window.renderStatusBar();
            _closeViewer();
        }
    }

    /* =========================================================================
       §7  RETWEET / SHARE
       ------------------------------------------------------------------------
       FIX ("tweeting posts does not work"): adding a repost used to only
       flip a local retweetedBy/retweets counter on the ORIGINAL item —
       nothing was actually shared anywhere, so friends never saw it.
       Now, adding a repost:
         1. still updates the counter/toggle UI on the original (so the
            button and count reflect "you reposted this"), AND
         2. builds a new status item carrying the ORIGINAL content
            untouched (same type/url/content/bg — "shared tweets must
            preserve the original content") plus the optional narrative
            text collected in the share sheet, and posts it onto the
            current user's own status — exactly the same write path the
            manual status composer uses — so it shows up for their
            friends like any other status.
       Removing a repost (tapping again after already reposting) is left
       as a pure local undo — there's no separate "delete the shared
       status" step here, matching how a quick unlike doesn't retract a
       comment; the accompanying shared status is a keepsake of the
       repost, not a live link back to it.
       optional quoteText — the user's own added narrative from the share
       sheet; undefined/omitted on the plain toggle-off path. ========================================================================= */
    async function _doRetweet(quoteText){
        var su=_curSU();if(!su)return;
        var items=_liveItems(su),item=items[window._currentStatusIdx||0];if(!item)return;
        if(!item.retweetedBy)item.retweetedBy=[];
        var uid=_us().id,idx=item.retweetedBy.indexOf(uid);
        var wasRetweeted=idx>-1;
        if(wasRetweeted){item.retweetedBy.splice(idx,1);item.retweets=Math.max(0,(item.retweets||0)-1);}
        else{item.retweetedBy.push(uid);item.retweets=(item.retweets||0)+1;}
        var didRt=!wasRetweeted;
        var rtBtn=document.getElementById('sv-rt-btn'),rtCnt=document.getElementById('sv-rt-count');
        if(rtBtn){rtBtn.classList.toggle('retweeted',didRt);if(didRt){rtBtn.style.transform='scale(1.25)';setTimeout(function(){rtBtn.style.transform='scale(1)';},200);}}
        if(rtCnt) rtCnt.textContent=item.retweets||0;
        _persistItem(su,item);

        if(!didRt){
            _svToast('Repost removed','info');
            return;
        }

        try{
            var me=_us();
            var repostItem=_mkItem(item.type, item.url, item.content, item.bg);
            repostItem.quoteText = (quoteText||'').trim();
            repostItem.repostOf  = { userId: su.userId, name: su.name||'User', avatar: su.avatar||'', itemId: item.id };

            var docId='status-'+me.id;
            if(!window.userStatuses)window.userStatuses=[];
            var ei=window.userStatuses.findIndex(function(s){return s.userId===me.id;});
            var existingDoc = ei>-1 ? window.userStatuses[ei] : null;
            var keptItems   = existingDoc ? _liveItems(existingDoc) : [];
            var mergedItems = keptItems.concat([repostItem]);
            var doc={userId:me.id,name:me.fullName||me.username||'User',avatar:me.avatar||'',items:mergedItems,viewed:false,createdAt:(existingDoc&&existingDoc.createdAt)||new Date().toISOString(),docId:docId};
            if(window.fbDb){try{await window.fbDb.collection('statuses').doc(docId).set({userId:doc.userId,name:doc.name,avatar:doc.avatar,items:mergedItems,createdAt:doc.createdAt},{merge:true});}catch(fe){console.warn('[Status retweet]',fe.message);}}
            if(ei>-1)window.userStatuses[ei]=doc;else window.userStatuses.unshift(doc);
            if(typeof window.renderStatusBar==='function') window.renderStatusBar();

            _svToast('Reposted to your status','success');
            _closeRetweetModal(false);
            /* same "direct navigation for confirmation" pattern already
               used by the manual status composer. */
            if(typeof window.openStatusViewer==='function'){
                var ownIdx = ei>-1 ? ei : 0;
                window.openStatusViewer(ownIdx);
                /* 2026-10-31 ("leave that screen and display the repost"): openStatusViewer always starts at the first item, but the repost
                   is appended LAST — jump straight to it so the person sees what they just reposted. */
                try{
                    var _ownDoc=(window.userStatuses||[])[ownIdx]||doc;
                    var _ri=_liveItems(_ownDoc).findIndex(function(x){ return x && x.id===repostItem.id; });
                    if(_ri>0){ _showItem(ownIdx,_ri); _recordView(ownIdx,_ri); }
                }catch(_je){}
            }
        }catch(err){
            console.error('[Status retweet]',err);
            _svToast('Repost failed: '+(err.message||'Try again'),'error');
            _closeRetweetModal(true);
        }
    }


    /* =========================================================================
       §7b  INLINE COMMENTS (WhatsApp-style reply that stays in the viewer)
       ------------------------------------------------------------------------
       FIX: the old reply flow navigated away to the Messages section the
       moment you sent something, which broke the "stay in the status"
       expectation. _postComment stores the comment on the status item
       itself (so it's visible to anyone viewing that status, like a
       caption-reply thread) AND, if a real DM-send function exists, also
       queues the same text as an actual direct message in the background —
       without switching screens or closing the viewer.

       FIX (bug: "emoji/messages should go to inbox, not the status"): the
       previous version did BOTH — pushed the reply into a PUBLIC
       item.comments array rendered for every viewer to see under the
       status, AND tried a best-effort DM. That's backwards: WhatsApp status
       replies are always PRIVATE — there is no public comment thread under
       a status at all. This version removes the public thread entirely and
       writes a real direct message using the exact same Firestore schema
       app-patch-openchat.js's _doSend() uses (collections 'messages' and
       'chats', same field names, same chatId format), so the reply lands
       in the recipient's actual inbox. Only the sender sees a brief private
       "Sent" confirmation — nothing is shown publicly on the status.
       ========================================================================= */
    function _buildStatusChatId(a, b) { return [a, b].sort().join('_'); }

    function _postComment(text, isEmojiOnly){
        var su=_curSU(); if(!su) return;
        var uid = su.userId;
        var me  = _us();
        /* FIX (2026-10-20 — "message from a status should drop like a normal
           message"): this used to build the message from the cached
           userState.id only. app-patch-openchat.js's _doSend() documents
           that this cached id can drift from the live Firebase Auth uid
           (session restore / anonymous fallback), and Firestore silently
           rejects a write whose senderId != request.auth.uid. Here the
           write errors were swallowed by an empty .catch(), and the
           "Reply sent" toast fired regardless — so a status reply could
           look sent yet never reach the inbox. Now: live uid first (same
           rule _doSend uses), same payload shape as a normal chat message,
           one automatic retry, and the confirmation only shows once the
           write is actually accepted. */
        var authUser = (window.fbAuth && window.fbAuth.currentUser) || null;
        var myId = (authUser && !authUser.isAnonymous && authUser.uid) || me.id || '';
        if (!uid || !myId || uid === myId) return; /* can't DM your own status */

        var chatId = _buildStatusChatId(myId, uid);
        var msgId  = 'msg-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
        var now    = new Date().toISOString();
        /* The status item on screen right now (window._currentStatusIdx into
           su.items). Snapshot of it travels ON the message so the thread can
           show "replied to a status" with a thumbnail on that exact bubble. */
        var curItem = (su.items || [])[window._currentStatusIdx] || {};
        var statusId = su.docId || ('status-'+uid);

        if (!window.fbDb) { _notify('Could not send reply — no connection. Try again.','error'); return; }

        var payload = {
            id:          msgId,
            chatId:      chatId,
            senderId:    myId,
            receiverId:  uid,
            senderName:  me.fullName || me.username || 'User',
            text:        text,
            replyTo:     null,
            read:        false,
            edited:      false,
            deleted:     false,
            createdAt:   now,
            statusReplyTo: statusId,
            statusReply: {
                statusId:  statusId,
                ownerId:   uid,
                ownerName: su.name || '',
                thumb:     curItem.url || '',
                type:      curItem.type || '',
                snippet:   String(curItem.content || '').slice(0, 80)
            }
        };

        function _write(isRetry){
            window.fbDb.collection('messages').doc(msgId).set(payload).then(function(){
                _flashSentConfirmation(isEmojiOnly ? text+' sent' : 'Reply sent to '+(su.name||'user'));
            }).catch(function(){
                if(!isRetry){ setTimeout(function(){ _write(true); }, 1500); return; }
                _notify('Could not send reply — check your connection and try again.','error');
            });
        }
        try {
            _write(false);
            window.fbDb.collection('chats').doc(chatId).set({
                participants: [myId, uid],
                lastMessage: text,
                lastMessageTime: now,
                lastSenderId: myId,
                // Chat-session-level status link, kept for older readers
                // (app-patch-openchat.js's top banner is retired; the thread
                // now reads the per-message statusReply snapshot above).
                statusId: statusId,
                statusThumbnail: curItem.url || '',
                statusThumbnailType: curItem.type || ''
            }, { merge: true }).catch(function(){});
        } catch(e) {
            _notify('Could not send reply — try again.','error');
        }
    }

    /* Small, private, self-dismissing confirmation shown near the composer
       — NOT a public comment, just local feedback that the DM went out. */
    function _flashSentConfirmation(msg){
        var bar=document.getElementById('sv-reply-bar');
        if(!bar){ _notify(msg,'success'); return; }
        var existing=document.getElementById('sv-sent-flash');
        if(existing) existing.remove();
        var flash=document.createElement('div');
        flash.id='sv-sent-flash';
        flash.textContent=msg;
        flash.style.cssText='position:absolute;left:8px;right:8px;bottom:100%;margin-bottom:8px;background:rgba(0,212,170,0.92);color:#062019;font-size:0.76rem;font-weight:700;text-align:center;padding:6px 10px;border-radius:10px;z-index:24;pointer-events:none;transition:opacity 0.3s;';
        bar.style.position='relative';
        bar.appendChild(flash);
        setTimeout(function(){ flash.style.opacity='0'; setTimeout(function(){ if(flash.parentNode) flash.remove(); },300); },1400);
    }

    /* Small inline emoji panel for the composer's emoji-toggle button.
       Tapping an emoji here INSERTS it into the reply input at the cursor
       (system-keyboard behavior) rather than posting immediately — distinct
       from the always-visible quick-reaction row, which posts on tap. */
    var EMOJI_PANEL_SET=['😀','😂','😍','😮','😢','😡','🙏','👏','🔥','💯','🎉','😎','😴','🤔','👍','❤️'];
    function _toggleInlineEmojiPanel(){
        var existing=document.getElementById('sv-emoji-panel');
        if(existing){ existing.remove(); return; }
        var bar=document.getElementById('sv-reply-bar');
        if(!bar) return;
        var panel=document.createElement('div');
        panel.id='sv-emoji-panel';
        panel.style.cssText='position:absolute;left:8px;right:8px;bottom:100%;margin-bottom:8px;background:rgba(20,20,30,0.96);backdrop-filter:blur(10px);border-radius:14px;padding:10px;display:grid;grid-template-columns:repeat(8,1fr);gap:4px;z-index:25;max-height:160px;overflow-y:auto;';
        EMOJI_PANEL_SET.forEach(function(em){
            var b=document.createElement('button');
            b.type='button';
            b.textContent=em;
            b.style.cssText='background:none;border:none;font-size:1.3rem;cursor:pointer;padding:6px;border-radius:8px;';
            b.addEventListener('click', function(e){
                e.stopPropagation();
                var inp=document.getElementById('sv-reply-inp');
                if(inp){ inp.value=(inp.value||'')+em; inp.focus(); }
            });
            panel.appendChild(b);
        });
        bar.style.position='relative';
        bar.appendChild(panel);
        /* close on outside tap */
        setTimeout(function(){
            document.addEventListener('click', function _closeEmojiPanel(e){
                if(e.target.closest('#sv-emoji-panel,#sv-emoji-toggle')) return;
                var p=document.getElementById('sv-emoji-panel');
                if(p) p.remove();
                document.removeEventListener('click', _closeEmojiPanel);
            });
        },0);
    }

    /* =========================================================================
       §8  VIEWERS PANEL
       ========================================================================= */
    function _populateViewers(){
        var list=document.getElementById('svp-list');if(!list)return;
        var su=_curSU();if(!su)return;
        var items=_liveItems(su),item=items[window._currentStatusIdx||0];
        var cntEl=document.getElementById('svp-count');
        if(cntEl) cntEl.textContent=(item&&item.viewers&&item.viewers.length)?item.viewers.length:'';
        if(!item||!item.viewers||!item.viewers.length){
            list.innerHTML='<div class="svp-empty"><i class="fas fa-eye-slash" style="margin-right:6px;"></i>No viewers yet</div>';
            return;
        }
        var html='';
        item.viewers.forEach(function(v){
            var uid=(v&&v.uid)?v.uid:String(v);
            var when=(v&&v.time)?_timeAgo(v.time):'';
            var u=_lookupUser(uid,(v&&v.uid)?v:null);
            var name=_esc(u.name||uid);
            var fb='https://ui-avatars.com/api/?name='+encodeURIComponent(u.name||'U')+'&background=1B2B8B&color=fff&size=38';
            var isSelf=uid===(_viewUid()||'');
            html+='<div class="svp-row" data-uid="'+_esc(uid)+'">'
                +'<img class="svp-avatar" src="'+(u.avatar||fb)+'" onerror="this.src=\''+fb+'\'" alt="'+name+'">'
                +'<div class="svp-info"><div class="svp-name">'+name+'</div>'+(when?'<div class="svp-time">'+when+'</div>':'')+'</div>'
                +(!isSelf?'<button class="svp-msg-btn" data-chat="'+_esc(uid)+'" title="Message" aria-label="Message"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4 3.5V16h-.5A1.5 1.5 0 0 1 4 14.5z"/><path d="M8 8.5h8M8 11.5h5"/></svg></button>':'')
                +'</div>';
        });
        list.innerHTML=html;
        /* FIX: this function runs every time the eye-badge/viewers panel is
           opened (also on swipe-up), but it kept calling addEventListener on
           the SAME #svp-list element without ever removing the previous
           listener. Each reopen stacked another handler, so tapping
           "Message" or a viewer row could fire navigation multiple times —
           inconsistent, glitchy behavior that doesn't match WhatsApp's
           clean single-fire tap. FIX: wire the click listener once, the
           first time #svp-list is created, using a guard flag — never wire
           it again on subsequent calls, since innerHTML reassignment above
           doesn't replace the listener (it's on the stable #svp-list
           element itself, not its children). */
        if (!list._ocViewersWired) {
            list._ocViewersWired = true;
            list.addEventListener('click', function(e){
                var cb=e.target.closest('[data-chat]');
                if(cb){e.stopPropagation();if(_isGuest()){_notify('Log in','info');return;}var p=document.getElementById('sv-viewers-panel');if(p)p.classList.remove('open');_closeViewer();_openChat(cb.dataset.chat);return;}
                var row=e.target.closest('.svp-row');
                if(row&&row.dataset.uid){_closeViewer();_goProfile(row.dataset.uid);}
            });
        }
    }


    /* =========================================================================
       §9  RECORD VIEW
       ========================================================================= */
    function _recordView(userIdx,itemIdx){
        var su=(window.userStatuses||[])[userIdx];if(!su)return;
        su.viewed=true;
        var items=_liveItems(su),item=items[itemIdx];if(!item)return;
        if(!item.viewers)item.viewers=[];
        var uid=_viewUid(),viewedAt=new Date().toISOString();
        var isNewViewer = uid && !item.viewers.find(function(v){return(v&&v.uid?v.uid:v)===uid;});
        if(isNewViewer){
            /* FIX (2026-10-30 — real names in viewers list): store the viewer's display name/avatar with the view so the owner never
               has to resolve a stranger's profile later. Old entries (uid+time only) keep working. */
            var _me=_us()||{};
            var _vn=_me.fullName||_me.username||'';
            var _ve={uid:uid,time:viewedAt};
            if(_vn){ _ve.name=_vn; if(_me.avatar && String(_me.avatar).indexOf('data:')!==0) _ve.avatar=_me.avatar; }
            item.viewers.push(_ve);
        }
        var docId=su.docId||('status-'+su.userId);
        if(window.fbDb&&docId){
            try{
                var payload = isNewViewer ? {viewed:true,items:su.items} : {viewed:true};
                window.fbDb.collection('statuses').doc(docId).set(payload,{merge:true}).catch(function(){});
            }catch(e){}
        }
        try{var vc=JSON.parse(localStorage.getItem('emp_viewed_statuses')||'{}');vc[su.userId]=Date.now();localStorage.setItem('emp_viewed_statuses',JSON.stringify(vc));}catch(e){}
        var eyeCnt=document.getElementById('sv-eye-count');
        if(eyeCnt)eyeCnt.textContent=item.viewers.length;
    }


    /* =========================================================================
       §10  GLOBAL DELEGATE — status bar taps + create-status
           SHORT tap (< 300ms) → peek preview
           Tap "View Status" in peek → openStatusViewer
       ========================================================================= */
    (function _wireBarAndPeek(){
        var _ptStart=0, _ptIdx=-1, _ptTimer=null;

        /* FIX (bug: "click doesn't open"): a tap on a status circle used to
           ALWAYS open the small peek card first — the full WhatsApp-style
           viewer (with eye-badge viewer count, retweet, heart/bubble likes,
           profile navigation) only opened if the user then tapped "View
           Status" inside that peek card. That two-step flow is what read as
           "clicking it doesn't open [the status]".
           FIX: a normal tap now opens the full status viewer directly, same
           as WhatsApp. The peek-preview code itself is left fully intact
           (still reachable any time _openPeek() is called) in case it's
           wanted elsewhere later — only the short-tap routing changed. */
        document.addEventListener('pointerdown', function(e){
            var item = e.target.closest && e.target.closest('.status-item');
            if (!item || item.id==='add-my-status-btn') return;
            _ptStart = Date.now();
            _ptIdx   = parseInt(item.dataset.statusIdx, 10);
        });

        document.addEventListener('pointerup', function(e){
            if (_ptIdx < 0) return;
            var item = e.target.closest && e.target.closest('.status-item');
            if (!item || item.id==='add-my-status-btn'){ _ptIdx=-1; return; }
            var idx  = _ptIdx; _ptIdx=-1;
            /* Tap (of any duration that isn't a drag/scroll) → open full
               viewer directly, WhatsApp-style. */
            var su=(window.userStatuses||[])[idx];
            if(su) openStatusViewer(idx);
        });

        /* Peek card buttons */
        document.addEventListener('click', function(e){
            /* Open full viewer from peek */
            if (e.target.closest && e.target.closest('#spk-open-btn')){
                var card=document.getElementById('sv-peek-card');
                var idx2=card?parseInt(card.dataset.idx||'0',10):0;
                _closePeek();
                openStatusViewer(idx2);
                return;
            }
            /* Reply from peek */
            if (e.target.closest && e.target.closest('#spk-reply-btn')){
                if(_isGuest()){_notify('Log in to reply','info');return;}
                var card2=document.getElementById('sv-peek-card');
                var uid=card2?card2.dataset.uid:'';
                _closePeek();
                if(uid) _openChat(uid);
                return;
            }
            /* Close peek on overlay bg */
            if (e.target && e.target.id==='sv-peek-overlay') _closePeek();

            /* "My Status" tile — has two distinct tap targets, matching
               WhatsApp/Facebook:
                 • the small ".status-add-icon" (+) badge → ALWAYS opens the
                   add/compose flow, even if a status already exists.
                 • the rest of the tile (avatar/ring) → views the existing
                   status if one exists, otherwise also opens compose.
               FIX (bug: "+ doesn't open the upload picker"): previously
               the WHOLE tile (avatar AND + badge alike) only opened compose
               for users with zero existing statuses — once you had posted
               once, every tap (including the + badge) just reopened your
               existing status viewer, so + appeared permanently broken
               after the first post. Now the + badge is a dedicated target
               that always reaches the picker, regardless of status count.
               Its "Choose Media" control (#status-file-input in index.html)
               is a real <input type="file" accept="image/*,video/*"
               multiple>, so it correctly triggers the device's native
               photo/video picker — same UI as the reference screenshot;
               that part was already wired, just unreachable via +. */
            if (e.target.closest && e.target.closest('.status-add-icon') && e.target.closest('#add-my-status-btn')){
                e.preventDefault();
                if(_isGuest()){if(typeof window.openAuthModal==='function')window.openAuthModal('login');return;}
                var cmPlus=document.getElementById('create-status-modal');
                if(cmPlus){cmPlus.style.display='flex';cmPlus.classList.add('show');document.body.classList.add('modal-open','status-composer-open');}
                setTimeout(_wireCreateModal,150);
                return;
            }
            if (e.target.closest && (e.target.closest('#add-my-status-btn')||e.target.id==='add-my-status-btn')){
                e.preventDefault();
                if(_isGuest()){if(typeof window.openAuthModal==='function')window.openAuthModal('login');return;}
                var myId=_us().id;
                var my=(window.userStatuses||[]).find(function(s){return s.userId===myId;});
                if(my&&my.items&&my.items.length){
                    var mi=(window.userStatuses||[]).indexOf(my);
                    openStatusViewer(mi>=0?mi:0);
                } else {
                    var cm=document.getElementById('create-status-modal');
                    if(cm){cm.style.display='flex';cm.classList.add('show');document.body.classList.add('modal-open','status-composer-open');}
                    setTimeout(_wireCreateModal,150);
                }
                return;
            }

            /* cancel create-status */
            if (e.target.id==='cancel-status-btn'){
                var csm=document.getElementById('create-status-modal');
                if(csm){csm.style.display='none';csm.classList.remove('show');}
                document.body.classList.remove('modal-open','status-composer-open');
                window._empPendingRemoteStatusMedia=null; /* don't leak a cancelled share into the next open */
            }
        });
    })();


    /* =========================================================================
       §11  CREATE STATUS MODAL
       ========================================================================= */
    /* FIX (2026-08-30 — "Share to Status doesn't move the video to the
       status upload section" / "the composer for commenting needs
       fixing"): three external callers already call
       window._empScrollStatusModalToBottom() right after attaching shared
       media to this composer — app-patch-openchat.js (1:1 chat media →
       status) and app-patch-v13.js, twice (group-chat media → status, and
       the reel "Share to Status" path this session's report is about).
       All three comments say some version of "app-status.js's own
       MutationObserver also does this" — but nothing in this file ever
       actually defined it. Every one of those three calls is guarded with
       typeof==='function', so every single one has been a silent no-op:
       the function has never existed.

       Net effect: .create-status-card is a fixed-height, scrollable card
       (max-height:92vh; overflow-y:auto — index.html). The moment media
       is attached — whether by hand via "Add photos or videos" or
       programmatically via one of the three callers above — the file
       preview thumbnail + upload-progress bar it inserts pushes the Text
       Status textarea (the "comment"/caption composer) and the Post
       Status button further down the card, with nothing to scroll that
       into view. A reel shared to Status landed in the DOM correctly the
       whole time; there was just nothing visible above the fold to prove
       it, and no way to reach the caption box or Post button without
       scrolling manually — indistinguishable from "the video never
       arrived" and "the comment composer is broken", which is exactly
       what was reported.

       Defined here now, and also wired directly into the file-input
       change handler below (not just left for external callers), so the
       ORIGINAL native "Add photos or videos" flow gets the same
       auto-reveal — this was never meant to be Share-to-Status only. */
    function _scrollStatusModalToBottom(){
        var card=document.querySelector('#create-status-modal .create-status-card');
        if(!card)return;
        /* Double rAF: one frame for the preview DOM just inserted to be
           laid out (scrollHeight must reflect the NEW content), a second
           so the scroll doesn't get raced by that same reflow. */
        requestAnimationFrame(function(){
            requestAnimationFrame(function(){
                card.scrollTo({top:card.scrollHeight,behavior:'smooth'});
            });
        });
    }
    window._empScrollStatusModalToBottom=_scrollStatusModalToBottom;

    /* FIX (2026-08-30 follow-up — "shared video doesn't move to the status
       uploader", still reproducing after the modal-opens-first ordering fix
       shipped earlier today in app-patch-v13.js/app-patch-openchat.js):
       confirmed via screenshot that the ordering fix was correct but not
       sufficient — the device in the repro is on a genuinely poor
       connection (console showed sub-1KB/s throughput). Every one of the
       three "Share to Status" callers (reel share, group-chat media,
       1:1-chat media) works by fetch()-ing the ALREADY-HOSTED media URL
       into a Blob, wrapping it in a File, and feeding that File through
       #status-file-input — which means posting shared media to Status
       required downloading the whole file here AND uploading it again on
       "Post Status" (_buildItems -> _uploadFile): the same bytes crossing
       the wire twice. On a connection that slow, that first fetch() can
       take minutes or simply never resolve, which is what actually
       produced the permanently-empty preview box — a network stall, not a
       stacking-context bug this time.

       Since the shared media is already a public, hosted URL (Cloudinary/
       Firebase Storage), there's no need to round-trip it through this
       device at all. This function shows the exact same preview UI
       (thumbnail, duration badge, split-into-parts note, remove button,
       loading/error states) directly against the REMOTE url — a <video>/
       <img> streaming or displaying from that url, never fetched into a
       Blob — and stashes {url,type} on window._empPendingRemoteStatusMedia
       for the "Post Status" submit handler (below) to post AS-IS, skipping
       the second upload entirely. Exposed as
       window._empAttachRemoteStatusMedia so every "Share to Status" caller
       (app-patch-v13.js x2, app-patch-openchat.js) can use it directly
       instead of their own fetch-into-File logic; each keeps that old
       logic only as a fallback for the (much older) app-status.js build
       that doesn't define this function.

       Returns true if the preview was attached, false if the modal/preview
       container isn't in the DOM yet (caller should show its own "still
       loading" notice, same as its existing not-found fallback). */
    /* FEATURE (2026-09-12 — "when a photo/video is selected, open a text
       composer to caption it"): shared by both media-attach paths below
       (the local #status-file-input picker AND _attachRemoteStatusMedia's
       own remote-url path, since Share-to-Status needs the exact same
       caption UX a manually-picked file gets). Folds the now-irrelevant
       Quote/Meme tabs and the background-colour cycler out of the tab row
       (see #create-status-modal.csm-media-active in _injectStyles() —
       Quote/Meme post with no caption anyway, see the Post-button
       handler's _csmMode checks), forces the composer onto the Text tab
       (the only one a real photo/video actually posts through), swaps
       the placeholder so it plainly reads as a caption field instead of
       a generic status, and focuses it so typing can start right away. */
    function _csmSetMediaCaptionMode(active){
        var modalEl=document.getElementById('create-status-modal');
        if(modalEl) modalEl.classList.toggle('csm-media-active',active);
        var txtEl=document.getElementById('status-text-input');
        if(!txtEl)return;
        if(active){
            if(typeof window._empCsmResetModeTabs==='function') window._empCsmResetModeTabs();
            txtEl.placeholder='Add a caption\u2026';
            _csmAutoGrow(txtEl);
            setTimeout(function(){txtEl.focus();_csmAutoGrow(txtEl);},250);
        } else {
            txtEl.placeholder="What's on your mind?";
            txtEl.style.height=''; /* back to the sheet's own fixed-size canvas */
        }
    }

    /* FEATURE (2026-10-17 — "as the user types and the text increases, the
       composer should increase"): in media mode the caption pill sizes to
       its content (up to ~38% of the screen, then scrolls inside itself)
       instead of being a fixed 5-row box. Only active in media mode —
       the Text-tab canvas keeps its own full-height behaviour. */
    function _csmAutoGrow(ta){
        var modalEl=document.getElementById('create-status-modal');
        if(!ta||!modalEl||!modalEl.classList.contains('csm-media-active')) return;
        ta.style.height='auto';
        var max=Math.round(window.innerHeight*0.38);
        ta.style.height=Math.max(24,Math.min(ta.scrollHeight,max))+'px';
    }
    document.addEventListener('input',function(e){
        if(e.target&&e.target.id==='status-text-input') _csmAutoGrow(e.target);
    });

    function _attachRemoteStatusMedia(url, mediaType){
        if(!url) return false;
        _wireCreateModal(); /* idempotent — make sure change/cancel/etc. are wired even though we bypass the file input itself */
        var prev=document.getElementById('status-file-preview')||document.getElementById('cs-file-preview');
        if(!prev) return false;

        prev.innerHTML='';
        prev.style.display='block';
        prev.classList.remove('cs-media-failed');
        prev.classList.add('cs-loading');
        _csmSetMediaCaptionMode(true);

        var isVid = mediaType ? String(mediaType).indexOf('video')===0 : /\.(mp4|mov|webm|m4v|3gp)(\?|#|$)/i.test(url);
        var mEl=document.createElement(isVid?'video':'img');
        var _settle=function(){prev.classList.remove('cs-loading');mEl.classList.add('cs-media-in');};

        /* Longer than the local-file timeout (6s) below — a REMOTE url still
           has to actually load over whatever connection is available, which
           can legitimately take longer than decoding an already-local blob,
           especially on the kind of connection that made this fix necessary
           in the first place. */
        var _settleTimer=setTimeout(function(){ _settleFailed(); },20000);
        function _clearSettleTimer(){ clearTimeout(_settleTimer); }
        function _settleFailed(){
            _clearSettleTimer();
            if(mEl.classList.contains('cs-media-in'))return;
            prev.classList.remove('cs-loading');
            prev.classList.add('cs-media-failed');
            var errMsg=document.createElement('div');errMsg.className='cs-media-error';
            errMsg.innerHTML='<i class="fas fa-triangle-exclamation"></i> Couldn\u2019t load this '+(isVid?'video':'photo')+' \u2014 remove and try again.';
            prev.appendChild(errMsg);
        }
        mEl.addEventListener('error',_settleFailed);
        if(isVid){
            /* FIX (2026-08-30 — shared reel video shows "Couldn't load this
               video" in the Status composer preview): crossOrigin='anonymous'
               forced this <video> into a CORS-gated fetch. This preview only
               ever plays the video back (no canvas/pixel access happens
               here) — playback itself never needs CORS headers, only
               pixel-level reads do. The exact same reel video URL plays
               fine with NO crossOrigin attribute at all inside the reel
               viewer itself (_buildReelViewerItem() in app-reel.js),
               confirming the host doesn't need to be asked for CORS for
               this to play — asking for it here just meant a host that
               doesn't happen to return a matching Access-Control-Allow-
               Origin header for its video responses made the whole load
               fail outright instead of playing normally. Removed; the
               image branch below never set this either. */
            mEl.muted=true;mEl.autoplay=false;mEl.controls=true;mEl.playsInline=true;mEl.preload='metadata';
            mEl.addEventListener('loadedmetadata',function(){
                _clearSettleTimer();
                try{mEl.currentTime=0.1;}catch(err){}
                var dur=mEl.duration;
                var db=document.createElement('div');db.className='cs-dur';db.textContent=_fmtDur(dur);prev.appendChild(db);
                if(dur>MAX_VID_S){var sn=document.createElement('div');sn.className='cs-split';sn.innerHTML='<i class="fas fa-cut"></i> '+Math.ceil(dur/MAX_VID_S)+' parts';prev.appendChild(sn);}
                _settle();
            });
        } else {
            mEl.addEventListener('load',function(){_clearSettleTimer();_settle();});
        }
        prev.insertBefore(mEl,prev.firstChild); /* inserted BEFORE src is set — see the same fix on the local-file path below */
        mEl.src=url;

        var rm=document.createElement('button');rm.type='button';rm.className='cs-rm-btn';rm.innerHTML='<i class="fas fa-times"></i>';
        rm.addEventListener('click',function(e2){
            e2.preventDefault();e2.stopPropagation();_clearSettleTimer();
            window._empPendingRemoteStatusMedia=null;
            prev.innerHTML='';prev.style.display='none';prev.classList.remove('cs-loading','cs-media-failed');
            _csmSetMediaCaptionMode(false);
        });
        prev.appendChild(rm);

        /* A remote share supersedes any local file previously picked (and
           vice versa — see the file-input 'change' handler below, which
           clears this same field the moment a real local file is chosen). */
        var fileInp=document.getElementById('status-file-input');
        if(fileInp) fileInp.value='';
        window._empPendingRemoteStatusMedia={url:url,type:isVid?'video':'image'};

        _scrollStatusModalToBottom();
        return true;
    }
    window._empAttachRemoteStatusMedia=_attachRemoteStatusMedia;

    function _wireCreateModal(){
        var modal=document.getElementById('create-status-modal');
        if(!modal||modal._v4Wired)return;
        modal._v4Wired=true;

        var cancelBtn=document.getElementById('cancel-status-btn');
        if(cancelBtn&&!cancelBtn._v4){cancelBtn._v4=true;
            cancelBtn.addEventListener('click',function(){modal.style.display='none';modal.classList.remove('show');document.body.classList.remove('modal-open','status-composer-open');window._empPendingRemoteStatusMedia=null;_csmSetMediaCaptionMode(false);});
        }

        /* FEATURE — Quote/Meme Card for Status. Reuses the exact same
           drawing/composer engine window.EmpQuoteCard (defined in
           app-fixes.js) already used by Quick Post and the profile
           composer — see those two files' own call sites for the
           established pattern this mirrors. The one difference here:
           neither of those composers' own media arrays exist for Status
           (this modal's "Photos & Videos" control reads straight off the
           native #status-file-input's own FileList — no separate JS
           array — see the fileInp 'change' handler below), so instead of
           pushing into an array, the finished card File is injected
           directly into that same input via DataTransfer and a synthetic
           'change' event is dispatched — which runs through the exact
           same preview/upload code path a manually-picked file already
           does, with nothing duplicated here.

           FIX (2026-09-12 — "quote and meme card is missing"): this was
           never actually missing — window.EmpQuoteCard.open() below was
           firing correctly, but the overlay it opens rendered BEHIND this
           modal because #create-status-modal's injected z-index (999999,
           see _injectStyles() below) was higher than the overlay's old
           z-index (100000). Fixed at the source in app-fixes.js (the
           overlay is now z-index:1000001) rather than by routing this
           button anywhere else, so it re-opens the full card composer —
           colors, signature, drag position — the same as before. */
        var quoteBtn=document.getElementById('status-quote-card-btn');
        if(quoteBtn&&!quoteBtn._v4){quoteBtn._v4=true;
            quoteBtn.addEventListener('click',function(){
                if(!window.EmpQuoteCard){
                    _notify('Quote Card composer isn\u2019t ready yet — try again in a moment.','warning');
                    return;
                }
                window.EmpQuoteCard.open(function(file,quoteText){
                    var fi=document.getElementById('status-file-input');
                    if(!fi) return;
                    /* A quote card supersedes any previously-attached
                       remote share, same as picking a real local file
                       already does a few lines below. */
                    window._empPendingRemoteStatusMedia=null;
                    var dt=new DataTransfer();
                    dt.items.add(file);
                    fi.files=dt.files;
                    fi.dispatchEvent(new Event('change',{bubbles:true}));
                    var txtEl=document.getElementById('status-text-input');
                    if(txtEl&&!txtEl.value.trim()) txtEl.value=quoteText;
                });
            });
        }

        /* FIX (2026-09-12 — "font text change isn't working" / "exclude
           contacts button doesn't work"): both those controls are wired
           much further down this same function (color/font/emoji tool
           rail, audience selector + "Hide from…" contact picker) — but
           this line used to `return` the ENTIRE function the moment
           #status-file-input wasn't found yet. Since modal._v4Wired is
           set true at the very top (before this check even runs) and is
           what permanently blocks _wireCreateModal from ever running
           again (see the top of this function), a single early call that
           lost this race — e.g. this script executing before index.html
           had finished parsing the rest of the composer markup — meant
           NOTHING below this point (submit button, audience/except
           picker, colour cycle, font cycle, emoji, mode tabs) ever got
           wired for the lifetime of the page, not just the file input
           itself. Restructured: only the file-input-SPECIFIC wiring
           below (the "choose media" click delegate and the fileInp
           'change' listener) is now skipped when it's missing — every
           other control in this modal wires unconditionally either way,
           so a missing/late file input can no longer silently disable
           the rest of the composer. */
        var fileInp=document.getElementById('status-file-input');
        if(fileInp){

        /* FIX (bug: "Choose Media button does nothing — no file picker
           opens"): index.html's visible "Choose Media" control was never
           actually wired to trigger the real (likely visually-hidden)
           #status-file-input — nothing in app-status.js called .click() on
           it in response to a tap. The only existing listener here was
           'change' on the input itself, which only fires AFTER a file is
           already chosen — useless if nothing ever opens the picker in the
           first place. FIX: delegate clicks anywhere inside this modal and
           explicitly forward them to fileInp.click() whenever the tapped
           element looks like the media-choosing control — covers a
           <label for="status-file-input">, a button with a recognizable
           id/class, or a data-action attribute — without needing to know
           index.html's exact markup. Skips the real file input itself (a
           native click on it already works) and the other real controls in
           this modal (cancel/post/color-cycle/textarea) so this never
           double-fires or steals their taps. */
        if(!modal._v4ChooseMediaWired){
            modal._v4ChooseMediaWired=true;
            modal.addEventListener('click',function(e){
                /* FIX (bug: "uploading photo/video kicks me out of the
                   gallery, have to try several times"): '[for="status-file-input"]'
                   was in this selector, so a tap on the real
                   <label for="status-file-input"> (#status-media-fab in
                   index.html) matched here too. Its native label→input
                   behaviour ALREADY opens the picker with no JS — this
                   handler then called safeFileClick() on top of that,
                   firing the OS picker twice on one tap and causing it to
                   flash open/close, needing repeated taps. Removed so this
                   only re-triggers custom buttons that aren't real
                   <label for="status-file-input"> elements. */
                var t=e.target.closest&&e.target.closest(
                    '#status-choose-media-btn,#choose-media-btn,#cs-choose-media-btn,'+
                    '.status-choose-media,.cs-choose-media,'+
                    '[data-action="choose-media"],[data-target="status-file-input"]'
                );
                if(!t){
                    /* Catch-all: index.html's exact markup/id for this
                       button is unknown, so as a last resort match on its
                       visible label text. Walk up from the click target to
                       the nearest clickable ancestor (button/label/div with
                       a click affordance) within this modal and check its
                       own text — not its full subtree — so this can't
                       accidentally match a large wrapping container. */
                    var cand=e.target.closest&&e.target.closest('button,label,[role="button"],a,div');
                    while(cand && modal.contains(cand)){
                        var ownText=(cand.textContent||'').trim().toLowerCase();
                        if(ownText==='choose media'||ownText==='choose file'||ownText==='select media'){ t=cand; break; }
                        cand=cand.parentElement;
                    }
                }
                if(!t)return;
                if(t.id==='status-file-input')return; // native input — already works on its own
                e.preventDefault();
                safeFileClick(fileInp);
            });
        }

        /* FIX (2026-09-12 — "fix the broken send button"): this listener
           had NO idempotency guard of its own (unlike cancelBtn/quoteBtn/
           subBtn/cycleBtn/audienceSel just above and below, which all use
           a per-element ._v4/._v5 flag). It relied entirely on the outer
           `if(!modal||modal._v4Wired)return;` at the very top of
           _wireCreateModal to only ever run once — but the Post-status
           submit handler below deliberately resets modal._v4Wired=false
           after every successful post (so a few other one-time setup
           steps can re-run cleanly next time the composer opens). That
           reset also let this ENTIRE function run again on the next open,
           re-adding a SECOND 'change' listener on the same never-replaced
           #status-file-input element — a third after the next post, and
           so on. Each stacked listener re-ran the full preview-build +
           _scrollStatusModalToBottom() logic below on every subsequent
           media pick, corrupting #status-file-preview (duplicate <img>/
           <video>/remove-button/progress-bar nodes layered on top of each
           other) and leaving stale references (e.g. old `prev`/`rm`
           closures still pointing at nodes from a previous open) that
           made the composer's Post button appear to do nothing or post
           the wrong media after the first successful status. Guarded the
           same way every sibling listener already is — attaches once,
           permanently, regardless of how many times modal._v4Wired gets
           reset — since this handler already reads fileInp.files and the
           DOM live at fire-time and needs no re-binding to pick up a
           freshly-reopened modal. */
        if(!fileInp._v4Wired){
        fileInp._v4Wired=true;
        fileInp.addEventListener('change',function(){
            /* A real local file just got picked by hand — it supersedes any
               previously-attached remote share (see _attachRemoteStatusMedia
               above), so the submit handler doesn't mistakenly post the old
               remote url instead of (or alongside) this new local pick. */
            window._empPendingRemoteStatusMedia=null;
            /* Guard: Android double-fires change after gallery close */
            var _files=Array.from(fileInp.files||[]);
            if(_files.length){
                var _sig=_files.map(function(f){return f.name+f.size+f.lastModified;}).join('|');
                if(fileInp._lastChangeSig===_sig) return;
                fileInp._lastChangeSig=_sig;
            }
            var prev=document.getElementById('status-file-preview')||document.getElementById('cs-file-preview');
            if(!prev)return;
            prev.innerHTML='';
            var files=_files;
            if(!files.length){prev.style.display='none';prev.classList.remove('cs-loading');_csmSetMediaCaptionMode(false);return;}
            prev.style.display='block';
            prev.classList.add('cs-loading');
            _csmSetMediaCaptionMode(true);

            /* Upload progress bar (+ live percentage label — ADDED 2026-08-10) */
            var progWrap=document.createElement('div');progWrap.className='cs-upload-progress';
            var progBar=document.createElement('div');progBar.className='cs-upload-bar';
            progWrap.appendChild(progBar);
            prev.appendChild(progWrap);
            var progPct=document.createElement('div');progPct.className='cs-upload-pct';progPct.textContent='0%';
            prev.appendChild(progPct);

            var first=files[0],isVid=first.type.startsWith('video/'),burl=URL.createObjectURL(first);
            var mEl=document.createElement(isVid?'video':'img');
            var _settle=function(){prev.classList.remove('cs-loading');mEl.classList.add('cs-media-in');};
            /* FIX (2026-08-30 — "shared video doesn't move to the status
               uploader"): two real gaps, either of which leaves this box
               stuck exactly as reported — a solid, empty shimmer box that
               never resolves, with no video visible and no error shown:
                 1) mEl.src used to be set BEFORE mEl was inserted into the
                    DOM (insertBefore happened 14 lines later). Some
                    mobile/WebView engines are inconsistent about starting
                    — or ever firing readystate/metadata events for — a
                    media element's resource fetch while it's still
                    detached from the document. Now inserted first, src
                    set after, so this can never depend on that ordering
                    again.
                 2) there was no 'error' handler on the video/img at all,
                    and no timeout fallback. If the blob URL ever fails to
                    decode (bad codec/container, or the browser simply
                    never fires loadedmetadata for some reason), _settle()
                    was never called by ANY path — the shimmer stayed on
                    screen indefinitely, with no video, no error, nothing
                    to click. Both cases now covered: an explicit error
                    handler shows a clear failure state instead of hanging
                    forever, and a 6s safety timeout calls _settle() (with
                    a visible fallback if metadata never resolved) so this
                    can never spin silently forever even if some future,
                    unknown failure mode reaches neither 'load'/
                    'loadedmetadata' nor 'error'. */
            var _settleTimer=setTimeout(function(){ _settleFailed(); },6000);
            function _clearSettleTimer(){ clearTimeout(_settleTimer); }
            function _settleFailed(){
                _clearSettleTimer();
                if(mEl.classList.contains('cs-media-in'))return; /* already succeeded — timer lost the race, ignore */
                prev.classList.remove('cs-loading');
                prev.classList.add('cs-media-failed');
                var errMsg=document.createElement('div');errMsg.className='cs-media-error';
                errMsg.innerHTML='<i class="fas fa-triangle-exclamation"></i> Couldn\u2019t load this '+(isVid?'video':'photo')+' \u2014 remove and try again.';
                prev.appendChild(errMsg);
            }
            mEl.addEventListener('error',_settleFailed);
            if(isVid){
                mEl.muted=true;mEl.autoplay=false;mEl.controls=true;mEl.playsInline=true;mEl.preload='metadata';
                mEl.addEventListener('loadedmetadata',function(){
                    _clearSettleTimer();
                    try{mEl.currentTime=0.1;}catch(err){}
                    var dur=mEl.duration;
                    var db=document.createElement('div');db.className='cs-dur';db.textContent=_fmtDur(dur);prev.appendChild(db);
                    if(dur>MAX_VID_S){var sn=document.createElement('div');sn.className='cs-split';sn.innerHTML='<i class="fas fa-cut"></i> '+Math.ceil(dur/MAX_VID_S)+' parts';prev.appendChild(sn);}
                    _settle();
                });
            } else {
                mEl.addEventListener('load',function(){_clearSettleTimer();URL.revokeObjectURL(burl);_settle();});
            }
            prev.insertBefore(mEl,prev.firstChild);
            mEl.src=burl; /* set AFTER insertion — see FIX note above */

            var rm=document.createElement('button');rm.type='button';rm.className='cs-rm-btn';rm.innerHTML='<i class="fas fa-times"></i>';
            rm.addEventListener('click',function(e2){e2.preventDefault();e2.stopPropagation();_clearSettleTimer();fileInp.value='';prev.innerHTML='';prev.style.display='none';prev.classList.remove('cs-loading','cs-media-failed');try{URL.revokeObjectURL(burl);}catch(ex){}_csmSetMediaCaptionMode(false);});
            prev.appendChild(rm);

            if(files.length>1){var cb2=document.createElement('div');cb2.className='cs-more-chip';cb2.textContent='+'+( files.length-1)+' more';prev.appendChild(cb2);}

            /* FIX (2026-08-30) — see _scrollStatusModalToBottom's own
               header above: reveal the Text Status composer + Post Status
               button now that the preview above them just grew, for the
               native "Add photos or videos" flow too (not just the three
               external Share-to-Status-style callers). */
            _scrollStatusModalToBottom();
        });
        } /* end if(!fileInp._v4Wired) — see FIX comment above */
        } /* FIX (2026-09-13 — "font text change isn't working" / "exclude
             contacts button doesn't work", still broken): the 2026-09-12
             restructure above documented that only the file-input-SPECIFIC
             wiring (the "choose media" click delegate and this fileInp
             'change' listener) should stay inside `if(fileInp){`, with
             everything else in this function — colour cycle, font cycle,
             audience/except picker, submit button, _wireCsmModeTabs(),
             _wireCsmToolRail() — wiring unconditionally either way. The
             comment was written but the matching closing brace for
             `if(fileInp){` (opened above, near the top of this function)
             was never actually added, so every one of those controls was
             STILL nested inside `if(fileInp)` and silently skipped on any
             run where #status-file-input wasn't found yet — exactly the
             same race the 09-12 fix thought it had already closed. This
             brace is that missing fix: it now closes `if(fileInp)` right
             here, immediately after the file-input-specific listener, so
             the colour/font cyclers, the audience "Hide from…" contact
             picker, and the rest of the composer's wiring run every time
             regardless of the file input's readiness. (This also fixes a
             file-wide brace imbalance that made app-status.js fail to
             parse at all — see the "})();" at the very end of this file.) */

        /* colour cycler — WhatsApp-style: one button cycles through the
           gradient set, applied live to #status-text-wrap (the textarea's
           own background IS the preview, no separate swatch grid). */
        var textWrap = document.getElementById('status-text-wrap');
        var cycleBtn  = document.getElementById('status-color-cycle-btn');
        /* FIX (2026-09-12 — "enable the combination of both primary colors
           and gradient, so users can choose"): this cycle used to be
           gradients only. Rather than add a second control (the rail only
           has room for the four tools already in the screenshot reference),
           the app's own primary brand solids — Deep Space Navy, Royal Blue,
           Emerald Teal, Bright Gold, from token.css — are interleaved into
           the SAME cycle, so one tap of the palette button now moves
           through both solid and gradient backgrounds. token.css/style.css
           are left untouched, per the never-edit-those-directly rule; the
           hexes are just referenced here as plain background values. */
        /* Note: the composer's text is fixed white (.csm-text-input, color:#fff)
           so only solids dark/saturated enough to keep that legible are
           mixed in — Bright Gold (#FFD500) was left out of this list for
           that reason, unlike the other three brand colors below. */
        /* FIX (2026-09-15 — "make provision for primary color for the
           color section scheme"): the hardcoded '#1B2B8B' entry below was
           a plain hex duplicate of the app's actual primary brand color,
           not a real reference to it — if --primary-color ever changes,
           this swatch silently stops matching. Swapped for a genuine
           var(--primary-color) reference (falls back to the same hex),
           and moved to index 0 so it's also what the composer's canvas
           defaults to on open — a plain primary-color fill instead of a
           gradient, matching the same "plain primary color instead of
           gradient" change just made to .csm-card's own background above. */
        /* FIX (2026-10-17 — "change the status background colour to black
           instead of blue"): index 0 (the composer's default canvas) is now
           black, and .csm-card's own sheet background is black too (see its
           rule above). The brand blue stays in the cycle (after pink) so it
           is still one of the choices, just no longer the default.
           PREVIOUS: "expand the colour options, include primary colours
           (red, blue, yellow, green, etc.)"): plain, saturated solid primaries
           added right after the brand default so they're a few taps away
           instead of buried after the gradients. Yellow/orange switch the
           composer text to dark for legibility (see _stTextColor). */
        var bgs=['#000000','#E53935','#1E88E5','#FDD835','#43A047','#FB8C00','#8E24AA','#D81B60','var(--primary-color,#1B2B8B)','linear-gradient(135deg,#0A0E27,#1B2B8B)','#0A0E27','linear-gradient(135deg,#7F1D1D,#EF4444)','linear-gradient(135deg,#064E3B,#10B981)','#00D4AA','linear-gradient(135deg,#1E1B4B,#6D28D9)','linear-gradient(135deg,#0C4A6E,#38BDF8)','linear-gradient(135deg,#78350F,#F59E0B)','linear-gradient(135deg,#831843,#EC4899)','linear-gradient(135deg,#1A1A2E,#E94560)','linear-gradient(135deg,#134E4A,#5EEAD4)','linear-gradient(135deg,#1F2937,#6EE7B7)'];
        var bgIdx=0;
        var selBg=bgs[0];
        /* FEATURE (2026-10-17 — "make the status background auto change
           colour anytime a user opens it"): the composer's canvas used to
           open on the same colour every time. _csmApplyBg() is the one place
           that sets the colour + the matching light/dark text class, and
           _csmRandomizeBg() picks a random entry from the same palette the
           palette button cycles through (never the same one twice in a
           row). It is exposed as window._empCsmRandomizeBg ONLY from the
           first wiring, because that first closure permanently owns the
           palette-button and Post-button handlers below (both guarded by
           ._v4 so they are never re-attached) — so its selBg is the one
           that actually gets posted. A MutationObserver on the modal (set
           up once) calls it every time the composer goes from hidden to
           shown, which covers every open path (the + badge, the avatar
           tap, and the external Share-to-Status callers) without touching
           any of them. */
        function _csmApplyBg(i){
            bgIdx=i; selBg=bgs[i];
            if(textWrap){ textWrap.style.background=selBg; textWrap.classList.toggle('csm-light-bg',_stTextColor(selBg)!=='#fff'); }
            /* the sheet itself (.csm-card) takes the colour too — that is the "black background" that now changes on every open. Media-caption mode forces it back to black via !important in its own CSS. */
            var cardEl=modal.querySelector('.csm-card');
            if(cardEl) cardEl.style.background=selBg;
        }
        function _csmRandomizeBg(){
            var n=bgs.length,i=Math.floor(Math.random()*n);
            if(n>1&&i===bgIdx) i=(i+1+Math.floor(Math.random()*(n-1)))%n;
            _csmApplyBg(i);
            window._empCsmBgAt=Date.now();
        }
        if(cycleBtn&&!cycleBtn._v4){cycleBtn._v4=true;
            window._empCsmRandomizeBg=_csmRandomizeBg;
            cycleBtn.addEventListener('click',function(e){
                e.preventDefault();
                _csmApplyBg((bgIdx+1)%bgs.length);
                cycleBtn.style.transform='scale(0.85)';
                setTimeout(function(){cycleBtn.style.transform='';},120);
            });
        }
        /* pick the colour for THIS open — unless the show-observer below
           already did within the last 1.5s (a re-wire right after a post
           runs ~150ms after the composer re-opens; re-rolling then would
           make the colour visibly flicker). */
        if(typeof window._empCsmRandomizeBg==='function'){
            if(!window._empCsmBgAt||Date.now()-window._empCsmBgAt>1500) window._empCsmRandomizeBg();
        } else if(textWrap){ textWrap.style.background=selBg; }
        if(!modal._empBgObs&&typeof MutationObserver!=='undefined'){
            modal._empBgWasOpen=modal.classList.contains('show');
            modal._empBgObs=new MutationObserver(function(){
                var open=modal.classList.contains('show');
                if(open&&!modal._empBgWasOpen&&typeof window._empCsmRandomizeBg==='function') window._empCsmRandomizeBg();
                modal._empBgWasOpen=open;
            });
            modal._empBgObs.observe(modal,{attributes:true,attributeFilter:['class']});
        }

        /* FIX (2026-09-12 — "block or filter posts from selected contacts" /
           "media restrictions ... like WhatsApp"): #status-audience existed
           in the markup but nothing in this file ever read its value, so
           every status posted as visible to everyone regardless of what was
           picked. Wired here: the select drives visibility of the new
           #status-except-btn, which opens a contact-exclude sheet; both the
           chosen audience and (for "except") the excluded ids are read at
           submit time below and saved on the status document. Actual
           enforcement for OTHER people's statuses happens where those
           documents are consumed — see the matching fix in app-fixes.js's
           statuses onSnapshot listener. */
        var audienceSel=document.getElementById('status-audience');
        var exceptBtn=document.getElementById('status-except-btn');
        var _csmExcludedIds=[];
        function _csmUpdateExceptVisibility(){
            if(exceptBtn) exceptBtn.hidden=(!audienceSel||audienceSel.value!=='except');
        }
        if(audienceSel&&!audienceSel._v5Wired){audienceSel._v5Wired=true;
            audienceSel.addEventListener('change',function(){
                _csmUpdateExceptVisibility();
                if(audienceSel.value==='except'&&exceptBtn) exceptBtn.click();
                if(audienceSel.value==='close') _notify('Close Friends uses your Followers list for now — a dedicated close-friends list is planned','info');
            });
        }
        _csmUpdateExceptVisibility();
        if(exceptBtn&&!exceptBtn._v5Wired){exceptBtn._v5Wired=true;
            exceptBtn.addEventListener('click',function(e){
                e.preventDefault();
                _csmOpenExceptSheet(_csmExcludedIds,function(ids){
                    _csmExcludedIds=ids||[];
                    exceptBtn.innerHTML='<i class="fas fa-user-slash"></i>&nbsp;Hidden from '+_csmExcludedIds.length;
                });
            });
        }

        /* submit */
        var subBtn=document.getElementById('post-status-btn');
        if(subBtn&&!subBtn._v4){subBtn._v4=true;
            subBtn.addEventListener('click',async function(e){
                e.preventDefault();
                if(_isGuest()){_notify('Log in to post a status','info');return;}
                var txtEl2=document.getElementById('status-text-input');
                var txt=(txtEl2?txtEl2.value.trim():'');
                var fi2=document.getElementById('status-file-input');
                var files=fi2?Array.from(fi2.files||[]):[];
                /* FIX (2026-08-30 follow-up — see _attachRemoteStatusMedia's
                   header above): a reel/chat/group "Share to Status" leaves
                   the media attached as a REMOTE url (window.
                   _empPendingRemoteStatusMedia), not a local File — #status-
                   file-input.files is legitimately empty in that case, so
                   the old `!files.length` half of this guard alone would
                   incorrectly block posting a shared video with no caption. */
                var pendingRemote=window._empPendingRemoteStatusMedia;

                /* FEATURE (Text/Quote/Meme mode tabs, see _wireCsmModeTabs
                   below): whichever tab is active at the moment Post is
                   tapped decides what actually gets posted, overriding the
                   plain-text-tab reads just above. Quote composes the quote
                   + author into the same `txt` this function already posts
                   as a text status (no new backend field); Meme posts the
                   currently-shown meme through the SAME remote-media path
                   `_attachRemoteStatusMedia`/"Share to Status" already use
                   (`window._empPendingRemoteStatusMedia`) — nothing new for
                   the submit/upload logic below to learn either way. */
                var _csmMode=modal.getAttribute('data-csm-mode')||'text';
                if(_csmMode==='quote'){
                    var _qtEl=document.getElementById('status-quote-text'),_qaEl=document.getElementById('status-quote-author');
                    var _qt=(_qtEl?_qtEl.textContent:'').replace(/^[\u201C"]+|[\u201D"]+$/g,'').trim();
                    var _qa=(_qaEl?_qaEl.textContent:'').trim();
                    txt=_qt+(_qa?('\n'+_qa):'');
                    selBg=window._empCsmQuoteBg||selBg;
                    files=[];pendingRemote=null;window._empPendingRemoteStatusMedia=null;
                    if(fi2)fi2.value='';
                } else if(_csmMode==='meme'){
                    var _memeImgEl=document.getElementById('status-meme-img');
                    if(_memeImgEl&&_memeImgEl.src){pendingRemote={url:_memeImgEl.src,type:'image'};window._empPendingRemoteStatusMedia=pendingRemote;}
                    txt='';files=[];
                    if(fi2)fi2.value='';
                } else if(_csmMode==='voice'){
                    /* FEATURE (2026-09-13 — "add voice note as a feature"):
                       the recorded take lives in _csmVoiceFile (a plain
                       File, set by _wireCsmVoice's recorder 'stop' handler)
                       — nothing to read from the DOM here, same shape as
                       Quote/Meme above swapping in their own source before
                       falling through to the shared upload/post logic. Any
                       caption typed is irrelevant in this tab (Voice has no
                       text field), so txt is cleared like Meme's. */
                    files=[];pendingRemote=null;window._empPendingRemoteStatusMedia=null;
                    if(fi2)fi2.value='';
                } else if(_csmMode==='election'){
                    /* FEATURE/FIX (2026-09-22 — Election tab, see
                       _wireCsmModeTabs's "Election tab" block above for the
                       full bug writeup): the composited "I Support ___"
                       card isn't ready synchronously (needs canvas.toBlob()
                       + an upload), so — like Voice above — this only
                       clears the plain-text/file inputs here; the actual
                       async upload happens in the try block below,
                       gated on _csmElectionGetState() having both a
                       candidate AND a photo. */
                    txt='';files=[];pendingRemote=null;window._empPendingRemoteStatusMedia=null;
                    if(fi2)fi2.value='';
                }
                var _csmElectionState=(_csmMode==='election'&&typeof window._csmElectionGetState==='function')?window._csmElectionGetState():null;
                var _csmElectionReady=!!(_csmElectionState&&_csmElectionState.candidate&&_csmElectionState.photo);
                if(!txt&&!files.length&&!pendingRemote&&!(_csmMode==='voice'&&_csmVoiceFile)&&!(_csmMode==='election'&&_csmElectionReady)){_notify(_csmMode==='voice'?'Record a voice note first':_csmMode==='election'?'Pick a candidate and add your photo first':'Add text or media first','warning');return;}
                subBtn.disabled=true;subBtn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Posting…';
                /* FIX (upload progress bar never moved): .cs-upload-bar was
                   created on file-select but its width was never updated
                   anywhere, and it lived in a different closure than the
                   actual upload call, so the two were never connected.
                   Look it up live here and drive it from real XHR progress
                   events forwarded out of _buildItems → _uploadFile. */
                var progBarEl=document.querySelector('.cs-upload-bar');
                var progPctEl=document.querySelector('.cs-upload-pct');
                if(progPctEl) progPctEl.classList.add('cs-show');
                var onUploadProgress=function(fileIdx,totalFiles,pct){
                    var overall=Math.min(Math.round(((fileIdx+(pct/100))/totalFiles)*100),100);
                    if(progBarEl) progBarEl.style.width=overall+'%';
                    if(progPctEl) progPctEl.textContent=(totalFiles>1?(fileIdx+1)+'/'+totalFiles+' — ':'')+overall+'%';
                };
                try{
                    /* Shared media already lives at a public, hosted url —
                       post it directly instead of re-uploading (see
                       _attachRemoteStatusMedia's header above for why this
                       matters on a poor connection). Any locally-picked
                       files (rare to have both, but not impossible if the
                       person also tapped "Add photos or videos" — the
                       'change' handler above only clears pendingRemote for
                       NEW picks, this branch still honours whichever is
                       actually current) still go through the normal upload
                       path. */
                    var newItems;
                    if(pendingRemote){
                        newItems=[_mkItem(pendingRemote.type, pendingRemote.url, txt, selBg)];
                    } else if(_csmMode==='voice'&&_csmVoiceFile){
                        /* Voice notes go through the exact same _uploadFile()
                           → window.uploadToCloudinary() (now Firebase
                           Storage, see the header comment on _uploadFile
                           above) path every other status media type uses —
                           just skipping _buildItems() since there's only
                           ever one voice take, not a files[] array to loop
                           over. */
                        _notify('Uploading voice note…','info');
                        var _vurl=await _uploadFile(_csmVoiceFile,'audio',function(pct){onUploadProgress(0,1,pct);});
                        if(!_vurl){_notify('Voice upload failed','error');return;}
                        newItems=[_mkItem('voice',_vurl,'',selBg,{duration:_csmVoiceDuration||0})];
                    } else if(_csmMode==='election'&&_csmElectionReady){
                        /* Same upload path as Voice/Quote/Meme above,
                           except the "file" doesn't exist until the
                           candidate+photo composite is rasterized off
                           #status-election-canvas. The raw photo the
                           person picked is discarded once composited —
                           only the finished branded card is ever
                           uploaded/posted, matching the Quick Post
                           Election modal's own save/share output. */
                        _notify('Preparing your card…','info');
                        var _eBlob=await window._csmElectionCanvasToBlob();
                        if(!_eBlob){_notify('Could not prepare your card — try again.','error');return;}
                        var _eFile=new File([_eBlob],'election-support-'+Date.now()+'.png',{type:'image/png'});
                        var _eurl=await _uploadFile(_eFile,'image',function(pct){onUploadProgress(0,1,pct);});
                        if(!_eurl){_notify('Card upload failed','error');return;}
                        newItems=[_mkItem('image',_eurl,'I support '+_csmElectionState.candidate.name+' #Vote2027',selBg)];
                    } else {
                        newItems=await _buildItems(files,txt,selBg,onUploadProgress);
                    }
                    if(progBarEl) progBarEl.style.width='100%';
                    if(progPctEl) progPctEl.textContent='100%';
                    if(!newItems.length){_notify('Nothing to post','warning');return;}
                    /* Attach the picked music-library preset (if any) as a
                       plain label — same "no audio asset, just a chosen
                       name" data shape app-reel.js already stores on
                       window._empReelSelectedSound, kept separate here. */
                    if(window._empStatusSelectedSoundLabel){
                        newItems.forEach(function(it){it.soundLabel=window._empStatusSelectedSoundLabel;});
                    }
                    var us2=_us();
                    var docId='status-'+us2.id;
                    if(!window.userStatuses)window.userStatuses=[];
                    var ei=window.userStatuses.findIndex(function(s){return s.userId===us2.id;});
                    /* FIX (point #4: "previous status disappears when a new
                       one is uploaded"): the prior write here replaced the
                       entire status document/array entry with a brand-new
                       `items` array containing ONLY the just-uploaded media —
                       every earlier still-live item was lost. Now: start from
                       whatever live (non-expired) items already exist for
                       this user and APPEND the new ones, exactly like
                       WhatsApp/Instagram multi-segment stories. */
                    var existingDoc = ei>-1 ? window.userStatuses[ei] : null;
                    var keptItems   = existingDoc ? _liveItems(existingDoc) : [];
                    var mergedItems = keptItems.concat(newItems);
                    var _csmAudience=(audienceSel&&audienceSel.value)||'everyone';
                    var doc={userId:us2.id,name:us2.fullName||us2.username||'User',avatar:us2.avatar||'',items:mergedItems,viewed:false,createdAt:(existingDoc&&existingDoc.createdAt)||new Date().toISOString(),docId:docId,audience:_csmAudience,excludedUserIds:(_csmAudience==='except'?_csmExcludedIds:[])};
                    /* FIX (point #4 persistence): merge:true on the `items`
                       field only — never blow away the doc wholesale, so a
                       fresh login's read of this same doc (see §13c below)
                       sees every still-live item, not just the latest post. */
                    /* FIX (2026-08-30 — see the _writeDocWithRetry comment
                       above): this used to be its own tiny try/catch that
                       only logged the error (console.warn) and let
                       execution fall straight through to the "✅ Status
                       posted!" success path below — even when the write
                       had actually failed, so a permission-denied looked
                       to the person exactly like a successful post that
                       silently vanished. Now retried with the same
                       auth-session-aware logic the group chat composer
                       already uses, and a failure that survives every
                       retry is allowed to propagate up to this function's
                       own outer catch (a few lines down), which already
                       correctly shows an error and never claims success. */
                    if(window.fbDb){
                        await _writeDocWithRetry(function () {
                            return window.fbDb.collection('statuses').doc(docId).set({userId:doc.userId,name:doc.name,avatar:doc.avatar,items:mergedItems,createdAt:doc.createdAt,audience:doc.audience,excludedUserIds:doc.excludedUserIds},{merge:true});
                        });
                    }
                    /* own status's post-post index — needed below whichever
                       branch runs: updated in place at ei, or landed at the
                       front via unshift. */
                    var ownIdx = ei>-1 ? ei : 0;
                    if(ei>-1)window.userStatuses[ei]=doc;else window.userStatuses.unshift(doc);
                    renderStatusBar();
                    _notify('✅ Status posted!','success');
                    modal.style.display='none';modal.classList.remove('show');document.body.classList.remove('modal-open','status-composer-open');
                    window._empPendingRemoteStatusMedia=null;
                    if(txtEl2)txtEl2.value='';if(fi2)fi2.value='';
                    var pv=document.getElementById('status-file-preview')||document.getElementById('cs-file-preview');
                    if(pv){pv.innerHTML='';pv.style.display='none';}
                    window._empStatusSelectedSoundLabel=null;
                    _csmSetMediaCaptionMode(false);
                    if(typeof window._empCsmResetModeTabs==='function') window._empCsmResetModeTabs();
                    modal._v4Wired=false;
                    /* FIX (2026-08-01 — "Direct navigation: after sharing,
                       users should be taken directly to the status screen
                       for confirmation and visibility"): posting used to
                       just close the composer and drop the person back
                       wherever they already were, so the only confirmation
                       was the toast — they had to find their own avatar in
                       the status bar and tap it themselves to see what
                       actually went live. Now it opens the viewer on their
                       own status immediately after the composer closes. */
                    if(typeof window.openStatusViewer==='function') window.openStatusViewer(ownIdx);
                }catch(err){
                    console.error('[Status post]',err);
                    if(progPctEl) progPctEl.textContent='Failed';
                    _notify('Failed: '+(err.message||'Try again'),'error');
                }
                finally{subBtn.disabled=false;subBtn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';}
            });
        }

        _wireCsmModeTabs(modal);
        _wireCsmToolRail(modal);
        _wireCsmVoice(modal);
    }

    /* =========================================================================
       §CSM-2  MODE TABS — Text / Quote / Meme
       =========================================================================
       Switches which of the three .csm-mode-panel blocks is visible and
       tracks the active mode on the modal itself (data-csm-mode), which the
       submit handler above reads to decide what actually gets posted. Purely
       a visibility/state layer on top of the SAME controls that already
       exist (#status-text-input for Text; a plain quote/meme preview for the
       other two) — no new posting path, no change to _buildItems/_mkItem.
       ========================================================================= */
    var CSM_QUOTE_FALLBACKS=[
        {q:'Simplicity is the ultimate sophistication.',a:'Leonardo da Vinci'},
        {q:'The only way to do great work is to love what you do.',a:'Steve Jobs'},
        {q:'In the middle of difficulty lies opportunity.',a:'Albert Einstein'},
        {q:'What we think, we become.',a:'Buddha'},
        {q:'Turn your wounds into wisdom.',a:'Oprah Winfrey'}
    ];
    var CSM_MEME_FALLBACKS=[
        'https://i.imgflip.com/1bij.jpg','https://i.imgflip.com/26am.jpg','https://i.imgflip.com/1g8my4.jpg'
    ];
    function _csmPickFallback(arr){return arr[Math.floor(Math.random()*arr.length)];}

    function _wireCsmModeTabs(modal){
        var tabsWrap=document.getElementById('status-mode-tabs');
        if(!tabsWrap||tabsWrap._v5Wired)return;
        tabsWrap._v5Wired=true;

        function _setMode(mode){
            var prevMode=modal.getAttribute('data-csm-mode')||'text';
            modal.setAttribute('data-csm-mode',mode);
            tabsWrap.querySelectorAll('.csm-mode-tab').forEach(function(b){b.classList.toggle('active',b.dataset.mode===mode);});
            /* keep the active tab (Text on open/reset) visible in the swipeable row */
            var _actTab=tabsWrap.querySelector('.csm-mode-tab.active');
            if(_actTab){
                var _tl=_actTab.offsetLeft-Math.max(0,(tabsWrap.clientWidth-_actTab.offsetWidth)/2);
                try{tabsWrap.scrollTo({left:Math.max(0,_tl),behavior:'smooth'});}catch(_e){tabsWrap.scrollLeft=Math.max(0,_tl);}
            }
            ['text','quote','meme','voice','election'].forEach(function(m){
                var panel=document.getElementById('status-mode-panel-'+m);
                if(panel)panel.classList.toggle('active',m===mode);
            });
            if(typeof window._empCsmUpdateToolVisibility==='function') window._empCsmUpdateToolVisibility(mode);
            /* Switching modes discards whichever alternate attachment the
               OTHER mode was about to post, so tapping Post right after a
               tab switch never posts a stale meme/text left over from the
               tab the person just left. */
            if(mode!=='meme') window._empPendingRemoteStatusMedia=null;
            /* FEATURE (voice note): leaving the Voice tab while a recording
               is still in progress would otherwise leave the mic stream
               open and the MediaRecorder running in the background with no
               UI left to stop it — cancel outright (discard, not save) the
               same way navigating away from an unsent chat voice note
               does. A completed ("ready") recording is intentionally left
               alone so switching tabs to peek at Text/Quote/Meme and
               coming back to Voice doesn't lose it. */
            if(prevMode==='voice'&&mode!=='voice'&&typeof window._csmVoiceCancelIfRecording==='function') window._csmVoiceCancelIfRecording();
        }
        tabsWrap.addEventListener('click',function(e){
            var b=e.target.closest('.csm-mode-tab');
            if(!b)return;
            _setMode(b.dataset.mode);
            if(b.dataset.mode==='quote') _csmEnsureQuoteLoaded();
            if(b.dataset.mode==='meme') _csmEnsureMemeLoaded();
            if(b.dataset.mode==='voice'&&typeof window._csmVoiceEnsureLoaded==='function') window._csmVoiceEnsureLoaded();
            if(b.dataset.mode==='election'&&typeof window._csmEnsureElectionLoaded==='function') window._csmEnsureElectionLoaded();
        });

        window._empCsmResetModeTabs=function(){_setMode('text'); if(typeof window._csmVoiceReset==='function') window._csmVoiceReset(); if(typeof window._csmElectionReset==='function') window._csmElectionReset();};

        /* ── Quote tab ── */
        function _renderQuote(q,a){
            var qEl=document.getElementById('status-quote-text'),aEl=document.getElementById('status-quote-author');
            if(qEl)qEl.textContent='\u201C'+q+'\u201D';
            if(aEl)aEl.textContent='\u2014 '+a;
        }
        function _csmEnsureQuoteLoaded(){
            var qEl=document.getElementById('status-quote-text');
            if(qEl&&qEl.textContent&&qEl.textContent!=='')return; /* already has something (fresh default markup) */
        }
        var quoteShuffleBtn=document.getElementById('status-quote-shuffle-btn');
        if(quoteShuffleBtn&&!quoteShuffleBtn._v5){quoteShuffleBtn._v5=true;
            quoteShuffleBtn.addEventListener('click',async function(){
                quoteShuffleBtn.disabled=true;
                var orig=quoteShuffleBtn.innerHTML;
                quoteShuffleBtn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Finding a quote…';
                try{
                    var res=await fetch('https://dummyjson.com/quotes/random');
                    if(!res.ok)throw new Error('quote fetch failed');
                    var data=await res.json();
                    _renderQuote(data.quote,data.author);
                }catch(err){
                    var fb=_csmPickFallback(CSM_QUOTE_FALLBACKS);
                    _renderQuote(fb.q,fb.a);
                }finally{
                    quoteShuffleBtn.disabled=false;quoteShuffleBtn.innerHTML=orig;
                }
            });
        }

        /* ── Meme tab ── */
        var memeImg=document.getElementById('status-meme-img'),memeLoading=document.getElementById('status-meme-loading');
        /* FIX (2026-09-12 — "broken icon"/broken-image glyph on Meme tab):
           the old catch() only covered meme-api.com's fetch/JSON failing —
           if THAT succeeded (or the local fallback list was used) but the
           image URL itself then failed to actually load (blocked host,
           dead link, offline), memeImg had no error handler at all, so it
           sat showing the browser's native broken-image icon forever with
           no way to recover short of tapping Random Meme again. This adds
           an onerror retry that walks the fallback list (capped, so a
           fully offline device doesn't loop forever) before finally
           surfacing a clear "couldn't load" state instead of native tofu. */
        var _memeRetryCount=0;
        function _csmMemeGiveUp(){
            if(memeLoading)memeLoading.classList.remove('active');
            _notify('Could not load a meme — check your connection and try again.','warning');
        }
        function _loadMeme(){
            if(!memeImg)return;
            _memeRetryCount=0;
            if(memeLoading)memeLoading.classList.add('active');
            fetch('https://meme-api.com/gimme').then(function(r){return r.json();}).then(function(data){
                if(data&&data.url){memeImg.src=data.url;}
                else throw new Error('no url');
            }).catch(function(){
                memeImg.src=_csmPickFallback(CSM_MEME_FALLBACKS);
            });
        }
        memeImg&&memeImg.addEventListener('error',function(){
            if(!memeImg.src)return;
            _memeRetryCount++;
            if(_memeRetryCount>CSM_MEME_FALLBACKS.length){ _csmMemeGiveUp(); return; }
            memeImg.src=_csmPickFallback(CSM_MEME_FALLBACKS);
        });
        function _csmEnsureMemeLoaded(){
            if(memeImg&&!memeImg.src) _loadMeme();
        }
        memeImg&&memeImg.addEventListener('load',function(){
            if(memeLoading)memeLoading.classList.remove('active');
            if(memeImg.src) window._empPendingRemoteStatusMedia={url:memeImg.src,type:'image'};
        });
        var memeShuffleBtn=document.getElementById('status-meme-shuffle-btn');
        if(memeShuffleBtn&&!memeShuffleBtn._v5){memeShuffleBtn._v5=true;
            memeShuffleBtn.addEventListener('click',function(){_loadMeme();});
        }

        /* ── Election tab ── FIX (2026-09-22 — "serious bug: clicking
           Election in the status bar just opens a blank tab"): the panel
           markup (#status-mode-panel-election in index.html) and its CSS
           (.csm-election-* above) already existed, and index.html's own
           comment on that panel claimed this file wired it up via
           window.EMP_ELECTION_CANDIDATES/_csmEnsureElectionLoaded/an
           election branch on #post-status-btn — but none of that was
           ever actually written. Two compounding bugs from that gap:
           (1) _setMode's panel-toggle loop above didn't list 'election'
           at all, so switching to it removed .active from every OTHER
           panel and never added it to this one either — the whole mode
           body went blank, which is the literal bug report; (2) even
           with the panel visible, tapping a candidate/photo did nothing
           because none of this code existed. Fixed here as a fully
           self-contained implementation — deliberately NOT reaching into
           app-patch-v49-v50.js's #election-modal (Quick Post's own,
           separate "Election" entry point) or vice versa, matching this
           codebase's own established rule that the two composers never
           share internals (see app-patch-v49-v50.js's header). Same
           CANDIDATES data/colors as that file purely for a consistent
           look between the two entry points — a coincidence of values,
           not a code dependency.

           Posting: this composited card goes through the EXACT SAME
           #post-status-btn write further above that every other mode on
           this tab already uses — fbDb.collection('statuses').doc(docId)
           .set(...) — never .collection('posts'), so an Election status
           (like every other status) never appears on the dashboard home
           feed, only in the individual status viewer. */
        window.EMP_ELECTION_CANDIDATES=window.EMP_ELECTION_CANDIDATES||[
            {id:'tinubu',name:'Bola Ahmed Tinubu',party:'APC',color:'#00853F',accent:'#E4292C'},
            {id:'atiku', name:'Atiku Abubakar',    party:'ADC',color:'#1E7A3D',accent:'#0B3D24'},
            {id:'obi',   name:'Peter Obi',         party:'NDC',color:'#1B2260',accent:'#D22B2B'},
            {id:'sowore',name:'Omoyele Sowore',    party:'AAC',color:'#5C4033',accent:'#D9A441'},
            {id:'makinde',name:'Seyi Makinde',   party:'APM',color:'#0F2A5C',accent:'#2E9E4F'},
            {id:'duke',  name:'Donald Duke',       party:'PRP',color:'#B3202A',accent:'#111111'}
        ];
        var _csmElectionCandidate=null,_csmElectionPhoto=null,_csmElectionFile=null;
        var electionGrid=document.getElementById('status-election-cand-grid');

        function _csmElectionRoundedRect(ctx,x,y,w,h,r){
            ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);
            ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
        }
        function _csmElectionDrawImageCover(ctx,img,x,y,w,h){
            var ir=img.width/img.height,tr=w/h,sx,sy,sw,sh;
            if(ir>tr){sh=img.height;sw=sh*tr;sx=(img.width-sw)/2;sy=0;}
            else{sw=img.width;sh=sw/tr;sx=0;sy=(img.height-sh)/2;}
            ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h);
        }
        function _csmElectionShade(hex,pct){
            var n=parseInt(hex.replace('#',''),16);
            var r=Math.max(0,Math.min(255,((n>>16)&255)*(1+pct)));
            var g=Math.max(0,Math.min(255,((n>>8)&255)*(1+pct)));
            var b=Math.max(0,Math.min(255,(n&255)*(1+pct)));
            return 'rgb('+(r|0)+','+(g|0)+','+(b|0)+')';
        }
        function _csmDrawElectionCard(){
            var canvas=document.getElementById('status-election-canvas');
            if(!canvas||!_csmElectionCandidate)return;
            var ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height,c=_csmElectionCandidate;
            ctx.clearRect(0,0,W,H);
            ctx.save();
            _csmElectionRoundedRect(ctx,0,0,W,H,28);
            ctx.clip();
            var grad=ctx.createLinearGradient(0,0,0,H);
            grad.addColorStop(0,c.color);grad.addColorStop(1,_csmElectionShade(c.color,-0.35));
            ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);

            var bx=44,by=50,br=30;
            ctx.beginPath();ctx.arc(bx,by,br,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();
            ctx.beginPath();ctx.arc(bx,by,br-3,0,Math.PI*2);ctx.fillStyle=c.color;ctx.fill();
            ctx.fillStyle='#fff';ctx.font='700 13px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
            ctx.fillText(c.party,bx,by+1);

            var cx=W/2,cy=H*0.42,radius=W*0.42;
            ctx.beginPath();ctx.arc(cx,cy,radius+6,0,Math.PI*2);ctx.fillStyle='rgba(255,255,255,0.85)';ctx.fill();
            ctx.save();ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.closePath();ctx.clip();
            if(_csmElectionPhoto){
                _csmElectionDrawImageCover(ctx,_csmElectionPhoto,cx-radius,cy-radius,radius*2,radius*2);
            }else{
                ctx.fillStyle='rgba(0,0,0,0.15)';ctx.fillRect(cx-radius,cy-radius,radius*2,radius*2);
                ctx.fillStyle='rgba(255,255,255,0.7)';ctx.font=Math.round(radius*0.7)+'px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
                ctx.fillText('\uD83D\uDE42',cx,cy+radius*0.06);
            }
            ctx.restore();
            ctx.lineWidth=5;ctx.strokeStyle='#fff';ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.stroke();

            var bannerH=64;
            ctx.fillStyle=c.accent;ctx.fillRect(0,H-bannerH,W,bannerH);
            ctx.fillStyle='#fff';ctx.font='800 20px Arial';ctx.textAlign='center';
            ctx.fillText('I SUPPORT '+c.name.toUpperCase(),W/2,H-bannerH+26);
            ctx.font='600 13px Arial';
            ctx.fillText('#Vote2027 \u00B7 '+c.party,W/2,H-bannerH+46);
            ctx.restore();
        }

        function _csmRenderElectionGrid(){
            if(!electionGrid||electionGrid.childElementCount)return; // build once, re-used across tab switches
            window.EMP_ELECTION_CANDIDATES.forEach(function(c){
                var card=document.createElement('div');
                card.className='csm-election-cand';
                card.dataset.id=c.id;
                card.innerHTML='<div class="cec-check"><i class="fas fa-check"></i></div>'+
                    '<div class="cec-name">'+c.name+'</div>'+
                    '<div class="cec-party">'+c.party+'</div>';
                card.addEventListener('click',function(){
                    _csmElectionCandidate=c;
                    electionGrid.querySelectorAll('.csm-election-cand').forEach(function(el){el.classList.toggle('selected',el.dataset.id===c.id);});
                    var photoBtn=document.getElementById('status-election-photo-btn');
                    if(photoBtn)photoBtn.hidden=false;
                    var previewWrap=document.getElementById('status-election-preview-wrap');
                    if(previewWrap)previewWrap.hidden=false;
                    var noteEl=document.getElementById('status-election-note');
                    if(noteEl)noteEl.hidden=false;
                    _csmDrawElectionCard();
                });
                electionGrid.appendChild(card);
            });
        }

        var electionPhotoInput=document.getElementById('status-election-photo-input');
        if(electionPhotoInput&&!electionPhotoInput._v5){electionPhotoInput._v5=true;
            electionPhotoInput.addEventListener('change',function(){
                var f=electionPhotoInput.files&&electionPhotoInput.files[0];
                if(!f)return;
                _csmElectionFile=f;
                var reader=new FileReader();
                reader.onload=function(){
                    var img=new Image();
                    img.onload=function(){_csmElectionPhoto=img;_csmDrawElectionCard();};
                    img.src=reader.result;
                };
                reader.readAsDataURL(f);
            });
        }

        window._csmEnsureElectionLoaded=function(){_csmRenderElectionGrid();};
        window._csmElectionReset=function(){
            _csmElectionCandidate=null;_csmElectionPhoto=null;_csmElectionFile=null;
            if(electionGrid)electionGrid.innerHTML='';
            var photoBtn=document.getElementById('status-election-photo-btn'); if(photoBtn)photoBtn.hidden=true;
            var previewWrap=document.getElementById('status-election-preview-wrap'); if(previewWrap)previewWrap.hidden=true;
            var noteEl=document.getElementById('status-election-note'); if(noteEl)noteEl.hidden=true;
            if(electionPhotoInput)electionPhotoInput.value='';
        };
        /* Exposed so #post-status-btn's election branch (further above in
           this file) can read the selected candidate/photo without a
           second copy of this state. */
        window._csmElectionGetState=function(){return {candidate:_csmElectionCandidate,photo:_csmElectionPhoto,file:_csmElectionFile};};
        window._csmElectionCanvasToBlob=function(){
            return new Promise(function(resolve){
                var canvas=document.getElementById('status-election-canvas');
                if(!canvas){resolve(null);return;}
                canvas.toBlob(function(blob){resolve(blob);},'image/png',0.95);
            });
        };

        _setMode('text'); /* always start on Text — matches the pre-tab default */
    }

    /* =========================================================================
       §CSM-3  TOOL RAIL — music / background / font / sticker
       =========================================================================
       Music opens a small preset-track sheet (same "synthesize a tone,
       no audio files" approach app-reel.js's own sound picker already uses
       — see that file's _soundLibraryPresets/_playSoundPreview for the
       established pattern this mirrors, kept as a fully separate preset
       list/DOM tree so neither module touches the other's ids). Background
       just re-triggers the pre-existing #status-color-cycle-btn cycler
       (untouched, only relocated visually into this rail). Font cycles the
       Text tab's own font-family. Sticker inserts an emoji into whichever
       text field the current mode actually has (Text textarea, or nothing
       for Meme, which has no text field to insert into).
       ========================================================================= */
    var CSM_SOUND_PRESETS=[
        {id:'none',label:'No music',icon:'fa-ban',freq:0,type:'sine'},
        {id:'upbeat',label:'Upbeat Pop',icon:'fa-bolt',freq:440,type:'square'},
        {id:'chill',label:'Chill Vibes',icon:'fa-cloud',freq:220,type:'sine'},
        {id:'cinematic',label:'Cinematic',icon:'fa-film',freq:110,type:'sawtooth'},
        {id:'afrobeat',label:'Afrobeat Groove',icon:'fa-drum',freq:330,type:'triangle'},
        {id:'lofi',label:'Lo-Fi Beats',icon:'fa-record-vinyl',freq:165,type:'sine'}
    ];
    var _csmSelectedSoundId='none';
    var _csmPreviewCtx=null,_csmPreviewOsc=null,_csmPreviewingId=null;
    function _csmStopPreview(){
        if(_csmPreviewOsc){try{_csmPreviewOsc.stop();}catch(e){}_csmPreviewOsc=null;}
        _csmPreviewingId=null;
        document.querySelectorAll('.ssm-track-preview.playing').forEach(function(b){b.classList.remove('playing');});
    }
    function _csmPlayPreview(preset,btnEl){
        if(_csmPreviewingId===preset.id){_csmStopPreview();return;}
        _csmStopPreview();
        if(!preset.freq)return;
        try{
            if(!_csmPreviewCtx)_csmPreviewCtx=new (window.AudioContext||window.webkitAudioContext)();
            if(_csmPreviewCtx.state==='suspended')_csmPreviewCtx.resume();
            _csmPreviewOsc=_csmPreviewCtx.createOscillator();
            var gain=_csmPreviewCtx.createGain();
            _csmPreviewOsc.type=preset.type||'sine';
            _csmPreviewOsc.frequency.value=preset.freq;
            gain.gain.value=0.08;
            _csmPreviewOsc.connect(gain).connect(_csmPreviewCtx.destination);
            _csmPreviewOsc.start();
            _csmPreviewingId=preset.id;
            if(btnEl)btnEl.classList.add('playing');
            setTimeout(function(){if(_csmPreviewingId===preset.id)_csmStopPreview();},2500);
        }catch(err){console.warn('[Status composer] sound preview unavailable:',err&&err.message);}
    }
    function _csmBuildMusicSheet(){
        if(document.getElementById('status-music-lib-scrim'))return;
        var scrim=document.createElement('div');
        scrim.id='status-music-lib-scrim';
        scrim.innerHTML='<div id="status-music-lib-sheet"><div id="status-music-lib-head"><h4><i class="fas fa-music"></i> Add music</h4>'
            +'<button type="button" id="status-music-lib-close" aria-label="Close"><i class="fas fa-times"></i></button></div>'
            +'<div id="status-music-lib-list"></div></div>';
        document.body.appendChild(scrim);
        scrim.addEventListener('click',function(e){if(e.target===scrim)_csmCloseMusicSheet();});
        scrim.querySelector('#status-music-lib-close').addEventListener('click',_csmCloseMusicSheet);
        _csmRenderMusicList();
    }
    function _csmRenderMusicList(){
        var list=document.getElementById('status-music-lib-list');
        if(!list)return;
        list.innerHTML=CSM_SOUND_PRESETS.map(function(p){
            var sel=p.id===_csmSelectedSoundId?' selected':'';
            return '<div class="ssm-track'+sel+'" data-sound-id="'+p.id+'">'
                +(p.freq?'<button type="button" class="ssm-track-preview" data-preview-id="'+p.id+'"><i class="fas fa-play"></i></button>'
                        :'<span class="ssm-track-preview"><i class="fas '+p.icon+'"></i></span>')
                +'<span class="ssm-track-label">'+p.label+'</span><i class="fas fa-check-circle"></i></div>';
        }).join('');
        list.querySelectorAll('.ssm-track-preview[data-preview-id]').forEach(function(btn){
            btn.addEventListener('click',function(e){
                e.stopPropagation();
                var preset=CSM_SOUND_PRESETS.filter(function(p){return p.id===btn.dataset.previewId;})[0];
                if(preset)_csmPlayPreview(preset,btn);
            });
        });
        list.querySelectorAll('.ssm-track').forEach(function(row){
            row.addEventListener('click',function(){
                _csmSelectedSoundId=row.dataset.soundId;
                var preset=CSM_SOUND_PRESETS.filter(function(p){return p.id===_csmSelectedSoundId;})[0];
                var isNone=!preset||preset.id==='none';
                window._empStatusSelectedSoundLabel=isNone?null:preset.label;
                document.querySelectorAll('.csm-music-sticker').forEach(function(st){
                    st.classList.toggle('active',!isNone);
                    var lbl=st.querySelector('.csm-music-sticker-label');
                    if(lbl)lbl.textContent=isNone?'':preset.label;
                });
                _csmCloseMusicSheet();
            });
        });
    }
    function _csmOpenMusicSheet(){
        _csmBuildMusicSheet();_csmRenderMusicList();
        var scrim=document.getElementById('status-music-lib-scrim');
        if(scrim)scrim.classList.add('active');
    }
    function _csmCloseMusicSheet(){
        _csmStopPreview();
        var scrim=document.getElementById('status-music-lib-scrim');
        if(scrim)scrim.classList.remove('active');
    }

    var CSM_FONTS=['inherit','Georgia,"Times New Roman",serif','"Courier New",monospace','Impact,sans-serif'];
    var CSM_FONT_LABELS=['Default','Serif','Mono','Impact'];
    var _csmFontIdx=0;
    var CSM_EMOJIS=['🔥','✨','💯','❤️','😂','🚀','🎉','😊'];

    /* FIX (2026-09-12 — "block or filter posts from selected contacts"):
       WhatsApp-style "My Contacts Except…" picker. Mirrors the existing
       music-library sheet's scrim+list DOM pattern (same file, above) so it
       reuses the same visual language rather than inventing a new one.
       Pulls candidates from window.mockUsers filtered to the people the
       current user follows (_us().followedUserIds) — the same "contacts"
       source app-profile.js's own Following list already uses — rather
       than every user in the app, matching WhatsApp's own contacts-only
       scope for this control. */
    function _csmOpenExceptSheet(preselectedIds,onDone){
        var existing=document.getElementById('status-except-scrim');
        if(existing)existing.remove();
        var us=_us();
        var followedIds=Array.from(us.followedUserIds||[]);
        var mu=window.mockUsers||{};
        var selected={};
        (preselectedIds||[]).forEach(function(id){selected[id]=true;});
        var scrim=document.createElement('div');
        scrim.id='status-except-scrim';
        scrim.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:var(--z-critical,99999);display:flex;align-items:flex-end;justify-content:center;';
        var rowsHtml=followedIds.length?followedIds.map(function(id){
            var u=mu[id]||{};
            var name=u.fullName||u.username||'Empyrean User';
            var checked=selected[id]?' checked':'';
            return '<label style="display:flex;align-items:center;gap:10px;padding:10px 6px;cursor:pointer;">'
                +'<input type="checkbox" data-uid="'+id+'"'+checked+' style="width:18px;height:18px;">'
                +'<img src="'+(u.avatar||'')+'" style="width:34px;height:34px;border-radius:50%;object-fit:cover;background:#ccc;">'
                +'<span style="font-weight:600;">'+name+'</span></label>';
        }).join(''):'<p style="text-align:center;padding:20px;color:rgba(255,255,255,0.6);">You\'re not following anyone yet to hide this from.</p>';
        scrim.innerHTML='<div style="background:#0D1540;color:#fff;width:min(480px,100vw);max-height:75vh;border-radius:20px 20px 0 0;display:flex;flex-direction:column;padding:16px;">'
            +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;"><h4 style="margin:0;">Hide status from</h4><button type="button" id="status-except-close" aria-label="Close" style="background:none;border:none;color:#fff;font-size:1.1rem;"><i class="fas fa-times"></i></button></div>'
            +'<div id="status-except-list" style="overflow-y:auto;flex:1;">'+rowsHtml+'</div>'
            +'<button type="button" id="status-except-done" style="margin-top:10px;padding:12px;border:none;border-radius:50px;background:var(--g-teal,linear-gradient(135deg,#00D4AA,#10B981));color:#0A0E27;font-weight:800;">Done</button>'
            +'</div>';
        document.body.appendChild(scrim);
        function _close(){scrim.remove();}
        scrim.addEventListener('click',function(e){if(e.target===scrim)_close();});
        scrim.querySelector('#status-except-close').addEventListener('click',_close);
        scrim.querySelector('#status-except-done').addEventListener('click',function(){
            var ids=Array.from(scrim.querySelectorAll('input[data-uid]:checked')).map(function(cb){return cb.getAttribute('data-uid');});
            _close();
            if(typeof onDone==='function')onDone(ids);
        });
    }

    function _wireCsmToolRail(modal){
        var rail=modal.querySelector('.csm-tools-col');
        if(!rail||rail._v5Wired)return;
        rail._v5Wired=true;

        var musicBtn=document.getElementById('status-music-tool-btn');
        if(musicBtn)musicBtn.addEventListener('click',function(e){e.preventDefault();_csmOpenMusicSheet();});

        document.querySelectorAll('[data-clear-music]').forEach(function(x){
            x.addEventListener('click',function(e){
                e.stopPropagation();
                _csmSelectedSoundId='none';
                window._empStatusSelectedSoundLabel=null;
                document.querySelectorAll('.csm-music-sticker').forEach(function(st){st.classList.remove('active');});
            });
        });

        var fontBtn=document.getElementById('status-font-cycle-btn');
        if(fontBtn)fontBtn.addEventListener('click',function(e){
            e.preventDefault();
            var txtEl=document.getElementById('status-text-input');
            if(!txtEl)return;
            _csmFontIdx=(_csmFontIdx+1)%CSM_FONTS.length;
            txtEl.style.fontFamily=CSM_FONTS[_csmFontIdx];
            /* FIX (2026-09-12 — "T feature disabled"): the cycle itself was
               already working, but firing silently on a plain circular
               icon-only button gave no confirmation a tap did anything —
               easy to read as broken, especially cycling INTO 'inherit'
               (index 0) where the text visibly looks unchanged. A quick
               toast + a brief scale pulse (matching the existing colour-
               cycle button's own feedback pattern just above) makes every
               tap visibly register. */
            _notify('Font: '+CSM_FONT_LABELS[_csmFontIdx],'info');
            fontBtn.style.transform='scale(0.85)';
            setTimeout(function(){fontBtn.style.transform='';},120);
        });

        var emojiBtn=document.getElementById('status-emoji-btn');
        if(emojiBtn)emojiBtn.addEventListener('click',function(e){
            e.preventDefault();
            var mode=modal.getAttribute('data-csm-mode')||'text';
            var target=mode==='text'?document.getElementById('status-text-input'):null;
            if(!target)return;
            target.value+=CSM_EMOJIS[Math.floor(Math.random()*CSM_EMOJIS.length)];
        });

        window._empCsmUpdateToolVisibility=function(mode){
            if(fontBtn)fontBtn.hidden=(mode!=='text');
            var colorBtn=document.getElementById('status-color-cycle-btn');
            if(colorBtn)colorBtn.hidden=(mode!=='text');
            if(emojiBtn)emojiBtn.hidden=(mode!=='text');
            /* music stays available in every mode */
        };
        window._empCsmUpdateToolVisibility('text');
    }

    /* =========================================================================
       FEATURE (2026-09-13 — "add voice note as a feature", modelled on the
       reference voice-status mockup supplied this session). MediaRecorder
       start/stop/cleanup here deliberately mirrors app-patch-openchat.js's
       existing, already-hardened 1:1/group-chat voice-note recorder
       (_startRecording/_stopRecording there): feature-detect getUserMedia
       AND MediaRecorder before touching either, negotiate 'audio/webm'
       with a browser-default fallback, wrap the MediaRecorder constructor
       in try/catch (some WebViews throw there even when the type check
       above passes), and always stop every audio track on the stream when
       done recording — regardless of save/cancel — so the mic indicator
       never stays on after this tab closes. Result is stored as a plain
       File (not just a Blob) in _csmVoiceFile so it can go through the
       exact same _uploadFile() used by every other status media type.
       ========================================================================= */
    var _csmVoiceRec = { recorder:null, chunks:[], stream:null, active:false, timer:null, elapsed:0 };
    var _csmVoiceFile = null, _csmVoiceDuration = 0, _csmVoiceWaveTimer = null;

    function _csmVoiceBars(containerId, count, cls){
        var el=document.getElementById(containerId);
        if(!el)return;
        el.innerHTML='';
        for(var i=0;i<count;i++){
            var bar=document.createElement('div');
            bar.className=cls;
            el.appendChild(bar);
        }
    }

    function _wireCsmVoice(modal){
        var wrap=document.getElementById('status-voice-wrap');
        if(!wrap||wrap._v5Wired)return;
        wrap._v5Wired=true;

        var recordBtn=document.getElementById('status-voice-record-btn');
        var stopBtn=document.getElementById('status-voice-stop-btn');
        var retakeBtn=document.getElementById('status-voice-retake-btn');
        var playBtn=document.getElementById('status-voice-play-btn');
        var timerEl=document.getElementById('status-voice-timer');
        var finalTimerEl=document.getElementById('status-voice-final-timer');
        var previewAudio=document.getElementById('status-voice-audio-preview');
        var avatarEl=document.getElementById('status-voice-avatar');

        function _fmtTime(s){ s=Math.max(0,Math.round(s)); var m=Math.floor(s/60),ss=s%60; return m+':'+(ss<10?'0':'')+ss; }

        window._csmVoiceEnsureLoaded=function(){
            if(avatarEl&&!avatarEl.src) avatarEl.src=_us().avatar||'';
            /* Only reset to idle if there's neither an in-progress
               recording nor an already-finished one waiting to be posted
               — coming back to this tab shouldn't wipe out a completed
               take, matching _setMode's own comment above. */
            if(wrap.dataset.state!=='recording'&&wrap.dataset.state!=='ready'){
                wrap.dataset.state='idle';
            }
        };

        function _startRecording(){
            if(_csmVoiceRec.active)return;
            if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
                _notify('Voice notes aren\'t supported on this browser.','warning'); return;
            }
            if(!window.MediaRecorder){
                _notify('Recording is not supported on this browser.','warning'); return;
            }
            navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
                _csmVoiceRec.stream=stream;
                _csmVoiceRec.chunks=[];
                var mimeType=(window.MediaRecorder&&MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported('audio/webm'))?'audio/webm':'';
                try{
                    _csmVoiceRec.recorder=mimeType?new MediaRecorder(stream,{mimeType:mimeType}):new MediaRecorder(stream);
                }catch(e){
                    _notify('Could not start recording on this device.','warning');
                    stream.getTracks().forEach(function(t){t.stop();});
                    _csmVoiceRec.stream=null;
                    return;
                }
                _csmVoiceRec.active=true;
                _csmVoiceRec.recorder.addEventListener('dataavailable',function(e){
                    if(e.data&&e.data.size>0)_csmVoiceRec.chunks.push(e.data);
                });
                _csmVoiceRec._startedAt=Date.now();
                _csmVoiceRec.recorder.addEventListener('stop',function(){
                    _csmVoiceRec.active=false;
                    if(_csmVoiceRec.stream){_csmVoiceRec.stream.getTracks().forEach(function(t){t.stop();});_csmVoiceRec.stream=null;}
                    clearInterval(_csmVoiceRec.timer);_csmVoiceRec.timer=null;
                    clearInterval(_csmVoiceWaveTimer);_csmVoiceWaveTimer=null;
                    var durationMs=Date.now()-(_csmVoiceRec._startedAt||0);
                    if(_csmVoiceRec._cancelled){
                        _csmVoiceRec.chunks=[];_csmVoiceRec._cancelled=false;
                        wrap.dataset.state='idle';
                        return;
                    }
                    if(durationMs<800){
                        _notify('Recording too short — hold a bit longer.','info');
                        _csmVoiceRec.chunks=[];
                        wrap.dataset.state='idle';
                        return;
                    }
                    var mt=(_csmVoiceRec.recorder&&_csmVoiceRec.recorder.mimeType)||'audio/webm';
                    var blob=new Blob(_csmVoiceRec.chunks,{type:mt});
                    var ext=(mt.indexOf('mp4')!==-1)?'m4a':'webm';
                    _csmVoiceFile=new File([blob],'voice-status-'+Date.now()+'.'+ext,{type:mt});
                    _csmVoiceDuration=Math.round(durationMs/1000);
                    _csmVoiceRec.chunks=[];
                    if(finalTimerEl)finalTimerEl.textContent=_fmtTime(_csmVoiceDuration);
                    _csmVoiceBars('status-voice-wave-static',28,'cvw-bar');
                    document.querySelectorAll('#status-voice-wave-static .cvw-bar').forEach(function(bar){
                        bar.style.height=(6+Math.random()*16|0)+'px';
                    });
                    if(previewAudio){previewAudio.src=URL.createObjectURL(_csmVoiceFile);previewAudio.currentTime=0;}
                    if(playBtn)playBtn.innerHTML='<i class="fas fa-play"></i>';
                    wrap.dataset.state='ready';
                });
                _csmVoiceRec.recorder.start();

                /* live UI: timer + randomized "levels" waveform, same
                   simple randomized-height approach app-patch-openchat.js's
                   own recording bar already uses (real amplitude via
                   AnalyserNode would need per-browser tuning for very
                   little visible benefit over this). */
                _csmVoiceRec.elapsed=0;
                if(timerEl)timerEl.textContent='0:00';
                _csmVoiceBars('status-voice-wave',22,'cvw-bar');
                _csmVoiceRec.timer=setInterval(function(){
                    _csmVoiceRec.elapsed++;
                    if(timerEl)timerEl.textContent=_fmtTime(_csmVoiceRec.elapsed);
                },1000);
                _csmVoiceWaveTimer=setInterval(function(){
                    document.querySelectorAll('#status-voice-wave .cvw-bar').forEach(function(bar){
                        bar.style.height=(6+Math.random()*18|0)+'px';
                    });
                },120);

                wrap.dataset.state='recording';
            }).catch(function(err){
                _notify('Microphone permission denied: '+(err.message||err),'warning');
            });
        }

        function _stopRecording(cancel){
            _csmVoiceRec._cancelled=!!cancel;
            if(_csmVoiceRec.recorder&&_csmVoiceRec.active){
                try{_csmVoiceRec.recorder.stop();}catch(e){}
            }
        }

        /* Exposed so _setMode (leaving the Voice tab mid-recording) and the
           composer's close button can both discard an in-progress
           recording without duplicating this logic. */
        window._csmVoiceCancelIfRecording=function(){
            if(_csmVoiceRec.active) _stopRecording(true);
        };
        window._csmVoiceReset=function(){
            window._csmVoiceCancelIfRecording();
            _csmVoiceFile=null;_csmVoiceDuration=0;
            if(previewAudio){try{previewAudio.pause();}catch(e){}previewAudio.src='';}
            wrap.dataset.state='idle';
        };

        if(recordBtn)recordBtn.addEventListener('click',function(e){e.preventDefault();_startRecording();});
        if(stopBtn)stopBtn.addEventListener('click',function(e){e.preventDefault();_stopRecording(false);});
        if(retakeBtn)retakeBtn.addEventListener('click',function(e){
            e.preventDefault();
            _csmVoiceFile=null;_csmVoiceDuration=0;
            if(previewAudio){try{previewAudio.pause();}catch(e){}previewAudio.src='';}
            wrap.dataset.state='idle';
        });
        if(playBtn)playBtn.addEventListener('click',function(e){
            e.preventDefault();
            if(!previewAudio||!previewAudio.src)return;
            if(previewAudio.paused){previewAudio.play().catch(function(){});playBtn.innerHTML='<i class="fas fa-pause"></i>';}
            else{previewAudio.pause();playBtn.innerHTML='<i class="fas fa-play"></i>';}
        });
        if(previewAudio)previewAudio.addEventListener('ended',function(){if(playBtn)playBtn.innerHTML='<i class="fas fa-play"></i>';});
    }

    async function _buildItems(files,txt,bg,onProgress){
        var items=[];
        if(txt&&!files.length){items.push(_mkItem('text',null,txt,bg));return items;}
        for(var i=0;i<files.length;i++){
            var f=files[i],isVid=f.type.startsWith('video/');
            var fileProg=function(pct){ if(typeof onProgress==='function') onProgress(i,files.length,pct); };
            if(isVid){
                var dur=await _getVidDur(f);
                _notify('Uploading video…','info');
                var url=await _uploadFile(f,'video',fileProg);
                if(!url){_notify('Video upload failed','error');continue;}
                if(dur>MAX_VID_S){
                    var sc=Math.ceil(dur/MAX_VID_S);
                    _notify('Splitting into '+sc+' parts','info');
                    for(var seg=0;seg<sc;seg++) items.push(_mkItem('video',url,txt,bg,{startOffset:seg*MAX_VID_S,endOffset:Math.min((seg+1)*MAX_VID_S,dur)}));
                } else items.push(_mkItem('video',url,txt,bg));
            } else {
                _notify('Uploading image…','info');
                var iurl=await _uploadFile(f,'image',fileProg);
                if(!iurl){_notify('Image upload failed','error');continue;}
                items.push(_mkItem('image',iurl,txt,bg));
            }
        }
        return items;
    }

    /* FIX (2026-08-04): this used to build its own FormData and POST
       straight to https://api.cloudinary.com/... via XMLHttpRequest,
       entirely separate from window.uploadToCloudinary() (app-dom.js).
       That function was migrated to upload to Firebase Storage instead
       of Cloudinary on 2026-08-03 — every other file that already called
       window.uploadToCloudinary() picked that up for free, but this
       file's private copy kept POSTing to Cloudinary directly, which is
       exactly the part that broke. Delegating to the shared function
       fixes that with no change to this function's own signature or
       contract: still resolves with a URL string on success and resolves
       with '' (never rejects) on failure, so every existing call site's
       `if(!url){...}` check below keeps working unchanged. onProgress
       still receives 0-100 the same way (window.uploadToCloudinary()
       calls it from Firebase Storage's own upload-progress event).
       `resourceType` is no longer needed by the upload call itself
       (Firebase Storage just stores the file's own contentType) but is
       kept as a parameter so every call site above is unaffected. */
    function _uploadFile(file, resourceType, onProgress){
        if (typeof window.uploadToCloudinary !== 'function') {
            console.error('[Status upload] window.uploadToCloudinary is not available.');
            return Promise.resolve('');
        }
        return window.uploadToCloudinary(file, onProgress).catch(function(err){
            console.error('[Status upload]', err && err.message);
            return '';
        });
    }

    function _mkItem(type,url,content,bg,extra){
        var it={id:'si-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),type:type,url:url||'',content:content||'',bg:bg||'',createdAt:new Date().toISOString(),likes:0,retweets:0,likedBy:[],retweetedBy:[],viewers:[]};
        if(extra)Object.assign(it,extra);
        return it;
    }

    function _getVidDur(file){
        return new Promise(function(res){
            var done=false;
            function finish(d){ if(done) return; done=true;
                try{ if(v.parentNode) v.parentNode.removeChild(v); }catch(e){}
                try{ URL.revokeObjectURL(v.src); }catch(e){}
                res(d);
            }
            var v=document.createElement('video');
            v.preload='metadata';
            v.muted=true;
            /* FIX (video upload silently hangs forever on mobile): a detached
               <video> element (never added to the DOM) often never fires
               loadedmetadata on mobile Chrome/Android -- the browser defers
               or skips metadata loading for elements that aren't in the
               document. That left `await _getVidDur(file)` stuck forever,
               which blocked the entire upload silently (no error shown,
               button stuck on "Posting..."). Attaching it off-screen (not
               display:none -- some engines also skip loading for display:none
               media) makes metadata load reliably, and a 8s timeout
               guarantees this Promise always resolves either way. */
            v.style.cssText='position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
            document.body.appendChild(v);
            v.onloadedmetadata=function(){ finish(isFinite(v.duration)?v.duration:0); };
            v.onerror=function(){ finish(0); };
            setTimeout(function(){ finish(isFinite(v.duration)?v.duration:0); }, 8000);
            v.src=URL.createObjectURL(file);
        });
    }
    function _fmtDur(s){if(!isFinite(s)||s<=0)return '';var m=Math.floor(s/60),sec=Math.floor(s%60);return m+':'+(sec<10?'0':'')+sec;}


    /* =========================================================================
       §12  FIRESTORE PERSISTENCE
       ========================================================================= */
    function _persistItem(su,item){
        var docId=su.docId||('status-'+su.userId);
        if(!window.fbDb)return;
        try{window.fbDb.collection('statuses').doc(docId).set({items:su.items},{merge:true}).catch(function(){});}catch(e){}
    }


    /* =========================================================================
       §13  PURGE + BOOTSTRAP
       ========================================================================= */
    /* ── Robustly parse a createdAt value that may be:
       • an ISO string          (our own _mkItem output)
       • a Firestore Timestamp  { seconds: N, nanoseconds: N } or .toMillis()
       • a JS Date object
       • a numeric epoch (ms)
       Returns epoch-ms, or 0 on failure so the item is treated as expired. */
    function _parseTs(v){
        if(!v) return 0;
        if(typeof v==='object'){
            if(typeof v.toMillis==='function') return v.toMillis();
            if(typeof v.seconds==='number')    return v.seconds*1000+Math.floor((v.nanoseconds||0)/1e6);
            if(v instanceof Date)              return v.getTime();
        }
        var d=new Date(v);
        return isNaN(d.getTime())?0:d.getTime();
    }

    function _purge(){
        if(!window.userStatuses)return;
        window.userStatuses=window.userStatuses.filter(function(su){
            if(!su||!su.items)return false;
            var before=su.items.length;
            /* BUG FIX 1: Use _parseTs so Firestore Timestamp objects are
               correctly compared. Items with no valid timestamp are treated
               as expired (not as immortal). */
            su.items=su.items.filter(function(it){
                var ts=_parseTs(it.createdAt);
                if(!ts) return false;
                return (Date.now()-ts)<EXPIRY_MS;
            });
            if(!su.items.length){
                if(window.fbDb&&su.docId){
                    try{window.fbDb.collection('statuses').doc(su.docId).delete();}catch(e){}
                }
                return false;
            }
            /* BUG FIX 2: If some items were pruned but the doc still has
               live items, write the trimmed array back to Firestore NOW so
               the next page-load doesn't re-fetch the already-expired items
               and make them reappear. */
            if(su.items.length!==before&&window.fbDb&&su.docId){
                try{
                    window.fbDb.collection('statuses').doc(su.docId)
                        .set({items:su.items},{merge:true}).catch(function(){});
                }catch(e){}
            }
            return true;
        });
        renderStatusBar();
    }

    /* ── utilities ── */
    /* BUG FIX 3: _liveItems also uses _parseTs so the viewer and status bar
       both agree with _purge on what is expired. The old `!it.createdAt`
       guard let items with a missing/unreadable timestamp live forever. */
    function _liveItems(su){
        return(su.items||[]).filter(function(it){
            var ts=_parseTs(it.createdAt);
            if(!ts) return false;
            return (Date.now()-ts)<EXPIRY_MS;
        });
    }

    /* FIX (feature: status ring in the Calls Log, app-patch-calls-log.js):
       that file needs to know "does this userId have a live, non-expired
       status, and has the current person already viewed it" to draw the
       same gradient/gray ring used everywhere else in this app — WITHOUT
       reimplementing _parseTs's Firestore-Timestamp/seconds-object/ISO-
       string handling a second time in a different file (a bug-prone
       duplication this codebase has already been burned by before). This
       is the minimal, read-only surface for that: given a userId, returns
       {idx, viewed} (idx being this user's position in window.userStatuses,
       ready to hand straight to openStatusViewer(idx)) or null if that
       user has no live status right now. Does not touch rendering, does
       not touch viewed-state — purely a lookup. */
    window._empUserHasLiveStatus = function (userId) {
        if (!userId) return null;
        var statuses = window.userStatuses || [];
        for (var i = 0; i < statuses.length; i++) {
            var su = statuses[i];
            if (!su || su.userId !== userId) continue;
            if (!_liveItems(su).length) return null;
            var viewedMap = {};
            try { viewedMap = JSON.parse(localStorage.getItem('emp_viewed_statuses') || '{}'); } catch (e) {}
            return { idx: i, viewed: !!(viewedMap[userId] || su.viewed) };
        }
        return null;
    };
    function _curSU(){return(window.userStatuses||[])[window._currentStatusUser];}
    function _timeAgo(iso){var ts=_parseTs(iso);if(!ts)return '';var s=Math.floor((Date.now()-ts)/1000);if(s<60)return 'Just now';if(s<3600)return Math.floor(s/60)+'m ago';return Math.floor(s/3600)+'h ago';}
    /* FEATURE (2026-09-13 — voice note playback): mm:ss formatter for the
       viewer's #sv-voice-timer, referenced from _showItem()'s voice branch
       above. Function declarations are hoisted within this IIFE, so its
       physical position here (rather than up near _showItem) is fine —
       kept beside _timeAgo since both are small display-time formatters. */
    function _fmtSvTime(s){ s=Math.max(0,Math.round(s||0)); var m=Math.floor(s/60),ss=s%60; return m+':'+(ss<10?'0':'')+ss; }
    function _goProfile(uid){if(typeof window.renderUserProfile==='function')window.renderUserProfile(uid);if(typeof window.navigateTo==='function')window.navigateTo('profile');}
    function _openChat(uid,msg){if(typeof window.navigateTo==='function')window.navigateTo('messages');setTimeout(function(){var fn=window.openChatWith||window.openChat;if(typeof fn==='function')fn(uid,msg);},400);}
    var _svPendingUserFetch = {};
    /* mockUsers only holds profiles the poster has already interacted with
       (followed, chatted with, etc.) — a viewer outside that set was falling
       through every check and rendering their raw uid as the display name.
       Fetch the missing profile from Firestore once, cache it, then
       re-render the open panel so the real name/avatar appear. */
    function _fetchViewerProfile(uid){
        if(!uid||_svPendingUserFetch[uid]||(window.mockUsers&&window.mockUsers[uid])||!window.fbDb) return;
        _svPendingUserFetch[uid]=true;
        function _hasName(d){ return !!(d&&(d.fullName||d.username||d.name||d.displayName)); }
        function _store(d){
            if(!d) return false;
            if(!d.fullName && !d.username) d.fullName=d.name||d.displayName||'';
            if(!d.id) d.id=uid;
            if(!window.mockUsers) window.mockUsers={};
            window.mockUsers[uid]=d;
            var panel=document.getElementById('sv-viewers-panel');
            if(panel&&panel.classList.contains('open')) _populateViewers();
            return true;
        }
        /* FIX (2026-10-30): the lookup only tried users/{uid}. The recurring Auth-UID vs app-user-id mismatch means a viewer's recorded id
           may be stored in the profile's id/uid FIELD rather than as the document id, so fall back to those queries. */
        function _byField(f){
            return window.fbDb.collection('users').where(f,'==',uid).limit(1).get().then(function(q){
                var d=null; if(q&&!q.empty){ q.forEach(function(x){ if(!d) d=x.data(); }); }
                return _hasName(d)?d:null;
            }).catch(function(){ return null; });
        }
        window.fbDb.collection('users').doc(uid).get().then(function(doc){
            var d=(doc&&doc.exists)?doc.data():null;
            if(_hasName(d)) return d;
            return _byField('id').then(function(r){ return r||_byField('uid'); });
        }).then(function(d){ if(d) _store(d); }).catch(function(){}).then(function(){ delete _svPendingUserFetch[uid]; });
    }
    function _lookupUser(uid,stored){var m=window.mockUsers&&window.mockUsers[uid];if(m&&(m.fullName||m.username||m.name||m.displayName))return{name:m.fullName||m.username||m.name||m.displayName,avatar:m.avatar||(stored&&stored.avatar)||''};if(stored&&stored.name)return{name:stored.name,avatar:stored.avatar||''};if(m)return{name:'Empyrean User',avatar:m.avatar||''};var f=(window.userStatuses||[]).find(function(s){return s.userId===uid;});if(f)return{name:f.name||'Empyrean User',avatar:f.avatar||''};_fetchViewerProfile(uid);return{name:'Empyrean User',avatar:''};}

    /* =========================================================================
       §13b  SCROLL-TO-HIDE STATUS BAR (point #3)
       Facebook/Instagram-style: scrolling down hides the status bar so it
       stops sitting over the feed; scrolling up — or returning near the
       top — reveals it again. Listens on .main-content, the app's actual
       scroll container (confirmed in app-nav.js: navigateTo() resets
       `.main-content.scrollTop = 0` on every section change, which is also
       why the bar correctly re-shows on navigation — scrollTop 0 always
       counts as "near top" below). Pure CSS class toggle — no layout
       changes, no interference with the sticky positioning itself.
       ========================================================================= */
    function _wireStatusBarScrollHide(){
        var mc = document.querySelector('.main-content');
        if (!mc || mc._svScrollWired) return;
        mc._svScrollWired = true;
        var lastY = mc.scrollTop;
        var THRESHOLD = 6;     // ignore sub-pixel/jitter scroll noise
        var NEAR_TOP  = 40;    // always show once back near the very top
        mc.addEventListener('scroll', function(){
            var bar = document.getElementById('status-bar-container');
            if (!bar) return;
            var y = mc.scrollTop;
            var dy = y - lastY;
            if (y <= NEAR_TOP) {
                bar.classList.remove('status-bar-hidden');
            } else if (dy > THRESHOLD) {
                bar.classList.add('status-bar-hidden');       // scrolling down → hide
            } else if (dy < -THRESHOLD) {
                bar.classList.remove('status-bar-hidden');    // scrolling up → reveal
            }
            lastY = y;
        }, { passive: true });
    }

    /* ── boot ── */
    _injectStyles();

    document.addEventListener('empyrean-init-done',function(){
        if(!window.userStatuses)window.userStatuses=[];
        _purge();
        setTimeout(renderStatusBar,400);
        setTimeout(_wireCreateModal,700);
        setTimeout(_wireStatusBarScrollHide,400);
    });
    document.addEventListener('empyrean-user-ready',function(){
        _purge();setTimeout(renderStatusBar,200);
    });
    document.addEventListener('empyrean-section-change',function(){
        var bar = document.getElementById('status-bar-container');
        if (bar) bar.classList.remove('status-bar-hidden');
        setTimeout(_wireStatusBarScrollHide,200);
    });
    document.addEventListener('click',function(e){
        if(e.target.closest&&(e.target.closest('#add-my-status-btn')||e.target.closest('[data-modal="create-status-modal"]')))
            setTimeout(_wireCreateModal,200);
    });
    setInterval(_purge,5*60*1000);
    if(document.readyState!=='loading'){
        if(!window.userStatuses)window.userStatuses=[];
        setTimeout(renderStatusBar,800);
        setTimeout(_wireCreateModal,1000);
    }

    console.log('[EmpStatus v4] ✅ Fixed: no listener stacking, bubble hearts in sv-content, peek-on-tap, viewers panel, direct Cloudinary upload.');

})();