/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v43
   app-patch-v43.js  |  Load LAST (after app-patch-v42.js)

   SCOPE: "Go Live" section redesign per dev brief — premium card layout,
   refined typography, and three additive interaction changes, all scoped
   under the new `.golive-v2` namespace added to index.html's #go-live
   markup so nothing outside that section is touched:

     §1 CSS — card layout, rounded corners, soft shadows, micro-
        interactions, serif labels (Playfair Display — already imported
        by style.css's own @import, so no new font request) over
        sans-serif inputs (Inter, via the existing --font-ui token).
        Injected at runtime; style.css itself is never edited, per
        established convention.

     §2 Description field — index.html now gives #live-description its
        own single "Aa" icon (#golive-fmt-toggle) instead of the always-
        visible Bold/Italic/Strike/Font/Copy/Cut/Paste toolbar every
        other textarea in the app still keeps (app-fixes.js's FIX E,
        which had 'live-description' removed from its target id list —
        see that file's own comment at the same date). Clicking the icon
        opens a small dropdown (#golive-fmt-menu) with just Font/Bold/
        Italic/Strike, using the exact same *bold* / _italic_ / ~strike~
        wrapping convention as FIX E so any downstream renderer treats
        this field the same as every other formatted field in the app.

     §3 Background selector — FIXED a real bug along the way: app-
        fixes.js's own "LIVE STREAM PREMIUM BACKGROUNDS" block was
        overwriting the {label, style, category} objects
        populateBackgroundSelector() needs with bare CSS-gradient
        strings, so bg.category/bg.label/bg.style were all undefined and
        NOTHING ever rendered into #live-bg-selector — this is why the
        "Choose a Background" panel was empty. Restored as objects in
        app-fixes.js (see that file), expanded with more premium
        gradients + photos, and here: category filter chips (built into
        the now-empty #live-bg-categories) plus CSS turning the strip
        into a horizontally swipeable/scrollable row (scroll-snap) in
        place of the old fixed grid.

     §4 Actions — a new outlined Cancel button (#golive-cancel-btn,
        added in index.html) that resets the form and collapses the
        panel, alongside the existing Start Streaming button.

   Nothing here touches Agora, Firestore, or any live-broadcast logic —
   purely the pre-broadcast setup form's markup/behavior.
   ============================================================================= */

(function empyreanPatchV43() {
    'use strict';

    if (window._empPatchV43Loaded) {
        console.warn('[V43] Already loaded — skipping duplicate.');
        return;
    }
    window._empPatchV43Loaded = true;

    function log(msg) { console.log('[V43-GoLive] ' + msg); }

    /* =========================================================================
       §1 — CSS injection (idempotent — safe if this script re-executes).
       ========================================================================= */
    function _injectCSS() {
        if (document.getElementById('_pv43_golive_style')) return;
        var s = document.createElement('style');
        s.id = '_pv43_golive_style';
        s.textContent = [
            /* ── Card shell ── */
            '.golive-v2-card { border-radius: var(--radius-2xl, 20px) !important; overflow: hidden; box-shadow: 0 10px 36px rgba(10,14,39,0.10); }',
            '.golive-v2-card .card-content { padding: 22px !important; }',

            /* ── Primary CTA (toggle) ── */
            '.golive-v2-cta { display:flex; align-items:center; justify-content:center; gap:10px; width:100%; padding:14px 16px; background:linear-gradient(135deg,#7C3AED,#4F46E5); border:none; border-radius:999px; color:#fff; font-family: var(--font-ui); font-size:0.95rem; font-weight:700; letter-spacing:0.2px; cursor:pointer; box-shadow: 0 8px 22px rgba(79,70,229,0.30); transition: transform 0.2s ease, box-shadow 0.2s ease; }',
            '.golive-v2-cta:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(79,70,229,0.40); }',
            '.golive-v2-cta:active { transform: translateY(0); }',
            '.golive-v2-cta-icon { width:30px; height:30px; border-radius:50%; background:rgba(255,255,255,0.2); border:2px solid rgba(255,255,255,0.6); display:inline-flex; align-items:center; justify-content:center; font-size:1.15rem; color:#fff; transition: transform 0.3s ease; }',

            /* ── Panel entrance ── */
            '@keyframes goliveV2Enter { from { opacity:0; transform: translateY(-8px); } to { opacity:1; transform:none; } }',
            '.golive-v2-panel { padding-top:20px; }',
            '.golive-v2-panel.golive-v2-panel-enter { animation: goliveV2Enter 0.35s ease; }',

            /* ── Typography: serif labels/titles, sans-serif inputs ── */
            '.golive-v2-title { font-family: "Playfair Display", var(--font-display), serif; font-size:1.5rem; font-weight:700; color: var(--primary); margin: 0 0 6px; }',
            '.golive-v2-intro { font-family: var(--font-ui); color: var(--text-muted, #6B7280); font-size:0.93rem; line-height:1.55; margin: 0 0 20px; }',
            '.golive-v2-field { margin-bottom: 18px !important; }',
            '.golive-v2-field > label, .golive-v2-label-row label { font-family: "Playfair Display", var(--font-display), serif !important; text-transform:none !important; letter-spacing:0.2px !important; font-size:0.98rem !important; font-weight:700 !important; }',
            '.golive-v2-field input, .golive-v2-field textarea { font-family: var(--font-ui) !important; border-radius: var(--radius-lg, 14px) !important; }',
            '.golive-v2-label-row { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; flex-wrap:wrap; }',
            '.golive-v2-label-row label { margin-bottom:0 !important; }',

            /* ── Format ("Aa") dropdown ── */
            '.golive-v2-fmt-wrap { position:relative; }',
            '.golive-v2-fmt-btn { width:32px; height:32px; border-radius:50%; border:1.5px solid rgba(10,14,39,0.14); background:#fff; font-family:"Playfair Display",serif; font-weight:700; font-size:0.78rem; color: var(--primary); cursor:pointer; display:flex; align-items:center; justify-content:center; transition: all 0.2s ease; }',
            '.golive-v2-fmt-btn:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-1px); }',
            '.golive-v2-fmt-btn[aria-expanded="true"] { border-color: var(--accent); color: var(--accent); }',
            '.golive-v2-fmt-menu { position:absolute; top:calc(100% + 8px); right:0; z-index:40; background:#fff; border-radius:14px; box-shadow: 0 14px 36px rgba(10,14,39,0.20); padding:10px; display:flex; flex-direction:column; gap:8px; min-width:172px; }',
            '.golive-v2-fmt-menu[hidden] { display:none !important; }',
            '.golive-v2-fmt-font { width:100%; padding:7px 8px; border-radius:8px; border:1px solid rgba(10,14,39,0.14); font-size:0.8rem; font-family: var(--font-ui); color: var(--primary); cursor:pointer; }',
            '.golive-v2-fmt-row { display:flex; gap:6px; }',
            '.golive-v2-fmt-row button { flex:1; padding:6px 0; border-radius:8px; border:1px solid rgba(10,14,39,0.14); background:#fff; cursor:pointer; font-size:0.85rem; color: var(--primary); transition: all 0.15s ease; }',
            '.golive-v2-fmt-row button:hover { background: var(--accent); border-color: var(--accent); color:#111; }',

            /* ── Background category chips ── */
            '.golive-v2-bg-tabs { display:flex; gap:6px; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; }',
            '.golive-v2-bg-tabs::-webkit-scrollbar { display:none; }',
            '.golive-v2-bg-tab { flex:0 0 auto; padding:5px 13px; border-radius:999px; border:1px solid rgba(10,14,39,0.14); background:#fff; font-family: var(--font-ui); font-size:0.72rem; font-weight:700; letter-spacing:0.3px; white-space:nowrap; color: var(--primary); cursor:pointer; transition: all 0.18s ease; }',
            '.golive-v2-bg-tab:hover { border-color: var(--accent); }',
            '.golive-v2-bg-tab.active { background: var(--primary); border-color: var(--primary); color:#fff; }',

            /* ── Swipeable background strip (overrides the older fixed grid,
                 loaded earlier in app-fixes.js, per this codebase's
                 last-loaded-file-wins CSS cascade convention) ── */
            '#live-bg-selector.golive-v2-bg-strip { display:flex !important; grid-template-columns:none !important; flex-wrap:nowrap !important; overflow-x:auto !important; overflow-y:hidden !important; scroll-snap-type:x proximity; gap:12px !important; padding:4px 2px 14px !important; margin-top:10px !important; -webkit-overflow-scrolling:touch; }',
            '#go-live-form .golive-v2-bg-strip .bg-thumb { flex:0 0 106px !important; width:106px !important; height:106px !important; scroll-snap-align:start; }',
            '.golive-v2-bg-cat-header { display:none !important; }',
            '.golive-v2-bg-strip .bg-thumb[data-golive-hide] { display:none !important; }',
            '.golive-v2-upload-btn { border-radius:999px !important; font-family: var(--font-ui) !important; margin-top:12px !important; }',

            /* ── Actions row ── */
            '.golive-v2-actions { display:flex; gap:12px; margin-top:22px; }',
            '.golive-v2-cancel-btn { flex:1; background:transparent !important; border:1.5px solid rgba(10,14,39,0.20) !important; color: var(--primary) !important; border-radius:999px !important; box-shadow:none !important; font-weight:700 !important; font-family: var(--font-ui) !important; transition: all 0.18s ease !important; }',
            '.golive-v2-cancel-btn:hover { border-color: var(--primary) !important; background: rgba(10,14,39,0.05) !important; transform: translateY(-1px); }',
            '.golive-v2-submit-btn { flex:2; border-radius:999px !important; }'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    }

    /* =========================================================================
       §2 — background category chips + swipeable-strip tagging/filtering.
       ========================================================================= */
    var CATS = [
        { key: 'all', label: 'All' },
        { key: 'classic', label: 'Classic' },
        { key: 'premium', label: 'Premium' },
        { key: 'studio', label: 'Studio' },
        { key: 'photo', label: 'Photo' }
    ];
    var _activeCat = 'all';

    function _ensureTabs() {
        var wrap = document.getElementById('live-bg-categories');
        if (!wrap || wrap._pv43Built) return;
        wrap._pv43Built = true;
        CATS.forEach(function (c) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'golive-v2-bg-tab' + (c.key === 'all' ? ' active' : '');
            b.textContent = c.label;
            b.dataset.cat = c.key;
            b.addEventListener('click', function () {
                _activeCat = c.key;
                wrap.querySelectorAll('.golive-v2-bg-tab').forEach(function (t) { t.classList.toggle('active', t === b); });
                _applyFilter();
            });
            wrap.appendChild(b);
        });
    }

    function _applyFilter() {
        var container = document.getElementById('live-bg-selector');
        if (!container) return;
        container.querySelectorAll('.bg-thumb').forEach(function (t) {
            var cat = t.getAttribute('data-golive-cat');
            var show = (_activeCat === 'all') || (cat === _activeCat) || (cat === 'custom');
            t.toggleAttribute('data-golive-hide', !show);
        });
    }

    /* populateBackgroundSelector() (app-fixes.js) renders a flat run of
       category-header <div>s followed by their .bg-thumb children, with
       no class on the headers and no category info on the thumbs
       themselves. Rather than editing that closure-scoped function, we
       tag both from the outside: walk #live-bg-selector's children in
       DOM order, remembering the most recent header text as the
       "current category" for every .bg-thumb that follows it. */
    function _tagAndFilter() {
        var container = document.getElementById('live-bg-selector');
        if (!container) return;
        var currentCat = 'classic';
        Array.prototype.forEach.call(container.children, function (el) {
            if (el.classList && el.classList.contains('bg-thumb')) {
                var span = el.querySelector('span');
                if (span && span.textContent === 'Custom') {
                    el.setAttribute('data-golive-cat', 'custom');
                } else {
                    el.setAttribute('data-golive-cat', currentCat);
                }
            } else {
                var txt = (el.textContent || '').trim().toLowerCase();
                if (txt) {
                    currentCat = txt;
                    el.classList.add('golive-v2-bg-cat-header');
                }
            }
        });
        _applyFilter();
    }

    function _watchSelector() {
        var container = document.getElementById('live-bg-selector');
        if (!container) return;
        container.classList.add('golive-v2-bg-strip');
        _tagAndFilter();
        if (container._pv43Watched) return;
        container._pv43Watched = true;
        new MutationObserver(function () { _tagAndFilter(); }).observe(container, { childList: true });
    }

    /* =========================================================================
       §3 — "Aa" format dropdown for #live-description.
       ========================================================================= */
    function _wireFormatDropdown() {
        var toggle = document.getElementById('golive-fmt-toggle');
        var menu = document.getElementById('golive-fmt-menu');
        var ta = document.getElementById('live-description');
        if (!toggle || !menu || !ta || toggle._pv43Wired) return;
        toggle._pv43Wired = true;

        function _close() { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
        function _open() { menu.hidden = false; toggle.setAttribute('aria-expanded', 'true'); }

        toggle.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (menu.hidden) _open(); else _close();
        });

        document.addEventListener('click', function (e) {
            if (!menu.hidden && !e.target.closest('.golive-v2-fmt-wrap')) _close();
        });

        var fontSel = document.getElementById('golive-fmt-font');
        if (fontSel) {
            fontSel.addEventListener('change', function () {
                ta.style.fontFamily = this.value;
            });
        }

        /* Same *bold* / _italic_ / ~strike~ convention as app-fixes.js's
           FIX E toolbar (used by every other textarea in the app), so
           downstream rendering treats this field identically. */
        menu.querySelectorAll('button[data-golive-fmt]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                var fmt = this.dataset.goliveFmt;
                var s = ta.selectionStart, en = ta.selectionEnd;
                var sel = ta.value.substring(s, en);
                var wrappers = { bold: ['*', '*'], italic: ['_', '_'], strike: ['~', '~'] };
                var w = wrappers[fmt];
                if (w) ta.setRangeText(w[0] + sel + w[1], s, en, 'end');
                ta.focus();
            });
        });
    }

    /* =========================================================================
       §4 — Cancel button.
       ========================================================================= */
    function _wireCancel() {
        var btn = document.getElementById('golive-cancel-btn');
        if (!btn || btn._pv43Wired) return;
        btn._pv43Wired = true;
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            var form = document.getElementById('go-live-form');
            var panel = document.getElementById('golive-create-panel');
            var toggleBtn = document.querySelector('.section-create-toggle-btn[data-panel="golive-create-panel"]');
            if (form) form.reset();
            if (panel) panel.style.display = 'none';
            if (toggleBtn) {
                var icon = toggleBtn.querySelector('.section-create-icon');
                if (icon) { icon.textContent = '+'; icon.style.transform = 'rotate(0deg)'; }
            }
            var menu = document.getElementById('golive-fmt-menu');
            if (menu) menu.hidden = true;
            log('Go Live form cancelled and reset.');
        });
    }

    /* =========================================================================
       §5 — entrance animation + lazy init when the panel is opened. This is
       additive on top of app-fixes.js's own toggle handler (which sets
       panel.style.display) — both listeners are on document.body, so this
       one (attached later, since this file loads last) always runs after
       app-fixes.js's has already toggled the panel open/closed.
       ========================================================================= */
    function _wireEntranceAnimation() {
        document.body.addEventListener('click', function (e) {
            var btn = e.target.closest && e.target.closest('.section-create-toggle-btn[data-panel="golive-create-panel"]');
            if (!btn) return;
            setTimeout(function () {
                var panel = document.getElementById('golive-create-panel');
                if (!panel) return;
                if (panel.style.display !== 'none') {
                    panel.classList.remove('golive-v2-panel-enter');
                    void panel.offsetWidth; /* force reflow so the animation replays */
                    panel.classList.add('golive-v2-panel-enter');
                    _ensureTabs();
                    _watchSelector();
                }
            }, 0);
        });
    }

    function _boot() {
        _injectCSS();
        _ensureTabs();
        _watchSelector();
        _wireFormatDropdown();
        _wireCancel();
        _wireEntranceAnimation();
    }

    if (document.readyState !== 'loading') {
        setTimeout(_boot, 200);
    } else {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(_boot, 200); });
    }
    document.addEventListener('empyrean-init-done', function () { setTimeout(_boot, 300); });

    console.log('[EmpyreanPatchV43] \u2705 Go Live redesigned \u2014 premium card layout + typography, single "Aa" format dropdown on the description field, expanded/swipeable background strip with category chips (and the bug that left it empty fixed in app-fixes.js), and a new outlined Cancel button.');

})();