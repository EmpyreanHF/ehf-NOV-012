/* =============================================================================
   EMPYREAN INTERNATIONAL — app-patch-calls-log.js
   Load order: AFTER app-patch-v20.js (needs its #v20-chat-tabs bar and
   #contacts-inner already built), app-patch-openchat.js (1:1 `calls`
   collection + chat header call buttons), app-patch-group-call.js
   (`group_calls` collection + window._empGroupCallStart), and
   app-patch-v13.js/v14.js (groups list / group identity cache).

   FEATURE — CALLS LOG (WhatsApp-style reference screenshot), placed as a
   5th tab/segment INSIDE the existing Messages screen (Chats | Groups |
   Broadcasts | Marketplace | Calls), per this session's own choice —
   NOT a new bottom-nav tab.

   WHAT THIS SHOWS
     Ongoing — any of the user's groups with an ACTIVE group_calls/{id}
       doc: group name/avatar, "Ongoing voice/video chat", a live avatar
       stack of who's currently on the call (group_calls/{id}/peers), and
       a Join button that calls the EXISTING window._empGroupCallStart
       (app-patch-group-call.js) — that function already handles "join an
       already-active call" transparently, so no new join logic is needed
       here at all.
     Recent — 1:1 call history, read straight from the `calls` collection
       app-patch-openchat.js ALREADY writes a full history record onto
       (participants/finalStatus/duration/endedAt — see that file's own
       "CALL LOG" comment block). No new collection, no new writes.
       Direction (incoming/outgoing), missed/declined/duration, and a
       tap-to-call-back action are all derived from data that already
       exists.

   WHY THIS IS A NEW FILE, NOT EDITS TO v20/openchat/group-call
   Everything needed is either already public (window._empGroupCallStart,
   window.openChat) or plain Firestore reads this file can do on its own
   (`groups`, `group_calls`, `group_calls/{id}/peers`, `calls`) — there is
   NOTHING here that requires reaching into any of those files' private
   closures, so unlike v33/v35/v37 (which genuinely needed a source edit),
   this one is 100% additive. The one exception is placing an actual 1:1
   call-back tap: app-patch-openchat.js's _startCallModal() only reads its
   OWN private `_peerId` (whichever chat is currently open), not a
   parameter — so rather than edit that closure, this file opens the
   target chat via the already-public window.openChat(otherId) (which
   sets _peerId as a normal side effect of opening a chat) and then taps
   that chat's own existing "Voice call"/"Video call" header button
   programmatically. Same call path a person would use manually — no new
   calling logic invented.

   HOW THE TAB IS ADDED WITHOUT TOUCHING app-patch-v20.js
   v20's own #v20-chat-tabs bar and #contacts-inner are plain DOM, not
   private — a 5th button is appended to the SAME bar, and a 5th section
   is appended to the SAME #contacts-inner v20 already uses for its own
   Groups/Broadcasts/Marketplace sections. Switching TO this tab hides
   every other direct child of #contacts-inner directly (belt-and-
   suspenders) and also writes v20's own localStorage tab key to a value
   ('calls') that doesn't match any of v20's OWN cases, so if v20's own
   MutationObserver-driven _applyFilter() re-runs for any reason it also
   naturally leaves everything else hidden instead of fighting this file.
   Switching AWAY from this tab hands off by literally clicking whichever
   v20 tab button was active before — that runs v20's own real
   setTab/paint/applyFilter/watcher logic exactly as if the person had
   tapped it themselves, instead of this file trying to reimplement it.

   FIRESTORE: needs a composite index for
     calls: participants (array-contains) + createdAt (desc)
   If that index doesn't exist yet, Firestore's error will be
   'failed-precondition' with a direct console link to create it — logged
   below rather than guessed at silently.

   ═══════════════════════════════════════════════════════════════════════
   ADDED THIS SESSION — STATUS RING IN THE CALL LOG ONLY
   ═══════════════════════════════════════════════════════════════════════
   Status/Stories is still hidden everywhere else in the Messages screen
   (app-patch-v20.js's own #status-bar-container gating, untouched) — this
   is the one place it's now allowed to surface: a 24h avatar ring (same
   gradient-while-unviewed / gray-once-viewed visual language as
   app-status.js's own .status-avatar-ring), around the 1:1 avatar in
   Recent and each peer avatar in the Ongoing group-call stack, for any
   user with a live status right now. Tapping a ringed avatar opens that
   person's status via window.openStatusViewer(); tapping the rest of the
   row keeps its existing action (call-back / Join) untouched. Needed one
   minimal, additive export from app-status.js — window._empUserHasLiveStatus()
   — so this file doesn't re-implement that file's Firestore-Timestamp/
   seconds-object/ISO-string expiry parsing a second time (see that
   file's own comment at the export for why).
   ============================================================================= */

(function empyreanCallsLog() {
    'use strict';

    if (window._empCallsLogLoaded) {
        console.warn('[CallsLog] Already loaded — skipping duplicate.');
        return;
    }
    window._empCallsLogLoaded = true;

    function log(msg) { console.log('[CallsLog] ' + msg); }
    function warn(msg, err) { console.warn('[CallsLog] ' + msg, err && (err.message || err)); }
    function notify(msg, type) { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); }
    function _fbOk() { return !!(window._firebaseLoaded && window.fbDb); }
    function _authUid() { try { return (window.fbAuth && window.fbAuth.currentUser && window.fbAuth.currentUser.uid) || null; } catch (e) { return null; } }
    function _us() { return (window.EmpState && window.EmpState.userState) || window.userState || {}; }
    function _myId() { return _authUid() || _us().id || ''; }
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function _ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

    /* =========================================================================
       §0 — STATUS RING (feature: "status story should display in the call
       log alone" — Status/Stories stays hidden everywhere else in Messages,
       per the existing app-patch-v20.js gating; this is the one place it's
       now allowed to surface, as a 24h avatar ring, same visual language as
       app-status.js's own .status-avatar-ring / .status-card-avatar-ring —
       gradient for an unviewed live status, gray once viewed, nothing at
       all once the status expires past 24h or the person has none.
       Reuses app-status.js's new window._empUserHasLiveStatus() lookup
       rather than re-parsing timestamps here.
       ========================================================================= */
    function _statusRingWrap(innerHtml, userId, size, extraStyle) {
        var info = (typeof window._empUserHasLiveStatus === 'function') ? window._empUserHasLiveStatus(userId) : null;
        if (!info) {
            // No live status — render exactly as before, just consistently
            // wrapped so callers (stack overlap margins, flex-shrink) don't
            // need two different code paths.
            return '<span style="display:inline-flex;' + (extraStyle || '') + '">' + innerHtml + '</span>';
        }
        var pad = Math.max(2, Math.round(size * 0.06));
        var ringSize = size + pad * 2;
        var bg = info.viewed ? 'rgba(180,180,180,0.55)' : 'linear-gradient(135deg,#00D4AA,#1B2B8B)';
        return '<div class="emp-call-status-ring" data-status-uid="' + _esc(userId) + '" title="View status" ' +
            'style="width:' + ringSize + 'px;height:' + ringSize + 'px;border-radius:50%;padding:' + pad + 'px;' +
            'background:' + bg + ';box-sizing:border-box;display:flex;align-items:center;justify-content:center;cursor:pointer;' + (extraStyle || '') + '">' +
            innerHtml +
            '</div>';
    }

    function _openStatusForUid(userId) {
        var info = (typeof window._empUserHasLiveStatus === 'function') ? window._empUserHasLiveStatus(userId) : null;
        if (!info) return; // status expired/removed between render and tap — nothing to open
        if (typeof window.openStatusViewer === 'function') window.openStatusViewer(info.idx);
        else if (typeof window._openStatusViewer === 'function') window._openStatusViewer(info.idx);
    }

    // Wires every .emp-call-status-ring currently inside `root` — called
    // right after each render, same convention this file already uses for
    // .emp-call-back-btn / .emp-call-join-btn. Per-element listeners (not
    // one document-level delegate) so stopPropagation reliably beats the
    // row's own click-to-call-back / click-to-join handler regardless of
    // DOM depth/bubble order.
    function _wireStatusRings(root) {
        if (!root) return;
        root.querySelectorAll('.emp-call-status-ring').forEach(function (ring) {
            ring.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                _openStatusForUid(ring.dataset.statusUid);
            });
        });
    }

    var TAB_KEY = 'emp_msgs_active_tab';
    var _active = false;
    var _prevTab = 'chats';

    /* =========================================================================
       §1 — the tab button itself, appended to v20's existing bar.
       ========================================================================= */
    function _ensureTabButton() {
        var bar = document.getElementById('v20-chat-tabs');
        if (!bar) return;
        if (document.getElementById('emp-calls-tab')) return;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'emp-calls-tab';
        btn.className = 'v20-chat-tab';
        btn.dataset.tab = 'calls';
        btn.textContent = 'Calls';
        btn.style.cssText =
            'flex:1;background:none;border:none;padding:12px 6px;cursor:pointer;' +
            'font-size:0.82rem;font-weight:700;color:var(--text-muted,#6B7280);' +
            'border-bottom:2.5px solid transparent;transition:color .15s,border-color .15s;';
        btn.addEventListener('click', function () { _activate(); });
        bar.appendChild(btn);

        /* Delegated on the bar, added AFTER v20's own per-button listeners
           are already wired (they're wired at button-creation time, before
           this file's script even runs) — so this only ever reacts to a
           tap on one of v20's OWN tabs, never intercepts or replaces their
           own handling of it. */
        bar.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('.v20-chat-tab');
            if (!b || b === btn) return;
            if (_active) _deactivate();
        });
    }

    /* =========================================================================
       §2 — activate / deactivate. Deactivating hands off to v20's own real
       tab-switch logic (by clicking its actual button) rather than trying
       to reimplement setTab/paint/applyFilter/watcher wiring here.
       ========================================================================= */
    function _hideOtherSections() {
        var inner = document.getElementById('contacts-inner');
        if (!inner) return;
        Array.prototype.forEach.call(inner.children, function (c) {
            if (c.id === 'emp-calls-log-section') return;
            c.style.display = 'none';
        });
    }

    function _ensureSection() {
        var inner = document.getElementById('contacts-inner');
        var existing = document.getElementById('emp-calls-log-section');
        if (existing) { if (inner && existing.parentNode !== inner) inner.appendChild(existing); return existing; }
        var section = document.createElement('div');
        section.id = 'emp-calls-log-section';
        section.innerHTML =
            '<div id="emp-calls-ongoing" style="padding:12px 16px 0;"></div>' +
            '<div id="emp-calls-recent" style="padding:6px 16px 16px;"></div>';
        if (inner) inner.appendChild(section);
        return section;
    }

    function _activate() {
        if (_active) return;
        _active = true;
        try { _prevTab = localStorage.getItem(TAB_KEY) || 'chats'; } catch (e) { _prevTab = 'chats'; }
        try { localStorage.setItem(TAB_KEY, 'calls'); } catch (e) {}

        var bar = document.getElementById('v20-chat-tabs');
        if (bar) {
            bar.querySelectorAll('.v20-chat-tab').forEach(function (b) {
                if (b.id === 'emp-calls-tab') return;
                b.style.color = 'var(--text-muted,#6B7280)';
                b.style.borderBottomColor = 'transparent';
            });
        }
        var mine = document.getElementById('emp-calls-tab');
        if (mine) { mine.style.color = 'var(--secondary,#1B2B8B)'; mine.style.borderBottomColor = 'var(--secondary,#1B2B8B)'; }

        _hideOtherSections();
        var section = _ensureSection();
        section.style.display = '';

        _startWatchers();
    }

    function _deactivate() {
        if (!_active) return;
        _active = false;
        _stopWatchers();

        var section = document.getElementById('emp-calls-log-section');
        if (section) section.style.display = 'none';

        var mine = document.getElementById('emp-calls-tab');
        if (mine) { mine.style.color = 'var(--text-muted,#6B7280)'; mine.style.borderBottomColor = 'transparent'; }

        var bar = document.getElementById('v20-chat-tabs');
        var target = bar && bar.querySelector('.v20-chat-tab[data-tab="' + _prevTab + '"]');
        if (target) target.click();
    }

    /* =========================================================================
       §3 — data watchers.
       ========================================================================= */
    var _groupsUnsub = null;
    var _groupsCache = {};        // groupId -> {id,name,avatar}
    var _groupCallUnsubs = {};    // groupId -> unsub
    var _activeGroupCalls = {};   // groupId -> group_calls doc data
    var _peersUnsubs = {};        // groupId -> unsub
    var _peersCache = {};         // groupId -> [{uid,name,avatar}]

    var _callsUnsub = null;
    var _callsRows = {};          // callId -> calls doc data

    function _teardownPeers(groupId) {
        if (_peersUnsubs[groupId]) { try { _peersUnsubs[groupId](); } catch (e) {} delete _peersUnsubs[groupId]; }
        delete _peersCache[groupId];
    }
    function _watchPeers(groupId) {
        if (_peersUnsubs[groupId]) return;
        _peersUnsubs[groupId] = window.fbDb.collection('group_calls').doc(groupId).collection('peers')
            .onSnapshot(function (snap) {
                _peersCache[groupId] = snap.docs.map(function (d) {
                    var p = d.data() || {};
                    return { uid: d.id, name: p.name || 'Guest', avatar: p.avatar || '' };
                });
                _renderOngoing();
            }, function () { /* peers list is cosmetic — fail quiet */ });
    }

    function _teardownGroupCallWatch(groupId) {
        if (_groupCallUnsubs[groupId]) { try { _groupCallUnsubs[groupId](); } catch (e) {} delete _groupCallUnsubs[groupId]; }
        _teardownPeers(groupId);
        delete _activeGroupCalls[groupId];
    }
    function _watchGroupCall(groupId) {
        if (_groupCallUnsubs[groupId]) return;
        _groupCallUnsubs[groupId] = window.fbDb.collection('group_calls').doc(groupId).onSnapshot(function (doc) {
            if (doc.exists && doc.data().status === 'active') {
                _activeGroupCalls[groupId] = doc.data();
                _watchPeers(groupId);
            } else {
                delete _activeGroupCalls[groupId];
                _teardownPeers(groupId);
            }
            _renderOngoing();
        }, function (err) { warn('group_calls listener error for ' + groupId, err); });
    }

    function _startWatchers() {
        if (!_fbOk()) { setTimeout(_startWatchers, 800); return; }
        var myId = _myId();
        if (!myId) { setTimeout(_startWatchers, 800); return; }

        if (!_groupsUnsub) {
            _groupsUnsub = window.fbDb.collection('groups').where('members', 'array-contains', myId)
                .onSnapshot(function (snap) {
                    snap.docChanges().forEach(function (ch) {
                        var id = ch.doc.id;
                        if (ch.type === 'removed') {
                            delete _groupsCache[id];
                            _teardownGroupCallWatch(id);
                        } else {
                            var d = ch.doc.data() || {};
                            _groupsCache[id] = { id: id, name: d.name || 'Group', avatar: d.avatar || '' };
                            _watchGroupCall(id);
                        }
                    });
                    _renderOngoing();
                }, function (err) {
                    warn('groups listener error', err);
                    notify('Could not check for ongoing group calls right now.', 'warning');
                });
        }

        if (!_callsUnsub) {
            _callsUnsub = window.fbDb.collection('calls')
                .where('participants', 'array-contains', myId)
                .orderBy('createdAt', 'desc').limit(40)
                .onSnapshot(function (snap) {
                    snap.docChanges().forEach(function (ch) {
                        if (ch.type === 'removed') delete _callsRows[ch.doc.id];
                        else _callsRows[ch.doc.id] = ch.doc.data();
                    });
                    _renderRecent();
                }, function (err) {
                    warn('calls listener error', err);
                    if (err && err.code === 'failed-precondition') {
                        notify('Recent calls needs a one-time Firestore index — check the console for the create-index link.', 'warning');
                    } else {
                        notify('Could not load recent calls right now.', 'warning');
                    }
                });
        }
    }

    function _stopWatchers() {
        if (_groupsUnsub) { try { _groupsUnsub(); } catch (e) {} _groupsUnsub = null; }
        if (_callsUnsub) { try { _callsUnsub(); } catch (e) {} _callsUnsub = null; }
        Object.keys(_groupCallUnsubs).forEach(_teardownGroupCallWatch);
        _groupCallUnsubs = {};
        _activeGroupCalls = {};
        _callsRows = {};
    }

    /* =========================================================================
       §4 — rendering.
       ========================================================================= */
    function _fmtWhen(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        var now = new Date();
        var diffMin = Math.floor((now - d) / 60000);
        if (diffMin < 1) return 'Just now';
        if (diffMin < 60) return diffMin + ' minute' + (diffMin === 1 ? '' : 's') + ' ago';
        var isToday = d.toDateString() === now.toDateString();
        if (isToday) return diffMin < 1440
            ? 'Today, ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        var yest = new Date(now); yest.setDate(yest.getDate() - 1);
        if (d.toDateString() === yest.toDateString()) return 'Yesterday, ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    function _fmtDuration(sec) {
        sec = sec || 0;
        var m = Math.floor(sec / 60), s = sec % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function _renderOngoing() {
        var wrap = document.getElementById('emp-calls-ongoing');
        if (!wrap) return;
        var ids = Object.keys(_activeGroupCalls);
        if (!ids.length) { wrap.innerHTML = ''; return; }

        var html = '<div style="font-weight:800;font-size:0.95rem;margin-bottom:8px;">Ongoing</div>';
        ids.forEach(function (gid) {
            var g = _groupsCache[gid] || { name: 'Group', avatar: '' };
            var call = _activeGroupCalls[gid];
            var peers = _peersCache[gid] || [];
            var isVideo = call.type === 'video';

            var avatarHtml = g.avatar
                ? '<img src="' + _esc(g.avatar) + '" style="width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
                : '<div style="width:48px;height:48px;border-radius:50%;background:#1B2B8B;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;">' + _esc((g.name || 'G').charAt(0).toUpperCase()) + '</div>';

            var stackHtml = '';
            peers.slice(0, 4).forEach(function (p, i) {
                var src = p.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(p.name) + '&background=1B2B8B&color=fff');
                var peerImg = '<img src="' + _esc(src) + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover;border:2px solid #fff;display:block;">';
                stackHtml += _statusRingWrap(peerImg, p.uid, 26, i ? 'margin-left:-8px;' : '');
            });
            if (peers.length > 4) {
                stackHtml += '<span style="margin-left:-8px;width:26px;height:26px;border-radius:50%;background:#E4E6EB;color:#444;font-size:0.68rem;font-weight:700;display:inline-flex;align-items:center;justify-content:center;border:2px solid #fff;">+' + (peers.length - 4) + '</span>';
            }

            html +=
                '<div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;background:rgba(27,43,139,0.05);margin-bottom:10px;">' +
                    avatarHtml +
                    '<div style="flex:1;min-width:0;">' +
                        '<div style="font-weight:700;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(g.name) + '</div>' +
                        '<div style="font-size:0.78rem;color:#6B7280;">Ongoing ' + (isVideo ? 'video' : 'voice') + ' chat</div>' +
                        '<div style="display:flex;align-items:center;gap:10px;margin-top:8px;">' +
                            '<button class="emp-call-join-btn" data-group-id="' + _esc(gid) + '" style="background:#111;color:#fff;border:none;border-radius:20px;padding:7px 18px;font-weight:700;font-size:0.82rem;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">' +
                                '<svg viewBox="0 0 24 24" width="13" height="13" fill="#fff"><path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z"/></svg>Join' +
                            '</button>' +
                            (stackHtml ? '<div style="display:flex;align-items:center;">' + stackHtml + '</div>' : '') +
                        '</div>' +
                    '</div>' +
                '</div>';
        });
        wrap.innerHTML = html;

        wrap.querySelectorAll('.emp-call-join-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var gid = btn.dataset.groupId;
                if (typeof window._empGroupCallStart === 'function') window._empGroupCallStart(gid);
                else notify('Group calling isn\u2019t available right now.', 'warning');
            });
        });
        _wireStatusRings(wrap);
    }

    function _renderRecent() {
        var wrap = document.getElementById('emp-calls-recent');
        if (!wrap) return;
        var myId = _myId();

        var rows = Object.keys(_callsRows).map(function (id) {
            var d = _callsRows[id]; d._id = id; return d;
        }).filter(function (d) { return !!d.finalStatus; }) // only finished calls belong in a log
          .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });

        if (!rows.length) {
            wrap.innerHTML = '<div style="text-align:center;color:#9CA3AF;padding:30px 10px;font-size:0.86rem;">No recent calls yet.</div>';
            return;
        }

        var html = '<div style="font-weight:800;font-size:0.95rem;margin:8px 0;">Recent</div>';
        rows.forEach(function (d) {
            var outgoing = d.callerId === myId;
            var otherId = outgoing ? d.calleeId : d.callerId;
            var mu = (window.mockUsers && window.mockUsers[otherId]) || {};
            var name = mu.fullName || mu.username || (outgoing ? 'User' : (d.callerName || 'User'));
            var avatar = mu.avatar || mu.photoURL || (outgoing ? '' : (d.callerAvatar || ''));
            var isVideo = d.type === 'video';
            var missed = !outgoing && (d.finalStatus === 'missed' || d.finalStatus === 'no_answer');
            var declined = d.finalStatus === 'declined';
            var statusLabel = missed ? ('Missed ' + (isVideo ? 'video' : 'voice') + ' call')
                : declined ? (outgoing ? 'Declined' : 'You declined')
                : (d.duration ? _fmtDuration(d.duration) : (isVideo ? 'Video call' : 'Voice call'));
            var arrowColor = missed ? '#E41E3F' : '#2E7D32';
            var arrowSvg = outgoing
                ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="' + arrowColor + '"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg>'
                : '<svg viewBox="0 0 24 24" width="13" height="13" fill="' + arrowColor + '"><path d="M17 7L7 17M7 17h9M7 17V8"/></svg>';

            var avatarHtml = avatar
                ? '<img src="' + _esc(avatar) + '" style="width:44px;height:44px;border-radius:50%;object-fit:cover;">'
                : '<div style="width:44px;height:44px;border-radius:50%;background:#1B2B8B;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;">' + _esc((name || 'U').charAt(0).toUpperCase()) + '</div>';
            avatarHtml = _statusRingWrap(avatarHtml, otherId, 44, 'flex-shrink:0;');

            html +=
                '<div class="emp-call-row" data-other-id="' + _esc(otherId) + '" data-is-video="' + (isVideo ? '1' : '0') + '" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(10,14,39,0.05);cursor:pointer;">' +
                    avatarHtml +
                    '<div style="flex:1;min-width:0;">' +
                        '<div style="font-weight:700;font-size:0.9rem;color:' + (missed ? '#E41E3F' : '#111') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(name) + '</div>' +
                        '<div style="display:flex;align-items:center;gap:5px;font-size:0.78rem;color:#6B7280;margin-top:2px;">' + arrowSvg + '<span>' + _esc(statusLabel) + ' \u00b7 ' + _esc(_fmtWhen(d.createdAt)) + '</span></div>' +
                    '</div>' +
                    '<button class="emp-call-back-btn" title="Call back" style="background:none;border:none;color:#1B2B8B;cursor:pointer;padding:8px;flex-shrink:0;">' +
                        (isVideo
                            ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>'
                            : '<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>') +
                    '</button>' +
                '</div>';
        });
        wrap.innerHTML += html;

        wrap.querySelectorAll('.emp-call-row').forEach(function (row) {
            var otherId = row.dataset.otherId;
            var isVideo = row.dataset.isVideo === '1';
            var backBtn = row.querySelector('.emp-call-back-btn');
            if (backBtn) backBtn.addEventListener('click', function (e) { e.stopPropagation(); _callBack(otherId, isVideo); });
            row.addEventListener('click', function () { _callBack(otherId, isVideo); });
        });
        _wireStatusRings(wrap);
    }

    /* =========================================================================
       §5 — call back: opens a FRESH browser tab (per this session's own
       request) rather than reusing the current one. The new tab loads the
       app at a `?callBack=<id>&callType=voice|video` deep link; §5b below
       (same pattern as v14.js's own `?openGroup=` handler) picks that up
       on load, opens the 1:1 chat, and taps that chat's own existing call
       button — same call path a person would use manually, just started
       from a new tab instead of the Calls list.
       ========================================================================= */
    function _callBack(otherId, isVideo) {
        if (!otherId) return;
        var url = location.origin + location.pathname + '?callBack=' + encodeURIComponent(otherId) +
            '&callType=' + (isVideo ? 'video' : 'voice');
        window.open(url, '_blank');
    }

    /* §5b — the fresh tab's own bootstrap: reads ?callBack=/&callType= once
       the new tab's session is signed in and ready, then opens the chat
       and taps its call button — identical mechanics to the old in-tab
       _callBack, just running in the tab that navigated here. */
    document.addEventListener('empyrean-init-done', function () {
        setTimeout(function () {
            try {
                var params = new URLSearchParams(location.search);
                var otherId = params.get('callBack');
                if (!otherId) return;
                var isVideo = params.get('callType') === 'video';
                if (typeof window.openChat !== 'function') return;
                window.openChat(otherId);
                setTimeout(function () {
                    var sel = isVideo ? '.oc-header-btn[title="Video call"]' : '.oc-header-btn[title="Voice call"]';
                    var btn = document.querySelector('#oc-chat-header ' + sel) || document.querySelector(sel);
                    if (btn) btn.click();
                    else notify('Chat opened — tap the call icon at the top to call back.', 'info');
                }, 450);
            } catch (e) {}
        }, 1200);
    });

    /* =========================================================================
       §6 — boot: keep trying to attach the tab button until v20's bar
       exists, and re-check after every relevant lifecycle event this
       codebase already dispatches.
       ========================================================================= */
    _ready(function () {
        setTimeout(_ensureTabButton, 400);
        setTimeout(_ensureTabButton, 1200);
    });
    document.addEventListener('empyrean-init-done', function () { setTimeout(_ensureTabButton, 300); });
    document.addEventListener('empyrean-section-change', function (e) {
        if (e && e.detail && e.detail.section === 'messages') setTimeout(_ensureTabButton, 200);
    });
    setInterval(_ensureTabButton, 2000);

    document.addEventListener('empyrean:logout', function () {
        _deactivate();
        try { localStorage.setItem(TAB_KEY, 'chats'); } catch (e) {}
    });

    console.log('[EmpyreanCallsLog] \u2705 Calls tab added inside the Messages screen \u2014 Ongoing (active group calls, tap to join) + Recent (1:1 call history, tap to call back). No existing file edited.');

})();