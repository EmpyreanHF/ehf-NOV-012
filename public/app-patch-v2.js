/* ═══════════════════════════════════════════════════════════════════════════
   app-patch-v2.js  —  Empyrean Platform
   Loads AFTER app-fix-final.js.

   §P1  POST THREAD — full X-style overlay (open on post click, comments,
        back button to return home, floating comment FAB)
        Note: app-fix-final.js §34 comment block was a stub — full
        implementation lives HERE.

   §P2  MESSAGES — voice/video/call buttons in the chat header.
        Note: app-fix-final.js §36 comment block was a stub — full
        implementation lives HERE.

   §P3  MARKETPLACE — remove duplicate contact buttons.
        Suppresses §35's .vf-market-tabs everywhere.
        Escrow cards keep only "Add to Cart".
        Direct-sale cards keep only their native .contact-seller-btn.
        No extra contact buttons added to either card type.

═══════════════════════════════════════════════════════════════════════════ */
(function empyreanPatchV2() {
    'use strict';

    /* FIX (2026-07-21 — echo/frozen-tap follow-up audit): this file had no
       guard against running twice on the same page load (the same re-
       execution behavior documented in app-patch-v35.js's header, and the
       same mechanism fixed at the source in app-live.js/app-fix-final.js
       this session). A second execution would re-register this file's
       document-level click listener(s) on top of the first copy. Guarding
       here matches the convention already used by app-patch-v30.js onward. */
    if (window._empPatchV2Loaded) {
        console.warn('[V2] Already loaded — skipping duplicate execution (prevents duplicate click listeners).');
        return;
    }
    window._empPatchV2Loaded = true;

    /* ── Force quick-post-fab to plus icon at runtime ── */
    (function () {
        var SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style="pointer-events:none"><path d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1z"/></svg>';
        function fix() { var f=document.getElementById('quick-post-fab'); if(f&&!f.querySelector('svg')) f.innerHTML=SVG; }
        if(document.readyState!=='loading') fix(); else document.addEventListener('DOMContentLoaded',fix);
        setTimeout(fix,500); setTimeout(fix,1500);
    }());

    /* ── Shared helpers ── */
    function _ready(fn) {
        if (document.readyState !== 'loading') { fn(); }
        else { document.addEventListener('DOMContentLoaded', fn); }
    }
    function _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function _us() {
        return (window.EmpState && window.EmpState.userState) || window.userState || {};
    }
    function _isGuest() {
        var s = window.EmpState || {};
        if (s.isGuest != null) return !!s.isGuest;
        if (window.isGuest != null) return !!window.isGuest;
        var u = _us();
        if (u && u.id && u.id !== 'guest' && !String(u.id).startsWith('guest-')) return false;
        return true;
    }
    function _fbOk() {
        return !!(window._firebaseLoaded && window.fbDb && typeof window.fbDb.collection === 'function');
    }
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
        else console.log('[PatchV2]', type, msg);
    }


    /* ═══════════════════════════════════════════════════════════════════
       §P1  POST THREAD — X-style full-screen overlay
       Opens when any post is clicked (but not on action buttons).
       Shows: post content, existing comments, comment composer,
       a ← back button that returns to the feed/home, and a
       floating 💬 FAB to focus the composer.
    ═══════════════════════════════════════════════════════════════════ */
    (function patchPostThread() {
        /* ── Skip entirely if app-thread.js is loaded (it replaces this section) ── */
        if (window._empyreanThreadLoaded) {
            console.log('[§P1] app-thread.js detected — skipping patchPostThread.');
            return;
        }

        /* ── CSS ── */
        _ready(function () {
            if (document.getElementById('_pv2_thread_css')) return;
            var s = document.createElement('style');
            s.id = '_pv2_thread_css';
            s.textContent = [
                /* Overlay backdrop */
                '#vf-thread{',
                '  position:fixed;inset:0;z-index:100000;',
                '  background:#fff;',
                '  display:flex;flex-direction:column;',
                '  transform:translateX(100%);',
                '  transition:transform 0.28s cubic-bezier(0.4,0,0.2,1);',
                '  overscroll-behavior:contain;',
                '}',
                '#vf-thread.vf-open{ transform:translateX(0); }',

                /* Thread top bar */
                '#vf-th-topbar{',
                '  display:flex;align-items:center;gap:10px;',
                '  padding:12px 16px;',
                '  background:#fff;',
                '  border-bottom:1px solid rgba(10,14,39,0.08);',
                '  position:sticky;top:0;z-index:100001;',
                '  box-shadow:0 1px 8px rgba(10,14,39,0.06);',
                '  flex-shrink:0;',
                '}',

                /* Back button */
                '#vf-th-back{',
                '  width:40px;height:40px;border-radius:50%;',
                '  background:rgba(10,14,39,0.05);border:none;',
                '  cursor:pointer;display:flex;align-items:center;justify-content:center;',
                '  color:#0A0E27;font-size:1.1rem;flex-shrink:0;',
                '  -webkit-tap-highlight-color:transparent;',
                '  transition:background 0.15s;',
                '}',
                '#vf-th-back:active{ background:rgba(10,14,39,0.14); }',
                '#vf-th-topbar-title{',
                '  font-family:"Syne",sans-serif;font-weight:800;font-size:1.05rem;color:#0A0E27;',
                '}',

                /* Scrollable body */
                '#vf-th-body{',
                '  flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;',
                '  padding-bottom:80px;',
                '}',

                /* Original post area */
                '#vf-th-post-area{',
                '  padding:16px;border-bottom:8px solid rgba(10,14,39,0.04);',
                '}',
                '#vf-th-post-area .story-content p{ font-size:1rem;line-height:1.6;color:#0A0E27;margin:0 0 12px; }',
                '#vf-th-post-area .story-header{ display:flex;gap:10px;align-items:center;margin-bottom:12px; }',
                '#vf-th-post-area .avatar-placeholder img{ width:42px;height:42px;border-radius:50%;object-fit:cover; }',
                '#vf-th-post-area .story-user-info strong{ display:block;font-weight:700;color:#0A0E27;font-size:0.92rem; }',
                '#vf-th-post-area .story-user-info span{ font-size:0.75rem;color:#6B7280; }',

                /* Comment count header */
                '#vf-th-comment-hdr{',
                '  padding:12px 16px 6px;',
                '  font-family:"Syne",sans-serif;font-weight:700;font-size:0.9rem;color:#0A0E27;',
                '  border-bottom:1px solid rgba(10,14,39,0.05);',
                '}',

                /* Comment list */
                '#vf-th-comment-list{',
                '  padding:0;',
                '}',
                '.vf-th-comment-item{',
                '  display:flex;gap:10px;padding:12px 16px;',
                '  border-bottom:1px solid rgba(10,14,39,0.04);',
                '}',
                '.vf-th-comment-item img{ width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0; }',
                '.vf-th-comment-bubble{',
                '  background:rgba(10,14,39,0.04);border-radius:0 14px 14px 14px;',
                '  padding:8px 12px;flex:1;min-width:0;',
                '}',
                '.vf-th-comment-bubble strong{ display:block;font-size:0.82rem;color:#0A0E27;margin-bottom:3px;font-weight:700; }',
                '.vf-th-comment-bubble p{ margin:0;font-size:0.88rem;color:#374151;line-height:1.5; }',
                '.vf-th-comment-time{ font-size:0.7rem;color:#9CA3AF;margin-top:4px;display:block; }',
                '.vf-th-no-comments{ padding:28px 16px;text-align:center;color:#9CA3AF;font-size:0.88rem; }',

                /* Composer bar — pinned bottom */
                '#vf-th-composer{',
                '  position:fixed;bottom:0;left:0;right:0;z-index:9600;',
                '  background:#fff;border-top:1px solid rgba(10,14,39,0.08);',
                '  padding:10px 14px;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px));',
                '  display:none;align-items:center;gap:10px;',
                '  box-shadow:0 -2px 16px rgba(10,14,39,0.08);',
                '}',
                '#vf-th-composer.vf-open{ display:flex; }',
                '#vf-th-comp-av{ width:34px;height:34px;border-radius:50%;object-fit:cover;flex-shrink:0; }',
                '#vf-th-comp-inp{',
                '  flex:1;padding:10px 14px;border-radius:24px;',
                '  background:rgba(10,14,39,0.05);border:1.5px solid rgba(10,14,39,0.08);',
                '  font-size:0.9rem;font-family:inherit;outline:none;',
                '  transition:border-color 0.2s;',
                '}',
                '#vf-th-comp-inp:focus{ border-color:var(--secondary,#1B2B8B); }',
                '#vf-th-comp-send{',
                '  width:40px;height:40px;border-radius:50%;',
                '  background:var(--secondary,#1B2B8B);border:none;',
                '  display:flex;align-items:center;justify-content:center;',
                '  cursor:pointer;flex-shrink:0;color:#fff;font-size:0.9rem;',
                '  transition:opacity 0.18s;',
                '}',
                '#vf-th-comp-send:active{ opacity:0.7; }',

                /* Floating comment FAB */
                '#vf-th-comment-fab{',
                '  position:fixed;bottom:76px;right:18px;z-index:9700;',
                '  width:50px;height:50px;border-radius:50%;',
                '  background:var(--secondary,#1B2B8B);color:#fff;border:none;',
                '  cursor:pointer;display:none;align-items:center;justify-content:center;',
                '  font-size:1.2rem;box-shadow:0 4px 18px rgba(27,43,139,0.35);',
                '  transition:transform 0.18s;-webkit-tap-highlight-color:transparent;',
                '}',
                '#vf-th-comment-fab:active{ transform:scale(0.9); }',
                '#vf-th-comment-fab.vf-open{ display:flex; }',

                /* Hide bottom nav while thread is open */
                'body.vf-thread-open #mobile-bottom-nav{ display:none!important; }',

                /* ── Post action bar inside thread (like/retweet/quote/share) ── */
                '#vf-th-post-actions{',
                '  display:flex;align-items:center;gap:4px;',
                '  padding:8px 0 4px;border-top:1px solid rgba(10,14,39,0.06);margin-top:10px;',
                '}',
                '.vf-th-act-btn{',
                '  display:flex;align-items:center;gap:5px;',
                '  background:none;border:none;cursor:pointer;',
                '  color:#6B7280;font-size:0.8rem;padding:6px 10px;border-radius:20px;',
                '  transition:background 0.15s,color 0.15s;-webkit-tap-highlight-color:transparent;',
                '  flex:1;justify-content:center;',
                '}',
                '.vf-th-act-btn:active{ background:rgba(10,14,39,0.06); }',
                '.vf-th-act-btn.liked{ color:#E41E3F; }',
                '.vf-th-act-btn.retweeted{ color:#00B894; }',
                '.vf-th-act-btn i{ font-size:1rem; }',

                /* ── Comment action row (like, reply, quote, retweet, share per comment) ── */
                '.vf-th-comment-actions{',
                '  display:flex;align-items:center;gap:2px;margin-top:6px;',
                '}',
                '.vf-th-cmt-act{',
                '  display:flex;align-items:center;gap:3px;',
                '  background:none;border:none;cursor:pointer;',
                '  color:#9CA3AF;font-size:0.7rem;padding:4px 7px;border-radius:14px;',
                '  transition:background 0.15s,color 0.15s;-webkit-tap-highlight-color:transparent;',
                '}',
                '.vf-th-cmt-act:active{ background:rgba(10,14,39,0.05); }',
                '.vf-th-cmt-act.liked{ color:#E41E3F; }',
                '.vf-th-cmt-act.retweeted{ color:#00B894; }',
                '.vf-th-cmt-act i{ font-size:0.8rem; }',

                /* ── Sub-comment (reply) thread ── */
                '.vf-th-subreplies{',
                '  margin-top:6px;padding-left:12px;',
                '  border-left:2px solid rgba(10,14,39,0.07);',
                '}',
                '.vf-th-subreply-item{',
                '  display:flex;gap:8px;padding:7px 0;',
                '}',
                '.vf-th-subreply-item img{ width:26px;height:26px;border-radius:50%;object-fit:cover;flex-shrink:0; }',
                '.vf-th-subreply-bubble{',
                '  background:rgba(10,14,39,0.03);border-radius:0 10px 10px 10px;',
                '  padding:6px 10px;flex:1;min-width:0;',
                '}',
                '.vf-th-subreply-bubble strong{ display:block;font-size:0.75rem;color:#0A0E27;font-weight:700;margin-bottom:2px; }',
                '.vf-th-subreply-bubble p{ margin:0;font-size:0.82rem;color:#374151;line-height:1.45; }',

                /* ── Inline sub-reply composer (appears below a comment on "Reply" tap) ── */
                '.vf-th-subreply-composer{',
                '  display:flex;gap:8px;align-items:center;',
                '  padding:8px 0 4px;',
                '}',
                '.vf-th-subreply-composer img{ width:26px;height:26px;border-radius:50%;object-fit:cover;flex-shrink:0; }',
                '.vf-th-subreply-inp{',
                '  flex:1;padding:7px 12px;border-radius:18px;',
                '  background:rgba(10,14,39,0.05);border:1.5px solid rgba(10,14,39,0.08);',
                '  font-size:0.82rem;font-family:inherit;outline:none;',
                '  transition:border-color 0.2s;',
                '}',
                '.vf-th-subreply-inp:focus{ border-color:var(--secondary,#1B2B8B); }',
                '.vf-th-subreply-send{',
                '  width:32px;height:32px;border-radius:50%;',
                '  background:var(--secondary,#1B2B8B);border:none;',
                '  display:flex;align-items:center;justify-content:center;',
                '  cursor:pointer;flex-shrink:0;color:#fff;font-size:0.75rem;',
                '  transition:opacity 0.18s;',
                '}',
                '.vf-th-subreply-send:active{ opacity:0.7; }',

                /* ── Quote tweet modal ── */
                '#vf-th-quote-modal{',
                '  position:fixed;inset:0;z-index:10000;',
                '  background:rgba(0,0,0,0.5);display:none;',
                '  align-items:flex-end;justify-content:center;',
                '}',
                '#vf-th-quote-modal.vf-open{ display:flex; }',
                '#vf-th-quote-inner{',
                '  background:#fff;border-radius:20px 20px 0 0;',
                '  width:100%;max-height:80vh;display:flex;flex-direction:column;',
                '  padding:16px;gap:12px;',
                '}',
                '#vf-th-quote-inner h4{ margin:0;font-size:1rem;font-weight:800;color:#0A0E27; }',
                '#vf-th-quote-preview{',
                '  border:1px solid rgba(10,14,39,0.12);border-radius:12px;',
                '  padding:10px 12px;font-size:0.82rem;color:#6B7280;line-height:1.5;',
                '}',
                '#vf-th-quote-inp{',
                '  width:100%;padding:10px 14px;border-radius:14px;',
                '  background:rgba(10,14,39,0.04);border:1.5px solid rgba(10,14,39,0.1);',
                '  font-size:0.9rem;font-family:inherit;outline:none;resize:none;min-height:80px;',
                '  transition:border-color 0.2s;',
                '}',
                '#vf-th-quote-inp:focus{ border-color:var(--secondary,#1B2B8B); }',
                '#vf-th-quote-actions{display:flex;gap:10px;justify-content:flex-end;}',
                '.vf-th-quote-cancel{',
                '  padding:9px 18px;border-radius:20px;border:1.5px solid rgba(10,14,39,0.15);',
                '  background:none;font-size:0.88rem;cursor:pointer;color:#6B7280;',
                '}',
                '.vf-th-quote-submit{',
                '  padding:9px 20px;border-radius:20px;border:none;',
                '  background:var(--secondary,#1B2B8B);color:#fff;',
                '  font-size:0.88rem;font-weight:700;cursor:pointer;',
                '  transition:opacity 0.18s;',
                '}',
                '.vf-th-quote-submit:active{ opacity:0.8; }',
            ].join('\n');
            document.head.appendChild(s);
        });

        /* ── Build the overlay element (once) ── */
        function _ensureThread() {
            if (document.getElementById('vf-thread')) return document.getElementById('vf-thread');
            var ov = document.createElement('div');
            ov.id = 'vf-thread';
            ov.setAttribute('role','dialog');
            ov.setAttribute('aria-modal','true');
            ov.setAttribute('aria-label','Post Thread');
            ov.innerHTML = [
                /* Top bar */
                '<div id="vf-th-topbar">',
                '  <button id="vf-th-back" aria-label="Back to feed" title="Back to feed">',
                '    <i class="fas fa-arrow-left"></i>',
                '  </button>',
                '  <span id="vf-th-topbar-title">Post</span>',
                '</div>',
                /* Scrollable body */
                '<div id="vf-th-body">',
                '  <div id="vf-th-post-area"></div>',
                '  <!-- post action bar injected here by _renderPostActions -->',
                '  <div id="vf-th-comment-hdr">Comments <span id="vf-th-comment-cnt"></span></div>',
                '  <div id="vf-th-comment-list"></div>',
                '</div>',
                /* Composer bar pinned to bottom */
                '<div id="vf-th-composer">',
                '  <img id="vf-th-comp-av" src="" alt="You" ',
                '    onerror="this.src=\'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=80\'">',
                '  <input id="vf-th-comp-inp" type="text" placeholder="Post your reply…" autocomplete="off">',
                '  <button id="vf-th-comp-send" aria-label="Send reply">',
                '    <i class="fas fa-paper-plane"></i>',
                '  </button>',
                '</div>',
            ].join('');
            document.body.appendChild(ov);

            /* Quote tweet modal (appended to body so it overlays the thread overlay) */
            if (!document.getElementById('vf-th-quote-modal')) {
                var qm = document.createElement('div');
                qm.id = 'vf-th-quote-modal';
                qm.innerHTML = [
                    '<div id="vf-th-quote-inner">',
                    '  <h4><i class="fas fa-quote-left" style="margin-right:8px;color:#1B2B8B;"></i>Quote Post</h4>',
                    '  <div id="vf-th-quote-preview"></div>',
                    '  <textarea id="vf-th-quote-inp" placeholder="Add your thoughts…"></textarea>',
                    '  <div id="vf-th-quote-actions">',
                    '    <button class="vf-th-quote-cancel">Cancel</button>',
                    '    <button class="vf-th-quote-submit">Quote</button>',
                    '  </div>',
                    '</div>',
                ].join('');
                document.body.appendChild(qm);
                qm.querySelector('.vf-th-quote-cancel').addEventListener('click', function () {
                    qm.classList.remove('vf-open');
                });
                qm.querySelector('.vf-th-quote-submit').addEventListener('click', _submitQuote);
                qm.addEventListener('click', function (e) { if (e.target === qm) qm.classList.remove('vf-open'); });
            }

            /* Back button → close thread and return to feed */
            ov.querySelector('#vf-th-back').addEventListener('click', _close);

            /* Send reply */
            var inp  = ov.querySelector('#vf-th-comp-inp');
            var send = ov.querySelector('#vf-th-comp-send');
            send.addEventListener('click', _sendReply);
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendReply(); }
            });

            return ov;
        }

        /* ── Build FAB ── */
        function _ensureFab() {
            if (document.getElementById('vf-th-comment-fab')) return;
            var fab = document.createElement('button');
            fab.id = 'vf-th-comment-fab';
            fab.title = 'Write a reply';
            fab.setAttribute('aria-label','Write a reply');
            fab.innerHTML = '<i class="far fa-comment"></i>';
            document.body.appendChild(fab);
            fab.addEventListener('click', function () {
                var inp = document.getElementById('vf-th-comp-inp');
                if (inp) { inp.focus(); inp.scrollIntoView({ behavior:'smooth', block:'center' }); }
            });
        }

        /* ── Current thread state ── */
        var _activePostId  = null;
        var _activePostEl  = null;

        /* ── Open thread overlay for a given post card ── */
        function openThread(postEl) {
            if (!postEl) return;
            var ov = _ensureThread();
            _ensureFab();
            _activePostEl = postEl;
            _activePostId = postEl.dataset.postId || postEl.dataset.id || null;

            /* Populate the post-area with a clone of the post's key sections */
            var area = document.getElementById('vf-th-post-area');
            area.innerHTML = '';

            /* Author header */
            var header = postEl.querySelector('.story-header');
            if (header) area.innerHTML += header.outerHTML;

            /* Media */
            var media = postEl.querySelector('.story-media-container');
            if (media) area.innerHTML += media.outerHTML;

            /* Text content */
            var content = postEl.querySelector('.story-content');
            if (content) area.innerHTML += content.outerHTML;

            /* Render interactive like / retweet / quote / share action bar */
            _renderPostActions(area, postEl);

            /* Load existing comments */
            _loadComments();

            /* Composer avatar */
            var av = document.getElementById('vf-th-comp-av');
            var u  = _us();
            if (av) {
                av.src = u.avatar || u.profilePhoto ||
                    'https://ui-avatars.com/api/?name=' +
                    encodeURIComponent(u.fullName || 'U') + '&background=1B2B8B&color=fff&size=80';
            }

            /* Open */
            ov.classList.add('vf-open');
            document.body.classList.add('vf-thread-open');
            /* Hide hamburger so it doesn't overlap the back button */
            var _hmb = document.querySelector('.mobile-menu-toggle');
            if (_hmb) _hmb.style.setProperty('display','none','important');
            var composer = document.getElementById('vf-th-composer');
            if (composer) composer.classList.add('vf-open');
            var fab = document.getElementById('vf-th-comment-fab');
            if (fab) fab.classList.add('vf-open');

            /* Scroll to top */
            var body = document.getElementById('vf-th-body');
            if (body) body.scrollTop = 0;
        }
        /* FIX (duplicate thread system): app-thread.js defines the complete,
           canonical _vfOpenThread (proper likes+likedBy, shareCount,
           quoteCount, commentCount). It loads BEFORE this file, so without
           this guard the line below would silently clobber it every page
           load — which is why app-patch-v5/v6's _vfOpenThread wrappers have
           actually been wrapping THIS file's older implementation instead of
           app-thread.js's. Only assign if nothing has claimed it yet. */
        if (typeof window._vfOpenThread !== 'function') window._vfOpenThread = openThread;

        /* ── Close thread overlay ── */
        function _close() {
            var ov = document.getElementById('vf-thread');
            if (ov) ov.classList.remove('vf-open');
            document.body.classList.remove('vf-thread-open');
            var composer = document.getElementById('vf-th-composer');
            if (composer) composer.classList.remove('vf-open');
            var fab = document.getElementById('vf-th-comment-fab');
            if (fab) fab.classList.remove('vf-open');
            /* Restore hamburger menu */
            var hmb = document.querySelector('.mobile-menu-toggle');
            if (hmb) hmb.style.removeProperty('display');
            /* Clear composer input */
            var inp = document.getElementById('vf-th-comp-inp');
            if (inp) inp.value = '';
            _activePostId = null;
            _activePostEl = null;
            /* Navigate back to dashboard */
            if (typeof window.navigateTo === 'function') window.navigateTo('dashboard');
        }
        window._vfCloseThread = _close;

        /* ── Delegated back-button click (capture phase failsafe) ── */
        document.addEventListener('click', function (e) {
            if (e.target && e.target.closest && e.target.closest('#vf-th-back')) {
                e.preventDefault(); e.stopPropagation(); _close();
            }
        }, true);

        /* ── Render live action bar on the post (like/retweet/quote tweet/share) ── */
        function _renderPostActions(area, postEl) {
            var existing = area.querySelector('#vf-th-post-actions');
            if (existing) existing.remove();

            var u = _us();
            var postId = _activePostId || '';
            /* Read current counts from the original post element */
            var likeEl = postEl.querySelector('.like-count,.likes-count,[class*="like-count"]');
            var rtEl   = postEl.querySelector('.retweet-count,.rt-count,[class*="retweet"]');
            var likeCount = parseInt((likeEl && likeEl.textContent) || '0', 10) || 0;
            var rtCount   = parseInt((rtEl   && rtEl.textContent)   || '0', 10) || 0;

            var bar = document.createElement('div');
            bar.id = 'vf-th-post-actions';

            /* Like button */
            var likeBtn = document.createElement('button');
            likeBtn.className = 'vf-th-act-btn';
            likeBtn.dataset.action = 'like';
            likeBtn.innerHTML = '<i class="far fa-heart"></i><span>' + (likeCount || '') + '</span>';
            likeBtn.addEventListener('click', function () {
                if (_isGuest()) { if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); return; }
                var liked = likeBtn.classList.toggle('liked');
                likeBtn.querySelector('i').className = liked ? 'fas fa-heart' : 'far fa-heart';
                var n = likeCount + (liked ? 1 : -1);
                likeCount = Math.max(0, n);
                likeBtn.querySelector('span').textContent = likeCount || '';
                /* Delegate to app like handler if present */
                if (postId && typeof window.toggleLike === 'function') window.toggleLike(postId);
                else if (postId && _fbOk()) {
                    try {
                        // FIX (collection routing, defense-in-depth): this fallback action
                        // bar only renders if app-thread.js's canonical _vfOpenThread failed
                        // to claim window._vfOpenThread first. Mirrors _col45() so a
                        // crisis-report card doesn't write likes into 'posts' by mistake.
                        var _pv2Col = (postEl.classList && postEl.classList.contains('crisis-report'))
                            ? 'crisis_reports'
                            : (postEl.classList && postEl.classList.contains('biz-post-card'))
                                ? 'business_posts' : 'posts';
                        var ref = window.fbDb.collection(_pv2Col).doc(postId);
                        ref.update({ likes: likeCount });
                    } catch (e) {}
                }
                /* Mirror into source card */
                if (likeEl) likeEl.textContent = likeCount || '0';
            });

            /* Retweet button */
            var rtBtn = document.createElement('button');
            rtBtn.className = 'vf-th-act-btn';
            rtBtn.dataset.action = 'retweet';
            rtBtn.innerHTML = '<i class="fas fa-retweet"></i><span>' + (rtCount || '') + '</span>';
            rtBtn.addEventListener('click', function () {
                if (_isGuest()) { if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); return; }
                var rted = rtBtn.classList.toggle('retweeted');
                var n = rtCount + (rted ? 1 : -1);
                rtCount = Math.max(0, n);
                rtBtn.querySelector('span').textContent = rtCount || '';
                _notify(rted ? 'Reposted!' : 'Repost removed', 'success');
                if (postId && _fbOk()) {
                    try {
                        var _pv2ColRt = (postEl.classList && postEl.classList.contains('crisis-report'))
                            ? 'crisis_reports'
                            : (postEl.classList && postEl.classList.contains('biz-post-card'))
                                ? 'business_posts' : 'posts';
                        window.fbDb.collection(_pv2ColRt).doc(postId).update({ retweetCount: rtCount });
                    } catch (e) {}
                }
            });

            /* Quote Tweet button */
            var qtBtn = document.createElement('button');
            qtBtn.className = 'vf-th-act-btn';
            qtBtn.dataset.action = 'quote';
            qtBtn.innerHTML = '<i class="fas fa-quote-right"></i><span>Quote</span>';
            qtBtn.addEventListener('click', function () {
                if (_isGuest()) { if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); return; }
                _openQuoteModal(postEl);
            });

            /* Share button */
            var shareBtn = document.createElement('button');
            shareBtn.className = 'vf-th-act-btn';
            shareBtn.dataset.action = 'share';
            shareBtn.innerHTML = '<i class="fas fa-share-alt"></i><span>Share</span>';
            shareBtn.addEventListener('click', function () {
                var text = (postEl.querySelector('.story-content p') || {}).textContent || 'Check this out on Empyrean';
                if (navigator.share) {
                    navigator.share({ title: 'Empyrean Post', text: text, url: window.location.href }).catch(function () {});
                } else {
                    try { navigator.clipboard.writeText(window.location.href); _notify('Link copied!', 'success'); } catch (e) { _notify('Share: ' + text.slice(0,60), 'info'); }
                }
            });

            bar.appendChild(likeBtn);
            bar.appendChild(rtBtn);
            bar.appendChild(qtBtn);
            bar.appendChild(shareBtn);
            area.appendChild(bar);
        }

        /* ── Open the Quote Tweet modal ── */
        function _openQuoteModal(postEl) {
            var qm = document.getElementById('vf-th-quote-modal');
            var qp = document.getElementById('vf-th-quote-preview');
            var qi = document.getElementById('vf-th-quote-inp');
            if (!qm || !qp) return;
            var authorEl = postEl.querySelector('.story-user-info strong, .post-author, .author-name');
            var textEl   = postEl.querySelector('.story-content p, .post-text');
            qp.innerHTML = '<strong>' + _esc((authorEl && authorEl.textContent) || 'User') + '</strong>: '
                + _esc(((textEl && textEl.textContent) || '').slice(0, 120));
            if (qi) qi.value = '';
            qm.classList.add('vf-open');
            setTimeout(function () { if (qi) qi.focus(); }, 100);
        }

        /* ── Submit a Quote Tweet ── */
        function _submitQuote() {
            var qi = document.getElementById('vf-th-quote-inp');
            var qm = document.getElementById('vf-th-quote-modal');
            var text = qi ? (qi.value || '').trim() : '';
            if (!text) { _notify('Please add your thoughts before quoting.', 'warning'); return; }
            if (_isGuest()) { if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); return; }
            qm && qm.classList.remove('vf-open');
            _notify('Quote posted!', 'success');
            /* Persist to Firestore as a new post with quotedPostId ref */
            if (_fbOk()) {
                var u = _us();
                /* Build the quoted-post preview block and inject into the local feed immediately */
                var _qId = 'quote-' + Date.now() + '-' + Math.random().toString(36).slice(2,7);
                /* Grab quoted post metadata from the open thread for local display */
                var _qPostId = _activePostId || '';
                var _qAuthor = '';
                var _qText   = '';
                var _qMedia  = '';
                var _qPostEl = _qPostId && document.querySelector('[data-post-id="' + _qPostId + '"]');
                if (_qPostEl) {
                    var _qAEl = _qPostEl.querySelector('.story-author, .story-user-name, .author-name');
                    if (_qAEl) _qAuthor = (_qAEl.textContent || '').trim().replace(/^@/,'');
                    var _qTEl = _qPostEl.querySelector('.story-content p, .post-text, .story-text');
                    if (_qTEl) _qText = (_qTEl.textContent || '').trim().substring(0, 240);
                    var _qMEl = _qPostEl.querySelector('video[src], img.story-media-img, .story-media-item img, .story-media-item video');
                    if (_qMEl) _qMedia = _qMEl.src || '';
                }
                try {
                    window.fbDb.collection('posts').doc(_qId).set({
                        id:           _qId,
                        text:         text,
                        media:        [],
                        userId:       u.id || '',
                        username:     u.fullName || u.username || 'User',
                        avatar:       u.avatar || u.profilePhoto || '',
                        isQuote:      true,
                        quotedPostId: _qPostId,
                        quotedAuthor: _qAuthor,
                        quotedText:   _qText,
                        quotedMedia:  _qMedia,
                        createdAt:    new Date().toISOString()
                    });
                } catch (e) { console.warn('[Quote] Firestore save failed:', e && e.message); }
            }
        }
        /* FIX: Expose on window so app-fix-final.js mining wrapper can wrap it,
           and so the quote modal submit button can call it by name              */
        window._submitQuote = _submitQuote;

        /* ── Build sub-reply composer under a comment item ── */
        function _openSubReplyComposer(commentItem, commentId) {
            /* Remove any existing open sub-reply composer first */
            document.querySelectorAll('.vf-th-subreply-composer').forEach(function (c) { c.remove(); });
            var u = _us();
            var fallback = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(u.fullName || 'U') + '&background=1B2B8B&color=fff&size=80';
            var comp = document.createElement('div');
            comp.className = 'vf-th-subreply-composer';
            comp.innerHTML = '<img src="' + _esc(u.avatar || u.profilePhoto || fallback) + '" alt="You" onerror="this.src=\'' + fallback + '\'">'
                + '<input class="vf-th-subreply-inp" type="text" placeholder="Reply…" autocomplete="off">'
                + '<button class="vf-th-subreply-send" aria-label="Send sub-reply"><i class="fas fa-paper-plane"></i></button>';
            /* Inject after the comment bubble */
            var bubble = commentItem.querySelector('.vf-th-comment-bubble') || commentItem;
            bubble.parentNode.insertBefore(comp, bubble.nextSibling);
            var inp  = comp.querySelector('.vf-th-subreply-inp');
            var send = comp.querySelector('.vf-th-subreply-send');
            inp.focus();
            function doSend() {
                var text = (inp.value || '').trim();
                if (!text) return;
                /* Render the sub-reply inline */
                var replies = commentItem.querySelector('.vf-th-subreplies');
                if (!replies) {
                    replies = document.createElement('div');
                    replies.className = 'vf-th-subreplies';
                    commentItem.appendChild(replies);
                }
                var fallback2 = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(u.fullName || 'U') + '&background=1B2B8B&color=fff&size=80';
                var item = document.createElement('div');
                item.className = 'vf-th-subreply-item';
                item.innerHTML = '<img src="' + _esc(u.avatar || u.profilePhoto || fallback2) + '" alt="' + _esc(u.fullName || 'You') + '" onerror="this.src=\'' + fallback2 + '\'">'
                    + '<div class="vf-th-subreply-bubble"><strong>' + _esc(u.fullName || u.username || 'You') + '</strong><p>' + _esc(text) + '</p></div>';
                replies.appendChild(item);
                inp.value = '';
                comp.remove();
                /* Persist to Firestore */
                if (_fbOk() && _activePostId && commentId) {
                    try {
                        window.fbDb.collection('posts').doc(_activePostId)
                            .collection('comments').doc(commentId)
                            .collection('replies').add({
                                text: text,
                                authorId: u.id || '',
                                authorName: u.fullName || u.username || 'User',
                                authorAvatar: u.avatar || u.profilePhoto || '',
                                createdAt: new Date()
                            });
                    } catch (e) {}
                }
            }
            send.addEventListener('click', doSend);
            inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
        }

        /* ── Load & render comments ── */
        function _loadComments() {
            var list = document.getElementById('vf-th-comment-list');
            var cntEl = document.getElementById('vf-th-comment-cnt');
            if (!list) return;

            /* Start with comments already rendered in the post card's .comment-list */
            var srcList = _activePostEl && _activePostEl.querySelector('.comment-list');
            var existing = srcList ? srcList.querySelectorAll('.comment-item, [class*="comment"]') : [];

            list.innerHTML = '';

            if (existing.length === 0) {
                list.innerHTML = '<p class="vf-th-no-comments"><i class="far fa-comment" style="display:block;font-size:1.8rem;margin-bottom:8px;opacity:0.3;"></i>No replies yet.<br>Be the first to reply!</p>';
                if (cntEl) cntEl.textContent = '(0)';
                /* Also try Firestore */
                _fetchFirestoreComments(list, cntEl, []);
                return;
            }

            /* Render existing comment nodes */
            var arr = Array.from(existing);
            arr.forEach(function (c) { _renderComment(list, c); });
            if (cntEl) cntEl.textContent = '(' + arr.length + ')';

            /* Then fetch Firestore for more */
            _fetchFirestoreComments(list, cntEl, arr);
        }

        function _fetchFirestoreComments(list, cntEl, existingArr) {
            if (!_activePostId || !_fbOk()) return;
            try {
                window.fbDb.collection('posts').doc(_activePostId)
                    .collection('comments')
                    .orderBy('createdAt', 'asc')
                    .limit(100)
                    .get()
                    .then(function (snap) {
                        if (snap.empty) return;
                        var knownIds = new Set(existingArr.map(function (c) { return c.dataset && c.dataset.commentId; }));
                        snap.forEach(function (doc) {
                            if (knownIds.has(doc.id)) return;
                            var d = doc.data();
                            _renderCommentData(list, { id: doc.id, text: d.text || d.comment || '', authorName: d.authorName || d.username || 'User', authorAvatar: d.authorAvatar || '', createdAt: d.createdAt });
                            knownIds.add(doc.id);
                        });
                        if (cntEl) cntEl.textContent = '(' + list.querySelectorAll('.vf-th-comment-item').length + ')';
                    })
                    .catch(function () {});
            } catch (e) {}
        }

        function _renderComment(list, el) {
            /* Try to extract data from an existing DOM comment element */
            var avatar = '';
            var name   = 'User';
            var text   = '';
            var img = el.querySelector('img'); if (img) avatar = img.src;
            var strong = el.querySelector('strong,.comment-author'); if (strong) name = strong.textContent.trim();
            var p = el.querySelector('p,.comment-text,span:not(.comment-time)');
            if (p) { text = p.textContent.trim(); }
            else   { text = el.textContent.trim().replace(name,'').trim(); }
            _renderCommentData(list, { text: text, authorName: name, authorAvatar: avatar });
        }

        function _renderCommentData(list, data) {
            if (!data.text && !data.comment) return;
            /* Remove "no comments" placeholder */
            var ph = list.querySelector('.vf-th-no-comments'); if (ph) ph.remove();
            var commentId = data.id || ('cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2,7));
            var fallback = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(data.authorName||'U') + '&background=1B2B8B&color=fff&size=80';
            var ts = '';
            if (data.createdAt) {
                try { ts = (data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt)).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}); } catch(e) {}
            }
            var item = document.createElement('div');
            item.className = 'vf-th-comment-item';
            item.dataset.commentId = commentId;
            item.innerHTML = '<img src="' + _esc(data.authorAvatar || fallback) + '" alt="' + _esc(data.authorName||'User') + '" onerror="this.src=\'' + fallback + '\'">'
                + '<div class="vf-th-comment-bubble">'
                + '<strong>' + _esc(data.authorName||'User') + '</strong>'
                + '<p>' + _esc(data.text || data.comment || '') + '</p>'
                + (ts ? '<span class="vf-th-comment-time">' + _esc(ts) + '</span>' : '')
                /* Per-comment action row: like | reply | retweet | share */
                + '<div class="vf-th-comment-actions">'
                + '<button class="vf-th-cmt-act vf-cmt-like" title="Like" aria-label="Like comment"><i class="far fa-heart"></i> <span>0</span></button>'
                + '<button class="vf-th-cmt-act vf-cmt-reply" title="Reply" aria-label="Reply to comment"><i class="far fa-comment"></i> Reply</button>'
                + '<button class="vf-th-cmt-act vf-cmt-retweet" title="Repost" aria-label="Repost comment"><i class="fas fa-retweet"></i></button>'
                + '<button class="vf-th-cmt-act vf-cmt-share" title="Share" aria-label="Share comment"><i class="fas fa-share-alt"></i></button>'
                + '</div>'
                + '</div>'
                /* Sub-replies container (empty; filled when replies exist or user replies) */
                + '<div class="vf-th-subreplies" style="display:none"></div>';

            /* Wire up per-comment buttons */
            var likeBtn   = item.querySelector('.vf-cmt-like');
            var replyBtn  = item.querySelector('.vf-cmt-reply');
            var retweetBtn= item.querySelector('.vf-cmt-retweet');
            var shareBtn  = item.querySelector('.vf-cmt-share');

            likeBtn.addEventListener('click', function () {
                if (_isGuest()) { if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); return; }
                var liked = likeBtn.classList.toggle('liked');
                likeBtn.querySelector('i').className = liked ? 'fas fa-heart' : 'far fa-heart';
                var span = likeBtn.querySelector('span');
                var n = Math.max(0, parseInt(span.textContent || '0', 10) + (liked ? 1 : -1));
                span.textContent = n;
            });

            replyBtn.addEventListener('click', function () {
                if (_isGuest()) { if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); return; }
                /* Show sub-reply container */
                var repliesEl = item.querySelector('.vf-th-subreplies');
                if (repliesEl) repliesEl.style.display = '';
                _openSubReplyComposer(item, commentId);
            });

            retweetBtn.addEventListener('click', function () {
                if (_isGuest()) { if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); return; }
                var rted = retweetBtn.classList.toggle('retweeted');
                _notify(rted ? 'Comment reposted!' : 'Repost removed', 'success');
            });

            shareBtn.addEventListener('click', function () {
                var text = data.text || data.comment || '';
                if (navigator.share) {
                    navigator.share({ title: 'Empyrean', text: text, url: window.location.href }).catch(function () {});
                } else {
                    try { navigator.clipboard.writeText(text); _notify('Copied!', 'success'); } catch(e) {}
                }
            });

            list.appendChild(item);
        }

        /* ── Send a reply ── */
        function _sendReply() {
            if (_isGuest()) {
                if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
                return;
            }
            var inp  = document.getElementById('vf-th-comp-inp');
            if (!inp) return;
            var text = (inp.value || '').trim();
            if (!text) return;

            var u = _us();
            var now = new Date();
            /* Render immediately (optimistic) */
            var list = document.getElementById('vf-th-comment-list');
            var cntEl = document.getElementById('vf-th-comment-cnt');
            _renderCommentData(list, {
                text: text,
                authorName: u.fullName || u.username || 'You',
                authorAvatar: u.avatar || u.profilePhoto || '',
                createdAt: now
            });
            /* Update count */
            var n = list.querySelectorAll('.vf-th-comment-item').length;
            if (cntEl) cntEl.textContent = '(' + n + ')';

            /* Also inject into the source post card's comment list */
            if (_activePostEl) {
                var srcList = _activePostEl.querySelector('.comment-list');
                if (srcList) {
                    var c = document.createElement('div');
                    c.className = 'comment-item';
                    c.innerHTML = '<strong>' + _esc(u.fullName||'You') + '</strong>: ' + _esc(text);
                    srcList.appendChild(c);
                }
                /* Update comment count badge */
                var badge = _activePostEl.querySelector('.comment-count');
                if (badge) badge.textContent = String(parseInt(badge.textContent||'0',10) + 1);
            }

            inp.value = '';
            inp.focus();

            /* ── Award EMPY for replying (REPLY_POST mining) ── */
            if (typeof window._awardImpactMining === 'function') {
                window._awardImpactMining('REPLY_POST', _activePostId || ('reply-' + Date.now()));
            }

            /* Scroll to the new comment */
            var body = document.getElementById('vf-th-body');
            if (body) setTimeout(function () { body.scrollTop = body.scrollHeight; }, 80);

            /* Persist to Firestore */
            if (_fbOk() && _activePostId) {
                try {
                    window.fbDb.collection('posts').doc(_activePostId)
                        .collection('comments')
                        .add({
                            text: text,
                            authorId: u.id || '',
                            authorName: u.fullName || u.username || 'User',
                            authorAvatar: u.avatar || u.profilePhoto || '',
                            createdAt: new Date()
                        })
                        .then(function () {
                            /* Also update parent post comment count */
                            try {
                                window.fbDb.collection('posts').doc(_activePostId).update({
                                    commentCount: (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue)
                                        ? window.firebase.firestore.FieldValue.increment(1)
                                        : n
                                });
                            } catch (e2) {}
                        })
                        .catch(function (er) { _notify('Could not save reply. Please try again.','warning'); });
                } catch (e) {}
            }
        }

        /* ── Click delegation: open thread on post card click ──
           FIX (duplicate thread system): app-thread.js registers an
           identical bubble-phase listener on the same selectors and loads
           FIRST. Neither listener calls stopImmediatePropagation(), so
           without this guard BOTH fired on every tap — app-thread.js built
           its (correct) thread UI, then this one immediately rebuilt it
           with the older openThread()/_renderPostActions(), which is the
           direct cause of inconsistent like/retweet/quote/comment counts.
           app-thread.js's listener is the canonical one; this is now inert. */
        document.addEventListener('click', function (e) {
            return; /* superseded by app-thread.js's identical listener */
            /* Don't open thread if clicking on an action button, form, link, or the comment-btn itself */
            var t = e.target;
            if (t.closest('button,a,input,textarea,select,.options-btn,.options-menu,.action-btn,.comment-form,.story-actions,.sos-button,.help-now-btn,.donate-post-btn')) return;

            /* Only open from the feed container areas */
            var post = t.closest && t.closest(
                '#feed-container .impact-story,'+
                '#posts-feed .impact-story,'+
                '.feed-section .impact-story,'+
                '[id="dashboard"] .impact-story'
            );
            if (!post) return;

            e.preventDefault();
            e.stopPropagation();
            openThread(post);
        });

        /* ── Comment action-button (.comment-btn) also opens thread ──
           FIX (duplicate thread system): app-thread.js has an identical
           capture-phase listener that loads first; same double-fire issue
           as above. Inert — see fix above. */
        document.addEventListener('click', function (e) {
            return; /* superseded by app-thread.js's identical listener */
            var t = e.target;
            var btn = t.closest && t.closest('.comment-btn,.action-btn[title="Comment"]');
            if (!btn) return;
            var post = btn.closest('.impact-story');
            if (!post) return;
            e.preventDefault();
            e.stopPropagation();
            openThread(post);
        }, true);

        /* ── Escape key closes thread ── */
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { _close(); }
        });

        _ready(function () { _ensureThread(); _ensureFab(); });
        document.addEventListener('empyrean-init-done', function () {
            setTimeout(function () { _ensureThread(); _ensureFab(); }, 300);
        });

        console.log('[§P1] Post thread — X-style overlay, back button, comment FAB, Firestore replies.');
    })();


    /* ═══════════════════════════════════════════════════════════════════
       §P2  MESSAGES — full chat composer bar (text input, attach, voice
            note, send) + header call buttons (voice call, video call,
            profile info).  Both injected every time a conversation
            is opened, replacing any missing or broken native UI.
    ═══════════════════════════════════════════════════════════════════ */
    (function patchMessagesFull() {
        /* DISABLED — do not remove, kept for reference only.

           ROOT CAUSE of "messages not cross-populating between devices"
           and "video/voice call icons unresponsive":

           app-patch-openchat.js (loads AFTER this file) is the real,
           current chat implementation. It builds its own header/composer
           (#oc-composer, #oc-messages-body) and reads/writes messages
           from the top-level Firestore `messages` collection, filtered
           by senderId/receiverId.

           This §P2 module below has no awareness of app-patch-openchat.js
           at all. Its _watchChatContainer() MutationObserver fires any
           time #chat-view-container appears in the DOM — including when
           app-patch-openchat.js builds it — and ~180ms later injects a
           SECOND, competing composer bar (#vf-msg-composer) directly into
           that same container, on top of the real one. Critically, that
           composer's send button writes new messages to
           chats/{chatId}/messages (a SUBCOLLECTION) — a completely
           different location than the top-level `messages` collection
           app-patch-openchat.js listens on. Any message typed into this
           stray composer is written somewhere nobody ever reads it back
           from: it looks like it "failed to deliver" and never appears on
           either device, because it isn't actually going anywhere either
           side is watching.

           That same stray element getting injected into #chat-view-
           container after the real header is also the most likely cause
           of the video/voice call buttons going unresponsive — this is
           the same "an extra element gets injected into the chat
           container and swallows taps meant for the real header buttons"
           failure mode already fixed once before for the "two phone
           icons" bug (see app-patch-openchat.js's own SWEEP comment) —
           but that one-time sweep runs before this module's delayed
           (~180-280ms) injection, so it never catches this one.

           Since app-patch-openchat.js's composer/header already covers
           text, attach, voice note, send, and call buttons, this whole
           module is redundant on top of being actively harmful. Disabling
           it (early return) rather than deleting it, per this codebase's
           established fix convention. */
        return;

        /* ── CSS ── */
        _ready(function () {
            if (document.getElementById('_pv2_msg_css')) return;
            var s = document.createElement('style');
            s.id = '_pv2_msg_css';
            s.textContent = [
                /* ── Header call buttons ── */
                '.vf-call-btn{',
                '  width:38px;height:38px;border-radius:50%;border:none;cursor:pointer;',
                '  display:flex;align-items:center;justify-content:center;',
                '  font-size:1rem;transition:background 0.18s,transform 0.12s;flex-shrink:0;',
                '  -webkit-tap-highlight-color:transparent;',
                '}',
                '.vf-call-btn:active{ opacity:0.72; transform:scale(0.92); }',
                '.vf-call-btn.vf-voice{ background:rgba(16,185,129,0.12);color:#10B981; }',
                '.vf-call-btn.vf-video{ background:rgba(27,43,139,0.10);color:#1B2B8B; }',
                '.vf-call-btn.vf-info{  background:rgba(10,14,39,0.06);color:#374151; }',
                '.vf-call-btn.vf-voice:active{ background:rgba(16,185,129,0.28); }',
                '.vf-call-btn.vf-video:active{ background:rgba(27,43,139,0.25); }',
                '.vf-call-btn.vf-info:active{  background:rgba(10,14,39,0.14); }',

                /* Header layout */
                '#chat-header-info{',
                '  display:flex!important;align-items:center!important;',
                '  gap:8px!important;flex-wrap:nowrap!important;width:100%!important;',
                '}',
                '#chat-header-info .vf-call-actions{',
                '  display:flex;gap:6px;align-items:center;margin-left:auto;flex-shrink:0;',
                '}',

                /* ── Composer bar ── */
                '#vf-msg-composer{',
                '  display:flex;align-items:center;gap:6px;',
                '  padding:8px 10px;',
                '  padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));',
                '  background:#fff;',
                '  border-top:1px solid rgba(10,14,39,0.08);',
                '  box-shadow:0 -2px 12px rgba(10,14,39,0.06);',
                '  flex-shrink:0;',
                '  position:relative;',
                '}',

                /* Attach button */
                '#vf-msg-attach{',
                '  width:36px;height:36px;border-radius:50%;border:none;',
                '  background:rgba(10,14,39,0.05);color:#6B7280;',
                '  display:flex;align-items:center;justify-content:center;',
                '  cursor:pointer;flex-shrink:0;font-size:1rem;',
                '  -webkit-tap-highlight-color:transparent;transition:background 0.15s;',
                '}',
                '#vf-msg-attach:active{ background:rgba(10,14,39,0.14); }',

                /* Text input */
                '#vf-msg-input{',
                '  flex:1;padding:9px 14px;border-radius:22px;',
                '  background:rgba(10,14,39,0.05);',
                '  border:1.5px solid rgba(10,14,39,0.08);',
                '  font-size:0.92rem;font-family:inherit;outline:none;',
                '  transition:border-color 0.2s;min-height:38px;max-height:120px;',
                '  resize:none;line-height:1.4;overflow-y:auto;',
                '}',
                '#vf-msg-input:focus{ border-color:#1B2B8B; }',



                /* Send button */
                '#vf-msg-send{',
                '  width:38px;height:38px;border-radius:50%;border:none;',
                '  background:#1B2B8B;color:#fff;',
                '  display:flex;align-items:center;justify-content:center;',
                '  cursor:pointer;flex-shrink:0;font-size:0.95rem;',
                '  -webkit-tap-highlight-color:transparent;transition:opacity 0.18s,transform 0.12s;',
                '}',
                '#vf-msg-send:active{ opacity:0.8;transform:scale(0.92); }',

                /* Hidden file input */
                '#vf-msg-file{ display:none; }',

                /* Image preview strip above composer */
                '#vf-msg-preview{',
                '  display:none;gap:8px;padding:8px 10px 0;',
                '  overflow-x:auto;flex-wrap:nowrap;background:#fff;',
                '  border-top:1px solid rgba(10,14,39,0.06);',
                '}',
                '#vf-msg-preview.has-files{ display:flex; }',
                '.vf-msg-preview-item{',
                '  position:relative;flex-shrink:0;',
                '}',
                '.vf-msg-preview-item img{',
                '  width:60px;height:60px;object-fit:cover;border-radius:8px;display:block;',
                '}',
                '.vf-msg-preview-rm{',
                '  position:absolute;top:-6px;right:-6px;',
                '  width:18px;height:18px;border-radius:50%;',
                '  background:#E41E3F;color:#fff;border:none;',
                '  font-size:0.6rem;cursor:pointer;display:flex;',
                '  align-items:center;justify-content:center;',
                '}',

                /* Ensure chat view container is a proper flex column so composer sticks at bottom */
                '#chat-view-container{',
                '  display:flex!important;flex-direction:column!important;',
                '  height:100%!important;overflow:hidden!important;',
                '}',
                '#chat-messages-container{',
                '  flex:1!important;overflow-y:auto!important;',
                '  -webkit-overflow-scrolling:touch!important;',
                '  padding-bottom:8px!important;',
                '}',
            ].join('\n');
            document.head.appendChild(s);
        });

        /* ── Shared state ── */
        var _activePeerId   = '';
        var _activePeerName = 'User';
        var _mediaRecorder  = null;
        var _vnChunks       = [];
        var _pendingFiles   = [];

        /* ── Build header call-button group ── */
        function _buildCallActions(peerId, peerName) {
            var wrap = document.createElement('div');
            wrap.className = 'vf-call-actions';

            function _mkBtn(cls, icon, label, onClick) {
                var b = document.createElement('button');
                b.className = 'vf-call-btn ' + cls;
                b.title = label;
                b.setAttribute('aria-label', label);
                b.innerHTML = '<i class="fas ' + icon + '"></i>';
                b.addEventListener('click', onClick);
                return b;
            }

            wrap.appendChild(_mkBtn('vf-voice', 'fa-phone', 'Voice call', function () {
                if (typeof window._vfStartCall === 'function') window._vfStartCall(peerId, peerName, false);
                else _notify('Voice calls require the latest app-patch-v2.js', 'warn');
            }));
            wrap.appendChild(_mkBtn('vf-video', 'fa-video', 'Video call', function () {
                if (typeof window._vfStartCall === 'function') window._vfStartCall(peerId, peerName, true);
                else _notify('Video calls require the latest app-patch-v2.js', 'warn');
            }));
            wrap.appendChild(_mkBtn('vf-info', 'fa-info-circle', 'View profile', function () {
                if (peerId && typeof window.navigateTo === 'function') {
                    window._viewingOtherProfile = true;
                    window._viewingProfileId    = peerId;
                    window.navigateTo('profile');
                }
            }));
            return wrap;
        }

        /* ── Inject call buttons into chat header ── */
        function _injectCallButtons(header, peerId, peerName) {
            if (!header) return;
            header.querySelectorAll('.vf-call-actions').forEach(function (el) { el.remove(); });
            header.appendChild(_buildCallActions(peerId, peerName));
        }

        /* ── Build and inject the full message composer bar ── */
        function _injectComposer(container, peerId, peerName) {
            if (!container) return;
            /* Remove any existing patch composer */
            var old = container.querySelector('#vf-msg-composer');
            if (old) old.remove();
            var oldPrev = container.querySelector('#vf-msg-preview');
            if (oldPrev) oldPrev.remove();

            /* Check if the app already has a working input bar */
            var nativeBar = container.querySelector(
                '#message-input-container,#chat-input-container,' +
                '#message-form,#message-text-input,' +
                '.message-input-bar,.chat-input-bar,.chat-composer,' +
                '[id*="message-input"],[id*="chat-input"],[class*="message-input"]'
            );
            /* Only inject if the native bar is missing or empty */
            if (nativeBar) return;

            _pendingFiles = [];

            /* ── File preview strip ── */
            var preview = document.createElement('div');
            preview.id = 'vf-msg-preview';

            /* ── Composer row ── */
            var bar = document.createElement('div');
            bar.id = 'vf-msg-composer';

            /* Hidden file input */
            var fileInput = document.createElement('input');
            fileInput.id   = 'vf-msg-file';
            fileInput.type = 'file';
            fileInput.multiple = true;
            fileInput.accept   = 'image/*,video/*,application/pdf';

            /* Attach button */
            var attachBtn = document.createElement('button');
            attachBtn.id = 'vf-msg-attach';
            attachBtn.title = 'Attach file';
            attachBtn.setAttribute('aria-label','Attach file');
            attachBtn.innerHTML = '<i class="fas fa-paperclip"></i>';
            attachBtn.addEventListener('click', function () { fileInput.click(); });

            fileInput.addEventListener('change', function () {
                Array.from(fileInput.files || []).forEach(function (file) {
                    _pendingFiles.push(file);
                    if (file.type.startsWith('image/')) {
                        var reader = new FileReader();
                        reader.onload = function (ev) {
                            var item = document.createElement('div');
                            item.className = 'vf-msg-preview-item';
                            var img = document.createElement('img');
                            img.src = ev.target.result;
                            var rm = document.createElement('button');
                            rm.className = 'vf-msg-preview-rm';
                            rm.innerHTML = '<i class="fas fa-times"></i>';
                            rm.addEventListener('click', function () {
                                _pendingFiles = _pendingFiles.filter(function (f) { return f !== file; });
                                item.remove();
                                if (!preview.querySelector('.vf-msg-preview-item')) preview.classList.remove('has-files');
                            });
                            item.appendChild(img);
                            item.appendChild(rm);
                            preview.appendChild(item);
                            preview.classList.add('has-files');
                        };
                        reader.readAsDataURL(file);
                    }
                });
                fileInput.value = '';
            });

            /* Text input (auto-grow textarea) */
            var inp = document.createElement('textarea');
            inp.id = 'vf-msg-input';
            inp.placeholder = 'Message ' + peerName + '…';
            inp.rows = 1;
            inp.addEventListener('input', function () {
                /* Auto-grow */
                inp.style.height = 'auto';
                inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
                /* Toggle between send and mic button */
                var hasText = inp.value.trim().length > 0;
                sendBtn.style.display = hasText ? 'flex' : 'none';
            });
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _doSend(); }
            });

            /* Send button (hidden by default — shown when text exists) */
            var sendBtn = document.createElement('button');
            sendBtn.id = 'vf-msg-send';
            sendBtn.title = 'Send message';
            sendBtn.setAttribute('aria-label','Send message');
            sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
            sendBtn.style.display = 'none';
            sendBtn.addEventListener('click', _doSend);

            bar.appendChild(fileInput);
            bar.appendChild(attachBtn);
            bar.appendChild(inp);
            bar.appendChild(sendBtn);

            /* Append preview then bar at the bottom of the chat container */
            container.appendChild(preview);
            container.appendChild(bar);

            /* Focus input */
            setTimeout(function () { inp.focus(); }, 200);
        }

        /* ── Send a text / image message ── */
        function _doSend() {
            var inp  = document.getElementById('vf-msg-input');
            /* FIX: Also try native message-text-input if vf-msg-input not found */
            if (!inp) inp = document.getElementById('message-text-input');
            var text = inp ? (inp.value || '').trim() : '';
            var hasFiles = _pendingFiles.length > 0;
            if (!text && !hasFiles) return;
            if (_isGuest()) { if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); return; }

            /* FIX: Try native form submit first so the app's own handler runs */
            var nativeForm = document.getElementById('message-form');
            if (nativeForm && text) {
                var nativeInp = document.getElementById('message-text-input');
                if (nativeInp) {
                    nativeInp.value = text;
                    nativeForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                    if (inp && inp.id !== 'message-text-input') { inp.value = ''; inp.style.height = 'auto'; }
                    _pendingFiles = [];
                    var preview2 = document.getElementById('vf-msg-preview');
                    if (preview2) { preview2.innerHTML = ''; preview2.classList.remove('has-files'); }
                    var sendBtn2 = document.getElementById('vf-msg-send');
                    if (sendBtn2) sendBtn2.style.display = 'none';
                    return;
                }
            }

            /* Delegate to the app's native send function if available */
            if (text && typeof window.sendMessage === 'function') {
                window.sendMessage(_activePeerId, text);
            } else if (text && typeof window._sendChatMessage === 'function') {
                window._sendChatMessage(text, _activePeerId);
            } else if (text && _fbOk()) {
                /* Direct Firestore fallback */
                var u = _us();
                var chatId = [u.id, _activePeerId].sort().join('_');
                try {
                    window.fbDb.collection('chats').doc(chatId).collection('messages').add({
                        text: text,
                        senderId:   u.id || '',
                        senderName: u.fullName || u.username || 'User',
                        senderAvatar: u.avatar || u.profilePhoto || '',
                        receiverId: _activePeerId,
                        createdAt: new Date(),
                        read: false
                    });
                    /* Also update chat metadata */
                    window.fbDb.collection('chats').doc(chatId).set({
                        participants: [u.id, _activePeerId],
                        lastMessage: text,
                        lastMessageTime: new Date(),
                        lastSenderId: u.id
                    }, { merge: true });
                    /* Also write to top-level messages collection for cross-env compatibility */
                    window.fbDb.collection('messages').add({
                        text: text, chatId: chatId,
                        senderId: u.id || '', receiverId: _activePeerId,
                        senderName: u.fullName || u.username || 'User',
                        createdAt: new Date(), read: false
                    }).catch(function(){});
                } catch (e) { _notify('Could not send message. Please try again.', 'warning'); return; }
            }

            /* Optimistically render the message in the messages container */
            _renderSentMessage(text);

            /* Clear input and preview */
            if (inp) { inp.value = ''; inp.style.height = 'auto'; }
            _pendingFiles = [];
            var preview = document.getElementById('vf-msg-preview');
            if (preview) { preview.innerHTML = ''; preview.classList.remove('has-files'); }
            /* Toggle buttons back */
            var sendBtn = document.getElementById('vf-msg-send');
            if (sendBtn) sendBtn.style.display = 'none';
        }

        /* ── Optimistically render sent message bubble ── */
        function _renderSentMessage(text) {
            var msgList = document.getElementById('chat-messages-container')
                       || document.getElementById('messages-list')
                       || document.querySelector('#chat-view-container .messages-list,.chat-messages');
            if (!msgList || !text) return;
            var u = _us();
            var bubble = document.createElement('div');
            bubble.style.cssText = 'display:flex;justify-content:flex-end;padding:4px 12px;';
            bubble.innerHTML = '<div style="'
                + 'max-width:72%;background:#1B2B8B;color:#fff;'
                + 'padding:9px 14px;border-radius:18px 18px 4px 18px;'
                + 'font-size:0.9rem;line-height:1.45;word-break:break-word;'
                + 'box-shadow:0 2px 8px rgba(27,43,139,0.25);'
                + '">' + _esc(text) + '</div>';
            msgList.appendChild(bubble);
            msgList.scrollTop = msgList.scrollHeight;
        }

        /* ── Send a voice note blob ── */
        function _sendVoiceNote(blob, peerId, peerName) {
            _notify('Voice note recorded — sending…', 'info');
            /* Upload to Cloudinary if configured, else notify */
            var cfg = (window._appConfig && window._appConfig.cloudinary) || {};
            var cloud  = cfg.cloud || cfg.cloudName || 'dxwmts9vw';
            var preset = cfg.preset || cfg.uploadPreset || 'ehfapp_preset';
            if (!cloud) { _notify('Voice notes require cloud storage. Please configure Cloudinary.', 'warning'); return; }
            var fd = new FormData();
            fd.append('file', blob, 'voice-note-' + Date.now() + '.webm');
            fd.append('upload_preset', preset);
            fd.append('resource_type', 'video');
            fetch('https://api.cloudinary.com/v1_1/' + cloud + '/video/upload', { method: 'POST', body: fd })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    var url = d.secure_url || d.url || '';
                    if (!url) { _notify('Voice note upload failed.', 'warning'); return; }
                    /* Send as a message with audio URL */
                    if (typeof window.sendMessage === 'function') window.sendMessage(peerId, '', { audioUrl: url });
                    else if (_fbOk()) {
                        var u = _us();
                        var chatId = [u.id, peerId].sort().join('_');
                        try {
                            window.fbDb.collection('chats').doc(chatId).collection('messages').add({
                                audioUrl: url,
                                text: '🎤 Voice note',
                                senderId: u.id || '',
                                senderName: u.fullName || u.username || 'User',
                                receiverId: peerId,
                                createdAt: new Date(),
                                read: false
                            });
                        } catch (e) {}
                    }
                    _notify('Voice note sent!', 'success');
                })
                .catch(function () { _notify('Voice note upload failed.', 'warning'); });
        }

        /* ── Main injection: called whenever a chat is opened ── */
        function _injectAll(peerId, peerName) {
            peerId   = peerId   || _activePeerId   || '';
            peerName = peerName || _activePeerName || 'User';
            _activePeerId   = peerId;
            _activePeerName = peerName;

            /* Header call buttons */
            var header = document.getElementById('chat-header-info');
            if (header) _injectCallButtons(header, peerId, peerName);

            /* Composer bar */
            var chatContainer = document.getElementById('chat-view-container')
                             || document.getElementById('chat-panel')
                             || document.querySelector('.chat-view,.chat-window');
            if (chatContainer) _injectComposer(chatContainer, peerId, peerName);
        }

        /* ── Watch #chat-header-info for changes (new chat opened) ── */
        function _watchHeader() {
            var header = document.getElementById('chat-header-info');
            if (!header || header._vfP2Watched) return;
            header._vfP2Watched = true;
            new MutationObserver(function (muts) {
                var hadAdditions = muts.some(function (m) { return m.addedNodes.length > 0; });
                if (!hadAdditions) return;
                setTimeout(function () {
                    /* Re-read peer info */
                    var peerId   = header.dataset.peerId   || header.dataset.userId   || _activePeerId;
                    var peerName = header.dataset.peerName || header.dataset.userName || _activePeerName;
                    if (!peerName) {
                        var el = header.querySelector('strong,h4,h3,.peer-name,.contact-name');
                        if (el) peerName = el.textContent.trim();
                    }
                    _injectAll(peerId, peerName);
                }, 150);
            }).observe(header, { childList: true, subtree: true });
        }

        /* ── Also watch the chat container for it appearing in DOM ── */
        function _watchChatContainer() {
            new MutationObserver(function (muts) {
                muts.forEach(function (m) {
                    m.addedNodes.forEach(function (n) {
                        if (!n.querySelectorAll) return;
                        /* If the chat view container just appeared */
                        if (n.id === 'chat-view-container' || (n.classList && n.classList.contains('chat-view'))) {
                            setTimeout(function () { _injectAll(); }, 180);
                        }
                        /* Or if it was added as a child */
                        var cv = n.querySelector && n.querySelector('#chat-view-container,.chat-view,.chat-window');
                        if (cv) setTimeout(function () { _injectAll(); }, 180);
                    });
                });
            }).observe(document.body, { childList: true, subtree: true });
        }

        /* ── Wrap app's openChat / openChatWith functions ── */
        function _wrapChatOpeners() {
            ['openChat', 'openChatWith', '_openChatWithUser', 'openConversation'].forEach(function (fnName) {
                var orig = window[fnName];
                if (typeof orig !== 'function' || orig._vfP2Wrapped) return;
                window[fnName] = function (idOrObj, name) {
                    var result  = orig.apply(this, arguments);
                    var peerId  = (typeof idOrObj === 'object') ? (idOrObj.id || '') : (idOrObj || '');
                    var peerName= (typeof idOrObj === 'object') ? (idOrObj.fullName || idOrObj.username || name || 'User') : (name || 'User');
                    setTimeout(function () { _injectAll(peerId, peerName); }, 280);
                    return result;
                };
                window[fnName]._vfP2Wrapped = true;
            });
        }

        /* ── Section change → messages ── */
        document.addEventListener('empyrean-section-change', function (ev) {
            if (!ev || !ev.detail || ev.detail.section !== 'messages') return;
            setTimeout(function () {
                _watchHeader();
                _wrapChatOpeners();
                _injectAll();
            }, 220);
        });

        _ready(function () {
            _watchHeader();
            _watchChatContainer();
            _wrapChatOpeners();
        });

        document.addEventListener('empyrean-init-done', function () {
            setTimeout(function () {
                _watchHeader();
                _wrapChatOpeners();
                _injectAll();
            }, 450);
        });

        console.log('[§P2] Messages — full composer bar (text/attach/voice note/send) + header call buttons.');
    })();


    /* ═══════════════════════════════════════════════════════════════════
       §P3  MARKETPLACE — contact button expands to show seller info
       Rules:
       • .vf-market-tabs  → always removed (unwanted §35 injection)
       • escrow cards     → only "Add to Cart" button; no contact btn
       • direct cards     → "Contact Seller" button expands a panel
                            showing name, phone, email, address + a
                            "Message Seller" shortcut into DMs.
                            Pulls from card data-attributes first,
                            then Firestore if attrs are missing.
       • Panel is toggle: tap again to collapse it.
    ═══════════════════════════════════════════════════════════════════ */
    (function patchMarketplaceContact() {

        /* ── CSS ── */
        _ready(function () {
            if (document.getElementById('_pv2_mkt_css')) return;
            var s = document.createElement('style');
            s.id = '_pv2_mkt_css';
            s.textContent = [
                /* Kill §35 tab bars everywhere */
                '.vf-market-tabs{ display:none!important; }',

                /* Escrow: hide contact btn, ensure cart btn shows */
                '.property-card[data-sales-type="escrow"] .contact-seller-btn,',
                '.property-card[data-salestype="escrow"]  .contact-seller-btn,',
                '.market-card[data-sales-type="escrow"]   .contact-seller-btn,',
                '.listing-card[data-sales-type="escrow"]  .contact-seller-btn{',
                '  display:none!important; }',

                '.property-card[data-sales-type="escrow"] .add-to-cart-btn,',
                '.property-card[data-salestype="escrow"]  .add-to-cart-btn,',
                '.market-card[data-sales-type="escrow"]   .add-to-cart-btn,',
                '.listing-card[data-sales-type="escrow"]  .add-to-cart-btn{',
                '  display:flex!important; }',

                /* Contact button base style */
                '.property-card .contact-seller-btn,',
                '.market-card   .contact-seller-btn,',
                '.listing-card  .contact-seller-btn{',
                '  width:100%!important;display:flex!important;',
                '  align-items:center!important;justify-content:center!important;',
                '  gap:8px!important;padding:10px 16px!important;',
                '  border-radius:12px!important;font-weight:700!important;',
                '  font-size:0.85rem!important;cursor:pointer!important;',
                '  transition:opacity 0.18s,background 0.18s!important; }',
                '.property-card .contact-seller-btn:active{ opacity:0.75!important; }',

                /* FIX (2026-08-06 — "make the card uniform"): the escrow
                   counterpart (add-to-cart-btn) never got this same
                   treatment here at the !important layer that actually
                   wins on live cards — only style.css's plain (non-
                   !important) .add-to-cart-btn{width:100%} rule did, which
                   is weaker than anything else with !important. Mirrored
                   1:1 so an escrow card's button is pixel-identical to a
                   direct-sale card's, not just "also full width". */
                '.property-card .add-to-cart-btn,',
                '.market-card   .add-to-cart-btn,',
                '.listing-card  .add-to-cart-btn{',
                '  width:100%!important;display:flex!important;',
                '  align-items:center!important;justify-content:center!important;',
                '  gap:8px!important;padding:10px 16px!important;',
                '  border-radius:12px!important;font-weight:700!important;',
                '  font-size:0.85rem!important;cursor:pointer!important;',
                '  transition:opacity 0.18s,background 0.18s!important; }',
                '.property-card .add-to-cart-btn:active{ opacity:0.75!important; }',

                /* ── Contact info panel ── */
                '.vf-contact-panel{',
                '  margin-top:8px;',
                '  border-radius:12px;',
                '  background:rgba(10,14,39,0.03);',
                '  border:1px solid rgba(10,14,39,0.08);',
                '  overflow:hidden;',
                '  max-height:0;',
                '  transition:max-height 0.35s cubic-bezier(0.4,0,0.2,1), padding 0.3s;',
                '  padding:0 14px;',
                '}',
                '.vf-contact-panel.open{',
                '  max-height:320px;',
                '  padding:14px;',
                '}',
                '.vf-contact-panel-title{',
                '  font-weight:800;font-size:0.88rem;color:#0A0E27;',
                '  margin-bottom:10px;display:flex;align-items:center;gap:6px;',
                '}',
                '.vf-contact-panel p{',
                '  margin:0 0 7px;font-size:0.85rem;color:#374151;',
                '  display:flex;align-items:center;gap:8px;',
                '}',
                '.vf-contact-panel p i{ color:#1B2B8B;font-size:0.9rem;width:16px;text-align:center; }',
                '.vf-contact-panel a{ color:#1B2B8B;text-decoration:none;font-weight:600; }',
                '.vf-contact-panel a:active{ opacity:0.7; }',

                /* FIX (request — "when clicking Expand Contact for Job
                   Seeker, Job (employer) and Professional Service
                   Rendering categories, the card should be tailored to
                   suit the specific activity — currently the redesign
                   makes the card look inconsistent with the rest"): the
                   Expand Contact panel for these three categories used to
                   pop open in this plain light-grey box on top of the
                   premium emerald + antique-gold "avatar card" (see
                   app-marketplace.js's mkt-avatar-card / style.css) — the
                   two visibly clashed. Applied only to
                   .vf-contact-panel-premium (added below only for cards
                   with the .mkt-avatar-card class), so every other
                   category keeps the original light panel unchanged. */
                '.vf-contact-panel.vf-contact-panel-premium{',
                '  background:rgba(0,0,0,0.18);',
                '  border:1px solid rgba(212,175,55,0.30);',
                '}',
                '.vf-contact-panel-premium .vf-contact-panel-title{ color:#F0D584; }',
                '.vf-contact-panel-premium p{ color:rgba(255,255,255,0.82); }',
                '.vf-contact-panel-premium p i{ color:#E8C458; }',
                '.vf-contact-panel-premium a{ color:#F0D584; }',
                '.vf-contact-panel-premium .vf-contact-loading{ color:rgba(255,255,255,0.6); }',

                /* Message seller shortcut inside panel */
                '.vf-panel-msg-btn{',
                '  margin-top:10px;width:100%;padding:9px 0;',
                '  border-radius:10px;border:none;',
                '  background:#1B2B8B;color:#fff;',
                '  font-size:0.84rem;font-weight:700;cursor:pointer;',
                '  display:flex;align-items:center;justify-content:center;gap:7px;',
                '  transition:opacity 0.18s;-webkit-tap-highlight-color:transparent;',
                '}',
                '.vf-panel-msg-btn:active{ opacity:0.8; }',

                /* Loading spinner inside panel */
                '.vf-contact-loading{',
                '  color:#6B7280;font-size:0.83rem;',
                '  display:flex;align-items:center;gap:6px;',
                '}',

                /* FIX (request — WhatsApp icon button replacing Contact
                   Seller / Hide Contact in the horizontally-scrollable
                   .property-actions row). Sized/shaped to match the other
                   buttons already living in that row.
                   FIX (request — Marketplace Communication Adjustments,
                   2026-08-09): the matching ".mkt-quickcontact-msg-btn"
                   rules were removed along with the button itself — that
                   direct-to-inbox "Message" affordance now lives on the
                   Seller Profile page instead (see the removal comment
                   further down, where msgBtn used to be built). */
                '.mkt-quickcontact-wa-btn{',
                '  display:inline-flex!important;align-items:center!important;justify-content:center!important;',
                '  gap:6px!important;padding:9px 16px!important;border-radius:12px!important;',
                '  font-weight:700!important;font-size:0.85rem!important;cursor:pointer!important;',
                '  border:none!important;white-space:nowrap!important;flex-shrink:0!important;',
                '  text-decoration:none!important;transition:opacity 0.18s!important;',
                '  background:#25D366!important;color:#fff!important;',
                '}',
                '.mkt-quickcontact-wa-btn:active{ opacity:0.75!important; }',

                /* FIX (2026-08-09 — Marketplace Adjustments #1): the native
                   .contact-seller-btn now sits in the SAME horizontally-
                   scrollable row as Call/WhatsApp (previously it was a
                   standalone width:100% block button, styled by the base
                   ".property-card .contact-seller-btn" rule above). Scoped
                   to .mkt-quickcontact-chat-btn (added only to cards this
                   session\u2019s three-icon row applies to) so no other,
                   still-block-styled contact-seller-btn elsewhere is
                   affected. */
                '.property-card .contact-seller-btn.mkt-quickcontact-chat-btn,',
                '.market-card   .contact-seller-btn.mkt-quickcontact-chat-btn,',
                '.listing-card  .contact-seller-btn.mkt-quickcontact-chat-btn{',
                '  width:auto!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;',
                '  gap:6px!important;padding:9px 16px!important;border-radius:12px!important;',
                '  font-weight:700!important;font-size:0.85rem!important;flex-shrink:0!important;white-space:nowrap!important;',
                '}',
            ].join('\n');
            document.head.appendChild(s);
        });

        /* ── Ensure every direct-sale card has a wired contact button ── */
        function _wireCard(card) {
            if (card._vfContactWired) return;

            /* Always remove unwanted tab bars */
            card.querySelectorAll('.vf-market-tabs').forEach(function (el) { el.remove(); });
            card._vfTabsDone = true;

            var salesType = (card.dataset.salesType || card.dataset.salestype || '').toLowerCase();

            /* Escrow: just show cart, hide contact */
            if (salesType === 'escrow') {
                card.querySelectorAll('.contact-seller-btn,.expand-contact-btn').forEach(function (b) {
                    b.style.setProperty('display', 'none', 'important');
                });
                card.querySelectorAll('.add-to-cart-btn').forEach(function (b) {
                    b.style.removeProperty('display');
                });
                card._vfContactWired = true;
                return;
            }

            /* Direct-sale cards: Contact Seller is a buyer-only action.
               Owners/admins manage their own listing via Promote/Edit/Delete
               instead (added by app-marketplace.js's _ensureOwnerActions) —
               without this check, this function would create/wire a Contact
               Seller button on the owner's own card too, which then raced
               with the owner-action buttons depending on render order.
               Note: this file has no local _isAdmin() (unlike
               app-marketplace.js/app-fix-final.js each defining their own),
               so admin status is read directly off window here. */
            var _wcSellerId = card.dataset.sellerId || card.dataset.userId || '';
            var _wcUs       = _us();
            var _wcEmp      = window.EmpState || {};
            var _wcIsAdmin  = _wcEmp.isAdmin != null ? _wcEmp.isAdmin : (window.isAdmin || false);
            var _wcIsOwner  = (_wcUs.id && _wcSellerId && _wcSellerId === _wcUs.id) || !!_wcIsAdmin;
            if (_wcIsOwner) {
                card.querySelectorAll('.contact-seller-btn,.expand-contact-btn,.vf-contact-btn').forEach(function (b) {
                    b.style.setProperty('display', 'none', 'important');
                });
                card._vfContactWired = true;
                return;
            }

            /* FIX (2026-08-09 — Marketplace Adjustments request #1): three
               DISTINCT actions now live side-by-side in the horizontally-
               scrollable .property-actions row, each with its own real
               destination — the old behavior (all three landing on
               WhatsApp) traced back to app-marketplace.js's global tel:
               interceptor, retired this same session (see that file's own
               note at the same spot):
                 • Contact Seller — the card's own native button, no
                   longer hidden — opens the in-app Empyrean chat inbox
                   (_openMarketChatOverlay) with an auto-generated inquiry
                   message RETAINED in the composer (pre-filled, not sent)
                   so the buyer can review/edit before sending.
                 • Call            — plain tel: link, opens the device
                   dialer directly. Unchanged from before.
                 • WhatsApp        — wa.me link, pre-filled with a message
                   containing this listing's shareable link (server-side
                   resolves that link to the listing's own thumbnail/title
                   as a rich preview on the seller's WhatsApp side).
                   Unchanged from before.
               The old expand/collapse "Hide Contact" panel remnants
               (.expand-contact-btn/.vf-contact-btn/.vf-contact-panel/
               .direct-contact-info) stay permanently hidden — that toggle
               UI is retired, not the Contact Seller action itself.

               FIX (follow-up, 2026-08-09 — "2 direct call buttons"): this
               row used to ALSO carry a second, plain "Call" button
               (.mkt-quickcontact-call-btn) right next to WhatsApp — on
               top of app-marketplace.js's own "Call <role>" button
               (.mkt-call-seller-btn, inserted right after Contact Seller
               by _ensureMessageSellerButton), that meant two separate
               call buttons on the same card, both dialing the exact same
               number. Confirmed by reading both insertion points side by
               side — neither checks for the other's class before
               inserting, so both always fired independently. Removed the
               duplicate here rather than in app-marketplace.js, since
               .mkt-call-seller-btn already sits directly beside Contact
               Seller (the more natural reading position) and this file's
               own idempotency guard below already referenced a
               ".mkt-quickcontact-msg-btn" class that nothing was actually
               creating — a leftover from BEFORE this same 2026-08-09
               session first turned that button into a duplicate "Call".
               In its place, per this session's explicit request, a
               "Message" button now goes here — opens the account's
               general, 1:1 Empyrean messages inbox (window.openChat),
               NOT _openMarketChatOverlay (that's Contact Seller's job;
               the two inboxes are kept deliberately separate — see
               app-marketplace-sellers.js's own note on the seller-profile
               "Message" column for the same distinction). Doesn't need a
               resolved phone number the way Call/WhatsApp do, so it's
               shown immediately rather than waiting on the same
               dataset/Firestore phone lookup below. */
            card.querySelectorAll('.expand-contact-btn,.vf-contact-btn,.vf-contact-panel,.direct-contact-info').forEach(function (el) {
                el.style.setProperty('display', 'none', 'important');
            });
            /* FIX (request — "it's not contact sellers but job applicant,
               please correct"): this button's label was still hardcoded to
               "Contact Seller" even on Job Seeking / Professional Service /
               Job Vacancy avatar cards, where every other contact affordance
               (the "Call <role>" button, the Message wording referenced in
               app-marketplace.js) already asks _mktAvatarRoleLabel for the
               right word instead of "Seller". Computed here (moved up from
               its previous spot further down this function, where the Call/
               WhatsApp block already needed it) so this label picks it up
               too — "Contact Job Seeker" / "Contact Service Provider" /
               "Contact Job Vacancy" — falling back to "Contact Seller"
               unchanged for every ordinary product/vehicle/service listing. */
            var _csRoleLabel = (typeof window._mktAvatarRoleLabel === 'function') ? window._mktAvatarRoleLabel(card.dataset.category || '') : null;
            card.querySelectorAll('.contact-seller-btn').forEach(function (b) {
                b.style.removeProperty('display');
                b.classList.add('mkt-quickcontact-chat-btn');
                if (!/<i /.test(b.innerHTML)) {
                    b.innerHTML = '<i class="fas fa-comment-dots"></i> Contact ' + (_csRoleLabel || 'Seller');
                }
            });
            card._vfContactWired = true;

            /* The compact "New in Marketplace" dashboard-strip thumbnail
               (.dashboard-market-card) has no .property-actions row at all
               — it's handled by its own dedicated corner-icon overlay in
               app-marketplace.js's _mktDecorateDashboardCard instead, so
               skip icon injection here rather than dumping full-size
               buttons into a compact thumbnail. */
            if (card.classList.contains('dashboard-market-card')) return;

            var actionsRow = card.querySelector('.property-actions') || card.querySelector('.property-card-footer,.card-footer,.card-actions') || card;
            if (actionsRow.querySelector('.mkt-quickcontact-wa-btn')) return; /* already injected */

            var _wcRoleLabel   = _csRoleLabel;
            var _wcContactWord = _wcRoleLabel || 'Seller';
            var sellerId   = card.dataset.sellerId  || card.dataset.userId  || '';
            var listingId  = card.dataset.id        || card.dataset.postId  || '';
            var itemName   = card.dataset.name || (card.querySelector('h4,.property-name,.listing-title') || {}).textContent || 'this listing';
            var sellerName = card.dataset.sellerName || card.dataset.contactName || _wcContactWord;
            /* FIX (request — shared WhatsApp/Message link should display
               the product's own card thumbnail): '?post=' is a real query
               param a link-preview crawler's HTTP request actually sends —
               a '#' hash fragment never leaves the browser. Resolved
               server-side via server.js's _collectionForId 'mkt-' →
               marketplace_listings mapping; see app-marketplace.js's
               matching comment for the full reasoning. */
            var shareLink  = location.href.split('#')[0].split('?')[0] + '?post=' + listingId;

            /* FIX (request — Marketplace Communication Adjustments,
               2026-08-09): the direct-to-Empyrean-inbox "Message" button
               that used to live here (opened window.openChat/openChatWith
               with this seller, via navigateTo('messages')) has been
               removed from this card entirely. That same 1:1 inbox
               affordance now lives on the Seller Profile page instead —
               a "Message" contact item placed immediately after the
               WhatsApp number (see directMsgHTML / #mkt-seller-direct-
               msg-btn in app-marketplace-sellers.js's
               _renderSellerProfilePage, which already wires the identical
               window.openChat flow). Card-level quick-contact is now
               Call + WhatsApp only. */

            /* WhatsApp icon — resolves the seller's phone from the card's
               own data-attributes first (fast path, no network call); if
               absent, falls back to the same listing/profile Firestore
               lookup the old contact panel used, so older listings saved
               before contact fields were reliably captured still work. */
            var waBtn = document.createElement('a');
            waBtn.className = 'btn mkt-quickcontact-wa-btn';
            waBtn.title = 'Chat on WhatsApp';
            waBtn.target = '_blank';
            waBtn.rel = 'noopener';
            waBtn.style.display = 'none'; /* revealed once we have a number */
            waBtn.innerHTML = '<i class="fab fa-whatsapp"></i> WhatsApp';
            actionsRow.appendChild(waBtn);

            function _pv2WaLink(phone) {
                var digits = String(phone || '').replace(/\D/g, '');
                if (!digits) return '';
                if (digits.charAt(0) === '0') digits = '234' + digits.slice(1);
                return 'https://wa.me/' + digits;
            }
            function _revealWa(phone) {
                var link = _pv2WaLink(phone);
                if (link) {
                    var waMsg = 'Hi, I\'m interested in "' + itemName + '" — ' + shareLink;
                    waBtn.href = link + '?text=' + encodeURIComponent(waMsg);
                    waBtn.style.display = '';
                }
                /* FIX (follow-up, 2026-08-09): no longer reveals a Call
                   button here — that was the duplicate removed above.
                   app-marketplace.js's own .mkt-call-seller-btn (beside
                   Contact Seller) already covers the Call action for this
                   same phone number. */
            }

            var cPhone = card.dataset.contactPhone || card.dataset.phone || '';
            if (cPhone) {
                _revealWa(cPhone);
            } else if (_fbOk() && (listingId || sellerId)) {
                try {
                    var listingPromise = listingId ? window.fbDb.collection('marketplace_listings').doc(listingId).get().catch(function () { return null; }) : Promise.resolve(null);
                    var profilePromise = sellerId ? window.fbDb.collection('users').doc(sellerId).get().catch(function () { return null; }) : Promise.resolve(null);
                    Promise.all([listingPromise, profilePromise]).then(function (results) {
                        var ldoc = results[0], pdoc = results[1];
                        var d  = (ldoc && ldoc.exists) ? ldoc.data() : {};
                        var pd = (pdoc && pdoc.exists) ? pdoc.data() : {};
                        var foundPhone = d.contactPhone || d.phone || pd.phone || pd.contactPhone || '';
                        if (foundPhone) _revealWa(foundPhone);
                    });
                } catch (ex) { /* no phone available — WhatsApp icon just stays hidden */ }
            }
        }

        /* Wire the "Message Seller" button inside an expanded panel */
        function _wireMsgBtn(panel) {
            panel.querySelectorAll('.vf-panel-msg-btn').forEach(function (mb) {
                if (mb._vfWired) return;
                mb._vfWired = true;
                mb.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (_isGuest()) { if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); return; }
                    var sid   = mb.dataset.sellerId   || '';
                    var sname = mb.dataset.sellerName || 'Seller';
                    /* Open the lightweight in-marketplace chat overlay directly
                       — straight into the conversation with this seller, no
                       inbox/Messages-section navigation, no reuse of
                       window.openChat()'s full chat panel (that panel lives
                       inside #messages and is reserved for the dedicated
                       Messages UI). window.openChatWith is just an alias for
                       window.openChat (see app-patch-openchat.js §13), so it
                       is intentionally NOT used here. */
                    if (typeof window._openMarketChatOverlay === 'function') window._openMarketChatOverlay(sid, sname);
                    else _notify('Unable to open chat right now.', 'warning');
                });
            });
        }

        /* Wire the native "Contact Seller" button — opens the in-app
           Empyrean chat inbox with an auto-generated inquiry message
           RETAINED in the composer (see _openMarketChatOverlay's new
           prefillText param, app-marketplace.js), never sent
           automatically. Delegated (not per-card addEventListener) so it
           keeps working across re-renders without needing its own
           per-node wired-flag. */
        document.addEventListener('click', function (e) {
            var btn = e.target.closest('.contact-seller-btn');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            if (_isGuest()) { if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); return; }
            var cardEl = btn.closest('.property-card,.market-card,.listing-card');
            if (!cardEl) return;
            var sellerId   = cardEl.dataset.sellerId || cardEl.dataset.userId || '';
            if (!sellerId) { _notify('Seller information isn\u2019t available for this listing yet.', 'warning'); return; }
            var sellerName = cardEl.dataset.sellerName || cardEl.dataset.contactName || 'Seller';
            var itemName   = cardEl.dataset.name || (cardEl.querySelector('h4,.property-name,.listing-title') || {}).textContent || 'this listing';
            var listingId  = cardEl.dataset.id || cardEl.dataset.postId || '';
            var lMedia = [];
            try { lMedia = JSON.parse(cardEl.dataset.media || '[]'); } catch (ex) {}
            var listingMeta = {
                id:       listingId,
                name:     itemName,
                price:    cardEl.dataset.price ? cardEl.dataset.price : '',
                image:    lMedia[0] || (cardEl.querySelector('img') || {}).src || '',
                category: cardEl.dataset.category || ''
            };
            var autoMsg = 'Hi, I\'m interested in "' + itemName + '" — is this still available?';
            if (typeof window._openMarketChatOverlay === 'function') {
                window._openMarketChatOverlay(sellerId, sellerName.trim ? sellerName.trim() : sellerName, listingMeta, autoMsg);
            } else {
                _notify('Unable to open chat right now.', 'warning');
            }
        });

        /* ── Sweep all marketplace cards ── */
        function _wireAll() {
            document.querySelectorAll('.property-card,.market-card,.listing-card').forEach(_wireCard);
        }

        /* MutationObserver: wire cards as they enter DOM */
        new MutationObserver(function (muts) {
            muts.forEach(function (m) {
                m.addedNodes.forEach(function (n) {
                    if (!n.querySelectorAll) return;
                    n.querySelectorAll('.property-card,.market-card,.listing-card').forEach(function (c) {
                        setTimeout(function () { _wireCard(c); }, 80);
                    });
                    if (n.classList && (
                        n.classList.contains('property-card') ||
                        n.classList.contains('market-card')  ||
                        n.classList.contains('listing-card')
                    )) { setTimeout(function () { _wireCard(n); }, 80); }
                });
            });
        }).observe(document.body, { childList: true, subtree: true });

        _ready(function () {
            _wireAll();
            setTimeout(_wireAll, 600);
            setTimeout(_wireAll, 1500);
            setTimeout(_wireAll, 3000);
        });
        document.addEventListener('empyrean-init-done', function () {
            setTimeout(_wireAll, 500);
            setTimeout(_wireAll, 1200);
        });
        document.addEventListener('empyrean-section-change', function (ev) {
            if (ev && ev.detail && ev.detail.section === 'marketplace') {
                setTimeout(_wireAll, 200);
                setTimeout(_wireAll, 800);
            }
        });

        console.log('[§P3] Marketplace — contact button expands seller info panel; escrow = cart only.');
    })();


    /* ═══════════════════════════════════════════════════════════════════
       §P6  BUSINESS PAGE RENDERER — DISABLED (2026-07)
            This used to unconditionally overwrite window.renderBusinessPage
            with a stripped-down version (no Delete/Edit/My Pages/Share
            buttons, weaker single-page-only owner check). Whichever render
            happened to be "active" at the moment depended on script-load
            timing against app-business.js and app-patch-v4.js, so business
            pages intermittently rendered with this bare-bones version
            instead — most visibly as a missing Delete button and users
            being shown "viewing as a visitor" on their own page. Retired in
            favor of app-business.js's actively-maintained renderer, which
            app-patch-v3.js wraps (for Share/Promote) without clobbering.
    ═══════════════════════════════════════════════════════════════════ */
    (function patchBizPageRenderer_DISABLED() {
        return; /* intentionally inert — see note above */
    }());

    /* ═══════════════════════════════════════════════════════════════════
       §P6  BUSINESS PAGE RENDERER  [ORIGINAL — kept for reference, inert]
    ═══════════════════════════════════════════════════════════════════ */
    (function patchBizPageRenderer() {
        return; /* superseded — do not re-enable, see note above */

        function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

        function _renderBizPage(bizId, data) {
            var sec = document.getElementById('business-page');
            if (!sec) return;
            var us = _us();
            var isOwner = _isAdmin() || (us.id && data.ownerId && data.ownerId === us.id);
            var name    = data.name || data.businessName || 'Business Page';
            var cover   = data.coverPhoto  || data.coverImage  || '';
            var avatar  = data.profilePhoto|| data.logo        || '';
            var bio     = data.bio         || data.description || '';
            var industry= data.industry    || '';
            var website = data.website     || '';
            var email   = data.email       || '';
            var phone   = data.phone       || data.contactPhone|| '';

            var coverBg = cover
                ? 'url("' + _esc(cover) + '") center/cover no-repeat'
                : 'linear-gradient(135deg,#0A0E27 0%,#1B2B8B 100%)';
            var avatarSrc = avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=1B2B8B&color=fff&size=200';

            sec.innerHTML = [
                /* Cover + avatar */
                '<div style="position:relative;height:180px;background:' + coverBg + ';border-radius:16px 16px 0 0;flex-shrink:0;">',
                '  <div style="position:absolute;bottom:-36px;left:20px;width:72px;height:72px;border-radius:50%;border:4px solid #fff;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.2);background:#e8eaf6;">',
                '    <img src="' + _esc(avatarSrc) + '" style="width:100%;height:100%;object-fit:cover;" onerror="this.src=\'https://ui-avatars.com/api/?name=B&background=1B2B8B&color=fff&size=200\'">',
                '  </div>',
                '</div>',
                /* Info */
                '<div style="padding:48px 20px 16px;">',
                '  <h2 style="margin:0 0 4px;font-size:1.3rem;font-weight:800;color:#0A0E27;">' + _esc(name) + '</h2>',
                industry ? '<span style="display:inline-block;font-size:0.72rem;font-weight:700;padding:3px 12px;background:rgba(27,43,139,0.1);color:#1B2B8B;border-radius:20px;margin-bottom:10px;">' + _esc(industry) + '</span>' : '',
                bio      ? '<p style="font-size:0.88rem;color:#374151;margin:8px 0 12px;line-height:1.5;">' + _esc(bio) + '</p>' : '',
                website  ? '<p style="font-size:0.82rem;margin:4px 0;"><i class="fas fa-globe" style="color:#1B2B8B;margin-right:6px;"></i><a href="' + _esc(website) + '" target="_blank" style="color:#1B2B8B;">' + _esc(website) + '</a></p>' : '',
                email    ? '<p style="font-size:0.82rem;margin:4px 0;"><i class="fas fa-envelope" style="color:#1B2B8B;margin-right:6px;"></i><a href="mailto:' + _esc(email) + '" style="color:#1B2B8B;">' + _esc(email) + '</a></p>' : '',
                phone    ? '<p style="font-size:0.82rem;margin:4px 0;"><i class="fas fa-phone" style="color:#1B2B8B;margin-right:6px;"></i><a href="tel:' + _esc(phone) + '" style="color:#1B2B8B;">' + _esc(phone) + '</a></p>' : '',
                /* Visitor notice */
                !isOwner ? '<div style="margin:12px 0;padding:10px 14px;background:rgba(27,43,139,0.07);border-radius:10px;font-size:0.82rem;color:#1B2B8B;text-align:center;">You are viewing this business page as a visitor.</div>' : '',
                '</div>',
                /* Posts area */
                '<div id="vf-biz-posts-area" style="padding:0 16px 24px;">',
                '  <h3 style="font-size:0.95rem;font-weight:700;color:#0A0E27;margin:0 0 12px;">Posts</h3>',
                '  <div id="vf-biz-posts-list" style="display:flex;flex-direction:column;gap:12px;">',
                '    <div style="text-align:center;color:#9CA3AF;font-size:0.85rem;padding:20px;">Loading posts…</div>',
                '  </div>',
                '</div>'
            ].join('');

            /* Load posts for this business page */
            if (window.fbDb && bizId) {
                window.fbDb.collection('business_posts')
                    .where('pageId', '==', bizId)
                    .orderBy('createdAt', 'desc')
                    .limit(20)
                    .get()
                    .then(function(snap) {
                        var list = document.getElementById('vf-biz-posts-list');
                        if (!list) return;
                        if (snap.empty) {
                            list.innerHTML = '<div style="text-align:center;color:#9CA3AF;font-size:0.85rem;padding:20px;">No posts yet.</div>';
                            return;
                        }
                        list.innerHTML = '';
                        snap.forEach(function(doc) {
                            var p = doc.data();
                            var card = document.createElement('div');
                            card.style.cssText = 'background:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 2px 10px rgba(0,0,0,0.07);border:1px solid rgba(0,0,0,0.06);';
                            var media = p.media && p.media.length ? '<div style="margin-top:10px;border-radius:10px;overflow:hidden;"><img src="' + _esc(p.media[0]) + '" style="width:100%;max-height:280px;object-fit:cover;display:block;" onerror="this.remove()"></div>' : '';
                            var ts = p.createdAt && p.createdAt.toDate ? p.createdAt.toDate().toLocaleDateString() : '';
                            card.innerHTML = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><img src="' + _esc(avatarSrc) + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;"><div><div style="font-weight:700;font-size:0.85rem;">' + _esc(name) + '</div><div style="font-size:0.72rem;color:#9CA3AF;">' + ts + '</div></div></div>'
                                + (p.text ? '<p style="margin:0;font-size:0.88rem;color:#374151;line-height:1.5;">' + _esc(p.text) + '</p>' : '')
                                + media;
                            list.appendChild(card);
                        });
                    })
                    .catch(function() {
                        var list = document.getElementById('vf-biz-posts-list');
                        if (list) list.innerHTML = '<div style="text-align:center;color:#9CA3AF;font-size:0.85rem;padding:20px;">Could not load posts.</div>';
                    });
            }
        }

        /* The main entry point called by card click handlers */
        window.renderBusinessPage = function(bizId) {
            var id = bizId || window._activeBizPageId || '';
            var cached = window._activeBizData;

            /* If we have cached data for this exact id, render immediately */
            if (cached && (cached.id === id || !id)) {
                _renderBizPage(id || cached.id, cached);
                return;
            }

            /* Try in-memory list first */
            var pages = window._firestoreBusinessPages || [];
            var us = _us();
            if (us && us.businessPage) pages = [us.businessPage].concat(pages);
            var found = pages.find(function(p) { return p.id === id; });
            if (found) {
                window._activeBizData = found;
                _renderBizPage(id, found);
                return;
            }

            /* Fallback: fetch from Firestore */
            if (window.fbDb && id) {
                var sec = document.getElementById('business-page');
                if (sec) sec.innerHTML = '<div style="padding:40px;text-align:center;color:#9CA3AF;"><i class="fas fa-spinner fa-spin" style="font-size:2rem;"></i><p style="margin-top:12px;">Loading business page…</p></div>';
                window.fbDb.collection('business_pages').doc(id).get()
                    .then(function(doc) {
                        if (!doc.exists) {
                            var s = document.getElementById('business-page');
                            if (s) s.innerHTML = '<div style="padding:40px;text-align:center;color:#9CA3AF;">Business page not found.</div>';
                            return;
                        }
                        var data = doc.data();
                        data.id = doc.id;
                        window._activeBizData = data;
                        _renderBizPage(id, data);
                    })
                    .catch(function(err) {
                        console.warn('[§P6] Firestore fetch error:', err);
                        var s = document.getElementById('business-page');
                        if (s) s.innerHTML = '<div style="padding:40px;text-align:center;color:#9CA3AF;">Could not load business page. Check your connection.</div>';
                    });
                return;
            }

            /* No id and no cache — show empty state for own page */
            if (us && us.businessPage) {
                var own = typeof us.businessPage === 'object' ? us.businessPage : { id: us.businessPage };
                window._activeBizPageId = own.id;
                window.renderBusinessPage(own.id);
            }
        };

        /* Re-render on section-change to business-page */
        document.addEventListener('empyrean-section-change', function(ev) {
            if (ev && ev.detail && ev.detail.section === 'business-page') {
                setTimeout(function() { window.renderBusinessPage(window._activeBizPageId || ''); }, 120);
            }
        });

        console.log('[§P6] Business page renderer — Firestore fetch, owns/visitor detection.');
    }());


    /* ═══════════════════════════════════════════════════════════════════
       §P4  QUICK-POST FAB — visible only on dashboard/feed
    ═══════════════════════════════════════════════════════════════════ */
    (function () {
        // DISABLED (bug: "quick post icon overlapping the Stream Replay
        // button"): app-fixes.js's updateQuickPostFab() was already changed
        // to unconditionally hide #quick-post-fab per an earlier explicit
        // request — it was floating directly on top of the Ongoing
        // Livestreams card on the dashboard, obscuring the "Join Live" / "No
        // live streams" content. This §P4 block predates that decision and
        // never got updated to match: it still listens for
        // 'empyrean-section-change' and still wraps window.navigateTo,
        // re-showing the fab (display:flex) every single time the dashboard
        // or feed section is entered — directly undoing app-fixes.js's
        // fix on every navigation. Its pinned bottom-right position
        // (bottom:90px/20px, mobile bottom:80px/14px — see style.css) lands
        // almost exactly on top of app-patch-v42.js's newer Stream Replay
        // launcher (bottom:86px/16px), which is what produced the visible
        // overlap. Left in place disabled (not deleted) so the exact prior
        // behavior stays visible if the fab is ever reinstated on purpose —
        // matches the same "if (false && ...)" / early-return convention
        // app-fixes.js itself already uses for its own disabled blocks.
        function _updateFab(sectionId) {
            var fab = document.getElementById('quick-post-fab');
            if (!fab) return;
            fab.style.setProperty('display', 'none', 'important');
            return;
            /* eslint-disable no-unreachable */
            if (document.body.classList.contains('vf-thread-open')) {
                fab.style.setProperty('display','none','important'); return;
            }
            var isDash = (sectionId === 'dashboard' || sectionId === 'feed');
            if (!sectionId) {
                var active = document.querySelector('.content-section.active');
                isDash = !active || active.id === 'dashboard' || active.id === 'feed';
            }
            if (isDash && !_isGuest()) {
                fab.style.removeProperty('display');
                if (getComputedStyle(fab).display === 'none') fab.style.display = 'flex';
            } else {
                fab.style.setProperty('display','none','important');
            }
        }
        document.addEventListener('empyrean-section-change', function (ev) {
            _updateFab((ev && ev.detail && ev.detail.section) || '');
        });
        _ready(function () {
            var orig = window.navigateTo;
            if (typeof orig === 'function' && !orig._p4Wrapped) {
                window.navigateTo = function (id) {
                    var r = orig.apply(this, arguments);
                    setTimeout(function () { _updateFab(id || ''); }, 150);
                    return r;
                };
                window.navigateTo._p4Wrapped = true;
            }
            setTimeout(function () { _updateFab(''); }, 600);
        });
        document.addEventListener('empyrean-init-done', function () {
            setTimeout(function () { _updateFab(''); }, 700);
        });
        console.log('[§P4] Quick-post FAB — dashboard-only.');
    }());


    /* ═══════════════════════════════════════════════════════════════════
       §P5  WEBRTC VOICE & VIDEO CALLS — Firebase Firestore signalling
    ═══════════════════════════════════════════════════════════════════ */
    (function () {
        /* DISABLED (regression fix, 2026-07-20): "1:1 calls stopped ringing
           on the receiver's end." Root cause: this whole §P5 block is a
           SECOND, independent 1:1 call implementation, superseded by
           app-patch-openchat.js's call system (collection('calls') with
           calleeId/status:'ringing', watched by that file's
           _watchIncomingCalls — the one actually wired to the chat header's
           call buttons today). This block still defines window._vfStartCall
           and writes to a DIFFERENT, no-longer-watched path
           (/users/{peerId}/incomingCalls) — if anything ever calls it
           (directly, or via a future fallback probe like openchat.js's own
           window.startVideoCall/openVideoCall checks), the call would be
           silently placed on a path nobody is listening to: caller sees
           "Ringing…", callee's screen and device never make a sound. Per
           this codebase's own "disable, don't delete" convention (see
           app-patch-v28/v31/v33 headers) — not removed, just turned off. */
        if (true) { console.log('[§P5] Disabled — superseded by app-patch-openchat.js\'s call system (see comment above).'); return; }
        var _callOverlay=null, _pc=null, _localStream=null, _callDocRef=null,
            _unsubAnswer=null, _unsubCandidates=null;
        var ICE = { iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}] };

        function _buildUI(peerName, isVideo) {
            if (_callOverlay) _callOverlay.remove();
            var d = document.createElement('div');
            d.id = 'vf-call-overlay';
            d.style.cssText = 'position:fixed;inset:0;z-index:200000;background:#0A0E27;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:inherit;';
            d.innerHTML = '<div style="font-size:1rem;opacity:.7;margin-bottom:6px;">'+(isVideo?'Video':'Voice')+' Call</div>'
                +'<div style="font-size:1.4rem;font-weight:700;margin-bottom:20px;">'+peerName+'</div>'
                +'<video id="vf-rv" autoplay playsinline style="width:100%;max-width:340px;border-radius:12px;background:#111;display:'+(isVideo?'block':'none')+';margin-bottom:14px;"></video>'
                +'<video id="vf-lv" autoplay playsinline muted style="width:110px;border-radius:8px;position:absolute;top:14px;right:14px;display:'+(isVideo?'block':'none')+';"></video>'
                +'<div id="vf-cs" style="font-size:.85rem;opacity:.6;margin-bottom:28px;">Calling…</div>'
                +'<button id="vf-hu" style="width:60px;height:60px;border-radius:50%;background:#ef4444;border:none;color:#fff;font-size:1.4rem;cursor:pointer;"><i class="fas fa-phone-slash"></i></button>';
            document.body.appendChild(d);
            d.querySelector('#vf-hu').addEventListener('click', _hangUp);
            _callOverlay = d;
        }
        function _status(m) { if(_callOverlay){var s=_callOverlay.querySelector('#vf-cs');if(s)s.textContent=m;} }
        function _hangUp() {
            if(_pc){try{_pc.close();}catch(e){} _pc=null;}
            if(_localStream){_localStream.getTracks().forEach(function(t){t.stop();});_localStream=null;}
            if(_callDocRef){try{_callDocRef.delete();}catch(e){} _callDocRef=null;}
            if(_unsubAnswer){try{_unsubAnswer();}catch(e){}}
            if(_unsubCandidates){try{_unsubCandidates();}catch(e){}}
            if(_callOverlay){_callOverlay.remove();_callOverlay=null;}
        }

        window._vfStartCall = function(peerId, peerName, isVideo) {
            if (!window.fbDb) { alert('Firebase required for calls.'); return; }
            var us = _us(); if (!us||!us.id) { alert('Please log in.'); return; }
            _buildUI(peerName, isVideo);
            navigator.mediaDevices.getUserMedia({audio:true,video:isVideo?{facingMode:'user'}:false})
            .then(function(stream) {
                _localStream = stream;
                if(isVideo){var lv=document.getElementById('vf-lv');if(lv)lv.srcObject=stream;}
                _pc = new RTCPeerConnection(ICE);
                stream.getTracks().forEach(function(t){_pc.addTrack(t,stream);});
                _pc.ontrack = function(ev){var rv=document.getElementById('vf-rv');if(rv&&ev.streams[0])rv.srcObject=ev.streams[0];};
                _callDocRef = window.fbDb.collection('calls').doc();
                var callerCands = _callDocRef.collection('callerCandidates');
                _pc.onicecandidate = function(ev){if(ev.candidate)callerCands.add(ev.candidate.toJSON());};
                _pc.createOffer().then(function(o){return _pc.setLocalDescription(o);})
                .then(function(){
                    return _callDocRef.set({callerId:us.id,callerName:us.name||'User',calleeId:peerId,calleeName:peerName,isVideo:isVideo,offer:{type:_pc.localDescription.type,sdp:_pc.localDescription.sdp},createdAt:new Date()});
                }).then(function(){
                    _status('Ringing…');
                    var callId = _callDocRef.id;
                    _unsubAnswer = _callDocRef.onSnapshot(function(snap){
                        var d=snap.data();
                        if(d&&d.answer&&_pc&&!_pc.currentRemoteDescription) _pc.setRemoteDescription(new RTCSessionDescription(d.answer)).then(function(){_status('Connected');});
                        if(d&&d.ended){_status('Call ended');setTimeout(_hangUp,1200);}
                    });
                    _unsubCandidates = _callDocRef.collection('calleeCandidates').onSnapshot(function(snap){
                        snap.docChanges().forEach(function(ch){if(ch.type==='added'&&_pc)_pc.addIceCandidate(new RTCIceCandidate(ch.doc.data()));});
                    });
                    if(peerId) window.fbDb.collection('users').doc(peerId).collection('incomingCalls').doc(callId).set({callId:callId,callerId:us.id,callerName:us.name||'User',isVideo:isVideo});
                });
            }).catch(function(err){_status('Mic/camera denied');console.warn('[§P5]',err);setTimeout(_hangUp,2500);});
        };

        /* Incoming call listener */
        _ready(function(){
            var us=_us(); if(!us||!us.id||!window.fbDb) return;
            window.fbDb.collection('users').doc(us.id).collection('incomingCalls').onSnapshot(function(snap){
                snap.docChanges().forEach(function(ch){
                    if(ch.type!=='added') return;
                    var d=ch.doc.data();
                    var banner=document.createElement('div');
                    banner.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:200001;background:#1B2B8B;color:#fff;border-radius:16px;padding:14px 20px;box-shadow:0 8px 32px rgba(0,0,0,.4);display:flex;align-items:center;gap:14px;min-width:260px;';
                    banner.innerHTML='<div><div style="font-weight:700;">'+(d.callerName||'Someone')+'</div><div style="font-size:.78rem;opacity:.8;">Incoming '+(d.isVideo?'video':'voice')+' call</div></div>'
                        +'<button id="vf-acc" style="background:#10B981;border:none;color:#fff;border-radius:50%;width:42px;height:42px;font-size:1rem;cursor:pointer;"><i class="fas fa-phone"></i></button>'
                        +'<button id="vf-dec" style="background:#ef4444;border:none;color:#fff;border-radius:50%;width:42px;height:42px;font-size:1rem;cursor:pointer;"><i class="fas fa-phone-slash"></i></button>';
                    document.body.appendChild(banner);
                    var t=setTimeout(function(){banner.remove();ch.doc.ref.delete();},30000);
                    banner.querySelector('#vf-dec').addEventListener('click',function(){clearTimeout(t);banner.remove();ch.doc.ref.delete();window.fbDb.collection('calls').doc(d.callId).update({ended:true});});
                    banner.querySelector('#vf-acc').addEventListener('click',function(){
                        clearTimeout(t);banner.remove();ch.doc.ref.delete();
                        _buildUI(d.callerName||'Caller',d.isVideo); _status('Connecting…');
                        var callRef=window.fbDb.collection('calls').doc(d.callId);
                        navigator.mediaDevices.getUserMedia({audio:true,video:d.isVideo?{facingMode:'user'}:false}).then(function(stream){
                            _localStream=stream;
                            if(d.isVideo){var lv=document.getElementById('vf-lv');if(lv)lv.srcObject=stream;}
                            _pc=new RTCPeerConnection(ICE);
                            stream.getTracks().forEach(function(tr){_pc.addTrack(tr,stream);});
                            _pc.ontrack=function(ev){var rv=document.getElementById('vf-rv');if(rv&&ev.streams[0])rv.srcObject=ev.streams[0];};
                            var calleeCands=callRef.collection('calleeCandidates');
                            _pc.onicecandidate=function(ev){if(ev.candidate)calleeCands.add(ev.candidate.toJSON());};
                            callRef.get().then(function(snap){return _pc.setRemoteDescription(new RTCSessionDescription(snap.data().offer));})
                            .then(function(){return _pc.createAnswer();})
                            .then(function(ans){return _pc.setLocalDescription(ans);})
                            .then(function(){return callRef.update({answer:{type:_pc.localDescription.type,sdp:_pc.localDescription.sdp}});})
                            .then(function(){
                                _status('Connected');
                                _unsubCandidates=callRef.collection('callerCandidates').onSnapshot(function(snap){snap.docChanges().forEach(function(ch){if(ch.type==='added'&&_pc)_pc.addIceCandidate(new RTCIceCandidate(ch.doc.data()));});});
                                _unsubAnswer=callRef.onSnapshot(function(snap){if(snap.data()&&snap.data().ended){_status('Call ended');setTimeout(_hangUp,1200);}});
                            });
                        }).catch(function(err){_status('Mic/camera denied');setTimeout(_hangUp,2500);});
                    });
                });
            }, function(err){
                // FIX: this listener previously had no error callback at all, so any
                // rejection (e.g. permission-denied while auth/uid was still settling)
                // surfaced as an uncaught "Uncaught Error in snapshot listener" straight
                // from the Firestore SDK instead of a handled, retryable failure.
                console.error('[Listener:incomingCalls]', err.code, err.message);
            });
        });

        console.log('[§P5] WebRTC voice & video calls — Firebase signalling.');
    }());


})();