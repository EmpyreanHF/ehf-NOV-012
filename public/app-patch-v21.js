/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v21 (rewritten — supersedes v22, which is
   now removed from index.html; its fix is folded in here)
   app-patch-v21.js  |  Load AFTER app-patch-v20.js

   ═══════════════════════════════════════════════════════════════════════
   ROOT CAUSE, CONFIRMED VIA LIVE CONSOLE DIAGNOSTIC (not guessed this time):

     { salesType:"direct", sellerId:"pvz47en...", promoteVisible:true }  <- not owner, Promote leaking
     { salesType:"escrow", sellerId:"<anyone>",   addToCartVisible:true, promoteVisible:true } <- ALWAYS true, every escrow card

   Every affected card had parent:"property-grid-container". That grid is
   populated by app-fixes.js's marketplace_listings Firestore onSnapshot
   listener, which builds each card via raw innerHTML directly and NEVER
   calls window.renderMarketplaceCards() afterward. Every owner-gating fix
   written so far (the promoteBtn toggle in app-marketplace.js, v21's
   original Part 1, v22) only runs *inside* renderMarketplaceCards()'s own
   sweep — so none of it has ever actually reached cards built by this
   other path. That's the real bug: not a mislabel, not a missing check,
   but an entire rendering path nothing was sweeping.
   ═══════════════════════════════════════════════════════════════════════

   PART 1 — Contact button: owner-hide + label-race fix (was v21 Part 1 +
            v22, merged here so v22's separate file is no longer needed).
   PART 2 — Two-way marketplace chat (unchanged from before): buyer
            messages route through window.openChat() and sellers discover
            new threads via a chats participants array-contains listener.
   PART 3 — NEW: a container-agnostic sweep that force-corrects Add to
            Cart / Promote / Edit / Delete visibility on EVERY card
            regardless of which file created it or which grid it lives in
            — the fix for the console-confirmed bug above.
   ============================================================================= */

(function empyreanPatchV21_Part1_ContactButton() {
    'use strict';

    function _us() {
        var s = window.EmpState || {};
        return s.userState || window.userState || {};
    }
    function _isAdmin() {
        var s = window.EmpState || {};
        return s.isAdmin != null ? s.isAdmin : (window.isAdmin || false);
    }

    var CONTACT_SEL   = '.contact-seller-btn, .expand-contact-btn, .vf-contact-btn';
    var CORRECT_LABEL = '<i class="fas fa-address-card"></i> Contact Seller';
    var INTRUDER_TEXT = 'Message Seller';
    var OPEN_TEXT      = 'Hide Contact';

    function fixContactLabel(btn) {
        if (!btn) return;
        var text = (btn.textContent || '').trim();
        /* Never touch it if already correct, or in its legitimate open
           state ("Hide Contact") — that's app-patch-v2.js's own toggle. */
        if (text.indexOf(INTRUDER_TEXT) === -1) return;
        if (text.indexOf(OPEN_TEXT) !== -1) return;
        btn.innerHTML = CORRECT_LABEL;
        btn._vfMsgLabelled = true; /* pre-empts app-marketplace.js's one-time relabel guard */
    }

    function enforceContactVisibility() {
        var cards = document.querySelectorAll(
            '#marketplace .property-card, #property-grid-container .property-card, ' +
            '.market-card, .listing-card'
        );
        var us = _us();
        var admin = _isAdmin();

        cards.forEach(function (card) {
            var salesType = (card.dataset.salesType || card.dataset.salestype || '').toLowerCase();
            var btn = card.querySelector(CONTACT_SEL);
            if (btn) fixContactLabel(btn);

            if (salesType === 'escrow') return; // escrow never shows a contact button

            var sellerId = card.dataset.sellerId || card.dataset.userId || '';
            if (!sellerId) return;

            var isOwner = admin || (us.id && sellerId === us.id);
            if (!isOwner) return; // buyers keep Contact Seller — nothing to do

            card.querySelectorAll(CONTACT_SEL).forEach(function (b) {
                b.style.setProperty('display', 'none', 'important');
            });
            var panel = card.querySelector('.vf-contact-panel.open, .direct-contact-info.open');
            if (panel) panel.classList.remove('open');
        });
    }

    document.addEventListener('empyrean-init-done', function () {
        setTimeout(enforceContactVisibility, 500);
        setTimeout(enforceContactVisibility, 1500);
    });

    var _mo1 = new MutationObserver(function () {
        clearTimeout(_mo1._t);
        _mo1._t = setTimeout(enforceContactVisibility, 200);
    });
    document.addEventListener('DOMContentLoaded', function () {
        _mo1.observe(document.body, { childList: true, subtree: true, characterData: true });
        enforceContactVisibility();
    });

    setInterval(enforceContactVisibility, 4000);

    console.log('[EmpyreanPatchV21] ✅ Part 1: Contact Seller button — owner-hidden on direct sales, label race with app-patch-v2.js resolved.');

})();


(function empyreanPatchV21_Part2_TwoWayMarketplaceChat() {
    'use strict';

    /* ── RETIRED (2026-08-09 — Marketplace Communication Adjustments) ──
       This whole part existed to route the marketplace "Contact Seller"
       flow through window.openChat() — the general 1:1 direct-message
       inbox — instead of app-marketplace.js's own dedicated
       window._openMarketChatOverlay() (which writes to its own
       'marketplace_messages' collection, not 'messages'/'chats').

       That's now explicitly the OPPOSITE of what's wanted: "Contact
       Seller" must open the separate marketplace chat, pre-filled with
       an auto-generated inquiry, with every message landing in the
       marketplace inbox — never the general 1:1 inbox. The override two
       lines below (`window._openMarketChatOverlay = function(...) {
       window.openChat(...) }`) was doing exactly the wrong thing: it
       silently swallowed listingMeta AND the auto-generated prefillText
       (see app-patch-v2.js's "Wire the native Contact Seller button"
       comment) every time it fired, since window.openChat() has no
       parameter for either.

       Retiring this restores app-marketplace.js's own
       _openMarketChatOverlay() as the one function every "Contact
       Seller" tap reaches (app-patch-v2.js's document-level click
       handler already calls window._openMarketChatOverlay directly —
       nothing else needs to change there). The 'chats' participants
       listener below existed only to help the general inbox discover
       marketplace threads that were being funneled into it by this same
       override; with the override gone it has nothing left to watch for
       (marketplace threads never touch the 'chats' collection), so it's
       retired alongside it rather than left running for no purpose. Left
       inert rather than deleted, per this codebase's no-deletion
       convention. Do not re-enable without re-reading the note above —
       re-enabling this reopens the exact bug it was retired for. */
    return;

    function _us() {
        var s = window.EmpState || {};
        return s.userState || window.userState || {};
    }
    function _mockUsersStore() {
        var s = window.EmpState || {};
        if (s.mockUsers) return s.mockUsers;
        if (!window.mockUsers) window.mockUsers = {};
        return window.mockUsers;
    }
    function _currentlyOpenPeerId() {
        if (!document.body.classList.contains('oc-chat-open')) return '';
        var active = document.querySelector('.contact-item.active');
        return active ? (active.dataset.userId || '') : '';
    }

    var _legacyOverlay = window._openMarketChatOverlay;
    window._openMarketChatOverlay = function (sellerId, sellerName) {
        if (typeof window.openChat === 'function') {
            window.openChat(sellerId, sellerName);
            return;
        }
        console.warn('[V21-Chat] window.openChat not ready yet — falling back to the legacy marketplace overlay for this one tap.');
        if (typeof _legacyOverlay === 'function') _legacyOverlay(sellerId, sellerName);
    };

    var _chatsUnsub = null;
    var _lastAttempt = 0;

    function _watchMyChats() {
        if (_chatsUnsub) return;
        var us = _us();
        if (!us.id || !window.fbDb) return;

        /* Avoid hammering Firestore with repeat permission-denied retries
           when there's no auth session yet — back off to a slower cadence
           after a failure instead of retrying every tick. */
        if (Date.now() - _lastAttempt < 4500) return;
        _lastAttempt = Date.now();

        try {
            _chatsUnsub = window.fbDb.collection('chats')
                .where('participants', 'array-contains', us.id)
                .onSnapshot(function (snap) {
                    if (!snap) return;
                    var mu = _mockUsersStore();
                    var needsRerender = false;

                    snap.docChanges().forEach(function (ch) {
                        if (ch.type === 'removed') return;
                        var data = ch.doc.data() || {};
                        var parts = Array.isArray(data.participants) ? data.participants : [];
                        var otherId = parts.filter(function (p) { return p && p !== us.id; })[0];
                        if (!otherId) return;

                        if (!mu[otherId]) {
                            window.fbDb.collection('users').doc(otherId).get().then(function (doc) {
                                if (!doc.exists) return;
                                var u = doc.data() || {};
                                u.id = u.id || otherId;
                                mu[otherId] = u;
                                if (typeof window.renderContactList === 'function') window.renderContactList();
                            }).catch(function () {});
                        } else {
                            needsRerender = true;
                        }

                        if (ch.type === 'modified' && data.lastSenderId && data.lastSenderId !== us.id
                            && _currentlyOpenPeerId() !== otherId
                            && typeof window.pushNotification === 'function') {
                            var name = (mu[otherId] && (mu[otherId].fullName || mu[otherId].username)) || 'New message';
                            window.pushNotification('💬 ' + name + ': ' + String(data.lastMessage || '').slice(0, 40), 'info');
                        }
                    });

                    if (needsRerender && typeof window.renderContactList === 'function') window.renderContactList();
                }, function (err) {
                    if (err && err.code !== 'permission-denied') {
                        console.warn('[V21-Chat] chats listener error:', err.code, err.message);
                    }
                    _chatsUnsub = null; // allow a later retry once auth/backoff permits
                });
        } catch (e) {
            console.warn('[V21-Chat] could not attach chats listener:', e && e.message);
        }
    }

    document.addEventListener('empyrean-init-done', function () { setTimeout(_watchMyChats, 700); });
    document.addEventListener('empyrean-user-ready', function () { setTimeout(_watchMyChats, 700); });
    setInterval(_watchMyChats, 5000);

    console.log('[EmpyreanPatchV21] ✅ Part 2: Two-way marketplace chat routes through window.openChat(); sellers discover new buyer threads via chats participants listener.');

})();


(function empyreanPatchV21_Part3_UniversalOwnerActionSweep() {
    'use strict';

    function _us() {
        var s = window.EmpState || {};
        return s.userState || window.userState || {};
    }
    function _isAdmin() {
        var s = window.EmpState || {};
        return s.isAdmin != null ? s.isAdmin : (window.isAdmin || false);
    }

    /* Deliberately container-agnostic — catches cards from ANY creation
       path (app-fixes.js's raw-HTML Firestore listener into
       #property-grid-container, app-marketplace.js's own render sweep
       into #marketplace, or any future grid), so a card is never again
       silently excluded just because it wasn't built by the "expected"
       renderer. This is the fix for the console-confirmed bug: escrow
       cards showing Add to Cart + Promote to everyone, and Promote
       leaking onto direct-sale cards you don't own. */
    function enforceOwnerActions() {
        var cards = document.querySelectorAll('.property-card, .market-card, .listing-card');
        var us = _us();
        var admin = _isAdmin();

        cards.forEach(function (card) {
            var sellerId = card.dataset.sellerId || card.dataset.userId || '';
            if (!sellerId) return; // can't confirm ownership yet — next sweep will catch it

            var isOwner = admin || (us.id && sellerId === us.id);

            /* Buyer-only buttons have no business existing on a card you
               own at all. Hiding them (the old approach) left a second,
               conflicting button set physically in the DOM whenever two
               different pieces of code disagreed about ownership at
               creation time — confirmed by console data showing Promote
               AND Message AND Contact all present on the same owned card
               simultaneously. Removing them outright closes that gap
               regardless of which code path added them. */
            if (isOwner) {
                var msgBtn = card.querySelector('.mkt-msg-seller-btn');
                if (msgBtn) msgBtn.remove();
                var contactBtn = card.querySelector('.contact-seller-btn, .expand-contact-btn, .vf-contact-btn');
                if (contactBtn) contactBtn.remove();
            } else {
                var addBtn = card.querySelector('.add-to-cart-btn');
                if (addBtn && (card.dataset.salesType || '').toLowerCase() !== 'escrow') addBtn.remove();
                ['.promote-post-btn', '.promote-item-btn', '.edit-post-btn', '.delete-post-btn'].forEach(function (sel) {
                    var btn = card.querySelector(sel);
                    if (btn) btn.remove();
                });
                /* app-fix-final.js's independent toolbar (.vf-owner-toolbar,
                   containing .vf-tb-edit/.vf-tb-delete) — a second,
                   completely separate Edit/Delete implementation this
                   sweep never touched before. Strip it for non-owners the
                   same as everything else. */
                var toolbar = card.querySelector('.vf-owner-toolbar');
                if (toolbar) toolbar.remove();
            }

            /* Visibility enforcement for whatever legitimately remains. */
            var cartBtn = card.querySelector('.add-to-cart-btn');
            if (cartBtn) cartBtn.style.setProperty('display', isOwner ? 'none' : 'flex', 'important');

            ['.promote-post-btn', '.promote-item-btn', '.edit-post-btn', '.delete-post-btn'].forEach(function (sel) {
                var btn = card.querySelector(sel);
                if (btn) btn.style.setProperty('display', isOwner ? 'flex' : 'none', 'important');
            });

            /* app-fix-final.js's own toolbar retries itself until
               ownership resolves true, so don't fabricate it — just make
               sure this sweep never accidentally hides it once it exists. */
            var vfToolbar = card.querySelector('.vf-owner-toolbar');
            if (vfToolbar && isOwner) vfToolbar.style.setProperty('display', 'flex', 'important');

            /* Can't safely fabricate a working Edit/Delete button from
               scratch (no visibility into their real click handlers), so
               flag it instead of silently leaving it broken — this is the
               visible signal for "this specific card's DOM is stale and
               needs a hard refresh," rather than a display bug. Checks
               BOTH known Edit/Delete implementations (.edit-post-btn from
               app-marketplace.js and .vf-tb-edit from app-fix-final.js)
               before concluding a card is genuinely incomplete. */
            var hasAnyEdit = card.querySelector('.edit-post-btn, .vf-tb-edit');
            var hasAnyDelete = card.querySelector('.delete-post-btn, .vf-tb-delete');
            if (isOwner && card.querySelector('.promote-post-btn') && (!hasAnyEdit || !hasAnyDelete)) {
                if (!card._v21FlaggedIncomplete) {
                    card._v21FlaggedIncomplete = true;
                    console.warn('[V21-Part3] Owned card is missing Edit/Delete entirely under either known implementation. id:', card.dataset.id || card.dataset.sellerId, '— needs a hard refresh, or app-fix-final.js\'s own toolbar retry hasn\'t fired yet.');
                }
            }
        });
    }

    document.addEventListener('empyrean-init-done', function () {
        setTimeout(enforceOwnerActions, 400);
        setTimeout(enforceOwnerActions, 1200);
    });

    var _mo2 = new MutationObserver(function () {
        clearTimeout(_mo2._t);
        _mo2._t = setTimeout(enforceOwnerActions, 150);
    });
    document.addEventListener('DOMContentLoaded', function () {
        _mo2.observe(document.body, { childList: true, subtree: true });
        enforceOwnerActions();
    });

    setInterval(enforceOwnerActions, 1500);

    console.log('[EmpyreanPatchV21] ✅ Part 3: wrong-owner buttons now removed outright (not just hidden) to eliminate duplicate button sets; cards still missing Edit/Delete after cleanup are flagged in console.');

})();