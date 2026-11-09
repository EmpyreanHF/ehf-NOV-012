/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v20
   app-patch-v20.js  |  Load AFTER app-patch-v19.js (and therefore after
   app-chat.js, app-patch-openchat.js, app-patch-v13.js, app-patch-v14.js —
   all of which this file reads from, never edits).

   BUG: "Chat Segmentation" — Messages must classify conversations into
   Chats / Groups / Broadcasts behind a clickable column row above the
   list, each in its own segment.

   ROOT CAUSE (traced through the actual rendering chain, not guessed):
   Three different files render into the SAME container (#contacts-inner)
   with no segmentation at all:
     • app-chat.js's renderContactList() appends one .contact-item div per
       1:1 conversation directly into #contacts-inner.
     • app-patch-v14.js's _renderGroupsInContactList() prepends a
       #v14-groups-section (labelled "Groups") full of .v14-group-item
       rows — real Firestore groups/{groupId} docs — to the very TOP of
       that same container.
     • Broadcasts (app-patch-v13.js's DATA MODEL comment: a
       broadcastLists/{listId} doc per broadcast, fanned out as tagged
       1:1 messages) never got a list UI at all — nothing in the codebase
       queries broadcastLists to render anything.
   With no tab/column control and no visual boundary between the group
   section and the plain contact rows beneath it, every row after the
   "Groups" heading reads as if it belongs to that group — exactly the
   screenshot (akhigbemicheal385 / Akhigbe Allen / Williams Adetoye are
   ordinary 1:1 contacts, not group members, sitting directly under the
   "GROUPS" label with nothing to tell them apart).

   FIX — non-invasive, reads existing DOM/Firestore, doesn't rewrite any
   prior file's rendering logic:
     1. A three-column tab row (Chats | Groups | Broadcasts) is inserted
        between the search box and #contacts-inner.
     2. Existing .contact-item rows (from app-chat.js) and the existing
        #v14-groups-section (from app-patch-v14.js) are left exactly as
        those files build them — this patch only toggles their
        display:none/'' based on the active tab, via a MutationObserver
        on #contacts-inner so it re-applies every time either file
        re-renders (Firestore snapshot, localStorage sync, search, etc.),
        regardless of which file's render happens to finish last.
     3. A NEW #v20-broadcasts-section is added (nothing else renders
        this): a live listener on broadcastLists where ownerId == me,
        matching the DATA MODEL app-patch-v13.js already documents and
        writes to when a broadcast is sent. Tapping an entry shows who
        it was sent to — broadcasts fan out as ordinary 1:1 DMs on
        purpose (recipients never see a shared thread), so there's no
        group-style conversation view to open for them.
     4. Each tab shows its own empty state instead of a shared blank pane.
   ============================================================================= */

(function empyreanPatchV20() {
    'use strict';

    function log(msg)  { console.log('[V20-ChatTabs] ' + msg); }
    function warn(msg, e) { console.warn('[V20-ChatTabs] ' + msg, e && (e.message || e)); }

    function _fbOk() { return !!(window._firebaseLoaded && window.fbDb); }
    function _myId() {
        var s  = window.EmpState || {};
        var us = s.userState || window.userState || {};
        return us.id;
    }
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function _directChildren(parent, cls) {
        return Array.prototype.filter.call(parent.children, function (c) {
            return c.classList && c.classList.contains(cls);
        });
    }

    var TAB_KEY = 'emp_msgs_active_tab';
    function _getTab()  { try { return localStorage.getItem(TAB_KEY) || 'chats'; } catch (e) { return 'chats'; } }
    function _setTab(t) { try { localStorage.setItem(TAB_KEY, t); } catch (e) {} }

    /* UNIFIED LIST (WhatsApp-style "All"): app-chat.js's filter chip state
       (exposed as window._empChatChip). The "All" chip on the Chats tab now
       shows 1:1 chats, groups and broadcasts together, in the same row
       format, newest first; the Groups / Broadcasts chips still isolate
       each kind on their own. */
    function _chip() { return (typeof window._empChatChip === 'function') ? window._empChatChip() : 'all'; }
    function _isMixView() { return _getTab() === 'chats' && _chip() === 'all'; }
    function _wantsBroadcasts() { return _getTab() === 'broadcasts' || _isMixView(); }


    /* =========================================================================
       §1  TAB ROW — Chats | Groups | Broadcasts
       ========================================================================= */
    function _buildTabBar() {
        var container = document.getElementById('contact-list-container');
        var inner     = document.getElementById('contacts-inner');
        if (!container || !inner) return null;

        var bar = document.getElementById('v20-chat-tabs');
        if (bar) return bar;

        bar = document.createElement('div');
        bar.id = 'v20-chat-tabs';
        bar.style.cssText =
            'display:flex;background:var(--color-white,#fff);flex-shrink:0;' +
            'border-bottom:1px solid rgba(10,14,39,0.07);' +
            /* FIX (duplicate filter rows): the chip row in index.html
               (#chat-filter-chips: All/Unread/Groups/Favourites/Broadcasts/
               Marketplace/Calls) is now the ONLY visible row. This tab bar
               stays in the DOM because the chips drive it via .click() on its
               buttons (app-chat.js _clickTab), app-patch-calls-log.js appends
               to it, and _syncStatusBar() uses its offsetParent. So it is
               collapsed (not display:none, which would null offsetParent). */
            'height:0;min-height:0;overflow:hidden;visibility:hidden;border-bottom:0;margin:0;padding:0;';

        [['chats', 'Chats'], ['groups', 'Groups'], ['broadcasts', 'Broadcasts'], ['marketplace', 'Marketplace']].forEach(function (pair) {
            var key = pair[0], label = pair[1];
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'v20-chat-tab';
            btn.dataset.tab = key;
            btn.textContent = label;
            btn.style.cssText =
                'flex:1;background:none;border:none;padding:12px 6px;cursor:pointer;' +
                'font-size:0.82rem;font-weight:700;color:var(--text-muted,#6B7280);' +
                'border-bottom:2.5px solid transparent;transition:color .15s,border-color .15s;';
            btn.addEventListener('click', function () {
                if (_getTab() === key) return;
                _setTab(key);
                _paintTabBar();
                _applyFilter();
                if (_wantsBroadcasts()) {
                    _watchBroadcastLists();
                } else {
                    // Not needed while looking at Chats/Groups/Marketplace — stop
                    // holding this listener open (and, if it was mid
                    // permission-error retry, stop retrying) in the
                    // background. See the FIX note above _broadcastUnsub.
                    _teardownBroadcastListener();
                }
                if (key === 'marketplace') {
                    _watchMarketplaceMessages();
                } else {
                    _teardownMarketplaceListeners();
                }
            });
            bar.appendChild(btn);
        });

        /* Sits between the search box (container's existing first child)
           and the scrollable list — never touches either of those. */
        container.insertBefore(bar, inner);
        return bar;
    }

    function _paintTabBar() {
        var bar = document.getElementById('v20-chat-tabs');
        if (!bar) return;
        var active = _getTab();
        bar.querySelectorAll('.v20-chat-tab').forEach(function (btn) {
            var on = btn.dataset.tab === active;
            btn.style.color            = on ? 'var(--secondary,#1B2B8B)' : 'var(--text-muted,#6B7280)';
            btn.style.borderBottomColor = on ? 'var(--secondary,#1B2B8B)' : 'transparent';
        });
    }

    /* #contacts-inner had a hardcoded height:calc(100% - 90px) sized for
       "search box only". Adding the tab row on top of it without
       correcting that would either clip the list or force a second,
       redundant scrollbar — so the offset is recalculated from the
       actual rendered heights instead of re-guessing a new constant. */
    function _fixInnerHeight() {
        /* DISABLED (2026-07-16): this used to force #contacts-inner into a
           calc(100% - Npx) fixed height sized to its own independent scroll
           pane. Scroll ownership now lives on #contact-list-container itself
           (see the !important rules in app-fix-final.js) so the blue Messages
           header + search box + this tab bar scroll away together with the
           list, instead of staying pinned above an inner scroll pane. Setting
           an inline height here would clip/reintroduce that inner scroll pane,
           undoing the fix. Kept as a no-op (not deleted) since _applyFilter()
           still calls it every re-render. */
        return;
    }


    /* =========================================================================
       §2  BROADCASTS SECTION — nothing rendered this before.
       broadcastLists/{listId} { ownerId, name, recipients:[uid,...], createdAt }
       — the exact shape app-patch-v13.js already writes on send.
       ========================================================================= */
    var _broadcastUnsub = null;

    /* ── FIX (Call Listener regression — "video/voice calls suddenly
       stopped connecting after this file loaded"): the §4 safety-net
       interval below used to call _watchBroadcastLists() unconditionally
       every 1200ms forever, for every session, regardless of whether the
       Broadcasts tab was ever opened. For any session without a REAL
       (non-anonymous) Firebase Auth user yet — which app-patch-v12.js's
       own comments confirm is routine for this app (localStorage-only
       sessions, or the 1-6s window before fbAuth.onAuthStateChanged
       fires with a real user) — every one of those calls opens a
       broadcastLists onSnapshot listener that Firestore immediately
       rejects with a permission error; the error handler below clears
       _broadcastUnsub so the very next 1200ms tick opens ANOTHER one,
       forever. The Firestore JS SDK multiplexes every onSnapshot
       listener for a given app (including app-patch-openchat.js's
       offer/answer/ICE-candidate listeners that calls depend on) over
       ONE shared realtime "Listen" stream — opening/tearing down a
       listener on that stream every 1.2s indefinitely churns it,
       which is consistent with calls ringing but never connecting, or
       dropping mid-call.
       Fix: (a) only ever open this listener when the Broadcasts tab is
       actually the active one — nothing needs it otherwise; (b) back
       off on repeated errors (2s → 4s → 8s → 16s, capped at 30s)
       instead of retrying every 1200ms; (c) tear the listener down the
       moment the tab is switched away from Broadcasts, instead of
       leaving it open (and still erroring/retrying) in the background. */
    var _broadcastFailCount = 0;
    var _broadcastNextRetryAt = 0;
    function _teardownBroadcastListener() {
        if (_broadcastUnsub) { try { _broadcastUnsub(); } catch (e) {} }
        _broadcastUnsub = null;
    }

    /* FIX (Firestore "Missing or insufficient permissions" on the
       broadcastLists listener): this is a timing race, not a broken rule.
       app-fixes.js's own documented flow restores userState from
       localStorage IMMEDIATELY on load so the UI can render right away,
       and only afterward — its own comment says 1-4s, up to 6s on slow
       networks — does fbAuth.onAuthStateChanged fire with the real,
       authenticated Firebase user. The broadcastLists security rule
       requires request.auth.uid == resource.data.ownerId, which can only
       be satisfied once that real auth handshake completes server-side;
       calling this before then gets rejected regardless of what myId
       looks like locally.
       The original code fired this query once at init and treated the
       returned unsubscribe function (which onSnapshot returns
       SYNCHRONOUSLY, before the async permission check even resolves) as
       proof the listener was healthy — so once the early, pre-auth call
       failed, _broadcastUnsub stayed permanently truthy and the guard at
       the top of this function blocked every future retry forever, even
       after real auth came through seconds later.
       Now: on a permission-denied (or any) error, clear _broadcastUnsub
       so this can be called again, and explicitly re-subscribe the
       moment fbAuth confirms a real (non-anonymous) user — the same
       signal app-fixes.js itself already uses to know the session is
       finally trustworthy. */
    var _broadcastAuthHooked = false;
    function _watchBroadcastLists() {
        if (!_fbOk() || _broadcastUnsub) return;
        // Lazy: nothing needs this listener unless someone is actually
        // looking at the Broadcasts tab (or the mixed "All" list, which
        // also shows broadcast rows) right now.
        if (!_wantsBroadcasts()) return;
        // Backoff: don't hammer Firestore with a fresh listener every
        // 1200ms after a permission error — wait out the computed delay.
        if (Date.now() < _broadcastNextRetryAt) return;
        var myId = _myId();
        if (!myId) return;
        _broadcastUnsub = window.fbDb.collection('broadcastLists')
            .where('ownerId', '==', myId)
            .onSnapshot(function (snap) {
                _broadcastFailCount = 0;
                _broadcastNextRetryAt = 0;
                _renderBroadcastSection(snap);
            }, function (err) {
                warn('broadcastLists listener error (backing off before retry)', err);
                _broadcastUnsub = null;
                _broadcastFailCount++;
                var delay = Math.min(2000 * Math.pow(2, _broadcastFailCount - 1), 30000);
                _broadcastNextRetryAt = Date.now() + delay;
            });

        if (!_broadcastAuthHooked && window.fbAuth && typeof window.fbAuth.onAuthStateChanged === 'function') {
            _broadcastAuthHooked = true;
            window.fbAuth.onAuthStateChanged(function (fbUser) {
                if (fbUser && !fbUser.isAnonymous) {
                    // Real session confirmed (possibly upgrading userState.id
                    // from a stale local value) — drop any pre-auth listener
                    // that was denied, clear backoff, and re-subscribe with
                    // the now-current id (still gated on the tab being active).
                    _teardownBroadcastListener();
                    _broadcastFailCount = 0;
                    _broadcastNextRetryAt = 0;
                    _watchBroadcastLists();
                }
            });
        }
    }

    function _renderBroadcastSection(snap) {
        var inner = document.getElementById('contacts-inner');
        if (!inner) return;

        var existing = document.getElementById('v20-broadcasts-section');
        if (existing) existing.remove();
        Array.prototype.forEach.call(inner.querySelectorAll(':scope > .v20-broadcast-item'), function (r) { r.remove(); }); /* rows hoisted by _enforceTimeOrder */

        if (snap && !snap.empty) {
            var section = document.createElement('div');
            section.id = 'v20-broadcasts-section';

            var rows = '';
            var mu0 = (window.EmpState && window.EmpState.mockUsers) || window.mockUsers || {};
            snap.forEach(function (doc) {
                var b = doc.data() || {};
                var recips = Array.isArray(b.recipients) ? b.recipients : [];
                var n = recips.length;
                var ts = b.createdAt ? (new Date(b.createdAt).getTime() || 0) : 0;
                var timeLbl = ts && typeof window._chatListTime === 'function' ? window._chatListTime(new Date(ts).toISOString()) : '';
                var names = recips.slice(0, 3).map(function (uid) {
                    var u = mu0[uid]; return (u && (u.fullName || u.username)) || '';
                }).filter(Boolean).join(', ');
                var preview = n + ' recipient' + (n === 1 ? '' : 's') + (names ? ' \u00b7 ' + names + (n > 3 ? '\u2026' : '') : '');
                rows +=
                    '<div class="v20-broadcast-item emp-chatrow" data-broadcast-id="' + _esc(doc.id) + '" data-last-ts="' + ts + '" data-unread="0" ' +
                    'style="display:flex;align-items:center;gap:12px;padding:12px 16px;min-height:72px;box-sizing:border-box;' +
                    'border-bottom:1px solid #F0F2F7;cursor:pointer;transition:background 0.15s;">' +
                        /* distinct broadcast avatar: green disc + megaphone (groups use the people glyph) */
                        '<div style="width:52px;height:52px;border-radius:50%;flex-shrink:0;' +
                        'background:linear-gradient(135deg,#3DD6A3 0%,#0B8F6B 100%);display:flex;align-items:center;justify-content:center;">' +
                        '<svg viewBox="0 0 24 24" width="26" height="26" fill="#fff"><path d="M18 11v2h4v-2h-4zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.6-.99-.74-2.24-1.68-3.2-2.4-.4.54-.8 1.08-1.2 1.61zM20.4 5.6c-.4-.53-.8-1.07-1.2-1.6-.99.74-2.24 1.68-3.2 2.4.4.53.8 1.07 1.2 1.6.96-.72 2.21-1.65 3.2-2.4zM4 9c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h1v4h2v-4h1l5 3V6L8 9H4zm11.5 3c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34z"/></svg></div>' +
                        '<div style="flex:1;min-width:0;">' +
                            '<div style="display:flex;align-items:center;gap:6px;min-width:0;margin-bottom:2px;">' +
                            '<strong style="font-size:0.98rem;color:#14213D;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">' +
                            _esc(b.name || 'Broadcast list') + '</strong>' +
                            '<span style="flex-shrink:0;background:#E3F7EF;color:#0B7A5C;border-radius:4px;font-size:0.62rem;font-weight:700;padding:1px 6px;">Broadcast</span>' +
                            '</div>' +
                            '<p style="font-size:0.84rem;color:#6B7A94;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;min-width:0;">' +
                            _esc(preview) + '</p>' +
                        '</div>' +
                        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;margin-left:6px;min-width:44px;">' +
                            '<span style="font-size:0.7rem;color:#6B7A94;' + (timeLbl ? '' : 'display:none;') + '">' + _esc(timeLbl) + '</span>' +
                        '</div>' +
                    '</div>';
            });

            section.innerHTML = rows;
            inner.appendChild(section);

            section.querySelectorAll('.v20-broadcast-item').forEach(function (item) {
                if (window._empApplyRowOrder) window._empApplyRowOrder(item);
                item.addEventListener('click', function () {
                    /* opens the broadcast as a chat the creator can send from (app-patch-v13.js §2b);
                       the old read-only recipients alert stays as the fallback if that isn't loaded */
                    if (typeof window._empOpenBroadcastChat === 'function') window._empOpenBroadcastChat(item.dataset.broadcastId);
                    else _showBroadcastRecipients(item.dataset.broadcastId);
                });
            });
        }

        _applyFilter();
    }

    function _showBroadcastRecipients(broadcastId) {
        if (!_fbOk()) return;
        window.fbDb.collection('broadcastLists').doc(broadcastId).get().then(function (doc) {
            if (!doc.exists) return;
            var b  = doc.data() || {};
            var mu = (window.EmpState && window.EmpState.mockUsers) || window.mockUsers || {};
            var names = (b.recipients || []).map(function (uid) {
                var u = mu[uid];
                return (u && (u.fullName || u.username)) || uid;
            });
            /* Broadcasts fan out as ordinary 1:1 DMs on purpose (per
               app-patch-v13.js) — there is no shared thread to open, so
               this is a read-only recipients view, same as WhatsApp's
               own broadcast-list tap target. */
            alert((b.name || 'Broadcast') + '\n\nSent to:\n' + (names.length ? names.join('\n') : '(no recipients)'));
        }).catch(function (err) { warn('Could not load broadcast recipients', err); });
    }


    /* =========================================================================
       §2b  MARKETPLACE SECTION — buyer/seller inquiry threads
       FEATURE ("not seeing the marketplace section in the general message
       section"): marketplace_messages/{tid} { buyerId, sellerId, listingId,
       listingName, listingPrice, listingImage, lastMessage, lastFrom, lastTs,
       unreadBuyer, unreadSeller } is the exact shape app-marketplace.js
       §8b/§8c already write to/read from for its own standalone inbox modal
       (renderMarketplaceInbox) — this reuses that same collection as a real
       tab here instead of introducing a second data source. Firestore's JS
       SDK has no native "buyerId == me OR sellerId == me" query, so — same
       as renderMarketplaceInbox() — this runs two queries and merges them
       client-side; unlike that one-shot version, both are live onSnapshot
       listeners (matching how Chats/Broadcasts already stay live here),
       lazily opened/torn down with the tab exactly like _watchBroadcastLists.
       ========================================================================= */
    var _mktUnsubBuyer = null, _mktUnsubSeller = null;
    var _mktRowsMap = {};
    var _mktRowsFor = null;
    var _mktFailCount = 0;
    var _mktNextRetryAt = 0;
    var _mktAuthHooked = false;

    function _teardownMarketplaceListeners() {
        if (_mktUnsubBuyer)  { try { _mktUnsubBuyer(); }  catch (e) {} }
        if (_mktUnsubSeller) { try { _mktUnsubSeller(); } catch (e) {} }
        _mktUnsubBuyer = null;
        _mktUnsubSeller = null;
    }

    function _mergeMktSnap(snap) {
        if (!snap) return;
        snap.docChanges().forEach(function (ch) {
            if (ch.type === 'removed') delete _mktRowsMap[ch.doc.id];
            else _mktRowsMap[ch.doc.id] = ch.doc.data();
        });
        _renderMarketplaceSection();
    }

    /* FIX (bug: marketplace tab permanently blank after logout/re-login,
       console spammed with "Uncaught Error in snapshot listener:
       permission-denied"): same root cause already diagnosed and fixed for
       _watchBroadcastLists() just above — onSnapshot() returns its
       unsubscribe function SYNCHRONOUSLY, before the permission check even
       resolves, so the original code treated a soon-to-fail listener as
       healthy forever. Worse here: nothing ever told this listener a
       logout happened, so it kept running (and erroring) against
       Firestore with no auth at all, exactly what showed up in the
       console. Mirrors the same fix: on error, null out the unsub handles
       and back off before retrying instead of getting stuck, and tear
       down + reset immediately on the new empyrean:logout event (see
       app-auth.js's signOutUser) instead of only on tab-switch. */
    function _watchMarketplaceMessages() {
        if (!_fbOk()) return;
        if (_getTab() !== 'marketplace') return;
        if (_mktUnsubBuyer || _mktUnsubSeller) return;
        if (Date.now() < _mktNextRetryAt) return;
        var myId = _myId();
        if (!myId) return;
        /* STABILITY: this used to wipe the rows on EVERY (re)subscribe, so on a flaky connection (listener errors ->
           retry) the Marketplace tab flipped to "No marketplace conversations yet" until the server answered. Only
           clear when the account actually changed; a fresh snapshot refreshes/updates rows in place. */
        if (_mktRowsFor !== myId) { _mktRowsMap = {}; _mktRowsFor = myId; }
        function _onErr(side) {
            return function (err) {
                warn('marketplace_messages (' + side + ' side) listener error (backing off before retry)', err);
                _mktUnsubBuyer = null;
                _mktUnsubSeller = null;
                _mktFailCount++;
                var delay = Math.min(2000 * Math.pow(2, _mktFailCount - 1), 30000);
                _mktNextRetryAt = Date.now() + delay;
            };
        }
        _mktUnsubBuyer = window.fbDb.collection('marketplace_messages').where('buyerId', '==', myId)
            .onSnapshot(function (snap) { _mktFailCount = 0; _mktNextRetryAt = 0; _mergeMktSnap(snap); }, _onErr('buyer'));
        _mktUnsubSeller = window.fbDb.collection('marketplace_messages').where('sellerId', '==', myId)
            .onSnapshot(function (snap) { _mktFailCount = 0; _mktNextRetryAt = 0; _mergeMktSnap(snap); }, _onErr('seller'));

        if (!_mktAuthHooked && window.fbAuth && typeof window.fbAuth.onAuthStateChanged === 'function') {
            _mktAuthHooked = true;
            window.fbAuth.onAuthStateChanged(function (fbUser) {
                if (fbUser && !fbUser.isAnonymous) {
                    _teardownMarketplaceListeners();
                    _mktFailCount = 0;
                    _mktNextRetryAt = 0;
                    _watchMarketplaceMessages();
                }
            });
        }
    }

    /* Both marketplace and broadcast listeners are otherwise only torn
       down on tab-switch — nothing previously ran on sign-out, so a
       listener left open on either tab kept erroring against Firestore
       with no auth at all until the tab happened to change. Reset both on
       logout and clear the rendered sections + row cache so a different
       account logging in on the same page load doesn't briefly show the
       previous account's cached rows. */
    document.addEventListener('empyrean:logout', function () {
        _teardownMarketplaceListeners();
        _teardownBroadcastListener();
        _mktRowsMap = {};
        _mktRowsFor = null;
        _mktFailCount = 0;
        _mktNextRetryAt = 0;
        _broadcastFailCount = 0;
        _broadcastNextRetryAt = 0;
        var mktSection = document.getElementById('v20-marketplace-section');
        if (mktSection) mktSection.remove();
    });

    function _renderMarketplaceSection() {
        var inner = document.getElementById('contacts-inner');
        if (!inner) return;

        var existing = document.getElementById('v20-marketplace-section');
        if (existing) existing.remove();

        var myId = _myId();
        var mu = (window.EmpState && window.EmpState.mockUsers) || window.mockUsers || {};
        var rows = Object.keys(_mktRowsMap).map(function (k) { return _mktRowsMap[k]; })
            .filter(function (r) { return r && r.lastMessage; })
            .sort(function (a, b) { return new Date(b.lastTs || 0) - new Date(a.lastTs || 0); });

        if (rows.length) {
            var section = document.createElement('div');
            section.id = 'v20-marketplace-section';

            var html = '';
            rows.forEach(function (r, idx) {
                var isBuyerSide = r.buyerId === myId;
                var counterpartId = isBuyerSide ? r.sellerId : r.buyerId;
                var counterpartName = (mu[counterpartId] && (mu[counterpartId].fullName || mu[counterpartId].username))
                    || (isBuyerSide ? 'Seller' : 'Buyer');
                var unread = isBuyerSide ? (r.unreadBuyer || 0) : (r.unreadSeller || 0);
                var avatar = r.listingImage || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(counterpartName) + '&background=1B2B8B&color=fff');
                html +=
                    '<div class="v20-marketplace-item" data-idx="' + idx + '" ' +
                    'style="display:flex;align-items:center;gap:12px;padding:13px 16px;' +
                    'border-bottom:1px solid rgba(10,14,39,0.05);cursor:pointer;">' +
                        '<img src="' + _esc(avatar) + '" style="width:48px;height:48px;border-radius:10px;' +
                        'object-fit:cover;flex-shrink:0;background:#eef0fa;">' +
                        '<div style="flex:1;min-width:0;">' +
                            '<div style="display:flex;align-items:center;gap:6px;min-width:0;">' +
                            '<strong style="font-size:0.92rem;color:var(--primary);display:block;' +
                            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">' +
                            _esc(r.listingName || counterpartName) + '</strong>' +
                            '<span style="flex-shrink:0;background:#E8F7EE;color:#1E7A45;border-radius:4px;font-size:0.62rem;font-weight:600;padding:1px 6px;">Marketplace</span>' +
                            '</div>' +
                            '<span style="font-size:0.79rem;color:var(--text-muted,#6B7280);display:block;' +
                            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
                            _esc((r.lastMessage || '').slice(0, 50)) + '</span>' +
                        '</div>' +
                        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;">' +
                        '<span style="font-size:0.7rem;color:' + (unread > 0 ? '#2E93E0' : 'var(--text-muted,#6B7280)') + ';">' +
                            _esc(typeof window._chatListTime === 'function' ? window._chatListTime(r.lastTs) : '') + '</span>' +
                        (unread > 0
                            ? '<span style="background:#EF4444;color:#fff;font-size:0.68rem;font-weight:700;' +
                              'min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;' +
                              'justify-content:center;padding:0 5px;flex-shrink:0;">' + (unread > 9 ? '9+' : unread) + '</span>'
                            : '') +
                        '</div>' +
                    '</div>';
            });

            section.innerHTML = html;
            inner.appendChild(section);

            section.querySelectorAll('.v20-marketplace-item').forEach(function (item) {
                item.addEventListener('click', function () {
                    var r = rows[parseInt(item.dataset.idx, 10)];
                    if (!r) return;
                    var isBuyerSide = r.buyerId === myId;
                    var counterpartId = isBuyerSide ? r.sellerId : r.buyerId;
                    var counterpartName = (mu[counterpartId] && (mu[counterpartId].fullName || mu[counterpartId].username))
                        || (isBuyerSide ? 'Seller' : 'Buyer');
                    if (typeof window._openMarketChatOverlay === 'function') {
                        window._openMarketChatOverlay(counterpartId, counterpartName, {
                            id: r.listingId, name: r.listingName, price: r.listingPrice,
                            image: r.listingImage, buyerId: r.buyerId
                        });
                    }
                });
            });
        }

        _applyFilter();
    }


    /* =========================================================================
       §3  FILTER — toggle visibility per active tab, own empty state per tab
       ========================================================================= */

    /* ORDER GUARANTEE. Rows are positioned with a CSS `order` (above), which only
       works while #contacts-inner is a flex column AND the two section wrappers are
       display:contents. If either is overridden (another stylesheet, a WebView
       without display:contents) the groups wrapper stays one block at the top and
       every group sits above every 1:1 chat no matter how new the chat is. So:
       1) defend the layout inline with !important, 2) verify the on-screen order
       really follows the order values, 3) if it doesn't, hoist the group and
       broadcast rows out of their wrappers into #contacts-inner and physically
       re-append every row in newest-first order. Hoisted rows are removed again by
       the section rebuilds (see _renderBroadcastSection / app-patch-v13.js), so
       nothing is duplicated. Cheap: runs from the existing 1.2s pass. */
    function _enforceTimeOrder(inner) {
        if (!inner) return;
        inner.style.setProperty('display', 'flex', 'important');
        inner.style.setProperty('flex-direction', 'column', 'important');
        ['v14-groups-section', 'v20-broadcasts-section'].forEach(function (id) {
            var sec = document.getElementById(id);
            if (sec && sec.style.display !== 'none') sec.style.setProperty('display', 'contents', 'important');
        });

        function _vis(r) { return r.style.display !== 'none' && r.getClientRects().length > 0; }
        function _orderOf(r) { return Number(r.style.order) || 0; }

        var rows = Array.prototype.slice.call(inner.querySelectorAll('.contact-item, .emp-chatrow')).filter(_vis);
        if (rows.length < 2) return;
        var sorted = rows.slice().sort(function (a, b) { return _orderOf(a) - _orderOf(b); });
        var ok = true, prev = -Infinity;
        for (var i = 0; i < sorted.length; i++) {
            var top = sorted[i].getBoundingClientRect().top;
            if (top < prev - 1) { ok = false; break; }
            prev = top;
        }
        if (ok) return;

        /* fallback: hoist wrapper rows, then physically sort */
        ['v14-groups-section', 'v20-broadcasts-section'].forEach(function (id) {
            var sec = document.getElementById(id);
            if (!sec) return;
            Array.prototype.slice.call(sec.children).forEach(function (c) {
                if (c.classList && (c.classList.contains('v14-group-item') || c.classList.contains('v20-broadcast-item'))) inner.appendChild(c);
            });
        });
        var all = Array.prototype.slice.call(inner.querySelectorAll(':scope > .contact-item, :scope > .emp-chatrow'));
        if (!all.length) return;
        var anchor = document.getElementById('emp-row-anchor');
        if (!anchor) { anchor = document.createElement('span'); anchor.id = 'emp-row-anchor'; anchor.style.display = 'none'; }
        var firstRow = null;
        for (var k = 0; k < inner.children.length; k++) {
            var ch = inner.children[k];
            if (ch.classList && (ch.classList.contains('contact-item') || ch.classList.contains('emp-chatrow'))) { firstRow = ch; break; }
        }
        inner.insertBefore(anchor, firstRow);
        all.sort(function (a, b) { return _orderOf(a) - _orderOf(b); }).forEach(function (r) { inner.insertBefore(r, anchor); });
    }

    function _applyFilter() {
        var inner = document.getElementById('contacts-inner');
        if (!inner) return;
        var active = _getTab();
        var chipNow = _chip();
        var mix = _isMixView();            /* Chats tab + "All" chip = unified list */
        var groupsVisible = false;
        var _q = (((document.getElementById('contacts-search') || {}).value) || '').toLowerCase().trim();
        function _rowName(el) { return ((el.querySelector('strong') || {}).textContent || '').toLowerCase(); }

        /* Chats — .contact-item rows are direct children, built by app-chat.js */
        var chatItems = _directChildren(inner, 'contact-item');
        chatItems.forEach(function (el) { el.style.display = (active === 'chats') ? '' : 'none'; });

        /* Groups — #v14-groups-section, built by app-patch-v14.js */
        var groupsSection = document.getElementById('v14-groups-section');
        var groupItems = [];
        if (groupsSection) {
            /* Shown on its own (Groups chip), mixed into "All", and on the
               "Unread" chip (only groups that actually have unread). */
            groupsVisible = (active === 'groups') || mix || (active === 'chats' && (chipNow === 'unread' || chipNow === 'favs'));
            groupsSection.style.display = groupsVisible ? '' : 'none';
            groupItems = inner.querySelectorAll('.v14-group-item');
            Array.prototype.forEach.call(groupItems, function (el) {
                var hide = !groupsVisible
                        || (active === 'chats' && chipNow === 'unread' && !(Number(el.dataset.unread || 0) > 0))
                        || (active === 'chats' && chipNow === 'favs' && !(typeof window._empIsFav === 'function' && window._empIsFav('g:' + el.dataset.groupId)))
                        || (!!_q && _rowName(el).indexOf(_q) === -1);
                el.style.display = hide ? 'none' : 'flex'; /* FIX: '' stripped the row's inline display:flex -> stacked layout */
            });
            /* Its own inline "Groups" heading is redundant once the tab
               itself carries that label. */
            var heading = groupsSection.firstElementChild;
            if (heading && !heading.classList.contains('v14-group-item')) heading.style.display = 'none';
        }

        /* Broadcasts — #v20-broadcasts-section, built above */
        var bcSection = document.getElementById('v20-broadcasts-section');
        var bcItems = [];
        if (bcSection) {
            bcSection.style.display = (active === 'broadcasts' || mix) ? '' : 'none';
            bcItems = inner.querySelectorAll('.v20-broadcast-item');
            Array.prototype.forEach.call(bcItems, function (el) {
                el.style.display = (!(active === 'broadcasts' || mix) || (!!_q && _rowName(el).indexOf(_q) === -1)) ? 'none' : 'flex'; /* FIX: keep row layout */
            });
        }

        /* Marketplace — #v20-marketplace-section, built above */
        var mktSection = document.getElementById('v20-marketplace-section');
        var mktItems = [];
        if (mktSection) {
            mktSection.style.display = (active === 'marketplace') ? '' : 'none';
            mktItems = mktSection.querySelectorAll('.v20-marketplace-item');
        }

        /* Empty state per tab, not a shared blank pane */
        /* FIX ("No conversations yet. Follow users to message them." still
           showing under real chats, on the Chats AND Marketplace tabs):
           this used to hide only getElementById('v20-empty-<tab>') — the
           FIRST element with each id — with a plain inline display:none.
           Any duplicate/re-inserted copy of a placeholder, or a later
           inline-style write, left a stale one visible. Now every
           placeholder (matched by id prefix) is force-hidden with
           !important on every pass, and only the active tab's single
           placeholder is un-hidden below, when that tab truly is empty. */
        Array.prototype.forEach.call(inner.querySelectorAll('[id^="v20-empty-"]'), function (el) {
            el.style.setProperty('display', 'none', 'important');
        });
        /* Chats: count every real row in the list (not just direct
           children) so a wrapped/re-parented row can't make the tab look
           empty. */
        var _chatRowCount = inner.querySelectorAll('.contact-item').length;
        /* any conversation of ANY kind counts, so a filter chip (Unread/Favourites) can't claim "No conversations yet"
           while groups / broadcasts / marketplace threads exist */
        var _anyOtherRows = inner.querySelectorAll('.v14-group-item, .v20-broadcast-item, .v20-marketplace-item').length > 0;
        var hasContent = active === 'chats' ? (chatItems.length > 0 || _chatRowCount > 0 || _anyOtherRows)
            : active === 'groups' ? groupItems.length > 0
            : active === 'broadcasts' ? bcItems.length > 0
            : mktItems.length > 0;
        if (!hasContent) {
            var id = 'v20-empty-' + active;
            var el = document.getElementById(id);
            if (!el) {
                el = document.createElement('div');
                el.id = id;
                el.style.cssText = 'text-align:center;padding:48px 20px;color:var(--text-muted,#6B7280);';
                var icon = active === 'groups' ? 'fa-users' : active === 'broadcasts' ? 'fa-bullhorn'
                    : active === 'marketplace' ? 'fa-comment-dollar' : 'fa-comment-dots';
                var text = active === 'groups' ? 'No groups yet.'
                    : active === 'broadcasts' ? 'No broadcast lists yet.'
                    : active === 'marketplace' ? 'No marketplace conversations yet.'
                    : 'No conversations yet.<br>Follow users to message them.';
                el.innerHTML = '<i class="fas ' + icon + '" style="font-size:2.2rem;display:block;margin-bottom:14px;opacity:0.35;"></i>' +
                    '<p style="font-size:0.9rem;line-height:1.5;">' + text + '</p>' +
                    (active === 'chats'
                        ? '<button type="button" id="chat-empty-new" style="margin-top:14px;border:0;border-radius:22px;padding:10px 22px;background:#5BC0F8;color:#0A2A5E;font-weight:700;font-size:0.88rem;cursor:pointer;">Start a chat</button>'
                        : '');
                inner.appendChild(el);
            }
            /* drop any duplicate copies of this same placeholder, then show the one */
            Array.prototype.slice.call(inner.querySelectorAll('[id="' + id + '"]')).forEach(function (d) {
                if (d !== el) d.remove();
            });
            el.style.removeProperty('display');
            el.style.display = '';
        }

        /* Re-apply the existing search-box filter (app-chat.js) so a live
           query isn't silently undone by this patch unhiding every chat
           row when the Chats tab is (re)selected. */
        if (active === 'chats') {
            var searchInput = document.getElementById('contacts-search');
            if (searchInput && searchInput.value && typeof searchInput._chatFilter === 'function') {
                searchInput._chatFilter();
            }
        }

        /* app-chat.js's own "No conversations yet" placeholder only knows
           about 1:1 rows — don't show it under real groups/broadcasts in
           the unified list. */
        var _ces = document.getElementById('_chat-empty-state');
        if (_ces) {
            /* app-chat.js's placeholder only knows about 1:1 rows. Show it only on the Chats tab and only when there is
               truly nothing — no groups, broadcasts or marketplace threads either (it used to leak onto the Marketplace,
               Groups and Broadcasts tabs, and sit above real conversations). */
            var _anyConv = inner.querySelectorAll('.contact-item, .v14-group-item, .v20-broadcast-item, .v20-marketplace-item').length > 0;
            if (active !== 'chats' || _anyConv) _ces.style.setProperty('display', 'none', 'important');
            else _ces.style.removeProperty('display');
        }

        /* Newest first across chats / groups / broadcasts (pinned chats
           on top) via CSS `order` — #contacts-inner is a flex column and
           the two section wrappers are display:contents (style.css), so
           every row is a direct flex item. Rows carry data-last-ts. */
        Array.prototype.forEach.call(inner.querySelectorAll('.contact-item, .emp-chatrow'), function (el) {
            if (typeof window._empApplyRowOrder === 'function') { window._empApplyRowOrder(el); return; }
            var o = (el.dataset.pinned === '1') ? -2000000000 : -Math.floor((Number(el.dataset.lastTs) || 0) / 1000);
            var os = String(o === 0 ? 0 : o);
            if (el.style.order !== os) el.style.order = os;
        });
        _enforceTimeOrder(inner);

        /* group previews/unread badges (cached 20s inside, cheap to call) */
        if (groupsVisible && typeof window._empRefreshGroupRows === 'function') window._empRefreshGroupRows(false);

        _fixInnerHeight();
        _syncStatusBar();
        _syncQuickContactsBar();
    }


    /* =========================================================================
       §4  RE-APPLY ON EVERY RE-RENDER
       app-chat.js and app-patch-v14.js each rebuild parts of #contacts-inner
       independently (Firestore snapshots, localStorage sync, search). A
       MutationObserver — rather than hooking either file's function
       directly — means this keeps working regardless of which one
       finishes rendering last, without needing to touch those files.
       ========================================================================= */
    window._v20ApplyFilter = _applyFilter; /* called by app-chat.js on every chip change */
    var _mo = null, _moTimer = null;
    function _watchInner() {
        var inner = document.getElementById('contacts-inner');
        if (!inner || _mo) return;
        _mo = new MutationObserver(function () {
            clearTimeout(_moTimer);
            _moTimer = setTimeout(_applyFilter, 40);
        });
        _mo.observe(inner, { childList: true });
    }


    /* =========================================================================
       §6  HIDE THE STATUS/STORY BAR WHILE MESSAGES IS OPEN
       ROOT CAUSE (found from the actual screenshots, not guessed): the
       horizontal strip of circular avatars the screenshots showed under
       every tab — identical regardless of which tab was active — was
       never the Chats/Groups/Broadcasts list at all. It's
       #status-bar-container, the WhatsApp-style Status/Stories bar,
       which lives structurally OUTSIDE the Messages section (a sibling
       of <section id="dashboard">, not nested inside #messages-view),
       and defaults to `class="visible"` in the raw HTML.
       app-patch-openchat.js already tries to hide it, but:
         1. One of its two CSS mechanisms — '#messages-view
            #status-bar-container { display:none }' — can never match,
            since status-bar-container is not a descendant of
            #messages-view in the DOM.
         2. Its other, correct mechanism (body.oc-in-messages + a
            MutationObserver) lives in app-patch-openchat.js, which loads
            much later in index.html than app-chat.js/v20 — so if the
            Messages page is reached before that file finishes
            initializing, the bar simply hasn't been told to hide yet.
       FIX: since this file already reliably knows the exact moment the
       Messages tab bar exists on screen (that's it's whole job), it can
       just own hiding the status bar directly too — no dependency on
       app-patch-openchat.js's load order or its broken selector. Only
       ever restores it if THIS file was the one that hid it (tracked via
       a dataset flag), so it never fights with any other legitimate
       show/hide logic for the bar.
       ========================================================================= */
    /* FIX (Chat List Specification): #v8-quick-contacts is a horizontal
       "quick contacts" strip built entirely independently by
       app-fix-final.js §9 (fixMessages/_injectQuickContacts) — a second,
       separate renderer for the messages list that exists alongside
       app-chat.js's renderContactList. It inserts itself via
       `inner.before(bar)`, i.e. as a SIBLING immediately before
       #contacts-inner, not a child of it — so it was invisible to every
       part of this file that only ever looks inside #contacts-inner
       (including _directChildren() and the MutationObserver watching
       #contacts-inner's own childList). It also rebuilds itself fresh on
       every navigation into Messages, regardless of which tab is active,
       which is why it kept showing identically under Groups/Broadcasts
       even after the underlying .contact-item rows were being hidden
       correctly. Since it's fundamentally "quick access to start a 1:1
       chat," it belongs with the Chats tab only. Re-applied every
       _applyFilter() call (not a one-time hide) because
       app-fix-final.js recreates this element from scratch periodically
       — a "hide once" flag would go stale the moment it's rebuilt. */
    function _syncQuickContactsBar() {
        var bar = document.getElementById('v8-quick-contacts');
        if (!bar) return;
        var active = _getTab();
        bar.style.setProperty('display', active === 'chats' ? 'flex' : 'none', 'important');
    }


    function _syncStatusBar() {
        var sbc = document.getElementById('status-bar-container');
        if (!sbc) return;
        /* #v20-chat-tabs, once built, stays in the DOM permanently — it is
           never removed when navigating away from Messages. So its mere
           presence can't be used as "Messages is open right now"; that
           would hide the status bar forever after the FIRST time Messages
           was ever visited, on every other page too. offsetParent is null
           whenever the element or any ancestor is display:none (however
           that's toggled — inline style or a CSS class on a parent
           .content-section), so it correctly reflects real, current
           visibility regardless of which mechanism hid it. */
        var bar = document.getElementById('v20-chat-tabs');
        var messagesOpen = !!(bar && bar.offsetParent !== null);
        if (messagesOpen) {
            if (sbc.style.display !== 'none') {
                sbc.dataset.v20Hidden = '1';
                sbc.style.setProperty('display', 'none', 'important');
            }
        } else if (sbc.dataset.v20Hidden === '1') {
            sbc.dataset.v20Hidden = '';
            sbc.style.removeProperty('display');
        }
    }


    /* =========================================================================
       §5  BOOTSTRAP
       ========================================================================= */
    function _init() {
        if (!_buildTabBar()) return false;
        _paintTabBar();
        _watchBroadcastLists();
        _watchMarketplaceMessages();
        _watchInner();
        var _si = document.getElementById('contacts-search');
        if (_si && !_si._v20Wired) { _si._v20Wired = true; _si.addEventListener('input', _applyFilter); }
        _applyFilter();
        _syncStatusBar();
        return true;
    }

    /* FIX (Chat List Specification — "chats/groups/broadcasts combined in
       every column"): three independent files re-render into this one
       shared #contacts-inner (app-chat.js, app-patch-v14.js, and this
       file's own broadcasts section), and the ONLY thing that re-hides
       rows per the active tab was a MutationObserver debounced by 40ms
       (see §4 above). A burst of renders that keeps arriving faster than
       every 40ms — exactly what happens when app-fixes.js's
       _startRealtimeListeners() does a full listener restart (visible in
       console as "[Listeners] Starting all real-time Firestore
       listeners...") — can keep re-arming that debounce indefinitely, so
       _applyFilter() never actually runs again after the burst starts.
       Every row appended from that point on keeps its default (visible)
       display, regardless of which tab is active, which is exactly the
       "everything shows in every column" symptom. This unconditional,
       idempotent re-apply is a safety net on top of the MutationObserver
       (not a replacement — the observer still gives near-instant
       correction for the common case): even if a mutation burst starves
       the debounce completely, the tab separation can never drift for
       longer than this interval. */
    setInterval(function () {
        if (document.getElementById('v20-chat-tabs')) _applyFilter();
        // Only re-check the broadcastLists listener here if the Broadcasts
        // tab is actually the one showing — _watchBroadcastLists() itself
        // also re-checks this plus its own error backoff, so this can
        // never re-open a rejected listener faster than the backoff allows,
        // and never opens one at all for the (common) case where nobody is
        // looking at Broadcasts right now. See the FIX note above
        // _broadcastUnsub for why this mattered for call reliability.
        if (_wantsBroadcasts()) _watchBroadcastLists();
        if (_getTab() === 'marketplace') _watchMarketplaceMessages();
    }, 1200);

    document.addEventListener('empyrean-init-done', function () { setTimeout(_init, 900); });
    document.addEventListener('empyrean-user-ready', function () { setTimeout(_init, 950); });

    /* #contacts-inner may not exist yet the first time either event fires
       (guest → login transition, slow first paint) — keep checking for a
       few seconds rather than depending on exact timing. */
    var _tries = 0;
    var _iv = setInterval(function () {
        _tries++;
        if (_init() || _tries > 20) clearInterval(_iv);
    }, 500);

    /* Diagnostic helper — run window._v20Debug() in the console and share
       the output. Reports exactly what this file sees right now, so the
       next fix (if needed) is based on a direct read of the live DOM
       instead of another guess from a screenshot. */
    window._v20Debug = function () {
        var bar = document.getElementById('v20-chat-tabs');
        var inner = document.getElementById('contacts-inner');
        var sbc = document.getElementById('status-bar-container');
        var chatItems = inner ? _directChildren(inner, 'contact-item') : [];
        var out = {
            tabBarExists: !!bar,
            tabBarOffsetParentIsNull: bar ? (bar.offsetParent === null) : 'n/a (no bar)',
            activeTabStored: (function () { try { return localStorage.getItem(TAB_KEY); } catch (e) { return '(threw)'; } })(),
            innerExists: !!inner,
            contactItemCount: chatItems.length,
            contactItemDisplays: chatItems.map(function (el) { return el.style.display || '(empty string)'; }),
            groupsSectionExists: !!document.getElementById('v14-groups-section'),
            broadcastsSectionExists: !!document.getElementById('v20-broadcasts-section'),
            marketplaceSectionExists: !!document.getElementById('v20-marketplace-section'),
            statusBarExists: !!sbc,
            statusBarDisplay: sbc ? (sbc.style.display || '(empty string)') : 'n/a',
            statusBarComputedDisplay: sbc ? getComputedStyle(sbc).display : 'n/a',
            statusBarV20HiddenFlag: sbc ? sbc.dataset.v20Hidden : 'n/a'
        };
        console.log('[V20-Debug]', JSON.stringify(out, null, 2));
        return out;
    };

    console.log('[EmpyreanPatchV20] ✅ Messages list segmented into Chats / Groups / Broadcasts / Marketplace tabs. (build 2026-07-17: added Marketplace tab, reusing app-marketplace.js\'s marketplace_messages collection — see §2b)');

})();