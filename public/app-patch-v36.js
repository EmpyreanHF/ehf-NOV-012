/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v36
   app-patch-v36.js  |  Load LAST — after app-patch-v35.js (and therefore after
   app-chat.js, app-patch-openchat.js, app-patch-v12.js, app-fixes.js)

   FIXES TWO REPORTED ISSUES:

   ISSUE #1 — Contact list permanently stuck on "Tap to start a conversation"
   ─────────────────────────────────────────────────────────────────────────
   REV.1 MISTAKE (what shipped first, and why it visibly changed nothing):
     Rev.1 assumed this was a TIMING problem — that _syncLastMessagePreview()
     in app-chat.js (a one-shot Firestore .get() against
     `messages/{tid}/msgs` ordered by a `ts` field) simply lost the race
     against Firebase Auth settling, so rev.1 just re-ran
     window.renderContactList() again once auth was confirmed ready.

     That re-run genuinely happens (visible in console as "[V36]
     renderContactList() re-run after empyrean:auth-ready..."), but the
     rows still show the placeholder, because auth timing was never the
     real problem.

   ACTUAL ROOT CAUSE (confirmed by reading every write path in the app):
     _syncLastMessagePreview queries a collection PATH the live chat
     system doesn't write to. The real, currently-active send path —
     app-patch-openchat.js's _doSend() (~line 4319) — writes each message
     as a FLAT doc: `messages/{msgId}` with fields senderId / receiverId /
     text / createdAt (ISO string). It never touches `messages/{tid}/msgs`
     or a field called `ts` at all. So _syncLastMessagePreview's query
     against that dead path returns an empty snapshot on every single
     call, no matter how many times or how late it's re-run — re-running
     a query that's structurally looking in the wrong place changes
     nothing, which is exactly what was reported.

     app-patch-openchat.js's _doSend() DOES, however, also keep a
     `chats/{chatId}` doc up to date on every send (merge:true):
         { participants, lastMessage, lastMessageTime, lastSenderId }
     — a doc built for exactly this "what's the last message in this
     thread" use case, already proven readable via plain .get() elsewhere
     in that same file (_loadChatFlags, ~line 1827). It was just never
     wired into the contact list.

   FIX (rev.2):
     Keep rev.1's auth-ready re-render (harmless, still useful as a cheap
     safety net) and ADD the actual fix: wrap window.renderContactList so
     that every time it runs, this patch attaches a live onSnapshot
     listener straight to `chats/{chatId}` for each visible contact row —
     the SAME doc the real send path keeps current — and writes
     lastMessage / lastMessageTime directly onto that row the moment the
     doc updates. Listeners are cached per uid (no duplicate subscriptions
     on repeated re-renders) and torn down when a row leaves the list.

   REV.2 GAP (why it "worked, then reverted back to the bug"):
     rev.2's paint only ran inside the onSnapshot callback — i.e. only
     when the chats/{chatId} doc itself changed. But renderContactList()
     is called constantly from all over the app (message-sent handlers,
     incoming-message listeners, app-fix-final.js's own refresh loop —
     8+ call sites) and EVERY call fully rebuilds every .contact-item row
     from scratch, straight back to the localStorage-only placeholder
     text. The very first paint looked correct, but the next unrelated
     renderContactList() call (no new message involved, just some other
     UI event elsewhere) silently rebuilt the row back to the placeholder
     — and since nothing had changed in Firestore, the listener never
     fired again to fix it a second time.

   FIX (rev.3):
     Cache the last-known {lastMessage, lastMessageTime} per contact and
     reapply it to that contact's row on EVERY render pass — not only
     when a fresh Firestore snapshot arrives. This is a pure, cheap DOM
     write (no network call), so running it on every pass is safe, and it
     closes the gap rev.2 left: however many times renderContactList()
     rebuilds the list in the background, the very next pass immediately
     repaints every row from cache before the person ever sees the
     placeholder flash back.

   ISSUE #2 — Chat header / message background redesign
   ─────────────────────────────────────────────────────────────────────────
   The live 1:1 chat header and message canvas are built by
   app-patch-openchat.js (#oc-chat-header, #oc-peer-avatar, #oc-peer-name,
   #oc-peer-status, .oc-header-btn, #oc-messages-body) — NOT by the older
   #chat-header-info premium styles in app-chat.js, which target an id
   that app-patch-openchat.js's own cv.innerHTML reset+rebuild bypasses
   entirely (dead CSS, confirmed by grep: no live element ever carries
   the `chat-header-premium` / `chat-bg-premium` classes it styles).

   This patch re-skins the REAL, currently-rendered header/background
   elements in place — no DOM rebuild, so it can't fight
   app-patch-openchat.js's own header-close/back-button wiring.

   rev.4 shipped a deep-navy/indigo + gold-hairline look. rev.5 (below)
   replaces that with the requested "Elegant White + Gold, curvy/premium"
   direction — same in-place re-skin strategy, just a different palette
   and shape:
     • #oc-cl-header / #oc-chat-header: ivory/white gradient with a gold
       hairline + curved bottom corners, replacing the navy fill.
     • #oc-cl-back-btn / #oc-cl-menu-btn / #oc-back-btn / .oc-header-btn:
       cream glass chips with a gold ring and navy icon glyphs (their SVG
       fill/stroke is repainted here too — the old white glyphs would be
       invisible once the header background went light).
     • #oc-peer-avatar / .contact-row-avatar / #v8-quick-contacts img:
       circles → soft "squircles" (curvy rounded-squares) with a slim
       gold ring + lift shadow instead of a flat border. The live-
       broadcast red ring stays untouched on purpose — it's a different
       signal (currently streaming) and shouldn't blur into the gold
       accent colour.
     • #oc-peer-name / #oc-peer-status: recoloured for contrast on the
       now-light header, live status dot unchanged (pulses on "online").
     • #oc-messages-body / .oc-tick: unchanged from rev.4 — still the
       soft ivory/lavender wallpaper and premium tick re-skin described
       below.
   Pure CSS, appended to <head> after every other stylesheet in the load
   order, so equal-specificity id/class rules here win the cascade without
   needing !important on most declarations (only the properties the
   inline-styled elements themselves set need it).

   ISSUE #3 — Voice→video switch: other person accepts, but video never appears
   ─────────────────────────────────────────────────────────────────────────
   ROOT CAUSE (confirmed by reading app-patch-openchat.js's own renegotiation
   handler):
     app-patch-openchat.js:2816, inside `_rtc.onVideoSwitchSnapshot`:

         if (data.videoSwitchAnswer && _rtc.videoSwitchAwaitingAnswer) {
             _rtc.videoSwitchAwaitingAnswer = false;
             if (_rtc.pc && !_rtc.pc.currentRemoteDescription) {
                 _rtc.pc.setRemoteDescription(new RTCSessionDescription(data.videoSwitchAnswer)) ...
             }
         }

     The `!_rtc.pc.currentRemoteDescription` guard is copy-pasted from the
     ORIGINAL call-setup answer listener (line 3177), where it correctly
     means "we haven't applied an answer yet." But a voice→video switch only
     ever happens on an ALREADY-CONNECTED call — `pc.currentRemoteDescription`
     has been non-null since the very first handshake and never becomes null
     again. So this guard is permanently false the moment a call is live,
     `setRemoteDescription()` is never called on the renegotiated answer, and
     the RTCPeerConnection stays stuck in signalingState 'have-local-offer'
     forever. The requester's own video track was already added and shown
     locally (which is why the requester's own camera preview can look like
     it "worked" for a split second) — but neither side's connection ever
     finishes the video renegotiation, so no video actually flows either way.
     That matches exactly: consent accepted, answer sent back, video never
     appears.

   WHY THIS PATCH CAN'T JUST EDIT THAT LINE:
     `_rtc` is a variable private to app-patch-openchat.js's own closure —
     it is never exposed on `window`, so no later-loaded file can reach in
     and flip that one guard directly. Instead, this patch fixes it from
     the outside using the same two hooks every browser exposes regardless
     of closures: the RTCPeerConnection constructor and the Firestore call
     doc both parties already write to.

   FIX:
     1. Wrap `window.RTCPeerConnection` (once) so every peer connection this
        page creates is also handed to a small tracker here — a transparent
        wrapper; every real instance is 100% the native object, so nothing
        else in the app (instanceof checks, method calls) can tell the
        difference.
     2. Watch each tracked connection's signalingstatechange. The ORIGINAL
        call handshake also passes through 'have-local-offer' once (on
        whichever side placed the original call) — so only signal on a
        *second* transition into 'have-local-offer', and only once the
        connection has already reported connectionState 'connected' at
        least once (i.e. the call was already live, which is exactly what
        distinguishes a video-switch renegotiation from the original
        handshake, and holds true regardless of which side — original
        caller or original callee — is the one requesting the switch).
     3. At that point, look up this user's currently-active call doc
        (`calls` where participants array-contains me, status 'active') and
        attach a small dedicated listener for `videoSwitchAnswer`. The
        moment it appears, apply it directly:
        `pc.setRemoteDescription(new RTCSessionDescription(answer))` —
        completing the exact step app-patch-openchat.js's own broken guard
        was blocking. Once applied, `pc.signalingState` naturally leaves
        'have-local-offer', so this can't double-apply even though the
        listener stays attached until the call ends.
     No existing behavior is touched — this only ever fires in the specific
     stuck state described above, and does nothing on every other call.
   ============================================================================= */

/* =============================================================================
   REV.4 ADDITIONS (same file, no new patch — per standing instruction not
   to keep spawning new patch files):

   A) RECENT CHAT NOT SORTED TO THE TOP
      renderContactList() (app-chat.js) builds rows in whatever order
      followedUserIds/mockUsers happen to iterate in — never by recency.
      _v36FixContactPreviews now also sorts .contact-item rows by the same
      chats/{chatId}.lastMessageTime this file already fetches for the
      preview text (rev.2/rev.3 above), most-recent first, re-running the
      sort both on every render pass and immediately whenever a live
      onSnapshot update lands (so a new incoming message jumps that
      contact to the top right away, not just on the next re-render).
      Only reorders .contact-item nodes — #v14-groups-section, #v20's
      broadcasts section, the search box and the tab bar are untouched.

   B) TWO HEADERS SHOWING AT ONCE ("white" one above the blue one)
      Root cause: app-fixes.js's #nav-breadcrumb (~line 13527) — a small
      "🏠 Messages" desktop-style breadcrumb — is inserted above EVERY
      section on navigation and is never scoped to hide anywhere. It was
      never "a second Messages header" by design, it's a leftover
      desktop-nav aid that happens to render right above
      app-patch-openchat.js's own blue #oc-cl-header on the Messages
      section specifically. Per instruction, this is now hidden outright
      (not shifted/covered) via body.oc-in-messages #nav-breadcrumb —
      reusing app-patch-openchat.js's own existing "Messages section is
      visible" signal — leaving the blue #oc-cl-header as the only header.

   C) "PREMIUM THUMBNAIL" FOR THE (NOW ONLY) BLUE HEADER
      #oc-cl-header was still flat #1B2B8B with plain white text — it
      never got the gradient/gold-hairline/glass-chip-button treatment
      already applied to the single-chat header (#oc-chat-header) earlier
      in this file. Re-skinned to match, via !important where needed to
      win over #oc-cl-header's inline style set at creation time.
   ============================================================================= */

(function empyreanPatchV36() {
    'use strict';

    if (window._empyreanPatchV36Loaded) return;
    window._empyreanPatchV36Loaded = true;

    function log(msg) { console.log('[V36] ' + msg); }

    /* ═══════════════════════════════════════════════════════════════════
       PART A — self-healing contact-list previews
       ═══════════════════════════════════════════════════════════════════ */

    var _rerenderPending = false;
    function _rerenderContactListSoon(reason) {
        if (_rerenderPending) return;
        _rerenderPending = true;
        setTimeout(function () {
            _rerenderPending = false;
            try {
                var isGuest = (window.EmpState && window.EmpState.isGuest != null)
                    ? window.EmpState.isGuest : !!window.isGuest;
                if (isGuest) return;
                if (typeof window.renderContactList === 'function') {
                    window.renderContactList();
                    log('renderContactList() re-run after ' + reason + ' — refreshing any rows stuck on the placeholder.');
                }
            } catch (e) {}
        }, 250);
    }

    window.addEventListener('empyrean:auth-ready', function () {
        _rerenderContactListSoon('empyrean:auth-ready');
    });
    window.addEventListener('empyrean:firebase-ready', function () {
        _rerenderContactListSoon('empyrean:firebase-ready');
    });

    /* Belt-and-suspenders: if neither event above ever fires on some
       older/slower session, still take one more pass a few seconds after
       load — cheap, and harmless if the list was already correct. */
    document.addEventListener('empyrean-init-done', function () {
        setTimeout(function () { _rerenderContactListSoon('startup safety-net'); }, 4000);
    });

    /* ── rev.2: the actual fix — read the last message from the doc the
       real send path (app-patch-openchat.js) genuinely keeps current ── */

    // FIX (2026-08-13 — flood of "[V36] chats/{chatId} listener failed:
    // permission-denied" for every contact row): this only checked that
    // Firestore itself was initialized, not that a real Firebase Auth
    // session (anonymous or signed-in) actually existed yet. chats/{id}'s
    // rule requires request.auth != null (firebase-rules.js), so every
    // time _v36FixContactPreviews ran before that session settled — which
    // it does, since renderContactList() (which this wraps) fires from
    // several places during boot — it attached one onSnapshot per visible
    // contact, all denied at once. Adding the fbAuth.currentUser check
    // here means this simply no-ops until a real session exists; the next
    // renderContactList() call (there are 8+ call sites per this file's
    // own header) picks the listeners up as soon as it does, with no
    // extra retry loop needed.
    function _v36FbOk() { return !!(window.fbDb && window._firebaseLoaded && window.fbAuth && window.fbAuth.currentUser); }

    function _v36Me() {
        var s  = window.EmpState || {};
        var us = s.userState || window.userState || {};
        return us.id || null;
    }

    function _v36BuildChatId(a, b) { return [a, b].sort().join('_'); }

    /* uid -> unsubscribe fn, so repeated re-renders never open duplicate
       listeners on the same thread, and a row that disappears (e.g. it's
       been filtered by a Groups/Broadcasts tab switch — see app-chat.js's
       own comment on _chatFilter) gets its listener cleaned up. */
    var _v36ChatListeners = {};

    /* uid -> last-known {lastMessage, lastMessageTime} from Firestore.
       CRITICAL: renderContactList() is called constantly from all over
       the app (message-sent handlers, incoming-message listeners,
       app-fix-final.js's own refresh loop — grep shows 8+ call sites) and
       every single call FULLY REBUILDS every .contact-item row from
       scratch, straight back to the localStorage-only placeholder text.
       An onSnapshot listener only fires again when the Firestore doc
       itself changes — it does NOT fire just because the row was
       rebuilt — so without this cache, the very first correct paint
       looked like it worked, then the next unrelated renderContactList()
       call (no new message, just some other UI event) silently wiped it
       back to the placeholder with nothing left to repaint it. Caching
       the last-known value here and reapplying it to every row on every
       single render pass (not only when a fresh snapshot arrives) closes
       that gap. */
    var _v36LastKnownData = {};
    window._v36ForgetChat = function (uid) { delete _v36LastKnownData[uid]; }; /* used by chat delete so a stale preview can't repaint */

    function _v36ApplyToRow(rowEl, data) {
        if (!rowEl || !data) return;
        var textEl = rowEl.querySelector('.contact-last-msg');
        var timeEl = rowEl.querySelector('.contact-last-time');
        if (textEl && data.lastMessage) {
            var preview = data.lastMessage;
            if (window._empE2EE && window._empE2EE.isEnvelope(preview)) {
                /* E2EE: chats/{id}.lastMessage holds the sealed string — open it on this
                   device. Show a neutral label meanwhile so ciphertext never flashes. */
                textEl.textContent = '\uD83D\uDD12 Message';
                window._empE2EE.readText(preview).then(function (plain) {
                    if (!rowEl.isConnected || rowEl.dataset.statusLine) return; /* "typing…" etc. wins */
                    var pv = String(plain || '');
                    textEl.textContent = pv.length > 38 ? pv.slice(0, 38) + '\u2026' : pv;
                });
            } else {
                if (preview.length > 38) preview = preview.slice(0, 38) + '\u2026';
                textEl.textContent = preview;
            }
        }
        if (timeEl && data.lastMessageTime) {
            timeEl.style.display = '';
            timeEl.textContent = (typeof window._chatListTime === 'function')
                ? window._chatListTime(data.lastMessageTime)
                : ((typeof window._timeAgo === 'function') ? window._timeAgo(data.lastMessageTime) : '');
        }
        /* re-apply "typing…" / "Waiting for network" on top of the repainted preview */
        if (typeof window._empRowStatusLine === 'function') window._empRowStatusLine(rowEl, rowEl.dataset.userId);
    }

    /* Reorders only the .contact-item rows within container, most-recent
       chat first — never touches #v14-groups-section, #v20-broadcasts-
       section, the search box, or the tab bar, since none of those carry
       the .contact-item class this selector targets. Rows with no cached
       last-message yet (never messaged, or listener hasn't resolved)
       sink to the bottom, keeping their existing relative order (Array
       .sort is stable in every engine this app ships on). */
    function _v36SortContactRows(container) {
        var rows = Array.prototype.slice.call(container.querySelectorAll('.contact-item[data-user-id]'));
        if (rows.length < 2) return;
        rows.sort(function (a, b) {
            var pa = a.dataset.pinned === '1' ? 1 : 0, pb = b.dataset.pinned === '1' ? 1 : 0;
            if (pa !== pb) return pb - pa; /* pinned chats stay on top */
            var da = _v36LastKnownData[a.dataset.userId];
            var db = _v36LastKnownData[b.dataset.userId];
            var ta = (da && da.lastMessageTime) ? new Date(da.lastMessageTime).getTime() : -1;
            var tb = (db && db.lastMessageTime) ? new Date(db.lastMessageTime).getTime() : -1;
            return tb - ta; /* most recent first */
        });
        rows.forEach(function (row) { container.appendChild(row); });
    }

    function _v36FixContactPreviews() {
        if (!_v36FbOk()) return;
        var me = _v36Me();
        if (!me) return;
        var container = document.getElementById('contacts-inner')
            || document.getElementById('contact-list-container');
        if (!container) return;

        var liveUids = {};
        container.querySelectorAll('.contact-item[data-user-id]').forEach(function (rowEl) {
            var uid = rowEl.dataset.userId;
            if (!uid) return;
            liveUids[uid] = true;

            /* Repaint from cache on EVERY pass — this is what actually
               survives renderContactList()'s constant full rebuilds (see
               comment on _v36LastKnownData above). Cheap: pure DOM writes,
               no network call, safe to run on every render. */
            if (_v36LastKnownData[uid]) _v36ApplyToRow(rowEl, _v36LastKnownData[uid]);

            if (_v36ChatListeners[uid]) return; /* already watching this thread */

            var chatId = _v36BuildChatId(me, uid);
            _v36ChatListeners[uid] = window.fbDb.collection('chats').doc(chatId)
                .onSnapshot(function (docSnap) {
                    if (!docSnap.exists) return;
                    var data = docSnap.data() || {};
                    if (!data.lastMessage && !data.lastMessageTime) return;

                    /* typing indicator: peer's entry in data.typing (keys that are not mine) */
                    try {
                        var _tp = data.typing || {}, _myA = window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid, _tv = 0;
                        Object.keys(_tp).forEach(function (k) { if (k !== _myA && k !== me && Number(_tp[k]) > _tv) _tv = Number(_tp[k]); });
                        if (typeof window._empNoteTyping === 'function') window._empNoteTyping(uid, _tv);
                    } catch (eTyp) {}

                    _v36LastKnownData[uid] = data;

                    /* Row may have been rebuilt since the listener was
                       attached (renderContactList re-renders the DOM) —
                       always re-query it fresh rather than holding a
                       stale reference. */
                    var freshRow = container.querySelector('.contact-item[data-user-id="' + uid + '"]');
                    _v36ApplyToRow(freshRow, data);

                    /* A live update is exactly when the ordering can have
                       changed (new message just landed) — re-sort right
                       away rather than waiting for the next unrelated
                       renderContactList() pass. */
                    _v36SortContactRows(container);
                }, function (err) {
                    console.warn('[V36] chats/' + chatId + ' listener failed:', err && err.code, err && err.message);
                    /* FIX (2026-08-25 — "permission-denied spam that never
                       recovers, difficulty logging in"): _v36FbOk() (added
                       2026-08-13) only checks that fbAuth.currentUser is
                       truthy BEFORE attaching — it can't see a token that
                       hasn't finished propagating yet, which is exactly
                       what a fresh sign-in on a poor connection produces:
                       currentUser is already set, but Firestore's rules
                       evaluation for the very first request can still see
                       no valid auth for a brief window right after, so
                       onSnapshot's error callback fires once with
                       permission-denied even though the guard passed.
                       Firestore treats permission-denied as TERMINAL — it
                       never retries this listener on its own — and this
                       line above (`if (_v36ChatListeners[uid]) return;`)
                       had already recorded the (now-dead) unsubscribe
                       function the moment onSnapshot() was called, so that
                       guard permanently blocked ever trying this contact
                       again, even minutes later once auth had fully
                       settled. That's a regression the 2026-08-13 fix
                       introduced: before it, every renderContactList()
                       pass re-attempted every listener with no memory of
                       past failures, so a transient denial eventually
                       cleared itself; after it, the FIRST denial for a
                       given contact is now permanent for the rest of the
                       page session. Only self-heal on permission-denied
                       specifically (the transient-token case) — leave the
                       entry in place, unmodified, for any other error, so
                       a genuine, persistent authorization problem still
                       only logs once instead of retrying forever. */
                    if (err && err.code === 'permission-denied') {
                        delete _v36ChatListeners[uid];
                    }
                });
        });

        /* Drop listeners for rows no longer present in the list. Cached
           data is intentionally kept (not deleted) so it's ready to
           instantly repaint the row again if that contact reappears
           (e.g. switching Chats/Groups/Broadcasts tabs back). */
        Object.keys(_v36ChatListeners).forEach(function (uid) {
            if (liveUids[uid]) return;
            try { _v36ChatListeners[uid](); } catch (e) {}
            delete _v36ChatListeners[uid];
        });

        /* Also sort on every ordinary render pass, not only on a fresh
           snapshot — covers the very first paint, where cached data from
           an EARLIER listener (attached before this particular DOM
           rebuild) already exists but nothing has changed in Firestore
           since to re-trigger the onSnapshot branch above. */
        _v36SortContactRows(container);
    }

    /* Wrap once, delegating to whatever window.renderContactList already
       resolves to (app-chat.js's real implementation, already itself
       wrapped by app-fix-final.js's quick-contacts refresh — same
       lazy-resolver delegation pattern used there, so this only ever
       ADDS a pass on top and never discards an earlier wrap). */
    if (!window._v36RealRenderContactList && typeof window.renderContactList === 'function') {
        window._v36RealRenderContactList = window.renderContactList;
    }
    window.renderContactList = function () {
        if (typeof window._v36RealRenderContactList === 'function') {
            window._v36RealRenderContactList.apply(this, arguments);
        }
        _v36FixContactPreviews();
    };


    /* ═══════════════════════════════════════════════════════════════════
       PART B — premium chat header + message background
       ═══════════════════════════════════════════════════════════════════ */

    function _injectPremiumChatStyle() {
        if (document.getElementById('_v36-chat-premium-style')) return;
        var s = document.createElement('style');
        s.id = '_v36-chat-premium-style';
        s.textContent = [

            /* ── kill the global desktop-style breadcrumb ("🏠 Messages")
               while viewing the Messages section — it's app-fixes.js's
               #nav-breadcrumb (~line 13527), inserted above EVERY section
               and never scoped to hide here, which is exactly the plain
               white sliver sitting above the app's own blue header.
               body.oc-in-messages is app-patch-openchat.js's own existing
               signal for "Messages section is currently visible" (set/
               cleared by _checkMessagesVisible / _doExitMessages), so this
               reuses it rather than adding a new one. ── */
            'body.oc-in-messages #nav-breadcrumb{display:none!important;}',

            /* ── contact-list header (#oc-cl-header: back arrow, "Messages"
               title, + button) — was flat #1B2B8B inline-styled at
               creation time; !important needed here to win over that
               inline style. rev.5: ivory/white + gold, curved bottom
               corners, matching the same language as the single-chat
               header below (#oc-chat-header) so there's one consistent
               "elegant white + gold" look across both screens. ── */
            '#oc-cl-header{',
            '  background:linear-gradient(180deg,#FFFFFF 0%,#F5F9FE 100%) !important;',
            '  border-bottom:none !important;',
            '  border-radius:0 0 26px 26px;',
            '  box-shadow:0 4px 18px rgba(23,33,63,0.10), inset 0 -2px 0 rgba(79,176,242,0.55);',
            '  padding:14px 18px !important;',
            '}',
            '#oc-cl-header span{',
            '  font-weight:700 !important;font-size:1.02rem !important;letter-spacing:0.2px;',
            '  color:#14213D;text-shadow:none;',
            '}',
            '#oc-cl-back-btn,#oc-cl-menu-btn{',
            '  border-radius:14px;width:36px;height:36px;',
            '  display:flex !important;align-items:center;justify-content:center;',
            '  background:linear-gradient(135deg,#FFFFFF,#E3EFFB);',
            '  box-shadow:0 0 0 1.5px rgba(79,176,242,0.45),0 2px 6px rgba(23,33,63,0.10);',
            '  transition:box-shadow 0.15s,transform 0.15s;',
            '}',
            '#oc-cl-back-btn:hover,#oc-cl-menu-btn:hover{ box-shadow:0 0 0 1.5px rgba(79,176,242,0.75),0 3px 10px rgba(23,33,63,0.14); }',
            '#oc-cl-back-btn:active,#oc-cl-menu-btn:active{ transform:scale(0.92); }',
            '#oc-cl-back-btn svg,#oc-cl-menu-btn svg{ fill:#14213D; }',
            '#oc-cl-back-btn svg path,#oc-cl-menu-btn svg path{ fill:#14213D;stroke:#14213D; }',

            /* ── contact-list rows — curvy "squircle" thumbnails instead
               of plain circles, slim gold ring + lift shadow instead of
               a flat border. Covers the main list and the quick-contacts
               strip (#v8-quick-contacts, app-fix-final.js §9). The live-
               broadcast red ring (.vf-avatar-live-ring) is untouched on
               purpose — different signal, shouldn't blur into gold. ── */
            '.contact-row-avatar,',
            '#v8-quick-contacts img,',
            '.contact-avatar-wrap img{',
            '  border-radius:30% !important;',
            '  box-shadow:0 0 0 2.5px rgba(79,176,242,0.55),0 3px 8px rgba(23,33,63,0.12) !important;',
            '  border-color:transparent !important;',
            '  transition:box-shadow 0.18s;',
            '}',
            '.contact-row:hover .contact-row-avatar,',
            '.contact-row:active .contact-row-avatar{',
            '  box-shadow:0 0 0 2.5px rgba(79,176,242,0.85),0 4px 12px rgba(23,33,63,0.16) !important;',
            '}',
            '.contact-online-dot{ border-color:#fff !important; }',
            '#v8-quick-contacts{ background:linear-gradient(180deg,#FFFFFF,#FFFFFF); }',

            /* ── single-chat header / avatar / name / buttons / canvas ──
               REDESIGN (2026-10-20 — "premium classic elegant white"): these
               rules now state the SAME white + light-blue design as the base
               rules in app-patch-openchat.js's _injectStyles(). They had to
               be updated together because the two stylesheets are injected at
               different moments (this file at script load, openchat's at
               DOM-ready) and, at equal specificity, whichever is injected
               last wins — so a palette change in only one of them showed up
               or not depending on load order. Sizes/geometry are unchanged
               (flat edge-to-edge header, compact 7px/12px padding, 36px
               avatar). */
            '#oc-chat-header{',
            '  background:#fff;',
            '  border-bottom:1px solid #E7EBF3;',
            '  border-radius:0 !important;',
            '  box-shadow:0 6px 18px -12px rgba(20,33,61,0.24);',
            '  padding:7px 12px !important;',
            '}',
            '#oc-back-btn{',
            '  background:#F1F5FB;',
            '  box-shadow:none;',
            '}',
            '#oc-back-btn:hover,#oc-back-btn:focus{ background:#E6EEF9; }',
            '#oc-back-btn svg{ fill:#14213D; }',

            '#oc-peer-avatar{',
            '  width:36px !important;height:36px !important;',
            '  border-radius:50%;',
            '  border:2px solid #fff;',
            '  box-shadow:0 0 0 1.5px #B9DDF8,0 2px 8px rgba(20,33,61,0.14);',
            '  background:#EAF2FB;',
            '}',

            '#oc-peer-name{',
            '  font-weight:700;font-size:1rem;letter-spacing:0.1px;',
            '  color:#14213D;text-shadow:none;',
            '}',
            '#oc-peer-status{',
            '  display:flex;align-items:center;gap:5px;',
            '  font-size:0.73rem;color:#5B6B86;opacity:1;',
            '}',
            '#oc-peer-status::before{',
            '  content:"";width:7px;height:7px;border-radius:50%;flex-shrink:0;',
            '  background:#9CA3AF;box-shadow:0 0 0 rgba(16,185,129,0.5);',
            '}',
            '#oc-peer-status.oc-status-online::before{',
            '  background:#16A34A;',
            '  animation:v36StatusPulse 2s ease-out infinite;',
            '}',
            '@keyframes v36StatusPulse{',
            '  0%{ box-shadow:0 0 0 0 rgba(16,185,129,0.55); }',
            '  70%{ box-shadow:0 0 0 6px rgba(16,185,129,0); }',
            '  100%{ box-shadow:0 0 0 0 rgba(16,185,129,0); }',
            '}',

            '.oc-header-btn{',
            '  background:#F1F6FC;',
            '  box-shadow:none;',
            '  border-radius:50%;',
            '}',
            '.oc-header-btn:hover{ background:#E3EFFB; }',
            '.oc-header-btn:active{ transform:scale(0.92); }',
            '.oc-header-btn svg{ fill:#1E2F52; }',
            '.oc-header-btn svg path,.oc-header-btn svg circle,.oc-header-btn svg rect{ fill:#1E2F52; }',

            '#oc-messages-body{',
            '  background:#F5F7FB;',
            '}',
            '#oc-messages-body::before{',
            '  content:"";display:none;',
            '}',

            /* ── premium send-status ticks (re-skin only — app-patch-
               openchat.js\'s _applyTickState still decides which state
               applies; this only changes how each state LOOKS) ── */
            '.oc-tick{',
            '  font-size:0.74rem;font-weight:700;letter-spacing:-1px;',
            '  transition:transform 0.2s ease;',
            '  display:inline-block;',
            '}',
            '.oc-tick.state-sent,.oc-tick.state-delivered{',
            '  background:linear-gradient(180deg,#B9BFC9 0%,#8C93A0 100%);',
            '  -webkit-background-clip:text;background-clip:text;',
            '  -webkit-text-fill-color:transparent;color:#9AA0A6;',
            '}',
            '.oc-tick.state-read{',
            '  background:linear-gradient(180deg,#5CC8FF 0%,#1E88E5 100%);',
            '  -webkit-background-clip:text;background-clip:text;',
            '  -webkit-text-fill-color:transparent;color:#34B7F1;',
            '  filter:drop-shadow(0 0 2.5px rgba(52,183,241,0.45));',
            '  animation:v36TickReadIn 0.28s ease-out;',
            '}',
            '@keyframes v36TickReadIn{',
            '  0%{ transform:scale(0.7); opacity:0.4; }',
            '  60%{ transform:scale(1.15); }',
            '  100%{ transform:scale(1); opacity:1; }',
            '}'

        ].join('');
        document.head.appendChild(s);
        log('premium header + message-background styles injected.');
    }

    _injectPremiumChatStyle();

    /* app-patch-openchat.js writes the literal word "online" (or similar
       presence text) into #oc-peer-status on every header build; tag it
       with .oc-status-online so the pulsing-dot CSS above only animates
       for an actual online state (not "typing…", "last seen…", etc). */
    function _tagStatusDot() {
        var statusEl = document.getElementById('oc-peer-status');
        if (!statusEl) return;
        var isOnline = /online/i.test(statusEl.textContent || '');
        statusEl.classList.toggle('oc-status-online', isOnline);
    }
    var _statusWatcher = new MutationObserver(function () { _tagStatusDot(); });
    document.addEventListener('empyrean-init-done', function () {
        var cv = document.getElementById('chat-view-container');
        if (cv) _statusWatcher.observe(cv, { childList: true, subtree: true, characterData: true });
        _tagStatusDot();
    });

    /* ═══════════════════════════════════════════════════════════════════
       PART C — fix voice→video switch: renegotiated answer never applied
       ═══════════════════════════════════════════════════════════════════ */

    function _v36Me() {
        var s  = window.EmpState || {};
        var us = s.userState || window.userState || {};
        return us.id || null;
    }

    function _v36FbOk() {
        return !!(window.fbDb && window._firebaseLoaded);
    }

    var _v36WatchedCallDocs = {};

    /* Once a stuck renegotiation is detected on `pc`, find this user's live
       call doc and wait for `videoSwitchAnswer` to show up on it, then apply
       it directly — the exact step app-patch-openchat.js's own guard was
       blocking (see file header for the full root-cause writeup). */
    function _v36AwaitRenegotiatedAnswer(pc) {
        if (!_v36FbOk()) return;
        var me = _v36Me();
        if (!me) return;

        window.fbDb.collection('calls')
            .where('participants', 'array-contains', me)
            .get()
            .then(function (snap) {
                var best = null;
                snap.forEach(function (doc) {
                    var d = doc.data() || {};
                    if (d.status !== 'active') return;
                    if (!best || (d.createdAt || '') > (best.data.createdAt || '')) {
                        best = { id: doc.id, data: d };
                    }
                });
                if (!best || _v36WatchedCallDocs[best.id]) return;
                _v36WatchedCallDocs[best.id] = true;

                window.fbDb.collection('calls').doc(best.id).onSnapshot(function (docSnap) {
                    if (!docSnap.exists) return;
                    var data = docSnap.data() || {};

                    if (data.videoSwitchAnswer && pc.signalingState === 'have-local-offer') {
                        pc.setRemoteDescription(new RTCSessionDescription(data.videoSwitchAnswer))
                            .then(function () { log('renegotiated video-switch answer applied — video should now start flowing.'); })
                            .catch(function (e) { console.warn('[V36] failed to apply renegotiated video answer:', e); });
                    }

                    /* Call over — nothing left to watch on this doc. */
                    if (data.status === 'ended') delete _v36WatchedCallDocs[best.id];
                }, function (e) { try { console.warn('[Empyrean] listener error (ignored):', e && (e.code || e.message)); } catch (_) {} });
            })
            .catch(function () {});
    }

    function _v36TrackPeerConnection(pc) {
        var everConnected = false;

        pc.addEventListener('connectionstatechange', function () {
            if (pc.connectionState === 'connected') everConnected = true;
        });

        pc.addEventListener('signalingstatechange', function () {
            if (pc.signalingState !== 'have-local-offer') return;
            /* The ORIGINAL call handshake also passes through this state
               once (on whichever side placed the call) — only a renegotiation
               (video-switch offer) reaches it again AFTER the call was
               already live, so `everConnected` is what tells the two apart. */
            if (!everConnected) return;
            _v36AwaitRenegotiatedAnswer(pc);
        });
    }

    function _v36WrapRTCPeerConnection() {
        if (typeof window.RTCPeerConnection !== 'function' || window.RTCPeerConnection._v36Wrapped) return;
        var NativePC = window.RTCPeerConnection;

        function PatchedRTCPeerConnection(config) {
            /* `new`-called: returning a different object from a constructor
               makes `new PatchedRTCPeerConnection()` resolve to THAT object
               instead — so every caller everywhere in the app still gets
               back a genuine, unmodified native RTCPeerConnection. This
               only ever adds a tracker on the side; nothing about how the
               rest of the app creates or uses peer connections changes. */
            var pc = new NativePC(config);
            _v36TrackPeerConnection(pc);
            return pc;
        }
        PatchedRTCPeerConnection.prototype = NativePC.prototype;
        PatchedRTCPeerConnection._v36Wrapped = true;
        window.RTCPeerConnection = PatchedRTCPeerConnection;
        log('RTCPeerConnection tracking armed — voice→video switch renegotiation will now complete.');
    }

    _v36WrapRTCPeerConnection();

    console.log('[EmpyreanPatchV36] ✅ rev.5 — Contact-list previews come from chats/{chatId}, cached + repainted on every render pass, and now sorted most-recent-first; the redundant white breadcrumb header above the Messages section is hidden; both the contact-list header and single-chat header are now Elegant White + Gold with curved bottom corners, and contact/peer avatars are curvy gold-ring "squircles" instead of plain circles; send-ticks got a premium re-skin; and voice\u2192video switch now actually completes the renegotiation instead of stalling after the other person accepts.');

})();