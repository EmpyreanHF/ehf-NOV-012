/* =============================================================================
   EMPYREAN INTERNATIONAL — PATCH v13 (merged: v13 + v14 + v50)
   app-patch-v13.js  |  Load order: AFTER app-patch-openchat.js and
   app-patch-v12.js (now merged into app-patch-v11.js — see that file).

   MERGED (file-count reduction, no behavior change): this file used to be
   three separate files — app-patch-v13.js, app-patch-v14.js, and
   app-patch-v50.js — where v14 directly builds on v13 (wraps
   window.openGroupChat, reuses the groups/{groupId} data model v13
   created) and v50 only READS things guaranteed to exist by the time a
   person can tap "Share" at all (window.fbDb, the Status modal, the
   action sheets Part 1/2 already build). Merging preserves internal
   order exactly: Part 1 executes first, Part 2 second, Part 3 third —
   byte-for-byte the same code each part originally shipped as (plus one
   correctness fix noted at Part 3's own header), just no longer split
   across three <script> tags.

     PART 1 (was v13) — bare-bones group chat + broadcast lists: "New
       group" (pick contacts, create a Firestore group, open its own
       message thread) and "New broadcast" (fan out a composed message
       as tagged 1:1 DMs). Also defines _wireGroupCallEntry(), which
       calls window._empGroupCallStart(groupId, type) at CLICK time —
       a runtime typeof-check with a graceful "still loading" fallback,
       not a load-time dependency.
     PART 2 (was v14) — Group Management Portal on top of v13's bare
       chat: admin roles, permissions (who can message / add members /
       edit info), member add/remove, copy group link, groups shown in
       the contact list. Wraps window.openGroupChat (defined by Part 1)
       at its own load time.
     PART 3 (was v50) — Universal "Share to…" sheet (window.EmpShare.open),
       used by Part 2's own group-message action sheet below ("Share" row),
       by app-patch-openchat.js's 1:1 message action sheet, and by
       app-feed.js's per-post Share pill: My Status, or forward a copy
       directly into any group/1:1 chat the person is in, or WhatsApp/
       native OS share. Was never actually wired into index.html as its
       own <script> tag before this merge, so window.EmpShare did not
       exist yet — those three call sites already guarded for that
       ("if (window.EmpShare && typeof window.EmpShare.open ===
       'function') ... else <old direct-to-status behavior>"), so this
       merge is what makes the feature live for the first time, not a
       behavior change to code that was already running.

   NOTE ON LOAD ORDER RELATIVE TO app-patch-group-call.js: that file
   used to load BETWEEN v13 and v14. Verified safe to move it to load
   after this merged file instead — group-call.js has no eager boot
   logic; it only defines window._empGroupCallStart once at the end of
   its own IIFE, for v13's/v14's click handlers to call later (both of
   which already only check `typeof window._empGroupCallStart ===
   'function'` at click time, with a graceful fallback if it's not
   ready yet — never a hard load-time requirement).

   Each part is still its own IIFE below, verbatim, in original internal
   order — splitting them back into separate files is safe if ever needed.
   ============================================================================= */

/* =============================================================================
   Empyrean — app-patch-v13.js
   ─────────────────────────────────────────────────────────────────────────
   Load order: AFTER app-patch-openchat.js and app-patch-v12.js.

   WHAT THIS FILE DOES
   Adds the two enhancements from the messaging spec that needed genuinely
   new UI/data (as opposed to fixing something that already existed):

     §1  New group  — pick contacts, create a real Firestore group, open a
                       group chat screen (its own message thread, separate
                       from 1:1 chats).
     §2  New broadcast — pick contacts, name the list, then compose a
                       message that fans out as an ordinary 1:1 DM to each
                       recipient individually (tagged isBroadcast:true) so
                       recipients see it as a normal chat, never a group.

   The "Add to List / Media, links & docs / Mute / Disappearing messages /
   View contact" fixes and the voice→video call switch (Issues 1 & 2) are
   direct edits inside app-patch-openchat.js itself — those need access to
   private state (the live RTCPeerConnection, the open chat's DOM) that
   only exists inside that file's own closure, so they couldn't be bolted
   on from a separate file the way this one can. The message delivery
   ticks (sent/delivered/read) enhancement is likewise inside
   app-patch-openchat.js, for the same reason (it re-renders the same
   sent-bubble timestamp element _buildBubble already owns).

   DATA MODEL (new)
     groups/{groupId}                    { name, avatar, ownerId, members:[uid,...], createdAt }
     groups/{groupId}/messages/{msgId}   { senderId, senderName, text, createdAt }
     broadcastLists/{listId}             { ownerId, name, recipients:[uid,...], createdAt }
     messages/{msgId}                    (existing 1:1 collection) + isBroadcast:true, broadcastId

   FIRESTORE RULES: needs new rules for groups/broadcastLists — see the
   firebase-rules.js diff shipped alongside this file. Nothing here writes
   to a collection without a matching rule already being added there.
   ============================================================================= */
(function () {
    'use strict';

    /* Premium group placeholder icon — replaces the plain "TU"-style
       two-letter initials avatar (ui-avatars.com) for groups with no
       uploaded photo. Navy→gold gradient circle with a people glyph,
       matching the gold-ring premium styling used in the Contact info
       redesign (app-patch-openchat.js). Local data URI, no network call. */
    var _V13_GROUP_ICON_SVG =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#CBD8EA"/>' +
        '<stop offset="100%" stop-color="#93A9C7"/>' +
        '</linearGradient></defs>' +
        '<circle cx="100" cy="100" r="100" fill="url(#g)"/>' +
        '<g fill="#fff">' +
        '<circle cx="53" cy="86" r="16" opacity="0.8"/>' +
        '<circle cx="147" cy="86" r="16" opacity="0.8"/>' +
        '<path d="M45 109c-16 3-27 14-27 29v16h30v-16c0-10 4-20 10-29z" opacity="0.8"/>' +
        '<path d="M155 109c16 3 27 14 27 29v16h-30v-16c0-10-4-20-10-29z" opacity="0.8"/>' +
        '<circle cx="100" cy="76" r="25"/>' +
        '<path d="M100 108c-29 0-50 15-50 36v14h100v-14c0-21-21-36-50-36z"/>' +
        '</g></svg>';
    var _V13_GROUP_ICON_URI = 'data:image/svg+xml,' + encodeURIComponent(_V13_GROUP_ICON_SVG);
    /* Exposed so app-patch-v14.js (Group Management Portal, loaded after
       this file) can use the same icon instead of duplicating the SVG. */
    window._empGroupIconUri = _V13_GROUP_ICON_URI;

    function _fbOk() { return !!(window._firebaseLoaded && window.fbDb); }
    function _us()   { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    /* FIX (bug: "added members can't see the group chat" — root cause
       confirmed by tracing this exact ID-mismatch class of bug, already
       documented and fixed elsewhere in this codebase for /messages,
       /chats, /broadcastLists, /marketplace_messages senderId, and the
       host-self-notify race in app-patch-v30.js): this used to return
       fbAuth.currentUser.uid unconditionally, including while that
       current user is an ANONYMOUS Firebase Auth session (the same
       anonymous-sign-in race app-patch-v12.js/app-patch-v31.js already
       document at length). group members are written using OTHER
       people's real profile id (the `users/{uid}` doc id, sourced from
       window.mockUsers — see app-fixes.js's own mockUsers[...] = ...
       assignments, all keyed by the real signed-in uid). If THIS
       device's Firebase session is anonymous at the moment _authUid()
       is read, this returned the anonymous uid instead of the real
       profile id, and every array-contains(members, myId) query used
       to find "my groups" (see _renderGroupsInContactList below) then
       searched for the wrong value and silently returned nothing — the
       new group never appeared, even though the write that added the
       member succeeded. Anonymous is never a valid identity for group
       membership, so it's excluded here exactly the way
       app-patch-v30.js already excludes it (`!fbUser.isAnonymous`) —
       _myId() now falls through to the real profile id
       (window.userState.id) whenever the live Firebase session is
       anonymous or absent. */
    function _authUid() {
        try {
            var u = window.fbAuth && window.fbAuth.currentUser;
            if (u && !u.isAnonymous) return u.uid;
            return null;
        } catch (e) { return null; }
    }
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
        });
    }
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') { try { window.showNotification(msg, type || 'info'); return; } catch (e) {} }
        console.log('[v13]', msg);
    }
    function _fmtTime(ts) {
        if (!ts) return '';
        var d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    /* =========================================================================
       §0b  MEDIA CAPTION COMPOSER  (WhatsApp-style: preview + "Add a
            caption…" + send, shown after picking a photo/video, before
            it actually uploads)
       ========================================================================= */
    /* =========================================================================
       §0c  MEDIA LIGHTBOX  (tap-to-expand fullscreen for image/video
            messages, "inside the chat box" per spec — i.e. an in-app
            overlay, not a new browser tab/window)
       Prefers window._ocOpenLightbox (app-patch-openchat.js's own
       fullscreen viewer, already used for 1:1 chat media/avatars) so
       there's only one visual implementation across the app when both
       files are loaded — but doesn't hard-depend on that load order,
       since group chat can be opened without ever having visited a 1:1
       chat first.
       ========================================================================= */
    function _v13OpenMediaLightbox(src, isVideo) {
        if (typeof window._ocOpenLightbox === 'function') { window._ocOpenLightbox(src, isVideo); return; }

        var existing = document.getElementById('v13-lightbox');
        if (existing) existing.remove();

        var lb = document.createElement('div');
        lb.id = 'v13-lightbox';
        lb.style.cssText = 'position:fixed;inset:0;z-index:10000030;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';

        var media = document.createElement(isVideo ? 'video' : 'img');
        media.src = src;
        if (isVideo) { media.controls = true; media.autoplay = true; media.playsInline = true; }
        media.style.cssText = 'width:96vw;height:90vh;max-width:96vw;max-height:90vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.6);object-fit:contain;';

        var close = document.createElement('button');
        close.innerHTML = '&#x2715;';
        close.style.cssText = 'position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.15);border:none;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:1.2rem;display:flex;align-items:center;justify-content:center;';

        function _close() {
            if (isVideo) { try { media.pause(); } catch (e) {} }
            lb.remove();
        }
        close.addEventListener('click', function (e) { e.stopPropagation(); _close(); });
        lb.addEventListener('click', _close);
        media.addEventListener('click', function (e) { e.stopPropagation(); });

        lb.appendChild(media);
        lb.appendChild(close);
        document.body.appendChild(lb);
    }

    function _openGroupMediaCaptionComposer(file, onSend) {
        var overlay = document.createElement('div');
        overlay.id = 'v13-caption-composer';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000020;background:#000;display:flex;flex-direction:column;';

        var topBar = document.createElement('div');
        topBar.style.cssText = 'display:flex;align-items:center;padding:12px 14px;flex-shrink:0;';
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
        closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:4px;';
        closeBtn.addEventListener('click', function () { overlay.remove(); });
        topBar.appendChild(closeBtn);
        overlay.appendChild(topBar);

        var previewWrap = document.createElement('div');
        previewWrap.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:10px;';
        var url = URL.createObjectURL(file);
        var mediaEl;
        if ((file.type || '').indexOf('video/') === 0) {
            mediaEl = document.createElement('video');
            mediaEl.src = url; mediaEl.controls = true;
            mediaEl.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;';
        } else if ((file.type || '').indexOf('image/') === 0) {
            mediaEl = document.createElement('img');
            mediaEl.src = url;
            mediaEl.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;';
        } else {
            /* Document/PDF — a broken <img> tag previously rendered here
               for any non-image/video file. Show a file-icon preview
               instead, matching the document card the bubble itself will
               render once sent. */
            mediaEl = document.createElement('div');
            mediaEl.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:14px;color:#fff;';
            var extMatch0 = /\.([a-zA-Z0-9]{2,5})$/.exec(file.name || '');
            var ext0 = (extMatch0 ? extMatch0[1] : 'FILE').toUpperCase().slice(0, 4);
            mediaEl.innerHTML =
                '<div style="width:72px;height:88px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:700;color:#fff;background:' + (ext0 === 'PDF' ? '#c0392b' : '#0f1b3d') + ';">' + ext0 + '</div>' +
                '<div style="font-size:0.9rem;max-width:260px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (file.name || 'Document') + '</div>';
        }
        previewWrap.appendChild(mediaEl);
        overlay.appendChild(previewWrap);

        var captionRow = document.createElement('div');
        captionRow.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(0,0,0,0.4);flex-shrink:0;';
        var captionInput = document.createElement('input');
        captionInput.type = 'text';
        captionInput.placeholder = 'Add a caption…';
        captionInput.style.cssText = 'flex:1;padding:11px 16px;border-radius:22px;border:none;background:rgba(255,255,255,0.15);color:#fff;font-size:0.92rem;outline:none;';
        captionRow.appendChild(captionInput);

        var sendBtn = document.createElement('button');
        sendBtn.type = 'button';
        sendBtn.title = 'Send';
        sendBtn.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
        sendBtn.style.cssText = 'width:44px;height:44px;border-radius:50%;border:none;background:linear-gradient(135deg,#6EC3FA 0%,#3F9FE8 100%);color:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(63,159,232,0.38);';
        captionRow.appendChild(sendBtn);
        overlay.appendChild(captionRow);

        function _confirm() {
            var caption = captionInput.value;
            overlay.remove();
            onSend(caption);
        }
        sendBtn.addEventListener('click', _confirm);
        captionInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') _confirm(); });

        document.body.appendChild(overlay);
        setTimeout(function () { captionInput.focus(); }, 60);
    }

    /* =========================================================================
       §0  CONTACT PICKER  (shared by New group / New broadcast)
       ========================================================================= */
    function _allKnownContacts() {
        var mu = window.mockUsers || {};
        // FIX (bug: group creator's own name/avatar showing as generic
        // "Member" in the member list — see the ownerId fix below for the
        // full explanation): mockUsers is keyed by each person's
        // persistent app user id, not their live/per-session Firebase
        // Auth uid. This filter used to prefer the live uid, so on a
        // device with a real (non-anonymous) session it compared the
        // wrong kind of id against mu's keys and never actually excluded
        // "yourself" from the list. Persistent id first, matching mu's
        // keys and everywhere else "myId" needs to line up with a
        // members/ownerId array.
        var myId = _us().id || _authUid() || '';
        return Object.keys(mu)
            .filter(function (id) { return id && id !== myId; })
            .map(function (id) {
                var u = mu[id] || {};
                return { id: id, name: u.fullName || u.username || 'User', avatar: u.avatar || u.photoURL || '' };
            });
    }

    function _openContactPicker(opts) {
        /* opts: { title, confirmLabel, onConfirm(selectedContacts) } */
        var contacts = _allKnownContacts();
        var selected = {};

        var panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;inset:0;z-index:10000000;background:#fff;display:flex;flex-direction:column;';
        panel.innerHTML =
            '<div style="display:flex;align-items:center;gap:12px;padding:14px;background:#1B2B8B;color:#fff;flex-shrink:0;">' +
              '<button id="v13-pick-back" style="background:none;border:none;color:#fff;font-size:1.4rem;cursor:pointer;">&#8592;</button>' +
              '<span style="font-weight:700;">' + _esc(opts.title) + '</span>' +
            '</div>' +
            '<div id="v13-pick-count" style="padding:8px 16px;font-size:0.78rem;color:#6B7280;flex-shrink:0;">0 selected</div>' +
            '<div id="v13-pick-list" style="flex:1;overflow-y:auto;"></div>' +
            '<div style="padding:14px 16px;border-top:1px solid #eee;flex-shrink:0;">' +
              '<button id="v13-pick-confirm" disabled style="width:100%;padding:13px;border:none;border-radius:10px;background:#9AA0A6;color:#fff;font-weight:700;font-size:0.92rem;">' + _esc(opts.confirmLabel) + '</button>' +
            '</div>';
        document.body.appendChild(panel);

        panel.querySelector('#v13-pick-back').addEventListener('click', function () { panel.remove(); });

        var list = panel.querySelector('#v13-pick-list');
        if (!contacts.length) {
            list.innerHTML = '<div style="text-align:center;color:#999;padding:30px 20px;">No contacts found yet — open a chat with someone first so they show up here.</div>';
        }
        contacts.forEach(function (c) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:pointer;border-bottom:1px solid #f5f5f5;';
            row.innerHTML =
                '<img src="' + _esc(c.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(c.name) + '&background=1B2B8B&color=fff')) + '" style="width:42px;height:42px;border-radius:50%;object-fit:cover;flex-shrink:0;">' +
                '<span style="flex:1;font-size:0.9rem;">' + _esc(c.name) + '</span>' +
                '<span class="v13-check" style="width:22px;height:22px;border-radius:50%;border:2px solid #d0d0d0;flex-shrink:0;"></span>';
            row.addEventListener('click', function () {
                var check = row.querySelector('.v13-check');
                if (selected[c.id]) {
                    delete selected[c.id];
                    check.style.cssText = 'width:22px;height:22px;border-radius:50%;border:2px solid #d0d0d0;flex-shrink:0;';
                } else {
                    selected[c.id] = c;
                    check.style.cssText = 'width:22px;height:22px;border-radius:50%;background:#1B2B8B;border:2px solid #1B2B8B;flex-shrink:0;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;';
                    check.textContent = '✓';
                }
                var n = Object.keys(selected).length;
                panel.querySelector('#v13-pick-count').textContent = n + ' selected';
                var confirmBtn = panel.querySelector('#v13-pick-confirm');
                confirmBtn.disabled = n === 0;
                confirmBtn.style.background = n === 0 ? '#9AA0A6' : '#1B2B8B';
            });
            list.appendChild(row);
        });

        panel.querySelector('#v13-pick-confirm').addEventListener('click', function () {
            var picked = Object.values(selected);
            if (!picked.length) return;
            panel.remove();
            opts.onConfirm(picked);
        });
    }

    /* =========================================================================
       §1  NEW GROUP
       ========================================================================= */
    function _startNewGroupFlow() {
        _openContactPicker({
            title: 'Add group participants',
            confirmLabel: 'Next',
            onConfirm: function (contacts) { _openGroupNameStep(contacts); }
        });
    }

    function _openGroupNameStep(contacts) {
        var panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;inset:0;z-index:10000000;background:#fff;display:flex;flex-direction:column;';
        panel.innerHTML =
            '<div style="display:flex;align-items:center;gap:12px;padding:14px;background:#1B2B8B;color:#fff;flex-shrink:0;">' +
              '<button id="v13-gn-back" style="background:none;border:none;color:#fff;font-size:1.4rem;cursor:pointer;">&#8592;</button>' +
              '<span style="font-weight:700;">New group</span>' +
            '</div>' +
            '<div style="padding:20px 16px;">' +
              '<input id="v13-group-name" placeholder="Group name" maxlength="60" style="width:100%;padding:12px 14px;border:1px solid #ddd;border-radius:10px;font-size:0.95rem;box-sizing:border-box;">' +
              '<div style="margin-top:10px;font-size:0.78rem;color:#6B7280;">' + contacts.length + ' participant' + (contacts.length === 1 ? '' : 's') + ' selected</div>' +
            '</div>' +
            '<div style="padding:0 16px;">' +
              '<button id="v13-gn-create" disabled style="width:100%;padding:13px;border:none;border-radius:10px;background:#9AA0A6;color:#fff;font-weight:700;font-size:0.92rem;">Create group</button>' +
            '</div>';
        document.body.appendChild(panel);

        panel.querySelector('#v13-gn-back').addEventListener('click', function () { panel.remove(); });
        var nameInput  = panel.querySelector('#v13-group-name');
        var createBtn  = panel.querySelector('#v13-gn-create');
        nameInput.addEventListener('input', function () {
            var ok = nameInput.value.trim().length > 0;
            createBtn.disabled = !ok;
            createBtn.style.background = ok ? '#1B2B8B' : '#9AA0A6';
        });
        nameInput.focus();

        createBtn.addEventListener('click', function () {
            var groupName = nameInput.value.trim();
            if (!groupName) return;
            if (!_fbOk()) { _notify('No internet connection', 'warning'); return; }
            createBtn.disabled = true;
            createBtn.textContent = 'Creating…';

            // FIX (bug: "group creator's name doesn't display — shows a
            // member was the one who created it" / group member list
            // showing "Member" with generic "ME" initials for the
            // creator's row): _nameOf()/_avatarOf() (app-patch-v14.js)
            // look the owner up in window.mockUsers, which is keyed by
            // each person's PERSISTENT app user id — the same id every
            // other member in `contacts` already contributes via c.id.
            // This line used to prefer the live Firebase Auth uid
            // instead, which on a device with a real (non-anonymous)
            // session at the moment of creation is a DIFFERENT value that
            // doesn't exist as a mockUsers key — so the lookup fell
            // through to _nameOf's literal 'Member' fallback and
            // _avatarOf's initials-from-"Member" avatar for the owner's
            // row specifically, while every other (contact-picker-added)
            // member correctly showed their real name. Persistent id
            // first, matching every other member entry and matching what
            // _isAdmin/_nameOf/_avatarOf actually key their lookups by.
            var myId = _us().id || _authUid() || '';
            var members = contacts.map(function (c) { return c.id; }).concat([myId]);
            var groupRef = window.fbDb.collection('groups').doc();

            groupRef.set({
                name: groupName,
                avatar: '',
                ownerId: myId,
                members: members,
                createdAt: new Date().toISOString()
            }).then(function () {
                panel.remove();
                _notify('Group "' + groupName + '" created', 'success');
                window.openGroupChat(groupRef.id);
            }).catch(function (err) {
                createBtn.disabled = false;
                createBtn.textContent = 'Create group';
                _notify('Could not create group — the groups security rule may still need deploying (see firebase-rules.js). ' + (err.message || ''), 'error');
            });
        });
    }

    /* =========================================================================
       §1b  GROUP CHAT SCREEN
       ========================================================================= */
    var _grpUnsub = null;
    var _grpId    = null;
    /* Reply-to state for the currently open group chat (long-press → Reply
       → quoted composer). Reset whenever a message is sent or the reply
       bar's ✕ is tapped. */
    var _grpReplyingTo = null;
    var _grpReplyingRowEl = null; /* DOM row highlighted for reply — kept OUT of _grpReplyingTo so it never gets spread into a Firestore payload */
    var _grpPinnedMsgs = {}; /* msgId -> lightweight snapshot, kept in sync by the existing message listener (no extra Firestore query/index) */

    /* FIX v15 (Group Chat Avatar Frame + admin-gated Delete spec): the
       group management portal in app-patch-v14.js already keeps a live
       onSnapshot on groups/{id} and knows admins/ownerId/avatar the
       instant they change. Rather than duplicate that listener here, v14
       mirrors its doc data into this shared cache (window._empyreanGroupCache)
       so this file can do permission checks and header/avatar updates
       without a second subscription. Falls back gracefully (sender-only
       delete) if v14 hasn't loaded yet or hasn't synced this group. */
    window._empyreanGroupCache = window._empyreanGroupCache || {};

    function _grpIsAdmin(groupId, uid) {
        var g = window._empyreanGroupCache[groupId];
        if (!g || !uid) return false;
        if (g.ownerId === uid) return true;
        return Array.isArray(g.admins) && g.admins.indexOf(uid) !== -1;
    }

    window.openGroupChat = function (groupId) {
        if (!_fbOk()) { _notify('No internet connection', 'warning'); return; }
        _grpId = groupId;
        if (_grpUnsub) { try { _grpUnsub(); } catch (e) {} _grpUnsub = null; }

        var existing = document.getElementById('v13-group-view');
        if (existing) existing.remove();

        // Persistent id first — see the ownerId fix in the group-creation
        // handler above for the full explanation; this needs to resolve
        // "myId" the same way so owner/admin/self comparisons against
        // g.ownerId / g.members / g.admins line up correctly.
        var myId = _us().id || _authUid() || '';
        var view = document.createElement('div');
        view.id = 'v13-group-view';
        view.style.cssText = 'position:fixed;inset:0;z-index:9999990;background:#F5F7FB;display:flex;flex-direction:column;font-family:Manrope,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;';
        view.innerHTML =
            '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#fff;color:#14213D;flex-shrink:0;min-height:60px;box-shadow:0 6px 18px -12px rgba(20,33,61,0.24);border-bottom:1px solid #E7EBF3;position:sticky;top:0;z-index:5;">' +
              '<button id="v13-grp-back" aria-label="Back" style="background:#F1F5FB;border:1px solid #E1E8F3;color:#14213D;width:34px;height:34px;min-width:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background 0.15s;">' +
                '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#14213D" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>' +
              '</button>' +
              '<img id="v13-grp-avatar" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;background:#EAF2FB;" src="">' +
              '<div style="flex:1;min-width:0;">' +
                '<div id="v13-grp-title" style="font-family:Playfair Display,Georgia,Times New Roman,serif;font-weight:700;font-size:1rem;letter-spacing:0.1px;color:#14213D;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;">Group</div>' +
                '<div id="v13-grp-sub" style="font-size:0.72rem;color:#5B6B86;margin-top:1px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;"></div>' +
              '</div>' +
              /* FIX (2026-10-28 — "hide the video and call icons in the group chat behind a chevron / 3-dots expansion"): the two call
                 buttons keep their ids and stay inside #v13-group-view (so _wireGroupCallEntry() below and app-patch-group-call.js
                 bind to them exactly as before) — they just live in a collapsed pill that the 3-dots button opens. */
              '<button id="v13-grp-more-btn" type="button" title="More" aria-label="More options" aria-expanded="false" class="v13-hdr-icon-btn" style="background:#F1F6FC;border:1px solid #DCE9F7;color:#14213D;cursor:pointer;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.15s;margin-left:2px;">' +
                '<svg viewBox="0 0 24 24" width="20" height="20" fill="#14213D" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>' +
              '</button>' +
              '<div id="v13-grp-more-menu" style="display:none;position:absolute;right:12px;top:calc(100% + 6px);z-index:30;align-items:center;gap:6px;padding:6px 8px;background:#fff;border:1px solid #E1E8F3;border-radius:28px;box-shadow:0 10px 26px -10px rgba(20,33,61,0.35);">' +
              '<button id="v13-grp-video-btn" title="Group video call" class="v13-hdr-icon-btn" style="background:#F1F6FC;border:1px solid #DCE9F7;color:#14213D;cursor:pointer;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.15s;margin-left:2px;">' +
                '<svg class="emp-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6.5" width="12.5" height="11" rx="2.8"/><path d="M15 10.3l4.7-2.8a.75.75 0 0 1 1.13.65v7.7a.75.75 0 0 1-1.13.65L15 13.7"/></svg>' +
              '</button>' +
              '<button id="v13-grp-voice-btn" title="Group voice call" class="v13-hdr-icon-btn" style="background:#F1F6FC;border:1px solid #DCE9F7;color:#14213D;cursor:pointer;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.15s;margin-left:2px;">' +
                '<svg class="emp-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
              '</button>' +
              '</div>' +
            '</div>' +
            '<div id="v13-grp-callbar" style="display:none;align-items:center;gap:10px;padding:9px 14px;background:#E8F5E9;border-bottom:1px solid rgba(16,185,129,0.25);flex-shrink:0;cursor:pointer;">' +
              '<span style="width:9px;height:9px;border-radius:50%;background:#10B981;flex-shrink:0;animation:v13RecPulse 1.4s infinite;"></span>' +
              '<span id="v13-grp-callbar-text" style="flex:1;font-size:0.84rem;color:#0F5132;font-weight:600;">Call in progress</span>' +
              '<span style="font-size:0.8rem;color:#10B981;font-weight:700;">Join &#8250;</span>' +
            '</div>' +
            '<div id="v13-grp-pinned-strip" style="display:none;gap:8px;overflow-x:auto;padding:8px 12px;background:#EEF0FA;border-bottom:1px solid rgba(10,14,39,0.08);flex-shrink:0;-webkit-overflow-scrolling:touch;"></div>' +
            '<div id="v13-grp-body" style="flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;min-height:0;padding:12px 8px 8px;display:flex;flex-direction:column;gap:3px;background:#F5F7FB;"></div>' +
            '<div id="v13-grp-reply-bar" style="display:none;align-items:center;gap:10px;padding:7px 12px;background:#fff;border-top:1px solid #E9EDF4;border-left:3px solid #3F9FE8;flex-shrink:0;">' +
              '<img id="v13-grp-reply-thumb" style="display:none;width:38px;height:38px;border-radius:6px;object-fit:cover;flex-shrink:0;" alt="">' +
              '<div style="flex:1;min-width:0;">' +
                '<div id="v13-grp-reply-name" style="font-size:0.76rem;font-weight:700;color:#0f1b3d;"></div>' +
                '<div id="v13-grp-reply-snippet" style="font-size:0.82rem;color:#6B7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>' +
              '</div>' +
              '<button id="v13-grp-reply-cancel" type="button" title="Cancel reply" style="background:none;border:none;color:#9CA3AF;font-size:1.2rem;line-height:1;cursor:pointer;flex-shrink:0;padding:4px;">&times;</button>' +
            '</div>' +
            '<div id="v13-grp-composer-row" style="display:flex;align-items:flex-end;gap:8px;padding:8px 10px;padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));background:#fff;border-top:1px solid #E9EDF4;box-shadow:0 -8px 20px -14px rgba(20,33,61,0.22);flex-shrink:0;">' +
              '<div style="flex:1;min-width:0;display:flex;align-items:flex-end;gap:6px;background:#F4F7FB;border-radius:24px;border:1px solid #E1E8F2;padding:4px 8px 4px 16px;">' +
                '<textarea id="v13-grp-input" rows="1" placeholder="Message" style="flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:inherit;font-size:0.93rem;line-height:1.4;color:#14213D;padding:8px 0;resize:none;overflow-y:auto;max-height:40vh;display:block;"></textarea>' +
                '<button id="v13-grp-attach" type="button" title="Send photo, video or document" style="background:none;border:none;cursor:pointer;padding:4px;color:#7A8AA5;display:flex;align-items:center;flex-shrink:0;">' +
                  '<svg viewBox="0 0 24 24" width="22" height="22" fill="#7A8AA5"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>' +
                '</button>' +
              '</div>' +
              '<button id="v13-grp-mic" type="button" title="Record voice note" style="width:44px;height:44px;min-width:44px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#6EC3FA 0%,#3F9FE8 100%);color:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(63,159,232,0.38);">' +
                '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M12 15c1.66 0 3-1.34 3-3V6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V22h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>' +
              '</button>' +
              '<button id="v13-grp-send" type="button" title="Send" style="width:44px;height:44px;min-width:44px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#6EC3FA 0%,#3F9FE8 100%);color:#fff;flex-shrink:0;display:none;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(63,159,232,0.38);">' +
                '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
              '</button>' +
            '</div>' +
            '<div id="v13-grp-recording-row" style="display:none;align-items:center;gap:12px;padding:10px 14px;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px));background:#fff;border-top:1px solid #E9EDF4;flex-shrink:0;">' +
              '<button id="v13-grp-rec-cancel" type="button" title="Cancel" style="width:40px;height:40px;border-radius:50%;border:1px solid #F3D3D3;background:#FFF5F5;color:#E53935;flex-shrink:0;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
                '<svg viewBox="0 0 24 24" width="18" height="18" fill="#E53935"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>' +
              '</button>' +
              '<div style="flex:1;display:flex;align-items:center;gap:8px;color:#E53935;font-size:0.9rem;">' +
                '<span style="width:10px;height:10px;border-radius:50%;background:#E53935;animation:v13RecPulse 1s infinite;"></span>' +
                '<span id="v13-grp-rec-timer">0:00</span>' +
                '<span style="color:#6B7A94;">Recording voice note…</span>' +
              '</div>' +
              '<button id="v13-grp-rec-send" type="button" title="Send" style="width:44px;height:44px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#6EC3FA 0%,#3F9FE8 100%);color:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(63,159,232,0.38);">' +
                '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
              '</button>' +
            '</div>' +
            '<style>@keyframes v13RecPulse{0%,100%{opacity:1;}50%{opacity:0.25;}} .v13-hdr-icon-btn:hover{background:#E3EFFB!important;} #v13-grp-composer-row > div:focus-within{background:#fff!important;border-color:#7CC4F7!important;box-shadow:0 0 0 3px rgba(79,176,242,0.16);} #v13-group-view .emp-avatar-frame{box-shadow:0 0 0 2px #fff,0 0 0 3.5px #B9DDF8,0 2px 8px rgba(20,33,61,0.14);} #v13-group-view button:active{transform:scale(0.94);}</style>';
        document.body.appendChild(view);

        var _gcCallDocUnsub = null;
        function _wireGroupCallEntry() {
            var videoBtn = view.querySelector('#v13-grp-video-btn');
            var voiceBtn = view.querySelector('#v13-grp-voice-btn');
            var callBar  = view.querySelector('#v13-grp-callbar');
            var callBarText = view.querySelector('#v13-grp-callbar-text');

            function _launch(type) {
                if (typeof window._empGroupCallStart === 'function') {
                    window._empGroupCallStart(groupId, type);
                } else {
                    _notify('Group calling module still loading — try again in a moment.', 'info');
                }
            }
            var moreBtn  = view.querySelector('#v13-grp-more-btn');
            var moreMenu = view.querySelector('#v13-grp-more-menu');
            function _closeMore() { if (moreMenu) moreMenu.style.display = 'none'; if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false'); }
            if (moreBtn && moreMenu) {
                moreBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var open = moreMenu.style.display === 'flex';
                    moreMenu.style.display = open ? 'none' : 'flex';
                    moreBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
                });
                view.addEventListener('click', function (e) {
                    if (moreMenu.style.display === 'flex' && !moreMenu.contains(e.target) && e.target !== moreBtn) _closeMore();
                });
            }
            videoBtn.addEventListener('click', function () { _closeMore(); _launch('video'); });
            voiceBtn.addEventListener('click', function () { _closeMore(); _launch('voice'); });
            callBar.addEventListener('click', function () {
                var lastType = callBar.getAttribute('data-call-type') || 'voice';
                _launch(lastType);
            });

            /* Banner is purely a reflection of group_calls/{groupId}'s live
               status — it does NOT try to track whether *I* am already in
               the call (that live "am I in it" state belongs to
               app-patch-group-call.js, which hides its own full-screen call
               UI independently). Worst case if I'm already in the call and
               this banner is also visible behind it: tapping it just re-runs
               _empGroupCallStart, which is written to detect "I'm already a
               participant" and no-op rather than double-join. */
            if (_fbOk()) {
                _gcCallDocUnsub = window.fbDb.collection('group_calls').doc(groupId)
                    .onSnapshot(function (snap) {
                        var active = snap.exists && snap.data().status === 'active';
                        callBar.style.display = active ? 'flex' : 'none';
                        if (active) {
                            var d = snap.data();
                            callBar.setAttribute('data-call-type', d.type || 'voice');
                            var count = (d.activeCount || 0);
                            callBarText.textContent = (d.type === 'video' ? 'Video' : 'Voice') + ' call in progress' + (count ? ' · ' + count + ' in call' : '');
                        }
                    }, function (err) { console.warn('[v13-grpcall] call-status listener error:', err.message); });
            }
        }
        _wireGroupCallEntry();

        view.querySelector('#v13-grp-back').addEventListener('click', function () {
            if (_gcCallDocUnsub) { try { _gcCallDocUnsub(); } catch (e) {} _gcCallDocUnsub = null; }
            if (_grpUnsub) { try { _grpUnsub(); } catch (e) {} _grpUnsub = null; }
            if (_mediaRecorder && _mediaRecorder.state !== 'inactive') { try { _mediaRecorder.stop(); } catch (e) {} }
            if (_recStream) { try { _recStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
            if (_recTimerHandle) clearInterval(_recTimerHandle);
            _grpReplyingTo = null;
            view.remove();
            /* refresh the chat-list preview/unread badge of the group just left */
            if (typeof window._empRefreshGroupRows === 'function') setTimeout(function () { window._empRefreshGroupRows(true); }, 400);
        });

        /* ── Reply-to (long-press a message → Reply → quoted composer) ── */
        function _grpReplySnippetFor(d) {
            if (d.text) return d.text;
            var mt = d.mediaType || '';
            if (mt === 'image') return '📷 Photo';
            if (mt === 'video') return '🎥 Video';
            if (mt === 'audio') return '🎤 Voice note';
            return 'Message';
        }
        function _cancelGroupReply() {
            if (_grpReplyingRowEl) _grpSetRowHighlight(_grpReplyingRowEl, false);
            _grpReplyingRowEl = null;
            _grpReplyingTo = null;
            var bar = view.querySelector('#v13-grp-reply-bar');
            if (bar) bar.style.display = 'none';
        }
        function _startGroupReply(msgId, data, row) {
            _grpReplyingTo = {
                msgId: msgId,
                senderId: data.senderId || '',
                senderName: (data.senderId === myId) ? 'You' : (data.senderName || 'Member'),
                text: data.text || '',
                mediaType: data.mediaType || '',
                mediaUrl: data.mediaUrl || ''
            };
            _grpReplyingRowEl = row || null;
            if (row) _grpSetRowHighlight(row, true);
            var bar = view.querySelector('#v13-grp-reply-bar');
            if (!bar) return;
            var nameEl = bar.querySelector('#v13-grp-reply-name');
            var snipEl = bar.querySelector('#v13-grp-reply-snippet');
            var thumbEl = bar.querySelector('#v13-grp-reply-thumb');
            if (nameEl) nameEl.textContent = _grpReplyingTo.senderName;
            if (snipEl) snipEl.textContent = _grpReplySnippetFor(_grpReplyingTo);
            if (thumbEl) {
                var qMt2 = _grpReplyingTo.mediaType || '';
                if (_grpReplyingTo.mediaUrl && (qMt2 === 'image' || qMt2 === 'video')) {
                    thumbEl.src = _grpReplyingTo.mediaUrl;
                    thumbEl.style.display = 'block';
                } else {
                    thumbEl.style.display = 'none';
                    thumbEl.src = '';
                }
            }
            bar.style.display = 'flex';
            var inp = view.querySelector('#v13-grp-input');
            if (inp) inp.focus();
        }
        /* _showGroupMsgActionSheet (its "Reply" row) lives outside this
           closure, at module level -- same pattern already used for
           window._empGroupCallStart / window.openGroupChat itself.
           Re-pointed every time a group chat is (re)opened, so it always
           targets the currently visible view. */
        window._grpStartReply = _startGroupReply;
        view.querySelector('#v13-grp-reply-cancel').addEventListener('click', _cancelGroupReply);

        function _applyGroupChrome(d) {
            window._empyreanGroupCache[groupId] = d;
            view.querySelector('#v13-grp-title').textContent = d.name || 'Group';
            view.querySelector('#v13-grp-sub').textContent = (d.members || []).length + ' participants';
            var avEl = view.querySelector('#v13-grp-avatar');
            /* FIX v15 (Group Chat Avatar Frame): use the offline-safe local
               initials frame (see app-patch-v15.js) instead of always
               depending on a remote ui-avatars.com fetch for the "no photo
               uploaded" placeholder — that remote call is what left the
               header showing a broken/blank avatar whenever the device
               couldn't reach the outside network. Falls back to the old
               behavior only if v15 hasn't loaded for some reason. */
            if (d.avatar) avEl.src = d.avatar;
            else if (window.EmpAvatar) window.EmpAvatar.wire(avEl, d.name || 'Group', _V13_GROUP_ICON_URI);
            else avEl.src = _V13_GROUP_ICON_URI;
        }

        window.fbDb.collection('groups').doc(groupId).get().then(function (doc) {
            if (!doc.exists) return;
            _applyGroupChrome(doc.data());
        }).catch(function () {});

        var body = view.querySelector('#v13-grp-body');
        var rendered = {}; /* doc id -> row element, so 'modified' can re-render in place */
        _grpPinnedMsgs = {};
        _renderGrpPinnedStrip(view);
        var totalMembers = 1;
        window.fbDb.collection('groups').doc(groupId).get().then(function (doc) {
            if (doc.exists) totalMembers = (doc.data().members || []).length || 1;
        }).catch(function () {});

        /* ── WhatsApp-style voice note player (group chat) ──
           Mirrors the 1:1 chat player in app-patch-openchat.js: avatar
           with a small mic badge, play/pause circle, scrubbable
           waveform, live duration. Built as real DOM (not an innerHTML
           string) since it needs event listeners; _fmtGroupRow drops a
           placeholder div into its string template and this gets
           appended into that placeholder afterward. */
        var _v13VnBarHeights = [6,10,14,18,22,16,12,8,14,20,24,18,10,6,12,16,20,14,8,10,18,22,16,12,6,10,14,20,18,12,8,16,22,14,10,6,12,18,20,16,10,8,14,18,22,16,12,6,10,14,20,18,12,8,16,22,14,10,6,12,18,20,16,10];

        function _v13SenderAvatar(data, isSent) {
            if (isSent) {
                return (_us().avatar || _us().photoURL) ||
                    ('https://ui-avatars.com/api/?name=' + encodeURIComponent(_us().fullName || _us().username || 'Me') + '&background=1B2B8B&color=fff&size=88');
            }
            var mu = (window.mockUsers && window.mockUsers[data.senderId]) || {};
            return (mu.avatar || mu.photoURL) ||
                ('https://ui-avatars.com/api/?name=' + encodeURIComponent(data.senderName || 'Member') + '&background=1B2B8B&color=fff&size=88');
        }

        function _v13BuildVoiceNote(data, isSent) {
            var wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:190px;max-width:100%;padding:2px 0;position:relative;';

            var audio = document.createElement('audio');
            audio.src = data.mediaUrl;
            audio.preload = 'metadata';
            audio.style.display = 'none';
            wrap.appendChild(audio);

            /* Avatar + mic badge.
               FIX (this session — "remove the mic background attached to
               the picture avatar, increase the size of the icon"): the
               light plate/border/ring behind the mic glyph is gone —
               just the glyph sits on the avatar corner now, sized up
               9px -> 19px so it reads without a plate behind it. A
               drop-shadow (instead of a solid disc) keeps it legible over
               light or dark avatar photos alike. Mirrors the same fix in
               app-patch-openchat.js's 1:1 voice note player. */
            var avWrap = document.createElement('div');
            avWrap.style.cssText = 'position:relative;width:36px;height:36px;flex-shrink:0;';
            var avImg = document.createElement('img');
            avImg.src = _v13SenderAvatar(data, isSent);
            avImg.style.cssText = 'width:36px;height:36px;border-radius:50%;object-fit:cover;display:block;';
            avImg.onerror = function () { this.onerror = null; this.src = 'https://ui-avatars.com/api/?name=U&background=1B2B8B&color=fff&size=72'; };
            avWrap.appendChild(avImg);
            var badge = document.createElement('div');
            badge.style.cssText = 'position:absolute;right:-2px;bottom:-2px;width:19px;height:19px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.55));';
            badge.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="#fff"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/><path d="M17 11a1 1 0 1 0-2 0 3 3 0 0 1-6 0 1 1 0 1 0-2 0 5 5 0 0 0 4 4.9V18H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.1a5 5 0 0 0 4-4.9z"/></svg>';
            avWrap.appendChild(badge);
            wrap.appendChild(avWrap);

            /* Play/Pause button.
               FIX (this session — "remove the blue play background,
               increase the size of the icon"): the filled disc is gone —
               the button is now a bare transparent hit-target and the
               icon carries the weight instead, sized up 15px -> 29px so
               it reads clearly at a glance. */
            var playBtn = document.createElement('button');
            playBtn.style.cssText = 'width:32px;height:32px;min-width:32px;border-radius:50%;border:none;background:none;color:#4B5563;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
            var playing = false;
            var PLAY_ICON = '<svg viewBox="0 0 24 24" width="29" height="29" fill="#4B5563"><path d="M8 5v14l11-7z"/></svg>';
            var PAUSE_ICON = '<svg viewBox="0 0 24 24" width="29" height="29" fill="#4B5563"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
            playBtn.innerHTML = PLAY_ICON;

            /* Waveform + progress (no duration line here anymore — it's
               merged into the time/read footer row by the caller, so the
               bubble stays short) */
            var track = document.createElement('div');
            track.style.cssText = 'flex:1;position:relative;height:22px;cursor:pointer;display:flex;align-items:center;min-width:0;';
            var barCount = _v13VnBarHeights.length;
            var barW = 160 / barCount;

            function makeBars(fillColor) {
                var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 160 22');
                svg.setAttribute('preserveAspectRatio', 'none');
                svg.style.cssText = 'width:100%;height:22px;display:block;';
                _v13VnBarHeights.forEach(function (h, i) {
                    var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    rect.setAttribute('x', (i * barW + barW * 0.15).toFixed(1));
                    rect.setAttribute('y', ((22 - h * 0.78) / 2).toFixed(1));
                    rect.setAttribute('width', (barW * 0.7).toFixed(1));
                    rect.setAttribute('height', (h * 0.78).toFixed(1));
                    rect.setAttribute('rx', '2');
                    rect.setAttribute('fill', fillColor);
                    svg.appendChild(rect);
                });
                return svg;
            }

            var svgBg = makeBars('rgba(0,0,0,0.18)');
            svgBg.style.cssText += 'position:absolute;left:0;top:0;';
            track.appendChild(svgBg);

            var progressWrap = document.createElement('div');
            progressWrap.style.cssText = 'position:absolute;left:0;top:0;height:100%;width:0%;overflow:hidden;pointer-events:none;';
            var svgFg = makeBars('#4B5563');
            svgFg.style.cssText += 'position:absolute;left:0;top:0;';
            progressWrap.appendChild(svgFg);
            track.appendChild(progressWrap);

            track.addEventListener('click', function (e) {
                var r = track.getBoundingClientRect();
                var ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
                if (audio.duration) {
                    audio.currentTime = ratio * audio.duration;
                    progressWrap.style.width = (ratio * 100) + '%';
                }
            });

            function fmtDur(sec) {
                sec = Math.round(sec || 0);
                var m = Math.floor(sec / 60), s = sec % 60;
                return m + ':' + (s < 10 ? '0' : '') + s;
            }

            /* Duration text — returned to the caller (not appended here)
               so it can sit on the same row as the time/read status. */
            var durLabel = document.createElement('span');
            durLabel.textContent = '0:00';
            audio.addEventListener('loadedmetadata', function () { durLabel.textContent = fmtDur(audio.duration); });
            audio.addEventListener('timeupdate', function () {
                if (!audio.duration) return;
                progressWrap.style.width = (audio.currentTime / audio.duration * 100) + '%';
                durLabel.textContent = fmtDur(audio.duration - audio.currentTime);
            });
            audio.addEventListener('ended', function () {
                playing = false;
                audio.classList.remove('_v13_vn_active');
                playBtn.innerHTML = PLAY_ICON;
                progressWrap.style.width = '0%';
            });

            playBtn.addEventListener('click', function () {
                if (playing) {
                    audio.pause();
                    playing = false;
                    playBtn.innerHTML = PLAY_ICON;
                } else {
                    document.querySelectorAll('audio._v13_vn_active').forEach(function (a) {
                        a.pause();
                        a.classList.remove('_v13_vn_active');
                        var btn = a.parentNode && a.parentNode.querySelector('button');
                        if (btn) btn.innerHTML = PLAY_ICON;
                    });
                    audio.play().catch(function () {});
                    audio.classList.add('_v13_vn_active');
                    playing = true;
                    playBtn.innerHTML = PAUSE_ICON;
                }
            });

            wrap.appendChild(playBtn);
            wrap.appendChild(track);
            return { el: wrap, durEl: durLabel };
        }

        /* FEATURE: WhatsApp-style sender avatar beside each received group message
           (bottom-left of the bubble). Tap -> full-view picture + bio. The avatar
           is absolutely positioned in the 36px gutter the received bubble reserves
           with margin-left, so the bubble/row structure other code relies on is
           unchanged. */
        function _v13SenderColor(name) {
            var str = String(name || 'Member'), h = 0;
            for (var i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
            return 'hsl(' + (Math.abs(h) % 360) + ',58%,36%)';
        }
        function _v13AddMsgAvatar(row, data, isSent) {
            if (isSent) return;
            var src = (data.senderAvatar) || _v13SenderAvatar(data, false);
            var fb = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(data.senderName || 'Member') + '&background=1B2B8B&color=fff&size=88';
            var av = document.createElement('img');
            av.className = 'v13-msg-avatar';
            row.dataset.senderId = String(data.senderId || ''); /* used by app-patch-v15.js to show the avatar only on the last message of a run */
            av.src = src; av.alt = data.senderName || ''; av.draggable = false;
            av.style.cssText = 'position:absolute;left:-36px;bottom:0;width:28px;height:28px;border-radius:50%;object-fit:cover;cursor:pointer;background:#1B2B8B;-webkit-touch-callout:none;';
            av.onerror = function () { this.onerror = null; this.src = fb; };
            /* keep the bubble's long-press timer from firing when the avatar is touched */
            ['touchstart', 'mousedown'].forEach(function (ev) { av.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); });
            av.addEventListener('click', function (e) {
                e.stopPropagation();
                if (typeof window._openAvatarPreviewSheet === 'function') {
                    window._openAvatarPreviewSheet(data.senderId, av.currentSrc || src, { full: true, name: data.senderName });
                } else if (typeof window._ocGoToUserProfile === 'function') window._ocGoToUserProfile(data.senderId);
            });
            row.appendChild(av);
        }

        function _fmtGroupRow(data, docId) {
            var isSent = data.senderId === myId;
            var row = document.createElement('div');
            row.dataset.msgId = docId;
            /* Same palette as the 1:1 chat's .oc-bubble (app-patch-openchat.js):
               sent = soft light green #DCF8C6 on navy ink, received = white,
               14px corners with a tighter tail corner, hairline border. */
            row.style.cssText = 'max-width:84%;min-width:60px;' + (isSent ? '' : 'margin-left:36px;') + 'align-self:' + (isSent ? 'flex-end' : 'flex-start') + ';background:' + (isSent ? '#DCF8C6' : '#fff') + ';border:1px solid ' + (isSent ? '#C3E8A8' : '#E7ECF4') + ';border-radius:14px;' + (isSent ? 'border-bottom-right-radius:3px;' : 'border-bottom-left-radius:3px;') + 'padding:7px 12px 6px;box-shadow:0 1px 2px rgba(20,33,61,0.06),0 6px 16px -8px rgba(20,33,61,0.14);position:relative;line-height:1.45;word-break:break-word;';
            var _txtColor = isSent ? '#14213D' : '#1F2A44';
            var _footColor = isSent ? 'rgba(20,33,61,0.52)' : '#8794AB';

            if (data.deleted === true) {
                row.innerHTML =
                    (isSent ? '' : '<div style="font-size:0.72rem;font-weight:700;color:#0f1b3d;margin-bottom:2px;">' + _esc(data.senderName || 'Member') + '</div>') +
                    '<div style="font-size:0.86rem;color:' + _footColor + ';font-style:italic;"><i class="fas fa-ban" style="margin-right:5px;font-size:0.8em;"></i>This message was deleted</div>' +
                    '<div style="font-size:0.62rem;color:' + _footColor + ';text-align:right;margin-top:2px;">' + _fmtTime(data.createdAt) + '</div>';
                _v13AddMsgAvatar(row, data, isSent);
                return row;
            }

            var readBy = Array.isArray(data.readBy) ? data.readBy : [];
            var readersExcludingSender = readBy.filter(function (u) { return u !== data.senderId; }).length;
            var readInfoHtml = '';
            if (isSent) {
                if (data.status === 'sending') readInfoHtml = '<span style="font-style:italic;opacity:0.75;">Sending…</span>';
                else if (data.status === 'failed') readInfoHtml = '<span style="color:#E53935;font-weight:600;">⚠ Not sent</span>';
                else readInfoHtml = '<span class="v13-viewers-count" data-msg-id="' + docId + '" style="cursor:pointer;text-decoration:underline dotted;">Read by ' + readersExcludingSender + '/' + Math.max(totalMembers - 1, 0) + '</span>';
            }

            /* FIX v16 (image/video upload in group chat): render a media
               bubble when the message carries mediaUrl, same shape as a
               text message (name header, timestamp/read-receipt footer)
               but with an <img>/<video> in place of (or above) the text. */
            var mediaHtml = '';
            var audioPlaceholderId = '';
            if (data.mediaUrl) {
                if (data.mediaType === 'video') {
                    /* FEATURE (2026-08-01 — tap-to-expand fullscreen, "inside
                       the chat box"): a bare native <video controls> gave no
                       consistent fullscreen affordance and, on Android, ate
                       the long-press gesture meant for the action sheet
                       below. Now a controls-less, muted inline preview sits
                       under a play-button overlay; tapping it opens the
                       same fullscreen lightbox images use (see the
                       .v13-media-tap wiring right after row.innerHTML is
                       set, a few lines down — needs real DOM, not an
                       innerHTML-string onclick, to avoid quote-escaping
                       hazards around the URL). -webkit-touch-callout:none
                       stops Android/iOS's own long-press-on-media gesture
                       from racing (and usually winning against) our JS
                       long-press timer in _attachGroupLongPress. */
                    /* FIX (video preview): a bare preload="metadata" <video> never
                       paints a frame on many Android WebViews, so the bubble
                       showed the system's grey "unloaded video" placeholder.
                       The #t=0.1 media fragment makes the browser decode and
                       show the first frame; the dark background + min size
                       keep the bubble a sensible shape while it loads, and
                       a duration chip (filled in on loadedmetadata, below)
                       gives it the usual chat-video look. */
                    mediaHtml = '<div class="v13-media-tap" data-video="1" data-src="' + _esc(data.mediaUrl) + '" style="position:relative;cursor:pointer;min-width:200px;border-radius:10px;overflow:hidden;background:#1F2937;margin-bottom:' + (data.text ? '5px' : '0') + ';">' +
                        '<video src="' + _esc(data.mediaUrl) + '#t=0.1" muted playsinline preload="metadata" style="width:100%;min-height:140px;max-height:260px;object-fit:cover;display:block;background:#1F2937;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;"></video>' +
                        '<span class="v13-vid-dur" style="display:none;position:absolute;left:8px;bottom:6px;background:rgba(0,0,0,0.55);color:#fff;font-size:0.68rem;font-weight:600;padding:1px 7px;border-radius:10px;pointer-events:none;"></span>' +
                        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;"><span style="width:52px;height:52px;border-radius:50%;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M8 5v14l11-7z"/></svg></span></div>' +
                        '</div>';
                } else if (data.mediaType === 'audio') {
                    /* Placeholder — the real interactive player (avatar,
                       mic badge, waveform) is DOM built by
                       _v13BuildVoiceNote and appended below, since it
                       needs live event listeners that an innerHTML
                       string can't carry. */
                    audioPlaceholderId = 'v13vn-' + docId;
                    mediaHtml = '<div id="' + audioPlaceholderId + '" style="margin-bottom:' + (data.text ? '5px' : '0') + ';"></div>';
                } else if (data.mediaType === 'document') {
                    /* FEATURE (premium redesign — "PDF sensitivity"):
                       group chat's attach button previously only accepted
                       image/*,video/* and this branch didn't exist at
                       all, so any non-image/video file fell into the
                       plain <img> branch below and rendered as a broken-
                       image icon. Now documents get their own card:
                       extension badge, filename, size — same treatment
                       as the 1:1 chat's document card. */
                    var gFName = data.fileName || 'Document';
                    var gExtMatch = /\.([a-zA-Z0-9]{2,5})$/.exec(gFName);
                    var gExt = (gExtMatch ? gExtMatch[1] : 'FILE').toUpperCase().slice(0, 4);
                    var gIsPdf = gExt === 'PDF';
                    var gSizeLabel = '';
                    if (typeof data.fileSize === 'number' && data.fileSize > 0) {
                        gSizeLabel = data.fileSize > 1024 * 1024
                            ? (data.fileSize / (1024 * 1024)).toFixed(1) + ' MB'
                            : Math.max(1, Math.round(data.fileSize / 1024)) + ' KB';
                    }
                    mediaHtml = '<a href="' + _esc(data.mediaUrl) + '" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;gap:10px;text-decoration:none;color:' + _txtColor + ';padding:6px 4px;min-width:200px;max-width:260px;border-radius:8px;margin-bottom:' + (data.text ? '5px' : '0') + ';">' +
                        '<div style="flex-shrink:0;width:38px;height:44px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700;letter-spacing:0.3px;color:#fff;background:' + (gIsPdf ? '#c0392b' : '#0f1b3d') + ';">' + gExt + '</div>' +
                        '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;">' +
                        '<span style="font-size:0.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(gFName) + '</span>' +
                        '<span style="font-size:0.7rem;opacity:0.7;">' + _esc([gSizeLabel, gExt].filter(Boolean).join(' \u00b7 ')) + '</span>' +
                        '</div></a>';
                } else {
                    /* FIX (2026-08-01 — media tap opened a new browser tab
                       instead of expanding in-app): was
                       onclick="window.open(this.src,'_blank')". See the
                       .v13-media-tap wiring below for the actual fullscreen
                       handler; draggable=false + touch-callout:none for the
                       same long-press reason as the video branch above. */
                    mediaHtml = '<img class="v13-media-tap" data-src="' + _esc(data.mediaUrl) + '" draggable="false" src="' + _esc(data.mediaUrl) + '" style="max-width:100%;max-height:260px;border-radius:8px;display:block;cursor:pointer;margin-bottom:' + (data.text ? '5px' : '0') + ';-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;">';
                }
            }

            var footerId = 'v13ft-' + docId;
            var quoteHtml = '';
            if (data.replyTo && (data.replyTo.text || data.replyTo.mediaType || data.replyTo.senderName)) {
                var qMt = data.replyTo.mediaType || '';
                var qThumbHtml = (data.replyTo.mediaUrl && (qMt === 'image' || qMt === 'video'))
                    ? '<img src="' + _esc(data.replyTo.mediaUrl) + '" style="width:34px;height:34px;border-radius:5px;object-fit:cover;flex-shrink:0;">'
                    : '';
                quoteHtml = '<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;margin-bottom:5px;border-left:3px solid ' + (isSent ? '#34B76B' : '#7CC4F7') + ';background:rgba(0,0,0,0.05);border-radius:4px;">' +
                    qThumbHtml +
                    '<div style="flex:1;min-width:0;display:flex;flex-direction:column;">' +
                    '<span style="font-size:0.72rem;font-weight:700;color:#1B2B8B;">' + _esc(data.replyTo.senderName || 'Member') + '</span>' +
                    '<span style="font-size:0.78rem;color:#6B7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;">' + _esc(_grpReplySnippetFor(data.replyTo)) + '</span>' +
                    '</div></div>';
            }
            /* @mention highlighting: bold+colored span for each tagged
               name (data.mentions is the [{uid,name}] array _send()
               attached). Matches against the ESCAPED text, so a mentioned
               name containing HTML-sensitive characters still lines up
               with what _esc() already produced. */
            var textHtml = data.text ? _esc(data.text) : '';
            if (textHtml && Array.isArray(data.mentions) && data.mentions.length) {
                data.mentions.forEach(function (m) {
                    var escName = _esc('@' + m.name);
                    textHtml = textHtml.split(escName).join(
                        '<span style="color:#1B2B8B;font-weight:700;">' + escName + '</span>'
                    );
                });
            }

            row.innerHTML =
                (isSent ? '' : '<div class="v13-grp-sender" style="font-size:0.72rem;font-weight:700;color:' + _v13SenderColor(data.senderName) + ';margin-bottom:2px;">' + _esc(data.senderName || 'Member') + '</div>') +
                quoteHtml +
                mediaHtml +
                (data.text ? '<div class="v13-grp-msg-text" style="font-size:0.92rem;color:' + _txtColor + ';word-break:break-word;">' + textHtml + '</div>' : '') +
                '<div id="' + footerId + '" class="v13-grp-foot" style="font-size:0.62rem;color:' + _footColor + ';text-align:right;margin-top:2px;">' +
                  (data.edited === true ? '<span style="font-style:italic;opacity:0.7;margin-right:4px;">edited</span>' : '') +
                  _fmtTime(data.createdAt) +
                  (readInfoHtml ? ' · ' + readInfoHtml : '') +
                '</div>';

            if (audioPlaceholderId) {
                var vnPh = row.querySelector('#' + audioPlaceholderId);
                var vn = _v13BuildVoiceNote(data, isSent);
                if (vnPh) vnPh.appendChild(vn.el);
                /* Merge duration onto the footer row: "0:04 · 12:33 AM · Read by 0/5" */
                var footerEl = row.querySelector('#' + footerId);
                if (footerEl) {
                    footerEl.insertBefore(document.createTextNode(' · '), footerEl.firstChild);
                    footerEl.insertBefore(vn.durEl, footerEl.firstChild);
                }
            }

            /* FIX/FEATURE (2026-08-01): wire the image/video tap target
               built into mediaHtml above to the fullscreen lightbox —
               done here as a real addEventListener rather than an
               innerHTML-string onclick attribute, since the media URL can
               contain characters that are painful to escape safely inside
               an inline HTML attribute (and the previous onclick approach
               is exactly what broke escaping for image messages before). */
            var _vidPrev = row.querySelector('.v13-media-tap video');
            var _vidDur  = row.querySelector('.v13-vid-dur');
            if (_vidPrev && _vidDur) {
                _vidPrev.addEventListener('loadedmetadata', function () {
                    var sec = Math.round(_vidPrev.duration || 0);
                    if (!isFinite(sec) || sec <= 0) return;
                    _vidDur.textContent = Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
                    _vidDur.style.display = 'block';
                });
            }

            var mediaTapEl = row.querySelector('.v13-media-tap');
            if (mediaTapEl) {
                mediaTapEl.addEventListener('click', function () {
                    if (row._v13LongPressFired) return;
                    _v13OpenMediaLightbox(mediaTapEl.getAttribute('data-src'), mediaTapEl.getAttribute('data-video') === '1');
                });
            }

            _v13AddMsgAvatar(row, data, isSent);
            return row;
        }

        function _wireViewerCount(row, data) {
            var el = row.querySelector('.v13-viewers-count');
            if (!el) return;
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                _showGroupReadReceipts(groupId, data);
            });
        }

        _grpUnsub = window.fbDb.collection('groups').doc(groupId).collection('messages')
            .orderBy('createdAt', 'asc').limit(150)
            .onSnapshot(function (snap) {
                snap.docChanges().forEach(function (ch) {
                    var data = ch.doc.data();
                    var docId = ch.doc.id;

                    if (ch.type === 'added') {
                        if (rendered[docId]) return;
                        var row = _fmtGroupRow(data, docId);
                        rendered[docId] = row;
                        if (data.deleted !== true) { _attachGroupLongPress(row, groupId, docId, data, myId); _wireViewerCount(row, data); }
                        body.appendChild(row);
                        body.scrollTop = body.scrollHeight;

                        if (data.pinned === true && data.deleted !== true) {
                            data._groupId = groupId;
                            _grpPinnedMsgs[docId] = data;
                            _renderGrpPinnedStrip(view);
                        }

                        /* Read receipts: mark myself as having read this
                           message the instant it renders, same "chat is
                           open and visible" gate as the 1:1 implementation. */
                        if (data.senderId !== myId && data.deleted !== true &&
                            (data.readBy || []).indexOf(myId) === -1 &&
                            document.visibilityState !== 'hidden' && _fbOk()) {
                            window.fbDb.collection('groups').doc(groupId).collection('messages').doc(docId)
                                .update({ readBy: firebase.firestore.FieldValue.arrayUnion(myId) })
                                .catch(function () {});
                        }
                    } else if (ch.type === 'modified') {
                        /* Covers: edits, soft deletes, and readBy count
                           changes landing from ANY device — this is what
                           makes them show up cross-device without needing
                           to reopen the chat. */
                        var oldRow = rendered[docId];
                        if (!oldRow) return;
                        var newRow = _fmtGroupRow(data, docId);
                        rendered[docId] = newRow;
                        if (data.deleted !== true) { _attachGroupLongPress(newRow, groupId, docId, data, myId); _wireViewerCount(newRow, data); }
                        oldRow.replaceWith(newRow);

                        if (data.pinned === true && data.deleted !== true) {
                            data._groupId = groupId;
                            _grpPinnedMsgs[docId] = data;
                        } else if (_grpPinnedMsgs[docId]) {
                            delete _grpPinnedMsgs[docId];
                        }
                        _renderGrpPinnedStrip(view);
                    }
                });
            }, function (err) {
                _notify('Could not load group messages — the groups/messages security rule may still need deploying.', 'warning');
            });

        /* FIX (2026-07-31 — "group message not sent" follow-up, network-
           flakiness half): mirrors app-patch-openchat.js's identical fix
           for the 1:1 chat ("a single dropped write on a flaky connection
           used to go straight to failed"). This group send path never had
           that retry at all — confirmed live via console: the actual
           failure wasn't permission-denied (the isGroupMember() rule fix
           closed that), it was `WebChannelConnection RPC 'Write' stream ...
           transport errored` / `TypeError: Failed to fetch` right after
           the send tap, with a `network state changed, OFFLINE => ONLINE`
           line just above it — a transient drop on a weak connection, not
           a permanent failure. One retry after a short delay before
           actually giving up matches the resilience the 1:1 chat already
           has and turns a routine mobile-network blip into a message that
           just arrives a little late instead of "Not sent". */
        /* FIX (2026-10-28 — "messages take too long to be delivered", screenshot: bubble stuck on "Sending…" / "Read by 0/0"):
           the optimistic bubble is only ever swapped by the snapshot listener's 'modified' branch, but the listener's 'added'
           branch skips any id already in rendered{} and a server acknowledgement is a metadata-only change that never raises
           'modified' — so a successfully delivered message stayed on "Sending…" until some OTHER change (e.g. someone reading
           it) touched the doc. Now the moment the write resolves, the sending bubble is rebuilt as a normal sent one (unless a
           'modified' snapshot already replaced it). */
        function _markSent(msgId, data) {
            var cur = rendered[msgId];
            if (!cur || (cur.textContent || '').indexOf('Sending…') === -1) return;
            var okData = {}; for (var k in data) okData[k] = data[k];
            delete okData.status;
            var newRow = _fmtGroupRow(okData, msgId);
            rendered[msgId] = newRow;
            if (okData.deleted !== true) { _attachGroupLongPress(newRow, groupId, msgId, okData, myId); _wireViewerCount(newRow, okData); }
            cur.replaceWith(newRow);
        }
        function _writeGroupMsg(msgId, payload) {
            _writeWithRetry(
                function () { return window.fbDb.collection('groups').doc(groupId).collection('messages').doc(msgId).set(payload); },
                function (err) {
                    _notify(err && err.code === 'permission-denied'
                        ? 'Message failed to send — you may no longer be a member of this group, or the group\'s security rules need deploying.'
                        : 'Message failed to send', 'error');
                    var failedData = {}; for (var k2 in payload) failedData[k2] = payload[k2]; failedData.status = 'failed';
                    var failedRow = _fmtGroupRow(failedData, msgId);
                    rendered[msgId].replaceWith(failedRow);
                    rendered[msgId] = failedRow;
                },
                function () { _markSent(msgId, payload); }
            );
        }

        /* FIX (2026-08-01 — "group message not sent" follow-up #2): the
           previous fix only ever gave a dropped write ONE retry, 1.5s
           later. Confirmed live via console (see screenshots): on a weak
           connection the SAME send can log several consecutive
           `TypeError: Failed to fetch` / WebChannel transport-errored
           attempts in a row, well past that single retry, before the
           connection stabilizes — so the retry itself was failing too and
           the message still ended up "Not sent" even though the network
           recovered moments later. Replaced with: up to 4 attempts total
           (1 initial + 3 retries) on an increasing backoff (1.5s/3s/6s),
           AND a one-time 'online' event listener that fires an immediate
           retry the instant the browser reports connectivity back instead
           of waiting out a stale backoff timer. Only marked 'failed' after
           every attempt is exhausted, or immediately on permission-denied
           (retrying won't fix a rules/membership problem). Shared by both
           the text send path (_writeGroupMsg) and the media send path
           (_writeGroupMedia) below so they behave identically. */
        /* FIX (2026-08-01 — "group message not sent" follow-up #3): both
           follow-ups above assumed permission-denied could only ever mean
           "genuinely not a member" and gave up on it instantly, no retry.
           That's true once a session (real or anonymous) actually exists —
           but confirmed live (see this session's own console/screenshots):
           the very first send of a page load can fire BEFORE
           app-patch-v11.js's auth watcher has finished establishing ANY
           Firebase Auth session (request.auth is briefly null while that
           watcher's grace window/anonymous fallback is still in flight —
           see its own header for why that's deliberately not instant).
           request.auth == null fails the exact same isGroupMember() check
           as "not a member" — Firestore returns the identical
           permission-denied either way, so this path can't tell a
           permanent membership problem apart from "no session YET" without
           checking auth state itself. Only give up immediately when a
           session already exists (any session — anonymous is enough to
           satisfy request.auth != null, so if one is present and this
           still failed, it really is membership); otherwise treat it as
           retryable like a network blip AND proactively nudge
           app-patch-v11.js's anonymous fallback (window._empTrySignInAnonymously,
           safe/idempotent/no-op if a session already exists or one is
           already pending) instead of passively waiting out its own grace
           window, so the retry a moment later actually has a session to
           succeed with. */
        function _hasAnyAuthSession() {
            return !!(window.fbAuth && window.fbAuth.currentUser);
        }
        function _writeWithRetry(doWrite, onGiveUp, onSuccess) {
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
                doWrite().then(function () {
                    _cleanupOnlineListener();
                    if (timer) clearTimeout(timer);
                    try { if (typeof onSuccess === 'function') onSuccess(); } catch (eOk) {}
                }, function (err) {
                    var permDenied = err && err.code === 'permission-denied';
                    var noSessionYet = permDenied && !_hasAnyAuthSession();
                    if (noSessionYet && typeof window._empTrySignInAnonymously === 'function') {
                        window._empTrySignInAnonymously();
                    }
                    if (attempt >= MAX_ATTEMPTS || (permDenied && !noSessionYet)) {
                        _cleanupOnlineListener();
                        onGiveUp(err);
                        return;
                    }
                    var delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
                    timer = setTimeout(_attempt, delay);
                    if (!onlineHandler) {
                        onlineHandler = function () {
                            if (timer) clearTimeout(timer);
                            _attempt();
                        };
                        window.addEventListener('online', onlineHandler);
                    }
                });
            }
            _attempt();
        }

        function _send() {
            var input = view.querySelector('#v13-grp-input');
            var text = input.value.trim();
            if (!text || !_fbOk()) return;
            input.value = '';
            input.style.height = 'auto'; /* composer shrinks back after a long message is sent */

            var msgId = 'gmsg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            var now = new Date().toISOString();
            var replySnapshot = _grpReplyingTo;
            _cancelGroupReply();

            /* @mention tagging: only keep pending mentions whose "@Name"
               text is still actually present in the final message — if the
               person tagged someone then deleted that part of the text
               before sending, it shouldn't silently notify them anyway. */
            var mentionsForSend = (_grpPendingMentions || []).filter(function (p) {
                return text.indexOf('@' + p.name) !== -1;
            });
            _grpPendingMentions = [];

            var payload = {
                senderId: myId,
                senderName: (_us().fullName || _us().username || 'Someone'),
                text: text,
                replyTo: replySnapshot || null,
                readBy: [myId],
                edited: false,
                deleted: false,
                createdAt: now
            };
            if (mentionsForSend.length) payload.mentions = mentionsForSend;

            /* Optimistic "Sending…" bubble, dedup'd against the listener
               the same way the 1:1 chat does it (§5c v15 fix). */
            var sendingData = {}; for (var k in payload) sendingData[k] = payload[k]; sendingData.status = 'sending';
            rendered[msgId] = _fmtGroupRow(sendingData, msgId);
            body.appendChild(rendered[msgId]);
            body.scrollTop = body.scrollHeight;

            _writeGroupMsg(msgId, payload);

            /* Fire-and-forget cross-user notification, same
               'user_notifications' shape already used for likes/follows
               elsewhere in this codebase (see app-fixes.js) — a separate
               write from the message itself, so a notification hiccup can
               never block or fail the actual send. */
            if (mentionsForSend.length && _fbOk()) {
                var g = window._empyreanGroupCache && window._empyreanGroupCache[groupId];
                var groupName = (g && g.name) || 'a group chat';
                var myName = _us().fullName || _us().username || 'Someone';
                var snippet = text.length > 80 ? text.slice(0, 80) + '…' : text;
                mentionsForSend.forEach(function (p) {
                    window.fbDb.collection('user_notifications').add({
                        userId: p.uid,
                        type: 'group_mention',
                        message: myName + ' mentioned you in ' + groupName + ': "' + snippet + '"',
                        fromUserId: myId,
                        groupId: groupId,
                        msgId: msgId,
                        read: false,
                        createdAt: now
                    }).catch(function () {});
                });
            }
        }
        view.querySelector('#v13-grp-send').addEventListener('click', _send);
        /* FIX (2026-10-28 — composer must expand for long typed/pasted text, like WhatsApp): #v13-grp-input is now an
           auto-growing <textarea> (was a one-line <input>). It grows up to 40% of the screen height, then scrolls.
           Enter sends on a physical keyboard (Shift+Enter = new line); on a touch keyboard Enter always inserts a
           new line and the Send button sends — identical to the 1:1 composer (#oc-text-input). */
        (function () {
            var _gi = view.querySelector('#v13-grp-input');
            var _touch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
            function _grow() {
                _gi.style.height = 'auto';
                var cap = Math.max(120, Math.round((window.innerHeight || 600) * 0.4));
                _gi.style.height = Math.min(_gi.scrollHeight, cap) + 'px';
            }
            _gi.addEventListener('input', _grow);
            _gi.addEventListener('paste', function () { setTimeout(_grow, 0); });
            _gi.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter' || e.isComposing) return;
                if (_touch || e.shiftKey) return; /* newline */
                e.preventDefault();
                _send();
            });
        })();

        /* FIX v16 (image/video upload) / v17 (voice notes reuse this too):
           attach button and mic button both funnel through here — uploads
           to Cloudinary, then sends a message carrying mediaUrl/mediaType,
           same optimistic "Sending…" / "⚠ Not sent" bubble pattern as a
           text message. `kind` is explicit rather than sniffed from
           file.type, because a recorded voice note's blob type
           (e.g. "audio/webm") doesn't start with "video" or "image" and
           would otherwise silently get sent as the wrong media type. */
        function _sendMedia(file, kind, caption, replyTo) {
            if (!file || !_fbOk()) return;
            if (!kind) kind = (file.type || '').indexOf('video') === 0 ? 'video' : (file.type || '').indexOf('image') === 0 ? 'image' : 'document';
            var MAX_BYTES = kind === 'video' ? 50 * 1024 * 1024 : (kind === 'audio' ? 20 * 1024 * 1024 : (kind === 'document' ? 20 * 1024 * 1024 : 10 * 1024 * 1024));
            if (file.size > MAX_BYTES) { _notify('That file is too large to send.', 'error'); return; }

            var msgId = 'gmsg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            var now = new Date().toISOString();
            var localUrl = URL.createObjectURL(file);
            var basePayload = {
                senderId: myId,
                senderName: (_us().fullName || _us().username || 'Someone'),
                text: (caption || '').trim(),
                mediaType: kind,
                fileName: file.name || '',
                fileSize: file.size || 0,
                replyTo: replyTo || null,
                readBy: [myId],
                edited: false,
                deleted: false,
                createdAt: now
            };

            var sendingData = {}; for (var k in basePayload) sendingData[k] = basePayload[k];
            sendingData.status = 'sending'; sendingData.mediaUrl = localUrl;
            rendered[msgId] = _fmtGroupRow(sendingData, msgId);
            body.appendChild(rendered[msgId]);
            body.scrollTop = body.scrollHeight;

            var cfg = (window._appConfig && window._appConfig.cloudinary) || {};
            var cloud  = cfg.cloud || cfg.cloudName || 'dxwmts9vw';
            var preset = cfg.preset || cfg.uploadPreset || 'ehfapp_preset';

            function _fail(msg) {
                _notify(msg, 'error');
                var failedData = {}; for (var k2 in basePayload) failedData[k2] = basePayload[k2];
                failedData.status = 'failed'; failedData.mediaUrl = localUrl;
                var failedRow = _fmtGroupRow(failedData, msgId);
                rendered[msgId].replaceWith(failedRow);
                rendered[msgId] = failedRow;
            }

            function _finish(url) {
                var payload = {}; for (var k3 in basePayload) payload[k3] = basePayload[k3];
                payload.mediaUrl = url;
                _writeWithRetry(
                    function () { return window.fbDb.collection('groups').doc(groupId).collection('messages').doc(msgId).set(payload); },
                    function (err) {
                        _fail(err && err.code === 'permission-denied'
                            ? 'Could not send — you may no longer be a member of this group, or the group\'s security rules need deploying.'
                            : 'Media uploaded but the message failed to send.');
                    },
                    function () { _markSent(msgId, payload); }
                );
            }

            /* Cloudinary has no dedicated "audio" resource type for
               unsigned uploads — audio files upload through the same
               /video/upload endpoint as video. Documents (PDF/doc/xls/
               etc.) go through /raw/upload — Cloudinary's endpoint for
               non-media binary files. */
            var uploadUrl = 'https://api.cloudinary.com/v1_1/' + cloud + '/' + (kind === 'image' ? 'image' : (kind === 'document' ? 'raw' : 'video')) + '/upload';
            var fd = new FormData();
            fd.append('file', file);
            fd.append('upload_preset', preset);
            fetch(uploadUrl, { method: 'POST', body: fd })
                .then(function (r) { if (!r.ok) throw new Error('upload http ' + r.status); return r.json(); })
                .then(function (d) {
                    var url = d.secure_url || d.url || '';
                    if (!url) throw new Error('no url');
                    _finish(url);
                })
                .catch(function () { _fail('Upload failed. Please check your connection and try again.'); });
        }

        view.querySelector('#v13-grp-attach').addEventListener('click', function () {
            var fi = document.createElement('input');
            fi.type = 'file';
            fi.accept = 'image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt';
            fi.style.display = 'none';
            document.body.appendChild(fi);
            fi.addEventListener('change', function () {
                var file = fi.files && fi.files[0];
                fi.remove();
                if (!file) return;
                var kind = (file.type || '').indexOf('video') === 0 ? 'video'
                    : (file.type || '').indexOf('image') === 0 ? 'image'
                    : 'document';
                var replySnapshot = _grpReplyingTo;
                _cancelGroupReply();
                _openGroupMediaCaptionComposer(file, function (caption) {
                    _sendMedia(file, kind, caption, replySnapshot);
                });
            });
            fi.click();
        });

        /* Toggle mic ↔ send button like the 1:1 chat composer: send once
           there's text to send, mic otherwise. */
        var micBtn  = view.querySelector('#v13-grp-mic');
        var sendBtn = view.querySelector('#v13-grp-send');
        var inputEl = view.querySelector('#v13-grp-input');
        /* FIX (2026-08-01 — "mic button invisible"): this used to set
           micBtn.style.display = '' for the visible case. '' doesn't mean
           "visible" — it CLEARS the inline style back to the browser's UA
           default for <button>, which is `display: inline-block`, not the
           `display:flex;align-items:center;justify-content:center` the
           template built it with (see the button's own inline style
           above). Losing the flex centering left the 17x17 mic SVG
           positioned by normal inline-block content flow instead of
           centered in the 44x44 circle — on this button's actual
           box model that pushes the icon outside the circle's visible
           paint area, reading as "the button is there but nothing shows
           on it." Setting the display explicitly back to 'flex' (the
           exact value the template used) instead of '' fixes this for
           good, matching the same explicit-value pattern already used
           correctly one line up for sendBtn/none. */
        function _syncSendMicVisibility() {
            var hasText = inputEl.value.trim().length > 0;
            sendBtn.style.display = hasText ? 'flex' : 'none';
            micBtn.style.display  = hasText ? 'none' : 'flex';
        }
        inputEl.addEventListener('input', _syncSendMicVisibility);
        _syncSendMicVisibility();

        /* =====================================================================
           FEATURE (2026-08-01) — @mention tagging in group chat.
           Typing "@" opens a small dropdown of group members (from the
           already-cached groups/{id}.members, same source _openAddToCallPicker
           uses), filtered by whatever's typed after the "@". Picking one
           inserts "@Name " into the text box and remembers {uid,name} in
           _grpPendingMentions so _send() can attach a durable `mentions`
           array to the message doc — matching stored uids at render time
           rather than re-parsing "@Name" text back to a uid (fragile: two
           members could share a display name, and a member could rename
           themselves after the fact).
           ===================================================================== */
        var _grpPendingMentions = []; /* [{uid, name}, ...] for the message currently being composed */
        var _mentionList = null;

        function _closeMentionList() {
            if (_mentionList && _mentionList.parentNode) _mentionList.parentNode.removeChild(_mentionList);
            _mentionList = null;
        }

        function _currentMentionQuery() {
            var pos = inputEl.selectionStart || inputEl.value.length;
            var upToCursor = inputEl.value.slice(0, pos);
            var m = upToCursor.match(/(?:^|\s)@([^\s@]*)$/);
            return m ? m[1] : null;
        }

        function _insertMention(uid, name) {
            var pos = inputEl.selectionStart || inputEl.value.length;
            var upToCursor = inputEl.value.slice(0, pos);
            var after = inputEl.value.slice(pos);
            var replaced = upToCursor.replace(/(?:^|\s)@([^\s@]*)$/, function (whole, tag) {
                var lead = whole.charAt(0) === '@' ? '' : whole.charAt(0);
                return lead + '@' + name + ' ';
            });
            inputEl.value = replaced + after;
            var newPos = replaced.length;
            inputEl.focus();
            inputEl.setSelectionRange(newPos, newPos);
            /* Drop any stale pending entry for the same uid (re-tagging the
               same person while still composing) before adding the fresh one. */
            _grpPendingMentions = _grpPendingMentions.filter(function (p) { return p.uid !== uid; });
            _grpPendingMentions.push({ uid: uid, name: name });
            _closeMentionList();
            _syncSendMicVisibility();
        }

        function _renderMentionList(query) {
            var g = window._empyreanGroupCache && window._empyreanGroupCache[groupId];
            var members = (g && g.members) || [];
            var mu = window.mockUsers || {};
            var q = (query || '').toLowerCase();
            var candidates = members
                .filter(function (uid) { return uid && uid !== myId; })
                .map(function (uid) {
                    var u = mu[uid] || {};
                    return { uid: uid, name: u.fullName || u.username || 'Member', avatar: u.avatar || u.photoURL || '' };
                })
                .filter(function (c) { return !q || c.name.toLowerCase().indexOf(q) !== -1; })
                .slice(0, 6);

            _closeMentionList();
            if (!candidates.length) return;

            _mentionList = document.createElement('div');
            _mentionList.id = 'v13-grp-mention-list';
            _mentionList.style.cssText = 'position:absolute;left:12px;right:12px;bottom:100%;margin-bottom:6px;background:#fff;border-radius:12px;box-shadow:0 -2px 16px rgba(0,0,0,0.18);max-height:220px;overflow-y:auto;z-index:10000015;';
            candidates.forEach(function (c) {
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;border-bottom:1px solid #f2f2f2;';
                row.innerHTML =
                    '<img src="' + _esc(c.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(c.name) + '&background=1B2B8B&color=fff')) + '" style="width:34px;height:34px;border-radius:50%;object-fit:cover;flex-shrink:0;">' +
                    '<span style="font-size:0.88rem;color:#111;">' + _esc(c.name) + '</span>';
                row.addEventListener('mousedown', function (e) { e.preventDefault(); _insertMention(c.uid, c.name); });
                _mentionList.appendChild(row);
            });
            composerRow.style.position = 'relative';
            composerRow.appendChild(_mentionList);
        }

        inputEl.addEventListener('input', function () {
            var q = _currentMentionQuery();
            if (q === null) { _closeMentionList(); return; }
            _renderMentionList(q);
        });
        inputEl.addEventListener('blur', function () {
            /* Small delay so a mousedown on a mention row (which fires
               before blur's click would) still registers before the list
               is torn down. */
            setTimeout(_closeMentionList, 150);
        });

        /* FIX v17: voice note recording — tap mic to start, the composer
           row swaps for a recording indicator (pulsing dot + timer +
           cancel/send), tap the trash to discard or the paper-plane to
           stop and send. Same Cloudinary upload + Firestore message path
           as photo/video via _sendMedia(file, 'audio'). */
        var composerRow = view.querySelector('#v13-grp-composer-row');
        var recordingRow = view.querySelector('#v13-grp-recording-row');
        var recTimerEl = view.querySelector('#v13-grp-rec-timer');
        var _mediaRecorder = null;
        var _recChunks = [];
        var _recStartedAt = 0;
        var _recTimerHandle = null;
        var _recStream = null;

        function _fmtRecTime(ms) {
            var totalSec = Math.floor(ms / 1000);
            var m = Math.floor(totalSec / 60);
            var s = totalSec % 60;
            return m + ':' + (s < 10 ? '0' : '') + s;
        }

        function _stopRecordingTracks() {
            if (_recStream) { _recStream.getTracks().forEach(function (t) { t.stop(); }); _recStream = null; }
            if (_recTimerHandle) { clearInterval(_recTimerHandle); _recTimerHandle = null; }
        }

        function _startRecording() {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                _notify('Voice notes aren\'t supported on this browser.', 'error');
                return;
            }
            navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
                _recStream = stream;
                _recChunks = [];
                var mimeType = (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm'))
                    ? 'audio/webm' : '';
                try {
                    _mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
                } catch (e) {
                    _notify('Could not start recording on this device.', 'error');
                    _stopRecordingTracks();
                    return;
                }
                _mediaRecorder.addEventListener('dataavailable', function (e) { if (e.data && e.data.size > 0) _recChunks.push(e.data); });
                _mediaRecorder.start();
                _recStartedAt = Date.now();
                composerRow.style.display = 'none';
                recordingRow.style.display = 'flex';
                recTimerEl.textContent = '0:00';
                _recTimerHandle = setInterval(function () {
                    recTimerEl.textContent = _fmtRecTime(Date.now() - _recStartedAt);
                }, 500);
            }).catch(function () {
                _notify('Microphone permission is needed to record a voice note.', 'error');
            });
        }

        function _endRecording(shouldSend) {
            if (!_mediaRecorder || _mediaRecorder.state === 'inactive') {
                composerRow.style.display = 'flex';
                recordingRow.style.display = 'none';
                _stopRecordingTracks();
                return;
            }
            var durationMs = Date.now() - _recStartedAt;
            _mediaRecorder.addEventListener('stop', function () {
                _stopRecordingTracks();
                composerRow.style.display = 'flex';
                recordingRow.style.display = 'none';
                if (shouldSend && durationMs >= 800) {
                    var blob = new Blob(_recChunks, { type: _mediaRecorder.mimeType || 'audio/webm' });
                    var ext = (blob.type.indexOf('mp4') !== -1) ? 'm4a' : 'webm';
                    var file = new File([blob], 'voice-note.' + ext, { type: blob.type });
                    _sendMedia(file, 'audio');
                } else if (shouldSend) {
                    _notify('Recording too short — hold a bit longer.', 'info');
                }
            }, { once: true });
            _mediaRecorder.stop();
        }

        micBtn.addEventListener('click', _startRecording);
        view.querySelector('#v13-grp-rec-cancel').addEventListener('click', function () { _endRecording(false); });
        view.querySelector('#v13-grp-rec-send').addEventListener('click', function () { _endRecording(true); });
    };

    /* =========================================================================
       §1c  GROUP MESSAGE LONG-PRESS → EDIT / DELETE / READ RECEIPTS
       ========================================================================= */
    function _grpSetRowHighlight(row, on) {
        if (!row) return;
        row.style.boxShadow = on
            ? '0 0 0 2px rgba(27,43,139,0.38) inset, 0 1px 1px rgba(0,0,0,0.08)'
            : '0 1px 1px rgba(0,0,0,0.08)';
    }

    /* ── Pin Message (spec item 5) — group chat ──
       Same approach as the 1:1 version: pinned state lives on the message
       subdoc (`pinned: true`), tracked locally via the existing thread
       onSnapshot listener rather than a separate query, so no new
       Firestore composite index is required. */
    function _grpTogglePinMessage(groupId, msgId, data, pinned) {
        if (!_fbOk()) { _notify('Offline — cannot pin right now.', 'error'); return; }
        window.fbDb.collection('groups').doc(groupId).collection('messages').doc(msgId)
            .update({ pinned: !!pinned }).catch(function() {
                _notify('Could not update pin — check your connection and try again.', 'error');
            });
    }

    function _renderGrpPinnedStrip(view) {
        var strip = view && view.querySelector('#v13-grp-pinned-strip');
        if (!strip) return;
        var ids = Object.keys(_grpPinnedMsgs);
        if (!ids.length) { strip.style.display = 'none'; strip.innerHTML = ''; return; }
        strip.innerHTML = '';
        strip.style.display = 'flex';
        ids.forEach(function(id) {
            var d = _grpPinnedMsgs[id];
            var card = document.createElement('div');
            card.style.cssText = 'flex:0 0 auto;max-width:180px;display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:14px;background:#fff;border:1px solid rgba(27,43,139,0.18);cursor:pointer;';
            if (d.mediaUrl && d.mediaType === 'image') {
                var img = document.createElement('img');
                img.src = d.mediaUrl;
                img.style.cssText = 'width:22px;height:22px;border-radius:4px;object-fit:cover;flex-shrink:0;';
                card.appendChild(img);
            }
            var label = document.createElement('span');
            label.style.cssText = 'font-size:0.74rem;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px;';
            label.textContent = _grpReplySnippetForModule(d);
            card.appendChild(label);
            var unpin = document.createElement('span');
            unpin.style.cssText = 'color:#9CA3AF;font-size:0.9rem;margin-left:2px;flex-shrink:0;';
            unpin.innerHTML = '&times;';
            unpin.title = 'Unpin';
            unpin.addEventListener('click', function(e) { e.stopPropagation(); _grpTogglePinMessage(d._groupId, id, d, false); });
            card.appendChild(unpin);
            card.addEventListener('click', function() {
                var row = view.querySelector('[data-msg-id="' + id + '"]');
                if (row) {
                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    _grpSetRowHighlight(row, true);
                    setTimeout(function() { _grpSetRowHighlight(row, false); }, 1200);
                }
            });
            strip.appendChild(card);
        });
    }

    /* Module-level twin of the in-closure _grpReplySnippetFor (that one is
       redeclared fresh per open chat and isn't reachable from here). */
    function _grpReplySnippetForModule(d) {
        if (d.text) return d.text;
        var mt = d.mediaType || '';
        if (mt === 'image') return '📷 Photo';
        if (mt === 'video') return '🎥 Video';
        if (mt === 'audio') return '🎤 Voice note';
        return 'Message';
    }

    function _attachGroupLongPress(row, groupId, msgId, data, myId) {
        var isSent = data.senderId === myId;
        var canDelete = isSent || _grpIsAdmin(groupId, myId);
        var timer;
        function _open() {
            _grpSetRowHighlight(row, true);
            /* FIX (2026-08-01 — lightbox popping open right after a
               long-press): mobile browsers still fire a synthetic click
               once the finger lifts after a long-press, which would
               otherwise also trigger the .v13-media-tap click handler
               below and open the fullscreen lightbox on top of the
               action sheet that just opened. Suppressed for a short
               window after a long-press fires. */
            row._v13LongPressFired = true;
            setTimeout(function () { row._v13LongPressFired = false; }, 400);
            _showGroupMsgActionSheet(row, groupId, msgId, data, isSent, canDelete);
        }
        row.addEventListener('touchstart', function (e) {
            timer = setTimeout(_open, 480);
        }, { passive: true });
        row.addEventListener('touchend',    function () { clearTimeout(timer); }, { passive: true });
        row.addEventListener('touchcancel', function () { clearTimeout(timer); }, { passive: true });
        row.addEventListener('touchmove',   function () { clearTimeout(timer); }, { passive: true });
        row.addEventListener('contextmenu', function (e) { e.preventDefault(); _open(); });
    }

    function _showGroupMsgActionSheet(row, groupId, msgId, data, isSent, canDelete) {
        var existing = document.getElementById('v13-msg-actions');
        if (existing) existing.remove();
        var existingOv = document.getElementById('v13-msg-actions-ov');
        if (existingOv) existingOv.remove();

        var ov = document.createElement('div');
        ov.id = 'v13-msg-actions-ov';
        ov.style.cssText = 'position:fixed;inset:0;z-index:10000012;background:rgba(0,0,0,0.3);';

        var sheet = document.createElement('div');
        sheet.id = 'v13-msg-actions';
        sheet.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:10000013;background:#fff;border-radius:16px 16px 0 0;box-shadow:0 -4px 30px rgba(0,0,0,0.22);padding:6px 0 20px;';

        function _close() {
            var o = document.getElementById('v13-msg-actions-ov'); if (o) o.remove();
            var s = document.getElementById('v13-msg-actions');    if (s) s.remove();
            _grpSetRowHighlight(row, false);
        }
        ov.addEventListener('click', _close);

        function _btn(label, color, fn, deferClose) {
            var b = document.createElement('button');
            b.style.cssText = 'display:block;width:100%;text-align:left;padding:14px 20px;background:none;border:none;font-size:0.92rem;color:' + color + ';';
            b.textContent = label;
            /* FIX (2026-08-01 — Share button opens frozen/blank until an
               unrelated repaint): deferClose lets Share build its own
               follow-on UI BEFORE this sheet is torn down, instead of
               always closing synchronously first — same fix as the 1:1
               chat's message action sheet in app-patch-openchat.js. */
            b.addEventListener('click', function () { if (deferClose) { fn(); return; } _close(); fn(); });
            return b;
        }

        sheet.appendChild(_btn('Reply', '#111', function () {
            if (typeof window._grpStartReply === 'function') window._grpStartReply(msgId, data, row);
        }));
        sheet.appendChild(_btn(data.pinned === true ? 'Unpin' : 'Pin', '#111', function () {
            _grpTogglePinMessage(groupId, msgId, data, data.pinned !== true);
        }));
        /* FEATURE (2026-08-02 — Forward vs Share spec) — same split as the
           1:1 chat's message action sheet in app-patch-openchat.js: this
           used to be a single "Share" row that sent immediately, no
           editing — that's Forward, kept as-is (just relabeled +
           internalOnly:true so it goes straight to the My Status/Groups/
           Direct-chats picker, no external-app tile). A new "Share" row
           opens the same picker with mode:'share', which opens EmpShare's
           editing composer before it actually sends. */
        sheet.appendChild(_btn('Forward', '#111', function () {
            if (window.EmpShare && typeof window.EmpShare.open === 'function') {
                window.EmpShare.open({ text: data.text || '', mediaUrl: data.mediaUrl || '', mediaType: data.mediaType || '', mode: 'forward', internalOnly: true });
                requestAnimationFrame(function () { requestAnimationFrame(_close); });
            } else if (data.mediaUrl) {
                _close();
                _shareGroupMediaToStatus(data);
            } else {
                _close();
            }
        }, true));
        sheet.appendChild(_btn('Share', '#111', function () {
            if (window.EmpShare && typeof window.EmpShare.open === 'function') {
                window.EmpShare.open({ text: data.text || '', mediaUrl: data.mediaUrl || '', mediaType: data.mediaType || '', mode: 'share', internalOnly: true });
                /* FIX (2026-08-01) — same close-before-open non-repaint bug
                   as the 1:1 chat Share row: let EmpShare's Level 1 paint
                   on top first, then remove this sheet two frames later
                   instead of removing it synchronously in the same tick. */
                requestAnimationFrame(function () { requestAnimationFrame(_close); });
            } else if (data.mediaUrl) {
                _close();
                _shareGroupMediaToStatus(data);
            } else {
                _close();
            }
        }, true));
        if (isSent) sheet.appendChild(_btn('Edit', '#111', function () { _openGroupEditModal(groupId, msgId, data); }));
        if (canDelete) sheet.appendChild(_btn('Delete', '#E53935', function () { _deleteGroupMessage(groupId, msgId); }));
        if (isSent) sheet.appendChild(_btn('View read receipts', '#111', function () { _showGroupReadReceipts(groupId, data); }));
        sheet.appendChild(_btn('Cancel', '#6B7280', function () {}));

        document.body.appendChild(ov);
        document.body.appendChild(sheet);
    }

    /* =========================================================================
       FEATURE (2026-08-01) — "Share to Status" from a group chat media post.
       Re-uses the Status feature's OWN existing composer end-to-end instead
       of building a second upload path: app-status.js already wires a real
       'change' listener on #status-file-input (see its _wireCreateModal,
       fired unconditionally a few times during boot — by the time a user
       could possibly long-press a message to reach this, that listener is
       already attached) that renders the preview and drives the Cloudinary
       upload when "Post Status" is tapped. So this function's only job is:
       1) get the group chat's media into that same file input as a real
          File object, 2) get the create-status modal open and visible, and
          3) land the user on the section where the status bar/composer
          actually lives (index.html nests #status-bar-container /
          #create-status-modal inside <main class="main-content">, ahead of
          every <section class="content-section">, so they render above
          whichever section is active — "dashboard" is the section they're
          visually anchored to and the one every other entry point into
          Status already uses, e.g. _goProfile/_openChat's own navigateTo
          calls elsewhere in this codebase).
       ========================================================================= */
    function _shareGroupMediaToStatus(data) {
        var modal = document.getElementById('create-status-modal');
        var fileInp = document.getElementById('status-file-input');
        if (!modal || !fileInp) { _notify('Status feature is still loading — try again in a moment.', 'info'); return; }

        if (typeof window.navigateTo === 'function') window.navigateTo('dashboard');

        function _openModal() {
            modal.style.display = 'flex';
            modal.classList.add('show');
            document.body.classList.add('modal-open');
            /* Safety net: app-status.js watches this class change itself
               and scrolls its card to the bottom so #post-status-btn is
               visible without the person needing to find it — call it
               directly too in case that observer hasn't attached yet. */
            if (typeof window._empScrollStatusModalToBottom === 'function') window._empScrollStatusModalToBottom();
        }

        /* FIX (2026-08-30 follow-up — see _shareToStatus()'s fuller comment
           for why): skip the fetch-into-File round trip entirely when
           app-status.js's remote-attach helper is available — it shows the
           same preview directly against the hosted url and posts that url
           as-is, so a poor connection never has to download the whole clip
           here just to re-upload it again on Post Status. */
        if (typeof window._empAttachRemoteStatusMedia === 'function') {
            _openModal();
            var attachedGrp = window._empAttachRemoteStatusMedia(data.mediaUrl, data.mediaType);
            if (!attachedGrp) {
                _notify('Could not auto-attach that media — please add it again from "Add photos or videos".', 'warning');
            }
            var textElGrp = document.getElementById('status-text-input');
            if (textElGrp && data.text && !textElGrp.value) textElGrp.value = data.text;
            return;
        }

        _notify('Preparing to share to your status…', 'info');

        fetch(data.mediaUrl)
            .then(function (r) { if (!r.ok) throw new Error('fetch http ' + r.status); return r.blob(); })
            .then(function (blob) {
                /* FIX (2026-08-30 — same "shared video doesn't move to the
                   status uploader" bug as _shareToStatus() below: opening
                   the modal must happen BEFORE the file is attached and
                   'change' dispatched, not after, or app-status.js's own
                   preview <video>/<img> gets sourced while its container is
                   still display:none and never starts decoding. See
                   _shareToStatus()'s fuller comment for why. */
                _openModal();

                var isVideo = data.mediaType === 'video';
                var ext = isVideo ? 'mp4' : 'jpg';
                var mime = blob.type || (isVideo ? 'video/mp4' : 'image/jpeg');
                var file = new File([blob], 'shared-status.' + ext, { type: mime });

                var dt = new DataTransfer();
                dt.items.add(file);
                fileInp.files = dt.files;
                fileInp._lastChangeSig = ''; /* clear the dup-change guard in app-status.js so this programmatic set is picked up */
                fileInp.dispatchEvent(new Event('change', { bubbles: true }));

                /* Carry the original caption over as a starting point for
                   the status text — the person can still edit or clear it
                   before posting, this just saves re-typing it. */
                var textEl = document.getElementById('status-text-input');
                if (textEl && data.text && !textEl.value) textEl.value = data.text;
            })
            .catch(function () {
                /* Media couldn't be fetched into a File (offline, or the
                   host blocking cross-origin fetch) — still open the
                   composer so the person isn't stuck with a dead tap, they
                   just need to re-attach the media manually via "Add photos
                   or videos" inside it. */
                _openModal();
                _notify('Could not auto-attach that media — please add it again from "Add photos or videos".', 'warning');
            });
    }

    function _openGroupEditModal(groupId, msgId, data) {
        var wrap = document.createElement('div');
        wrap.id = 'v13-edit-modal';
        wrap.style.cssText = 'position:fixed;inset:0;z-index:10000014;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:20px;';
        wrap.innerHTML =
            '<div style="background:#fff;border-radius:14px;width:100%;max-width:380px;padding:18px;">' +
              '<div style="font-weight:700;font-size:0.95rem;margin-bottom:10px;color:#111;">Edit message</div>' +
              '<textarea id="v13-edit-textarea" rows="4" style="width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:10px;padding:10px;font-size:0.9rem;resize:vertical;font-family:inherit;"></textarea>' +
              '<div style="display:flex;gap:10px;margin-top:14px;">' +
                '<button id="v13-edit-cancel" style="flex:1;padding:11px;border-radius:10px;border:1px solid #ddd;background:#fff;color:#111;font-weight:600;">Cancel</button>' +
                '<button id="v13-edit-save" style="flex:1;padding:11px;border-radius:10px;border:none;background:#1B2B8B;color:#fff;font-weight:700;">Save</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(wrap);
        var ta = wrap.querySelector('#v13-edit-textarea');
        ta.value = data.text || '';
        ta.focus();
        wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
        wrap.querySelector('#v13-edit-cancel').addEventListener('click', function () { wrap.remove(); });
        wrap.querySelector('#v13-edit-save').addEventListener('click', function () {
            var newText = ta.value.trim();
            wrap.remove();
            if (!newText || newText === data.text) return;
            window.fbDb.collection('groups').doc(groupId).collection('messages').doc(msgId)
                .update({ text: newText, edited: true, editedAt: new Date().toISOString() })
                .catch(function () { _notify('Could not save edit.', 'error'); });
        });
    }

    function _deleteGroupMessage(groupId, msgId) {
        if (!confirm('Delete this message for everyone in the group?')) return;
        window.fbDb.collection('groups').doc(groupId).collection('messages').doc(msgId)
            .update({ deleted: true, text: '', readBy: [] })
            .catch(function () { _notify('Could not delete message.', 'error'); });
    }

    function _showGroupReadReceipts(groupId, data) {
        var readBy = (Array.isArray(data.readBy) ? data.readBy : []).filter(function (u) { return u !== data.senderId; });
        var g = window._empyreanGroupCache[groupId] || {};
        var total = Math.max((g.members || []).length - 1, 0);
        var mu = window.mockUsers || {};

        var existing = document.getElementById('v13-viewers-sheet');
        if (existing) existing.remove();
        var existingOv = document.getElementById('v13-viewers-ov');
        if (existingOv) existingOv.remove();

        var ov = document.createElement('div');
        ov.id = 'v13-viewers-ov';
        ov.style.cssText = 'position:fixed;inset:0;z-index:10000020;background:rgba(0,0,0,0.3);';
        function _close() {
            var o = document.getElementById('v13-viewers-ov'); if (o) o.remove();
            var s = document.getElementById('v13-viewers-sheet'); if (s) s.remove();
        }
        ov.addEventListener('click', _close);

        var sheet = document.createElement('div');
        sheet.id = 'v13-viewers-sheet';
        sheet.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:10000021;background:#fff;border-radius:16px 16px 0 0;box-shadow:0 -4px 30px rgba(0,0,0,0.22);max-height:60vh;display:flex;flex-direction:column;';

        var header = document.createElement('div');
        header.style.cssText = 'padding:14px 18px;border-bottom:1px solid #eee;font-weight:700;font-size:0.94rem;color:#111;flex-shrink:0;';
        header.textContent = 'Seen by ' + readBy.length + ' of ' + total;
        sheet.appendChild(header);

        var list = document.createElement('div');
        list.style.cssText = 'overflow-y:auto;padding:6px 0 max(10px, env(safe-area-inset-bottom));';
        sheet.appendChild(list);

        if (!readBy.length) {
            var empty = document.createElement('div');
            empty.style.cssText = 'padding:24px 18px;text-align:center;color:#9CA3AF;font-size:0.86rem;';
            empty.textContent = 'No one has read this message yet.';
            list.appendChild(empty);
        }

        readBy.forEach(function (uid) {
            var u = mu[uid] || {};
            var name = u.fullName || u.username || 'Member';
            var avatarUrl = u.avatar || u.photoURL || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=1B2B8B&color=fff');

            var row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 18px;';

            var av = document.createElement('img');
            av.src = avatarUrl;
            av.style.cssText = 'width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0;cursor:pointer;';
            av.title = 'View picture';
            av.addEventListener('click', function () {
                if (typeof window._ocOpenLightbox === 'function') window._ocOpenLightbox(avatarUrl);
                else window.open(avatarUrl, '_blank');
            });

            var nameEl = document.createElement('div');
            nameEl.style.cssText = 'flex:1;min-width:0;font-size:0.9rem;font-weight:600;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            nameEl.textContent = name;

            var chatBtn = document.createElement('button');
            chatBtn.type = 'button';
            chatBtn.title = 'Message ' + name;
            chatBtn.style.cssText = 'width:38px;height:38px;border-radius:50%;border:none;background:rgba(27,43,139,0.10);color:#1B2B8B;flex-shrink:0;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:1.05rem;';
            chatBtn.innerHTML = '<i class="fas fa-comment-dots"></i>';
            chatBtn.addEventListener('click', function () {
                _close();
                if (typeof window.openChat !== 'function') { _notify('Messaging isn\u2019t available right now.', 'warning'); return; }
                /* FIX (2026-10-23 — "tapping the message icon in Seen-by doesn't open their inbox"): the group
                   chat view (#v13-group-view) sits at z-index 9999990, ABOVE the 1:1 chat overlay openChat()
                   builds (99999), so the person's chat opened underneath the group and looked like nothing
                   happened. Same cure app-patch-v14.js's group-member "Message" button already uses: leave the
                   group view via its own back button (so its listeners tear down normally), land on the Inbox,
                   then open that person's 1:1 chat. */
                var grpBackBtn = document.getElementById('v13-grp-back');
                if (grpBackBtn) grpBackBtn.click();
                else { var grpView = document.getElementById('v13-group-view'); if (grpView) grpView.remove(); }
                if (typeof window.navigateTo === 'function') window.navigateTo('messages');
                setTimeout(function () { window.openChat(uid, name); }, 250);
            });

            row.appendChild(av);
            row.appendChild(nameEl);
            row.appendChild(chatBtn);
            list.appendChild(row);
        });

        document.body.appendChild(ov);
        document.body.appendChild(sheet);
    }

    /* =========================================================================
       §2  NEW BROADCAST
       Recipients each get the message as an ordinary 1:1 DM in the existing
       `messages` collection — no group thread is created, matching the
       spec ("recipients can view them without forming a group chat").
       ========================================================================= */
    function _startNewBroadcastFlow() {
        _openContactPicker({
            title: 'New broadcast — recipients',
            confirmLabel: 'Next',
            onConfirm: function (contacts) { _openBroadcastComposeStep(contacts); }
        });
    }

    function _openBroadcastComposeStep(contacts) {
        var panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;inset:0;z-index:10000000;background:#fff;display:flex;flex-direction:column;';
        panel.innerHTML =
            '<div style="display:flex;align-items:center;gap:12px;padding:14px;background:#1B2B8B;color:#fff;flex-shrink:0;">' +
              '<button id="v13-bc-back" style="background:none;border:none;color:#fff;font-size:1.4rem;cursor:pointer;">&#8592;</button>' +
              '<span style="font-weight:700;">Broadcast to ' + contacts.length + '</span>' +
            '</div>' +
            '<div style="padding:16px;color:#6B7280;font-size:0.8rem;">Each recipient gets this as a normal chat message. They won\'t see anyone else on the list, and replies come back to you as a regular 1:1 chat.</div>' +
            '<div style="flex:1;"></div>' +
            '<div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid #eee;">' +
              '<input id="v13-bc-text" placeholder="Type your broadcast message" style="flex:1;padding:12px 14px;border:1px solid #ddd;border-radius:22px;font-size:0.9rem;">' +
              '<button id="v13-bc-send" style="width:46px;height:46px;border-radius:50%;border:none;background:#1B2B8B;color:#fff;flex-shrink:0;font-size:1.1rem;">&#10148;</button>' +
            '</div>';
        document.body.appendChild(panel);

        panel.querySelector('#v13-bc-back').addEventListener('click', function () { panel.remove(); });

        function _send() {
            var input = panel.querySelector('#v13-bc-text');
            var text = input.value.trim();
            if (!text) return;
            if (!_fbOk()) { _notify('No internet connection', 'warning'); return; }
            var sendBtn = panel.querySelector('#v13-bc-send');
            sendBtn.disabled = true;

            var myId = _authUid() || _us().id || '';
            var myName = _us().fullName || _us().username || 'Someone';

            var listRef = window.fbDb.collection('broadcastLists').doc();
            listRef.set({
                ownerId: myId,
                name: 'Broadcast ' + new Date().toLocaleDateString(),
                recipients: contacts.map(function (c) { return c.id; }),
                createdAt: new Date().toISOString()
            }).then(function () {
                var batch = window.fbDb.batch();
                contacts.forEach(function (c) {
                    var msgRef = window.fbDb.collection('messages').doc();
                    batch.set(msgRef, {
                        senderId: myId,
                        receiverId: c.id,
                        senderName: myName,
                        text: text,
                        read: false,
                        isBroadcast: true,
                        broadcastId: listRef.id,
                        createdAt: new Date().toISOString()
                    });
                });
                return batch.commit();
            }).then(function () {
                panel.remove();
                _notify('Broadcast sent to ' + contacts.length + ' contact' + (contacts.length === 1 ? '' : 's'), 'success');
            }).catch(function (err) {
                sendBtn.disabled = false;
                _notify('Broadcast failed to send. ' + (err.message || ''), 'error');
            });
        }
        panel.querySelector('#v13-bc-send').addEventListener('click', _send);
        panel.querySelector('#v13-bc-text').addEventListener('keydown', function (e) { if (e.key === 'Enter') _send(); });
        panel.querySelector('#v13-bc-text').focus();
    }

    /* =========================================================================
       §2b  BROADCAST CHAT — opened by tapping a broadcast row in the chat list
       (app-patch-v20.js). The creator sees the list as a chat: a "You created a
       broadcast list with N recipients" notice, every broadcast already sent, and
       a message box that fans a new message out to the recipients the same way
       the creation flow above does (one ordinary 1:1 DM per recipient).
       ========================================================================= */
    window._empOpenBroadcastChat = function (listId) {
        if (!listId || !_fbOk()) { _notify('No internet connection', 'warning'); return; }
        var old = document.getElementById('v13-bc-chat'); if (old) old.remove();
        window.fbDb.collection('broadcastLists').doc(listId).get().then(function (doc) {
            if (!doc.exists) { _notify('This broadcast list no longer exists.', 'info'); return; }
            _buildBroadcastChat(listId, doc.data() || {});
        }).catch(function (err) { _notify('Could not open the broadcast list. ' + ((err && err.message) || ''), 'error'); });
    };

    function _buildBroadcastChat(listId, b) {
        var recips = Array.isArray(b.recipients) ? b.recipients.slice() : [];
        var mu = (window.EmpState && window.EmpState.mockUsers) || window.mockUsers || {};
        var names = recips.map(function (uid) { var u = mu[uid]; return (u && (u.fullName || u.username)) || ''; }).filter(Boolean);
        var n = recips.length;
        var title = n + ' recipient' + (n === 1 ? '' : 's');

        var panel = document.createElement('div');
        panel.id = 'v13-bc-chat';
        panel.style.cssText = 'position:fixed;inset:0;z-index:10000000;background:#F5F1E8;display:flex;flex-direction:column;';
        panel.innerHTML =
            '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:#fff;border-bottom:1px solid #E8E4D8;flex-shrink:0;">' +
              '<button id="v13-bcc-back" aria-label="Back" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:#0A0E27;padding:4px 8px;">&#8592;</button>' +
              '<div style="width:42px;height:42px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#3DD6A3 0%,#0B8F6B 100%);display:flex;align-items:center;justify-content:center;"><i class="fas fa-bullhorn" style="color:#fff;font-size:1rem;"></i></div>' +
              '<div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:1rem;color:#0A0E27;">' + _esc(title) + '</div>' +
              '<div style="font-size:0.8rem;color:#6B7A94;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(names.join(', ') || (b.name || 'Broadcast list')) + '</div></div>' +
              '<button id="v13-bcc-more" aria-label="More" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#0A0E27;padding:6px 10px;">&#8942;</button>' +
            '</div>' +
            '<div id="v13-bcc-body" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 12px;display:flex;flex-direction:column;gap:8px;">' +
              '<div style="align-self:center;max-width:88%;text-align:center;background:#FFF1CF;color:#5B5340;border-radius:10px;padding:8px 12px;font-size:0.8rem;line-height:1.4;">Broadcast messages are delivered to each recipient as a normal chat. They won\'t see anyone else on the list, and replies come back to you as a regular 1:1 chat.</div>' +
              '<div style="align-self:center;background:rgba(255,255,255,0.9);color:#374151;border-radius:10px;padding:6px 12px;font-size:0.82rem;">You created a broadcast list with ' + _esc(title) + '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:transparent;flex-shrink:0;">' +
              '<input id="v13-bcc-text" placeholder="Message" autocomplete="off" style="flex:1;min-width:0;padding:13px 16px;border:none;border-radius:24px;font-size:0.95rem;background:#fff;outline:none;">' +
              '<button id="v13-bcc-send" aria-label="Send" style="width:46px;height:46px;border-radius:50%;border:none;background:#1B2B8B;color:#fff;flex-shrink:0;font-size:1.1rem;cursor:pointer;">&#10148;</button>' +
            '</div>';
        document.body.appendChild(panel);

        var body = panel.querySelector('#v13-bcc-body');
        var input = panel.querySelector('#v13-bcc-text');
        var sendBtn = panel.querySelector('#v13-bcc-send');
        var shown = {};

        function _fmt(iso) {
            var d = new Date(iso); if (isNaN(d.getTime())) return '';
            return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        }
        function _addBubble(text, iso, key) {
            if (key && shown[key]) return null;
            if (key) shown[key] = true;
            var el = document.createElement('div');
            el.style.cssText = 'align-self:flex-end;max-width:80%;background:#D9F2E6;color:#0A0E27;border-radius:14px 14px 4px 14px;padding:8px 12px;font-size:0.92rem;line-height:1.4;word-break:break-word;box-shadow:0 1px 1px rgba(0,0,0,0.08);';
            el.innerHTML = '<div style="white-space:pre-wrap;">' + _esc(text) + '</div><div style="text-align:right;font-size:0.68rem;color:#6B7A94;margin-top:2px;">' + _esc(_fmt(iso)) + '<span class="v13-bcc-st"></span></div>';
            body.appendChild(el);
            body.scrollTop = body.scrollHeight;
            return el;
        }

        /* history: one bubble per broadcast (each send writes one DM per recipient) */
        var myId = _authUid() || _us().id || '';
        window.fbDb.collection('messages').where('broadcastId', '==', listId).where('senderId', '==', myId).get().then(function (snap) {
            var seen = {}, list = [];
            snap.forEach(function (d) {
                var m = d.data() || {};
                if (m.deleted === true) return;
                var t = new Date(m.createdAt).getTime() || 0;
                var key = m.bcKey || ((m.text || '') + '|' + Math.floor(t / 5000));
                if (seen[key]) return;
                seen[key] = true;
                list.push({ text: m.text || '', at: m.createdAt, t: t, key: key });
            });
            list.sort(function (a, c) { return a.t - c.t; });
            list.forEach(function (m) { var be = _addBubble(m.text, m.at, m.key); if (be) _setStatus(be, 'sent'); });
        }).catch(function () { /* history is a convenience — sending still works */ });

        /* Optimistic send: the bubble appears and the box clears immediately. Firestore keeps a write queued while
           the connection is weak/offline (its promise only resolves once the server acknowledges), which used to
           leave this button disabled and the text sitting in the box with no sign anything happened. */
        function _setStatus(el, state) {
            var st = el.querySelector('.v13-bcc-st'); if (!st) return;
            if (state === 'sent') { st.textContent = ' \u2713'; st.style.color = '#1B6FD1'; st.onclick = null; st.style.cursor = ''; }
            else if (state === 'failed') { st.textContent = ' \u26A0 Not sent \u2014 tap to retry'; st.style.color = '#E53935'; st.style.cursor = 'pointer'; }
            else { st.textContent = ' \u23F3'; st.style.color = '#6B7A94'; st.style.cursor = ''; }
        }
        function _fanOut(text, nowIso, bcKey, bubbleEl) {
            var myName = _us().fullName || _us().username || 'Someone';
            var tasks = [];
            for (var i = 0; i < recips.length; i += 400) {
                var batch = window.fbDb.batch();
                recips.slice(i, i + 400).forEach(function (rid) {
                    /* deterministic id => a retry overwrites instead of duplicating */
                    var msgRef = window.fbDb.collection('messages').doc(bcKey + '_' + rid);
                    batch.set(msgRef, {
                        id: msgRef.id,
                        chatId: [myId, rid].sort().join('_'),
                        senderId: myId,
                        receiverId: rid,
                        senderName: myName,
                        text: text,
                        read: false,
                        isBroadcast: true,
                        broadcastId: listId,
                        bcKey: bcKey,
                        createdAt: nowIso
                    });
                });
                tasks.push(batch.commit());
            }
            _setStatus(bubbleEl, 'sending');
            Promise.all(tasks).then(function () { _setStatus(bubbleEl, 'sent'); })
            .catch(function (err) {
                _setStatus(bubbleEl, 'failed');
                var st = bubbleEl.querySelector('.v13-bcc-st');
                if (st) st.onclick = function () { _fanOut(text, nowIso, bcKey, bubbleEl); };
                _notify('Broadcast failed to send. ' + ((err && err.message) || ''), 'error');
            });
        }
        function _send() {
            var text = input.value.trim();
            if (!text) return;
            if (!n) { _notify('This list has no recipients.', 'warning'); return; }
            if (!_fbOk()) { _notify('No internet connection', 'warning'); return; }
            var nowIso = new Date().toISOString();
            var bcKey = 'bc' + Date.now() + Math.random().toString(36).slice(2, 7);
            var bubbleEl = _addBubble(text, nowIso, bcKey);
            input.value = '';
            input.focus();
            if (bubbleEl) _fanOut(text, nowIso, bcKey, bubbleEl);
        }
        sendBtn.addEventListener('click', _send);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') _send(); });
        panel.querySelector('#v13-bcc-back').addEventListener('click', function () { panel.remove(); });

        panel.querySelector('#v13-bcc-more').addEventListener('click', function (e) {
            e.stopPropagation();
            var ex = document.getElementById('v13-bcc-menu'); if (ex) { ex.remove(); return; }
            var menu = document.createElement('div');
            menu.id = 'v13-bcc-menu';
            menu.style.cssText = 'position:absolute;top:56px;right:10px;z-index:3;background:#fff;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,0.22);min-width:190px;overflow:hidden;';
            [['View recipients', false], ['Delete broadcast list', true]].forEach(function (it) {
                var r = document.createElement('div');
                r.textContent = it[0];
                r.style.cssText = 'padding:13px 16px;font-size:0.88rem;cursor:pointer;color:' + (it[1] ? '#E53935' : '#111') + ';';
                r.addEventListener('click', function (ev) {
                    ev.stopPropagation(); menu.remove();
                    if (!it[1]) { alert((b.name || 'Broadcast') + '\n\nSent to:\n' + (names.length ? names.join('\n') : '(no recipients)')); return; }
                    if (!confirm('Delete this broadcast list? Messages already delivered to recipients are not affected.')) return;
                    window.fbDb.collection('broadcastLists').doc(listId).delete().then(function () {
                        panel.remove();
                        _notify('Broadcast list deleted', 'success');
                    }).catch(function (err) { _notify('Could not delete the list. ' + ((err && err.message) || ''), 'error'); });
                });
                menu.appendChild(r);
            });
            panel.appendChild(menu);
            setTimeout(function () { document.addEventListener('click', function () { menu.remove(); }, { once: true }); }, 30);
        });
    }

    /* =========================================================================
       §3  ENTRY MENU  (wired from the "+" button app-patch-openchat.js adds
       to the messages list header)
       ========================================================================= */
    window._ocOpenGroupBroadcastMenu = function () {
        var existing = document.getElementById('v13-entry-menu');
        if (existing) { existing.remove(); return; }

        var menu = document.createElement('div');
        menu.id = 'v13-entry-menu';
        menu.style.cssText = 'position:fixed;top:54px;right:10px;z-index:10000001;background:#fff;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,0.22);min-width:190px;overflow:hidden;';

        var ITEMS = [
            { label: 'New group',     action: _startNewGroupFlow },
            { label: 'New broadcast', action: _startNewBroadcastFlow }
        ];
        ITEMS.forEach(function (item) {
            var row = document.createElement('div');
            row.textContent = item.label;
            row.style.cssText = 'padding:13px 16px;font-size:0.88rem;cursor:pointer;color:#111;';
            row.addEventListener('click', function (e) {
                e.stopPropagation();
                menu.remove();
                item.action();
            });
            menu.appendChild(row);
        });
        document.body.appendChild(menu);

        setTimeout(function () {
            document.addEventListener('click', function _close() {
                if (menu.parentNode) menu.remove();
                document.removeEventListener('click', _close);
            }, { once: true });
        }, 30);
    };

    console.log('[EmpyreanPatchV13] ✅ Group chat + broadcast channel ready.');
})();

/* ───────────────────────────── Part 2 (was app-patch-v14.js) ───────────────────────────── */

/* =============================================================================
   Empyrean — app-patch-v14.js
   ─────────────────────────────────────────────────────────────────────────
   Load order: AFTER app-patch-v13.js (needs window.openGroupChat + the
   groups/{groupId} data model it created).

   WHAT THIS FILE DOES
   Adds the "Group Management Portal" half of the messaging spec on top of
   v13's bare-bones group chat:

     §1  Data model additions — admins:[uid,...], permissions:{...} on the
         existing groups/{groupId} doc. Nothing here breaks a group created
         before this file existed; missing fields are treated as defaults
         (no extra admins beyond the creator, everyone can message/add).
     §2  Header tap → Management Portal (admins, creator, created date,
         copy group link, permissions, member list, add/remove members,
         make/dismiss admin, exit group, delete group).
     §3  Permission enforcement — composer disables itself for non-admins
         when "only admins can message" is on; Add-members hides itself
         for non-admins when "only admins can add members" is on. Real
         enforcement lives in firebase-rules.js; this is the UI reflection
         of the same rule so people aren't hitting silent permission-denied
         writes.
     §4  Groups now appear in the contact list (a "Groups" section above
         1:1 contacts) — before this file, the ONLY way back into a group
         you'd already created was re-running the New Group flow, since
         openGroupChat() was never wired to anything persistent.
     §5  ?openGroup=<id> deep link — "Copy group link" produces a URL that,
         when opened by an existing member, jumps straight into that
         group's chat.

   FIRESTORE RULES: replace the groups/{groupId} "allow update" rule with
   the tightened version (see chat) — lets any member touch `members`,
   but only an admin/owner can touch `admins` or `permissions`.

   DATA MODEL (additions to existing groups/{groupId})
     admins:      [uid, ...]     — owner is always an implicit admin
     permissions: {
       onlyAdminsCanMessage:    bool,
       onlyAdminsCanAddMembers: bool,
       onlyAdminsCanEditInfo:   bool
     }
   ============================================================================= */
(function () {
    'use strict';

    if (window._empyreanV14Loaded) { console.warn('[v14] Already loaded — skipping.'); return; }
    window._empyreanV14Loaded = true;

    function _fbOk() { return !!(window._firebaseLoaded && window.fbDb); }
    function _us()   { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    /* FIX (bug: "added members can't see the group chat"): same
       anonymous-Firebase-session exclusion as app-patch-v13.js's own
       _authUid() — see that file's header comment for the full root-
       cause trace. In short: an anonymous fbAuth.currentUser.uid does
       not match the real profile id (window.userState.id) that other
       members' devices actually wrote into groups/{id}.members, so
       _renderGroupsInContactList's `array-contains` query below was
       searching for the wrong value and the group silently never
       appeared for the added person. Anonymous sessions now fall
       through to the real profile id instead. */
    function _authUid() {
        try {
            var u = window.fbAuth && window.fbAuth.currentUser;
            if (u && !u.isAnonymous) return u.uid;
            return null;
        } catch (e) { return null; }
    }
    // FIX (bugs: group creator's name/avatar showing as generic "Member"
    // in the member list, and group photo upload silently not saving):
    // window.mockUsers, and the ownerId/members arrays written at group
    // creation (app-patch-v13.js), are keyed by each person's PERSISTENT
    // app user id — not their live, per-session (often anonymous)
    // Firebase Auth uid. This used to prefer the live uid, so on a device
    // with a real (non-anonymous) session, "myId" here was a different
    // value than the persistent id actually stored in g.ownerId/g.members
    // — breaking isOwner/isAdmin checks (which decide who sees the photo
    // upload control and whether the update is even attempted) and, via
    // the identical bug in app-patch-v13.js's group creation, the
    // _nameOf()/_avatarOf() lookups below for the owner's own row.
    // Persistent id first, matching mockUsers' keys.
    function _myId() { return _us().id || _authUid() || ''; }
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
        });
    }
    function _notify(msg, type) {
        if (typeof window.showNotification === 'function') { try { window.showNotification(msg, type || 'info'); return; } catch (e) {} }
        console.log('[v14]', msg);
    }
    function _fmtDateTime(ts) {
        if (!ts) return '';
        var d = (ts && ts.toDate) ? ts.toDate() : new Date(ts);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
            + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    function _nameOf(uid) {
        var mu = window.mockUsers || {};
        var u = mu[uid];
        return (u && (u.fullName || u.username)) || 'Member';
    }
    function _avatarOf(uid) {
        var mu = window.mockUsers || {};
        var u = mu[uid] || {};
        return u.avatar || u.photoURL
            || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(_nameOf(uid)) + '&background=1B2B8B&color=fff');
    }

    /* =========================================================================
       §1  ADMIN / PERMISSION HELPERS
       ========================================================================= */
    function _isAdmin(g, uid) {
        if (!g || !uid) return false;
        if (g.ownerId === uid) return true;
        return Array.isArray(g.admins) && g.admins.indexOf(uid) !== -1;
    }
    function _perm(g) {
        return (g && g.permissions) || {};
    }
    function _canMessage(g, uid)    { return !_perm(g).onlyAdminsCanMessage    || _isAdmin(g, uid); }
    function _canAddMembers(g, uid) { return !_perm(g).onlyAdminsCanAddMembers || _isAdmin(g, uid); }
    function _canEditInfo(g, uid)   { return !_perm(g).onlyAdminsCanEditInfo   || _isAdmin(g, uid); }


    /* =========================================================================
       §2  WRAP window.openGroupChat  (defined in app-patch-v13.js)
       Adds: clickable header → portal, live permission gating on composer.
       ========================================================================= */
    var _origOpenGroupChat = window.openGroupChat;
    var _liveGroupUnsub = null;

    if (typeof _origOpenGroupChat === 'function') {
        window.openGroupChat = function (groupId) {
            _origOpenGroupChat(groupId);
            setTimeout(function () { _wireGroupChrome(groupId); }, 60);
        };
    } else {
        console.warn('[v14] window.openGroupChat not found — load AFTER app-patch-v13.js.');
    }

    function _wireGroupChrome(groupId) {
        var view = document.getElementById('v13-group-view');
        if (!view || !_fbOk()) return;

        if (_liveGroupUnsub) { try { _liveGroupUnsub(); } catch (e) {} _liveGroupUnsub = null; }

        var myId  = _myId();
        var titleEl  = view.querySelector('#v13-grp-title');
        var subEl    = view.querySelector('#v13-grp-sub');
        var input    = view.querySelector('#v13-grp-input');
        var sendBtn  = view.querySelector('#v13-grp-send');
        /* FIX (2026-08-01 — "Only admins can send messages" bypassable via
           voice note or attach): the permission snapshot below only ever
           disabled `input`/`sendBtn`. #v13-grp-mic and #v13-grp-attach were
           never included, so a non-admin in a locked-down group could still
           record and send a voice note, or attach a photo/video, completely
           bypassing the restriction the text composer was visibly enforcing.
           Picked up here too so all four composer controls gate together. */
        var micBtn    = view.querySelector('#v13-grp-mic');
        var attachBtn = view.querySelector('#v13-grp-attach');

        /* Header is now a tap target for the management portal */
        var headerBar = titleEl && titleEl.closest('div[style*="flex:1"]');
        if (headerBar) {
            headerBar.style.cursor = 'pointer';
            headerBar.onclick = function () { _openGroupManagementPortal(groupId); };
        }

        /* Live listen to the group doc so name/permission changes reflect
           immediately without needing to reopen the chat. */
        _liveGroupUnsub = window.fbDb.collection('groups').doc(groupId)
            .onSnapshot(function (doc) {
                if (!doc.exists) return;
                var g = doc.data();
                if (titleEl) titleEl.textContent = g.name || 'Group';
                if (subEl)   subEl.textContent   = (g.members || []).length + ' participants';

                /* FIX v15 (Group Chat Avatar Frame spec): keep the header
                   avatar in sync with the group doc, and mirror the whole
                   doc into the cache app-patch-v13.js reads for admin/
                   read-receipt checks (see §1b there) — this is the one
                   live subscription for groups/{id}, v13 doesn't open a
                   second one. */
                window._empyreanGroupCache = window._empyreanGroupCache || {};
                window._empyreanGroupCache[groupId] = g;
                var avEl = view.querySelector('#v13-grp-avatar');
                /* FIX v18 (redesign): one call now handles the offline-safe
                   initials frame, the edit badge, and the click-to-upload
                   target (the whole frame, not the img — see v15.js for
                   why that distinction is what was actually broken). Safe
                   to call on every snapshot tick; it's fully idempotent. */
                if (avEl) {
                    if (window.EmpAvatar) {
                        window.EmpAvatar.wire(avEl, g.name || 'Group', g.avatar || window._empGroupIconUri || '', {
                            editable: _canEditInfo(g, myId),
                            onEdit: function () { _openGroupAvatarPicker(groupId, avEl); }
                        });
                    } else {
                        avEl.src = g.avatar || window._empGroupIconUri || '';
                    }
                }

                var allowed = _canMessage(g, myId);
                if (input)   { input.disabled = !allowed; input.placeholder = allowed ? 'Message' : 'Only admins can send messages'; }
                if (sendBtn) { sendBtn.disabled = !allowed; sendBtn.style.opacity = allowed ? '1' : '0.45'; }
                if (micBtn)    { micBtn.disabled = !allowed; micBtn.style.opacity = allowed ? '1' : '0.45'; micBtn.style.pointerEvents = allowed ? '' : 'none'; }
                if (attachBtn) { attachBtn.disabled = !allowed; attachBtn.style.opacity = allowed ? '1' : '0.45'; attachBtn.style.pointerEvents = allowed ? '' : 'none'; }
            }, function () { /* rules deploy may still be pending — leave composer as-is */ });

        /* Detach the live listener when the group view closes */
        var backBtn = view.querySelector('#v13-grp-back');
        if (backBtn && !backBtn._v14Wired) {
            backBtn._v14Wired = true;
            backBtn.addEventListener('click', function () {
                if (_liveGroupUnsub) { try { _liveGroupUnsub(); } catch (e) {} _liveGroupUnsub = null; }
            });
        }
    }


    /* =========================================================================
       §3a  GROUP INVITE LINK SHEET
       ========================================================================= */
    function _openGroupInviteSheet(groupId, groupName) {
        var existing = document.getElementById('v14-invite-sheet');
        if (existing) existing.remove();

        var link = location.origin + location.pathname + '?openGroup=' + groupId;

        var sheet = document.createElement('div');
        sheet.id = 'v14-invite-sheet';
        sheet.style.cssText = 'position:fixed;inset:0;z-index:10000012;background:rgba(0,0,0,0.4);display:flex;align-items:flex-end;';
        sheet.innerHTML =
            '<div style="background:#fff;width:100%;border-radius:14px 14px 0 0;padding:18px 20px 24px;">' +
              '<div style="font-weight:700;font-size:0.98rem;color:#111;margin-bottom:4px;">Invite to ' + _esc(groupName) + '</div>' +
              '<div style="font-size:0.8rem;color:#6B7280;margin-bottom:14px;">Anyone with this link can join the group.</div>' +
              '<input id="v14-invite-link-input" readonly value="' + _esc(link) + '" style="width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:0.82rem;color:#111;background:#F7F7F8;margin-bottom:14px;">' +
              '<div style="display:flex;gap:10px;">' +
                '<button id="v14-invite-copy" style="flex:1;padding:12px;border:none;border-radius:10px;background:#1B2B8B;color:#fff;font-weight:700;font-size:0.88rem;">Copy link</button>' +
                (typeof navigator.share === 'function'
                    ? '<button id="v14-invite-share" style="flex:1;padding:12px;border:1px solid #1B2B8B;border-radius:10px;background:#fff;color:#1B2B8B;font-weight:700;font-size:0.88rem;">Share</button>'
                    : '') +
              '</div>' +
              '<button id="v14-invite-close" style="width:100%;text-align:center;padding:14px 0 0;background:none;border:none;font-size:0.85rem;color:#6B7280;">Close</button>' +
            '</div>';
        document.body.appendChild(sheet);

        var linkInput = sheet.querySelector('#v14-invite-link-input');
        linkInput.addEventListener('click', function () { linkInput.select(); });
        /* Auto-select on open too, so even if every copy mechanism below
           is blocked, a long-press → Copy on the field itself still works. */
        setTimeout(function () { try { linkInput.focus(); linkInput.select(); } catch (e) {} }, 50);

        sheet.addEventListener('click', function (e) { if (e.target === sheet) sheet.remove(); });
        sheet.querySelector('#v14-invite-close').addEventListener('click', function () { sheet.remove(); });

        /* FIX v18 ("Copy button is not working"): the previous version
           relied entirely on navigator.clipboard.writeText, with
           document.execCommand('copy') only as a .catch() fallback and
           the only feedback being a toast via _notify — which is easy to
           miss, and on some in-app/embedded browsers *both* copy
           mechanisms can be silently unavailable (clipboard permission
           denied AND execCommand disabled), which previously looked
           exactly like "nothing happened". The button itself now always
           changes its own label to confirm what happened — success or
           not — instead of depending solely on a toast, and if neither
           mechanism works the text stays selected so a manual long-press
           copy is the obvious next step. */
        var copyBtn = sheet.querySelector('#v14-invite-copy');
        var copyBtnDefaultLabel = copyBtn.textContent;
        function _flashCopyBtn(label, isError) {
            copyBtn.textContent = label;
            copyBtn.style.background = isError ? '#E53935' : '#1B2B8B';
            setTimeout(function () {
                copyBtn.textContent = copyBtnDefaultLabel;
                copyBtn.style.background = '#1B2B8B';
            }, 1800);
        }
        copyBtn.addEventListener('click', function () {
            linkInput.focus();
            linkInput.select();
            try { linkInput.setSelectionRange(0, link.length); } catch (e) {}

            function _execCommandCopy() {
                try { return document.execCommand('copy'); } catch (e) { return false; }
            }

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(link).then(function () {
                    _flashCopyBtn('Copied ✓', false);
                    _notify('Group link copied', 'success');
                }).catch(function () {
                    /* Clipboard API blocked (common without a fresh user
                       gesture, on http-in-webview, or without clipboard
                       permission) — fall back immediately. */
                    if (_execCommandCopy()) {
                        _flashCopyBtn('Copied ✓', false);
                        _notify('Group link copied', 'success');
                    } else {
                        _flashCopyBtn('Long-press to copy', true);
                        _notify('Could not copy automatically — the link is selected, long-press it to copy.', 'warning');
                    }
                });
            } else if (_execCommandCopy()) {
                _flashCopyBtn('Copied ✓', false);
                _notify('Group link copied', 'success');
            } else {
                _flashCopyBtn('Long-press to copy', true);
                _notify('Could not copy automatically — the link is selected, long-press it to copy.', 'warning');
            }
        });

        var shareBtn = sheet.querySelector('#v14-invite-share');
        if (shareBtn) {
            shareBtn.addEventListener('click', function () {
                navigator.share({ title: groupName, text: 'Join ' + groupName + ' on Empyrean', url: link }).catch(function () {});
            });
        }
    }

    /* =========================================================================
       §3  MANAGEMENT PORTAL
       ========================================================================= */
    function _openGroupManagementPortal(groupId) {
        if (!_fbOk()) { _notify('No internet connection', 'warning'); return; }
        var existing = document.getElementById('v14-portal');
        if (existing) existing.remove();

        var panel = document.createElement('div');
        panel.id = 'v14-portal';
        panel.style.cssText = 'position:fixed;inset:0;z-index:10000005;background:#F7F7F8;display:flex;flex-direction:column;overflow-y:auto;';
        panel.innerHTML =
            '<div style="display:flex;align-items:center;gap:12px;padding:14px;background:#1B2B8B;color:#fff;flex-shrink:0;">' +
              '<button id="v14-back" style="background:none;border:none;color:#fff;font-size:1.4rem;cursor:pointer;">&#8592;</button>' +
              '<span style="font-weight:700;">Group info</span>' +
            '</div>' +
            '<div id="v14-body" style="flex:1;">' +
              '<div style="text-align:center;padding:40px;color:#999;">Loading…</div>' +
            '</div>';
        document.body.appendChild(panel);
        panel.querySelector('#v14-back').addEventListener('click', function () { panel.remove(); });

        window.fbDb.collection('groups').doc(groupId).get().then(function (doc) {
            if (!doc.exists) { panel.remove(); _notify('Group not found', 'error'); return; }
            _renderPortalBody(panel, groupId, doc.data());
        }).catch(function (err) {
            _notify('Could not load group info. ' + (err.message || ''), 'error');
        });
    }

    function _renderPortalBody(panel, groupId, g) {
        var myId    = _myId();
        var iAmAdmin = _isAdmin(g, myId);
        var members = g.members || [];
        var admins  = g.admins  || [];
        var perms   = g.permissions || {};
        var body    = panel.querySelector('#v14-body');

        function permRow(label, key) {
            var isAdminOnly = !!perms[key];
            return '<div class="v14-perm-row" data-key="' + key + '" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #eee;">' +
                     '<span style="font-size:0.88rem;color:#111;">' + _esc(label) + '</span>' +
                     '<span class="v14-perm-value" style="font-size:0.82rem;font-weight:700;color:' + (iAmAdmin ? '#1B2B8B' : '#9CA3AF') + ';' + (iAmAdmin ? 'cursor:pointer;' : '') + '">' +
                       (isAdminOnly ? 'Only admins' : 'Everyone') +
                     '</span>' +
                   '</div>';
        }

        var memberRows = members.map(function (uid) {
            var isOwner = uid === g.ownerId;
            var isAdm   = _isAdmin(g, uid);
            return '<div class="v14-member-row" data-uid="' + _esc(uid) + '" style="display:flex;align-items:center;gap:12px;padding:11px 16px;' + (iAmAdmin && uid !== myId ? 'cursor:pointer;' : '') + '">' +
                     '<img class="v14-member-avatar" data-uid="' + _esc(uid) + '" src="' + _esc(_avatarOf(uid)) + '" style="width:42px;height:42px;border-radius:50%;object-fit:cover;flex-shrink:0;cursor:pointer;">' +
                     '<div style="flex:1;min-width:0;">' +
                       '<div style="font-size:0.9rem;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(_nameOf(uid)) + (uid === myId ? ' (You)' : '') + '</div>' +
                       (isOwner ? '<div style="font-size:0.72rem;color:#1B2B8B;font-weight:700;">Creator</div>' :
                        isAdm   ? '<div style="font-size:0.72rem;color:#1B2B8B;">Admin</div>' : '') +
                     '</div>' +
                   '</div>';
        }).join('');

        /* FIX (bug: "premium icons broken" — the Voice chat / Add / Search
           pills and the pencil/link glyphs rendered as empty tofu boxes):
           these were plain Font Awesome <i class="fas fa-..."> glyphs,
           which depend on the FA webfont finishing its own network
           fetch from the CDN (see index.html's <link> to
           cdnjs.cloudflare.com/.../font-awesome/...). On the same
           weak/bouncing mobile connections already documented at length
           elsewhere in this codebase (app-patch-v31.js, app-patch-v35.js),
           that font request can time out or fail independently of the
           app's own JS/CSS, leaving every icon glyph on this screen as a
           blank fallback box even though everything else rendered fine.
           app-patch-v32.js already hit this exact failure mode for the
           live-stream mic/camera/exit icons and fixed it the same way
           this does: replace the webfont glyph with an inline, self-
           contained SVG painted via currentColor — nothing left to fetch
           over the network, so it can never render as an empty box
           again regardless of connection quality. */
        var GROUP_ICONS = {
            voice:  '<path d="M4 12v-1a8 8 0 0 1 16 0v1"/><rect x="2.5" y="12" width="4" height="6" rx="1.6"/><rect x="17.5" y="12" width="4" height="6" rx="1.6"/><path d="M21.5 18v1.2a2.8 2.8 0 0 1-2.8 2.8h-4"/>',
            add:    '<circle cx="9" cy="8" r="3.4"/><path d="M2.7 20c0-3.6 2.8-6 6.3-6s6.3 2.4 6.3 6"/><path d="M18.5 8v5M16 10.5h5"/>',
            search: '<circle cx="10.2" cy="10.2" r="6.6"/><path d="M20 20l-4.9-4.9"/>',
            link:   '<path d="M9.5 14.5l5-5"/><path d="M7.4 12.8l-1.9 1.9a3.2 3.2 0 0 0 4.5 4.5l3-3a3.2 3.2 0 0 0 0-4.5"/><path d="M16.6 11.2l1.9-1.9a3.2 3.2 0 0 0-4.5-4.5l-3 3a3.2 3.2 0 0 0 0 4.5"/>',
            pencil: '<path d="M4 20l.9-3.6L15.4 6a1.8 1.8 0 0 1 2.6 0l.1.1a1.8 1.8 0 0 1 0 2.6L7.6 19.1z"/><path d="M13.6 8l2.5 2.5"/>'
        };
        function _svgIcon(name, size, strokeW) {
            size = size || 18; strokeW = strokeW || 1.9;
            return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
                '" fill="none" stroke="currentColor" stroke-width="' + strokeW +
                '" stroke-linecap="round" stroke-linejoin="round" style="display:block;">' +
                (GROUP_ICONS[name] || GROUP_ICONS.link) + '</svg>';
        }

        function _quickPill(id, iconName, label) {
            return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;" id="' + id + '">' +
                     '<div style="width:46px;height:46px;border-radius:50%;background:rgba(27,43,139,0.07);color:#1B2B8B;display:flex;align-items:center;justify-content:center;">' +
                       _svgIcon(iconName, 20) +
                     '</div>' +
                     '<span style="font-size:0.74rem;color:#374151;font-weight:600;">' + _esc(label) + '</span>' +
                   '</div>';
        }

        /* FIX (bug: "group description isn't implemented" — group info
           screen never had anywhere to show or set an About/description
           text, unlike every other field on this same panel). New field
           on the EXISTING groups/{id} doc: `description` (plain string,
           empty by default). Shown right under the member count, same
           position WhatsApp's own group-info screen uses for its About
           text — tappable to edit under the exact same
           _canEditInfo()/"Edit group info" permission that already gates
           renaming the group two lines below, so it obeys whichever of
           Everyone/Only admins the group has actually chosen, instead of
           adding a second, separate permission concept. */
        var iCanEditInfoForDesc = _canEditInfo(g, myId);
        var descText = (g.description || '').trim();
        var descHtml = descText
            ? '<div id="v14-group-desc" style="font-size:0.84rem;color:#4B5563;margin-top:10px;padding:0 8px;line-height:1.4;white-space:pre-wrap;word-break:break-word;' + (iCanEditInfoForDesc ? 'cursor:pointer;' : '') + '">' + _esc(descText) + '</div>'
            : (iCanEditInfoForDesc
                ? '<div id="v14-group-desc" style="font-size:0.84rem;color:#9CA3AF;margin-top:10px;cursor:pointer;">Add group description</div>'
                : '');

        body.innerHTML =
            '<div style="background:#fff;padding:30px 20px 22px;text-align:center;border-bottom:8px solid #F0F0F0;">' +
              '<div style="width:104px;height:104px;margin:0 auto 14px;border-radius:50%;padding:3.5px;background:linear-gradient(135deg,#D4AF37,#F5E7A3,#D4AF37);box-shadow:0 8px 20px rgba(10,14,39,0.18);">' +
                '<img id="v14-group-avatar-img" src="' + _esc(g.avatar || window._empGroupIconUri || '') + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;border:3px solid #fff;display:block;">' +
              '</div>' +
              '<div id="v14-group-name" style="font-size:1.22rem;font-weight:800;color:#111;' + (iAmAdmin ? 'cursor:pointer;' : '') + '">' + _esc(g.name || 'Group') + (iAmAdmin ? ' <span style="display:inline-flex;vertical-align:middle;margin-left:4px;color:#9CA3AF;">' + _svgIcon('pencil', 13, 2.1) + '</span>' : '') + '</div>' +
              '<div style="font-size:0.84rem;color:#6B7280;margin-top:4px;">Group &middot; <strong style="color:#1B2B8B;">' + members.length + ' member' + (members.length === 1 ? '' : 's') + '</strong></div>' +
              descHtml +
              '<div style="display:flex;margin-top:22px;">' +
                _quickPill('v14-qa-voice', 'voice', 'Voice chat') +
                (_canAddMembers(g, myId) ? _quickPill('v14-qa-add', 'add', 'Add') : '') +
                _quickPill('v14-qa-search', 'search', 'Search') +
              '</div>' +
            '</div>' +

            '<div style="background:#fff;border-bottom:8px solid #F0F0F0;">' +
              '<button id="v14-copy-link" style="width:100%;text-align:left;background:none;border:none;padding:14px 16px;font-size:0.88rem;color:#1B2B8B;cursor:pointer;display:flex;align-items:center;gap:12px;">' +
                '<span style="width:30px;height:30px;border-radius:9px;background:rgba(27,43,139,0.08);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">' + _svgIcon('link', 15, 2) + '</span> Copy group link</button>' +
              '<div style="padding:12px 16px;font-size:0.8rem;color:#6B7280;border-top:1px solid #eee;">' +
                'Created by <strong>' + _esc(_nameOf(g.ownerId)) + '</strong><br>' + _fmtDateTime(g.createdAt) +
              '</div>' +
            '</div>' +

            '<div style="background:#fff;border-bottom:8px solid #F0F0F0;">' +
              '<div style="padding:10px 16px 4px;font-size:0.75rem;font-weight:700;color:#6B7280;text-transform:uppercase;">Permissions</div>' +
              permRow('Send messages', 'onlyAdminsCanMessage') +
              permRow('Add members', 'onlyAdminsCanAddMembers') +
              permRow('Edit group info', 'onlyAdminsCanEditInfo') +
              (iAmAdmin ? '' : '<div style="padding:8px 16px;font-size:0.72rem;color:#9CA3AF;">Only admins can change these.</div>') +
            '</div>' +

            '<div style="background:#fff;">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px 4px;">' +
                '<span style="font-size:0.75rem;font-weight:700;color:#6B7280;text-transform:uppercase;">' + members.length + ' Members</span>' +
                (_canAddMembers(g, myId) ? '<button id="v14-add-members" style="background:none;border:none;color:#1B2B8B;font-size:0.82rem;font-weight:700;cursor:pointer;">+ Add</button>' : '') +
              '</div>' +
              memberRows +
            '</div>' +

            '<div style="padding:24px 16px;display:flex;flex-direction:column;gap:10px;">' +
              '<button id="v14-exit-group" style="padding:13px;border:1px solid #E53935;border-radius:10px;background:#fff;color:#E53935;font-weight:700;font-size:0.9rem;">Exit group</button>' +
              (myId === g.ownerId ? '<button id="v14-delete-group" style="padding:13px;border:none;border-radius:10px;background:#E53935;color:#fff;font-weight:700;font-size:0.9rem;">Delete group</button>' : '') +
            '</div>';

        /* ── Quick action pills ──
           Voice chat reuses the exact same window._empGroupCallStart the
           chat header's own call button uses (app-patch-group-call.js) —
           no new calling logic. Add reuses the existing add-members
           picker below. Search is new but intentionally minimal: prompts
           for a keyword and outlines matching bubbles already rendered in
           the open group chat, the same lightweight pattern
           app-patch-openchat.js already uses for 1:1 chat search. */
        var voicePill = body.querySelector('#v14-qa-voice');
        if (voicePill) voicePill.addEventListener('click', function () {
            if (typeof window._empGroupCallStart === 'function') window._empGroupCallStart(groupId, 'voice');
            else _notify('Voice calling isn\'t available right now.', 'warning');
        });
        var searchPill = body.querySelector('#v14-qa-search');
        if (searchPill) searchPill.addEventListener('click', function () {
            var kw = prompt('Search messages in this group:');
            if (!kw) return;
            var msgBody = document.getElementById('v13-grp-body');
            if (!msgBody) { _notify('Open the group chat first, then search.', 'info'); return; }
            var lkw = kw.toLowerCase();
            var hit = null;
            msgBody.querySelectorAll('.v13-grp-msg-text').forEach(function (textEl) {
                var row = textEl.closest('[data-msg-id]') || textEl.parentElement;
                var match = textEl.textContent.toLowerCase().indexOf(lkw) !== -1;
                if (row) row.style.outline = match ? '2px solid #1B2B8B' : '';
                if (match && !hit) hit = row;
            });
            panel.remove();
            if (hit && hit.scrollIntoView) hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });

        /* ── Group invite link ──
           FIX v17 (spec item: "group link doesn't generate a link yet"):
           the old handler only ever did a *silent* clipboard write —
           nothing was ever shown on screen, so if navigator.clipboard
           was blocked (common on http origins, embedded webviews, or
           when the tab isn't focused, all of which throw
           NotAllowedError) the fallback was a plain OS prompt() that's
           easy to miss, and even on success there was nothing to look
           at except a toast — no confirmation the link actually exists
           or a way to grab it again without re-clicking. This now opens
           a small sheet that always renders the real link as visible,
           selectable text, with an explicit Copy button (and a native
           Share button where supported) — so "generate the link" has a
           result you can actually see, independent of whether the
           clipboard API cooperates. */
        body.querySelector('#v14-copy-link').addEventListener('click', function () {
            _openGroupInviteSheet(groupId, g.name || 'Group');
        });

        var iCanEditInfo = _canEditInfo(g, myId);

        /* ── Rename group (gated by onlyAdminsCanEditInfo — respects the
           "Edit group info: Everyone" permission toggle, not admin-only) ── */
        if (iCanEditInfo) {
            body.querySelector('#v14-group-name').addEventListener('click', function () {
                var newName = prompt('Group name', g.name || '');
                if (!newName || !newName.trim() || newName.trim() === g.name) return;
                window.fbDb.collection('groups').doc(groupId).update({ name: newName.trim() })
                    .then(function () { _notify('Group renamed', 'success'); _openGroupManagementPortal(groupId); })
                    .catch(function (err) { _notify('Could not rename group. ' + (err.message || ''), 'error'); });
            });
            var descEl = body.querySelector('#v14-group-desc');
            if (descEl) descEl.addEventListener('click', function () {
                var newDesc = prompt('Group description', g.description || '');
                if (newDesc === null) return; // cancelled
                newDesc = newDesc.trim();
                if (newDesc === (g.description || '').trim()) return;
                window.fbDb.collection('groups').doc(groupId).update({ description: newDesc })
                    .then(function () { _notify('Group description updated', 'success'); _openGroupManagementPortal(groupId); })
                    .catch(function (err) { _notify('Could not update description. ' + (err.message || ''), 'error'); });
            });
        }

        /* ── Group Chat Avatar Frame (spec item 4): FIX v18 — this used to
           attach its click listener directly to the <img>, which is
           display:none whenever there's no photo yet (the exact case
           someone taps this to fix). It also relied on a separate badge
           element that the raw HTML template only rendered for a literal
           admin, ignoring the "Edit group info: Everyone" setting. Both
           symptoms are now handled in one place — see the FIX v18 note in
           app-patch-v15.js — by letting EmpAvatar.wire() own the whole
           editable affordance (frame is the tap target, badge is its own
           concern, both driven by the same `editable` flag every time). ── */
        var portalAvatarImg = body.querySelector('#v14-group-avatar-img');
        if (portalAvatarImg && window.EmpAvatar) {
            window.EmpAvatar.wire(portalAvatarImg, g.name || 'Group', g.avatar || window._empGroupIconUri || '', {
                editable: iCanEditInfo,
                onEdit: function () { _openGroupAvatarPicker(groupId, portalAvatarImg); }
            });
        }

        /* ── Permission toggles (admins only) ── */
        if (iAmAdmin) {
            body.querySelectorAll('.v14-perm-row').forEach(function (row) {
                row.querySelector('.v14-perm-value').addEventListener('click', function () {
                    var key = row.dataset.key;
                    var newVal = !perms[key];
                    var update = {};
                    update['permissions.' + key] = newVal;
                    window.fbDb.collection('groups').doc(groupId).update(update)
                        .then(function () { _openGroupManagementPortal(groupId); })
                        .catch(function (err) { _notify('Could not update permission. ' + (err.message || ''), 'error'); });
                });
            });
        }

        /* ── Add members ── */
        var addBtn = body.querySelector('#v14-add-members');
        var addPill = body.querySelector('#v14-qa-add');
        if (addBtn) addBtn.addEventListener('click', function () { _openAddMembersPicker(groupId, members); });
        if (addPill) addPill.addEventListener('click', function () { _openAddMembersPicker(groupId, members); });

        /* ── Member row tap → make/dismiss admin, remove ── */
        if (iAmAdmin) {
            body.querySelectorAll('.v14-member-row').forEach(function (row) {
                var uid = row.dataset.uid;
                if (uid === myId) return; /* can't manage yourself */
                row.addEventListener('click', function () { _openMemberActionSheet(groupId, uid, g); });
            });
        }

        /* ── Avatar tap → brief bio preview (feature request: "clicking
           members avatar frame should display a preview of their brief
           Bio data like it's in the one on one chat"). Wired on the
           avatar specifically (not the whole row) and every member
           (not just the ones an admin can manage), so it works the same
           way for admins and regular members alike, and doesn't collide
           with the admin-only "tap row → make/remove admin" action sheet
           wired just above — stopPropagation keeps a tap on the avatar
           from also bubbling up into that row-level listener. See
           _openMemberBioPreview() below. ── */
        body.querySelectorAll('.v14-member-avatar').forEach(function (img) {
            img.addEventListener('click', function (e) {
                e.stopPropagation();
                _openMemberBioPreview(img.dataset.uid);
            });
        });

        /* ── Exit group ── */
        body.querySelector('#v14-exit-group').addEventListener('click', function () {
            if (!confirm('Exit this group? You will stop receiving its messages.')) return;
            var updates = { members: firebase.firestore.FieldValue.arrayRemove(myId) };
            if (admins.indexOf(myId) !== -1) updates.admins = firebase.firestore.FieldValue.arrayRemove(myId);
            window.fbDb.collection('groups').doc(groupId).update(updates)
                .then(function () {
                    panel.remove();
                    var groupView = document.getElementById('v13-group-view');
                    if (groupView) groupView.remove();
                    _notify('You left the group', 'info');
                    _renderGroupsInContactList();
                })
                .catch(function (err) { _notify('Could not exit group. ' + (err.message || ''), 'error'); });
        });

        /* ── Delete group (owner only) ──
           BUG FIX: this used to be a single fbDb.collection('groups').doc(
           groupId).delete() behind a plain confirm(). That only ever
           removed the group's own doc — Firestore never cascade-deletes
           subcollections on its own, so groups/{groupId}/messages (every
           message ever sent) and, if the group had ever used the group
           call feature, group_calls/{groupId} + its peers/signals/
           candidates subcollections (app-patch-group-call.js) were left
           behind permanently as orphaned data no UI could ever reach
           again. "Members" were already effectively removed (they live
           in the members:[] array on the group doc itself, so they went
           away with that doc) — it was specifically the message history
           and call-signaling data that survived. Now routed through
           _openDeleteGroupConfirm()/_cascadeDeleteGroup() below, which
           (a) requires typing the exact group name before the button
           even enables, so a mis-tap can't nuke a group by accident, and
           (b) actually sweeps every known subcollection before removing
           the group doc itself, and (c) records the deletion into the
           existing Admin Panel audit log (window.logAdminAction, already
           defined in app-live.js and already rendered by the Admin
           Panel's own Audit Log tab) so there's a record of who deleted
           what and when. */
        var delBtn = body.querySelector('#v14-delete-group');
        if (delBtn) {
            delBtn.addEventListener('click', function () {
                _openDeleteGroupConfirm(groupId, g, members, panel);
            });
        }
    }

    /* =========================================================================
       §2b  GROUP DELETION — typed confirmation + cascading cleanup + audit log
       ========================================================================= */

    /* Deletes every doc directly inside collRef, paginated so this stays
       correct (not just "works on small test groups") for a group with a
       long message history: reads at most BATCH docs at a time, deletes
       them, and repeats until the collection is empty, rather than
       pulling the whole history into memory in one .get(). */
    function _deleteCollectionBatched(collRef) {
        var BATCH = 400; // Firestore's hard cap on ops per batch write
        function _step() {
            return collRef.limit(BATCH).get().then(function (snap) {
                if (snap.empty) return;
                var batch = window.fbDb.batch();
                snap.forEach(function (doc) { batch.delete(doc.ref); });
                return batch.commit().then(_step);
            });
        }
        return _step();
    }

    /* Sweeps every piece of Firestore data tied to a group before removing
       the group doc itself — order matters here: subcollections have to
       be gone (or at least in flight) before the parent doc disappears,
       otherwise a slow/failed sweep leaves data an outside observer can
       no longer even find a path to. group_calls cleanup is wrapped in
       its own .catch() since a group that never used the call feature
       simply has nothing there, and that's not a failure condition. */
    function _cascadeDeleteGroup(groupId) {
        var groupRef = window.fbDb.collection('groups').doc(groupId);
        var callRef  = window.fbDb.collection('group_calls').doc(groupId);

        var messagesDone = _deleteCollectionBatched(groupRef.collection('messages'));

        var callCleanupDone = callRef.collection('signals').get().then(function (sigSnap) {
            var candidateSweeps = [];
            sigSnap.forEach(function (sigDoc) {
                candidateSweeps.push(_deleteCollectionBatched(sigDoc.ref.collection('candidates')));
            });
            return Promise.all(candidateSweeps);
        }).then(function () {
            return Promise.all([
                _deleteCollectionBatched(callRef.collection('signals')),
                _deleteCollectionBatched(callRef.collection('peers'))
            ]);
        }).then(function () {
            return callRef.delete();
        }).catch(function () { /* no group call ever happened for this group — nothing to clean up, not an error */ });

        return Promise.all([messagesDone, callCleanupDone]).then(function () {
            return groupRef.delete();
        });
    }

    function _openDeleteGroupConfirm(groupId, g, members, portalPanel) {
        var existing = document.getElementById('v14-delete-confirm-sheet');
        if (existing) existing.remove();

        var groupName = g.name || 'this group';
        var memberCount = (members || []).length;

        var sheet = document.createElement('div');
        sheet.id = 'v14-delete-confirm-sheet';
        sheet.style.cssText = 'position:fixed;inset:0;z-index:10000012;background:rgba(0,0,0,0.45);display:flex;align-items:flex-end;';
        sheet.innerHTML =
            '<div style="background:#fff;width:100%;border-radius:14px 14px 0 0;padding:20px;box-sizing:border-box;">' +
              '<div style="font-weight:800;font-size:1rem;color:#111;margin-bottom:6px;"><i class="fas fa-exclamation-triangle" style="color:#E53935;margin-right:6px;"></i>Delete "' + _esc(groupName) + '"?</div>' +
              '<div style="font-size:0.85rem;color:#6B7280;line-height:1.5;margin-bottom:14px;">' +
                'This permanently deletes the group, every message in it, and removes all ' + memberCount + ' member' + (memberCount === 1 ? '' : 's') + '. This cannot be undone.' +
              '</div>' +
              '<label style="font-size:0.78rem;color:#374151;font-weight:600;display:block;margin-bottom:6px;">Type <strong>' + _esc(groupName) + '</strong> to confirm</label>' +
              '<input id="v14-delete-confirm-input" type="text" autocomplete="off" spellcheck="false" style="width:100%;padding:11px 12px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:0.9rem;margin-bottom:6px;box-sizing:border-box;">' +
              '<div id="v14-delete-confirm-err" style="display:none;color:#E53935;font-size:0.78rem;margin-bottom:10px;"></div>' +
              '<button id="v14-delete-confirm-btn" disabled style="width:100%;padding:13px;border:none;border-radius:10px;background:#F3A0A0;color:#fff;font-weight:700;font-size:0.9rem;margin-bottom:8px;">Delete permanently</button>' +
              '<button id="v14-delete-cancel-btn" style="width:100%;padding:13px;border:none;border-radius:10px;background:none;color:#6B7280;font-weight:600;font-size:0.9rem;">Cancel</button>' +
            '</div>';
        document.body.appendChild(sheet);

        sheet.addEventListener('click', function (e) { if (e.target === sheet) sheet.remove(); });

        var input = sheet.querySelector('#v14-delete-confirm-input');
        var confirmBtn = sheet.querySelector('#v14-delete-confirm-btn');
        var errBox = sheet.querySelector('#v14-delete-confirm-err');

        input.addEventListener('input', function () {
            var match = input.value.trim() === groupName;
            confirmBtn.disabled = !match;
            confirmBtn.style.background = match ? '#E53935' : '#F3A0A0';
        });

        sheet.querySelector('#v14-delete-cancel-btn').addEventListener('click', function () { sheet.remove(); });

        confirmBtn.addEventListener('click', function () {
            if (confirmBtn.disabled) return;
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Deleting…';
            errBox.style.display = 'none';

            var deleterName = (window.userState && (window.userState.fullName || window.userState.username || window.userState.email)) || 'the creator';

            _cascadeDeleteGroup(groupId)
                .then(function () {
                    if (typeof window.logAdminAction === 'function') {
                        window.logAdminAction(
                            'Group Deleted',
                            groupName,
                            memberCount + ' member(s) removed \u2022 deleted by ' + deleterName + ' \u2022 group ID ' + groupId
                        );
                    }
                    sheet.remove();
                    if (portalPanel) portalPanel.remove();
                    var groupView = document.getElementById('v13-group-view');
                    if (groupView) groupView.remove();
                    _notify('Group deleted', 'success');
                    _renderGroupsInContactList();
                })
                .catch(function (err) {
                    errBox.textContent = 'Could not delete group. ' + (err && err.message ? err.message : 'Please try again.');
                    errBox.style.display = 'block';
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = 'Delete permanently';
                });
        });
    }

    /* Entry points used by app-chat.js's long-press menu on a group row in the chat list. They reuse the exact
       same Firestore operations / confirmation flow as the Group info portal's Exit / Delete buttons above. */
    window._empIsGroupOwner = function (groupId) {
        var g = _v14GroupCache[groupId];
        return !!(g && g.ownerId && (g.ownerId === _myId() || g.ownerId === _us().id));
    };
    window._empExitGroup = function (groupId) {
        if (!_fbOk()) { _notify('Offline — cannot exit the group right now.', 'error'); return; }
        var myId = _myId();
        if (!myId) return;
        if (!confirm('Exit this group? You will stop receiving its messages.')) return;
        var ref = window.fbDb.collection('groups').doc(groupId);
        ref.get().then(function (snap) {
            var g = (snap && snap.exists) ? (snap.data() || {}) : {};
            var updates = { members: firebase.firestore.FieldValue.arrayRemove(myId) };
            if ((g.admins || []).indexOf(myId) !== -1) updates.admins = firebase.firestore.FieldValue.arrayRemove(myId);
            return ref.update(updates);
        }).then(function () {
            var groupView = document.getElementById('v13-group-view');
            if (groupView) groupView.remove();
            _notify('You left the group', 'info');
            _renderGroupsInContactList();
        }).catch(function (err) { _notify('Could not exit group. ' + ((err && err.message) || ''), 'error'); });
    };
    window._empDeleteGroup = function (groupId) {
        if (!_fbOk()) { _notify('Offline — cannot delete the group right now.', 'error'); return; }
        window.fbDb.collection('groups').doc(groupId).get().then(function (snap) {
            if (!snap || !snap.exists) { _notify('This group no longer exists.', 'info'); _renderGroupsInContactList(); return; }
            var g = snap.data() || {};
            if (g.ownerId !== _myId() && g.ownerId !== _us().id) { _notify('Only the group creator can delete this group.', 'warning'); return; }
            _openDeleteGroupConfirm(groupId, g, g.members || [], null);
        }).catch(function (err) { _notify('Could not load the group. ' + ((err && err.message) || ''), 'error'); });
    };

    /* =========================================================================
       §3b  GROUP AVATAR — crop/resize modal + Cloudinary upload
       ========================================================================= */
    function _openAvatarCropModal(file, onConfirm) {
        var existing = document.getElementById('v14-crop-modal');
        if (existing) existing.remove();

        var url = URL.createObjectURL(file);
        var wrap = document.createElement('div');
        wrap.id = 'v14-crop-modal';
        wrap.style.cssText = 'position:fixed;inset:0;z-index:10000020;background:#000;display:flex;flex-direction:column;';
        wrap.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;color:#fff;">' +
              '<button id="v14-crop-cancel" style="background:none;border:none;color:#fff;font-size:0.95rem;">Cancel</button>' +
              '<span style="font-weight:700;">Move and scale</span>' +
              '<button id="v14-crop-save" style="background:none;border:none;color:#4DA8FF;font-weight:700;font-size:0.95rem;">Save</button>' +
            '</div>' +
            '<div id="v14-crop-viewport" style="flex:1;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;">' +
              '<img id="v14-crop-img" src="' + url + '" style="max-width:none;position:absolute;cursor:grab;touch-action:none;">' +
              '<div style="position:absolute;inset:0;pointer-events:none;box-shadow:0 0 0 2000px rgba(0,0,0,0.55);border-radius:50%;width:min(70vw,320px);height:min(70vw,320px);margin:auto;top:0;left:0;right:0;bottom:0;"></div>' +
            '</div>' +
            '<div style="padding:14px 20px 24px;display:flex;align-items:center;gap:10px;">' +
              '<i class="fas fa-image" style="color:#fff;opacity:0.6;font-size:0.8rem;"></i>' +
              '<input id="v14-crop-zoom" type="range" min="100" max="300" value="100" style="flex:1;">' +
              '<i class="fas fa-image" style="color:#fff;font-size:1.1rem;"></i>' +
            '</div>';
        document.body.appendChild(wrap);

        var img = wrap.querySelector('#v14-crop-img');
        var viewport = wrap.querySelector('#v14-crop-viewport');
        var zoomSlider = wrap.querySelector('#v14-crop-zoom');
        var scale = 1, posX = 0, posY = 0, natW = 0, natH = 0;

        function _render() {
            img.style.width = (natW * scale) + 'px';
            img.style.height = (natH * scale) + 'px';
            img.style.left = (viewport.clientWidth / 2 - (natW * scale) / 2 + posX) + 'px';
            img.style.top  = (viewport.clientHeight / 2 - (natH * scale) / 2 + posY) + 'px';
        }
        img.addEventListener('load', function () {
            natW = img.naturalWidth; natH = img.naturalHeight;
            var frame = Math.min(viewport.clientWidth, viewport.clientHeight) * 0.7;
            var fitScale = Math.max(frame / natW, frame / natH);
            scale = fitScale; posX = 0; posY = 0;
            _render();
        });

        /* Drag to reposition */
        var dragging = false, lastX = 0, lastY = 0;
        function _start(e) { dragging = true; var p = e.touches ? e.touches[0] : e; lastX = p.clientX; lastY = p.clientY; img.style.cursor = 'grabbing'; }
        function _move(e) {
            if (!dragging) return;
            var p = e.touches ? e.touches[0] : e;
            posX += p.clientX - lastX; posY += p.clientY - lastY;
            lastX = p.clientX; lastY = p.clientY;
            _render();
        }
        function _end() { dragging = false; img.style.cursor = 'grab'; }
        img.addEventListener('mousedown', _start); img.addEventListener('touchstart', _start, { passive: true });
        document.addEventListener('mousemove', _move); img.addEventListener('touchmove', _move, { passive: true });
        document.addEventListener('mouseup', _end); img.addEventListener('touchend', _end);

        zoomSlider.addEventListener('input', function () {
            var frame = Math.min(viewport.clientWidth, viewport.clientHeight) * 0.7;
            var fitScale = Math.max(frame / natW, frame / natH);
            scale = fitScale * (zoomSlider.value / 100);
            _render();
        });

        function _teardown() { URL.revokeObjectURL(url); wrap.remove(); }
        wrap.querySelector('#v14-crop-cancel').addEventListener('click', _teardown);

        wrap.querySelector('#v14-crop-save').addEventListener('click', function () {
            /* Render the visible circular frame region to a square canvas */
            var frame = Math.min(viewport.clientWidth, viewport.clientHeight) * 0.7;
            var OUT = 512;
            var canvas = document.createElement('canvas');
            canvas.width = OUT; canvas.height = OUT;
            var ctx = canvas.getContext('2d');
            var imgLeft = viewport.clientWidth / 2 - (natW * scale) / 2 + posX;
            var imgTop  = viewport.clientHeight / 2 - (natH * scale) / 2 + posY;
            var frameLeft = viewport.clientWidth / 2 - frame / 2;
            var frameTop  = viewport.clientHeight / 2 - frame / 2;
            var srcX = (frameLeft - imgLeft) / scale;
            var srcY = (frameTop - imgTop) / scale;
            var srcSize = frame / scale;
            ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUT, OUT);
            canvas.toBlob(function (blob) {
                _teardown();
                if (blob) onConfirm(blob);
            }, 'image/jpeg', 0.92);
        });
    }

    /* FIX v16 (upload was only reachable from inside the Group info portal —
       tapping the small header avatar itself did nothing, which read as a
       fixed/uneditable graphic even though it's a real upload target for
       admins). One shared picker so header and portal behave identically. */
    function _openGroupAvatarPicker(groupId, imgEl) {
        var fi = document.createElement('input');
        fi.type = 'file';
        fi.accept = 'image/jpeg,image/png,image/webp';
        fi.style.display = 'none';
        document.body.appendChild(fi);
        fi.addEventListener('change', function () {
            var file = fi.files && fi.files[0];
            fi.remove();
            if (!file) return;
            _openAvatarCropModal(file, function (blob) {
                _uploadGroupAvatar(groupId, blob, imgEl);
            });
        });
        fi.click();
    }

    function _uploadGroupAvatar(groupId, blob, imgEl) {
        /* FIX v15 (Group Chat Avatar Frame — save/error handling hardening):
           - reject obviously-bad input before touching the network
           - remember what was showing so a failed upload/save can revert
             the optimistic preview instead of leaving a stale local blob
             URL that makes it LOOK saved when it wasn't
           - distinguish "upload to Cloudinary failed" from "upload worked
             but the Firestore write failed" so the notification the person
             sees actually matches what happened */
        if (!blob || typeof blob.size !== 'number') { _notify('Could not read that image. Please try another photo.', 'error'); return; }
        var MAX_BYTES = 8 * 1024 * 1024; /* cropped output is already a 512x512 JPEG, this only guards against something unexpected */
        if (blob.size > MAX_BYTES) { _notify('That image is too large. Please choose a smaller photo.', 'error'); return; }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) { _notify('No internet connection — the photo can\'t be saved right now.', 'warning'); return; }

        var previousSrc = imgEl ? (imgEl.getAttribute('src') || '') : '';
        var localUrl;
        try { localUrl = URL.createObjectURL(blob); }
        catch (e) { _notify('Could not process that image. Please try another photo.', 'error'); return; }

        if (imgEl) { imgEl.src = localUrl; imgEl.style.display = 'block'; } /* optimistic preview */
        _notify('Uploading group photo…', 'info');

        function _revertPreview() {
            if (!imgEl) return;
            if (previousSrc) { imgEl.src = previousSrc; imgEl.style.display = 'block'; }
            else { imgEl.removeAttribute('src'); imgEl.style.display = 'none'; } /* falls back to the initials frame behind it */
        }

        var cfg = (window._appConfig && window._appConfig.cloudinary) || {};
        var cloud  = cfg.cloud || cfg.cloudName || 'dxwmts9vw';
        var preset = cfg.preset || cfg.uploadPreset || 'ehfapp_preset';

        /* FIX v16 (root cause of "picks/crops the photo fine, then never
           saves"): window.uploadToCloudinary (app-dom.js) strictly requires
           `file instanceof File` and rejects immediately — before any
           network request — for anything else, including a plain Blob.
           _openAvatarCropModal's canvas.toBlob(...) hands this function a
           raw Blob, not a File, so every group-avatar upload was rejecting
           synchronously on the type check, hitting the .catch() below,
           and reverting the optimistic preview. Nothing was ever sent to
           Cloudinary. Wrapping it in a File (same trick already used for
           voice notes elsewhere in the app) satisfies that check. */
        var uploadBlob = (typeof File === 'function' && !(blob instanceof File))
            ? new File([blob], 'group-avatar-' + Date.now() + '.jpg', { type: blob.type || 'image/jpeg' })
            : blob;

        if (typeof window.uploadToCloudinary === 'function') {
            window.uploadToCloudinary(uploadBlob).then(function (url) {
                if (!url) throw new Error('empty url');
                _finishGroupAvatarUpload(groupId, url, _revertPreview);
            }).catch(function () {
                _revertPreview();
                _notify('Group photo upload failed. Please check your connection and try again.', 'error');
            });
            return;
        }

        var fd = new FormData();
        fd.append('file', blob);
        fd.append('upload_preset', preset);
        fetch('https://api.cloudinary.com/v1_1/' + cloud + '/image/upload', { method: 'POST', body: fd })
            .then(function (r) { if (!r.ok) throw new Error('upload http ' + r.status); return r.json(); })
            .then(function (d) {
                var url = d.secure_url || d.url || '';
                if (!url) throw new Error('no url');
                _finishGroupAvatarUpload(groupId, url, _revertPreview);
            })
            .catch(function () {
                _revertPreview();
                _notify('Group photo upload failed. Please check your connection and try again.', 'error');
            });
    }

    function _finishGroupAvatarUpload(groupId, url, onSaveFail) {
        window.fbDb.collection('groups').doc(groupId).update({ avatar: url })
            .then(function () { _notify('Group photo updated', 'success'); })
            .catch(function (err) {
                if (typeof onSaveFail === 'function') onSaveFail();
                /* FIX v16: permission-denied is a distinct, actionable case
                   (you're not admin/owner on this doc, or the /groups
                   security rules haven't been deployed yet) — worth telling
                   apart from a generic network/save failure. */
                _notify(err && err.code === 'permission-denied'
                    ? 'Photo uploaded but could not be saved — you may not be an admin of this group, or the group\'s security rules need deploying.'
                    : 'Photo uploaded but could not be saved to the group. ' + (err.message || ''), 'error');
            });
    }

    /* ── Avatar tap → brief bio preview sheet ──
       FEATURE (spec item: "clicking members avatar frame should display
       a preview of their brief Bio data like it's in the one on one
       chat"): app-chat.js's inbox avatar tap already opens a bottom-sheet
       bio preview (_openAvatarPreviewSheet, see app-patch-openchat.js's
       own comments on window._ocOpenFullProfile/_ocGoToUserProfile,
       which that sheet's "View full profile" link calls through to).
       That function is private to app-chat.js's own closure and not
       exposed on window, so it can't be called directly from here
       without editing that file (the same closure-privacy constraint
       this codebase's other patches have run into repeatedly — see
       app-patch-v33.js's header) — reimplementing a lightweight
       equivalent here, using the exact same users/{uid} fields
       (bio/username/isVerified) _openProfileModal already reads, keeps
       the data and visual language identical without needing that edit.
       Shows instantly with whatever's already known locally
       (_avatarOf/_nameOf, already resolved for the member list), then
       fills in bio/verified/username once the Firestore read lands, so
       there's no blank flash while waiting on the network. */
    function _openMemberBioPreview(uid) {
        if (!uid) return;
        var existing = document.getElementById('v14-bio-preview-sheet');
        if (existing) existing.remove();

        var myId = _myId();
        var isSelf = uid === myId;

        var sheet = document.createElement('div');
        sheet.id = 'v14-bio-preview-sheet';
        sheet.style.cssText = 'position:fixed;inset:0;z-index:10000013;background:rgba(0,0,0,0.4);display:flex;align-items:flex-end;';
        sheet.innerHTML =
            '<div style="background:#fff;width:100%;border-radius:16px 16px 0 0;padding:22px 20px 26px;max-height:80vh;overflow-y:auto;">' +
              '<div style="display:flex;align-items:center;gap:14px;">' +
                '<img src="' + _esc(_avatarOf(uid)) + '" style="width:60px;height:60px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid #F0F0F0;">' +
                '<div style="flex:1;min-width:0;">' +
                  '<div id="v14-bio-name" style="font-size:1.05rem;font-weight:800;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px;">' + _esc(_nameOf(uid)) + (isSelf ? ' (You)' : '') + '</div>' +
                  '<div id="v14-bio-username" style="font-size:0.82rem;color:#6B7280;margin-top:2px;"></div>' +
                '</div>' +
              '</div>' +
              '<div id="v14-bio-text" style="display:none;margin-top:16px;font-size:0.88rem;line-height:1.5;color:#374151;background:#F7F7F8;border-radius:12px;padding:12px 14px;"></div>' +
              '<div style="display:flex;gap:10px;margin-top:20px;">' +
                (isSelf ? '' : '<button id="v14-bio-message" style="flex:1;padding:12px;border:none;border-radius:10px;background:#1B2B8B;color:#fff;font-weight:700;font-size:0.88rem;">Message</button>') +
                '<button id="v14-bio-full-profile" style="flex:1;padding:12px;border:1px solid #1B2B8B;border-radius:10px;background:#fff;color:#1B2B8B;font-weight:700;font-size:0.88rem;">View full profile</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(sheet);

        sheet.addEventListener('click', function (e) { if (e.target === sheet) sheet.remove(); });

        /* FIX: the bio sheet sits ON TOP of the Group info portal
           (#v14-portal, z-index 10000005 — see _openGroupManagementPortal
           above), but only the sheet itself was ever removed on tap.
           #chat-view-container tops out at z-index 99999 and the full
           "Contact info" panel (_openProfileModal) tops out at z-index
           9999999 — BOTH are lower than 10000005, so whichever one opened
           was rendering directly UNDERNEATH the still-present Group info
           portal. Visually that's indistinguishable from "nothing
           happened, still looking at the members list," which is exactly
           what was reported. Closing the portal here (it's fine to close
           — it's just a list view, nothing being edited/lost) is what
           actually surfaces the chat / profile panel. */
        function _closeGroupOverlays() {
            /* Close the Group info portal (as before). */
            var portal = document.getElementById('v14-portal');
            if (portal) portal.remove();

            /* FIX: ALSO close the actual group CHAT view (#v13-group-view,
               app-patch-v13.js) if the bio sheet was opened from a group
               that's currently open behind the portal. That view sits at
               z-index 9999990 — higher than #chat-view-container's 99999,
               the overlay openChat() below uses for the 1-1 DM — so with
               it left open, the 1-1 chat was rendering UNDERNEATH it,
               which is exactly why "Message" still looked like it stayed
               on the group conversation instead of switching to the
               individual's inbox. Trigger its own back button rather than
               just removing the node, so its listeners (call-status, live
               group doc, voice recorder) tear down the same way a real
               tap on that button would. */
            var grpBackBtn = document.getElementById('v13-grp-back');
            if (grpBackBtn) grpBackBtn.click();
            else { var grpView = document.getElementById('v13-group-view'); if (grpView) grpView.remove(); }

            /* This file's OWN live group-doc listener (see _wireGroupChrome
               above) is a second, separate subscription on top of v13's —
               v13's back button doesn't know about it, so it's detached
               here explicitly. */
            if (_liveGroupUnsub) { try { _liveGroupUnsub(); } catch (e) {} _liveGroupUnsub = null; }
        }

        var msgBtn = sheet.querySelector('#v14-bio-message');
        if (msgBtn) msgBtn.addEventListener('click', function () {
            sheet.remove();
            if (typeof window.openChat !== 'function') { _notify('Messaging isn\u2019t available right now.', 'warning'); return; }
            _closeGroupOverlays();
            /* Land the user in the Inbox itself (not just an overlay on top
               of whichever section — e.g. Groups — the sheet was opened
               from), so backing out of the chat returns them to the Inbox
               list, same convention this file already uses for
               ?openGroup deep links (see _enterChat() above). The short
               delay lets the Messages section finish mounting first,
               matching _enterChat()'s own timing. */
            if (typeof window.navigateTo === 'function') window.navigateTo('messages');
            setTimeout(function () { window.openChat(uid, _nameOf(uid)); }, 250);
        });

        sheet.querySelector('#v14-bio-full-profile').addEventListener('click', function () {
            sheet.remove();
            _closeGroupOverlays();
            if (typeof window._ocOpenFullProfile === 'function') window._ocOpenFullProfile(uid, _nameOf(uid), _avatarOf(uid));
            else if (typeof window._ocGoToUserProfile === 'function') window._ocGoToUserProfile(uid);
            else _notify('Profile view isn\u2019t available right now.', 'warning');
        });

        /* Fill in username/bio/verified from Firestore once it lands --
           instant name/avatar above already came from the member list's
           own local lookups, so there's nothing to wait on for those. */
        if (_fbOk()) {
            window.fbDb.collection('users').doc(uid).get().then(function (doc) {
                if (!doc.exists || !document.getElementById('v14-bio-preview-sheet')) return;
                var d = doc.data() || {};

                var nameEl = document.getElementById('v14-bio-name');
                if (nameEl && d.isVerified) {
                    nameEl.innerHTML = _esc(d.fullName || _nameOf(uid)) + (isSelf ? ' (You)' : '') +
                        ' <i class="fas fa-circle-check" style="color:#D4AF37;font-size:0.82rem;" title="Verified"></i>';
                }
                var unEl = document.getElementById('v14-bio-username');
                if (unEl && d.username) unEl.textContent = '@' + d.username;

                if (d.bio) {
                    var bioEl = document.getElementById('v14-bio-text');
                    if (bioEl) { bioEl.style.display = 'block'; bioEl.textContent = d.bio; }
                }
            }).catch(function () { /* sheet already shows name/avatar -- bio/username are a nice-to-have, not worth an error toast */ });
        }
    }

    /* ── Member action sheet: make/dismiss admin, remove from group ── */
    function _openMemberActionSheet(groupId, uid, g) {
        var existing = document.getElementById('v14-action-sheet');
        if (existing) existing.remove();

        var isAdm = _isAdmin(g, uid);
        var sheet = document.createElement('div');
        sheet.id = 'v14-action-sheet';
        sheet.style.cssText = 'position:fixed;inset:0;z-index:10000010;background:rgba(0,0,0,0.4);display:flex;align-items:flex-end;';
        sheet.innerHTML =
            '<div style="background:#fff;width:100%;border-radius:14px 14px 0 0;padding:8px 0 20px;">' +
              '<div style="text-align:center;padding:10px;font-size:0.85rem;color:#6B7280;">' + _esc(_nameOf(uid)) + '</div>' +
              '<button id="v14-toggle-admin" style="width:100%;text-align:left;padding:14px 20px;background:none;border:none;font-size:0.92rem;color:#111;">' +
                (isAdm ? 'Dismiss as admin' : 'Make group admin') + '</button>' +
              '<button id="v14-remove-member" style="width:100%;text-align:left;padding:14px 20px;background:none;border:none;font-size:0.92rem;color:#E53935;">Remove from group</button>' +
              '<button id="v14-cancel-sheet" style="width:100%;text-align:left;padding:14px 20px;background:none;border:none;font-size:0.92rem;color:#6B7280;">Cancel</button>' +
            '</div>';
        document.body.appendChild(sheet);

        sheet.addEventListener('click', function (e) { if (e.target === sheet) sheet.remove(); });
        sheet.querySelector('#v14-cancel-sheet').addEventListener('click', function () { sheet.remove(); });

        sheet.querySelector('#v14-toggle-admin').addEventListener('click', function () {
            sheet.remove();
            var update = { admins: isAdm
                ? firebase.firestore.FieldValue.arrayRemove(uid)
                : firebase.firestore.FieldValue.arrayUnion(uid) };
            window.fbDb.collection('groups').doc(groupId).update(update)
                .then(function () { _notify(isAdm ? 'Admin rights removed' : 'Now a group admin', 'success'); _openGroupManagementPortal(groupId); })
                .catch(function (err) { _notify('Could not update admin status. ' + (err.message || ''), 'error'); });
        });

        sheet.querySelector('#v14-remove-member').addEventListener('click', function () {
            sheet.remove();
            if (!confirm('Remove ' + _nameOf(uid) + ' from the group?')) return;
            window.fbDb.collection('groups').doc(groupId).update({
                members: firebase.firestore.FieldValue.arrayRemove(uid),
                admins:  firebase.firestore.FieldValue.arrayRemove(uid)
            }).then(function () { _notify('Member removed', 'success'); _openGroupManagementPortal(groupId); })
              .catch(function (err) { _notify('Could not remove member. ' + (err.message || ''), 'error'); });
        });
    }

    /* ── Add members picker (excludes existing members) ── */
    function _openAddMembersPicker(groupId, existingMembers) {
        var mu = window.mockUsers || {};
        var myId = _myId();
        var candidates = Object.keys(mu)
            .filter(function (id) { return id && id !== myId && existingMembers.indexOf(id) === -1; })
            .map(function (id) { return { id: id, name: _nameOf(id), avatar: _avatarOf(id) }; });

        var selected = {};
        var panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;inset:0;z-index:10000008;background:#fff;display:flex;flex-direction:column;';
        panel.innerHTML =
            '<div style="display:flex;align-items:center;gap:12px;padding:14px;background:#1B2B8B;color:#fff;flex-shrink:0;">' +
              '<button id="v14-am-back" style="background:none;border:none;color:#fff;font-size:1.4rem;cursor:pointer;">&#8592;</button>' +
              '<span style="font-weight:700;">Add participants</span>' +
            '</div>' +
            '<div id="v14-am-list" style="flex:1;overflow-y:auto;"></div>' +
            '<div style="padding:14px 16px;border-top:1px solid #eee;">' +
              '<button id="v14-am-confirm" disabled style="width:100%;padding:13px;border:none;border-radius:10px;background:#9AA0A6;color:#fff;font-weight:700;">Add</button>' +
            '</div>';
        document.body.appendChild(panel);
        panel.querySelector('#v14-am-back').addEventListener('click', function () { panel.remove(); });

        var list = panel.querySelector('#v14-am-list');
        if (!candidates.length) {
            list.innerHTML = '<div style="text-align:center;color:#999;padding:30px 20px;">Everyone you know is already in this group.</div>';
        }
        candidates.forEach(function (c) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:pointer;border-bottom:1px solid #f5f5f5;';
            row.innerHTML =
                '<img src="' + _esc(c.avatar) + '" style="width:42px;height:42px;border-radius:50%;object-fit:cover;flex-shrink:0;">' +
                '<span style="flex:1;font-size:0.9rem;">' + _esc(c.name) + '</span>' +
                '<span class="v14-am-check" style="width:22px;height:22px;border-radius:50%;border:2px solid #d0d0d0;flex-shrink:0;"></span>';
            row.addEventListener('click', function () {
                var check = row.querySelector('.v14-am-check');
                if (selected[c.id]) {
                    delete selected[c.id];
                    check.style.cssText = 'width:22px;height:22px;border-radius:50%;border:2px solid #d0d0d0;flex-shrink:0;';
                } else {
                    selected[c.id] = true;
                    check.style.cssText = 'width:22px;height:22px;border-radius:50%;background:#1B2B8B;border:2px solid #1B2B8B;flex-shrink:0;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;';
                    check.textContent = '✓';
                }
                var n = Object.keys(selected).length;
                var confirmBtn = panel.querySelector('#v14-am-confirm');
                confirmBtn.disabled = n === 0;
                confirmBtn.style.background = n === 0 ? '#9AA0A6' : '#1B2B8B';
            });
            list.appendChild(row);
        });

        panel.querySelector('#v14-am-confirm').addEventListener('click', function () {
            var ids = Object.keys(selected);
            if (!ids.length) return;
            window.fbDb.collection('groups').doc(groupId).update({
                members: firebase.firestore.FieldValue.arrayUnion.apply(null, ids)
            }).then(function () {
                panel.remove();
                _notify(ids.length + ' member(s) added', 'success');
                _openGroupManagementPortal(groupId);
            }).catch(function (err) {
                _notify('Could not add members. ' + (err.message || ''), 'error');
            });
        });
    }


    /* =========================================================================
       §4  GROUPS IN THE CONTACT LIST
       Before this file, a group only existed while its chat window was
       open — closing it left no way back in. This renders a persistent
       "Groups" section above the 1:1 contact list, live-synced via
       Firestore's array-contains query, so every group you're a member of
       always has an entry to tap back into.
       ========================================================================= */
    var _groupsListUnsub = null;

    var _groupsListUnsub2 = null; // secondary listener — see below
    var _groupsListKey = null, _groupsRepaint = null, _groupsContainerRef = null; // see STABILITY note in _renderGroupsInContactList

    /* Row markup, extracted out of _renderGroupsInContactList's inline
       loop so both the primary and the secondary (legacy-id self-heal)
       listener build identical markup from one place. */
    var _v14GroupCache = {};   /* groupId -> last-seen group data, for the chat-list row menu (app-chat.js) */
    function _v14GroupRowHtml(doc, g) {
        _v14GroupCache[doc.id] = g || {};
        /* UNIFIED ROW: same geometry/typography as the 1:1 `.contact-item`
           rows app-chat.js renders (52px avatar, name line, preview line,
           right-hand time + unread badge) so Chats, Groups and Broadcasts
           read as one list, WhatsApp-style. Deliberately NOT given the
           `.contact-item` class — app-chat.js owns/clears that class and
           routes its click to openChat(userId). The preview, time and
           badge are patched in by _fetchGroupPreview() below.
           FIX v15 (Group Chat Avatar Frame): no remote fallback URL — the
           offline-safe initials frame (wired in below) handles "no photo". */
        var ts = g && g.createdAt ? (new Date(g.createdAt).getTime() || 0) : 0;
        return '<div class="v14-group-item emp-chatrow" data-group-id="' + _esc(doc.id) + '" data-last-ts="' + ts + '" data-unread="0" style="display:flex;align-items:center;gap:12px;padding:12px 16px;min-height:72px;box-sizing:border-box;border-bottom:1px solid #F0F2F7;cursor:pointer;transition:background 0.15s;">' +
                 '<div style="position:relative;flex-shrink:0;">' +
                   '<img class="v14-group-avatar-img" data-gname="' + _esc(g.name || 'Group') + '" data-gavatar="' + _esc(g.avatar || '') + '" src="" style="width:52px;height:52px;border-radius:50%;object-fit:cover;">' +
                 '</div>' +
                 '<div style="flex:1;min-width:0;">' +
                   '<div style="display:flex;align-items:center;margin-bottom:2px;">' +
                     '<strong class="v14-group-name" style="font-size:0.98rem;color:#14213D;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">' + _esc(g.name || 'Group') + '</strong>' +
                   '</div>' +
                   '<div style="display:flex;align-items:center;gap:5px;min-width:0;color:#6B7A94;">' +
                     '<p class="v14-group-preview" style="font-size:0.84rem;color:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;min-width:0;">' + (g.members || []).length + ' participants</p>' +
                   '</div>' +
                 '</div>' +
                 '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;margin-left:6px;min-width:44px;">' +
                   '<span class="v14-group-time" style="font-size:0.7rem;color:#6B7A94;display:none;"></span>' +
                   '<div class="v14-group-badge-slot" style="display:flex;align-items:center;gap:6px;min-height:20px;"></div>' +
                 '</div>' +
               '</div>';
    }

    /* ---- last-message preview / time / unread badge for each group row ----
       Groups carry no lastMessage field, so this reads the newest few
       messages of each group once (cached 20s per group, so the 1.2s
       re-render safety net in app-patch-v20.js can't hammer Firestore) and
       patches the row. Unread = messages from others, not deleted, whose
       readBy doesn't contain me (readBy is arrayUnion'd on open, see
       _wireViewerCount in Part 1). */
    var _grpPreviewCache = {};     /* groupId -> { at, text, ts, unread, hasMsg } */
    var _grpPreviewBusy  = {};     /* groupId -> true while a fetch is in flight */
    var GRP_PREVIEW_TTL  = 20000;
    var GRP_PREVIEW_LIMIT = 15;

    function _grpPreviewText(m) {
        var mt = m.mediaType || '';
        var body = m.text ? m.text
            : mt === 'audio' ? 'Voice note'
            : mt === 'image' ? 'Photo'
            : mt === 'video' ? 'Video'
            : mt === 'document' ? (m.fileName || 'Document')
            : 'Message';
        var mine = (m.senderId === _myId()) || (_us().id && m.senderId === _us().id);
        var who = mine ? 'You' : String(m.senderName || '').trim().split(/\s+/)[0];
        var t = (who ? who + ': ' : '') + body;
        return t.length > 42 ? t.slice(0, 42) + '\u2026' : t;
    }

    function _applyGroupPreview(rowEl, p) {
        if (!rowEl || !p) return;
        var prev = rowEl.querySelector('.v14-group-preview');
        var time = rowEl.querySelector('.v14-group-time');
        var slot = rowEl.querySelector('.v14-group-badge-slot');
        var name = rowEl.querySelector('.v14-group-name');
        if (p.hasMsg && prev) prev.textContent = p.text;
        if (time) {
            var label = p.ts ? (typeof window._chatListTime === 'function' ? window._chatListTime(new Date(p.ts).toISOString()) : '') : '';
            time.textContent = label || '';
            time.style.display = label ? '' : 'none';
            time.style.color = p.unread > 0 ? '#2E93E0' : '#6B7A94';
            time.style.fontWeight = p.unread > 0 ? '700' : '400';
        }
        if (p.ts) rowEl.dataset.lastTs = String(p.ts);
        if (window._empApplyRowOrder) window._empApplyRowOrder(rowEl);
        rowEl.dataset.unread = String(p.unread || 0);
        if (name) name.style.fontWeight = p.unread > 0 ? '800' : '600';
        if (prev) { prev.style.fontWeight = p.unread > 0 ? '600' : '400'; prev.style.color = p.unread > 0 ? '#0A0E27' : 'inherit'; }
        if (slot) {
            slot.innerHTML = p.unread > 0
                ? '<span style="background:#2E93E0;color:#fff;font-size:0.68rem;font-weight:700;min-width:20px;height:20px;border-radius:10px;display:flex;align-items:center;justify-content:center;padding:0 6px;box-sizing:border-box;">' + (p.unread >= GRP_PREVIEW_LIMIT ? GRP_PREVIEW_LIMIT + '+' : p.unread) + '</span>'
                : '';
        }
        rowEl.style.background = p.unread > 0 ? '#F7FAFF' : '';
    }

    function _fetchGroupPreview(groupId, rowEl, force) {
        var c = _grpPreviewCache[groupId];
        if (c) _applyGroupPreview(rowEl, c);          /* instant paint from cache */
        if (!_fbOk() || !(window.fbAuth && window.fbAuth.currentUser)) return;
        if (_grpPreviewBusy[groupId]) return;
        if (c && !force && (Date.now() - c.at) < GRP_PREVIEW_TTL) return;
        _grpPreviewBusy[groupId] = true;
        var me = _myId(), alt = _us().id;
        window.fbDb.collection('groups').doc(groupId).collection('messages')
            .orderBy('createdAt', 'desc').limit(GRP_PREVIEW_LIMIT).get()
            .then(function (snap) {
                var p = { at: Date.now(), text: '', ts: 0, unread: 0, hasMsg: false };
                snap.docs.forEach(function (d) {
                    var m = d.data() || {};
                    if (m.deleted === true) return;
                    if (!p.hasMsg) {
                        p.hasMsg = true;
                        p.text = _grpPreviewText(m);
                        p.ts = new Date(m.createdAt).getTime() || 0;
                    }
                    var mine = (m.senderId === me) || (alt && m.senderId === alt);
                    var readBy = Array.isArray(m.readBy) ? m.readBy : [];
                    if (!mine && readBy.indexOf(me) === -1 && !(alt && readBy.indexOf(alt) !== -1)) p.unread++;
                });
                _grpPreviewCache[groupId] = p;
                /* re-find the row: the section is rebuilt on every groups snapshot */
                var live = document.querySelector('.v14-group-item[data-group-id="' + groupId + '"]');
                _applyGroupPreview(live || rowEl, p);
            })
            .catch(function () {})
            .then(function () { delete _grpPreviewBusy[groupId]; });
    }

    window._empRefreshGroupRows = function (force) {
        var rows = document.querySelectorAll('.v14-group-item');
        for (var i = 0; i < rows.length; i++) _fetchGroupPreview(rows[i].dataset.groupId, rows[i], !!force);
    };

    function _renderGroupsInContactList() {
        // FIX (2026-08-13 — "[v14] Groups list listener error: Missing or
        // insufficient permissions"): _fbOk() only confirmed Firestore
        // itself was initialized, not that a real Firebase Auth session
        // (anonymous or signed-in) existed yet — /groups requires
        // request.auth != null (firebase-rules.js). This function is
        // re-invoked on every render pass alongside renderContactList()
        // (see the wiring below this one), so simply requiring
        // fbAuth.currentUser here means it quietly waits for the next
        // pass once that session settles, instead of attaching a doomed
        // listener every time it's called before then.
        if (!_fbOk() || !(window.fbAuth && window.fbAuth.currentUser)) return;
        var myId = _myId();
        if (!myId) return;

        var container = document.getElementById('contacts-inner') || document.getElementById('contact-list-container');
        if (!container) return;

        /* STABILITY: window.renderContactList() is called from 8+ places (several on timers), and every call used
           to tear this listener down and open a brand-new one, so on a slow connection the first server snapshot
           never had time to arrive and the Groups list stayed blank/flickering. Now the listeners are kept for as
           long as the account is unchanged; a repeat call only repaints from the docs already received. */
        var _gKey = myId + '|' + ((_us().id && _us().id !== myId) ? _us().id : '');
        if (_groupsListUnsub && _groupsListKey === _gKey && typeof _groupsRepaint === 'function') {
            _groupsContainerRef = container;
            _groupsRepaint();
            return;
        }
        if (_groupsListUnsub) { try { _groupsListUnsub(); } catch (e) {} _groupsListUnsub = null; }
        if (_groupsListUnsub2) { try { _groupsListUnsub2(); } catch (e) {} _groupsListUnsub2 = null; }
        _groupsListKey = _gKey;
        _groupsContainerRef = container;

        /* FIX (bug: "added members can't see the group chat"): a device
           that was anonymous at some point in the past (before the
           _authUid() fix above) may have been added to a group using
           its real profile id, while ALSO — depending on exactly when
           it created its OWN groups — some existing docs could in
           theory carry the anonymous id instead. Rather than require a
           manual Firestore data migration for whatever's already out
           there, this runs a SECOND array-contains listener keyed off
           window.userState.id whenever it differs from the primary
           _myId() value, and merges both result sets by doc id before
           rendering — so already-mis-added groups self-heal the next
           time this renders, on top of the root-cause fix above
           preventing any NEW mismatch from happening. */
        var altId = (_us().id && _us().id !== myId) ? _us().id : null;
        var _groupDocs = {}; // doc.id -> data, merged across both listeners

        function _renderMerged() {
            var container = _groupsContainerRef || document.getElementById('contacts-inner') || document.getElementById('contact-list-container');
            if (!container) return;
            var section = document.getElementById('v14-groups-section');
            if (section) section.remove();
            Array.prototype.forEach.call(container.querySelectorAll(':scope > .v14-group-item'), function (r) { r.remove(); }); /* rows hoisted by app-patch-v20.js _enforceTimeOrder */

            var ids = Object.keys(_groupDocs);
            if (!ids.length) return;

            section = document.createElement('div');
            section.id = 'v14-groups-section';

            var rows = '';
            ids.forEach(function (docId) {
                var g = _groupDocs[docId];
                var doc = { id: docId };
                rows += _v14GroupRowHtml(doc, g);
            });

            section.innerHTML = rows;
            container.insertBefore(section, container.firstChild);

            section.querySelectorAll('.v14-group-item').forEach(function (item) {
                item.addEventListener('click', function () { window.openGroupChat(item.dataset.groupId); });
                if (window._empApplyRowOrder) window._empApplyRowOrder(item);
                _fetchGroupPreview(item.dataset.groupId, item, false);
            });
            if (window.EmpAvatar) {
                section.querySelectorAll('.v14-group-avatar-img').forEach(function (img) {
                    /* FIX: list rows use the SAME placeholder as 1:1 chats (navy
                       #1B2B8B disc, white initials, thin ring) — no people-glyph icon. */
                    window.EmpAvatar.wire(img, img.dataset.gname, img.dataset.gavatar || '');
                    var fr = img._empFrameWrap;
                    if (fr) { fr.style.background = '#1B2B8B'; fr.style.border = '2px solid rgba(27,43,139,0.12)'; fr.style.boxSizing = 'border-box'; }
                });
            } else {
                section.querySelectorAll('.v14-group-avatar-img').forEach(function (img) {
                    img.src = img.dataset.gavatar || window._empGroupIconUri || '';
                });
            }
        }

        _groupsRepaint = function () {
            /* only rebuild when the list isn't already on screen (another file cleared it) — avoids needless DOM churn */
            if (Object.keys(_groupDocs).length && !document.getElementById('v14-groups-section')
                && !(_groupsContainerRef && _groupsContainerRef.querySelector(':scope > .v14-group-item'))) _renderMerged();
        };

        if (altId) {
            _groupsListUnsub2 = window.fbDb.collection('groups')
                .where('members', 'array-contains', altId)
                .onSnapshot(function (snap) {
                    snap.docChanges().forEach(function (chg) {
                        if (chg.type === 'removed') delete _groupDocs[chg.doc.id];
                        else _groupDocs[chg.doc.id] = chg.doc.data();
                    });
                    _renderMerged();
                }, function (err) {
                    console.warn('[v14] Groups list (secondary/legacy-id) listener error:', err && err.message);
                    _groupsListKey = null; /* let the next render pass retry */
                });
        }

        _groupsListUnsub = window.fbDb.collection('groups')
            .where('members', 'array-contains', myId)
            .onSnapshot(function (snap) {
                snap.docChanges().forEach(function (chg) {
                    if (chg.type === 'removed') delete _groupDocs[chg.doc.id];
                    else _groupDocs[chg.doc.id] = chg.doc.data();
                });
                _renderMerged();
            }, function (err) {
                console.warn('[v14] Groups list listener error:', err && err.message);
                _groupsListKey = null; /* let the next render pass retry */
                if (_groupsListUnsub) { try { _groupsListUnsub(); } catch (e) {} _groupsListUnsub = null; }
            });
    }

    /* Re-render whenever the contact list itself re-renders, and on init */
    var _origRenderContactList = window.renderContactList;
    if (typeof _origRenderContactList === 'function') {
        window.renderContactList = function () {
            _origRenderContactList.apply(this, arguments);
            setTimeout(_renderGroupsInContactList, 50);
        };
    }
    document.addEventListener('empyrean-init-done', function () { setTimeout(_renderGroupsInContactList, 700); });


    /* =========================================================================
       §5  ?openGroup=<id> DEEP LINK  /  GROUP INVITE LINK

       FIX v16 (spec item 5 — "enable group chat link generation"): "Copy
       group link" (§3 above) has always produced this same `?openGroup=`
       URL, but until now opening it as anyone other than an *existing*
       member dead-ended at "You are not a member of this group" — the
       link could be generated and copied, but never actually admitted
       anyone, so it wasn't a working invite link, just a bookmark for
       people already in the group. Now a non-member who opens the link
       is asked to confirm, then added to the group's members via the
       same arrayUnion pattern the rest of this file already uses for
       membership changes, before the chat opens.
       ========================================================================= */
    /* FIX (2026-10-28 — "clicking a group share link redirects members to the general dashboard before opening the
       group"): the app boots into the dashboard (or the last section), and this handler used to wait for
       empyrean-init-done + a fixed 1200ms + navigateTo('messages') + another 250ms before opening the group — so the
       dashboard/messages list was visible for several seconds first. Now:
         • a full-screen "Opening group…" cover (#emp-og-cover, also injected at the very top of <body> in
           index.html so it exists from the first paint) hides everything underneath until the group chat is open;
         • the fixed delays are cut to the minimum (150ms after init-done, 150ms after navigateTo);
         • the same join/open logic is exposed as window._empOpenGroupFromLink(gid) so tapping a group link INSIDE a
           chat opens the group instantly, without reloading the app at all (see app-link-preview.js §11).
       Signed-out visitors are not blocked: the cover is removed as soon as init finishes with no session. */
    function _ogCover(show) {
        var c = document.getElementById('emp-og-cover');
        if (show) {
            if (c) return;
            c = document.createElement('div');
            c.id = 'emp-og-cover';
            c.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;background:linear-gradient(160deg,#0a0e27 0%,#1B2B8B 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#fff;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;transition:opacity .25s;';
            c.innerHTML = '<div style="width:64px;height:64px;border-radius:50%;background:#fff;color:#1B2B8B;font-weight:800;font-size:34px;display:flex;align-items:center;justify-content:center;">E</div>' +
                '<div style="font-size:15px;font-weight:600;letter-spacing:.3px;">Opening group\u2026</div>' +
                '<div style="width:26px;height:26px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:empOgSpin .8s linear infinite;"></div>' +
                '<style>@keyframes empOgSpin{to{transform:rotate(360deg)}}</style>';
            (document.body || document.documentElement).appendChild(c);
        } else if (c) {
            c.style.opacity = '0';
            setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 280);
        }
    }

    /* Opens (joining first, if needed) the group with this id. Returns false when it cannot even start (not
       signed in / Firebase not ready) so the caller can fall back to a normal page navigation. `done(ok)` is
       called when the attempt finishes. */
    function _empOpenGroupFromLink(gid, done) {
        done = done || function () {};
        if (!gid || !_fbOk()) { done(false); return false; }
        var myId = _myId();
        if (!myId) { done(false); return false; }
        window.fbDb.collection('groups').doc(gid).get().then(function (doc) {
            if (!doc.exists) { _notify('Group not found', 'error'); done(false); return; }
            var g = doc.data();
            var isMember = (g.members || []).indexOf(myId) !== -1;

            function _enterChat() {
                if (typeof window.navigateTo === 'function') window.navigateTo('messages');
                setTimeout(function () { window.openGroupChat(gid); done(true); }, 150);
            }

            if (isMember) { _enterChat(); return; }

            if (!confirm('Join "' + (g.name || 'this group') + '"?')) { done(false); return; }

            window.fbDb.collection('groups').doc(gid).update({
                members: firebase.firestore.FieldValue.arrayUnion(myId)
            }).then(function () {
                _notify('Joined ' + (g.name || 'the group'), 'success');
                _enterChat();
            }).catch(function (err) {
                _notify('Could not join the group. ' + (err.message || ''), 'error');
                done(false);
            });
        }).catch(function () { done(false); });
        return true;
    }
    window._empOpenGroupFromLink = _empOpenGroupFromLink;

    var _ogParam = '';
    try { _ogParam = new URLSearchParams(location.search).get('openGroup') || ''; } catch (e) {}
    var _ogDone = false, _ogBusy = false;
    if (_ogParam) {
        _ogCover(true);
        setTimeout(function () { _ogCover(false); }, 20000); /* failsafe: never leave the cover up */
    }
    function _runOpenGroupDeepLink() {
        if (!_ogParam || _ogDone || _ogBusy) return;
        if (!_fbOk()) return; /* Firebase not ready yet — the next init-done retries; failsafe covers the worst case */
        if (!_myId()) {
            /* No session yet. If one is expected (stale-guest pass during sign-in) keep waiting for the next
               init-done; otherwise this is a genuine signed-out visitor — release the screen. */
            var expect = false;
            try { expect = !!(window.fbAuth && window.fbAuth.currentUser) || !!localStorage.getItem('empyrean_session_email'); } catch (e) {}
            if (!expect) _ogCover(false);
            return;
        }
        _ogBusy = true;
        _empOpenGroupFromLink(_ogParam, function (ok) {
            _ogBusy = false; _ogDone = true;
            setTimeout(function () { _ogCover(false); }, ok ? 450 : 0);
        });
    }
    document.addEventListener('empyrean-init-done', function () { setTimeout(_runOpenGroupDeepLink, 150); });

    console.log('[EmpyreanPatchV14] ✅ Group management portal ready (admins, permissions, member management).');
})();

/* =============================================================================
   Empyrean — app-patch-v13.js PART 3 (was app-patch-v50.js — Universal "Share" sheet)
   ─────────────────────────────────────────────────────────────────────────
   MERGE FIX (2026-08-01): the standalone app-patch-v50.js this part came
   from built each forwarded 1:1 message's doc ID as 'msg-' + Date.now() +
   '-fwd' — no random component. Forwarding to two or more 1:1 chats at
   once (_makeSendHandler's targets.forEach loop, synchronous, well within
   Date.now()'s 1ms resolution) could produce the SAME doc ID for two
   different chats. Since 1:1 messages live in one flat top-level
   `messages` collection (not nested per-chat), that collision meant the
   second .set() silently overwrote the first — one of the forwarded
   messages would just vanish, into whichever chat's write landed second.
   Fixed by adding the same random suffix _forwardToGroup already used.
   Everything else below is unchanged from the original file.

   WHAT THIS PART DOES
   ────────────────────
   Adds a single, reusable "Share to…" bottom sheet — window.EmpShare.open(
   payload) — used from every existing Share entry point instead of each one
   going straight to one hard-coded destination:

     Level 1 ("Share to")   Empyrean | WhatsApp | More (native OS share)
     Level 2 ("Empyrean")   My Status, then every group and every 1:1 chat
                            the person is actually in (read live from
                            Firestore — `groups` where members array-contains
                            me, `chats` where participants array-contains me),
                            multi-selectable with a WhatsApp-style floating
                            send button.

   Picking "My Status" reuses the exact same fetch → File → #status-file-input
   handoff app-patch-openchat.js / this file's own Part 1/2 already had (so
   the composer opens pre-filled, editable, with its own "Post Status"
   button — nothing about that part changes). Picking one or more chats/
   groups instead WRITES A FORWARDED COPY of the message directly into that
   chat/group (same Firestore schema each chat type's own send code already
   uses), so it shows up there immediately without leaving the current
   screen.

   ENTRY POINTS WIRED TO THIS SHEET (see each file's own patch note):
     • app-patch-openchat.js — 1:1 message long-press action sheet's row,
       renamed "Share" (was "Share to Status", media-only)
     • Part 2 above — group message long-press action sheet's row, same
     • app-feed.js — the existing per-post Share pill icon; native OS share
       ("More" here) still goes through the SAME app-thread.js _empShare()
       count/mining path it always did — only the destination picker in
       front of it is new.
   ============================================================================= */
(function () {
    'use strict';
    if (window.EmpShare) return; // idempotent — a hot-reload/dev-preview re-run must not rebuild

    /* ---------- small shared helpers — same patterns already used across
       app-patch-openchat.js / app-patch-v13.js, kept self-contained here so
       this file has no load-order dependency on either of them. ---------- */
    function _us() { return window.userState || window.currentUser || {}; }
    function _myId() {
        /* FIX (2026-08-01 — Share sheet only ever shows "My Status", no
           groups or direct chats): this queried the live Firebase Auth uid
           first, falling back to the persistent app user id (userState.id)
           last. But groups.members / chats.participants are written with
           each person's PERSISTENT id, not their live (often anonymous,
           per-session) Firebase Auth uid — the identical mismatch already
           fixed for this exact "groups.members array-contains myId" query
           elsewhere in this same file (see the other _myId() above, "group
           creator's name/avatar showing as generic Member" fix). Wrong-uid
           here doesn't error — the array-contains query just matches
           nothing, so every group/chat silently disappears from the list
           while "My Status" (which needs no id match) still renders fine.
           Fix: persistent id first, matching the already-correct fix. */
        try { var uid = _us().id; if (uid) return uid; } catch (e) {}
        try { if (window.fbAuth && window.fbAuth.currentUser && !window.fbAuth.currentUser.isAnonymous) return window.fbAuth.currentUser.uid; } catch (e) {}
        try { if (window.firebase && firebase.auth && firebase.auth().currentUser) return firebase.auth().currentUser.uid; } catch (e) {}
        return '';
    }
    function _fbOk() { return !!(window.fbDb && window.firebase); }
    function _isGuest() { return typeof window._isGuest === 'function' ? window._isGuest() : !_myId(); }
    function _notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type); }
    function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function _attr(s) { return _esc(s); }
    function _buildChatId(a, b) { return [a, b].sort().join('_'); }
    function _isImageType(mt) { return /^image\//.test(mt || '') || mt === 'image'; }
    function _isVideoType(mt) { return /^video\//.test(mt || '') || mt === 'video'; }
    function _shortMediaType(mt) { return _isVideoType(mt) ? 'video' : (_isImageType(mt) ? 'image' : ''); }

    /* =========================================================================
       FIX (2026-08-30 -- bug: "clicking a destination in the internal Share
       sheet does nothing" -- confirmed live via console: FirebaseError:
       Missing or insufficient permissions, firing immediately after tapping
       a chat/group row + the send button).
       ROOT CAUSE: _forwardToGroup / _forwardToChat / _forwardToStatus below
       each fire a single, un-retried .set() at the exact same
       groups/{id}/messages, messages/{id}, and statuses/{id} paths the
       group chat composer already writes to elsewhere in this same file --
       and that composer's own _writeWithRetry/_hasAnyAuthSession (see its
       extensive comment a few hundred lines up, in the group-chat-view
       closure) already root-caused and fixed the EXACT SAME
       "permission-denied" symptom on those exact paths: it isn't always a
       real membership rejection -- Firebase Auth can still be finishing its
       anonymous-session handshake (request.auth briefly null) the first
       time a write fires after a screen opens, which fails the rules'
       auth check with the identical "Missing or insufficient permissions"
       error a genuine non-member would get. The share sheet's forward path
       never had that same retry/auth-nudge logic -- it's a different
       closure (this EmpShare module, not the group-chat-view one), so it
       couldn't reach the other one's private helpers. This is the same
       proven fix, duplicated into this closure rather than reached into
       across closures, exactly the way this file already has two separate
       _myId() copies for the same reason (see the comment on the one right
       above). Nothing about the group-chat-view module's own
       _writeWithRetry is touched by this. */
    function _hasAnyAuthSession() {
        return !!(window.fbAuth && window.fbAuth.currentUser);
    }
    function _writeWithRetry(doWrite, onGiveUp, onSuccess) {
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
            doWrite().then(function () {
                _cleanupOnlineListener();
                if (timer) clearTimeout(timer);
                if (typeof onSuccess === 'function') onSuccess();
            }).catch(function (err) {
                var permDenied = err && err.code === 'permission-denied';
                var noSessionYet = permDenied && !_hasAnyAuthSession();
                if (noSessionYet && typeof window._empTrySignInAnonymously === 'function') {
                    window._empTrySignInAnonymously();
                }
                if (attempt >= MAX_ATTEMPTS || (permDenied && !noSessionYet)) {
                    _cleanupOnlineListener();
                    onGiveUp(err);
                    return;
                }
                var delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
                timer = setTimeout(_attempt, delay);
                if (!onlineHandler) {
                    onlineHandler = function () {
                        if (timer) clearTimeout(timer);
                        _attempt();
                    };
                    window.addEventListener('online', onlineHandler);
                }
            });
        }
        _attempt();
    }
    function _fullMediaType(mt) {
        if (/\//.test(mt || '')) return mt; // already a full MIME
        if (mt === 'video') return 'video/mp4';
        if (mt === 'image') return 'image/jpeg';
        return mt || '';
    }

    /* =========================================================================
       STYLES — injected once via <style>, never touching style.css/token.css
       (this codebase's own long-standing rule — see e.g. app-status.js's own
       _injectStyles()).
       ========================================================================= */
    function _injectStyle() {
        if (document.getElementById('emp-share-style')) return;
        var css =
            /* FIX (2026-08-01): these two used to be ID selectors
               (#emp-share-ov / #emp-share-sheet). Level 1 and Level 2 now
               each get their own unique id (see _renderLevel1/_renderLevel2
               below) so both can briefly coexist during a transition — the
               styling below is shared between them via these classes
               instead, which every level's overlay/sheet element carries. */
            /* FIX (2026-08-01, second pass — the debug overlay caught the
               REAL bug): the previous fix above addressed why the sheet
               might not repaint in time, but the debug log from a 1:1 chat
               (the "Preview" in-app WebView, not desktop Chrome) showed
               something worse — even once the sheet had fully finished
               animating (computed transform already matrix(1,0,0,1,0,0),
               i.e. translateY(0), opacity already 1 — nothing left
               pending, no timing window left to miss) elementFromPoint at
               the sheet's own on-screen position STILL returned its own
               overlay, not the sheet. That's not a timing problem at all —
               it means this WebView was not resolving z-index correctly
               between .emp-share-ov (z-index 9999998) and
               .emp-share-sheet (9999999) when they're two INDEPENDENT
               top-level position:fixed siblings of <body>, regardless of
               how settled either one is. Comparing z-index across two
               separate fixed-position elements like that is exactly the
               kind of cross-stacking-context comparison weaker/older
               WebView compositors are known to get wrong. Fix: stop
               asking this WebView to resolve that comparison at all.
               .emp-share-ov and .emp-share-sheet are now both children of
               ONE shared position:fixed wrapper (.emp-share-wrap) instead
               of being independent fixed siblings — so there's only ever
               ONE element whose own fixed-positioning support actually
               matters, and within it the sheet paints over the overlay
               simply because it's the LATER child in normal DOM paint
               order (both left at z-index:auto), which is basic
               same-stacking-context painting behaviour every layout
               engine — including this one — gets right. */
            '.emp-share-wrap{position:fixed;inset:0;z-index:9999999;isolation:isolate;pointer-events:none;}' +
            '.emp-share-wrap .emp-share-ov,.emp-share-wrap .emp-share-sheet{pointer-events:auto;}' +
            '.emp-share-ov{position:absolute;inset:0;background:rgba(0,0,0,0.4);}' +
            /* FIX (2026-08-01 — "sheet doesn't pop up until you swipe"):
               a @keyframes animation that starts playing the instant the
               element is inserted relies on the browser having already
               committed that insertion to a paint before the animation's
               first frame can run. The same embedded WebView documented
               elsewhere in this file (see _renderLevel2's own big FIX
               comment on the Level1→Level2 hand-off) can sit on a
               same-tick "append this brand-new element" mutation from a
               click handler without compositing it at all until some
               later, unrelated input (a scroll/swipe) forces it to catch
               up — so the sheet was technically already in the DOM the
               whole time, just never actually painted until a swipe
               forced a repaint. Replaced the auto-playing @keyframes with
               an explicit transform+transition pair driven by a class
               (.emp-share-in) added one animation frame after insertion
               — the exact same forced two-frame paint idiom already used
               for the old-node removal in _renderLevel1/_renderLevel2
               below, now also covering the initial pop-up itself so it
               no longer depends on a swipe to appear. */
            /* FIX (2026-08-01 — "auto pop-up missing, users must swipe
               upward to reveal the tab"): this sheet used to be inserted
               off-screen (translateY(100%), opacity:.4) and only reach its
               visible end state once JS toggled a class on it one frame
               later. Every previous fix in this file tried to force that
               later toggle to actually paint (a synchronous reflow, a
               scrollTop nudge mimicking a real swipe, rAF + setTimeout
               fallbacks stacked together) — all of them make the SAME
               assumption, that the two-step "insert hidden, then flip to
               visible" pattern will eventually get painted by this
               embedded WebView. The debug overlay wired in for this pass
               (see _showDebug below) proved that assumption wrong: even
               with every one of those forced-repaint signals firing and
               confirming "class added, transform correct", the sheet
               still wasn't the topmost paintable thing at its own
               on-screen position — this WebView was simply never
               compositing that second step on its own, no matter how it
               was nudged, until some unrelated input (a real swipe) forced
               a full repaint. Fix: stop depending on a second step at all.
               The sheet's default (only) state is now its fully visible
               one — nothing needs to happen after insertion for it to be
               on screen, so there's no later paint for this WebView to
               skip. A purely cosmetic slide-up (see _animateIn below) is
               layered on top via the Web Animations API, which schedules
               its own compositor animation in the same call rather than
               depending on a later, separate style recalculation — but
               even if that call does nothing at all in some environment,
               the sheet is still fully visible immediately either way. */
            '.emp-share-sheet{position:absolute;left:0;right:0;bottom:0;background:#fff;border-radius:18px 18px 0 0;' +
            'box-shadow:0 -6px 34px rgba(0,0,0,0.28);max-height:82vh;display:flex;flex-direction:column;' +
            'padding-bottom:max(10px,env(safe-area-inset-bottom));}' +
            '.emp-share-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 8px;flex-shrink:0;gap:6px;}' +
            '.emp-share-title{font-weight:700;font-size:1rem;color:#111;}' +
            '.emp-share-close{background:none;border:none;font-size:1.4rem;color:#888;cursor:pointer;line-height:1;padding:4px 8px;}' +
            '.emp-share-back{background:none;border:none;font-size:1.25rem;color:#1B2B8B;cursor:pointer;padding:4px 10px 4px 0;}' +
            '.emp-share-grid{display:grid;grid-auto-flow:column;grid-auto-columns:76px;gap:10px;padding:6px 16px 22px;overflow-x:auto;}' +
            '.emp-share-tile{background:none;border:none;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;padding:4px;}' +
            '.emp-share-tile-icon{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#F3F4F6;}' +
            '.emp-share-tile-label{font-size:0.72rem;color:#374151;font-weight:600;text-align:center;}' +
            '.emp-share-search{margin:2px 16px 8px;}' +
            '.emp-share-search input{width:100%;padding:10px 14px;border-radius:12px;border:1.5px solid #eee;background:#F9FAFB;font-size:0.86rem;outline:none;}' +
            '.emp-share-list{overflow-y:auto;flex:1;padding:0 8px 70px;}' +
            '.emp-share-section-label{padding:10px 12px 4px;font-size:0.72rem;font-weight:700;color:#6B7280;text-transform:uppercase;}' +
            '.emp-share-row{display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:12px;cursor:pointer;}' +
            '.emp-share-row:active{background:#F3F4F6;}' +
            '.emp-share-row-avatar{width:42px;height:42px;border-radius:50%;object-fit:cover;background:#1B2B8B;flex-shrink:0;}' +
            '.emp-share-row-name{font-size:0.88rem;font-weight:600;color:#111;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
            '.emp-share-row-check{width:22px;height:22px;border-radius:50%;border:2px solid #D1D5DB;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:transparent;}' +
            '.emp-share-row.selected .emp-share-row-check{background:#1B2B8B;border-color:#1B2B8B;color:#fff;}' +
            '.emp-share-empty{padding:30px 20px;text-align:center;color:#9CA3AF;font-size:0.85rem;}' +
            '.emp-share-send-bar{position:absolute;right:16px;bottom:16px;background:#1B2B8B;color:#fff;border:none;border-radius:50%;width:52px;height:52px;' +
            'display:none;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(27,43,139,0.4);cursor:pointer;}' +
            '.emp-share-send-bar.show{display:flex;}' +
            '.emp-share-send-bar .emp-share-send-count{position:absolute;top:-4px;right:-4px;background:#E53935;color:#fff;font-size:0.66rem;font-weight:700;' +
            'border-radius:10px;min-width:18px;height:18px;display:flex;align-items:center;justify-content:center;padding:0 4px;}' +
            /* FEATURE (2026-08-02 — Forward vs Share spec): the composer's
               own Send is a full-width bottom bar (not the circular
               floating FAB the list screens use above) — it sits in a
               normal document-flow footer under the textarea/preview,
               not floating over scrollable content, so the circular FAB
               treatment doesn't fit here. */
            '.emp-share-composer-send{display:flex;align-items:center;justify-content:center;gap:8px;width:calc(100% - 32px);margin:6px 16px 4px;' +
            'padding:13px;background:#1B2B8B;color:#fff;border:none;border-radius:14px;font-size:0.92rem;font-weight:700;cursor:pointer;}' +
            '.emp-share-composer-send:active{opacity:0.85;}' +
            '.emp-share-composer-input:focus{border-color:#1B2B8B;}';
        var st = document.createElement('style');
        st.id = 'emp-share-style';
        st.textContent = css;
        document.head.appendChild(st);
    }

    function _closeAll() {
        /* FIX (2026-08-01, second pass): removes the shared .emp-share-wrap
           container(s) — see the FIX comment on .emp-share-wrap above for
           why .emp-share-ov/.emp-share-sheet are no longer independent
           top-level elements. Removing the wrap takes its overlay+sheet
           children with it. */
        document.querySelectorAll('.emp-share-wrap').forEach(function (e) { e.remove(); });
        void document.body.offsetHeight; /* force the removal to commit before any caller appends new nodes in the same tick */
    }

    /* FIX (2026-08-01 — replaces the old _forcePaint hack chain): the sheet
       no longer needs anything to happen after insertion to be visible —
       its default CSS state IS the visible state (see the FIX comment on
       .emp-share-sheet above). This helper is purely cosmetic: it plays a
       slide-up-from-bottom animation via the Web Animations API, which
       schedules its own compositor animation in one call instead of
       depending on the browser noticing a later, separate class/style
       change — but if el.animate isn't available, or the WebView declines
       to run it, the sheet is still sitting fully visible regardless, so
       there's nothing here for a missing animation to break. */
    function _animateIn(el) {
        try {
            if (typeof el.animate !== 'function') return;
            el.animate(
                [{ transform: 'translateY(100%)', opacity: 0.4 }, { transform: 'translateY(0)', opacity: 1 }],
                { duration: 220, easing: 'ease-out' }
            );
        } catch (e) { /* purely cosmetic — nothing to fall back to */ }
    }

    var _ICONS = {
        empyrean: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#1B2B8B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/></svg>',
        whatsapp: '<svg viewBox="0 0 32 32" width="28" height="28" fill="#25D366"><path d="M16.04 3C9.37 3 3.98 8.39 3.98 15.06c0 2.24.6 4.34 1.65 6.15L3 29l7.98-2.58a12.02 12.02 0 0 0 5.06 1.12h.01c6.67 0 12.06-5.39 12.06-12.06C28.11 8.39 22.72 3 16.04 3zm0 22c-1.7 0-3.36-.44-4.8-1.28l-.34-.2-4.73 1.53 1.55-4.6-.22-.35a9.85 9.85 0 0 1-1.5-5.24c0-5.5 4.48-9.98 10-9.98s10 4.47 10 9.98-4.5 9.14-10 9.14z"/><path d="M21.4 18.3c-.29-.15-1.72-.85-1.99-.95-.27-.1-.46-.15-.66.15-.2.29-.75.94-.92 1.14-.17.2-.34.22-.63.07-.29-.15-1.22-.45-2.32-1.43-.86-.76-1.44-1.71-1.6-2-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.2-.29.29-.49.1-.2.05-.37-.02-.51-.07-.15-.66-1.59-.9-2.18-.24-.57-.48-.49-.66-.5h-.56c-.2 0-.51.07-.78.37-.27.29-1.02 1-1.02 2.44s1.05 2.83 1.2 3.03c.15.2 2.06 3.15 5 4.42.7.3 1.24.48 1.67.62.7.22 1.34.19 1.84.12.56-.08 1.72-.7 1.96-1.38.24-.68.24-1.26.17-1.38-.07-.12-.26-.2-.55-.34z"/></svg>',
        more: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#374151" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
        copy: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#374151" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        /* NEW — dedicated Facebook tile (see _shareToFacebook below for
           why this exists as its own tile instead of relying on the
           generic OS share sheet's own Facebook target). */
        facebook: '<svg viewBox="0 0 24 24" width="26" height="26" fill="#1877F2"><path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.91h-2.33V22c4.78-.79 8.44-4.94 8.44-9.94z"/></svg>',
        status: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
        send: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
        /* NEW — Forward/Share chooser (spec: "Empyrean... expand to reveal
           two functions: Forward and Share"): distinct glyph for Forward so
           it no longer borrows the Empyrean logo (that logo now belongs to
           the "Empyrean" tile itself, one level up) or the Share paper-plane
           — a standard forward-arrow, same family as the other outline icons
           above. */
        forward: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1B2B8B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 4 22 11 15 18"/><path d="M2 20v-3a7 7 0 0 1 7-7h13"/></svg>'
    };

    function _tile(label, iconHtml, bg, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'emp-share-tile';
        b.innerHTML = '<span class="emp-share-tile-icon"' + (bg ? ' style="background:' + bg + '"' : '') + '>' + iconHtml + '</span>' +
            '<span class="emp-share-tile-label">' + _esc(label) + '</span>';
        b.addEventListener('click', onClick);
        return b;
    }

    /* =========================================================================
       PUBLIC ENTRY — window.EmpShare.open(payload)
       payload: { text, mediaUrl, mediaType, pageUrl }
       All fields optional, but at least one of text/mediaUrl should be set
       for the destination-forward paths to have anything to send.
       ========================================================================= */
    function open(payload) {
        payload = payload || {};
        /* FEATURE (2026-08-02 — Forward vs Share spec): two new, optional,
           fully backward-compatible fields on payload:
             mode         — 'forward' (default) | 'share'. Controls what
                             happens AFTER destinations are picked in
                             Level 2: 'forward' sends immediately, exactly
                             as this function always has; 'share' opens a
                             one-screen editing composer first (see
                             _renderComposer below) so the person can add
                             a comment or edit the text before it sends —
                             mirroring WhatsApp's own Share flow.
             internalOnly — when true, skips Level 1 (the Empyrean/
                             WhatsApp/More external-share tiles) and opens
                             Level 2 (My Status / Groups / Direct chats)
                             directly. A message inside a chat is already
                             INSIDE Empyrean — offering to "share to
                             WhatsApp" a message that's already a WhatsApp-
                             style chat message doesn't make sense the way
                             it does for a feed post or business page link,
                             which is the only case Level 1 is still shown
                             for (every existing caller — app-feed.js,
                             business-page shares, etc. — passes neither
                             field, so they get today's exact behavior,
                             unchanged).
           Every existing call site (feed posts, business pages, the old
           message-Share rows before this feature) omits both fields and
           is completely unaffected — mode defaults to 'forward' (today's
           only behavior) and internalOnly defaults to false (today's
           Level-1-first flow). */
        payload.mode = payload.mode === 'share' ? 'share' : 'forward';
        payload.internalOnly = !!payload.internalOnly;
        /* The on-screen debug overlay that used to fire unconditionally
           here (across many prior "fix" attempts that were never actually
           confirmed against a real observed error) found the root cause of
           the swipe-to-reveal bug — see the FIX comment on .emp-share-sheet
           above — and is now opt-in only (window.EMP_SHARE_DEBUG = true),
           kept around for any future WebView-specific issue rather than
           deleted outright. */
        _showDebug('EmpShare.open() called — mediaUrl=' + (payload.mediaUrl ? 'yes' : 'no') + ' text=' + (payload.text ? 'yes' : 'no') + ' mode=' + payload.mode + ' internalOnly=' + payload.internalOnly);
        try {
            _injectStyle();
            _closeAll();
            if (payload.internalOnly) _renderLevel2(payload);
            else _renderLevel1(payload);
        } catch (e) {
            _showDebug('ERROR in open(): ' + (e && e.message) + '\n' + (e && e.stack || ''));
        }
    }

    /* FIX (2026-08-01 — this overlay was left permanently on): it was
       wired in purely to diagnose the auto-pop-up bug (see the FIX comment
       on .emp-share-sheet above, and on _animateIn) and did its job — the
       root cause is now fixed structurally, not by reading these logs on
       every open. Left in as an opt-in tool (set window.EMP_SHARE_DEBUG =
       true before calling EmpShare.open) rather than deleted outright, in
       case a *different* embedded-WebView quirk turns up later, but it no
       longer renders on top of the sheet for every real user by default. */
    function _showDebug(msg) {
        if (!window.EMP_SHARE_DEBUG) return;
        try {
            var d = document.getElementById('emp-share-debug');
            if (!d) {
                d = document.createElement('div');
                d.id = 'emp-share-debug';
                d.style.cssText = 'position:fixed;left:6px;right:6px;bottom:6px;z-index:2147483647;background:#111;color:#7CFC7C;font:10px/1.4 monospace;padding:8px 10px;border-radius:8px;max-height:38vh;overflow:auto;white-space:pre-wrap;box-shadow:0 4px 20px rgba(0,0,0,.6);pointer-events:auto;';
                var closeBtn = document.createElement('div');
                closeBtn.textContent = '✕ close debug log';
                closeBtn.style.cssText = 'color:#fff;background:#c0392b;padding:4px 8px;border-radius:4px;margin-bottom:6px;display:inline-block;font-weight:bold;';
                closeBtn.addEventListener('click', function () { d.remove(); });
                d.appendChild(closeBtn);
                document.body.appendChild(d);
            }
            var line = document.createElement('div');
            line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
            d.appendChild(line);
            d.scrollTop = d.scrollHeight;
        } catch (e2) {}
    }

    function _renderLevel1(payload) {
        _showDebug('_renderLevel1() start');
        var wrap = document.createElement('div'); wrap.id = 'emp-share-wrap-l1'; wrap.className = 'emp-share-wrap';
        var ov = document.createElement('div'); ov.className = 'emp-share-ov';
        ov.addEventListener('click', _closeAll);
        var sheet = document.createElement('div'); sheet.id = 'emp-share-sheet-l1'; sheet.className = 'emp-share-sheet';

        var head = document.createElement('div'); head.className = 'emp-share-head';
        head.innerHTML = '<div class="emp-share-title">Share to</div><button type="button" class="emp-share-close" aria-label="Close">&times;</button>';
        head.querySelector('.emp-share-close').addEventListener('click', _closeAll);
        sheet.appendChild(head);

        var grid = document.createElement('div'); grid.className = 'emp-share-grid';
        /* FEATURE (2026-08-30 — spec: "Clicking the Share icon should first
           display three options: Empyrean, WhatsApp, and Share More. When
           Empyrean is selected, it should expand to reveal two functions:
           Forward and Share."): this level used to put Forward and Share
           side by side as two of FOUR top-level tiles (Forward, Share,
           WhatsApp, More), with "Forward" confusingly wearing the Empyrean
           logo icon and no actual "Empyrean" tile existing on its own.
           Collapsed back down to the three tiles the spec asks for — the
           Forward/Share choice moved one level deeper, into
           _renderEmpyreanChooser() below, which is where the exact same
           _renderLevel2() call + payload.mode branch that already worked
           now lives. No forward/share send logic changed, only where the
           choice between them is presented. */
        grid.appendChild(_tile('Empyrean', _ICONS.empyrean, '#EEF0FB', function () {
            _showDebug('Empyrean tile tapped — opening Forward/Share chooser');
            try {
                _renderEmpyreanChooser(payload);
            } catch (e) {
                _showDebug('ERROR in _renderEmpyreanChooser(): ' + (e && e.message) + '\n' + (e && e.stack || ''));
            }
        }));
        grid.appendChild(_tile('WhatsApp', _ICONS.whatsapp, '#E7F9EE', function () { _shareToWhatsApp(payload); _closeAll(); }));
        /* FEATURE (report — "the link showing is too conspicuous when
           shared/posted on Facebook, only the join empyrean domain [the
           preview card] should display"): tapping Facebook inside the
           OS's own generic "Share More" sheet just hands this app's url
           straight to Facebook's regular composer, which pastes it in as
           plain, visible, auto-linked text ABOVE the auto-scraped preview
           card — see _shareToFacebook below for why a dedicated tile that
           opens Facebook's own sharer dialog avoids that entirely. */
        grid.appendChild(_tile('Facebook', _ICONS.facebook, '#E7F0FE', function () { _shareToFacebook(payload); _closeAll(); }));
        /* payload.onMore lets a caller that already has its own native-share
           plumbing (e.g. app-feed.js's _empShare — count + mining tracking
           bundled with the native call) use that instead of a generic one
           here, so this sheet doesn't duplicate or fight that bookkeeping.
           Labeled "Share More" (was "More") to match the spec's naming for
           this third top-level option; behavior is unchanged. */
        if (typeof payload.onMore === 'function') {
            grid.appendChild(_tile('Share More', _ICONS.more, '#F3F4F6', function () { payload.onMore(); _closeAll(); }));
        } else if (typeof navigator.share === 'function') {
            grid.appendChild(_tile('Share More', _ICONS.more, '#F3F4F6', function () { _shareNative(payload); _closeAll(); }));
        } else {
            grid.appendChild(_tile('Copy link', _ICONS.copy, '#F3F4F6', function () { _copyLink(payload); _closeAll(); }));
        }
        sheet.appendChild(grid);

        /* ov before sheet — DOM order alone decides who paints on top
           within this one wrap (see the FIX comment on .emp-share-wrap
           above); neither child needs, or has, its own z-index. */
        wrap.appendChild(ov);
        wrap.appendChild(sheet);
        document.body.appendChild(wrap);
        void sheet.offsetHeight; /* force this sheet to paint now rather than possibly waiting for an unrelated later repaint */
        _showDebug('_renderLevel1() appended to body — sheet is already visible, playing cosmetic slide-up');
        /* Sheet is already fully visible at this point (see the FIX
           comment on .emp-share-sheet above) — this just layers a cosmetic
           slide-up on top. */
        _animateIn(sheet);

        /* FIX (2026-08-01): covers the Level 2 → Level 1 "back" path. Any
           leftover Level-2 wrap is removed two frames after this wrap has
           already painted on top of it (later in document order always
           wins within the same z-index) — see the matching, more detailed
           comment in _renderLevel2 below for why this two-step order
           (paint new on top first, remove old a couple of frames later)
           is what actually fixes the "nothing visibly happens until an
           unrelated repaint" bug, instead of the previous close-then-open
           order. Also covers the Empyrean-chooser → Level 1 "back" path
           (same reasoning — see _renderEmpyreanChooser below), and is a
           harmless no-op for whichever of the two wraps isn't present. */
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                var oldWrap = document.getElementById('emp-share-wrap-l2'); if (oldWrap) oldWrap.remove();
                var oldChooserWrap = document.getElementById('emp-share-wrap-l1c'); if (oldChooserWrap) oldChooserWrap.remove();
            });
        });
    }

    /* =========================================================================
       EMPYREAN CHOOSER — shown after the "Empyrean" tile on Level 1, per the
       spec: "When Empyrean is selected, it should expand to reveal two
       functions: Forward and Share." Reuses the exact same _renderLevel2()
       destination picker + payload.mode branch Level 1's old Forward/Share
       tiles already called — only the presentation moved one level deeper,
       not the send logic. Same paint-new-on-top-then-remove-old-two-frames-
       later pattern as Level 1 ↔ Level 2 (see the FIX comment on
       _renderLevel1 above for why that order matters on this codebase's
       real WebView target).
       ========================================================================= */
    function _renderEmpyreanChooser(payload) {
        _showDebug('_renderEmpyreanChooser() start');
        var wrap = document.createElement('div'); wrap.id = 'emp-share-wrap-l1c'; wrap.className = 'emp-share-wrap';
        var ov = document.createElement('div'); ov.className = 'emp-share-ov';
        ov.addEventListener('click', _closeAll);
        var sheet = document.createElement('div'); sheet.id = 'emp-share-sheet-l1c'; sheet.className = 'emp-share-sheet';

        var head = document.createElement('div'); head.className = 'emp-share-head';
        head.innerHTML =
            '<button type="button" class="emp-share-back" aria-label="Back">&larr;</button>' +
            '<div class="emp-share-title" style="flex:1;">Empyrean</div>' +
            '<button type="button" class="emp-share-close" aria-label="Close">&times;</button>';
        head.querySelector('.emp-share-back').addEventListener('click', function () { _renderLevel1(payload); });
        head.querySelector('.emp-share-close').addEventListener('click', _closeAll);
        sheet.appendChild(head);

        var grid = document.createElement('div'); grid.className = 'emp-share-grid';
        grid.appendChild(_tile('Forward', _ICONS.forward, '#EEF0FB', function () {
            payload.mode = 'forward';
            _showDebug('Forward tile tapped — calling _renderLevel2() with mode=forward');
            try {
                _renderLevel2(payload);
                _showDebug('_renderLevel2() returned without throwing');
            } catch (e) {
                _showDebug('ERROR in _renderLevel2(): ' + (e && e.message) + '\n' + (e && e.stack || ''));
            }
        }));
        grid.appendChild(_tile('Share', _ICONS.send, '#EEF3FF', function () {
            payload.mode = 'share';
            _showDebug('Share tile tapped — calling _renderLevel2() with mode=share');
            try {
                _renderLevel2(payload);
                _showDebug('_renderLevel2() returned without throwing');
            } catch (e) {
                _showDebug('ERROR in _renderLevel2(): ' + (e && e.message) + '\n' + (e && e.stack || ''));
            }
        }));
        sheet.appendChild(grid);

        /* ov before sheet — see the matching comment in _renderLevel1. */
        wrap.appendChild(ov);
        wrap.appendChild(sheet);
        document.body.appendChild(wrap);
        void sheet.offsetHeight; /* force this sheet to paint now, matching _renderLevel1/_renderLevel2 */
        _showDebug('_renderEmpyreanChooser() appended to body — sheet is already visible, playing cosmetic slide-up');
        _animateIn(sheet);

        /* Covers the Level 1 → chooser path: leftover Level-1 wrap is
           removed two frames after this one has already painted on top of
           it — same reasoning as _renderLevel1's own cleanup above. */
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                var oldWrap = document.getElementById('emp-share-wrap-l1'); if (oldWrap) oldWrap.remove();
            });
        });
    }

    /* =========================================================================
       LEVEL 2 — "Share to Empyrean": My Status + live Groups + live Chats,
       multi-select, floating Send.
       ========================================================================= */
    var _profileCache = {}; // uid -> {name, avatar}
    function _fetchProfile(uid) {
        if (_profileCache[uid]) return Promise.resolve(_profileCache[uid]);
        if (!_fbOk()) return Promise.resolve({ name: 'User', avatar: '' });
        return window.fbDb.collection('users').doc(uid).get().then(function (doc) {
            var d = doc.exists ? (doc.data() || {}) : {};
            var p = { name: d.fullName || d.username || 'User', avatar: d.avatar || d.photoURL || '' };
            _profileCache[uid] = p;
            return p;
        }).catch(function () { return { name: 'User', avatar: '' }; });
    }

    function _renderLevel2(payload) {
        /* FIX (2026-08-01 — reported bug: tapping "Empyrean" showed nothing
           until an unrelated later action — leaving the chat, or a swipe —
           forced a repaint, even though this Level-2 sheet really was
           already sitting in the DOM the whole time (confirmed by it
           "catching up" the moment anything else forced a repaint
           elsewhere on the page). Root cause: this used to call
           _closeAll() FIRST, tearing down Level 1 — the very element that
           had just received the tap — synchronously, inside that tap's
           own click handler, before Level 2 was even built. A stock
           Chrome tab repaints that fine, but the embedded WebView an
           installed WebAPK actually runs on (this codebase's real test
           target — see the ongoing native-wrapper work) can silently skip
           compositing a same-tick "remove what I'm touching, then insert
           something new" swap like that until some other input forces it
           to catch up. FIX: Level 2 no longer closes Level 1 up front. It
           gets its own ids (emp-share-*-l2, styled by the same shared
           .emp-share-ov/.emp-share-sheet classes Level 1 uses) and is
           appended to <body> — and therefore already painting on top,
           since same z-index + later in document order always wins the
           tie — BEFORE Level 1's nodes are removed, not after. Level 1 is
           then removed two animation frames later (see below, after this
           sheet is appended), by which point Level 2 has already had a
           full, independent paint cycle sitting on top of it, so that
           removal is invisible cleanup rather than something a stalled
           compositor needs to "catch up" on. */
        _showDebug('_renderLevel2() start — checking guest status');
        if (_isGuest()) {
            /* TEMP DIAGNOSTIC: window._isGuest is never actually assigned
               anywhere in this codebase (only local, per-file _isGuest()
               closures exist elsewhere), so this ALWAYS falls back to
               !_myId(). If _myId() fails to resolve an id in this
               specific context, this silently redirects to a login modal
               and closes everything — which looks exactly like "nothing
               happens" if openAuthModal doesn't render anything visible
               here (missing element, hidden behind something, or the
               function itself doesn't exist in this context). */
            _showDebug('_isGuest() returned TRUE (myId=' + JSON.stringify(_myId()) + ') — redirecting to login instead of the share picker. openAuthModal exists: ' + (typeof window.openAuthModal === 'function'));
            if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
            requestAnimationFrame(function () { requestAnimationFrame(_closeAll); });
            return;
        }
        _showDebug('_isGuest() returned false (myId=' + JSON.stringify(_myId()) + ') — proceeding to build the sheet');
        var myId = _myId();
        var selected = {}; // key -> {type:'group'|'chat', id}

        var wrap = document.createElement('div'); wrap.id = 'emp-share-wrap-l2'; wrap.className = 'emp-share-wrap';
        var ov = document.createElement('div'); ov.className = 'emp-share-ov';
        ov.addEventListener('click', _closeAll);
        var sheet = document.createElement('div'); sheet.id = 'emp-share-sheet-l2'; sheet.className = 'emp-share-sheet';

        var head = document.createElement('div'); head.className = 'emp-share-head';
        /* FEATURE (2026-08-02 — Forward vs Share spec): title reflects
           which action opened this sheet, and the back arrow (which
           would return to Level 1) only makes sense when Level 1 was
           actually shown first — internalOnly callers (message Forward/
           Share) skip straight here, so there's nothing to go "back" to. */
        var _l2Title = payload.mode === 'share'
            ? 'Share to' /* FEATURE (2026-08-30): now shown for the non-internalOnly reel/feed Share tile too, not just the message long-press one — same label, same meaning, minimal change since 'forward' mode (both internalOnly and not) keeps its exact prior title below. */
            : (payload.internalOnly ? 'Forward to' : 'Share to Empyrean');
        head.innerHTML =
            (payload.internalOnly ? '' : '<button type="button" class="emp-share-back" aria-label="Back">&larr;</button>') +
            '<div class="emp-share-title" style="flex:1;">' + _esc(_l2Title) + '</div>' +
            '<button type="button" class="emp-share-close" aria-label="Close">&times;</button>';
        var _backBtn = head.querySelector('.emp-share-back');
        /* FEATURE (2026-08-30 — Empyrean chooser): this back button only
           ever renders when !payload.internalOnly (see the ternary just
           above) — and the only non-internalOnly way to reach Level 2 is
           now through the Empyrean chooser (Level 1's own tiles no longer
           call _renderLevel2 directly — see _renderLevel1's "Empyrean"
           tile above). So "back" from here means back to the chooser, not
           all the way to Level 1. */
        if (_backBtn) _backBtn.addEventListener('click', function () { _renderEmpyreanChooser(payload); });
        head.querySelector('.emp-share-close').addEventListener('click', _closeAll);
        sheet.appendChild(head);

        var searchWrap = document.createElement('div'); searchWrap.className = 'emp-share-search';
        searchWrap.innerHTML = '<input type="text" placeholder="Search chats and groups">';
        var searchInp = searchWrap.querySelector('input');
        sheet.appendChild(searchWrap);

        var list = document.createElement('div'); list.className = 'emp-share-list';
        sheet.appendChild(list);

        var sendBar = document.createElement('button');
        sendBar.type = 'button';
        sendBar.className = 'emp-share-send-bar';
        sendBar.innerHTML = _ICONS.send + '<span class="emp-share-send-count">0</span>';
        sheet.appendChild(sendBar);

        /* ov before sheet — see the matching comment in _renderLevel1. */
        wrap.appendChild(ov);
        wrap.appendChild(sheet);
        document.body.appendChild(wrap);
        void sheet.offsetHeight; /* this sheet is now on top and already painting — see the FIX comment at the top of this function for why this replaced the old close-then-open order */
        _showDebug('_renderLevel2() appended to body (in DOM: ' + document.body.contains(sheet) + ') — sheet is already visible, playing cosmetic slide-up');
        /* Sheet is already fully visible at this point, same as Level 1 —
           this applies equally to both entry points now, since visibility
           no longer depends on which entry point's own outer action sheet
           happens to sit at a higher z-index (see the FIX comment on
           .emp-share-sheet above for why that used to matter). */
        _animateIn(sheet);

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                var oldWrap = document.getElementById('emp-share-wrap-l1'); if (oldWrap) oldWrap.remove();
                /* FEATURE (2026-08-30 — Empyrean chooser): the chooser is
                   now the only non-internalOnly path into Level 2 (see the
                   back-button comment above) — clean up its wrap the same
                   way, harmless no-op if it already removed itself. */
                var oldChooserWrap = document.getElementById('emp-share-wrap-l1c'); if (oldChooserWrap) oldChooserWrap.remove();
            });
        });

        function _updateSendBar() {
            var n = Object.keys(selected).length;
            sendBar.classList.toggle('show', n > 0);
            sendBar.querySelector('.emp-share-send-count').textContent = String(n);
        }

        function _row(key, name, avatarUrl, isStatus, onPick) {
            var r = document.createElement('div');
            r.className = 'emp-share-row';
            r.dataset.name = (name || '').toLowerCase();
            var avEl = isStatus
                ? '<span class="emp-share-row-avatar" style="display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0A0E27,#1B2B8B);">' + _ICONS.status + '</span>'
                : '<img class="emp-share-row-avatar" src="' + _attr(avatarUrl || '') + '" onerror="this.style.visibility=\'hidden\'">';
            r.innerHTML = avEl + '<span class="emp-share-row-name">' + _esc(name) + '</span>' +
                (isStatus ? '' : '<span class="emp-share-row-check">&#10003;</span>');
            r.addEventListener('click', function () {
                if (isStatus) { onPick(); return; }
                if (selected[key]) { delete selected[key]; r.classList.remove('selected'); }
                else { selected[key] = onPick(); r.classList.add('selected'); }
                _updateSendBar();
            });
            return r;
        }

        list.appendChild(_row('status', 'My Status', '', true, function () {
            /* FIX (2026-08-01 — "Clicking My Status doesn't take you to the
               status editor"): the previous fix here opened the status
               composer FIRST, then deferred closing this sheet by two
               animation frames — mirroring the Level1<->Level2 pattern
               above, which works because both sides of that transition
               share the same stacking context (.emp-share-* elements at
               z-index 9999998/9999999, so "later in document order wins
               the tie"). #create-status-modal is a separate component at
               z-index 8900 — far BELOW this sheet — so deferring the
               removal left the composer sitting hidden underneath this
               still-present, higher z-index sheet for the entire deferred
               window. Fix: since the destination isn't another EmpShare
               level, there's no same-stacking-context race to protect
               here — close this sheet first (also forces a layout/paint
               via the offsetHeight read inside _closeAll), then open the
               composer, so it's never covered by a sheet that hasn't been
               removed yet. */
            _showDebug('My Status row tapped — closing sheet — mode=' + payload.mode + ' internalOnly=' + payload.internalOnly);
            _closeAll();
            /* FEATURE (2026-08-02 — Forward vs Share spec, follow-up):
               "My Status" used to call _shareToStatus() unconditionally,
               which ALWAYS opens the editing composer — correct for Share,
               but wrong for Forward (spec: "Forwarding should be direct,
               no editing composer"). The chats/groups destinations already
               branch on payload.mode via _makeSendHandler (see above);
               this row was the one destination that never did. Gated on
               payload.internalOnly (true only for the message long-press
               Forward/Share rows this spec is about) so the pre-existing
               feed-post/business-page "Share" pill — Level 1 entry,
               internalOnly always false/undefined, mode defaults to
               'forward' for unrelated legacy reasons per open()'s own
               header comment — keeps landing in the composer exactly as
               it always has; only a message's own explicit Forward action
               changes behavior here. */
            if (payload.internalOnly && payload.mode === 'forward') {
                _forwardToStatus(payload);
            } else {
                _shareToStatus(payload);
            }
        }));

        if (!_fbOk()) {
            var offline = document.createElement('div'); offline.className = 'emp-share-empty'; offline.textContent = 'No connection — can\u2019t load chats right now.';
            list.appendChild(offline);
            sendBar.addEventListener('click', _makeSendHandler(selected, payload));
            return;
        }

        var groupsLabel = document.createElement('div'); groupsLabel.className = 'emp-share-section-label'; groupsLabel.textContent = 'Groups';
        var groupsWrap = document.createElement('div');
        var chatsLabel = document.createElement('div'); chatsLabel.className = 'emp-share-section-label'; chatsLabel.textContent = 'Direct chats';
        var chatsWrap = document.createElement('div');

        /* FIX (2026-08-30 — "clicking Forward or Share only shows My
           Status, never Groups or Direct chats"): myId was captured ONCE,
           above (`var myId = _myId();`), at the exact moment this sheet
           opens. _myId() itself already has its own fix for reading the
           PERSISTENT id (window.userState.id) rather than the live Auth
           uid — but this codebase has a separately well-documented,
           repeating bug CLASS on top of that: window.userState.id can
           still be genuinely un-hydrated for a beat right after a fast
           navigation/section-open (see app-patch-v30.js's own header for
           the same race in a different feature — "host sees own live
           banner" — fixed there by RE-CHECKING a moment later rather than
           trusting a single read). This Share sheet can be opened very
           soon after landing on a screen (e.g. straight from a reel), so
           it's exposed to the exact same race. When that happens here,
           myId resolves to '' — `array-contains ''` is a valid query that
           matches nothing, no error, no permission-denied — structurally
           indistinguishable from "this account genuinely has zero groups
           and zero chats", which is exactly why the existing error-vs-
           empty distinction above never caught it. Fix: if myId is empty
           right when the sheet opens, re-resolve it once, shortly after,
           before ever running the queries — the same "wait, don't assume
           a single bad read is authoritative" pattern already established
           in this codebase. If it's STILL empty after that, this really
           is running with no id (not a guest — that's already handled by
           the _isGuest() check above — but some other, rarer local-state
           gap), and the queries would fail to load anyone's chats
           regardless of when they ran; running them anyway at that point
           is unchanged from today's existing behavior. */
        function _runShareDestinationQueries(resolvedMyId) {
            /* FIX (2026-08-30, same header as above): a genuinely-empty
               result now says so, instead of staying visually identical
               to "still loading" or "failed" — the three states were
               previously indistinguishable from each other in the UI. */
            var _settled = 0, _anyError = false, _anyRows = false;
            function _noteSettled(isError, gotRows) {
                _settled++;
                if (isError) _anyError = true;
                if (gotRows) _anyRows = true;
                if (_settled < 2) return; /* wait for both queries to finish */
                if (_anyRows) return; /* something loaded — nothing more to say */
                if (_anyError) {
                    var err = document.createElement('div');
                    err.className = 'emp-share-empty';
                    err.textContent = 'Couldn\u2019t load your groups/chats — check your connection and try again.';
                    list.appendChild(err);
                } else {
                    var empty = document.createElement('div');
                    empty.className = 'emp-share-empty';
                    empty.textContent = 'No groups or chats yet — start one from Messages first.';
                    list.appendChild(empty);
                }
            }

            window.fbDb.collection('groups').where('members', 'array-contains', resolvedMyId).get()
                .then(function (snap) {
                    if (snap.empty) { _noteSettled(false, false); return; }
                    list.appendChild(groupsLabel);
                    list.appendChild(groupsWrap);
                    snap.forEach(function (doc) {
                        var g = doc.data() || {};
                        var name = g.name || 'Group';
                        groupsWrap.appendChild(_row('group:' + doc.id, name, g.avatar || '', false, function () {
                            return { type: 'group', id: doc.id };
                        }));
                    });
                    _noteSettled(false, true);
                }).catch(function (err) {
                    console.warn('[EmpShare] groups query failed for uid=' + resolvedMyId + ':', err && err.code, err && err.message);
                    _noteSettled(true, false);
                });

            window.fbDb.collection('chats').where('participants', 'array-contains', resolvedMyId).get()
                .then(function (snap) {
                    if (snap.empty) { _noteSettled(false, false); return; }
                    var docs = [];
                    snap.forEach(function (doc) { docs.push(doc); });
                    return Promise.all(docs.map(function (doc) {
                        var d = doc.data() || {};
                        var parts = Array.isArray(d.participants) ? d.participants : [];
                        var peerId = parts.filter(function (id) { return id !== resolvedMyId; })[0];
                        if (!peerId) return null;
                        return _fetchProfile(peerId).then(function (p) { return { peerId: peerId, name: p.name, avatar: p.avatar }; });
                    })).then(function (rows) {
                        rows = rows.filter(Boolean);
                        if (!rows.length) { _noteSettled(false, false); return; }
                        list.appendChild(chatsLabel);
                        list.appendChild(chatsWrap);
                        rows.forEach(function (r) {
                            chatsWrap.appendChild(_row('chat:' + r.peerId, r.name, r.avatar, false, function () {
                                return { type: 'chat', id: r.peerId };
                            }));
                        });
                        _noteSettled(false, true);
                    });
                }).catch(function (err) {
                    console.warn('[EmpShare] chats query failed for uid=' + resolvedMyId + ':', err && err.code, err && err.message);
                    _noteSettled(true, false);
                });
        }

        if (myId) {
            _runShareDestinationQueries(myId);
        } else {
            _showDebug('_renderLevel2(): myId resolved empty on first read — retrying once shortly (userState.id hydration race, same class as app-patch-v30.js\'s own fix) before running groups/chats queries');
            setTimeout(function () {
                var retryId = _myId();
                if (!retryId) { _showDebug('_renderLevel2(): myId still empty after retry — running queries anyway, will show as "no groups or chats yet"'); }
                _runShareDestinationQueries(retryId || myId);
            }, 400);
        }

        searchInp.addEventListener('input', function () {
            var q = searchInp.value.trim().toLowerCase();
            list.querySelectorAll('.emp-share-row').forEach(function (r) {
                if (r.dataset.name === undefined) return; // 'My Status' row always visible
                r.style.display = (!q || r.dataset.name.indexOf(q) !== -1) ? '' : 'none';
            });
        });

        sendBar.addEventListener('click', _makeSendHandler(selected, payload));
    }

    function _makeSendHandler(selected, payload) {
        return function () {
            var targets = Object.keys(selected).map(function (k) { return selected[k]; });
            if (!targets.length) return;
            /* FEATURE (2026-08-02 — Forward vs Share spec): 'share' opens
               a one-screen composer (pre-filled with the original text/
               media, editable, with a real Send) before anything actually
               sends — matching the WhatsApp Share flow this was asked to
               mirror. 'forward' (the default, and the ONLY behavior this
               function had before this feature) is unchanged: it sends to
               every selected target immediately, with no editing step. */
            if (payload.mode === 'share') {
                _renderComposer(targets, payload);
                return;
            }
            targets.forEach(function (t) {
                if (t.type === 'group') _forwardToGroup(t.id, payload);
                else if (t.type === 'chat') _forwardToChat(t.id, payload);
            });
            _notify('Shared to ' + targets.length + (targets.length === 1 ? ' chat' : ' chats'), 'success');
            /* FIX (2026-08-01): same deferred-close pattern as the "My
               Status" row above, applied here too so the confirmation
               toast and sheet dismissal are never left waiting on an
               unrelated repaint to actually show up. */
            requestAnimationFrame(function () { requestAnimationFrame(_closeAll); });
        };
    }

    /* =========================================================================
       FEATURE (2026-08-02 — Forward vs Share spec) — SHARE COMPOSER
       One screen, shown after destinations are picked in Level 2, ONLY for
       mode:'share'. Pre-fills the original text (if any) into an editable
       textarea, shows a small media preview when payload.mediaUrl is set,
       and only sends once the person taps this screen's own Send — the
       exact "open the editing composer / allow adding comments or
       additional text" requirement from the spec. Forward (mode:'forward',
       the default) never reaches this function at all — it keeps sending
       immediately, unedited, straight from Level 2, exactly as it always
       has.
       ========================================================================= */
    function _renderComposer(targets, payload) {
        var wrap = document.createElement('div'); wrap.id = 'emp-share-wrap-composer'; wrap.className = 'emp-share-wrap';
        var ov = document.createElement('div'); ov.className = 'emp-share-ov';
        var sheet = document.createElement('div'); sheet.id = 'emp-share-sheet-composer'; sheet.className = 'emp-share-sheet';

        var head = document.createElement('div'); head.className = 'emp-share-head';
        head.innerHTML =
            '<button type="button" class="emp-share-back" aria-label="Back">&larr;</button>' +
            '<div class="emp-share-title" style="flex:1;">' + _esc('Share to ' + targets.length + (targets.length === 1 ? ' chat' : ' chats')) + '</div>' +
            '<button type="button" class="emp-share-close" aria-label="Close">&times;</button>';
        head.querySelector('.emp-share-back').addEventListener('click', function () { _renderLevel2(payload); });
        head.querySelector('.emp-share-close').addEventListener('click', _closeAll);
        sheet.appendChild(head);

        var body = document.createElement('div');
        body.style.cssText = 'padding:14px 16px 10px;';

        if (payload.mediaUrl) {
            var mt = (payload.mediaType || '').indexOf('video') !== -1 ? 'video' : 'image';
            var prev = document.createElement('div');
            prev.style.cssText = 'width:100%;max-height:220px;border-radius:12px;overflow:hidden;background:#000;margin-bottom:12px;display:flex;align-items:center;justify-content:center;';
            prev.innerHTML = mt === 'video'
                ? '<video src="' + _attr(payload.mediaUrl) + '" style="width:100%;max-height:220px;object-fit:contain;" muted playsinline></video>'
                : '<img src="' + _attr(payload.mediaUrl) + '" style="width:100%;max-height:220px;object-fit:contain;">';
            body.appendChild(prev);
        }

        var ta = document.createElement('textarea');
        ta.className = 'emp-share-composer-input';
        ta.placeholder = 'Add a comment…';
        ta.value = payload.text || '';
        ta.style.cssText = 'width:100%;min-height:70px;max-height:160px;resize:vertical;border:1px solid rgba(0,0,0,0.12);border-radius:12px;padding:10px 12px;font-size:0.92rem;font-family:inherit;box-sizing:border-box;';
        body.appendChild(ta);
        sheet.appendChild(body);

        var sendBtn = document.createElement('button');
        sendBtn.type = 'button';
        sendBtn.className = 'emp-share-composer-send';
        sendBtn.innerHTML = _ICONS.send + '<span>Send</span>';
        sheet.appendChild(sendBtn);

        wrap.appendChild(ov);
        wrap.appendChild(sheet);
        document.body.appendChild(wrap);
        void sheet.offsetHeight;
        _animateIn(sheet);
        ta.focus();

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                var oldWrap = document.getElementById('emp-share-wrap-l2'); if (oldWrap) oldWrap.remove();
            });
        });

        sendBtn.addEventListener('click', function () {
            if (sendBtn._sending) return; // guard against a double-tap firing this twice
            sendBtn._sending = true;
            var editedText = ta.value; // NOT trimmed-to-required — an image/video with no caption is valid, same as the original composer allows
            var sharedPayload = { text: editedText, mediaUrl: payload.mediaUrl, mediaType: payload.mediaType };
            targets.forEach(function (t) {
                /* markForwarded:false — this went through the person's own
                   editing composer, so it's sent as a normal (not
                   "Forwarded"-tagged) message, matching WhatsApp's own
                   behavior: a genuine unedited Forward carries the
                   "Forwarded" label, a Share you typed a comment on/
                   edited does not. */
                if (t.type === 'group') _forwardToGroup(t.id, sharedPayload, false);
                else if (t.type === 'chat') _forwardToChat(t.id, sharedPayload, false);
            });
            _notify('Shared to ' + targets.length + (targets.length === 1 ? ' chat' : ' chats'), 'success');
            requestAnimationFrame(function () { requestAnimationFrame(_closeAll); });
        });
    }

    /* =========================================================================
       FORWARDING — writes directly into the same collections/schema each
       chat type's own composer already uses (see app-patch-openchat.js's
       _doSend/_sendFile for 1:1, app-patch-v13.js's _send/_sendMedia for
       groups), so a forwarded message renders exactly like a normal one
       (through each screen's own live onSnapshot listener) with no extra
       client-side plumbing needed here.
       ========================================================================= */
    function _forwardToGroup(groupId, payload, markForwarded) {
        if (!_fbOk()) return;
        var myId = _myId();
        var msgId = 'gmsg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        var doc = {
            senderId: myId,
            senderName: (_us().fullName || _us().username || 'Someone'),
            text: payload.text || '',
            /* FEATURE (2026-08-02 — Forward vs Share spec): markForwarded
               defaults to true (undefined -> true below), so every
               EXISTING caller of this function keeps tagging its message
               "Forwarded" exactly as before. Only the new Share composer
               above passes markForwarded:false explicitly, since that
               message went through the person's own edit, and WhatsApp
               itself doesn't tag an edited Share the same way it tags an
               untouched Forward. */
            forwarded: markForwarded !== false,
            readBy: [myId],
            edited: false,
            deleted: false,
            createdAt: new Date().toISOString()
        };
        if (payload.mediaUrl) { doc.mediaUrl = payload.mediaUrl; doc.mediaType = _shortMediaType(payload.mediaType); }
        /* FIX (2026-08-30) — see the _writeWithRetry comment above: retries
           through a transient "no auth session yet" permission-denied
           instead of giving up on the very first attempt. */
        _writeWithRetry(
            function () { return window.fbDb.collection('groups').doc(groupId).collection('messages').doc(msgId).set(doc); },
            function (err) {
                _notify(err && err.code === 'permission-denied'
                    ? 'Could not forward to that group — you may no longer be a member.'
                    : 'Could not forward to that group.', 'error');
            }
        );
    }

    function _forwardToChat(peerId, payload, markForwarded) {
        if (!_fbOk()) return;
        var myId = _myId();
        var chatId = _buildChatId(myId, peerId);
        var msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '-fwd';
        var now = new Date().toISOString();
        var doc = {
            id: msgId, chatId: chatId,
            senderId: myId, receiverId: peerId,
            senderName: (_us().fullName || _us().username || 'Someone'),
            text: payload.text || '',
            forwarded: markForwarded !== false, // see _forwardToGroup's own comment on this same flag
            read: false, edited: false, deleted: false,
            createdAt: now
        };
        if (payload.mediaUrl) { doc.mediaUrl = payload.mediaUrl; doc.mediaType = _fullMediaType(payload.mediaType); }
        /* FIX (2026-08-30) — see the _writeWithRetry comment above. The
           secondary chats/{chatId} metadata write (lastMessage preview
           etc.) is left as its existing best-effort/silent-catch — it's
           non-critical and was never the write reported as failing; it now
           only fires once the retried message write has actually landed. */
        /* E2EE (2026-10-30): forwarded text is sealed for this chat like any other
           1:1 message (app-chat.js §0b). doc.text then holds the sealed string,
           which is also what the chat-list preview below carries. */
        var _fwdSeal = (window._empE2EE && typeof window._empE2EE.sealPayload === 'function')
            ? window._empE2EE.sealPayload(doc, peerId) : Promise.resolve(doc);
        _fwdSeal.then(function () {
        _writeWithRetry(
            function () { return window.fbDb.collection('messages').doc(msgId).set(doc); },
            function (err) {
                _notify(err && err.code === 'permission-denied'
                    ? 'Could not forward to that chat — please try again.'
                    : 'Could not forward to that chat.', 'error');
            },
            function () {
                window.fbDb.collection('chats').doc(chatId).set({
                    participants: [myId, peerId],
                    lastMessage: doc.text || (doc.mediaUrl ? 'Media' : ''),
                    lastMessageTime: now,
                    lastSenderId: myId
                }, { merge: true }).catch(function () {});
            }
        );
        }, function () { _notify('Could not encrypt this message — it was not forwarded.', 'error'); });
    }

    /* =========================================================================
       FIX (2026-08-02 — "Share to Status doesn't take users to the composer,
       have to manually re-navigate"): root cause was NOT the navigateTo()
       timing race already fixed below — it's a stacking-context problem.
       Both full-screen chat panels this Share sheet can be opened from sit
       WAY above #create-status-modal (z-index 8900):
         • 1:1 chat  — #chat-view-container.oc-mobile-open, z-index:99999
                       (app-patch-openchat.js)
         • Group chat — #v13-group-view, z-index:9999990 (this file, Part 2)
       _shareToStatus() already correctly opens the composer modal — it was
       just opening it BEHIND whichever of those two panels was still on
       screen, which is visually indistinguishable from "nothing happened."
       That's exactly what sent people hunting for the status composer
       manually. Fix: before doing anything else, close whichever panel is
       currently open by clicking its OWN close button (not by hiding/
       removing the DOM directly) — that runs each panel's real teardown
       (Firestore listener unsubscribe, history state cleanup, etc.)
       instead of leaving it half-alive off-screen. Safe to call even when
       neither panel is open (both lookups are simple existence checks). */
    function _closeAnyOpenChatScreen() {
        var ocBack = document.getElementById('oc-back-btn');
        if (ocBack && document.body.classList.contains('oc-chat-open')) {
            try { ocBack.click(); } catch (e) {}
        }
        var grpBack = document.getElementById('v13-grp-back');
        if (grpBack && document.getElementById('v13-group-view')) {
            try { grpBack.click(); } catch (e) {}
        }
        /* FIX (2026-08-30 — "Share to Status doesn't take the reel video to
           the status upload composer"): same stacking-context bug as the
           two chat panels above, for a THIRD full-screen panel this
           function didn't know about yet — the reel viewer
           (#reel-viewer-modal-overlay, app-reel.js — z-index 9900 per its
           own injected stylesheet, well above #create-status-modal's
           8900). Reels were wired into this same Share sheet more
           recently than the two panels above, so this guard never learned
           about a third panel to check. Left open, it visually covers
           both navigateTo('dashboard') and the composer underneath it —
           indistinguishable from "nothing happened," exactly the reported
           symptom. window._closeReelViewer is app-fix-final.js's own
           "authoritative close handler" for this exact overlay (real
           teardown — pauses/unloads the video, clears the container,
           restores body classes) — the same "call the real close path,
           don't just hide the DOM" approach already used for the two chat
           panels above, not a third, competing way of closing it. */
        var reelOverlay = document.getElementById('reel-viewer-modal-overlay');
        var reelIsOpen = reelOverlay && (reelOverlay.classList.contains('show') || document.body.classList.contains('reel-open'));
        if (reelIsOpen) {
            /* FIX (2026-08-30): prefer app-reel.js's OWN, more complete
               teardown (window._empReelCloseViewer — detaches live-count
               listeners, closes the shared comments drawer, resumes grid
               autoplay) over app-fix-final.js's window._closeReelViewer,
               which only handles the overlay/video/exit-button. Both were
               answering to "close the reel viewer" under different names;
               this makes sure the fuller one runs when it's available,
               falling back to the shorter one only if app-reel.js hasn't
               loaded for some reason — never worse than before. */
            var closeFn = (typeof window._empReelCloseViewer === 'function')
                ? window._empReelCloseViewer
                : window._closeReelViewer;
            if (typeof closeFn === 'function') {
                try { closeFn(); } catch (e) {}
            }
        }
    }

    /* =========================================================================
       FEATURE (2026-08-02 — Forward vs Share spec) — FORWARD TO STATUS
       Mirrors _forwardToGroup/_forwardToChat: writes directly into
       Firestore with no composer, no navigation, no "leaving the current
       screen" — the spec's own words ("Forwarding should be direct — no
       editing composer"). Reuses app-status.js's exact doc shape
       (statuses/status-{uid}, {userId,name,avatar,items,createdAt},
       merge:true) and its exact "keep existing live items, append the new
       one" merge behavior (see app-status.js's own post-status handler,
       which this deliberately matches item-for-item) so a forwarded status
       is indistinguishable, once posted, from one created through the
       normal composer — just without stopping to ask for a caption first.
       payload.mediaUrl is already a public, already-hosted URL (Cloudinary,
       from the original message) — unlike _shareToStatus's composer path,
       there's no upload step needed here at all. */
    function _forwardToStatus(payload) {
        if (_isGuest()) {
            if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
            return;
        }
        var us = _us();
        var uid = us.id || _myId();
        if (!uid) { _notify('Could not forward to status — try again in a moment.', 'warning'); return; }

        var bg = 'linear-gradient(135deg,#0A0E27,#1B2B8B)'; // same default the composer's own color-cycler starts on
        var item = {
            id: 'si-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
            type: payload.mediaUrl ? (_isVideoType(payload.mediaType) ? 'video' : 'image') : 'text',
            url: payload.mediaUrl || '',
            content: payload.text || '',
            bg: bg,
            createdAt: new Date().toISOString(),
            likes: 0, retweets: 0, likedBy: [], retweetedBy: [], viewers: []
        };

        window.userStatuses = window.userStatuses || [];
        var idx = window.userStatuses.findIndex(function (s) { return s.userId === uid; });
        var existing = idx > -1 ? window.userStatuses[idx] : null;
        // Same "keep whatever's still live, append the new one" merge
        // app-status.js's own submit handler uses — a forward must not
        // wipe out a status the person already has up.
        var keptItems = existing && Array.isArray(existing.items)
            ? existing.items.filter(function (it) {
                var ts = new Date(it.createdAt).getTime();
                return isFinite(ts) && (Date.now() - ts) < (24 * 60 * 60 * 1000);
            })
            : [];
        var mergedItems = keptItems.concat([item]);
        var docId = 'status-' + uid;
        var doc = {
            userId: uid,
            name: us.fullName || us.username || 'User',
            avatar: us.avatar || '',
            items: mergedItems,
            viewed: false,
            createdAt: (existing && existing.createdAt) || new Date().toISOString(),
            docId: docId
        };

        if (idx > -1) window.userStatuses[idx] = doc; else window.userStatuses.unshift(doc);
        if (typeof window.renderStatusBar === 'function') window.renderStatusBar();

        if (!_fbOk()) { _notify('Forwarded to status locally — will sync once you\u2019re back online.', 'info'); return; }
        /* FIX (2026-08-30) — see the _writeWithRetry comment above. */
        _writeWithRetry(
            function () {
                return window.fbDb.collection('statuses').doc(docId).set({
                    userId: doc.userId, name: doc.name, avatar: doc.avatar,
                    items: mergedItems, createdAt: doc.createdAt
                }, { merge: true });
            },
            function (err) {
                _notify(err && err.code === 'permission-denied'
                    ? 'Could not forward to status — please try again.'
                    : 'Could not forward to status — try again.', 'error');
            },
            function () {
                _notify('Forwarded to your status.', 'success');
            }
        );
    }

    /* =========================================================================
       STATUS — generalized version of the fetch → File → #status-file-input
       handoff app-patch-openchat.js / app-patch-v13.js already had; this one
       also handles a text-only share (those two never needed to, since they
       only offered "Share to Status" for image/video messages).
       ========================================================================= */
    /* FIX (2026-08-02 — "Share to Status takes users out of the flow
       instead of landing them in the editor"): this used to call
       _openModal() synchronously, immediately after firing
       navigateTo('dashboard') — before that navigation had actually
       finished doing its own work. _shareGroupMediaToStatus and
       _shareMediaToStatus (the group-chat and 1:1-media-message share
       paths a few hundred lines up / in app-patch-openchat.js) never had
       this bug because they only open the modal AFTER the media fetch
       resolves, which gives navigateTo() a full network round-trip to
       settle first. This path had no such delay for the common case
       (sharing a photo/video), so the modal could get opened while
       navigateTo was still mid-flight and get swept away by whatever
       cleanup navigateTo performs on route change.

       SECOND BUG (2026-08-02, found via user report that tapping "My
       Status" then sending instead forwards back into the chat): even
       with the ordering above fixed, #create-status-modal and
       #status-file-input were still captured into `modal`/`fileInp`
       variables ONCE, at the very top of this function — BEFORE
       navigateTo('dashboard') runs. If navigateTo() re-renders any part
       of the DOM those elements live in (routers commonly re-render the
       target section on every call, even when already on it, to refresh
       its data), those captured references go stale: they point at
       detached nodes that have already been replaced by fresh ones.
       Setting .style.display on a detached node is a silent no-op, and
       dispatching a 'change' event on a detached input never reaches the
       live listener app-status.js actually has attached to the NEW node
       — so nothing visibly happens, the person assumes the tap did
       nothing, and goes back to forward the media as a normal chat
       message instead. Fix: stop caching these elements up front —
       re-query #create-status-modal / #status-file-input / #status-text-input
       fresh at the exact moment each is used (inside _openModal, and
       again after the fetch resolves), so we're always touching
       whatever is actually live in the DOM at that point, not a
       snapshot from before navigateTo ran. */
    function _shareToStatus(payload) {
        _closeAnyOpenChatScreen();
        if (typeof window.navigateTo === 'function') window.navigateTo('dashboard');

        function _openModal() {
            var modal = document.getElementById('create-status-modal');
            if (!modal) {
                _showDebug('_shareToStatus._openModal(): #create-status-modal not found in DOM (post-navigateTo)');
                _notify('Status feature is still loading — try again in a moment.', 'info');
                return null;
            }
            modal.style.display = 'flex';
            modal.classList.add('show');
            document.body.classList.add('modal-open');
            /* app-status.js's own MutationObserver also does this, but call
               it directly too so the submit button is guaranteed visible
               right away rather than waiting a tick. */
            if (typeof window._empScrollStatusModalToBottom === 'function') window._empScrollStatusModalToBottom();
            _showDebug('_shareToStatus._openModal(): modal.style.display=' + modal.style.display + ' classList=' + modal.className);
            return modal;
        }

        function _prefillText() {
            var textEl = document.getElementById('status-text-input');
            if (textEl && payload.text && !textEl.value) textEl.value = payload.text;
        }

        if (!payload.mediaUrl) {
            /* Text-only share: nothing async to wait on, so there's no
               navigateTo race to protect against here — open right away,
               same as before. */
            _openModal();
            _prefillText();
            return;
        }

        /* FIX (2026-08-30 follow-up — "shared video doesn't move to the
           status uploader", still reproducing after the modal-first
           ordering fix below): confirmed via screenshot the device is on a
           genuinely poor connection (console showed sub-1KB/s throughput).
           fetch()-ing the whole video into a Blob here — just to feed it
           through #status-file-input so app-status.js re-uploads those
           SAME bytes again on "Post Status" — is a full extra round-trip
           of the media that a connection that slow may never finish. Since
           payload.mediaUrl is already a public, hosted url, there's no
           need to round-trip it through this device at all:
           app-status.js's own _empAttachRemoteStatusMedia() shows the
           identical preview directly against that url (streamed, never
           fetched into a Blob) and its "Post Status" submit handler posts
           that same url as-is. Falls through to the old fetch-into-File
           path below only if that function isn't available (an older
           app-status.js build still loaded), so this can never regress to
           a dead tap. */
        if (typeof window._empAttachRemoteStatusMedia === 'function') {
            _openModal();
            var attached = window._empAttachRemoteStatusMedia(payload.mediaUrl, payload.mediaType);
            if (!attached) {
                _notify('Could not auto-attach that media — please add it again from "Add photos or videos".', 'warning');
            }
            _prefillText();
            return;
        }

        _notify('Preparing to share to your status…', 'info');

        fetch(payload.mediaUrl)
            .then(function (r) { if (!r.ok) throw new Error('fetch http ' + r.status); return r.blob(); })
            .then(function (blob) {
                var fileInp = document.getElementById('status-file-input');
                if (!fileInp) {
                    _showDebug('_shareToStatus: #status-file-input not found post-fetch (post-navigateTo)');
                    _openModal();
                    _notify('Could not auto-attach that media — please add it again from "Add photos or videos".', 'warning');
                    return;
                }
                /* FIX (2026-08-30 — "shared video doesn't move to the status
                   uploader", confirmed via screenshot: the preview box stays
                   a permanently empty, error-free rectangle): this used to
                   assign the file and dispatch 'change' FIRST, then call
                   _openModal() afterwards — so app-status.js's own 'change'
                   handler built the preview <video>/<img>, inserted it into
                   #status-file-preview, and set its src while
                   #create-status-modal (and therefore that whole preview
                   container) still had display:none. On the mobile WebView
                   this was reproduced on, a <video> never starts decoding
                   when its ancestor chain is display:none at the moment its
                   src is assigned, and never retroactively picks it up once
                   the ancestor becomes visible later — so the box stayed
                   empty forever, with no error (app-status.js's own 6s
                   timeout/error handling only fires for a genuinely FAILED
                   decode, not one that was never given the chance to start).
                   Opening the modal FIRST guarantees #status-file-preview is
                   already visible and rendered by the time the file is
                   attached and 'change' fires. */
                _openModal();
                var isVideo = _isVideoType(payload.mediaType);
                var ext = isVideo ? 'mp4' : 'jpg';
                var mime = blob.type || (isVideo ? 'video/mp4' : 'image/jpeg');
                var file = new File([blob], 'shared-status.' + ext, { type: mime });
                var dt = new DataTransfer();
                dt.items.add(file);
                fileInp.files = dt.files;
                fileInp._lastChangeSig = '';
                fileInp.dispatchEvent(new Event('change', { bubbles: true }));
                _prefillText();
            })
            .catch(function () {
                /* Media couldn't be fetched into a File (offline, or the
                   host blocking cross-origin fetch) — still open the
                   composer so the person isn't stuck with a dead tap, they
                   just need to re-attach the media manually via "Add
                   photos or videos". */
                _openModal();
                _notify('Could not auto-attach that media — please add it again from "Add photos or videos".', 'warning');
            });
    }

    /* =========================================================================
       EXTERNAL — WhatsApp deep link + native OS share / clipboard fallback.
       WhatsApp Web/mobile has no public API to accept an in-page File
       object, so media is shared as a link (Cloudinary URLs are already
       public HTTPS links) alongside any caption text — the same approach
       every "Share to WhatsApp" web button uses.
       ========================================================================= */
    function _shareToWhatsApp(payload) {
        var text = (payload.text || '').trim();
        var link = payload.mediaUrl || payload.pageUrl || window.location.href;
        var full = (text ? text + ' ' : '') + link;
        window.open('https://wa.me/?text=' + encodeURIComponent(full.trim()), '_blank');
    }

    function _shareNative(payload) {
        var shareData = { title: 'Empyrean International' };
        if (payload.text) shareData.text = payload.text;
        shareData.url = payload.mediaUrl || payload.pageUrl || window.location.href;
        navigator.share(shareData).catch(function (err) {
            if (err && err.name !== 'AbortError') _copyLink(payload);
        });
    }

    /* =========================================================================
       EXTERNAL — Facebook, via Facebook's own official sharer.php dialog
       instead of the generic OS share sheet's "Facebook" target.
       FIX (report — "the link showing is too conspicuous [...] only the
       join empyrean domain [as seen below the video, i.e. the preview
       card] should display"): going through the OS's generic share sheet
       (Android ACTION_SEND) to Facebook hands this app's text/url
       straight to Facebook's REGULAR status composer, which pastes the
       raw url in as plain, visible, auto-linked post text and THEN,
       separately, scrapes that same url's OG tags into a preview card
       underneath — so the person ends up with both the ugly raw link
       AND the card. That composer behavior belongs to the Facebook app
       itself; no url/text this app hands to a generic share intent can
       suppress it. Facebook's own official share dialog (sharer.php)
       does not have that problem: it opens with an EMPTY caption box
       (the person can still type their own words) plus only the
       scraped preview card — no raw url anywhere in the resulting post.
       Prioritizes payload.pageUrl (this app's own '?post=<id>' permalink,
       which server.js tags with real og:title/og:image/og:video meta —
       see app-link-preview.js) over payload.mediaUrl (opposite priority
       from _shareToWhatsApp above): a raw Cloudinary/Storage video FILE
       url has no HTML/OG tags at all, so sharer.php could build no
       preview card from it. Also strips fbclid/utm_* params before
       handing the url to sharer.php — those get appended by Facebook
       itself the first time a link is opened via a Facebook-originated
       click, so a person who reached this reel that way and then shared
       it again would otherwise carry that clutter straight back into a
       new post. */
    function _shareToFacebook(payload) {
        var link = payload.pageUrl || payload.mediaUrl || window.location.href;
        try {
            var u = new URL(link, window.location.origin);
            ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (p) { u.searchParams.delete(p); });
            link = u.toString();
        } catch (e) { /* malformed/relative url — share as-is rather than block the tap */ }
        window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(link), '_blank');
    }

    function _copyLink(payload) {
        var url = payload.mediaUrl || payload.pageUrl || window.location.href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(function () { _notify('Link copied!', 'success'); }).catch(function () {});
        }
    }

    /* =========================================================================
       FEED LONG-PRESS HIGHLIGHT — visual parity with the chat long-press
       flow (app-patch-openchat.js / app-patch-v13.js already highlight a
       message row on long-press). Feed posts' Share button is already
       always visible (unlike a chat bubble, which needs the long-press just
       to reveal any actions at all), so this doesn't gate anything — it's
       purely the same "you've selected this post" visual cue before tapping
       Share, delegated so it works on posts rendered after this file loads
       too. */
    function _injectFeedHighlightStyle() {
        if (document.getElementById('emp-share-feed-style')) return;
        var st = document.createElement('style');
        st.id = 'emp-share-feed-style';
        st.textContent = '.emp-post-selected{outline:2px solid rgba(27,43,139,0.35);outline-offset:-2px;border-radius:12px;background:rgba(27,43,139,0.04);transition:background .15s;}';
        document.head.appendChild(st);
    }
    (function _wireFeedLongPress() {
        _injectFeedHighlightStyle();
        var CARD_SEL = '.impact-story, .story-card, .crisis-card, .news-card, .business-card';
        var _timer = null, _sx = 0, _sy = 0;
        function _clearSoon(card) { setTimeout(function () { card.classList.remove('emp-post-selected'); }, 2500); }
        document.addEventListener('touchstart', function (e) {
            var card = e.target.closest && e.target.closest(CARD_SEL);
            if (!card) return;
            var pt = e.touches[0]; _sx = pt.clientX; _sy = pt.clientY;
            clearTimeout(_timer);
            _timer = setTimeout(function () { card.classList.add('emp-post-selected'); _clearSoon(card); }, 450);
        }, { passive: true });
        document.addEventListener('touchmove', function (e) {
            if (!_timer) return;
            var pt = e.touches[0];
            if (Math.abs(pt.clientX - _sx) > 10 || Math.abs(pt.clientY - _sy) > 10) { clearTimeout(_timer); _timer = null; }
        }, { passive: true });
        document.addEventListener('touchend', function () { clearTimeout(_timer); _timer = null; }, { passive: true });
    })();

    window.EmpShare = { open: open };
    console.log('[EmpyreanPatchV50] \u2705 Universal Share sheet ready (Empyrean status/chats/groups + WhatsApp + native share).');
})();