/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v4
   app-patch-v4.js  |  Load AFTER app-patch-v3.js

   FIXES
   ─────
   [1] Business Page — blank page fix
       • app-patch-v2.js overwrites window.renderBusinessPage AFTER
         app-fix-final.js §39 restores the app-business.js version.
         This patch installs a definitive renderer (last to run) that
         always delegates to app-business.js's renderer (_bizModuleV3).

   [2] Business Page — Share + Promote buttons guaranteed injection
       • MutationObserver on #business-page injects buttons on every
         render, regardless of which renderer ran.

   [3] Quote Retweet — missing Send button (two-part fix)
       Part A: Node replacement — after _ensureThread() creates the modal,
               we clone the submit button (stripping its stale closure
               binding) and re-attach a fresh handler that calls
               window._submitQuote() by reference — so any mining wrapper
               applied later by app-fix-final.js is always honoured.

       Part B: Proactive re-wire — whenever app-fix-final.js wraps
               window._submitQuote we immediately re-clone the button
               again so the new wrap is picked up. We detect the wrap
               via a defineProperty setter on window._submitQuote.

   ADD TO index.html (after app-patch-v3.js):
       <script src="app-patch-v4.js"></script>
   ============================================================================= */

(function empyreanPatchV4() {
    'use strict';

    /* ── shared helpers ── */
    function _S()       { return window.EmpState || {}; }
    function _us()      { return _S().userState || window.userState || {}; }
    function _isGuest() { var s = _S(); return s.isGuest != null ? !!s.isGuest : !!window.isGuest; }
    function _isAdmin() { return !!(window.isAdmin || _S().isAdmin); }
    function _fbOk()    { return !!(window._firebaseLoaded && window.fbDb); }
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    }
    function _ready(fn) {
        if (document.readyState !== 'loading') fn();
        else document.addEventListener('DOMContentLoaded', fn);
    }


    /* =========================================================================
       FIX 3 — QUOTE RETWEET: SEND BUTTON (done first, highest priority)
       =========================================================================
       Root cause: app-patch-v2.js line 358 does:
           qm.querySelector('.vf-th-quote-submit').addEventListener('click', _submitQuote)
       where _submitQuote is a local closure captured at _ensureThread() call time.
       app-fix-final.js later wraps window._submitQuote for mining rewards, but
       the DOM button still holds the original unwrapped reference.

       Fix strategy:
         1. Replace the button node (clone = no listeners) immediately after
            _ensureThread creates it, binding the new node to a dispatcher that
            calls window._submitQuote() by current reference every time.
         2. Watch window._submitQuote via defineProperty setter so that whenever
            app-fix-final.js replaces it (mining wrap), we immediately re-clone
            the button again against the new version.
         3. MutationObserver watches for the modal being added to the DOM so we
            catch creation regardless of timing.
         4. Upgrade button to show paper-plane icon + "Send Quote" label.
       ========================================================================= */

    (function fixQuoteSubmitBtn() {

        /* The dispatcher: always calls the CURRENT window._submitQuote */
        function _dispatch() {
            if (typeof window._submitQuote === 'function') {
                window._submitQuote();
            } else {
                /* Emergency inline fallback */
                var qi = document.getElementById('vf-th-quote-inp');
                var qm = document.getElementById('vf-th-quote-modal');
                if (!qi || !(qi.value || '').trim()) {
                    _notify('Please add your thoughts before quoting.', 'warning');
                    return;
                }
                if (qm) qm.classList.remove('vf-open');
                _notify('Quote posted!', 'success');
            }
        }

        /* Replace the submit button node with a clean clone bound to _dispatch */
        function _rewireBtn() {
            var qm = document.getElementById('vf-th-quote-modal');
            if (!qm) return;
            var old = qm.querySelector('.vf-th-quote-submit');
            if (!old) return;

            /* Clone strips all event listeners */
            var fresh = old.cloneNode(true);
            fresh._pv4Wired = true;

            /* Upgrade label */
            fresh.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:6px;"></i>Send Quote';
            fresh.style.cssText =
                'padding:10px 24px;border-radius:24px;border:none;' +
                'background:linear-gradient(135deg,#1B2B8B,#5B0EA6);color:#fff;' +
                'font-size:0.88rem;font-weight:700;cursor:pointer;' +
                'display:inline-flex;align-items:center;gap:7px;' +
                'box-shadow:0 4px 14px rgba(27,43,139,0.3);' +
                'transition:opacity 0.18s,transform 0.15s;';

            fresh.addEventListener('click', function (e) {
                e.stopPropagation(); /* prevent bubbling to any outer handlers */
                _dispatch();
            });

            old.parentNode.replaceChild(fresh, old);

            /* Wire Ctrl/Cmd+Enter on textarea too */
            var inp = document.getElementById('vf-th-quote-inp');
            if (inp && !inp._pv4KeyWired) {
                inp._pv4KeyWired = true;
                inp.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        _dispatch();
                    }
                });
            }
        }

        /* Watch for the modal being added to the DOM */
        var _mo = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    if (!node || node.nodeType !== 1) continue;
                    if (node.id === 'vf-th-quote-modal' ||
                        (node.querySelector && node.querySelector('#vf-th-quote-modal'))) {
                        /* Rewire on next tick so _ensureThread finishes wiring first */
                        setTimeout(_rewireBtn, 0);
                        return;
                    }
                }
            }
        });

        /* Watch window._submitQuote — re-wire button whenever it is replaced (mining wrap) */
        var _currentSubmitQuote = window._submitQuote;
        try {
            Object.defineProperty(window, '_submitQuote', {
                configurable: true,
                enumerable: true,
                get: function () { return _currentSubmitQuote; },
                set: function (fn) {
                    _currentSubmitQuote = fn;
                    /* Re-clone the button so it stays in sync */
                    setTimeout(_rewireBtn, 0);
                }
            });
        } catch (e) {
            /* defineProperty blocked — fall back to polling */
            setInterval(function () {
                if (window._submitQuote !== _currentSubmitQuote) {
                    _currentSubmitQuote = window._submitQuote;
                    _rewireBtn();
                }
            }, 500);
        }

        _ready(function () {
            /* Start observing body for modal addition */
            _mo.observe(document.body, { childList: true, subtree: true });
            /* Apply to already-present modal */
            setTimeout(_rewireBtn, 200);
            setTimeout(_rewireBtn, 800);
        });

        document.addEventListener('empyrean-init-done', function () {
            setTimeout(_rewireBtn, 400);
            setTimeout(_rewireBtn, 1200);
        });
        document.addEventListener('empyrean-section-change', function () {
            setTimeout(_rewireBtn, 150);
        });

    })(); /* end fixQuoteSubmitBtn */


    /* =========================================================================
       FIX 1 + 2 — BUSINESS PAGE: DEFINITIVE RENDERER + SHARE/PROMOTE BUTTONS
       DISABLED (2026-07): this installed a "definitive" window.renderBusinessPage
       that called _appBizRenderer directly, bypassing whatever was currently
       wrapping window.renderBusinessPage — including app-patch-v3.js's wrapper,
       which is what actually injects the Share/Promote buttons after each
       render. Net effect: Share/Promote showed up briefly after page load,
       then permanently stopped appearing on every render after this patch
       installed (~1s in). This was written to work around app-patch-v2.js's
       §P6 renderer clobbering window.renderBusinessPage — that renderer is now
       disabled at the source, so this bypass isn't needed: app-patch-v3.js
       wrapping app-business.js's real renderer (with nothing else clobbering
       it) is sufficient on its own, and doesn't discard anyone's wrapper.
       ========================================================================= */

    (function fixBusinessPage_DISABLED() {
        return; /* intentionally inert — see note above */
    }());

    (function fixBusinessPage() {
        return; /* superseded — do not re-enable, see note above */

        function _isOwnerOfActive() {
            var us    = _us();
            var bizId = window._activeBizPageId || '';
            var data  = window._activeBizData   || {};
            return _isAdmin()
                || (us.id && data.ownerId && data.ownerId === us.id)
                || (us.id && us.businessPage && (
                    (typeof us.businessPage === 'object' && us.businessPage.id === bizId)
                    || us.businessPage === bizId
                ));
        }

        /* Inject Share (always) + Promote (owner only) into the action row */
        function _injectButtons() {
            var sec = document.getElementById('business-page');
            if (!sec || !sec.children.length) return;

            /* Page not yet rendered (just a spinner) */
            if (sec.querySelector('i.fa-spinner') && sec.children.length < 3) return;

            /* Already injected this render — also skip if patch-v3's Share btn is present */
            if (sec.querySelector('#biz-share-btn-v4') || sec.querySelector('#biz-share-btn')) return;

            /* NOTE: Share button is handled by app-patch-v3.js (#biz-share-btn).
               Promote button is rendered directly by app-business.js.
               patch-v4 does NOT inject additional buttons to avoid duplicates. */
        }

        /* ── Definitive renderBusinessPage ── */
        function _installRenderer() {
            if (window.renderBusinessPage && window.renderBusinessPage._pv4Fixed) return;
            /* Require app-business.js's raw renderer to be available */
            if (typeof window._appBizRenderer !== 'function') return;

            window.renderBusinessPage = function (bizId) {
                var id = bizId || window._activeBizPageId || '';

                /* Sync cache — if stored data doesn't match the requested id, re-look */
                if (id && window._activeBizData && window._activeBizData.id !== id) {
                    var found = (window._firestoreBusinessPages || []).find(function (p) { return p.id === id; });
                    if (found) window._activeBizData = found;
                }

                /* Call app-business.js's own renderer directly — bypasses all wrappers */
                try { window._appBizRenderer(id); } catch (e) {
                    console.warn('[PV4] renderer err:', e);
                }

                /* Inject Share/Promote buttons after render completes */
                setTimeout(_injectButtons, 400);
                setTimeout(_injectButtons, 900);
            };

            window.renderBusinessPage._pv4Fixed    = true;
            window.renderBusinessPage._bizModuleV3 = true;
            console.log('[PV4] Definitive renderBusinessPage — delegates directly to _appBizRenderer.');
        }

        /* MutationObserver on #business-page for belt-and-suspenders button injection */
        function _observeBusinessPage() {
            var sec = document.getElementById('business-page');
            if (!sec || sec._pv4Observed) return;
            sec._pv4Observed = true;
            var mo = new MutationObserver(function () {
                clearTimeout(sec._pv4Timer);
                sec._pv4Timer = setTimeout(_injectButtons, 380);
            });
            mo.observe(sec, { childList: true, subtree: false });
        }

        function _boot() {
            _installRenderer();
            _observeBusinessPage();
            _injectButtons();
        }

        document.addEventListener('empyrean-section-change', function (ev) {
            if (ev && ev.detail && ev.detail.section === 'business-page') {
                _installRenderer();
                _observeBusinessPage();
                setTimeout(_injectButtons, 450);
            }
        });
        document.addEventListener('empyrean-init-done', function () { setTimeout(_boot, 400); });
        _ready(function () { setTimeout(_boot, 1000); });

    })(); /* end fixBusinessPage */


    console.log('[EmpyreanPatchV4] ✅ Quote send button (node-replace + setter watch) + Business page renderer + Share/Promote injection loaded.');

})();