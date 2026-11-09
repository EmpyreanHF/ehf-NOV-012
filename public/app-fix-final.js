/**
 * EMPYREAN — app-fix-final.js  (UNIFIED — replaces v5 through v10)
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE file. ONE load. Zero conflicts.
 *
 * All logic from app-fix-v5 → v10 has been audited, merged, and de-duplicated.
 * Where fixes in later files superseded earlier ones, only the latest correct
 * version is kept. Where earlier fixes were confirmed working and never broken
 * by later files, they are preserved verbatim.
 *
 * SECTION MAP
 *  §0   Shared helpers
 *  §1   Bottom nav  (SVG icons — no Font Awesome dependency)
 *  §2   Viewport / layout overflow fix
 *  §3   Status upload  (Cloudinary, video, label-click, preview)
 *  §4   Status bar — restore after viewing, 24 h persistence
 *  §5   Status viewer buttons  (retweet, profile, chat, viewer count)
 *  §6   Reel bubble buttons  (like, comment, retweet, share, download)
 *  §7   Reel / modal universal close + exit buttons  (EXIT BUG FIX)
 *  §8   Profile page blank fix
 *  §9   Messages contacts list
 *  §10  Suggested users visibility + Follow button
 *  §11  Online presence dots + messenger badge
 *  §12  Business: create-page modal, video upload, dashboard slider
 *  §13  Business posts — block from general feed, dedup guard
 *  §14  Business dashboard card enrichment + demo-card removal
 *  §15  Business duplicate post guard
 *  §16  Business card click → navigate to business page
 *  §17  NGO / Individual form activation buttons
 *  §18  Admin: chief login + enroll panel
 *  §19  Admin: individual disbursement crypto wallet type selector  ← (THE FIXED ONE)
 *  §20  Admin: chain selector + empty-wallet filter for NGO disburse
 *  §21  KYC permissions fix
 *  §22  Wallet balance sync from Firestore
 *  §23  Login re-prompt / guest-state sync
 *  §24  Account switcher
 *  §25  Nav bar style (sidebar icons)
 *  §26  Premium badge removal (v8 killed it — keep that)
 *  §27  Dashboard business posts slider (hardcoded HTML containers)
 *  §28  Video preload + playsinline
 *  §29  Global init bridge
 *  §30  Marketplace — dashboard strip + contact/chat + owner toolbar + card click-to-chat
 *  §31  (moved to app-business-feedcard.js — "Business Pages For You" strip)
 *  §32  Feed privacy — post composer owner-only + biz-page visitor enforcement + profile post-column restriction
 *  §33  SOS donate button — persistent across re-renders, MutationObserver + periodic sweep
 *  §34  (moved to app-patch-v2.js — post thread view)
 *  §35  (moved to app-patch-v2.js — marketplace contact tab)
 *  §36  (moved to app-patch-v2.js — messages composer/call)
 *  §37  Dashboard business section — fix mismatched container IDs
 *  §38  Admin disbursement — define missing window functions
 *  §39  Business page renderer — anti-override bridge (app-business.js over app-patch-v2.js)
 *  §40  Modal exit buttons — ind-acct-modal + ngo-application-modal body.modal-open cleanup
 *  §41  Message / media upload — cross-environment Firestore persistence
 *  §42  Conflict audit — logs final state of all critical window functions
 *  §43  Impact mining engine — _rewardUser + X/Twitter interactions [v2, 3 bugs fixed]
 *
 * LOAD ORDER: must be the LAST app-fix-*.js script before </body>.
 *             app-patch-v2.js (post threads, marketplace, messages) loads AFTER this file.
 *             app-patch-v3.js and app-patch-v4.js load after app-patch-v2.js.
 * REPLACE all of: app-fix-v5.js, app-fix-v6.js, app-fix-v7.js,
 *                 app-fix-v8.js, app-fix-v9.js, app-fix-v10.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function EmpyreanFixFinal() {
    'use strict';

    /* FIX (2026-07-21 — echo + frozen-tap root cause, shared with app-live.js):
       this file is the one core app-fix-*.js file that never picked up the
       `window._emp*Loaded` idempotency guard already used by
       app-live-tiktok-patch.js and app-live-final.js (both confirmed
       vulnerable to the same issue before they added it). Its own onReady()
       below runs immediately whenever document.readyState is already past
       'loading' — exactly true if the live-preview/dev-reload tooling
       re-injects this script into an already-loaded page without a real
       navigation (see app-patch-v35.js's header for why that happens on
       this host). A second execution re-registers all ~23 of this file's
       document-level click listeners on top of the first copy, so a single
       real tap fires the whole handler chain multiple times — compounding
       with the identical issue in app-live.js to produce both the reported
       repeated/echoing audio (duplicate Agora joins in app-live.js) and the
       frozen/unresponsive taps (duplicate listeners here and elsewhere).
       Guarding here closes the last gap; a real page reload/navigation
       resets `window` entirely, so normal usage is unaffected. */
    if (window._empFixFinalLoaded) {
        console.warn('[EmpyreanFixFinal] Already loaded — skipping duplicate execution (prevents duplicate click listeners that contribute to frozen/unresponsive taps).');
        return;
    }
    window._empFixFinalLoaded = true;

    /* ═══════════════════════════════════════════════════════════════════════
       §0  SHARED HELPERS
    ═══════════════════════════════════════════════════════════════════════ */
    function ready(fn) {
        if (document.readyState !== 'loading') fn();
        else document.addEventListener('DOMContentLoaded', fn);
    }
    function _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
        else console.log('[EmpFix notify]', type, msg);
    }
    function _fbOk() { return !!(window._firebaseLoaded && window.fbDb && typeof window.fbDb.collection === 'function'); }
    function _us() { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    function _isGuest() {
        var s = window.EmpState || {};
        if (s.isGuest != null) return !!s.isGuest;
        if (window.isGuest != null) return !!window.isGuest;
        var u = _us();
        if (u && u.id && u.id !== 'guest' && !String(u.id).startsWith('guest-')) return false;
        return true;
    }
    function _isAdmin() { return !!(window.isAdmin || (window.EmpState && window.EmpState.isAdmin)); }
    function _cfg() { return (window._appConfig && window._appConfig.cloudinary) || {}; }

    /* ── GUARD: app-sos.js sometimes calls createSosPostOnFeed(sosData) before
       app-feed.js has exposed it, or before sosData is populated. Wrap the
       global to swallow ReferenceErrors instead of crashing the page. ── */
    (function _guardSosDataGlobal() {
        var _origCreateSos = window.createSosPostOnFeed;
        function _safeSos(data) {
            if (!data || typeof data !== 'object') return;
            try {
                if (typeof _origCreateSos === 'function') { _origCreateSos(data); return; }
                /* app-feed.js not yet loaded — queue and retry once */
                setTimeout(function() {
                    var fn = window.createSosPostOnFeed;
                    if (typeof fn === 'function') try { fn(data); } catch(e) {}
                }, 500);
            } catch(e) { console.warn('[EmpFix] createSosPostOnFeed error:', e.message); }
        }
        /* Install safe wrapper now; re-install if app-feed.js loads later and overwrites it */
        if (!window.createSosPostOnFeed || !window.createSosPostOnFeed._sosSafe) {
            _safeSos._sosSafe = true;
            window.createSosPostOnFeed = _safeSos;
        }
        /* Re-wrap after app-feed.js loads */
        window.addEventListener('load', function() {
            var fn = window.createSosPostOnFeed;
            if (fn && !fn._sosSafe) {
                _origCreateSos = fn;
                _safeSos._sosSafe = true;
                window.createSosPostOnFeed = _safeSos;
            }
        });
    })();

    /* Safe single-wrap of navigateTo — prevent infinite-wrap chains */
    var _navWrapDone = false;
    function _wrapNavigateTo(fn) {
        var prev = window.navigateTo;
        window.navigateTo = function(id, fc) {
            if (typeof prev === 'function') prev(id, fc);
            try { fn(id, fc); } catch (e) { console.warn('[EmpFix navWrap]', e); }
        };
    }


    /* ═══════════════════════════════════════════════════════════════════════
       §1  BOTTOM NAV — SVG icons, milky white, Facebook-style
           Uses inline SVG so it never depends on Font Awesome loading.
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixBottomNav() {
        var SVG = {
            home:        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>',
            reels:       '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6H2v14a2 2 0 002 2h14v-2H4V6zm16-4H8a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg>',
            messages:    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z"/></svg>',
            marketplace: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5c-1.1 0-2 .9-2 2v12a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2zm-7-3a3 3 0 010 6 3 3 0 010-6zm0 10a4 4 0 11.001-8.001A4 4 0 0112 13zm0-6a2 2 0 100 4 2 2 0 000-4z"/></svg>',
            wallet:      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 7H3a2 2 0 00-2 2v9a2 2 0 002 2h18a2 2 0 002-2V9a2 2 0 00-2-2zM1 5h20v2H1zM3 3h16v2H3zm14 10a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/></svg>',
            globe:       '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1a2 2 0 002 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3a1 1 0 00-1-1H8v-2h2a1 1 0 000-2H8V7h2a2 2 0 012 2v1h2a1 1 0 011 1v3h1c.65 0 1.23.24 1.68.63-.18.76-.44 1.49-.78 2.16z"/></svg>',
            news:        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm-1 7H5v-1h14v1zm0-3H5V7h14v1zm-9 6H5v-1h5v1zm4 0h-3v-1h3v1z"/></svg>',
            profile:     '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 3a3 3 0 110 6 3 3 0 010-6zm0 14.2a7.2 7.2 0 01-6-3.22c.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08a7.2 7.2 0 01-6 3.22z"/></svg>',
            /* FEATURE (this session — "insert the notification button also
               at the footer navigation bar at the bottom"): a plain bell
               outline, drawn in the same single-path/currentColor style as
               every other icon in this SVG map so it inherits the same
               sizing/color logic in _makeSVG() below with no special case. */
            bell:        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 00-2 2v.34C7.16 5.16 5 7.8 5 11v4.5L3 18v1h18v-1l-2-2.5V11c0-3.2-2.16-5.84-5-6.66V4a2 2 0 00-2-2zm0 20a2.5 2.5 0 002.45-2h-4.9A2.5 2.5 0 0012 22z"/></svg>'
        };
        var ICON_MAP = { dashboard:'home', reels:'reels', messages:'messages', marketplace:'marketplace', 'my-wallet':'wallet', 'ngo-partners':'globe', news:'news', profile:'profile', notifications:'bell' };
        var GUEST_ITEMS = [{id:'dashboard'},{id:'marketplace'},{id:'reels'},{id:'news'},{id:'ngo-partners'}];
        /* FIX (this session — "clicking the notification icon in the footer
           nav should open a full notification section, that has not been
           done"): 'notifications' WAS treated as not-a-real-content-section
           (see the old comment this replaces), so the click handler below
           special-cased it to proxy a click onto the header's #notif-bell-btn
           dropdown instead of ever calling navigateTo(). But index.html
           already ships a real #notifications content-section (full-page
           list, "Mark all read" button) and app-notifications.js already
           has renderNotifPage() fully wired to populate it on
           empyrean-section-change — the two pieces just never got
           connected to this tap. 'notifications' is now treated as an
           ordinary section id: the click handler's special case is removed
           below so it falls through to the same navigateTo(btn.dataset
           .target, true) path every other footer tab already uses. The
           header bell's own #notif-panel dropdown is untouched — it still
           opens from the header bell icon exactly as before, this only
           changes what tapping the FOOTER bell does. */
        var USER_ITEMS  = [{id:'dashboard'},{id:'reels'},{id:'messages',badge:'messages'},{id:'marketplace'},{id:'my-wallet'},{id:'notifications',badge:'notifications'},{id:'profile',isAvatar:true}];

        function _badgeCount(key) {
            try {
                if (key==='messages') return window._unreadMessageCount||0;
                /* window._empNotifUnreadCount is a small public mirror of
                   app-notifications.js's own private unread counter — see
                   that file's updateBadge() for where it's kept in sync. */
                if (key==='notifications') return window._empNotifUnreadCount||0;
            } catch(e){}
            return 0;
        }
        function _avatarSrc() { var u=_us(); return (u&&(u.avatar||u.profilePhoto||u.profilePic))||null; }
        function _makeSVG(key, color) {
            return (SVG[key]||SVG.home).replace('<svg ','<svg width="26" height="26" style="display:block;flex-shrink:0;color:'+color+'" ');
        }
        function _buildItem(item, activeId) {
            var isActive = item.id === activeId, color = isActive ? '#1877F2' : '#65676B';
            var btn = document.createElement('button');
            btn.className = 'emp-nav-btn' + (isActive ? ' active' : '');
            btn.dataset.target = btn.dataset.section = item.id;
            btn.setAttribute('aria-label', item.id);
            btn.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;'+
                'background:none;border:none;border-top:3px solid '+(isActive?'#1877F2':'transparent')+';'+
                'cursor:pointer;padding:0;height:60px;color:'+color+';-webkit-tap-highlight-color:transparent;'+
                'transition:color .15s,border-color .15s;position:relative;';
            if (item.isAvatar) {
                var src = _avatarSrc();
                btn.innerHTML = src
                    ? '<img src="'+_esc(src)+'" alt="Profile" style="width:30px;height:30px;min-width:30px;max-width:30px;max-height:30px;border-radius:50%;object-fit:cover;border:2.5px solid '+(isActive?'#1877F2':'rgba(0,0,0,0.15)')+';" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><span style="display:none;width:30px;height:30px;border-radius:50%;background:#E4E6EB;align-items:center;justify-content:center;">'+_makeSVG('profile',color)+'</span>'
                    : _makeSVG('profile', color);
            } else {
                var cnt = item.badge ? _badgeCount(item.badge) : 0;
                var badge = cnt > 0 ? '<span style="position:absolute;top:8px;right:calc(50% - 22px);background:#E41E3F;color:#fff;font-size:0.52rem;font-weight:700;min-width:15px;height:15px;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:0 3px;border:1.5px solid #fff;line-height:1;">'+(cnt>99?'99+':cnt)+'</span>' : '';
                btn.innerHTML = _makeSVG(ICON_MAP[item.id]||'home', color) + badge;
            }
            return btn;
        }

        function _injectCSS() {
            ['_v7_nav_style','_v8_nav_css','_v9_nav_css','_v10_nav_css','_v10f_nav_css','_vf_nav_css'].forEach(function(id){ var el=document.getElementById(id); if(el) el.remove(); });
            if (document.getElementById('_vf_nav_css')) return;
            var s = document.createElement('style');
            s.id = '_vf_nav_css';
            s.textContent = '#mobile-bottom-nav{position:fixed!important;bottom:0!important;left:0!important;right:0!important;height:60px!important;background:rgba(255,255,255,0.98)!important;border-top:1px solid rgba(0,0,0,0.10)!important;box-shadow:0 -2px 16px rgba(0,0,0,0.08)!important;display:flex!important;align-items:stretch!important;justify-content:space-around!important;z-index:10000!important;padding:0!important;padding-bottom:env(safe-area-inset-bottom,0px)!important;overflow:hidden!important;}#mobile-bottom-nav .mobile-nav-item{display:none!important;}.main-content{padding-bottom:calc(72px + env(safe-area-inset-bottom,0px))!important;}'
            /* FIX: hide mobile nav when thread overlay open; raise composer above nav */
            + 'body.vf-thread-open #mobile-bottom-nav{display:none!important;}'
            + '#vf-th-composer{z-index:10001!important;}'
            + '#vf-th-comment-fab{z-index:10001!important;}';
            document.head.appendChild(s);
        }

        function _build() {
            _injectCSS();
            var old = document.getElementById('mobile-bottom-nav'); if (old) old.remove();
            var activeId; try { activeId = localStorage.getItem('empyrean_last_section')||'dashboard'; } catch(e){ activeId='dashboard'; }
            var items = _isGuest() ? GUEST_ITEMS : USER_ITEMS;
            var nav = document.createElement('nav');
            nav.id = 'mobile-bottom-nav'; nav.setAttribute('role','navigation'); nav.setAttribute('aria-label','Bottom navigation');
            /* GATE (2026-09-28 — "blue bottom nav flashes during network glitches"):
               only THIS builder's nav carries data-emp-nav="final"; style.css hides
               every #mobile-bottom-nav without it, so the older app-nav.js draft can
               never paint, whatever order slow-network events fire in. */
            nav.setAttribute('data-emp-nav','final');
            nav.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:60px;background:rgba(255,255,255,0.98);border-top:1px solid rgba(0,0,0,0.10);box-shadow:0 -2px 16px rgba(0,0,0,0.08);display:flex;align-items:stretch;justify-content:space-around;z-index:10000;padding:0;padding-bottom:env(safe-area-inset-bottom,0px);overflow:hidden;';
            items.forEach(function(item){ nav.appendChild(_buildItem(item, activeId)); });
            nav.addEventListener('click', function(e){
                var btn = e.target.closest && e.target.closest('.emp-nav-btn');
                if (!btn) return; e.preventDefault(); e.stopPropagation();

                /* FIX (this session): 'notifications' used to be special-
                   cased here to proxy onto the header's #notif-bell-btn
                   dropdown instead of navigating — removed (see the header
                   comment above USER_ITEMS/ICON_MAP for why). It now falls
                   through to the same navigateTo(btn.dataset.target, true)
                   call below as every other footer tab, opening the real
                   #notifications section (index.html) that
                   app-notifications.js's renderNotifPage() already
                   populates on empyrean-section-change. */

                nav.querySelectorAll('.emp-nav-btn').forEach(function(b){
                    b.classList.remove('active'); b.style.borderTopColor='transparent'; b.style.color='#65676B';
                    b.querySelectorAll('svg').forEach(function(svg){ svg.style.color='#65676B'; });
                    var img=b.querySelector('img'); if(img) img.style.borderColor='rgba(0,0,0,0.15)';
                });
                btn.classList.add('active'); btn.style.borderTopColor='#1877F2'; btn.style.color='#1877F2';
                btn.querySelectorAll('svg').forEach(function(svg){ svg.style.color='#1877F2'; });
                var img2=btn.querySelector('img'); if(img2) img2.style.borderColor='#1877F2';
                try { localStorage.setItem('empyrean_last_section', btn.dataset.target); } catch(e2){}
                if (typeof window.navigateTo==='function') window.navigateTo(btn.dataset.target, true);
            });
            document.body.appendChild(nav);
        }

        document.addEventListener('empyrean-section-change', function(e){
            if (!e||!e.detail) return;
            var sec=e.detail.section, nav=document.getElementById('mobile-bottom-nav');
            if (!nav) return;
            nav.querySelectorAll('.emp-nav-btn').forEach(function(b){
                var ia=b.dataset.target===sec; b.classList.toggle('active',ia);
                b.style.borderTopColor=ia?'#1877F2':'transparent'; b.style.color=ia?'#1877F2':'#65676B';
                b.querySelectorAll('svg').forEach(function(svg){ svg.style.color=ia?'#1877F2':'#65676B'; });
                var img=b.querySelector('img'); if(img) img.style.borderColor=ia?'#1877F2':'rgba(0,0,0,0.15)';
            });
            try { localStorage.setItem('empyrean_last_section', sec); } catch(e2){}
        });

        ready(_build);
        document.addEventListener('empyrean-init-done', function(){ setTimeout(_build,200); });
        document.addEventListener('empyrean-user-ready', function(){ setTimeout(_build,200); });
        window._buildMobileBottomNav = _build;
        window._empFinalNavBuild = _build; /* stable handle: app-nav.js's old builder delegates here */
        console.log('[§1] Bottom nav — milky white, SVG icons.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §2  VIEWPORT / LAYOUT OVERFLOW FIX
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixViewport() {
        ready(function(){
            ['_v7_viewport_fix','_v10f_layout','_v10f_layout_v2','_v10f_layout_v3','_vf_layout'].forEach(function(id){ var el=document.getElementById(id); if(el) el.remove(); });
            if (document.getElementById('_vf_layout')) return;
            var s=document.createElement('style'); s.id='_vf_layout';
            s.textContent=[
                /* ── 1. Global overflow prevention ── */
                'body{overflow-x:hidden!important;max-width:100vw!important;}',
                'html,body{box-sizing:border-box!important;}',
                '*,*::before,*::after{box-sizing:border-box!important;}',
                '.main-content{overflow-x:hidden!important;max-width:100vw!important;box-sizing:border-box!important;}',
                '#dashboard{width:100%!important;max-width:100%!important;box-sizing:border-box!important;}',

                /* ── 2. Active content sections scroll and clear bottom nav.
                        ONLY .active sections get these rules — inactive ones
                        are display:none so the rules never apply to them. ── */
                '.content-section.active{',
                '  overflow-y:auto!important;',
                '  -webkit-overflow-scrolling:touch!important;',
                '  padding-bottom:calc(72px + env(safe-area-inset-bottom,0px))!important;}',

                /* ── 3. Messages section: needs a defined height so its inner
                        flex children can use height:calc(100%).
                        #messages itself is display:block when active (from app CSS).
                        We give it a fixed viewport height and NO overflow so the
                        children manage scrolling themselves.
                        padding-bottom:0 overrides rule 2 for this section. ── */
                '#messages.active{',
                '  height:calc(100vh - 60px)!important;',
                '  overflow:hidden!important;',
                '  padding-bottom:0!important;}',

                /* ── 4. messages-view is the flex row container ── */
                '#messages.active #messages-view{',
                '  display:flex!important;',
                '  height:100%!important;',
                '  overflow:hidden!important;}',

                /* ── 5. Contact list panel scrolls independently ── */
                '#contact-list-container{',
                '  overflow-y:auto!important;overflow-x:hidden!important;',
                '  -webkit-overflow-scrolling:touch!important;',
                '  display:flex!important;flex-direction:column!important;}',
                /* FIX (Messages section scroll unification): #contacts-inner used to be
                   the sole scrolling pane (flex:1;overflow-y:auto), which is what kept
                   the blue Messages header + search box + Chats/Groups/Broadcasts tabs
                   pinned above it (they live outside #contacts-inner as static
                   siblings, so scrolling the inner pane never moved them). Scroll
                   ownership now lives on #contact-list-container itself (above), so
                   the header/search/tabs scroll away together with the list. This
                   element just flows to its natural content height now. */
                '#contacts-inner{',
                '  overflow:visible!important;',
                '  flex:0 0 auto!important;}',

                /* ── 6. Chat view panel: column flex ── */
                /* NOTE: display is managed by app-patch-openchat.js via .oc-mobile-open.
                   We must NOT force display:flex here unconditionally — that overrides
                   the mobile display:none state and causes the two-column desktop layout
                   to bleed through on phones before a chat is opened. */
                '#chat-view-container{',
                '  flex-direction:column!important;',
                '  overflow:hidden!important;flex:1!important;}',
                /* Only show chat panel when explicitly opened (mobile full-screen) */
                '#chat-view-container.oc-mobile-open{',
                '  display:flex!important;}',
                '#chat-messages-container{',
                '  flex:1!important;overflow-y:auto!important;',
                '  -webkit-overflow-scrolling:touch!important;}',

                /* ── 7. Message input bar: never hidden by bottom nav ── */
                '#chat-view-container.oc-mobile-open>div:last-child{',
                '  flex-shrink:0!important;',
                '  padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))!important;',
                '  background:white!important;}',
            ].join('');
            document.head.appendChild(s);
        });
        console.log('[§2] Viewport + messages section scroll fix.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §3 · §4 · §5  — REMOVED
       All status logic (upload, bar, viewer buttons, retweet, chat, viewers
       panel, video preview, 3-min split) lives exclusively in app-status.js.
       These sections were causing direct conflicts:
         §3 overwrote the Facebook-style file preview with 80×80 thumbnails.
         §5 hid the retweet button, broke the viewers-panel slide animation,
            and double-wired profile/chat buttons with stale closures.
    ═══════════════════════════════════════════════════════════════════════ */


    /* ═══════════════════════════════════════════════════════════════════════
       §6  REEL BUBBLE BUTTONS (like, comment, retweet, share, download)
           Capture-phase handler — fires before any blocking inline handlers.
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixReelButtons(){
        if (!window._reelDataStore) window._reelDataStore = {};
        function _getData(id){ if(!window._reelDataStore[id]) window._reelDataStore[id]={likes:0,likedBy:[],retweets:0,retweetedBy:[],comments:[]}; return window._reelDataStore[id]; }
        function _reward(type){ if(typeof window._rewardUser==='function') try{window._rewardUser(type);}catch(e){} }
        function _getReelId(btn){ return btn.dataset.reelId||(btn.closest('[data-reel-id]')&&btn.closest('[data-reel-id]').dataset.reelId)||(btn.closest('.reel-viewer-item')&&btn.closest('.reel-viewer-item').dataset.reelId)||(btn.closest('.reel-card')&&btn.closest('.reel-card').dataset.reelId)||null; }
        var SEL={ like:'.reel-like-btn,[data-reel-action="like"]', comment:'.reel-comment-btn,[data-reel-action="comment"]', retweet:'.reel-retweet-btn,[data-reel-action="retweet"],.reel-repost-btn', share:'.reel-share-btn,[data-reel-action="share"]', download:'.reel-download-btn,[data-reel-action="download"]' };

        document.addEventListener('click',function(e){
            var inViewer=document.getElementById('reel-viewer-overlay'), inCard=e.target.closest&&e.target.closest('.reel-card,.reel-viewer-item');
            if (!inCard&&!(inViewer&&inViewer.contains(e.target))) return;
            var t=e.target;

            var likeBtn=t.closest&&t.closest(SEL.like);
            if (likeBtn){ e.preventDefault(); e.stopImmediatePropagation();
                if(_isGuest()){ _notify('Log in to like reels.','info'); return; }
                var reelId=_getReelId(likeBtn), uid=(_us()).id, data=_getData(reelId), idx=data.likedBy.indexOf(uid);
                if(idx>-1){ data.likedBy.splice(idx,1); data.likes=Math.max(0,data.likes-1); likeBtn.classList.remove('liked','active'); likeBtn.style.color=''; }
                else {
                    data.likedBy.push(uid); data.likes++; likeBtn.classList.add('liked','active'); likeBtn.style.color='#EF4444'; _reward('ENGAGE_LIKE');
                    /* FIX: reel like tap had ZERO bubble animation anywhere — only the
                       feed-post like handler further down this file had one. Reuse the
                       same red-heart-floats-up likeBubblePop keyframe (app-patch-v7.js §A)
                       so reel likes match feed/post like behaviour. Only fires on like,
                       not unlike. */
                    try {
                        var _lbReel = document.createElement('span');
                        _lbReel.innerHTML = '<i class="fas fa-heart" style="color:#EF4444;"></i>';
                        var _brReel = likeBtn.getBoundingClientRect();
                        _lbReel.style.cssText = 'position:fixed;left:' + (_brReel.left + (_brReel.width / 2) - 8) + 'px;top:' + (_brReel.top - 5) + 'px;pointer-events:none;font-size:1.6rem;z-index:99999;animation:likeBubblePop 1.2s ease-out forwards;';
                        document.body.appendChild(_lbReel);
                        setTimeout(function () { if (_lbReel.parentNode) _lbReel.remove(); }, 1400);
                    } catch (eReelBubble) {}
                }
                var lc=likeBtn.querySelector('.reel-like-count,.count,[class*="count"]'); if(lc) lc.textContent=data.likes;
                if(_fbOk()&&reelId) window.fbDb.collection('reels').doc(reelId).update({likes:data.likes,likedBy:data.likedBy}).catch(function(){});
                return;
            }
            var commentBtn=t.closest&&t.closest(SEL.comment);
            if (commentBtn){ e.preventDefault(); e.stopImmediatePropagation();
                /* Route to shared body-level drawer (app-reel.js architecture) */
                var reelIdC = _getReelId(commentBtn);
                /* Ensure drawer exists even if reel viewer hasn't opened yet */
                if (typeof window._empReelEnsureDrawer === 'function') window._empReelEnsureDrawer();
                var sharedDr = document.getElementById('reel-shared-comments-drawer');
                var sharedList = document.getElementById('reel-shared-comments-list');
                var scrimC = document.getElementById('reel-comments-scrim');
                if (sharedDr && reelIdC) {
                    sharedDr.dataset.reelId = reelIdC;
                    /* Reset input */
                    var sharedInp = document.getElementById('reel-shared-comment-input');
                    if (sharedInp) { sharedInp.value = ''; delete sharedInp.dataset.replyTo; sharedInp.placeholder = 'Add a comment…'; }
                    /* Set avatar */
                    var avEl = document.getElementById('reel-commenter-avatar');
                    if (avEl) avEl.src = (_us() && _us().avatar) || '';
                    /* Render comments via app-reel.js renderer if available */
                    if (typeof window._empReelRenderComments === 'function') {
                        window._empReelRenderComments(reelIdC, sharedList);
                    }
                    /* Update badge */
                    var badgeC = document.getElementById('reel-comments-count-badge');
                    if (badgeC && window._reelDataStore && window._reelDataStore[reelIdC]) {
                        var cnt = (window._reelDataStore[reelIdC].comments || []).length;
                        badgeC.textContent = cnt ? '(' + cnt + ')' : '';
                    }
                    sharedDr.classList.add('open');
                    if (scrimC) scrimC.classList.add('active');
                    setTimeout(function(){ if (sharedInp) sharedInp.focus(); }, 350);
                } else {
                    _notify('Comments coming soon.','info');
                }
                return;
            }
            /* RETWEET -- SUPERSEDED, NOW A DOCUMENTED NO-OP (2026-08-30 --
               bug: "retweet/tweet features are not functioning, count
               doesn't update, no retweet activity reflected on home feed
               or profile"). Same class of bug as the SHARE branch
               immediately below (already disabled) -- this whole listener
               is registered on `document` in the CAPTURE phase (see the
               `,true` on this file's addEventListener call), so it always
               ran BEFORE app-reel.js's own delegated click handler for
               '.reel-retweet-btn' (a bubble-phase document listener --
               capture always reaches `document` before the event bubbles
               back up to it, regardless of script load order). This
               branch's own stopImmediatePropagation() above meant
               app-reel.js's real handler -- the one with the premium "Add
               a comment / Repost" card, the actual repost document written
               to Firestore, and the retweetCount/home-feed/profile
               mirroring -- never got a chance to run. What ran instead was
               this branch's own local-only toggle: no repost doc was ever
               created, and it wrote a differently-shaped retweets/
               retweetedBy field that nothing else in the app reads --
               exactly matching all four reported symptoms. No-op'd here,
               same "supersede, don't delete" precedent already used for
               the SHARE branch right below. */
            if (false && t.closest && t.closest(SEL.retweet)) {
                var rtBtn=t.closest(SEL.retweet);
                if(_isGuest()){ _notify('Log in to repost.','info'); return; }
                var reelId2=_getReelId(rtBtn), uid2=(_us()).id, data2=_getData(reelId2), idx2=data2.retweetedBy.indexOf(uid2);
                if(idx2>-1){ data2.retweetedBy.splice(idx2,1); data2.retweets=Math.max(0,data2.retweets-1); rtBtn.classList.remove('retweeted','active'); rtBtn.style.color=''; }
                else { data2.retweetedBy.push(uid2); data2.retweets++; rtBtn.classList.add('retweeted','active'); rtBtn.style.color='#10B981'; _notify('Reel reposted! \u2728','success'); _reward('RETWEET_POST'); }
                var rc=rtBtn.querySelector('.reel-retweet-count,.count,[class*="count"]'); if(rc) rc.textContent=data2.retweets;
                if(_fbOk()&&reelId2) window.fbDb.collection('reels').doc(reelId2).update({retweets:data2.retweets,retweetedBy:data2.retweetedBy}).catch(function(){});
                return;
            }
            /* SHARE — SUPERSEDED, NOW A DOCUMENTED NO-OP (this session, bug:
               "share button doesn't work... clicking share should
               rebroadcast the original reel"): this branch's own comment
               claimed stopImmediatePropagation() above meant this handler
               "owns reel action-bar clicks exclusively" — but that's only
               true for listeners registered AFTER this one. app-reel.js's
               own delegated click handler (its "── Share reel ──" branch)
               is attached to document earlier in page-load order (see
               index.html script order: app-reel.js loads well before this
               file), so it always ran FIRST and was never actually
               stopped by this one — every reel-share tap was firing BOTH
               handlers: two navigator.share() calls (sometimes two
               overlapping native share sheets) and, worse, neither one
               ever created a real repost, which is the actual bug that
               was reported. app-reel.js's handler now owns real rebroadcast
               logic (_rebroadcastReel() — writes an actual reel doc so the
               share shows up in the sharer's own reel section + profile,
               not just a link) AND still opens the native share sheet /
               copies the link itself, so nothing here is lost by no-op'ing
               this copy — same "supersede, don't delete" precedent already
               used for the analogous duplicate in app-fixes.js's own click
               handler (search "share button fires twice"). Left as `if
               (false && ...)` rather than removed so the history/reasoning
               stays visible and this can't silently reappear as dead code
               that looks unintentionally missing. */
            if (false && t.closest && t.closest(SEL.share)) {
                var shareBtn=t.closest(SEL.share);
                var shareUrl=shareBtn.dataset.url||window.location.origin+'?reel='+(_getReelId(shareBtn)||'');
                if(navigator.share) navigator.share({title:'Empyrean Reel',url:shareUrl}).catch(function(){});
                else { try{navigator.clipboard.writeText(shareUrl);}catch(e2){} _notify('Link copied!','success'); }
                _reward('SHARE_POST');
                return;
            }
            /* DOWNLOAD — SUPERSEDED, NOW A DOCUMENTED NO-OP (2026-08-31 —
               feature: "add the Empyrean watermark to video downloads in
               the reel section and other videos across the site,
               dynamically inserting the username of the poster, just like
               TikTok"). Same capture-vs-bubble mechanism the RETWEET
               branch above already documents: this whole listener is
               registered on `document` in the CAPTURE phase (see the
               `,true` on this file's addEventListener call below), so it
               always ran BEFORE app-reel.js's own delegated click handler
               for '.reel-download-btn' (a bubble-phase document listener —
               capture always reaches `document` before the event bubbles
               back up to it, regardless of script load order). This
               branch's own stopImmediatePropagation() above meant
               app-reel.js's real handler — now the one that fetches the
               file, burns in the Empyrean watermark with the poster's own
               @username via app-fixes.js's shared watermark engine
               (window._watermarkVideoBlob), and falls back to this exact
               plain download only when watermarking isn't supported —
               never got a chance to run. What ran instead was this
               branch's own plain, un-watermarked `<a download>`, exactly
               matching the reported gap (reel downloads never carried a
               watermark at all). No-op'd here, same "supersede, don't
               delete" precedent already used for the RETWEET and SHARE
               branches above. */
            if (false && t.closest && t.closest(SEL.download)) {
                var dlBtn=t.closest(SEL.download);
                e.preventDefault(); e.stopImmediatePropagation();
                var ri=dlBtn.closest('.reel-viewer-item,.reel-card'), vid=ri&&ri.querySelector('video');
                var dlUrl=dlBtn.dataset.url||(vid&&(vid.src||(vid.querySelector('source')&&vid.querySelector('source').src)))||'';
                if(!dlUrl){ _notify('Video URL not available.','error'); return; }
                var a=document.createElement('a'); a.href=dlUrl; a.download='empyrean-reel-'+Date.now()+'.mp4'; a.target='_blank'; a.rel='noopener noreferrer';
                document.body.appendChild(a); a.click(); a.remove(); _notify('Download started!','success');
                return;
            }
        },true);

        /* Sync Firestore data into local store when viewer opens */
        ready(function(){
            var overlay=document.getElementById('reel-viewer-overlay');
            if (overlay) new MutationObserver(function(){
                overlay.querySelectorAll('[data-reel-id]').forEach(function(el){ var rid=el.dataset.reelId; if(rid&&!window._reelDataStore[rid]&&_fbOk()) window.fbDb.collection('reels').doc(rid).get().then(function(doc){ if(doc.exists){ var d=doc.data(); window._reelDataStore[rid]={likes:d.likes||0,likedBy:d.likedBy||[],retweets:d.retweets||0,retweetedBy:d.retweetedBy||[],comments:d.comments||[]}; } }).catch(function(){}); });
            }).observe(overlay,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
        });

        /* §6-EXIT-SYNC: JS-driven reel exit button visibility.
           CSS sibling selector (#reel-viewer-modal-overlay.show ~ #reel-exit-btn)
           is unreliable when both elements are appended to <body> at different
           times by app-reel.js vs app-fix-final.js. This observer guarantees the
           button shows/hides correctly for BOTH overlay IDs used in the codebase. */
        function _ensureReelExitBtn() {
            var exitBtn = document.getElementById('reel-exit-btn');
            if (!exitBtn) {
                exitBtn = document.createElement('button');
                exitBtn.id = 'reel-exit-btn';
                exitBtn.setAttribute('aria-label', 'Close reels');
                exitBtn.title = 'Close reels (Esc)';
                exitBtn.innerHTML = '<i class="fas fa-times"></i>';
                exitBtn.style.cssText = 'position:fixed;top:18px;right:18px;z-index:10001;background:rgba(10,14,30,0.82);border:1.5px solid rgba(255,255,255,0.22);cursor:pointer;color:white;width:46px;height:46px;border-radius:50%;display:none;align-items:center;justify-content:center;font-size:1.15rem;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 4px 22px rgba(0,0,0,0.6);transition:background 0.2s,transform 0.15s;';
                document.body.appendChild(exitBtn);
                exitBtn.addEventListener('click', function() {
                    if (typeof window._closeReelViewer === 'function') window._closeReelViewer();
                });
            }
            /* Observe both overlay IDs used across modules */
            ['reel-viewer-modal-overlay', 'reel-viewer-overlay'].forEach(function(ovId) {
                var ov = document.getElementById(ovId);
                if (!ov || ov._vfExitBtnObs) return;
                ov._vfExitBtnObs = true;
                new MutationObserver(function() {
                    var btn = document.getElementById('reel-exit-btn');
                    if (!btn) return;
                    var isOpen = ov.classList.contains('show') || ov.style.display === 'flex' || ov.style.display === 'block';
                    btn.style.display = isOpen ? 'flex' : 'none';
                }).observe(ov, { attributes: true, attributeFilter: ['class', 'style'] });
            });
        }
        ready(function() { setTimeout(_ensureReelExitBtn, 500); });
        document.addEventListener('empyrean-init-done', function() { setTimeout(_ensureReelExitBtn, 400); });
        document.addEventListener('click', function(e) {
            if (e.target.closest && e.target.closest('.reel-card,.reel-preview-card,.dashboard-reel-card')) setTimeout(_ensureReelExitBtn, 150);
        });

        console.log('[§6] Reel bubble buttons fixed.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §7  UNIVERSAL CLOSE / EXIT BUTTONS — including REEL EXIT FIX
           This is the authoritative close handler. All other close logic
           in previous fix files is replaced by this single implementation.
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixCloseButtons(){
        // FIX (mock/conflict cleanup — "modal only opens once" bug): this used to
        // unconditionally set `el.style.display = 'none'` on every close, in
        // addition to removing the 'show' class. For .live-sub-modal elements
        // (gift catalog, viewer rankings, guest join-requests, goal/fan-club/
        // games settings — see style.css: `.live-sub-modal{display:none}` /
        // `.live-sub-modal.show{display:flex}`), that inline style has higher
        // specificity than the class rule and is NEVER cleared anywhere. So the
        // first time any of these was closed via its × button, it got stuck
        // with an inline display:none forever — every later `.classList.
        // toggle('show')` (the gift button, the host-requests bell, etc.)
        // still correctly added the 'show' class, but the inline style kept
        // rendering it hidden regardless. This is why gift/host-requests/
        // viewer-rankings modals worked exactly once and then silently
        // stopped opening. For .live-sub-modal elements we now only touch the
        // class and clear any stale inline display so the CSS rule governs
        // both directions; other modal types (which don't have a class-based
        // show/hide rule and rely on this function to set display:none
        // directly) keep the original behavior.
        function _closeEl(el){
            if(!el) return;
            if (el.classList.contains('live-sub-modal')) {
                el.style.removeProperty('display');
            } else {
                el.style.display='none';
            }
            el.classList.remove('show','active','open');
            document.body.classList.remove('modal-open','reel-open');
            document.body.style.overflow='';
        }
        /* Reel-specific teardown — pauses + unloads video src to free memory */
        function _closeReelViewer(){
            var ov=document.getElementById('reel-viewer-modal-overlay'); _closeEl(ov);
            document.querySelectorAll('#reel-viewer-modal-overlay video,.reel-viewer-item video').forEach(function(v){ try{v.pause();v.removeAttribute('src');v.load();}catch(ve){} });
            var ct=document.getElementById('reel-viewer-container'); if(ct) ct.innerHTML='';
            var eb=document.getElementById('reel-exit-btn'); if(eb) eb.style.display='none';
        }
        window._closeReelViewer=_closeReelViewer;
        function _findOverlay(btn){ return btn.closest('.modal-overlay-container,.modal-overlay,[id$="-modal"],[id$="-overlay"],.live-sub-modal,#create-status-modal,#status-viewer-modal,#emp-reset-modal'); }

        document.addEventListener('click',function(e){
            var t=e.target;

            /* Generic close-modal classes */
            if (t.classList.contains('close-modal')||t.classList.contains('close-modal-btn')||t.classList.contains('modal-close-btn')||(t.closest&&(t.closest('.close-modal')||t.closest('.close-modal-btn')))){
                var btn2=t.closest('.close-modal,.close-modal-btn')||t, overlay=_findOverlay(btn2)||_findOverlay(t);
                if(overlay){ e.stopImmediatePropagation(); _closeEl(overlay); return; }
            }

            /* Specific ID map (covers reel exit, status viewer close, etc.) */
            var id=t.id||'';
            var idMap={
                'cancel-status-btn':       'create-status-modal',
                'status-viewer-close':     'status-viewer-modal',
                'status-viewer-close-btn': 'status-viewer-modal',
                'live-close-btn':          'go-live-modal-overlay',
                'emp-reset-close':         'emp-reset-modal',
                'emp-reset-cancel':        'emp-reset-modal',
                'kyc-camera-close-btn':    'kyc-camera-modal'
            };
            if (idMap[id]){ e.stopImmediatePropagation(); _closeEl(document.getElementById(idMap[id])); if(id==='live-close-btn'&&typeof window.endLiveStream==='function') try{window.endLiveStream();}catch(_2){} return; }

            /* REEL EXIT — covers .reel-viewer-close (index.html native btn) AND
               #reel-exit-btn (app-reel.js injected btn) */
            var reelClose = t.closest&&(
                t.closest('#reel-close-btn,#reel-exit-btn,.reel-close-btn,.reel-exit-btn,.reel-viewer-close,[data-reel-action="close"],[data-reel-action="exit"],.reel-back-btn,#close-reel-viewer')
            );
            if (reelClose){ e.stopImmediatePropagation(); e.preventDefault(); _closeReelViewer(); return; }

            /* Backdrop click on reel overlay */
            if (t.id==='reel-viewer-modal-overlay'&&e.target===t){ e.stopImmediatePropagation(); _closeReelViewer(); return; }

            /* Backdrop click */
            if ((t.classList.contains('modal-overlay-container')||t.classList.contains('modal-overlay')||t.id==='emp-reset-modal')&&e.target===t){ e.stopImmediatePropagation(); _closeEl(t); }

        },true);

        /* Escape key */
        document.addEventListener('keydown',function(e){ if(e.key!=='Escape') return; var ov=document.getElementById('reel-viewer-modal-overlay'); if(ov&&(ov.classList.contains('show')||ov.style.display==='block')){ _closeReelViewer(); return; } document.querySelectorAll('.modal-overlay-container.show,.modal-overlay.show').forEach(_closeEl); });

        /* Admin exit button */
        ready(function(){ var ax=document.getElementById('admin-exit-btn'); if(ax&&!ax._vfClose){ ax._vfClose=true; ax.addEventListener('click',function(e){ e.preventDefault(); e.stopImmediatePropagation(); if(typeof window.navigateTo==='function') window.navigateTo('dashboard'); }); } });

        console.log('[§7] Universal close/exit buttons fixed (incl. reel exit).');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §8  PROFILE PAGE BLANK FIX
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixProfileBlank(){
        function _doRender(uid){
            uid=uid||_us().id; if(!uid) return false;
            var mu=window.mockUsers||(window.EmpState&&window.EmpState.mockUsers)||{};
            var sec=document.getElementById('profile'); if(!sec) return false;
            if (sec.children.length>1) return true;
            if (typeof window.renderUserProfile==='function') try{ window.renderUserProfile(uid); return true; } catch(e){ return false; }
            return false;
        }
        function _tryRender(uid,delay,attempts){ if(attempts<=0) return; setTimeout(function(){ if(!_doRender(uid)) _tryRender(uid,delay*1.8,attempts-1); },delay); }

        _wrapNavigateTo(function(id){ if(id==='profile'||id==='my-profile') _tryRender(null,80,8); });
        document.addEventListener('empyrean-section-change',function(ev){ if(ev&&ev.detail&&ev.detail.section==='profile') _tryRender(null,100,6); });
        document.addEventListener('empyrean-init-done',function(){ var a=document.querySelector('.content-section.active'); if(a&&a.id==='profile') _tryRender(null,200,6); });
        ready(function(){ var sec=document.getElementById('profile'); if(!sec) return; new MutationObserver(function(){ if(sec.classList.contains('active')) _tryRender(null,60,8); }).observe(sec,{attributes:true,attributeFilter:['class']}); });

        /* Avatar/username click in feed → view that user's profile */
        document.addEventListener('click',function(e){ var pa=e.target.closest&&e.target.closest('[data-profile-uid],.post-author-link'); if(!pa) return; var uid=pa.dataset.profileUid||pa.dataset.userId; if(uid){ window._viewingOtherProfile=true; window._viewingProfileId=uid; _tryRender(uid,350,4); } });
        console.log('[§8] Profile blank fix.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §9  MESSAGES CONTACTS LIST
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixMessages(){
        var _built=false;
        function _avatar(u){ return u.avatar||u.profilePhoto||('https://ui-avatars.com/api/?name='+encodeURIComponent(u.fullName||u.username||'U')+'&background=1B2B8B&color=fff&size=80'); }

        // FEATURE ("enable user to join live through the message avatar
        // from the message section; once a user is online it should
        // indicate in their picture avatar"): app-live.js already has a
        // generic, working click delegate for any element carrying
        // data-live-avatar-for="<hostId>" (see joinLiveByHostId), and
        // already tracks who's currently live in window._liveHostStreamIds
        // — this just wires the messages list's avatars into that existing
        // system instead of building a parallel one. Online status reuses
        // app-notifications.js's real dot-update selector
        // ('.contact-item[data-user-id] .online-dot'), which never matched
        // anything here because these rows only ever had class
        // "contact-row" — kept that class (other code may depend on it)
        // and additionally tag every row/avatar-wrap with "contact-item"
        // and the dot with "online-dot" so that existing logic can
        // actually reach them.
        function _applyLivePresence(avatarWrapEl, avatarImgEl, uid) {
            if (!avatarWrapEl || !uid) return;
            var live = window._liveHostStreamIds && window._liveHostStreamIds[uid];
            if (live) {
                avatarWrapEl.classList.add('vf-avatar-live-ring');
                if (avatarImgEl) avatarImgEl.dataset.liveAvatarFor = uid;
            } else {
                avatarWrapEl.classList.remove('vf-avatar-live-ring');
                if (avatarImgEl) delete avatarImgEl.dataset.liveAvatarFor;
            }
        }
        if (!document.getElementById('vf-live-ring-style')) {
            var _liveRingStyle = document.createElement('style');
            _liveRingStyle.id = 'vf-live-ring-style';
            _liveRingStyle.textContent = '.vf-avatar-live-ring img{border:2.5px solid #EF4444!important;box-shadow:0 0 0 2px rgba(239,68,68,0.25);cursor:pointer;}';
            document.head.appendChild(_liveRingStyle);
        }
        // Periodically re-check live/online state against whatever rows are
        // currently rendered — cheap attribute/class toggles only, no
        // re-render, so it can't regress the list itself.
        function _refreshPresenceDots() {
            document.querySelectorAll('.contact-row[data-user-id], #v8-quick-contacts [data-user-id]').forEach(function (el) {
                var uid = el.dataset.userId; if (!uid) return;
                var wrap = el.querySelector('.vf-avatar-wrap') || el;
                var img = el.querySelector('img');
                _applyLivePresence(wrap, img, uid);
            });
        }
        setInterval(_refreshPresenceDots, 4000);

        function _injectQuickContacts(list){
            /* ACCESS (2026-10-30): only people I follow who follow me back (app-chat.js §0a). */
            list=(list||[]).filter(function(u){ return typeof window._empCanChat!=='function' || window._empCanChat(u.id); });
            var msgView=document.getElementById('messages-view')||document.getElementById('messages');
            if(!msgView) return;
            var existing=document.getElementById('v8-quick-contacts'); if(existing) existing.remove();
            if(!list||!list.length) return;
            var bar=document.createElement('div'); bar.id='v8-quick-contacts';
            bar.style.cssText='display:flex;gap:12px;overflow-x:auto;padding:12px 14px 8px;border-bottom:1px solid rgba(10,14,39,0.07);scrollbar-width:none;-webkit-overflow-scrolling:touch;flex-shrink:0;';
            list.slice(0,12).forEach(function(u){
                var av=_avatar(u), dot=document.createElement('div');
                dot.className='contact-item';
                dot.dataset.userId=u.id;
                dot.style.cssText='display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;flex-shrink:0;';
                dot.innerHTML='<div class="vf-avatar-wrap" style="position:relative;"><img src="'+_esc(av)+'" style="width:52px;height:52px;border-radius:50%;object-fit:cover;border:2.5px solid rgba(27,43,139,0.15);" onerror="this.src=\'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=80\'"><span class="online-dot" style="position:absolute;bottom:1px;right:1px;width:12px;height:12px;border-radius:50%;background:#9CA3AF;border:2px solid white;box-sizing:border-box;"></span></div><span style="font-size:0.65rem;color:#374151;font-weight:600;max-width:52px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+_esc((u.fullName||u.username||'').split(' ')[0])+'</span>';
                // Tapping a currently-live contact's avatar joins their
                // stream (data-live-avatar-for, set by _applyLivePresence
                // below) instead of opening chat.
                dot.addEventListener('click',function(e){
                    if (e.target.closest('[data-live-avatar-for]')) return; // let app-live.js's delegate handle it
                    if(typeof window.openChat==='function') window.openChat(u.id); else if(typeof window._openChatWithUser==='function') window._openChatWithUser(u);
                });
                _applyLivePresence(dot.querySelector('.vf-avatar-wrap'), dot.querySelector('img'), u.id);
                bar.appendChild(dot);
            });
            var inner=document.getElementById('contacts-inner'); if(inner) inner.before(bar); else msgView.prepend(bar);
        }

        function _build(){
            var inner=document.getElementById('contacts-inner'); if(!inner) return;
            var usersMap={}, us=_us();
            var mu=window.mockUsers||(window.EmpState&&window.EmpState.mockUsers)||{};
            Object.values(mu).forEach(function(u){ if(u&&u.id&&u.id!==us.id) usersMap[u.id]=u; });
            var ru=window.registeredUsers||{}; (Array.isArray(ru)?ru:Object.values(ru)).forEach(function(u){ if(u&&u.id&&u.id!==us.id) usersMap[u.id]=u; });
            var list=Object.values(usersMap);
            /* FIX (Groups/Broadcasts tabs showing every contact — bug had
               regressed back): this used to wipe #contacts-inner
               (innerHTML='') and refill it with a .contact-item row for
               EVERY registered/mock user in the system, not real 1:1
               conversations — destroying app-chat.js's real rows plus
               #v14-groups-section and #v20-broadcasts-section (both live
               inside #contacts-inner) every single time this ran. Since
               _try() re-fires this on init, every section-change into
               Messages, every message-sent event, and a repeating
               interval, it kept re-detonating the tab separation those
               later patches build. app-chat.js's renderContactList already
               owns the real conversation list (and is exactly what
               app-patch-v20.js's Chats/Groups/Broadcasts tabs segment) —
               this file's only remaining real job here is the
               quick-contacts strip below, so that's all it does now. */
            _injectQuickContacts(list);
            if (!_fbOk()) return;
            try { window.fbDb.collection('users').limit(100).get().then(function(snap){ var added=false; snap.forEach(function(doc){ var d=doc.data(); d.id=d.id||doc.id; if(d.id&&d.id!==us.id&&!usersMap[d.id]){ usersMap[d.id]=d; if(!window.mockUsers) window.mockUsers={}; window.mockUsers[d.id]=d; added=true; } }); if(added){ var nl=Object.values(usersMap); _injectQuickContacts(nl); } }).catch(function(e){ console.warn('[§9]',e.message); }); } catch(e){}
        }

        function _try(){ var inner=document.getElementById('contacts-inner'); if(!inner) return; if(!_built||!inner.querySelectorAll('.contact-row').length){ _built=true; _build(); } }

        ready(_try); setTimeout(_try,1000); setTimeout(_try,3000);
        _wrapNavigateTo(function(id){ if(id==='messages'||id==='chat') setTimeout(_try,150); });
        document.addEventListener('empyrean-section-change',function(ev){ if(ev&&ev.detail&&ev.detail.section==='messages') _try(); });
        ready(function(){ var si=document.getElementById('contacts-search'); if(si&&!si._vfSearch){ si._vfSearch=true; si.addEventListener('input',function(){ var q=si.value.toLowerCase(); document.querySelectorAll('#contacts-inner .contact-row').forEach(function(r){ r.style.display=(!q||r.textContent.toLowerCase().includes(q))?'':'none'; }); }); } });

        /* Inject chat back button */
        /* _injectBackBtn disabled: app-patch-openchat.js owns the chat header
           (including the X close button). Injecting #vf-chat-back-btn here
           conflicts with that header and triggers a strip loop in §13b of
           app-patch-openchat.js that causes "Maximum call stack size exceeded". */
        function _injectBackBtn(){ /* no-op — intentionally disabled */ }
        /* ── openChat wrap: DEFERRED so the real function is defined first ──
           Previous code ran at IIFE parse time when window.openChat was still
           undefined (app-nav.js defines it inside DOMContentLoaded).
           Now we wait for empyrean-init-done before wrapping, and use a lazy
           resolver so stacking wrappers never break the original. ── */
        function _wrapOpenChat() {
            /* Find the real unwrapped openChat */
            var real = window._vfRealOpenChat || window.openChat;
            if (typeof real !== 'function') return; /* not ready yet */
            /* Store the real function so repeated calls never double-wrap */
            if (!window._vfRealOpenChat) window._vfRealOpenChat = real;
            window.openChat = function(userId, name) {
                window._vfRealOpenChat.apply(this, arguments);
                setTimeout(_injectBackBtn, 400);
            };
            window.openChat._vfBackBtnWrapped = true;
        }
        /* Export renderContactList so app-fixes.js bare call works.
           FIX (Groups/Broadcasts tabs reverting): this used to overwrite
           window.renderContactList outright, permanently discarding
           app-chat.js's real implementation (assigned earlier, since
           app-chat.js loads before this file) with only this file's own
           quick-contacts refresh. Every caller of window.renderContactList()
           — the message-sent listener right below, app-fixes.js's bare
           call, app-patch-openchat.js — was therefore never actually
           refreshing the real 1:1 conversation rows app-patch-v20.js
           segments into tabs. Same lazy-resolver pattern as _wrapOpenChat
           above: save the real function once, then delegate to it. */
        if (!window._vfRealRenderContactList && typeof window.renderContactList === 'function') {
            window._vfRealRenderContactList = window.renderContactList;
        }
        window.renderContactList = function() {
            if (typeof window._vfRealRenderContactList === 'function') window._vfRealRenderContactList();
            _built = false; _try();
        };
        /* Defer the wrap + initial build until real functions are ready */
        document.addEventListener('empyrean-init-done', function() {
            setTimeout(function() { _wrapOpenChat(); _try(); }, 300);
        });
        document.addEventListener('empyrean-user-ready', function() {
            setTimeout(function() { _wrapOpenChat(); _built = false; _try(); }, 200);
        });
        document.addEventListener('empyrean-message-sent', function() {
            setTimeout(function() { if (typeof window.renderContactList === 'function') window.renderContactList(); }, 200);
        });
        console.log('[§9] Messages contacts + quick scroll + back button + deferred openChat wrap.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §10  SUGGESTED USERS — visibility + Follow button
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixSuggestedUsers(){
        /* Delegated follow button handler
           FIX (2026-08-24 — "follower/following counts stuck at zero,
           never increase"): this handler used to independently mutate
           userState.followedUserIds AND write it to Firestore itself, in
           the CAPTURE phase (the trailing `true` below) on `document` —
           which fires BEFORE app-fixes.js's own canonical `.follow-btn`
           handler (registered on `document.body` with no capture flag,
           i.e. bubble phase; capture-on-document always resolves before
           bubble-on-a-descendant for the same click). So every tap did
           this, in order:
             1. THIS handler ran first: added uid to followedUserIds,
                wrote the array to Firestore, relabeled the button
                "Following".
             2. app-fixes.js's handler ran next and re-checked
                userState.followedUserIds.has(uid) to decide follow vs
                unfollow — found it already true (this handler had just
                added it) — so it took the UNFOLLOW branch: deleted the
                uid again, wrote the array back out MINUS it, and
                decremented the count.
           Net effect on Firestore: every follow tap round-tripped back
           to "not following", and the target's followerCount (only ever
           incremented inside app-fixes.js's handler) was never reached
           at all on the follow half of that round-trip. This is why the
           indicator never moved. Fix: this handler no longer touches
           followedUserIds or Firestore — that's app-fixes.js's job, and
           only app-fixes.js's job now. This handler keeps just its own
           presentational effect (fade the suggested-user card out after
           a successful follow), reading the OUTCOME of the canonical
           handler a tick later instead of racing it. */
        document.addEventListener('click',function(e){
            var btn=e.target.closest&&e.target.closest('.follow-btn,.suggested-follow-btn');
            if (!btn) return;
            /* FIX (2026-10-07 — "Follow on the home feed should show Following instantly,
               like Facebook/X"): this fade-away is ONLY meant for the Suggested-for-you
               cards. The feed post's own Follow button (.emp-post-follow, app-feed.js)
               carries data-user-id itself, so `btn.closest('[data-user-id]')` below
               resolved to the BUTTON, faded it out 50ms after the tap and removed it —
               the button vanished instead of settling on "Following". Leave it alone. */
            if (btn.classList.contains('emp-post-follow')) return;
            /* FIX (2026-10-28 — Follow-15 sheet): the sheet's Follow button itself
               carries data-user-id, so `card` below resolved to the BUTTON and this
               removed it ~350ms after a follow (followed rows lost their button).
               The sheet (app-nav.js) manages its own Following state — leave it. */
            if (btn.closest && btn.closest('#emp-follow-gate')) return;
            var card=btn.closest('.suggested-user-card,[data-user-id]'); if(!card||!card.dataset.userId) return;
            setTimeout(function(){
                // app-fixes.js's canonical handler has now run (bubble
                // phase, same click) and toggled the button's real state.
                // Only animate the card away on an actual FOLLOW result —
                // an unfollow tap (or the canonical handler bailing out
                // for some reason) leaves the card alone.
                if (!btn.classList.contains('followed')) return;
                card.style.transition='opacity 0.28s,transform 0.28s'; card.style.opacity='0'; card.style.transform='scale(0.85)';
                setTimeout(function(){ card.remove(); if(typeof window.renderSuggestedUsers==='function') try{window.renderSuggestedUsers();}catch(e2){} },300);
            }, 50);
        },true);

        function _ensureVisible(){ if(_isGuest()) return; var c=document.getElementById('suggested-users-container'), s=document.getElementById('suggested-users-slider'); if(!c||!s) return; var hasUsers=Object.keys(window.mockUsers||{}).length>0||(window._firestoreSuggestedUsers||[]).length>0; if(hasUsers&&s.children.length>0&&getComputedStyle(c).display==='none') c.style.display='block'; if(!s.children.length){ window._suggestedFetchDone=false; if(typeof window.renderSuggestedUsers==='function') window.renderSuggestedUsers(); } }
        document.addEventListener('empyrean-section-change',function(ev){ if(ev&&ev.detail&&ev.detail.section==='dashboard') setTimeout(_ensureVisible,400); });
        document.addEventListener('empyrean-init-done',function(){ setTimeout(_ensureVisible,1500); });
        ready(function(){ setTimeout(_ensureVisible,3000); });
        console.log('[§10] Suggested users fix.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §11  ONLINE PRESENCE DOTS + MESSENGER BADGE
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixOnlineStatus(){
        var _onlineSet=new Set(), _presenceListeners=[], _presenceInterval=null;
        function _heartbeat(){ if(_isGuest()||!_fbOk()) return; var uid=(_us()).id||''; if(!uid) return; try{ window.fbDb.collection('presence').doc(uid).set({online:true,lastSeen:new Date().toISOString(),uid:uid},{merge:true}); }catch(e){} }
        /* FIX (tick-marks jumping straight to double-check / "delivered"
           for a peer who isn't actually there): this heartbeat wrote
           online:true every 60s but nothing ever wrote it back to false —
           Firestore has no server-side onDisconnect() the way the Realtime
           Database does, so a presence doc stayed online:true forever once
           written, even after the person closed the app. app-patch-
           openchat.js's tick logic now also cross-checks lastSeen
           freshness so it can't be fooled by a stale doc forever, but
           marking offline proactively here still makes the common case
           (switching apps / closing the tab normally) reflect instantly
           instead of waiting out the freshness window. Best-effort only —
           a killed process or lost connection on mobile can still skip
           these events entirely, which is exactly why the freshness check
           in app-patch-openchat.js is the real fix and this is just a fast
           path on top of it. */
        function _markOffline(){ if(_isGuest()||!_fbOk()) return; var uid=(_us()).id||''; if(!uid) return; try{ window.fbDb.collection('presence').doc(uid).set({online:false,lastSeen:new Date().toISOString(),uid:uid},{merge:true}); }catch(e){} }
        document.addEventListener('visibilitychange', function(){ if(document.visibilityState==='hidden') _markOffline(); else _heartbeat(); });
        window.addEventListener('pagehide', _markOffline);
        function _updateDots(){ document.querySelectorAll('.online-dot').forEach(function(dot){ var item=dot.closest('[data-user-id]'); if(!item) return; var uid=item.dataset.userId, on=_onlineSet.has(uid); dot.style.background=on?'#10B981':'#9CA3AF'; dot.style.boxShadow=on?'0 0 0 2px rgba(16,185,129,0.3)':'none'; dot.title=on?'Online':'Offline'; }); var md=document.getElementById('messages-online-dot'); if(md){ md.style.background=_onlineSet.size>0?'#10B981':'#9CA3AF'; md.style.display='block'; } }
        function _subscribePresence(){ if(_isGuest()||!_fbOk()) return; var ids=[]; var us=_us(); if(us.followedUserIds){ ids=Array.isArray(us.followedUserIds)?us.followedUserIds:Array.from(us.followedUserIds); } document.querySelectorAll('[data-user-id]').forEach(function(el){ var uid=el.dataset.userId; if(uid&&!ids.includes(uid)) ids.push(uid); }); if(!ids.length) return; _presenceListeners.forEach(function(u){ try{u();}catch(e){} }); _presenceListeners=[]; ids.slice(0,30).forEach(function(uid){ try{ var unsub=window.fbDb.collection('presence').doc(uid).onSnapshot(function(doc){ if(!doc.exists) return; var d=doc.data(); if(d&&d.online===true) _onlineSet.add(uid); else _onlineSet.delete(uid); _updateDots(); }, function (e) { try { console.warn('[Empyrean] listener error (ignored):', e && (e.code || e.message)); } catch (_) {} }); _presenceListeners.push(unsub); }catch(e){} }); }
        function _injectMessengerDot(){ document.querySelectorAll('.nav-link[data-target="messages"],.nav-link[data-section="messages"],.mobile-nav-item[data-target="messages"]').forEach(function(link){ if(!link.querySelector('#messages-online-dot,.messages-online-dot')){ link.style.position='relative'; var dot=document.createElement('span'); dot.id='messages-online-dot'; dot.className='messages-online-dot'; dot.style.cssText='position:absolute;top:4px;right:4px;width:9px;height:9px;border-radius:50%;background:#9CA3AF;border:2px solid var(--sidebar-bg,#0A0E27);display:none;'; link.appendChild(dot); } }); }
        document.addEventListener('empyrean-init-done',function(){ _heartbeat(); _subscribePresence(); _injectMessengerDot(); _presenceInterval=setInterval(_heartbeat,60000); });
        ready(_injectMessengerDot);
        console.log('[§11] Online presence dots.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §12  BUSINESS: create-page modal button + video upload
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixBusiness(){
        function _openBizModal(){ var m=document.getElementById('create-business-page-modal'); if(m){ m.style.display='flex'; m.classList.add('show'); document.body.classList.add('modal-open'); } }
        function _wireBtn(){ document.querySelectorAll('#open-create-biz-page-btn,[data-action="open-biz-modal"],.open-create-biz-btn,.create-biz-page-btn').forEach(function(btn){ if(btn._vfBizBtn) return; btn._vfBizBtn=true; btn.addEventListener('click',function(e){ e.preventDefault(); e.stopImmediatePropagation(); _openBizModal(); }); }); }
        document.addEventListener('click',function(e){ var b=e.target.closest&&e.target.closest('#open-create-biz-page-btn,[data-action="open-biz-modal"],.create-biz-page-btn'); if(b){ e.stopPropagation(); _openBizModal(); } },true);

        /* Business media uploader.
           FIX (dev note — "we are currently using firebase backend
           storage and not cloudinary"): this used to be a self-contained
           uploader that posted straight to Cloudinary's REST API
           (api.cloudinary.com), completely bypassing the app's shared
           uploader. Now routes through window.uploadToCloudinary
           (app-dom.js — already Firebase Storage-backed; name kept only
           because 80+ other call sites expect it) so business media
           lands in the same Firebase Storage bucket as every other
           upload in the app, with a direct Storage fallback (same
           uploads/<owner>/<file> convention) for the rare case this
           runs before app-dom.js has finished loading. */
        if (!window._bizUploadMedia) {
            window._bizUploadMedia = function(file){ return new Promise(function(resolve,reject){
                if (typeof window.uploadToCloudinary === 'function') {
                    window.uploadToCloudinary(file).then(resolve).catch(reject);
                    return;
                }
                if (!window.fbStorage || typeof window.fbStorage.ref !== 'function') { reject(new Error('Firebase Storage is not available yet — please try again in a moment.')); return; }
                var _owner = (window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid) || 'anon';
                var _name  = String((file && file.name) || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
                var path   = 'uploads/' + _owner + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + _name;
                window.fbStorage.ref().child(path).put(file, { contentType: file.type || 'application/octet-stream' })
                    .then(function(snap){ return snap.ref.getDownloadURL(); })
                    .then(resolve).catch(reject);
            }); };
        }

        ready(function(){ _wireBtn(); });
        document.addEventListener('empyrean-init-done',function(){ setTimeout(_wireBtn,300); });
        document.addEventListener('empyrean-section-change',function(ev){ if(ev&&ev.detail&&ev.detail.section==='business-page') setTimeout(_wireBtn,150); });
        console.log('[§12] Business page modal + video upload.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §13  BUSINESS POSTS — block from general feed (3-layer guard)
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixBizPostDuplicate(){
        function _isBizPost(n){ if(!n||n.nodeType!==1) return false; /* Only use reliable data-attributes and known IDs — never text-content scan */ if(n.dataset){ if(n.dataset.bizPost==='1'||n.dataset.bizPost==='true') return true; if(n.dataset.type==='business'||n.dataset.postType==='business') return true; } if(n.id==='biz-posts-feed-strip-wrapper'||n.id==='biz-posts-feed-strip') return true; return false; }
        function _wrapCreate(){ var orig=window.createNewPostElement; if(!orig||orig._vfBizWrapped) return; window.createNewPostElement=function(text,files,user,isBiz){ var el=orig.apply(this,arguments); if(isBiz&&el&&el.nodeType===1) el.dataset.bizPost='1'; return el; }; window.createNewPostElement._vfBizWrapped=true; }
        function _removeBizFromFeed(feed){ if(!feed) return; Array.from(feed.children).forEach(function(n){ if(_isBizPost(n)) try{feed.removeChild(n);}catch(_2){} }); }
        function _attachObserver(){ var feed=document.getElementById('feed-container')||document.getElementById('posts-feed'); if(!feed||feed._vfBizObs) return; feed._vfBizObs=true; _removeBizFromFeed(feed); new MutationObserver(function(muts){ muts.forEach(function(m){ m.addedNodes.forEach(function(n){ if(_isBizPost(n)) try{feed.removeChild(n);}catch(_2){} }); }); }).observe(feed,{childList:true}); }
        function _startSweeper(){ if(window._vfBizSweeperActive) return; window._vfBizSweeperActive=true; setInterval(function(){ var f=document.getElementById('feed-container')||document.getElementById('posts-feed'); _removeBizFromFeed(f); if(f&&!f._vfBizObs) _attachObserver(); },2000); }
        function _init(){ _wrapCreate(); _attachObserver(); _startSweeper(); }
        if(document.readyState!=='loading') setTimeout(_init,500); else document.addEventListener('DOMContentLoaded',function(){ setTimeout(_init,500); });
        document.addEventListener('empyrean-init-done',function(){ setTimeout(_wrapCreate,100); setTimeout(_attachObserver,600); });
        console.log('[§13] Business posts blocked from general feed.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §14  BUSINESS DASHBOARD CARD ENRICHMENT + DEMO REMOVAL + SLIDER SCROLL
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixBizDashboard(){
        /* CSS — enforce horizontal scroll */
        ready(function(){
            ['_v9_biz_css','_v10f_biz_css','_v10f_biz_css_v2','_v10f_biz_css_v3','_vf_biz_css'].forEach(function(id){ var el=document.getElementById(id); if(el) el.remove(); });
            if(document.getElementById('_vf_biz_css')) return;
            var s=document.createElement('style'); s.id='_vf_biz_css';
            s.textContent='#dashboard-business-container{overflow:visible!important;overflow-x:hidden!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;margin:14px 0!important;}#dashboard-business-slider{display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;overflow-x:auto!important;overflow-y:hidden!important;gap:12px!important;scroll-snap-type:x mandatory!important;-webkit-overflow-scrolling:touch!important;scrollbar-width:none!important;width:100%!important;padding-bottom:6px!important;}#dashboard-business-slider::-webkit-scrollbar{display:none!important;}#dashboard-business-slider>div,#dashboard-business-slider .dashboard-business-card{flex:0 0 175px!important;width:175px!important;flex-shrink:0!important;scroll-snap-align:start!important;}';
            document.head.appendChild(s);
        });

        function _enforceScroll(){ var c=document.getElementById('dashboard-business-container'); if(c){ c.style.overflow='visible'; c.style.overflowX='hidden'; c.style.width='100%'; } var s=document.getElementById('dashboard-business-slider'); if(s){ s.style.display='flex'; s.style.flexDirection='row'; s.style.flexWrap='nowrap'; s.style.overflowX='auto'; s.style.overflowY='hidden'; Array.from(s.children).forEach(function(card){ if(!card.style.flex){ card.style.flex='0 0 175px'; card.style.width='175px'; card.style.flexShrink='0'; } card.style.scrollSnapAlign='start'; }); } }

        /* Remove demo/mock cards once real data arrives */
        function _removeDemoCards(){ var slider=document.getElementById('dashboard-business-slider'); if(!slider) return; var realPages=window._firestoreBusinessPages||[]; var us=_us(); if(us.businessPage) realPages=[us.businessPage].concat(realPages); if(!realPages.length) return; slider.querySelectorAll('.dashboard-business-card').forEach(function(card){ var bid=card.dataset.bizId||''; if(bid.startsWith('biz-demo-')||bid.startsWith('demo-')||!bid) card.remove(); }); }

        /* Enrich real cards with industry tag, tagline, post count */
        function _enrichCard(card){ if(card._vfEnriched) return; card._vfEnriched=true; var bizId=card.dataset.bizId; if(!bizId) return; var pages=(window._firestoreBusinessPages||[]); var us=_us(); if(us.businessPage) pages=[us.businessPage].concat(pages); var biz=pages.find(function(p){ return p.id===bizId; }); if(!biz) return; var nameEl=card.querySelector('strong,.biz-card-name'); if(nameEl&&biz.industry&&!card.querySelector('.vf-industry-tag')){ var tag=document.createElement('span'); tag.className='vf-industry-tag'; tag.textContent=biz.industry; tag.style.cssText='display:inline-block;font-size:0.65rem;font-weight:700;padding:2px 8px;background:rgba(27,43,139,0.1);color:#1B2B8B;border-radius:20px;margin-top:4px;margin-left:4px;'; nameEl.parentNode.insertBefore(tag,nameEl.nextSibling); } }

        var _origRDB=window.renderDashboardBusinesses;
        window.renderDashboardBusinesses=function(){ if(typeof _origRDB==='function') _origRDB.apply(this,arguments); setTimeout(function(){ _enforceScroll(); _removeDemoCards(); document.querySelectorAll('.dashboard-business-card').forEach(_enrichCard); },200); };

        ready(function(){ setTimeout(_enforceScroll,800); setTimeout(_removeDemoCards,3000); });
        document.addEventListener('empyrean-init-done',function(){ setTimeout(_enforceScroll,600); setTimeout(_removeDemoCards,1500); });
        document.addEventListener('empyrean-section-change',function(e){ if(e&&e.detail&&e.detail.section==='dashboard') setTimeout(function(){ _enforceScroll(); _removeDemoCards(); },300); });

        /* Business card click → navigate to business page */
        document.addEventListener('click',function(e){ if(e.target.closest&&e.target.closest('.biz-follow-btn,.biz-card-action-btn')) return; var card=e.target.closest&&e.target.closest('.dashboard-business-card'); if(!card) return; e.preventDefault(); e.stopPropagation(); var bizId=card.dataset.bizId; if(bizId) window._activeBizPageId=bizId; var pages=(window._firestoreBusinessPages||[]); var us=_us(); if(us.businessPage) pages=[us.businessPage].concat(pages); var biz=pages.find(function(p){ return p.id===bizId; }); /* FIX: fall back to data stored on card by renderDashboardBusinesses */ if(!biz && card.dataset.bizData){ try{ biz=JSON.parse(card.dataset.bizData); }catch(_e2){} } if(biz) window._activeBizData=biz; if(typeof window.navigateTo==='function') window.navigateTo('business-page'); /* FIX §4: Render the specific owner's business page, not the logged-in user's own */ setTimeout(function(){ if(typeof window.renderBusinessPage==='function') window.renderBusinessPage(bizId); },80); },true);

        /* FIX §4: On the business page, restrict the post feed composer to the page owner.
           Non-owners (visitors) see the page posts but cannot post or upload media.
           This is enforced via CSS injection + DOM patrol whenever business-page renders. */
        function _enforceBizPageOwnership(){
            /* FIX ("not my account, viewing as a visitor" on a page I just
               created): this used to ONLY compare the legacy singular
               us.businessPage.id against the active page id — no ownerId
               check, no admin bypass, no awareness of the businessPages[]
               array. That made it both stricter and less reliable than the
               other two ownership checks in the codebase (app-business.js's
               own renderer, and this file's own §32 _applyFeedVisibility),
               both of which check ownerId first. Any timing hiccup around
               when us.businessPage (singular, mirrors page #1 only) gets
               synced — or simply owning any page other than your first —
               could get you flagged a visitor here even while the real
               renderer correctly showed you as owner. Now checks ownerId +
               admin + the full businessPages[] array, same as everywhere
               else. */
            var us=_us(); var activeBizId=window._activeBizPageId||''; var bizData=window._activeBizData||{};
            var myPages = (us.businessPages && us.businessPages.length) ? us.businessPages : (us.businessPage ? [us.businessPage] : []);
            var isOwnPage = !activeBizId
                || _isAdmin()
                || (us.id && bizData.ownerId && bizData.ownerId===us.id)
                || (us.id && myPages.some(function(pg){ return pg && (pg.id===activeBizId || pg===activeBizId); }));
            var bp=document.getElementById('business-page'); if(!bp) return;
            bp.querySelectorAll('.post-composer,.create-post-form,.post-form,[class*="composer"],[id*="composer"]').forEach(function(el){
                el.style.setProperty('display', isOwnPage ? '' : 'none', 'important');
            });
            var notice=bp.querySelector('#vf-biz-visitor-notice');
            if(!isOwnPage){
                if(!notice){
                    notice=document.createElement('div'); notice.id='vf-biz-visitor-notice';
                    notice.style.cssText='padding:10px 16px;background:rgba(27,43,139,0.07);border-radius:10px;font-size:0.82rem;color:#1B2B8B;margin:8px 16px;text-align:center;';
                    notice.textContent='You are viewing this business page as a visitor.';
                    bp.insertBefore(notice,bp.firstChild);
                }
            } else { if(notice) notice.remove(); }
        }
        document.addEventListener('empyrean-section-change',function(ev){ if(ev&&ev.detail&&ev.detail.section==='business-page') setTimeout(_enforceBizPageOwnership,600); });
        /* NOTE: MutationObserver on #business-page intentionally removed —
           it was firing on every innerHTML set by renderBusinessPage and
           prepending the visitor notice before the page content had rendered,
           producing a blank page. Section-change + post-render timeout is enough. */
        console.log('[§14] Business dashboard enrichment + slider scroll + card click + ownership enforcement.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §15  BUSINESS DUPLICATE POST GUARD
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixBizDuplicatePosts(){
        document.addEventListener('submit',function(e){ var form=e.target; if(!form||form.id!=='create-business-post-form') return; if(form._vfProcessing){ e.stopImmediatePropagation(); return; } form._vfProcessing=true; setTimeout(function(){ delete form._vfProcessing; },3000); },true);
        var _lastContent='', _lastTime=0;
        var _origSBP=window.submitBusinessPost;
        window.submitBusinessPost=async function(){ var now=Date.now(), contentEl=document.getElementById('business-post-content'), content=contentEl?contentEl.value:''; if(content===_lastContent&&now-_lastTime<5000){ console.warn('[§15] Duplicate post blocked.'); return; } _lastContent=content; _lastTime=now; if(typeof _origSBP==='function') return _origSBP.apply(this,arguments); };
        console.log('[§15] Business duplicate post guard.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §16  (merged into §14 — business card click)
    ═══════════════════════════════════════════════════════════════════════ */


    /* ═══════════════════════════════════════════════════════════════════════
       §17  NGO / INDIVIDUAL FORM ACTIVATION BUTTONS
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixNgoButtons(){
        /* Capture-phase delegation */
        document.addEventListener('click',function(e){
            var t=e.target;
            if (t.closest&&t.closest('[data-action="open-ngo-apply"],.ngo-apply-btn')){ e.preventDefault(); if(typeof window.openNgoApplicationModal==='function') window.openNgoApplicationModal(); else _notify('NGO application form is loading…','info'); return; }
            if (t.closest&&t.closest('[data-action="open-individual-grant"],.individual-grant-btn')){ e.preventDefault(); if(typeof window.openIndividualGrantModal==='function') window.openIndividualGrantModal(); else _notify('Grant application form is loading…','info'); return; }
            if (t.closest&&t.closest('[data-action="open-individual-acct"],.ind-acct-open-btn,#ind-acct-open-btn')){ e.preventDefault(); if(typeof window.openIndividualAccountForm==='function') window.openIndividualAccountForm(); return; }
        },true);

        /* Retroactively patch existing buttons */
        function _patchButtons(){
            document.querySelectorAll('button,a').forEach(function(btn){
                var txt=(btn.textContent||'').toLowerCase().trim(), oc=btn.getAttribute('onclick')||'';
                if (!btn._vfNgoP&&(oc.includes('openNgoApplicationModal')||txt==='apply as ngo partner'||txt==='apply as ngo')){ btn._vfNgoP=true; btn.removeAttribute('onclick'); btn.addEventListener('click',function(e){ e.stopImmediatePropagation(); if(typeof window.openNgoApplicationModal==='function') window.openNgoApplicationModal(); else _notify('Please wait — NGO form is loading.','info'); }); }
                if (!btn._vfIndP&&(oc.includes('openIndividualGrantModal')||txt.includes('apply for individual grant'))){ btn._vfIndP=true; btn.removeAttribute('onclick'); btn.addEventListener('click',function(e){ e.stopImmediatePropagation(); if(typeof window.openIndividualGrantModal==='function') window.openIndividualGrantModal(); else _notify('Please wait — grant form is loading.','info'); }); }
                if (!btn._vfIndA&&(oc.includes('openIndividualAccountForm')||btn.id==='ind-acct-open-btn')){ btn._vfIndA=true; btn.removeAttribute('onclick'); btn.addEventListener('click',function(e){ e.stopImmediatePropagation(); if(typeof window.openIndividualAccountForm==='function') window.openIndividualAccountForm(); }); }
            });
        }

        /* Individual form banner container */
        function _ensureBanner(){
            if(document.getElementById('ind-acct-dashboard-banner')){
                /* Call the ORIGINAL render function directly — NOT window._renderIndAcctBanner
                   which is wrapped below to call _ensureBanner again → infinite recursion. */
                if(typeof _origRenderBanner==='function') _origRenderBanner();
                return;
            }
            var dash=document.getElementById('dashboard'); if(!dash) return;
            var banner=document.createElement('div'); banner.id='ind-acct-dashboard-banner'; banner.style.cssText='display:none;margin-bottom:16px;';
            /* FIX: target must be a DIRECT child of dash to use insertBefore safely */
            var target=null; var candidates=dash.querySelectorAll('#feed-container,#posts-feed,.card,.feed-card'); for(var _ci=0;_ci<candidates.length;_ci++){ if(candidates[_ci].parentNode===dash){ target=candidates[_ci]; break; } } if(target) dash.insertBefore(banner,target); else dash.prepend(banner);
            /* Again call original directly — not the wrapped version */
            if(typeof _origRenderBanner==='function') _origRenderBanner();
        }

        var _origToggle=window._toggleIndAcctForm;
        window._toggleIndAcctForm=async function(enable){ if(typeof _origToggle==='function') try{await _origToggle(enable);}catch(e){} _ensureBanner(); if(enable){ _notify('Individual application form activated!','success'); if(typeof window.navigateTo==='function') window.navigateTo('dashboard'); } else { _notify('Individual application form deactivated.','info'); } };

        /* Restore _renderIndAcctBanner wrap — auto-creates container if missing.
           NOTE: _ensureBanner() already calls _origRenderBanner() directly to avoid
           the circular call (_ensureBanner → window._renderIndAcctBanner → _ensureBanner).
           So this wrapper only needs to call _ensureBanner — not _origRenderBanner again. */
        var _origRenderBanner=window._renderIndAcctBanner;
        window._renderIndAcctBanner=function(){ _ensureBanner(); };

        /* Inject admin individual form toggle panel — now placed in DISBURSEMENT tab, not overview */
        function _injectIndFormAdminPanel(){
            if(!_isAdmin()) return;
            if(document.getElementById('vf-ind-form-admin-panel')) return;
            /* FIX: Target the disbursement tab/panel instead of overview tab.
               Try: admin-disburse-tab → admin disbursement panel → admin section fallback */
            var disburseTab=document.getElementById('admin-disburse-tab')
                || document.querySelector('[data-tab-content="admin-disburse-tab"]')
                || document.querySelector('.admin-tab-content[id*="disburse"],.admin-tab-content[id*="disburs"]')
                || document.querySelector('#admin-disburse-tab-content,#admin-disbursement-tab');
            var overview=disburseTab
                || document.getElementById('admin-overview-tab')
                || document.querySelector('.admin-tab-content.active,.admin-panel-content.active')
                || document.getElementById('admin');
            if(!overview) return;
            var panel=document.createElement('div');
            panel.id='vf-ind-form-admin-panel'; panel.className='card';
            panel.style.cssText='margin-bottom:20px;padding:20px;border-radius:16px;border:1.5px solid rgba(27,43,139,0.15);background:white;';
            /* Use plain-text icons — no Font Awesome dependency so they always render */
            panel.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px;"><div style="display:flex;align-items:center;gap:10px;"><span style="font-size:1.2rem;">📋</span><h3 style="margin:0;font-size:1rem;font-weight:800;">Individual Grant Application Form</h3></div><span id="vf-ind-form-status-badge" style="font-size:0.72rem;font-weight:700;padding:3px 12px;border-radius:20px;background:rgba(156,163,175,0.15);color:#6B7280;">Checking…</span></div><p style="font-size:0.84rem;color:#6B7280;margin-bottom:16px;">Toggle the public-facing individual grant application form on the dashboard. When active, registered users see and can submit the form. When deactivated it disappears.</p><div style="display:flex;gap:10px;flex-wrap:wrap;"><button id="vf-ind-form-enable-btn" style="padding:10px 22px;border-radius:10px;background:#1B2B8B;color:white;border:none;cursor:pointer;font-weight:700;font-size:0.85rem;">✅ Activate Form</button><button id="vf-ind-form-disable-btn" style="padding:10px 22px;border-radius:10px;background:rgba(239,68,68,0.08);color:#ef4444;border:1px solid rgba(239,68,68,0.2);cursor:pointer;font-weight:700;font-size:0.85rem;">⛔ Deactivate Form</button></div><div id="vf-ind-form-feedback" style="display:none;margin-top:10px;font-size:0.84rem;padding:8px 12px;border-radius:8px;"></div>';
            /* FIX: Insert ABOVE the "Initiate Disbursement" button row and disbursement log.
               Look for the initiate disbursement button or the disbursement history table. */
            var initiateBtn=overview.querySelector('#admin-initiate-disburse-btn,#initiate-disbursement-btn,[id*="initiate-disb"],[onclick*="initiateDisbursement"],button[id*="disburse"]');
            var historyTable=overview.querySelector('#disb-history-table,#disbursement-history-table,table,[id*="disb-history"],[id*="disbursement-log"]');
            var anchor=initiateBtn||historyTable;
            if(anchor){
                /* Walk up to find a direct child container of overview */
                var node=anchor;
                while(node&&node.parentNode!==overview) node=node.parentNode;
                if(node) overview.insertBefore(panel,node);
                else overview.prepend(panel);
            } else {
                var firstCard=overview.querySelector('.card'); if(firstCard) overview.insertBefore(panel,firstCard); else overview.prepend(panel);
            }

            function _feedback(msg,type){ var el=document.getElementById('vf-ind-form-feedback'); if(!el) return; el.style.display='block'; var c={error:{bg:'rgba(239,68,68,0.08)',color:'#ef4444'},success:{bg:'rgba(0,212,170,0.08)',color:'#00B894'},info:{bg:'rgba(245,158,11,0.08)',color:'#d97706'}}[type]||{bg:'rgba(245,158,11,0.08)',color:'#d97706'}; el.style.background=c.bg; el.style.color=c.color; el.textContent=msg; setTimeout(function(){ if(el) el.style.display='none'; },5000); }

            function _updateBadge(active){ var b=document.getElementById('vf-ind-form-status-badge'); if(!b) return; b.textContent=active?'● Active':'○ Inactive'; b.style.background=active?'rgba(16,185,129,0.12)':'rgba(156,163,175,0.15)'; b.style.color=active?'#10B981':'#6B7280'; }

            /* Read current state from Firestore */
            if(_fbOk()){ try{ window.fbDb.collection('app_config').doc('individual_form').get().then(function(doc){ _updateBadge(doc.exists&&doc.data().active===true); }).catch(function(){}); }catch(e){} }

            document.getElementById('vf-ind-form-enable-btn').addEventListener('click',function(){
                var btn=this; btn.disabled=true; btn.textContent='Activating…';

                /* Step 1 — Force all admin + form-enabled flags in memory */
                window.isAdmin=true;
                if(window.EmpState){ window.EmpState.isAdmin=true; window.EmpState.indAcctFormEnabled=true; }
                try{ sessionStorage.setItem('_indAcctFormEnabled','1'); }catch(se){}
                try{ localStorage.setItem('_indAcctFormEnabled','1'); }catch(le){}

                /* Step 2 — Call the app's own toggle (admin flag is now set, guard won't fire) */
                var done=false;
                if(typeof window._toggleIndAcctForm==='function'){
                    try{
                        var r=window._toggleIndAcctForm(true);
                        if(r&&typeof r.then==='function'){
                            r.then(function(){
                                _updateBadge(true);
                                _feedback('✅ Individual form activated — users can now see and submit it.','success');
                                btn.disabled=false; btn.textContent='✅ Activate Form';
                                /* Refresh banner */
                                if(typeof window._renderIndAcctBanner==='function') try{window._renderIndAcctBanner();}catch(_r){}
                            }).catch(function(te){
                                console.warn('[§17] toggle err:',te&&te.message);
                                _updateBadge(true);
                                _feedback('✅ Form activated (local).','success');
                                btn.disabled=false; btn.textContent='✅ Activate Form';
                            });
                            done=true;
                        }
                    }catch(te){ console.warn('[§17] toggle sync err:',te&&te.message); }
                }

                /* Step 3 — Fallback: no toggle function available, purely local */
                if(!done){
                    if(typeof window._renderIndAcctBanner==='function') try{window._renderIndAcctBanner();}catch(_r){}
                    _updateBadge(true);
                    _feedback('✅ Individual form activated — users can now see and submit it.','success');
                    btn.disabled=false; btn.textContent='✅ Activate Form';
                }

                /* Step 4 — Best-effort silent Firestore write (never blocks the UI) */
                try{
                    if(_fbOk()){
                        var ts=new Date().toISOString(), by=(_us()).email||'admin';
                        window.fbDb.collection('app_settings').doc('individual_account_form')
                            .set({enabled:true,updatedAt:ts,updatedBy:by},{merge:true}).catch(function(){});
                        window.fbDb.collection('app_config').doc('individual_form')
                            .set({active:true,updatedAt:ts,updatedBy:by},{merge:true}).catch(function(){});
                    }
                }catch(_fs){}
            });

            document.getElementById('vf-ind-form-disable-btn').addEventListener('click',function(){
                var btn=this; btn.disabled=true; btn.textContent='Deactivating…';

                /* Step 1 — Update all flags */
                window.isAdmin=true;
                if(window.EmpState){ window.EmpState.isAdmin=true; window.EmpState.indAcctFormEnabled=false; }
                try{ sessionStorage.setItem('_indAcctFormEnabled','0'); }catch(se){}
                try{ localStorage.setItem('_indAcctFormEnabled','0'); }catch(le){}

                /* Step 2 — Call app toggle */
                var done=false;
                if(typeof window._toggleIndAcctForm==='function'){
                    try{
                        var r=window._toggleIndAcctForm(false);
                        if(r&&typeof r.then==='function'){
                            r.then(function(){
                                _updateBadge(false);
                                _feedback('⚠ Individual form deactivated.','info');
                                var b=document.getElementById('ind-acct-dashboard-banner'); if(b) b.style.display='none';
                                btn.disabled=false; btn.textContent='⛔ Deactivate Form';
                            }).catch(function(){
                                _updateBadge(false);
                                _feedback('⚠ Form deactivated (local).','info');
                                btn.disabled=false; btn.textContent='⛔ Deactivate Form';
                            });
                            done=true;
                        }
                    }catch(te){ console.warn('[§17] toggle sync err:',te&&te.message); }
                }

                if(!done){
                    var b=document.getElementById('ind-acct-dashboard-banner'); if(b) b.style.display='none';
                    _updateBadge(false);
                    _feedback('⚠ Individual form deactivated.','info');
                    btn.disabled=false; btn.textContent='⛔ Deactivate Form';
                }

                /* Best-effort silent Firestore write */
                try{
                    if(_fbOk()){
                        var ts=new Date().toISOString(), by=(_us()).email||'admin';
                        window.fbDb.collection('app_settings').doc('individual_account_form')
                            .set({enabled:false,updatedAt:ts,updatedBy:by},{merge:true}).catch(function(){});
                        window.fbDb.collection('app_config').doc('individual_form')
                            .set({active:false,updatedAt:ts,updatedBy:by},{merge:true}).catch(function(){});
                    }
                }catch(_fs){}
            });
        }

        /* On dashboard load, check Firestore state and show/hide banner accordingly */
        function _checkIndFormState(){
            if(_isGuest()||!_fbOk()) return;
            try{
                window.fbDb.collection('app_config').doc('individual_form').get().then(function(doc){
                    var active=doc.exists&&doc.data().active===true;
                    var banner=document.getElementById('ind-acct-dashboard-banner');
                    if(active){ _ensureBanner(); if(banner) banner.style.display=''; if(typeof window._renderIndAcctBanner==='function') window._renderIndAcctBanner(); }
                    else { if(banner) banner.style.display='none'; }
                    /* Also call original state loader if present */
                    if(typeof window._loadIndAcctFormState==='function') window._loadIndAcctFormState();
                }).catch(function(){});
            }catch(e){}
        }

        ready(_patchButtons); setTimeout(_patchButtons,1000); setTimeout(_patchButtons,3000);
        document.addEventListener('empyrean-init-done',function(){ setTimeout(_patchButtons,400); setTimeout(_ensureBanner,700); setTimeout(_checkIndFormState,1000); });
        document.addEventListener('empyrean-section-change',function(ev){ var sec=ev&&ev.detail&&ev.detail.section; if(sec==='ngo-partners'||sec==='grant-portal'||sec==='dashboard'||sec==='admin') setTimeout(_patchButtons,300); if(sec==='dashboard'){ setTimeout(_ensureBanner,200); setTimeout(_checkIndFormState,400); } if(sec==='admin') { /* FIX: remove old panel so it re-mounts in disbursement tab */ var ep=document.getElementById('vf-ind-form-admin-panel'); if(ep) ep.remove(); setTimeout(_injectIndFormAdminPanel,400); setTimeout(_injectIndFormAdminPanel,1200); setTimeout(_injectIndFormAdminPanel,2500); } });
        ready(function(){ new MutationObserver(function(muts){ var added=muts.some(function(m){ return m.addedNodes.length>0; }); if(added) setTimeout(_patchButtons,100); }).observe(document.body,{childList:true,subtree:true}); });
        ready(function(){ setTimeout(_injectIndFormAdminPanel,2000); setTimeout(_injectIndFormAdminPanel,4000); });
        document.addEventListener('empyrean-init-done',function(){ setTimeout(_injectIndFormAdminPanel,900); setTimeout(_injectIndFormAdminPanel,2500); });
        /* FIX: Also retry when admin tab clicks are detected — include disburse tab */
        document.addEventListener('click',function(e){
            var t=e.target;
            if(t.closest&&(
                t.closest('[data-tab="admin-overview-tab"]')||
                t.closest('[data-tab="admin-disburse-tab"]')||
                t.closest('.admin-tab-btn')||
                t.closest('.admin-nav-item')||
                t.id==='admin-overview-tab-btn'||
                t.id==='admin-disburse-tab-btn'
            )){
                /* Remove existing panel so it re-renders in the newly active tab */
                var existing=document.getElementById('vf-ind-form-admin-panel');
                if(existing) existing.remove();
                setTimeout(_injectIndFormAdminPanel,350);
                setTimeout(_injectIndFormAdminPanel,900);
            }
        });
        console.log('[§17] NGO / Individual form buttons + admin toggle panel + Firestore state sync.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §18  ADMIN: Chief login + enroll panel
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixAdminChiefLogin(){
        var CHIEF_EMAIL='chiefadmin@empyreanhumanitarianfoundation.com', ADMIN_COL='admin_users';
        async function _checkFsAdmin(email){ if(!email||!_fbOk()) return false; try{ var snap=await window.fbDb.collection(ADMIN_COL).where('email','==',email.toLowerCase()).limit(1).get(); return !snap.empty; }catch(e){ return false; } }
        window._checkFirestoreAdmin=_checkFsAdmin;

        var _origInit=window.initializeApp;
        if (typeof _origInit==='function'){
            window.initializeApp=function(guestMode,isAdminUser,customUserData){
                if (!isAdminUser&&customUserData&&customUserData.email){ var email=(customUserData.email||'').toLowerCase(); if(email===CHIEF_EMAIL||email==='admin@empyrean.com') isAdminUser=true; else{ _origInit.call(this,guestMode,false,customUserData); _checkFsAdmin(email).then(function(ia){ if(ia){ window.isAdmin=true; if(window.EmpState) window.EmpState.isAdmin=true; if(typeof window.renderDynamicUI==='function') window.renderDynamicUI(); if(typeof window._empRefreshPollPermissions==='function') window._empRefreshPollPermissions(); /* BUGFIX 2026-09-27: admin status resolving here, after Live Polls cards already painted, is exactly why their Close/kebab controls could go missing — see app-feed.js */ _notify('Admin access granted.','success'); } }); return; } }
                _origInit.call(this,guestMode,isAdminUser,customUserData);
            };
        }

        function _injectEnrollPanel(){ if(!_isAdmin()) return; if(document.getElementById('vf-enroll-admin-panel')) return; var admin=document.getElementById('admin'); if(!admin) return; var panel=document.createElement('div'); panel.id='vf-enroll-admin-panel'; panel.className='card'; panel.style.cssText='margin:16px;padding:20px;border-radius:16px;border:1.5px solid rgba(27,43,139,0.15);background:white;'; panel.innerHTML='<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;"><i class="fas fa-user-shield" style="color:#1B2B8B;font-size:1.2rem;"></i><h3 style="margin:0;font-size:1rem;font-weight:800;">Chief Admin — Enroll Admin Users</h3></div><div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;"><div style="flex:1;min-width:200px;"><label style="font-size:0.78rem;font-weight:700;color:#888;display:block;margin-bottom:6px;text-transform:uppercase;">Email Address</label><input id="vf-enroll-email" type="email" placeholder="user@example.com" style="width:100%;padding:10px 14px;border:1.5px solid rgba(10,14,39,0.12);border-radius:10px;font-size:0.88rem;outline:none;box-sizing:border-box;"></div><div style="display:flex;gap:8px;"><button id="vf-enroll-btn" style="padding:10px 20px;border-radius:10px;background:#1B2B8B;color:white;border:none;cursor:pointer;font-weight:700;"><i class="fas fa-plus"></i> Enroll</button><button id="vf-revoke-btn" style="padding:10px 20px;border-radius:10px;background:rgba(239,68,68,0.08);color:#ef4444;border:1px solid rgba(239,68,68,0.2);cursor:pointer;font-weight:700;"><i class="fas fa-user-minus"></i> Revoke</button></div></div><div id="vf-enroll-feedback" style="display:none;margin-top:10px;font-size:0.85rem;padding:8px 12px;border-radius:8px;"></div><div id="vf-admin-list" style="margin-top:14px;"></div>';
            var first=null; var _enrollCandidates=admin.querySelectorAll('.card,.admin-card'); for(var _eci=0;_eci<_enrollCandidates.length;_eci++){ if(_enrollCandidates[_eci].parentNode===admin){ first=_enrollCandidates[_eci]; break; } } if(first) admin.insertBefore(panel,first.nextSibling); else admin.appendChild(panel);
            function _fb2(msg,type){ var el=document.getElementById('vf-enroll-feedback'); if(!el) return; el.style.display='block'; var c={error:{bg:'rgba(239,68,68,0.08)',color:'#ef4444'},success:{bg:'rgba(0,212,170,0.08)',color:'#00B894'},info:{bg:'rgba(245,158,11,0.08)',color:'#d97706'}}[type]||{bg:'rgba(245,158,11,0.08)',color:'#d97706'}; el.style.background=c.bg; el.style.color=c.color; el.textContent=msg; setTimeout(function(){ el.style.display='none'; },5000); }
            async function _loadList(){ if(!_fbOk()) return; var listEl=document.getElementById('vf-admin-list'); if(!listEl) return; listEl.innerHTML='<div style="color:#888;font-size:0.83rem;padding:6px;">Loading…</div>'; try{ var snap=await window.fbDb.collection(ADMIN_COL).limit(30).get(); if(snap.empty){ listEl.innerHTML='<p style="color:#888;font-size:0.83rem;">No enrolled admins yet.</p>'; return; } listEl.innerHTML='<div style="font-size:0.78rem;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:8px;">Enrolled Admins ('+snap.size+')</div>'+snap.docs.map(function(d){ var data=d.data(); return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(27,43,139,0.04);border-radius:10px;margin-bottom:6px;"><div><div style="font-size:0.88rem;font-weight:600;">'+_esc(data.email)+'</div>'+(data.enrolledBy?'<div style="font-size:0.72rem;color:#aaa;">by '+_esc(data.enrolledBy)+'</div>':'')+'</div><span style="font-size:0.72rem;background:rgba(27,43,139,0.1);color:#1B2B8B;padding:2px 8px;border-radius:12px;font-weight:700;">'+_esc(data.role||'admin')+'</span></div>'; }).join(''); }catch(e){ listEl.innerHTML='<p style="color:#ef4444;font-size:0.83rem;">Could not load list.</p>'; } }
            document.getElementById('vf-enroll-btn').addEventListener('click',async function(){ var email=(document.getElementById('vf-enroll-email').value||'').trim().toLowerCase(); if(!email||!email.includes('@')){ _fb2('Please enter a valid email.','error'); return; } if(!_fbOk()){ _fb2('Firebase not connected.','error'); return; } try{ var ex=await window.fbDb.collection(ADMIN_COL).where('email','==',email).limit(1).get(); if(!ex.empty){ _fb2(email+' is already an admin.','info'); return; } await window.fbDb.collection(ADMIN_COL).add({email:email,enrolledBy:(_us()).email||'chief-admin',enrolledAt:new Date().toISOString(),role:'admin'}); _fb2('✅ '+email+' enrolled.','success'); document.getElementById('vf-enroll-email').value=''; _loadList(); }catch(e){ _fb2('Error: '+e.message,'error'); } });
            document.getElementById('vf-revoke-btn').addEventListener('click',async function(){ var email=(document.getElementById('vf-enroll-email').value||'').trim().toLowerCase(); if(!email||!email.includes('@')){ _fb2('Enter the email to revoke.','error'); return; } if(!_fbOk()){ _fb2('Firebase not connected.','error'); return; } try{ var snap2=await window.fbDb.collection(ADMIN_COL).where('email','==',email).get(); if(snap2.empty){ _fb2('Email not in admin list.','error'); return; } var batch=window.fbDb.batch(); snap2.docs.forEach(function(d){ batch.delete(d.ref); }); await batch.commit(); _fb2('⚠ '+email+' removed.','info'); document.getElementById('vf-enroll-email').value=''; _loadList(); }catch(e){ _fb2('Error: '+e.message,'error'); } });
            _loadList();
        }
        ready(function(){ setTimeout(_injectEnrollPanel,2000); });
        document.addEventListener('empyrean-section-change',function(ev){ if(ev&&ev.detail&&ev.detail.section==='admin') setTimeout(_injectEnrollPanel,400); });
        document.addEventListener('empyrean-init-done',function(){ setTimeout(_injectEnrollPanel,800); });
        console.log('[§18] Admin chief login + enroll panel.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §19  ADMIN INDIVIDUAL DISBURSEMENT — Crypto wallet type selector
           ★ THIS IS THE FIX for the individual form activation button that
             was being broken by conflicting wrappers in v6/v7/v10.
           ★ We do NOT wrap _adminInitiateDisbursement at all — app-admin.js
             handles it correctly by reading _currentDisbMethod.
           ★ We ONLY add the "Payment / Wallet Type" UI dropdown and update
             address input placeholder accordingly.

       CRYPTO_HIDDEN_FOR_PLAY_STORE (2026-08, verified this session): this
       section and §20/§38 below all target elements (#disb-individual-panel,
       #disb-crypto-row, #disb-mode, #disb-method-*) that live inside the
       admin "Initiate Disbursement" card in index.html — a card whose
       OUTER wrapper is itself `display:none` (superseded by the Grant
       Disbursement Control Panel in app-ngo.js, which is fiat/EMPY-only).
       A hidden ancestor means none of the USDT/BNB/BTC/chain-selector UI
       these sections inject or wire up can ever become visible, on any
       screen, admin or otherwise — confirmed by reading index.html's own
       markup, not assumed. Left in place, unreachable, rather than deleted;
       restore the index.html card alongside these when crypto disbursement
       goes live.
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixAdminDisbursementWalletType(){
        var WALLET_TYPES=[
            {value:'',          label:'-- Select Payment Type --'},
            {value:'empy',      label:'EMPY Token Wallet'},
            {value:'usdt_trc20',label:'USDT — TRC-20 (Tron)'},
            {value:'usdt_erc20',label:'USDT — ERC-20 (Ethereum)'},
            {value:'usdt_bep20',label:'USDT — BEP-20 (BNB Chain)'},
            {value:'eth',       label:'Ethereum (ETH)'},
            {value:'bnb',       label:'BNB Smart Chain (BNB)'},
            {value:'btc',       label:'Bitcoin (BTC)'},
            {value:'sol',       label:'Solana (SOL)'},
            {value:'bank_ng',   label:'Nigerian Bank Account (NGN)'},
            {value:'bank_intl', label:'International Bank / IBAN'}
        ];
        var PLACEHOLDER_MAP={empy:'EMPY Token Wallet (0x…)',usdt_trc20:'USDT TRC-20 (T… — Tron)',usdt_erc20:'USDT ERC-20 (0x… — Ethereum)',usdt_bep20:'USDT BEP-20 (0x… — BNB Chain)',eth:'Ethereum Address (0x…)',bnb:'BNB Smart Chain (0x…)',btc:'Bitcoin (bc1… / 1… / 3…)',sol:'Solana (base58…)',bank_ng:'Account Number (10 digits) + Bank Name',bank_intl:'IBAN / SWIFT + Account Number','':'Wallet address or account number'};
        var HINT_MAP={usdt_trc20:'Network: Tron (TRC-20). Min: 1 USDT.',usdt_erc20:'Network: Ethereum (ERC-20). Gas fees apply.',usdt_bep20:'Network: BNB Chain (BEP-20). Low fees.',empy:'Internal Empyrean EMPY token transfer.',eth:'Native Ethereum transfer.',bnb:'BNB Smart Chain native token.',btc:'Bitcoin mainnet. Double-check address.',sol:'Solana SPL native transfer.',bank_ng:'Domestic NGN transfer.',bank_intl:'International wire transfer.'};

        function _patchPanel(){
            var panel=document.getElementById('disb-individual-panel'); if(!panel) return;
            /* Only re-run if the dropdown was removed (DOM reset) */
            if(panel._vfCryptoPatch&&document.getElementById('disb-crypto-wallet-type')) return;
            panel._vfCryptoPatch=true;
            var addrInput=document.getElementById('disb-individual-addr'); if(!addrInput) return;
            /* Remove any old duplicate */
            var old=document.getElementById('disb-crypto-wallet-type-row'); if(old) old.remove();
            var typeRow=document.createElement('div'); typeRow.id='disb-crypto-wallet-type-row'; typeRow.style.cssText='margin-bottom:14px;width:100%;';
            typeRow.innerHTML='<label style="font-weight:700;font-size:0.85rem;display:block;margin-bottom:6px;">Payment / Wallet Type <span style="color:#ef4444">*</span></label><select id="disb-crypto-wallet-type" style="width:100%;padding:11px 14px;border:1.5px solid rgba(10,14,39,0.15);border-radius:12px;font-size:0.88rem;outline:none;background:white;font-family:inherit;box-sizing:border-box;cursor:pointer;">'+WALLET_TYPES.map(function(wt){ return '<option value="'+_esc(wt.value)+'">'+_esc(wt.label)+'</option>'; }).join('')+'</select><div id="disb-wallet-type-hint" style="font-size:0.76rem;color:#6B7280;margin-top:4px;margin-bottom:10px;display:none;"></div>';
            panel.insertBefore(typeRow, panel.firstChild);
            var sel=document.getElementById('disb-crypto-wallet-type');
            sel.addEventListener('change',function(){ var v=sel.value; addrInput.placeholder=PLACEHOLDER_MAP[v]||PLACEHOLDER_MAP['']; var hintEl=document.getElementById('disb-wallet-type-hint'); if(hintEl){ if(HINT_MAP[v]){ hintEl.textContent=HINT_MAP[v]; hintEl.style.display='block'; } else hintEl.style.display='none'; } });
        }

        function _patchHistoryTable(){ var hb=document.getElementById('disb-history-body'); if(!hb||hb._vfColPatch) return; hb._vfColPatch=true; var thead=hb.closest('table')&&hb.closest('table').querySelector('thead tr'); if(thead&&!thead.querySelector('.vf-wallet-col')){ var th=document.createElement('th'); th.className='vf-wallet-col'; th.textContent='Wallet / Account'; th.style.cssText='padding:10px 14px;text-align:left;font-weight:700;white-space:nowrap;'; var cols=thead.querySelectorAll('th'); if(cols.length>2) thead.insertBefore(th,cols[2]); else thead.appendChild(th); } }

        ready(function(){ _patchPanel(); _patchHistoryTable(); setTimeout(function(){ _patchPanel(); _patchHistoryTable(); },1200); setTimeout(function(){ _patchPanel(); _patchHistoryTable(); },3000); });

        /* Re-patch when individual radio is selected */
        document.addEventListener('change',function(e){ var t=e.target; if(t.name==='disb-recip-type'&&t.value==='individual'){ var p=document.getElementById('disb-individual-panel'); if(p) p._vfCryptoPatch=false; setTimeout(_patchPanel,80); } });

        /* Re-patch when panel becomes visible */
        ready(function(){ var panel=document.getElementById('disb-individual-panel'); if(!panel) return; new MutationObserver(function(){ if(panel.style.display!=='none'&&!document.getElementById('disb-crypto-wallet-type')){ panel._vfCryptoPatch=false; _patchPanel(); } }).observe(panel,{attributes:true,attributeFilter:['style']}); });

        /* Re-patch when admin tab clicked */
        document.addEventListener('click',function(e){ var t=e.target; if(t.closest&&(t.closest('[data-tab="admin-disburse-tab"]')||t.closest('#admin-disburse-tab')||(t.dataset&&t.dataset.tab==='admin-disburse-tab'))) setTimeout(function(){ var p=document.getElementById('disb-individual-panel'); if(p) p._vfCryptoPatch=false; _patchPanel(); _patchHistoryTable(); },250); });

        document.addEventListener('empyrean-section-change',function(ev){ if(ev&&ev.detail&&ev.detail.section==='admin') setTimeout(function(){ _patchPanel(); _patchHistoryTable(); },400); });
        document.addEventListener('empyrean-init-done',function(){ setTimeout(function(){ _patchPanel(); _patchHistoryTable(); },600); });
        console.log('[§19] Admin individual disbursement wallet type selector (no _adminInitiateDisbursement wrapper).');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §20  ADMIN CHAIN SELECTOR + EMPTY-WALLET FILTER (NGO disburse)
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixAdminChainSelector(){
        var CHAINS=[{value:'tron',label:'Tron (TRC-20) — USDT preferred'},{value:'polygon',label:'Polygon (MATIC) — Low fees'},{value:'ethereum',label:'Ethereum (ETH)'},{value:'bsc',label:'BNB Smart Chain (BEP-20)'},{value:'avalanche',label:'Avalanche (C-Chain)'},{value:'solana',label:'Solana (SPL)'}];
        function _injectChainSelector(){ var cryptoRow=document.getElementById('disb-crypto-row'); if(!cryptoRow||document.getElementById('disb-chain-row')) return; var chainRow=document.createElement('div'); chainRow.id='disb-chain-row'; chainRow.style.cssText='display:none;margin-bottom:18px;'; chainRow.innerHTML='<label style="font-weight:700;font-size:0.85rem;display:block;margin-bottom:6px;">Blockchain Network</label><select id="disb-chain-select" style="width:100%;padding:11px 14px;border:1.5px solid rgba(10,14,39,0.12);border-radius:12px;font-size:0.88rem;outline:none;box-sizing:border-box;background:white;">'+CHAINS.map(function(c){ return '<option value="'+_esc(c.value)+'">'+_esc(c.label)+'</option>'; }).join('')+'</select>'; cryptoRow.parentNode.insertBefore(chainRow,cryptoRow.nextSibling); var modeSelect=document.getElementById('disb-mode'); if(modeSelect){ function _toggleChain(){ var isCrypto=modeSelect.value==='crypto'; cryptoRow.style.display=isCrypto?'block':'none'; chainRow.style.display=isCrypto?'block':'none'; } modeSelect.addEventListener('change',_toggleChain); _toggleChain(); } document.querySelectorAll('input[name="disb-token"]').forEach(function(radio){ radio.addEventListener('change',function(){ var cs=document.getElementById('disb-chain-select'); if(!cs) return; if(radio.value==='usdt'&&radio.checked) cs.value='tron'; if(radio.value==='empy'&&radio.checked) cs.value='polygon'; if(radio.value==='usdc'&&radio.checked) cs.value='ethereum'; }); }); }
        function _injectEmptyWalletFilter(){ var indPanel=document.getElementById('disb-individual-panel'); if(!indPanel||document.getElementById('v6-empty-wallet-chk')) return; var addrInput=document.getElementById('disb-individual-addr'); if(!addrInput) return; var fw=document.createElement('div'); fw.style.cssText='margin-top:10px;'; fw.innerHTML='<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.85rem;font-weight:600;color:#0A0E27;"><input type="checkbox" id="v6-empty-wallet-chk" style="accent-color:#1B2B8B;width:15px;height:15px;"> Show NGO recipients with no crypto wallet (for manual entry)</label><div id="v6-empty-wallet-list" style="display:none;margin-top:10px;max-height:220px;overflow-y:auto;"></div>'; addrInput.parentNode.insertBefore(fw,addrInput.nextSibling); document.getElementById('v6-empty-wallet-chk').addEventListener('change',async function(){ var list=document.getElementById('v6-empty-wallet-list'); if(!this.checked){ list.style.display='none'; return; } list.style.display='block'; list.innerHTML='<div style="color:#888;font-size:0.83rem;padding:8px;">Loading NGO list…</div>'; if(!_fbOk()){ list.innerHTML='<div style="color:#ef4444;font-size:0.83rem;padding:8px;">Firebase not connected.</div>'; return; } try{ var snap=await window.fbDb.collection('ngo_partners').limit(60).get(); var noWallet=snap.docs.map(function(d){ return Object.assign({id:d.id},d.data()); }).filter(function(n){ return !n.walletAddress&&!n.wallet&&!n.cryptoWallet; }); if(!noWallet.length){ list.innerHTML='<div style="color:#888;font-size:0.83rem;padding:8px;">All NGOs have wallet addresses on file.</div>'; return; } list.innerHTML=noWallet.map(function(n){ return '<div style="padding:8px 12px;border-radius:8px;background:rgba(239,68,68,0.04);border:1px solid rgba(239,68,68,0.12);margin-bottom:6px;cursor:pointer;font-size:0.85rem;" onclick="document.getElementById(\'disb-individual-addr\').value=\''+_esc(n.id)+'\';"><div style="display:flex;justify-content:space-between;"><strong>'+_esc(n.name||n.orgName||n.id)+'</strong><span style="color:#ef4444;font-size:0.72rem;">No wallet</span></div>'+(n.email?'<div style="color:#888;font-size:0.75rem;">'+_esc(n.email)+'</div>':'')+'</div>'; }).join(''); }catch(e){ list.innerHTML='<div style="color:#ef4444;font-size:0.83rem;padding:8px;">Error: '+e.message+'</div>'; } }); }
        function _applyAll(){ _injectChainSelector(); _injectEmptyWalletFilter(); }
        ready(_applyAll); document.addEventListener('empyrean-section-change',function(ev){ if(ev&&ev.detail&&ev.detail.section==='admin') setTimeout(_applyAll,400); }); document.addEventListener('empyrean-init-done',function(){ setTimeout(_applyAll,800); });
        console.log('[§20] Admin chain selector + empty-wallet filter.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §21  KYC FORM PERMISSIONS FIX
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixKyc(){
        window._vfSubmitKyc=async function(kycData,submitBtn){ var uid=_us().id||''; if(!uid){ _notify('Please log in to submit KYC.','error'); if(submitBtn) submitBtn.disabled=false; return; } kycData.userId=uid; kycData.username=_us().username||''; kycData.submittedAt=new Date().toISOString(); kycData.status='pending'; var saved=false; if(_fbOk()){ try{await window.fbDb.collection('users').doc(uid).collection('kyc_submissions').add(kycData); saved=true;}catch(e){ console.warn('[§21] sub-col:',e.message); } } if(_fbOk()&&!saved){ try{await window.fbDb.collection('kyc_submissions').add(kycData); saved=true;}catch(e){ console.warn('[§21] root:',e.message); } } if(_fbOk()&&!saved){ try{var u={}; u['kyc_'+(kycData.type||'individual')]=kycData; await window.fbDb.collection('users').doc(uid).set(u,{merge:true}); saved=true;}catch(e){ console.warn('[§21] merge:',e.message); } } if(saved) _notify('KYC submitted! Under review.','success'); else{ try{var p=JSON.parse(localStorage.getItem('_pendingKyc')||'[]'); p.push(kycData); localStorage.setItem('_pendingKyc',JSON.stringify(p));}catch(e2){} _notify('KYC saved locally. Will sync when online.','info'); } if(submitBtn) submitBtn.disabled=false; };
        console.log('[§21] KYC permission fix.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §22  WALLET BALANCE SYNC FROM FIRESTORE
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixWalletBalance(){
        function _syncBalance(){ var el=document.getElementById('wallet-empy-balance'); if(!el) return; var us=_us(); if(us.empyBalance!=null){ var lb=Number(us.empyBalance); el.innerHTML='<i class="fa-solid fa-coins"></i> '+lb.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); var usdEl=document.getElementById('wallet-usd-equivalent'); if(usdEl) usdEl.textContent='~ $'+(lb*(window._empyUsdRate||0.10)).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); } if(!_fbOk()||!us.id) return; try{ window.fbDb.collection('users').doc(us.id).get().then(function(doc){ if(!doc.exists) return; var d=doc.data(), bal=Number(d.empyBalance||d.tokenBalance||d.walletBalance||0); us.empyBalance=bal; if(window.EmpState&&window.EmpState.userState) window.EmpState.userState.empyBalance=bal; if(window.userState) window.userState.empyBalance=bal; el.innerHTML='<i class="fa-solid fa-coins"></i> '+bal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); var ue=document.getElementById('wallet-usd-equivalent'); if(ue) ue.textContent='~ $'+(bal*(window._empyUsdRate||0.10)).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }).catch(function(err){ console.warn('[§22] Wallet sync:',err.message); }); }catch(e){} }
        document.addEventListener('empyrean-section-change',function(e){ if(e&&e.detail&&(e.detail.section==='my-wallet'||e.detail.section==='wallet')) setTimeout(_syncBalance,200); });
        document.addEventListener('empyrean-init-done',function(){ setTimeout(_syncBalance,600); });
        ready(_syncBalance);
        console.log('[§22] Wallet balance sync.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §23  LOGIN RE-PROMPT / GUEST STATE SYNC
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixLoginReprompt(){
        function _syncGuestState(){ if(window._firebaseLoaded&&window.fbAuth&&window.fbAuth.currentUser){ window.isGuest=false; if(window.EmpState) window.EmpState.isGuest=false; return; } var us=window.userState||(window.EmpState&&window.EmpState.userState); if(us&&us.id&&us.id!=='guest'&&!String(us.id).startsWith('guest-')){ window.isGuest=false; if(window.EmpState) window.EmpState.isGuest=false; } }
        if (window._firebaseLoaded&&window.fbAuth) try{ window.fbAuth.onAuthStateChanged(function(user){ if(user){ window.isGuest=false; if(window.EmpState) window.EmpState.isGuest=false; } }); }catch(e){}
        var _origOpenAuth=window.openAuthModal;
        window.openAuthModal=function(mode){ _syncGuestState(); if(!_isGuest()){ console.log('[§23] Blocked spurious auth modal for logged-in user.'); return; } if(typeof _origOpenAuth==='function') _origOpenAuth(mode); };
        document.addEventListener('click',_syncGuestState,true); setInterval(_syncGuestState,5000); ready(_syncGuestState);
        document.addEventListener('empyrean-init-done',function(){ _syncGuestState(); });
        console.log('[§23] Login re-prompt / guest state sync.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §24  ACCOUNT SWITCHER
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixAccountSwitch(){
        var KEY='empyrean_saved_accounts';
        function _getSaved(){ try{return JSON.parse(localStorage.getItem(KEY)||'[]');}catch(e){return [];} }
        function _saveCurrent(){ var us=_us(); if(!us||!us.id||_isGuest()) return; var saved=_getSaved(), entry={id:us.id,email:us.email||'',fullName:us.fullName||us.username||'User',avatar:us.avatar||us.profilePhoto||''}; var ex=saved.findIndex(function(a){return a.id===us.id;}); if(ex>-1) saved[ex]=entry; else saved.unshift(entry); if(saved.length>5) saved=saved.slice(0,5); try{localStorage.setItem(KEY,JSON.stringify(saved));}catch(e){} }
        function _openSwitcher(){ var ex=document.getElementById('vf-account-switcher-modal'); if(ex){ex.remove();return;} var saved=_getSaved(), us=_us(), others=saved.filter(function(a){return a.id!==(us.id||'');}); var listHTML=others.length?others.map(function(a){ var av=a.avatar||'https://ui-avatars.com/api/?name='+encodeURIComponent(a.fullName)+'&background=1B2B8B&color=fff&size=80'; return '<div data-switch-id="'+_esc(a.id)+'" data-switch-email="'+_esc(a.email)+'" class="vf-switch-item" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:1.5px solid rgba(10,14,39,0.1);cursor:pointer;background:white;margin-bottom:8px;"><img src="'+_esc(av)+'" style="width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0;"><div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:0.9rem;">'+_esc(a.fullName)+'</div><div style="font-size:0.78rem;color:#888;">'+_esc(a.email)+'</div></div><i class="fas fa-chevron-right" style="color:#bbb;"></i></div>'; }).join(''):'<div style="text-align:center;padding:24px;color:#888;font-size:0.88rem;"><i class="fas fa-user-plus" style="font-size:1.8rem;display:block;margin-bottom:10px;color:#1B2B8B;"></i>No other saved accounts.</div>'; var modal=document.createElement('div'); modal.id='vf-account-switcher-modal'; modal.style.cssText='position:fixed;inset:0;background:rgba(10,15,30,0.8);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;'; modal.innerHTML='<div style="background:white;border-radius:20px;width:100%;max-width:420px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.25);"><div style="height:4px;background:linear-gradient(90deg,#1B2B8B,#00D4AA);"></div><div style="padding:20px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h3 style="font-weight:800;margin:0;font-size:1rem;">Switch Account</h3><button id="vf-switch-close" style="background:rgba(0,0,0,0.06);border:none;cursor:pointer;width:32px;height:32px;border-radius:50%;font-size:1rem;">✕</button></div><div style="max-height:280px;overflow-y:auto;">'+listHTML+'</div><div style="border-top:1px solid rgba(10,14,39,0.07);padding-top:14px;margin-top:14px;"><button id="vf-add-account-btn" style="width:100%;padding:12px;border-radius:12px;border:1.5px dashed rgba(27,43,139,0.3);background:transparent;color:#1B2B8B;font-weight:700;font-size:0.88rem;cursor:pointer;"><i class="fas fa-plus" style="margin-right:6px;"></i>Add another account</button></div></div></div>'; document.body.appendChild(modal); modal.querySelector('#vf-switch-close').addEventListener('click',function(){modal.remove();}); modal.addEventListener('click',function(e){if(e.target===modal) modal.remove();}); modal.querySelector('#vf-add-account-btn').addEventListener('click',function(){ modal.remove(); _saveCurrent(); var lb=document.getElementById('logout-btn'); if(lb) lb.click(); else if(typeof window.logoutUser==='function') window.logoutUser(); }); modal.querySelectorAll('.vf-switch-item').forEach(function(item){ item.addEventListener('click',function(){ _saveCurrent(); var email=item.dataset.switchEmail; modal.remove(); var lb=document.getElementById('logout-btn'); if(lb){ lb.click(); setTimeout(function(){ var ei=document.getElementById('login-email'); if(ei) ei.value=email; if(typeof window.openAuthModal==='function'){window.isGuest=true; window.openAuthModal('login');} },900); } }); }); }
        function _injectSwitchBtn(){ if(_isGuest()) return; if(document.getElementById('vf-switch-account-btn')) return; var lb=document.getElementById('logout-btn'); if(!lb) return; _saveCurrent(); var btn=document.createElement('a'); btn.id='vf-switch-account-btn'; btn.href='#'; btn.style.cssText='display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(27,43,139,0.08);border:1px solid rgba(27,43,139,0.18);border-radius:10px;color:#93C5FD;font-weight:600;font-size:0.83rem;text-decoration:none;margin-bottom:6px;cursor:pointer;'; btn.innerHTML='<i class="fas fa-right-left"></i> Switch Account'; btn.addEventListener('click',function(e){e.preventDefault();_openSwitcher();}); lb.parentNode.insertBefore(btn,lb); }
        ready(function(){setTimeout(_injectSwitchBtn,1500);}); document.addEventListener('empyrean-init-done',function(){setTimeout(_injectSwitchBtn,600);}); ready(function(){ var sb=document.querySelector('.sidebar'); if(sb) new MutationObserver(function(){setTimeout(_injectSwitchBtn,300);}).observe(sb,{childList:true,subtree:true}); });
        window._vfOpenAccountSwitcher=_openSwitcher;
        console.log('[§24] Account switcher.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §25  NAV BAR SIDEBAR ICON STYLE — Premium SVG icons, no emoji fallbacks
            Replaces emoji CSS content: overrides with professional inline SVG.
            Maps each nav section ID to a clean monochrome SVG path.
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixNavStyle(){
        /* Override emoji fallback rules injected by index.html <style> block */
        ready(function(){
            if(document.getElementById('_vf_nav_sidebar')) return;
            var s=document.createElement('style'); s.id='_vf_nav_sidebar';
            s.textContent=[
                /* Kill emoji content overrides from index.html lines 15-18 */
                '.fa-video:before{content:"" !important;}',
                '.fa-store:before{content:"" !important;}',
                '.fa-film:before{content:"" !important;}',
                '.fa-newspaper:before{content:"" !important;}',
                '.fa-user-circle:before{content:"" !important;}',
                '.fa-cog:before{content:"" !important;}',
                '.fa-user-shield:before{content:"" !important;}',
                '.fa-hands-helping:before{content:"" !important;}',
                '.fa-file-invoice-dollar:before{content:"" !important;}',
                '.fa-briefcase:before{content:"" !important;}',
                '.fa-comment:before{content:"" !important;}',
                '.fa-satellite-dish:before{content:"" !important;}',
                '.fa-exclamation-triangle:before{content:"" !important;}',
                '.fa-building:before{content:"" !important;}',
                '.fa-users:before{content:"" !important;}',
                '.fa-tasks:before{content:"" !important;}',
                '.fa-hands-holding-circle:before{content:"" !important;}',
                '.fa-user:before{content:"" !important;}',
                '.fa-sitemap:before{content:"" !important;}',
                /* Sidebar link base style */
                '.sidebar-nav .nav-link{display:flex;align-items:center;gap:11px;padding:11px 16px;border-radius:10px;transition:background 0.18s,color 0.18s;color:rgba(232,240,255,0.72)!important;font-size:0.88rem;font-weight:500;text-decoration:none;cursor:pointer;border:none;background:none;width:100%;box-sizing:border-box;}',
                '.sidebar-nav .nav-link:hover{background:rgba(255,255,255,0.08)!important;color:#fff!important;}',
                '.sidebar-nav .nav-link.active{background:rgba(245,197,24,0.12)!important;color:#F5C518!important;font-weight:700;}',
                '.sidebar-nav .nav-link i,.sidebar-nav .nav-link .vf-nav-icon{color:rgba(232,240,255,0.65)!important;flex-shrink:0;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;}',
                '.sidebar-nav .nav-link.active .vf-nav-icon,.sidebar-nav .nav-link:hover .vf-nav-icon{color:#F5C518!important;}',
                '.sidebar-nav .nav-link.active i,.sidebar-nav .nav-link:hover i{color:#F5C518!important;}',
                /* SVG icon base */
                '.vf-nav-svg{width:20px;height:20px;fill:currentColor;display:block;flex-shrink:0;}',
            ].join('\n');
            document.head.appendChild(s);
        });

        /* SVG path map: section-id → SVG path(s) */
        var SVG_MAP = {
            'dashboard':        '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>',
            'go-live':          '<path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/>',
            'reels':            '<path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/>',
            'news':             '<path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-1 7H5v-1h14v1zm0-3H5V7h14v1zm-9 6H5v-1h5v1zm4 0h-3v-1h3v1z"/>',
            'marketplace':      '<path d="M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5c-1.1 0-2 .9-2 2v12a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2zm-7-3a3 3 0 010 6 3 3 0 010-6zm0 10a4 4 0 11.001-8.001A4 4 0 0112 13zm0-6a2 2 0 100 4 2 2 0 000-4z"/>',
            'business-page':    '<path d="M20 7H4c-1.1 0-2 .9-2 2v11a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zm-2 13H6V9h12v11zM0 5h24v2H0zm4-2h4V1H4v2zm12 0h4V1h-4v2z"/>',
            'community-tasks':  '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>',
            'request-help':     '<path d="M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/>',
            'report-crisis':    '<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>',
            'grant-portal':     '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15h8v2H8zm0-4h8v2H8zm0-4h5v2H8z"/>',
            'ngo-partners':     '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1a2 2 0 002 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3a1 1 0 00-1-1H8v-2h2a1 1 0 000-2H8V7h2a2 2 0 012 2v1h2a1 1 0 011 1v3h1c.65 0 1.23.24 1.68.63-.18.76-.44 1.49-.78 2.16z"/>',
            'messages':         '<path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z"/>',
            'my-wallet':        '<path d="M21 7H3a2 2 0 00-2 2v9a2 2 0 002 2h18a2 2 0 002-2V9a2 2 0 00-2-2zM1 5h20v2H1zM3 3h16v2H3zm14 10a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/>',
            'my-profile':       '<path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 3a3 3 0 110 6 3 3 0 010-6zm0 14.2a7.2 7.2 0 01-6-3.22c.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08a7.2 7.2 0 01-6 3.22z"/>',
            'profile':          '<path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 3a3 3 0 110 6 3 3 0 010-6zm0 14.2a7.2 7.2 0 01-6-3.22c.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08a7.2 7.2 0 01-6 3.22z"/>',
            'settings':         '<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7.37 7.37 0 00-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 00-.59.22L2.74 8.87a.47.47 0 00.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.37 1.04.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 00-.12-.61l-2.03-1.58zM12 15.6a3.6 3.6 0 110-7.2 3.6 3.6 0 010 7.2z"/>',
            /* Election Results / Polls / Help & Assistance Center were falling back to the
               emoji glyphs (📊 📊 🛟) because they had no entry here. */
            'election-results': '<path fill-rule="evenodd" d="M7 2h10a1 1 0 011 1v9H6V3a1 1 0 011-1zM8.6 7.4l2 2 4.6-4.6 1 1-5.6 5.6-3-3zM5 14h14a2 2 0 012 2v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4a2 2 0 012-2zM9 17h6v2H9z"/>',
            /* Saved was falling back to the bookmark emoji glyph because it had no entry here. */
            'saved-posts':      '<path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/>',
            'live-polls':       '<path fill-rule="evenodd" d="M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM7 7h6v2H7zm0 4h10v2H7zm0 4h4v2H7z"/>',
            'help-center':      '<path fill-rule="evenodd" d="M21.9 13.39A10 10 0 0 1 13.39 21.9L12.64 16.56A4.6 4.6 0 0 0 16.56 12.64zM10.61 21.9A10 10 0 0 1 2.1 13.39L7.44 12.64A4.6 4.6 0 0 0 11.36 16.56zM2.1 10.61A10 10 0 0 1 10.61 2.1L11.36 7.44A4.6 4.6 0 0 0 7.44 11.36zM13.39 2.1A10 10 0 0 1 21.9 10.61L16.56 11.36A4.6 4.6 0 0 0 12.64 7.44z"/>',
            'admin':            '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4a3 3 0 110 6 3 3 0 010-6zm0 14c-2.67 0-5-1.33-6.43-3.36.62-1.26 2.63-2.14 6.43-2.14s5.81.88 6.43 2.14C17 17.67 14.67 19 12 19z"/>',
        };

        function _makeSVG(sectionId, color) {
            var path = SVG_MAP[sectionId] || '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>';
            return '<svg class="vf-nav-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="color:'+(color||'currentColor')+'">' + path + '</svg>';
        }

        function _patchSidebarLinks() {
            document.querySelectorAll('.sidebar-nav .nav-link[data-section],.sidebar-nav .nav-link[data-target]').forEach(function(link) {
                if (link._vfIconPatched) return;
                link._vfIconPatched = true;
                var sec = link.dataset.section || link.dataset.target || '';
                if (!SVG_MAP[sec]) return;
                /* Remove existing <i> emoji-icon elements */
                link.querySelectorAll('i').forEach(function(i) { i.remove(); });
                /* Prepend SVG icon */
                var svgWrap = document.createElement('span');
                svgWrap.className = 'vf-nav-icon';
                svgWrap.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex-shrink:0;color:inherit;';
                svgWrap.innerHTML = _makeSVG(sec);
                link.insertBefore(svgWrap, link.firstChild);
            });
        }

        ready(function() { setTimeout(_patchSidebarLinks, 300); setTimeout(_patchSidebarLinks, 1000); setTimeout(_patchSidebarLinks, 2500); });
        document.addEventListener('empyrean-init-done', function() { setTimeout(_patchSidebarLinks, 400); });
        /* Re-patch when sidebar is rebuilt */
        ready(function() {
            var sb = document.querySelector('.sidebar,.sidebar-nav');
            if (sb) new MutationObserver(function() { setTimeout(_patchSidebarLinks, 80); }).observe(sb, { childList: true, subtree: true });
        });
        window._vfPatchSidebarIcons = _patchSidebarLinks;
        console.log('[§25] Sidebar nav — premium SVG icons, emoji overrides removed.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §26  PREMIUM BADGE REMOVAL (v8 killed it — keep that behaviour)
    ═══════════════════════════════════════════════════════════════════════ */
    (function removePremiumBadge(){
        /* §26 — Previously removed #v6-premium-btn / #v6-sidebar-premium.
           Those IDs no longer exist in app-fixes.js (they were from an older
           version). The section is kept as a no-op so section numbering is
           preserved and no other file's logic is disturbed. */
        console.log('[§26] Premium badge section — no-op (IDs no longer exist).');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §27  DASHBOARD BUSINESS POSTS SLIDER — REMOVED
            #dashboard-bizposts-container no longer exists in index.html
            (removed in favor of the interactive Business Page card now
            rendered inside #feed-container by app-business-feedcard.js).
            Section kept as a no-op so section numbering stays stable and
            no other file's logic is disturbed.
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixDashboardBizPostsSlider(){
        console.log('[§27] Dashboard business posts slider — no-op, container removed from index.html.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §28  VIDEO PRELOAD + PLAYSINLINE (feed posts)
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixVideoPreload(){
        ['_v10f_media_css','_v10f_media_css_v2','_v10f_media_css_v3','_v10f_media_css_v4','_v10f_media_css_v5','_v10f_detail_media_css'].forEach(function(id){ var el=document.getElementById(id); if(el) el.remove(); });
        function _fixVideos(root){ var scope=root||document; scope.querySelectorAll('.story-media-item video,.story-media-container video,.news-item-image video').forEach(function(vid){ if(vid._vfVidFixed) return; vid._vfVidFixed=true; if(!vid.getAttribute('preload')||vid.getAttribute('preload')==='none') vid.setAttribute('preload','metadata'); if(!vid.hasAttribute('playsinline')) vid.setAttribute('playsinline',''); if(!vid.hasAttribute('controls')) vid.setAttribute('controls',''); if(vid.readyState===0&&vid.src) vid.load(); }); }
        function _attachFeedObs(){ var feed=document.getElementById('feed-container')||document.getElementById('posts-feed'); if(!feed||feed._vfVideoObs) return; feed._vfVideoObs=true; new MutationObserver(function(muts){ muts.forEach(function(m){ m.addedNodes.forEach(function(n){ if(n.nodeType===1) setTimeout(function(){_fixVideos(n);},80); }); }); }).observe(feed,{childList:true}); }
        function _init(){ _fixVideos(document); _attachFeedObs(); }
        if(document.readyState!=='loading'){ setTimeout(_init,150); setTimeout(function(){_fixVideos(document);},1500); } else document.addEventListener('DOMContentLoaded',function(){setTimeout(_init,150);});
        document.addEventListener('empyrean-init-done',function(){setTimeout(_init,250); setTimeout(function(){_fixVideos(document);},1200);});
        console.log('[§28] Video preload fix.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §29  GLOBAL INIT BRIDGE
    ═══════════════════════════════════════════════════════════════════════ */
    document.addEventListener('empyrean-init-done', function(){
        setTimeout(function(){
            /* Re-render profile if currently visible and empty */
            var profileSection=document.getElementById('profile');
            if (profileSection&&getComputedStyle(profileSection).display!=='none'){
                var us=window.userState||{}; if(us.id&&typeof window.renderUserProfile==='function') { var hasContent=profileSection.querySelector('.profile-header,.profile-content,.user-profile-wrapper,.profile-card'); if(!hasContent) window.renderUserProfile(us.id); }
            }
        },1200);
    });

    console.log('[Empyrean Fix FINAL] ✅ All 33 sections loaded. Replace v5–v10 with this single file.');


    /* ═══════════════════════════════════════════════════════════════════════
       §30  MARKETPLACE — dashboard strip visibility + contact+chat + owner toolbar
            C1. Load marketplace listings into dashboard strip from Firestore.
            C2. Contact button: expand phone/email + private "Message Seller" button.
            C3. Horizontal scrollable owner/admin Edit + Delete toolbar per card.
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixMarketplaceDashboardAndControls(){

        /* ── C1: CSS for scroll toolbar + contact expand panel ── */
        ready(function(){
            if(document.getElementById('_vf_mkt_ext_css')) return;
            var s=document.createElement('style'); s.id='_vf_mkt_ext_css';
            s.textContent=[
                '.direct-contact-info{padding:0;overflow:hidden;max-height:0;transition:max-height 0.3s ease,padding 0.3s ease;background:rgba(0,212,170,0.05);border-top:1px solid rgba(0,212,170,0.1);}',
                '.direct-contact-info.open{max-height:320px!important;padding:14px 16px!important;}',
                '.direct-contact-info p{margin:5px 0;font-size:0.87rem;}',
                '.vf-chat-seller-btn{display:inline-flex;align-items:center;gap:6px;margin-top:10px;padding:8px 16px;border-radius:8px;background:rgba(27,43,139,0.08);color:#1B2B8B;border:1px solid rgba(27,43,139,0.18);cursor:pointer;font-size:0.82rem;font-weight:700;transition:background 0.18s;}',
                '.vf-chat-seller-btn:hover{background:rgba(27,43,139,0.15);}',
                '.vf-owner-toolbar{display:flex!important;flex-wrap:nowrap!important;overflow-x:auto!important;gap:8px!important;padding:8px 12px!important;scrollbar-width:none!important;-webkit-overflow-scrolling:touch!important;border-top:1px solid rgba(0,0,0,0.05);}',
                '.vf-owner-toolbar::-webkit-scrollbar{display:none;}',
                '.vf-tb-btn{flex-shrink:0;white-space:nowrap;padding:7px 14px;border-radius:8px;font-size:0.8rem;font-weight:700;cursor:pointer;border:1px solid transparent;display:inline-flex;align-items:center;gap:5px;}',
                '.vf-tb-edit{background:rgba(0,212,170,0.09);color:#00B894;border-color:rgba(0,212,170,0.22);}',
                '.vf-tb-delete{background:rgba(229,57,53,0.07);color:#e53935;border-color:rgba(229,57,53,0.18);}',
            ].join('');
            document.head.appendChild(s);
        });

        /* ── C1: Load listings into dashboard strip from Firestore ── */
        function _buildStripCard(data){
            var card=document.createElement('div');
            card.className='dashboard-market-card';
            card.dataset.id=data.id||''; card.dataset.navTarget='marketplace';
            card.style.cssText='flex:0 0 130px;width:130px;border-radius:14px;overflow:hidden;cursor:pointer;box-shadow:0 2px 12px rgba(10,14,39,0.12);background:#fff;border:1px solid rgba(10,14,39,0.07);scroll-snap-align:start;transition:transform 0.2s;';
            var firstUrl=(data.media&&data.media[0])||data.img||data.imageUrl||'';
            var isVid=/\.(mp4|webm|mov)(\?|$)/i.test(firstUrl)||/\/video\/upload\//i.test(firstUrl);
            var price=typeof window._fmtPrice==='function'?window._fmtPrice(data.price||0,data.currency||'NGN'):('₦'+Number(data.price||0).toLocaleString());
            var media=firstUrl?(isVid?'<video src="'+_esc(firstUrl)+'" autoplay loop muted playsinline style="width:100%;height:80px;object-fit:cover;display:block;"></video>':'<img src="'+_esc(firstUrl)+'" alt="'+_esc(data.name||'')+'" loading="lazy" style="width:100%;height:80px;object-fit:cover;display:block;">'):'<div style="width:100%;height:80px;background:rgba(0,212,170,0.07);display:flex;align-items:center;justify-content:center;"><i class="fas fa-store" style="font-size:1.6rem;color:rgba(0,212,170,0.4);"></i></div>';
            // FIX (request — "no design or texts inside the light green top
            // header of the marketplace card... there should be some
            // information from the Bio data captured during filling"):
            // this older strip loader (still running alongside the newer
            // avatar-card one in app-fixes.js) only ever showed name+price,
            // even for Job Seeking / Professional Services / Job Vacancy
            // listings whose posting form captures a role, location, etc.
            // Surfacing just the role badge + location here — one compact
            // line, same 130px card, same 80px media block, nothing resized.
            var _bcIsAvatar=(typeof window._mktIsAvatarCategory==='function')&&window._mktIsAvatarCategory(data.category);
            var _bcBio='';
            if(_bcIsAvatar){
                var _bcRole=(typeof window._mktAvatarRoleLabel==='function')?window._mktAvatarRoleLabel(data.category):'';
                var _bcLoc=(data.location||'').trim();
                var _bcBioText=[_bcRole,_bcLoc].filter(Boolean).join(' • ');
                if(_bcBioText) _bcBio='<div style="font-size:0.68rem;color:#5A6270;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+_esc(_bcBioText)+'</div>';
            }
            card.innerHTML=media+'<div style="padding:8px 10px;"><div style="font-weight:700;font-size:0.76rem;color:#0A0E27;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+_esc(data.name||'Item')+'</div>'+_bcBio+'<div style="font-size:0.72rem;color:#00D4AA;font-weight:700;margin-top:2px;">'+price+'</div></div>';
            card.addEventListener('click',function(){ if(typeof window.navigateTo==='function') window.navigateTo('marketplace'); });
            card.addEventListener('mouseenter',function(){ card.style.transform='translateY(-3px)'; });
            card.addEventListener('mouseleave',function(){ card.style.transform=''; });
            return card;
        }

        function _loadMarketStrip(){
            // DISABLED (request — "two or more marketplace cards should not
            // appear on the same site... remove the card-style system"):
            // this function's own header comment already documented it as
            // "still running alongside the newer avatar-card one in
            // app-fixes.js" — a separate, independent one-time
            // .get() fetch that populates #dashboard-market-slider on top
            // of whatever app-fixes.js's real-time onSnapshot listener
            // (the canonical one, with the current compact-card design and
            // document/category-aware rendering) has already put there.
            // Both write into the identical container using overlapping
            // dedupe keys, so whichever one's timing wins on a given load
            // is what the user actually sees — explaining why the wrong
            // card style ("screenshot 2") was the dominant one after a
            // normal login (this fires reliably on 'empyrean-init-done'/
            // ready) while the correct one only won the race occasionally
            // (after a hard refresh changed load timing). Left in place
            // per this codebase's no-deletion convention, but inert: the
            // three setTimeout(_loadMarketStrip, ...) call sites below are
            // now harmless no-ops. app-fixes.js's listener is the single
            // remaining owner of #dashboard-market-slider.
            return;
            var cont=document.getElementById('dashboard-market-container');
            var slider=document.getElementById('dashboard-market-slider');
            if(!cont||!slider) return;
            /* Force container visible immediately so layout doesn't collapse */
            cont.style.display='block';
            /* Slider CSS guard */
            if(!slider.style.display) { slider.style.display='flex'; slider.style.flexWrap='nowrap'; slider.style.overflowX='auto'; slider.style.gap='10px'; slider.style.scrollSnapType='x mandatory'; slider.style.webkitOverflowScrolling='touch'; }
            if(!_fbOk()) return;
            /* Three-level fallback: status+order → order only → simple get */
            function _populate(snap){
                if(!snap||snap.empty) return;
                snap.forEach(function(doc){ var d=doc.data(); d.id=doc.id; if(!slider.querySelector('[data-id="'+d.id+'"]')) slider.appendChild(_buildStripCard(d)); });
            }
            try{
                window.fbDb.collection('marketplace_listings').where('status','==','active').orderBy('createdAt','desc').limit(12).get()
                    .then(_populate)
                    .catch(function(){
                        window.fbDb.collection('marketplace_listings').orderBy('createdAt','desc').limit(12).get()
                            .then(_populate)
                            .catch(function(){
                                window.fbDb.collection('marketplace_listings').limit(12).get().then(_populate).catch(function(){});
                            });
                    });
            }catch(e){}
        }

        /* Wrap addMarketItemToDashboardStrip so new uploads also show the container */
        var _origAdd=window.addMarketItemToDashboardStrip;
        window.addMarketItemToDashboardStrip=function(data){
            if(typeof _origAdd==='function') _origAdd(data);
            var cont=document.getElementById('dashboard-market-container'); if(cont) cont.style.display='block';
        };
        window.addMarketItemToDashboardSlider=window.addMarketItemToDashboardStrip;

        /* ── C2: Contact button delegation — DISABLED ──
           app-patch-v2.js's patchMarketplaceContact (§P3, loads later in
           index.html) now owns this button exclusively: it wires a listener
           directly on each button, includes a more complete Firestore
           fallback (listing doc + seller profile doc), and is the version
           the rest of the codebase's comments describe as canonical.
           This handler was registered on document with capture:true and
           called stopImmediatePropagation(), which meant it fired FIRST on
           every tap and silently prevented app-patch-v2.js's handler from
           ever running — the two panels were never actually racing, this
           one was just always winning and shadowing the better one.
           Left here disabled rather than deleted in case app-patch-v2.js
           is ever removed and this needs to be the fallback again. */
        function _disabled_C2_contactButtonDelegation(e){
            var contactBtn=e.target.closest(
                '.contact-seller-btn,.expand-contact-btn,'+
                '[data-action="expand-contact"],[data-action="contact-seller"],'+
                'button[class*="contact"],button[class*="expand-contact"]'
            );
            if(!contactBtn) return;
            e.preventDefault(); e.stopImmediatePropagation();
            if(_isGuest()){ if(typeof window.openAuthModal==='function') window.openAuthModal('login'); return; }
            var card=contactBtn.closest('.property-card,.market-card,.listing-card'); if(!card) return;
            var panel=card.querySelector('.direct-contact-info');
            if(!panel){
                panel=document.createElement('div');
                panel.className='direct-contact-info';
                panel.style.cssText='overflow:hidden;max-height:0;transition:max-height 0.32s ease,padding 0.32s ease;background:rgba(0,212,170,0.05);border-top:1px solid rgba(0,212,170,0.15);padding:0 16px;box-sizing:border-box;';
                var actionsDiv=card.querySelector('.property-actions');
                if(actionsDiv) card.insertBefore(panel,actionsDiv); else card.appendChild(panel);
            }
            var isOpen=panel.classList.contains('open');
            if(isOpen){
                panel.classList.remove('open');
                panel.style.maxHeight='0'; panel.style.padding='0 16px';
                contactBtn.innerHTML='<i class="fas fa-phone"></i> Contact Seller';
                contactBtn.setAttribute('aria-expanded','false');
                return;
            }
            /* ── build the contact panel content ── */
            var cName  = card.dataset.contactName  || card.dataset.sellerName || '';
            var cPhone = card.dataset.contactPhone || card.dataset.phone || '';
            var cEmail = card.dataset.contactEmail || card.dataset.email || '';
            var cAddr  = card.dataset.contactAddress || card.dataset.address || '';
            var sellerId   = card.dataset.sellerId || card.dataset.userId || '';
            var listingId  = card.dataset.id || card.dataset.postId || '';
            var sellerName = cName || (card.querySelector('h4,.property-name')||{}).textContent || 'Seller';
            var us = _us();
            var isOwner = _isAdmin() || (us.id && sellerId && sellerId === us.id);

            function _buildContactHTML(nm, ph, em, ad, uname){
                var chatBtn = (!isOwner && sellerId)
                    ? '<button class="vf-chat-seller-btn mkt-msg-seller-btn" data-seller-id="'+_esc(sellerId)+'" data-seller-name="'+_esc(nm||sellerName)+'" style="margin-top:10px;width:100%;padding:10px;background:var(--secondary,#1B2B8B);color:#fff;border:none;border-radius:10px;font-size:0.87rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;"><i class="fas fa-comment-dots"></i> Message Seller</button>'
                    : '';
                var displayName = nm || uname || sellerName;
                var rows = [
                    '<p style="font-weight:700;font-size:0.87rem;margin:0 0 10px;color:var(--primary,#0A0E27);"><i class="fas fa-address-card" style="color:#00D4AA;margin-right:7px;"></i>Seller Contact</p>',
                    /* Always show name/username — this is never empty */
                    '<p style="margin:4px 0;font-size:0.85rem;"><i class="fas fa-user" style="width:16px;margin-right:7px;opacity:0.55;"></i>'+_esc(displayName)+(uname&&uname!==displayName?' <span style="color:#6B7280;font-size:0.78rem;">(@'+_esc(uname)+')</span>':'')+'</p>',
                    ph  ? '<p style="margin:4px 0;font-size:0.85rem;"><i class="fas fa-phone" style="width:16px;margin-right:7px;opacity:0.55;"></i><a href="tel:'+_esc(ph)+'" style="color:var(--secondary,#1B2B8B);font-weight:600;">'+_esc(ph)+'</a></p>' : '',
                    em  ? '<p style="margin:4px 0;font-size:0.85rem;"><i class="fas fa-envelope" style="width:16px;margin-right:7px;opacity:0.55;"></i><a href="mailto:'+_esc(em)+'" style="color:var(--secondary,#1B2B8B);font-weight:600;">'+_esc(em)+'</a></p>' : '',
                    ad  ? '<p style="margin:4px 0;font-size:0.85rem;"><i class="fas fa-map-marker-alt" style="width:16px;margin-right:7px;opacity:0.55;"></i>'+_esc(ad)+'</p>' : '',
                    (!ph&&!em) ? '<p style="margin:6px 0 2px;font-size:0.81rem;color:#6B7280;"><i class="fas fa-info-circle" style="margin-right:5px;"></i>No phone or email on file — tap Message Seller to chat directly.</p>' : '',
                    chatBtn,
                ].join('');
                return rows;
            }

            function _openPanel(html){
                panel.innerHTML=html;
                panel.classList.add('open');
                panel.style.maxHeight='320px'; panel.style.padding='14px 16px';
                contactBtn.innerHTML='<i class="fas fa-chevron-up"></i> Hide Contact';
                contactBtn.setAttribute('aria-expanded','true');
            }

            if(!cPhone && !cEmail && !cName && _fbOk() && listingId){
                /* No data on dataset yet — fetch listing doc AND seller profile in parallel */
                _openPanel('<p style="color:#6B7280;font-size:0.83rem;"><i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Loading contact info…</p>');
                var listingPromise = window.fbDb.collection('marketplace_listings').doc(listingId).get();
                var profilePromise = sellerId
                    ? window.fbDb.collection('users').doc(sellerId).get()
                    : Promise.resolve(null);
                Promise.all([listingPromise, profilePromise])
                    .then(function(results){
                        var ldoc = results[0], pdoc = results[1];
                        var ld = ldoc && ldoc.exists ? ldoc.data() : {};
                        var pd = pdoc && pdoc.exists ? pdoc.data() : {};
                        /* Priority: listing contact fields → seller user profile fields */
                        var ph = ld.contactPhone || ld.phone || pd.phone || pd.contactPhone || '';
                        var em = ld.contactEmail || ld.email || pd.email || pd.contactEmail || '';
                        var nm = ld.contactName  || ld.sellerName || pd.fullName || pd.username || sellerName;
                        var ad = ld.contactAddress || ld.address || pd.address || pd.location || '';
                        var uname = pd.username || ld.sellerName || '';
                        /* Cache on dataset */
                        card.dataset.contactPhone   = ph;
                        card.dataset.contactEmail   = em;
                        card.dataset.contactName    = nm;
                        card.dataset.contactAddress = ad;
                        card.dataset.sellerUsername = uname;
                        _openPanel(_buildContactHTML(nm, ph, em, ad, uname));
                    })
                    .catch(function(){ _openPanel(_buildContactHTML('','','','')); });
            } else {
                var uname2 = card.dataset.sellerUsername || '';
                _openPanel(_buildContactHTML(cName, cPhone, cEmail, cAddr, uname2));
            }
        }

        /* ── C2b: window._openMarketChatOverlay — DISABLED as the active
           implementation ──
           FIX (two-way marketplace chat gap, 2026-07-18): app-marketplace.js
           loads BEFORE this file and already assigns the canonical
           window._openMarketChatOverlay — the one with quick-reply chips
           that writes to marketplace_messages/{tid}/msgs, which is the exact
           collection+shape app-patch-v20.js's Marketplace tab and the
           marketplace inbox modal both read from. This file was loading
           AFTER app-marketplace.js and unconditionally overwriting that
           global with THIS function instead, which reads/writes a totally
           different collection (top-level 'messages' with a plain chatId,
           no listing scoping). Net effect: any entry point that calls
           window._openMarketChatOverlay (notably the Marketplace tab inside
           Messages) opened a chat pointed at the wrong collection — it
           looked empty even though the real thread had messages, and any
           reply sent from there vanished into a collection the other party
           never reads. The "Message Seller" button on listing cards was
           unaffected only because app-marketplace.js calls its own local
           function directly rather than through window.
           This function is kept as a fallback (renamed, no longer assigned
           to window directly) in case app-marketplace.js is ever removed —
           see the guard just below its closing brace. */
        function _legacyMktChatOverlay(sellerId, sellerName) {
            if(!sellerId){ _notify('Cannot open chat — seller info missing.','warning'); return; }
            var us = _us();
            if(!us||!us.id){ if(typeof window.openAuthModal==='function') window.openAuthModal('login'); return; }
            if(sellerId===us.id){ _notify('This is your own listing.','info'); return; }

            /* Remove any existing overlay */
            var existing = document.getElementById('mkt-chat-overlay');
            if(existing){ existing.remove(); }

            var sname = sellerName || 'Seller';
            var chatId = [us.id, sellerId].sort().join('_');

            /* ── Build the overlay ── */
            var overlay = document.createElement('div');
            overlay.id = 'mkt-chat-overlay';
            overlay.style.cssText = [
                'position:fixed;bottom:0;left:0;right:0;z-index:9999;',
                'background:white;border-radius:20px 20px 0 0;',
                'box-shadow:0 -8px 40px rgba(10,14,39,0.18);',
                'display:flex;flex-direction:column;',
                /* height set below via JS — window.innerHeight is used instead of
                   the 55vh unit because Android WebViews (this app's "Preview"
                   tool included) frequently size vh against the full device
                   viewport rather than the actually-visible area, which was
                   pushing the composer bar below the visible fold even though
                   it was correctly present in the DOM. Same class of bug fixed
                   previously for the business-post comment composer. */
                'transform:translateY(100%);transition:transform 0.32s cubic-bezier(0.4,0,0.2,1);',
            ].join('');
            overlay.style.height = Math.round((window.visualViewport ? window.visualViewport.height : window.innerHeight) * 0.55) + 'px';

            overlay.innerHTML = [
                /* Header */
                '<div style="display:flex;align-items:center;gap:12px;padding:14px 16px 12px;',
                'border-bottom:1px solid rgba(10,14,39,0.07);background:white;border-radius:20px 20px 0 0;flex-shrink:0;">',
                '<div style="width:38px;height:38px;border-radius:50%;background:var(--secondary,#1B2B8B);',
                'display:flex;align-items:center;justify-content:center;flex-shrink:0;color:white;font-weight:700;font-size:1rem;">',
                _esc(sname.charAt(0).toUpperCase())+'</div>',
                '<div style="flex:1;min-width:0;">',
                '<div style="font-weight:700;font-size:0.95rem;color:#0A0E27;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+_esc(sname)+'</div>',
                '<div style="font-size:0.75rem;color:#6B7280;">Marketplace Chat</div>',
                '</div>',
                '<button id="mkt-chat-goto-inbox" title="Open in Messages" style="background:rgba(27,43,139,0.07);border:none;',
                'border-radius:10px;padding:7px 12px;font-size:0.78rem;font-weight:700;color:var(--secondary,#1B2B8B);',
                'cursor:pointer;display:flex;align-items:center;gap:6px;margin-right:6px;">',
                '<i class="fas fa-external-link-alt"></i> Full Chat</button>',
                '<button id="mkt-chat-close" style="width:34px;height:34px;border-radius:50%;background:rgba(10,14,39,0.06);',
                'border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">',
                '<i class="fas fa-times" style="color:#374151;font-size:0.9rem;"></i></button>',
                '</div>',
                /* Messages area */
                '<div id="mkt-chat-messages" style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;',
                'flex-direction:column;gap:8px;background:rgba(240,242,248,0.45);min-height:0;">',
                '<div id="mkt-chat-loading" style="text-align:center;padding:20px;color:#9CA3AF;font-size:0.83rem;">',
                '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Loading messages…</div>',
                '</div>',
                /* Composer — flex-shrink:0 keeps it always visible at the bottom */
                '<div id="mkt-chat-composer" style="padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(10,14,39,0.07);background:white;flex-shrink:0;min-height:64px;">',
                '<div style="display:flex;align-items:center;gap:8px;">',
                '<input id="mkt-chat-input" type="text" placeholder="Message '+_esc(sname)+'…" ',
                'style="flex:1;padding:11px 16px;background:rgba(10,14,39,0.04);border:1.5px solid rgba(10,14,39,0.09);',
                'border-radius:22px;font-size:0.9rem;outline:none;font-family:inherit;" autocomplete="off">',
                '<button id="mkt-chat-send" style="width:42px;height:42px;border-radius:50%;background:var(--secondary,#1B2B8B);',
                'border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;',
                'box-shadow:0 3px 10px rgba(27,43,139,0.3);">',
                '<i class="fas fa-paper-plane" style="color:white;font-size:0.88rem;"></i></button>',
                '</div></div>',
            ].join('');

            document.body.appendChild(overlay);
            /* Animate in */
            requestAnimationFrame(function(){ overlay.style.transform='translateY(0)'; });

            /* ── Reposition overlay above keyboard when it opens (Android/iOS) ──
               visualViewport fires a resize event whenever the keyboard appears
               or disappears. We move the overlay's bottom edge to sit exactly
               at the top of the keyboard so the composer is never hidden. */
            function _reposition(){
                var vv = window.visualViewport;
                if(!vv) return;
                var kbHeight = window.innerHeight - vv.height;
                overlay.style.bottom = (kbHeight > 0 ? kbHeight : 0) + 'px';
            }
            if(window.visualViewport){
                window.visualViewport.addEventListener('resize', _reposition);
                window.visualViewport.addEventListener('scroll', _reposition);
            }

            /* ── Helpers ── */
            var _esc2 = typeof _esc==='function' ? _esc : function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
            var db = window.fbDb;
            var msgsDiv = document.getElementById('mkt-chat-messages');
            var input   = document.getElementById('mkt-chat-input');
            var unsubscribe = null;

            function _bubble(text, mine, ts){
                var d = document.createElement('div');
                d.style.cssText = 'display:flex;justify-content:'+(mine?'flex-end':'flex-start')+';';
                var time = ts ? new Date(ts.toDate ? ts.toDate() : ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
                d.innerHTML = '<div style="max-width:72%;padding:9px 13px;border-radius:'+(mine?'16px 16px 4px 16px':'16px 16px 16px 4px')+';'
                    +'background:'+(mine?'var(--secondary,#1B2B8B)':'white')+';color:'+(mine?'white':'#0A0E27')+';'
                    +'font-size:0.88rem;line-height:1.4;box-shadow:0 1px 4px rgba(0,0,0,0.08);">'
                    +_esc2(text)
                    +(time?'<div style="font-size:0.68rem;opacity:0.6;margin-top:3px;text-align:right;">'+time+'</div>':'')
                    +'</div>';
                return d;
            }

            function _scrollBottom(){
                if(msgsDiv) msgsDiv.scrollTop = msgsDiv.scrollHeight;
            }

            /* ── Load existing messages via real-time listener ── */
            function _loadMessages(){
                if(!db) return;
                var loading = document.getElementById('mkt-chat-loading');
                try {
                    /* NOTE: intentionally no .orderBy('createdAt') here — a
                       where() on one field plus orderBy() on another requires
                       a Firestore composite index. Without one this query
                       failed outright, which is what produced the
                       "Could not load messages." error text. Sorting the
                       60-message page client-side avoids needing that index. */
                    unsubscribe = db.collection('messages')
                        .where('chatId','==',chatId)
                        .limit(60)
                        .onSnapshot(function(snap){
                            if(loading){ loading.remove(); loading=null; }
                            /* Clear and re-render all (simpler for small chat windows) */
                            var existingBubbles = msgsDiv.querySelectorAll('.mkt-bubble');
                            existingBubbles.forEach(function(b){ b.remove(); });
                            var docs = [];
                            snap.forEach(function(doc){ docs.push(doc.data()); });
                            docs.sort(function(a,b){
                                var ta = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
                                var tb = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
                                return ta - tb;
                            });
                            docs.forEach(function(d){
                                var b=_bubble(d.text||d.body||'',d.senderId===us.id,d.createdAt);
                                b.className='mkt-bubble';
                                msgsDiv.appendChild(b);
                            });
                            if(snap.empty && loading===null){
                                var empty=document.createElement('div');
                                empty.className='mkt-bubble';
                                empty.style.cssText='text-align:center;color:#9CA3AF;font-size:0.82rem;padding:20px;';
                                empty.textContent='No messages yet. Say hello!';
                                msgsDiv.appendChild(empty);
                            }
                            _scrollBottom();
                        }, function(err){
                            if(loading){ loading.textContent='Could not load messages.'; }
                            console.warn('[MktChat] listener error:',err.message);
                        });
                } catch(e){
                    if(loading){ loading.textContent='Could not connect to chat.'; }
                    console.warn('[MktChat] onSnapshot setup failed:',e.message);
                }
            }

            /* ── Send a message ── */
            function _send(){
                var text = input ? input.value.trim() : '';
                if(!text) return;
                if(!db){ _notify('Not connected to Firebase.','warning'); return; }
                input.value='';
                var now = new Date();
                var msg = {
                    chatId:     chatId,
                    senderId:   us.id,
                    receiverId: sellerId,
                    text:       text,
                    createdAt:  firebase.firestore.FieldValue.serverTimestamp
                        ? firebase.firestore.FieldValue.serverTimestamp()
                        : now,
                    read: false,
                };
                /* Optimistic bubble */
                var b=_bubble(text,true,now); b.className='mkt-bubble'; msgsDiv.appendChild(b); _scrollBottom();
                /* Write to Firestore */
                db.collection('messages').add(msg).catch(function(e){ console.warn('[MktChat] send failed:',e.message); });
                /* Update / create chat thread metadata (mirrors what the main inbox expects) */
                var thread = {
                    participants:    [us.id, sellerId],
                    lastMessage:     text,
                    lastMessageTime: firebase.firestore.FieldValue.serverTimestamp
                        ? firebase.firestore.FieldValue.serverTimestamp()
                        : now,
                    updatedAt:       firebase.firestore.FieldValue.serverTimestamp
                        ? firebase.firestore.FieldValue.serverTimestamp()
                        : now,
                    unreadCount:     firebase.firestore.FieldValue.increment
                        ? firebase.firestore.FieldValue.increment(1)
                        : 1,
                };
                db.collection('chats').doc(chatId).set(thread, {merge:true}).catch(function(e){ console.warn('[MktChat] chat thread update:',e.message); });
            }

            /* ── Wire events ── */
            var sendBtn = document.getElementById('mkt-chat-send');
            var closeBtn = document.getElementById('mkt-chat-close');
            var gotoInbox = document.getElementById('mkt-chat-goto-inbox');

            function _closeOverlay(){
                overlay.style.transform='translateY(100%)';
                overlay.style.bottom='0';
                if(window.visualViewport){
                    window.visualViewport.removeEventListener('resize', _reposition);
                    window.visualViewport.removeEventListener('scroll', _reposition);
                }
                setTimeout(function(){ if(unsubscribe) unsubscribe(); overlay.remove(); }, 320);
            }

            if(sendBtn) sendBtn.addEventListener('click', _send);
            if(input) input.addEventListener('keydown', function(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); _send(); } });
            if(closeBtn) closeBtn.addEventListener('click', _closeOverlay);
            if(gotoInbox) gotoInbox.addEventListener('click', function(){
                _closeOverlay();
                setTimeout(function(){
                    if(typeof window.openChat==='function') window.openChat(sellerId, sname);
                    else if(typeof window.navigateTo==='function') window.navigateTo('messages');
                }, 200);
            });
            /* Close on backdrop tap (above the panel) */
            document.addEventListener('click', function _bdClose(e){
                if(!overlay.contains(e.target)){
                    _closeOverlay();
                    document.removeEventListener('click', _bdClose);
                }
            });

            _loadMessages();
            setTimeout(function(){ if(input) input.focus(); }, 400);
        }

        /* Only install this legacy overlay if app-marketplace.js's canonical
           one (quick-reply chips + marketplace_messages/{tid}/msgs) hasn't
           already claimed window._openMarketChatOverlay. Since that file
           loads first, this branch should normally never run in production
           — it's a safety net only. */
        if (typeof window._openMarketChatOverlay !== 'function') {
            window._openMarketChatOverlay = _legacyMktChatOverlay;
        }

        /* Chat button click — kept active in case .vf-chat-seller-btn is
           still rendered anywhere else in the app, but now opens the same
           in-marketplace overlay instead of navigating to a separate
           inbox/messages section. */
        document.addEventListener('click',function(e){
            var btn=e.target.closest('.vf-chat-seller-btn'); if(!btn) return;
            e.preventDefault(); e.stopPropagation();
            if(_isGuest()){ if(typeof window.openAuthModal==='function') window.openAuthModal('login'); return; }
            var sid=btn.dataset.sellerId, sname=btn.dataset.sellerName||'Seller';
            if(typeof window._openMarketChatOverlay==='function') window._openMarketChatOverlay(sid,sname);
            else if(typeof window.showMarketplaceGallery==='function'){ /* no-op fallback guard */ }
            else{ _notify('Unable to open chat right now.','warning'); }
        });

        /* ── C3: Horizontal owner/admin toolbar per .property-card ── */
        function _ensureToolbar(card){
            if(!card||card._vfToolbarDone) return;
            var us=_us(), sellerId=card.dataset.sellerId||card.dataset.userId||'';
            /* FIX: Only show edit/delete to admin OR the owner of this listing */
            if(!_isAdmin()&&!(us.id&&sellerId&&sellerId===us.id)) return;
            card._vfToolbarDone=true;
            /* Skip if app-marketplace.js already injected edit/delete */
            if(card.querySelector('.edit-post-btn,.sp-tb-btn,.vf-tb-btn')) return;
            var toolbar=document.createElement('div'); toolbar.className='vf-owner-toolbar';
            var eb=document.createElement('button'); eb.className='vf-tb-btn vf-tb-edit'; eb.innerHTML='<i class="fas fa-pencil-alt"></i> Edit'; eb.dataset.action='vf-edit';
            var db=document.createElement('button'); db.className='vf-tb-btn vf-tb-delete'; db.innerHTML='<i class="fas fa-trash-alt"></i> Delete'; db.dataset.action='vf-delete';
            toolbar.appendChild(eb); toolbar.appendChild(db);
            var ci=card.querySelector('.direct-contact-info'); if(ci) card.insertBefore(toolbar,ci); else card.appendChild(toolbar);
        }

        document.addEventListener('click',function(e){
            var t=e.target;
            /* Edit */
            var editBtn=t.closest('[data-action="vf-edit"]');
            if(editBtn){ var card=editBtn.closest('.property-card'); if(!card) return; e.preventDefault(); e.stopPropagation();
                var existingEdit=card.querySelector('.edit-post-btn'); if(existingEdit){ existingEdit.click(); return; }
                var name=(card.querySelector('h4,.property-name')||{}).textContent||'', price=card.dataset.price||'';
                var nn=prompt('Edit title:',name); if(nn===null) return;
                var np=prompt('Edit price:',price); if(np===null) return;
                var h4=card.querySelector('h4,.property-name'); if(h4) h4.textContent=nn; card.dataset.price=np;
                if(_fbOk()&&(card.dataset.id||card.dataset.postId)){ try{ window.fbDb.collection('marketplace_listings').doc(card.dataset.id||card.dataset.postId).update({name:nn,price:parseFloat(np)||0}); }catch(ex){} }
                _notify('Listing updated!','success'); return; }
            /* Delete */
            var delBtn=t.closest('[data-action="vf-delete"]');
            if(delBtn){ var card2=delBtn.closest('.property-card'); if(!card2) return; e.preventDefault(); e.stopPropagation();
                var sid2=card2.dataset.sellerId||'', us2=_us();
                if(!_isAdmin()&&sid2&&sid2!==us2.id){ _notify('You can only delete your own listings.','warning'); return; }
                if(!confirm('Delete this listing? This cannot be undone.')) return;
                var docId=card2.dataset.id||card2.dataset.postId||'';
                card2.style.transition='opacity 0.3s,transform 0.3s'; card2.style.opacity='0'; card2.style.transform='scale(0.94)';
                setTimeout(function(){ document.querySelectorAll('[data-id="'+docId+'"],[data-post-id="'+docId+'"]').forEach(function(el){ el.remove(); }); },320);
                if(_fbOk()&&docId){ try{ window.fbDb.collection('marketplace_listings').doc(docId).delete(); _notify('✅ Listing deleted.','success'); }catch(ex){ _notify('Removed from view.','info'); } }
                else _notify('Listing removed.','success'); return; }
        });

        /* Apply toolbar to all current + future .property-card/.market-card/.listing-card elements */
        function _applyToolbars(){ document.querySelectorAll('.property-card,.market-card,.listing-card').forEach(_ensureToolbar); }
        new MutationObserver(function(muts){ muts.forEach(function(m){ m.addedNodes.forEach(function(n){ if(!n.querySelectorAll) return; n.querySelectorAll('.property-card,.market-card,.listing-card').forEach(_ensureToolbar); if(n.classList&&(n.classList.contains('property-card')||n.classList.contains('market-card')||n.classList.contains('listing-card'))) _ensureToolbar(n); }); }); }).observe(document.body,{childList:true,subtree:true});

        /* ── C4: Whole-card click → open seller's profile dashboard ──
           Clicking anywhere on a .property-card that is NOT a button/link/
           input/media element navigates to the seller's profile dashboard
           (window._openSellerProfile, defined in app-marketplace-sellers.js).
           The Message Seller button remains the sole entry point into direct
           messaging — this handler no longer opens any chat overlay.
           Media elements (img/video) are explicitly excluded here so a tap
           on a picture/video falls through to the full-screen gallery
           handler instead of being hijacked into a profile navigation. */
        document.addEventListener('click',function(e){
            /* Skip if the click landed on an interactive element */
            var t=e.target;
            if(t.closest('button,a,input,select,textarea,.contact-seller-btn,.expand-contact-btn,.vf-chat-seller-btn,.mkt-msg-seller-btn,.direct-contact-info,.vf-owner-toolbar,[data-action]')) return;
            /* Skip media taps — those open the full-screen gallery instead */
            if(t.closest('img,video')) return;
            var card=t.closest&&t.closest('.property-card,.market-card,.listing-card');
            if(!card) return;
            /* Must be inside the marketplace section or a dashboard listing strip */
            var inMarket=card.closest('#marketplace,#property-grid-container,.dashboard-market-container,#dashboard-market-slider,.dashboard-market-card');
            /* property-card IS the marketplace card — accept it directly too */
            if(!inMarket&&!card.classList.contains('property-card')) return;
            if(_isGuest()){ if(typeof window.openAuthModal==='function') window.openAuthModal('login'); return; }
            var us=_us();
            var sid=card.dataset.sellerId||card.dataset.userId||'';
            if(!sid){ _notify('Navigate to Marketplace to see the full listing and contact the seller.','info'); return; }
            /* Don't navigate to your own profile via this card tap */
            if(sid===us.id){ _notify('This is your listing.','info'); return; }
            e.preventDefault(); e.stopPropagation();
            /* Open the seller's profile dashboard — no inbox/chat stopover. */
            if(typeof window._openSellerProfile==='function') window._openSellerProfile(sid);
            else _notify('Unable to open seller profile right now.','warning');
        });

        document.addEventListener('empyrean-init-done',function(){ setTimeout(_loadMarketStrip,600); setTimeout(_applyToolbars,1000); });
        document.addEventListener('empyrean-section-change',function(ev){ var sec=ev&&ev.detail&&ev.detail.section; if(sec==='dashboard') setTimeout(_loadMarketStrip,400); if(sec==='marketplace') setTimeout(_applyToolbars,300); });
        ready(function(){ setTimeout(_loadMarketStrip,1800); setTimeout(_applyToolbars,2200); });
        console.log('[§30] Marketplace — dashboard strip + contact/chat + owner toolbar.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §32  FEED PRIVACY + POST COMPOSER OWNERSHIP
            • Business-page feed: only the page OWNER can create posts.
              Visitors can read posts but cannot compose or upload media.
            • Own dashboard/personal feed: only you can post (composer is yours).
            • On navigating to another user's PROFILE page (business or personal),
              the post composer / create-post column is fully deactivated.
              Users cannot post on pages that are not their own — matching
              standard social platform behaviour (Facebook, Instagram, etc.).
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixFeedPrivacy(){

        /* CSS: hide every possible post-creation element for visitors */
        ready(function(){
            if(document.getElementById('_vf_feed_privacy_css')) return;
            var s=document.createElement('style'); s.id='_vf_feed_privacy_css';
            s.textContent=[
                /* ── Viewing ANOTHER user's profile: hide ALL composer UI ── */
                'body.viewing-other-profile #create-post-area,',
                'body.viewing-other-profile .create-post-card,',
                'body.viewing-other-profile #post-composer,',
                'body.viewing-other-profile .post-input-area,',
                'body.viewing-other-profile #create-post-form,',
                'body.viewing-other-profile .post-create-section,',
                'body.viewing-other-profile .new-post-composer,',
                'body.viewing-other-profile [id*="create-post"],',
                'body.viewing-other-profile [class*="post-composer"],',
                'body.viewing-other-profile [class*="create-post"],',
                'body.viewing-other-profile #quick-post-fab',
                '{display:none!important;}',
                /* ── On business page, visitor class hides all composer elements ── */
                'body.biz-visitor #business-post-form,',
                'body.biz-visitor #create-business-post-form,',
                'body.biz-visitor .business-post-composer,',
                'body.biz-visitor #biz-post-composer,',
                'body.biz-visitor [id*="biz-media-upload"],',
                'body.biz-visitor .biz-post-compose-area,',
                'body.biz-visitor .biz-create-post-row,',
                'body.biz-visitor #quick-post-fab',
                '{display:none!important;}',
            ].join('');
            document.head.appendChild(s);
        });

        /* Force-hide all post-creation DOM nodes for the current state */
        function _hideComposerDOM(){
            var COMPOSER_SELS=[
                '#create-post-area','.create-post-card','#post-composer',
                '.post-input-area','#create-post-form','.post-create-section',
                '.new-post-composer'
            ];
            COMPOSER_SELS.forEach(function(sel){
                document.querySelectorAll(sel).forEach(function(el){ el.style.setProperty('display','none','important'); });
            });
            /* Hide quick-post FAB */
            var fab=document.getElementById('quick-post-fab');
            if(fab) fab.style.display='none';
        }

        /* Restore composer visibility (own profile / dashboard) */
        function _showComposerDOM(){
            var COMPOSER_SELS=[
                '#create-post-area','.create-post-card','#post-composer',
                '.post-input-area','.post-create-section','.new-post-composer'
            ];
            COMPOSER_SELS.forEach(function(sel){
                document.querySelectorAll(sel).forEach(function(el){ el.style.removeProperty('display'); });
            });
            /* Restore quick-post FAB only if on dashboard */
            var fab=document.getElementById('quick-post-fab');
            var activeSection=document.querySelector('.content-section.active');
            var isDash=activeSection&&activeSection.id==='dashboard';
            if(fab) fab.style.display=(isDash&&!_isGuest())?'flex':'none';
        }

        function _applyFeedVisibility(){
            var us=_us();
            var bizId=window._activeBizPageId||'';
            var bizData=window._activeBizData||{};
            var activeSection=document.querySelector('.content-section.active');
            var activeSectionId=activeSection?activeSection.id:'';

            /* ── Business page: set owner/visitor body class ──
               FIX: added the businessPages[] fallback so this stays correct
               for any page beyond your first — us.businessPage (singular)
               only ever mirrors businessPages[0]. ownerId is still checked
               first and remains the primary, most reliable signal. */
            var myPages=(us.businessPages&&us.businessPages.length)?us.businessPages:(us.businessPage?[us.businessPage]:[]);
            var isOwner=_isAdmin()||(us.id&&bizData.ownerId&&bizData.ownerId===us.id)||(us.id&&myPages.some(function(pg){ return pg&&(pg.id===bizId||pg===bizId); }));
            if(activeSectionId==='business-page'&&bizId){
                document.body.classList.toggle('biz-visitor',!isOwner);
            } else {
                document.body.classList.remove('biz-visitor');
            }

            /* ── Profile page: detect if viewing another user's profile ── */
            var viewingOther=false;
            if(activeSectionId==='profile'){
                /* Check both the global flag AND confirm the viewed profile ≠ self */
                var viewedId=window._viewingProfileId||'';
                viewingOther=!!(viewedId&&us.id&&viewedId!==us.id);
                /* Also check if the profile section itself shows a different user */
                if(!viewingOther){
                    var profSec=document.getElementById('profile');
                    if(profSec){
                        var profUid=profSec.dataset.userId||profSec.dataset.uid||'';
                        if(profUid&&us.id&&profUid!==us.id) viewingOther=true;
                    }
                }
            }
            document.body.classList.toggle('viewing-other-profile',viewingOther);

            /* ── DOM enforcement ── */
            if(viewingOther){
                _hideComposerDOM();
            } else if(activeSectionId==='dashboard'||activeSectionId==='feed'){
                document.body.classList.remove('viewing-other-profile');
                _showComposerDOM();
            }

            /* Direct DOM enforcement for business page composer */
            var bizComposer=document.querySelector('#business-post-form,#create-business-post-form,.business-post-composer,#biz-post-composer');
            if(bizComposer) bizComposer.style.display=(activeSectionId==='business-page'&&bizId&&!isOwner)?'none':'';
        }

        document.addEventListener('empyrean-section-change',function(ev){
            if(!ev||!ev.detail) return;
            var sec=ev.detail.section;
            if(sec==='business-page'||sec==='profile') setTimeout(_applyFeedVisibility,350);
            if(sec==='dashboard'||sec==='feed'){
                /* Back on own feed — clear all visitor flags and restore composer */
                document.body.classList.remove('biz-visitor','viewing-other-profile');
                window._viewingOtherProfile=false;
                window._viewingProfileId='';
                setTimeout(_showComposerDOM,100);
            }
        });

        _wrapNavigateTo(function(id){
            if(id!=='business-page') document.body.classList.remove('biz-visitor');
            if(id==='dashboard'||id==='feed'){
                document.body.classList.remove('viewing-other-profile');
                window._viewingOtherProfile=false;
                window._viewingProfileId='';
            }
            setTimeout(_applyFeedVisibility,300);
        });

        /* Intercept profile-link clicks to reliably set viewingOther */
        document.addEventListener('click',function(e){
            var pa=e.target.closest&&e.target.closest('[data-profile-uid],[data-user-id].post-author,[data-user-id].contact-row,.post-author-link,.contact-row');
            if(!pa) return;
            var uid=pa.dataset.profileUid||pa.dataset.userId||'';
            var us=_us();
            if(uid&&us.id&&uid!==us.id){
                window._viewingOtherProfile=true;
                window._viewingProfileId=uid;
            }
        },true);

        document.addEventListener('empyrean-init-done',function(){ setTimeout(_applyFeedVisibility,1000); });
        ready(function(){ setTimeout(_applyFeedVisibility,2000); });
        console.log('[§32] Feed privacy — composer owner-only, biz-page visitor enforcement, profile post column deactivated for visitors.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §33  SOS DONATE BUTTON — persistent across re-renders and devices
            The donate button sometimes disappears after media upload or when
            app-sos.js re-renders feed cards. This section:
            A) Injects a donate button on any SOS card that is missing one.
            B) Watches feed-container for new SOS cards (MutationObserver).
            C) Runs periodic sweeps every 3 s while on the dashboard.
            D) Re-runs whenever the dashboard/feed section becomes active.
            The button is styled to always be conspicuous (red gradient, full-width).
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixSosDonateButton(){
        var BTN_HTML_TPL = function(userId, username){
            return '<button class="sos-donate-universal help-now-btn vf-sos-donate-btn"'
                +' data-sos-user-id="'+_esc(userId)+'" data-sos-username="'+_esc(username)+'"'
                +' style="width:100%;padding:12px 16px;background:linear-gradient(135deg,#EF4444,#B91C1C);'
                +'color:white;border:none;border-radius:12px;font-size:0.92rem;font-weight:700;'
                +'cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;'
                +'box-shadow:0 4px 14px rgba(239,68,68,0.4);margin:0;">'
                +'<i class="fas fa-hand-holding-heart"></i> Donate — Help '+_esc(username||'this cause')
                +'</button>';
        };

        function _ensureDonateBtn(card){
            if(!card) return;
            /* Only SOS request cards — never crisis-report cards */
            if(!card.classList.contains('sos-request')) return;
            if(card.classList.contains('crisis-report')) return;
            /* Check if a donate button already exists and is visible */
            var existing=card.querySelector('.help-now-btn,.donate-post-btn,.vf-sos-donate-btn,.sos-donate-universal');
            if(existing){
                /* Ensure it's always visible — force display in case it was hidden */
                existing.style.setProperty('display','flex','important');
                existing.style.setProperty('visibility','visible','important');
                existing.style.setProperty('opacity','1','important');
                return;
            }
            /* Inject missing donate button */
            var userId=card.dataset.userId||'', username=card.dataset.username||'this person';
            var wrap=document.createElement('div');
            wrap.className='vf-donate-wrap';
            wrap.style.cssText='padding:10px 16px 14px;';
            wrap.innerHTML=BTN_HTML_TPL(userId,username);
            /* Insert before comment section if present, else append */
            var commentSec=card.querySelector('.comment-section');
            if(commentSec) card.insertBefore(wrap,commentSec); else card.appendChild(wrap);
        }

        function _sweepFeedCards(){
            /* Repair all SOS cards on the page */
            document.querySelectorAll('.impact-story.sos-request').forEach(_ensureDonateBtn);
            /* Remove any donate button from crisis cards (insurance) */
            document.querySelectorAll('.impact-story.crisis-report .donate-post-btn,.impact-story.crisis-report .vf-sos-donate-btn,.impact-story.crisis-report .sos-donate-universal').forEach(function(btn){
                var wrap=btn.parentElement; if(wrap&&wrap.classList.contains('vf-donate-wrap')) wrap.remove(); else btn.remove();
            });
        }

        /* CSS: ensure donate button is always visible inside SOS cards */
        ready(function(){
            if(document.getElementById('_vf_sos_donate_css')) return;
            var s=document.createElement('style'); s.id='_vf_sos_donate_css';
            s.textContent=[
                '.impact-story.sos-request .help-now-btn,',
                '.impact-story.sos-request .donate-post-btn,',
                '.impact-story.sos-request .vf-sos-donate-btn{',
                '  display:flex!important;visibility:visible!important;opacity:1!important;',
                '  width:100%!important;flex-shrink:0!important;',
                '}',
                '.vf-donate-wrap{padding:10px 16px 14px!important;}',
            ].join('');
            document.head.appendChild(s);
        });

        /* MutationObserver: watch for new SOS cards added to the feed */
        function _attachFeedObserver(){
            var feed=document.getElementById('feed-container')||document.getElementById('posts-feed');
            if(!feed||feed._vfSosObs) return;
            feed._vfSosObs=true;
            new MutationObserver(function(muts){
                muts.forEach(function(m){
                    m.addedNodes.forEach(function(n){
                        if(n.nodeType!==1) return;
                        if(n.classList&&n.classList.contains('sos-request')) _ensureDonateBtn(n);
                        /* Check children too */
                        n.querySelectorAll&&n.querySelectorAll('.impact-story.sos-request').forEach(_ensureDonateBtn);
                    });
                    /* Also re-check existing cards in case inner DOM changed */
                    m.target.querySelectorAll&&m.target.querySelectorAll('.impact-story.sos-request').forEach(_ensureDonateBtn);
                });
            }).observe(feed,{childList:true,subtree:true});
        }

        /* Periodic sweep while app is running */
        var _sweepTimer=null;
        function _startSweeper(){
            if(_sweepTimer) return;
            _sweepTimer=setInterval(_sweepFeedCards,3000);
        }

        /* Also re-sweep after any SOS upload completes */
        var _origSubmitSos=window.submitSosRequest;
        window.submitSosRequest=async function(){
            var r=(typeof _origSubmitSos==='function')?await _origSubmitSos.apply(this,arguments):undefined;
            setTimeout(_sweepFeedCards,500);
            setTimeout(_sweepFeedCards,1500);
            setTimeout(_sweepFeedCards,3000);
            return r;
        };

        /* Wire up delegate click so buttons injected by this fix also trigger the donation modal */
        document.addEventListener('click',function(e){
            var btn=e.target.closest&&e.target.closest('.vf-sos-donate-btn');
            if(!btn) return;
            /* Delegate to the existing donate flow if available */
            var userId=btn.dataset.sosUserId||'', username=btn.dataset.sosUsername||'';
            if(typeof window._openDonateSosModal==='function'){ window._openDonateSosModal(userId,username); return; }
            /* Try the standard donate modal by simulating a click on a standard help-now-btn */
            var card=btn.closest('.impact-story'); if(!card) return;
            var stdBtn=card.querySelector('.help-now-btn:not(.vf-sos-donate-btn)');
            if(stdBtn){ stdBtn.click(); return; }
            /* Fallback: open sos-donation-modal directly */
            var modal=document.getElementById('sos-donation-modal'); if(!modal) return;
            var titleEl=document.getElementById('donation-modal-title'); if(titleEl) titleEl.textContent='Donate to '+username;
            modal.style.display='flex'; modal.classList.add('show'); document.body.classList.add('modal-open');
        });

        ready(function(){
            _sweepFeedCards();
            _attachFeedObserver();
            _startSweeper();
            setTimeout(_sweepFeedCards,1500);
            setTimeout(_sweepFeedCards,4000);
        });
        document.addEventListener('empyrean-init-done',function(){ setTimeout(_sweepFeedCards,600); setTimeout(_attachFeedObserver,400); _startSweeper(); });
        document.addEventListener('empyrean-section-change',function(ev){ if(ev&&ev.detail&&(ev.detail.section==='dashboard'||ev.detail.section==='feed'||ev.detail.section==='request-help')) setTimeout(_sweepFeedCards,400); });
        /* Re-sweep after Firestore SOS listener fires */
        document.addEventListener('empyrean-sos-updated',function(){ setTimeout(_sweepFeedCards,300); });
        console.log('[§33] SOS donate button persistence — MutationObserver + periodic sweep + CSS enforcement.');
    })();




    /* ═══════════════════════════════════════════════════════════════════════
       §34  POST THREAD VIEW — moved to app-patch-v2.js
       §35  MARKETPLACE contact tab — moved to app-patch-v2.js
       §36  MESSAGES composer/call — moved to app-patch-v2.js
       All three sections have been removed from this file to avoid conflicts
       with the corrected implementations in app-patch-v2.js which loads after
       this file. app-patch-v2.js must be present in index.html after this script.
    ═══════════════════════════════════════════════════════════════════════ */


    /* ═══════════════════════════════════════════════════════════════════════
       §37  DASHBOARD BUSINESS SECTION — fix mismatched container IDs
            app-business.js renderDashboardBusinesses() targets
            #dashboard-business-container / #dashboard-business-slider but
            index.html has #dashboard-bizposts-container / #dashboard-bizposts-slider.
            This alias bridge ensures the function finds its target on every env.
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixDashboardBizContainerIds() {
        /* §37 — Alias bridge for the two ID sets.
           #dashboard-bizposts-slider  (real, in index.html) — receives PRODUCT/POST cards
                                        from app-business.js §10 _upsertProductCard().
           #dashboard-business-slider  (alias, hidden)       — receives PAGE cards from
                                        renderDashboardBusinesses(); kept off-screen so the
                                        function finds its target without injecting page-level
                                        cards into the product timeline.

           FIX: We intentionally do NOT migrate cards from the alias slider to the real slider.
           Product cards and page cards are separate UI concerns. Mixing them caused blank-looking
           "View Page" cards to appear alongside product cards in the Business Posts strip. */
        function _bridge() {
            var realContainer = document.getElementById('dashboard-bizposts-container');
            var realSlider    = document.getElementById('dashboard-bizposts-slider');
            if (!realContainer || !realSlider) return;

            /* Invisible alias elements so renderDashboardBusinesses() doesn't error */
            if (!document.getElementById('dashboard-business-container')) {
                var ac = document.createElement('div');
                ac.id = 'dashboard-business-container';
                ac.style.cssText = 'display:none!important;width:0;height:0;overflow:hidden;position:absolute;pointer-events:none;';
                document.body.appendChild(ac);
            }
            if (!document.getElementById('dashboard-business-slider')) {
                var as_ = document.createElement('div');
                as_.id = 'dashboard-business-slider';
                as_.style.cssText = 'display:none!important;width:0;height:0;overflow:hidden;position:absolute;pointer-events:none;';
                document.body.appendChild(as_);
            }

            realContainer.style.display = 'block';
        }

        ready(function() { setTimeout(_bridge, 400); setTimeout(_bridge, 1500); });
        document.addEventListener('empyrean-init-done', function() { setTimeout(_bridge, 500); });
        console.log('[§37] Dashboard biz container ID bridge — alias sliders kept hidden, product cards stay in real slider only.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §38  ADMIN DISBURSEMENT — define missing window functions
            _selectDisbMethod / _adminDisbRecipChange / _adminDisbModeChange
            are called by inline onclick in index.html but never defined in
            any JS file. This section defines them universally.
            The crypto wallet fields (EMPY/USDT/BNB/BTC) already exist in
            index.html; this just wires their show/hide toggling correctly.
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixAdminDisbursementFunctions() {

        /* ── _selectDisbMethod(method) ─────────────────────────────────────
           Shows the correct address/field sub-panel for the chosen method.
           Saves the selection to window._currentDisbMethod so
           _adminInitiateDisbursement (in app-admin.js) can read it.        */
        window._selectDisbMethod = window._selectDisbMethod || function(method) {
            window._currentDisbMethod = method;

            /* All known method sub-panel IDs */
            var panels = ['disb-method-bank','disb-method-empy','disb-method-usdt','disb-method-bnb','disb-method-btc'];
            panels.forEach(function(pid) {
                var el = document.getElementById(pid);
                if (el) el.style.display = 'none';
            });

            /* Show the selected panel */
            var active = document.getElementById('disb-method-' + method);
            if (active) active.style.display = 'block';

            /* Update button active styles */
            var tabContainer = document.getElementById('disb-method-tabs');
            if (tabContainer) {
                tabContainer.querySelectorAll('button[data-method]').forEach(function(btn) {
                    var isActive = btn.dataset.method === method;
                    btn.style.background = isActive ? '#0A0E27' : 'white';
                    btn.style.color      = isActive ? 'white'   : '#0A0E27';
                    btn.style.borderColor = isActive ? '#0A0E27' : 'rgba(10,14,39,0.15)';
                });
            }
        };

        /* ── _adminDisbRecipChange() ────────────────────────────────────────
           Toggles between NGO panel and Individual panel based on the
           selected radio button.                                             */
        window._adminDisbRecipChange = window._adminDisbRecipChange || function() {
            var radios = document.querySelectorAll('input[name="disb-recip-type"]');
            var selected = '';
            radios.forEach(function(r) { if (r.checked) selected = r.value; });

            var ngoPanel  = document.getElementById('disb-ngo-panel');
            var indPanel  = document.getElementById('disb-individual-panel');

            if (ngoPanel)  ngoPanel.style.display  = (selected === 'ngo')        ? 'block' : 'none';
            if (indPanel)  indPanel.style.display   = (selected === 'individual') ? 'block' : 'none';

            /* When switching to individual, default to bank transfer tab */
            if (selected === 'individual') {
                /* Ensure §19's wallet type selector is injected if present */
                var p = document.getElementById('disb-individual-panel');
                if (p) p._vfCryptoPatch = false;
                setTimeout(function() {
                    /* Default to bank tab */
                    if (typeof window._selectDisbMethod === 'function') {
                        window._selectDisbMethod('bank');
                    }
                }, 80);
            }
        };

        /* ── _adminDisbModeChange() ─────────────────────────────────────────
           Shows/hides the crypto token selector row based on Fiat vs Crypto. */
        window._adminDisbModeChange = window._adminDisbModeChange || function() {
            var modeSelect  = document.getElementById('disb-mode');
            var cryptoRow   = document.getElementById('disb-crypto-row');
            if (!modeSelect || !cryptoRow) return;
            var isCrypto = modeSelect.value === 'crypto';
            cryptoRow.style.display = isCrypto ? 'block' : 'none';
        };

        /* Wire up on DOM ready — handles cases where the panel is already rendered */
        ready(function() {
            /* Default: bank transfer selected */
            setTimeout(function() {
                if (typeof window._selectDisbMethod === 'function') {
                    window._selectDisbMethod('bank');
                }
            }, 600);

            /* Wire radio changes if not already done by inline handlers */
            document.querySelectorAll('input[name="disb-recip-type"]').forEach(function(radio) {
                if (!radio._disbWired) {
                    radio._disbWired = true;
                    radio.addEventListener('change', function() {
                        if (typeof window._adminDisbRecipChange === 'function') window._adminDisbRecipChange();
                    });
                }
            });

            var modeSelect = document.getElementById('disb-mode');
            if (modeSelect && !modeSelect._disbWired) {
                modeSelect._disbWired = true;
                modeSelect.addEventListener('change', function() {
                    if (typeof window._adminDisbModeChange === 'function') window._adminDisbModeChange();
                });
            }
        });

        /* Re-wire whenever admin tab is activated */
        document.addEventListener('click', function(e) {
            var t = e.target;
            if (t && t.closest && (t.closest('[data-tab="admin-disburse-tab"]') || (t.dataset && t.dataset.tab === 'admin-disburse-tab'))) {
                setTimeout(function() {
                    if (typeof window._selectDisbMethod === 'function') window._selectDisbMethod(window._currentDisbMethod || 'bank');
                    document.querySelectorAll('input[name="disb-recip-type"]').forEach(function(radio) {
                        if (!radio._disbWired) {
                            radio._disbWired = true;
                            radio.addEventListener('change', function() {
                                if (typeof window._adminDisbRecipChange === 'function') window._adminDisbRecipChange();
                            });
                        }
                    });
                }, 300);
            }
        });

        console.log('[§38] Admin disbursement functions defined — _selectDisbMethod / _adminDisbRecipChange / _adminDisbModeChange.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §39  BUSINESS PAGE — stop app-patch-v2.js from overriding app-business.js
            app-patch-v2.js redefines window.renderBusinessPage AFTER
            app-business.js, replacing the full rich renderer with a stripped
            version that shows blank content when _activeBizData is unset.
            This section runs LAST (after both files) and restores the correct
            renderer, bridging _activeBizData → _viewingBizPage so both
            click-handler systems stay consistent.
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixBusinessPageRenderer() {
        function _restore() {
            /* Guard: run once; the _vfBizFixed flag prevents re-wrapping */

            /* The app-business.js version is exposed as window.renderBusinessPage by
               app-business.js itself. app-patch-v2.js overwrites it afterwards.
               We wrap the current window.renderBusinessPage so that:
               1) _activeBizData / _activeBizPageId from app-fix-final.js click handlers
                  are synced into _viewingBizPage which app-business.js reads.
               2) If page data exists, always prefer the rich app-business.js renderer. */

            if (window.renderBusinessPage && window.renderBusinessPage._vfBizFixed) return;

            var _pv2Version = window.renderBusinessPage; /* the app-patch-v2 version */

            window.renderBusinessPage = function(bizId) {
                /* Sync _activeBizData → _viewingBizPage */
                if (window._activeBizData && !window._viewingBizPage) {
                    window._viewingBizPage = window._activeBizData;
                }
                if (window._activeBizData && window._viewingBizPage !== window._activeBizData) {
                    /* If a specific bizId was passed and matches _activeBizData, use it */
                    if (!bizId || window._activeBizData.id === bizId) {
                        window._viewingBizPage = window._activeBizData;
                    }
                }

                /* Route through the app-patch-v2 version (which does the Firestore lookup)
                   but with _activeBizData / _viewingBizPage pre-populated for it */
                /* Re-read it fresh — app-business.js exports it as window.renderBusinessPage
                   but we just overwrote that. Call the module's internal version via the
                   alias it set before app-patch-v2 ran.                                     */
                var sec = document.getElementById('business-page');
                if (!sec) return;

                /* Determine what page to render */
                var us    = (window.EmpState && window.EmpState.userState) || window.userState || {};
                var biz   = window._viewingBizPage || window._activeBizData || us.businessPage;
                var id    = bizId || (biz && biz.id) || window._activeBizPageId || '';

                /* If we have data, render the RICH app-business.js version
                   (window._appBizRenderer) — this is the renderer that
                   includes the working "Edit Page" button + _wireEditPageBtn.
                   The app-patch-v2 (_pv2Version) renderer has no edit button
                   at all, so calling it here was the cause of "Edit Page"
                   appearing to do nothing. */
                if (biz && (biz.name || biz.businessName)) {
                    window._activeBizData = biz;
                    if (typeof window._appBizRenderer === 'function') {
                        try { window._appBizRenderer.call(this, id || biz.id); return; } catch(e2) {}
                    }
                    if (typeof _pv2Version === 'function') {
                        try { _pv2Version.call(this, id || biz.id); } catch(e2b) {}
                    }
                    return;
                }

                /* No data: Firestore fetch — prefer the rich renderer too,
                   it handles its own Firestore lookup and includes the
                   Edit Page button once data resolves. */
                if (id && typeof window._appBizRenderer === 'function') {
                    try { window._appBizRenderer.call(this, id); return; } catch(e3a) {}
                }
                if (id && typeof _pv2Version === 'function') {
                    try { _pv2Version.call(this, id); } catch(e3) {}
                    return;
                }

                /* Final fallback: show create-page prompt */
                sec.innerHTML =
                    '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;padding:40px 20px;text-align:center;">' +
                    '<div style="width:90px;height:90px;border-radius:50%;background:linear-gradient(135deg,#0A0E27,#1B2B8B);display:flex;align-items:center;justify-content:center;margin-bottom:24px;box-shadow:0 8px 32px rgba(27,43,139,0.25);">' +
                    '<i class="fas fa-briefcase" style="font-size:2rem;color:#F5C518;"></i></div>' +
                    '<h2 style="font-family:Syne,sans-serif;font-weight:800;color:#0A0E27;margin:0 0 12px;">Create Your Business Page</h2>' +
                    '<p style="color:#6B7280;font-size:0.95rem;max-width:380px;line-height:1.6;margin:0 0 28px;">Showcase your organisation, post updates, and connect with the Empyrean community.</p>' +
                    '<button id="open-create-biz-page-btn" class="btn btn-accent" style="padding:14px 36px;border-radius:50px;font-size:1rem;font-weight:700;background:linear-gradient(135deg,#0A0E27,#1B2B8B);color:white;border:none;cursor:pointer;box-shadow:0 6px 20px rgba(27,43,139,0.3);">' +
                    '<i class="fas fa-plus"></i> Create Business Page</button></div>';
                var openBtn = document.getElementById('open-create-biz-page-btn');
                if (openBtn && !openBtn._bizWired) {
                    openBtn._bizWired = true;
                    openBtn.addEventListener('click', function() {
                        var modal = document.getElementById('create-business-page-modal');
                        if (modal) { modal.classList.add('show'); document.body.classList.add('modal-open'); }
                    });
                }
            };
            window.renderBusinessPage._vfBizFixed = true;
        }

        /* Run after all modules (including app-patch-v2.js) have loaded */
        if (document.readyState !== 'loading') {
            setTimeout(_restore, 200);
            setTimeout(_restore, 800);
        } else {
            document.addEventListener('DOMContentLoaded', function() {
                setTimeout(_restore, 200);
                setTimeout(_restore, 800);
            });
        }
        document.addEventListener('empyrean-init-done', function() { setTimeout(_restore, 300); });
        /* Also restore whenever navigating to business-page */
        document.addEventListener('empyrean-section-change', function(ev) {
            if (ev && ev.detail && ev.detail.section === 'business-page') {
                if (!window.renderBusinessPage || !window.renderBusinessPage._vfBizFixed) _restore();
            }
        });
        console.log('[§39] Business page renderer — anti-override bridge (app-business.js takes precedence over app-patch-v2.js).');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §40  MODAL EXIT BUTTONS — ind-acct-modal and ngo-application-modal
            Both modals use inline onclick to close but never remove
            document.body classList 'modal-open', trapping scroll.
            Also: ind-acct-modal re-uses an existing hidden instance
            but its close button only does style.display='none' without
            cleaning up body state.
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixModalExitButtons() {

        /* Central close helper — removes the modal and cleans up body state */
        function _closeModal(modalId, removeEl) {
            var m = document.getElementById(modalId);
            if (!m) return;
            if (removeEl) {
                m.remove();
            } else {
                m.style.display = 'none';
            }
            /* Always clean up body */
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
        }

        /* Expose as global so inline onclick handlers can call it */
        window._closeEmpModal = function(modalId) { _closeModal(modalId, false); };
        window._removeEmpModal = function(modalId) { _closeModal(modalId, true); };

        /* Delegate handler for modal close buttons that use our helper classes */
        document.addEventListener('click', function(e) {
            var t = e.target;
            if (!t) return;

            /* Close on clicking the backdrop overlay of dynamically created modals */
            if (t.id === 'ind-acct-modal') {
                _closeModal('ind-acct-modal', false);
                return;
            }
            if (t.id === 'ngo-application-modal') {
                _closeModal('ngo-application-modal', true);
                return;
            }
            if (t.id === 'individual-grant-modal') {
                _closeModal('individual-grant-modal', true);
                return;
            }

            /* Patch the X close buttons — detect them by proximity to known modals */
            var btn = t.closest ? t.closest('button') : null;
            if (!btn) return;

            /* ind-acct-modal close button (uses inline onclick style.display=none) */
            var indModal = btn.closest('#ind-acct-modal');
            if (indModal) {
                /* If the button's onclick hides the modal, also clean body */
                var onclickStr = btn.getAttribute('onclick') || '';
                if (onclickStr.indexOf('ind-acct-modal') !== -1 && onclickStr.indexOf('none') !== -1) {
                    setTimeout(function() { document.body.classList.remove('modal-open'); document.body.style.overflow = ''; }, 50);
                }
                return;
            }

            /* ngo-application-modal X button */
            var ngoModal = btn.closest('#ngo-application-modal');
            if (ngoModal) {
                var onclickStrNgo = btn.getAttribute('onclick') || '';
                if (onclickStrNgo.indexOf('ngo-application-modal') !== -1) {
                    setTimeout(function() { document.body.classList.remove('modal-open'); document.body.style.overflow = ''; }, 50);
                }
                return;
            }

            /* individual-grant-modal X button */
            var grantModal = btn.closest('#individual-grant-modal');
            if (grantModal) {
                var onclickStrGrant = btn.getAttribute('onclick') || '';
                if (onclickStrGrant.indexOf('individual-grant-modal') !== -1) {
                    setTimeout(function() { document.body.classList.remove('modal-open'); document.body.style.overflow = ''; }, 50);
                }
                return;
            }
        }, true /* capture phase so it fires before inline onclick */);

        /* Patch openIndividualAccountForm so its close button properly cleans body */
        var _origOpenIndAcct = window.openIndividualAccountForm;
        window.openIndividualAccountForm = function() {
            if (typeof _origOpenIndAcct === 'function') _origOpenIndAcct.apply(this, arguments);
            /* After the modal is created, upgrade its close buttons */
            setTimeout(function() {
                var m = document.getElementById('ind-acct-modal');
                if (!m) return;
                /* Find all close/cancel buttons and add cleanup */
                m.querySelectorAll('button').forEach(function(btn) {
                    var oc = btn.getAttribute('onclick') || '';
                    if ((oc.indexOf('ind-acct-modal') !== -1 && oc.indexOf('none') !== -1) || btn.textContent.trim() === 'Cancel') {
                        if (!btn._exitPatched) {
                            btn._exitPatched = true;
                            btn.addEventListener('click', function() {
                                setTimeout(function() {
                                    document.body.classList.remove('modal-open');
                                    document.body.style.overflow = '';
                                }, 30);
                            });
                        }
                    }
                });
            }, 100);
        };

        /* Patch openNgoApplicationModal similarly */
        var _origOpenNgoModal = window.openNgoApplicationModal;
        window.openNgoApplicationModal = function() {
            if (typeof _origOpenNgoModal === 'function') _origOpenNgoModal.apply(this, arguments);
            setTimeout(function() {
                var m = document.getElementById('ngo-application-modal');
                if (!m) return;
                m.querySelectorAll('button').forEach(function(btn) {
                    var oc = btn.getAttribute('onclick') || '';
                    if (oc.indexOf('ngo-application-modal') !== -1 || btn.textContent.trim() === 'Cancel') {
                        if (!btn._exitPatched) {
                            btn._exitPatched = true;
                            btn.addEventListener('click', function() {
                                setTimeout(function() {
                                    document.body.classList.remove('modal-open');
                                    document.body.style.overflow = '';
                                }, 30);
                            });
                        }
                    }
                });
            }, 100);
        };

        console.log('[§40] Modal exit buttons patched — ind-acct-modal + ngo-application-modal body.modal-open cleanup.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §41  MESSAGE / MEDIA UPLOAD — cross-environment persistence
            Ensures typed messages AND file attachments save to Firestore
            in a single canonical collection ('chats/{chatId}/messages')
            that both the sender's and recipient's listeners can read.
            Also patches the send flow in app-patch-v2.js §P2 so that
            media uploads use the configured Cloudinary preset (not
            hard-coded 'Empyrean_preset') and always resolve the cloud URL
            before sending.
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixMessageUploadPersist() {

        /* ── Chat attachment upload helper ──
           FIX (dev note — "we are currently using firebase backend
           storage and not cloudinary"): this used to post every chat
           attachment straight to Cloudinary's REST API. Routes through
           window.uploadToCloudinary (app-dom.js — already Firebase
           Storage-backed) instead, same as the business-media uploader
           above, with the same direct-Storage fallback if that shared
           function isn't loaded yet. */
        function _uploadFileToCloud(file) {
            return new Promise(function(resolve, reject) {
                if (typeof window.uploadToCloudinary === 'function') {
                    window.uploadToCloudinary(file).then(resolve).catch(reject);
                    return;
                }
                if (!window.fbStorage || typeof window.fbStorage.ref !== 'function') { reject(new Error('Firebase Storage is not available yet — please try again in a moment.')); return; }
                var _owner = (window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid) || 'anon';
                var _name  = String((file && file.name) || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
                var path   = 'uploads/' + _owner + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + _name;
                window.fbStorage.ref().child(path).put(file, { contentType: file.type || 'application/octet-stream' })
                    .then(function(snap){ return snap.ref.getDownloadURL(); })
                    .then(resolve).catch(reject);
            });
        }

        /* ── Canonical Firestore message writer ── */
        function _persistMessage(peerId, text, mediaUrls) {
            if (!_fbOk()) return;
            var u      = _us();
            var chatId = [u.id, peerId].sort().join('_');
            var msgDoc = {
                text:         text || '',
                media:        mediaUrls || [],
                senderId:     u.id || '',
                senderName:   u.fullName || u.username || 'User',
                senderAvatar: u.avatar || u.profilePhoto || '',
                receiverId:   peerId,
                chatId:       chatId,
                createdAt:    new Date(),
                read:         false
            };
            try {
                /* Primary: subcollection that onSnapshot listeners watch */
                window.fbDb.collection('chats').doc(chatId).collection('messages').add(msgDoc)
                    .catch(function(e) { console.warn('[§41] msg subcollection save failed:', e && e.message); });

                /* Chat metadata */
                var lastText = text || (mediaUrls && mediaUrls.length ? '[media]' : '');
                window.fbDb.collection('chats').doc(chatId).set({
                    participants:    [u.id, peerId],
                    lastMessage:     lastText,
                    lastMessageTime: new Date(),
                    lastSenderId:    u.id
                }, { merge: true }).catch(function() {});

            } catch(e) { console.warn('[§41] _persistMessage error:', e && e.message); }
        }

        /* ── Wrap window.sendMessage (defined by app-fixes or app-nav) ── */
        function _wrapSendMessage() {
            if (window.sendMessage && window.sendMessage._vfPersistWrap) return;
            var _orig = window.sendMessage;
            window.sendMessage = function(peerId, text, extras) {
                /* UPGRADE: guests must sign up before sending any message. */
                if (!(window.fbAuth && window.fbAuth.currentUser) && !(window.EmpState && window.EmpState.isGuest === false) && window.isGuest !== false) {
                    if (typeof window._empRedirectGuestToSignup === 'function') window._empRedirectGuestToSignup('send messages');
                    return;
                }
                /* Call the original first */
                var result;
                if (typeof _orig === 'function') {
                    try { result = _orig.apply(this, arguments); } catch(e) {}
                }
                /* Ensure persistence regardless of whether original saved */
                if (peerId && (text || (extras && extras.audioUrl))) {
                    var mediaUrls = (extras && extras.audioUrl) ? [extras.audioUrl] : [];
                    _persistMessage(peerId, text, mediaUrls);
                }
                return result;
            };
            window.sendMessage._vfPersistWrap = true;
        }

        /* ── Patch the message form submit to upload media before sending ── */
        function _patchMessageForm() {
            var form = document.getElementById('message-form');
            if (!form || form._vfUploadPatch) return;
            form._vfUploadPatch = true;

            form.addEventListener('submit', function(e) {
                /* If there are pending files in the vf-msg-preview area, upload them first */
                var preview = document.getElementById('vf-msg-preview') || document.getElementById('message-media-preview');
                if (!preview) return;
                var imgs = preview.querySelectorAll('img[data-pending-file],video[data-pending-file]');
                if (!imgs.length) return;

                /* The files are stored as data-pending-file object URLs; we need the raw File refs */
                /* app-patch-v2.js stores them in _pendingFiles array on the window */
                var files = window._pendingFiles || [];
                if (!files.length) return;

                e.preventDefault();
                e.stopImmediatePropagation();

                var inp = document.getElementById('message-text-input') || document.getElementById('vf-msg-input');
                var text = inp ? (inp.value || '').trim() : '';
                var peerId = window._activePeerId || '';

                Promise.all(files.map(function(f) {
                    return _uploadFileToCloud(f).catch(function() { return ''; });
                })).then(function(urls) {
                    var validUrls = urls.filter(Boolean);
                    if (typeof window.sendMessage === 'function') {
                        window.sendMessage(peerId, text, { mediaUrls: validUrls });
                    } else {
                        _persistMessage(peerId, text, validUrls);
                    }
                    /* Clear */
                    if (inp) { inp.value = ''; inp.style.height = 'auto'; }
                    window._pendingFiles = [];
                    if (preview) { preview.innerHTML = ''; preview.classList.remove('has-files'); }
                    _notify('Message sent!', 'success');
                }).catch(function(err) {
                    _notify('Upload failed: ' + (err.message || 'try again'), 'error');
                });
            }, true /* capture so we intercept before app-patch-v2 submit handler */);
        }

        ready(function() {
            _wrapSendMessage();
            setTimeout(_wrapSendMessage, 1000);
            _patchMessageForm();
            setTimeout(_patchMessageForm, 1500);
        });
        document.addEventListener('empyrean-init-done', function() {
            _wrapSendMessage();
            setTimeout(_patchMessageForm, 400);
        });
        /* Re-patch when messages section activates */
        document.addEventListener('empyrean-section-change', function(ev) {
            if (ev && ev.detail && ev.detail.section === 'messages') {
                setTimeout(function() { _wrapSendMessage(); _patchMessageForm(); }, 300);
            }
        });
        console.log('[§41] Message upload + Firestore persistence patch applied.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §42  CONFLICT AUDIT — suppress known overwrite side-effects
            app-fix-final.js §14 wraps window.renderDashboardBusinesses
            which app-business.js defines. The wrapper calls the original
            then enforces scroll styles. This is safe.
            app-patch-v2.js §P6 defines window.renderBusinessPage last —
            §39 above already fixes this by restoring the correct bridge.
            This section logs the final state of critical window functions
            so the console shows exactly which version is active.
    ═══════════════════════════════════════════════════════════════════════ */
    (function auditCriticalFunctions() {
        setTimeout(function() {
            var checks = [
                'renderBusinessPage',
                'renderDashboardBusinesses',
                'sendMessage',
                '_selectDisbMethod',
                '_adminDisbRecipChange',
                '_adminDisbModeChange',
                'openIndividualAccountForm',
                'openNgoApplicationModal',
                'navigateTo',
                'renderStatusBar',
                'openChat',
                'renderContactList',
                '_openStatusViewer'
            ];
            var report = checks.map(function(fn) {
                return fn + ':' + (typeof window[fn] === 'function' ? '✓' : '✗MISSING');
            }).join(' | ');
            console.log('[§42 Audit]', report);
        }, 2500);
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §43  IMPACT MINING — Twitter/X-style interactions  [v3 — moved to
            app-impactmining.js]
       ─────────────────────────────────────────────────────────────────────
       This section used to contain its own complete reward engine (rate
       table, per-action daily caps, session dedup guard, balance mutation,
       Firestore persistence). That has all been MOVED to app-impactmining.js
       (§1/§2 there), which is now the single canonical reward engine for the
       whole app — see that file's rate table for current EMPY amounts and
       daily caps per action.

       What's left here is purely DOM click-detection: mapping clicks on the
       thread view's action bar, comment likes/retweets/shares, reply/
       sub-reply composers, etc. to an action name + dedup key, which gets
       handed to window.rewardUserForAction() (aliased below as _awardEMPY /
       window._rewardUser / window._awardImpactMining for backward
       compatibility with existing call sites in §6, §45, and
       app-patch-v2.js — none of them needed to change).
    ═══════════════════════════════════════════════════════════════════════ */
    (function impactMiningEngine() {

        /* MOVED (2026-07): the rate table, per-action daily caps, session
           dedup guard, wallet-sync, and balance/Firestore-write logic that
           used to live here have all been moved into app-impactmining.js,
           which is now the single canonical reward engine (see that file's
           §1/§2). This was previously a second, independent implementation
           running in parallel with app-fixes.js's own private copy AND with
           app-impactmining.js (which wasn't even loaded via <script> until
           now) — three engines that could each evaluate the same click
           differently, which is why rewards fired unpredictably and
           earnings didn't reliably go up. Everything below this point is
           now just DOM click-detection: it maps a click to an action name
           + a dedup key and hands it to the canonical module. */

        function _awardEMPY(actionType, targetId) {
            if (typeof window.rewardUserForAction === 'function') {
                window.rewardUserForAction(actionType, null, targetId || '');
            }
        }

        /* ── Expose globally ─────────────────────────────────────────────
           window._rewardUser  → called by §6 _reward() wrapper for reels
           window._awardImpactMining → direct external calls (§45's like/
           share handlers) — both are now thin pass-throughs; the real
           implementation lives in app-impactmining.js and is also directly
           reachable as window.rewardUserForAction / window._rewardUser /
           window._awardImpactMining from there. Kept here too so nothing
           needs to change at any existing call site.               */
        window._rewardUser        = function(actionType, targetId) { _awardEMPY(actionType, targetId || ''); };
        window._awardImpactMining = _awardEMPY;

        /* ══════════════════════════════════════════════════════════════════
           Capture-phase delegation — fires before any bubble-phase
           stopPropagation() in existing handlers.
           BUG FIX v3: toggle direction detected BEFORE the button's own
           handler flips the class (capture fires first), which is correct.
           The selectors now also cover the comment-btn (opens thread) so
           the comment action itself awards REPLY_POST via _sendReply wrap.
        ══════════════════════════════════════════════════════════════════ */
        document.addEventListener('click', function(e) {
            var t = e.target;
            if (!t || !t.closest) return;

            /* ── 1. Thread post action bar (app-patch-v2.js #vf-th-post-actions) ── */
            var postActionBtn = t.closest('#vf-th-post-actions .vf-th-act-btn');
            if (postActionBtn) {
                var action = postActionBtn.dataset.action || '';
                var postId = window._activePostId || '';
                if (action === 'like' && !postActionBtn.classList.contains('liked')) {
                    _awardEMPY('LIKE_POST', postId || ('lp-' + Date.now()));
                } else if (action === 'retweet' && !postActionBtn.classList.contains('retweeted')) {
                    _awardEMPY('RETWEET_POST', postId || ('rp-' + Date.now()));
                } else if (action === 'share') {
                    _awardEMPY('SHARE_POST', 'share-' + (postId || Date.now()));
                }
                /* quote awarded at submit time via _submitQuote wrap */
                return;
            }

            /* ── 2. Feed card like button (.action-btn.like-btn) — SUPERSEDED
               (bug: "[EmpImpact] Possible duplicate reward trigger for
               LIKE_POST ... fired twice ... from two different call
               sites"): this branch pre-emptively awarded LIKE_POST the
               moment this CAPTURE-phase listener saw an unliked
               .impact-story like button, purely from the "not yet liked"
               class check — no toggle, no Firestore write, just the
               reward call. The §45 LIKE HANDLER further down this same
               file (search "── LIKE HANDLER ──") independently does the
               REAL work for the exact same button — toggle, Firestore
               write, AND its own LIKE_POST award — since §45 only skips
               reel cards and thread-post-action-bar buttons (see its own
               two early returns), never .impact-story. Both listeners are
               registered on document in capture phase, this one first, so
               every .impact-story like tap fired BOTH: this branch's
               preflight award, then §45's real one a moment later — two
               calls, two rewards, for one tap. §45 is the complete,
               correct owner (it has the actual liked/unliked state after
               its own toggle, not a guess from before); this preflight
               duplicate is retired rather than removed outright, per this
               file's own "supersede, don't delete" precedent (see the
               SHARE branch above). Thread-post likes (branch 1, above)
               and reel likes (§6) are untouched — §45 already excludes
               both of those itself, so removing THIS branch closes the
               double-reward without leaving any card unrewarded. */
            if (false) {
                var feedLikeBtn = t.closest('.action-btn.like-btn');
                if (feedLikeBtn && feedLikeBtn.closest('.impact-story')) {
                    if (!feedLikeBtn.classList.contains('liked') && !feedLikeBtn.classList.contains('active')) {
                        var card = feedLikeBtn.closest('.impact-story');
                        var pid  = card ? (card.dataset.postId || '') : '';
                        _awardEMPY('LIKE_POST', pid || ('fl-' + Date.now()));
                    }
                    return;
                }
            }

            /* ── 3. Feed retweet button (.action-btn.retweet-btn) ──
               FIX (double mining reward): this used to award RETWEET_POST
               the moment the button was clicked, before the user had even
               chosen Retweet vs Quote in the picker app-fixes.js opens next
               — and without stopping propagation, so app-fixes.js's picker
               ran too. Its "_rt_do" completion handler awards RETWEET_POST
               a second time once the retweet is actually confirmed (see
               that file for the dedup key added there). That meant a
               completed retweet was paid twice, and a cancelled/quoted one
               was still paid once for an action that never happened.
               Retweet is a two-step action (open picker → confirm), unlike
               like/share which complete on a single tap, so the reward now
               belongs solely at the confirmation step in app-fixes.js. No
               award here — just let the click continue through to the
               picker unchanged. */
            var feedRtBtn = t.closest('.action-btn.retweet-btn');
            if (feedRtBtn && feedRtBtn.closest('.impact-story')) {
                return;
            }

            /* ── 4. Feed share button (.action-btn.share-btn) ── */
            var feedShareBtn = t.closest('.action-btn.share-btn');
            if (feedShareBtn && feedShareBtn.closest('.impact-story')) {
                var card3 = feedShareBtn.closest('.impact-story');
                var pid3  = card3 ? (card3.dataset.postId || '') : '';
                _awardEMPY('SHARE_POST', 'sh-' + (pid3 || Date.now()));
                return;
            }

            /* ── 5. Comment like (.vf-cmt-like) ── */
            var cmtLikeBtn = t.closest('.vf-cmt-like');
            if (cmtLikeBtn) {
                if (!cmtLikeBtn.classList.contains('liked')) {
                    var cmtItem = cmtLikeBtn.closest('.vf-th-comment-item');
                    var cmtId   = cmtItem ? (cmtItem.dataset.commentId || '') : '';
                    _awardEMPY('LIKE_COMMENT', cmtId || ('cl-' + Date.now()));
                }
                return;
            }

            /* ── 6. Comment retweet (.vf-cmt-retweet) ── */
            var cmtRtBtn = t.closest('.vf-cmt-retweet');
            if (cmtRtBtn) {
                if (!cmtRtBtn.classList.contains('retweeted')) {
                    var cmtItem2 = cmtRtBtn.closest('.vf-th-comment-item');
                    var cmtId2   = cmtItem2 ? (cmtItem2.dataset.commentId || '') : '';
                    _awardEMPY('RETWEET_COMMENT', cmtId2 || ('crt-' + Date.now()));
                }
                return;
            }

            /* ── 7. Comment share (.vf-cmt-share) ── */
            var cmtShareBtn = t.closest('.vf-cmt-share');
            if (cmtShareBtn) {
                var cmtItem3 = cmtShareBtn.closest('.vf-th-comment-item');
                var cmtId3   = cmtItem3 ? (cmtItem3.dataset.commentId || '') : '';
                _awardEMPY('SHARE_POST', 'cs-' + (cmtId3 || Date.now()));
                return;
            }

            /* ── 8. Thread reply send button (#vf-th-comp-send) ── */
            var sendBtn = t.closest('#vf-th-comp-send');
            if (sendBtn) {
                var inp = document.getElementById('vf-th-comp-inp');
                if (inp && (inp.value || '').trim()) {
                    _awardEMPY('REPLY_POST', 'rp-' + Date.now());
                }
                return;
            }

            /* ── 9. Sub-reply send button (.vf-th-subreply-send) ── */
            var srSendBtn = t.closest('.vf-th-subreply-send');
            if (srSendBtn) {
                var comp  = srSendBtn.closest('.vf-th-subreply-composer');
                var srInp = comp ? comp.querySelector('.vf-th-subreply-inp') : null;
                if (srInp && (srInp.value || '').trim()) {
                    _awardEMPY('SUBREPLY', 'sr-' + Date.now());
                }
                return;
            }

            /* ── 10. Sub-reply like (.vf-sr-like) ── */
            var srLikeBtn = t.closest('.vf-sr-like');
            if (srLikeBtn) {
                if (!srLikeBtn.classList.contains('liked')) {
                    var srItem = srLikeBtn.closest('.vf-th-subreply-item');
                    _awardEMPY('LIKE_SUBREPLY', (srItem && srItem.dataset.replyId) || ('srl-' + Date.now()));
                }
                return;
            }

        }, true /* capture phase */);

        /* ── Wrap _submitQuote for Quote Tweet mining ─────────────────── */
        function _wrapQuoteSubmit() {
            if (window._submitQuote && !window._submitQuote._miningWrapped) {
                var _orig = window._submitQuote;
                window._submitQuote = function() {
                    var qi = document.getElementById('vf-th-quote-inp');
                    if (qi && (qi.value || '').trim()) {
                        _awardEMPY('QUOTE_TWEET', 'qt-' + Date.now());
                    }
                    return typeof _orig === 'function' ? _orig.apply(this, arguments) : undefined;
                };
                window._submitQuote._miningWrapped = true;
            }
        }

        /* REMOVED (2026-07): _wrapPostCreate() used to wrap window.createPost /
           submitPost / addPost / publishPost to award POST_CREATE. None of
           those four names are ever defined anywhere in this codebase — the
           real post-submit code is an inline form handler, not a function
           under any of those names — so this wrapper never found anything to
           wrap and POST_CREATE could never fire. Confirmed dead via full-
           codebase search before removal. CREATE_POST (app-fixes.js) remains
           the one real reward for publishing a post. */

        /* ── Init ─────────────────────────────────────────────────────── */
        ready(function() {
            _wrapQuoteSubmit();
            setTimeout(_wrapQuoteSubmit, 1000);
        });
        document.addEventListener('empyrean-init-done', function() {
            _wrapQuoteSubmit();
            setTimeout(_wrapQuoteSubmit, 500);
        });

        console.log('[§43 v3] Impact mining engine — click-detection only; rewards now delegated to app-impactmining.js.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §44  DASHBOARD CARD DUPLICATES — pre-create #dashboard-business-slider
            alias BEFORE app-business.js renderDashboardBusinesses() runs.

            ROOT CAUSE: app-business.js renderDashboardBusinesses() does:
              var slider = getElementById('dashboard-business-slider')
                         || getElementById('dashboard-bizposts-slider');
              if (!getElementById('dashboard-business-slider')) slider.id =
                'dashboard-business-slider';
            On the FIRST call (alias doesn't exist yet) it RENAMES the real
            product-card slider (#dashboard-bizposts-slider) to
            #dashboard-business-slider and writes business-page cards into
            it. §37's bridge then can't find #dashboard-bizposts-slider
            (renamed), so its dedupe/move logic never runs, and re-renders
            keep appending fresh business/product cards alongside the old
            ones — producing the duplicate cards seen on the dashboard
            timeline.

            FIX: create a separate, real (but visually hidden) #dashboard-
            business-slider + #dashboard-business-container BEFORE the first
            render, so app-business.js never renames #dashboard-bizposts-
            slider. §37's bridge then moves business cards from this alias
            into the real #dashboard-bizposts-slider using its existing
            dedupe-by-data-biz-id check, which now works correctly because
            #dashboard-bizposts-slider keeps its original id and contents.

            Also performs a sweep to remove any duplicate cards (same
            data-biz-id or data-post-id) that already accumulated in
            #dashboard-bizposts-slider from prior renders, keeping the
            first/most-recent occurrence of each.
    ═══════════════════════════════════════════════════════════════════════ */
    (function fixDashboardCardDuplicates() {

        function _ensureAlias() {
            /* FIX (old Business Posts strip removed): #dashboard-bizposts-container
               no longer exists in index.html, so there's nothing left for
               renderDashboardBusinesses() to target or rename — creating this
               hidden alias now would just be a permanently-empty, purposeless
               DOM node. No-op unless the real container somehow comes back. */
            if (!document.getElementById('dashboard-bizposts-container')) return;
            if (!document.getElementById('dashboard-business-slider')) {
                var aliasSlider = document.createElement('div');
                aliasSlider.id = 'dashboard-business-slider';
                aliasSlider.style.cssText = 'display:none!important;width:0;height:0;overflow:hidden;position:absolute;pointer-events:none;';
                document.body.appendChild(aliasSlider);
            }
            if (!document.getElementById('dashboard-business-container')) {
                var aliasContainer = document.createElement('div');
                aliasContainer.id = 'dashboard-business-container';
                aliasContainer.style.cssText = 'display:none!important;width:0;height:0;overflow:hidden;position:absolute;pointer-events:none;';
                document.body.appendChild(aliasContainer);
            }
        }

        /* Remove duplicate cards (same data-biz-id, data-page-id, or
           data-post-id) that may already exist in the real slider from
           earlier renders. Each business page should show only ONE
           catalog card in the dashboard timeline. */
        function _dedupeRealSlider() {
            var slider = document.getElementById('dashboard-bizposts-slider');
            if (!slider) return;
            var seenBiz  = {};
            var seenPost = {};
            var seenPage = {};
            Array.from(slider.children).forEach(function(card) {
                var bizId  = card.dataset && card.dataset.bizId;
                var postId = card.dataset && card.dataset.postId;
                var pageId = card.dataset && card.dataset.pageId;
                if (bizId) {
                    if (seenBiz[bizId]) { try { slider.removeChild(card); } catch(_e) {} return; }
                    seenBiz[bizId] = true;
                }
                if (pageId) {
                    if (seenPage[pageId]) { try { slider.removeChild(card); } catch(_e3) {} return; }
                    seenPage[pageId] = true;
                }
                if (postId) {
                    if (seenPost[postId]) { try { slider.removeChild(card); } catch(_e2) {} return; }
                    seenPost[postId] = true;
                }
            });
        }

        function _init() {
            _ensureAlias();
            _dedupeRealSlider();
        }

        /* Run as early as possible — before app-business.js's first
           renderDashboardBusinesses() call (fires ~600ms after
           empyrean-init-done / empyrean-section-change). */
        if (document.readyState !== 'loading') _init();
        else document.addEventListener('DOMContentLoaded', _init);
        document.addEventListener('empyrean-init-done', function() {
            _init();
            setTimeout(_dedupeRealSlider, 900);
            setTimeout(_dedupeRealSlider, 2000);
        });
        document.addEventListener('empyrean-section-change', function(ev) {
            if (ev && ev.detail && ev.detail.section === 'dashboard') {
                _init();
                setTimeout(_dedupeRealSlider, 900);
            }
        });

        console.log('[§44] Dashboard card duplicates — pre-create #dashboard-business-slider alias + dedupe sweep.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §45  TWITTER-STYLE LIKES + UNIVERSAL NATIVE SHARE

       LIKES
       ─────
       Single capture-phase delegated handler covers every `.action-btn.like-btn`
       across feed, SOS/crisis cards, business-page posts, and the thread view.
       • Optimistic toggle: red filled heart immediately, count +1/-1.
       • Firestore write: FieldValue.increment(±1) on the posts/sos_posts/
         business_posts collection, plus likedBy arrayUnion/arrayRemove so the
         state survives page refresh.
       • Collection routing: reads data-collection attribute on the card
         (set by the business page renderer) or defaults to "posts".
       • Per-session dedup via Set — prevents double-like on rapid tap.
       • Like count shown as a tiny number next to the heart (handled by the
         existing .x-count / .like-count CSS in index.html).

       SHARE
       ─────
       A single capture-phase handler intercepts every `.share-btn /
       [data-action="share"]` click — including business-page posts.
       On Android / iOS  → navigator.share() (real OS share drawer).
       On desktop        → navigator.clipboard.writeText() + toast.
       The old custom fallback sheet is bypassed entirely because this handler
       fires in capture before app-thread.js's bubble handler.
       navigator.share() MUST be called synchronously in the user-gesture stack;
       this handler does so with zero async overhead.
    ═══════════════════════════════════════════════════════════════════════ */
    (function initLikesAndShare() {

        /* ── helpers ── */
        function _fv45() {
            return (window.firebase && window.firebase.firestore &&
                    window.firebase.firestore.FieldValue) || null;
        }
        function _inc45(n) {
            var fv = _fv45();
            return (fv && typeof fv.increment === 'function') ? fv.increment(n) : n;
        }
        function _fbOk45() {
            return !!(window._firebaseLoaded && window.fbDb &&
                      typeof window.fbDb.collection === 'function');
        }
        /* FIX (live counts root cause): this used to check window.currentUser /
           window._currentUser, neither of which is ever assigned anywhere in
           the codebase — so it always fell through to {id:null}, which made
           _isGuest45() always return true and silently blocked every like
           write for every user, guest or logged-in. Delegate to the already-
           correct _us()/_isGuest() defined at the top of this file (§0),
           which check window.EmpState.userState / window.userState properly. */
        function _us45() { return _us(); }
        function _isGuest45() { return _isGuest(); }
        function _notify45(msg, type) {
            if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'success');
        }
        function _fmt45(n) {
            if (!n || n <= 0) return '';
            if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
            if (n >= 1000)    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
            return String(n);
        }
        function _col45(card) {
            if (card && card.dataset.collection) return card.dataset.collection;
            /* FIX (collection name mismatch, round 2): the class names checked
               here — 'crisis-card' / 'sos-card' — do not exist anywhere in the
               card-creation code. createSosPostOnFeed() (app-sos.js) sets
               className = 'impact-story sos-request', and
               createCrisisPostOnFeed() sets className = 'impact-story
               crisis-report'. Because neither matched, EVERY like/retweet/
               quote/share/download on an SOS or crisis card fell through to
               the 'posts' default.
                 - For crisis-report cards this is fatal: those docs live only
                   in 'crisis_reports', never in 'posts', so the target
                   document never exists — permanent permission-denied.
                 - For sos-request cards this is intermittent: the SOS doc IS
                   mirrored into 'posts' on admin approval (app-sos.js
                   _handleApproveSos), but only once that write lands — any
                   engagement click that beat it there hit a nonexistent doc
                   and got permission-denied. */
            if (card && card.classList.contains('crisis-report')) return 'crisis_reports';
            if (card && card.classList.contains('sos-request'))  return 'posts';
            if (card && card.classList.contains('biz-post-card')) return 'business_posts';
            return 'posts';
        }

        /* Prevent double-like within one session */
        var _liking = new Set();

        /* ── LIKE HANDLER ────────────────────────────────────────────── */
        document.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest &&
                      e.target.closest('.action-btn.like-btn, [data-action="like"].action-btn');
            if (!btn) return;

            /* Reel likes handled by §6 — skip */
            if (btn.closest('.reel-overlay, .reel-card, [data-reel-action], .reel-container')) return;
            /* Thread post action bar handled by app-patch-v2 — skip */
            if (btn.closest('#vf-th-post-actions')) return;

            e.preventDefault();
            e.stopPropagation();

            if (_isGuest45()) {
                if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
                else _notify45('Log in to like posts.', 'info');
                return;
            }

            /* FIX ("[§45 like] Firestore error: Missing or insufficient
               permissions"): checked here, BEFORE any of the optimistic
               UI work below (class toggle, icon swap, pop animation, count
               update) runs — so there's nothing to undo if this bails.
               window._firebaseLoaded/window.fbDb (what _fbOk45() checks)
               reflect whether the Firestore SDK object itself is ready,
               not whether a Firebase Auth session has actually attached
               yet (anonymous fallback sign-in and session restore both
               happen asynchronously — the same timing gap already fixed
               for the Reel Live Broadcast Channel's own like/gift writes).
               A tap landing in that gap reached the write anyway and got
               denied server-side with exactly this error. */
            if (_fbOk45() && !(window.fbAuth && window.fbAuth.currentUser)) {
                _notify45('Your session is still connecting — please wait a moment and try again.', 'info');
                return;
            }

            var card = btn.closest(
                '[data-post-id], .impact-story, .story-card, .crisis-card,' +
                ' .sos-card, .biz-post-card, .news-card'
            );
            var postId = card && (card.dataset.postId || '');
            if (!postId) {
                if (window._empDebugLog) window._empDebugLog('[§45] LIKE BLOCKED — no data-post-id on card (' + (card ? card.className : 'no card matched') + ')', '#f55');
                return;
            }

            /* Debounce: ignore if a write is already in-flight for this post */
            if (_liking.has(postId)) return;
            _liking.add(postId);
            setTimeout(function () { _liking.delete(postId); }, 1500);

            /* Toggle liked class */
            var isOn = btn.classList.toggle('liked');

            /* Heart icon: filled ↔ outline */
            var heartIcon = btn.querySelector('i.fas, i.far, i.fa-heart');
            var heartSvg  = btn.querySelector('svg');
            var heartPath = heartSvg && heartSvg.querySelector('path');
            if (heartIcon) {
                heartIcon.className = isOn ? 'fas fa-heart' : 'far fa-heart';
            } else if (heartPath) {
                heartSvg.style.fill   = isOn ? 'rgb(249,24,128)' : 'none';
                heartSvg.style.stroke = isOn ? 'rgb(249,24,128)' : 'currentColor';
            }

            /* Pop animation (class x-like-pop defined in index.html) */
            btn.classList.remove('like-anim');
            if (isOn) { void btn.offsetWidth; btn.classList.add('like-anim'); }

            /* ── Floating red heart bubble (ported from app-fixes.js's older
               like handler — that code was unreachable here for the same
               capture+stopPropagation reason as the notify block below, so
               the bubble was created + appended but never actually ran,
               making the "like animation" invisible. likeBubblePop keyframe
               is defined in app-patch-v7.js §A. Only fires on like, not
               unlike. ── */
            if (isOn) {
                try {
                    var _lb45 = document.createElement('span');
                    _lb45.innerHTML = '<i class="fas fa-heart" style="color:#EF4444;"></i>';
                    var _br45 = btn.getBoundingClientRect();
                    _lb45.style.cssText = 'position:fixed;left:' + (_br45.left + (_br45.width / 2) - 8) + 'px;top:' + (_br45.top - 5) + 'px;pointer-events:none;font-size:1.6rem;z-index:9999;animation:likeBubblePop 1.2s ease-out forwards;';
                    document.body.appendChild(_lb45);
                    setTimeout(function () { if (_lb45.parentNode) _lb45.remove(); }, 1400);
                } catch (eBubble45) {}
            }

            /* ── Notify post owner (ported from app-fixes.js's older like
               handler, which is unreachable here since this capture-phase
               handler stops propagation first — but its owner-notification
               logic was never carried over, so likes never told the post
               owner anyone liked their post). Only fires on like, not unlike,
               and only when the post belongs to someone else. ── */
            if (isOn) {
                var ownerUid = card && card.dataset.userId;
                var meUid45  = _us45().id;
                if (ownerUid && ownerUid !== meUid45) {
                    if (typeof window.pushNotification === 'function') {
                        window.pushNotification((_us45().fullName || 'Someone') + ' liked your post! ❤️', 'info');
                    }
                    if (_fbOk45()) {
                        try {
                            window.fbDb.collection('user_notifications').add({
                                userId: ownerUid, type: 'like',
                                message: (_us45().fullName || 'Someone') + ' liked your post',
                                fromUserId: meUid45, postId: postId,
                                read: false, createdAt: new Date().toISOString()
                            }).catch(function () {});
                        } catch (eNotif) {}
                    }
                }
            }

            /* Count display — pick the most-specific span inside the button */
            var countEl = btn.querySelector('.like-count') ||
                          btn.querySelector('.x-count');
            var curN = countEl ? (parseInt(countEl.textContent || '0', 10) || 0) : 0;
            var newN = Math.max(0, curN + (isOn ? 1 : -1));
            if (countEl) countEl.textContent = _fmt45(newN);

            /* X-pill tint when liked */
            var pill = btn.querySelector('.x-pill');
            if (pill) pill.style.color = isOn ? 'rgb(249,24,128)' : '';

            /* Firestore write */
            /* TEMP DIAGNOSTIC (safe to remove once live-count bug is confirmed
               fixed): logs every branch via the existing app-debug-panel.js
               logger so we can see exactly where a like write stops, instead
               of guessing from silence. No-ops if the debug panel isn't loaded. */
            if (window._empDebugLog) window._empDebugLog('[§45] _fbOk45()=' + _fbOk45() + ' col=' + _col45(card) + ' postId=' + postId, '#0af');
            if (_fbOk45()) {
                /* FIX ("[§45 like] Firestore error: Missing or insufficient
                   permissions"): firebase-rules.js's isValidEngagementChange()
                   requires likedBy to toggle request.auth.uid specifically —
                   the REAL Firebase Auth identity — not whatever this app's
                   own userState.id currently holds. This codebase has hit
                   that exact live-Auth-uid-vs-userState.id mismatch
                   repeatedly elsewhere (see firebase-rules.js's own
                   isContactVisibilityOnlyUpdate/isProfileMediaOnlyUpdate
                   comments), and reading _us45().id here risked writing the
                   wrong uid into likedBy — denied server-side because the
                   rule checks it against request.auth.uid, not whatever
                   value the client sent. Reading straight off
                   window.fbAuth.currentUser.uid instead guarantees the
                   value written is the one Firestore rules actually check
                   against. */
                var _liveAuthUser45 = window.fbAuth && window.fbAuth.currentUser;
                var uid = (_liveAuthUser45 && _liveAuthUser45.uid) || _us45().id;
                var fv  = _fv45();
                var upd = { likes: _inc45(isOn ? 1 : -1) };
                if (fv && uid) {
                    upd.likedBy = isOn ? fv.arrayUnion(uid) : fv.arrayRemove(uid);
                }
                if (window._empDebugLog) window._empDebugLog('[§45] uid=' + uid + ' fv=' + !!fv + ' upd=' + JSON.stringify(Object.keys(upd)), '#0af');
                try {
                    window.fbDb.collection(_col45(card)).doc(postId)
                        .update(upd)
                        .then(function () {
                            if (window._empDebugLog) window._empDebugLog('[§45] like write OK', '#0f0');
                        })
                        .catch(function (err) {
                            console.warn('[§45 like] Firestore error:', err && err.message);
                            if (window._empDebugLog) window._empDebugLog('[§45] like write FAILED: ' + (err && err.message), '#f55');
                        });
                } catch (ex) {
                    console.warn('[§45 like] Exception:', ex && ex.message);
                    if (window._empDebugLog) window._empDebugLog('[§45] like write THREW: ' + (ex && ex.message), '#f55');
                }
            } else {
                if (window._empDebugLog) window._empDebugLog('[§45] SKIPPED write — _fbOk45() was false', '#f55');
            }

            /* Mining reward */
            if (isOn && typeof window._awardImpactMining === 'function') {
                window._awardImpactMining('LIKE_POST', postId);
            }

        }, true /* capture phase */);


        /* Debounce: ignore a second share click for the same post while the
           first click's Firestore write/native share sheet is still settling. */
        var _sharing = new Set();

        /* ── SHARE HANDLER ───────────────────────────────────────────── */
        document.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest &&
                      e.target.closest(
                          '.share-btn, .action-btn.share-btn,' +
                          ' [data-action="share"], #biz-share-btn, .biz-share-trigger'
                      );
            if (!btn) return;

            /* Reel share handled by §6 */
            if (btn.closest('.reel-overlay, .reel-card, [data-reel-action], .reel-container')) return;
            /* Thread post action bar — app-thread.js handles this natively */
            if (btn.closest('#vf-th-post-actions, #vf-th-body')) return;

            /* CRITICAL: navigator.share() must be called synchronously in the
               user-gesture call stack. No awaits, no setTimeout before this call. */
            e.preventDefault();
            e.stopPropagation();

            var card = btn.closest(
                '[data-post-id], [data-biz-id], [data-page-id],' +
                ' .impact-story, .story-card, .crisis-card, .sos-card,' +
                ' .biz-post-card, .news-card, .business-card'
            );
            var postId = card && (card.dataset.postId || card.dataset.bizId ||
                                  card.dataset.pageId || '');

            var shareUrl = window.location.origin +
                (postId ? '/?post=' + encodeURIComponent(postId) : window.location.pathname);

            /* FIX (one share per account, per post — matches like/download):
               btn.classList.contains('shared') is restored from the post's
               own sharedBy array by _applyCounts45 below, the same way
               .liked already is, so this holds across page refreshes and
               other devices, not just this tab. Rapid double-clicks before
               that class/array round-trips are covered by the _sharing
               debounce set. Neither of these blocks the native share sheet
               itself from opening again below — only the counted
               engagement + mining reward are capped at one per account. */
            var alreadyCounted = btn.classList.contains('shared');
            var canCount = postId && !alreadyCounted && !_sharing.has(postId);
            if (canCount) {
                _sharing.add(postId);
                setTimeout(function () { _sharing.delete(postId); }, 1500);
                btn.classList.add('shared');

                if (_fbOk45()) {
                    var uidShare = _us45().id;
                    var fvShare  = _fv45();
                    var updShare = { shareCount: _inc45(1) };
                    if (fvShare && uidShare) updShare.sharedBy = fvShare.arrayUnion(uidShare);
                    try {
                        window.fbDb.collection(_col45(card)).doc(postId)
                            .update(updShare).catch(function () {});
                    } catch (ex) {}
                }

                /* Update share count in the UI */
                var shEl = btn.querySelector('.share-count, .x-count');
                if (shEl) {
                    var shN = Math.max(0, parseInt(shEl.textContent || '0', 10) || 0) + 1;
                    shEl.textContent = _fmt45(shN);
                }

                /* Award mining for share */
                if (typeof window._awardImpactMining === 'function') {
                    window._awardImpactMining('SHARE_POST', 'sh-' + postId);
                }
            } else if (!postId && window._empDebugLog) {
                window._empDebugLog('[§45] SHARE mining SKIPPED — no data-post-id/biz-id/page-id on card (' + (card ? card.className : 'no card matched') + ')', '#f55');
            }

            /* NATIVE SHARE — opens the real Android/iOS share drawer */
            if (typeof navigator.share === 'function') {
                navigator.share({
                    title: 'Empyrean International',
                    url:   shareUrl
                }).catch(function (err) {
                    /* AbortError = user dismissed — nothing to do.
                       Any other error → copy to clipboard as last resort. */
                    if (err && err.name !== 'AbortError') {
                        _clipboardCopy45(shareUrl);
                    }
                });
                return; /* Always return — do NOT fall through to copy on mobile */
            }

            /* Desktop / browser without Share API — show share sheet with real links */
            if (typeof window._empShowShareSheet === 'function') {
                window._empShowShareSheet(shareUrl);
            } else {
                _clipboardCopy45(shareUrl);
            }

        }, true /* capture phase — fires before app-thread.js bubble handler */);


        function _clipboardCopy45(url) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url)
                    .then(function () { _notify45('Link copied to clipboard!', 'success'); })
                    .catch(function () { _legacyCopy45(url); });
            } else {
                _legacyCopy45(url);
            }
        }

        function _legacyCopy45(url) {
            try {
                var ta = document.createElement('textarea');
                ta.value = url;
                ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:-9999px;';
                document.body.appendChild(ta);
                ta.focus(); ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                _notify45('Link copied!', 'success');
            } catch (ex) {
                _notify45('Share: ' + url, 'info');
            }
        }


        /* ── RESTORE LIKED STATE + LIVE COUNT SYNC when cards render ───
           FIX (live count stuck/frozen — root cause): this used to be a
           ONE-SHOT .get() that ran exactly once per card (guarded by
           card._45restored), so every count span got painted with
           whatever values existed at that single instant and then never
           moved again — even while other users were actively liking,
           commenting, sharing, downloading, or viewing the very same
           post in real time. It also only ever restored `likes` and
           `shareCount`, leaving comment/download/view/retweet/quote
           counts permanently stuck at their initial render value too.

           Replaced with a genuine Firestore onSnapshot subscription per
           post-id (not per DOM node — re-renders of the same post just
           reuse the existing subscription via window._45countSubs, so
           navigating between feed/profile/business views never leaks
           listeners or re-subscribes the same doc twice). Every time
           ANY user's action_mining write lands on that doc — like,
           share, download, comment, retweet, quote, or a view-count
           increment — this listener re-renders every matching count
           span currently in the DOM, on every device, instantly,
           exactly like X/Twitter's own live counters. */
        if (!window._45countSubs) window._45countSubs = {};

        function _applyCounts45(pid, d) {
            var fmt = function (n) { return _fmt45(n || 0); };
            document.querySelectorAll('[data-post-id="' + pid + '"]').forEach(function (card) {
                var lkEl = card.querySelector('.like-count, .action-btn.like-btn .x-count');
                var shEl = card.querySelector('.share-count, .action-btn.share-btn .x-count');
                var dlEl = card.querySelector('.download-count, .download-media-btn .x-count');
                var cmEl = card.querySelector('.comment-count, .action-btn.comment-btn .x-count');
                var vcEl = card.querySelector('.view-count, .view-count-display .x-count');
                var rtEl = card.querySelector('.retweet-count, .action-btn.retweet-btn .x-count');
                var qtEl = card.querySelector('.quote-count');
                if (lkEl) lkEl.textContent = fmt(d.likes);
                if (shEl) shEl.textContent = fmt(d.shareCount);
                if (dlEl) dlEl.textContent = fmt(d.downloadCount);
                if (cmEl) cmEl.textContent = fmt(d.commentCount);
                if (vcEl) vcEl.textContent = fmt(d.views);
                if (rtEl) rtEl.textContent = fmt(d.retweetCount || d.retweets);
                if (qtEl) qtEl.textContent = fmt(d.quoteCount);

                /* Restore/refresh liked heart state for the current user */
                var likeBtn = card.querySelector('.action-btn.like-btn');
                var uid = _us45().id;
                if (likeBtn && uid) {
                    var likedBy = d.likedBy || [];
                    var isLiked = likedBy.indexOf(uid) !== -1;
                    likeBtn.classList.toggle('liked', isLiked);
                    var svg45  = likeBtn.querySelector('svg');
                    var path45 = svg45 && svg45.querySelector('path');
                    var icon45 = likeBtn.querySelector('i');
                    var pill45 = likeBtn.querySelector('.x-pill');
                    if (icon45) icon45.className = isLiked ? 'fas fa-heart' : 'far fa-heart';
                    else if (path45) {
                        svg45.style.fill   = isLiked ? 'rgb(249,24,128)' : 'none';
                        svg45.style.stroke = isLiked ? 'rgb(249,24,128)' : 'currentColor';
                    }
                    if (pill45) pill45.style.color = isLiked ? 'rgb(249,24,128)' : '';
                }

                /* FIX (one share/download/retweet per account — cross-session):
                   same restore pattern as .liked above, so the SHARE gate
                   added to §45's handler (and the corresponding download/
                   retweet gates) hold even after a refresh or on a
                   different device, not just within the tab that performed
                   the action. */
                if (uid) {
                    var shareBtn45 = card.querySelector('.action-btn.share-btn');
                    if (shareBtn45) shareBtn45.classList.toggle('shared', (d.sharedBy || []).indexOf(uid) !== -1);

                    var dlBtn45 = card.querySelector('.download-media-btn');
                    if (dlBtn45 && (d.downloadedBy || []).indexOf(uid) !== -1) {
                        dlBtn45.classList.add('downloaded');
                        if (window.userState && window.userState.downloadedPostIds) {
                            window.userState.downloadedPostIds.add(pid);
                        }
                    }

                    var rtBtn45 = card.querySelector('.action-btn.retweet-btn');
                    if (rtBtn45) {
                        var isRt45 = (d.retweetedBy || []).indexOf(uid) !== -1;
                        rtBtn45.classList.toggle('retweeted', isRt45);
                        if (isRt45 && window.userState && window.userState.retweetedPostIds) {
                            window.userState.retweetedPostIds.add(pid);
                        }
                    }

                    /* 2026-10-19 — "make comment / requote / share indicate too, like Like": the Comment and Quote buttons now get the
                       same active state as Like once the current user has commented / quoted (class .commented / .quoted, styled in
                       style.css). Comment state also checks a per-device list so it still shows if the database refuses commentedBy. */
                    var cmBtn45 = card.querySelector('.action-btn.comment-btn');
                    if (cmBtn45) cmBtn45.classList.toggle('commented', (d.commentedBy || []).indexOf(uid) !== -1 || !!(window._empLocalAct && window._empLocalAct('commented', pid)));
                    var qtBtn45 = card.querySelector('.action-btn.quote-btn');
                    if (qtBtn45) qtBtn45.classList.toggle('quoted', (d.quotedBy || []).indexOf(uid) !== -1);

                    // FIX (quote cap didn't survive reload) — same restore
                    // pattern as retweetedBy/downloadedBy just above, feeding
                    // the gate added in app-thread.js's _doSubmitQuote.
                    if ((d.quotedBy || []).indexOf(uid) !== -1 && window.userState && window.userState.quotedPostIds) {
                        window.userState.quotedPostIds.add(pid);
                    }
                }
            });
        }

        function _subscribeCounts45(pid, col) {
            if (!pid || window._45countSubs[pid]) return;
            try {
                window._45countSubs[pid] = window.fbDb.collection(col).doc(pid)
                    .onSnapshot(function (doc) {
                        if (!doc.exists) return;
                        _applyCounts45(pid, doc.data() || {});
                    }, function (err) {
                        /* permission-denied / not-found: drop the handle so a future
                           render (e.g. once the doc actually exists) can retry. */
                        try { window._45countSubs[pid](); } catch (e2) {}
                        delete window._45countSubs[pid];
                    });
            } catch (ex) {}
        }

        function _restoreLikedState() {
            if (!_fbOk45()) return;
            document.querySelectorAll('[data-post-id]').forEach(function (card) {
                var pid = card.dataset.postId;
                if (!pid) return;
                /* FIX (report — "retweet/quote/like doesn't indicate" on the
                   Post detail/thread page): this gate only recognized the
                   main feed card's own like-button markup
                   (.action-btn.like-btn), so a post opened in
                   app-thread.js's full-thread view — which renders its own
                   action bar with a different convention
                   (.vf-th-act-btn[data-action="like"]) — never got past
                   this check at all. That meant _subscribeCounts45/
                   _applyCounts45 below (the one shared engine that restores
                   like/retweet/quote state and keeps counts live) never ran
                   for ANY post viewed via its detail page, only for posts
                   also currently rendered in the main feed. Recognizing
                   either convention here is what lets the rest of this
                   pipeline reach the thread view at all. */
                var likeBtn = card.querySelector('.action-btn.like-btn, .vf-th-act-btn[data-action="like"]');
                if (!likeBtn) return;
                _subscribeCounts45(pid, _col45(card));
            });
        }

        /* Trigger restore on section changes */
        document.addEventListener('empyrean-section-change', function () {
            setTimeout(_restoreLikedState, 700);
        });
        document.addEventListener('empyrean-init-done', function () {
            setTimeout(_restoreLikedState, 1000);
        });

        /* Watch feed-container for newly injected post cards */
        (function _watchFeed() {
            var fc = document.getElementById('feed-container');
            if (!fc) { setTimeout(_watchFeed, 1500); return; }
            new MutationObserver(function (mutations) {
                if (mutations.some(function (m) { return m.addedNodes.length > 0; })) {
                    setTimeout(_restoreLikedState, 350);
                }
            }).observe(fc, { childList: true, subtree: false });
        }());

        /* ── LIVE LIKE-COUNT BAR ─────────────────────────────────────────
           Injects a thin animated bar beneath the like count that fills
           proportionally to the post's like count relative to the most-liked
           post visible on screen. Updates live when likes change.
        ─────────────────────────────────────────────────────────────────── */
        (function initLikeBar() {
            /* Inject CSS once */
            if (!document.getElementById('emp-like-bar-style')) {
                var st = document.createElement('style');
                st.id = 'emp-like-bar-style';
                st.textContent = [
                    '.emp-like-bar-wrap{display:block;width:100%;height:3px;background:rgba(0,0,0,0.07);border-radius:2px;margin-top:3px;overflow:hidden;}',
                    '.emp-like-bar{height:100%;width:0%;border-radius:2px;',
                    'background:linear-gradient(90deg,rgb(249,24,128),rgb(255,80,80));',
                    'transition:width 0.5s cubic-bezier(0.34,1.56,0.64,1);}'
                ].join('');
                document.head.appendChild(st);
            }

            function _ensureBar(btn) {
                var pill = btn.querySelector('.x-pill');
                if (!pill) return;
                if (pill.querySelector('.emp-like-bar-wrap')) return; /* already added */
                var wrap = document.createElement('span');
                wrap.className = 'emp-like-bar-wrap';
                var bar = document.createElement('span');
                bar.className = 'emp-like-bar';
                wrap.appendChild(bar);
                pill.appendChild(wrap);
            }

            function _updateBars() {
                /* Collect all visible like buttons with counts */
                var btns = document.querySelectorAll('.action-btn.like-btn');
                var max = 0;
                btns.forEach(function(b) {
                    var cnt = b.querySelector('.like-count, .x-count');
                    var n = cnt ? (parseInt(cnt.textContent.replace(/[KMk]/g,'') || '0', 10) || 0) : 0;
                    /* rough parse for K/M suffixes */
                    if (cnt && cnt.textContent) {
                        var raw = cnt.textContent.trim();
                        if (raw.endsWith('M')) n = parseFloat(raw) * 1000000;
                        else if (raw.endsWith('K') || raw.endsWith('k')) n = parseFloat(raw) * 1000;
                    }
                    if (n > max) max = n;
                });
                btns.forEach(function(b) {
                    _ensureBar(b);
                    var cnt = b.querySelector('.like-count, .x-count');
                    var n = 0;
                    if (cnt && cnt.textContent) {
                        var raw = cnt.textContent.trim();
                        if (raw.endsWith('M')) n = parseFloat(raw) * 1000000;
                        else if (raw.endsWith('K') || raw.endsWith('k')) n = parseFloat(raw) * 1000;
                        else n = parseInt(raw, 10) || 0;
                    }
                    var bar = b.querySelector('.emp-like-bar');
                    if (bar) {
                        var pct = max > 0 ? Math.round((n / max) * 100) : 0;
                        bar.style.width = pct + '%';
                        /* Tint bar when liked */
                        if (b.classList.contains('liked')) {
                            bar.style.opacity = '1';
                        } else {
                            bar.style.opacity = n > 0 ? '0.55' : '0.25';
                        }
                    }
                });
            }

            /* Initial run + update after any like click */
            setTimeout(_updateBars, 800);
            document.addEventListener('click', function(e) {
                if (e.target && e.target.closest && e.target.closest('.action-btn.like-btn')) {
                    setTimeout(_updateBars, 120);
                }
            }, false);

            /* Re-run whenever new cards land in feed or business pages */
            ['feed-container', 'biz-posts-container', 'biz-posts-list'].forEach(function(cid) {
                (function _watchContainer() {
                    var el = document.getElementById(cid) || document.querySelector('.' + cid);
                    if (el) {
                        new MutationObserver(function() { setTimeout(_updateBars, 400); })
                            .observe(el, { childList: true, subtree: true });
                    } else {
                        setTimeout(_watchContainer, 2000);
                    }
                }());
            });
        }());

        console.log('[§45] Twitter-style likes (Firestore toggle + live count + liked state restore) + universal native share installed.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §46  DISPLAY-NAME REPAIR — fix sidebar showing email/prefix on login
       ═══════════════════════════════════════════════════════════════════════
       Root cause: when a user's Firestore profile has fullName set to the
       email prefix (e.g. "akhigbemicheal385" instead of their real name),
       buildSidebar renders that bad value.  The old repair condition in
       app-nav.js was too aggressive — it also flagged real single-word names
       that happened to match the email prefix after lowercasing.

       This section:
         1. Runs once on empyrean-init-done / empyrean-user-ready.
         2. Checks whether window.userState.fullName is a bad placeholder.
         3. Pulls the real name from (in priority order):
              a. fbAuth.currentUser.displayName  (set by updateProfile at registration)
              b. localStorage empyrean_users[email].fullName
         4. Writes the corrected name back to all in-memory state objects,
            Firestore, and localStorage so every subsequent render is correct.
         5. Re-calls buildSidebar() so the sidebar shows the real name
            immediately without requiring a page reload.
    ════════════════════════════════════════════════════════════════════════ */
    (function fixDisplayName() {

        function _repairAndRedraw() {
            var us = (window.EmpState && window.EmpState.userState) || window.userState;
            if (!us || !us.email) return;

            var fn      = (us.fullName || '').trim();
            var email   = us.email.toLowerCase();
            var rawPfx  = email.split('@')[0];               // e.g. "akhigbemicheal385"

            /* Only act when the stored name is clearly auto-generated:
               empty, is the full email, contains @, or is exactly the
               raw lowercase prefix string (all-lowercase = never hand-typed). */
            var isExactRawPrefix = (fn === rawPfx) || (fn.toLowerCase() === rawPfx);
            var needsRepair = !fn || fn === email || fn.indexOf('@') !== -1 || isExactRawPrefix;
            if (!needsRepair) return;

            /* ── Source A: Firebase Auth displayName ─────────────────────── */
            var fbDN = '';
            try {
                fbDN = (window.fbAuth && window.fbAuth.currentUser &&
                        window.fbAuth.currentUser.displayName) || '';
            } catch(e) {}

            var realName = '';
            if (fbDN && fbDN !== email && fbDN !== rawPfx && fbDN.indexOf('@') === -1) {
                realName = fbDN;
            }

            /* ── Source B: localStorage signup data ──────────────────────── */
            if (!realName) {
                try {
                    var ls    = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
                    var lsEnt = ls[email] || {};
                    var lsN   = (lsEnt.fullName || '').trim();
                    if (lsN && lsN !== email && lsN !== rawPfx && lsN.indexOf('@') === -1) {
                        realName = lsN;
                    }
                } catch(e) {}
            }

            if (!realName) return; // nothing to repair with

            console.log('[§46] Repairing fullName for', email, ':', fn || '(empty)', '->', realName);

            /* ── Apply to every in-memory reference ──────────────────────── */
            us.fullName = realName;
            if (window.userState) window.userState.fullName = realName;
            if (window.EmpState && window.EmpState.userState)
                window.EmpState.userState.fullName = realName;

            /* ── Write correction back to Firestore ──────────────────────── */
            try {
                var uid = us.id || (window.fbAuth && window.fbAuth.currentUser &&
                                    window.fbAuth.currentUser.uid) || '';
                if (uid && window.fbDb && window._firebaseLoaded) {
                    window.fbDb.collection('users').doc(uid)
                        .update({ fullName: realName })
                        .catch(function(e) { console.warn('[§46] Firestore update:', e.message); });
                }
            } catch(e) {}

            /* ── Write correction back to localStorage ───────────────────── */
            try {
                var ls2    = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
                if (ls2[email]) { ls2[email].fullName = realName; }
                localStorage.setItem('empyrean_users', JSON.stringify(ls2));
                var sess = JSON.parse(localStorage.getItem('empyrean_session') || 'null');
                if (sess && sess.email && sess.email.toLowerCase() === email) {
                    sess.fullName = realName;
                    localStorage.setItem('empyrean_session', JSON.stringify(sess));
                }
            } catch(e) {}

            /* ── Rebuild sidebar so the correct name shows immediately ────── */
            try {
                if (typeof window.buildSidebar === 'function') window.buildSidebar();
            } catch(e) {}
        }

        /* Run on every login / init */
        document.addEventListener('empyrean-init-done',  function() { setTimeout(_repairAndRedraw, 400); });
        document.addEventListener('empyrean-user-ready', function() { setTimeout(_repairAndRedraw, 400); });

        /* Also run once on load in case events already fired */
        if (document.readyState !== 'loading') {
            setTimeout(_repairAndRedraw, 1200);
        }

        console.log('[§46] Display-name repair installed.');
    })();


    /* ═══════════════════════════════════════════════════════════════════════
       §47  DONOR-HUB BANNER + DISBURSEMENT/GRANT/ACCOUNT MODAL EXIT — HARDENED
            Bug reports after deployment:
              1) Tapping the "Sponsor a Project" donor-hub banner on the
                 public dashboard sometimes does nothing — it relies solely
                 on a single inline onclick, which is one broken/blocked
                 handler away from silently doing nothing.
              2) The individual disbursement / grant / account forms
                 (ind-acct-modal, ngo-application-modal,
                 individual-grant-modal) sometimes fail to close via their
                 X / Cancel controls, leaving the form stuck open with no
                 way out — same single-point-of-failure inline-onclick
                 pattern.
            Fix: one independent, capture-phase document delegate that
            guarantees both behaviours regardless of what any other
            handler on the page does (mirrors this file's existing
            capture-phase delegation pattern used throughout), plus a
            direct listener bound straight to the banner element itself
            as a second, independent path. A short debounce prevents a
            double-navigation if the original inline onclick also still
            fires normally.
    ═══════════════════════════════════════════════════════════════════════ */
    (function hardenDonorBannerAndDisbModals() {

        var DISB_MODAL_IDS = ['ind-acct-modal', 'ngo-application-modal', 'individual-grant-modal'];
        var DISB_MODAL_SELECTOR = '#' + DISB_MODAL_IDS.join(', #');

        function _closeDisbModal(modal) {
            if (!modal) return;
            /* ind-acct-modal is reused across opens (hidden, not removed);
               the other two are created fresh each time and safe to remove. */
            if (modal.id === 'ind-acct-modal') {
                modal.style.display = 'none';
            } else {
                modal.remove();
            }
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
        }

        var _lastDonorNav = 0;
        function _goDonorHub() {
            var now = Date.now();
            if (now - _lastDonorNav < 500) return; /* avoid double-nav if inline onclick also fires */
            _lastDonorNav = now;
            if (typeof window.navigateTo === 'function') window.navigateTo('donor-hub');
        }

        document.addEventListener('click', function(e) {
            var t = e.target;
            if (!t || !t.closest) return;

            /* --- Donor-hub banner: force navigation no matter what else happens ---
               We fully own this click once matched, so stop it here — this both
               guarantees single-fire (no double navigateTo if the original
               inline onclick is intact) and guarantees it still works if the
               inline onclick is missing, broken, or blocked upstream. */
            if (t.closest('#donor-awareness-banner')) {
                e.stopPropagation();
                _goDonorHub();
                return;
            }

            /* --- Disbursement / grant / account modals: force-close on backdrop or X/Cancel --- */
            var modal = t.closest(DISB_MODAL_SELECTOR);
            if (modal) {
                if (t === modal) { e.stopPropagation(); _closeDisbModal(modal); return; } /* backdrop click */
                var btn = t.closest('button');
                if (btn) {
                    var label = (btn.textContent || '').trim().toLowerCase();
                    var hasCloseIcon = !!btn.querySelector('.fa-times, .fa-xmark');
                    if (hasCloseIcon || label === 'cancel' || label === 'close') {
                        e.stopPropagation();
                        _closeDisbModal(modal);
                        return;
                    }
                }
            }
        }, true /* capture — runs independently of any other listener's propagation state */);

        /* Keyboard access mirrors the click path */
        document.addEventListener('keydown', function(e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            var t = e.target;
            if (t && t.id === 'donor-awareness-banner') { e.preventDefault(); _goDonorHub(); }
        }, true);

        /* Direct, independent binding on the banner itself as a second path */
        function _bindBannerDirect() {
            var banner = document.getElementById('donor-awareness-banner');
            if (!banner || banner._empDirectBound) return;
            banner._empDirectBound = true;
            banner.addEventListener('click', _goDonorHub);
        }
        if (document.readyState !== 'loading') _bindBannerDirect();
        document.addEventListener('DOMContentLoaded', _bindBannerDirect);
        document.addEventListener('empyrean-init-done', _bindBannerDirect);
        document.addEventListener('empyrean-section-change', _bindBannerDirect);

        console.log('[§47] Donor-hub banner + disbursement/grant/account modal exit — hardened delegate installed.');
    })();


})();

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   §48  COMMENT BUTTON ACTIVE STATE + SAVED COMMENT COUNT  (added 2026-10-19)
   "Make the comment, requote, share indicate too, like Like, when users act."
   • Like / Share / Repost already remember who did them (likedBy / sharedBy / retweetedBy) and already light up.
   • Comment did not: the number was only bumped on screen and never saved, and the button never lit up.
     Now, after a user posts a comment:
       – the Comment button gets the active look (.commented) with its count, exactly like a liked heart;
       – the post's commentCount is saved (counted from the real comments, so it can never double-count) and
         commentedBy gets the user's id, so the highlight survives refresh and shows on other devices;
       – the post is also remembered on this device, so the highlight shows even if the database refuses the extra field.
   • Quote gets the same active look (.quoted) via quotedBy, restored in _applyCounts45 above.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
(function empCommentIndicator() {
    'use strict';

    function _user() { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    function _uid() { return _user().id || ''; }
    function _lsKey(kind) { return 'emp_acts_' + kind + '_' + (_uid() || 'anon'); }
    function _readSet(kind) { try { return JSON.parse(localStorage.getItem(_lsKey(kind)) || '{}') || {}; } catch (e) { return {}; } }
    function _writeSet(kind, o) { try { localStorage.setItem(_lsKey(kind), JSON.stringify(o)); } catch (e) {} }

    window._empLocalAct = function (kind, pid) { return !!(pid && _readSet(kind)[pid]); };

    function _col(card) {
        if (card.dataset && card.dataset.collection) return card.dataset.collection;
        if (card.classList.contains('crisis-report')) return 'crisis_reports';
        return 'posts';
    }

    window._empMarkCommented = function (card) {
        try {
            if (!card) return;
            var pid = card.dataset.postId; if (!pid) return;
            var btn = card.querySelector('.action-btn.comment-btn');
            if (btn) btn.classList.add('commented');

            var set = _readSet('commented'); set[pid] = 1; _writeSet('commented', set);

            var db = window.fbDb;
            if (!window._firebaseLoaded || !db || typeof db.collection !== 'function') return;
            var ref = db.collection(_col(card)).doc(pid);
            var shown = parseInt((card.querySelector('.comment-count') || {}).textContent || '0', 10) || 0;

            /* Save the real comment count (idempotent — recounts instead of adding 1). */
            db.collection('comments').where('postId', '==', pid).get().then(function (snap) {
                var n = 0; snap.forEach(function (d) { if (!((d.data() || {}).parentId)) n++; });
                return ref.update({ commentCount: Math.max(n, shown) });
            }).catch(function () {});

            /* Remember who commented (separate write so one refusal can't block the other). */
            var fv = window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue;
            var uid = _uid();
            if (fv && uid) ref.update({ commentedBy: fv.arrayUnion(uid) }).catch(function () {});
        } catch (e) { console.warn('[§48] mark commented failed:', e && e.message); }
    };

    /* Re-apply the per-device highlight whenever cards appear (feed, profile, thread). */
    function _sweep() {
        var set = _readSet('commented');
        document.querySelectorAll('.impact-story[data-post-id]').forEach(function (card) {
            if (!set[card.dataset.postId]) return;
            var b = card.querySelector('.action-btn.comment-btn');
            if (b && !b.classList.contains('commented')) b.classList.add('commented');
        });
    }
    var _t = null;
    function _later() { clearTimeout(_t); _t = setTimeout(_sweep, 400); }
    try { new MutationObserver(_later).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    document.addEventListener('empyrean-init-done', function () { setTimeout(_sweep, 600); });
    console.log('[§48] Comment / quote / share active indicators ready.');
})();


/* ═══════════════════════════════════════════════════════════════════════════
   §49  SESSION SYNC — profile picture, follows and follower counts that STICK
   (2026-10-28)

   Reported: (1) one browser did not show the account's profile picture until it
   was uploaded again, while another browser did; (2) an uploaded picture was not
   reflected in the avatar on posts (home feed + profile page); (3) following an
   account did not stick — it vanished after logging out and back in — and
   follower counts did not stick either.

   Root causes (all traced in the code, none were Firestore "bugs"):
     • A browser that already had a cached login (localStorage 'empyrean_session')
       enters the app instantly from that CACHE. When Firebase later confirmed the
       login, the real Firestore profile was only written back to localStorage —
       it was never merged into the live session unless the user id differed. So
       an old cached avatar / follow list stayed on screen, and the next
       whole-profile save pushed that stale copy back OVER the good data.
     • The follow button wrote the whole followedUserIds array to
       users/{userState.id} with no error handling (userState.id is not always the
       real Firebase uid here), and tried to increment followerCount on the OTHER
       person's document, which a normal user is not allowed to edit.
     • A post stores a copy of the author's avatar from the moment it was
       published, so posts made while the account still had its initials
       placeholder kept that placeholder forever.

   What this section does (everything else is wired in the files named here):
     1. window._empPersistFollow(targetId, add)   — saves a follow/unfollow with
        arrayUnion/arrayRemove to the REAL signed-in uid, logs failures and
        queues them in localStorage for retry.
     2. Session hydrate — once Firebase confirms the login, merge the stored
        Firestore profile into the live session (picture, cover, follow list,
        text fields), keep follow changes made during this session, push a real
        local picture UP if Firestore has none, then refresh the screen.
     3. window._empRefreshFollowerCount(uid) — follower count = how many accounts
        actually follow uid (a query on followedUserIds), written back to your own
        profile so the number is the same everywhere.
     4. window._empSweepPostAvatars() — points every post header avatar at the
        author's CURRENT picture (posts rendered by createNewPostElement in
        app-feed.js carry data-emp-av="1").
   ═══════════════════════════════════════════════════════════════════════════ */
(function empSessionSync49() {
    'use strict';

    function _db()  { return window.fbDb || null; }
    function _fv()  { return (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null; }
    function _authUid() {
        var u = window.fbAuth && window.fbAuth.currentUser;
        return (u && !u.isAnonymous && u.uid) || null;
    }
    function _me() { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    function _isReal(u) { return !!u && typeof u === 'string' && !/ui-avatars\.com|source\.unsplash\.com/i.test(u); }
    function _warn(tag, e) { try { console.warn('[§49] ' + tag, e && (e.code || e.message || e)); } catch (_) {} }

    /* ── 1. Follow persistence (+ retry queue) ─────────────────────────────── */
    var QKEY = 'empyrean_pending_follow_ops';
    function _readQ() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]') || []; } catch (e) { return []; } }
    function _writeQ(q) { try { localStorage.setItem(QKEY, JSON.stringify(q.slice(-200))); } catch (e) {} }
    function _queue(uid, target, add) {
        var q = _readQ().filter(function (o) { return !(o.u === uid && o.t === target); });
        q.push({ u: uid, t: target, a: !!add });
        _writeQ(q);
    }
    function _dequeue(uid, target) {
        _writeQ(_readQ().filter(function (o) { return !(o.u === uid && o.t === target); }));
    }

    window._empFollowOps = window._empFollowOps || {};   // follow changes made in THIS session: id -> true(follow)/false(unfollow)

    window._empPersistFollow = function (targetId, add) {
        if (!targetId) return Promise.resolve(false);
        window._empFollowOps[targetId] = !!add;
        var me = _me();
        try { _saveSession(me); } catch (_ss) {}   /* keep the local login cache in step with this follow/unfollow */
        var uid = _authUid() || ((me.id && !/^(local-|user-demo|admin-user)/.test(String(me.id))) ? me.id : null);
        var FV = _fv(), db = _db();
        if (!uid || !FV || !db) { if (uid) _queue(uid, targetId, add); return Promise.resolve(false); }
        return db.collection('users').doc(uid).set({
            followedUserIds: add ? FV.arrayUnion(targetId) : FV.arrayRemove(targetId)
        }, { merge: true }).then(function () {
            _dequeue(uid, targetId);
            return true;
        }).catch(function (e) {
            console.error('[Follow] could not save to Firestore (will retry):', e && (e.code || e.message));
            _queue(uid, targetId, add);
            return false;
        });
    };

    function _flushQueue() {
        var uid = _authUid(), db = _db(), FV = _fv();
        if (!uid || !db || !FV) return;
        _readQ().filter(function (o) { return o.u === uid; }).forEach(function (o) {
            db.collection('users').doc(uid).set({
                followedUserIds: o.a ? FV.arrayUnion(o.t) : FV.arrayRemove(o.t)
            }, { merge: true }).then(function () { _dequeue(uid, o.t); }).catch(function (e) { _warn('retry failed', e); });
        });
    }
    window.addEventListener('online', function () { setTimeout(_flushQueue, 800); });

    /* ── 2. Follower count = who actually follows this person ─────────────── */
    var _cntLast = {};
    window._empRefreshFollowerCount = function (uid) {
        var db = _db();
        if (!uid || !db || String(uid).indexOf('biz-') === 0 || uid === 'admin-user') return;
        var now = Date.now();
        if (_cntLast[uid] && now - _cntLast[uid] < 1500) return;
        _cntLast[uid] = now;
        db.collection('users').where('followedUserIds', 'array-contains', uid).limit(5000).get().then(function (snap) {
            var n = snap.size;
            var me = _me(), myId = _authUid() || me.id;
            var iAmIn = false;
            snap.forEach(function (d) { if (d.id === myId) iAmIn = true; });
            var op = window._empFollowOps && window._empFollowOps[uid];      // my own follow/unfollow of this person, this session
            if (op === true && !iAmIn) n += 1;
            if (op === false && iAmIn) n -= 1;
            if (n < 0) n = 0;

            try { if (window.mockUsers && window.mockUsers[uid]) window.mockUsers[uid].followerCount = n; } catch (e) {}
            var isMe = !!(me && me.id === uid);
            var before = isMe ? me.followerCount : null;
            if (isMe) me.followerCount = n;
            if (isMe) { try { _saveSession(me); } catch (_ss2) {} }   /* cached count survives logout -> login */

            var info = document.querySelector('.profile-header-info[data-user-id="' + uid + '"]');
            if (info) { var pc = document.getElementById('profile-follower-count'); if (pc) pc.textContent = n.toLocaleString(); }
            if (isMe) { var dc = document.getElementById('profile-dash-followers'); if (dc) dc.textContent = n.toLocaleString(); }

            /* The owner may write their OWN document: keep the stored number honest so suggestion cards etc. match. */
            if (isMe && _authUid() === uid && before !== n) {
                db.collection('users').doc(uid).update({ followerCount: n }).catch(function (e) { _warn('own followerCount write refused', e); });
            }
        }).catch(function (e) { _warn('follower count query failed', e); });
    };

    /* ── 3. Post-header avatars always show the author's CURRENT picture ──── */
    window._empAvatarCache = window._empAvatarCache || {};
    var _avMiss = {}, _avBusy = {};
    function _bestAvatarFor(uid) {
        var me = _me();
        if (me && me.id === uid && _isReal(me.avatar)) return me.avatar;
        var c = window._empAvatarCache[uid]; if (_isReal(c)) return c;
        try { var m = window.mockUsers && window.mockUsers[uid]; if (m && _isReal(m.avatar)) return m.avatar; } catch (e) {}
        return null;
    }
    function _syncFollowButtons() {
        var set = _me().followedUserIds;
        if (!set || typeof set.has !== 'function') return;
        Array.prototype.forEach.call(document.querySelectorAll('.emp-post-follow[data-user-id]'), function (b) {
            var f = set.has(b.getAttribute('data-user-id'));
            if (b.classList.contains('followed') !== f) {
                b.classList.toggle('followed', f);
                b.innerHTML = f ? '<i class="fas fa-check"></i> Following' : 'Follow';
            }
        });
    }
    function _sweepPostAvatars() {
        var need = {}, db = _db();
        Array.prototype.forEach.call(document.querySelectorAll('.impact-story[data-emp-av="1"]'), function (card) {
            var uid = card.dataset.userId;
            if (!uid || uid === 'undefined' || uid === 'null' || uid === 'admin-user' || uid.indexOf('biz-') === 0) return;
            var img = card.querySelector('.story-header .avatar-placeholder img');
            if (!img) return;
            var best = _bestAvatarFor(uid);
            if (best) {
                if (img.dataset.empAvSet !== best) { img.dataset.empAvSet = best; img.src = best; }
            } else if (!_isReal(img.getAttribute('src')) && !_avMiss[uid] && !_avBusy[uid]) {
                need[uid] = 1;
            }
        });
        if (db) {
            Object.keys(need).slice(0, 40).forEach(function (uid) {
                _avBusy[uid] = true;
                db.collection('users').doc(uid).get().then(function (d) {
                    _avBusy[uid] = false;
                    var _ud = d && d.exists ? (d.data() || {}) : {}; var a = _ud.avatar; if (!_isReal(a)) a = _ud.profilePhoto || _ud.photoURL || a;   /* 2026-10-29: some accounts store the picture under profilePhoto/photoURL */
                    if (_isReal(a)) { window._empAvatarCache[uid] = a; _later(); } else { _avMiss[uid] = true; }
                }).catch(function () { _avBusy[uid] = false; _avMiss[uid] = true; });
            });
        }
        _syncFollowButtons();
    }
    window._empSweepPostAvatars = _sweepPostAvatars;
    var _swT = null;
    function _later() { clearTimeout(_swT); _swT = setTimeout(_sweepPostAvatars, 350); }
    try { new MutationObserver(_later).observe(document.body, { childList: true, subtree: true }); } catch (e) {}

    /* ── 4. Merge the stored Firestore profile into the live session ───────── */
    var TEXT_FIELDS = ['fullName', 'username', 'bio', 'phone', 'website', 'profession', 'education', 'maritalStatus', 'hobbies', 'location', 'isVerified', 'hasBlueBadge'];
    function _saveSession(us) {
        try {
            var s = Object.assign({}, us);
            Object.keys(s).forEach(function (k) { if (s[k] instanceof Set) s[k] = Array.from(s[k]); });
            delete s.password;
            localStorage.setItem('empyrean_session', JSON.stringify(s));
            /* FIX (2026-10-28 — follows/followers vanish after logout→login): the per-account
               cache 'empyrean_users' is what the fast/offline login and restoreLocalSession()
               read. Nothing refreshed it after a follow, so it kept the OLD follow list.
               Keep it in step with the live session (password is preserved, never rewritten). */
            if (s.email) {
                var all = JSON.parse(localStorage.getItem('empyrean_users') || '{}');
                var prev = all[s.email] || {};
                var merged = Object.assign({}, prev, s);
                if (prev.password) merged.password = prev.password;
                all[s.email] = merged;
                localStorage.setItem('empyrean_users', JSON.stringify(all));
            }
        } catch (e) {}
    }
    window._empSaveSessionCache = _saveSession;
    var _hydratedAt = {};
    function hydrate(uid, attempt) {
        attempt = attempt || 0;
        var db = _db(); if (!db || !uid) return;
        var us = _me();
        if (!us || us.id !== uid) {                       // session object not upgraded to the real uid yet
            if (attempt < 8) setTimeout(function () { hydrate(uid, attempt + 1); }, 1000);
            return;
        }
        if (_hydratedAt[uid] && Date.now() - _hydratedAt[uid] < 4000) return;
        _hydratedAt[uid] = Date.now();

        db.collection('users').doc(uid).get().then(function (doc) {
            if (!doc || !doc.exists) return;
            var s = doc.data() || {};
            us = _me();
            if (us.id !== uid) return;
            var changed = false, push = {}, FV = _fv();

            /* profile picture / cover: Firestore wins when it has a real one; otherwise push a real local one UP */
            if (_isReal(s.avatar)) {
                if (us.avatar !== s.avatar) { us.avatar = s.avatar; changed = true; }
            } else if (_isReal(us.avatar)) {
                push.avatar = us.avatar;
            }
            if (s.coverPhoto) {
                if (us.coverPhoto !== s.coverPhoto) { us.coverPhoto = s.coverPhoto; changed = true; }
            } else if (us.coverPhoto && !/^https:\/\/images\.unsplash\.com/i.test(us.coverPhoto)) {
                push.coverPhoto = us.coverPhoto;
            }
            TEXT_FIELDS.forEach(function (k) {
                if (s[k] !== undefined && s[k] !== null && s[k] !== '' && us[k] !== s[k]) { us[k] = s[k]; changed = true; }
            });

            /* follow list: Firestore is the truth, then re-apply follows/unfollows done during this session */
            var srv = Array.isArray(s.followedUserIds) ? s.followedUserIds : null;
            var cur = (us.followedUserIds instanceof Set) ? us.followedUserIds : new Set(Array.isArray(us.followedUserIds) ? us.followedUserIds : []);
            var next = new Set(srv || Array.from(cur));
            var ops = window._empFollowOps || {};
            Object.keys(ops).forEach(function (id) { if (ops[id]) next.add(id); else next['delete'](id); });
            if (!srv && cur.size && FV) push.followedUserIds = FV.arrayUnion.apply(FV, Array.from(cur));
            var same = next.size === cur.size && Array.from(next).every(function (id) { return cur.has(id); });
            if (!same || !(us.followedUserIds instanceof Set)) {
                if (!(us.followedUserIds instanceof Set)) us.followedUserIds = new Set();
                us.followedUserIds.clear();
                next.forEach(function (id) { us.followedUserIds.add(id); });
                changed = true;
            }

            try { if (window.mockUsers) { window.mockUsers[uid] = window.mockUsers[uid] || us; if (window.mockUsers[uid] !== us) { window.mockUsers[uid].avatar = us.avatar; window.mockUsers[uid].coverPhoto = us.coverPhoto; } } } catch (e) {}

            if (Object.keys(push).length) {
                db.collection('users').doc(uid).set(push, { merge: true }).catch(function (e) { _warn('push-up of local data refused', e); });
            }
            _saveSession(us);

            if (changed) {
                try { if (typeof window.propagateProfilePicture === 'function') window.propagateProfilePicture(); } catch (e) {}
                try { if (typeof window.renderSuggestedUsers === 'function') window.renderSuggestedUsers(); } catch (e) {}
                try {
                    var p = document.getElementById('profile');
                    if (p && p.offsetParent !== null && !window._viewingOtherProfile && typeof window.renderUserProfile === 'function') window.renderUserProfile(uid);
                } catch (e) {}
            }
            _sweepPostAvatars();
            window._empRefreshFollowerCount(uid);
            _flushQueue();
            console.log('[§49] session synced with Firestore profile' + (changed ? ' (updated)' : ''));
        }).catch(function (e) { _warn('profile sync failed', e); });
    }

    var _tries = 0;
    function _start() {
        if (!(window.fbAuth && typeof window.fbAuth.onAuthStateChanged === 'function')) {
            if (_tries++ < 90) setTimeout(_start, 1000);
            return;
        }
        window.fbAuth.onAuthStateChanged(function (u) {
            if (u && !u.isAnonymous) setTimeout(function () { hydrate(u.uid, 0); }, 1200);
        });
    }
    _start();
    document.addEventListener('empyrean-init-done', function () {
        var uid = _authUid();
        if (uid) setTimeout(function () { hydrate(uid, 0); }, 1500);
    });
    console.log('[§49] Session sync (picture / follows / follower counts) ready.');
})();
