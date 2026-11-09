/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v7  (CONFLICT-AUDITED — v4)
   app-patch-v7.js  |  Load AFTER app-patch-v6.js

   FIXES
   ─────
   §A  CSS — lift buy-empy-modal z-index, fix close button stacking,
       TikTok keyframes, likeBubblePop keyframe (was referenced in
       app-fixes.js line 6137 but NEVER defined anywhere — root cause of
       the invisible like animation).

   §B  REMOVED (v4). Used to inject a circled "GIFTS" toggle pill that
       opened #live-gift-side-tab. That side-tab has since been deleted
       from index.html — the composer's #live-gift-btn is the single gift
       entry point now, so this section was removed rather than left
       injecting a button with nothing left to control.

   §C  Hide FABs during live stream — #quick-post-fab and
       #submit-complaint-fab both have z-index:99999+ so they paint over the
       live modal. A MutationObserver hides them when the live overlay opens
       and restores them via the existing updateQuickPostFab() / updateComplaintFab()
       functions when it closes, so nav-section logic stays intact.

   §D  Close button belt-and-suspenders (no stopPropagation).

   §E  Buy EMPY button belt-and-suspenders (no stopPropagation).

   §F  TikTok-style gift animations via MutationObserver on
       #gift-animation-layer — intercepts any particle from any closure-local
       caller and replaces it with multi-particle TikTok bursts.
   ============================================================================= */

(function empyreanPatchV7() {
    'use strict';

    /* =========================================================================
       §A  CSS
    ========================================================================= */
    (function injectCSS() {
        if (document.getElementById('_pv7_css')) return;
        var s = document.createElement('style');
        s.id = '_pv7_css';
        s.textContent = [

            /* 1 & 2. REMOVED (superseded): #live-gift-side-tab and its
               #_pv7_gift_toggle "GIFTS" pill used to give the live stream a
               second, redundant gift entry point floating on the right edge.
               The side-tab element itself has since been removed from
               index.html entirely — the composer's #live-gift-btn is now the
               single gift affordance, opening #live-gift-catalog-modal
               directly. Injecting a toggle button for an element that no
               longer exists just left a permanently non-functional circled
               "GIFTS" icon on screen, so both the CSS and the injection
               function below (§B) are removed rather than hidden. */

            /* 3. Fix close button inside live-sub-modal */
            '.live-sub-modal > .close-modal {',
            '    position: absolute !important;',
            '    top: 10px !important;',
            '    right: 12px !important;',
            '    z-index: 20 !important;',
            '    background: rgba(255,255,255,0.15) !important;',
            '    border: none !important;',
            '    color: #fff !important;',
            '    font-size: 1.4rem !important;',
            '    width: 32px !important;',
            '    height: 32px !important;',
            '    border-radius: 50% !important;',
            '    cursor: pointer !important;',
            '    display: flex !important;',
            '    align-items: center !important;',
            '    justify-content: center !important;',
            '    padding: 0 !important;',
            '    pointer-events: auto !important;',
            '}',

            /* 4. Buy EMPY modal above live stream */
            '#buy-empy-modal { z-index: 10000 !important; }',
            '#buy-empy-modal .modal-card { z-index: 10001 !important; position: relative !important; }',

            /* 5. Gift animation layer */
            '#gift-animation-layer {',
            '    position: absolute !important;',
            '    inset: 0 !important;',
            '    pointer-events: none !important;',
            '    overflow: hidden !important;',
            '    z-index: 50 !important;',
            '}',

            /* 6. TikTok gift keyframes */
            '@keyframes _pv7Rise  { 0%{opacity:1;transform:translateY(0) scale(1) rotate(0deg)} 40%{opacity:1;transform:translateY(-35%) scale(1.6) rotate(-8deg)} 70%{opacity:.9;transform:translateY(-70%) scale(2) rotate(6deg)} 100%{opacity:0;transform:translateY(-110%) scale(2.4) rotate(-4deg)} }',
            '@keyframes _pv7RiseR { 0%{opacity:1;transform:translateY(0) scale(1) rotate(0deg)} 40%{opacity:1;transform:translateY(-35%) scale(1.5) rotate(10deg)} 70%{opacity:.8;transform:translateY(-72%) scale(1.9) rotate(-5deg)} 100%{opacity:0;transform:translateY(-115%) scale(2.2) rotate(8deg)} }',
            '@keyframes _pv7RiseL { 0%{opacity:1;transform:translateY(0) scale(1) rotate(0deg)} 40%{opacity:1;transform:translateY(-40%) scale(1.7) rotate(-12deg)} 70%{opacity:.7;transform:translateY(-75%) scale(2.1) rotate(7deg)} 100%{opacity:0;transform:translateY(-105%) scale(2.5) rotate(-6deg)} }',
            '@keyframes _pv7Spiral{ 0%{opacity:1;transform:translate(0,0) scale(1) rotate(0deg)} 25%{opacity:1;transform:translate(-15px,-25%) scale(1.5) rotate(-20deg)} 50%{opacity:.9;transform:translate(12px,-55%) scale(1.9) rotate(15deg)} 75%{opacity:.5;transform:translate(-8px,-85%) scale(2.3) rotate(-10deg)} 100%{opacity:0;transform:translate(0,-115%) scale(2.8) rotate(5deg)} }',
            '@keyframes _pv7Burst { 0%{opacity:1;transform:scale(0.3) rotate(0deg)} 20%{opacity:1;transform:scale(2.2) rotate(20deg)} 50%{opacity:1;transform:scale(1.8) rotate(-10deg) translateY(-30%)} 80%{opacity:.6;transform:scale(2.4) rotate(5deg) translateY(-75%)} 100%{opacity:0;transform:scale(3) rotate(-5deg) translateY(-110%)} }',
            '@keyframes _pv7Glow  { 0%,100%{filter:drop-shadow(0 0 4px gold)} 50%{filter:drop-shadow(0 0 16px gold) drop-shadow(0 0 32px orange)} }',

            /* 7. likeBubblePop — was referenced in app-fixes.js line 6137 but           */
            /*    NEVER defined in any file. Heart element was created + appended but      */
            /*    played no animation (no keyframe = invisible). Defined here to fix it.  */
            '@keyframes likeBubblePop {',
            '    0%   { opacity: 1; transform: translateY(0)    scale(0.6); }',
            '    25%  { opacity: 1; transform: translateY(-8px)  scale(1.4); }',
            '    55%  { opacity: 1; transform: translateY(-28px) scale(1.1); }',
            '    80%  { opacity: 0.6; transform: translateY(-55px) scale(1.3); }',
            '    100% { opacity: 0; transform: translateY(-80px) scale(1.6); }',
            '}'

        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    })();


    /* =========================================================================
       §B  REMOVED — used to inject #_pv7_gift_toggle (the circled "GIFTS"
       pill) and watch the live modal to reset it. Both existed only to
       operate #live-gift-side-tab, which has been removed from index.html.
       The composer's #live-gift-btn (see app-live-tiktok-patch.js) is the
       one and only gift entry point now.
    ========================================================================= */


    /* =========================================================================
       §C  Hide FABs (#quick-post-fab, #submit-complaint-fab) during live
           stream. Restores via existing window functions on close so section-
           nav visibility logic stays intact.
    ========================================================================= */
    function _watchFabsForLive() {
        var overlay = document.getElementById('go-live-modal-overlay');
        if (!overlay || overlay._pv7FabWatched) return;
        overlay._pv7FabWatched = true;

        new MutationObserver(function () {
            var isLive  = overlay.classList.contains('show');
            var qfab    = document.getElementById('quick-post-fab');
            var cfab    = document.getElementById('submit-complaint-fab');

            if (isLive) {
                // Hide both FABs while live stream is open
                if (qfab) qfab.style.setProperty('display', 'none', 'important');
                if (cfab) cfab.style.setProperty('display', 'none', 'important');
            } else {
                // Restore via existing functions so section-nav logic applies
                if (typeof window.updateQuickPostFab === 'function') {
                    window.updateQuickPostFab(window._currentSection || 'dashboard');
                } else if (qfab) {
                    qfab.style.removeProperty('display');
                }
                if (cfab) cfab.style.removeProperty('display');
            }
        }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
    }


    /* =========================================================================
       §D  Close button belt-and-suspenders (no stopPropagation)
    ========================================================================= */
    function _wireGiftCatalogClose() {
        var modal = document.getElementById('live-gift-catalog-modal');
        if (!modal || modal._pv7CloseWired) return;
        modal._pv7CloseWired = true;
        var closeBtn = modal.querySelector('.close-modal');
        if (!closeBtn) return;
        closeBtn.addEventListener('click', function () {
            modal.classList.remove('show');
            modal.style.display = '';
        });
    }


    /* =========================================================================
       §E  Buy EMPY button belt-and-suspenders (no stopPropagation)
    ========================================================================= */
    function _wireBuyEmpyBtn() {
        var catalogModal = document.getElementById('live-gift-catalog-modal');
        var buyModal     = document.getElementById('buy-empy-modal');
        if (!catalogModal || !buyModal || catalogModal._pv7BuyWired) return;
        catalogModal._pv7BuyWired = true;
        catalogModal.addEventListener('click', function (e) {
            if (!e.target || !e.target.closest) return;
            if (!e.target.closest('#buy-empy-btn')) return;
            buyModal.classList.add('show');
            buyModal.style.removeProperty('display');
            document.body.classList.add('modal-open');
        });
    }


    /* =========================================================================
       §H  Gift button — SOLE handler now (no more racy isLive check)
       The old approach here backed off whenever `liveStreamData.isLive` was
       true, trusting the handler inside app-fixes.js's giant delegated
       click listener to open the modal instead. That trust was misplaced:
       `isLive` is set from a Firestore round-trip and can still be
       false/stale for a beat after the UI already looks live, and on a
       slow connection (confirmed in the field — sub-1KB/s at times) that
       gap is long enough for a real tap to land in it. Rather than guess
       which handler will win, this now ALWAYS opens the modal itself and
       calls stopImmediatePropagation so app-fixes.js's copy never runs at
       all — one reliable owner instead of two handlers racing.
    ========================================================================= */
    // FIX (bug: "gift icon and share icon work once then freeze"): there
    // used to be THREE independent click handlers reacting to each of these
    // two buttons -- one here, one in app-fixes.js, and (for share) a third
    // in app-live-tiktok-patch.js. Multiple handlers firing on what looks
    // like the same tap is the actual root cause, not any one handler's
    // internal logic. The other copies have all been disabled (search each
    // file for "DISABLED (bug: ... works once then freezes)") so these two
    // functions are now the ONE AND ONLY place either button is handled.
    // The share button's Firestore share-count increment (previously done
    // in a second, now-disabled handler in app-live-tiktok-patch.js) has
    // been folded in here too, so nothing was lost by removing the others.
    // Each handler body stays wrapped in try/catch (SAFETY NET pattern used
    // elsewhere in this codebase) so a thrown error can never eat a tap.
    function _wireGiftBtn() {
        var btn = document.getElementById('live-gift-btn');
        if (!btn || !document.getElementById('live-gift-catalog-modal')) return;
        if (btn._pv7GiftWired) {
            // DIAG: if this fires, _wireGiftBtn() is being called again on
            // the SAME node that's already wired -- harmless (we return
            // right after), but if you see this logged many times back to
            // back it tells us something is calling _wireGiftBtn() in a
            // tight loop, which is worth knowing.
            console.log('[GiftBtn][DIAG] _wireGiftBtn() called again — already wired, skipping.');
            return;
        }
        btn._pv7GiftWired = true;
        console.log('[GiftBtn][DIAG] wiring click listener to', btn);
        btn.addEventListener('click', function (e) {
            e.stopImmediatePropagation();
            e.preventDefault();
            try {
                // SAFETY NET: re-look-up the modal HERE, at click time,
                // instead of trusting a `modal` variable captured once back
                // when _wireGiftBtn() ran. If the modal element is ever
                // rebuilt/replaced after wiring, a captured reference would
                // keep toggling a detached node forever -- 'show' would
                // silently flip on an element no longer in the document,
                // which looks exactly like "the gift icon stopped working"
                // even though the tap itself lands fine every time.
                // getElementById always finds whatever copy is live now.
                var modalNow = document.getElementById('live-gift-catalog-modal');
                console.log('[GiftBtn][DIAG] click fired. modalNow found?', !!modalNow,
                    '| in document?', modalNow ? document.contains(modalNow) : 'n/a',
                    '| classList before:', modalNow ? modalNow.className : 'n/a');
                if (!modalNow) return;
                // CHANGED: always OPEN on tap, never toggle closed. The modal
                // already has its own dedicated close (X) button wired up in
                // _wireGiftCatalogClose() above -- that's the only thing that
                // should ever remove 'show'. Toggling here meant every SECOND
                // tap of the icon closed the panel you'd just opened, which
                // looked exactly like "the gift icon stopped working" even
                // though it was behaving exactly as coded.
                // FIX (bug: "gift icon works once then just blinks after
                // that"): confirmed via stack trace -- app-nav.js has its
                // own capture-phase close-button handler (registered before
                // this one, and calling stopImmediatePropagation) that also
                // matches this modal's close button and closes it by doing
                // BOTH modal.classList.remove('show') AND
                // modal.style.display = 'none' (an inline style). Because
                // it runs in capture phase and stops propagation, our own
                // close handler in _wireGiftCatalogClose() -- which resets
                // style.display back to '' -- never gets a chance to run.
                // That leaves a stale inline `display:none` on the modal
                // permanently. An inline style always beats a class-based
                // CSS rule, so every tap after that first close correctly
                // added the 'show' class (confirmed in the DIAG log above)
                // but the modal stayed invisible regardless -- exactly the
                // "blinks but doesn't open" symptom. Clearing the inline
                // style here too means it doesn't matter which code path
                // closed the modal; opening it always actually works.
                modalNow.style.removeProperty('display');
                modalNow.classList.add('show');
                console.log('[GiftBtn][DIAG] classList after:', modalNow.className);
                document.getElementById('live-viewers-modal')?.classList.remove('show');
                document.getElementById('tk-viewer-rankings-modal')?.classList.remove('show');
                if (typeof window.updateWalletUI === 'function') window.updateWalletUI();
            } catch (giftBtnErr) {
                console.error('[GiftBtn] tap failed:', giftBtnErr && giftBtnErr.message, giftBtnErr);
            }
        });
    }

    /* Same fix, same reasoning, for the share button. */
    function _wireShareBtn() {
        var btn = document.querySelector('.live-footer .share-live-btn');
        if (!btn || btn._pv7ShareWired) return;
        btn._pv7ShareWired = true;
        btn.addEventListener('click', function (e) {
            e.stopImmediatePropagation();
            e.preventDefault();
            try {
                // Firestore share-count increment (folded in from the
                // now-disabled copy in app-live-tiktok-patch.js).
                var db = window.fbDb;
                var sd = window.liveStreamData || {};
                var FV = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
                if (db && FV && sd.streamId && window._firebaseLoaded) {
                    db.collection('active_streams').doc(sd.streamId)
                        .update({ shares: FV.increment(1) })
                        .catch(function () {});
                }
                var badge = document.getElementById('tk-share-count');
                if (badge) badge.textContent = (parseInt(badge.textContent, 10) || 0) + 1;

                // Share sheet.
                if (typeof window.shareContent === 'function') {
                    var hostNameEl = document.getElementById('live-host-name');
                    window.shareContent({
                        title: 'Live Stream: ' + (sd.title || 'Empyrean Live'),
                        text: 'Join ' + (hostNameEl ? hostNameEl.textContent : 'this') + '\'s live stream on Empyrean!',
                        url: window.location.href.split('#')[0] + '#live/' + (sd.streamId || '')
                    }).catch(function (shareErr) {
                        console.error('[ShareBtn] shareContent rejected:', shareErr && shareErr.message, shareErr);
                    });
                }
            } catch (shareBtnErr) {
                console.error('[ShareBtn] tap failed:', shareBtnErr && shareBtnErr.message, shareBtnErr);
            }
        });
    }

    // FIX (same bug, belt-and-suspenders): re-run the two wiring functions
    // whenever the live footer's contents change (e.g.
    // app-live-tiktok-patch.js restructuring the footer when the modal
    // opens), instead of trusting only the fixed boot/init/section-change
    // timers below. Both functions already no-op instantly once a given
    // node is wired (`_pv7GiftWired`/`_pv7ShareWired`), so this costs
    // nothing on the common case and only does real work the moment
    // either button is ever swapped for a fresh, unwired node.
    function _watchLiveFooterForRewire() {
        var footer = document.querySelector('.live-footer');
        if (!footer || footer._pv7FooterWatched) return;
        footer._pv7FooterWatched = true;
        new MutationObserver(function () {
            _wireGiftBtn();
            _wireShareBtn();
        }).observe(footer, { childList: true, subtree: true });
    }

    /* =========================================================================
       §I  Viewer-count expand + host-control-panel toggle — same disease,
       same cure. Both `.live-viewers` (tap the eye/user count to open the
       viewer list) and `#host-control-toggle-btn` (the chevron that slides
       the host tool stack out) live ONLY inside app-fixes.js's big
       `if (liveStreamData.isLive) {...}` delegated listener. The viewer
       COUNT NUMBER itself updates fine because that comes from a separate
       Firestore listener — it's specifically the tap-to-expand/tap-to-slide
       interaction that was silently swallowed whenever isLive hadn't
       resolved yet at tap time. Wired here exactly like the gift/share
       buttons above: always fires, takes exclusive ownership.
    ========================================================================= */
    // FIX (removed _wireViewerCountBtn — dead code): this used to bind a
    // click listener directly to `.live-viewers` and call
    // stopImmediatePropagation(). app-live-tiktok-patch.js later added a
    // capture-phase document listener for the exact same button (loads
    // after this file, and capture-phase always runs before a target-bound
    // bubble listener can ever be reached), so this copy could never fire
    // — every tap was already intercepted before it got here. Keeping dead
    // code that looks functional wastes debugging time on the wrong file
    // (confirmed: several fix attempts were made here that could never
    // have worked). _populateViewerList() below is still used — it's
    // exposed as window._empyPopulateViewerList and called by the
    // surviving handler in app-live-tiktok-patch.js.

    // FIX (gap: viewer list and viewer count disagreed): this used to only
    // list the host + accepted guests, while the top-of-screen number
    // (app-live.js's _startViewerCountListener) is now driven by the real
    // active_streams/{id}/viewers presence subcollection — so the modal
    // could show "2 people" under a count that said "37 viewers". Both now
    // read from the same source and apply the same 45s staleness cutoff,
    // so the list total always matches the badge.
    function _populateViewerList() {
        var listEl = document.getElementById('viewer-list-container');
        var countEl = document.getElementById('modal-viewer-count');
        if (!listEl) return;
        var db = window.fbDb;
        var sd = window.liveStreamData || {};
        var sid = sd.streamId;
        if (!db || !sid || !window._firebaseLoaded) {
            listEl.innerHTML = '<p style="text-align:center; color:#ccc; padding:20px;">Viewer list unavailable right now.</p>';
            return;
        }
        var streamRef = db.collection('active_streams').doc(sid);
        Promise.all([streamRef.get(), streamRef.collection('viewers').get()]).then(function (results) {
            var docSnap = results[0], viewersSnap = results[1];
            if (!docSnap.exists) return;
            var data = docSnap.data() || {};
            var rows = [];
            var seen = {}; // de-dup: a guest broadcaster also has a presence doc
            rows.push({
                avatar: data.hostAvatar || '',
                name: data.hostName || 'Host',
                username: data.hostUsername || '',
                tag: ' (Host)'
            });
            if (data.hostId) seen[data.hostId] = true;
            (data.guests || []).forEach(function (g) {
                if (g.userId && seen[g.userId]) return;
                if (g.userId) seen[g.userId] = true;
                rows.push({ avatar: g.avatar || '', name: g.fullName || g.username || 'Guest', username: g.username || '', tag: ' (Guest)' });
            });
            var now = Date.now();
            viewersSnap.forEach(function (doc) {
                var v = doc.data() || {};
                if (v.userId && seen[v.userId]) return;
                var seenAt = v.lastSeen ? new Date(v.lastSeen).getTime() : 0;
                if (now - seenAt >= 45000) return; // stale/ghost presence doc
                if (v.userId) seen[v.userId] = true;
                rows.push({ avatar: v.avatar || '', name: v.fullName || v.username || 'Viewer', username: v.username || '', tag: '' });
            });
            if (countEl) countEl.textContent = rows.length;
            listEl.innerHTML = rows.map(function (r) {
                return '<div class="viewer-item"><img src="' + r.avatar + '" alt="' + r.name + '">' +
                    '<div class="viewer-item-info"><strong>' + r.name + '</strong><span>@' + r.username + r.tag + '</span></div></div>';
            }).join('');
        }).catch(function () {
            listEl.innerHTML = '<p style="text-align:center; color:#ccc; padding:20px;">Couldn\'t load viewers — try again.</p>';
        });
    }

    // FIX (removed _wireHostControlToggle — dead code, same reason as
    // _wireViewerCountBtn above): bound directly to #host-control-toggle-btn
    // and called stopImmediatePropagation(), but app-live-tiktok-patch.js's
    // capture-phase document listener for the same button always runs
    // first and stops the event before it ever reaches this target-bound
    // listener. This copy — including its [HCP-DEBUG] logging — could
    // never actually execute; removed so future fixes for the host-panel
    // toggle land in the one file that's actually reachable.


    /* =========================================================================
       §F  TikTok gift animations via MutationObserver on #gift-animation-layer
    ========================================================================= */
    var _ANIMS = ['_pv7Rise', '_pv7RiseR', '_pv7RiseL', '_pv7Spiral'];

    function _priceFor(symbol, giftName) {
        var catalog = window.empyGiftCatalog || [];
        // Prefer matching by name -- reliable regardless of icon markup.
        if (giftName) {
            for (var i = 0; i < catalog.length; i++) {
                if (catalog[i].name === giftName) return catalog[i].price;
            }
        }
        // Fallback: exact symbol match (works for plain-emoji callers, or if
        // no name was supplied).
        for (var j = 0; j < catalog.length; j++) {
            if (catalog[j].symbol === symbol) return catalog[j].price;
        }
        return 0;
    }

    function _particleCount(price) {
        if (price > 500) return 12;
        if (price > 100) return 8;
        if (price > 20)  return 5;
        return 3;
    }

    function _spawnTikTokBurst(symbol, giftName, layer) {
        if (!symbol || !layer) return;
        var price     = _priceFor(symbol, giftName);
        var count     = _particleCount(price);
        var isPremium = price > 500;
        var isMid     = price > 100;

        for (var i = 0; i < count; i++) {
            (function (idx) {
                setTimeout(function () {
                    var el       = document.createElement('div');
                    el.innerHTML = symbol; // symbol is SVG markup (or, for callers still passing raw emoji, plain text) — innerHTML handles both
                    var xPct     = (15 + Math.random() * (isPremium ? 70 : isMid ? 55 : 40)).toFixed(1);
                    var fontSize = (isPremium ? 2.8 : isMid ? 2.2 : 1.8) + Math.random() * 0.8;
                    var dur      = (1.8 + Math.random() * 1.0).toFixed(2);
                    var ease     = 'cubic-bezier(0.25,0.46,0.45,0.94)';
                    var anim     = (isPremium && idx === 0) ? '_pv7Burst' : _ANIMS[idx % _ANIMS.length];
                    var glow     = isPremium ? ',_pv7Glow ' + dur + 's ease-in-out infinite' : '';
                    // FIX (feature: "gift should appear at the middle instead of the
                    // bottom"): was hardcoded to bottom:80px, which anchors every
                    // burst near the footer. Anchoring from `top` at ~38-50% of the
                    // layer's height centers it vertically instead, with a little
                    // randomness so multiple particles don't stack in an identical line.
                    var yPct = (38 + Math.random() * 12).toFixed(1); // 38%-50% from top
                    el.style.cssText = 'position:absolute;top:' + yPct + '%;left:' + xPct + '%;font-size:' + fontSize.toFixed(1) + 'rem;z-index:51;pointer-events:none;user-select:none;animation:' + anim + ' ' + dur + 's ' + ease + ' forwards' + glow;
                    layer.appendChild(el);
                    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, Math.ceil(parseFloat(dur) * 1000) + 300);
                }, idx * 120);
            })(i);
        }
    }

    function _watchAnimLayer() {
        var layer = document.getElementById('gift-animation-layer');
        if (!layer || layer._pv7AnimWatched) return;
        layer._pv7AnimWatched = true;
        new MutationObserver(function (mutations) {
            mutations.forEach(function (mut) {
                mut.addedNodes.forEach(function (node) {
                    if (!(node instanceof HTMLElement)) return;
                    if (node.classList.contains('heart-mill-animation')) return; // keep Heart Mills
                    var anim = (node.style && node.style.animation) || '';
                    if (anim.indexOf('_pv7') !== -1) return; // skip own particles

                    // FIX (session 2026-07-19, sixth follow-up — root cause of
                    // "small gift magnification / token background / horizontal
                    // float" never sticking no matter how style.css or
                    // app-fixes.js's showGiftAnimation() were edited): THIS
                    // observer fires for every single node app-fixes.js appends
                    // to #gift-animation-layer, with no exception for tier.
                    // Until this fix, it unconditionally deleted the node --
                    // including ones showGiftAnimation() had already correctly
                    // tagged with 'gift-animation-small' (reduced scale,
                    // horizontal giftFloatSmall/giftFloatSmallLeft drift --
                    // see style.css) and/or 'gift-animation-token' (transparent,
                    // no-background coin) -- and replaced it with this file's
                    // own generic multi-particle burst, which has no concept of
                    // "small" at all: every replacement particle gets the same
                    // vertical _pv7Rise/_pv7Spiral/_pv7Burst keyframes (scale
                    // climbing past 2x-3x, not the 0.42-0.5 the small tier
                    // wants) and is a brand-new element that never carries the
                    // original's classes, so a floated Empy Token always kept
                    // its square background too. Every earlier attempt to fix
                    // this at the style.css/showGiftAnimation layer was
                    // therefore being silently overwritten by this exact block,
                    // one tick after it ran.
                    //
                    // Fix: a small-tier or token particle is left completely
                    // alone here -- app-fixes.js + style.css's own handling for
                    // those classes is authoritative and is not touched by this
                    // patch. Only gifts that are NEITHER small nor token (i.e.
                    // rare/epic/legendary, non-token gifts) still get the big
                    // multi-particle TikTok burst below, exactly as before.
                    //
                    // FIX (bug: "4th avatar row horizontal float send gift
                    // display was not implemented"): app-fixes.js's
                    // showGiftAnimation() anchors a gift to the 4th
                    // guest-box tile (via top/left inline styles + the
                    // 'gift-animation-avatar-anchor' class) for EVERY tier,
                    // not just small ones -- see that function's own
                    // comment ("Anchoring is now independent of tier").
                    // This observer, however, only ever skipped
                    // 'gift-animation-small'/'gift-animation-token'
                    // particles; an anchored epic/legendary gift (neither
                    // small nor token) still fell through to the delete-
                    // and-replace path below, which spawns brand-new
                    // particles at random xPct/yPct positions with no idea
                    // the original was anchored -- silently discarding the
                    // 4th-tile position every time for those tiers. That's
                    // the entire reason the feature looked unimplemented.
                    // Anchored particles are now left alone here too, same
                    // as small/token, so they keep the exact position
                    // app-fixes.js set and animate via their own CSS
                    // (base .gift-animation's vertical giftFloat rise,
                    // since only the small-tier variant also gets the
                    // horizontal drift -- see style.css).
                    if (node.classList.contains('gift-animation-small') || node.classList.contains('gift-animation-token') || node.classList.contains('gift-animation-avatar-anchor')) {
                        return;
                    }

                    // FIX (unified icon set): gift symbols are now SVG icon
                    // markup, not plain emoji characters, so `.textContent`
                    // (which only ever sees text nodes, and SVG shape elements
                    // like <path>/<circle> have none) always returned '' here,
                    // silently disabling the whole burst effect. `.innerHTML`
                    // captures the actual markup either way -- plain emoji
                    // strings still round-trip through it unchanged.
                    var symbol = (node.innerHTML || '').trim();
                    if (!symbol) return;
                    var giftName = node.dataset ? node.dataset.giftName : '';
                    if (node.parentNode) node.parentNode.removeChild(node); // remove plain particle
                    _spawnTikTokBurst(symbol, giftName, layer);
                });
            });
        }).observe(layer, { childList: true });
    }


    /* =========================================================================
       §F.5  DIAGNOSTIC ONLY — trace every class change on the gift modal
       =========================================================================
       FIX to the diagnostic itself: the previous version of this used a
       MutationObserver and logged `new Error().stack` inside its callback.
       That stack is useless for finding the real culprit -- MutationObserver
       callbacks always run as a disconnected microtask, so the captured
       stack only ever shows this observer's own dispatch frames (confirmed
       by every report so far pointing at the same two lines in THIS file).
       This version instead patches classList.add/remove/toggle directly on
       this one modal element, so the stack is captured synchronously, at
       the exact moment and in the exact call stack of whatever code is
       actually calling it -- add/remove/toggle every one else's calls are
       completely unaffected since these are only overridden on this single
       element's own classList instance.
    ========================================================================= */
    function _watchGiftModalClassChanges() {
        var modal = document.getElementById('live-gift-catalog-modal');
        if (!modal || modal._pv7ClassWatched) return;
        modal._pv7ClassWatched = true;
        console.log('[GiftModal][DIAG] classList interceptor attached. Current class:', modal.className);
        ['add', 'remove', 'toggle'].forEach(function (methodName) {
            var original = modal.classList[methodName];
            modal.classList[methodName] = function () {
                var argsList = Array.prototype.slice.call(arguments);
                var result = original.apply(modal.classList, argsList);
                console.log('[GiftModal][DIAG] classList.' + methodName + '(' + argsList.join(', ') + ') called. class is now:', modal.className, '\ncaller stack:', new Error().stack);
                return result;
            };
        });
        // Also catch direct `.className = '...'` reassignment, which some
        // other code in this codebase uses instead of classList.
        var classNameDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'className');
        Object.defineProperty(modal, 'className', {
            configurable: true,
            get: function () { return classNameDescriptor.get.call(modal); },
            set: function (value) {
                console.log('[GiftModal][DIAG] className = "' + value + '" (direct reassignment). Was:', modal.getAttribute('class'), '\ncaller stack:', new Error().stack);
                return classNameDescriptor.set.call(modal, value);
            }
        });
    }


    /* =========================================================================
       §G  Boot
    ========================================================================= */
    function _boot() {
        window._empyPopulateViewerList = _populateViewerList;
        _watchFabsForLive();
        _wireGiftCatalogClose();
        _wireBuyEmpyBtn();
        _wireGiftBtn();
        _wireShareBtn();
        _watchLiveFooterForRewire();
        _watchGiftModalClassChanges();
        _watchAnimLayer();
    }

    if (document.readyState !== 'loading') {
        setTimeout(_boot, 400);
    } else {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(_boot, 400); });
    }
    document.addEventListener('empyrean-init-done', function () {
        setTimeout(function () {
            _watchFabsForLive();
            _wireGiftCatalogClose();
            _wireBuyEmpyBtn();
            _wireGiftBtn();
            _wireShareBtn();
            _watchLiveFooterForRewire();
            _watchGiftModalClassChanges();
            _watchAnimLayer();
        }, 600);
    });

    // Also re-wire every time the live modal itself opens — §H/§I buttons
    // are static markup so they normally only need wiring once, but this
    // costs nothing (each function no-ops once already wired) and closes
    // any timing gap on the very first stream of a session.
    document.addEventListener('empyrean-section-change', function () {
        setTimeout(function () {
            _wireGiftBtn();
            _wireShareBtn();
            _watchLiveFooterForRewire();
        }, 200);
    });

    console.log('[EmpyreanPatchV7] v7 ✅ Gift/share are the sole, always-on handlers (no longer racing app-fixes.js\'s isLive-gated copies). Viewer-count/host-panel-toggle wiring removed — now owned exclusively by app-live-tiktok-patch.js\'s capture-phase handler. FABs hidden in live, likeBubblePop defined, TikTok animations active.');

})();